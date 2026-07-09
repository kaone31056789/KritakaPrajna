// Soft Machine motion library — Emil Kowalski's rules encoded as shared constants.
// UI animations: <300ms, transform/opacity only, custom curves, no keyboard-action animation.

export const EASE_OUT = [0.23, 1, 0.32, 1];
export const EASE_IN_OUT = [0.77, 0, 0.175, 1];
export const EASE_DRAWER = [0.32, 0.72, 0, 1];

export const T_FAST = 0.12;
export const T = 0.18;
export const T_SLOW = 0.26;
export const T_MODAL = 0.32;

// Apple-style springs — easier to reason about than stiffness/damping
export const SPRING_SNAPPY = { type: "spring", duration: 0.45, bounce: 0.15 };
export const SPRING_SOFT = { type: "spring", duration: 0.6, bounce: 0.22 };
export const SPRING_ISLAND = { type: "spring", duration: 0.5, bounce: 0.3 };

// ── Shared variants ──

// Nothing enters from scale(0); start ≥0.95 with opacity
export const scaleIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97, transition: { duration: T_FAST, ease: EASE_OUT } },
  transition: { duration: T, ease: EASE_OUT },
};

export const fadeUp = (dist = 8) => ({
  initial: { opacity: 0, y: dist },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: dist / 2, transition: { duration: T_FAST, ease: EASE_OUT } },
  transition: { duration: T, ease: EASE_OUT },
});

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: T_FAST } },
  transition: { duration: T, ease: EASE_OUT },
};

// Modal: centered origin, scale + fade (exit faster than enter)
export const modalPop = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { duration: T_SLOW, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.15, ease: EASE_OUT } },
};

export const backdropFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: T_SLOW, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// Staggered list entrance — 40ms between items, decorative only
export const staggerParent = {
  animate: { transition: { staggerChildren: 0.04 } },
};
export const staggerChild = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: T, ease: EASE_OUT } },
};

export const pageTransition = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.22, ease: EASE_OUT },
};

export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
