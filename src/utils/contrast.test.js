import { contrastRatio, readableInk, contrastGrade, parseColor } from "./contrast";

describe("contrast", () => {
  test("the two anchors of the scale", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#888888", "#888888")).toBeCloseTo(1, 5);
  });

  test("reads the colour forms the pickers actually emit", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("#ffb454")).toEqual([255, 180, 84]);
    expect(parseColor("rgb(255, 180, 84)")).toEqual([255, 180, 84]);
    expect(parseColor("rgba(255,180,84,0.5)")).toEqual([255, 180, 84]);
    expect(parseColor("not a colour")).toBeNull();
    expect(contrastRatio("nope", "#fff")).toBeNull();
  });

  test("ink is chosen for readability, not for taste", () => {
    // The brand accent is light enough that black text wins on it.
    expect(readableInk("#ffb454")).toBe("#101216");
    expect(readableInk("#101216")).toBe("#ffffff");
  });

  test("grades match the WCAG thresholds", () => {
    expect(contrastGrade(21).level).toBe("AAA");
    expect(contrastGrade(7).level).toBe("AAA");
    expect(contrastGrade(4.5).level).toBe("AA");
    expect(contrastGrade(4.49).ok).toBe(false);
    expect(contrastGrade(2.9).level).toBe("Fail");
    expect(contrastGrade(null).ok).toBe(false);
  });

  test("the app's own ink ladder grades as designed", () => {
    // Measured against the default dark background, not assumed:
    // text-hi 15.6 · text 9.4 · text-dim 4.7 · text-faint 2.7
    const on = (fg) => contrastGrade(contrastRatio(fg, "#16181d"));
    expect(on("#eef0f4").level).toBe("AAA");
    expect(on("#b7bdc9").level).toBe("AAA");
    expect(on("#7c8494").ok).toBe(true); // 4.72 — scrapes AA
    expect(on("#565e6d").ok).toBe(false); // 2.72 — decorative only, and the warning says so
  });
});
