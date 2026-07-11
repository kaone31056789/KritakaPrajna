/* Encrypted backup domain logic for KritakaPrajna.

   Captures a curated allowlist of localStorage keys (refetchable caches are
   deliberately excluded) into a plain payload, hands it to crypto.js for an
   AES-GCM/PBKDF2 envelope, and writes a .kpbak file. Restore reverses it as a
   full overwrite followed by a reload. Provider API keys are opt-in and, when
   present, gathered from / restored to the secure electron-store (localStorage
   fallback in browser dev). */

import { encryptJSON, decryptJSON } from "./crypto";
import { EMPTY_PROVIDERS } from "./keys";

export const BACKUP_SCHEMA = "kritakaprajna.backup";
export const BACKUP_SCHEMA_VERSION = 1;
const APP_NAME = "KritakaPrajna";
const FILE_EXT = ".kpbak";

/* Curated allowlist — every persisted key the app actually owns. Grouped only
   for readability; order here is also the restore order. Keep in sync when new
   persisted keys are introduced. */
export const BACKUP_KEYS = [
  // ── Settings ──
  "openrouter_system_prompt",
  "openrouter_response_length",
  "openrouter_history_window",
  "openrouter_max_input_tokens",
  "openrouter_max_user_chars",
  "openrouter_reasoning_depth",
  "openrouter_model_pref",
  "openrouter_advisor_prefs",
  "kp_shortcuts",
  "kp_web_mode",
  "kp_send_key",
  "kp_density",
  "kp_cost_cap_monthly",
  "kp_auto_failover",
  // ── Chats, folders, personas ──
  "openrouter_chats",
  "openrouter_active_chat",
  "kp_chat_folders",
  "kp_chat_personas",
  "kp_active_persona",
  // ── Prompt library ──
  "kp_prompt_library",
  // ── Model selection ──
  "openrouter_last_model",
  "openrouter_task_pref",
  // ── User memory ──
  "openrouter_user_memory",
  // ── Agent workspace ──
  "openrouter_agent_workspace",
  "openrouter_agent_chats",
  "openrouter_agent_active_chat",
  // ── Appearance & navigation ──
  "kp_theme",
  "kp_theme_skin",
  "kp_accent",
  "kp_active_view",
  "kp_palette_recent",
  "kp_tour_done",
  // ── Usage & cost history (real history, not a refetchable cache) ──
  "openrouter_provider_usage_v1",
  "openrouter_lifetime_cost",
  "openrouter_monthly_spend",
];

/* Deliberately excluded from backups — derived data the app can rebuild on its
   own. Documented so the omission is a decision, not an oversight. */
export const EXCLUDED_CACHE_KEYS = [
  "kp_or_rankings_v1", // OpenRouter model-rankings cache
  "openrouter_advisor_rankings_v2", // advisor ranking cache
];

const BACKUP_KEY_SET = new Set(BACKUP_KEYS);
const PROVIDERS = Object.keys(EMPTY_PROVIDERS);

/* ── helpers ── */

async function getAppVersion() {
  try {
    if (window.electronAPI?.getAppVersion) return await window.electronAPI.getAppVersion();
  } catch {}
  return null;
}

async function gatherProviderKeys() {
  const out = {};
  try {
    if (window.electronAPI?.getAllProviderKeys) {
      const keys = await window.electronAPI.getAllProviderKeys();
      for (const p of PROVIDERS) if (keys?.[p]) out[p] = keys[p];
    } else {
      for (const p of PROVIDERS) {
        const v = localStorage.getItem(`${p}_key`);
        if (v) out[p] = v;
      }
    }
  } catch {}
  return out;
}

async function restoreProviderKeys(providerKeys) {
  for (const p of PROVIDERS) {
    const key = providerKeys[p];
    if (typeof key !== "string" || !key) continue;
    try {
      if (window.electronAPI?.setProviderKey) await window.electronAPI.setProviderKey(p, key);
      else localStorage.setItem(`${p}_key`, key);
    } catch {}
  }
}

function safeCount(rawValue) {
  if (rawValue == null) return 0;
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.length : parsed ? 1 : 0;
  } catch {
    return 0;
  }
}

/* ── payload build / restore ── */

/**
 * Snapshot the allowlisted localStorage into a plain payload object.
 * Values are stored verbatim (raw strings) so restore is byte-exact.
 */
export async function buildBackupPayload({ includeKeys = false } = {}) {
  const data = {};
  for (const key of BACKUP_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }

  const payload = {
    schema: BACKUP_SCHEMA,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: APP_NAME,
    appVersion: await getAppVersion(),
    createdAt: new Date().toISOString(),
    data,
  };

  if (includeKeys) {
    payload.providerKeys = await gatherProviderKeys();
  }
  return payload;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Backup contents are unreadable.");
  }
  if (payload.schema !== BACKUP_SCHEMA) {
    throw new Error("This backup was made by a different app and can't be restored here.");
  }
  if (!payload.data || typeof payload.data !== "object") {
    throw new Error("Backup is missing its data section.");
  }
}

/**
 * Full-overwrite restore: clear every allowlisted key, then apply the backup.
 * Provider keys are only touched when restoreKeys is true and they're present.
 * Caller is responsible for reloading the app afterwards.
 */
export async function restorePayload(payload, { restoreKeys = false } = {}) {
  validatePayload(payload);

  for (const key of BACKUP_KEYS) localStorage.removeItem(key);

  for (const [key, value] of Object.entries(payload.data)) {
    if (!BACKUP_KEY_SET.has(key)) continue; // ignore anything not on the allowlist
    if (typeof value === "string") localStorage.setItem(key, value);
  }

  if (restoreKeys && payload.providerKeys && typeof payload.providerKeys === "object") {
    await restoreProviderKeys(payload.providerKeys);
  }
}

/* ── encode / decode ── */

/** Build the full encrypted .kpbak file text, ready to write to disk. */
export async function createBackupFile({ passphrase, includeKeys = false } = {}) {
  const payload = await buildBackupPayload({ includeKeys });
  const envelope = await encryptJSON(payload, passphrase);
  return JSON.stringify(envelope, null, 2);
}

/** Parse a .kpbak file's text into an envelope, rejecting anything foreign. */
export function parseBackupFile(text) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a valid backup (invalid JSON).");
  }
  if (!envelope || envelope.format !== "kpbak") {
    throw new Error("That file isn't a KritakaPrajna backup.");
  }
  return envelope;
}

/** Parse + decrypt + validate a .kpbak file's text into a usable payload. */
export async function decodeBackupFile(text, passphrase) {
  const envelope = parseBackupFile(text);
  const payload = await decryptJSON(envelope, passphrase);
  validatePayload(payload);
  return payload;
}

/* ── file I/O (renderer Blob download; import via <input type=file>) ── */

export function defaultBackupFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `kritakaprajna-backup-${stamp}${FILE_EXT}`;
}

export function downloadTextFile(contents, filename) {
  const blob = new Blob([contents], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── presentation helpers ── */

export function backupHasKeys(payload) {
  return !!(payload?.providerKeys && Object.keys(payload.providerKeys).length > 0);
}

/** Human-readable summary of what a decrypted payload will restore. */
export function summarizePayload(payload) {
  const data = payload?.data || {};
  const keys = payload?.providerKeys || {};
  return {
    createdAt: payload?.createdAt || null,
    appVersion: payload?.appVersion || null,
    chats: safeCount(data["openrouter_chats"]),
    agentChats: safeCount(data["openrouter_agent_chats"]),
    prompts: safeCount(data["kp_prompt_library"]),
    personas: safeCount(data["kp_chat_personas"]),
    folders: safeCount(data["kp_chat_folders"]),
    itemCount: Object.keys(data).length,
    providerKeyCount: Object.keys(keys).length,
  };
}

/* ── passphrase strength (pure, UI-agnostic) ── */

export const MIN_PASSPHRASE_LENGTH = 8;

/** 0-4 score + label + hint. Cheap heuristic, not a security guarantee. */
export function passphraseStrength(pw) {
  const value = typeof pw === "string" ? pw : "";
  if (!value) return { score: 0, label: "", ok: false };

  let score = 0;
  if (value.length >= MIN_PASSPHRASE_LENGTH) score++;
  if (value.length >= 14) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  score = Math.min(4, score);

  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
  return {
    score,
    label: labels[score],
    ok: value.length >= MIN_PASSPHRASE_LENGTH,
  };
}
