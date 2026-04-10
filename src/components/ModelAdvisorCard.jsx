import React from "react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

// ── Badge ───────────────────────────────────────────────────────────────────

function Badge({ children, color = "saffron" }) {
  const colors = {
    saffron: "bg-[#00ff41]/10 text-[#00ff41] border-[#00ff41]/20",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    purple: "bg-purple-500/10 text-purple-300 border-purple-500/20",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/20",
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    rose: "bg-rose-500/10 text-rose-300 border-rose-500/20",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-medium rounded-full px-2 py-0.5 border ${colors[color] || colors.saffron}`}>
      {children}
    </span>
  );
}

// ── Source Indicator ────────────────────────────────────────────────────────

function SourceIndicator({ label, active, color = "#00ff41" }) {
  return (
    <div className="flex items-center gap-1.5" title={active ? `${label}: Live data` : `${label}: Offline / fallback`}>
      <span
        className="relative flex h-2 w-2"
      >
        {active && (
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50"
            style={{ backgroundColor: color }}
          />
        )}
        <span
          className="relative inline-flex rounded-full h-2 w-2"
          style={{ backgroundColor: active ? color : "#444" }}
        />
      </span>
      <span className={`text-[9px] font-medium tracking-wide ${active ? "text-[#e0e0e0]" : "text-[#555]"}`}>
        {label}
      </span>
    </div>
  );
}

function RankingSourceBar({ sources }) {
  if (!sources) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
      className="flex items-center gap-3 px-3 py-2 rounded-md border border-white/[0.05] bg-[#0a0a0a]/60 backdrop-blur-sm"
    >
      <SourceIndicator label="OpenRouter" active={!!sources.openRouter} color="#818cf8" />
      <SourceIndicator label="HuggingFace" active={!!sources.huggingFace} color="#fbbf24" />
      <SourceIndicator label="Leaderboard" active={!!sources.leaderboard} color="#34d399" />
    </motion.div>
  );
}

// ── Confidence Meter ────────────────────────────────────────────────────────

function ConfidenceMeter({ confidence }) {
  const levels = { high: 3, medium: 2, low: 1 };
  const level = levels[confidence] || 1;
  const colors = {
    high: "#34d399",
    medium: "#fbbf24",
    low: "#6b7280",
  };
  const color = colors[confidence] || colors.low;
  const label = confidence === "high" ? "High confidence" : confidence === "medium" ? "Moderate confidence" : "Limited data";

  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3].map((i) => (
          <motion.div
            key={i}
            initial={{ scaleY: 0.3 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: i * 0.08, duration: 0.2, ease }}
            className="w-1 rounded-full origin-bottom"
            style={{
              height: `${4 + i * 3}px`,
              backgroundColor: i <= level ? color : "#333",
            }}
          />
        ))}
      </div>
      <span className="text-[9px] font-medium" style={{ color }}>{label}</span>
    </div>
  );
}

// ── Radar Chart (SVG) ───────────────────────────────────────────────────────

function RadarChart({ scores, size = 140 }) {
  if (!scores) return null;

  const axes = [
    { key: "quality", label: "Quality" },
    { key: "speed", label: "Speed" },
    { key: "cost", label: "Cost" },
    { key: "context", label: "Context" },
    { key: "reasoning", label: "Reason" },
    { key: "coding", label: "Coding" },
  ];

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.38;
  const angleStep = (2 * Math.PI) / axes.length;

  const getPoint = (index, value) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const r = (Math.min(Math.max(value, 0), 100) / 100) * maxR;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const gridPaths = gridLevels.map((level) => {
    const points = axes.map((_, i) => {
      const angle = -Math.PI / 2 + i * angleStep;
      const r = level * maxR;
      return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
    });
    return `M${points.join("L")}Z`;
  });

  const dataPoints = axes.map((axis, i) => getPoint(i, scores[axis.key] || 0));
  const dataPath = `M${dataPoints.map((p) => `${p.x},${p.y}`).join("L")}Z`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease }}
      className="flex justify-center"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Grid lines */}
        {gridPaths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
        ))}

        {/* Axis lines */}
        {axes.map((_, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + maxR * Math.cos(angle)}
              y2={cy + maxR * Math.sin(angle)}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="0.5"
            />
          );
        })}

        {/* Data polygon */}
        <motion.path
          d={dataPath}
          fill="rgba(0,255,65,0.08)"
          stroke="#00ff41"
          strokeWidth="1.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        />

        {/* Data points */}
        {dataPoints.map((p, i) => (
          <motion.circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="2.5"
            fill="#00ff41"
            initial={{ r: 0 }}
            animate={{ r: 2.5 }}
            transition={{ delay: 0.3 + i * 0.05, duration: 0.2 }}
          />
        ))}

        {/* Labels */}
        {axes.map((axis, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          const labelR = maxR + 14;
          const lx = cx + labelR * Math.cos(angle);
          const ly = cy + labelR * Math.sin(angle);
          const score = scores[axis.key] || 0;
          return (
            <text
              key={i}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-[#999] text-[8px] font-medium"
              style={{ fontSize: "8px" }}
            >
              {axis.label} {score}
            </text>
          );
        })}
      </svg>
    </motion.div>
  );
}

// ── Benchmark Bars ──────────────────────────────────────────────────────────

function BenchmarkBars({ benchmarks }) {
  if (!benchmarks) return null;

  const items = [
    { key: "mmlu", label: "MMLU", color: "#818cf8" },
    { key: "arc", label: "ARC", color: "#34d399" },
    { key: "hellaswag", label: "HellaSwag", color: "#fbbf24" },
    { key: "truthfulqa", label: "TruthfulQA", color: "#f472b6" },
    { key: "gsm8k", label: "GSM8K", color: "#38bdf8" },
    { key: "winogrande", label: "Winogrande", color: "#a78bfa" },
  ];

  const validItems = items.filter((item) => benchmarks[item.key] != null && benchmarks[item.key] > 0);
  if (validItems.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
      className="space-y-1.5"
    >
      <span className="block text-[9px] uppercase tracking-[0.16em] text-[#b0b0b0]/40 font-semibold">
        Benchmark Scores
      </span>
      {validItems.map((item, idx) => {
        const value = Math.round(benchmarks[item.key]);
        return (
          <div key={item.key} className="flex items-center gap-2">
            <span className="text-[9px] text-[#999] w-16 shrink-0 truncate font-medium">{item.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: item.color }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(value, 100)}%` }}
                transition={{ delay: 0.1 + idx * 0.06, duration: 0.5, ease }}
              />
            </div>
            <span className="text-[9px] text-[#ccc] w-7 text-right font-mono">{value}</span>
          </div>
        );
      })}
      {benchmarks.avg != null && (
        <div className="flex items-center justify-between pt-1 border-t border-white/[0.04]">
          <span className="text-[9px] text-[#999] font-medium">Average</span>
          <span className="text-[10px] font-bold text-[#00ff41]">{Math.round(benchmarks.avg)}</span>
        </div>
      )}
    </motion.div>
  );
}

// ── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 36, label }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(score, 100) / 100) * circumference;
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#fbbf24" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease }}
        />
      </svg>
      <span className="text-[9px] text-[#999] font-medium">{label}</span>
    </div>
  );
}

// ── MiniCard ────────────────────────────────────────────────────────────────

function MiniCard({ title, name, subtitle, buttonLabel, theme = "saffron", onClick, loading, orRank }) {
  const buttonClass =
    theme === "purple"
      ? "text-purple-200 border-purple-400/25 bg-purple-500/10 hover:bg-purple-500/18"
      : theme === "emerald"
        ? "text-emerald-200 border-emerald-400/25 bg-emerald-500/10 hover:bg-emerald-500/18"
        : theme === "blue"
          ? "text-blue-200 border-blue-400/25 bg-blue-500/10 hover:bg-blue-500/18"
          : "text-[#00ff41] border-[#00ff41]/25 bg-[#00ff41]/10 hover:bg-[#00ff41]/18";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease }}
      className="rounded-md border border-white/[0.06] bg-[#111111]/60 shadow-[0_10px_24px_rgba(0,0,0,0.18)] p-3 hover:border-white/[0.1] transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="block text-[10px] uppercase tracking-[0.14em] text-[#b0b0b0]/40 font-semibold">{title}</span>
            {orRank && orRank <= 20 && (
              <span className="text-[8px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/15 font-mono">
                #{orRank}
              </span>
            )}
          </div>
          <span className="block mt-1 text-[14px] font-semibold text-[#e0e0e0] truncate">{name}</span>
          <span className="block mt-1 text-[11px] text-[#b0b0b0]/60">{subtitle}</span>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onClick}
          disabled={loading}
          className={`shrink-0 rounded-md px-3 py-2 text-[11px] font-semibold border cursor-pointer disabled:opacity-40 transition-colors ${buttonClass}`}
        >
          {buttonLabel}
        </motion.button>
      </div>
    </motion.div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────────────────

export default function ModelAdvisorPanel({ advisorData, onSwitchModel, loading, open, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease }}
          className="shrink-0 bg-[#0a0a0a] border-l border-white/[0.06] flex flex-col overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.5)]"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0 bg-[#0d0d0d]/80 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <div className="relative">
                <svg className="w-4 h-4 text-[#00ff41]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#00ff41] animate-pulse" />
              </div>
              <span className="text-xs font-semibold text-[#e0e0e0] tracking-wide">Model Advisor</span>
            </div>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              className="text-[#b0b0b0]/60 hover:text-[#e0e0e0] cursor-pointer p-0.5"
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
                <p className="text-[11px] text-[#b0b0b0]/40 leading-relaxed">
                  Send a message to see<br />model recommendations
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
          ? "bg-[#00ff41]/15 border-[#00ff41]/25 text-[#00ff41]"
          : hasData
            ? "bg-[#111111]/80 border-[#1a1a1a]/40 text-[#00ff41] hover:bg-[#111111]"
            : "bg-[#111111]/60 border-[#1a1a1a]/30 text-[#b0b0b0]/40 hover:text-[#b0b0b0] hover:bg-[#111111]/80"
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
        <span className="absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full bg-[#00ff41] animate-pulse" />
      )}
    </motion.button>
  );
}

// ── Content ─────────────────────────────────────────────────────────────────

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
  const [showRadar, setShowRadar] = React.useState(false);

  const taskLabel =
    taskType === "coding" ? "Coding"
    : taskType === "vision" ? "Vision"
    : taskType === "document" ? "Documents"
    : "General chat";

  const intro =
    taskType === "coding"
      ? "Coding task detected — optimized recommendations."
      : taskType === "vision"
        ? "Vision task detected — models ranked for image analysis."
        : taskType === "document"
          ? "Document task detected — context-optimized picks."
          : "Here's the optimal model for your workload.";

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

  const hasAnySource = rankingSources?.huggingFace || rankingSources?.openRouter || rankingSources?.leaderboard;
  const benchmarks = currentModel?.benchmarkDetail?.benchmarks || null;
  const orRank = currentModel?.benchmarkDetail?.orRank || null;

  return (
    <div className="space-y-4">
      {/* Ranking source indicators */}
      <RankingSourceBar sources={rankingSources} />

      {/* Main recommendation */}
      <section className="space-y-2">
        <p className="text-[11px] leading-relaxed text-[#b0b0b0]/60">{intro}</p>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease }}
          className="rounded-lg border border-white/[0.08] bg-gradient-to-br from-[#111111] via-[#0f0f0f] to-[#0a0a0a] shadow-[0_14px_30px_rgba(0,0,0,0.28)] p-4"
          style={{
            backgroundImage: mainRecommendation
              ? "linear-gradient(135deg, rgba(129,140,248,0.03) 0%, transparent 50%, rgba(0,255,65,0.02) 100%)"
              : undefined,
          }}
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-[#00ff41]/80 font-semibold">Best Model</span>
                  {orRank && orRank <= 20 && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/15 font-mono">
                      #{orRank} on OR
                    </span>
                  )}
                </div>
                <h3 className="mt-1 text-lg font-semibold text-white truncate">{mainRecommendation?.name || currentModel.name}</h3>
                <span className="mt-1 block text-[11px] text-[#b0b0b0]/60">{mainRecommendation?.provider || currentModel.provider}</span>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Badge color={mainRecommendation?.cost === "Free" || (!mainRecommendation && currentModel.isFree) ? "emerald" : "saffron"}>
                  {mainRecommendation?.cost || (currentModel.isFree ? "Free" : "Paid")}
                </Badge>
                {currentModel?.confidence && (
                  <ConfidenceMeter confidence={currentModel.confidence} />
                )}
              </div>
            </div>

            {/* Score ring summary */}
            <div className="flex items-center justify-around pt-1">
              <ScoreRing score={currentModel?.scores?.quality || 0} label="Quality" />
              <ScoreRing score={currentModel?.scores?.speed || 0} label="Speed" />
              <ScoreRing score={currentModel?.scores?.cost || 0} label="Value" />
              <ScoreRing score={currentModel?.scores?.reasoning || 0} label="Reason" />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md border border-white/[0.06] bg-[#0d0d0d]/50 px-3 py-2">
                <span className="block text-[#b0b0b0]/40">Cost</span>
                <span className="block mt-1 text-[#e0e0e0] font-medium">{mainRecommendation?.cost || (currentModel.isFree ? "Free" : "Paid")}</span>
              </div>
              <div className="rounded-md border border-white/[0.06] bg-[#0d0d0d]/50 px-3 py-2">
                <span className="block text-[#b0b0b0]/40">Best for</span>
                <span className="block mt-1 text-[#e0e0e0] font-medium">{mainRecommendation?.bestFor || taskLabel}</span>
              </div>
            </div>

            {!currentModel.isFree && estMonthlyCost > 0 && (
              <div className="rounded-md border border-white/[0.06] bg-[#0d0d0d]/50 px-3 py-2 text-[11px] flex items-center justify-between">
                <span className="text-[#b0b0b0]/40">~Monthly est.</span>
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
                className="w-full rounded-md px-4 py-3 text-sm font-semibold text-purple-100 bg-gradient-to-r from-purple-500/20 to-indigo-500/15 border border-purple-400/25 hover:from-purple-500/28 hover:to-indigo-500/22 transition-all cursor-pointer disabled:opacity-40"
              >
                {mainRecommendation.button}
              </motion.button>
            ) : (
              <div className="rounded-md border border-emerald-500/15 bg-emerald-500/8 px-3 py-2 text-[11px] text-emerald-300 flex items-center gap-1.5">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                You're on a strong choice for this task.
              </div>
            )}
          </div>
        </motion.div>
      </section>

      {/* Radar chart toggle */}
      {currentModel?.scores && (
        <section className="space-y-2">
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowRadar((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-[#b0b0b0]/60 hover:text-[#e0e0e0] transition-colors cursor-pointer"
          >
            <svg className={`w-3 h-3 transition-transform ${showRadar ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {showRadar ? "Hide Radar Chart" : "Show Radar Chart"}
          </motion.button>

          <AnimatePresence>
            {showRadar && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease }}
                className="overflow-hidden"
              >
                <div className="rounded-lg border border-white/[0.06] bg-[#0d0d0d]/50 p-3">
                  <RadarChart scores={currentModel.scores} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      {/* Benchmark scores */}
      {benchmarks && (
        <section className="rounded-lg border border-white/[0.06] bg-[#0d0d0d]/50 p-3">
          <BenchmarkBars benchmarks={benchmarks} />
        </section>
      )}

      {/* Alternatives */}
      {finalAlternatives.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider font-semibold">Alternatives</h4>
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

      {/* Current model */}
      <section className="space-y-2">
        <h4 className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider font-semibold">Current Model</h4>
        <div className="rounded-md border border-white/[0.06] bg-[#111111]/55 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[#e0e0e0] truncate">
              Current: <span className="font-semibold text-white">{currentModel.name}</span> ({currentModel.isFree ? "Free" : "Paid"})
            </span>
            {!mainRecommendation && <Badge color="emerald">Current</Badge>}
          </div>
        </div>
      </section>

      {/* Details toggle */}
      <section className="space-y-2">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowDetails((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-[#b0b0b0]/60 hover:text-[#e0e0e0] transition-colors cursor-pointer"
        >
          <svg className={`w-3 h-3 transition-transform ${showDetails ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
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
              <div className="rounded-lg border border-white/[0.06] bg-[#111111]/55 p-3 space-y-2 text-[11px] text-[#b0b0b0]">
                <div className="flex items-center justify-between">
                  <span>Last response cost</span>
                  <span className="text-[#e0e0e0]">{costLabel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Model cost tier</span>
                  <span className="text-[#e0e0e0]">~{costPer1M}/1M tokens</span>
                </div>
                {monthlyBudget > 0 && budgetEstMonthly != null && (
                  <div className="flex items-center justify-between">
                    <span>Budget estimate</span>
                    <span className={`${budgetEstMonthly > monthlyBudget ? "text-red-400" : "text-emerald-300"}`}>
                      ~${budgetEstMonthly < 0.01 ? budgetEstMonthly.toFixed(4) : budgetEstMonthly.toFixed(2)}/mo
                    </span>
                  </div>
                )}

                {/* Data source badges */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {rankingSources?.leaderboard && <Badge color="emerald">HF Leaderboard</Badge>}
                  {rankingSources?.huggingFace && <Badge color="purple">HF Popularity</Badge>}
                  {rankingSources?.openRouter && <Badge color="blue">OR Model Data</Badge>}
                  {rankingSources?.freshness === "live" && <Badge color="saffron">Live Data</Badge>}
                  {rankingSources?.freshness === "cached" && <Badge color="amber">Cached Data</Badge>}
                  {rankingSources?.freshness === "fallback" && <Badge color="rose">Fallback Priors</Badge>}
                  {featureSignals?.webSearchUsed && <Badge color="blue">Web-aware ({featureSignals.webSearchMode})</Badge>}
                  {!featureSignals?.webSearchUsed && featureSignals?.explicitWebIntent && <Badge color="blue">Web-intent prompt</Badge>}
                  {featureSignals?.terminalIntent && <Badge color="purple">Terminal intent</Badge>}
                  {featureSignals?.reasoningDepth === "deep" && <Badge color="saffron">Deep reasoning</Badge>}
                  {featureSignals?.reasoningDepth === "fast" && <Badge color="emerald">Fast reasoning</Badge>}
                  <Badge color={isCodingTask ? "purple" : taskType === "vision" ? "blue" : "saffron"}>{taskLabel}</Badge>
                </div>

                {providerPicks?.length > 0 && (
                  <div className="pt-2 space-y-1.5">
                    <span className="block text-[#b0b0b0]/40">Best by provider</span>
                    {providerPicks.slice(0, 4).map((pick) => (
                      <div key={pick.id} className="flex items-center justify-between gap-3">
                        <span className="truncate">{pick.provider}: {pick.name}</span>
                        <span className="text-[#e0e0e0] shrink-0">{pick.isFree ? "Free" : pick.costLabel}</span>
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
