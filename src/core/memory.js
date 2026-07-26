import { createStore, readJSON, writeJSON } from "./store";
import {
  DEFAULT_USER_MEMORY,
  USER_MEMORY_STORAGE_KEY,
  MEMORY_CATEGORY_DEFS,
  normalizeUserMemory,
  mergeUserMemory,
  detectMemoryFromExchange,
  isSensitiveMemoryText,
  parseExplicitMemoryCommand,
  categorizeExplicitMemory,
  selectRelevantMemory,
} from "../utils/userMemory";

/* User memory — synced to electron-store when available, localStorage otherwise. */

export const memoryStore = createStore({
  memory: normalizeUserMemory(readJSON(USER_MEMORY_STORAGE_KEY, DEFAULT_USER_MEMORY)),
  loaded: false,
});

export async function loadMemory() {
  try {
    if (window.electronAPI?.getMemory) {
      const remote = await window.electronAPI.getMemory();
      if (remote) {
        memoryStore.set({ memory: normalizeUserMemory(remote), loaded: true });
        return;
      }
    }
  } catch {}
  memoryStore.set({ loaded: true });
}

export async function saveMemory(memory) {
  const normalized = normalizeUserMemory(memory);
  memoryStore.set({ memory: normalized });
  writeJSON(USER_MEMORY_STORAGE_KEY, normalized);
  try {
    if (window.electronAPI?.setMemory) await window.electronAPI.setMemory(normalized);
  } catch {}
}

export async function resetMemory() {
  await saveMemory({ ...DEFAULT_USER_MEMORY });
}

/** Explicitly remember a fact (bypasses autoMode). Returns {category, entry} or null. */
export function rememberExplicit(text) {
  const entry = String(text || "").trim();
  if (!entry || isSensitiveMemoryText(entry)) return null;
  const { memory } = memoryStore.get();
  const category = categorizeExplicitMemory(entry);
  const merged = mergeUserMemory(memory, {
    ...DEFAULT_USER_MEMORY,
    [category]: [entry],
    autoMode: memory.autoMode,
  });
  saveMemory(merged);
  return { category, entry };
}

/** Remove all memory entries containing `query` (case-insensitive). Returns removed count. */
export function forgetMatching(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return 0;
  const { memory } = memoryStore.get();
  let removed = 0;
  const next = { ...memory };
  for (const def of MEMORY_CATEGORY_DEFS) {
    const before = memory[def.id] || [];
    const kept = before.filter((e) => !e.toLowerCase().includes(q));
    removed += before.length - kept.length;
    next[def.id] = kept;
  }
  if (removed > 0) saveMemory(next);
  return removed;
}

/** Auto-capture memory from a completed exchange (explicit commands always work). */
export function captureMemoryFromExchange(userText, aiText) {
  // "remember that …" / "forget …" work even when autoMode is off
  const explicit = parseExplicitMemoryCommand(userText);
  if (explicit?.action === "remember") rememberExplicit(explicit.payload);
  else if (explicit?.action === "forget") forgetMatching(explicit.payload);

  const { memory } = memoryStore.get();
  if (!memory.autoMode) return;
  const additions = detectMemoryFromExchange(userText, aiText);
  if (!additions) return;
  const merged = mergeUserMemory(memory, additions);
  if (merged !== memory) saveMemory(merged);
}

/* ── Review queue (LLM-suggested memories) ─────────────────────────────────── */

/**
 * Queue extracted memory candidates for user review.
 * Dedupe against saved entries + existing queue happens in normalizeUserMemory.
 * Returns the number of candidates actually queued.
 */
export function queuePendingCandidates(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) return 0;
  const { memory } = memoryStore.get();
  const before = (memory.pending || []).length;
  const next = normalizeUserMemory({
    ...memory,
    pending: [...(memory.pending || []), ...candidates],
  });
  const added = next.pending.length - before;
  if (added > 0) saveMemory(next);
  return Math.max(0, added);
}

/** Approve a pending suggestion — merges it into its category (with dedupe). */
export function approvePendingEntry(id) {
  const { memory } = memoryStore.get();
  const item = (memory.pending || []).find((p) => p.id === id);
  if (!item) return false;
  const merged = mergeUserMemory(
    { ...memory, pending: (memory.pending || []).filter((p) => p.id !== id) },
    { ...DEFAULT_USER_MEMORY, [item.category]: [item.text], autoMode: memory.autoMode }
  );
  saveMemory(merged);
  return true;
}

/** Reject (discard) a pending suggestion. */
export function rejectPendingEntry(id) {
  const { memory } = memoryStore.get();
  const pending = memory.pending || [];
  const next = pending.filter((p) => p.id !== id);
  if (next.length === pending.length) return false;
  saveMemory({ ...memory, pending: next });
  return true;
}

/** Discard the entire review queue. */
export function clearPendingEntries() {
  const { memory } = memoryStore.get();
  if ((memory.pending || []).length === 0) return;
  saveMemory({ ...memory, pending: [] });
}

// Greetings / one-word pings where injecting memory backfires: small local
// models treat the memory block as the topic and answer it instead of the user
// ("hi" → an essay about the user's remembered interests).
const TRIVIAL_MESSAGE_RE =
  /^(hi+|hey+|hello+|yo|sup|hola|namaste|good\s*(morning|afternoon|evening|night)|thanks?( you)?|thank u|ty|ok(ay)?|k|cool|nice|great|lol|haha+|bye|good\s*bye|test(ing)?|\?+|\.+)[\s!.?]*$/i;

/** Compact [User Memory] block for the system prompt. */
export function memoryPromptSection(memory = memoryStore.get().memory, contextText = "") {
  // Skip memory entirely for trivial openers — nothing in memory is relevant
  // to "hi", and tiny models will happily recite the whole block otherwise.
  const ctx = String(contextText || "").trim();
  if (ctx.length > 0 && (ctx.length < 3 || TRIVIAL_MESSAGE_RE.test(ctx))) return "";
  // Style categories always inject; context entries are relevance-ranked
  // against the current message so long-lived memory stays on-topic.
  const selected = selectRelevantMemory(memory, contextText);
  const lines = [];
  for (const def of MEMORY_CATEGORY_DEFS) {
    const entries = selected[def.id] || [];
    if (entries.length === 0) continue;
    lines.push(`${def.label}: ${entries.join("; ")}`);
  }
  if (lines.length === 0) return "";
  return `\n\n[User Memory] (quiet background about the user — apply only when relevant; never recite, list, or mention these unprompted)\n${lines.join("\n")}`;
}
