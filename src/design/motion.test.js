import { __parse, syncMotion, T, T_FAST, EASE_OUT, SPRING_SNAPPY } from "./motion";

const { seconds, bezier, bounceFrom } = __parse;

/* The parsing is where this quietly goes wrong: a bad unit or a dropped
   control point does not throw, it just makes every skin move the same again. */

describe("token parsing", () => {
  test("ms and s both land in seconds", () => {
    expect(seconds("300ms", 9)).toBeCloseTo(0.3);
    expect(seconds("90ms", 9)).toBeCloseTo(0.09);
    expect(seconds("0.42s", 9)).toBeCloseTo(0.42);
    expect(seconds("  260ms  ", 9)).toBeCloseTo(0.26);
  });

  test("an absent or unreadable token falls back rather than yielding NaN", () => {
    expect(seconds("", 0.18)).toBe(0.18);
    expect(seconds(undefined, 0.18)).toBe(0.18);
    expect(seconds("fast", 0.18)).toBe(0.18);
  });

  test("cubic-bezier parses, including the negative and >1 control points", () => {
    // Memphis: undershoot then overshoot — the wobble.
    expect(bezier("cubic-bezier(0.68, -0.4, 0.32, 1.4)", null)).toEqual([0.68, -0.4, 0.32, 1.4]);
    expect(bezier("cubic-bezier(.25,1,.5,1)", null)).toEqual([0.25, 1, 0.5, 1]);
  });

  test("easing keywords and junk fall back to the house curve", () => {
    const fb = [0.23, 1, 0.32, 1];
    expect(bezier("ease-in-out", fb)).toBe(fb);
    expect(bezier("cubic-bezier(1,2)", fb)).toBe(fb);
    expect(bezier("", fb)).toBe(fb);
  });
});

describe("bounce inferred from the skin's own curve", () => {
  test("flat curves get no bounce at all", () => {
    expect(bounceFrom([0.25, 1, 0.5, 1])).toBe(0); // minimalism
    expect(bounceFrom([0.2, 0, 0, 1])).toBe(0); // brutalism
    expect(bounceFrom([0.4, 0, 0.6, 1])).toBe(0); // flat
  });

  test("overshooting curves bounce in proportion to their overshoot", () => {
    const clay = bounceFrom([0.34, 1.7, 0.5, 1]); // claymorphism — squish
    const max = bounceFrom([0.34, 1.56, 0.64, 1]); // maximalism
    const retro = bounceFrom([0.7, -0.15, 0.3, 1.15]); // retrofuturism — gentle
    expect(clay).toBeGreaterThan(max);
    expect(max).toBeGreaterThan(retro);
    expect(retro).toBeGreaterThan(0);
  });

  test("bounce is capped so no skin turns into a trampoline", () => {
    expect(bounceFrom([0, 9, 0, 9])).toBeLessThanOrEqual(0.5);
  });
});

describe("live resync", () => {
  const applySkin = (vars) => {
    const el = document.documentElement;
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    syncMotion();
  };

  afterEach(() => {
    document.documentElement.style.cssText = "";
    syncMotion();
  });

  test("switching skin changes the exported timing, not just the CSS", () => {
    applySkin({ "--t": "90ms", "--t-fast": "60ms", "--t-slow": "140ms", "--t-modal": "190ms" });
    expect(T).toBeCloseTo(0.09); // swiss — precise and flat
    expect(T_FAST).toBeCloseTo(0.06);

    applySkin({ "--t": "380ms", "--t-fast": "220ms", "--t-slow": "520ms", "--t-modal": "680ms" });
    expect(T).toBeCloseTo(0.38); // vaporwave — dreamy drift
  });

  test("a skin's easing reaches framer-motion", () => {
    applySkin({ "--ease-out": "cubic-bezier(0.34, 1.7, 0.5, 1)" });
    expect(EASE_OUT).toEqual([0.34, 1.7, 0.5, 1]);
    expect(SPRING_SNAPPY.bounce).toBeGreaterThan(0); // clay springs
  });

  test("a skin with no overshoot produces a spring that does not bounce", () => {
    applySkin({ "--ease-out": "cubic-bezier(0.2, 0, 0, 1)", "--t-slow": "170ms" });
    expect(SPRING_SNAPPY.bounce).toBe(0); // brutalism — instant snap
  });
});
