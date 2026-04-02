import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

function Badge({ children, color = "saffron" }) {
  const colors = {
    saffron: "bg-saffron-500/10 text-saffron-300 border-saffron-500/20",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    purple: "bg-purple-500/10 text-purple-300 border-purple-500/20",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/20",
    red: "bg-red-500/10 text-red-300 border-red-500/20",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-medium rounded-full px-2 py-0.5 border ${colors[color] || colors.saffron}`}>
      {children}
    </span>
  );
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

export default function ModelAdvisorCard({ advisorData, onSwitchModel, loading }) {
  const [expanded, setExpanded] = useState(false);

  if (!advisorData) return null;
  const {
    cost, costLabel, costPer1M, isFree,
    currentModel, taskType, isCodingTask,
    cheaperAlternative, betterModel,
    bestFree, bestPaid, codingSuggestion,
  } = advisorData;

  const hasSuggestions = cheaperAlternative || betterModel || (bestFree && bestFree.id !== currentModel.id) || (bestPaid && bestPaid.id !== currentModel.id);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease }}
      className="mt-1.5 w-full"
      style={{ marginLeft: '34px' }}
    >
      {/* Compact header — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 group cursor-pointer select-none"
      >
        {/* Cost pill */}
        <span className="inline-flex items-center gap-1 text-[10px] text-dark-400 bg-dark-800/60 border border-dark-700/30 rounded-full px-2 py-0.5">
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1" />
          </svg>
          {costLabel}
        </span>

        {/* Est per 1M tokens */}
        <span className="text-[10px] text-dark-500">
          ~{costPer1M}/1M tokens
        </span>

        {/* Task badge */}
        {taskType !== "general" && (
          <Badge color={isCodingTask ? "purple" : taskType === "vision" ? "blue" : "saffron"}>
            {isCodingTask ? "💻 Coding" : taskType === "vision" ? "👁 Vision" : "📄 Document"}
          </Badge>
        )}

        {/* Expand indicator */}
        {hasSuggestions && (
          <span className="text-[10px] text-dark-500 group-hover:text-dark-300 transition-colors flex items-center gap-0.5">
            <svg
              className={`w-3 h-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            Advisor
          </span>
        )}
      </button>

      {/* Expanded panel */}
      <AnimatePresence>
        {expanded && hasSuggestions && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease }}
            className="overflow-hidden"
          >
            <div className="mt-2 bg-dark-800/50 border border-dark-700/30 rounded-xl p-3 space-y-3 max-w-md">
              {/* Current model scores */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-dark-300 font-medium">Current: {currentModel.name}</span>
                  {currentModel.isFree && <Badge color="emerald">Free</Badge>}
                </div>
                <CapBar label="Capability" score={currentModel.capabilityScore} />
                <CapBar label="Speed" score={currentModel.speedScore} />
              </div>

              {/* Divider */}
              <div className="border-t border-dark-700/30" />

              {/* Cheaper alternative */}
              {cheaperAlternative && (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px]">💰</span>
                    <div className="min-w-0">
                      <span className="text-[11px] text-dark-200 block truncate">{cheaperAlternative.name}</span>
                      <span className="text-[10px] text-dark-500">
                        {cheaperAlternative.isFree ? "Free" : cheaperAlternative.costLabel}
                        {" · Cap: "}{cheaperAlternative.capabilityScore}
                      </span>
                    </div>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onSwitchModel?.(cheaperAlternative.id)}
                    disabled={loading}
                    className="text-[10px] font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg px-2.5 py-1 cursor-pointer disabled:opacity-30 transition-colors shrink-0"
                  >
                    Use Cheaper
                  </motion.button>
                </div>
              )}

              {/* Better model */}
              {betterModel && (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px]">🚀</span>
                    <div className="min-w-0">
                      <span className="text-[11px] text-dark-200 block truncate">{betterModel.name}</span>
                      <span className="text-[10px] text-dark-500">
                        {betterModel.isFree ? "Free" : betterModel.costLabel}
                        {" · Cap: "}{betterModel.capabilityScore}
                      </span>
                    </div>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onSwitchModel?.(betterModel.id)}
                    disabled={loading}
                    className="text-[10px] font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg px-2.5 py-1 cursor-pointer disabled:opacity-30 transition-colors shrink-0"
                  >
                    Use Better
                  </motion.button>
                </div>
              )}

              {/* Coding suggestions */}
              {isCodingTask && codingSuggestion && (codingSuggestion.bestFree || codingSuggestion.bestPaid) && (
                <>
                  <div className="border-t border-dark-700/30" />
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-dark-500 uppercase tracking-wider font-semibold">Coding Specialists</span>
                    {codingSuggestion.bestFree && codingSuggestion.bestFree.id !== currentModel.id && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-dark-300 truncate">🆓 {codingSuggestion.bestFree.name}</span>
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => onSwitchModel?.(codingSuggestion.bestFree.id)}
                          disabled={loading}
                          className="text-[10px] font-medium text-saffron-300 bg-saffron-500/10 hover:bg-saffron-500/20 border border-saffron-500/20 rounded-lg px-2 py-0.5 cursor-pointer disabled:opacity-30 transition-colors shrink-0"
                        >
                          Switch
                        </motion.button>
                      </div>
                    )}
                    {codingSuggestion.bestPaid && codingSuggestion.bestPaid.id !== currentModel.id && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-dark-300 truncate">💎 {codingSuggestion.bestPaid.name} <span className="text-dark-500">({codingSuggestion.bestPaid.costLabel})</span></span>
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => onSwitchModel?.(codingSuggestion.bestPaid.id)}
                          disabled={loading}
                          className="text-[10px] font-medium text-saffron-300 bg-saffron-500/10 hover:bg-saffron-500/20 border border-saffron-500/20 rounded-lg px-2 py-0.5 cursor-pointer disabled:opacity-30 transition-colors shrink-0"
                        >
                          Switch
                        </motion.button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Both options row: best free + best paid */}
              {(bestFree || bestPaid) && (
                <>
                  <div className="border-t border-dark-700/30" />
                  <div className="flex gap-2">
                    {bestFree && bestFree.id !== currentModel.id && (
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => onSwitchModel?.(bestFree.id)}
                        disabled={loading}
                        className="flex-1 text-center text-[10px] font-medium text-emerald-300 bg-emerald-500/8 hover:bg-emerald-500/15 border border-emerald-500/15 rounded-lg px-2 py-1.5 cursor-pointer disabled:opacity-30 transition-colors"
                      >
                        Best Free<br />
                        <span className="text-dark-400 font-normal">{bestFree.name}</span>
                      </motion.button>
                    )}
                    {bestPaid && bestPaid.id !== currentModel.id && (
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => onSwitchModel?.(bestPaid.id)}
                        disabled={loading}
                        className="flex-1 text-center text-[10px] font-medium text-purple-300 bg-purple-500/8 hover:bg-purple-500/15 border border-purple-500/15 rounded-lg px-2 py-1.5 cursor-pointer disabled:opacity-30 transition-colors"
                      >
                        Best Paid<br />
                        <span className="text-dark-400 font-normal">{bestPaid.name}</span>
                      </motion.button>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
