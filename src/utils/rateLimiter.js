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
