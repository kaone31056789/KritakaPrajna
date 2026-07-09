import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useStore } from "../../core/store";
import { modelsStore, selectModel, modelDisplayName, isFreeModel, formatPrice, contextLabel } from "../../core/models";
import { advisorStore, refreshSignals, rankModels, PRIORITY_OPTIONS } from "../../core/advisor";
import { settingsStore, setSetting } from "../../core/settings";
import { providerLabel } from "../../api/providerRouter";
import { setView } from "../../core/nav";
import { EASE_OUT } from "../../design/motion";
import Icon from "../../ui/icons";
import { Segmented, GradientOrb, NeuBadge, NeuButton, SectionLabel, Spinner, EmptyState } from "../../ui/primitives";
import { toast } from "../../ui/Toaster";

const TASK_OPTIONS = [
  { value: "general", label: "General", icon: "chat" },
  { value: "coding", label: "Coding", icon: "code" },
  { value: "reasoning", label: "Reasoning", icon: "brain" },
  { value: "vision", label: "Vision", icon: "eye" },
  { value: "text-to-image", label: "Images", icon: "image" },
];

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
  const { model, score, parts, live } = entry;
  const medal = rank === 0 ? "gold" : rank === 1 ? "silver" : rank === 2 ? "bronze" : null;

  return (
    <motion.div
      variants={{
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } },
      }}
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
        <GradientOrb seed={model._selectionId} size={34} glow={rank === 0} />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-[14.5px] text-hi truncate">{modelDisplayName(model)}</p>
          <p className="text-[10.5px] text-faint">{providerLabel(model._provider)}</p>
        </div>
        <div className="text-right">
          <p className="font-display font-bold text-[22px] leading-none text-accent">{score}</p>
          <p className="text-[9px] uppercase tracking-[0.14em] text-faint mt-0.5">score</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <ScoreBar label="Ability" value={parts.cap} />
        <ScoreBar label="Price" value={parts.price} />
        <ScoreBar label="Speed" value={parts.speed} />
        <ScoreBar label="Uptime" value={parts.rel} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {isFreeModel(model) ? (
          <NeuBadge tone="ok">free</NeuBadge>
        ) : (
          <NeuBadge>{formatPrice(model.pricing?.prompt)}</NeuBadge>
        )}
        {contextLabel(model) && <NeuBadge tone="info">{contextLabel(model)}</NeuBadge>}
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

export default function AdvisorScreen() {
  const { models, selectedId } = useStore(modelsStore, (s) => ({ models: s.models, selectedId: s.selectedId }));
  const { signals, signalsLoading } = useStore(advisorStore);
  const { advisorPrefs } = useStore(settingsStore, (s) => ({ advisorPrefs: s.advisorPrefs }));
  const [task, setTask] = useState("general");
  const priority = advisorPrefs?.priority || "balanced";

  useEffect(() => {
    if (models.length > 0 && !signals && !signalsLoading) refreshSignals(models);
  }, [models, signals, signalsLoading]);

  const ranked = useMemo(
    () => rankModels(models, { task, priority, limit: 9 }),
    [models, task, priority, signals]
  );

  const liveActive = !!(signals?.sources?.hf || signals?.sources?.or || signals?.sources?.leaderboard);

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
              Offline heuristics always work; live popularity signals add a small boost when available.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            {signalsLoading ? (
              <span className="flex items-center gap-1.5 text-dim"><Spinner size={11} /> fetching live signals…</span>
            ) : (
              <span className={`flex items-center gap-1.5 ${liveActive ? "text-ok" : "text-faint"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${liveActive ? "bg-ok" : "bg-faint"}`} />
                {liveActive ? "Live signals active" : "Offline mode"}
              </span>
            )}
            <button
              type="button"
              onClick={() => refreshSignals(models)}
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
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
          initial="initial"
          animate="animate"
          variants={{ animate: { transition: { staggerChildren: 0.05 } } }}
        >
          {ranked.map((entry, i) => (
            <RankCard
              key={entry.model._selectionId}
              entry={entry}
              rank={i}
              selected={entry.model._selectionId === selectedId}
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}
