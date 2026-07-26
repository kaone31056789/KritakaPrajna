import React, { useCallback, useEffect, useRef } from "react";
import { useMotionValue, useSpring, useReducedMotion } from "framer-motion";

/* ═══ Text effects ═══════════════════════════════════════════════════════
   Adapted from React Bits (reactbits.dev, MIT + Commons Clause) to run on
   the framer-motion already in this app rather than pulling in `motion`,
   `gsap` or `ogl` — the upstream components import `motion/react`, which is
   the same library under its newer package name.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A number that springs to its new value instead of snapping.
 *
 * Writes through a ref rather than React state on purpose: a spring emits on
 * every frame, and re-rendering the tree sixty times a second to change one
 * digit is exactly the kind of cost a counter should not impose.
 */
export function CountUp({ to, from = 0, duration = 1, delay = 0, separator = ",", className = "" }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const value = useMotionValue(from);
  const spring = useSpring(value, {
    damping: 20 + 40 * (1 / duration),
    stiffness: 100 * (1 / duration),
  });

  const decimals = Math.max(dp(from), dp(to));
  const format = useCallback(
    (n) =>
      Intl.NumberFormat("en-US", {
        useGrouping: !!separator,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
        .format(n)
        .replace(/,/g, separator),
    [decimals, separator]
  );

  useEffect(() => {
    if (reduced) {
      if (ref.current) ref.current.textContent = format(to);
      return;
    }
    if (!delay) {
      value.set(to);
      return;
    }
    // Lets a counter start in step with a sibling animation (a ring sweep, say).
    const t = setTimeout(() => value.set(to), delay * 1000);
    return () => clearTimeout(t);
  }, [to, value, reduced, format, delay]);

  useEffect(() => spring.on("change", (n) => {
    if (ref.current) ref.current.textContent = format(n);
  }), [spring, format]);

  return <span ref={ref} className={className}>{format(reduced ? to : from)}</span>;
}

function dp(n) {
  const s = String(n);
  if (!s.includes(".")) return 0;
  const d = s.split(".")[1];
  return parseInt(d, 10) === 0 ? 0 : d.length;
}

/**
 * A sheen travelling across the text, masked to the glyphs themselves.
 *
 * The upstream version drives this per-frame through a motion value. This app
 * already ships the identical effect as `.reason-shimmer` (index.css) — a
 * background-position keyframe that runs on the compositor for no JS at all,
 * which matters when it runs for minutes during a long read. Reuse it rather
 * than shipping a second copy; only the duration is worth parameterising.
 */
export function ShinyText({ children, active = true, speed = 2.4, className = "" }) {
  const reduced = useReducedMotion();
  if (!active || reduced) return <span className={className}>{children}</span>;
  return (
    <span className={`reason-shimmer ${className}`} style={{ animationDuration: `${speed}s` }}>
      {children}
    </span>
  );
}
