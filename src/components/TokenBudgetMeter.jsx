import React from "react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const LEVEL_NAMES = ["L0 Lossless", "L1 Structural", "L2 Semantic", "L3 Aggressive"];
const LEVEL_COLORS = ["#34d399", "#a78bfa", "#fbbf24", "#ef4444"];

/**
 * Token Budget Meter — shows context usage, compression status, and savings.
 * Renders inline above the message input as a compact, collapsible widget.
 */
export default function TokenBudgetMeter({ budgetInfo, visible = true }) {
  const [expanded, setExpanded] = React.useState(false);

  if (!visible || !budgetInfo) return null;

  const {
    estimatedTokens = 0,
    maxTokens = 12000,
    compressionLevel = -1,
    savings = { tokens: 0, percentage: 0 },
    compressionLog = [],
    deepAnalysis = false,
    segments = {},
    prediction = null,
  } = budgetInfo;

  const usagePercent = maxTokens > 0 ? Math.min((estimatedTokens / maxTokens) * 100, 100) : 0;
  const isWarning = usagePercent >= 70;
  const isDanger = usagePercent >= 90;

  const barColor = isDanger ? "#ef4444" : isWarning ? "#fbbf24" : "#34d399";
  const statusText = isDanger ? "Near limit" : isWarning ? "High usage" : "Optimal";

  // Segment widths
  const systemPercent = Math.min(((segments.system || 0) / maxTokens) * 100, 30);
  const summaryPercent = Math.min(((segments.summary || 0) / maxTokens) * 100, 20);
  const historyPercent = Math.min(((segments.history || 0) / maxTokens) * 100, 50);
  const remainingPercent = Math.max(0, 100 - systemPercent - summaryPercent - historyPercent);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.2, ease }}
        className="mx-2 mb-1.5"
      >
        {/* Compact bar */}
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-white/[0.06] bg-[#0d0d0d]/80 backdrop-blur-sm cursor-pointer hover:border-white/[0.1] transition-colors"
          onClick={() => setExpanded((v) => !v)}
          title="Click to expand token budget details"
        >
          {/* Mini segmented bar */}
          <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden flex">
            {systemPercent > 0 && (
              <motion.div
                className="h-full"
                style={{ width: `${systemPercent}%`, backgroundColor: "#818cf8" }}
                initial={{ width: 0 }}
                animate={{ width: `${systemPercent}%` }}
                transition={{ duration: 0.4, ease }}
              />
            )}
            {summaryPercent > 0 && (
              <motion.div
                className="h-full"
                style={{ width: `${summaryPercent}%`, backgroundColor: "#a78bfa" }}
                initial={{ width: 0 }}
                animate={{ width: `${summaryPercent}%` }}
                transition={{ duration: 0.4, delay: 0.05, ease }}
              />
            )}
            {historyPercent > 0 && (
              <motion.div
                className="h-full"
                style={{ width: `${historyPercent}%`, backgroundColor: barColor }}
                initial={{ width: 0 }}
                animate={{ width: `${historyPercent}%` }}
                transition={{ duration: 0.4, delay: 0.1, ease }}
              />
            )}
          </div>

          {/* Token count */}
          <span className="text-[9px] text-[#b0b0b0] font-mono shrink-0">
            {formatTokens(estimatedTokens)}/{formatTokens(maxTokens)}
          </span>

          {/* Status dot */}
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: barColor }}
          />

          {/* Savings badge */}
          {savings.tokens > 0 && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/15 font-mono shrink-0">
              −{savings.percentage}%
            </span>
          )}

          {/* Deep analysis badge */}
          {deepAnalysis && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/15 font-medium shrink-0">
              Deep
            </span>
          )}

          {/* Expand chevron */}
          <svg
            className={`w-2.5 h-2.5 text-[#666] transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Expanded details */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15, ease }}
              className="overflow-hidden"
            >
              <div className="mt-1 rounded-md border border-white/[0.06] bg-[#0d0d0d]/90 px-2.5 py-2 space-y-2">
                {/* Usage summary */}
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-[#999]">Context usage</span>
                  <span className="font-mono" style={{ color: barColor }}>
                    {Math.round(usagePercent)}% · {statusText}
                  </span>
                </div>

                {/* Segment legend */}
                <div className="flex flex-wrap gap-2.5 text-[9px]">
                  {segments.system > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#818cf8" }} />
                      <span className="text-[#999]">System {formatTokens(segments.system)}</span>
                    </span>
                  )}
                  {segments.summary > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#a78bfa" }} />
                      <span className="text-[#999]">Summary {formatTokens(segments.summary)}</span>
                    </span>
                  )}
                  {segments.history > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#34d399" }} />
                      <span className="text-[#999]">History {formatTokens(segments.history)}</span>
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#333" }} />
                    <span className="text-[#999]">Free {formatTokens(Math.max(0, maxTokens - estimatedTokens))}</span>
                  </span>
                </div>

                {/* Compression log */}
                {compressionLog.length > 0 && (
                  <div className="space-y-1 pt-1 border-t border-white/[0.04]">
                    <span className="block text-[9px] text-[#b0b0b0]/40 uppercase tracking-wider font-semibold">
                      Compression Applied
                    </span>
                    {compressionLog.map((entry, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[9px]">
                        <span className="flex items-center gap-1">
                          <span
                            className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: LEVEL_COLORS[entry.level] || "#666" }}
                          />
                          <span className="text-[#ccc]">{LEVEL_NAMES[entry.level] || `L${entry.level}`}</span>
                        </span>
                        <span className="text-[#999] font-mono">
                          {entry.tokensSaved > 0 ? `−${formatTokens(entry.tokensSaved)}` : "—"}
                          {entry.messagesChanged > 0 && ` (${entry.messagesChanged} msgs)`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Prediction info */}
                {prediction && (
                  <div className="pt-1 border-t border-white/[0.04] flex items-center justify-between text-[9px]">
                    <span className="text-[#999]">Predicted usage</span>
                    <span className="text-[#ccc] font-mono">
                      ~{formatTokens(prediction.total)} tokens ({prediction.confidence})
                    </span>
                  </div>
                )}

                {/* Deep analysis notice */}
                {deepAnalysis && (
                  <div className="pt-1 border-t border-white/[0.04] text-[9px] text-purple-300/80 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Deep analysis: expanded window (40 msgs / 32K tokens)
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
