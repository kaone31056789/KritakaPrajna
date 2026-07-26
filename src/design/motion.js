// Soft Machine motion library — Emil Kowalski's rules encoded as shared constants.
// UI animations: <300ms, transform/opacity only, custom curves, no keyboard-action animation.
//
// These are LIVE bindings, resynced whenever the skin changes.
//
// Every skin in themes.css already declares its own timing and easing — Swiss
// runs at 90ms on a flat curve, Vaporwave drifts at 380ms, Memphis wobbles on
// cubic-bezier(0.68, -0.4, 0.32, 1.4). CSS transitions honoured all of that;
// framer-motion did not, because these were hardcoded numbers. Since Framer
// drives everything memorable — modals, view changes, the island, list
// reordering, the card reveal — all twenty skins moved identically no matter
// which one you picked. Reading the tokens here activates every personality
// at once, across all eighteen files that import this module.

const FALLBACK = {
  ease: [0.23, 1, 0.32, 1],
  fast: 0.12,
  base: 0.18,
  slow: 0.26,
  modal: 0.32,
  bounce: 0.15,
};

export let EASE_OUT = FALLBACK.ease;
export let T_FAST = FALLBACK.fast;
export let T = FALLBACK.base;
export let T_SLOW = FALLBACK.slow;

// Apple-style springs — easier to reason about than stiffness/damping
export let SPRING_SNAPPY = { type: "spring", duration: 0.45, bounce: FALLBACK.bounce };
export let SPRING_ISLAND = { type: "spring", duration: 0.5, bounce: 0.3 };

// ── Shared variants ──
export let modalPop = {};
export let backdropFade = {};

/** "300ms" / "0.3s" → 0.3 seconds. */
function seconds(raw, fallback) {
  const v = String(raw || "").trim();
  if (!v) return fallback;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith("ms") ? n / 1000 : n;
}

/** "cubic-bezier(.34, 1.56, .64, 1)" → [0.34, 1.56, 0.64, 1]. */
function bezier(raw, fallback) {
  const m = String(raw || "").match(/cubic-bezier\(([^)]+)\)/);
  if (!m) return fallback;
  const parts = m[1].split(",").map((n) => parseFloat(n.trim()));
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : fallback;
}

/**
 * How much a spring should overshoot, inferred from the skin's own curve.
 *
 * A control point above 1 means the designer already asked for overshoot —
 * Claymorphism peaks at 1.7, Memphis at 1.4, Swiss and Brutalism never exceed
 * 1. Deriving bounce from that keeps springs and CSS transitions telling the
 * same story without a second set of tokens to maintain.
 */
function bounceFrom(curve) {
  const peak = Math.max(curve[1], curve[3]);
  if (peak <= 1) return 0;
  return Math.min(0.5, (peak - 1) * 0.45);
}

function rebuild({ ease, fast, base, slow, modal, bounce }) {
  EASE_OUT = ease;
  T_FAST = fast;
  T = base;
  T_SLOW = slow;
  SPRING_SNAPPY = { type: "spring", duration: slow + 0.2, bounce };
  SPRING_ISLAND = { type: "spring", duration: modal, bounce: Math.max(bounce, 0.18) };

  modalPop = {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: { duration: slow, ease } },
    exit: { opacity: 0, scale: 0.97, transition: { duration: fast, ease } },
  };
  backdropFade = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: slow, ease } },
    exit: { opacity: 0, transition: { duration: fast } },
  };
}

/** Re-read the active skin's tokens. Call after the skin or theme changes. */
export function syncMotion() {
  if (typeof window === "undefined" || !document?.documentElement) {
    rebuild(FALLBACK);
    return;
  }
  const css = getComputedStyle(document.documentElement);
  const ease = bezier(css.getPropertyValue("--ease-out"), FALLBACK.ease);
  rebuild({
    ease,
    fast: seconds(css.getPropertyValue("--t-fast"), FALLBACK.fast),
    base: seconds(css.getPropertyValue("--t"), FALLBACK.base),
    slow: seconds(css.getPropertyValue("--t-slow"), FALLBACK.slow),
    modal: seconds(css.getPropertyValue("--t-modal"), FALLBACK.modal),
    bounce: bounceFrom(ease),
  });
}

syncMotion();

export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Exported for tests — the parsing is where this quietly goes wrong.
export const __parse = { seconds, bezier, bounceFrom };
