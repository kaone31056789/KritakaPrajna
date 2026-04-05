import { extractParamBillions, qualityScore, isFreeModel, supportsVision, supportsTask } from "./smartModelSelect";
import { getModelHealth } from "./rateLimiter";
import { supportsReasoningModel } from "./reasoningControls";

const CACHE_KEY = "openrouter_advisor_rankings_v1";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_HF_FETCHES = 36;

const HF_BENCHMARK_PRIORS = [
  { pattern: "gpt-oss", score: 94 },
  { pattern: "kimi-k2", score: 93 },
  { pattern: "glm-4.5", score: 92 },
  { pattern: "qwen3", score: 90 },
  { pattern: "qwen-2.5-72b", score: 88 },
  { pattern: "deepseek-v3", score: 91 },
  { pattern: "deepseek-r1", score: 92 },
  { pattern: "llama-4", score: 90 },
  { pattern: "llama-3.3-70b", score: 88 },
  { pattern: "llama-3.1-405b", score: 89 },
  { pattern: "gemma-4", score: 87 },
  { pattern: "gemma-3", score: 84 },
  { pattern: "mixtral", score: 78 },
  { pattern: "mistral-large", score: 86 },
  { pattern: "mistral", score: 72 },
  { pattern: "phi-4", score: 77 },
  { pattern: "phi-3.5", score: 74 },
  { pattern: "smollm3", score: 67 },
  { pattern: "smollm2", score: 63 },
];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAdvisorContext(context = {}) {
  return {
    webSearchUsed: !!context.webSearchUsed,
    explicitWebIntent: !!context.explicitWebIntent,
    webSearchMode: context.webSearchMode === "deep" ? "deep" : "fast",
    terminalIntent: !!context.terminalIntent,
    reasoningDepth:
      context.reasoningDepth === "fast" || context.reasoningDepth === "deep"
        ? context.reasoningDepth
        : "balanced",
  };
}

function normalizeWeights(weights) {
  const cleaned = {};
  let total = 0;

  Object.entries(weights).forEach(([key, value]) => {
    const n = Math.max(0, Number(value) || 0);
    cleaned[key] = n;
    total += n;
  });

  if (total <= 0) {
    return {
      quality: 0.4,
      cost: 0.3,
      speed: 0.1,
      availability: 0.2,
      capability: 0,
      context: 0,
      reasoning: 0,
    };
  }

  const normalized = {};
  Object.keys(cleaned).forEach((key) => {
    normalized[key] = cleaned[key] / total;
  });
  return normalized;
}

function normalizeRepoId(model) {
  const raw = (model?._hfRepoId || model?.id || "").split(":")[0];
  return raw.includes("/") ? raw : "";
}

function getStoredCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : { updatedAt: 0, repos: {} };
  } catch {
    return { updatedAt: 0, repos: {} };
  }
}

function saveStoredCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function popularityScore(downloads = 0, likes = 0) {
  const d = Math.log10((Number(downloads) || 0) + 1) / 6;
  const l = Math.log10((Number(likes) || 0) + 1) / 4;
  return clamp(Math.round((d * 0.7 + l * 0.3) * 100));
}

function benchmarkPrior(model) {
  const id = `${model?.id || ""} ${model?.name || ""}`.toLowerCase();
  const match = HF_BENCHMARK_PRIORS.find((entry) => id.includes(entry.pattern));
  return match?.score ?? null;
}

function contextScore(model) {
  const contextLength = Number(model?.context_length) || 0;
  if (contextLength <= 0) return 35;
  return clamp(Math.round((Math.log2(Math.min(contextLength, 1_000_000)) / 20) * 100));
}

function speedScore(model) {
  const params = extractParamBillions(model);
  if (params === 0) return 55;
  if (params <= 3) return 95;
  if (params <= 8) return 90;
  if (params <= 14) return 82;
  if (params <= 32) return 70;
  if (params <= 72) return 55;
  if (params <= 180) return 38;
  return 24;
}

function costPer1M(model) {
  const prompt = Number(model?.pricing?.prompt) || 0;
  const completion = Number(model?.pricing?.completion) || 0;
  return (prompt + completion) * 1_000_000;
}

function inverseCostScore(model) {
  const cost = costPer1M(model);
  if (cost <= 0) return 100;
  const normalized = 1 - Math.min(Math.log10(cost + 1) / 3, 1);
  return clamp(Math.round(normalized * 100));
}

function availabilityScore(model) {
  const health = getModelHealth(model?._selectionId || model?.id || "");
  let score = 84;

  if (model?._provider === "openrouter") score = 87;
  if (model?._provider === "openai") score = 92;
  if (model?._provider === "anthropic") score = 90;
  if (model?._provider === "huggingface") score = 78;

  if (!health.available) score -= 35;
  if (health.slow) score -= 12;
  score -= Math.min(health.recentFailures * 6, 18);

  return clamp(score);
}

function qualitySignal(model, hfSignals = {}) {
  const base = clamp(qualityScore(model));
  const prior = benchmarkPrior(model);
  const repoSignal = hfSignals[normalizeRepoId(model)] || null;
  const popularity = repoSignal ? popularityScore(repoSignal.downloads, repoSignal.likes) : 0;

  const parts = [base * 0.6];
  if (prior != null) parts.push(prior * 0.25);
  if (repoSignal) parts.push(popularity * 0.15);

  return clamp(Math.round(parts.reduce((sum, value) => sum + value, 0)));
}

function reasoningCapabilityScore(model) {
  if (supportsReasoningModel(model)) return 100;

  const id = (model?.id || "").toLowerCase();
  if (/(claude|gpt-4|o1\b|o3\b|o4\b|gemini|deepseek-r1|qwen3|glm-4\.5|kimi-k2)/.test(id)) {
    return 88;
  }

  const params = extractParamBillions(model);
  if (params >= 70) return 84;
  if (params >= 30) return 76;
  if (params >= 10) return 68;
  if (params > 0) return 58;
  return 52;
}

function codingCapabilityScore(model) {
  const id = (model?.id || "").toLowerCase();
  if (/(coder|codestral|deepseek|claude|gpt-4|qwen.*coder|starcoder|codellama|phind)/.test(id)) {
    return 100;
  }
  if (/(llama|mistral|qwen|gemma|phi|mixtral)/.test(id)) {
    return 78;
  }
  return 62;
}

function scoreWeightsForTask(taskType, context = {}) {
  const ctx = normalizeAdvisorContext(context);
  const webNeed = ctx.webSearchUsed || ctx.explicitWebIntent;

  let weights;
  if (taskType === "coding") {
    weights = { quality: 0.45, cost: 0.18, speed: 0.12, availability: 0.17, capability: 0.08, context: 0, reasoning: 0 };
  } else if (taskType === "vision") {
    weights = { quality: 0.42, cost: 0.14, speed: 0.1, availability: 0.17, capability: 0.11, context: 0.06, reasoning: 0 };
  } else if (taskType === "document") {
    weights = { quality: 0.36, cost: 0.2, speed: 0.1, availability: 0.15, capability: 0.04, context: 0.15, reasoning: 0 };
  } else {
    weights = { quality: 0.4, cost: 0.28, speed: 0.1, availability: 0.2, capability: 0.02, context: 0, reasoning: 0 };
  }

  if (webNeed) {
    if (ctx.webSearchMode === "deep") {
      weights.context += 0.12;
      weights.reasoning += 0.08;
      weights.quality += 0.05;
      weights.availability += 0.04;
      weights.cost -= 0.07;
      weights.speed -= 0.04;
    } else {
      weights.context += 0.08;
      weights.reasoning += 0.03;
      weights.quality += 0.03;
      weights.availability += 0.03;
      weights.cost -= 0.05;
      weights.speed -= 0.02;
    }
  }

  if (ctx.terminalIntent) {
    weights.capability += 0.12;
    weights.availability += 0.05;
    weights.quality += 0.02;
    weights.cost -= 0.05;
    weights.context += 0.01;
  }

  if (ctx.reasoningDepth === "deep") {
    weights.reasoning += 0.08;
    weights.quality += 0.04;
    weights.speed -= 0.04;
    weights.cost -= 0.03;
  } else if (ctx.reasoningDepth === "fast") {
    weights.speed += 0.06;
    weights.cost += 0.05;
    weights.reasoning -= 0.04;
    weights.context -= 0.01;
  }

  return normalizeWeights(weights);
}

function taskCapabilityBoost(model, taskType, context = {}) {
  const ctx = normalizeAdvisorContext(context);
  const webNeed = ctx.webSearchUsed || ctx.explicitWebIntent;

  if (taskType === "vision") return supportsVision(model) ? 100 : 0;

  if (taskType === "coding" || ctx.terminalIntent) {
    return codingCapabilityScore(model);
  }

  if (webNeed) {
    const contextReady = contextScore(model);
    const reasoningReady = reasoningCapabilityScore(model);
    return clamp(Math.round(contextReady * 0.6 + reasoningReady * 0.4));
  }

  return 88;
}

export function buildUnifiedModelProfile(model, taskType = "general", hfSignals = {}, advisorContext = {}) {
  const ctx = normalizeAdvisorContext(advisorContext);
  const weights = scoreWeightsForTask(taskType, ctx);
  const quality = qualitySignal(model, hfSignals);
  const costScore = inverseCostScore(model);
  const speed = speedScore(model);
  const availability = availabilityScore(model);
  const capability = taskCapabilityBoost(model, taskType, ctx);
  const context = contextScore(model);
  const reasoning = reasoningCapabilityScore(model);

  const finalScore = clamp(Math.round(
    quality * (weights.quality || 0) +
    costScore * (weights.cost || 0) +
    speed * (weights.speed || 0) +
    availability * (weights.availability || 0) +
    capability * (weights.capability || 0) +
    context * (weights.context || 0) +
    reasoning * (weights.reasoning || 0)
  ));

  return {
    modelId: model?._selectionId || model?.id || "",
    rawId: model?.id || "",
    provider: model?._provider || "openrouter",
    supportsTasks: {
      text: true,
      vision: supportsVision(model),
      textGeneration: supportsTask(model, "text-generation"),
      imageToText: supportsTask(model, "image-to-text"),
      textToImage: supportsTask(model, "text-to-image"),
      imageToImage: supportsTask(model, "image-to-image"),
      textToSpeech: supportsTask(model, "text-to-speech"),
      textToVideo: supportsTask(model, "text-to-video"),
      anyToAny: supportsTask(model, "any-to-any"),
    },
    qualityScore: quality,
    cost: costPer1M(model),
    speedScore: speed,
    contextLength: Number(model?.context_length) || 0,
    contextScore: context,
    reasoningScore: reasoning,
    availabilityScore: availability,
    costScore,
    capabilityScore: capability,
    finalScore,
    isFree: isFreeModel(model),
    scoreWeights: weights,
    advisorContext: ctx,
    sourceSignals: {
      hasHfSignal: !!hfSignals[normalizeRepoId(model)],
      hasBenchmarkPrior: benchmarkPrior(model) != null,
      repoId: normalizeRepoId(model),
    },
  };
}

export function filterRankableModels(models, taskType) {
  if (taskType === "vision") return models.filter(supportsVision);
  return models.filter((model) => !String(model?.id || "").startsWith("openrouter/"));
}

export function rankModelsForTask(models, taskType = "general", hfSignals = {}, advisorContext = {}) {
  return filterRankableModels(models, taskType)
    .map((model) => ({ model, profile: buildUnifiedModelProfile(model, taskType, hfSignals, advisorContext) }))
    .sort((a, b) => b.profile.finalScore - a.profile.finalScore);
}

export function bestValueForTask(models, taskType = "general", hfSignals = {}, advisorContext = {}) {
  const ranked = filterRankableModels(models, taskType).map((model) => {
    const profile = buildUnifiedModelProfile(model, taskType, hfSignals, advisorContext);
    const valueScore = Math.round(
      profile.qualityScore * 0.55 +
      profile.costScore * 0.3 +
      profile.availabilityScore * 0.15
    );
    return { model, profile, valueScore };
  });

  ranked.sort((a, b) => b.valueScore - a.valueScore);
  return ranked[0] || null;
}

async function fetchRepoSignal(repoId) {
  const res = await fetch(`https://huggingface.co/api/models/${encodeURIComponent(repoId)}`);
  if (!res.ok) throw new Error(`HF ${res.status}`);
  const json = await res.json();
  return {
    downloads: Number(json?.downloads) || 0,
    likes: Number(json?.likes) || 0,
    pipeline_tag: json?.pipeline_tag || "",
    lastModified: json?.lastModified || "",
  };
}

export async function loadAdvisorRankingSignals(models) {
  const cache = getStoredCache();
  const freshEnough = Date.now() - Number(cache.updatedAt || 0) < CACHE_TTL_MS;

  const repoIds = Array.from(new Set(
    (models || [])
      .map(normalizeRepoId)
      .filter(Boolean)
  )).slice(0, MAX_HF_FETCHES);

  const cachedRepos = cache.repos || {};
  const missing = freshEnough ? [] : repoIds.filter((repoId) => !cachedRepos[repoId]);

  if (missing.length === 0) {
    const subset = {};
    repoIds.forEach((repoId) => {
      if (cachedRepos[repoId]) subset[repoId] = cachedRepos[repoId];
    });
    return subset;
  }

  const fetched = await Promise.all(
    missing.map(async (repoId) => {
      try {
        return [repoId, await fetchRepoSignal(repoId)];
      } catch {
        return [repoId, null];
      }
    })
  );

  const mergedRepos = { ...cachedRepos };
  fetched.forEach(([repoId, signal]) => {
    if (signal) mergedRepos[repoId] = signal;
  });

  saveStoredCache({ updatedAt: Date.now(), repos: mergedRepos });

  const subset = {};
  repoIds.forEach((repoId) => {
    if (mergedRepos[repoId]) subset[repoId] = mergedRepos[repoId];
  });
  return subset;
}
