import { createStore, readRaw, writeRaw } from "./store";
import { prefersReducedMotion, syncMotion } from "../design/motion";
import { THEME_IDS } from "../design/themes";

const THEME_KEY = "kp_theme";
const SKIN_KEY = "kp_theme_skin";
const ACCENT_KEY = "kp_accent";
const BG_KEY = "kp_bg";
const SURFACE_KEY = "kp_surface";

const hex6 = (v) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : "");

const initial = readRaw(THEME_KEY) === "light" ? "light" : "dark";
const storedSkin = readRaw(SKIN_KEY, "neumorphism");
const initialSkin = THEME_IDS.includes(storedSkin) ? storedSkin : "neumorphism";
const initialAccent = hex6(readRaw(ACCENT_KEY, ""));
const initialBg = hex6(readRaw(BG_KEY, ""));
const initialSurface = hex6(readRaw(SURFACE_KEY, ""));

export const themeStore = createStore({
  theme: initial,
  skin: initialSkin,
  accent: initialAccent,
  bg: initialBg,
  surface: initialSurface,
});

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

/* ── Custom surface overrides ──
   Every theme card shows three swatches — page, panel, accent — and each one
   is independently overridable. Deriving all three from a single colour is what
   flattens an interface into one wash; keeping them separate is what lets a
   palette stay a palette. Within a swatch the derived steps still follow the
   token set's own direction: the deep well darkens, the raised panels lighten.
   Empty string → remove that override, falling back to the skin's own value. */
const BG_VARS = ["--bg", "--bg-deep"];
const SURFACE_VARS = ["--surface", "--surface-2", "--surface-3"];
const INK_VARS = ["--text-hi", "--text", "--text-dim", "--text-faint"];

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const mixFrom = (hex, pct, towards) => `color-mix(in srgb, ${hex} ${pct}%, ${towards})`;

function stampBg(hex) {
  const root = document.documentElement.style;
  if (!hex) return BG_VARS.forEach((v) => root.removeProperty(v));
  root.setProperty("--bg", hex);
  root.setProperty("--bg-deep", mixFrom(hex, 88, "black"));
}

function stampSurface(hex) {
  const root = document.documentElement.style;
  if (!hex) return SURFACE_VARS.forEach((v) => root.removeProperty(v));
  root.setProperty("--surface", hex);
  root.setProperty("--surface-2", mixFrom(hex, 93, "white"));
  root.setProperty("--surface-3", mixFrom(hex, 86, "white"));
}

/**
 * Text is deliberately left alone — a skin's tinted ink is part of its
 * character, and recolouring it was never what was asked for. The one
 * exception is an override that flips the theme's polarity (a pale panel under
 * a dark theme), where leaving the ink would render the interface unreadable.
 */
function syncInk(bg, surface) {
  const root = document.documentElement.style;
  const ref = surface || bg; // most text sits on panels, not on the page
  if (!ref) return INK_VARS.forEach((v) => root.removeProperty(v));
  const light = luminance(ref) > 0.5;
  if (light !== (document.documentElement.dataset.theme !== "light")) {
    return INK_VARS.forEach((v) => root.removeProperty(v));
  }
  const ink = light
    ? ["#12141a", "#333844", "#5c6473", "#8a919e"]
    : ["#f0f2f6", "#c3c8d2", "#8b93a1", "#5e6673"];
  INK_VARS.forEach((v, i) => root.setProperty(v, ink[i]));
}

function applySurfaces(bg, surface) {
  stampBg(bg);
  stampSurface(surface);
  syncInk(bg, surface);
}

export function setBg(hex) {
  const v = hex || "";
  writeRaw(BG_KEY, v);
  themeStore.set({ bg: v });
  applySurfaces(v, themeStore.get().surface);
}

export function setSurface(hex) {
  const v = hex || "";
  writeRaw(SURFACE_KEY, v);
  themeStore.set({ surface: v });
  applySurfaces(themeStore.get().bg, v);
}

/** Drop every colour override at once, back to the skin as its designer set it. */
export function resetColors() {
  setAccent("");
  writeRaw(BG_KEY, "");
  writeRaw(SURFACE_KEY, "");
  themeStore.set({ bg: "", surface: "" });
  applySurfaces("", "");
}

stamp(initial);
stampSkin(initialSkin);
stampAccent(initialAccent);
applySurfaces(initialBg, initialSurface);

export function setTheme(theme) {
  stamp(theme);
  writeRaw(THEME_KEY, theme);
  syncMotion();
  // The ink guard keys off the theme's polarity, so re-derive it after the flip.
  const { bg, surface } = themeStore.get();
  syncInk(bg, surface);
  themeStore.set({ theme });
}

export function setSkin(skin) {
  if (!THEME_IDS.includes(skin)) return;
  stampSkin(skin);
  writeRaw(SKIN_KEY, skin);
  // Framer-motion reads its timing from the skin's CSS tokens, so it has to be
  // resynced after the attribute lands or the new skin keeps the old motion.
  syncMotion();
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
