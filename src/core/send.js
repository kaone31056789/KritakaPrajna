import {
  routeStream,
  routeImageGen,
  isImageGenModel,
  findModelBySelection,
  suggestFallbackAcrossProviders,
} from "../api/providerRouter";
import { createStore, generateId } from "./store";
import { chatsStore, appendMessage, patchMessage, truncateMessages, setActiveChat } from "./chats";
import { settingsStore } from "./settings";
import { modelsStore } from "./models";
import { keysStore } from "./keys";
import { memoryStore, memoryPromptSection, captureMemoryFromExchange } from "./memory";
import {
  normalizeUserInputForSend,
  buildSlidingWindowHistory,
  resolveGenerationSettings,
  compressSystemPrompt,
} from "../utils/tokenOptimizer";
import { calculateCost } from "../utils/costTracker";
import { addLifetimeCost } from "../utils/costTracker";
import { recordProviderUsage } from "../utils/usageTracker";
import { recordSuccess, recordFailure } from "../utils/rateLimiter";
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

function buildSystemPrompt({ persona, webContext, hasWeb }) {
  const { systemPrompt, responseLength } = settingsStore.get();
  let prompt = compressSystemPrompt(systemPrompt);
  if (persona?.systemPrompt) prompt += `\n\n[Persona]\n${persona.systemPrompt.trim()}`;
  prompt += memoryPromptSection(memoryStore.get().memory);
  if (responseLength === "short") prompt += "\n\nKeep the answer brief.";
  if (responseLength === "long") prompt += "\n\nGive a thorough, complete answer.";
  if (hasWeb && webContext) {
    prompt += `\n\nUse the numbered [Web Sources] provided in the user message; cite them as [1], [2].`;
  }
  return prompt;
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

  const normalized = normalizeUserInputForSend(text, { maxChars: settings.maxUserChars });
  const cleanText = normalized?.text ?? String(text || "").trim();
  if (!cleanText && uploads.length === 0) return;

  // ── Compose the user message (text + attachments) ──
  const imageUploads = uploads.filter((u) => u.type === "image" && u.dataUrl);
  const textUploads = uploads.filter((u) => u.type !== "image" && u.content);
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
    appendMessage(id, { role: "user", content: displayContent, ts: Date.now() });
  }

  const controller = new AbortController();
  controllers.set(id, controller);
  const startedAt = Date.now();

  try {
    /* ── Image generation models take a different path ── */
    if (isImageGenModel(model)) {
      setRun(id, "imaging");
      appendMessage(id, { role: "assistant", content: "", streaming: true, ts: Date.now() });
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
      if (cost > 0) addLifetimeCost(cost);
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
    const { recentMessages } = buildSlidingWindowHistory(
      toApiMessages(history),
      settings.historyWindow
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

    const systemPrompt = buildSystemPrompt({ persona, webContext, hasWeb: sources.length > 0 });
    apiMessages = [{ role: "system", content: systemPrompt }, ...apiMessages];

    /* ── Stream ── */
    appendMessage(id, { role: "assistant", content: "", streaming: true, ts: Date.now() });
    const gen = resolveGenerationSettings(model._provider, settings.responseLength);

    let streamed = "";
    const { text: finalText, usage } = await routeStream(providers, model, apiMessages, {
      signal: controller.signal,
      reasoningDepth: settings.reasoningDepth,
      maxTokens: gen.maxTokens,
      temperature: gen.temperature,
      topP: gen.topP,
      onChunk: (chunk) => {
        streamed += chunk;
        patchMessage(id, -1, { content: streamed });
      },
    });

    const answer = finalText || streamed;
    const cost = calculateCost(usage, model.pricing);
    patchMessage(id, -1, {
      streaming: false,
      content: answer,
      _meta: {
        modelId: model.id,
        modelName: model.name || model.id,
        provider: model._provider,
        elapsedMs: Date.now() - startedAt,
        usage: usage || null,
        cost,
        webSources,
      },
    });

    recordSuccess(model.id, Date.now() - startedAt);
    recordProviderUsage(model._provider, usage || {}, cost || 0);
    if (cost > 0) addLifetimeCost(cost);
    captureMemoryFromExchange(cleanText, answer);
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

/** Export a chat as clean markdown. */
export function chatToMarkdown(chat) {
  const lines = [`# ${chat.title || "Chat"}`, ""];
  for (const m of chat.messages || []) {
    const who = m.role === "user" ? "You" : m._meta?.modelName || "Assistant";
    lines.push(`### ${who}`, "", extractText(m), "");
  }
  return lines.join("\n");
}
