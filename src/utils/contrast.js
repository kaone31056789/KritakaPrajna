/* WCAG 2.x relative luminance and contrast ratio.
   Used to warn when a chosen colour pair is unreadable, and to pick the ink
   that sits on top of an accent. */

export function parseColor(input) {
  const s = String(input || "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split("");
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

export function luminance(color) {
  const rgb = Array.isArray(color) ? color : parseColor(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 1 (identical) … 21 (black on white). Null when either colour is unparseable. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever is actually readable on the given background. */
export function readableInk(bg) {
  const onWhite = contrastRatio(bg, "#ffffff");
  const onBlack = contrastRatio(bg, "#000000");
  if (onWhite === null || onBlack === null) return "#ffffff";
  return onWhite >= onBlack ? "#ffffff" : "#101216";
}

/** WCAG grade for normal-size body text. */
export function contrastGrade(ratio) {
  if (ratio === null) return { level: "?", ok: false, label: "unknown" };
  if (ratio >= 7) return { level: "AAA", ok: true, label: `${ratio.toFixed(1)}:1` };
  if (ratio >= 4.5) return { level: "AA", ok: true, label: `${ratio.toFixed(1)}:1` };
  if (ratio >= 3) return { level: "AA Large", ok: false, label: `${ratio.toFixed(1)}:1` };
  return { level: "Fail", ok: false, label: `${ratio.toFixed(1)}:1` };
}
