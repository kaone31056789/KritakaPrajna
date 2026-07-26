// Deliberately the smartModelSelect variant, not the one in core/models: this
// one reads a missing pricing block as NOT free, so the spend guard below fails
// closed on a catalogue that declines to state its prices.
import { isFreeModel } from "./smartModelSelect";

// ── Cache ───────────────────────────────────────────────────────────────────
const CACHE_KEY = "openrouter_advisor_rankings_v2";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_HF_FETCHES = 36;

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

/** Blended $ per million tokens, for the popularity heuristic below. */
function costPer1M(model) {
  const prompt = Number(model?.pricing?.prompt) || 0;
  const completion = Number(model?.pricing?.completion) || 0;
  return (prompt + completion) * 1_000_000;
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

// ── OpenRouter live rankings (real usage data) ──────────────────────────────
//
// deriveORPopularity() above is only a heuristic proxy — its own comment notes
// the real data is "Not available from public API". It IS: OpenRouter exposes
// the usage leaderboard as JSON via GET /datasets/rankings-daily (top-50 models
// per day by token volume, authenticated with any OpenRouter key).
// refreshOpenRouterRankings() pulls that real data on demand ("update anytime")
// and merges it into the advisor cache, replacing the proxy. A free/cheapest
// model is used ONLY to reconcile permaslugs that don't map by string.
// Source: https://openrouter.ai/docs/api/api-reference/datasets/get-rankings-daily

const OR_API_BASE = "https://openrouter.ai/api/v1";
const RANKINGS_ENDPOINT = `${OR_API_BASE}/datasets/rankings-daily`;
const RANKINGS_MIN_INTERVAL_MS = 60_000; // guard the 30 req/min endpoint limit
let lastRankingsFetchAt = 0;
let rankingsInFlight = false;

function usageTierForRank(rank) {
  return rank <= 5 ? "top" : rank <= 15 ? "high" : rank <= 40 ? "mid" : "low";
}

/**
 * Fetch OpenRouter's real daily usage rankings (top-50 by token volume).
 * Returns [{ permaslug, tokens, rank }] for the latest available date, or
 * null on any failure (caller keeps the heuristic fallback).
 */
export async function fetchOpenRouterRankings(apiKey, { signal } = {}) {
  if (!apiKey) return null;
  try {
    const res = await fetch(RANKINGS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rows = Array.isArray(json) ? json : json?.data || json?.rankings || [];
    if (!Array.isArray(rows) || rows.length === 0) return null;

    // Rows are per (date, model_permaslug). Keep only the most recent date.
    const dateOf = (r) => String(r?.date || r?.day || "");
    const latestDate = rows.reduce((acc, r) => (dateOf(r) > acc ? dateOf(r) : acc), "");
    const dayRows = (latestDate ? rows.filter((r) => dateOf(r) === latestDate) : rows)
      .map((r) => ({
        permaslug: String(r?.model_permaslug || r?.permaslug || r?.model || "").trim(),
        tokens:
          (Number(r?.prompt_tokens) || 0) + (Number(r?.completion_tokens) || 0) ||
          Number(r?.total_tokens) ||
          Number(r?.tokens) ||
          0,
      }))
      .filter((r) => r.permaslug && r.permaslug !== "other");

    dayRows.sort((a, b) => b.tokens - a.tokens);
    return dayRows.map((r, i) => ({ ...r, rank: i + 1 }));
  } catch {
    return null;
  }
}

/**
 * Deterministically map OpenRouter permaslugs to our configured model ids by
 * normalized string. Returns { orMeta, unmatchedRankings, unmatchedModels }.
 */
function mapRankingsToModels(rankings, models) {
  const totalTokens = rankings.reduce((s, r) => s + (r.tokens || 0), 0) || 1;

  const byNorm = new Map();
  const bySegment = new Map();
  const orModels = (models || []).filter((m) => m?._provider === "openrouter" || !m?._provider);
  for (const m of orModels) {
    const norm = normalizeModelText(m.id);
    if (norm && !byNorm.has(norm)) byNorm.set(norm, m);
    const seg = normalizeModelText(String(m.id || "").split("/").pop());
    if (seg && !bySegment.has(seg)) bySegment.set(seg, m);
  }

  const orMeta = {};
  const matchedModelIds = new Set();
  const unmatchedRankings = [];
  for (const r of rankings) {
    const model = byNorm.get(normalizeModelText(r.permaslug)) ||
      bySegment.get(normalizeModelText(r.permaslug.split("/").pop())) ||
      null;
    if (!model || orMeta[model?.id]) {
      if (!model) unmatchedRankings.push(r);
      continue;
    }
    orMeta[model.id] = {
      rank: r.rank,
      usageTier: usageTierForRank(r.rank),
      tokenShare: Math.round((r.tokens / totalTokens) * 1000) / 1000,
      throughput: null,
      source: "openrouter-live",
    };
    matchedModelIds.add(model.id);
  }

  const unmatchedModels = orModels.filter((m) => !matchedModelIds.has(m.id));
  return { orMeta, unmatchedRankings, unmatchedModels };
}

/**
 * OPTIONAL: use a free/cheapest model to reconcile OpenRouter permaslugs that
 * did not map to our model ids by string (fuzzy naming only). Free-model-only —
 * never spends real money — and silent on any failure. Returns a
 * { permaslug: modelId } map of confident matches (possibly empty).
 */
async function reconcileUnmatchedWithModel({ providers, models, unmatchedRankings, unmatchedModels, signal }) {
  try {
    if (unmatchedRankings.length === 0 || unmatchedModels.length === 0) return {};

    const [{ routeStream }, { pickCheapestSummaryModel }] = await Promise.all([
      import("../api/providerRouter"),
      import("./tokenOptimizer"),
    ]);
    const model = pickCheapestSummaryModel(models, providers);
    if (!model || !isFreeModel(model)) return {}; // never spend real money here

    const slugs = unmatchedRankings.slice(0, 25).map((r) => r.permaslug);
    const ids = unmatchedModels.slice(0, 60).map((m) => m.id);
    const prompt =
      "Match each OpenRouter permaslug to the SAME underlying model id from the candidate list. " +
      'Reply with ONLY a JSON object { "permaslug": "candidate_id" }. ' +
      "Only include a pair when you are confident it is the exact same model; omit all others.\n\n" +
      `PERMASLUGS:\n${slugs.join("\n")}\n\nCANDIDATES:\n${ids.join("\n")}`;

    const { text: raw } = await routeStream(
      providers,
      model,
      [{ role: "user", content: prompt }],
      { reasoningDepth: "off", maxTokens: 300, temperature: 0, signal, onChunk: () => {} }
    );

    const s = String(raw || "");
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end <= start) return {};
    let obj;
    try {
      obj = JSON.parse(s.slice(start, end + 1));
    } catch {
      return {};
    }
    if (!obj || typeof obj !== "object") return {};

    const idSet = new Set(ids);
    const slugSet = new Set(slugs);
    const out = {};
    for (const [slug, id] of Object.entries(obj)) {
      if (slugSet.has(slug) && idSet.has(id)) out[slug] = id;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Refresh OpenRouter usage rankings on demand and merge the REAL data into the
 * advisor cache (replacing the heuristic deriveORPopularity proxy). Pass
 * { force: true } to bypass the throttle ("update anytime"). Never throws.
 */
export async function refreshOpenRouterRankings({ models = [], providers = {}, force = false, useModel = true, signal } = {}) {
  const apiKey = providers?.openrouter;
  if (!apiKey) return { ok: false, reason: "no-openrouter-key" };

  const now = Date.now();
  if (!force && (rankingsInFlight || now - lastRankingsFetchAt < RANKINGS_MIN_INTERVAL_MS)) {
    return { ok: false, reason: "throttled", nextAllowedInMs: Math.max(0, RANKINGS_MIN_INTERVAL_MS - (now - lastRankingsFetchAt)) };
  }
  rankingsInFlight = true;
  lastRankingsFetchAt = now;
  try {
    const rankings = await fetchOpenRouterRankings(apiKey, { signal });
    if (!rankings || rankings.length === 0) return { ok: false, reason: "fetch-failed" };

    const { orMeta, unmatchedRankings, unmatchedModels } = mapRankingsToModels(rankings, models);
    const totalTokens = rankings.reduce((s, r) => s + (r.tokens || 0), 0) || 1;

    let reconciledCount = 0;
    if (useModel && unmatchedRankings.length > 0 && unmatchedModels.length > 0) {
      const matches = await reconcileUnmatchedWithModel({ providers, models, unmatchedRankings, unmatchedModels, signal });
      for (const [slug, id] of Object.entries(matches)) {
        const r = unmatchedRankings.find((x) => x.permaslug === slug);
        if (!r || orMeta[id]) continue;
        orMeta[id] = {
          rank: r.rank,
          usageTier: usageTierForRank(r.rank),
          tokenShare: Math.round((r.tokens / totalTokens) * 1000) / 1000,
          throughput: null,
          source: "openrouter-live-model",
        };
        reconciledCount += 1;
      }
    }

    // Merge into cache without disturbing HF repo/leaderboard signals.
    const cache = getStoredCache();
    const stampedAt = Date.now();
    saveStoredCache({
      ...cache,
      updatedAt: stampedAt,
      orMeta,
      orSource: "openrouter-live",
      orUpdatedAt: stampedAt,
    });

    return {
      ok: true,
      source: "openrouter-live",
      total: rankings.length,
      matched: Object.keys(orMeta).length,
      reconciled: reconciledCount,
      unmatched: rankings.length - Object.keys(orMeta).length,
      updatedAt: stampedAt,
    };
  } catch {
    return { ok: false, reason: "error" };
  } finally {
    rankingsInFlight = false;
  }
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

  // Prefer REAL OpenRouter rankings if a live refresh populated them; otherwise
  // fall back to the local heuristic proxy. (See refreshOpenRouterRankings.)
  const hasLiveOr =
    cache.orSource === "openrouter-live" && cache.orMeta && Object.keys(cache.orMeta).length > 0;
  const orMeta = hasLiveOr ? cache.orMeta : deriveORPopularity(models);

  // Save to cache (preserve live-OR flags so the HF refetch never clobbers them)
  const newCache = {
    updatedAt: Date.now(),
    repos: mergedRepos,
    leaderboard: leaderboardData || {},
    orMeta,
    orSource: hasLiveOr ? cache.orSource : cache.orSource || null,
    orUpdatedAt: cache.orUpdatedAt || 0,
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
