import { createStore } from "./store";

/* Provider API keys — electron-store in the app, localStorage fallback in browser dev. */

export const EMPTY_PROVIDERS = {
  openrouter: null,
  openai: null,
  anthropic: null,
  huggingface: null,
  ollama: null,
  nvidia: null,
};

export const keysStore = createStore({ providers: { ...EMPTY_PROVIDERS }, loaded: false });

export async function loadProviderKeys() {
  let keys;
  if (window.electronAPI?.getAllProviderKeys) {
    keys = await window.electronAPI.getAllProviderKeys();
  } else {
    keys = {};
    for (const p of Object.keys(EMPTY_PROVIDERS)) {
      keys[p] = localStorage.getItem(`${p}_key`) || null;
    }
  }
  keysStore.set({ providers: { ...EMPTY_PROVIDERS, ...keys }, loaded: true });
  return keysStore.get().providers;
}

export async function setProviderKey(provider, key) {
  if (window.electronAPI?.setProviderKey) {
    await window.electronAPI.setProviderKey(provider, key);
  } else {
    localStorage.setItem(`${provider}_key`, key);
  }
  keysStore.set((s) => ({ providers: { ...s.providers, [provider]: key } }));
}

export async function removeProviderKey(provider) {
  if (window.electronAPI?.removeProviderKey) {
    await window.electronAPI.removeProviderKey(provider);
  } else {
    localStorage.removeItem(`${provider}_key`);
  }
  keysStore.set((s) => ({ providers: { ...s.providers, [provider]: null } }));
}

export async function resetAllKeys() {
  for (const p of Object.keys(EMPTY_PROVIDERS)) {
    await removeProviderKey(p);
  }
}

export function hasAnyKey(providers) {
  return Object.values(providers || {}).some(Boolean);
}
