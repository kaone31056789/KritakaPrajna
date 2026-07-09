import { createStore, readJSON, writeJSON } from "./store";
import {
  DEFAULT_USER_MEMORY,
  USER_MEMORY_STORAGE_KEY,
  MEMORY_CATEGORY_DEFS,
  normalizeUserMemory,
  mergeUserMemory,
  detectMemoryFromExchange,
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

/** Auto-capture memory from a completed exchange (only when autoMode is on). */
export function captureMemoryFromExchange(userText, aiText) {
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
