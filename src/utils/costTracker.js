// ── Cost Tracking Utility ────────────────────────────────────────────────────

const LIFETIME_COST_KEY = "openrouter_lifetime_cost";

/**
 * Calculate message cost from token usage and model pricing.
 * OpenRouter pricing is per-token (price per 1 token).
 * Returns cost in dollars, or 0 if free / missing data.
 */
export function calculateCost(usage, modelPricing) {
  if (!usage || !modelPricing) return 0;

  const promptPrice = Number(modelPricing.prompt) || 0;
  const completionPrice = Number(modelPricing.completion) || 0;
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;

  return (promptTokens * promptPrice) + (completionTokens * completionPrice);
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
 */
export function addLifetimeCost(amount) {
  if (!amount || amount <= 0) return;
  const current = loadLifetimeCost();
  const updated = current + amount;
  localStorage.setItem(LIFETIME_COST_KEY, updated.toString());
  return updated;
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
