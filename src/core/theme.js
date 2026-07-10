import { createStore, readRaw, writeRaw } from "./store";
import { prefersReducedMotion } from "../design/motion";
import { THEME_IDS } from "../design/themes";

const THEME_KEY = "kp_theme";
const SKIN_KEY = "kp_theme_skin";

const initial = readRaw(THEME_KEY) === "light" ? "light" : "dark";
const storedSkin = readRaw(SKIN_KEY, "neumorphism");
const initialSkin = THEME_IDS.includes(storedSkin) ? storedSkin : "neumorphism";

export const themeStore = createStore({ theme: initial, skin: initialSkin });

function stamp(theme) {
  document.documentElement.dataset.theme = theme;
}

function stampSkin(skin) {
  document.documentElement.dataset.skin = skin;
}

stamp(initial);
stampSkin(initialSkin);

export function setTheme(theme) {
  stamp(theme);
  writeRaw(THEME_KEY, theme);
  themeStore.set({ theme });
}

export function setSkin(skin) {
  if (!THEME_IDS.includes(skin)) return;
  stampSkin(skin);
  writeRaw(SKIN_KEY, skin);
  themeStore.set({ skin });
}

/** Skin swap with a soft crossfade (View Transitions when available). */
export function switchSkin(skin) {
  if (themeStore.get().skin === skin) return;
  if (!document.startViewTransition || prefersReducedMotion()) {
    setSkin(skin);
    return;
  }
  document.startViewTransition(() => setSkin(skin));
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
