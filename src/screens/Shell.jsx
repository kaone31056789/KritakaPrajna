import React, { Suspense, lazy, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../core/store";
import { navStore, setView, openPalette } from "../core/nav";
import { themeStore, toggleTheme } from "../core/theme";
import { sendStore, stopStreaming } from "../core/send";
import { islandStore } from "../core/island";
import { chatsStore } from "../core/chats";
import { modelsStore, getSelectedModel, modelDisplayName } from "../core/models";
import { initRankings } from "../core/rankings";
import { SPRING_ISLAND, EASE_OUT } from "../design/motion";
import Icon from "../ui/icons";
import { NeuTooltip, Spinner, Kbd } from "../ui/primitives";
import BrandIcon from "../ui/BrandIcon";
import { LogoMark } from "../ui/Logo";
import CommandPalette from "../ui/CommandPalette";
import { Toaster } from "../ui/Toaster";
import Tour from "../ui/Tour";
import ErrorBoundary from "../ui/ErrorBoundary";

const ChatScreen = lazy(() => import("./Chat"));
const AgentScreen = lazy(() => import("./Agent"));
const AdvisorScreen = lazy(() => import("./Advisor"));
const SettingsScreen = lazy(() => import("./Settings"));

/* ═══ Dynamic Island — spring-morphing status pill ═══ */

function Island() {
  const { runs } = useStore(sendStore, (s) => ({ runs: s.runs }));
  const { override } = useStore(islandStore, (s) => ({ override: s.override }));
  const { activeChatId } = useStore(chatsStore, (s) => ({ activeChatId: s.activeChatId }));
  const { selectedId, models } = useStore(modelsStore, (s) => ({ selectedId: s.selectedId, models: s.models }));

  const model = useMemo(() => getSelectedModel({ models, selectedId }), [models, selectedId]);
  const activeRun = runs[activeChatId] || Object.values(runs)[0];

  let mode = "idle";
  let content;
  if (override) {
    mode = "override";
    content = (
      <>
        {override.spinning ? <Spinner size={12} /> : <Icon name="agent" size={13} className={`text-${override.tone || "accent"}`} />}
        <span className="truncate max-w-[280px] text-[11.5px] text-body">{override.text}</span>
      </>
    );
  } else if (activeRun) {
    mode = activeRun.phase;
    content = (
      <>
        {activeRun.phase === "searching" ? (
          <Icon name="globe" size={13} className="text-info animate-breathe" />
        ) : (
          <Spinner size={12} />
        )}
        <span className="text-[11.5px] text-body">
          {activeRun.phase === "searching" ? "Searching the web…" : activeRun.phase === "imaging" ? "Generating image…" : "Thinking…"}
        </span>
        <button
          type="button"
          onClick={() => stopStreaming(activeChatId)}
          className="pressable flex items-center justify-center w-5 h-5 rounded-full bg-err-soft text-err"
          aria-label="Stop"
        >
          <Icon name="stop" size={9} />
        </button>
      </>
    );
  } else {
    content = (
      <>
        {model ? <BrandIcon model={model} seed={model._selectionId} size={14} /> : <Icon name="spark" size={13} className="text-accent" />}
        <span className="truncate max-w-[220px] text-[11.5px] text-dim">
          {model ? modelDisplayName(model) : "KritakaPrajna"}
        </span>
        <Kbd>⌘K</Kbd>
      </>
    );
  }

  return (
    <motion.button
      type="button"
      layout
      transition={SPRING_ISLAND}
      onClick={mode === "idle" ? openPalette : undefined}
      className={`flex items-center gap-2 h-8 px-3.5 rounded-full bg-deep [box-shadow:var(--neu-inset-sm)] ${
        mode === "idle" ? "cursor-pointer hover:[box-shadow:var(--neu-inset-sm),0_0_10px_var(--accent-glow)]" : "cursor-default"
      }`}
      style={{ WebkitAppRegion: "no-drag", transition: "box-shadow 200ms var(--ease-out)" }}
    >
      {content}
    </motion.button>
  );
}

/* ═══ Window controls ═══ */

function WindowControls() {
  const api = window.electronAPI;
  if (!api?.windowMinimize) return null;
  return (
    <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" }}>
      <button type="button" onClick={() => api.windowMinimize()} aria-label="Minimize"
        className="pressable w-9 h-8 rounded-xs flex items-center justify-center text-dim hover:text-hi hover:bg-surface-2">
        <Icon name="minimize" size={13} />
      </button>
      <button type="button" onClick={() => api.windowMaximize()} aria-label="Maximize"
        className="pressable w-9 h-8 rounded-xs flex items-center justify-center text-dim hover:text-hi hover:bg-surface-2">
        <Icon name="maximize" size={12} />
      </button>
      <button type="button" onClick={() => api.windowClose()} aria-label="Close"
        className="pressable w-9 h-8 rounded-xs flex items-center justify-center text-dim hover:text-err hover:bg-err-soft">
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

/* ═══ Theme toggle — morph origin = the button itself ═══ */

function ThemeToggle() {
  const { theme } = useStore(themeStore, (s) => ({ theme: s.theme }));
  const dark = theme === "dark";
  return (
    <NeuTooltip label={dark ? "Light theme" : "Dark theme"} side="right">
      <button
        type="button"
        aria-label="Toggle theme"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          toggleTheme(r.left + r.width / 2, r.top + r.height / 2);
        }}
        className="pressable w-10 h-10 rounded-sm flex items-center justify-center text-dim hover:text-accent bg-surface [box-shadow:var(--neu-raised-sm)]"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={theme}
            initial={{ opacity: 0, rotate: -40, scale: 0.7 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 40, scale: 0.7 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="flex"
          >
            <Icon name={dark ? "moon" : "sun"} size={17} />
          </motion.span>
        </AnimatePresence>
      </button>
    </NeuTooltip>
  );
}

/* ═══ Nav rail ═══ */

const NAV_ITEMS = [
  { id: "chat", icon: "chat", label: "Chat" },
  { id: "agent", icon: "agent", label: "Agent" },
  { id: "advisor", icon: "advisor", label: "Model Advisor" },
];

function NavRail() {
  const { view } = useStore(navStore, (s) => ({ view: s.view }));
  return (
    <nav className="app-nav w-[64px] shrink-0 flex flex-col items-center py-4 gap-2.5 relative z-10">
      {NAV_ITEMS.map((item) => {
        const active = view === item.id;
        return (
          <NeuTooltip key={item.id} label={item.label} side="right">
            <button
              type="button"
              aria-label={item.label}
              onClick={() => setView(item.id)}
              className={`pressable relative w-10 h-10 rounded-sm flex items-center justify-center ${
                active
                  ? "text-accent bg-deep [box-shadow:var(--neu-inset-sm)]"
                  : "text-dim hover:text-hi bg-surface [box-shadow:var(--neu-raised-sm)]"
              }`}
              style={{ transition: "color 150ms var(--ease-out), box-shadow 200ms var(--ease-out)" }}
            >
              <Icon name={item.icon} size={18} />
              {active && (
                <motion.span
                  layoutId="nav-glow"
                  className="absolute -left-[13px] w-[3px] h-5 rounded-full"
                  style={{ background: "linear-gradient(180deg, var(--accent), var(--accent-2))" }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                />
              )}
            </button>
          </NeuTooltip>
        );
      })}
      <div className="flex-1" />
      <ThemeToggle />
      <NeuTooltip label="Settings" side="right">
        <button
          type="button"
          aria-label="Settings"
          onClick={() => setView("settings")}
          className={`pressable w-10 h-10 rounded-sm flex items-center justify-center ${
            view === "settings"
              ? "text-accent bg-deep [box-shadow:var(--neu-inset-sm)]"
              : "text-dim hover:text-hi bg-surface [box-shadow:var(--neu-raised-sm)]"
          }`}
        >
          <Icon name="settings" size={18} />
        </button>
      </NeuTooltip>
    </nav>
  );
}

/* ═══ Shell ═══ */

const VIEW_COMPONENTS = {
  chat: ChatScreen,
  agent: AgentScreen,
  advisor: AdvisorScreen,
  settings: SettingsScreen,
};

export default function Shell() {
  const { view } = useStore(navStore, (s) => ({ view: s.view }));
  const View = VIEW_COMPONENTS[view] || ChatScreen;

  // Live model rankings: fetch on launch, auto-refresh every 6h.
  useEffect(() => {
    initRankings();
  }, []);

  return (
    <div className="h-screen flex flex-col relative overflow-hidden bg-bg">
      <div className="aurora" />

      {/* Title bar — draggable frame region */}
      <header
        className="relative z-10 h-12 shrink-0 flex items-center justify-between pl-4 pr-2"
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="flex items-center gap-2.5 w-[200px]">
          <LogoMark size={26} />
          <span className="font-display font-semibold text-[13px] tracking-wide">
            <span className="text-hi">Kritaka</span>
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
            >
              Prajna
            </span>
          </span>
        </div>
        <Island />
        <div className="flex items-center justify-end w-[200px]">
          <WindowControls />
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative z-10">
        <NavRail />
        <main className="flex-1 min-w-0 pb-3 pr-3">
          <div className="h-full bezel">
            <div className="bezel-core overflow-hidden">
              <Suspense
                fallback={
                  <div className="h-full flex items-center justify-center">
                    <Spinner size={22} />
                  </div>
                }
              >
                {/* No AnimatePresence exit here on purpose: interrupted "wait"
                    transitions could drop the incoming view and leave the pane
                    permanently empty. Keyed mount animation is enough. */}
                <motion.div
                  key={view}
                  className="h-full"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16, ease: EASE_OUT }}
                >
                  <ErrorBoundary scope={view}>
                    <View />
                  </ErrorBoundary>
                </motion.div>
              </Suspense>
            </div>
          </div>
        </main>
      </div>

      <CommandPalette />
      <Toaster />
      <Tour />
    </div>
  );
}
