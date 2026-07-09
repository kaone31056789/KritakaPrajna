import { createStore } from "./store";
import { getModelHealth } from "../utils/rateLimiter";
import { supportsTask } from "../utils/smartModelSelect";
import { loadLiveRankingSignals } from "../utils/advisorRanking";
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

const KNOWN_STRONG = [
  /claude|fable|opus|sonnet/i,
  /gpt-5|gpt-4|o[34]\b/i,
  /gemini.*(pro|ultra|2)/i,
  /deepseek.*(v3|r1)/i,
  /llama.*(70b|405b|4)/i,
  /qwen.*(72b|max|2\.5)/i,
  /mistral.*(large|medium)/i,
  /grok/i,
];

function capabilityScore(model, task) {
  let score = 30;
  const name = `${model.id} ${model.name || ""}`;
  if (KNOWN_STRONG.some((re) => re.test(name))) score += 35;

  const ctx = Number(model.context_length || model.top_provider?.context_length || 0);
  if (ctx >= 1_000_000) score += 20;
  else if (ctx >= 200_000) score += 16;
  else if (ctx >= 100_000) score += 12;
  else if (ctx >= 32_000) score += 8;
  else if (ctx >= 8_000) score += 4;

  if (task && task !== "general" && supportsTask(model, task)) score += 15;
  return Math.min(100, score);
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
 * Returns [{ model, score, parts: {cap, price, speed, rel}, live }]
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
      const live = liveBoost(model, signals);
      return { model, parts, live, score: Math.round(Math.min(100, base + live)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
