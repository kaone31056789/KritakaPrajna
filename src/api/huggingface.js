import { mapReasoningEffort, supportsReasoningModel } from "../utils/reasoningControls";
const API_BASE = "https://router.huggingface.co/v1";
const HUB_API  = "https://huggingface.co/api/models";

const BLOCKED_MODEL_IDS = new Set([
  "deepseek-ai/DeepSeek-V3.2",
]);

// Fallback list — used when Hub API fetch fails.
// Only small/medium models reliably supported on HuggingFace's free Serverless Inference tier.
const FALLBACK_MODELS = [
  "deepseek-ai/DeepSeek-V3.2-Exp",
  "HuggingFaceTB/SmolLM3-3B",
  "HuggingFaceTB/SmolLM2-1.7B-Instruct",
  "Qwen/Qwen2.5-7B-Instruct",
  "Qwen/Qwen2.5-Coder-7B-Instruct",
  "meta-llama/Llama-3.2-3B-Instruct",
  "meta-llama/Llama-3.1-8B-Instruct",
  "mistralai/Mistral-7B-Instruct-v0.3",
  "mistralai/Mistral-Nemo-Instruct-2407",
  "google/gemma-2-2b-it",
  "microsoft/Phi-3.5-mini-instruct",
  "HuggingFaceH4/zephyr-7b-beta",
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
  "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
  "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
];

const PREFERRED_PREFIXES = [
  "openai/gpt-oss",
  "moonshotai/Kimi",
  "zai-org/GLM",
  "deepseek-ai/DeepSeek-V3",
  "deepseek-ai/DeepSeek-R1",
  "Qwen/Qwen3",
  "Qwen/Qwen2.5-Coder-32B-Instruct",
  "Qwen/Qwen2.5-7B-Instruct-1M",
  "HuggingFaceTB/SmolLM",
  "Qwen/Qwen2.5",
  "meta-llama/Llama-4",
  "meta-llama/Llama-3.3",
  "google/gemma-4",
  "google/gemma-3",
  "google/gemma-2",
  "microsoft/Phi-3.5",
  "meta-llama/Llama-3.2",
  "meta-llama/Llama-3.1",
  "mistralai/Mistral-",
  "deepseek-ai/DeepSeek-R1-Distill",
  "HuggingFaceH4/zephyr",
  "TinyLlama/",
];

function idToName(id) {
  const short = id.includes("/") ? id.split("/")[1] : id;
  return short
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function buildModel(id, downloads = 0) {
  return {
    id,
    name: idToName(id),
    pricing: { prompt: "0", completion: "0" }, // HF free inference tier
    context_length: 32768,
    _provider: "huggingface",
    _downloads: downloads,
  };
}

function buildRouterModel(raw) {
  const inputPerMillion = Number(raw?.pricing?.input);
  const outputPerMillion = Number(raw?.pricing?.output);

  const id = raw.id || raw.modelId;

  return {
    id,
    name: idToName(id),
    pricing: {
      prompt: Number.isFinite(inputPerMillion) ? String(inputPerMillion / 1_000_000) : "0",
      completion: Number.isFinite(outputPerMillion) ? String(outputPerMillion / 1_000_000) : "0",
    },
    context_length: raw.context_length || 32768,
    _provider: "huggingface",
    _downloads: Number(raw.downloads) || 0,
    _ownedBy: raw.owned_by || "",
  };
}

function preferredRank(id) {
  const index = PREFERRED_PREFIXES.findIndex((prefix) => id.startsWith(prefix));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isLikelyChatModel(modelId) {
  const id = modelId.toLowerCase();
  const hints = [
    "instruct", "chat", "-it", "_it", "assistant", "zephyr", "hermes",
    "openhermes", "command-r", "smollm", "phi", "deepseek-r1-distill",
    "deepseek-r1", "deepseek-v3", "thinking", "aya", "1m",
    "gemma-4", "gemma-3", "gemma-2", "coder", "reasoner", "kimi", "gpt-oss",
    "glm-4", "llama-4", "llama-3.3", "sonoma", "magistral", "mistral-small",
  ];
  return hints.some((hint) => id.includes(hint));
}

function isLikelySupportedSize(modelId) {
  const id = modelId.toLowerCase();
  const tooLarge = ["671b", "480b", "405b", "236b", "123b"];
  return !tooLarge.some((token) => id.includes(token));
}

function isBadVariant(modelId) {
  const id = modelId.toLowerCase();
  const badHints = ["gguf", "awq", "gptq", "exl2", "mlx", "onnx", "int4", "int8", "4bit", "8bit", "quant"];
  return !badHints.some((hint) => id.includes(hint));
}

function isNonChatTaskModel(modelId) {
  const id = modelId.toLowerCase();
  const blocked = [
    "embedding", "rerank", "rank", "whisper", "tts", "asr", "stt",
    "diffusion", "sdxl", "flux", "image", "vision-preview", "vl-ocr",
    "moderation", "sentence-transformer", "bge-", "gte-", "jina-embeddings",
  ];
  return blocked.some((hint) => id.includes(hint));
}

function isBlockedModelId(modelId) {
  return BLOCKED_MODEL_IDS.has(modelId);
}

function sortModels(models) {
  return models.sort((a, b) => {
    const rankDiff = preferredRank(a.id) - preferredRank(b.id);
    if (rankDiff !== 0) return rankDiff;

    const aPaid = (Number(a.pricing?.prompt) || 0) + (Number(a.pricing?.completion) || 0) > 0 ? 1 : 0;
    const bPaid = (Number(b.pricing?.prompt) || 0) + (Number(b.pricing?.completion) || 0) > 0 ? 1 : 0;
    if (aPaid !== bPaid) return bPaid - aPaid;

    return b._downloads - a._downloads || a.id.localeCompare(b.id);
  });
}

async function fetchRouterModels(apiKey) {
  const res = await fetch(`${API_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) throw new Error(`Router models ${res.status}`);

  const json = await res.json();
  const raw = Array.isArray(json?.data) ? json.data : [];
  if (raw.length === 0) throw new Error("Empty router model response");

  return raw
    .filter((m) => {
      const modelId = m.id || m.modelId;
      if (!modelId) return false;
      if (isBlockedModelId(modelId)) return false;
      if (isNonChatTaskModel(modelId)) return false;
      if (!isLikelyChatModel(modelId)) return false;
      if (!isBadVariant(modelId)) return false;
      return true;
    })
    .map((m) => buildRouterModel(m))
    .filter((m, index, arr) => arr.findIndex((x) => x.id === m.id) === index);
}

function normalizeChatModel(modelId) {
  if (!modelId) return modelId;
  return modelId.includes(":") ? modelId : `${modelId}:fastest`;
}

function stripRoutingSuffix(modelId) {
  if (!modelId) return modelId;
  const idx = modelId.indexOf(":");
  return idx === -1 ? modelId : modelId.slice(0, idx);
}

function parseErrorDetail(text) {
  let detail = text;
  try {
    const json = JSON.parse(text);
    detail = json?.error?.message || json?.error || json?.message || text;
  } catch {}
  return String(detail || "Unknown error");
}

function contentPartToText(part) {
  if (!part) return "";
  if (typeof part === "string") return part;
  if (part.type === "text" && typeof part.text === "string") return part.text;
  if (part.type === "image_url") return "[Image omitted]";
  return "";
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(contentPartToText).filter(Boolean).join("\n");
}

function toTextGenerationPrompt(messages) {
  const lines = [];
  for (const msg of messages || []) {
    const role = msg?.role || "user";
    const text = contentToText(msg?.content).trim();
    if (!text) continue;

    const label = role === "system"
      ? "System"
      : role === "assistant"
        ? "Assistant"
        : role === "tool"
          ? "Tool"
          : "User";

    lines.push(`${label}: ${text}`);
  }

  lines.push("Assistant:");
  return lines.join("\n\n");
}

function extractGeneratedText(payload, prompt) {
  let text = "";

  if (Array.isArray(payload)) {
    text = payload[0]?.generated_text || payload[0]?.text || "";
  } else if (payload && typeof payload === "object") {
    text =
      payload.generated_text ||
      payload.text ||
      payload?.choices?.[0]?.message?.content ||
      payload?.choices?.[0]?.text ||
      "";
  } else if (typeof payload === "string") {
    text = payload;
  }

  if (text && prompt && text.startsWith(prompt)) {
    text = text.slice(prompt.length).trimStart();
  }

  return String(text || "").replace(/^assistant:\s*/i, "").trim();
}

function shouldUseTextGenerationFallback(status, detail, modelId) {
  if (![400, 404, 422].includes(status)) return false;

  const lower = String(detail || "").toLowerCase();
  if (lower.includes("not a chat model")) return true;
  if (lower.includes("chat template")) return true;
  if (lower.includes("chat/completions")) return true;
  if (lower.includes("messages") && lower.includes("unsupported")) return true;

  // DeepSeek V3.2 is often exposed as text-generation on HF instead of chat/completions.
  return String(modelId || "").toLowerCase().includes("deepseek-v3.2");
}

async function streamViaCompletions(apiKey, modelId, messages, { onChunk, signal } = {}) {
  const body = {
    model: normalizeChatModel(modelId),
    prompt: toTextGenerationPrompt(messages),
    stream: true,
    max_tokens: 2048,
  };

  const res = await fetch(`${API_BASE}/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HuggingFace ${res.status}: ${parseErrorDetail(text)}`);
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
        const token = json.choices?.[0]?.text || json.choices?.[0]?.delta?.content;
        if (token) {
          full += token;
          onChunk?.(full);
        }
        if (json.usage) {
          usage = {
            prompt_tokens: json.usage.prompt_tokens || 0,
            completion_tokens: json.usage.completion_tokens || 0,
            cost: null,
          };
        }
      } catch {}
    }
  }

  return { text: full || "(No response)", usage };
}

async function streamViaTextGeneration(apiKey, modelId, messages, { onChunk, signal } = {}) {
  const prompt = toTextGenerationPrompt(messages);
  const resolvedModel = stripRoutingSuffix(modelId);

  const res = await fetch(`https://router.huggingface.co/hf-inference/models/${resolvedModel}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "x-wait-for-model": "true",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: 2048,
        return_full_text: false,
      },
      options: {
        wait_for_model: true,
      },
    }),
    signal,
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`HuggingFace ${res.status}: ${parseErrorDetail(rawText)}`);
  }

  let payload = rawText;
  try {
    payload = JSON.parse(rawText);
  } catch {}

  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.error) {
    throw new Error(`HuggingFace: ${payload.error}`);
  }

  const text = extractGeneratedText(payload, prompt) || "(No response)";
  onChunk?.(text);

  return {
    text,
    usage: null,
  };
}

/**
 * Fetch models from the HuggingFace Hub that support the Serverless Inference API.
 * Uses the hf-inference model catalog and then narrows to likely chat-capable small models.
 * Falls back to a curated static list on failure.
 */
export async function fetchModels(apiKey) {
  try {
    const routerModels = apiKey ? await fetchRouterModels(apiKey) : [];
    if (routerModels.length > 0) {
      const liveIds = new Set(routerModels.map((m) => m.id));
      const extras = FALLBACK_MODELS
        .filter((id) => !liveIds.has(id))
        .map((id) => buildModel(id));

      return sortModels([...routerModels, ...extras]).slice(0, 100);
    }

    // HF docs point users to the hf-inference catalog for supported models.
    const params = new URLSearchParams({
      inference_provider: "hf-inference",
      pipeline_tag: "text-generation",
      sort: "downloads",
      limit: "100",
      full: "true",
    });

    const headers = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(`${HUB_API}?${params}`, { headers });
    if (!res.ok) throw new Error(`Hub API ${res.status}`);

    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("Empty response");

    const chatModels = raw
      .filter((m) => {
        const modelId = m.modelId || m.id;
        if (!modelId) return false;
        if (isBlockedModelId(modelId)) return false;
        if (isNonChatTaskModel(modelId)) return false;
        if (!isLikelyChatModel(modelId)) return false;
        if (!isLikelySupportedSize(modelId)) return false;
        if (!isBadVariant(modelId)) return false;
        return true;
      })
      .map((m) => buildModel(m.modelId || m.id, m.downloads || 0))
      .filter((m, index, arr) => arr.findIndex((x) => x.id === m.id) === index);

    // Always include our hand-picked reliable models even if not in the API response.
    const liveIds = new Set(chatModels.map((m) => m.id));
    const extras = FALLBACK_MODELS
      .filter((id) => !liveIds.has(id))
      .map((id) => buildModel(id));

    const combined = sortModels([...extras, ...chatModels]).slice(0, 100);
    return combined.length > 0 ? combined : FALLBACK_MODELS.map(buildModel);
  } catch {
    // Hub API unavailable — return curated fallback list
    return FALLBACK_MODELS.map(buildModel);
  }
}

/** Image generation models available on Hugging Face */
export const IMAGE_GEN_MODELS = [
  { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell (Free)", _provider: "huggingface", _isImageGen: true, pricing: { prompt: "0", completion: "0" }, context_length: 0 },
  { id: "black-forest-labs/FLUX.1-dev",     name: "FLUX.1 Dev",            _provider: "huggingface", _isImageGen: true, pricing: { prompt: "0", completion: "0" }, context_length: 0 },
  { id: "stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL Base",    _provider: "huggingface", _isImageGen: true, pricing: { prompt: "0", completion: "0" }, context_length: 0 },
];


/**
 * Shared helper: call HF hf-inference router with binary response.
 * Uses router.huggingface.co (same domain as chat — no CORS/CSP issues).
 */
async function hfInferenceBinary(apiKey, modelId, prompt) {
  const res = await fetch(`https://router.huggingface.co/hf-inference/models/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "x-wait-for-model": "true",
    },
    body: JSON.stringify({ inputs: prompt }),
  });

  if (!res.ok) {
    const txt = await res.text();
    let msg = txt;
    try { msg = JSON.parse(txt).error || txt; } catch {}
    throw new Error(msg);
  }

  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return { dataUrl: `data:${contentType};base64,${btoa(binary)}`, contentType };
}

/** Generate an image via HuggingFace hf-inference router */
export async function generateImage(apiKey, modelId, prompt) {
  const { dataUrl } = await hfInferenceBinary(apiKey, modelId, prompt);
  return { imageUrl: dataUrl };
}


/**
 * Stream a chat completion via HuggingFace Inference API (OpenAI-compatible).
 * Returns { text, usage } to match the other providers.
 */
export async function streamMessage(apiKey, modelId, messages, { onChunk, signal, reasoningDepth } = {}) {
  const body = {
    model: normalizeChatModel(modelId),
    messages,
    stream: true,
    max_tokens: 4096,
  };
  if (supportsReasoningModel({ id: modelId, _provider: "huggingface" })) {
    body.reasoning = { effort: mapReasoningEffort(reasoningDepth || "balanced") };
  }

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    const detail = parseErrorDetail(text);
    if (shouldUseTextGenerationFallback(res.status, detail, modelId)) {
      try {
        return await streamViaCompletions(apiKey, modelId, messages, { onChunk, signal });
      } catch (completionErr) {
        const completionMsg = String(completionErr?.message || "").toLowerCase();
        const canFallbackToTextGen =
          completionMsg.includes("404") ||
          completionMsg.includes("not found") ||
          completionMsg.includes("unsupported") ||
          completionMsg.includes("endpoint");

        if (!canFallbackToTextGen) throw completionErr;
        return streamViaTextGeneration(apiKey, modelId, messages, { onChunk, signal });
      }
    }
    throw new Error(`HuggingFace ${res.status}: ${detail}`);
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
            cost: null,
          };
        }
      } catch {}
    }
  }

  return { text: full || "(No response)", usage };
}
