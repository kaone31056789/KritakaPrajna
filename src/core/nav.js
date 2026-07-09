import { createStore, readRaw, writeRaw } from "./store";

/* Shell navigation + command palette state. */

const VIEW_KEY = "kp_active_view";
const VIEWS = ["chat", "agent", "advisor", "settings"];

export const navStore = createStore({
  view: VIEWS.includes(readRaw(VIEW_KEY, "chat")) ? readRaw(VIEW_KEY, "chat") : "chat",
  paletteOpen: false,
  sidebarOpen: true,
});

export function setView(view) {
  if (!VIEWS.includes(view)) return;
  navStore.set({ view });
  writeRaw(VIEW_KEY, view);
}

export function openPalette() {
  navStore.set({ paletteOpen: true });
}

export function closePalette() {
  navStore.set({ paletteOpen: false });
}

export function toggleSidebar() {
  navStore.set((s) => ({ sidebarOpen: !s.sidebarOpen }));
}
