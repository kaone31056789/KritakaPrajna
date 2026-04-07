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
  historyWindowSize: 10,
  maxInputTokens: 3000,
  maxUserChars: 2000,
  summaryMaxTokens: 220,
  summaryCharLimit: 1200,
};

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

  let truncated = false;
  const limit = Math.max(100, Number(maxChars) || 2000);

  if (text.length > limit) {
    text = text.slice(0, limit).trimEnd();
    truncated = true;
  }

  return {
    text,
    truncated,
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
      `Return at most 8 bullets, under ${maxChars} characters total.`,
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

  for (const msg of overflowMessages.slice(-8)) {
    const role = msg?.role === "assistant" ? "Assistant" : "User";
    const text = cleanTextLine(extractMessageText(msg?.content));
    if (!text) continue;
    bullets.push(`- ${role}: ${text.slice(0, 140)}`);
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

export function enforceInputTokenBudget(messages = [], maxInputTokens = 3000) {
  const budget = Math.max(256, Number(maxInputTokens) || 3000);
  const next = [...messages];
  let droppedCount = 0;

  while (estimateTokensFromMessages(next) > budget && next.length > 2) {
    // Preserve system message at index 0 and latest user turn at the end.
    next.splice(1, 1);
    droppedCount += 1;
  }

  const estimatedTokens = estimateTokensFromMessages(next);
  return {
    messages: next,
    droppedCount,
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
