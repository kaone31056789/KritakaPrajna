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
  { id: "google/gemini-2.5-flash-image",        name: "Gemini 2.5 Flash Image",       _provider: "openrouter", _isImageGen: true, pricing: { prompt: "0.0000003", completion: "0.0000025" }, context_length: 0 },
  { id: "google/gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash Image",       _provider: "openrouter", _isImageGen: true, pricing: { prompt: "0.0000005", completion: "0.000003" }, context_length: 0 },
  { id: "google/gemini-3-pro-image-preview",     name: "Gemini 3 Pro Image",           _provider: "openrouter", _isImageGen: true, pricing: { prompt: "0.000002", completion: "0.000012" }, context_length: 0 },
  { id: "openai/gpt-5-image-mini",               name: "GPT-5 Image Mini",             _provider: "openrouter", _isImageGen: true, pricing: { prompt: "0.0000025", completion: "0.000002" }, context_length: 0 },
  { id: "openai/gpt-5-image",                    name: "GPT-5 Image",                  _provider: "openrouter", _isImageGen: true, pricing: { prompt: "0.00001", completion: "0.00001" }, context_length: 0 },
];

function parseOpenRouterError(text, fallback = "OpenRouter request failed") {
  let detail = text || fallback;
  try {
    const json = JSON.parse(text || "{}");
    detail =
      json?.error?.message ||
      json?.error ||
      json?.message ||
      text ||
      fallback;
  } catch {}
  return String(detail || fallback);
}

function extractImageUrlFromChatResponse(json) {
  const message = json?.choices?.[0]?.message || {};

  let imageUrl = message?.images?.[0]?.image_url?.url;
  if (!imageUrl) {
    imageUrl = json?.choices?.[0]?.images?.[0]?.image_url?.url;
  }

  if (!imageUrl && Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part?.type === "image_url" && part?.image_url?.url) {
        imageUrl = part.image_url.url;
        break;
      }
    }
  }

  if (!imageUrl && typeof message.content === "string" && message.content.startsWith("data:image/")) {
    imageUrl = message.content;
  }

  return imageUrl || null;
}

function extractUsageFromChatResponse(json) {
  const usage = json?.usage;
  if (!usage || typeof usage !== "object") return null;

  return {
    prompt_tokens: Number(usage.prompt_tokens) || 0,
    completion_tokens: Number(usage.completion_tokens) || 0,
    image_tokens:
      Number(usage.image_tokens) ||
      Number(usage?.completion_tokens_details?.image_tokens) ||
      0,
    cost: usage.cost != null ? Number(usage.cost) : null,
  };
}

async function generateImageViaChat(apiKey, modelId, prompt, modalities) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://kritakaprajna.app",
      "X-Title": "KritakaPrajna",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      modalities,
      stream: false,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(`OpenRouter ${res.status}: ${parseOpenRouterError(raw)}`);
    err.status = res.status;
    throw err;
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Invalid response from OpenRouter while generating image");
  }

  const imageUrl = extractImageUrlFromChatResponse(json);
  if (!imageUrl) {
    throw new Error("No image returned by selected model");
  }

  const usage = extractUsageFromChatResponse(json);
  return {
    imageUrl,
    usage,
    cost: usage?.cost ?? null,
  };
}

async function generateImageViaLegacyEndpoint(apiKey, modelId, prompt) {
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
    const txt = contentType.includes("text/html")
      ? "Model not available for image generation on OpenRouter"
      : await res.text();
    throw new Error(parseOpenRouterError(txt, txt));
  }

  const json = await res.json();
  const url = json.data?.[0]?.url || json.data?.[0]?.b64_json;
  if (!url) throw new Error("No image returned from OpenRouter");
  if (url.startsWith("data:") || url.startsWith("http")) return { imageUrl: url };
  return { imageUrl: `data:image/png;base64,${url}` };
}

/**
 * Generate an image via OpenRouter.
 * Uses chat/completions with modalities (current API),
 * then falls back to legacy images/generations endpoint.
 */
export async function generateImage(apiKey, modelId, prompt) {
  try {
    return await generateImageViaChat(apiKey, modelId, prompt, ["image", "text"]);
  } catch (err1) {
    const msg1 = String(err1?.message || "").toLowerCase();
    const tryImageOnly =
      msg1.includes("modalities") ||
      msg1.includes("unprocessable") ||
      msg1.includes("400") ||
      msg1.includes("422");

    if (tryImageOnly) {
      try {
        return await generateImageViaChat(apiKey, modelId, prompt, ["image"]);
      } catch {}
    }

    try {
      return await generateImageViaLegacyEndpoint(apiKey, modelId, prompt);
    } catch (legacyErr) {
      throw new Error(String(legacyErr?.message || err1?.message || "Image generation failed"));
    }
  }
}

