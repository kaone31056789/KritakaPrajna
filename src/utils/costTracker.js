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
