import { createStore } from "./store";
import { getModelHealth } from "../utils/rateLimiter";
import { supportsTask } from "../utils/smartModelSelect";
import { loadLiveRankingSignals } from "../utils/advisorRanking";
import { rankInfoFor, usageScore } from "./rankings";
import { isFreeModel } from "./models";

/* Model Advisor — offline-first heuristic scoring that always works.
   Live HF/OpenRouter signals are an optional boost with a visible status. */

export const advisorStore = createStore({
  signals: null, // { hfRepoSignals, orPopularity, sources, freshness }
  signalsLoading: false,
});

export async function refreshSignals(models) {
  if (advisorStore.get().signalsLoading) return;
  advisorStore.set({ signalsLoading: true });
  try {
    const signals = await loadLiveRankingSignals(models);
    advisorStore.set({ signals, signalsLoading: false });
  } catch {
    advisorStore.set({ signals: null, signalsLoading: false });
  }
}

/* Ability tiers — newer / stronger families rank higher so scores actually
   differentiate instead of collapsing into one flat number. First match wins. */
const ABILITY_TIERS = [
  [/gpt-5|opus|fable|gemini[- ]?3[.\d]*[- ]?pro|grok[- ]?4/i, 62],
  [/sonnet|gpt-4\.5|gemini[- ]?2\.5[- ]?pro|deepseek[- ]?v3\.2|kimi[- ]?k2|glm[- ]?4\.[6-9]|qwen3[- ]?(235b|coder)|llama[- ]?4[- ]?maverick|minimax[- ]?m[12]/i, 54],
  [/gpt-4o|\bo[34]\b|gemini[- ]?[\d.]*[- ]?flash|deepseek[- ]?(v3\.1|r1[- ]?0528)|qwen3|command[- ]?a|mistral[- ]?(large|medium)|llama[- ]?4|gpt[- ]?oss[- ]?120b|grok/i, 47],
  [/deepseek[- ]?(v3|r1)|llama[- ]?3\.[13]|qwen[- ]?2\.5|gemma[- ]?3|glm[- ]?4\.5|gpt[- ]?oss|hermes|nemotron|command/i, 41],
];

/* Small/distilled checkpoints get capped — big context can't rescue a 3B. */
const SMALL_HINTS =
  /distill|[- ](mini|small|nano|lite|tiny)\b|smollm|zephyr|tinyllama|\b[1-9](\.\d)?b\b|\b1[0-4]b\b/i;

function abilityBase(name) {
  for (const [re, pts] of ABILITY_TIERS) if (re.test(name)) return pts;
  return 33;
}

// Deterministic per-model jitter (0–5) so same-family checkpoints don't tie.
function tieBreak(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 6;
}

function capabilityScore(model, task) {
  const name = `${model.id} ${model.name || ""}`;
  let score = abilityBase(name);
  if (SMALL_HINTS.test(name)) score = Math.min(score, 29);
  // Newer revisions of the same family get a nudge.
  if (/0528|0324|terminus|exp\b|latest|preview|2507|1120/i.test(name)) score += 3;

  const ctx = Number(model.context_length || model.top_provider?.context_length || 0);
  if (ctx >= 1_000_000) score += 20;
  else if (ctx >= 200_000) score += 16;
  else if (ctx >= 100_000) score += 12;
  else if (ctx >= 32_000) score += 8;
  else if (ctx >= 8_000) score += 4;

  if (task && task !== "general" && supportsTask(model, task)) score += 15;
  return Math.min(100, score + tieBreak(String(model.id || "")));
}

function priceScore(model) {
  if (isFreeModel(model)) return 100;
  const perM = Number(model.pricing?.prompt || 0) * 1_000_000;
  if (perM <= 0.1) return 92;
  if (perM <= 0.5) return 80;
  if (perM <= 1.5) return 65;
  if (perM <= 5) return 45;
  if (perM <= 15) return 25;
  return 10;
}

function speedScore(model) {
  const health = getModelHealth(model.id);
  const avg = Number(health?.avgResponseMs || 0);
  if (avg > 0) {
    if (avg < 2500) return 90;
    if (avg < 6000) return 70;
    if (avg < 12000) return 45;
    return 25;
  }
  // Proxy: cheaper models are usually smaller and faster
  return Math.min(85, 30 + priceScore(model) * 0.5);
}

function reliabilityScore(model) {
  const health = getModelHealth(model.id);
  const failures = Number(health?.recentFailures || health?.failures || 0);
  if (failures === 0) return 85;
  if (failures <= 2) return 55;
  return 20;
}

function liveBoost(model, signals) {
  if (!signals) return 0;
  const repo = signals.hfRepoSignals?.[String(model.id).toLowerCase()] ||
    signals.hfRepoSignals?.[model.id];
  const pop = signals.orPopularity?.[model.id];
  let boost = 0;
  if (repo?.likes > 1000) boost += 4;
  if (repo?.downloads > 100_000) boost += 3;
  if (pop) boost += 3;
  return Math.min(8, boost);
}

const WEIGHTS = {
  balanced: { cap: 0.4, price: 0.25, speed: 0.15, rel: 0.2 },
  quality: { cap: 0.65, price: 0.05, speed: 0.1, rel: 0.2 },
  budget: { cap: 0.2, price: 0.55, speed: 0.1, rel: 0.15 },
  speed: { cap: 0.2, price: 0.15, speed: 0.5, rel: 0.15 },
};

export const PRIORITY_OPTIONS = [
  { value: "balanced", label: "Balanced", icon: "gauge" },
  { value: "quality", label: "Quality", icon: "spark" },
  { value: "budget", label: "Budget", icon: "dollar" },
  { value: "speed", label: "Speed", icon: "zap" },
];

/**
 * Rank models for a task + priority. Pure and synchronous — always works offline.
 * Returns [{ model, score, parts: {cap, price, speed, rel, usage?}, live, rankInfo }]
 */
export function rankModels(models, { task = "general", priority = "balanced", limit = 12 } = {}) {
  const w = WEIGHTS[priority] || WEIGHTS.balanced;
  const signals = advisorStore.get().signals;

  const pool = models.filter((m) => !m._isImageGen || task === "text-to-image");

  return pool
    .map((model) => {
      const parts = {
        cap: capabilityScore(model, task),
        price: priceScore(model),
        speed: speedScore(model),
        rel: reliabilityScore(model),
      };
      const base =
        parts.cap * w.cap + parts.price * w.price + parts.speed * w.speed + parts.rel * w.rel;
      // Blend in live OpenRouter usage rank when available — real-world
      // popularity is a strong quality + reliability proxy.
      const rankInfo = rankInfoFor(model);
      let blended = base;
      if (rankInfo) {
        parts.usage = usageScore(rankInfo.rank);
        blended = base * 0.72 + parts.usage * 0.28;
      }
      const live = liveBoost(model, signals);
      return { model, parts, live, rankInfo, score: Math.round(Math.min(100, blended + live)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
