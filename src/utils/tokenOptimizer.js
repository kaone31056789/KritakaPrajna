// TOKEN OPTIMIZATION: Shared utilities for prompt compression, history pruning,
// token estimation, and generation defaults.

export const RESPONSE_LENGTH_PRESETS = {
  short: 128,
  medium: 512,
  long: 1024,
};

export const PROVIDER_GENERATION_DEFAULTS = {
  openrouter: { maxTokens: 512, temperature: 0.7, topP: 0.9 },
  openai: { maxTokens: 512, temperature: 0.7, topP: 0.9 },
  anthropic: { maxTokens: 512, temperature: 0.7, topP: 0.9 },
  huggingface: { maxTokens: 512, temperature: 0.65, topP: 0.9 },
  ollama: { maxTokens: 512, temperature: 0.7, topP: 0.9 },
};

export const DEFAULT_TOKEN_OPTIMIZATION_CONFIG = {
  historyWindowSize: 18,
  maxInputTokens: 12000,
  maxUserChars: 48000,
  summaryMaxTokens: 220,
  summaryCharLimit: 1800,
};

const DEEP_ANALYSIS_RE = /\b(deep analysis|analyze deeply|in-depth analysis|detailed analysis|thorough analysis|full analysis|step[-\s]?by[-\s]?step analysis|explain in depth|deep dive)\b/i;
const CODE_REQUEST_RE = /\b(provide code|write code|show code|give me code|full code|complete code|implement (this|it)|build (this|it) in code|code example|with code|return code)\b/i;
const NEGATED_CODE_RE = /\b(no code|without code|dont write code|do not write code|skip code)\b/i;

function toFinitePositive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function shouldRelaxTokenMode(rawText = "") {
  const text = asString(rawText).toLowerCase();
  if (!text.trim()) return false;

  const deepIntent = DEEP_ANALYSIS_RE.test(text);
  const codeIntent = CODE_REQUEST_RE.test(text) && !NEGATED_CODE_RE.test(text);
  return deepIntent || codeIntent;
}

export function resolveAdaptiveTokenBudgets(
  rawText,
  {
    maxInputTokens = DEFAULT_TOKEN_OPTIMIZATION_CONFIG.maxInputTokens,
    maxUserChars = DEFAULT_TOKEN_OPTIMIZATION_CONFIG.maxUserChars,
    modelContextTokens = null,
  } = {}
) {
  const baseInput = toFinitePositive(maxInputTokens, DEFAULT_TOKEN_OPTIMIZATION_CONFIG.maxInputTokens);
  const baseChars = toFinitePositive(maxUserChars, DEFAULT_TOKEN_OPTIMIZATION_CONFIG.maxUserChars);
  const modelCtx = Number(modelContextTokens);

  // Leave room for model output + protocol overhead instead of using a tiny fixed cap.
  const adaptiveInput = Number.isFinite(modelCtx) && modelCtx > 0
    ? Math.max(1024, modelCtx - Math.max(2048, Math.floor(modelCtx * 0.2)))
    : baseInput;

  // Soft char guidance derived from token budget; input normalization will not hard-trim.
  const adaptiveChars = Math.max(baseChars, Math.round(adaptiveInput * 4.5));
  const relaxed = shouldRelaxTokenMode(rawText);

  if (!relaxed) {
    return {
      relaxed: false,
      maxInputTokens: adaptiveInput,
      maxUserChars: adaptiveChars,
      minResponseTokens: null,
    };
  }

  return {
    relaxed: true,
    maxInputTokens: Number.POSITIVE_INFINITY,
    maxUserChars: Number.POSITIVE_INFINITY,
    minResponseTokens: 8192,
  };
}

function asString(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function cleanTextLine(value) {
  return asString(value).replace(/\s+/g, " ").trim();
}

export function normalizeUserInputForSend(rawText, { maxChars = 2000 } = {}) {
  const original = asString(rawText);

  let text = original
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([!?.,])\1{3,}/g, "$1$1")
    .trim();

  let condensed = false;
  let condensedChars = 0;
  const rawLimit = Number(maxChars);
  const hasSoftLimit = Number.isFinite(rawLimit) && rawLimit > 0;

  // Avoid hard trimming user input. If it is extremely long, condense semantically.
  if (hasSoftLimit && text.length > rawLimit * 2.5) {
    const blocks = text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (blocks.length >= 4) {
      const head = blocks.slice(0, 3);
      const tail = blocks.slice(-2);
      const bullets = blocks
        .flatMap((part) => part.split("\n").map((line) => line.trim()))
        .filter((line) => /^([\-*•]|\d+[.)])\s+/.test(line))
        .slice(0, 24);
      const middle = blocks
        .slice(3, -2)
        .sort((a, b) => b.length - a.length)
        .slice(0, 3);

      const composite = [
        ...head,
        bullets.length > 0 ? `Key points:\n${bullets.join("\n")}` : "",
        ...middle,
        ...tail,
      ]
        .filter(Boolean)
        .join("\n\n")
        .trim();

      if (composite && composite.length < text.length * 0.9) {
        condensed = true;
        condensedChars = text.length - composite.length;
        text = composite;
      }
    }
  }

  return {
    text,
    truncated: false,
    condensed,
    condensedChars,
    originalLength: original.length,
    finalLength: text.length,
  };
}

export function compressSystemPrompt(rawPrompt) {
  let prompt = asString(rawPrompt)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Remove common filler phrase without touching app-specific identity.
  prompt = prompt.replace(/\bYou are a helpful assistant that\b/gi, "");

  const lines = prompt
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => {
      if (!line) {
        return idx > 0 && arr[idx - 1] !== "";
      }
      return true;
    });

  return lines.join("\n").trim();
}

export function extractMessageText(content) {
  if (typeof content === "string") return content;

  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part) return "";
      if (typeof part === "string") return part;
      if (part.type === "text") return asString(part.text);
      if (part.type === "image_url") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function estimateTokensFromText(text) {
  const chars = asString(text).length;
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

export function estimateTokensFromMessage(message) {
  const roleOverhead = 4;
  const role = estimateTokensFromText(message?.role || "user");
  const body = estimateTokensFromText(extractMessageText(message?.content));
  return roleOverhead + role + body;
}

export function estimateTokensFromMessages(messages = []) {
  return (messages || []).reduce((sum, msg) => sum + estimateTokensFromMessage(msg), 0);
}

export function buildSlidingWindowHistory(messages = [], windowSize = 10) {
  const size = Math.max(1, Number(windowSize) || 10);
  const safeMessages = Array.isArray(messages) ? messages : [];

  if (safeMessages.length <= size) {
    return {
      recentMessages: [...safeMessages],
      overflowMessages: [],
      overflowCount: 0,
    };
  }

  const overflowCount = safeMessages.length - size;
  return {
    recentMessages: safeMessages.slice(-size),
    overflowMessages: safeMessages.slice(0, overflowCount),
    overflowCount,
  };
}

export function buildHistorySummaryPrompt(
  overflowMessages = [],
  existingSummary = "",
  summaryCharLimit = 1200
) {
  const transcript = (overflowMessages || [])
    .map((msg) => {
      const role = asString(msg?.role || "user").toUpperCase();
      const content = cleanTextLine(extractMessageText(msg?.content)).slice(0, 260);
      if (!content) return "";
      return `${role}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");

  const prior = cleanTextLine(existingSummary);
  const maxChars = Math.max(400, Number(summaryCharLimit) || 1200);

  return {
    system:
      "Compress prior conversation context for future turns. Return concise bullet points only. Keep constraints, decisions, requirements, unresolved issues, and action items. Avoid filler.",
    user: [
      prior ? `Existing summary to preserve:\n${prior}` : "",
      transcript ? `New transcript lines:\n${transcript}` : "",
      `Return at most 12 bullets, under ${maxChars} characters total.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function buildFallbackHistorySummary(
  overflowMessages = [],
  existingSummary = "",
  summaryCharLimit = 1200
) {
  const bullets = [];

  if (existingSummary) {
    bullets.push(existingSummary.trim());
  }

  for (const msg of overflowMessages.slice(-14)) {
    const role = msg?.role === "assistant" ? "Assistant" : "User";
    const text = cleanTextLine(extractMessageText(msg?.content));
    if (!text) continue;
    bullets.push(`- ${role}: ${text.slice(0, 180)}`);
  }

  const merged = bullets.join("\n").trim();
  const maxChars = Math.max(400, Number(summaryCharLimit) || 1200);
  return merged.slice(0, maxChars).trim();
}

function modelUnitCost(model) {
  const prompt = Number(model?.pricing?.prompt) || 0;
  const completion = Number(model?.pricing?.completion) || 0;
  return prompt + completion;
}

export function pickCheapestSummaryModel(models = [], providers = {}) {
  const active = (models || []).filter((m) => !!providers?.[m?._provider]);
  if (active.length === 0) return null;

  const ollama = active.find((m) => m?._provider === "ollama");
  if (ollama) return ollama;

  const hfFree = active.find((m) => m?._provider === "huggingface" && modelUnitCost(m) === 0);
  if (hfFree) return hfFree;

  const freeAny = active.find((m) => modelUnitCost(m) === 0);
  if (freeAny) return freeAny;

  return [...active].sort((a, b) => modelUnitCost(a) - modelUnitCost(b))[0] || null;
}

function compressTextForBudget(text = "", targetChars = 240) {
  const source = cleanTextLine(text);
  if (!source) return "";

  const maxChars = Math.max(80, Number(targetChars) || 240);
  if (source.length <= maxChars) return source;

  const sentenceParts = source
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts.length >= 3) {
    const first = sentenceParts[0];
    const last = sentenceParts[sentenceParts.length - 1];
    const middleBudget = Math.max(24, maxChars - first.length - last.length - 8);
    const middle = sentenceParts
      .slice(1, -1)
      .join(" ")
      .slice(0, middleBudget)
      .trim();

    const stitched = [first, middle ? `${middle}...` : "...", last]
      .filter(Boolean)
      .join(" ")
      .slice(0, maxChars)
      .trim();

    if (stitched) return stitched;
  }

  const headLen = Math.max(30, Math.floor(maxChars * 0.65));
  const tailLen = Math.max(16, maxChars - headLen - 4);
  return `${source.slice(0, headLen).trimEnd()} ... ${source.slice(-tailLen).trimStart()}`.slice(0, maxChars).trim();
}

function compressMessageContent(content, targetChars) {
  if (typeof content === "string") {
    return compressTextForBudget(content, targetChars);
  }

  if (!Array.isArray(content)) {
    return content;
  }

  const textParts = content.filter((part) => part?.type === "text");
  if (textParts.length === 0) return content;

  const perPartBudget = Math.max(48, Math.floor((targetChars || 240) / textParts.length));
  return content.map((part) => {
    if (part?.type !== "text") return part;
    return {
      ...part,
      text: compressTextForBudget(part?.text || "", perPartBudget),
    };
  });
}

function compressMessageForBudget(message, targetChars) {
  const nextContent = compressMessageContent(message?.content, targetChars);
  const before = extractMessageText(message?.content);
  const after = extractMessageText(nextContent);
  return {
    message: { ...message, content: nextContent },
    changed: after.length > 0 && after.length < before.length,
  };
}

export function enforceInputTokenBudget(messages = [], maxInputTokens = 3000) {
  const rawBudget = Number(maxInputTokens);
  if (!Number.isFinite(rawBudget) || rawBudget <= 0) {
    return {
      messages: [...messages],
      droppedCount: 0,
      compressedCount: 0,
      estimatedTokens: estimateTokensFromMessages(messages),
      overBudget: false,
    };
  }

  const budget = Math.max(256, rawBudget);
  const next = [...messages];
  let compressedCount = 0;

  let estimatedTokens = estimateTokensFromMessages(next);
  if (estimatedTokens > budget) {
    // Preserve structure and roles; progressively compress older turns.
    const candidateIndexes = [];
    for (let i = 1; i < next.length - 1; i++) {
      candidateIndexes.push(i);
    }

    for (let round = 0; round < 5 && estimatedTokens > budget; round++) {
      let changedInRound = false;
      for (const idx of candidateIndexes) {
        const current = next[idx];
        const sourceText = extractMessageText(current?.content);
        if (!sourceText || sourceText.length < 120) continue;

        const reduction = Math.max(0.3, 0.72 - round * 0.12);
        const targetChars = Math.max(96, Math.floor(sourceText.length * reduction));
        const compressed = compressMessageForBudget(current, targetChars);
        if (compressed.changed) {
          next[idx] = compressed.message;
          compressedCount += 1;
          changedInRound = true;
        }
      }

      estimatedTokens = estimateTokensFromMessages(next);
      if (!changedInRound) break;
    }

    if (estimatedTokens > budget && next.length > 1) {
      for (let i = 0; i < next.length - 1; i++) {
        const current = next[i];
        const sourceText = extractMessageText(current?.content);
        if (!sourceText || sourceText.length < 80) continue;
        const compressed = compressMessageForBudget(current, 120);
        if (compressed.changed) {
          next[i] = compressed.message;
          compressedCount += 1;
        }
      }
      estimatedTokens = estimateTokensFromMessages(next);
    }

    // If still over budget, compress the newest user payload with semantic preservation.
    if (estimatedTokens > budget && next.length > 0) {
      const latestIdx = next.length - 1;
      for (let round = 0; round < 4 && estimatedTokens > budget; round++) {
        const latest = next[latestIdx];
        const sourceText = extractMessageText(latest?.content);
        if (!sourceText || sourceText.length < 180) break;

        const reduction = Math.max(0.35, 0.82 - round * 0.16);
        const targetChars = Math.max(160, Math.floor(sourceText.length * reduction));
        const compressed = compressMessageForBudget(latest, targetChars);
        if (!compressed.changed) break;

        next[latestIdx] = compressed.message;
        compressedCount += 1;
        estimatedTokens = estimateTokensFromMessages(next);
      }
    }
  }

  return {
    messages: next,
    droppedCount: 0,
    compressedCount,
    estimatedTokens,
    overBudget: estimatedTokens > budget,
  };
}

export function resolveGenerationSettings(provider, responseLength = "medium") {
  const defaults = PROVIDER_GENERATION_DEFAULTS[provider] || PROVIDER_GENERATION_DEFAULTS.openrouter;
  const preset = RESPONSE_LENGTH_PRESETS[responseLength] || defaults.maxTokens;

  return {
    maxTokens: Math.max(64, Math.min(4096, Number(preset) || defaults.maxTokens)),
    temperature: defaults.temperature,
    topP: defaults.topP,
  };
}

// ── Deep Analysis Window Expansion ──────────────────────────────────────────

const DEEP_ANALYSIS_FULL_RE = /\b(deep analysis|analyze deeply|in-depth analysis|detailed analysis|thorough analysis|full analysis|step[-\s]?by[-\s]?step analysis|explain in depth|deep dive|comprehensive analysis|complete analysis|exhaustive|break(down| it down) (in detail|thoroughly|completely))\b/i;

/**
 * Detect if the current request warrants a larger token window.
 * Returns expanded config or the defaults.
 */
export function resolveDeepAnalysisConfig(rawText = "", baseConfig = {}) {
  const text = asString(rawText).toLowerCase();
  const isDeep = DEEP_ANALYSIS_FULL_RE.test(text) || shouldRelaxTokenMode(rawText);

  if (!isDeep) {
    return {
      deepAnalysis: false,
      historyWindowSize: baseConfig.historyWindowSize || DEFAULT_TOKEN_OPTIMIZATION_CONFIG.historyWindowSize,
      maxInputTokens: baseConfig.maxInputTokens || DEFAULT_TOKEN_OPTIMIZATION_CONFIG.maxInputTokens,
      maxUserChars: baseConfig.maxUserChars || DEFAULT_TOKEN_OPTIMIZATION_CONFIG.maxUserChars,
    };
  }

  // Deep analysis: expand windows significantly
  return {
    deepAnalysis: true,
    historyWindowSize: Math.max(baseConfig.historyWindowSize || 18, 100),
    maxInputTokens: Math.max(baseConfig.maxInputTokens || 12000, 128000),
    maxUserChars: Math.max(baseConfig.maxUserChars || 48000, 512000),
  };
}

// ── Tiered Compression Engine ───────────────────────────────────────────────

const ACKNOWLEDGMENT_RE = /^(ok|okay|sure|got it|thanks|thank you|understood|alright|perfect|great|nice|cool|yes|yep|yeah|no problem|np|ty)[\s.!]*$/i;
const MARKDOWN_BOLD_RE = /\*\*(.*?)\*\*/g;
const MARKDOWN_ITALIC_RE = /\*(.*?)\*/g;
const MARKDOWN_HEADER_RE = /^#{1,6}\s+/gm;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;
const CODE_COMMENT_LINE_RE = /^\s*\/\/.*$/gm;
const CODE_COMMENT_BLOCK_RE = /\/\*[\s\S]*?\*\//g;
const HASH_COMMENT_RE = /^\s*#(?!!).*$/gm;

/**
 * L0: Lossless compression — only removes truly redundant content.
 */
function compressL0(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * L1: Structural compression — remove formatting, keep content.
 */
function compressL1(text) {
  let result = compressL0(text);
  // Strip markdown formatting
  result = result.replace(MARKDOWN_BOLD_RE, "$1");
  result = result.replace(MARKDOWN_ITALIC_RE, "$1");
  result = result.replace(MARKDOWN_HEADER_RE, "");
  result = result.replace(MARKDOWN_LINK_RE, "$1");
  // Strip code comments (but preserve code blocks themselves)
  const codeBlocks = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });
  result = result.replace(CODE_COMMENT_LINE_RE, "");
  result = result.replace(CODE_COMMENT_BLOCK_RE, "");
  result = result.replace(HASH_COMMENT_RE, "");
  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    result = result.replace(`__CODE_BLOCK_${i}__`, block);
  });
  result = result.replace(/\n{3,}/g, "\n\n").trim();
  return result;
}

/**
 * L2: Semantic compression — keep important sentences, drop filler.
 */
function compressL2(text, keepRatio = 0.6) {
  let result = compressL1(text);
  if (result.length < 200) return result;

  // Preserve code blocks
  const codeBlocks = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // Split into sentences and score by information density
  const sentences = result.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 3) {
    codeBlocks.forEach((block, i) => {
      result = result.replace(`__CODE_BLOCK_${i}__`, block);
    });
    return result;
  }

  // Score sentences by: length (info density), presence of specifics (numbers, names, terms)
  const scored = sentences.map((s, idx) => {
    let score = 0;
    score += Math.min(s.length / 200, 1) * 0.3; // longer = more info
    score += (/\d+/.test(s) ? 0.15 : 0); // has numbers
    score += (/[A-Z][a-z]+/.test(s) ? 0.1 : 0); // has proper nouns
    score += (/`[^`]+`/.test(s) ? 0.2 : 0); // has inline code
    score += (idx === 0 ? 0.15 : 0); // first sentence bonus
    score += (idx === sentences.length - 1 ? 0.1 : 0); // last sentence bonus
    return { sentence: s, score, idx };
  });

  const keepCount = Math.max(2, Math.ceil(sentences.length * keepRatio));
  const kept = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, keepCount)
    .sort((a, b) => a.idx - b.idx)
    .map((s) => s.sentence);

  result = kept.join(" ");

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    result = result.replace(`__CODE_BLOCK_${i}__`, block);
  });

  return result.trim();
}

/**
 * L3: Aggressive compression — hard caps per message.
 */
function compressL3(text, maxChars = 300) {
  let result = compressL2(text, 0.4);
  if (result.length <= maxChars) return result;

  // Hard truncate with head/tail preservation
  const headLen = Math.floor(maxChars * 0.65);
  const tailLen = Math.max(30, maxChars - headLen - 5);
  return `${result.slice(0, headLen).trimEnd()} … ${result.slice(-tailLen).trimStart()}`;
}

function compressMessageAtLevel(message, level) {
  const text = extractMessageText(message?.content);
  if (!text || text.length < 60) return { message, changed: false };

  let compressed;
  switch (level) {
    case 0:
      compressed = compressL0(text);
      break;
    case 1:
      compressed = compressL1(text);
      break;
    case 2:
      compressed = compressL2(text);
      break;
    case 3:
      compressed = compressL3(text);
      break;
    default:
      compressed = text;
  }

  const changed = compressed.length < text.length;
  if (!changed) return { message, changed: false };

  const newContent = typeof message.content === "string"
    ? compressed
    : Array.isArray(message.content)
      ? message.content.map((part) =>
          part?.type === "text" ? { ...part, text: compressed } : part
        )
      : compressed;

  return {
    message: { ...message, content: newContent },
    changed: true,
  };
}

/**
 * Tiered compression — apply lightest compression first, escalate only if needed.
 *
 * @param {Array} messages - Messages to compress
 * @param {Object} options
 * @param {number} options.targetTokens - Token budget
 * @param {number} options.maxLevel - Max compression level (0-3, default 3)
 * @param {boolean} options.deepAnalysis - If true, be more conservative
 * @returns {{ messages, level, savings: { tokens, percentage }, compressionLog }}
 */
export function tieredCompress(messages, options = {}) {
  const {
    targetTokens = 12000,
    maxLevel = 3,
    deepAnalysis = false,
  } = options;

  const effectiveTarget = deepAnalysis ? Math.max(targetTokens, 32000) : targetTokens;
  const originalTokens = estimateTokensFromMessages(messages);

  if (originalTokens <= effectiveTarget) {
    return {
      messages: [...messages],
      level: -1,
      savings: { tokens: 0, percentage: 0 },
      compressionLog: [],
    };
  }

  let current = [...messages];
  let currentTokens = originalTokens;
  const log = [];

  for (let level = 0; level <= Math.min(maxLevel, 3); level++) {
    if (currentTokens <= effectiveTarget) break;

    let levelChanges = 0;
    const beforeTokens = currentTokens;

    // Skip system message (index 0) and current user message (last) at lower levels
    const startIdx = level < 2 ? 1 : 0;
    const endIdx = level < 3 ? current.length - 1 : current.length;

    for (let i = startIdx; i < endIdx; i++) {
      // Skip acknowledgments entirely at L2+
      if (level >= 2) {
        const msgText = extractMessageText(current[i]?.content);
        if (ACKNOWLEDGMENT_RE.test(String(msgText || "").trim())) {
          // Replace with a minimal marker
          current[i] = { ...current[i], content: "[ack]" };
          levelChanges++;
          continue;
        }
      }

      const { message: compressed, changed } = compressMessageAtLevel(current[i], level);
      if (changed) {
        current[i] = compressed;
        levelChanges++;
      }
    }

    currentTokens = estimateTokensFromMessages(current);
    const saved = beforeTokens - currentTokens;

    log.push({
      level,
      name: ["Lossless", "Structural", "Semantic", "Aggressive"][level],
      messagesChanged: levelChanges,
      tokensSaved: saved,
      tokensAfter: currentTokens,
    });
  }

  const totalSaved = originalTokens - currentTokens;
  const lastLevel = log.length > 0 ? log[log.length - 1].level : -1;

  return {
    messages: current,
    level: lastLevel,
    savings: {
      tokens: totalSaved,
      percentage: originalTokens > 0 ? Math.round((totalSaved / originalTokens) * 100) : 0,
    },
    compressionLog: log,
  };
}
