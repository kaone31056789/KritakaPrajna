import { createStore } from "./store";

/* Dynamic-island override — the Agent (or anything else) can take over the pill. */

export const islandStore = createStore({ override: null }); // { text, tone: 'accent'|'ok'|'err', spinning }

export function setIsland(override) {
  islandStore.set({ override });
}

export function clearIsland() {
  islandStore.set({ override: null });
}
