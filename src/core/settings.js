import { createStore, readRaw, readJSON, writeRaw, writeJSON } from "./store";
import { DEFAULT_SHORTCUTS, mergeShortcuts } from "../utils/keyboardShortcuts";

/* App settings — persisted under the legacy keys so v3 users keep their config. */

const K = {
  systemPrompt: "openrouter_system_prompt",
  responseLength: "openrouter_response_length",
  historyWindow: "openrouter_history_window",
  maxInputTokens: "openrouter_max_input_tokens",
  maxUserChars: "openrouter_max_user_chars",
  reasoningDepth: "openrouter_reasoning_depth",
  modelPref: "openrouter_model_pref",
  advisorPrefs: "openrouter_advisor_prefs",
  shortcuts: "kp_shortcuts",
  webMode: "kp_web_mode",
  sendKey: "kp_send_key",
  density: "kp_density",
  costCapMonthly: "kp_cost_cap_monthly",
  autoFailover: "kp_auto_failover",
};

export const DEFAULT_SYSTEM_PROMPT = `KritakaPrajna assistant rules:
- Answer directly and concisely.
- Do not use reasoning headers like "Approach", "Analyze", "Reason", or "Solve".
- For code: use fenced code blocks with language tags; keep edits minimal and explain briefly.
- For terminal commands: always use fenced blocks. Windows -> powershell/cmd, macOS/Linux -> bash/sh.
- For terminal output: confirm success on exit 0; diagnose failures and provide a fixed command block.
- For web sources: cite as [1], [2] and keep final source list concise (max 5 unique lines).`;

// Guard against stale/corrupt persisted values (e.g. JSON-quoted strings from
// older versions) — an invalid enum here crashes lookups downstream.
function readEnum(key, allowed, fallback) {
  const raw = String(readRaw(key, fallback) || "").replace(/^"|"$/g, "");
  return allowed.includes(raw) ? raw : fallback;
}

export const settingsStore = createStore({
  systemPrompt: readRaw(K.systemPrompt, "") || DEFAULT_SYSTEM_PROMPT,
  responseLength: readRaw(K.responseLength, "balanced"),
  historyWindow: Number(readRaw(K.historyWindow, 10)) || 10,
  maxInputTokens: Number(readRaw(K.maxInputTokens, 0)) || 0,
  maxUserChars: Number(readRaw(K.maxUserChars, 4000)) || 4000,
  reasoningDepth: readRaw(K.reasoningDepth, "balanced"),
  modelPref: readRaw(K.modelPref, "balanced"),
  advisorPrefs: readJSON(K.advisorPrefs, { priority: "balanced" }),
  shortcuts: mergeShortcuts(readJSON(K.shortcuts, {}) || {}),
  webMode: readEnum(K.webMode, ["auto", "always", "off"], "auto"),
  sendKey: readEnum(K.sendKey, ["enter", "mod-enter"], "enter"),
  density: readEnum(K.density, ["comfortable", "compact"], "comfortable"),
  costCapMonthly: Number(readRaw(K.costCapMonthly, 0)) || 0,
  autoFailover: readJSON(K.autoFailover, true) !== false,
});

/* Adaptive density — reflected as a root attribute so CSS can compact spacing. */
export function applyDensity(density = settingsStore.get().density) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-density", density);
  }
}
applyDensity();

const RAW_KEYS = new Set([
  "systemPrompt",
  "responseLength",
  "reasoningDepth",
  "modelPref",
  "webMode",
  "sendKey",
  "density",
]);

export function setSetting(name, value) {
  settingsStore.set({ [name]: value });
  if (name === "density") applyDensity(value);
  const storageKey = K[name];
  if (!storageKey) return;
  if (RAW_KEYS.has(name)) writeRaw(storageKey, value);
  else if (typeof value === "number") writeRaw(storageKey, value);
  else writeJSON(storageKey, value);
}

export function resetSystemPrompt() {
  setSetting("systemPrompt", DEFAULT_SYSTEM_PROMPT);
}
