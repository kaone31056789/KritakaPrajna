import React, { useEffect, useMemo, useState, useId } from "react";
import { motion, animate } from "framer-motion";
import { useStore } from "../../core/store";
import { modelsStore, selectModel, modelDisplayName, isFreeModel, formatPrice, contextLabel } from "../../core/models";
import { advisorStore, refreshSignals, rankModels, PRIORITY_OPTIONS } from "../../core/advisor";
import { settingsStore, setSetting } from "../../core/settings";
import { providerLabel } from "../../api/providerRouter";
import { setView } from "../../core/nav";
import { EASE_OUT } from "../../design/motion";
import Icon from "../../ui/icons";
import { Segmented, NeuBadge, NeuButton, SectionLabel, Spinner, EmptyState } from "../../ui/primitives";
import { toast } from "../../ui/Toaster";
import BrandIcon from "../../ui/BrandIcon";
import { rankingsStore, refreshRankings, initRankings, formatTokens, timeAgo } from "../../core/rankings";

const TASK_OPTIONS = [
  { value: "general", label: "General", icon: "chat" },
  { value: "coding", label: "Coding", icon: "code" },
  { value: "reasoning", label: "Reasoning", icon: "brain" },
  { value: "vision", label: "Vision", icon: "eye" },
  { value: "text-to-image", label: "Images", icon: "image" },
];

/** Animated number that counts up from 0 to `value`. */
function CountUp({ value, duration = 0.9, delay = 0, className }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(0, value, {
      duration,
      delay,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, duration, delay]);

  return <span className={className}>{display}</span>;
}

/** Circular score gauge with gradient sweep + count-up center. */
function RingGauge({ score, size = 76, stroke = 7, glow = false, delay = 0 }) {
  const gid = useId().replace(/:/g, "");
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 block">
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(127,127,127,0.16)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.9, ease: EASE_OUT, delay }}
          style={glow ? { filter: "drop-shadow(0 0 6px var(--accent-glow))" } : undefined}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <CountUp
          value={score}
          delay={delay}
          className={`font-display font-bold leading-none text-hi ${size >= 90 ? "text-[24px]" : "text-[19px]"}`}
        />
        <span className="text-[8.5px] uppercase tracking-[0.14em] text-faint mt-0.5">score</span>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9.5px] uppercase tracking-[0.12em] text-faint w-[52px]">{label}</span>
      <div className="flex-1 h-[5px] rounded-full bg-deep [box-shadow:var(--neu-inset-sm)] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        />
      </div>
      <span className="text-[10px] font-mono text-dim w-6 text-right">{value}</span>
    </div>
  );
}

function RankCard({ entry, rank, selected }) {
  const { model, score, parts, live, rankInfo } = entry;
  const medal = rank === 0 ? "gold" : rank === 1 ? "silver" : rank === 2 ? "bronze" : null;

  return (
    <motion.div
      variants={{
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } },
      }}
      whileHover={{ y: -4, transition: { duration: 0.18, ease: EASE_OUT } }}
      className={`neu-raised rounded-lg p-5 flex flex-col gap-3.5 relative ${
        selected ? "[box-shadow:var(--neu-raised),0_0_0_1.5px_var(--accent)]" : ""
      }`}
    >
      {medal && (
        <span
          className={`absolute -top-2.5 left-5 px-2.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-[0.14em] ${
            medal === "gold"
              ? "text-accent-ink"
              : "bg-surface-3 text-dim [box-shadow:var(--neu-raised-sm)]"
          }`}
          style={
            medal === "gold"
              ? { background: "linear-gradient(135deg, var(--accent), var(--accent-2))", boxShadow: "0 2px 10px var(--accent-glow)" }
              : undefined
          }
        >
          #{rank + 1}{medal === "gold" ? " · Top pick" : ""}
        </span>
      )}

      <div className="flex items-center gap-3 pt-1">
        <BrandIcon model={model} seed={model._selectionId} size={34} glow={rank === 0} />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-[14.5px] text-hi truncate">{modelDisplayName(model)}</p>
          <p className="text-[10.5px] text-faint">{providerLabel(model._provider)}</p>
        </div>
        <div className="text-right">
          <p className="font-display font-bold text-[22px] leading-none text-accent">
            <CountUp value={score} />
          </p>
          <p className="text-[9px] uppercase tracking-[0.14em] text-faint mt-0.5">score</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <ScoreBar label="Ability" value={parts.cap} />
        <ScoreBar label="Price" value={parts.price} />
        <ScoreBar label="Speed" value={parts.speed} />
        <ScoreBar label="Uptime" value={parts.rel} />
        {parts.usage != null && <ScoreBar label="Usage" value={parts.usage} />}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {isFreeModel(model) ? (
          <NeuBadge tone="ok">free</NeuBadge>
        ) : (
          <NeuBadge>{formatPrice(model.pricing?.prompt)}</NeuBadge>
        )}
        {contextLabel(model) && <NeuBadge tone="info">{contextLabel(model)}</NeuBadge>}
        {rankInfo && <NeuBadge tone="accent">#{rankInfo.rank} this week</NeuBadge>}
        {rankInfo && <NeuBadge>{formatTokens(rankInfo.tokens)} tok/day</NeuBadge>}
        {rankInfo?.trendPct != null && rankInfo.trendPct !== 0 && (
          <NeuBadge tone={rankInfo.trendPct > 0 ? "ok" : undefined}>
            {rankInfo.trendPct > 0 ? "▲" : "▼"} {Math.abs(rankInfo.trendPct)}%
          </NeuBadge>
        )}
        {live > 0 && <NeuBadge tone="accent">+{live} live</NeuBadge>}
        <div className="flex-1" />
        <NeuButton
          size="sm"
          variant={selected ? "raised" : "accent"}
          icon={selected ? "check" : "zap"}
          onClick={() => {
            selectModel(model._selectionId);
            toast.success(`Switched to ${modelDisplayName(model)}`);
            setView("chat");
          }}
        >
          {selected ? "Selected" : "Use model"}
        </NeuButton>
      </div>
    </motion.div>
  );
}

const MEDAL_META = [
  { label: "Top pick", style: { background: "linear-gradient(135deg, var(--accent), var(--accent-2))", boxShadow: "0 2px 10px var(--accent-glow)" }, ink: "text-accent-ink" },
  { label: "Runner-up", style: { background: "linear-gradient(135deg, #b9c0cc, #8f97a6)", color: "#16171b" }, ink: "" },
  { label: "Third", style: { background: "linear-gradient(135deg, #d1996a, #a5713f)", color: "#16171b" }, ink: "" },
];

/** Large podium card for the top-3 ranked models. */
function PodiumCard({ entry, rank, selected }) {
  const { model, score, parts, live, rankInfo } = entry;
  const isWinner = rank === 0;
  const medal = MEDAL_META[rank];

  return (
    <motion.div
      variants={{
        initial: { opacity: 0, y: 18, scale: 0.97 },
        animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: EASE_OUT } },
      }}
      whileHover={{ y: -5, transition: { duration: 0.18, ease: EASE_OUT } }}
      className={`neu-raised rounded-lg p-5 flex flex-col items-center gap-3.5 relative ${
        isWinner ? "md:order-2 md:-mt-2" : rank === 1 ? "md:order-1" : "md:order-3"
      } ${selected ? "[box-shadow:var(--neu-raised),0_0_0_1.5px_var(--accent)]" : ""}`}
    >
      <span
        className={`absolute -top-2.5 px-2.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-[0.14em] ${medal.ink}`}
        style={medal.style}
      >
        #{rank + 1} · {medal.label}
      </span>

      <RingGauge
        score={score}
        size={isWinner ? 96 : 78}
        stroke={isWinner ? 8 : 7}
        glow={isWinner}
        delay={0.1 + rank * 0.12}
      />

      <div className="flex items-center gap-2.5 min-w-0 max-w-full">
        <BrandIcon model={model} seed={model._selectionId} size={26} glow={isWinner} />
        <div className="min-w-0 text-left">
          <p className="font-display font-semibold text-[13.5px] text-hi truncate">{modelDisplayName(model)}</p>
          <p className="text-[10px] text-faint">{providerLabel(model._provider)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 w-full">
        <ScoreBar label="Ability" value={parts.cap} />
        <ScoreBar label="Price" value={parts.price} />
        <ScoreBar label="Speed" value={parts.speed} />
        <ScoreBar label="Uptime" value={parts.rel} />
      </div>

      <div className="flex items-center justify-center gap-1.5 flex-wrap">
        {isFreeModel(model) ? (
          <NeuBadge tone="ok">free</NeuBadge>
        ) : (
          <NeuBadge>{formatPrice(model.pricing?.prompt)}</NeuBadge>
        )}
        {contextLabel(model) && <NeuBadge tone="info">{contextLabel(model)}</NeuBadge>}
        {rankInfo && <NeuBadge tone="accent">#{rankInfo.rank} this week</NeuBadge>}
        {live > 0 && <NeuBadge tone="accent">+{live} live</NeuBadge>}
      </div>

      <NeuButton
        size="sm"
        variant={selected ? "raised" : "accent"}
        icon={selected ? "check" : "zap"}
        className="w-full justify-center"
        onClick={() => {
          selectModel(model._selectionId);
          toast.success(`Switched to ${modelDisplayName(model)}`);
          setView("chat");
        }}
      >
        {selected ? "Selected" : "Use model"}
      </NeuButton>
    </motion.div>
  );
}

export default function AdvisorScreen() {
  const { models, selectedId } = useStore(modelsStore, (s) => ({ models: s.models, selectedId: s.selectedId }));
  const { signals, signalsLoading } = useStore(advisorStore);
  const { advisorPrefs } = useStore(settingsStore, (s) => ({ advisorPrefs: s.advisorPrefs }));
  const rankings = useStore(rankingsStore, (s) => ({
    updatedAt: s.updatedAt,
    loading: s.loading,
    count: s.items.length,
  }));
  const [task, setTask] = useState("general");
  const priority = advisorPrefs?.priority || "balanced";

  useEffect(() => {
    initRankings();
  }, []);

  useEffect(() => {
    if (models.length > 0 && !signals && !signalsLoading) refreshSignals(models);
  }, [models, signals, signalsLoading]);

  const ranked = useMemo(
    () => rankModels(models, { task, priority, limit: 9 }),
    [models, task, priority, signals, rankings.updatedAt]
  );

  const liveActive = !!(signals?.sources?.hf || signals?.sources?.or || signals?.sources?.leaderboard);

  // Podium needs a full top-3; otherwise fall back to the plain grid.
  const podium = ranked.length >= 3 ? ranked.slice(0, 3) : [];
  const rest = ranked.length >= 3 ? ranked.slice(3) : ranked;

  if (models.length === 0) {
    return <EmptyState icon="advisor" title="No models loaded" hint="Connect a provider in Settings to get recommendations." className="h-full" />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1060px] mx-auto px-8 py-8">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-7">
          <div>
            <SectionLabel>Model Advisor</SectionLabel>
            <h1 className="font-display font-bold text-[24px] text-hi mt-1">
              Best model for the job
            </h1>
            <p className="text-[12.5px] text-dim mt-1">
              Offline heuristics blended with live OpenRouter usage rankings when available.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            {signalsLoading || rankings.loading ? (
              <span className="flex items-center gap-1.5 text-dim"><Spinner size={11} /> updating live signals…</span>
            ) : rankings.count > 0 ? (
              <span className="flex items-center gap-1.5 text-ok">
                <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                Live rankings · updated {timeAgo(rankings.updatedAt)}
              </span>
            ) : (
              <span className={`flex items-center gap-1.5 ${liveActive ? "text-ok" : "text-faint"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${liveActive ? "bg-ok" : "bg-faint"}`} />
                {liveActive ? "Live signals active" : "Offline mode"}
              </span>
            )}
            <button
              type="button"
              onClick={() => { refreshSignals(models); refreshRankings(true); }}
              className="pressable w-7 h-7 rounded-xs flex items-center justify-center text-dim hover:text-hi"
              aria-label="Refresh live signals"
            >
              <Icon name="refresh" size={13} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap mb-7">
          <Segmented value={task} onChange={setTask} options={TASK_OPTIONS} />
          <div className="flex-1" />
          <Segmented
            value={priority}
            onChange={(v) => setSetting("advisorPrefs", { ...advisorPrefs, priority: v })}
            options={PRIORITY_OPTIONS}
            size="sm"
          />
        </div>

        <motion.div
          key={`${task}-${priority}`}
          initial="initial"
          animate="animate"
          variants={{ animate: { transition: { staggerChildren: 0.06 } } }}
        >
          {podium.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:items-end mb-8">
              {podium.map((entry, i) => (
                <PodiumCard
                  key={entry.model._selectionId}
                  entry={entry}
                  rank={i}
                  selected={entry.model._selectionId === selectedId}
                />
              ))}
            </div>
          )}

          {rest.length > 0 && (
            <>
              {podium.length > 0 && (
                <div className="mb-3">
                  <SectionLabel>More contenders</SectionLabel>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {rest.map((entry, i) => (
                  <RankCard
                    key={entry.model._selectionId}
                    entry={entry}
                    rank={i + podium.length}
                    selected={entry.model._selectionId === selectedId}
                  />
                ))}
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
