import { mapReasoningEffort, supportsReasoningModel } from "../utils/reasoningControls";
const API_BASE = "https://api.openai.com/v1";

// Static curated model list — fetched live below but this is the fallback
const STATIC_OPENAI_MODELS = [
  { id: "gpt-4o",            name: "GPT-4o",         pricing: { prompt: "0.0000025",  completion: "0.00001"   }, context_length: 128000 },
  { id: "gpt-4o-mini",       name: "GPT-4o mini",    pricing: { prompt: "0.00000015", completion: "0.0000006" }, context_length: 128000 },
  { id: "gpt-4-turbo",       name: "GPT-4 Turbo",    pricing: { prompt: "0.00001",    completion: "0.00003"   }, context_length: 128000 },
  { id: "gpt-3.5-turbo",     name: "GPT-3.5 Turbo",  pricing: { prompt: "0.0000005",  completion: "0.0000015" }, context_length: 16385  },
  { id: "o1",                name: "o1",              pricing: { prompt: "0.000015",   completion: "0.00006"   }, context_length: 200000 },
  { id: "o1-mini",           name: "o1-mini",         pricing: { prompt: "0.000003",   completion: "0.000012"  }, context_length: 128000 },
  { id: "o3-mini",           name: "o3-mini",         pricing: { prompt: "0.0000011",  completion: "0.0000044" }, context_length: 200000 },
];

/**
 * Returns the curated OpenAI model list with _provider tag.
 * Optionally validates the key with a lightweight /models call.
 */
export async function fetchModels(apiKey) {
  try {
    const res = await fetch(`${API_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenAI models: ${res.status}`);
    const json = await res.json();
    // Filter to chat-capable models from the live list
    const CHAT_IDS = new Set(STATIC_OPENAI_MODELS.map((m) => m.id));
    const live = (json.data || [])
      .filter((m) => CHAT_IDS.has(m.id))
      .map((m) => {
        const meta = STATIC_OPENAI_MODELS.find((s) => s.id === m.id);
        return { ...meta, _provider: "openai" };
      });
    // Return static list if live filtering yields nothing useful
    return live.length > 0 ? live : STATIC_OPENAI_MODELS.map((m) => ({ ...m, _provider: "openai" }));
  } catch {
    return STATIC_OPENAI_MODELS.map((m) => ({ ...m, _provider: "openai" }));
  }
}

/**
 * Stream a chat completion via OpenAI API.
 * Same return shape as openrouter.streamMessage: { text, usage }
 */
export async function streamMessage(
  apiKey,
  modelId,
  messages,
  { onChunk, signal, reasoningDepth, maxTokens, temperature, topP } = {}
) {
  const requestBody = {
    model: modelId,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    // TOKEN OPTIMIZATION: bounded output and controlled sampling.
    max_tokens: maxTokens ?? 512,
    temperature: temperature ?? 0.7,
    top_p: topP ?? 0.9,
  };

  if (supportsReasoningModel({ id: modelId, _provider: "openai" })) {
    requestBody.reasoning_effort = mapReasoningEffort(reasoningDepth || "balanced");
  }

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    let detail = body;
    try { detail = JSON.parse(body).error?.message || body; } catch {}
    throw new Error(`OpenAI ${res.status}: ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") break;
      try {
        const json = JSON.parse(payload);
        const token = json.choices?.[0]?.delta?.content;
        if (token) {
          full += token;
          onChunk?.(full);
        }
        if (json.usage) {
          usage = {
            prompt_tokens: json.usage.prompt_tokens || 0,
            completion_tokens: json.usage.completion_tokens || 0,
            cost: null, // OpenAI doesn't return cost in stream
          };
        }
      } catch {}
    }
  }

  return { text: full || "(No response)", usage };
}
