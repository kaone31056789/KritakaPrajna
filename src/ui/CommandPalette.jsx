import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../core/store";
import { navStore, closePalette, openPalette, setView } from "../core/nav";
import { chatsStore, newChat, setActiveChat, togglePinChat } from "../core/chats";
import { modelsStore, selectModel, modelDisplayName } from "../core/models";
import { toggleTheme, themeStore } from "../core/theme";
import { providerLabel } from "../api/providerRouter";
import Icon from "./icons";
import { Kbd, GradientOrb } from "./primitives";

/* Ctrl+K command palette. Keyboard-initiated → renders INSTANTLY, no animation (Emil). */

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
    const { chats, activeChatId } = chatsStore.get();
    const { models } = modelsStore.get();
    const dark = themeStore.get().theme === "dark";

    const actions = [
      { kind: "action", icon: "plus", label: "New chat", run: () => { setView("chat"); newChat(); } },
      { kind: "action", icon: dark ? "sun" : "moon", label: dark ? "Switch to light theme" : "Switch to dark theme", run: () => toggleTheme(window.innerWidth / 2, 80) },
      { kind: "action", icon: "chat", label: "Go to Chat", run: () => setView("chat") },
      { kind: "action", icon: "agent", label: "Go to Agent", run: () => setView("agent") },
      { kind: "action", icon: "advisor", label: "Go to Model Advisor", run: () => setView("advisor") },
      { kind: "action", icon: "settings", label: "Go to Settings", run: () => setView("settings") },
      activeChatId && {
        kind: "action",
        icon: "pin",
        label: "Pin / unpin current chat",
        run: () => togglePinChat(activeChatId),
      },
    ].filter(Boolean);

    const chatItems = chats.slice(0, 60).map((c) => ({
      kind: "chat",
      icon: "chat",
      label: c.title || "New chat",
      hint: `${(c.messages || []).length} messages`,
      run: () => { setView("chat"); setActiveChat(c.id); },
    }));

    const modelItems = models.slice(0, 400).map((m) => ({
      kind: "model",
      orbSeed: m._selectionId,
      label: modelDisplayName(m),
      hint: providerLabel(m._provider),
      run: () => selectModel(m._selectionId),
    }));

    const all = [...actions, ...chatItems, ...modelItems];
    if (!query.trim()) return [...actions, ...chatItems.slice(0, 6)];
    return all
      .map((item) => ({ item, score: fuzzyScore(query, `${item.label} ${item.hint || ""}`) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 14)
      .map((x) => x.item);
  }, [paletteOpen, query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    const el = listRef.current?.children?.[cursor];
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!paletteOpen) return null;

  const runItem = (item) => {
    closePalette();
    item?.run?.();
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

  const KIND_LABEL = { action: "Action", chat: "Chat", model: "Model" };

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
            placeholder="Search actions, chats, models…"
            className="flex-1 bg-transparent border-none outline-none text-[14.5px] text-hi placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="text-center text-[13px] text-faint py-8">No matches.</p>
          )}
          {items.map((item, i) => (
            <button
              key={`${item.kind}-${item.label}-${i}`}
              type="button"
              onClick={() => runItem(item)}
              onMouseMove={() => setCursor(i)}
              className={`w-full flex items-center gap-3 px-3.5 h-11 rounded-sm text-left ${
                i === cursor ? "bg-surface-2 [box-shadow:var(--neu-raised-sm)]" : ""
              }`}
            >
              {item.orbSeed ? (
                <GradientOrb seed={item.orbSeed} size={20} />
              ) : (
                <Icon name={item.icon} size={16} className={i === cursor ? "text-accent" : "text-dim"} />
              )}
              <span className={`flex-1 truncate text-[13.5px] ${i === cursor ? "text-hi" : "text-body"}`}>
                {item.label}
              </span>
              {item.hint && <span className="text-[11px] text-faint truncate max-w-[130px]">{item.hint}</span>}
              <span className="text-[9.5px] uppercase tracking-[0.14em] text-faint w-12 text-right">
                {KIND_LABEL[item.kind]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
