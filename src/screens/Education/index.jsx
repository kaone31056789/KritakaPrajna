import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useStore } from "../../core/store";
import {
  educationStore,
  addSource,
  removeSource,
  clearSources,
  togglePastPaper,
  setPaperFormat,
  researchTopic,
  candidatesFor,
  setTier,
  generateSet,
  removeSet,
  openSet,
  dismissError,
  stopRun,
  paperQuestions,
  dueIndexes,
  setRetention,
  setRecallMode,
  RECALL_MODES,
  resetEduSpend,
  formatTokens,
  formatSpend,
  KIND_LABEL,
  JOBS,
  TIERS,
} from "../../core/education";
import { modelsStore } from "../../core/models";
import { keysStore } from "../../core/keys";
import { setView } from "../../core/nav";
import { EASE_OUT, T } from "../../design/motion";
import Icon from "../../ui/icons";
import {
  NeuButton,
  IconButton,
  SectionLabel,
  EmptyState,
  NeuBadge,
  NeuTooltip,
  Segmented,
  Spinner,
} from "../../ui/primitives";
import { toast } from "../../ui/Toaster";
import { CountUp, ShinyText } from "../../ui/textfx";
import { Flashcards, Quiz, PaperAttempt } from "./Study";
import Dashboard from "./Dashboard";

/* ═══ Education Hub — notes in, study material out ═══ */

const KIND_OPTIONS = [
  { value: "flashcards", label: "Flashcards", icon: "layers" },
  { value: "quiz", label: "Quiz", icon: "check" },
  { value: "paper", label: "Exam paper", icon: "clock" },
];

const DIFFICULTY_OPTIONS = [
  { value: "recall", label: "Recall" },
  { value: "exam", label: "Exam level" },
  { value: "stretch", label: "Stretch" },
];

const SOURCE_ICON = { slides: "layers", pdf: "file", scan: "image", notes: "file" };

/* ─── Tier ───
   No model list. You pick a budget and the hub routes each job — writing,
   reading handwriting, marking — to whichever model suits it, newest first,
   with a fallback chain behind each one. */

function TierToggle() {
  const { tier } = useStore(educationStore, (s) => ({ tier: s.tier }));
  useStore(modelsStore, (s) => ({ n: (s.models || []).length })); // recompute as models load

  // Cheap enough to recompute on render, and always current as models load.
  const chains = {
    author: candidatesFor("author", tier),
    mark: candidatesFor("mark", tier),
    read: candidatesFor("read", tier),
  };
  const depth = Math.max(chains.author.length, chains.mark.length);
  const meta = TIERS.find((t) => t.id === tier);

  return (
    <NeuTooltip
      label={
        depth === 0
          ? `Nothing available in ${meta?.label || tier}`
          : `${meta?.hint} — ` +
            Object.entries(chains)
              .filter(([, c]) => c.length)
              .map(
                ([job, c]) =>
                  `${JOBS[job].label}: ${c[0].name || c[0].id}${c[0]._pinned ? " (your pick)" : ""} (+${
                    c.length - 1
                  } backup)`
              )
              .join(" · ") + " · change these in Settings → Study Routing"
      }
    >
      <div className="flex items-center gap-2">
        <Segmented
          size="sm"
          value={tier}
          onChange={setTier}
          options={TIERS.map((t) => ({ value: t.id, label: t.label }))}
        />
        <NeuBadge tone={depth === 0 ? "err" : depth >= 3 ? "ok" : "info"}>
          {depth === 0 ? "none" : `${depth} deep`}
        </NeuBadge>
      </div>
    </NeuTooltip>
  );
}

/* ─── Who actually did the work ─── */

function RouteLine() {
  const { route } = useStore(educationStore, (s) => ({ route: s.route }));
  const parts = Object.entries(route || {}).filter(([, v]) => v);
  if (parts.length === 0) return null;
  const verb = { author: "written by", mark: "marked by", read: "read by" };
  return (
    <p className="text-[11px] text-faint flex items-center gap-1.5 flex-wrap">
      <Icon name="layers" size={11} className="shrink-0" />
      {parts.map(([job, name], i) => (
        <span key={job}>
          {i > 0 && <span className="mx-1 text-line">·</span>}
          {verb[job] || job} <span className="text-dim">{name}</span>
        </span>
      ))}
    </p>
  );
}

/* ─── Retention ───
   FSRS solves the interval from a target recall probability, so this is a real
   dial rather than a preference: raise it and every card comes back sooner. */

const RETENTION_STOPS = [
  { v: 0.85, label: "Relaxed", note: "longest gaps, most forgetting" },
  { v: 0.9, label: "Normal", note: "the FSRS default" },
  { v: 0.95, label: "Exam week", note: "short gaps, heavy load" },
];

function RetentionDial() {
  const { retention, recallMode, sets } = useStore(educationStore, (s) => ({
    retention: s.retention,
    recallMode: s.recallMode,
    sets: s.sets,
  }));
  const decks = sets.filter((s) => s.kind === "flashcards");
  if (decks.length === 0) return null;
  const due = decks.reduce((n, s) => n + dueIndexes(s).length, 0);

  return (
    <div className="flex items-center gap-2">
      <NeuTooltip label={RECALL_MODES.find((m) => m.id === recallMode)?.hint || ""}>
        <Segmented
          size="sm"
          value={recallMode}
          onChange={setRecallMode}
          options={RECALL_MODES.map((m) => ({ value: m.id, label: m.label }))}
        />
      </NeuTooltip>
      <NeuTooltip label={`Target recall probability — ${due} card${due === 1 ? "" : "s"} due right now`}>
        <div className="flex items-center gap-2">
          <Segmented
            size="sm"
            value={String(retention)}
            onChange={(v) => setRetention(Number(v))}
            options={RETENTION_STOPS.map((r) => ({ value: String(r.v), label: r.label }))}
          />
          <NeuBadge tone={due > 0 ? "accent" : "neutral"}>{due} due</NeuBadge>
        </div>
      </NeuTooltip>
    </div>
  );
}

/* ─── Spend meter ─── */

function SpendMeter() {
  const { spend } = useStore(educationStore, (s) => ({ spend: s.spend }));
  if (!spend || spend.runs === 0) return null;
  const total = spend.inTokens + spend.outTokens;

  return (
    <NeuTooltip
      label={`${formatTokens(spend.inTokens)} in · ${formatTokens(spend.outTokens)} out · ${spend.runs} call${
        spend.runs === 1 ? "" : "s"
      } — click to reset`}
    >
      <button
        type="button"
        onClick={() => {
          resetEduSpend();
          toast.success("Hub meter reset");
        }}
        className="neu-raised-sm rounded-lg px-3 h-9 flex items-center gap-2 text-[11.5px] text-dim hover:text-hi transition-colors"
      >
        <Icon name="gauge" size={13} className="text-accent" />
        {/* Ticks up as passes land, so the meter reads as live rather than jumping. */}
        <span className="tabular-nums">
          <CountUp to={total} duration={0.8} /> tokens
        </span>
        <span className="text-faint">·</span>
        <span className={`tabular-nums ${spend.cost > 0 ? "text-hi" : "text-ok"}`}>{formatSpend(spend.cost)}</span>
      </button>
    </NeuTooltip>
  );
}

/* ─── History sidebar ─── */

function HistorySidebar() {
  const { sets, activeSetId } = useStore(educationStore, (s) => ({
    sets: s.sets,
    activeSetId: s.activeSetId,
  }));
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sets;
    return sets.filter((s) => `${s.title} ${KIND_LABEL[s.kind]} ${s.modelName}`.toLowerCase().includes(needle));
  }, [sets, q]);

  const sizeOf = (s) =>
    s.kind === "flashcards"
      ? `${(s.payload?.cards || []).length} cards`
      : s.kind === "quiz"
      ? `${(s.payload?.questions || []).length} questions`
      : `${paperQuestions(s).length} questions`;

  return (
    <aside className="w-[250px] shrink-0 h-full flex flex-col border-r border-line">
      <div className="shrink-0 px-3.5 pt-4 pb-3">
        <NeuButton icon="plus" className="w-full" onClick={() => openSet(null)}>
          New material
        </NeuButton>
      </div>

      {sets.length > 3 && (
        <div className="shrink-0 px-3.5 pb-2.5 relative">
          <Icon name="search" size={12} className="absolute left-6 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search saved…"
            className="w-full h-8 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[12px] text-hi placeholder:text-faint pl-8 pr-3 focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)]"
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-4">
        {sets.length === 0 ? (
          <p className="text-[11.5px] text-faint px-2 py-6 text-center leading-relaxed">
            Everything you generate is saved here.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-[11.5px] text-faint px-2 py-6 text-center">Nothing matches “{q}”.</p>
        ) : (
          // Grid items default to min-width:auto, which lets a long title push the
          // delete button off the rail — hence minmax(0,1fr) and min-w-0 below.
          <ul className="grid gap-1 [grid-template-columns:minmax(0,1fr)]">
            <AnimatePresence initial={false}>
              {shown.map((s) => {
                const active = s.id === activeSetId;
                return (
                  <motion.li
                    key={s.id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: T, ease: EASE_OUT }}
                    className="min-w-0"
                  >
                    <div
                      className={`group flex items-start gap-2 px-2.5 py-2 rounded-lg min-w-0 ${
                        active ? "bg-deep [box-shadow:var(--neu-inset-sm)]" : "hover:bg-surface-2"
                      }`}
                    >
                      <Icon
                        name={s.kind === "paper" ? "clock" : s.kind === "quiz" ? "check" : "layers"}
                        size={13}
                        className={`shrink-0 mt-0.5 ${active ? "text-accent" : "text-faint"}`}
                      />
                      <button type="button" onClick={() => openSet(s.id)} className="flex-1 min-w-0 text-left">
                        <span className={`block text-[12px] font-medium truncate ${active ? "text-accent" : "text-body"}`}>
                          {s.title}
                        </span>
                        <span className="block text-[10px] text-faint truncate">
                          {sizeOf(s)}
                          {s.spent ? ` · ${formatSpend(s.spent.cost)}` : ""}
                        </span>
                        {s.kind === "flashcards" && dueIndexes(s).length > 0 && (
                          <span className="inline-block mt-1 text-[9.5px] font-semibold tracking-wide text-accent">
                            {dueIndexes(s).length} due
                          </span>
                        )}
                      </button>
                      <IconButton
                        name="trash"
                        size={12}
                        className="shrink-0 opacity-40 group-hover:opacity-100"
                        onClick={() => removeSet(s.id)}
                        label={`Delete ${s.title}`}
                      />
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </aside>
  );
}

/* ─── Material ─── */

function Material() {
  const { sources, busy, phase } = useStore(educationStore, (s) => ({
    sources: s.sources,
    busy: s.busy,
    phase: s.phase,
  }));
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const take = async (files) => {
    for (const f of Array.from(files || [])) {
      const added = await addSource(f);
      if (added) toast.success(`Read ${added.name}`);
    }
  };

  return (
    <section className="neu-raised rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <SectionLabel>Material</SectionLabel>
        <div className="flex items-center gap-2">
          {sources.length > 0 && (
            <>
              <span className="text-[11px] text-faint tabular-nums">
                {sources.reduce((n, s) => n + s.chars, 0).toLocaleString()} characters
              </span>
              <NeuTooltip label="Remove all material">
                <IconButton
                  name="trash"
                  size={13}
                  onClick={() => {
                    clearSources();
                    toast.success("Material cleared");
                  }}
                  label="Remove all material"
                />
              </NeuTooltip>
            </>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".pdf,.pptx,.ppt,.docx,.doc,.txt,.md,.csv,image/*"
        className="hidden"
        onChange={(e) => { take(e.target.files); e.target.value = ""; }}
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); take(e.dataTransfer.files); }}
        className={`w-full rounded-lg px-5 py-6 text-center transition-colors ${
          dragOver ? "bg-accent-soft [box-shadow:var(--neu-inset-sm)]" : "bg-deep [box-shadow:var(--neu-inset-sm)]"
        }`}
      >
        {busy && phase === "reading" ? (
          <span className="flex items-center justify-center gap-2 text-[13px] text-dim">
            <Spinner size={13} /> Reading…
          </span>
        ) : (
          <>
            <Icon name="paperclip" size={18} className="text-accent mx-auto" />
            <p className="text-[13px] text-body mt-2">Drop notes, lecture slides or a past paper</p>
            <p className="text-[11.5px] text-faint mt-1">
              PDF, PowerPoint, Word, text — or a photo of a page, which gets read by OCR
            </p>
          </>
        )}
      </button>

      {sources.length > 0 && (
        <ul className="mt-3 grid gap-1.5">
          <AnimatePresence initial={false}>
            {sources.map((s) => (
              <motion.li
                key={s.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: T, ease: EASE_OUT }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-deep [box-shadow:var(--neu-inset-sm)]"
              >
                <Icon name={SOURCE_ICON[s.kind] || "file"} size={14} className="text-dim shrink-0" />
                <span className="flex-1 min-w-0 text-[12.5px] text-body truncate">{s.name}</span>
                <NeuTooltip
                  label={
                    s.isPastPaper
                      ? "Treated as a past paper — its format shapes generated exams. Click to undo."
                      : "Mark as a past paper so exams copy its format"
                  }
                >
                  <button
                    type="button"
                    onClick={() => togglePastPaper(s.id)}
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide transition-colors ${
                      s.isPastPaper ? "bg-accent-soft text-accent" : "text-faint hover:text-dim"
                    }`}
                  >
                    past paper
                  </button>
                </NeuTooltip>
                {s.readBy && <NeuBadge tone={s.readBy === "vision model" ? "ok" : "neutral"}>{s.readBy}</NeuBadge>}
                <span className="text-[10.5px] text-faint tabular-nums shrink-0">
                  {(s.chars / 1000).toFixed(1)}k
                </span>
                <IconButton name="close" size={12} onClick={() => removeSource(s.id)} label={`Remove ${s.name}`} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

/* ─── Working panel ───
   A two-pass read over a long document takes real time. Without a live
   elapsed count and a moving bar it reads as frozen, so this shows what pass
   it is on, which model is answering, and that the clock is still running. */

function WorkingPanel() {
  const { progress } = useStore(educationStore, (s) => ({ progress: s.progress }));
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!progress) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [progress]);

  if (!progress) return null;

  const elapsed = Math.max(0, Math.round((now - (progress.startedAt || now)) / 1000));
  const determinate = progress.total > 1 && progress.step > 0;
  const pct = determinate ? Math.min(100, (progress.step / progress.total) * 100) : 0;

  return (
    <div className="mt-4 rounded-lg bg-deep [box-shadow:var(--neu-inset-sm)] px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <span className="text-[12.5px] font-medium min-w-0 truncate">
          <ShinyText speed={2.6}>{progress.label || "Working"}</ShinyText>
        </span>
        <span className="flex items-center gap-2.5 shrink-0">
          <span className="text-[11px] text-faint tabular-nums">
            {determinate && `pass ${progress.step}/${progress.total} · `}
            {elapsed}s
          </span>
          {/* Cancels the in-flight requests, not just the progress bar — a long
              free-tier read is minutes of billable calls to walk away from. */}
          <NeuButton size="sm" variant="ghost" icon="stop" onClick={stopRun} title="Stop this run">
            Stop
          </NeuButton>
        </span>
      </div>

      {/* A determinate bar only moves when a pass lands, which on a long free-tier
          read can be minutes apart — so it always carries a travelling sheen on
          top, and the completed portion never sits perfectly still. */}
      <div className="relative h-1.5 rounded-full bg-surface-2 overflow-hidden">
        {determinate && (
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
          />
        )}
        {!reduced && (
          <motion.div
            className="absolute inset-y-0 w-1/3 rounded-full"
            style={{ background: "linear-gradient(90deg, transparent, var(--accent), transparent)" }}
            animate={{ x: ["-110%", "330%"] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "linear" }}
          />
        )}
        {reduced && !determinate && <div className="h-full w-1/3 rounded-full bg-accent" />}
      </div>

      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        {progress.parallel > 1 && (
          <NeuBadge tone="accent">{progress.parallel} models in parallel</NeuBadge>
        )}
        {progress.model && (
          <span className="text-[10.5px] text-faint min-w-0 truncate">
            {progress.retrying ? "retrying on " : ""}
            <span className="text-dim">{progress.model}</span>
            {progress.of > 1 && progress.attempt > 1 && ` (${progress.attempt} of ${progress.of})`}
          </span>
        )}
        {progress.found > 0 && (
          <NeuBadge tone="ok">
            {progress.found} topic{progress.found === 1 ? "" : "s"} found
          </NeuBadge>
        )}
        {progress.failedPasses > 0 && (
          <NeuBadge tone="info">
            {progress.failedPasses} pass{progress.failedPasses === 1 ? "" : "es"} skipped
          </NeuBadge>
        )}
      </div>

      {elapsed > 40 && (
        <p className="mt-2.5 text-[11px] text-dim leading-relaxed border-t border-line pt-2.5">
          <span className="text-accent font-medium">This is normal.</span> Free models are slow and
          heavily rate-limited — a long document can take several minutes. Every pass that lands is
          cached, so generating again from the same notes is near-instant. Paid or Paid+ finishes this
          in a fraction of the time.
        </p>
      )}
    </div>
  );
}

/* ─── Topic ───
   No notes needed: name a topic, the hub researches it on the web and turns
   the result into material you can generate from. */

function Topic() {
  const { busy, phase } = useStore(educationStore, (s) => ({ busy: s.busy, phase: s.phase }));
  const [topic, setTopic] = useState("");

  const run = async () => {
    const q = topic.trim();
    if (!q || busy) return;
    const added = await researchTopic(q);
    if (added) {
      setTopic("");
      toast.success(
        added.sourceCount
          ? `Researched “${added.name}” — ${added.sourceCount} source${added.sourceCount === 1 ? "" : "s"}`
          : `Added “${added.name}” — the web was unreachable, so the model will use its own knowledge`
      );
    }
  };

  return (
    <section className="neu-raised rounded-xl p-5">
      <SectionLabel className="mb-3">Or study a topic</SectionLabel>
      <div className="flex gap-2.5 items-stretch">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder="e.g. Kirchhoff's laws, Mughal administration, binary search trees…"
          className="flex-1 min-w-0 h-10 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[13.5px] text-hi placeholder:text-faint px-3.5 focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)]"
        />
        <NeuButton
          icon="globe"
          onClick={run}
          disabled={!topic.trim() || busy}
          loading={busy && phase === "researching"}
          className="shrink-0"
        >
          {busy && phase === "researching" ? "Researching…" : "Research"}
        </NeuButton>
      </div>
      <p className="text-[11.5px] text-faint mt-2 leading-relaxed">
        Searches the web, reads what it finds, and adds it above as material. Works alongside your own
        notes — research a topic your slides skipped and both get used.
      </p>
    </section>
  );
}

/* ─── Make ─── */

function Make() {
  const { sources, busy, phase, paperFormat } = useStore(educationStore, (s) => ({
    sources: s.sources,
    busy: s.busy,
    phase: s.phase,
    paperFormat: s.paperFormat,
  }));
  const [kind, setKind] = useState("flashcards");
  const [count, setCount] = useState(12);
  const [difficulty, setDifficulty] = useState("exam");
  const [minutes, setMinutes] = useState(60);

  const ready = sources.length > 0 && !busy;
  const pastPapers = sources.filter((s) => s.isPastPaper).length;

  const run = async () => {
    const set = await generateSet({ kind, count: Number(count) || 10, difficulty, minutes: Number(minutes) || 60 });
    if (set) toast.success(`${KIND_LABEL[kind]} ready`);
  };

  return (
    <section className="neu-raised rounded-xl p-5">
      <SectionLabel className="mb-3">Make</SectionLabel>

      <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} className="mb-4" />

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <label className="block">
          <span className="block text-[11px] tracking-[0.15em] uppercase text-faint mb-1.5">
            {kind === "flashcards" ? "Cards" : "Questions"}
          </span>
          <input
            type="number"
            min={3}
            max={60}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-full h-9 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[13px] tabular-nums text-hi px-3"
          />
        </label>

        {kind === "paper" && (
          <label className="block">
            <span className="block text-[11px] tracking-[0.15em] uppercase text-faint mb-1.5">Minutes</span>
            <input
              type="number"
              min={5}
              max={360}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-full h-9 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[13px] tabular-nums text-hi px-3"
            />
          </label>
        )}

        <div>
          <span className="block text-[11px] tracking-[0.15em] uppercase text-faint mb-1.5">Level</span>
          <Segmented size="sm" options={DIFFICULTY_OPTIONS} value={difficulty} onChange={setDifficulty} />
        </div>
      </div>

      {kind === "paper" && (
        <div className="mt-4">
          <span className="block text-[11px] tracking-[0.15em] uppercase text-faint mb-1.5">
            Your exam pattern
          </span>
          <textarea
            value={paperFormat}
            onChange={(e) => setPaperFormat(e.target.value)}
            rows={3}
            placeholder={
              "How does your university set this paper? e.g. Section A: 10 MCQs × 1 mark. " +
              "Section B: answer any 5 of 7 × 4 marks. Section C: 2 long answers × 10 marks. 3 hours."
            }
            className="w-full rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[12.5px] text-hi placeholder:text-faint px-3.5 py-2.5 resize-y leading-relaxed focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)]"
          />
          <p className="text-[11px] text-faint mt-1.5 leading-relaxed">
            {pastPapers > 0 ? (
              <>
                <span className="text-accent">{pastPapers} past paper{pastPapers === 1 ? "" : "s"}</span> will
                also be copied for section layout, mark split and wording — new questions, same house style.
              </>
            ) : (
              "Upload a past paper above and mark it, and the format gets copied from the real thing."
            )}
          </p>
        </div>
      )}

      <NeuButton
        variant="accent"
        icon="wand"
        className="mt-4 w-full"
        onClick={run}
        disabled={!ready}
        loading={busy && (phase === "comprehending" || phase === "generating")}
      >
        {phase === "comprehending"
          ? "Reading your material…"
          : phase === "generating"
          ? "Writing questions…"
          : `Generate ${KIND_LABEL[kind].toLowerCase()}`}
      </NeuButton>

      <WorkingPanel />

      {sources.length === 0 && (
        <p className="text-[11.5px] text-faint mt-2 text-center">Add material first.</p>
      )}
    </section>
  );
}

/* ─── Screen ─── */

export default function EducationScreen() {
  const { sets, activeSetId, error, busy, phase } = useStore(educationStore, (s) => ({
    sets: s.sets,
    activeSetId: s.activeSetId,
    error: s.error,
    busy: s.busy,
    phase: s.phase,
  }));
  const { providers } = useStore(keysStore, (s) => ({ providers: s.providers }));
  const hasKey = Object.values(providers || {}).some(Boolean);

  const active = sets.find((s) => s.id === activeSetId) || null;

  return (
    <div className="h-full flex overflow-hidden">
      <HistorySidebar />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* The header shares the content column's width. Left-aligned title and
            right-aligned controls against a centred column read as two
            unrelated layouts on a wide window. */}
        <header
          className={`shrink-0 px-6 pt-5 pb-4 mx-auto w-full flex items-end justify-between gap-4 ${
            active ? "max-w-[880px]" : "max-w-[1210px]"
          }`}
        >
          <div className="min-w-0">
            <SectionLabel>Education Hub</SectionLabel>
            <h1 className="font-display font-semibold text-[19px] text-hi mt-1 truncate">
              {active ? active.title : "Turn your material into practice"}
            </h1>
            <div className="mt-1.5">
              <RouteLine />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <RetentionDial />
            <SpendMeter />
            <TierToggle />
          </div>
        </header>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="shrink-0 mx-6 mb-3 px-3.5 py-2.5 rounded-lg bg-err-soft flex items-start gap-2"
              role="alert"
            >
              <Icon name="alert" size={13} className="text-err shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0 text-[12.5px] text-err break-words">{error}</span>
              <IconButton name="close" size={12} onClick={dismissError} label="Dismiss" />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          {!hasKey ? (
            <EmptyState
              icon="key"
              title="No provider connected"
              hint="The hub reads your notes with a model, so it needs one API key. OpenRouter alone covers everything here, free tier included."
              action={<NeuButton icon="key" onClick={() => setView("settings")}>Open Settings</NeuButton>}
            />
          ) : active ? (
            <>
              {busy && phase === "transcribing" && (
                <div className="max-w-[820px] mx-auto mb-3 neu-inset rounded-xl px-4 py-3 flex items-center gap-2.5 text-[12.5px] text-dim">
                  <Spinner size={13} /> Reading your handwriting…
                </div>
              )}
              {active.kind === "flashcards" && <Flashcards set={active} />}
              {active.kind === "quiz" && <Quiz set={active} />}
              {active.kind === "paper" && <PaperAttempt set={active} />}
            </>
          ) : (
            <div className="max-w-[1180px] mx-auto w-full grid gap-4">
              {/* What is due leads; making new material comes after. */}
              <Dashboard />
              <div className="grid gap-4 items-start [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
                <div className="grid gap-4 min-w-0">
                  <Material />
                  <Topic />
                </div>
                <Make />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
