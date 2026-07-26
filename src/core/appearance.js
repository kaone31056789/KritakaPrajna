import { createStore, readJSON, writeJSON } from "./store";
import { themeStore, setTheme, setSkin, setAccent, setBg, setSurface } from "./theme";

/* ═══ Appearance ════════════════════════════════════════════════════════════
   Everything about how the app looks that is NOT already owned by theme.js.

   theme.js stays the owner of mode / skin / accent / bg / surface — the rest
   of the app imports it and must keep working. This module owns the newer
   dimensions (shape, type, motion, background, accessibility, custom themes)
   and, because undo has to span both, the history stack for the pair.

   Everything here resolves to CSS custom properties stamped on <html>, so a
   setting is never "a value in a store that a component happens to read": it
   is a token the whole interface already consumes.
   ═══════════════════════════════════════════════════════════════════════════ */

const KEY = "kp_appearance";
const CUSTOM_KEY = "kp_custom_themes";

/* ── Defaults ──────────────────────────────────────────────────────────────
   Each group is resettable on its own, so they are declared as groups. */

export const DEFAULTS = {
  mode: "dark", // dark | light | system | oled | auto
  shape: {
    radius: 1, // multiplier on the skin's own radii
    elevation: 1, // multiplier on shadow spread
    shadow: 1, // multiplier on shadow opacity
    border: true,
    borderWidth: 1,
    blur: 0, // px of backdrop blur on glass surfaces
    transparency: 0, // 0..1 — how see-through panels are
    density: "comfortable", // compact | comfortable | spacious
  },
  type: {
    ui: "", // "" = the skin's own font
    reading: "",
    mono: "",
    size: 1, // multiplier on root font size
    weight: 0, // -1 lighter · 0 as designed · +1 heavier
    lineHeight: 1,
    letterSpacing: 0, // em
    headingScale: 1,
  },
  motion: {
    level: "full", // full | reduced | none
    intensity: 1,
    speed: 1, // >1 = faster
    transition: "fade", // fade | slide | scale | none
    hover: 1,
  },
  background: {
    kind: "solid", // solid | gradient | mesh | image
    noise: 0,
    blur: 0,
    brightness: 1,
    opacity: 1,
    image: "",
  },
  a11y: {
    highContrast: false,
    textScale: 1,
    strongFocus: false,
    reduceTransparency: false,
    reduceMotion: false,
    colorBlind: "none", // none | protanopia | deuteranopia | tritanopia
  },
  favourites: [],
  recent: [],
  recentAccents: [],
};

/* ── Loading ───────────────────────────────────────────────────────────────
   Stored settings are user data from an older build: never trust their shape.
   Merge group-by-group against the defaults so a missing or corrupt group
   costs that group only, not the whole appearance. */

function mergeGroup(defaults, saved) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...defaults };
  const out = { ...defaults };
  for (const k of Object.keys(defaults)) {
    const v = saved[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== typeof defaults[k]) continue; // wrong type — keep the default
    out[k] = v;
  }
  return out;
}

function load() {
  const saved = readJSON(KEY, null);
  if (!saved || typeof saved !== "object") return { ...DEFAULTS };
  return {
    mode: ["dark", "light", "system", "oled", "auto"].includes(saved.mode) ? saved.mode : DEFAULTS.mode,
    shape: mergeGroup(DEFAULTS.shape, saved.shape),
    type: mergeGroup(DEFAULTS.type, saved.type),
    motion: mergeGroup(DEFAULTS.motion, saved.motion),
    background: mergeGroup(DEFAULTS.background, saved.background),
    a11y: mergeGroup(DEFAULTS.a11y, saved.a11y),
    favourites: Array.isArray(saved.favourites) ? saved.favourites.filter((x) => typeof x === "string") : [],
    recent: Array.isArray(saved.recent) ? saved.recent.filter((x) => typeof x === "string") : [],
    recentAccents: Array.isArray(saved.recentAccents)
      ? saved.recentAccents.filter((x) => typeof x === "string").slice(0, 12)
      : [],
  };
}

function loadCustom() {
  const saved = readJSON(CUSTOM_KEY, null);
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

export const appearanceStore = createStore({
  ...load(),
  custom: loadCustom(),
});

/* ── The tokens a custom theme may override ────────────────────────────────
   Deliberately the ones with a plain visual meaning — the neumorphic shadow
   pairs are derived, not hand-set, so they are not on this list. */

export const CUSTOM_TOKENS = [
  { key: "bg", varName: "--bg", label: "App background" },
  { key: "bgDeep", varName: "--bg-deep", label: "Sidebar background" },
  { key: "surface", varName: "--surface", label: "Elevated surface" },
  { key: "surface2", varName: "--surface-2", label: "Input background" },
  { key: "surface3", varName: "--surface-3", label: "Button background" },
  { key: "textHi", varName: "--text-hi", label: "Primary text" },
  { key: "text", varName: "--text", label: "Secondary text" },
  { key: "textDim", varName: "--text-dim", label: "Muted text" },
  { key: "line", varName: "--line", label: "Border color" },
  { key: "accent", varName: "--accent", label: "Accent color" },
  { key: "accent2", varName: "--accent-2", label: "Accent hover" },
  { key: "ok", varName: "--ok", label: "Success" },
  { key: "err", varName: "--err", label: "Error" },
  { key: "info", varName: "--info", label: "Information" },
  { key: "accentSoft", varName: "--accent-soft", label: "Selection color" },
  { key: "synText", varName: "--syn-text", label: "Code text" },
  { key: "backdrop", varName: "--backdrop", label: "Code block background" },
];

/* The five that change how the app actually looks. The other twelve are for
   someone building a theme in earnest, and stay behind "Show all". */
export const ESSENTIAL_TOKENS = ["bg", "surface", "textHi", "accent", "line"];

export const THEME_CATEGORIES = {
  neumorphism: "Soft",
  claymorphism: "Soft",
  glassmorphism: "Soft",
  "liquid-glass": "Soft",
  minimalism: "Minimal",
  monochrome: "Minimal",
  sandstone: "Minimal",
  "paper-circuit": "Minimal",
  maximalism: "Bold",
  brutalism: "Bold",
  neobrutalism: "Bold",
  memphis: "Bold",
  swiss: "Professional",
  bauhaus: "Professional",
  material: "Professional",
  flat: "Professional",
  "deep-ocean": "Professional",
  og: "Professional",
  y2k: "Retro",
  vaporwave: "Retro",
  synthwave: "Retro",
  retrofuturism: "Retro",
  skeuomorphism: "Retro",
  "terminal-amber": "Retro",
  cyberpunk: "Futuristic",
  "frutiger-aero": "Futuristic",
  "high-contrast": "Experimental",
};

export const CATEGORY_LIST = ["All", "Minimal", "Soft", "Bold", "Retro", "Futuristic", "Professional", "Experimental"];

/* ── Applying ──────────────────────────────────────────────────────────────
   Every managed property is cleared before the skin is read, so the values we
   scale from are always the skin's own and never last frame's output. This is
   the same trick syncMotion() uses for timing; the alternative — multiplying a
   variable by itself in calc() — is circular.
   ─────────────────────────────────────────────────────────────────────────── */

const MANAGED = [
  "--r-xs", "--r-sm", "--r", "--r-lg", "--r-xl",
  "--neu-raised-sm", "--neu-raised", "--neu-raised-lg", "--neu-inset", "--neu-inset-sm", "--neu-focus",
  "--line", "--line-strong",
  "--font-ui", "--font-display", "--font-mono",
  "--t-fast", "--t", "--t-slow", "--t-modal",
  "--kp-blur", "--kp-noise", "--kp-bg-image", "--kp-bg-brightness", "--kp-bg-opacity",
  "--kp-letter-spacing", "--kp-line-height", "--kp-heading-scale", "--kp-hover", "--kp-weight",
];

const px = (v) => `${Math.round(v * 100) / 100}px`;
const num = (v) => String(Math.round(v * 1000) / 1000);

function readBase(root, names) {
  for (const n of MANAGED) root.style.removeProperty(n);
  const cs = getComputedStyle(root);
  const out = {};
  for (const n of names) out[n] = cs.getPropertyValue(n).trim();
  return out;
}

const parsePx = (v, fallback) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

const parseMs = (v, fallback) => {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return String(v).trim().endsWith("ms") ? n : n * 1000;
};

/** Shadows the skin hand-tuned are left alone at 1×; past that we generate. */
function shadowSet(elevation, strength) {
  if (elevation === 1 && strength === 1) return null;
  if (elevation === 0 || strength === 0) {
    return {
      "--neu-raised-sm": "0 0 0 1px var(--line)",
      "--neu-raised": "0 0 0 1px var(--line)",
      "--neu-raised-lg": "0 0 0 1px var(--line-strong)",
      "--neu-inset": "inset 0 0 0 1px var(--line)",
      "--neu-inset-sm": "inset 0 0 0 1px var(--line)",
    };
  }
  const d = (n) => px(n * elevation);
  const a = (n) => num(Math.min(0.95, n * strength));
  const dark = (n, o) => `${d(n)} ${d(n)} ${d(n * 2.6)} rgba(5, 7, 11, ${a(o)})`;
  const lift = (n, o) => `${d(-n)} ${d(-n)} ${d(n * 2)} rgba(255, 255, 255, ${a(o)})`;
  return {
    "--neu-raised-sm": `${dark(3, 0.55)}, ${lift(2, 0.035)}`,
    "--neu-raised": `${dark(6, 0.6)}, ${lift(4, 0.04)}`,
    "--neu-raised-lg": `${dark(14, 0.65)}, ${lift(8, 0.045)}`,
    "--neu-inset": `inset ${dark(4, 0.6)}, inset ${lift(3, 0.035)}`,
    "--neu-inset-sm": `inset ${dark(2, 0.55)}, inset ${lift(2, 0.03)}`,
  };
}

const FONT_STACKS = {
  "": "",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  inter: "Inter, system-ui, sans-serif",
  jakarta: "'Plus Jakarta Sans', system-ui, sans-serif",
  grotesk: "'Space Grotesk', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', Consolas, monospace",
  rounded: "'Nunito', 'Segoe UI', system-ui, sans-serif",
};

/** A font the machine does not have must fall back, never collapse the layout. */
export const fontStack = (id) => FONT_STACKS[id] || "";

export function applyAppearance(state = appearanceStore.get()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const { shape, type, motion, background, a11y } = state;

  const base = readBase(root, [
    "--r-xs", "--r-sm", "--r", "--r-lg", "--r-xl",
    "--t-fast", "--t", "--t-slow", "--t-modal",
  ]);

  const set = (n, v) => (v === null || v === "" ? root.style.removeProperty(n) : root.style.setProperty(n, v));

  // Shape ────────────────────────────────────────────────────────────────────
  if (shape.radius !== 1) {
    const fallback = { "--r-xs": 8, "--r-sm": 12, "--r": 16, "--r-lg": 22, "--r-xl": 28 };
    for (const n of Object.keys(fallback)) set(n, px(parsePx(base[n], fallback[n]) * shape.radius));
  }
  const shadows = shadowSet(shape.elevation, shape.shadow);
  if (shadows) for (const [n, v] of Object.entries(shadows)) set(n, v);

  if (!shape.border) {
    set("--line", "transparent");
    set("--line-strong", "transparent");
  } else if (shape.borderWidth !== 1) {
    // Width is expressed through the ring helpers rather than the colour.
    set("--kp-border-width", px(shape.borderWidth));
  }

  const transparency = a11y.reduceTransparency ? 0 : shape.transparency;
  set("--kp-blur", a11y.reduceTransparency || !shape.blur ? null : px(shape.blur));
  set("--kp-surface-alpha", transparency ? num(1 - transparency) : null);

  // Type ─────────────────────────────────────────────────────────────────────
  set("--font-ui", fontStack(type.ui) || null);
  set("--font-display", fontStack(type.reading) || null);
  set("--font-mono", fontStack(type.mono) || null);
  const scale = type.size * (a11y.textScale || 1);
  root.style.fontSize = scale === 1 ? "" : `${Math.round(16 * scale)}px`;
  set("--kp-line-height", type.lineHeight !== 1 ? num(type.lineHeight) : null);
  set("--kp-letter-spacing", type.letterSpacing ? `${num(type.letterSpacing)}em` : null);
  set("--kp-heading-scale", type.headingScale !== 1 ? num(type.headingScale) : null);
  set("--kp-weight", type.weight ? String(type.weight > 0 ? 600 : 300) : null);

  // Motion ───────────────────────────────────────────────────────────────────
  const still = motion.level === "none" || a11y.reduceMotion;
  const damped = still ? 0 : motion.level === "reduced" ? 0.5 : motion.intensity;
  const speed = still ? 0 : Math.max(0.1, motion.speed);
  const fallbackMs = { "--t-fast": 120, "--t": 180, "--t-slow": 260, "--t-modal": 320 };
  for (const n of Object.keys(fallbackMs)) {
    set(n, still ? "0ms" : `${Math.round(parseMs(base[n], fallbackMs[n]) / speed)}ms`);
  }
  set("--kp-hover", still ? "0" : num(motion.hover * damped));

  // Background ───────────────────────────────────────────────────────────────
  set("--kp-noise", background.noise ? num(background.noise) : null);
  set("--kp-bg-brightness", background.brightness !== 1 ? num(background.brightness) : null);
  set("--kp-bg-opacity", background.opacity !== 1 ? num(background.opacity) : null);
  set("--kp-bg-image", background.kind === "image" && background.image ? `url("${background.image}")` : null);

  // Attributes CSS keys off ──────────────────────────────────────────────────
  const attrs = {
    "data-density": shape.density,
    "data-bg": background.kind,
    "data-motion": still ? "none" : motion.level,
    "data-transition": motion.transition,
    "data-contrast": a11y.highContrast ? "high" : null,
    "data-focus": a11y.strongFocus ? "strong" : null,
    "data-cvd": a11y.colorBlind !== "none" ? a11y.colorBlind : null,
    "data-flat": shape.elevation === 0 ? "true" : null,
    "data-glass": !a11y.reduceTransparency && (shape.blur > 0 || shape.transparency > 0) ? "true" : null,
  };
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) root.removeAttribute(k);
    else root.setAttribute(k, v);
  }
}

/* ── Modes ─────────────────────────────────────────────────────────────────
   theme.js only knows dark and light, which is the right vocabulary for it.
   The three modes on top are resolutions, not new palettes: system follows the
   OS, auto follows the clock, and OLED is dark with the page pushed to true
   black — a real difference on an OLED panel, where #000 costs no light. */

const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : true;

const nightNow = () => {
  const h = new Date().getHours();
  return h >= 19 || h < 7;
};

export function resolveMode(mode) {
  if (mode === "system") return prefersDark() ? "dark" : "light";
  if (mode === "auto") return nightNow() ? "dark" : "light";
  if (mode === "oled") return "dark";
  return mode === "light" ? "light" : "dark";
}

function applyMode(mode) {
  setTheme(resolveMode(mode));
  const root = document.documentElement;
  if (mode === "oled") {
    root.setAttribute("data-oled", "true");
    root.style.setProperty("--bg", "#000000");
    root.style.setProperty("--bg-deep", "#000000");
  } else {
    root.removeAttribute("data-oled");
    // Only clear what OLED set — a user's own background override must survive.
    const { bg } = themeStore.get();
    if (bg) setBg(bg);
    else {
      root.style.removeProperty("--bg");
      root.style.removeProperty("--bg-deep");
    }
  }
}

/* ── History ───────────────────────────────────────────────────────────────
   Undo has to span both stores or it lies: picking a theme and then nudging a
   slider are one sequence to the person doing it. */

const past = [];
const future = [];
const MAX_HISTORY = 50;

const snapshot = () => {
  const { theme, skin, accent, bg, surface } = themeStore.get();
  const { custom, ...rest } = appearanceStore.get();
  return { theme: { theme, skin, accent, bg, surface }, appearance: JSON.parse(JSON.stringify(rest)) };
};

export const historyStore = createStore({ canUndo: false, canRedo: false });
const syncHistory = () => historyStore.set({ canUndo: past.length > 0, canRedo: future.length > 0 });

function record() {
  past.push(snapshot());
  if (past.length > MAX_HISTORY) past.shift();
  future.length = 0;
  syncHistory();
}

function restore(snap) {
  const t = snap.theme;
  setSkin(t.skin);
  setAccent(t.accent);
  setBg(t.bg);
  setSurface(t.surface);
  appearanceStore.set({ ...snap.appearance, custom: appearanceStore.get().custom });
  applyMode(snap.appearance.mode);
  applyAppearance();
  persist();
}

export function undo() {
  if (!past.length) return;
  future.push(snapshot());
  restore(past.pop());
  syncHistory();
}

export function redo() {
  if (!future.length) return;
  past.push(snapshot());
  restore(future.pop());
  syncHistory();
}

/* ── Actions ─────────────────────────────────────────────────────────────── */

function persist() {
  const { custom, ...rest } = appearanceStore.get();
  writeJSON(KEY, rest);
}

/** The one path every setting change takes: record, mutate, stamp, persist. */
function commit(patch) {
  record();
  appearanceStore.set(patch);
  applyAppearance();
  persist();
}

export function setMode(mode) {
  if (!["dark", "light", "system", "oled", "auto"].includes(mode)) return;
  record();
  appearanceStore.set({ mode });
  applyMode(mode);
  applyAppearance();
  persist();
}

/** Patch one group (shape, type, motion, background, a11y) without clobbering it. */
export function setGroup(group, patch) {
  const cur = appearanceStore.get()[group];
  if (!cur) return;
  commit({ [group]: { ...cur, ...patch } });
}

export function resetSection(group) {
  if (!DEFAULTS[group]) return;
  commit({ [group]: { ...DEFAULTS[group] } });
}

export function resetAll() {
  record();
  const { custom, favourites, recent } = appearanceStore.get();
  appearanceStore.set({ ...DEFAULTS, custom, favourites, recent });
  setAccent("");
  setBg("");
  setSurface("");
  applyCustomTokens(null);
  applyMode(DEFAULTS.mode);
  applyAppearance();
  persist();
}

export function applyPreset(skinId) {
  record();
  setSkin(skinId);
  const { recent } = appearanceStore.get();
  appearanceStore.set({ recent: [skinId, ...recent.filter((r) => r !== skinId)].slice(0, 6) });
  applyAppearance(); // the new skin's radii and timings are the base we scale from
  persist();
}

export function toggleFavourite(skinId) {
  const { favourites } = appearanceStore.get();
  const next = favourites.includes(skinId) ? favourites.filter((f) => f !== skinId) : [...favourites, skinId];
  appearanceStore.set({ favourites: next });
  persist();
}

/* ── Custom themes ───────────────────────────────────────────────────────── */

function persistCustom(custom) {
  appearanceStore.set({ custom });
  writeJSON(CUSTOM_KEY, custom);
}

const TOKEN_KEYS = new Set(CUSTOM_TOKENS.map((t) => t.key));

/** Stamp a custom theme's tokens; pass null to clear them. */
export function applyCustomTokens(tokens) {
  const root = document.documentElement;
  for (const t of CUSTOM_TOKENS) {
    const v = tokens ? tokens[t.key] : "";
    if (v) root.style.setProperty(t.varName, v);
    else root.style.removeProperty(t.varName);
  }
}

export function updateToken(id, key, value) {
  if (!TOKEN_KEYS.has(key)) return;
  const custom = appearanceStore.get().custom;
  const theme = custom[id];
  if (!theme) return;
  record();
  const tokens = { ...theme.tokens };
  if (value) tokens[key] = value;
  else delete tokens[key];
  persistCustom({ ...custom, [id]: { ...theme, tokens } });
  applyCustomTokens(tokens);
}

export function saveCustomTheme(opts) {
  const custom = appearanceStore.get().custom;
  const key = opts.id || `custom-${Date.now().toString(36)}`;
  const entry = {
    id: key,
    name: opts.name || "My theme",
    from: opts.from || themeStore.get().skin,
    tokens: opts.tokens || {},
  };
  persistCustom({ ...custom, [key]: entry });
  return key;
}

export function deleteCustomTheme(id) {
  const custom = appearanceStore.get().custom;
  if (!custom[id]) return;
  const rest = { ...custom };
  delete rest[id];
  persistCustom(rest);
  applyCustomTokens(null);
}

const COLOR_VALUE = /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([^)]*\)|transparent)$/;

/**
 * Validate before applying, never after. An imported file is untrusted input:
 * an unchecked value here would be written straight into a live CSS variable.
 */
export function importTheme(json) {
  let parsed;
  try {
    parsed = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return { ok: false, error: "That is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "Expected a theme object." };
  if (parsed.kind && parsed.kind !== "kritakaprajna-theme") {
    return { ok: false, error: "That JSON is not a KritakaPrajna theme." };
  }
  const src = parsed.tokens && typeof parsed.tokens === "object" ? parsed.tokens : parsed;
  const tokens = {};
  const rejected = [];
  for (const k of Object.keys(src)) {
    if (!TOKEN_KEYS.has(k)) continue;
    const v = src[k];
    if (typeof v !== "string" || !COLOR_VALUE.test(v.trim())) {
      rejected.push(k);
      continue;
    }
    tokens[k] = v.trim();
  }
  if (!Object.keys(tokens).length) return { ok: false, error: "No usable colour tokens found in that file." };
  const id = saveCustomTheme({
    name: String(parsed.name || "Imported theme").slice(0, 40),
    tokens,
    from: parsed.from,
  });
  return { ok: true, id, imported: Object.keys(tokens).length, rejected };
}

export function exportTheme(id) {
  const theme = appearanceStore.get().custom[id];
  if (!theme) return "";
  const payload = {
    kind: "kritakaprajna-theme",
    version: 1,
    name: theme.name,
    from: theme.from,
    tokens: theme.tokens,
  };
  return JSON.stringify(payload, null, 2);
}

/* ── Boot ──────────────────────────────────────────────────────────────────
   Runs at import time, before React mounts, so a saved appearance is already
   stamped at first paint rather than flashing the default theme first. */

if (typeof document !== "undefined") {
  applyMode(appearanceStore.get().mode);
  applyAppearance();
  syncHistory();

  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (appearanceStore.get().mode === "system") applyMode("system");
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  // The clock mode only has to be right to the minute.
  setInterval(() => {
    if (appearanceStore.get().mode === "auto") applyMode("auto");
  }, 60000);
}

/** Accent history, so a colour you liked is one click away rather than re-picked. */
export function rememberAccent(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) return;
  const { recentAccents } = appearanceStore.get();
  appearanceStore.set({
    recentAccents: [hex, ...recentAccents.filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(0, 10),
  });
  persist();
}

/** Theme-affecting change that lives in theme.js but still belongs in history. */
export function recordThemeChange() {
  record();
}

/* ── Page transitions ──────────────────────────────────────────────────────
   The style the Motion section offers, expressed as framer-motion variants.
   Kept here rather than in the Shell so the setting and its effect live in the
   same file — and so "none" genuinely means no animated properties at all,
   not a zero-duration one that still triggers a paint. */
export function routeTransition(state = appearanceStore.get()) {
  const { motion: m, a11y } = state;
  const still = m.level === "none" || a11y.reduceMotion;
  if (still || m.transition === "none") {
    return { initial: false, animate: {}, transition: { duration: 0 } };
  }
  const damp = m.level === "reduced" ? 0.5 : m.intensity;
  const duration = 0.18 / Math.max(0.1, m.speed);
  const base = { transition: { duration, ease: [0.23, 1, 0.32, 1] } };
  switch (m.transition) {
    case "slide":
      return { initial: { opacity: 0, x: 18 * damp }, animate: { opacity: 1, x: 0 }, ...base };
    case "scale":
      return { initial: { opacity: 0, scale: 1 - 0.03 * damp }, animate: { opacity: 1, scale: 1 }, ...base };
    case "fade":
    default:
      return { initial: { opacity: 0, y: 6 * damp }, animate: { opacity: 1, y: 0 }, ...base };
  }
}
