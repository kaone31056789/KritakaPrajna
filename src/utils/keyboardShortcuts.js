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
const VALID_SINGLE_KEYS = new Set([
  "Enter", ",", "B", "K", "N", "R",
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);

export function getShortcutLabel(actionId) {
  return SHORTCUT_ACTIONS.find((item) => item.id === actionId)?.label || actionId;
}

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

export function eventToShortcut(event) {
  const modifiers = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("Ctrl");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.altKey) modifiers.push("Alt");

  let key = event.key;
  if (!key) return "";
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return "";
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();

  return normalizeShortcutString([...modifiers, key].join("+"));
}

export function isValidShortcut(shortcut) {
  const normalized = normalizeShortcutString(shortcut);
  if (!normalized) return false;
  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (modifiers.length === 0) return false;
  return VALID_SINGLE_KEYS.has(key) || /^[A-Z0-9]$/.test(key);
}

export function findShortcutConflict(shortcuts, actionId, shortcut) {
  const normalized = normalizeShortcutString(shortcut);
  return Object.entries(shortcuts || {}).find(([id, value]) => id !== actionId && normalizeShortcutString(value) === normalized) || null;
}

export function mergeShortcuts(shortcuts) {
  const merged = { ...DEFAULT_SHORTCUTS, ...(shortcuts || {}) };
  Object.keys(merged).forEach((key) => {
    merged[key] = normalizeShortcutString(merged[key]) || DEFAULT_SHORTCUTS[key];
  });
  return merged;
}
