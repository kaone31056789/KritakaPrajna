import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, readJSON, writeJSON } from "../core/store";
import { navStore, closePalette, openPalette, setView, toggleSidebar } from "../core/nav";
import { chatsStore, newChat, setActiveChat, togglePinChat } from "../core/chats";
import { modelsStore, selectModel, modelDisplayName } from "../core/models";
import { toggleTheme, themeStore, switchSkin, setAccent } from "../core/theme";
import { settingsStore, setSetting } from "../core/settings";
import { THEMES, ACCENT_PRESETS } from "../design/themes";
import { REASONING_MODES } from "../utils/reasoningControls";
import { providerLabel } from "../api/providerRouter";
import Icon from "./icons";
import { Kbd, GradientOrb } from "./primitives";

/* ═══ Command Palette 2.0 ═══
   Ctrl+K. Keyboard-initiated → renders INSTANTLY, no animation (Emil).
   - Grouped results (Recent / Actions / Thinking / Theme / Accent / Chats / Models)
   - Recent-first: last-run commands persist and surface on open
   - Deep commands: reasoning depth, web search mode, all 20 skins, accent presets */

const RECENT_KEY = "kp_palette_recent";
const RECENT_MAX = 8;

const readRecents = () => readJSON(RECENT_KEY, []) || [];
function pushRecent(id) {
  if (!id) return;
  writeJSON(RECENT_KEY, [id, ...readRecents().filter((x) => x !== id)].slice(0, RECENT_MAX));
}

const GROUP_LABEL = {
  recent: "Recent",
  action: "Actions",
  thinking: "Thinking",
  theme: "Theme",
  accent: "Accent",
  chat: "Chats",
  model: "Models",
};
const GROUP_ORDER = ["recent", "action", "thinking", "theme", "accent", "chat", "model"];

function fuzzyScore(query, target) {
  const q = query.toLowerCase();
  const t = String(target || "").toLowerCase();
  if (!q) return 1;
  if (t.includes(q)) return 100 - t.indexOf(q);
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += 2 + streak;
      if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "-") score += 4;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : -1;
}

/* Build the full command catalog. Cheap: only runs while the palette is open. */
function buildCatalog() {
  const { chats, activeChatId } = chatsStore.get();
  const { models } = modelsStore.get();
  const { theme, skin, accent } = themeStore.get();
  const { reasoningDepth, webMode } = settingsStore.get();
  const dark = theme === "dark";

  const actions = [
    { id: "act:new-chat", group: "action", icon: "plus", label: "New chat", kw: "create start", run: () => { setView("chat"); newChat(); } },
    { id: "act:go-chat", group: "action", icon: "chat", label: "Go to Chat", kw: "view screen", run: () => setView("chat") },
    { id: "act:go-agent", group: "action", icon: "agent", label: "Go to Agent", kw: "view screen autonomous", run: () => setView("agent") },
    { id: "act:go-advisor", group: "action", icon: "advisor", label: "Go to Model Advisor", kw: "view screen rankings", run: () => setView("advisor") },
    { id: "act:go-settings", group: "action", icon: "settings", label: "Go to Settings", kw: "view screen preferences", run: () => setView("settings") },
    { id: "act:toggle-sidebar", group: "action", icon: "sidebar", label: "Toggle sidebar", kw: "hide show collapse", run: () => toggleSidebar() },
    activeChatId && {
      id: "act:pin-chat",
      group: "action",
      icon: "pin",
      label: "Pin / unpin current chat",
      kw: "favorite bookmark",
      run: () => togglePinChat(activeChatId),
    },
  ].filter(Boolean);

  const thinking = [
    ...REASONING_MODES.map((m) => ({
      id: `think:${m.id}`,
      group: "thinking",
      icon: "brain",
      label: `Thinking: ${m.label}`,
      kw: "reasoning depth effort mode",
      active: (reasoningDepth || "balanced") === m.id,
      run: () => setSetting("reasoningDepth", m.id),
    })),
    ...["auto", "always", "off"].map((m) => ({
      id: `web:${m}`,
      group: "thinking",
      icon: "globe",
      label: `Web search: ${m[0].toUpperCase()}${m.slice(1)}`,
      kw: "internet browse online mode",
      active: (webMode || "auto") === m,
      run: () => setSetting("webMode", m),
    })),
  ];

  const themeCmds = [
    {
      id: "theme:toggle",
      group: "theme",
      icon: dark ? "sun" : "moon",
      label: dark ? "Switch to light theme" : "Switch to dark theme",
      kw: "dark light mode appearance toggle",
      run: () => toggleTheme(window.innerWidth / 2, 80),
    },
    ...THEMES.map((t) => ({
      id: `skin:${t.id}`,
      group: "theme",
      colors: dark ? t.dark : t.light,
      label: `Theme: ${t.name}`,
      hint: t.tag,
      kw: `skin design style ${t.motion}`,
      active: skin === t.id,
      run: () => switchSkin(t.id),
    })),
  ];

  const accents = [
    ...ACCENT_PRESETS.map((p) => ({
      id: `accent:${p.hex}`,
      group: "accent",
      swatch: p.hex,
      label: `Accent: ${p.name}`,
      kw: "color highlight brand",
      active: accent === p.hex,
      run: () => setAccent(p.hex),
    })),
    accent && {
      id: "accent:reset",
      group: "accent",
      icon: "refresh",
      label: "Accent: Skin default",
      kw: "color reset remove custom",
      run: () => setAccent(""),
    },
  ].filter(Boolean);

  const chatItems = chats.slice(0, 60).map((c) => ({
    id: `chat:${c.id}`,
    group: "chat",
    icon: "chat",
    label: c.title || "New chat",
    hint: `${(c.messages || []).length} messages`,
    run: () => { setView("chat"); setActiveChat(c.id); },
  }));

  const modelItems = models.slice(0, 400).map((m) => ({
    id: `model:${m._selectionId}`,
    group: "model",
    orbSeed: m._selectionId,
    label: modelDisplayName(m),
    hint: providerLabel(m._provider),
    run: () => selectModel(m._selectionId),
  }));

  return [...actions, ...thinking, ...themeCmds, ...accents, ...chatItems, ...modelItems];
}

export default function CommandPalette() {
  const { paletteOpen } = useStore(navStore, (s) => ({ paletteOpen: s.paletteOpen }));
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Global shortcut — window-level so it works from any screen
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navStore.get().paletteOpen ? closePalette() : openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  const items = useMemo(() => {
    if (!paletteOpen) return [];
    const catalog = buildCatalog();
    const recents = readRecents();

    if (!query.trim()) {
      // Recent-first default view: recents, then actions, then a few chats.
      const byId = new Map(catalog.map((it) => [it.id, it]));
      const recentItems = recents
        .map((id) => byId.get(id))
        .filter(Boolean)
        .slice(0, 5)
        .map((it) => ({ ...it, group: "recent" }));
      const shown = new Set(recentItems.map((it) => it.id));
      return [
        ...recentItems,
        ...catalog.filter((it) => it.group === "action" && !shown.has(it.id)),
        ...catalog.filter((it) => it.group === "chat" && !shown.has(it.id)).slice(0, 5),
      ];
    }

    // Search: score everything, boost recents, then regroup in stable order.
    const recentRank = new Map(recents.map((id, i) => [id, i]));
    const scored = catalog
      .map((item) => ({
        item,
        score:
          fuzzyScore(query, `${item.label} ${item.hint || ""} ${item.kw || ""}`) +
          (recentRank.has(item.id) ? 6 - recentRank.get(item.id) * 0.5 : 0),
      }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 18);

    const best = new Map(); // group → best score, for group ordering
    scored.forEach(({ item, score }) => {
      if (!best.has(item.group)) best.set(item.group, score);
    });
    return [...scored]
      .sort(
        (a, b) =>
          best.get(b.item.group) - best.get(a.item.group) ||
          (a.item.group === b.item.group ? b.score - a.score : 0)
      )
      .map((x) => x.item);
  }, [paletteOpen, query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!paletteOpen) return null;

  const runItem = (item) => {
    if (!item) return;
    pushRecent(item.id);
    closePalette();
    item.run?.();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(items[cursor]);
    } else if (e.key === "Escape") {
      closePalette();
    }
  };

  // Interleave group headers into the flat, keyboard-navigable list.
  const rows = [];
  items.forEach((item, i) => {
    if (i === 0 || items[i - 1].group !== item.group) {
      rows.push({ header: GROUP_LABEL[item.group] || item.group, key: `h-${item.group}-${i}` });
    }
    rows.push({ item, idx: i, key: item.id });
  });

  return createPortal(
    <div
      className="fixed inset-0 flex items-start justify-center pt-[16vh] px-6"
      style={{ zIndex: "var(--z-palette)" }}
    >
      <div
        className="absolute inset-0"
        style={{ background: "var(--backdrop)", backdropFilter: "blur(6px)" }}
        onClick={closePalette}
      />
      <div className="relative w-[600px] max-w-full neu-raised-lg overflow-hidden">
        <div className="flex items-center gap-3 px-5 h-14 border-b border-line">
          <Icon name="search" size={17} className="text-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search actions, themes, chats, models…"
            className="flex-1 bg-transparent border-none outline-none text-[14.5px] text-hi placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="text-center text-[13px] text-faint py-8">No matches.</p>
          )}
          {rows.map((row) =>
            row.header ? (
              <p
                key={row.key}
                className="px-3.5 pt-3 pb-1.5 text-[9.5px] uppercase tracking-[0.16em] text-faint select-none"
              >
                {row.header}
              </p>
            ) : (
              <button
                key={row.key}
                data-idx={row.idx}
                type="button"
                onClick={() => runItem(row.item)}
                onMouseMove={() => setCursor(row.idx)}
                className={`w-full flex items-center gap-3 px-3.5 h-11 rounded-sm text-left ${
                  row.idx === cursor ? "bg-surface-2 [box-shadow:var(--neu-raised-sm)]" : ""
                }`}
              >
                {row.item.orbSeed ? (
                  <GradientOrb seed={row.item.orbSeed} size={20} />
                ) : row.item.swatch ? (
                  <span
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ background: row.item.swatch, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)" }}
                  />
                ) : row.item.colors ? (
                  <span className="flex items-center gap-1 shrink-0 w-4 justify-center">
                    {row.item.colors.slice(0, 3).map((c, ci) => (
                      <span
                        key={ci}
                        className="w-[7px] h-[7px] rounded-full -ml-1 first:ml-0"
                        style={{ background: c, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)" }}
                      />
                    ))}
                  </span>
                ) : (
                  <Icon
                    name={row.item.icon}
                    size={16}
                    className={row.idx === cursor ? "text-accent" : "text-dim"}
                  />
                )}
                <span
                  className={`flex-1 truncate text-[13.5px] ${
                    row.idx === cursor ? "text-hi" : "text-body"
                  }`}
                >
                  {row.item.label}
                </span>
                {row.item.hint && (
                  <span className="text-[11px] text-faint truncate max-w-[160px]">{row.item.hint}</span>
                )}
                {row.item.active && <Icon name="check" size={14} className="text-accent shrink-0" />}
              </button>
            )
          )}
        </div>
        <div className="flex items-center gap-4 px-5 h-9 border-t border-line text-[10.5px] text-faint select-none">
          <span className="flex items-center gap-1.5"><Kbd>↑↓</Kbd> navigate</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> run</span>
          <span className="flex items-center gap-1.5"><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
