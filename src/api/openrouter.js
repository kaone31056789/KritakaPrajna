import { mapReasoningEffort, supportsReasoningModel } from "../utils/reasoningControls";
const API_BASE = "https://openrouter.ai/api/v1";

export async function fetchModels(apiKey) {
  const res = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.data || [];
}

/**
 * Fetch account credits and usage from OpenRouter.
 * Returns { total_credits, total_usage } or null on failure.
 */
export async function fetchCredits(apiKey) {
  try {
    const res = await fetch(`${API_BASE}/credits`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

/**
 * Stream a chat completion. Calls `onChunk(text)` for each token.
 * Returns { text, usage } where usage is { prompt_tokens, completion_tokens } or null.
 * Pass an AbortController signal to allow cancellation.
 */
export async function streamMessage(apiKey, model, messages, { onChunk, signal, reasoningDepth } = {}) {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const body = { model, messages, stream: true };
    if (supportsReasoningModel({ id: model, _provider: "openrouter" })) {
      body.reasoning = { effort: mapReasoningEffort(reasoningDepth || "balanced") };
    }

    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://kritakaprajna.app",
        "X-Title": "KritakaPrajna",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (res.status === 429 && attempt < maxRetries - 1) {
      const wait = (attempt + 1) * 2000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (!res.ok) {
      const errorBody = await res.text();
      let detail = "";
      try {
        const parsed = JSON.parse(errorBody);
        detail = parsed.error?.message || errorBody;
      } catch {
        detail = errorBody;
      }
      if (res.status === 429) {
        throw new Error("Rate limited — try a different model or wait a moment.");
      }
      if (res.status === 404 && detail.toLowerCase().includes("guardrail")) {
        throw new Error("Blocked by your OpenRouter privacy settings. Go to openrouter.ai/settings/privacy and allow this provider.");
      }
      throw new Error(`${res.status}: ${detail}`);
    }

    // Read the SSE stream
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
          // Capture usage from the final chunk (OpenRouter includes it)
          if (json.usage) {
            usage = {
              prompt_tokens: json.usage.prompt_tokens || 0,
              completion_tokens: json.usage.completion_tokens || 0,
              cost: json.usage.cost ?? null, // Actual cost from OpenRouter
            };
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    return { text: full || "(No response)", usage };
  }
}

/** Image generation models available on OpenRouter (confirmed catalog IDs) */
export const IMAGE_GEN_MODELS = [
  { id: "openai/dall-e-3",                    name: "DALL·E 3",          _provider: "openrouter", _isImageGen: true, pricing: { prompt: "0.00004", completion: "0" }, context_length: 0 },
  { id: "black-forest-labs/flux-1.1-pro",     name: "FLUX 1.1 Pro",      _provider: "openrouter", _isImageGen: true, pricing: { prompt: "0.000004", completion: "0" }, context_length: 0 },
  { id: "black-forest-labs/flux-pro",         name: "FLUX Pro",          _provider: "openrouter", _isImageGen: true, pricing: { prompt: "0.000055", completion: "0" }, context_length: 0 },
  { id: "black-forest-labs/flux-schnell",     name: "FLUX Schnell",      _provider: "openrouter", _isImageGen: true, pricing: { prompt: "0.0000005", completion: "0" }, context_length: 0 },
  { id: "stability-ai/stable-diffusion-xl",  name: "Stable Diffusion XL", _provider: "openrouter", _isImageGen: true, pricing: { prompt: "0.000008", completion: "0" }, context_length: 0 },
];

/**
 * Generate an image via OpenRouter's images/generations endpoint.
 * Returns { imageUrl } — a remote URL.
 */
export async function generateImage(apiKey, modelId, prompt) {
  const res = await fetch(`${API_BASE}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://kritakaprajna.app",
      "X-Title": "KritakaPrajna",
    },
    body: JSON.stringify({ model: modelId, prompt, n: 1 }),
  });

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok || contentType.includes("text/html")) {
    // HTML response = endpoint doesn't exist or model not found
    const txt = contentType.includes("text/html")
      ? "Model not available for image generation on OpenRouter"
      : await res.text();
    let msg = txt;
    try { if (!contentType.includes("text/html")) msg = JSON.parse(txt).error?.message || txt; } catch {}
    throw new Error(msg);
  }

  const json = await res.json();
  const url = json.data?.[0]?.url || json.data?.[0]?.b64_json;
  if (!url) throw new Error("No image returned from OpenRouter");
  if (url.startsWith("data:") || url.startsWith("http")) return { imageUrl: url };
  return { imageUrl: `data:image/png;base64,${url}` };
}

