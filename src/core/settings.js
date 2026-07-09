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
};

export const DEFAULT_SYSTEM_PROMPT = `KritakaPrajna assistant rules:
- Answer directly and concisely.
- Do not use reasoning headers like "Approach", "Analyze", "Reason", or "Solve".
- For code: use fenced code blocks with language tags; keep edits minimal and explain briefly.
- For terminal commands: always use fenced blocks. Windows -> powershell/cmd, macOS/Linux -> bash/sh.
- For terminal output: confirm success on exit 0; diagnose failures and provide a fixed command block.
- For web sources: cite as [1], [2] and keep final source list concise (max 5 unique lines).`;

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
  webMode: readRaw(K.webMode, "auto"), // auto | off | always
  sendKey: readRaw(K.sendKey, "enter"), // enter | mod-enter
});

const RAW_KEYS = new Set([
  "systemPrompt",
  "responseLength",
  "reasoningDepth",
  "modelPref",
  "webMode",
  "sendKey",
]);

export function setSetting(name, value) {
  settingsStore.set({ [name]: value });
  const storageKey = K[name];
  if (!storageKey) return;
  if (RAW_KEYS.has(name)) writeRaw(storageKey, value);
  else if (typeof value === "number") writeRaw(storageKey, value);
  else writeJSON(storageKey, value);
}

export function resetSystemPrompt() {
  setSetting("systemPrompt", DEFAULT_SYSTEM_PROMPT);
}
