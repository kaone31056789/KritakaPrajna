// Live OpenRouter model-usage rankings.
// Feed: https://openrouter.ai/api/frontend/v1/rankings/models (fetched via the
// Electron main process to bypass CORS; falls back to a direct fetch in dev).
// Rows arrive per model-variant per day; we aggregate the latest day, rank by
// total tokens, and expose lookup helpers keyed by base model slug.
import { createStore, readJSON, writeJSON } from "./store";

const RANKINGS_URL = "https://openrouter.ai/api/frontend/v1/rankings/models";
const CACHE_KEY = "kp_or_rankings_v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const REFRESH_MS = 6 * 60 * 60 * 1000;

export const rankingsStore = createStore({
  items: [], // [{ permaslug, base, tokens, requests, rank, trendPct }] sorted by rank
  byBase: {}, // base slug (and permaslug) → item
  updatedAt: 0,
  loading: false,
  error: "",
});

// "gpt-5.2-20251120" → "gpt-5.2" (permaslugs carry a date suffix)
export function baseSlug(slug) {
  return String(slug || "").replace(/-\d{8}$/, "");
}

function indexItems(items) {
  const byBase = {};
  for (const item of items) {
    if (byBase[item.base] == null) byBase[item.base] = item;
    if (byBase[item.permaslug] == null) byBase[item.permaslug] = item;
  }
  return byBase;
}

function applyItems(items, updatedAt) {
  rankingsStore.set({
    items,
    byBase: indexItems(items),
    updatedAt: updatedAt || Date.now(),
    loading: false,
    error: "",
  });
}

// Aggregate raw feed rows → ranked list for the most recent date.
export function aggregateRankings(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const dates = [...new Set(rows.map((r) => r?.date).filter(Boolean))].sort();
  if (!dates.length) return [];
  const last = dates[dates.length - 1];
  const prev = dates.length > 1 ? dates[dates.length - 2] : null;

  const sumBy = (date) => {
    const map = new Map();
    for (const row of rows) {
      if (!row || row.date !== date) continue;
      const slug = row.model_permaslug || row.permaslug || row.model || "";
      if (!slug) continue;
      const cur = map.get(slug) || { tokens: 0, requests: 0 };
      cur.tokens += Number(row.total_completion_tokens || 0) + Number(row.total_prompt_tokens || 0);
      cur.requests += Number(row.count || row.total_requests || 0);
      map.set(slug, cur);
    }
    return map;
  };

  const latest = sumBy(last);
  const previous = prev ? sumBy(prev) : new Map();

  const items = [...latest.entries()]
    .map(([permaslug, agg]) => {
      const before = previous.get(permaslug);
      const trendPct =
        before && before.tokens > 0
          ? Math.round(((agg.tokens - before.tokens) / before.tokens) * 100)
          : null;
      return {
        permaslug,
        base: baseSlug(permaslug),
        tokens: agg.tokens,
        requests: agg.requests,
        trendPct,
      };
    })
    .filter((it) => it.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .map((it, i) => ({ ...it, rank: i + 1 }));

  return items;
}

async function fetchFeed() {
  // Preferred: main-process fetch (no CORS restrictions).
  if (window.electronAPI?.fetchModelRankings) {
    const res = await window.electronAPI.fetchModelRankings();
    if (res?.ok && Array.isArray(res.data)) return res.data;
    if (res && !res.ok) throw new Error(res.error || "Rankings fetch failed.");
  }
  // Dev/browser fallback — works when CORS allows it.
  const res = await fetch(RANKINGS_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

export async function refreshRankings(force = false) {
  const state = rankingsStore.get();
  if (state.loading) return;

  const cached = readJSON(CACHE_KEY, null);
  const cacheFresh =
    cached?.updatedAt &&
    Array.isArray(cached.items) &&
    cached.items.length &&
    Date.now() - cached.updatedAt < CACHE_TTL_MS;

  if (!force && cacheFresh) {
    if (!state.items.length) applyItems(cached.items, cached.updatedAt);
    return;
  }

  rankingsStore.set({ loading: true, error: "" });
  try {
    const rows = await fetchFeed();
    const items = aggregateRankings(rows);
    if (!items.length) throw new Error("Empty rankings feed.");
    writeJSON(CACHE_KEY, { updatedAt: Date.now(), items });
    applyItems(items, Date.now());
  } catch (err) {
    // Keep serving stale cache rather than nothing.
    if (cached?.items?.length && !rankingsStore.get().items.length) {
      applyItems(cached.items, cached.updatedAt);
    }
    rankingsStore.set({ loading: false, error: err?.message || "Rankings unavailable." });
  }
}

let refreshTimer = null;
export function initRankings() {
  if (refreshTimer) return;
  refreshRankings(false);
  refreshTimer = setInterval(() => refreshRankings(true), REFRESH_MS);
}

// Look up the live ranking entry for a catalog model.
export function rankInfoFor(model) {
  if (!model) return null;
  const byBase = rankingsStore.get().byBase;
  if (!byBase) return null;
  const canonical = baseSlug(model.canonical_slug || "");
  const idBase = String(model.id || "").split(":")[0];
  return (canonical && byBase[canonical]) || byBase[idBase] || null;
}

// Popularity score from rank position: #1→100, #10→80, #100→60 (log scale).
export function usageScore(rank) {
  const r = Math.max(1, Number(rank) || 1);
  return Math.max(30, Math.round(100 - 20 * Math.log10(r)));
}

// Top-ranked entries matched against the local model catalog.
export function topRankedModels(models, n = 6) {
  const { items } = rankingsStore.get();
  if (!items.length || !models?.length) return [];
  const out = [];
  for (const item of items) {
    if (out.length >= n) break;
    const matches = models.filter((m) => {
      const idBase = String(m.id || "").split(":")[0];
      return baseSlug(m.canonical_slug || "") === item.base || idBase === item.base;
    });
    if (!matches.length) continue;
    const pick = matches.find((m) => !String(m.id).includes(":free")) || matches[0];
    out.push({ model: pick, info: item });
  }
  return out;
}

export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e12) return (v / 1e12).toFixed(1) + "T";
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return Math.round(v / 1e3) + "K";
  return String(v);
}

export function timeAgo(ts) {
  if (!ts) return "";
  const sec = (Date.now() - ts) / 1000;
  if (sec < 90) return "just now";
  const min = sec / 60;
  if (min < 60) return `${Math.round(min)}m ago`;
  const hr = min / 60;
  if (hr < 48) return `${Math.round(hr)}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
