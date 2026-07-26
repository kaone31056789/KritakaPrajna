/* ═══ FSRS-6 ═══════════════════════════════════════════════════════════════
 * Free Spaced Repetition Scheduler, ported from the reference implementation
 * (open-spaced-repetition/py-fsrs, MIT). Replaces SM-2.
 *
 * Where SM-2 carries one ease factor and multiplies intervals by it, FSRS
 * models memory with three quantities:
 *
 *   Stability (S)      days until recall probability falls to 90%
 *   Difficulty (D)     intrinsic hardness of the card, 1–10
 *   Retrievability (R) probability you would recall it right now
 *
 * Intervals are then *solved* from a target retention rather than accumulated
 * by multiplication, which is what makes "I want to remember 95% of this by
 * Friday" expressible at all. Difficulty mean-reverts on every review, which
 * is the specific fix for SM-2's ease hell — a card you keep failing cannot
 * ratchet its ease down forever until it becomes unschedulable.
 *
 * The published defaults below are population-fitted, so this works from the
 * very first card with no review history. Fitting them to your own log is an
 * improvement, not a prerequisite.
 * ═══════════════════════════════════════════════════════════════════════ */

export const DAY = 86400000;

/** FSRS-6 default parameters (w0…w20). w20 is the decay term. */
export const FSRS_DEFAULTS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
];

export const RATING = { again: 1, hard: 2, good: 3, easy: 4 };

const MIN_D = 1;
const MAX_D = 10;
const MIN_S = 0.001;
const MAX_INTERVAL = 36500; // 100 years — the reference cap

const clampD = (d) => Math.min(Math.max(d, MIN_D), MAX_D);
const clampS = (s) => Math.max(s, MIN_S);

function terms(w) {
  const decay = -w[20];
  return { decay, factor: Math.pow(0.9, 1 / decay) - 1 };
}

/** Probability of recall after `days` at stability `s`. */
export function retrievability(days, s, w = FSRS_DEFAULTS) {
  if (!s || s <= 0) return 0;
  const { decay, factor } = terms(w);
  return Math.pow(1 + (factor * Math.max(0, days)) / s, decay);
}

/** Days until recall probability falls to `retention`. */
export function intervalFor(s, retention = 0.9, w = FSRS_DEFAULTS) {
  const { decay, factor } = terms(w);
  const raw = (s / factor) * (Math.pow(retention, 1 / decay) - 1);
  return Math.min(Math.max(Math.round(raw), 1), MAX_INTERVAL);
}

const initialStability = (rating, w) => clampS(w[rating - 1]);
const initialDifficulty = (rating, w, clamp = true) => {
  const d = w[4] - Math.exp(w[5] * (rating - 1)) + 1;
  return clamp ? clampD(d) : d;
};

/** Difficulty drifts on the grade, then reverts toward the "easy" anchor. */
function nextDifficulty(d, rating, w) {
  const delta = -(w[6] * (rating - 3));
  const damped = d + ((10 - d) * delta) / 9;
  const anchor = initialDifficulty(RATING.easy, w, false);
  return clampD(w[7] * anchor + (1 - w[7]) * damped);
}

function recallStability(d, s, r, rating, w) {
  const hard = rating === RATING.hard ? w[15] : 1;
  const easy = rating === RATING.easy ? w[16] : 1;
  return (
    s *
    (1 +
      Math.exp(w[8]) *
        (11 - d) *
        Math.pow(s, -w[9]) *
        (Math.exp((1 - r) * w[10]) - 1) *
        hard *
        easy)
  );
}

function forgetStability(d, s, r, w) {
  const longTerm =
    w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  const shortTerm = s / Math.exp(w[17] * w[18]);
  return Math.min(longTerm, shortTerm);
}

/** Same-day repeat: stability nudges rather than jumping a whole interval. */
function shortTermStability(s, rating, w) {
  let inc = Math.exp(w[17] * (rating - 3 + w[18])) * Math.pow(s, -w[19]);
  if (rating === RATING.good || rating === RATING.easy) inc = Math.max(inc, 1);
  return clampS(s * inc);
}

/**
 * Review a card and return its next state.
 *
 * @param {object|null} card  { stability, difficulty, due, lastReview, reps, lapses } or null for a new card
 * @param {number} rating     1 again · 2 hard · 3 good · 4 easy
 * @param {object} [opts]     { retention = 0.9, now = Date.now(), w = FSRS_DEFAULTS }
 */
export function review(card, rating, opts = {}) {
  const { retention = 0.9, now = Date.now(), w = FSRS_DEFAULTS } = opts;
  const fresh = !card || card.stability == null;

  let stability;
  let difficulty;

  if (fresh) {
    stability = initialStability(rating, w);
    difficulty = initialDifficulty(rating, w);
  } else {
    const elapsedDays = Math.max(0, (now - (card.lastReview || now)) / DAY);
    const r = retrievability(elapsedDays, card.stability, w);
    difficulty = nextDifficulty(card.difficulty ?? initialDifficulty(RATING.good, w), rating, w);

    // Under a day since the last look is a repeat, not a scheduled review —
    // treating it as one would hand out a multi-day interval for re-reading.
    stability =
      elapsedDays < 1
        ? shortTermStability(card.stability, rating, w)
        : clampS(
            rating === RATING.again
              ? forgetStability(difficulty, card.stability, r, w)
              : recallStability(difficulty, card.stability, r, rating, w)
          );
  }

  const lapsed = !fresh && rating === RATING.again;
  const interval = intervalFor(stability, retention, w);

  return {
    stability,
    difficulty,
    interval,
    // A lapse comes back inside the session; anything else gets its real interval.
    due: now + (lapsed ? 8 * 60 * 1000 : interval * DAY),
    lastReview: now,
    reps: lapsed ? 0 : (card?.reps || 0) + 1,
    lapses: (card?.lapses || 0) + (lapsed ? 1 : 0),
  };
}
