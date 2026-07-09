import { createStore, readRaw, writeRaw } from "./store";
import { prefersReducedMotion } from "../design/motion";

const THEME_KEY = "kp_theme";

const initial = readRaw(THEME_KEY) === "light" ? "light" : "dark";

export const themeStore = createStore({ theme: initial });

function stamp(theme) {
  document.documentElement.dataset.theme = theme;
}

stamp(initial);

export function setTheme(theme) {
  stamp(theme);
  writeRaw(THEME_KEY, theme);
  themeStore.set({ theme });
}

/**
 * Theme morph: circular View Transition reveal expanding from the toggle.
 * Falls back to a plain swap when unsupported or reduced-motion.
 */
export function toggleTheme(originX, originY) {
  const next = themeStore.get().theme === "dark" ? "light" : "dark";

  if (!document.startViewTransition || prefersReducedMotion() || originX == null) {
    setTheme(next);
    return;
  }

  const vt = document.startViewTransition(() => setTheme(next));
  vt.ready
    .then(() => {
      const r = Math.hypot(
        Math.max(originX, window.innerWidth - originX),
        Math.max(originY, window.innerHeight - originY)
      );
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${originX}px ${originY}px)`,
            `circle(${r}px at ${originX}px ${originY}px)`,
          ],
        },
        {
          duration: 480,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    })
    .catch(() => {});
}
