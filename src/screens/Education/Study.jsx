import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../../core/store";
import {
  educationStore,
  paperQuestions,
  startAttempt,
  setAnswer,
  abandonAttempt,
  ingestAnswerSheet,
  gradeAttempt,
  formatTokens,
  formatSpend,
  dueIndexes,
  nextDueAt,
  dueLabel,
  reviewCard,
  resetReview,
  scheduleNext,
  markRecall,
  CONFIDENCE,
  GRADE,
} from "../../core/education";
import { EASE_OUT, T_SLOW, T } from "../../design/motion";
import Icon from "../../ui/icons";
import { NeuButton, IconButton, NeuBadge, EmptyState, Spinner, Kbd } from "../../ui/primitives";
import Markdown from "../../ui/Markdown";
import { CountUp, ShinyText } from "../../ui/textfx";
import { toast } from "../../ui/Toaster";

/* ═══ Study runners — one per set kind ═══ */

/* Course material is full of programs, so anything carrying a fence, a table or
   inline formatting goes through the full markdown renderer (syntax highlighting,
   KaTeX, tables). Plain prose keeps the large display type — routing everything
   through markdown would flatten a one-line recall prompt into body copy. */

const RICH = /```|\n\s*[-*|]\s|\$\$|\\\(|<[a-z]+>|\|.*\|/;

export const hasCode = (s) => /```/.test(String(s || ""));

function Body({ text, size = "prose" }) {
  const value = String(text || "");
  if (RICH.test(value)) return <Markdown>{value}</Markdown>;
  return (
    <p
      className={
        size === "display"
          ? "whitespace-pre-wrap text-[22px] leading-[1.4] font-display font-semibold text-hi"
          : "whitespace-pre-wrap text-[15px] leading-[1.7] text-hi"
      }
    >
      {value}
    </p>
  );
}

/* ─── Flashcards ─── */

export function Flashcards({ set }) {
  const cards = set.payload?.cards || [];
  // The queue is frozen for the session so cards do not reshuffle underfoot as
  // they get scheduled. Lapses get pushed back onto the end of it.
  const { recallMode, busy } = useStore(educationStore, (s) => ({
    recallMode: s.recallMode,
    busy: s.busy,
  }));
  const [queue, setQueue] = useState(() => dueIndexes(set));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [graded, setGraded] = useState(0);
  const [again, setAgain] = useState(0);
  const [typed, setTyped] = useState("");
  const [confidence, setConfidence] = useState(null);
  const [hintUsed, setHintUsed] = useState(false);
  const [mark, setMark] = useState(null); // { verdict, missing, grade }
  const [calibration, setCalibration] = useState({ hit: 0, miss: 0 });
  const deckId = useRef(set.id);

  const resetCard = () => {
    setFlipped(false);
    setTyped("");
    setConfidence(null);
    setHintUsed(false);
    setMark(null);
  };

  if (deckId.current !== set.id) {
    // Switched decks from the sidebar — start that deck's own session.
    deckId.current = set.id;
    setQueue(dueIndexes(set));
    setPos(0);
    setGraded(0);
    setAgain(0);
    setCalibration({ hit: 0, miss: 0 });
    resetCard();
  }

  const idx = queue[pos];
  const card = cards[idx];

  const grade = (g) => {
    if (idx == null) return;
    reviewCard(set.id, idx, g);
    setGraded((n) => n + 1);
    // Track whether stated confidence matched the outcome — the gap between
    // "I know this" and knowing it is the thing worth surfacing.
    if (confidence) {
      const felt = confidence === "sure";
      const was = g >= GRADE.good;
      setCalibration((c) => ({ hit: c.hit + (felt === was ? 1 : 0), miss: c.miss + (felt === was ? 0 : 1) }));
    }
    if (g === GRADE.again) {
      setAgain((n) => n + 1);
      setQueue((q) => [...q, idx]); // comes back before the session ends
    }
    resetCard();
    setPos((p) => p + 1);
  };

  const submitTyped = async () => {
    if (!typed.trim() || busy) return;
    const res = await markRecall({
      question: card.q,
      expected: card.a,
      answer: typed,
      hintUsed,
    });
    if (res) {
      setMark(res);
      setFlipped(true);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches?.("input, textarea")) return;
      if (e.key === " ") { e.preventDefault(); setFlipped((f) => !f); }
      else if (!flipped) return;
      else if (e.key === "1") grade(GRADE.again);
      else if (e.key === "2") grade(GRADE.hard);
      else if (e.key === "3") grade(GRADE.good);
      else if (e.key === "4") grade(GRADE.easy);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (cards.length === 0) {
    return <EmptyState icon="layers" title="This deck is empty" hint="Generate it again — the material may have been too thin." />;
  }

  /* Nothing left in this session. */
  if (!card) {
    const next = nextDueAt(set);
    return (
      <div className="h-full flex items-center justify-center">
        <div className="neu-raised rounded-2xl px-8 py-9 max-w-[460px] text-center">
          <Icon name="check" size={26} className="text-ok mx-auto" />
          <h2 className="font-display font-semibold text-[19px] text-hi mt-3">
            {graded > 0 ? "Session done" : "Nothing due"}
          </h2>
          <p className="text-[13px] text-dim mt-2 leading-relaxed">
            {graded > 0
              ? `${graded} review${graded === 1 ? "" : "s"} logged${again > 0 ? `, ${again} to come back sooner` : ""}.`
              : "Every card in this deck is scheduled for later."}
            {next && next > Date.now() && ` Next card is due in ${dueLabel(next)}.`}
          </p>
          <div className="flex items-center justify-center gap-2 mt-6">
            <NeuButton
              icon="refresh"
              onClick={() => {
                setQueue(cards.map((_, i) => i));
                setPos(0);
                setGraded(0);
                setAgain(0);
              }}
            >
              Study all anyway
            </NeuButton>
            <NeuButton
              onClick={() => {
                resetReview(set.id);
                setQueue(cards.map((_, i) => i));
                setPos(0);
                setGraded(0);
                setAgain(0);
              }}
            >
              Reset schedule
            </NeuButton>
          </div>
        </div>
      </div>
    );
  }

  const sched = set.review?.[idx];
  // What each button actually buys, computed before you press it.
  const preview = (g) => dueLabel(Date.now() + scheduleNext(sched, g).due - Date.now());

  return (
    <div className="h-full max-w-[900px] mx-auto w-full flex flex-col gap-4 pb-2">
      {/* Progress */}
      <div className="shrink-0">
        <div className="flex items-baseline justify-between mb-2 gap-3">
          <span className="text-[12px] text-dim tabular-nums">
            <span className="text-hi font-semibold">{pos + 1}</span> of {queue.length} due
          </span>
          <span className="text-[11.5px] text-faint tabular-nums">
            {graded} reviewed{again > 0 ? ` · ${again} repeating` : ""}
            {calibration.miss > 0 && ` · ${calibration.miss} misjudged`}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-deep [box-shadow:var(--neu-inset-sm)] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
            animate={{ width: `${(pos / queue.length) * 100}%` }}
            transition={{ duration: T_SLOW, ease: EASE_OUT }}
          />
        </div>
      </div>

      {/* Sized to its content — a one-line definition should not float in a
          window-height void, and a full program should not be squeezed. */}
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="neu-raised rounded-2xl w-full px-8 py-7 text-left flex flex-col gap-4 relative"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] tracking-[0.2em] uppercase ${flipped ? "text-accent" : "text-faint"}`}>
            {flipped ? "Answer" : "Prompt"}
          </span>
          {card.topic && <NeuBadge>{card.topic}</NeuBadge>}
          {hasCode(flipped ? card.a : card.q) && (
            <NeuBadge tone="info">
              <Icon name="code" size={10} /> code
            </NeuBadge>
          )}
          <span className="flex-1" />
          {sched?.reps > 0 && (
            <NeuBadge tone="ok">
              seen {sched.reps}× · {sched.interval}d
            </NeuBadge>
          )}
          {sched?.difficulty != null && (
            <NeuBadge tone={sched.difficulty > 7 ? "err" : sched.difficulty > 4 ? "info" : "neutral"}>
              difficulty {sched.difficulty.toFixed(1)}
            </NeuBadge>
          )}
          {sched?.lapses > 0 && <NeuBadge tone="info">lapsed {sched.lapses}×</NeuBadge>}
        </div>

        <div className="min-h-[120px] max-h-[54vh] overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${idx}-${pos}-${flipped}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: T, ease: EASE_OUT }}
            >
              <Body text={flipped ? card.a : card.q} size={flipped ? "prose" : "display"} />

              {/* A hint is available but never free — see the grade cap below. */}
              {!flipped && card.hint && (
                hintUsed ? (
                  <p className="mt-5 text-[13px] text-dim pl-3 border-l-2" style={{ borderColor: "var(--accent)" }}>
                    {card.hint}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setHintUsed(true); }}
                    className="mt-5 text-[12px] text-faint hover:text-accent transition-colors"
                  >
                    Show hint — caps this card at Hard
                  </button>
                )
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Write it before you see it — this is the retrieval the research measures. */}
        {recallMode === "type" && !flipped && (
          <div onClick={(e) => e.stopPropagation()} role="presentation">
            <textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitTyped();
              }}
              rows={4}
              placeholder="Write the answer from memory…"
              className="w-full rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[13.5px] text-hi placeholder:text-faint px-3.5 py-3 resize-y leading-relaxed focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)]"
            />
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              <span className="text-[10px] tracking-[0.15em] uppercase text-faint">How sure?</span>
              {CONFIDENCE.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setConfidence(c.id)}
                  className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${
                    confidence === c.id
                      ? "bg-deep [box-shadow:var(--neu-inset-sm)] text-accent"
                      : "bg-surface [box-shadow:var(--neu-raised-sm)] text-dim hover:text-hi"
                  }`}
                >
                  {c.label}
                </button>
              ))}
              <span className="flex-1" />
              <NeuButton
                variant="accent"
                icon="check"
                onClick={submitTyped}
                disabled={!typed.trim()}
                loading={busy}
              >
                {busy ? "Marking…" : "Mark it"}
              </NeuButton>
            </div>
          </div>
        )}

        {/* What was missing — feedback is what turns a failed retrieval into learning. */}
        {mark && flipped && (
          <div
            className="rounded-lg bg-deep [box-shadow:var(--neu-inset-sm)] px-4 py-3"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <NeuBadge tone={mark.verdict === "correct" ? "ok" : mark.verdict === "partial" ? "info" : "err"}>
                {mark.verdict}
              </NeuBadge>
              {mark.hintUsed && <NeuBadge tone="info">hint used — capped at Hard</NeuBadge>}
              {confidence === "sure" && mark.verdict === "wrong" && (
                <NeuBadge tone="err">you felt sure — worth noting</NeuBadge>
              )}
            </div>
            {mark.missing && <p className="text-[13px] text-body leading-relaxed">{mark.missing}</p>}
            <p className="text-[11px] text-faint mt-2">
              Your answer: <span className="text-dim">{typed.slice(0, 240)}</span>
            </p>
          </div>
        )}

        <p className="text-[11px] text-faint flex items-center gap-1.5">
          <Kbd>Space</Kbd>{" "}
          {flipped
            ? "back to the prompt"
            : recallMode === "type"
            ? "reveal without answering — scores no better than Hard"
            : "reveal the answer, then grade it"}
        </p>
      </button>

      {/* Grading — only once the answer is showing, or you are grading a guess */}
      <div className="shrink-0 flex items-center gap-2">
        {flipped ? (
          <>
            {/* Four grades, because FSRS distinguishes "hard but recalled" from
                "forgotten" — SM-2 collapsed them and lost the signal. Each
                button shows the interval it will actually buy you. */}
            {[
              [GRADE.again, "Again", "1", false],
              [GRADE.hard, "Hard", "2", false],
              [GRADE.good, "Good", "3", true],
              [GRADE.easy, "Easy", "4", false],
            ].map(([g, label, key, primary]) => (
              <NeuButton
                key={g}
                // After marking, the model's verdict pre-selects the grade —
                // a suggestion, since you still know best whether you knew it.
                variant={(mark ? mark.grade === g : primary) ? "accent" : undefined}
                className="flex-1"
                onClick={() => grade(g)}
              >
                <span className="flex flex-col items-center leading-tight">
                  <span>{label} <Kbd>{key}</Kbd></span>
                  <span className="text-[9.5px] opacity-60 tabular-nums">{preview(g)}</span>
                </span>
              </NeuButton>
            ))}
          </>
        ) : (
          <NeuButton className="flex-1" icon="eye" onClick={() => setFlipped(true)}>
            Show answer
          </NeuButton>
        )}
      </div>

      {/* Session strip */}
      <div className="shrink-0 flex items-center gap-1 flex-wrap">
        {queue.map((cardIdx, n) => (
          <span
            key={`${cardIdx}-${n}`}
            className={`h-1.5 flex-1 min-w-[8px] rounded-full ${
              n === pos ? "bg-accent" : n < pos ? "bg-ok" : "bg-surface-2"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Quiz ─── */

export function Quiz({ set }) {
  const questions = set.payload?.questions || [];
  const [picked, setPicked] = useState({});
  const [checked, setChecked] = useState(false);

  const score = useMemo(
    () => questions.reduce((n, q, idx) => n + (picked[idx] === q.answer ? 1 : 0), 0),
    [picked, questions]
  );

  if (questions.length === 0) {
    return <EmptyState icon="layers" title="This quiz is empty" hint="Generate it again, or pick another model." />;
  }

  return (
    <div className="max-w-[820px] mx-auto w-full flex flex-col gap-2.5">
      {questions.map((q, idx) => {
        const sel = picked[idx];
        return (
          <div key={idx} className="neu-raised rounded-xl px-5 py-4">
            {/* Number and question read as one line; the topic sits under them
                rather than being flung to the far edge of a wide card. */}
            <div className="flex items-start gap-2.5">
              <span className="text-[13px] text-faint tabular-nums pt-[3px] shrink-0">{idx + 1}.</span>
              <div className="flex-1 min-w-0">
                <Body text={q.q} />
                {q.topic && (
                  <p className="text-[10.5px] text-faint mt-1 truncate">{q.topic}</p>
                )}
              </div>
            </div>
            <div className="grid gap-1 mt-3 pl-[22px]">
              {(q.options || []).map((opt, oi) => {
                const isPicked = sel === oi;
                const isRight = checked && oi === q.answer;
                const isWrong = checked && isPicked && oi !== q.answer;
                return (
                  <button
                    key={oi}
                    type="button"
                    onClick={() => !checked && setPicked((p) => ({ ...p, [idx]: oi }))}
                    disabled={checked}
                    className={`text-left px-3 py-2 rounded-lg text-[13px] flex items-start gap-2.5 transition-colors ${
                      isRight
                        ? "bg-ok-soft text-ok"
                        : isWrong
                        ? "bg-err-soft text-err"
                        : isPicked
                        ? "bg-deep [box-shadow:var(--neu-inset-sm)] text-hi"
                        : "bg-surface [box-shadow:var(--neu-raised-sm)] text-body hover:text-hi"
                    }`}
                  >
                    <span className="w-4 shrink-0 text-[11px] text-faint pt-[2px]">{"ABCD"[oi]}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap leading-snug">{opt}</span>
                    {isRight && <Icon name="check" size={14} className="shrink-0 mt-[2px]" />}
                  </button>
                );
              })}
            </div>
            {checked && q.why && (
              <p className="mt-2.5 ml-[22px] text-[12.5px] text-dim leading-relaxed border-l-2 border-line pl-3">
                {q.why}
              </p>
            )}
          </div>
        );
      })}

      {/* A transparent sticky bar let the questions behind it show through the
          button. It needs its own surface, and a fade so the list does not just
          stop at a hard edge. */}
      <div
        className="sticky bottom-0 z-10 -mx-1 px-1 pt-4 pb-3 flex items-center gap-3"
        style={{
          background: "linear-gradient(to top, var(--bg) 62%, transparent)",
          backdropFilter: "blur(2px)",
        }}
      >
        {checked ? (
          <>
            <NeuBadge tone={score === questions.length ? "ok" : score * 2 >= questions.length ? "info" : "err"}>
              <CountUp to={score} duration={1.1} /> / {questions.length}
            </NeuBadge>
            <NeuButton icon="refresh" onClick={() => { setPicked({}); setChecked(false); }}>
              Try again
            </NeuButton>
          </>
        ) : (
          <NeuButton
            variant="accent"
            icon="check"
            onClick={() => setChecked(true)}
            disabled={Object.keys(picked).length === 0}
          >
            Check answers
          </NeuButton>
        )}
      </div>
    </div>
  );
}

/* ─── Exam paper ─── */

const isMcq = (q) => q?.type === "mcq" && Array.isArray(q.options) && q.options.length > 1;

function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function PaperAttempt({ set }) {
  const { attempt, busy, phase } = useStore(educationStore, (s) => ({
    attempt: s.attempt,
    busy: s.busy,
    phase: s.phase,
  }));
  const questions = useMemo(() => paperQuestions(set), [set]);
  const [minutes, setMinutes] = useState(set.payload?.durationMin || 60);
  const [now, setNow] = useState(Date.now());
  const fileRef = useRef(null);

  const live = attempt && attempt.setId === set.id && !attempt.submitted;
  const done = attempt && attempt.setId === set.id && attempt.submitted;

  // Tick only while a paper is actually running.
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  const left = live ? attempt.limitSec - (now - attempt.startedAt) / 1000 : 0;
  const outOfTime = live && left <= 0;

  const submit = async () => {
    const res = await gradeAttempt();
    if (res) toast.success(`Marked — ${res.total} / ${res.outOf}`);
  };

  // Auto-submit the moment the clock runs out, exactly like a real invigilator.
  // gradeAttempt() reads the live store, so the stale closure here is harmless.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (outOfTime) submitRef.current();
  }, [outOfTime]);

  const onSheet = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const dataUrl = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });
    const merged = await ingestAnswerSheet(dataUrl);
    if (merged) toast.success(`Read ${Object.keys(merged).length} answers from your sheet`);
  };

  const totalMarks =
    set.payload?.totalMarks || questions.reduce((n, q) => n + (Number(q.marks) || 0), 0);

  /* Not started yet — the briefing screen. */
  if (!live && !done) {
    return (
      <div className="max-w-[640px] mx-auto w-full">
        <div className="neu-raised rounded-xl p-7 text-center">
          <Icon name="clock" size={26} className="text-accent mx-auto" />
          <h2 className="font-display font-semibold text-[19px] text-hi mt-3">{set.title}</h2>
          <p className="text-[13px] text-dim mt-2">
            {questions.length} question{questions.length === 1 ? "" : "s"} · {totalMarks} marks
          </p>

          <label className="block mt-6 text-[11px] tracking-[0.15em] uppercase text-faint">Time limit</label>
          <div className="flex items-center justify-center gap-3 mt-2">
            <input
              type="number"
              min={1}
              max={360}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-24 h-10 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-center text-[15px] tabular-nums text-hi"
            />
            <span className="text-[13px] text-dim">minutes</span>
          </div>

          <NeuButton
            variant="accent"
            icon="clock"
            className="mt-6"
            onClick={() => startAttempt(set.id, minutes)}
          >
            Start the clock
          </NeuButton>
          <p className="text-[11.5px] text-faint mt-4 leading-relaxed">
            Type your answers here, or write on paper and photograph the sheet when you are done —
            it gets transcribed back into the right boxes.
          </p>
        </div>
      </div>
    );
  }

  const result = done ? attempt.result : null;
  const byN = {};
  if (result) for (const r of result.perQuestion) byN[String(r.n)] = r;

  return (
    <div className="max-w-[820px] mx-auto w-full flex flex-col gap-3">
      {/* Invigilator bar */}
      <div className="sticky top-0 z-10 neu-raised rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
        {live ? (
          <>
            <Icon name="clock" size={15} className={left < 60 ? "text-err animate-breathe" : "text-accent"} />
            <span className={`font-mono text-[15px] tabular-nums ${left < 60 ? "text-err" : "text-hi"}`}>
              {clock(left)}
            </span>
            <span className="text-[11.5px] text-faint">
              {Object.keys(attempt.answers).length} of {questions.length} answered
            </span>
            <div className="flex-1" />
            <input ref={fileRef} type="file" accept="image/*" onChange={onSheet} className="hidden" />
            <NeuButton icon="paperclip" onClick={() => fileRef.current?.click()} loading={busy && phase === "transcribing"}>
              Photograph sheet
            </NeuButton>
            <NeuButton variant="accent" icon="check" onClick={submit} loading={busy && phase === "grading"}>
              Submit
            </NeuButton>
          </>
        ) : (
          <>
            <NeuBadge tone={result && result.total * 2 >= result.outOf ? "ok" : "err"}>
              {/* Counts up to your mark — the one number worth a beat of drama. */}
              <CountUp to={result?.total ?? 0} duration={1.4} /> / {result?.outOf}
            </NeuBadge>
            <span className="text-[12.5px] text-dim">{set.title}</span>
            {result?.spent && (
              <span className="text-[11px] text-faint tabular-nums">
                marking cost {formatTokens(result.spent.inTokens + result.spent.outTokens)} tok ·{" "}
                {formatSpend(result.spent.cost)}
              </span>
            )}
            <div className="flex-1" />
            <NeuButton icon="refresh" onClick={() => abandonAttempt()}>Retake</NeuButton>
          </>
        )}
      </div>

      {busy && phase === "grading" && (
        <div className="neu-inset rounded-xl px-4 py-3 flex items-center gap-2.5 text-[12.5px] text-dim">
          <Spinner size={13} /> <ShinyText speed={2.6}>Marking your paper against the mark scheme…</ShinyText>
        </div>
      )}

      {result?.summary && (
        <div className="neu-raised rounded-xl p-5">
          <p className="text-[10px] tracking-[0.18em] uppercase text-faint mb-2">What to revise</p>
          <p className="text-[13.5px] text-body leading-relaxed">{result.summary}</p>
        </div>
      )}

      {attempt.transcribed > 0 && live && (
        <p className="text-[11.5px] text-ok flex items-center gap-1.5 px-1">
          <Icon name="check" size={12} /> {attempt.transcribed} answers transcribed from your sheet — check them before submitting.
        </p>
      )}

      {questions.map((q) => {
        const mark = byN[String(q.n)];
        return (
          <div key={q.n} className="neu-raised rounded-xl p-5">
            <div className="flex items-start gap-3 mb-3">
              <span className="text-[12px] text-faint tabular-nums pt-0.5">Q{q.n}</span>
              <div className="flex-1 min-w-0">
                {q.section && <p className="text-[10.5px] text-faint mb-1.5">{q.section}</p>}
                <Body text={q.q} />
              </div>
              {mark ? (
                <NeuBadge tone={mark.awarded >= (mark.outOf || q.marks || 1) ? "ok" : mark.awarded > 0 ? "info" : "err"}>
                  {mark.awarded} / {mark.outOf ?? q.marks ?? 0}
                </NeuBadge>
              ) : (
                <NeuBadge>{q.marks ?? 0} {(q.marks ?? 0) === 1 ? "mark" : "marks"}</NeuBadge>
              )}
            </div>

            {isMcq(q) ? (
              <div className="grid gap-1.5 mt-3">
                {q.options.map((opt, oi) => {
                  const label = `${"ABCD"[oi] || oi + 1}) ${opt}`;
                  const picked = attempt.answers[q.n] === label;
                  const isRight = !live && oi === q.answer;
                  const isWrong = !live && picked && oi !== q.answer;
                  return (
                    <button
                      key={oi}
                      type="button"
                      disabled={!live}
                      onClick={() => setAnswer(q.n, label)}
                      className={`text-left px-3.5 py-2.5 rounded-lg text-[13px] flex items-center gap-2.5 transition-colors ${
                        isRight
                          ? "bg-ok-soft text-ok"
                          : isWrong
                          ? "bg-err-soft text-err"
                          : picked
                          ? "bg-deep [box-shadow:var(--neu-inset-sm)] text-hi"
                          : "bg-surface [box-shadow:var(--neu-raised-sm)] text-body hover:text-hi"
                      }`}
                    >
                      <span className="w-5 shrink-0 text-[11px] text-faint">{"ABCD"[oi] || oi + 1}</span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap">{opt}</span>
                      {isRight && <Icon name="check" size={14} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={attempt.answers[q.n] || ""}
                onChange={(e) => setAnswer(q.n, e.target.value)}
                readOnly={!live}
                rows={q.type === "long" ? 7 : 4}
                placeholder={live ? "Write your answer…" : "(left blank)"}
                className="w-full rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[13.5px] text-hi placeholder:text-faint px-3.5 py-3 resize-y leading-relaxed"
              />
            )}

            {mark?.feedback && (
              <p className="mt-3 text-[12.5px] text-dim leading-relaxed border-t border-line pt-3">{mark.feedback}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
