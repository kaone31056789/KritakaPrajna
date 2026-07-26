import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { useStore } from "../../core/store";
import {
  educationStore,
  openSet,
  dueIndexes,
  forecast,
  retentionForecast,
  activity,
  studySummary,
} from "../../core/education";
import { EASE_OUT, T } from "../../design/motion";
import Icon from "../../ui/icons";
import { NeuButton, SectionLabel, NeuBadge, NeuTooltip } from "../../ui/primitives";
import { CountUp } from "../../ui/textfx";

/* ═══ Study dashboard ═══════════════════════════════════════════════════════
   Everything here is derived from FSRS state. Counting cards could only ever
   tell you how many are due; stability per card is what makes "what will I
   have forgotten by Friday" a question with an answer.
   ═══════════════════════════════════════════════════════════════════════════ */

const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

function Stat({ label, value, sub, tone = "neutral", count = true }) {
  return (
    <div className="rounded-lg bg-deep [box-shadow:var(--neu-inset-sm)] px-4 py-3 min-w-0">
      <p className="text-[10px] tracking-[0.15em] uppercase text-faint">{label}</p>
      <p
        className={`font-display font-semibold text-[22px] tabular-nums mt-0.5 ${
          tone === "accent" ? "text-accent" : tone === "ok" ? "text-ok" : "text-hi"
        }`}
      >
        {count && typeof value === "number" ? <CountUp to={value} duration={0.9} /> : value}
      </p>
      {sub && <p className="text-[11px] text-faint mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

/** Bars for the next fortnight — where the workload actually lands. */
function Forecast({ sets }) {
  const bins = useMemo(() => forecast(sets, 14), [sets]);
  const peak = Math.max(1, ...bins);
  const today = new Date().getDay();

  return (
    <section className="neu-raised rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3.5">
        <SectionLabel>Coming up</SectionLabel>
        <span className="text-[11px] text-faint tabular-nums">
          {bins.reduce((a, b) => a + b, 0)} reviews over 14 days
        </span>
      </div>
      <div className="flex items-end gap-1.5 h-[92px]">
        {bins.map((n, i) => (
          <NeuTooltip
            key={i}
            label={n === 0 ? "Nothing due" : `${n} card${n === 1 ? "" : "s"} in ${i === 0 ? "today" : `${i}d`}`}
          >
            <div className="flex-1 h-full flex flex-col justify-end items-center gap-1.5 min-w-0">
              <motion.div
                className="w-full rounded-t-sm"
                style={{
                  background:
                    i === 0
                      ? "linear-gradient(180deg, var(--accent), var(--accent-2))"
                      : "var(--surface-3)",
                  minHeight: n > 0 ? 3 : 0,
                }}
                initial={{ height: 0 }}
                animate={{ height: `${(n / peak) * 100}%` }}
                transition={{ duration: 0.4, delay: i * 0.02, ease: EASE_OUT }}
              />
              <span className={`text-[9px] tabular-nums ${i === 0 ? "text-accent" : "text-faint"}`}>
                {DAY_LETTER[(today + i) % 7]}
              </span>
            </div>
          </NeuTooltip>
        ))}
      </div>
    </section>
  );
}

/** The forgetting curve for your actual collection, if you review nothing. */
function RetentionCurve({ sets }) {
  const curve = useMemo(() => retentionForecast(sets, 30), [sets]);
  if (curve.length === 0) return null;

  const w = 300;
  const h = 70;
  const pts = curve
    .map((r, i) => `${(i / (curve.length - 1)) * w},${h - r * h}`)
    .join(" ");
  const inAMonth = curve[curve.length - 1];

  return (
    <section className="neu-raised rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <SectionLabel>If you stop now</SectionLabel>
        <span className="text-[11px] text-faint">
          <span className={inAMonth < 0.5 ? "text-err" : "text-dim"}>
            {Math.round(inAMonth * 100)}%
          </span>{" "}
          recalled in 30 days
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[70px] overflow-visible" role="img"
        aria-label={`Predicted recall falls to ${Math.round(inAMonth * 100)} percent over 30 days`}>
        <defs>
          <linearGradient id="edu-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 90% line — the retention FSRS is scheduling toward. */}
        <line x1="0" y1={h - 0.9 * h} x2={w} y2={h - 0.9 * h}
          stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
        <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#edu-fade)" />
        <motion.polyline
          points={pts}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        />
      </svg>
      <p className="text-[11px] text-faint mt-1.5">
        Dashed line is your 90% target. The curve is every card you have seen, decaying together.
      </p>
    </section>
  );
}

/** Thirteen weeks of study, one square per day. */
function Heatmap({ log }) {
  const days = 91;
  const bins = useMemo(() => activity(log, days), [log]);
  const peak = Math.max(1, ...bins);

  return (
    <section className="neu-raised rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3.5">
        <SectionLabel>Last 13 weeks</SectionLabel>
        <span className="text-[11px] text-faint tabular-nums">
          {bins.filter((n) => n > 0).length} active days
        </span>
      </div>
      <div className="grid grid-flow-col grid-rows-7 gap-[3px] justify-start">
        {bins.map((n, i) => {
          const strength = n === 0 ? 0 : 0.25 + (n / peak) * 0.75;
          const ago = days - 1 - i;
          return (
            <NeuTooltip
              key={i}
              label={`${n === 0 ? "No" : n} review${n === 1 ? "" : "s"} · ${
                ago === 0 ? "today" : `${ago}d ago`
              }`}
            >
              <div
                className="w-[11px] h-[11px] rounded-[2px]"
                style={{
                  background:
                    n === 0 ? "var(--surface-2)" : `color-mix(in srgb, var(--accent) ${strength * 100}%, transparent)`,
                }}
              />
            </NeuTooltip>
          );
        })}
      </div>
    </section>
  );
}

/* ─── Screen ─── */

export default function Dashboard() {
  const { sets, log } = useStore(educationStore, (s) => ({ sets: s.sets, log: s.log }));
  const decks = sets.filter((s) => s.kind === "flashcards");
  const summary = useMemo(() => studySummary(sets, log), [sets, log]);

  if (decks.length === 0) return null;

  // Most-due deck first — that is where a session should start.
  const ranked = decks
    .map((d) => ({ deck: d, due: dueIndexes(d).length }))
    .sort((a, b) => b.due - a.due);
  const next = ranked[0];

  return (
    <motion.div
      className="grid gap-4"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: T, ease: EASE_OUT }}
    >
      <section className="neu-raised rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <SectionLabel>Today</SectionLabel>
            <h2 className="font-display font-semibold text-[17px] text-hi mt-1">
              {summary.due > 0
                ? `${summary.due} card${summary.due === 1 ? "" : "s"} ready for review`
                : "Nothing due — you are ahead"}
            </h2>
          </div>
          {summary.due > 0 && next && (
            <NeuButton variant="accent" icon="layers" onClick={() => openSet(next.deck.id)}>
              Start with {next.due} in “{next.deck.title.slice(0, 24)}”
            </NeuButton>
          )}
        </div>

        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(128px,1fr))]">
          <Stat label="Due now" value={summary.due} tone={summary.due > 0 ? "accent" : "neutral"} />
          <Stat label="Reviewed today" value={summary.reviewsToday} />
          <Stat
            label="Streak"
            value={summary.streak}
            sub={summary.streak === 1 ? "day" : "days"}
            tone={summary.streak > 0 ? "ok" : "neutral"}
          />
          <Stat
            label="Recall now"
            value={summary.recall == null ? "—" : `${Math.round(summary.recall * 100)}%`}
            count={false}
            sub={`${summary.seen} of ${summary.total} cards seen`}
          />
        </div>

        {summary.leeches > 0 && (
          <p className="mt-3 text-[11.5px] text-dim flex items-center gap-1.5">
            <Icon name="alert" size={12} className="text-info shrink-0" />
            {summary.leeches} card{summary.leeches === 1 ? " has" : "s have"} lapsed three times or more —
            usually a sign the card is badly written rather than the topic being hard.
          </p>
        )}
      </section>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        <Forecast sets={sets} />
        {summary.seen > 0 && <RetentionCurve sets={sets} />}
      </div>

      {log.length > 0 && <Heatmap log={log} />}

      {decks.length > 1 && (
        <section className="neu-raised rounded-xl p-5">
          <SectionLabel className="mb-3">Decks</SectionLabel>
          <ul className="grid gap-1.5">
            {ranked.map(({ deck, due }) => (
              <li key={deck.id}>
                <button
                  type="button"
                  onClick={() => openSet(deck.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-surface [box-shadow:var(--neu-raised-sm)] text-left pressable"
                >
                  <Icon name="layers" size={14} className={due > 0 ? "text-accent" : "text-faint"} />
                  <span className="flex-1 min-w-0 text-[12.5px] text-body truncate">{deck.title}</span>
                  <NeuBadge tone={due > 0 ? "accent" : "neutral"}>
                    {due > 0 ? `${due} due` : "clear"}
                  </NeuBadge>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </motion.div>
  );
}
