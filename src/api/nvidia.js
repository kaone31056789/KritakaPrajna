import { mapReasoningEffort, supportsReasoningModel } from "../utils/reasoningControls";
import { parseChatSSE } from "./sse";
const API_BASE = "https://integrate.api.nvidia.com/v1";
const STATIC_NVIDIA_MODELS = [
  // ── DeepSeek ──────────────────────────────────────────────────────────────
  { id: "deepseek-ai/deepseek-r1-distill-llama-8b",  name: "DeepSeek R1 Distill Llama 8B",  context_length: 32768 },
  { id: "deepseek-ai/deepseek-r1-distill-qwen-7b",   name: "DeepSeek R1 Distill Qwen 7B",   context_length: 32768 },
  { id: "deepseek-ai/deepseek-r1-distill-qwen-14b",  name: "DeepSeek R1 Distill Qwen 14B",  context_length: 32768 },
  { id: "deepseek-ai/deepseek-r1-distill-qwen-32b",  name: "DeepSeek R1 Distill Qwen 32B",  context_length: 32768 },
  { id: "deepseek-ai/deepseek-v3.1",                  name: "DeepSeek V3.1",                  context_length: 65536 },
  { id: "deepseek-ai/deepseek-v3.1-terminus",         name: "DeepSeek V3.1 Terminus",         context_length: 65536 },
  { id: "deepseek-ai/deepseek-v3.2",                  name: "DeepSeek V3.2",                  context_length: 65536 },

  // ── Google Gemma ──────────────────────────────────────────────────────────
  { id: "google/gemma-2-2b-it",      name: "Gemma 2 2B IT",        context_length: 8192  },
  { id: "google/gemma-2-9b-it",      name: "Gemma 2 9B IT",        context_length: 8192  },
  { id: "google/gemma-2-27b-it",     name: "Gemma 2 27B IT",       context_length: 8192  },
  { id: "google/gemma-3-1b-it",      name: "Gemma 3 1B IT",        context_length: 32768 },
  { id: "google/gemma-3-27b-it",     name: "Gemma 3 27B IT",       context_length: 32768 },
  { id: "google/gemma-3n-e2b-it",    name: "Gemma 3n E2B IT",      context_length: 32768 },
  { id: "google/gemma-3n-e4b-it",    name: "Gemma 3n E4B IT",      context_length: 32768 },
  { id: "google/gemma-4-31b-it",     name: "Gemma 4 31B IT",       context_length: 32768 },
  { id: "google/codegemma-7b",       name: "CodeGemma 7B",         context_length: 8192  },
  { id: "google/codegemma-1.1-7b",   name: "CodeGemma 1.1 7B",     context_length: 8192  },

  // ── Meta Llama ────────────────────────────────────────────────────────────
  { id: "meta/llama2-70b",            name: "Llama 2 70B",               context_length: 4096   },
  { id: "meta/llama3-8b",             name: "Llama 3 8B",                context_length: 8192   },
  { id: "meta/llama3-70b",            name: "Llama 3 70B",               context_length: 8192   },
  { id: "meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct",    context_length: 128000 },
  { id: "meta/llama-3.1-70b-instruct",name: "Llama 3.1 70B Instruct",   context_length: 128000 },
  { id: "meta/llama-3.1-405b-instruct",name:"Llama 3.1 405B Instruct",  context_length: 128000 },
  { id: "meta/llama-3.2-1b-instruct", name: "Llama 3.2 1B Instruct",    context_length: 128000 },
  { id: "meta/llama-3.2-3b-instruct", name: "Llama 3.2 3B Instruct",    context_length: 128000 },
  { id: "meta/llama-3.3-70b-instruct",name: "Llama 3.3 70B Instruct",   context_length: 128000 },
  { id: "meta/llama-4-scout-17b-16e-instruct",    name: "Llama 4 Scout 17B 16E",       context_length: 1048576 },
  { id: "meta/llama-4-maverick-17b-128e-instruct",name: "Llama 4 Maverick 17B 128E",   context_length: 1048576 },
  { id: "meta/codellama-70b",         name: "CodeLlama 70B",             context_length: 16384  },

  // ── Microsoft Phi ─────────────────────────────────────────────────────────
  { id: "microsoft/phi-3-mini-4k-instruct",    name: "Phi 3 Mini 4K",           context_length: 4096   },
  { id: "microsoft/phi-3-mini-128k-instruct",  name: "Phi 3 Mini 128K",         context_length: 128000 },
  { id: "microsoft/phi-3-small-8k-instruct",   name: "Phi 3 Small 8K",          context_length: 8192   },
  { id: "microsoft/phi-3-small-128k-instruct", name: "Phi 3 Small 128K",        context_length: 128000 },
  { id: "microsoft/phi-3-medium-4k-instruct",  name: "Phi 3 Medium 4K",         context_length: 4096   },
  { id: "microsoft/phi-3-medium-128k-instruct",name: "Phi 3 Medium 128K",       context_length: 128000 },
  { id: "microsoft/phi-3.5-mini",              name: "Phi 3.5 Mini",            context_length: 128000 },
  { id: "microsoft/phi-4-mini-instruct",       name: "Phi 4 Mini Instruct",     context_length: 16384  },
  { id: "microsoft/phi-4-mini-flash-reasoning",name: "Phi 4 Mini Flash Reasoning", context_length: 16384 },
  { id: "microsoft/phi-4-multimodal-instruct", name: "Phi 4 Multimodal Instruct", context_length: 16384 },

  // ── Mistral ───────────────────────────────────────────────────────────────
  { id: "mistralai/mistral-7b-instruct",             name: "Mistral 7B Instruct",            context_length: 32768  },
  { id: "mistralai/mistral-7b-instruct-v0.3",        name: "Mistral 7B Instruct v0.3",       context_length: 32768  },
  { id: "mistralai/mistral-large",                    name: "Mistral Large",                   context_length: 32768  },
  { id: "mistralai/mistral-2-large-instruct",         name: "Mistral 2 Large Instruct",        context_length: 128000 },
  { id: "mistralai/mistral-large-3-675b-instruct-2512", name: "Mistral Large 3 675B",        context_length: 128000 },
  { id: "mistralai/mistral-medium-3-instruct",        name: "Mistral Medium 3 Instruct",       context_length: 128000 },
  { id: "mistralai/mistral-small-24b-instruct",       name: "Mistral Small 24B",               context_length: 32768  },
  { id: "mistralai/mistral-small-3.1-24b-instruct-2503", name: "Mistral Small 3.1 24B",      context_length: 128000 },
  { id: "mistralai/mistral-small-4-119b-2603",        name: "Mistral Small 4 119B",            context_length: 128000 },
  { id: "mistralai/mistral-nemotron",                  name: "Mistral NeMoTron",                context_length: 128000 },
  { id: "mistralai/mixtral-8x7b-instruct",            name: "Mixtral 8x7B Instruct",           context_length: 32768  },
  { id: "mistralai/mixtral-8x22b-instruct",           name: "Mixtral 8x22B Instruct",          context_length: 65536  },
  { id: "mistralai/codestral-22b-instruct-v0.1",      name: "Codestral 22B",                   context_length: 32768  },
  { id: "mistralai/devstral-2-123b-instruct-2512",    name: "Devstral 2 123B",                 context_length: 128000 },
  { id: "mistralai/magistral-small-2506",              name: "Magistral Small",                 context_length: 128000 },
  { id: "mistralai/mamba-codestral-7b-v0.1",          name: "Mamba Codestral 7B",              context_length: 256000 },
  { id: "mistralai/mathstral-7b-v01",                 name: "Mathstral 7B",                    context_length: 32768  },
  { id: "mistralai/ministral-14b-instruct-2512",      name: "Ministral 14B",                   context_length: 128000 },

  // ── Nvidia ────────────────────────────────────────────────────────────────
  { id: "nvidia/llama3-chatqa-1.5-8b",              name: "ChatQA 1.5 8B",              context_length: 8192   },
  { id: "nvidia/llama-3.1-nemotron-nano-8b-v1",     name: "Nemotron Nano 8B v1",        context_length: 128000 },
  { id: "nvidia/llama-3.1-nemotron-nano-4b-v1_1",   name: "Nemotron Nano 4B v1.1",      context_length: 128000 },
  { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",  name: "Nemotron Ultra 253B v1",     context_length: 128000 },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1",   name: "Nemotron Super 49B v1",      context_length: 128000 },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5", name: "Nemotron Super 49B v1.5",    context_length: 128000 },
  { id: "nvidia/nemotron-mini-4b-instruct",         name: "Nemotron Mini 4B Instruct",  context_length: 4096   },
  { id: "nvidia/nvidia-nemotron-nano-9b-v2",        name: "Nemotron Nano 9B v2",        context_length: 128000 },
  { id: "nvidia/nemotron-nano-12b-v2-vl",           name: "Nemotron Nano 12B v2 VL",    context_length: 128000 },
  { id: "nvidia/nemotron-3-nano-30b-a3b",           name: "Nemotron 3 Nano 30B",        context_length: 128000 },
  { id: "nvidia/nemotron-3-super-120b-a12b",        name: "Nemotron 3 Super 120B",      context_length: 128000 },
  { id: "nvidia/nemotron-4-mini-hindi-4b-instruct", name: "Nemotron 4 Mini Hindi 4B",   context_length: 4096   },
  { id: "nvidia/usdcode",                           name: "USDCode",                    context_length: 32768  },
  { id: "nvidia/riva-translate-4b-instruct-v1_1",   name: "Riva Translate 4B",          context_length: 4096   },

  // ── Qwen ──────────────────────────────────────────────────────────────────
  { id: "qwen/qwen2-7b-instruct",              name: "Qwen2 7B Instruct",          context_length: 32768  },
  { id: "qwen/qwen2.5-7b-instruct",            name: "Qwen2.5 7B Instruct",        context_length: 32768  },
  { id: "qwen/qwen2.5-coder-7b-instruct",      name: "Qwen2.5 Coder 7B",           context_length: 32768  },
  { id: "qwen/qwen2.5-coder-32b-instruct",     name: "Qwen2.5 Coder 32B",          context_length: 32768  },
  { id: "qwen/qwen3-32b",                      name: "Qwen3 32B",                  context_length: 131072 },
  { id: "qwen/qwen3-235b-a22b",                name: "Qwen3 235B A22B",            context_length: 131072 },
  { id: "qwen/qwen3-5-122b-a10b",              name: "Qwen3.5 122B",               context_length: 131072 },
  { id: "qwen/qwen3-coder-480b-a35b-instruct", name: "Qwen3 Coder 480B",           context_length: 131072 },
  { id: "qwen/qwen3-next-80b-a3b-instruct",    name: "Qwen3 Next 80B Instruct",    context_length: 131072 },
  { id: "qwen/qwen3-next-80b-a3b-thinking",    name: "Qwen3 Next 80B Thinking",    context_length: 131072 },
  { id: "qwen/qwq-32b",                        name: "QwQ 32B",                    context_length: 32768  },

  // ── MoonshotAI ────────────────────────────────────────────────────────────
  { id: "moonshotai/kimi-k2-instruct",        name: "Kimi K2 Instruct",        context_length: 131072 },
  { id: "moonshotai/kimi-k2-instruct-0905",   name: "Kimi K2 Instruct 0905",   context_length: 131072 },
  { id: "moonshotai/kimi-k2-thinking",        name: "Kimi K2 Thinking",        context_length: 131072 },

  // ── MiniMax ───────────────────────────────────────────────────────────────
  { id: "minimaxai/minimax-m2.5",  name: "MiniMax M2.5",   context_length: 128000 },

  // ── IBM Granite ───────────────────────────────────────────────────────────
  { id: "ibm/granite-3_3-8b-instruct",    name: "Granite 3.3 8B Instruct",    context_length: 128000 },
  { id: "ibm/granite-guardian-3.0-8b",     name: "Granite Guardian 3.0 8B",    context_length: 8192   },

  // ── StepFun ───────────────────────────────────────────────────────────────
  { id: "stepfun-ai/step-3-5-flash",  name: "Step 3.5 Flash",  context_length: 32768 },

  // ── ByteDance Seed ────────────────────────────────────────────────────────
  { id: "bytedance/seed-oss-36b-instruct",  name: "Seed OSS 36B Instruct",  context_length: 32768 },

  // ── OpenAI GPT-OSS ────────────────────────────────────────────────────────
  { id: "openai/gpt-oss-20b",   name: "GPT OSS 20B",   context_length: 128000 },
  { id: "openai/gpt-oss-120b",  name: "GPT OSS 120B",  context_length: 128000 },

  // ── AbacusAI ──────────────────────────────────────────────────────────────
  { id: "abacusai/dracarys-llama-3.1-70b-instruct",  name: "Dracarys Llama 3.1 70B",  context_length: 128000 },

  // ── AI21 Labs ─────────────────────────────────────────────────────────────
  { id: "ai21labs/jamba-1.5-mini-instruct",  name: "Jamba 1.5 Mini Instruct",  context_length: 256000 },

  // ── iGenius ───────────────────────────────────────────────────────────────
  { id: "igenius/colosseum_355b_instruct_16k",  name: "Colosseum 355B 16K",  context_length: 16384 },
  { id: "igenius/italia_10b_instruct_16k",      name: "Italia 10B 16K",      context_length: 16384 },

  // ── Z-AI / GLM ────────────────────────────────────────────────────────────
  { id: "z-ai/glm-4.6", name: "GLM 4.6",  context_length: 128000 },
  { id: "z-ai/glm4.7",  name: "GLM 4.7",  context_length: 128000 },
  { id: "z-ai/glm5",    name: "GLM 5",    context_length: 128000 },

  // ── THUDM ChatGLM ────────────────────────────────────────────────────────
  { id: "thudm/chatglm3-6b",  name: "ChatGLM3 6B",  context_length: 32768 },

  // ── Falcon (TII UAE) ─────────────────────────────────────────────────────
  { id: "tiiuae/falcon3-7b-instruct",  name: "Falcon 3 7B Instruct",  context_length: 32768 },

  // ── Sarvam AI ─────────────────────────────────────────────────────────────
  { id: "sarvamai/sarvam-m",  name: "Sarvam M",  context_length: 32768 },

  // ── Marin ─────────────────────────────────────────────────────────────────
  { id: "marin/marin-8b-instruct",  name: "Marin 8B Instruct",  context_length: 32768 },

  // ── Upstage Solar ─────────────────────────────────────────────────────────
  { id: "upstage/solar-10.7b-instruct",  name: "Solar 10.7B Instruct",  context_length: 4096 },

  // ── Rakuten ───────────────────────────────────────────────────────────────
  { id: "rakuten/rakutenai-7b-chat",      name: "RakutenAI 7B Chat",      context_length: 4096  },
  { id: "rakuten/rakutenai-7b-instruct",  name: "RakutenAI 7B Instruct",  context_length: 4096  },

  // ── EuroLLM ───────────────────────────────────────────────────────────────
  { id: "utter-project/eurollm-9b-instruct",  name: "EuroLLM 9B Instruct",  context_length: 4096 },

  // ── SEA-LION ──────────────────────────────────────────────────────────────
  { id: "aisingapore/sea-lion-7b-instruct",  name: "SEA-LION 7B Instruct",  context_length: 4096 },

  // ── Baichuan ──────────────────────────────────────────────────────────────
  { id: "baichuan-inc/baichuan2-13b-chat",  name: "Baichuan2 13B Chat",  context_length: 4096 },

  // ── Bielik ────────────────────────────────────────────────────────────────
  { id: "speakleash/bielik-11b-v2_6-instruct",  name: "Bielik 11B v2.6",  context_length: 32768 },

  // ── SEA-LLM ──────────────────────────────────────────────────────────────
  { id: "seallms/seallm-7b-v2.5",  name: "SeaLLM 7B v2.5",  context_length: 4096 },

  // ── Breeze (MediaTek) ─────────────────────────────────────────────────────
  { id: "mediatek/breeze-7b-instruct",  name: "Breeze 7B Instruct",  context_length: 32768 },

  // ── Stockmark ─────────────────────────────────────────────────────────────
  { id: "stockmark/stockmark-2-100b-instruct",  name: "Stockmark 2 100B",  context_length: 32768 },

  // ── Taiwan Llama ──────────────────────────────────────────────────────────
  { id: "yentinglin/llama-3-taiwan-70b-instruct",  name: "Llama 3 Taiwan 70B",  context_length: 8192 },
];

// Default pricing for Nvidia NIM models (free tier / not exposed in API)
const DEFAULT_PRICING = { prompt: "0", completion: "0" };

// Model families the NIM catalogue serves that are not chat completions.
const NON_CHAT_PREFIXES = [
  "nvidia/embed", "nvidia/nv-embed", "nvidia/nv-rerankqa", "nvidia/rerank",
  "nvidia/llama-3.2-nemoretriever", "nvidia/llama-3.2-nv-embedqa", "nvidia/llama-3.2-nv-rerankqa",
  "nvidia/llama-nemotron-embed", "nvidia/llama-nemotron-rerank", "nvidia/nvclip",
  "nvidia/nv-embedcode", "nvidia/nv-embedqa",
  "nvidia/nemoguard", "nvidia/llama-3.1-nemoguard", "nvidia/llama-3_1-nemotron-safety",
  "nvidia/nemotron-content-safety", "nvidia/gliner",
  "nvidia/bevformer", "nvidia/cosmos", "nvidia/nemoretriever-parse", "nvidia/nemotron-parse",
  "meta/llama-guard",
  "hive/", "black-forest-labs/", "snowflake/", "baai/",
  "nvidia/llama-nemotron-rerank-vl",
];

function isNonChatModel(modelId) {
  const id = (modelId || "").toLowerCase();
  return NON_CHAT_PREFIXES.some((prefix) => id.startsWith(prefix.toLowerCase()));
}

const NON_MODEL_IDS = new Set([
  "nvidia",
  "meta",
  "mistralai",
  "google",
  "openai",
  "microsoft",
  "qwen",
  "deepseek-ai",
  "abacusai",
  "moonshotai",
  "minimaxai",
  "ibm",
  "rakuten",
  "sarvamai",
  "marin",
  "upstage",
  "thudm",
  "tiiuae",
  "speakleash",
  "mediatek",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLikelyChatModelId(modelId) {
  const raw = String(modelId || "").trim();
  if (!raw) return false;

  const id = raw.toLowerCase();
  if (NON_MODEL_IDS.has(id)) return false;
  if (UUID_RE.test(id)) return false;
  if (id.includes(" ")) return false;
  if (id.startsWith("http://") || id.startsWith("https://")) return false;

  if (id.includes("/")) return true;

  // NVIDIA also exposes certain legacy no-slash IDs (example: nvidia-nemotron-4-340b-instruct).
  return /^[a-z0-9][a-z0-9._-]{6,}$/i.test(raw) && id.includes("-");
}

/**
 * Build a static fallback model map keyed by id for fast lookup.
 */
const STATIC_MAP = new Map(STATIC_NVIDIA_MODELS.map((m) => [m.id, m]));

const SAFE_FALLBACK_MODEL_IDS = [
  "nvidia/llama3-chatqa-1.5-8b",
  "meta/llama-3.1-8b-instruct",
  "meta/llama-3.1-70b-instruct",
  "mistralai/mistral-7b-instruct-v0.3",
  "qwen/qwen2.5-7b-instruct",
];

function buildSafeFallbackModels() {
  return SAFE_FALLBACK_MODEL_IDS.map((id) => {
    const meta = STATIC_MAP.get(id);
    return {
      id,
      name: meta?.name || prettifyModelId(id),
      context_length: meta?.context_length || 8192,
      pricing: meta?.pricing || DEFAULT_PRICING,
      _provider: "nvidia",
    };
  });
}

/**
 * Fetches the list of models from Nvidia NIM using the /models endpoint.
 * Falls back to the comprehensive static list if the API call fails.
 */
export async function fetchModels(apiKey) {
  try {
    const res = await fetch(`${API_BASE}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) throw new Error(`Nvidia NIM models: ${res.status}`);
    const json = await res.json();

    const live = (json.data || [])
      .filter((m) => !isNonChatModel(m.id) && isLikelyChatModelId(m.id))
      .map((m) => {
        const liveId = String(m.id || "").trim();
        const meta = STATIC_MAP.get(m.id);
        return {
          id: liveId,
          name: meta?.name || prettifyModelId(liveId),
          context_length: m.context_length || meta?.context_length || 8192,
          pricing: meta?.pricing || DEFAULT_PRICING,
          _provider: "nvidia",
        };
      });

    const dedupedLive = [];
    const seen = new Set();
    for (const model of live) {
      if (!model?.id || seen.has(model.id)) continue;
      seen.add(model.id);
      dedupedLive.push(model);
    }

    // When live lookup succeeds, trust account-visible models only.
    if (dedupedLive.length > 0) return dedupedLive;

    return buildSafeFallbackModels();
  } catch {
    // Live fetch failed — expose a small safe fallback set only.
    return buildSafeFallbackModels();
  }
}

/**
 * Convert a model id like "meta/llama-3.1-70b-instruct" to "Llama 3.1 70B Instruct"
 */
function prettifyModelId(id) {
  const name = (id || "").split("/").pop() || id;
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function parseNvidiaError(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return String(
      parsed?.error?.message ||
      parsed?.error ||
      parsed?.detail ||
      parsed?.message ||
      raw ||
      "NVIDIA request failed"
    );
  } catch {
    return String(raw || "NVIDIA request failed");
  }
}

const VALID_MESSAGE_ROLES = new Set(["system", "user", "assistant"]);

function normalizeMessageRole(role) {
  const value = String(role || "user").toLowerCase();
  if (VALID_MESSAGE_ROLES.has(value)) return value;
  if (value === "developer") return "system";
  if (value === "model") return "assistant";
  if (value === "tool") return "assistant";
  return "user";
}

function hasNonEmptyContent(content) {
  if (typeof content === "string") {
    return content.trim().length > 0;
  }

  if (Array.isArray(content)) {
    return content.some((part) => {
      if (!part || typeof part !== "object") return false;
      if (part.type === "text") return String(part.text || "").trim().length > 0;
      if (part.type === "image_url") {
        const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
        return String(url || "").trim().length > 0;
      }
      return false;
    });
  }

  return false;
}

function contentParts(content) {
  if (Array.isArray(content)) return content;
  if (typeof content === "string" && content.trim()) {
    return [{ type: "text", text: content.trim() }];
  }
  return [];
}

function mergeMessageContent(left, right) {
  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);

  if (leftIsArray || rightIsArray) {
    return [...contentParts(left), ...contentParts(right)];
  }

  return [String(left || "").trim(), String(right || "").trim()]
    .filter(Boolean)
    .join("\n");
}

function normalizeMessagePart(part) {
  if (part == null) return null;

  if (typeof part === "string") {
    return part.trim() ? { type: "text", text: part } : null;
  }

  if (typeof part !== "object") return null;

  const type = String(part.type || "").toLowerCase();

  if (type === "text" && typeof part.text === "string") {
    return { type: "text", text: part.text };
  }

  if (type === "image_url" || type === "input_image") {
    const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
    if (typeof url === "string" && url.trim()) {
      return { type: "image_url", image_url: { url: url.trim() } };
    }
  }

  if (typeof part.text === "string") {
    return { type: "text", text: part.text };
  }

  return null;
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    const parts = content
      .map(normalizeMessagePart)
      .filter(Boolean);

    if (parts.length === 0) return "";

    const hasImage = parts.some((part) => part.type === "image_url");
    if (!hasImage) {
      return parts.map((part) => part.text || "").join("\n");
    }

    return parts;
  }

  if (content == null) return "";
  if (typeof content === "object" && typeof content.text === "string") return content.text;

  return String(content);
}

function sanitizeMessagesForNvidia(messages) {
  if (!Array.isArray(messages)) return [{ role: "user", content: "Please continue." }];

  const sanitized = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;

    // Native function-calling messages must pass through untouched: a
    // role:"tool" reply is bound to its tool_call_id, and an assistant turn
    // carrying tool_calls may legitimately have empty content. Coercing or
    // merging these breaks the provider's tool-call protocol.
    if (message.role === "tool" && message.tool_call_id) {
      sanitized.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: normalizeMessageContent(message.content) || "(empty)",
      });
      continue;
    }
    if (
      message.role === "assistant" &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length > 0
    ) {
      sanitized.push({
        role: "assistant",
        content: normalizeMessageContent(message.content) || "",
        tool_calls: message.tool_calls,
      });
      continue;
    }

    const role = normalizeMessageRole(message.role);
    const content = normalizeMessageContent(message.content);
    if (!hasNonEmptyContent(content)) continue;

    const last = sanitized[sanitized.length - 1];
    if (last && last.role === role) {
      last.content = mergeMessageContent(last.content, content);
      continue;
    }

    sanitized.push({
      role,
      content,
    });
  }

  if (!sanitized.some((message) => message.role === "user" && hasNonEmptyContent(message.content))) {
    sanitized.push({ role: "user", content: "Please continue." });
  }

  return sanitized.length > 0 ? sanitized : [{ role: "user", content: "Please continue." }];
}

function preferFallbackModelId(models, failedModelId) {
  const list = Array.isArray(models) ? models : [];
  if (list.length === 0) return null;

  const normalize = (value) => String(value || "").trim().toLowerCase();
  const failed = normalize(failedModelId);

  // First, prefer a case-normalized exact match if available.
  const exact = list.find((model) => normalize(model?.id) === failed);
  if (exact?.id) return exact.id;

  // Next, try known-good model IDs.
  for (const id of SAFE_FALLBACK_MODEL_IDS) {
    const candidate = list.find((model) => normalize(model?.id) === normalize(id));
    if (candidate?.id) return candidate.id;
  }

  // Finally, any available different model.
  const alternate = list.find((model) => normalize(model?.id) !== failed && isLikelyChatModelId(model?.id));
  return alternate?.id || null;
}

export async function streamMessage(
  apiKey,
  modelId,
  messages,
  { onChunk, signal, reasoningDepth, maxTokens, temperature, topP, tools, toolChoice } = {}
) {
  const sanitizedMessages = sanitizeMessagesForNvidia(messages);

  const streamWithModel = async (effectiveModelId) => {
    const requestBody = {
      model: effectiveModelId,
      messages: sanitizedMessages,
      stream: true,
      max_tokens: maxTokens ?? 1024,
      temperature: temperature ?? 0.7,
      top_p: topP ?? 0.9,
    };

    if (Array.isArray(tools) && tools.length) {
      requestBody.tools = tools;
      requestBody.tool_choice = toolChoice || "auto";
    }

    if (supportsReasoningModel({ id: effectiveModelId, _provider: "nvidia" })) {
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
      const detail = parseNvidiaError(body);
      const error = new Error(`Nvidia NIM ${res.status}: ${detail}`);
      error.status = res.status;
      error.detail = detail;
      throw error;
    }

    return { ...(await parseChatSSE(res, onChunk)), model: effectiveModelId };
  };

  try {
    return await streamWithModel(modelId);
  } catch (err) {
    const status = Number(err?.status) || 0;
    const detail = String(err?.detail || err?.message || "");
    const functionNotFound =
      status === 404 &&
      /function/i.test(detail) &&
      /not found for account/i.test(detail);

    if (!functionNotFound) throw err;

    try {
      const liveModels = await fetchModels(apiKey);
      const fallbackModelId = preferFallbackModelId(liveModels, modelId);
      if (!fallbackModelId || String(fallbackModelId) === String(modelId)) {
        throw err;
      }

      console.warn(`[nvidia] model \"${modelId}\" unavailable; retrying with \"${fallbackModelId}\"`);
      return await streamWithModel(fallbackModelId);
    } catch {
      throw err;
    }
  }
}
