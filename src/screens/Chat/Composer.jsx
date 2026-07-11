import React, { useCallback, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../../core/store";
import { chatsStore, setActivePersona, newChat } from "../../core/chats";
import { modelsStore, getSelectedModel, modelDisplayName } from "../../core/models";
import { settingsStore, setSetting } from "../../core/settings";
import { sendMessage, sendStore, stopStreaming } from "../../core/send";
import { rememberExplicit, forgetMatching } from "../../core/memory";
import { estimateTokensFromText } from "../../utils/tokenOptimizer";
import { REASONING_MODES, supportsReasoningModel } from "../../utils/reasoningControls";
import { EASE_OUT } from "../../design/motion";
import Icon from "../../ui/icons";
import { NeuPopover, MenuItem, NeuTooltip } from "../../ui/primitives";
import BrandIcon from "../../ui/BrandIcon";
import { toast } from "../../ui/Toaster";
import ModelPicker from "./ModelPicker";
import ModelAdvice from "./ModelAdvice";

const WEB_MODES = ["auto", "always", "off"];
const WEB_META = {
  auto: { label: "Web: auto", cls: "text-dim" },
  always: { label: "Web: always", cls: "text-info" },
  off: { label: "Web: off", cls: "text-faint" },
};

/* Thinking-effort chip meta (reasoning models only). */
const DEPTH_META = {
  fast: { label: "Think", cls: "text-dim" },
  balanced: { label: "Think+", cls: "text-info" },
  deep: { label: "Ultra", cls: "text-accent" },
};

/* Claude Code-style slash commands — type "/" at the start of the composer. */
const SLASH_COMMANDS = [
  { cmd: "model", icon: "cpu", hint: "Switch model", run: (c) => c.openModel() },
  { cmd: "persona", icon: "brain", hint: "Choose persona", run: (c) => c.openPersona() },
  { cmd: "web", icon: "globe", hint: "Cycle web search: auto → always → off", run: (c) => c.cycleWeb() },
  { cmd: "think", icon: "zap", hint: "Fast thinking — quick, light reasoning", run: (c) => c.setDepth("fast") },
  { cmd: "megathink", icon: "gauge", hint: "Balanced thinking", run: (c) => c.setDepth("balanced") },
  { cmd: "ultrathink", icon: "spark", hint: "Deep thinking — max reasoning effort", run: (c) => c.setDepth("deep") },
  { cmd: "new", icon: "plus", hint: "Start a new chat", run: (c) => c.newChat() },
  { cmd: "clear", icon: "refresh", hint: "Clear — start a fresh chat", run: (c) => c.newChat() },
  { cmd: "remember", icon: "bookmark", hint: "Save a fact to memory — /remember <text>", run: (c) => c.insert("/remember ") },
  { cmd: "forget", icon: "trash", hint: "Remove matching memory — /forget <text>", run: (c) => c.insert("/forget ") },
  { cmd: "help", icon: "command", hint: "List slash commands", run: (c) => c.help() },
];

async function fileToUpload(file) {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (file.type.startsWith("image/")) {
    const dataUrl = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });
    return { id: `${Date.now()}-${file.name}`, name: file.name, type: "image", dataUrl };
  }
  if (ext === "pdf" && window.electronAPI?.extractPdfTextFromBuffer) {
    const buf = await file.arrayBuffer();
    const res = await window.electronAPI.extractPdfTextFromBuffer(buf);
    const content = typeof res === "string" ? res : res?.text || "";
    return { id: `${Date.now()}-${file.name}`, name: file.name, type: "pdf", content };
  }
  const content = await file.text();
  return { id: `${Date.now()}-${file.name}`, name: file.name, type: "text", content };
}

export default function Composer() {
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  const { activeChatId, personas, activePersonaId } = useStore(chatsStore, (s) => ({
    activeChatId: s.activeChatId,
    personas: s.personas,
    activePersonaId: s.activePersonaId,
  }));
  const runs = useStore(sendStore, (s) => s.runs);
  const busy = !!runs[activeChatId];
  const { models, selectedId } = useStore(modelsStore, (s) => ({ models: s.models, selectedId: s.selectedId }));
  const { webMode, sendKey, reasoningDepth } = useStore(settingsStore, (s) => ({
    webMode: s.webMode,
    sendKey: s.sendKey,
    reasoningDepth: s.reasoningDepth,
  }));

  const model = getSelectedModel({ models, selectedId });
  const persona = personas.find((p) => p.id === activePersonaId);
  const tokens = estimateTokensFromText(text);
  const webMeta = WEB_META[webMode] || WEB_META.auto;
  const depth = reasoningDepth || "balanced";
  const depthMeta = DEPTH_META[depth] || DEPTH_META.balanced;
  const canThink = supportsReasoningModel(model || {});

  // Slash menu: active while composer text is exactly "/command-prefix" (no spaces).
  const slashItems = useMemo(() => {
    if (slashDismissed || !text.startsWith("/") || /[\s\n]/.test(text)) return [];
    const q = text.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q));
  }, [text, slashDismissed]);
  const slashHi = Math.max(0, Math.min(slashIdx, slashItems.length - 1));

  const cycleWeb = useCallback(() => {
    const cur = settingsStore.get().webMode;
    const next = WEB_MODES[(WEB_MODES.indexOf(cur) + 1 + WEB_MODES.length) % WEB_MODES.length];
    setSetting("webMode", next);
    toast.info(WEB_META[next].label);
  }, []);

  const setDepth = useCallback((d) => {
    setSetting("reasoningDepth", d);
    const m = REASONING_MODES.find((x) => x.id === d);
    toast.info(`Thinking: ${m ? m.label : d}`);
  }, []);

  const runSlash = useCallback(
    (c) => {
      setText("");
      setSlashIdx(0);
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.style.height = "auto";
      });
      c.run({
        openModel: () => setModelOpen(true),
        openPersona: () => setPersonaOpen(true),
        cycleWeb,
        setDepth,
        newChat: () => {
          newChat({ personaId: activePersonaId });
          toast.info("New chat");
        },
        help: () => toast.info(`Commands: ${SLASH_COMMANDS.map((x) => `/${x.cmd}`).join("  ")}`),
        insert: (s) => {
          setText(s);
          requestAnimationFrame(() => taRef.current?.focus());
        },
      });
    },
    [cycleWeb, setDepth, activePersonaId]
  );

  const autoGrow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(220, ta.scrollHeight)}px`;
  }, []);

  const addFiles = useCallback(async (files) => {
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 20MB)`);
        continue;
      }
      try {
        const upload = await fileToUpload(file);
        setUploads((prev) => [...prev, upload]);
      } catch {
        toast.error(`Could not read ${file.name}`);
      }
    }
  }, []);

  const doSend = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && uploads.length === 0) || busy) return;
    // Argument slash commands — handled locally, never sent to the model
    const argCmd = trimmed.match(/^\/(remember|forget)\s+(.+)/is);
    if (argCmd) {
      const payload = argCmd[2].trim();
      if (argCmd[1].toLowerCase() === "remember") {
        const saved = rememberExplicit(payload);
        toast.info(saved ? `Remembered under ${saved.category}` : "Couldn't save that (empty or sensitive)");
      } else {
        const n = forgetMatching(payload);
        toast.info(n > 0 ? `Forgot ${n} ${n === 1 ? "entry" : "entries"}` : "No matching memory found");
      }
      setText("");
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.style.height = "auto";
      });
      return;
    }
    sendMessage({ chatId: activeChatId, text: trimmed, uploads });
    setText("");
    setUploads([]);
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = "auto";
    });
  }, [text, uploads, busy, activeChatId]);

  const onKeyDown = (e) => {
    if (slashItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => (i + 1) % slashItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => (i - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        runSlash(slashItems[slashHi]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    const modEnter = (e.ctrlKey || e.metaKey) && e.key === "Enter";
    const plainEnter = e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey;
    if ((sendKey === "enter" && plainEnter) || modEnter) {
      e.preventDefault();
      doSend();
    }
  };

  return (
    <div className="px-6 pb-5 pt-2">
      <ModelAdvice />
      <div
        className={`app-composer max-w-[880px] mx-auto rounded-lg bg-surface [box-shadow:var(--neu-raised)] ${
          dragOver ? "[box-shadow:var(--neu-raised),0_0_0_2px_var(--accent)]" : ""
        }`}
        style={{ transition: "box-shadow 180ms var(--ease-out)" }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles([...e.dataTransfer.files]);
        }}
      >
        {/* Upload chips */}
        <AnimatePresence>
          {uploads.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="overflow-hidden"
            >
              <div className="flex gap-2 flex-wrap px-4 pt-3.5">
                {uploads.map((u) => (
                  <span key={u.id} className="flex items-center gap-2 pl-2.5 pr-1.5 h-8 rounded-full bg-deep [box-shadow:var(--neu-inset-sm)] text-[11.5px] text-body">
                    {u.type === "image" && u.dataUrl ? (
                      <img src={u.dataUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                    ) : (
                      <Icon name="file" size={12} className="text-dim" />
                    )}
                    <span className="max-w-[140px] truncate">{u.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${u.name}`}
                      onClick={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-faint hover:text-err"
                    >
                      <Icon name="close" size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input */}
        <div className="px-4 pt-3 relative">
          <AnimatePresence>
            {slashItems.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.14, ease: EASE_OUT }}
                className="absolute bottom-full left-3 mb-2 w-[340px] rounded-md bg-surface [box-shadow:var(--neu-raised)] p-1.5 z-30"
              >
                <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-mono uppercase tracking-wider text-faint">
                  Commands — ↑↓ · Enter · Esc
                </p>
                {slashItems.map((c, i) => (
                  <button
                    key={c.cmd}
                    type="button"
                    onMouseEnter={() => setSlashIdx(i)}
                    onClick={() => runSlash(c)}
                    className={`w-full flex items-center gap-2.5 px-2.5 h-9 rounded-xs text-left ${
                      i === slashHi ? "bg-deep [box-shadow:var(--neu-inset-sm)]" : ""
                    }`}
                  >
                    <Icon name={c.icon} size={13} className={i === slashHi ? "text-accent" : "text-dim"} />
                    <span className="text-[12.5px] font-mono text-hi">/{c.cmd}</span>
                    <span className="flex-1 truncate text-[11px] text-faint text-right">{c.hint}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <textarea
            ref={taRef}
            value={text}
            rows={1}
            placeholder={persona ? `Message as ${persona.name}…` : "Message KritakaPrajna — type / for commands…"}
            onChange={(e) => {
              setText(e.target.value);
              setSlashDismissed(false);
              setSlashIdx(0);
              autoGrow();
            }}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length > 0) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            className="w-full bg-transparent border-none outline-none resize-none text-[14px] text-hi placeholder:text-faint leading-relaxed max-h-[220px]"
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1.5 px-3 pb-3 pt-1.5">
          {/* Model chip */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setModelOpen((o) => !o)}
              className="pressable flex items-center gap-2 h-8 pl-2 pr-3 rounded-full bg-deep [box-shadow:var(--neu-inset-sm)] hover:[box-shadow:var(--neu-inset-sm),0_0_8px_var(--accent-glow)]"
              style={{ transition: "box-shadow 180ms var(--ease-out)" }}
            >
              {model ? <BrandIcon model={model} seed={model._selectionId} size={16} /> : <Icon name="cpu" size={14} className="text-dim" />}
              <span className="text-[11.5px] text-body max-w-[170px] truncate">
                {model ? modelDisplayName(model) : "Pick a model"}
              </span>
              <Icon name="chevronDown" size={11} className="text-faint" />
            </button>
            <ModelPicker open={modelOpen} onClose={() => setModelOpen(false)} anchor="top-start" />
          </div>

          {/* Persona chip */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPersonaOpen((o) => !o)}
              className={`pressable flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] ${
                persona ? "bg-accent-soft text-accent" : "text-dim hover:text-body hover:bg-surface-2"
              }`}
            >
              <Icon name="brain" size={13} />
              <span className="max-w-[110px] truncate">{persona ? persona.name : "Persona"}</span>
            </button>
            <NeuPopover open={personaOpen} onClose={() => setPersonaOpen(false)} anchor="top-start" width={220}>
              <MenuItem icon="close" onClick={() => { setActivePersona(""); setPersonaOpen(false); }}>
                No persona
              </MenuItem>
              {personas.map((p) => (
                <MenuItem
                  key={p.id}
                  icon="brain"
                  onClick={() => { setActivePersona(p.id); setPersonaOpen(false); }}
                >
                  {p.id === activePersonaId ? `✓ ${p.name}` : p.name}
                </MenuItem>
              ))}
              {personas.length === 0 && (
                <p className="px-3 py-2 text-[11.5px] text-faint">Create personas in Settings.</p>
              )}
            </NeuPopover>
          </div>

          {/* Web mode */}
          <NeuTooltip label={webMeta.label}>
            <button
              type="button"
              aria-label="Web search mode"
              onClick={cycleWeb}
              className={`pressable w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-2 ${webMeta.cls}`}
            >
              <Icon name="globe" size={15} />
            </button>
          </NeuTooltip>

          {/* Thinking effort — reasoning-capable models only */}
          {canThink && (
            <NeuTooltip label={`Thinking effort: ${REASONING_MODES.find((m) => m.id === depth)?.label || depth} — click to cycle`}>
              <button
                type="button"
                aria-label="Thinking effort"
                onClick={() => {
                  const ids = REASONING_MODES.map((m) => m.id);
                  setDepth(ids[(ids.indexOf(depth) + 1) % ids.length]);
                }}
                className={`pressable flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] hover:bg-surface-2 ${depthMeta.cls}`}
              >
                <Icon name="gauge" size={13} />
                <span>{depthMeta.label}</span>
              </button>
            </NeuTooltip>
          )}

          {/* Attach */}
          <NeuTooltip label="Attach files">
            <button
              type="button"
              aria-label="Attach files"
              onClick={() => fileRef.current?.click()}
              className="pressable w-8 h-8 rounded-full flex items-center justify-center text-dim hover:text-body hover:bg-surface-2"
            >
              <Icon name="paperclip" size={15} />
            </button>
          </NeuTooltip>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...e.target.files]);
              e.target.value = "";
            }}
          />

          <div className="flex-1" />

          {tokens > 0 && (
            <span className="text-[10px] font-mono text-faint pr-1">~{tokens} tok</span>
          )}

          {/* Send / Stop */}
          {busy ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={() => stopStreaming(activeChatId)}
              className="pressable w-10 h-10 rounded-full flex items-center justify-center bg-err-soft text-err [box-shadow:var(--neu-raised-sm)]"
            >
              <Icon name="stop" size={15} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              disabled={!text.trim() && uploads.length === 0}
              onClick={doSend}
              className="pressable w-10 h-10 rounded-full flex items-center justify-center text-accent-ink disabled:opacity-40 disabled:pointer-events-none"
              style={{
                background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
                boxShadow: "var(--neu-raised-sm), 0 2px 12px var(--accent-glow)",
              }}
            >
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
