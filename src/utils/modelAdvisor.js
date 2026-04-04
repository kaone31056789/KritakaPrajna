import { isFreeModel, extractParamBillions, supportsVision } from "./smartModelSelect";
import { isModelUnavailable } from "./rateLimiter";
import { buildUnifiedModelProfile, rankModelsForTask, bestValueForTask } from "./advisorRanking";

const CODING_MODELS = [
  "deepseek-coder", "deepseek-chat", "deepseek-r1", "codellama", "code-llama",
  "starcoder", "wizardcoder", "phind", "codestral", "claude-3.5-sonnet",
  "claude-3-opus", "claude-4", "gpt-4o", "gpt-4-turbo", "gemini-2",
  "gemini-1.5-pro", "qwen-2.5-coder", "yi-coder",
];

function costPer1MTokens(model) {
  const p = model?.pricing;
  if (!p) return 0;
  const prompt = Number(p.prompt) || 0;
  const completion = Number(p.completion) || 0;
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

function providerLabel(provider) {
  switch (provider) {
    case "openrouter": return "OpenRouter";
    case "huggingface": return "Hugging Face";
    case "openai": return "OpenAI";
    case "anthropic": return "Anthropic";
    default: return provider || "Unknown";
  }
}

function selectionId(model) {
  return model?._selectionId || model?.id || "";
}

export function buildModelProfile(model, taskType = "general", rankingSignals = {}) {
  const unified = buildUnifiedModelProfile(model, taskType, rankingSignals);
  return {
    id: selectionId(model),
    rawId: model.id,
    name: shortName(model.id),
    capabilityScore: unified.qualityScore,
    codingScore: buildUnifiedModelProfile(model, "coding", rankingSignals).finalScore,
    speedScore: unified.speedScore,
    costPer1M: costPer1MTokens(model),
    costLabel: formatPricePer1M(model),
    isFree: unified.isFree,
    supportsVision: supportsVision(model),
    supportsCode: CODING_MODELS.some((p) => model.id.toLowerCase().includes(p)),
    params: extractParamBillions(model),
    provider: unified.provider,
    qualityScore: unified.qualityScore,
    availabilityScore: unified.availabilityScore,
    contextLength: unified.contextLength,
    finalScore: unified.finalScore,
  };
}

export function generateAdvisorData({
  models,
  currentModelId,
  taskType,
  cost,
  usage,
  pricing,
  preference = "auto",
  monthlyBudget = null,
  rankingSignals = {},
}) {
  if (!models || models.length === 0) return null;

  const realModels = models.filter((m) => !m.id.startsWith("openrouter/") && !isModelUnavailable(selectionId(m)));
  const currentModel = realModels.find((m) => selectionId(m) === currentModelId || m.id === currentModelId);
  if (!currentModel) return null;

  const capable = taskType === "vision" ? realModels.filter(supportsVision) : [...realModels];
  const ranked = rankModelsForTask(capable, taskType, rankingSignals);
  const currentProfile = buildModelProfile(currentModel, taskType, rankingSignals);
  const currentScore = currentProfile.finalScore;

  const bestOverall = ranked[0] || null;
  const bestFreeRanked = ranked.find(({ profile }) => profile.isFree) || null;
  const bestPaidRanked = ranked.find(({ profile }) => !profile.isFree) || null;
  const bestValueRanked = bestValueForTask(capable, taskType, rankingSignals);
  const providerPicks = [];
  const providerSeen = new Set();
  ranked.forEach(({ model, profile }) => {
    if (providerSeen.has(profile.provider)) return;
    providerSeen.add(profile.provider);
    providerPicks.push({
      id: selectionId(model),
      name: shortName(model.id),
      provider: providerLabel(profile.provider),
      isFree: profile.isFree,
      costLabel: formatPricePer1M(model),
    });
  });

  let cheaperAlternative = null;
  if (!currentProfile.isFree) {
    const cheaper = capable
      .map((model) => ({ model, profile: buildUnifiedModelProfile(model, taskType, rankingSignals) }))
      .filter(({ model, profile }) =>
        selectionId(model) !== currentModelId &&
        model.id !== currentModelId &&
        profile.finalScore >= currentScore * 0.82 &&
        costPer1MTokens(model) < costPer1MTokens(currentModel)
      )
      .sort((a, b) => costPer1MTokens(a.model) - costPer1MTokens(b.model));

    if (cheaper[0]) {
      cheaperAlternative = {
        id: selectionId(cheaper[0].model),
        name: shortName(cheaper[0].model.id),
        provider: providerLabel(cheaper[0].profile.provider),
        isFree: cheaper[0].profile.isFree,
        costLabel: formatPricePer1M(cheaper[0].model),
        capabilityScore: cheaper[0].profile.finalScore,
      };
    }
  }

  const betterRanked = ranked.find(({ model, profile }) =>
    selectionId(model) !== currentModelId &&
    model.id !== currentModelId &&
    profile.finalScore > currentScore + 5
  );

  const betterModel = betterRanked ? {
    id: selectionId(betterRanked.model),
    name: shortName(betterRanked.model.id),
    provider: providerLabel(betterRanked.profile.provider),
    isFree: betterRanked.profile.isFree,
    costLabel: formatPricePer1M(betterRanked.model),
    capabilityScore: betterRanked.profile.finalScore,
  } : null;

  const bestFree = bestFreeRanked ? {
    id: selectionId(bestFreeRanked.model),
    name: shortName(bestFreeRanked.model.id),
    provider: providerLabel(bestFreeRanked.profile.provider),
    capabilityScore: bestFreeRanked.profile.finalScore,
    params: extractParamBillions(bestFreeRanked.model),
  } : null;

  const bestPaid = bestPaidRanked ? {
    id: selectionId(bestPaidRanked.model),
    name: shortName(bestPaidRanked.model.id),
    provider: providerLabel(bestPaidRanked.profile.provider),
    costLabel: formatPricePer1M(bestPaidRanked.model),
    capabilityScore: bestPaidRanked.profile.finalScore,
    params: extractParamBillions(bestPaidRanked.model),
  } : null;

  const cheapestPaidCandidate = capable
    .map((model) => ({ model, profile: buildUnifiedModelProfile(model, taskType, rankingSignals) }))
    .filter(({ model, profile }) =>
      !profile.isFree &&
      selectionId(model) !== currentModelId &&
      model.id !== currentModelId &&
      profile.finalScore >= Math.max(30, currentScore * 0.6)
    )
    .sort((a, b) => costPer1MTokens(a.model) - costPer1MTokens(b.model))[0];

  const cheapestPaid = cheapestPaidCandidate ? {
    id: selectionId(cheapestPaidCandidate.model),
    name: shortName(cheapestPaidCandidate.model.id),
    provider: providerLabel(cheapestPaidCandidate.profile.provider),
    isFree: false,
    costLabel: formatPricePer1M(cheapestPaidCandidate.model),
    capabilityScore: cheapestPaidCandidate.profile.finalScore,
  } : null;

  // Always-on monthly estimate for current model (20 msgs/day × 30 days, ~500 in + ~800 out tokens each)
  const MONTHLY_MSGS = 600; // 20/day × 30
  const AVG_TOKENS = 1300;  // 500 prompt + 800 completion
  const currentRawCost = costPer1MTokens(currentModel);
  const estMonthlyCost = currentRawCost > 0 ? (currentRawCost / 1_000_000) * (MONTHLY_MSGS * AVG_TOKENS) : 0;

  let budgetPick = null;
  let budgetEstMonthly = null;
  if (monthlyBudget > 0) {
    const MONTHLY_TOKENS = 400_000;
    const maxCostPer1M = (monthlyBudget / MONTHLY_TOKENS) * 1_000_000;
    const currentCostPer1M = costPer1MTokens(currentModel);
    budgetEstMonthly = (currentCostPer1M / 1_000_000) * MONTHLY_TOKENS;

    const budgetCandidates = capable
      .map((model) => ({ model, profile: buildUnifiedModelProfile(model, taskType, rankingSignals) }))
      .filter(({ model, profile }) =>
        !profile.isFree &&
        selectionId(model) !== currentModelId &&
        model.id !== currentModelId &&
        costPer1MTokens(model) <= maxCostPer1M &&
        costPer1MTokens(model) > 0
      )
      .sort((a, b) => b.profile.finalScore - a.profile.finalScore);

    if (budgetCandidates[0]) {
      const chosen = budgetCandidates[0];
      budgetPick = {
        id: selectionId(chosen.model),
        name: shortName(chosen.model.id),
        provider: providerLabel(chosen.profile.provider),
        isFree: false,
        costLabel: formatPricePer1M(chosen.model),
        capabilityScore: chosen.profile.finalScore,
        estMonthlyCost: (costPer1MTokens(chosen.model) / 1_000_000) * MONTHLY_TOKENS,
      };
    }
  }

  let codingSuggestion = null;
  if (taskType === "coding") {
    const codingRanked = rankModelsForTask(
      capable.filter((m) => CODING_MODELS.some((p) => m.id.toLowerCase().includes(p))),
      "coding",
      rankingSignals
    );
    const bestCodingFree = codingRanked.find(({ profile }) => profile.isFree) || null;
    const bestCodingPaid = codingRanked.find(({ profile }) => !profile.isFree) || null;

    codingSuggestion = {
      bestFree: bestCodingFree ? { id: selectionId(bestCodingFree.model), name: shortName(bestCodingFree.model.id) } : null,
      bestPaid: bestCodingPaid ? { id: selectionId(bestCodingPaid.model), name: shortName(bestCodingPaid.model.id), provider: providerLabel(bestCodingPaid.profile.provider), costLabel: formatPricePer1M(bestCodingPaid.model) } : null,
    };
  }

  return {
    cost,
    isFree: currentProfile.isFree,
    costLabel: cost === 0 ? "Free" : (cost < 0.0001 ? "$" + cost.toFixed(6) : cost < 0.01 ? "$" + cost.toFixed(4) : "$" + cost.toFixed(2)),
    costPer1M: currentProfile.costLabel,
    currentModel: currentProfile,
    taskType,
    isCodingTask: taskType === "coding",
    bestModel: bestOverall ? {
      id: selectionId(bestOverall.model),
      name: shortName(bestOverall.model.id),
      provider: providerLabel(bestOverall.profile.provider),
      score: bestOverall.profile.finalScore,
    } : null,
    cheaperAlternative,
    betterModel,
    cheapestPaid,
    bestFree,
    bestPaid,
    bestValueModel: bestValueRanked ? {
      id: selectionId(bestValueRanked.model),
      name: shortName(bestValueRanked.model.id),
      provider: providerLabel(bestValueRanked.profile.provider),
      isFree: bestValueRanked.profile.isFree,
      costLabel: formatPricePer1M(bestValueRanked.model),
      score: bestValueRanked.profile.finalScore,
    } : null,
    codingSuggestion,
    rankingSources: {
      huggingFace: Object.keys(rankingSignals || {}).length > 0,
      openRouter: models.some((m) => m._provider === "openrouter"),
    },
    providerPicks,
    budgetPick,
    monthlyBudget: monthlyBudget > 0 ? monthlyBudget : null,
    budgetEstMonthly,
    estMonthlyCost,
    preference,
  };
}
