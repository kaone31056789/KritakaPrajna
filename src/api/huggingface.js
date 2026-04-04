import { mapReasoningEffort, supportsReasoningModel } from "../utils/reasoningControls";
const API_BASE = "https://router.huggingface.co/v1";
const HUB_API  = "https://huggingface.co/api/models";

// Fallback list — used when Hub API fetch fails.
// Only small/medium models reliably supported on HuggingFace's free Serverless Inference tier.
const FALLBACK_MODELS = [
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

  return {
    id: raw.id || raw.modelId,
    name: idToName(raw.id || raw.modelId),
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
    "deepseek-r1", "thinking", "aya", "1m",
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
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.error || text;
    } catch {}
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
