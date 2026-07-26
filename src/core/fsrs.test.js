import { review, retrievability, intervalFor, FSRS_DEFAULTS, RATING, DAY } from "./fsrs";

/* Ported from py-fsrs. These assert the properties the algorithm is defined by,
   so a bad constant or a flipped sign fails here rather than silently handing
   out wrong intervals for months. */

const at = (days) => Date.now() + days * DAY;

describe("the forgetting curve", () => {
  test("R = 0.9 exactly at t = S — this is the definition of stability", () => {
    for (const s of [1, 7, 30, 365]) {
      expect(retrievability(s, s)).toBeCloseTo(0.9, 6);
    }
  });

  test("recall starts at 1 and decays monotonically", () => {
    expect(retrievability(0, 10)).toBeCloseTo(1, 6);
    const curve = [1, 5, 10, 40, 200].map((d) => retrievability(d, 10));
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeLessThan(curve[i - 1]);
    expect(curve[curve.length - 1]).toBeGreaterThan(0);
  });

  test("intervalFor inverts the curve", () => {
    for (const s of [2, 20, 100]) {
      expect(intervalFor(s, 0.9)).toBe(Math.round(s) || 1);
    }
  });

  test("wanting to remember more means shorter gaps", () => {
    const s = 100;
    expect(intervalFor(s, 0.95)).toBeLessThan(intervalFor(s, 0.9));
    expect(intervalFor(s, 0.9)).toBeLessThan(intervalFor(s, 0.85));
  });
});

describe("first review", () => {
  test("initial stability comes straight from w0..w3, ordered by grade", () => {
    const s = [RATING.again, RATING.hard, RATING.good, RATING.easy].map(
      (g) => review(null, g).stability
    );
    expect(s).toEqual(FSRS_DEFAULTS.slice(0, 4));
    expect(s[0]).toBeLessThan(s[3]); // again is the least stable, easy the most
  });

  test("a card answered Easy is easier than one answered Again", () => {
    expect(review(null, RATING.easy).difficulty).toBeLessThan(review(null, RATING.again).difficulty);
  });

  test("difficulty always lands inside 1–10", () => {
    for (const g of [1, 2, 3, 4]) {
      const d = review(null, g).difficulty;
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(10);
    }
  });
});

describe("subsequent reviews", () => {
  const learned = () => {
    let c = review(null, RATING.good);
    c = review(c, RATING.good, { now: at(c.interval) });
    return c;
  };

  test("a successful review always increases stability", () => {
    const c = learned();
    const next = review(c, RATING.good, { now: c.lastReview + c.interval * DAY });
    expect(next.stability).toBeGreaterThan(c.stability);
    expect(next.reps).toBe(c.reps + 1);
  });

  test("Easy buys a longer interval than Good, which beats Hard", () => {
    const c = learned();
    const now = c.lastReview + c.interval * DAY;
    const hard = review(c, RATING.hard, { now }).interval;
    const good = review(c, RATING.good, { now }).interval;
    const easy = review(c, RATING.easy, { now }).interval;
    expect(easy).toBeGreaterThan(good);
    expect(good).toBeGreaterThan(hard);
  });

  test("a lapse drops stability, counts itself, and returns inside the session", () => {
    const c = learned();
    const now = c.lastReview + c.interval * DAY;
    const lapsed = review(c, RATING.again, { now });
    expect(lapsed.stability).toBeLessThan(c.stability);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.reps).toBe(0);
    // Relative to when the review happened, not to wall-clock now.
    expect(lapsed.due - now).toBeLessThan(DAY);
  });

  test("reviewing late gains MORE stability — the spacing effect", () => {
    const c = learned();
    const onTime = review(c, RATING.good, { now: c.lastReview + c.interval * DAY });
    const late = review(c, RATING.good, { now: c.lastReview + c.interval * 3 * DAY });
    expect(late.stability).toBeGreaterThan(onTime.stability);
  });

  test("but the late bonus saturates instead of growing without limit", () => {
    // This is the concrete difference from SM-2, which inflates intervals in
    // proportion to the delay however absurd the delay gets.
    const c = learned();
    const g = (mult) => review(c, RATING.good, { now: c.lastReview + c.interval * mult * DAY }).stability;
    const gain10 = g(10) - g(5);
    const gain100 = g(100) - g(50);
    expect(gain100).toBeLessThan(gain10);
  });
});

describe("ease hell cannot happen", () => {
  test("difficulty stays inside bounds after a long failure streak", () => {
    let c = review(null, RATING.again);
    for (let i = 0; i < 50; i++) c = review(c, RATING.again, { now: c.lastReview + DAY });
    expect(c.difficulty).toBeLessThanOrEqual(10);
    expect(c.stability).toBeGreaterThan(0);
    expect(c.interval).toBeGreaterThanOrEqual(1); // still schedulable, never stuck
  });

  test("difficulty reverts toward easy rather than ratcheting one way forever", () => {
    // SM-2's failure mode: ease only ever falls. Here a run of Easy recovers it.
    let hard = review(null, RATING.again);
    for (let i = 0; i < 10; i++) hard = review(hard, RATING.again, { now: hard.lastReview + DAY });
    let recovered = hard;
    for (let i = 0; i < 10; i++) {
      recovered = review(recovered, RATING.easy, { now: recovered.lastReview + recovered.interval * DAY });
    }
    expect(recovered.difficulty).toBeLessThan(hard.difficulty);
  });
});

describe("same-day repeats", () => {
  test("re-reading within the day does not buy a full interval", () => {
    const first = review(null, RATING.good);
    const sameDay = review(first, RATING.good, { now: first.lastReview + 60 * 1000 });
    const nextDay = review(first, RATING.good, { now: first.lastReview + DAY });
    expect(sameDay.stability).toBeLessThan(nextDay.stability);
  });
});

describe("target retention feeds through to real scheduling", () => {
  test("exam-week retention pulls every card back sooner", () => {
    const c = review(null, RATING.good);
    const now = c.lastReview + c.interval * DAY;
    const relaxed = review(c, RATING.good, { now, retention: 0.85 }).interval;
    const strict = review(c, RATING.good, { now, retention: 0.95 }).interval;
    expect(strict).toBeLessThan(relaxed);
  });
});
