import { extractParamBillions, qualityScore, isFreeModel, supportsVision, supportsTask } from "./smartModelSelect";
import { getModelHealth } from "./rateLimiter";
import { supportsReasoningModel } from "./reasoningControls";

// ── Cache ───────────────────────────────────────────────────────────────────
const CACHE_KEY = "openrouter_advisor_rankings_v2";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_HF_FETCHES = 36;

// ── Static fallback priors (used when live data is unavailable) ─────────────
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

const NORMALIZED_NAME_PRIORS = [
  { pattern: "deepseek-r1", score: 92 },
  { pattern: "deepseek-v3", score: 90 },
  { pattern: "claude-4", score: 96 },
  { pattern: "claude-3.5-sonnet", score: 92 },
  { pattern: "gpt-4o", score: 90 },
  { pattern: "gpt-4-turbo", score: 88 },
  { pattern: "o4-mini", score: 88 },
  { pattern: "o3", score: 91 },
  { pattern: "o1", score: 89 },
  { pattern: "qwen-2.5-coder", score: 87 },
  { pattern: "qwen-2.5-72b", score: 84 },
  { pattern: "qwen-2.5", score: 79 },
  { pattern: "qwen-3", score: 84 },
  { pattern: "codestral", score: 86 },
  { pattern: "codellama", score: 74 },
  { pattern: "starcoder", score: 73 },
  { pattern: "llama-4", score: 90 },
  { pattern: "llama-3.3-70b", score: 86 },
  { pattern: "llama-3.1-405b", score: 89 },
  { pattern: "llama-3", score: 68 },
  { pattern: "gemma-4", score: 86 },
  { pattern: "gemma-3", score: 76 },
  { pattern: "mistral-large", score: 84 },
  { pattern: "mixtral", score: 70 },
  { pattern: "phi-4", score: 72 },
];

// ── HuggingFace leaderboard model family → repo mapping ─────────────────────
const HF_LEADERBOARD_REPOS = [
  { family: "qwen3", repo: "Qwen/Qwen3-235B-A22B" },
  { family: "qwen-2.5-72b", repo: "Qwen/Qwen2.5-72B-Instruct" },
  { family: "qwen-2.5-coder", repo: "Qwen/Qwen2.5-Coder-32B-Instruct" },
  { family: "llama-4", repo: "meta-llama/Llama-4-Maverick-17B-128E-Instruct" },
  { family: "llama-3.3-70b", repo: "meta-llama/Llama-3.3-70B-Instruct" },
  { family: "llama-3.1-405b", repo: "meta-llama/Meta-Llama-3.1-405B-Instruct" },
  { family: "deepseek-v3", repo: "deepseek-ai/DeepSeek-V3-0324" },
  { family: "deepseek-r1", repo: "deepseek-ai/DeepSeek-R1" },
  { family: "gemma-3", repo: "google/gemma-3-27b-it" },
  { family: "gemma-4", repo: "google/gemma-4-27b-it" },
  { family: "mistral-large", repo: "mistralai/Mistral-Large-Instruct-2411" },
  { family: "mixtral", repo: "mistralai/Mixtral-8x22B-Instruct-v0.1" },
  { family: "phi-4", repo: "microsoft/phi-4" },
  { family: "phi-3.5", repo: "microsoft/Phi-3.5-mini-instruct" },
  { family: "codestral", repo: "mistralai/Codestral-22B-v0.1" },
  { family: "smollm3", repo: "HuggingFaceTB/SmolLM3-3B" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeModelText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[:_/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/([a-z])(\d)/g, "$1-$2")
    .replace(/(\d)([a-z])/g, "$1-$2")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function modelFingerprint(model) {
  return normalizeModelText(`${model?.id || ""} ${(model?.name || "")}`);
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
      locality: 0,
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

// ── Cache management ────────────────────────────────────────────────────────

function getStoredCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : { updatedAt: 0, repos: {}, leaderboard: {}, orMeta: {} };
  } catch {
    return { updatedAt: 0, repos: {}, leaderboard: {}, orMeta: {} };
  }
}

function saveStoredCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

// ── Quality & scoring signals ───────────────────────────────────────────────

function popularityScore(downloads = 0, likes = 0) {
  const d = Math.log10((Number(downloads) || 0) + 1) / 6;
  const l = Math.log10((Number(likes) || 0) + 1) / 4;
  return clamp(Math.round((d * 0.7 + l * 0.3) * 100));
}

function benchmarkPrior(model) {
  const id = modelFingerprint(model);
  const match = HF_BENCHMARK_PRIORS.find((entry) => id.includes(normalizeModelText(entry.pattern)));
  return match?.score ?? null;
}

function normalizedNamePrior(model) {
  const id = modelFingerprint(model);
  const match = NORMALIZED_NAME_PRIORS.find((entry) => id.includes(normalizeModelText(entry.pattern)));
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

function availabilityScore(model, taskType = "general", context = {}) {
  const ctx = normalizeAdvisorContext(context);
  const health = getModelHealth(model?._selectionId || model?.id || "");
  let score = 84;

  if (model?._provider === "openrouter") score = 87;
  if (model?._provider === "openai") score = 92;
  if (model?._provider === "anthropic") score = 90;
  if (model?._provider === "huggingface") score = 78;
  if (model?._provider === "ollama") {
    score = 84;
    if (taskType === "coding" || taskType === "document") score += 4;
    if (ctx.terminalIntent) score += 4;
    if (ctx.webSearchUsed && ctx.webSearchMode === "deep") score -= 3;
  }

  if (!health.available) score -= 35;
  if (health.slow) score -= 12;
  score -= Math.min(health.recentFailures * 6, 18);

  return clamp(score);
}

// ── Live benchmark scoring (replaces pure-static approach) ──────────────────

/**
 * Convert raw HF leaderboard benchmark values to a 0-100 quality score.
 * Benchmarks like MMLU are 0-100, ARC is 0-100, HellaSwag is 0-100.
 */
function leaderboardToScore(entry) {
  if (!entry) return null;
  const fields = ["mmlu", "arc_challenge", "hellaswag", "truthfulqa", "winogrande", "gsm8k", "avg"];

  // Look for an avg score first
  if (entry.avg != null && entry.avg > 0) {
    return clamp(Math.round(Number(entry.avg)));
  }

  // Compute average from available benchmark fields
  let sum = 0;
  let count = 0;
  fields.forEach((f) => {
    const val = Number(entry[f]);
    if (val > 0) {
      sum += val;
      count++;
    }
  });

  if (count === 0) return null;
  return clamp(Math.round(sum / count));
}

/**
 * Match a model to its leaderboard family and return the live score.
 */
function liveLeaderboardScore(model, leaderboardData = {}) {
  if (!leaderboardData || Object.keys(leaderboardData).length === 0) return null;
  const id = modelFingerprint(model);

  // Try direct repo match
  const repoId = normalizeRepoId(model);
  if (repoId && leaderboardData[repoId]) {
    return leaderboardToScore(leaderboardData[repoId]);
  }

  // Try family match
  for (const [family, entry] of Object.entries(leaderboardData)) {
    const normalizedFamily = normalizeModelText(family);
    if (id.includes(normalizedFamily) || normalizedFamily.includes(id.split("-").slice(0, 2).join("-"))) {
      return leaderboardToScore(entry);
    }
  }

  return null;
}

/**
 * Enhanced quality signal that blends live and static data.
 * Priority: live leaderboard scores > HF repo popularity > static priors.
 */
function qualitySignal(model, rankingSignals = {}) {
  const hfSignals = rankingSignals.hfRepoSignals || rankingSignals || {};
  const leaderboard = rankingSignals.hfLeaderboard || {};
  const orMeta = rankingSignals.orPopularity || {};

  const baseRaw = clamp(qualityScore(model));
  const aliasPrior = normalizedNamePrior(model);
  const base = aliasPrior == null
    ? baseRaw
    : clamp(Math.max(baseRaw, Math.round(baseRaw * 0.6 + aliasPrior * 0.4)));

  const prior = benchmarkPrior(model);
  const repoId = normalizeRepoId(model);
  const repoSignal = hfSignals[repoId] || null;
  const popularity = repoSignal ? popularityScore(repoSignal.downloads, repoSignal.likes) : 0;
  const liveScore = liveLeaderboardScore(model, leaderboard);
  const orRankBoost = orMeta[model?.id]?.rank ? clamp(100 - orMeta[model.id].rank * 3) : 0;

  // If we have a live leaderboard score, weight it heavily
  if (liveScore != null) {
    let weightedSum = liveScore * 0.42 + base * 0.28;
    let totalWeight = 0.70;

    if (popularity > 0) {
      weightedSum += popularity * 0.12;
      totalWeight += 0.12;
    }
    if (prior != null) {
      weightedSum += prior * 0.10;
      totalWeight += 0.10;
    }
    if (orRankBoost > 0) {
      weightedSum += orRankBoost * 0.08;
      totalWeight += 0.08;
    }

    return clamp(Math.round(totalWeight > 0 ? weightedSum / totalWeight : liveScore));
  }

  // No live score — fall back to prior-based approach
  let weightedSum = base * 0.6;
  let totalWeight = 0.6;

  if (prior != null) {
    weightedSum += prior * 0.25;
    totalWeight += 0.25;
  }
  if (repoSignal) {
    weightedSum += popularity * 0.15;
    totalWeight += 0.15;
  }

  return clamp(Math.round(totalWeight > 0 ? weightedSum / totalWeight : base));
}

function localityScore(model, taskType = "general", context = {}) {
  const ctx = normalizeAdvisorContext(context);
  const provider = model?._provider || "openrouter";

  if (provider === "ollama") {
    let score = 88;
    if (taskType === "document") score += 8;
    if (taskType === "coding") score += 6;
    if (ctx.terminalIntent) score += 6;
    if (ctx.webSearchUsed && ctx.webSearchMode === "deep") score -= 4;
    return clamp(score);
  }

  if (provider === "huggingface") return 63;
  if (provider === "openrouter") return 60;
  if (provider === "openai" || provider === "anthropic") return 55;
  return 58;
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
    weights = { quality: 0.42, cost: 0.16, speed: 0.11, availability: 0.16, capability: 0.08, context: 0, reasoning: 0.02, locality: 0.05 };
  } else if (taskType === "vision") {
    weights = { quality: 0.42, cost: 0.14, speed: 0.1, availability: 0.17, capability: 0.11, context: 0.05, reasoning: 0, locality: 0.01 };
  } else if (taskType === "document") {
    weights = { quality: 0.32, cost: 0.18, speed: 0.09, availability: 0.14, capability: 0.04, context: 0.14, reasoning: 0, locality: 0.09 };
  } else {
    weights = { quality: 0.39, cost: 0.25, speed: 0.1, availability: 0.19, capability: 0.02, context: 0, reasoning: 0.02, locality: 0.03 };
  }

  if (webNeed) {
    if (ctx.webSearchMode === "deep") {
      weights.context += 0.12;
      weights.reasoning += 0.08;
      weights.quality += 0.05;
      weights.availability += 0.04;
      weights.locality -= 0.03;
      weights.cost -= 0.07;
      weights.speed -= 0.04;
    } else {
      weights.context += 0.08;
      weights.reasoning += 0.03;
      weights.quality += 0.03;
      weights.availability += 0.03;
      weights.locality -= 0.01;
      weights.cost -= 0.05;
      weights.speed -= 0.02;
    }
  }

  if (ctx.terminalIntent) {
    weights.capability += 0.12;
    weights.availability += 0.05;
    weights.locality += 0.04;
    weights.quality += 0.02;
    weights.cost -= 0.05;
    weights.context += 0.01;
  }

  if (ctx.reasoningDepth === "deep") {
    weights.reasoning += 0.08;
    weights.quality += 0.04;
    weights.locality -= 0.02;
    weights.speed -= 0.04;
    weights.cost -= 0.03;
  } else if (ctx.reasoningDepth === "fast") {
    weights.speed += 0.06;
    weights.cost += 0.05;
    weights.reasoning -= 0.04;
    weights.locality += 0.01;
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

// ── Model profile building ──────────────────────────────────────────────────

/**
 * Extract live benchmark detail for a model (for UI display).
 */
function extractBenchmarkDetail(model, rankingSignals = {}) {
  const leaderboard = rankingSignals.hfLeaderboard || {};
  const orMeta = rankingSignals.orPopularity || {};
  const id = modelFingerprint(model);
  const repoId = normalizeRepoId(model);

  let benchmarks = null;

  // Try direct repo
  if (repoId && leaderboard[repoId]) {
    benchmarks = leaderboard[repoId];
  } else {
    // Try family match
    for (const [family, entry] of Object.entries(leaderboard)) {
      const normalizedFamily = normalizeModelText(family);
      if (id.includes(normalizedFamily)) {
        benchmarks = entry;
        break;
      }
    }
  }

  const orInfo = orMeta[model?.id] || null;

  return {
    benchmarks: benchmarks ? {
      mmlu: benchmarks.mmlu || null,
      arc: benchmarks.arc_challenge || null,
      hellaswag: benchmarks.hellaswag || null,
      truthfulqa: benchmarks.truthfulqa || null,
      winogrande: benchmarks.winogrande || null,
      gsm8k: benchmarks.gsm8k || null,
      avg: benchmarks.avg || null,
    } : null,
    orRank: orInfo?.rank || null,
    orUsageTier: orInfo?.usageTier || null,
  };
}

export function buildUnifiedModelProfile(model, taskType = "general", rankingSignals = {}, advisorContext = {}) {
  const ctx = normalizeAdvisorContext(advisorContext);
  const weights = scoreWeightsForTask(taskType, ctx);
  const quality = qualitySignal(model, rankingSignals);
  const costScoreVal = inverseCostScore(model);
  const speed = speedScore(model);
  const availability = availabilityScore(model, taskType, ctx);
  const capability = taskCapabilityBoost(model, taskType, ctx);
  const context = contextScore(model);
  const reasoning = reasoningCapabilityScore(model);
  const locality = localityScore(model, taskType, ctx);

  const finalScore = clamp(Math.round(
    quality * (weights.quality || 0) +
    costScoreVal * (weights.cost || 0) +
    speed * (weights.speed || 0) +
    availability * (weights.availability || 0) +
    capability * (weights.capability || 0) +
    context * (weights.context || 0) +
    reasoning * (weights.reasoning || 0) +
    locality * (weights.locality || 0)
  ));

  const liveLeaderboard = rankingSignals?.hfLeaderboard || {};
  const hfRepoSignals = rankingSignals?.hfRepoSignals || rankingSignals || {};
  const orPopularity = rankingSignals?.orPopularity || {};
  const repoId = normalizeRepoId(model);

  const hasLiveBenchmark = liveLeaderboardScore(model, liveLeaderboard) != null;
  const hasHfSignal = !!hfRepoSignals[repoId];
  const hasOrSignal = !!orPopularity[model?.id];
  const hasPrior = benchmarkPrior(model) != null;

  // Confidence: how many data sources contributed
  let confidence = "low";
  const srcCount = [hasLiveBenchmark, hasHfSignal, hasOrSignal, hasPrior].filter(Boolean).length;
  if (srcCount >= 3) confidence = "high";
  else if (srcCount >= 2) confidence = "medium";

  const benchmarkDetail = extractBenchmarkDetail(model, rankingSignals);

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
    localityScore: locality,
    availabilityScore: availability,
    costScore: costScoreVal,
    capabilityScore: capability,
    finalScore,
    isFree: isFreeModel(model),
    scoreWeights: weights,
    advisorContext: ctx,
    confidence,
    benchmarkDetail,
    sourceSignals: {
      hasHfSignal,
      hasBenchmarkPrior: hasPrior,
      hasLiveBenchmark,
      hasOrSignal,
      repoId,
    },
  };
}

// ── Filtering & ranking ─────────────────────────────────────────────────────

export function filterRankableModels(models, taskType) {
  if (taskType === "vision") return models.filter(supportsVision);
  return models.filter((model) => !String(model?.id || "").startsWith("openrouter/"));
}

export function rankModelsForTask(models, taskType = "general", rankingSignals = {}, advisorContext = {}) {
  return filterRankableModels(models, taskType)
    .map((model) => ({ model, profile: buildUnifiedModelProfile(model, taskType, rankingSignals, advisorContext) }))
    .sort((a, b) => {
      const scoreDelta = b.profile.finalScore - a.profile.finalScore;
      if (scoreDelta !== 0) return scoreDelta;

      const qualityDelta = b.profile.qualityScore - a.profile.qualityScore;
      if (qualityDelta !== 0) return qualityDelta;

      const availabilityDelta = b.profile.availabilityScore - a.profile.availabilityScore;
      if (availabilityDelta !== 0) return availabilityDelta;

      const costDelta = b.profile.costScore - a.profile.costScore;
      if (costDelta !== 0) return costDelta;

      return String(a.model?.id || "").localeCompare(String(b.model?.id || ""));
    });
}

export function bestValueForTask(models, taskType = "general", rankingSignals = {}, advisorContext = {}) {
  const ranked = filterRankableModels(models, taskType).map((model) => {
    const profile = buildUnifiedModelProfile(model, taskType, rankingSignals, advisorContext);
    const valueScore = Math.round(
      profile.qualityScore * 0.45 +
      profile.costScore * 0.25 +
      profile.availabilityScore * 0.15 +
      profile.capabilityScore * 0.08 +
      profile.localityScore * 0.04 +
      profile.speedScore * 0.03
    );
    return { model, profile, valueScore };
  });

  ranked.sort((a, b) => b.valueScore - a.valueScore);
  return ranked[0] || null;
}

// ── Live data fetchers ──────────────────────────────────────────────────────

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

/**
 * Fetch HuggingFace leaderboard benchmark data for known model families.
 * Uses the HF model API which often includes evaluation results.
 */
async function fetchHFLeaderboardData() {
  const results = {};
  const fetchPromises = HF_LEADERBOARD_REPOS.map(async ({ family, repo }) => {
    try {
      const res = await fetch(`https://huggingface.co/api/models/${encodeURIComponent(repo)}`);
      if (!res.ok) return;
      const json = await res.json();

      // Extract eval results from model card data
      const evalResults = json?.cardData?.eval_results || json?.eval_results || [];
      const benchmarks = {};

      evalResults.forEach((er) => {
        const name = String(er?.dataset?.name || er?.task?.name || "").toLowerCase();
        const metric = Number(er?.metrics?.[0]?.value ?? er?.value);
        if (!metric || metric <= 0) return;

        if (name.includes("mmlu")) benchmarks.mmlu = metric > 1 ? metric : metric * 100;
        else if (name.includes("arc") && name.includes("challenge")) benchmarks.arc_challenge = metric > 1 ? metric : metric * 100;
        else if (name.includes("hellaswag")) benchmarks.hellaswag = metric > 1 ? metric : metric * 100;
        else if (name.includes("truthful")) benchmarks.truthfulqa = metric > 1 ? metric : metric * 100;
        else if (name.includes("winogrande")) benchmarks.winogrande = metric > 1 ? metric : metric * 100;
        else if (name.includes("gsm8k") || name.includes("gsm")) benchmarks.gsm8k = metric > 1 ? metric : metric * 100;
      });

      // Compute average from available benchmarks
      const scores = Object.values(benchmarks).filter((v) => v > 0);
      if (scores.length > 0) {
        benchmarks.avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
      }

      // Even if no eval_results, store popularity data
      benchmarks.downloads = Number(json?.downloads) || 0;
      benchmarks.likes = Number(json?.likes) || 0;
      benchmarks.family = family;

      results[family] = benchmarks;
      results[repo] = benchmarks; // Also store by repo ID for direct lookup
    } catch {
      // Silently skip failures
    }
  });

  await Promise.all(fetchPromises);
  return results;
}

/**
 * Derive OpenRouter popularity/usage ranking from the models list metadata.
 * Models with more providers, lower latency flags, and recent creation dates rank higher.
 */
function deriveORPopularity(models) {
  const orModels = models.filter((m) => m._provider === "openrouter" || !m._provider);
  if (orModels.length === 0) return {};

  // Score by: pricing competitiveness + context length + recency
  const scored = orModels.map((m) => {
    const cost = costPer1M(m);
    const ctx = Number(m?.context_length) || 0;
    const created = m?.created ? new Date(m.created * 1000).getTime() : 0;
    const recencyBonus = created > 0 ? Math.min((Date.now() - created) / (90 * 24 * 60 * 60 * 1000), 1) : 0.5;

    // Lower cost and higher context are better, newer is better
    const costFactor = cost <= 0 ? 1 : Math.max(0, 1 - Math.log10(cost + 1) / 3);
    const ctxFactor = ctx > 0 ? Math.min(Math.log2(ctx) / 20, 1) : 0.3;
    const freshness = 1 - recencyBonus * 0.3;

    return {
      model: m,
      score: costFactor * 0.3 + ctxFactor * 0.3 + freshness * 0.4,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const result = {};
  scored.forEach(({ model }, index) => {
    const rank = index + 1;
    result[model.id] = {
      rank,
      usageTier: rank <= 5 ? "top" : rank <= 15 ? "high" : rank <= 40 ? "mid" : "low",
      throughput: null, // Not available from public API
    };
  });

  return result;
}

// ── Main data loader ────────────────────────────────────────────────────────

/**
 * Load live ranking signals from OpenRouter + HuggingFace.
 * Returns a rich signal object for use throughout the advisor pipeline.
 *
 * @param {Array} models - All available models
 * @returns {Promise<{
 *   hfRepoSignals: Object,
 *   hfLeaderboard: Object,
 *   orPopularity: Object,
 *   sources: { hf: boolean, or: boolean, leaderboard: boolean },
 *   freshness: "live" | "cached" | "fallback"
 * }>}
 */
export async function loadLiveRankingSignals(models) {
  const cache = getStoredCache();
  const freshEnough = Date.now() - Number(cache.updatedAt || 0) < CACHE_TTL_MS;

  // If cache is fresh, return it immediately
  if (freshEnough && cache.repos && Object.keys(cache.repos).length > 0) {
    return {
      hfRepoSignals: cache.repos || {},
      hfLeaderboard: cache.leaderboard || {},
      orPopularity: cache.orMeta || {},
      sources: {
        hf: Object.keys(cache.repos || {}).length > 0,
        or: Object.keys(cache.orMeta || {}).length > 0,
        leaderboard: Object.keys(cache.leaderboard || {}).length > 0,
      },
      freshness: "cached",
    };
  }

  // Fetch live data in parallel
  const repoIds = Array.from(new Set(
    (models || [])
      .map(normalizeRepoId)
      .filter(Boolean)
  )).slice(0, MAX_HF_FETCHES);

  const cachedRepos = cache.repos || {};
  const missing = repoIds.filter((repoId) => !cachedRepos[repoId]);

  const [repoResults, leaderboardData] = await Promise.all([
    // Fetch repo signals for models not in cache
    missing.length > 0
      ? Promise.all(
          missing.map(async (repoId) => {
            try {
              return [repoId, await fetchRepoSignal(repoId)];
            } catch {
              return [repoId, null];
            }
          })
        )
      : [],
    // Fetch leaderboard data
    !freshEnough ? fetchHFLeaderboardData().catch(() => ({})) : Promise.resolve(cache.leaderboard || {}),
  ]);

  // Merge repo signals
  const mergedRepos = { ...cachedRepos };
  if (Array.isArray(repoResults)) {
    repoResults.forEach(([repoId, signal]) => {
      if (signal) mergedRepos[repoId] = signal;
    });
  }

  // Derive OR popularity from model list
  const orMeta = deriveORPopularity(models);

  // Save to cache
  const newCache = {
    updatedAt: Date.now(),
    repos: mergedRepos,
    leaderboard: leaderboardData || {},
    orMeta,
  };
  saveStoredCache(newCache);

  // Build repo subset for returned models
  const repoSubset = {};
  repoIds.forEach((repoId) => {
    if (mergedRepos[repoId]) repoSubset[repoId] = mergedRepos[repoId];
  });

  return {
    hfRepoSignals: repoSubset,
    hfLeaderboard: leaderboardData || {},
    orPopularity: orMeta,
    sources: {
      hf: Object.keys(repoSubset).length > 0,
      or: Object.keys(orMeta).length > 0,
      leaderboard: Object.keys(leaderboardData || {}).length > 0,
    },
    freshness: "live",
  };
}

// ── Backward compat alias ───────────────────────────────────────────────────
export async function loadAdvisorRankingSignals(models) {
  return loadLiveRankingSignals(models);
}
