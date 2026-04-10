// TOKEN OPTIMIZATION: Session response cache with semantic similarity matching.
// Keyed by chat + model + normalized prompt, with SimHash for approximate matching.

const RESPONSE_CACHE_KEY = "kp_response_cache_v1";
const DEFAULT_MAX_ENTRIES = 100;

function safeLowerText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hashString(value) {
  let hash = 2166136261;
  const str = String(value || "");
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

// ── SimHash for semantic similarity ─────────────────────────────────────────

const SIM_STOP_WORDS = new Set([
  "a","an","the","is","it","in","on","at","to","for","of","and","or","but",
  "not","this","that","with","from","by","as","be","was","were","are","i",
  "you","we","they","me","my","your","can","do","does","please","would",
  "could","should","will","just","also","very","too","more","what","how",
]);

function tokenizeForSim(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !SIM_STOP_WORDS.has(w));
}

function nGrams(tokens, n = 2) {
  const grams = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.push(tokens.slice(i, i + n).join(" "));
  }
  // Also include unigrams for short texts
  if (tokens.length < 5) {
    tokens.forEach((t) => grams.push(t));
  }
  return grams;
}

function fnv1a(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

/**
 * Compute a 32-bit SimHash fingerprint for text.
 * Uses bigram + trigram features hashed with FNV-1a.
 */
export function simHash(text) {
  const tokens = tokenizeForSim(text);
  if (tokens.length === 0) return 0;

  const features = [
    ...nGrams(tokens, 2),
    ...nGrams(tokens, 3),
  ];

  if (features.length === 0) return 0;

  // Accumulate weighted bit counts
  const bits = new Int32Array(32);

  for (const feature of features) {
    const hash = fnv1a(feature);
    for (let i = 0; i < 32; i++) {
      if ((hash >> i) & 1) {
        bits[i] += 1;
      } else {
        bits[i] -= 1;
      }
    }
  }

  // Build fingerprint
  let fingerprint = 0;
  for (let i = 0; i < 32; i++) {
    if (bits[i] > 0) {
      fingerprint |= (1 << i);
    }
  }

  return fingerprint >>> 0;
}

/**
 * Compute Hamming distance between two SimHash fingerprints.
 * Lower = more similar. 0 = identical.
 */
export function hammingDistance(a, b) {
  let xor = (a ^ b) >>> 0;
  let count = 0;
  while (xor) {
    count += xor & 1;
    xor >>>= 1;
  }
  return count;
}

// ── Cache management ────────────────────────────────────────────────────────

function loadRawCache() {
  try {
    const raw = sessionStorage.getItem(RESPONSE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistRawCache(cache) {
  try {
    sessionStorage.setItem(RESPONSE_CACHE_KEY, JSON.stringify(cache || {}));
  } catch {
    // Ignore storage failures (quota/private mode)
  }
}

export function loadSessionResponseCache() {
  return loadRawCache();
}

export function makeResponseCacheKey({ chatId, provider, modelId, userText }) {
  const normalized = `${chatId || "global"}:${provider || "unknown"}:${modelId || ""}:${safeLowerText(userText)}`;
  return `resp_${hashString(normalized)}`;
}

export function getCachedResponseEntry(cache, key) {
  if (!cache || !key) return null;
  const entry = cache[key];
  if (!entry) return null;

  if (typeof entry.response !== "string" || !entry.response.trim()) {
    return null;
  }

  return entry;
}

export function setCachedResponseEntry(cache, key, value, maxEntries = DEFAULT_MAX_ENTRIES) {
  if (!key || !value || typeof value.response !== "string") {
    return cache || {};
  }

  const userText = value.userText || "";
  const fingerprint = userText ? simHash(userText) : 0;

  const next = {
    ...(cache || {}),
    [key]: {
      response: value.response,
      usage: value.usage || null,
      modelUsed: value.modelUsed || "",
      createdAt: Date.now(),
      fingerprint,
      userText: safeLowerText(userText).slice(0, 200), // Store for semantic match validation
    },
  };

  const keys = Object.keys(next);
  if (keys.length > maxEntries) {
    keys
      .sort((a, b) => (next[a]?.createdAt || 0) - (next[b]?.createdAt || 0))
      .slice(0, keys.length - maxEntries)
      .forEach((oldKey) => {
        delete next[oldKey];
      });
  }

  persistRawCache(next);
  return next;
}

// ── Semantic cache lookup (🧪 Experimental) ─────────────────────────────────

/**
 * Find a semantically similar cached response.
 * Uses SimHash with configurable Hamming distance threshold.
 *
 * @param {Object} cache - The response cache
 * @param {string} queryText - The new user query
 * @param {Object} options
 * @param {number} options.maxDistance - Max Hamming distance for a match (default 3)
 * @param {string} options.modelId - Only match same model
 * @returns {{ entry, key, distance, isSemanticMatch } | null}
 */
export function findSemanticMatch(cache, queryText, options = {}) {
  const { maxDistance = 3, modelId = null } = options;

  if (!cache || !queryText) return null;

  const queryFingerprint = simHash(queryText);
  if (queryFingerprint === 0) return null;

  let bestMatch = null;
  let bestDistance = Infinity;

  for (const [key, entry] of Object.entries(cache)) {
    if (!entry?.fingerprint || !entry?.response) continue;

    // If model filter is set, only match same model
    if (modelId && entry.modelUsed && entry.modelUsed !== modelId) continue;

    const distance = hammingDistance(queryFingerprint, entry.fingerprint);

    if (distance <= maxDistance && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = { entry, key, distance, isSemanticMatch: distance > 0 };
    }
  }

  return bestMatch;
}

/**
 * Check if semantic caching is enabled.
 */
export function isSemanticCacheEnabled() {
  try {
    return localStorage.getItem("kp_experimental_semantic_cache") === "true";
  } catch {
    return false;
  }
}

export function setSemanticCacheEnabled(enabled) {
  try {
    localStorage.setItem("kp_experimental_semantic_cache", enabled ? "true" : "false");
  } catch {}
}
