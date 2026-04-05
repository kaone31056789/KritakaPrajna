import React from "react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

function Badge({ children, color = "saffron" }) {
  const colors = {
    saffron: "bg-saffron-500/10 text-saffron-300 border-saffron-500/20",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    purple: "bg-purple-500/10 text-purple-300 border-purple-500/20",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-medium rounded-full px-2 py-0.5 border ${colors[color] || colors.saffron}`}>
      {children}
    </span>
  );
}

function MiniCard({ title, name, subtitle, buttonLabel, theme = "saffron", onClick, loading }) {
  const buttonClass =
    theme === "purple"
      ? "text-purple-200 border-purple-400/25 bg-purple-500/10 hover:bg-purple-500/18"
      : theme === "emerald"
        ? "text-emerald-200 border-emerald-400/25 bg-emerald-500/10 hover:bg-emerald-500/18"
        : "text-saffron-200 border-saffron-400/25 bg-saffron-500/10 hover:bg-saffron-500/18";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease }}
      className="rounded-2xl border border-white/[0.06] bg-dark-800/60 shadow-[0_10px_24px_rgba(0,0,0,0.18)] p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[10px] uppercase tracking-[0.14em] text-dark-500 font-semibold">{title}</span>
          <span className="block mt-1 text-[14px] font-semibold text-dark-100 truncate">{name}</span>
          <span className="block mt-1 text-[11px] text-dark-400">{subtitle}</span>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onClick}
          disabled={loading}
          className={`shrink-0 rounded-xl px-3 py-2 text-[11px] font-semibold border cursor-pointer disabled:opacity-40 transition-colors ${buttonClass}`}
        >
          {buttonLabel}
        </motion.button>
      </div>
    </motion.div>
  );
}

export default function ModelAdvisorPanel({ advisorData, onSwitchModel, loading, open, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease }}
          className="shrink-0 bg-dark-900 border-l border-white/[0.06] flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-saffron-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="text-xs font-semibold text-dark-100 tracking-wide">Model Advisor</span>
            </div>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              className="text-dark-400 hover:text-dark-200 cursor-pointer p-0.5"
              aria-label="Close advisor"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </motion.button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {!advisorData ? (
              <div className="flex flex-col items-center justify-center text-center gap-3 py-6">
                <p className="text-[11px] text-dark-500 leading-relaxed">
                  Send a message to see<br />simple model suggestions
                </p>
              </div>
            ) : (
              <AdvisorContent advisorData={advisorData} onSwitchModel={onSwitchModel} loading={loading} />
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

export function AdvisorToggle({ open, onClick, hasData }) {
  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={`fixed right-0 top-1/2 -translate-y-1/2 z-20 flex items-center gap-1 px-1.5 py-3 rounded-l-lg border border-r-0 cursor-pointer transition-colors ${
        open
          ? "bg-saffron-500/15 border-saffron-500/25 text-saffron-400"
          : hasData
            ? "bg-dark-800/80 border-dark-700/40 text-saffron-400 hover:bg-dark-800"
            : "bg-dark-800/60 border-dark-700/30 text-dark-500 hover:text-dark-300 hover:bg-dark-800/80"
      }`}
      aria-label={open ? "Close advisor" : "Open advisor"}
    >
      <svg
        className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      {!open && (
        <span className="text-[9px] font-semibold tracking-wider uppercase" style={{ writingMode: "vertical-rl" }}>
          Advisor
        </span>
      )}
      {hasData && !open && (
        <span className="absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full bg-saffron-500 animate-pulse" />
      )}
    </motion.button>
  );
}

function AdvisorContent({ advisorData, onSwitchModel, loading }) {
  const {
    costLabel,
    costPer1M,
    currentModel,
    taskType,
    isCodingTask,
    betterModel,
    cheaperAlternative,
    bestFree,
    bestPaid,
    bestModel,
    bestValueModel,
    budgetPick,
    monthlyBudget,
    budgetEstMonthly,
    estMonthlyCost,
    rankingSources,
    featureSignals,
    providerPicks,
  } = advisorData;

  const [showDetails, setShowDetails] = React.useState(false);

  const taskLabel =
    taskType === "coding" ? "Coding"
    : taskType === "vision" ? "Vision"
    : taskType === "document" ? "Documents"
    : "General chat";

  const intro =
    taskType === "coding"
      ? "This looks like a coding task. Here's the best model for you."
      : taskType === "vision"
        ? "This looks like a vision task. Here's the best model for you."
        : taskType === "document"
          ? "This looks like a document task. Here's the best model for you."
          : "Here's the best model for what you're doing.";

  const mainRecommendation =
    (bestModel && bestModel.id !== currentModel.id && {
      id: bestModel.id,
      name: bestModel.name,
      provider: bestModel.provider,
      cost: bestFree?.id === bestModel.id ? "Free" : "Paid",
      bestFor: isCodingTask ? "Coding" : taskLabel,
      button: "Use This Model",
    }) ||
    (betterModel && {
      id: betterModel.id,
      name: betterModel.name,
      provider: betterModel.provider,
      cost: betterModel.isFree ? "Free" : "Paid",
      bestFor: isCodingTask ? "Coding" : taskLabel,
      button: "Use This Model",
    });

  const alternatives = [
    bestFree && bestFree.id !== currentModel.id ? {
      id: bestFree.id,
      provider: bestFree.provider,
      title: "Best Free",
      name: bestFree.name,
      subtitle: `${bestFree.provider} · ${isCodingTask ? "Great free pick for coding" : "Strong free option"}`,
      buttonLabel: "Use Free",
      theme: "emerald",
    } : null,
    bestValueModel && bestValueModel.id !== currentModel.id ? {
      id: bestValueModel.id,
      provider: bestValueModel.provider,
      title: "Best Value",
      name: bestValueModel.name,
      subtitle: `${bestValueModel.provider} · ${bestValueModel.isFree ? "Free and reliable" : `${bestValueModel.costLabel} and balanced`}`,
      buttonLabel: "Use Value",
      theme: "saffron",
    } : null,
    cheaperAlternative && cheaperAlternative.id !== currentModel.id ? {
      id: cheaperAlternative.id,
      provider: cheaperAlternative.provider,
      title: "Cheapest",
      name: cheaperAlternative.name,
      subtitle: `${cheaperAlternative.provider} · ${cheaperAlternative.isFree ? "Cheapest free fallback" : "Lower cost with similar quality"}`,
      buttonLabel: "Use Cheaper",
      theme: "emerald",
    } : null,
    bestPaid && bestPaid.id !== currentModel.id && bestPaid.id !== bestModel?.id ? {
      id: bestPaid.id,
      provider: bestPaid.provider,
      title: "Best Paid",
      name: bestPaid.name,
      subtitle: `${bestPaid.provider} · ${isCodingTask ? "Premium coding option" : "Highest quality paid option"}`,
      buttonLabel: "Use Paid",
      theme: "purple",
    } : null,
    budgetPick && budgetPick.id !== currentModel.id ? {
      id: budgetPick.id,
      provider: budgetPick.provider,
      title: "Budget Pick",
      name: budgetPick.name,
      subtitle: `${budgetPick.provider} · ${budgetPick.estMonthlyCost ? `~$${budgetPick.estMonthlyCost.toFixed(2)}/mo` : "Fits your budget"}`,
      buttonLabel: "Use Budget",
      theme: "saffron",
    } : null,
  ].filter(Boolean);

  const shownProviders = new Set();
  if (mainRecommendation?.provider) shownProviders.add(mainRecommendation.provider);

  const diverseAlternatives = [];
  alternatives.forEach((option) => {
    if (diverseAlternatives.length >= 3) return;
    if (!shownProviders.has(option.provider)) {
      diverseAlternatives.push(option);
      shownProviders.add(option.provider);
    }
  });

  if (diverseAlternatives.length < 3 && providerPicks?.length > 0) {
    providerPicks.forEach((pick) => {
      if (diverseAlternatives.length >= 3) return;
      if (pick.id === currentModel.id || pick.id === mainRecommendation?.id) return;
      if (shownProviders.has(pick.provider)) return;

      diverseAlternatives.push({
        id: pick.id,
        provider: pick.provider,
        title: `Best ${pick.provider}`,
        name: pick.name,
        subtitle: `${pick.provider} · ${pick.isFree ? "Strong free option" : pick.costLabel}`,
        buttonLabel: "Use Model",
        theme: pick.provider === "Hugging Face" ? "saffron" : pick.provider === "OpenAI" || pick.provider === "Anthropic" ? "purple" : "emerald",
      });
      shownProviders.add(pick.provider);
    });
  }

  if (diverseAlternatives.length < 3) {
    alternatives.forEach((option) => {
      if (diverseAlternatives.length >= 3) return;
      if (diverseAlternatives.some((item) => item.id === option.id)) return;
      diverseAlternatives.push(option);
    });
  }

  const pinnedBestPaid =
    bestPaid &&
    bestPaid.id !== currentModel.id &&
    bestPaid.id !== mainRecommendation?.id &&
    !diverseAlternatives.some((item) => item.id === bestPaid.id)
      ? {
          id: bestPaid.id,
          provider: bestPaid.provider,
          title: "Best Paid",
          name: bestPaid.name,
          subtitle: `${bestPaid.provider} · ${isCodingTask ? "Premium coding option" : "Highest quality paid option"}`,
          buttonLabel: "Use Paid",
          theme: "purple",
        }
      : null;

  const finalAlternatives = pinnedBestPaid
    ? [...diverseAlternatives.slice(0, 2), pinnedBestPaid]
    : diverseAlternatives.slice(0, 3);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="text-[11px] leading-relaxed text-dark-400">{intro}</p>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease }}
          className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-dark-800 via-dark-800/95 to-dark-900 shadow-[0_14px_30px_rgba(0,0,0,0.28)] p-4"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] uppercase tracking-[0.16em] text-saffron-400/80 font-semibold">Best Model</span>
                <h3 className="mt-1 text-lg font-semibold text-white truncate">{mainRecommendation?.name || currentModel.name}</h3>
                <span className="mt-1 block text-[11px] text-dark-400">{mainRecommendation?.provider || currentModel.provider}</span>
              </div>
              <Badge color={mainRecommendation?.cost === "Free" || (!mainRecommendation && currentModel.isFree) ? "emerald" : "saffron"}>
                {mainRecommendation?.cost || (currentModel.isFree ? "Free" : "Paid")}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-white/[0.06] bg-dark-900/50 px-3 py-2">
                <span className="block text-dark-500">Cost</span>
                <span className="block mt-1 text-dark-100 font-medium">{mainRecommendation?.cost || (currentModel.isFree ? "Free" : "Paid")}</span>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-dark-900/50 px-3 py-2">
                <span className="block text-dark-500">Best for</span>
                <span className="block mt-1 text-dark-100 font-medium">{mainRecommendation?.bestFor || taskLabel}</span>
              </div>
            </div>
            {!currentModel.isFree && estMonthlyCost > 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-dark-900/50 px-3 py-2 text-[11px] flex items-center justify-between">
                <span className="text-dark-500">~Monthly est.</span>
                <span className="text-amber-300 font-medium" title="20 msgs/day × 30 days">
                  {estMonthlyCost < 0.01 ? `$${estMonthlyCost.toFixed(4)}` : `$${estMonthlyCost.toFixed(2)}`}/mo
                </span>
              </div>
            )}
            {mainRecommendation ? (
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onSwitchModel?.(mainRecommendation.id)}
                disabled={loading}
                className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-purple-100 bg-purple-500/20 border border-purple-400/25 hover:bg-purple-500/28 transition-colors cursor-pointer disabled:opacity-40"
              >
                {mainRecommendation.button}
              </motion.button>
            ) : (
              <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/8 px-3 py-2 text-[11px] text-emerald-300">
                You're already on a strong choice for this task.
              </div>
            )}
          </div>
        </motion.div>
      </section>

      {finalAlternatives.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-[10px] text-dark-500 uppercase tracking-wider font-semibold">Alternatives</h4>
          <div className="space-y-2">
            {finalAlternatives.map((option) => (
              <MiniCard
                key={option.id}
                title={option.title}
                name={option.name}
                subtitle={option.subtitle}
                buttonLabel={option.buttonLabel}
                theme={option.theme}
                onClick={() => onSwitchModel?.(option.id)}
                loading={loading}
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h4 className="text-[10px] text-dark-500 uppercase tracking-wider font-semibold">Current Model</h4>
        <div className="rounded-2xl border border-white/[0.06] bg-dark-800/55 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-dark-200 truncate">
              Current: <span className="font-semibold text-white">{currentModel.name}</span> ({currentModel.isFree ? "Free" : "Paid"})
            </span>
            {!mainRecommendation && <Badge color="emerald">Current</Badge>}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowDetails((v) => !v)}
          className="text-[11px] text-dark-400 hover:text-dark-200 transition-colors cursor-pointer"
        >
          {showDetails ? "Hide Details" : "Show Details"}
        </motion.button>

        <AnimatePresence>
          {showDetails && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease }}
              className="overflow-hidden"
            >
              <div className="rounded-2xl border border-white/[0.06] bg-dark-800/55 p-3 space-y-2 text-[11px] text-dark-300">
                <div className="flex items-center justify-between">
                  <span>Last response cost</span>
                  <span className="text-dark-100">{costLabel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Model cost tier</span>
                  <span className="text-dark-100">~{costPer1M}/1M tokens</span>
                </div>
                {monthlyBudget > 0 && budgetEstMonthly != null && (
                  <div className="flex items-center justify-between">
                    <span>Budget estimate</span>
                    <span className={`${budgetEstMonthly > monthlyBudget ? "text-red-400" : "text-emerald-300"}`}>
                      ~${budgetEstMonthly < 0.01 ? budgetEstMonthly.toFixed(4) : budgetEstMonthly.toFixed(2)}/mo
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {rankingSources?.huggingFace && <Badge color="purple">HF quality signal</Badge>}
                  {rankingSources?.openRouter && <Badge color="blue">OpenRouter pricing signal</Badge>}
                  {featureSignals?.webSearchUsed && <Badge color="blue">Web-aware ({featureSignals.webSearchMode})</Badge>}
                  {!featureSignals?.webSearchUsed && featureSignals?.explicitWebIntent && <Badge color="blue">Web-intent prompt</Badge>}
                  {featureSignals?.terminalIntent && <Badge color="purple">Terminal intent</Badge>}
                  {featureSignals?.reasoningDepth === "deep" && <Badge color="saffron">Deep reasoning</Badge>}
                  {featureSignals?.reasoningDepth === "fast" && <Badge color="emerald">Fast reasoning</Badge>}
                  <Badge color={isCodingTask ? "purple" : taskType === "vision" ? "blue" : "saffron"}>{taskLabel}</Badge>
                </div>
                {providerPicks?.length > 0 && (
                  <div className="pt-2 space-y-1.5">
                    <span className="block text-dark-500">Best by provider</span>
                    {providerPicks.slice(0, 4).map((pick) => (
                      <div key={pick.id} className="flex items-center justify-between gap-3">
                        <span className="truncate">{pick.provider}: {pick.name}</span>
                        <span className="text-dark-100 shrink-0">{pick.isFree ? "Free" : pick.costLabel}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
