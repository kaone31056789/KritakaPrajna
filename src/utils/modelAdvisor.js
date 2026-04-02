// ── Model Advisor: scoring, ranking & suggestions ────────────────────────────
//
// Provides per-response advisor data: cost info, cheaper/better alternatives,
// task-aware recommendations, and dual free+paid options.

import { isFreeModel, extractParamBillions, supportsVision, detectTaskType } from "./smartModelSelect";
import { isModelUnavailable } from "./rateLimiter";

// ── Coding model patterns (prioritized for code tasks) ──────────────────────

const CODING_MODELS = [
  "deepseek-coder", "deepseek-chat", "deepseek-r1", "codellama", "code-llama",
  "starcoder", "wizardcoder", "phind", "codestral", "claude-3.5-sonnet",
  "claude-3-opus", "claude-4", "gpt-4o", "gpt-4-turbo", "gemini-2",
  "gemini-1.5-pro", "qwen-2.5-coder", "yi-coder",
];

// ── Speed tiers (heuristic: smaller = faster) ───────────────────────────────

function speedScore(model) {
  const params = extractParamBillions(model);
  if (params === 0) return 50; // unknown
  if (params <= 7) return 90;
  if (params <= 14) return 80;
  if (params <= 34) return 65;
  if (params <= 72) return 50;
  if (params <= 180) return 35;
  return 20; // 400B+
}

// ── Capability scoring ──────────────────────────────────────────────────────

const QUALITY_TIERS = [
  { pattern: "claude-4", score: 96 },
  { pattern: "claude-3-opus", score: 95 },
  { pattern: "claude-3.5-sonnet", score: 92 },
  { pattern: "gpt-4o", score: 90 },
  { pattern: "gpt-4-turbo", score: 88 },
  { pattern: "gemini-2", score: 88 },
  { pattern: "gemini-1.5-pro", score: 86 },
  { pattern: "llama-3.1-405b", score: 85 },
  { pattern: "deepseek-v3", score: 83 },
  { pattern: "deepseek-r1", score: 82 },
  { pattern: "llama-3.3-70b", score: 80 },
  { pattern: "mistral-large", score: 80 },
  { pattern: "qwen-2.5-72b", score: 79 },
  { pattern: "deepseek-chat", score: 78 },
  { pattern: "qwen3", score: 76 },
  { pattern: "llama-3", score: 65 },
  { pattern: "mixtral", score: 62 },
  { pattern: "gemma", score: 60 },
  { pattern: "phi-3", score: 55 },
  { pattern: "phi-4", score: 58 },
  { pattern: "qwen", score: 55 },
  { pattern: "mistral", score: 50 },
  { pattern: "deepseek", score: 70 },
];

function capabilityScore(model) {
  const id = model.id.toLowerCase();
  let base = 30;
  for (const tier of QUALITY_TIERS) {
    if (id.includes(tier.pattern)) { base = tier.score; break; }
  }
  const params = extractParamBillions(model);
  let paramBonus = 0;
  if (params >= 200) paramBonus = 20;
  else if (params >= 65) paramBonus = 15;
  else if (params >= 30) paramBonus = 10;
  else if (params >= 10) paramBonus = 5;
  else if (params >= 1) paramBonus = 2;
  return base + paramBonus;
}

// ── Coding capability boost ─────────────────────────────────────────────────

function codingScore(model) {
  const id = model.id.toLowerCase();
  let bonus = 0;
  if (CODING_MODELS.some((p) => id.includes(p))) bonus = 15;
  return capabilityScore(model) + bonus;
}

// ── Cost per 1M tokens (combined prompt + completion) ───────────────────────

function costPer1MTokens(model) {
  const p = model?.pricing;
  if (!p) return 0;
  const prompt = Number(p.prompt) || 0;
  const completion = Number(p.completion) || 0;
  // OpenRouter pricing is per-token, multiply by 1M
  return (prompt + completion) * 1_000_000;
}

function formatPricePer1M(model) {
  const cost = costPer1MTokens(model);
  if (cost === 0) return "Free";
  if (cost < 0.01) return "$" + cost.toFixed(4);
  if (cost < 1) return "$" + cost.toFixed(2);
  return "$" + cost.toFixed(2);
}

function shortName(id) {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(slash + 1) : id;
}

// ── Model profile builder ───────────────────────────────────────────────────

/**
 * Build a profile object for a model with all scores.
 */
export function buildModelProfile(model) {
  return {
    id: model.id,
    name: shortName(model.id),
    capabilityScore: capabilityScore(model),
    codingScore: codingScore(model),
    speedScore: speedScore(model),
    costPer1M: costPer1MTokens(model),
    costLabel: formatPricePer1M(model),
    isFree: isFreeModel(model),
    supportsVision: supportsVision(model),
    supportsCode: CODING_MODELS.some((p) => model.id.toLowerCase().includes(p)),
    params: extractParamBillions(model),
  };
}

// ── Main advisor logic ──────────────────────────────────────────────────────

/**
 * Generate advisor data for a completed response.
 *
 * @param {object} params
 * @param {Array} params.models - All available models
 * @param {string} params.currentModelId - Model that was used
 * @param {string} params.taskType - "coding"|"general"|"vision"|"document"
 * @param {number} params.cost - Cost of this response
 * @param {object} params.usage - { prompt_tokens, completion_tokens }
 * @param {object} params.pricing - Model pricing object
 * @param {"auto"|"free"|"paid"|"best"} params.preference - User preference
 * @param {number|null} params.monthlyBudget - Monthly spending limit in dollars
 * @returns {object} Advisor card data
 */
export function generateAdvisorData({
  models,
  currentModelId,
  taskType,
  cost,
  usage,
  pricing,
  preference = "auto",
  monthlyBudget = null,
}) {
  if (!models || models.length === 0) return null;

  // Filter out meta/router models and unavailable (rate-limited/down) models
  const realModels = models.filter((m) => !m.id.startsWith("openrouter/") && !isModelUnavailable(m.id));

  const currentModel = realModels.find((m) => m.id === currentModelId);
  if (!currentModel) return null;

  const currentProfile = buildModelProfile(currentModel);
  const isFree = currentProfile.isFree;

  // Scorer selection based on task
  const scorer = taskType === "coding" ? codingScore : capabilityScore;

  // Filter capable models
  let capable;
  if (taskType === "vision") {
    capable = realModels.filter(supportsVision);
  } else {
    capable = [...realModels];
  }

  // ── Find cheaper alternative (similar capability, lower cost) ──
  let cheaperAlternative = null;
  if (!isFree) {
    const currentScore = scorer(currentModel);
    const cheaper = capable
      .filter((m) => {
        if (m.id === currentModelId) return false;
        const mScore = scorer(m);
        // At least 70% of current capability
        return mScore >= currentScore * 0.7;
      })
      .sort((a, b) => costPer1MTokens(a) - costPer1MTokens(b));

    const best = cheaper.find((m) => costPer1MTokens(m) < costPer1MTokens(currentModel));
    if (best) {
      cheaperAlternative = {
        id: best.id,
        name: shortName(best.id),
        isFree: isFreeModel(best),
        costLabel: formatPricePer1M(best),
        capabilityScore: scorer(best),
      };
    }
  }

  // ── Find better model (higher capability) ──
  let betterModel = null;
  const currentScore = scorer(currentModel);
  const betterCandidates = capable
    .filter((m) => m.id !== currentModelId && scorer(m) > currentScore + 5)
    .sort((a, b) => scorer(b) - scorer(a));

  if (betterCandidates.length > 0) {
    const best = betterCandidates[0];
    betterModel = {
      id: best.id,
      name: shortName(best.id),
      isFree: isFreeModel(best),
      costLabel: formatPricePer1M(best),
      capabilityScore: scorer(best),
    };
  }

  // ── Best free option ──
  const freeModels = capable.filter(isFreeModel).sort((a, b) => scorer(b) - scorer(a));
  const bestFree = freeModels[0] ? {
    id: freeModels[0].id,
    name: shortName(freeModels[0].id),
    capabilityScore: scorer(freeModels[0]),
    params: extractParamBillions(freeModels[0]),
  } : null;

  // ── Best paid option ──
  const paidModels = capable.filter((m) => !isFreeModel(m)).sort((a, b) => scorer(b) - scorer(a));
  const bestPaid = paidModels[0] ? {
    id: paidModels[0].id,
    name: shortName(paidModels[0].id),
    costLabel: formatPricePer1M(paidModels[0]),
    capabilityScore: scorer(paidModels[0]),
    params: extractParamBillions(paidModels[0]),
  } : null;

  // ── Cheapest paid option (decent capability for the task) ──
  let cheapestPaid = null;
  {
    const minScore = Math.max(25, currentScore * 0.5); // At least half the current model's capability
    const paidCapable = capable
      .filter((m) => !isFreeModel(m) && m.id !== currentModelId && scorer(m) >= minScore)
      .sort((a, b) => costPer1MTokens(a) - costPer1MTokens(b));
    if (paidCapable.length > 0) {
      const cp = paidCapable[0];
      cheapestPaid = {
        id: cp.id,
        name: shortName(cp.id),
        isFree: false,
        costLabel: formatPricePer1M(cp),
        capabilityScore: scorer(cp),
      };
    }
  }

  // ── Budget pick (best quality paid model within monthly budget) ──
  let budgetPick = null;
  let budgetEstMonthly = null; // estimated monthly cost for current model
  if (monthlyBudget > 0) {
    // Estimate: avg 800 tokens/message (300 prompt + 500 completion), ~500 msgs/month = 400K tokens/month
    const MONTHLY_TOKENS = 400_000;
    const maxCostPer1M = (monthlyBudget / MONTHLY_TOKENS) * 1_000_000; // max they can afford per 1M tokens

    // Current model estimated monthly cost
    const currentCostPer1M = costPer1MTokens(currentModel);
    budgetEstMonthly = (currentCostPer1M / 1_000_000) * MONTHLY_TOKENS;

    const budgetCandidates = capable
      .filter((m) => !isFreeModel(m) && m.id !== currentModelId && costPer1MTokens(m) <= maxCostPer1M && costPer1MTokens(m) > 0)
      .sort((a, b) => scorer(b) - scorer(a)); // best quality first

    if (budgetCandidates.length > 0) {
      const bp = budgetCandidates[0];
      const bpMonthlyCost = (costPer1MTokens(bp) / 1_000_000) * MONTHLY_TOKENS;
      budgetPick = {
        id: bp.id,
        name: shortName(bp.id),
        isFree: false,
        costLabel: formatPricePer1M(bp),
        capabilityScore: scorer(bp),
        estMonthlyCost: bpMonthlyCost,
      };
    }
  }

  // ── Coding-specific suggestion ──
  let codingSuggestion = null;
  if (taskType === "coding") {
    const codingModels = capable
      .filter((m) => CODING_MODELS.some((p) => m.id.toLowerCase().includes(p)))
      .sort((a, b) => codingScore(b) - codingScore(a));

    const bestCodingFree = codingModels.filter(isFreeModel)[0] || null;
    const bestCodingPaid = codingModels.filter((m) => !isFreeModel(m))[0] || null;

    codingSuggestion = {
      bestFree: bestCodingFree ? { id: bestCodingFree.id, name: shortName(bestCodingFree.id) } : null,
      bestPaid: bestCodingPaid ? { id: bestCodingPaid.id, name: shortName(bestCodingPaid.id), costLabel: formatPricePer1M(bestCodingPaid) } : null,
    };
  }

  return {
    // Cost of this response
    cost,
    isFree,
    costLabel: cost === 0 ? "Free" : (cost < 0.0001 ? "$" + cost.toFixed(6) : cost < 0.01 ? "$" + cost.toFixed(4) : "$" + cost.toFixed(2)),
    costPer1M: currentProfile.costLabel,
    // Current model info
    currentModel: currentProfile,
    // Task
    taskType,
    isCodingTask: taskType === "coding",
    // Suggestions (null if none better)
    cheaperAlternative,
    betterModel,
    cheapestPaid,
    bestFree,
    bestPaid,
    codingSuggestion,
    // Budget
    budgetPick,
    monthlyBudget: monthlyBudget > 0 ? monthlyBudget : null,
    budgetEstMonthly,
    // Preference applied
    preference,
  };
}
