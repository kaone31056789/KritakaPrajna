import { useRef, useSyncExternalStore } from "react";

/* Minimal external store — immutable state, sync listeners, selector hook. */

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();

  const get = () => state;

  const set = (patch) => {
    const next = typeof patch === "function" ? patch(state) : patch;
    if (next === state) return;
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };

  const subscribe = (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };

  return { get, set, subscribe };
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

/** Subscribe a component to a slice of a store. Selector must be pure. */
export function useStore(store, selector = (s) => s) {
  const cache = useRef({ state: undefined, snap: undefined });
  return useSyncExternalStore(store.subscribe, () => {
    const state = store.get();
    const c = cache.current;
    if (c.state === state) return c.snap;
    const next = selector(state);
    c.state = state;
    c.snap = shallowEqual(c.snap, next) ? c.snap : next;
    return c.snap;
  });
}

/* ── Persistence helpers (legacy-key compatible) ── */

export function readRaw(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function readJSON(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function writeRaw(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const pendingWrites = new Map();

/** Debounced JSON persistence — batches rapid updates (e.g. streaming tokens). */
export function persistJSON(key, value, delay = 400) {
  clearTimeout(pendingWrites.get(key));
  pendingWrites.set(
    key,
    setTimeout(() => {
      writeJSON(key, value);
      pendingWrites.delete(key);
    }, delay)
  );
}

export function generateId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}
