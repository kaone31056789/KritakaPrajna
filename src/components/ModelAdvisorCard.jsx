import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getModelHealth, isModelUnavailable } from "../utils/rateLimiter";

const ease = [0.4, 0, 0.2, 1];

function Badge({ children, color = "saffron" }) {
  const colors = {
    saffron: "bg-saffron-500/10 text-saffron-300 border-saffron-500/20",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    purple: "bg-purple-500/10 text-purple-300 border-purple-500/20",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/20",
    red: "bg-red-500/10 text-red-300 border-red-500/20",
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-medium rounded-full px-2 py-0.5 border ${colors[color] || colors.saffron}`}>
      {children}
    </span>
  );
}

/** Rate limit status indicator for a model */
function RateBadge({ modelId }) {
  const health = getModelHealth(modelId);
  if (!health.available) {
    const secs = Math.ceil(health.cooldownRemaining / 1000);
    return <Badge color="red">⛔ Limited{secs > 0 ? ` ${secs}s` : ""}</Badge>;
  }
  if (health.slow) {
    return <Badge color="amber">🐢 Slow</Badge>;
  }
  if (health.recentFailures > 0) {
    return <Badge color="amber">⚠ {health.recentFailures} fail</Badge>;
  }
  return <Badge color="emerald">✓ OK</Badge>;
}

function CapBar({ score, label, max = 100 }) {
  const pct = Math.min(score / max * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-dark-400 w-[52px] shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-dark-700/50 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease }}
          className="h-full rounded-full bg-gradient-to-r from-saffron-600 to-saffron-400"
        />
      </div>
      <span className="text-[10px] text-dark-400 w-6 text-right">{score}</span>
    </div>
  );
}

function SuggestionRow({ emoji, name, detail, btnLabel, btnColor, onSwitch, loading, modelId }) {
  const btnThemes = {
    emerald: "text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20",
    purple: "text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/20",
    saffron: "text-saffron-300 bg-saffron-500/10 hover:bg-saffron-500/20 border-saffron-500/20",
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[11px] shrink-0">{emoji}</span>
        <div className="min-w-0">
          <span className="text-[11px] text-dark-200 block truncate">{name}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-dark-500">{detail}</span>
            {modelId && <RateBadge modelId={modelId} />}
          </div>
        </div>
      </div>
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={onSwitch}
        disabled={loading}
        className={`text-[10px] font-medium border rounded-lg px-2.5 py-1 cursor-pointer disabled:opacity-30 transition-colors shrink-0 ${btnThemes[btnColor] || btnThemes.saffron}`}
      >
        {btnLabel}
      </motion.button>
    </div>
  );
}

/**
 * Always-visible section: current model pricing, fast free recs, cost estimator.
 */
function ModelQuickInfo({ models, selectedModel, onSwitchModel }) {
  const m = models.find((mod) => mod.id === selectedModel);
  if (!m) return null;

  const p = m.pricing || {};
  const promptCost = Number(p.prompt) || 0;
  const completionCost = Number(p.completion) || 0;
  const per1M = (promptCost + completionCost) * 1_000_000;
  const isFree = per1M === 0;

  // Top free alternatives ranked by quality (larger/better models first), excluding unavailable
  const fastFree = isFree
    ? models
        .filter((mod) => {
          const mp = mod.pricing;
          return mp && Number(mp.prompt) === 0 && Number(mp.completion) === 0 && mod.id !== selectedModel && !isModelUnavailable(mod.id);
        })
        .map((mod) => {
          const id = mod.id.toLowerCase();
          const match = id.match(/(\d+(?:\.\d+)?)[b]/);
          const params = match ? parseFloat(match[1]) : 0;
          // Quality heuristic: known good models get high base, then param size bonus
          let score = 30;
          if (id.includes("llama-3")) score = 70;
          if (id.includes("qwen")) score = 60;
          if (id.includes("gemma")) score = 55;
          if (id.includes("deepseek")) score = 75;
          if (id.includes("mistral")) score = 58;
          if (id.includes("phi")) score = 52;
          if (params >= 65) score += 20;
          else if (params >= 30) score += 15;
          else if (params >= 10) score += 10;
          else if (params >= 3) score += 5;
          return { ...mod, _score: score };
        })
        .sort((a, b) => b._score - a._score)
        .slice(0, 3)
    : [];

  // Est cost per 1K messages (avg ~300 prompt + 500 completion tokens)
  const estPer1K = isFree ? 0 : (promptCost * 300 + completionCost * 500) * 1000;

  return (
    <div className="space-y-3 mb-4 pb-4 border-b border-dark-700/50">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-dark-500 uppercase tracking-wider">Price</span>
        <Badge color={isFree ? "emerald" : "saffron"}>
          {isFree ? "Free" : `$${per1M < 0.01 ? per1M.toFixed(4) : per1M.toFixed(2)}/1M tokens`}
        </Badge>
        <RateBadge modelId={selectedModel} />
      </div>

      {/* Cost estimator for paid models */}
      {!isFree && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-dark-500 uppercase tracking-wider">Est.</span>
          <span className="text-[11px] text-saffron-300">
            ~${estPer1K < 0.01 ? estPer1K.toFixed(4) : estPer1K.toFixed(2)}/1K msgs
          </span>
        </div>
      )}

      {/* Fast free recommendations */}
      {isFree && fastFree.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] text-dark-500 uppercase tracking-wider">🏆 Top Free Models</span>
          {fastFree.map((fm) => {
            const sn = fm.id.includes("/") ? fm.id.split("/").pop() : fm.id;
            const label = sn.length > 22 ? sn.slice(0, 20) + "…" : sn;
            const health = getModelHealth(fm.id);
            return (
              <motion.button
                key={fm.id}
                whileTap={{ scale: 0.97 }}
                onClick={() => onSwitchModel(fm.id)}
                className={`w-full text-left text-[11px] border rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors truncate ${
                  !health.available
                    ? "text-red-300 bg-red-500/8 border-red-500/15 opacity-50"
                    : "text-emerald-300 bg-emerald-500/8 hover:bg-emerald-500/15 border-emerald-500/15"
                }`}
                title={fm.id}
                disabled={!health.available}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className="truncate">⚡ {label}</span>
                  <RateBadge modelId={fm.id} />
                </span>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Right-side slider panel for model advisor.
 * Rendered as a sibling to the chat column in ChatApp.
 */
export default function ModelAdvisorPanel({ advisorData, onSwitchModel, loading, open, onClose, models = [], selectedModel = "" }) {
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
          {/* Header */}
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

          {/* Content — scrollable */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {/* Always-visible: model info + fast recs + cost estimate */}
            <ModelQuickInfo models={models} selectedModel={selectedModel} onSwitchModel={onSwitchModel} />

            {!advisorData ? (
              <div className="flex flex-col items-center justify-center text-center gap-3 py-6">
                <p className="text-[11px] text-dark-500 leading-relaxed">
                  Send a message to see<br />detailed suggestions
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

/** Toggle button that sits at the edge of the chat area */
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
        <span className="text-[9px] font-semibold tracking-wider uppercase" style={{ writingMode: 'vertical-rl' }}>
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
    costLabel, costPer1M, currentModel, taskType, isCodingTask,
    cheaperAlternative, betterModel, cheapestPaid, bestFree, bestPaid, codingSuggestion,
    budgetPick, monthlyBudget, budgetEstMonthly,
  } = advisorData;

  return (
    <div className="space-y-4">
      {/* Cost overview */}
      <section className="space-y-2">
        <h4 className="text-[10px] text-dark-500 uppercase tracking-wider font-semibold">Last Response</h4>
        <div className="bg-dark-800/60 border border-dark-700/30 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-dark-400">Cost</span>
            <span className="text-[11px] text-dark-100 font-medium">{costLabel}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-dark-400">Per 1M tokens</span>
            <span className="text-[11px] text-dark-200">~{costPer1M}</span>
          </div>
          {taskType !== "general" && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-dark-400">Task</span>
              <Badge color={isCodingTask ? "purple" : taskType === "vision" ? "blue" : "saffron"}>
                {isCodingTask ? "Coding" : taskType === "vision" ? "Vision" : "Document"}
              </Badge>
            </div>
          )}
        </div>
      </section>

      {/* Monthly Budget */}
      {monthlyBudget > 0 && (
        <section className="space-y-2">
          <h4 className="text-[10px] text-dark-500 uppercase tracking-wider font-semibold">Monthly Budget</h4>
          <div className="bg-dark-800/60 border border-dark-700/30 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-dark-400">Limit</span>
              <span className="text-[11px] text-saffron-300 font-medium">${monthlyBudget.toFixed(2)}/mo</span>
            </div>
            {budgetEstMonthly != null && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-dark-400">Est. with current model</span>
                  <span className={`text-[11px] font-medium ${budgetEstMonthly > monthlyBudget ? "text-red-400" : "text-emerald-400"}`}>
                    ~${budgetEstMonthly < 0.01 ? budgetEstMonthly.toFixed(4) : budgetEstMonthly.toFixed(2)}/mo
                  </span>
                </div>
                <div className="h-1.5 bg-dark-700/50 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((budgetEstMonthly / monthlyBudget) * 100, 100)}%` }}
                    transition={{ duration: 0.5, ease }}
                    className={`h-full rounded-full ${budgetEstMonthly > monthlyBudget ? "bg-red-500" : budgetEstMonthly > monthlyBudget * 0.8 ? "bg-amber-500" : "bg-emerald-500"}`}
                  />
                </div>
                <span className="text-[10px] text-dark-500">
                  {budgetEstMonthly > monthlyBudget
                    ? "⚠ Over budget — consider switching to a cheaper model"
                    : budgetEstMonthly > monthlyBudget * 0.8
                      ? "⚡ Close to limit"
                      : "✓ Within budget"}
                </span>
              </>
            )}
          </div>
        </section>
      )}

      {/* Current model */}
      <section className="space-y-2">
        <h4 className="text-[10px] text-dark-500 uppercase tracking-wider font-semibold">Current Model</h4>
        <div className="bg-dark-800/60 border border-dark-700/30 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-dark-200 font-medium truncate">{currentModel.name}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {currentModel.isFree && <Badge color="emerald">Free</Badge>}
              <RateBadge modelId={currentModel.id} />
            </div>
          </div>
          <CapBar label="Capability" score={currentModel.capabilityScore} />
          <CapBar label="Speed" score={currentModel.speedScore} />
        </div>
      </section>

      {/* Suggestions */}
      {(cheaperAlternative || betterModel) && (
        <section className="space-y-2">
          <h4 className="text-[10px] text-dark-500 uppercase tracking-wider font-semibold">Suggestions</h4>
          <div className="space-y-2">
            {cheaperAlternative && (
              <SuggestionRow
                emoji="💰"
                name={cheaperAlternative.name}
                detail={`${cheaperAlternative.isFree ? "Free" : cheaperAlternative.costLabel} · Cap: ${cheaperAlternative.capabilityScore}`}
                btnLabel="Use Cheaper"
                btnColor="emerald"
                onSwitch={() => onSwitchModel?.(cheaperAlternative.id)}
                loading={loading}
                modelId={cheaperAlternative.id}
              />
            )}
            {betterModel && (
              <SuggestionRow
                emoji="🚀"
                name={betterModel.name}
                detail={`${betterModel.isFree ? "Free" : betterModel.costLabel} · Cap: ${betterModel.capabilityScore}`}
                btnLabel="Use Better"
                btnColor="purple"
                onSwitch={() => onSwitchModel?.(betterModel.id)}
                loading={loading}
                modelId={betterModel.id}
              />
            )}
          </div>
        </section>
      )}

      {/* Coding specialists */}
      {isCodingTask && codingSuggestion && (codingSuggestion.bestFree || codingSuggestion.bestPaid) && (
        <section className="space-y-2">
          <h4 className="text-[10px] text-dark-500 uppercase tracking-wider font-semibold">Coding Specialists</h4>
          <div className="space-y-2">
            {codingSuggestion.bestFree && codingSuggestion.bestFree.id !== currentModel.id && (
              <SuggestionRow
                emoji="🆓"
                name={codingSuggestion.bestFree.name}
                detail="Free · Code-optimized"
                btnLabel="Switch"
                btnColor="saffron"
                onSwitch={() => onSwitchModel?.(codingSuggestion.bestFree.id)}
                loading={loading}
                modelId={codingSuggestion.bestFree.id}
              />
            )}
            {codingSuggestion.bestPaid && codingSuggestion.bestPaid.id !== currentModel.id && (
              <SuggestionRow
                emoji="💎"
                name={codingSuggestion.bestPaid.name}
                detail={`${codingSuggestion.bestPaid.costLabel} · Code-optimized`}
                btnLabel="Switch"
                btnColor="saffron"
                onSwitch={() => onSwitchModel?.(codingSuggestion.bestPaid.id)}
                loading={loading}
                modelId={codingSuggestion.bestPaid.id}
              />
            )}
          </div>
        </section>
      )}

      {/* Best free / best paid / cheapest paid / budget pick */}
      {(bestFree || bestPaid || cheapestPaid || budgetPick) && (bestFree?.id !== currentModel.id || bestPaid?.id !== currentModel.id || (cheapestPaid && cheapestPaid.id !== currentModel.id) || (budgetPick && budgetPick.id !== currentModel.id)) && (
        <section className="space-y-2">
          <h4 className="text-[10px] text-dark-500 uppercase tracking-wider font-semibold">Quick Switch</h4>
          <div className="grid grid-cols-2 gap-2">
            {bestFree && bestFree.id !== currentModel.id && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => onSwitchModel?.(bestFree.id)}
                disabled={loading}
                className="text-center text-[10px] font-medium text-emerald-300 bg-emerald-500/8 hover:bg-emerald-500/15 border border-emerald-500/15 rounded-xl px-2 py-2.5 cursor-pointer disabled:opacity-30 transition-colors"
              >
                <span className="block text-dark-400 text-[9px] uppercase tracking-wider mb-1">Best Free</span>
                <span className="block truncate">{bestFree.name}</span>
                <span className="block mt-1"><RateBadge modelId={bestFree.id} /></span>
              </motion.button>
            )}
            {cheapestPaid && cheapestPaid.id !== currentModel.id && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => onSwitchModel?.(cheapestPaid.id)}
                disabled={loading}
                className="text-center text-[10px] font-medium text-saffron-300 bg-saffron-500/8 hover:bg-saffron-500/15 border border-saffron-500/15 rounded-xl px-2 py-2.5 cursor-pointer disabled:opacity-30 transition-colors"
              >
                <span className="block text-dark-400 text-[9px] uppercase tracking-wider mb-1">Cheap Paid</span>
                <span className="block truncate">{cheapestPaid.name}</span>
                <span className="block mt-1"><RateBadge modelId={cheapestPaid.id} /></span>
              </motion.button>
            )}
            {budgetPick && budgetPick.id !== currentModel.id && budgetPick.id !== cheapestPaid?.id && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => onSwitchModel?.(budgetPick.id)}
                disabled={loading}
                className="text-center text-[10px] font-medium text-blue-300 bg-blue-500/8 hover:bg-blue-500/15 border border-blue-500/15 rounded-xl px-2 py-2.5 cursor-pointer disabled:opacity-30 transition-colors"
              >
                <span className="block text-dark-400 text-[9px] uppercase tracking-wider mb-1">Budget Pick</span>
                <span className="block truncate">{budgetPick.name}</span>
                <span className="block text-[9px] text-blue-400/70 mt-0.5">~${budgetPick.estMonthlyCost < 0.01 ? budgetPick.estMonthlyCost.toFixed(4) : budgetPick.estMonthlyCost.toFixed(2)}/mo</span>
                <span className="block mt-1"><RateBadge modelId={budgetPick.id} /></span>
              </motion.button>
            )}
            {bestPaid && bestPaid.id !== currentModel.id && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => onSwitchModel?.(bestPaid.id)}
                disabled={loading}
                className="text-center text-[10px] font-medium text-purple-300 bg-purple-500/8 hover:bg-purple-500/15 border border-purple-500/15 rounded-xl px-2 py-2.5 cursor-pointer disabled:opacity-30 transition-colors"
              >
                <span className="block text-dark-400 text-[9px] uppercase tracking-wider mb-1">Best Paid</span>
                <span className="block truncate">{bestPaid.name}</span>
                <span className="block mt-1"><RateBadge modelId={bestPaid.id} /></span>
              </motion.button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
