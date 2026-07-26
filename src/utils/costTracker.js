// ── Cost Tracking Utility ────────────────────────────────────────────────────

const LIFETIME_COST_KEY = "openrouter_lifetime_cost";

/**
 * Calculate message cost from token usage and model pricing.
 * OpenRouter pricing is per-token (price per 1 token).
 * Returns cost in dollars, or 0 if free / missing data.
 */
/**
 * A per-token price the app can actually do arithmetic with, or null.
 *
 * OpenRouter ships `-1` for models whose cost it cannot state up front —
 * `openrouter/fusion` routes a prompt through a panel of models, so its price
 * is only known after the fact. Multiplied through as a plain number that
 * sentinel reads as *negative* cost: it undercuts every value cap and
 * subtracts from the running spend total. An absent price still means free
 * (NVIDIA and HuggingFace catalogues arrive with no pricing block at all);
 * a present but unusable one means unknown.
 *
 * @returns {number|null} price per token, or null when unstated
 */
export function tokenPrice(pricing, side) {
  const raw = pricing?.[side];
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function calculateCost(usage, modelPricing) {
  if (!usage || !modelPricing) return 0;

  // An unstated price contributes nothing rather than a negative correction.
  const promptPrice = tokenPrice(modelPricing, "prompt") ?? 0;
  const completionPrice = tokenPrice(modelPricing, "completion") ?? 0;
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;

  return (promptTokens * promptPrice) + (completionTokens * completionPrice);
}

function estimateTextTokens(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        return "";
      })
      .join("\n");
  }
  return "";
}

export function estimateUsageFromMessages(messages = [], outputText = "") {
  const promptTokens = messages.reduce((sum, message) => {
    return sum + estimateTextTokens(contentToText(message?.content));
  }, 0);

  const completionTokens = estimateTextTokens(outputText);

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    estimated: true,
    cost: null,
  };
}

/**
 * Check if a model is free (both prompt and completion pricing are 0).
 */
export function isModelFree(modelPricing) {
  if (!modelPricing) return false;
  return Number(modelPricing.prompt) === 0 && Number(modelPricing.completion) === 0;
}

/**
 * Format a dollar amount for display.
 * - Free: "Free"
 * - Tiny amounts: "$0.000012" (up to 6 decimals)
 * - Small: "$0.0023"
 * - Larger: "$1.24"
 */
export function formatCost(cost) {
  if (cost === 0) return "Free";
  if (cost < 0.0001) return "$" + cost.toFixed(6);
  if (cost < 0.01) return "$" + cost.toFixed(4);
  return "$" + cost.toFixed(2);
}

/**
 * Load lifetime cost from localStorage.
 */
export function loadLifetimeCost() {
  try {
    return parseFloat(localStorage.getItem(LIFETIME_COST_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Add to lifetime cost and persist.
 * Returns the new total.
 */
export function addLifetimeCost(amount) {
  if (!amount || amount <= 0) return loadLifetimeCost();
  const current = loadLifetimeCost();
  const updated = current + amount;
  localStorage.setItem(LIFETIME_COST_KEY, updated.toString());
  return updated;
}

/**
 * Reset lifetime cost to 0 (or a specific value).
 */
export function resetLifetimeCost(value = 0) {
  localStorage.setItem(LIFETIME_COST_KEY, value.toString());
  return value;
}

/* ── Monthly spend (for the cost cap) ─────────────────────────────────────── */

const MONTHLY_SPEND_KEY = "openrouter_monthly_spend";

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // "2026-02"
}

/** Month-to-date spend in dollars; resets automatically when the month rolls over. */
export function getMonthlySpend() {
  try {
    const raw = JSON.parse(localStorage.getItem(MONTHLY_SPEND_KEY) || "null");
    return raw && raw.month === currentMonth() ? Number(raw.total) || 0 : 0;
  } catch {
    return 0;
  }
}

export function addMonthlySpend(amount) {
  if (!amount || amount <= 0) return getMonthlySpend();
  const updated = getMonthlySpend() + amount;
  try {
    localStorage.setItem(MONTHLY_SPEND_KEY, JSON.stringify({ month: currentMonth(), total: updated }));
  } catch {}
  return updated;
}

export function resetMonthlySpend() {
  try {
    localStorage.setItem(MONTHLY_SPEND_KEY, JSON.stringify({ month: currentMonth(), total: 0 }));
  } catch {}
  return 0;
}

/**
 * Calculate session cost from all chat messages that have a cost field.
 */
export function calcSessionCost(chats) {
  let total = 0;
  for (const chat of chats) {
    for (const msg of chat.messages) {
      if (msg.cost && msg.cost > 0) {
        total += msg.cost;
      }
    }
  }
  return total;
}
