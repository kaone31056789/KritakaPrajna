import {
  routeStream,
  routeImageGen,
  isImageGenModel,
  findModelBySelection,
  suggestFallbackAcrossProviders,
} from "../api/providerRouter";
import { createStore, generateId } from "./store";
import { chatsStore, appendMessage, patchMessage, truncateMessages, setActiveChat, applyAutoTitle, patchChat, renameChat, userMessageText, attachmentLabel } from "./chats";
import { settingsStore } from "./settings";
import { modelsStore } from "./models";
import { keysStore } from "./keys";
import { memoryStore, memoryPromptSection, captureMemoryFromExchange } from "./memory";
import { maybeExtractMemoryLLM } from "./memoryExtract";
import {
  normalizeUserInputForSend,
  assembleContextWindow,
  resolveGenerationSettings,
  compressSystemPrompt,
  resolveAdaptiveTokenBudgets,
  enforceInputTokenBudget,
  estimateTokensFromMessages,
} from "../utils/tokenOptimizer";
import {
  calculateCost,
  addLifetimeCost,
  isModelFree,
  getMonthlySpend,
  addMonthlySpend,
} from "../utils/costTracker";
import { recordProviderUsage } from "../utils/usageTracker";
import { supportsVision } from "../utils/smartModelSelect";
import { recordSuccess, recordFailure, isModelUnavailable } from "../utils/rateLimiter";
import { isWebIntent, isNewsIntent, isDetailedIntent, buildSearchQuery } from "../utils/intentDetector";
import {
  webSearch,
  deepArticleSearch,
  fetchAllWebContent,
  buildWebContext,
  extractUrlsFromText,
  parseWebCommand,
  mergeWebSources,
} from "../utils/webFetcher";

/* ═══ Run state — one entry per chat while a request is in flight ═══ */

export const sendStore = createStore({ runs: {} });
const controllers = new Map();

function setRun(chatId, phase) {
  sendStore.set((s) => ({
    runs: phase
      ? { ...s.runs, [chatId]: { phase, startedAt: s.runs[chatId]?.startedAt || Date.now() } }
      : Object.fromEntries(Object.entries(s.runs).filter(([k]) => k !== chatId)),
  }));
}

export function isBusy(chatId) {
  return !!sendStore.get().runs[chatId];
}

export function stopStreaming(chatId) {
  controllers.get(chatId)?.abort();
}

/* ═══ Helpers ═══ */

const EXPLICIT_WEB_RE =
  /\b(websearch|web\s*search|search (the )?(web|internet|online)|browse (the )?(web|internet|online)|look (it )?up( online)?|latest|current|today|breaking)\b/i;

function personaFor(chat) {
  const { personas, activePersonaId } = chatsStore.get();
  const id = chat?.personaId || activePersonaId;
  return personas.find((p) => p.id === id) || null;
}

function buildSystemPrompt({ persona, webContext, hasWeb, contextText = "" }) {
  const { systemPrompt, responseLength } = settingsStore.get();
  let prompt = compressSystemPrompt(systemPrompt);
  if (persona?.systemPrompt) prompt += `\n\n[Persona]\n${persona.systemPrompt.trim()}`;
  const memorySection = memoryPromptSection(memoryStore.get().memory, contextText);
  prompt += memorySection;
  // Universal proportionality rule — injected here (not only in the default
  // prompt) so users with an older persisted system prompt get it too. Small
  // local models especially need this or "hi" turns into an essay.
  prompt += "\n\nMatch answer length to the request: greetings and trivial messages get a one-line reply.";
  if (responseLength === "short") prompt += "\n\nKeep the answer brief.";
  if (responseLength === "long") prompt += "\n\nGive a thorough, complete answer.";
  if (hasWeb && webContext) {
    prompt += `\n\nUse the numbered [Web Sources] provided in the user message; cite them as [1], [2].`;
  }
  return { prompt, memoryUsed: memorySection.length > 0 };
}

async function runWebSearch(rawText, webMode, onPhase) {
  if (webMode === "off" || !window.electronAPI) return { sources: [], attempted: false };

  const command = parseWebCommand(rawText);
  const urls = extractUrlsFromText(rawText);
  const explicit = EXPLICIT_WEB_RE.test(rawText);
  const intent = isWebIntent(rawText) || isNewsIntent(rawText);
  const shouldSearch = webMode === "always" || command || urls.length > 0 || explicit || intent;
  if (!shouldSearch) return { sources: [], attempted: false };

  onPhase("searching");
  try {
    if ((command || urls.length > 0) && window.electronAPI?.fetchWebPage) {
      const sources = await fetchAllWebContent(rawText);
      return { sources: sources || [], attempted: true };
    }
    const query = buildSearchQuery(rawText) || rawText;
    const detailed = isDetailedIntent(rawText);
    let sources = await webSearch(query, { detailed, includeNews: isNewsIntent(rawText) });
    if ((!sources || sources.length === 0) && window.electronAPI?.deepSearch) {
      sources = mergeWebSources(await deepArticleSearch(query));
    }
    return { sources: sources || [], attempted: true };
  } catch {
    return { sources: [], attempted: true };
  }
}

function toApiMessages(messages) {
  // Strip UI-only fields before sending to providers
  return messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && !m.error)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Ask the model for a concise title AND a novelty judgement in one call.
 * Returns { title, special } — special = the question is genuinely unusual/creative.
 */
/** Flatten string-or-parts message content to plain text (image parts become a tag). */
function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p?.type === "text" ? p.text : p?.type === "image_url" ? "[image]" : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/**
 * Turn a raw title-model response into a usable thread title — or "" if the
 * model rambled. Small local models (3B) often reply conversationally
 * ("The user wants me to name this chat…") or leak <think> blocks; take the
 * first line that actually looks like a title instead of line 1 blindly.
 */
const TITLE_META_LINE_RE =
  /^(the (user|chat|conversation|thread)|okay|ok\b|sure|alright|here('|’)?s?\b|i('|’)?(ll| will| am|m| can| need| think)?\b|let('|’)?s\b|as an ai|based on|this (chat|conversation|thread|is)|note[:\s]|response[:\s]|answer[:\s])/i;

function sanitizeTitle(raw) {
  const cleaned = String(raw || "")
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, " ")
    .replace(/```[\s\S]*?(```|$)/g, " ");
  for (let line of cleaned.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^special\s*[=:]/i.test(line)) continue;
    line = line
      .replace(/^["'`*#\-–—\s]+|["'`*]+$/g, "")
      .replace(/^\s*(line\s*1\s*[:.]?\s*)?title\s*[:=\-]\s*/i, "")
      .replace(/\bSPECIAL\s*[=:]\s*(yes|no)\b.*$/i, "")
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    if (!line) continue;
    if (TITLE_META_LINE_RE.test(line)) continue; // conversational/meta, not a title
    if (line.split(/\s+/).length > 9) continue; // essay line, not a title
    return line.slice(0, 48);
  }
  return "";
}

async function generateChatTitle(providers, model, firstUser, firstReply) {
  // Prefer the user's typed intent; if they only attached a file, title from the
  // file name + the assistant's reply rather than 800 chars of raw file dump.
  const intent = userMessageText(firstUser);
  const att = attachmentLabel(firstUser);
  const userLine =
    intent || (att ? `Shared a file: ${att}` : contentToText(firstUser?.content).slice(0, 200));
  const convo =
    `User: ${userLine.slice(0, 800)}` +
    (att && intent ? `\n(Attached file: ${att})` : "") +
    (firstReply ? `\n\nAssistant: ${contentToText(firstReply.content).slice(0, 400)}` : "");
  const { text } = await routeStream(
    providers,
    model,
    [
      {
        role: "system",
        content:
          "You name chat threads. Line 1: a short specific title (3-6 words, Title Case, no quotes, no trailing punctuation). Line 2: SPECIAL=yes if the user's request is genuinely unusual, creative, or thought-provoking, otherwise SPECIAL=no. Output only those two lines.",
      },
      { role: "user", content: convo },
    ],
    { reasoningDepth: "off", maxTokens: 40, temperature: 0.3, onChunk: () => {} }
  );
  const raw = String(text || "");
  const title = sanitizeTitle(raw);
  const special = /special\s*[=:]\s*yes/i.test(raw);
  return { title, special };
}

/**
 * Try each candidate model in order until one yields a usable title. Covers
 * local-only setups where the "free API model" has no key (call fails) and
 * tiny local models whose first attempt sanitizes to "".
 */
async function titleWithFallback(providers, candidates, firstUser, firstReply) {
  const list = candidates.filter(Boolean);
  const seen = new Set();
  let attempted = false;
  for (const m of list) {
    const key = m.id || m.name || JSON.stringify(m);
    if (seen.has(key)) continue;
    seen.add(key);
    // Skip models currently rate-limited / cooling down (health tracked from real
    // sends) so titling never stalls on a 429. The model that just answered is
    // healthy, so it is never skipped here.
    if (isModelUnavailable(m._selectionId || m.id)) continue;
    attempted = true;
    try {
      const res = await generateChatTitle(providers, m, firstUser, firstReply);
      if (res.title) return res;
    } catch {
      /* rate-limited or keyless — try the next candidate */
    }
  }
  // Every candidate was flagged unavailable — one last-resort attempt so a title
  // can still land instead of leaving the placeholder forever.
  if (!attempted && list.length) {
    try {
      return await generateChatTitle(providers, list[0], firstUser, firstReply);
    } catch {
      /* keep the placeholder title */
    }
  }
  return { title: "", special: false };
}

/**
 * Pick a FREE model for titling so naming a thread never costs the user money.
 * Prefers an OpenRouter ":free" variant, then any zero-priced model, and only
 * falls back to the caller's active model if no free model is available.
 */
function pickTitleModel(models, fallback) {
  const list = Array.isArray(models) ? models : [];
  const free = list.filter((m) => isModelFree(m.pricing));
  return (
    free.find((m) => /:free\b/i.test(m.id || "")) ||
    free[0] ||
    fallback ||
    null
  );
}

/**
 * ChatGPT-style auto-title: after the first exchange, name the thread and flag
 * genuinely unique ones. Non-blocking and best-effort — any failure keeps the
 * instant first-message placeholder, and a manual rename is never overridden.
 * Titles with the model that actually answered so it matches the user's choice;
 * a free model is only a fallback when that model is rate-limited/unavailable.
 */
async function maybeAutoTitle(id, providers, model) {
  try {
    const chat = chatsStore.get().chats.find((c) => c.id === id);
    if (!chat || chat.titleLocked || chat.autoTitled) return;
    const msgs = chat.messages || [];
    if (msgs.filter((m) => m.role === "user").length !== 1) return; // only the opening turn
    const firstUser = msgs.find((m) => m.role === "user");
    const firstReply = msgs.find((m) => m.role === "assistant" && !m.error && m.content);
    if (!firstUser || !firstReply) return;

    // Use the model that just answered first (the user picked it); fall back to a
    // free model only if the answering model is rate-limited / has no key.
    const { title, special } = await titleWithFallback(
      providers,
      [model, pickTitleModel(modelsStore.get().models, model)],
      firstUser,
      firstReply
    );
    if (title) applyAutoTitle(id, title);
    if (special) patchChat(id, { special: true });
  } catch {
    /* keep the placeholder title */
  }
}

/**
 * Manual "Rename with AI" (sidebar right-click). Forces a fresh title + special
 * flag on demand, using the currently selected model. Locks the title after.
 */
export async function regenerateTitle(chatId) {
  try {
    const chat = chatsStore.get().chats.find((c) => c.id === chatId);
    if (!chat) return;
    const msgs = chat.messages || [];
    const firstUser = msgs.find((m) => m.role === "user");
    if (!firstUser) return;
    const firstReply = msgs.find((m) => m.role === "assistant" && !m.error && m.content);
    const providers = keysStore.get().providers;
    const { models, selectedId } = modelsStore.get();
    const selected = findModelBySelection(models, selectedId);
    const { title, special } = await titleWithFallback(
      providers,
      [selected, pickTitleModel(models, selected)],
      firstUser,
      firstReply
    );
    if (title) renameChat(chatId, title);
    patchChat(chatId, { special: !!special });
  } catch {
    /* ignore — leave the existing title */
  }
}

/* ═══ The send pipeline ═══ */

/**
 * Send a user message in a chat.
 * @param {object} p
 * @param {string} p.chatId       target chat (created on demand when missing)
 * @param {string} p.text         raw user input
 * @param {Array}  p.uploads      [{type:'image', dataUrl} | {type:'text'|'pdf', name, content}]
 * @param {boolean} p.skipUserAppend  used by regenerate — reuse existing history
 */
export async function sendMessage({ chatId, text, uploads = [], skipUserAppend = false }) {
  const providers = keysStore.get().providers;
  const { models, selectedId } = modelsStore.get();
  const settings = settingsStore.get();

  let id = chatId;
  if (!id) {
    id = generateId();
    setActiveChat(id);
  }
  if (isBusy(id)) return;

  const chat = chatsStore.get().chats.find((c) => c.id === id) || null;
  const persona = personaFor(chat);
  const model =
    findModelBySelection(models, persona?.modelId || "") ||
    findModelBySelection(models, selectedId);
  if (!model) {
    appendMessage(id, {
      role: "assistant",
      content: "",
      error: "No model selected. Add a provider key or pick a model first.",
    });
    return;
  }

  /* ── Monthly cost cap (paid models only — free models always pass) ── */
  const costCap = Number(settings.costCapMonthly) || 0;
  if (costCap > 0 && !isModelFree(model.pricing) && getMonthlySpend() >= costCap) {
    appendMessage(id, {
      role: "assistant",
      content: "",
      error: `Monthly cost cap of $${costCap.toFixed(2)} reached. Switch to a free model or raise the cap in Settings → Behavior.`,
    });
    return;
  }

  const normalized = normalizeUserInputForSend(text, { maxChars: settings.maxUserChars });
  const cleanText = normalized?.text ?? String(text || "").trim();
  if (!cleanText && uploads.length === 0) return;

  // ── Compose the user message (text + attachments) ──
  const imageUploads = uploads.filter((u) => u.type === "image" && u.dataUrl);
  const textUploads = uploads.filter((u) => u.type !== "image" && u.content);

  /* ── Vision guard: don't burn a request sending images to a text-only model ── */
  if (imageUploads.length > 0 && !isImageGenModel(model) && !supportsVision(model)) {
    appendMessage(id, {
      role: "assistant",
      content: "",
      error: `${model.name || model.id} can't read images. Pick a vision-capable model (e.g. one tagged "multimodal" in the model picker) and resend, or remove the image attachment.`,
    });
    return;
  }
  let textContent = cleanText;
  if (textUploads.length > 0) {
    const fileBlocks = textUploads
      .map((u) => `[Attached file: ${u.name}]\n\`\`\`\n${String(u.content).slice(0, 24000)}\n\`\`\``)
      .join("\n\n");
    textContent = `${fileBlocks}\n\n${textContent}`;
  }

  if (!skipUserAppend) {
    const displayContent =
      imageUploads.length > 0
        ? [
            ...imageUploads.map((u) => ({ type: "image_url", image_url: { url: u.dataUrl } })),
            { type: "text", text: textContent },
          ]
        : textContent;
    // Attachment chips: metadata only. The real file content stays inlined in
    // `content` (that's what the model receives). `_displayText` is the user's
    // typed text, shown in the bubble instead of the inlined file dump so a
    // non-image upload renders as a compact chip rather than a wall of text.
    const attachments = textUploads.map((u) => ({ name: u.name || "file", kind: u.type || "file" }));
    appendMessage(id, {
      role: "user",
      content: displayContent,
      ...(attachments.length > 0 ? { _attachments: attachments } : {}),
      _displayText: cleanText,
      ts: Date.now(),
    });
  }

  const controller = new AbortController();
  controllers.set(id, controller);
  const startedAt = Date.now();

  try {
    /* ── Image generation models take a different path ── */
    // Provisional meta so the model's brand icon shows while streaming
    // (full meta with usage/cost overwrites it on completion).
    const liveMeta = { modelId: model.id, modelName: model.name || model.id, provider: model._provider };

    if (isImageGenModel(model)) {
      setRun(id, "imaging");
      appendMessage(id, { role: "assistant", content: "", streaming: true, ts: Date.now(), _meta: liveMeta });
      const result = await routeImageGen(providers, model, textContent);
      const usage = result?.usage || null;
      const cost = result?.cost ?? calculateCost(usage, model.pricing);
      patchMessage(id, -1, {
        streaming: false,
        content: result?.text || "",
        _images: result?.imageUrl ? [result.imageUrl] : [],
        _meta: {
          modelId: model.id,
          modelName: model.name || model.id,
          provider: model._provider,
          elapsedMs: Date.now() - startedAt,
          usage,
          cost,
        },
      });
      recordProviderUsage(model._provider, usage || {}, cost || 0);
      if (cost > 0) {
        addLifetimeCost(cost);
        addMonthlySpend(cost);
      }
      return;
    }

    /* ── Web search (auto intent / explicit / always) ── */
    const { sources, attempted } = await runWebSearch(cleanText, settings.webMode, (phase) =>
      setRun(id, phase)
    );
    const webContext = sources.length > 0 ? buildWebContext(sources, { detailed: isDetailedIntent(cleanText) }) : "";
    const webSources = sources
      .filter((s) => s.ok)
      .slice(0, 6)
      .map((s) => ({ title: s.title || s.url, url: s.url }));

    /* ── Build request messages ── */
    setRun(id, "streaming");
    const stateNow = chatsStore.get();
    const history = stateNow.chats.find((c) => c.id === id)?.messages || [];
    const keepFiles = settings.keepFilesInContext !== false;
    const { messages: recentMessages, summaryNote } = assembleContextWindow(
      toApiMessages(history),
      {
        contextMode: settings.contextMode || "full",
        windowSize: settings.historyWindow,
        protectFiles: keepFiles,
      }
    );

    // Inject web context into the final user turn
    let apiMessages = [...recentMessages];
    if (webContext && apiMessages.length > 0) {
      const last = apiMessages[apiMessages.length - 1];
      if (last.role === "user") {
        apiMessages[apiMessages.length - 1] = {
          ...last,
          content:
            typeof last.content === "string"
              ? `${webContext}${last.content}`
              : last.content.map((p) => (p.type === "text" ? { ...p, text: `${webContext}${p.text}` } : p)),
        };
      }
    } else if (attempted && sources.length === 0 && apiMessages.length > 0) {
      const last = apiMessages[apiMessages.length - 1];
      if (last.role === "user" && typeof last.content === "string") {
        apiMessages[apiMessages.length - 1] = {
          ...last,
          content: `${last.content}\n\n[NOTE: Web search returned no results — answer from training knowledge and say so briefly.]`,
        };
      }
    }

    const built = buildSystemPrompt({
      persona,
      webContext,
      hasWeb: sources.length > 0,
      contextText: cleanText,
    });
    const memoryUsed = built.memoryUsed;
    // Smart context mode condenses older turns into a summary the model still sees.
    const systemPrompt = summaryNote
      ? `${built.prompt}\n\n[Earlier conversation summary — older turns condensed]\n${summaryNote}`
      : built.prompt;
    apiMessages = [{ role: "system", content: systemPrompt }, ...apiMessages];

    /* ── Token optimisation — fit the request into the model's context budget ── */
    let tokenSavings = null;
    if (settings.tokenMode !== "off") {
      const budgets = resolveAdaptiveTokenBudgets(cleanText, {
        maxInputTokens: settings.maxInputTokens || undefined,
        maxUserChars: settings.maxUserChars,
        modelContextTokens: model.context_length || model.contextLength || null,
      });
      const cap =
        settings.tokenMode === "aggressive" && Number.isFinite(budgets.maxInputTokens)
          ? Math.max(1024, Math.floor(budgets.maxInputTokens * 0.55))
          : budgets.maxInputTokens;
      if (Number.isFinite(cap)) {
        const before = estimateTokensFromMessages(apiMessages);
        const opt = enforceInputTokenBudget(apiMessages, cap, { protectFiles: keepFiles });
        apiMessages = opt.messages;
        if (opt.droppedCount > 0 || opt.compressedCount > 0) {
          const saved = Math.max(0, before - opt.estimatedTokens);
          if (saved > 0) {
            tokenSavings = {
              saved,
              finalTokens: opt.estimatedTokens,
              compressed: opt.compressedCount,
              dropped: opt.droppedCount,
              mode: settings.tokenMode,
            };
          }
          console.info(
            `[tokenOptimizer] ~${opt.estimatedTokens} tok (cap ${cap}) — saved ~${saved}, compressed ${opt.compressedCount}, dropped ${opt.droppedCount}`
          );
        }
      }
    }

    /* ── Stream (auto-failover retries once on another provider/model) ── */
    appendMessage(id, { role: "assistant", content: "", streaming: true, ts: Date.now(), _meta: liveMeta });

    // Track the model that actually produced the answer (may differ from the
    // originally-selected `model` after a failover) so auto-rename titles with it.
    let answeredModel = model;
    const streamOnce = async (mdl, failoverFrom = null) => {
      const gen = resolveGenerationSettings(mdl._provider, settings.responseLength);
      let streamed = "";
      const { text: finalText, usage } = await routeStream(providers, mdl, apiMessages, {
        signal: controller.signal,
        reasoningDepth: settings.reasoningDepth,
        maxTokens: gen.maxTokens,
        temperature: gen.temperature,
        topP: gen.topP,
        // Providers emit the cumulative text so far, not a delta — assign, don't append,
        // or the live bubble renders "He" + "Hello" + "Hello there" until the stream ends.
        onChunk: (chunk) => {
          streamed = chunk;
          patchMessage(id, -1, { content: streamed });
        },
      });

      const answer = finalText || streamed;
      const cost = calculateCost(usage, mdl.pricing);
      patchMessage(id, -1, {
        streaming: false,
        content: answer,
        _meta: {
          modelId: mdl.id,
          modelName: mdl.name || mdl.id,
          provider: mdl._provider,
          elapsedMs: Date.now() - startedAt,
          usage: usage || null,
          cost,
          webSources,
          ...(memoryUsed ? { memoryUsed: true } : {}),
          ...(failoverFrom ? { failoverFrom } : {}),
          ...(tokenSavings ? { tokenSavings } : {}),
        },
      });

      answeredModel = mdl; // the model that actually landed this reply
      recordSuccess(mdl.id, Date.now() - startedAt);
      recordProviderUsage(mdl._provider, usage || {}, cost || 0);
      if (cost > 0) {
        addLifetimeCost(cost);
        addMonthlySpend(cost);
      }
      captureMemoryFromExchange(cleanText, answer);
      // Background LLM extraction — throttled, free-model-first, feeds the pending review queue
      maybeExtractMemoryLLM(providers, models, mdl, cleanText, answer);
    };

    // A vision turn must fail over to another vision model, never a text-only one.
    const needsVision = imageUploads.length > 0;
    try {
      await streamOnce(model);
    } catch (err) {
      if (controller.signal.aborted) throw err;
      recordFailure(model.id, String(err?.message || ""));
      // failoverMode: "never" → surface the error; "notify"/"silent" → reroute.
      const mode = settings.failoverMode || "notify";
      const fallback = mode !== "never"
        ? suggestFallbackAcrossProviders(models, model._selectionId || selectedId, providers, { needsVision })
        : null;
      if (!fallback?.model || fallback.model.id === model.id) throw err;
      // Reset the message slot and retry once on the fallback route. In "notify"
      // mode we record where we switched from so the reply can show a visible
      // "switched from X → Y" badge; "silent" reroutes without the badge.
      patchMessage(id, -1, { content: "", streaming: true, error: undefined });
      await streamOnce(fallback.model, mode === "notify" ? (model.name || model.id) : null);
    }

    // First exchange landed — generate a ChatGPT-style title in the background,
    // using the model that actually answered (post-failover) rather than the
    // originally-selected one.
    maybeAutoTitle(id, providers, answeredModel);
  } catch (err) {
    const aborted = controller.signal.aborted || /abort/i.test(String(err?.message || ""));
    recordFailure(model.id, String(err?.message || ""));

    const fallback = aborted ? null : suggestFallbackAcrossProviders(models, selectedId, providers);
    patchMessage(id, -1, (m) => ({
      streaming: false,
      content: m.content || "",
      error: aborted ? "Stopped." : String(err?.message || "Request failed."),
      _fallback: fallback ? { selectionId: fallback.model._selectionId, message: fallback.message } : undefined,
    }));
  } finally {
    controllers.delete(id);
    setRun(id, null);
  }
}

/* ═══ Message actions ═══ */

/** Regenerate the assistant reply at `index` (truncates everything after the preceding user turn). */
export async function regenerateMessage(chatId, index) {
  const chat = chatsStore.get().chats.find((c) => c.id === chatId);
  if (!chat) return;
  // Find the user turn that produced this assistant message
  let userIdx = -1;
  for (let i = index; i >= 0; i--) {
    if (chat.messages[i]?.role === "user") {
      userIdx = i;
      break;
    }
  }
  if (userIdx === -1) return;
  truncateMessages(chatId, userIdx + 1);
  await sendMessage({ chatId, text: extractText(chat.messages[userIdx]), skipUserAppend: true });
}

/** Replace a user message's text and re-send from that point. */
export async function editAndResend(chatId, index, newText) {
  const chat = chatsStore.get().chats.find((c) => c.id === chatId);
  if (!chat || chat.messages[index]?.role !== "user") return;
  truncateMessages(chatId, index);
  await sendMessage({ chatId, text: newText });
}

export function extractText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

/* ═══ Reasoning / think-tag parsing ═══
   Many reasoning models (DeepSeek R1/V3, Qwen3, etc.) emit their chain of
   thought inline as <think>…</think> right in the content stream. We split
   that out so the UI can render it as a dedicated, collapsible panel instead
   of dumping raw tags into the answer. Handles the streaming case where the
   closing </think> hasn't arrived yet. */

/** Strip protocol artifacts that occasionally leak into visible text:
 *  orphan think tags, agent <step> markers, and DeepSeek tool-call tokens. */
export function stripProtocolNoise(s) {
  return String(s || "")
    .replace(/<\s*\/?\s*(think|thinking|reasoning)\s*>/gi, "")
    .replace(/<\s*\/?\s*step\b[^>]*>/gi, "")
    .replace(/<\s*\|\s*tool_calls?_(?:begin|end)\s*\|\s*>/gi, "")
    .replace(/<\s*\|\s*tool_call_(?:begin|end)\s*\|\s*>/gi, "")
    .replace(/<\s*\|\s*tool_sep\s*\|\s*>/gi, "");
}

/**
 * Split assistant text into reasoning (chain of thought) and the visible answer.
 * @returns {{ reasoning: string, answer: string, pending: boolean, hasReasoning: boolean }}
 *   pending = an unclosed <think> block is still streaming (no answer yet).
 */
export function splitReasoning(raw) {
  const text = typeof raw === "string" ? raw : extractText(raw);
  if (!/<\s*(think|thinking|reasoning)\s*>/i.test(text)) {
    return { reasoning: "", answer: stripProtocolNoise(text).trim(), pending: false, hasReasoning: false };
  }

  let reasoning = "";
  let answer = "";
  let idx = 0;
  const closed = /<\s*(think|thinking|reasoning)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi;
  let m;
  while ((m = closed.exec(text)) !== null) {
    answer += text.slice(idx, m.index);
    reasoning += (reasoning ? "\n" : "") + m[2].trim();
    idx = closed.lastIndex;
  }

  let pending = false;
  const rest = text.slice(idx);
  const open = /<\s*(think|thinking|reasoning)\s*>([\s\S]*)$/i.exec(rest);
  if (open) {
    answer += rest.slice(0, open.index);
    reasoning += (reasoning ? "\n" : "") + open[2].replace(/^\s+/, "");
    pending = true;
  } else {
    answer += rest;
  }

  const cleanReasoning = reasoning.trim();
  return {
    reasoning: cleanReasoning,
    answer: stripProtocolNoise(answer).trim(),
    pending,
    hasReasoning: cleanReasoning.length > 0 || pending,
  };
}

/** Export a chat as clean markdown. */
export function chatToMarkdown(chat) {
  const lines = [`# ${chat.title || "Chat"}`, ""];
  for (const m of chat.messages || []) {
    const who = m.role === "user" ? "You" : m._meta?.modelName || "Assistant";
    // Assistant turns carry chain-of-thought in <think> blocks — export the answer only.
    const body = m.role === "user" ? extractText(m) : splitReasoning(m).answer;
    lines.push(`### ${who}`, "", body, "");
  }
  return lines.join("\n");
}
