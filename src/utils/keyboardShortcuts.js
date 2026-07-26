export const DEFAULT_SHORTCUTS = {
  sendMessage: "Ctrl+Enter",
  newChat: "Ctrl+N",
  openSettings: "Ctrl+,",
  retryResponse: "Ctrl+R",
  toggleSidebar: "Ctrl+B",
  openModelSelector: "Ctrl+K",
};

export const SHORTCUT_ACTIONS = [
  { id: "sendMessage", label: "Send Message", category: "Chat" },
  { id: "retryResponse", label: "Retry Response", category: "Chat" },
  { id: "newChat", label: "New Chat", category: "Chat" },
  { id: "openSettings", label: "Open Settings", category: "Navigation" },
  { id: "toggleSidebar", label: "Toggle Sidebar", category: "Navigation" },
  { id: "openModelSelector", label: "Open Model Selector", category: "Model" },
];

const MODIFIER_ORDER = ["Ctrl", "Shift", "Alt"];

export function normalizeShortcutString(shortcut = "") {
  if (!shortcut) return "";
  const parts = String(shortcut)
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  let key = "";
  const modifiers = new Set();
  parts.forEach((part) => {
    const normalized =
      /^ctrl$/i.test(part) ? "Ctrl"
      : /^shift$/i.test(part) ? "Shift"
      : /^alt$/i.test(part) ? "Alt"
      : part.length === 1 ? part.toUpperCase()
      : part === "," ? ","
      : part;

    if (MODIFIER_ORDER.includes(normalized)) modifiers.add(normalized);
    else key = normalized;
  });

  if (!key) return "";
  return [...MODIFIER_ORDER.filter((item) => modifiers.has(item)), key].join("+");
}

export function mergeShortcuts(shortcuts) {
  const merged = { ...DEFAULT_SHORTCUTS, ...(shortcuts || {}) };
  Object.keys(merged).forEach((key) => {
    merged[key] = normalizeShortcutString(merged[key]) || DEFAULT_SHORTCUTS[key];
  });
  return merged;
}
