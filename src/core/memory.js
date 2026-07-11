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

/** Compact [User Memory] block for the system prompt. */
export function memoryPromptSection(memory = memoryStore.get().memory) {
  const lines = [];
  for (const def of MEMORY_CATEGORY_DEFS) {
    const entries = memory[def.id] || [];
    if (entries.length === 0) continue;
    lines.push(`${def.label}: ${entries.slice(0, 6).join("; ")}`);
  }
  if (lines.length === 0) return "";
  return `\n\n[User Memory]\n${lines.join("\n")}`;
}
