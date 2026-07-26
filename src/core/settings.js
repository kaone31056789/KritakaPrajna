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
  failoverMode: "kp_failover_mode",
  contextMode: "kp_context_mode",
  keepFilesInContext: "kp_keep_files_in_context",
  tokenMode: "kp_token_mode",
  localRuntime: "kp_local_runtime",
};

// Advanced local-runtime knobs (mirrors Ollama app / LM Studio). Zero/empty
// means "runtime default" — buildRuntimeEnv in the main process skips those.
export const DEFAULT_LOCAL_RUNTIME = {
  contextLength: 0,      // OLLAMA_CONTEXT_LENGTH (tokens; 0 = runtime default 4096)
  keepAlive: "",         // OLLAMA_KEEP_ALIVE ("5m", "30m", "-1" = forever)
  numParallel: 0,        // OLLAMA_NUM_PARALLEL
  maxLoadedModels: 0,    // OLLAMA_MAX_LOADED_MODELS
  flashAttention: null,  // OLLAMA_FLASH_ATTENTION (null = runtime default)
  kvCacheType: "",       // OLLAMA_KV_CACHE_TYPE ("f16" | "q8_0" | "q4_0")
  // Per-request options (sent in /api/chat `options`, local runtime only):
  numGpu: null,          // num_gpu — layers offloaded to GPU (0 = CPU only, null = auto)
  numThread: 0,          // num_thread — CPU threads (0 = runtime default)
};

export const DEFAULT_SYSTEM_PROMPT = `KritakaPrajna assistant rules:
- Answer directly and concisely.
- Match answer length to the request: a greeting or trivial message gets a one-line reply; only long/complex questions get long answers.
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
  // How the model reacts when your selected model fails. Migrates from the old
  // boolean `autoFailover` (false → "never", true → "notify") so upgraders keep
  // their intent while gaining the transparent "switched from X → Y" path.
  failoverMode: readEnum(
    K.failoverMode,
    ["notify", "never", "silent"],
    readJSON(K.autoFailover, true) === false ? "never" : "notify"
  ),
  // How much of the conversation is sent to the model each turn:
  //   full  — entire thread, only trimmed when it overflows the model's context (Claude/ChatGPT-like, default)
  //   smart — recent turns in full + a running summary of older ones
  //   fixed — only the last `historyWindow` turns
  contextMode: readEnum(K.contextMode, ["full", "smart", "fixed"], "full"),
  // Keep uploaded file text readable for the whole chat (protected from history
  // compression) rather than only on the turn it was attached.
  keepFilesInContext: readJSON(K.keepFilesInContext, true) !== false,
  tokenMode: readEnum(K.tokenMode, ["off", "balanced", "aggressive"], "balanced"),
  localRuntime: { ...DEFAULT_LOCAL_RUNTIME, ...(readJSON(K.localRuntime, {}) || {}) },
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
  "tokenMode",
  "failoverMode",
  "contextMode",
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
