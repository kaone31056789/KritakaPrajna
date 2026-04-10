/**
 * promptDistiller.js — 🧪 Experimental
 *
 * Uses a cheap/free model to rewrite verbose user prompts into dense,
 * token-efficient equivalents before sending to the expensive model.
 *
 * Feature-flagged: only runs when user opts in via settings.
 */

import { estimateTokensFromText } from "./tokenOptimizer";

const DISTILL_CACHE_KEY = "kp_prompt_distill_cache_v1";
const DISTILL_MIN_TOKENS = 80;   // Don't distill short prompts
const DISTILL_MAX_CACHE = 50;
const DISTILL_TIMEOUT_MS = 6000;

const DISTILL_SYSTEM_PROMPT =
  "Rewrite the following user request in the most concise form possible. " +
  "Preserve ALL requirements, constraints, specifics, code snippets, and technical details. " +
  "Remove filler words, pleasantries, redundant phrasing, and excessive explanation. " +
  "Return ONLY the rewritten request with no additional commentary.";

// ── Cache ───────────────────────────────────────────────────────────────────

function loadDistillCache() {
  try {
    const raw = sessionStorage.getItem(DISTILL_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDistillCache(cache) {
  try {
    const keys = Object.keys(cache);
    if (keys.length > DISTILL_MAX_CACHE) {
      const entries = Object.entries(cache);
      entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
      const trimmed = Object.fromEntries(entries.slice(0, DISTILL_MAX_CACHE));
      sessionStorage.setItem(DISTILL_CACHE_KEY, JSON.stringify(trimmed));
    } else {
      sessionStorage.setItem(DISTILL_CACHE_KEY, JSON.stringify(cache));
    }
  } catch {}
}

function hashText(text) {
  let hash = 2166136261;
  const str = String(text || "").trim().toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

// ── Distillation ────────────────────────────────────────────────────────────

/**
 * Distill a verbose prompt into a concise equivalent.
 *
 * @param {string} text - The user's original prompt
 * @param {Object} options
 * @param {Function} options.routeChat - Function to route a chat completion
 * @param {Object} options.cheapModel - The model object to use for distillation
 * @param {Object} options.providers - Provider keys
 * @returns {Promise<{ original, distilled, tokensSaved, savingsPercent, fromCache } | null>}
 */
export async function distillPrompt(text, { routeChat, cheapModel, providers } = {}) {
  const original = String(text || "").trim();
  if (!original) return null;

  const originalTokens = estimateTokensFromText(original);
  if (originalTokens < DISTILL_MIN_TOKENS) return null;

  // Check cache first
  const cache = loadDistillCache();
  const key = `d_${hashText(original)}`;
  if (cache[key]) {
    const cached = cache[key];
    return {
      original,
      distilled: cached.distilled,
      tokensSaved: originalTokens - estimateTokensFromText(cached.distilled),
      savingsPercent: Math.round(
        ((originalTokens - estimateTokensFromText(cached.distilled)) / originalTokens) * 100
      ),
      fromCache: true,
    };
  }

  // Need a route function and a model
  if (!routeChat || !cheapModel || !providers) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISTILL_TIMEOUT_MS);

    const messages = [
      { role: "system", content: DISTILL_SYSTEM_PROMPT },
      { role: "user", content: original },
    ];

    const result = await routeChat(providers, cheapModel, messages, {
      maxTokens: Math.min(originalTokens, 1024),
      temperature: 0.3,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const distilled = String(result?.text || "").trim();
    if (!distilled || distilled.length >= original.length * 0.95) {
      // Distillation didn't help
      return null;
    }

    const distilledTokens = estimateTokensFromText(distilled);
    const saved = originalTokens - distilledTokens;
    const savingsPercent = Math.round((saved / originalTokens) * 100);

    // Only use if we saved at least 15%
    if (savingsPercent < 15) return null;

    // Cache the result
    cache[key] = { distilled, ts: Date.now() };
    saveDistillCache(cache);

    return {
      original,
      distilled,
      tokensSaved: saved,
      savingsPercent,
      fromCache: false,
    };
  } catch {
    return null;
  }
}

/**
 * Check if prompt distillation is enabled in user settings.
 */
export function isDistillationEnabled() {
  try {
    return localStorage.getItem("kp_experimental_distill") !== "false";
  } catch {
    return true;
  }
}

export function setDistillationEnabled(enabled) {
  try {
    localStorage.setItem("kp_experimental_distill", enabled ? "true" : "false");
  } catch {}
}
