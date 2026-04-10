/**
 * tokenPredictor.js
 *
 * Predictive token budgeting using exponential moving averages.
 * Tracks actual token usage per (model, taskType) pair and predicts
 * optimal budgets for future requests.
 */

const STORAGE_KEY = "kp_token_usage_stats_v1";
const ALPHA = 0.15; // EMA decay factor
const MAX_ENTRIES = 100;
const MIN_SAMPLES_FOR_PREDICTION = 3;

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStats(stats) {
  try {
    const keys = Object.keys(stats);
    if (keys.length > MAX_ENTRIES) {
      // Evict least recently updated entries
      const entries = keys.map((k) => [k, stats[k]]);
      entries.sort((a, b) => (b[1].lastUpdated || 0) - (a[1].lastUpdated || 0));
      const kept = {};
      entries.slice(0, MAX_ENTRIES).forEach(([k, v]) => { kept[k] = v; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    }
  } catch {}
}

function makeKey(modelId, taskType) {
  const model = String(modelId || "unknown").split("/").pop().split(":")[0];
  const task = String(taskType || "general");
  return `${model}::${task}`;
}

function ema(oldVal, newVal, alpha = ALPHA) {
  if (oldVal == null || oldVal === 0) return newVal;
  return alpha * newVal + (1 - alpha) * oldVal;
}

/**
 * Record actual token usage after a completed request.
 */
export function recordTokenUsage(modelId, taskType, usage = {}, compressionInfo = {}) {
  const stats = loadStats();
  const key = makeKey(modelId, taskType);
  const existing = stats[key] || {
    avgPromptTokens: 0,
    avgCompletionTokens: 0,
    avgTotalTokens: 0,
    p95PromptTokens: 0,
    p95CompletionTokens: 0,
    avgCompressionLevel: -1,
    avgSavingsPercent: 0,
    sampleCount: 0,
    recentSamples: [],
    lastUpdated: 0,
  };

  const promptTokens = Number(usage.prompt_tokens) || 0;
  const completionTokens = Number(usage.completion_tokens) || 0;
  const totalTokens = promptTokens + completionTokens;

  existing.avgPromptTokens = ema(existing.avgPromptTokens, promptTokens);
  existing.avgCompletionTokens = ema(existing.avgCompletionTokens, completionTokens);
  existing.avgTotalTokens = ema(existing.avgTotalTokens, totalTokens);
  existing.sampleCount += 1;
  existing.lastUpdated = Date.now();

  // Track compression stats
  if (compressionInfo.level != null && compressionInfo.level >= 0) {
    existing.avgCompressionLevel = ema(existing.avgCompressionLevel >= 0 ? existing.avgCompressionLevel : compressionInfo.level, compressionInfo.level);
  }
  if (compressionInfo.savingsPercent != null && compressionInfo.savingsPercent > 0) {
    existing.avgSavingsPercent = ema(existing.avgSavingsPercent, compressionInfo.savingsPercent);
  }

  // Keep recent samples for P95 calculation (last 20)
  existing.recentSamples = [
    ...(existing.recentSamples || []).slice(-19),
    { prompt: promptTokens, completion: completionTokens },
  ];

  // Calculate P95 from recent samples
  if (existing.recentSamples.length >= 5) {
    const sortedPrompt = existing.recentSamples.map((s) => s.prompt).sort((a, b) => a - b);
    const sortedCompletion = existing.recentSamples.map((s) => s.completion).sort((a, b) => a - b);
    const idx = Math.floor(sortedPrompt.length * 0.95);
    existing.p95PromptTokens = sortedPrompt[idx] || 0;
    existing.p95CompletionTokens = sortedCompletion[idx] || 0;
  }

  stats[key] = existing;
  saveStats(stats);
}

/**
 * Predict optimal token budget for a (model, taskType) pair.
 * Returns null if not enough data.
 */
export function predictTokenBudget(modelId, taskType) {
  const stats = loadStats();
  const key = makeKey(modelId, taskType);
  const entry = stats[key];

  if (!entry || entry.sampleCount < MIN_SAMPLES_FOR_PREDICTION) {
    return null;
  }

  // Add 20% headroom to the average for safe prediction
  const headroom = 1.2;

  return {
    prompt: Math.ceil(entry.avgPromptTokens * headroom),
    completion: Math.ceil(entry.avgCompletionTokens * headroom),
    total: Math.ceil(entry.avgTotalTokens * headroom),
    p95Prompt: Math.ceil(entry.p95PromptTokens),
    p95Completion: Math.ceil(entry.p95CompletionTokens),
    confidence: entry.sampleCount >= 10 ? "high" : entry.sampleCount >= 5 ? "medium" : "low",
    sampleCount: entry.sampleCount,
    avgCompressionLevel: entry.avgCompressionLevel >= 0 ? Math.round(entry.avgCompressionLevel * 10) / 10 : null,
    avgSavingsPercent: Math.round(entry.avgSavingsPercent),
  };
}

/**
 * Get token efficiency report for the Model Advisor.
 */
export function getTokenEfficiencyReport(modelId) {
  const stats = loadStats();
  const entries = Object.entries(stats).filter(([key]) => key.startsWith(makeKey(modelId, "").split("::")[0]));

  if (entries.length === 0) return null;

  let totalSamples = 0;
  let weightedAvgTokens = 0;
  let weightedAvgSavings = 0;

  entries.forEach(([, entry]) => {
    totalSamples += entry.sampleCount;
    weightedAvgTokens += entry.avgTotalTokens * entry.sampleCount;
    weightedAvgSavings += entry.avgSavingsPercent * entry.sampleCount;
  });

  if (totalSamples === 0) return null;

  return {
    avgTokensPerRequest: Math.round(weightedAvgTokens / totalSamples),
    avgSavingsPercent: Math.round(weightedAvgSavings / totalSamples),
    totalSamples,
    taskBreakdown: Object.fromEntries(
      entries.map(([key, entry]) => [
        key.split("::")[1] || "general",
        {
          avgTokens: Math.round(entry.avgTotalTokens),
          samples: entry.sampleCount,
          avgCompression: entry.avgCompressionLevel >= 0 ? Math.round(entry.avgCompressionLevel * 10) / 10 : null,
        },
      ])
    ),
  };
}

/**
 * Suggest optimal maxTokens for response generation based on history.
 */
export function suggestMaxResponseTokens(modelId, taskType, fallback = 512) {
  const prediction = predictTokenBudget(modelId, taskType);
  if (!prediction) return fallback;

  // Use p95 completion tokens as the suggested max, with a floor of 256
  return Math.max(256, Math.min(8192, prediction.p95Completion || prediction.completion || fallback));
}
