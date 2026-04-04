// ── Rate Limit & Model Health Tracker ────────────────────────────────────────
//
// Tracks model failures, slow responses, and rate limits.
// Provides fallback suggestions when models are unavailable.

const FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SLOW_THRESHOLD_MS = 30 * 1000; // 30 seconds = "slow"
const MAX_FAILURES_BEFORE_UNAVAILABLE = 3;
const COOLDOWN_MS = 2 * 60 * 1000; // 2 min cooldown after marking unavailable

/** In-memory store for model health */
const modelHealth = new Map();

function modelKey(modelOrId) {
  if (!modelOrId) return "";
  if (typeof modelOrId === "string") return modelOrId;
  return modelOrId._selectionId || modelOrId.id;
}

function getHealth(modelId) {
  if (!modelHealth.has(modelId)) {
    modelHealth.set(modelId, {
      failures: [],      // timestamps of failures
      slowResponses: [], // timestamps of slow responses
      unavailableSince: null,
      lastSuccess: null,
    });
  }
  return modelHealth.get(modelId);
}

function pruneOld(timestamps) {
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  return timestamps.filter((t) => t > cutoff);
}

/**
 * Record a successful response for a model.
 */
export function recordSuccess(modelId, responseTimeMs) {
  const h = getHealth(modelId);
  h.lastSuccess = Date.now();
  h.unavailableSince = null;

  if (responseTimeMs > SLOW_THRESHOLD_MS) {
    h.slowResponses.push(Date.now());
    h.slowResponses = pruneOld(h.slowResponses);
  }
}

/**
 * Record a failure for a model.
 */
export function recordFailure(modelId, errorMessage = "") {
  const h = getHealth(modelId);
  h.failures.push(Date.now());
  h.failures = pruneOld(h.failures);

  const lower = errorMessage.toLowerCase();

  // Instant unavailable on rate limit or server-side errors
  const isRateLimit =
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    errorMessage.includes("429");

  const isBusyOrDown =
    errorMessage.includes("503") ||
    errorMessage.includes("502") ||
    lower.includes("busy") ||
    lower.includes("overloaded") ||
    lower.includes("unavailable") ||
    lower.includes("no endpoints") ||
    lower.includes("capacity") ||
    lower.includes("server error") ||
    lower.includes("timed out") ||
    lower.includes("timeout");

  if (isRateLimit || isBusyOrDown) {
    h.unavailableSince = Date.now();
  }

  // Mark unavailable after repeated failures of any kind
  if (h.failures.length >= MAX_FAILURES_BEFORE_UNAVAILABLE) {
    h.unavailableSince = Date.now();
  }
}

/**
 * Check if a model is currently considered unavailable.
 */
export function isModelUnavailable(modelId) {
  const h = getHealth(modelId);
  if (!h.unavailableSince) return false;

  // Cooldown expired — try again
  if (Date.now() - h.unavailableSince > COOLDOWN_MS) {
    h.unavailableSince = null;
    h.failures = [];
    return false;
  }

  return true;
}

/**
 * Check if a model is responding slowly.
 */
export function isModelSlow(modelId) {
  const h = getHealth(modelId);
  h.slowResponses = pruneOld(h.slowResponses);
  return h.slowResponses.length >= 2;
}

/**
 * Get a health summary for a model.
 * @returns {{ available: boolean, slow: boolean, recentFailures: number, cooldownRemaining: number }}
 */
export function getModelHealth(modelId) {
  const h = getHealth(modelId);
  h.failures = pruneOld(h.failures);
  h.slowResponses = pruneOld(h.slowResponses);

  const unavailable = isModelUnavailable(modelId);
  const cooldownRemaining = unavailable && h.unavailableSince
    ? Math.max(0, COOLDOWN_MS - (Date.now() - h.unavailableSince))
    : 0;

  return {
    available: !unavailable,
    slow: isModelSlow(modelId),
    recentFailures: h.failures.length,
    cooldownRemaining,
  };
}

/**
 * Find the best available fallback model.
 * Filters out unavailable models, sorts by quality.
 *
 * @param {Array} models - All models
 * @param {string} currentModelId - Model to skip
 * @param {string} taskType - "coding"|"general"|"vision"|"document"
 * @param {Function} qualityScorer - function(model) => number
 * @returns {object|null} Best available model or null
 */
export function findFallbackModel(models, currentModelId, taskType, qualityScorer) {
  const currentModel = models.find((m) => modelKey(m) === currentModelId || m.id === currentModelId);
  const currentIsFree =
    currentModel &&
    Number(currentModel.pricing?.prompt) === 0 &&
    Number(currentModel.pricing?.completion) === 0;

  const available = models.filter((m) => {
    if (modelKey(m) === currentModelId || m.id === currentModelId) return false;
    if (m.id.startsWith("openrouter/")) return false;
    if (isModelUnavailable(modelKey(m))) return false;
    // Stay in the same pricing tier: free → free, paid → paid
    const mIsFree = Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
    if (currentIsFree && !mIsFree) return false;
    if (!currentIsFree && mIsFree) return false;
    return true;
  });

  if (available.length === 0) return null;

  // Sort by quality score descending
  available.sort((a, b) => (qualityScorer(b) || 0) - (qualityScorer(a) || 0));
  return available[0];
}

/**
 * Find the cheapest capable model for a task.
 * @param {Array} models - All models
 * @param {string} taskType - "coding"|"general"|"vision"|"document"
 * @param {Function} capabilityFilter - function(model) => boolean
 * @returns {{ model: object, isFree: boolean, costLabel: string }|null}
 */
export function findCheapestModel(models, taskType, capabilityFilter) {
  let capable = capabilityFilter
    ? models.filter(capabilityFilter)
    : [...models];

  // Filter out unavailable and OpenRouter auto/meta models
  capable = capable.filter((m) =>
    !isModelUnavailable(modelKey(m)) && !m.id.startsWith("openrouter/")
  );
  if (capable.length === 0) return null;

  // Sort by total price (prompt + completion pricing)
  capable.sort((a, b) => {
    const costA = (Number(a.pricing?.prompt) || 0) + (Number(a.pricing?.completion) || 0);
    const costB = (Number(b.pricing?.prompt) || 0) + (Number(b.pricing?.completion) || 0);
    return costA - costB;
  });

  const cheapest = capable[0];
  const isFree = Number(cheapest.pricing?.prompt) === 0 && Number(cheapest.pricing?.completion) === 0;

  // Build label
  const slash = cheapest.id.indexOf("/");
  const shortName = slash > 0 ? cheapest.id.slice(slash + 1) : cheapest.id;
  const costLabel = isFree ? `${shortName} (Free)` : shortName;

  return { model: cheapest, isFree, costLabel };
}

/**
 * Reset health data for all models (useful for testing / manual reset).
 */
export function resetAllHealth() {
  modelHealth.clear();
}
