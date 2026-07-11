import { createStore, readRaw, writeRaw } from "./store";
import { prefersReducedMotion } from "../design/motion";
import { THEME_IDS } from "../design/themes";

const THEME_KEY = "kp_theme";
const SKIN_KEY = "kp_theme_skin";
const ACCENT_KEY = "kp_accent";

const initial = readRaw(THEME_KEY) === "light" ? "light" : "dark";
const storedSkin = readRaw(SKIN_KEY, "neumorphism");
const initialSkin = THEME_IDS.includes(storedSkin) ? storedSkin : "neumorphism";
const initialAccent = /^#[0-9a-fA-F]{6}$/.test(readRaw(ACCENT_KEY, "")) ? readRaw(ACCENT_KEY, "") : "";

export const themeStore = createStore({ theme: initial, skin: initialSkin, accent: initialAccent });

function stamp(theme) {
  document.documentElement.dataset.theme = theme;
}

function stampSkin(skin) {
  document.documentElement.dataset.skin = skin;
}

/* ── Custom accent override ──
   Sets inline CSS vars derived from one hex so it layers over ANY skin.
   Empty string → remove overrides, falling back to the skin's own accent. */
const ACCENT_VARS = ["--accent", "--accent-2", "--accent-soft", "--accent-glow", "--accent-ink"];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function stampAccent(hex) {
  const root = document.documentElement.style;
  if (!hex) {
    ACCENT_VARS.forEach((v) => root.removeProperty(v));
    return;
  }
  const [r, g, b] = hexToRgb(hex);
  // Relative luminance → pick readable ink on top of the accent
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  root.setProperty("--accent", hex);
  root.setProperty("--accent-2", `color-mix(in srgb, ${hex} 72%, white)`);
  root.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.14)`);
  root.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.38)`);
  root.setProperty("--accent-ink", lum > 0.55 ? "#101216" : "#ffffff");
}

export function setAccent(hex) {
  stampAccent(hex);
  writeRaw(ACCENT_KEY, hex || "");
  themeStore.set({ accent: hex || "" });
}

stamp(initial);
stampSkin(initialSkin);
stampAccent(initialAccent);

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
