import { mapAnthropicThinking, supportsReasoningModel } from "../utils/reasoningControls";
const API_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

// Static model list — Anthropic models change infrequently
const STATIC_ANTHROPIC_MODELS = [
  { id: "claude-opus-4-5",               name: "Claude Opus 4",         pricing: { prompt: "0.000015",  completion: "0.000075" }, context_length: 200000 },
  { id: "claude-sonnet-4-5",             name: "Claude Sonnet 4",       pricing: { prompt: "0.000003",  completion: "0.000015" }, context_length: 200000 },
  { id: "claude-haiku-4-5-20251001",     name: "Claude Haiku 4",        pricing: { prompt: "0.00000025",completion: "0.00000125"},context_length: 200000 },
  { id: "claude-3-5-sonnet-20241022",    name: "Claude 3.5 Sonnet",     pricing: { prompt: "0.000003",  completion: "0.000015" }, context_length: 200000 },
  { id: "claude-3-5-haiku-20241022",     name: "Claude 3.5 Haiku",      pricing: { prompt: "0.0000008", completion: "0.000004" }, context_length: 200000 },
  { id: "claude-3-opus-20240229",        name: "Claude 3 Opus",         pricing: { prompt: "0.000015",  completion: "0.000075" }, context_length: 200000 },
  { id: "claude-3-haiku-20240307",       name: "Claude 3 Haiku",        pricing: { prompt: "0.00000025",completion: "0.00000125"},context_length: 200000 },
];

export async function fetchModels(_apiKey) {
  // Return static list — no API call needed
  return STATIC_ANTHROPIC_MODELS.map((m) => ({
    ...m,
    _provider: "anthropic",
    architecture: { modality: "text+image->text" }, // all claude models support vision
  }));
}

/**
 * Stream a chat completion via the Anthropic Messages API.
 * Anthropic uses a different SSE format and requires system to be a top-level param.
 * Returns { text, usage } to match the other providers.
 */
export async function streamMessage(apiKey, modelId, messages, { onChunk, signal, reasoningDepth } = {}) {
  // Anthropic requires system as a separate param, not in messages array
  const systemMsg = messages.find((m) => m.role === "system");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      // Anthropic uses "user"/"assistant" roles only
      // Content can be string or array (multimodal)
      if (Array.isArray(m.content)) {
        // Convert OpenAI image_url format to Anthropic's format
        const parts = m.content.map((p) => {
          if (p.type === "text") return { type: "text", text: p.text };
          if (p.type === "image_url") {
            const url = p.image_url?.url || "";
            if (url.startsWith("data:")) {
              const [header, data] = url.split(",");
              const mediaType = header.replace("data:", "").replace(";base64", "");
              return { type: "image", source: { type: "base64", media_type: mediaType, data } };
            }
          }
          return null;
        }).filter(Boolean);
        return { role: m.role, content: parts };
      }
      return { role: m.role, content: m.content };
    });

  const body = {
    model: modelId,
    max_tokens: 8096,
    messages: chatMessages,
    stream: true,
  };
  if (systemMsg) body.system = systemMsg.content;
  if (supportsReasoningModel({ id: modelId, _provider: "anthropic" })) {
    body.thinking = {
      type: "enabled",
      budget_tokens: mapAnthropicThinking(reasoningDepth || "balanced"),
    };
  }

  const res = await fetch(`${API_BASE}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try { detail = JSON.parse(text).error?.message || text; } catch {}
    throw new Error(`Anthropic ${res.status}: ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  let usage = null;
  let currentEvent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { currentEvent = ""; continue; }
      if (trimmed.startsWith("event: ")) {
        currentEvent = trimmed.slice(7);
        continue;
      }
      if (trimmed.startsWith("data: ")) {
        const payload = trimmed.slice(6);
        try {
          const json = JSON.parse(payload);
          if (currentEvent === "content_block_delta" || json.type === "content_block_delta") {
            const text = json.delta?.text;
            if (text) {
              full += text;
              onChunk?.(full);
            }
          }
          if (currentEvent === "message_start" || json.type === "message_start") {
            const inputTokens = json.message?.usage?.input_tokens;
            if (inputTokens != null) {
              usage = {
                prompt_tokens: inputTokens || 0,
                completion_tokens: usage?.completion_tokens || 0,
                cost: null,
              };
            }
          }
          if (currentEvent === "message_delta" || json.type === "message_delta") {
            if (json.usage) {
              usage = {
                prompt_tokens: usage?.prompt_tokens || json.usage.input_tokens || 0,
                completion_tokens: json.usage.output_tokens || 0,
                cost: null,
              };
            }
          }
        } catch {}
      }
    }
  }

  return { text: full || "(No response)", usage };
}
