// TOKEN OPTIMIZATION: Session response cache keyed by chat + model + normalized prompt.

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

  const next = {
    ...(cache || {}),
    [key]: {
      response: value.response,
      usage: value.usage || null,
      modelUsed: value.modelUsed || "",
      createdAt: Date.now(),
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
