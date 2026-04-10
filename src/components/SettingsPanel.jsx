import { useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getAutoRun, setAutoRun } from "./TerminalPanel";
import PersonaEditor from "./PersonaEditor";
import FolderEditor from "./FolderEditor";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, eventToShortcut, findShortcutConflict, getShortcutLabel, isValidShortcut, mergeShortcuts, normalizeShortcutString } from "../utils/keyboardShortcuts";
import {
  DEFAULT_USER_MEMORY,
  MEMORY_CATEGORY_DEFS,
  extractMemoryFromImport,
  isSensitiveMemoryText,
  mergeUserMemory,
  normalizeUserMemory,
  parseStructuredAIResponse,
  removeUserMemoryEntry,
  updateUserMemoryEntry,
} from "../utils/userMemory";
import { fetchCloudUsage as fetchOllamaCloudUsage } from "../api/ollama";

const ease = [0.4, 0, 0.2, 1];

const AI_IMPORT_PROMPT = `Analyze my conversation history and summarize:

1. My preferred programming language
2. My response style (short/detailed)
3. My goals (learning, building, etc.)
4. Any repeated patterns in my requests

Return in this format:

Preferences:
* ...

Coding Style:
* ...

Context:
* ...`;

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "********";
  return key.slice(0, 5) + "****" + key.slice(-4);
}

const PROVIDER_DEFS = [
  { id: "openrouter",  label: "OpenRouter",    placeholder: "sk-or-v1-...", color: "#7c6ff7", note: "500+ models via single key", valueLabel: "Key", inputType: "password" },
  { id: "openai",      label: "OpenAI",         placeholder: "sk-proj-...", color: "#10a37f", note: "GPT-4o, o1, o3-mini", valueLabel: "Key", inputType: "password" },
  { id: "anthropic",   label: "Anthropic",      placeholder: "sk-ant-...",  color: "#c96442", note: "Claude Opus, Sonnet, Haiku", valueLabel: "Key", inputType: "password" },
  { id: "huggingface", label: "HuggingFace",    placeholder: "hf_...",      color: "#f5a623", note: "Popular open models, free + paid router options", valueLabel: "Key", inputType: "password" },
  { id: "ollama",      label: "Ollama",         placeholder: "ollama_...", color: "#22c55e", note: "Cloud models via API key from ollama.com/settings/keys", valueLabel: "Key", inputType: "password" },
];

function ProviderRow({ def, currentKey, onSave, onRemove }) {
  const [draft, setDraft]       = useState("");
  const [mode, setMode]         = useState("idle");   // "idle" | "adding" | "replacing"
  const [busy, setBusy]         = useState(false);
  const [err,  setErr]          = useState("");

  const isConnected = !!currentKey;

  const handleSave = async (e) => {
    e.preventDefault();
    const trimmed = draft.trim() || def.defaultValue || "";
    if (!trimmed) return;
    setBusy(true); setErr("");
    try {
      await onSave(def.id, trimmed);
      setDraft(""); setMode("idle");
    } catch {
      setErr("Failed to save — check your value.");
    } finally {
      setBusy(false);
    }
  };

  const valueLabel = def.valueLabel || "Key";
  const isSecret = (def.inputType || "password") === "password";
  const displayedValue = isSecret ? maskKey(currentKey) : currentKey;

  return (
    <div className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm p-4 space-y-3 shadow-elevation-1 inner-highlight">
      {/* Header row */}
      <div className="flex items-center gap-2.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: def.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-dark-100">{def.label}</span>
            {isConnected ? (
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5 font-medium">Connected</span>
            ) : (
              <span className="text-[10px] text-[#b0b0b0]/40 bg-[#1a1a1a]/50 border border-[#1a1a1a]/30 rounded-full px-1.5 py-0.5 font-medium"> Not connected</span>
            )}
          </div>
          <p className="text-[11px] text-[#b0b0b0]/40 mt-0.5">{def.note}</p>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {!isConnected && mode === "idle" && (
            <button type="button" onClick={() => setMode("adding")}
              className="text-[11px] text-[#00ff41] hover:text-[#00ff41] font-medium cursor-pointer px-2 py-1 rounded-sm hover:bg-[#00ff41]/10">
              Add {valueLabel}
            </button>
          )}
          {isConnected && mode === "idle" && (
            <>
              <button type="button" onClick={() => { setDraft(""); setMode("replacing"); }}
                className="text-[11px] text-[#b0b0b0]/60 hover:text-[#e0e0e0] font-medium cursor-pointer px-2 py-1 rounded-sm hover:bg-[#1a1a1a]">
                Replace {valueLabel}
              </button>
              <button type="button" onClick={() => onRemove(def.id)}
                className="text-[11px] text-red-400/70 hover:text-red-400 font-medium cursor-pointer px-2 py-1 rounded-sm hover:bg-red-500/10">
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {/* Masked current key */}
      {isConnected && mode === "idle" && (
        <div className="font-mono text-xs text-[#b0b0b0]/60 bg-[#0d0d0d]/50 border border-[#1a1a1a]/30 rounded-sm px-3 py-2 shadow-inner-shadow">
          {displayedValue}
        </div>
      )}

      {/* Add / Replace form */}
      <AnimatePresence>
        {mode !== "idle" && (
          <motion.form
            onSubmit={handleSave}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease }}
            className="overflow-hidden space-y-2"
          >
            <input
              type={def.inputType || "password"}
              placeholder={def.placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              autoFocus
              className="w-full bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40 disabled:opacity-50"
            />
            {err && <p className="text-xs text-red-400">{err}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={!(draft.trim() || def.defaultValue) || busy}
                className="flex-1 bg-gradient-to-r from-[#00cc33] to-[#00ff41] disabled:opacity-40 text-black font-medium rounded-sm px-3 py-2 text-xs cursor-pointer">
                {busy ? "Saving…" : (mode === "adding" ? `Save ${valueLabel}` : `Replace ${valueLabel}`)}
              </button>
              <button type="button" onClick={() => { setMode("idle"); setDraft(""); setErr(""); }}
                className="px-3 py-2 text-xs text-[#b0b0b0]/60 hover:text-[#e0e0e0] cursor-pointer">
                Cancel
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

function ShortcutEditor({ shortcuts, onSaveShortcuts, onResetShortcuts }) {
  const [merged, setMerged] = useState(() => mergeShortcuts(shortcuts));
  const [search, setSearch] = useState("");
  const [recording, setRecording] = useState(null);
  const [shortcutError, setShortcutError] = useState("");
  const recordButtonRefs = useRef({});

  useEffect(() => {
    setMerged(mergeShortcuts(shortcuts));
  }, [shortcuts]);

  useEffect(() => {
    if (!recording) return;
    const button = recordButtonRefs.current[recording];
    button?.focus();
  }, [recording]);

  const persistShortcuts = async (nextShortcuts) => {
    const normalized = mergeShortcuts(nextShortcuts);
    setMerged(normalized);
    await onSaveShortcuts?.(normalized);
  };

  const visibleActions = SHORTCUT_ACTIONS.filter((action) =>
    action.label.toLowerCase().includes(search.toLowerCase())
  );

  const handleRecord = async (actionId, event) => {
    event.preventDefault();
    event.stopPropagation();
    const shortcut = eventToShortcut(event);
    if (!shortcut) return;
    if (!isValidShortcut(shortcut)) {
      setShortcutError("Use Ctrl/Shift/Alt + a valid key (A-Z, 0-9, Enter, comma, or F1-F12).");
      setRecording(null);
      return;
    }

    setShortcutError("");
    const conflict = findShortcutConflict(merged, actionId, shortcut);
    let next = { ...merged };

    if (conflict) {
      const shouldReplace = window.confirm(
        `This shortcut is already assigned to '${getShortcutLabel(conflict[0])}'. Replace it?`
      );
      if (!shouldReplace) {
        setRecording(null);
        return;
      }
      next[conflict[0]] = DEFAULT_SHORTCUTS[conflict[0]];
    }

    next[actionId] = normalizeShortcutString(shortcut);
    await persistShortcuts(next);
    setRecording(null);
  };

  const handleResetAction = async (actionId) => {
    setShortcutError("");
    await persistShortcuts({ ...merged, [actionId]: DEFAULT_SHORTCUTS[actionId] });
  };

  const handleResetAll = async () => {
    setShortcutError("");
    setRecording(null);
    await onResetShortcuts?.();
    setMerged(mergeShortcuts(DEFAULT_SHORTCUTS));
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">
            Keyboard Shortcuts
          </h3>
          <p className="text-xs text-[#b0b0b0]/60 mt-1">
            Customize shortcuts for chat, navigation, and model actions.
          </p>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.12, ease }}
          onClick={handleResetAll}
          className="text-[11px] text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/30 rounded-sm px-3 py-2 cursor-pointer"
        >
          Reset All
        </motion.button>
      </div>

      {shortcutError && (
        <p className="text-xs text-red-400">{shortcutError}</p>
      )}

      <input
        type="text"
        placeholder="Search shortcuts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40"
      />

      <div className="overflow-hidden rounded-sm border border-[#1a1a1a]/50 bg-[#111111]">
        <div className="grid grid-cols-[1.4fr_1fr] px-4 py-2 text-[11px] uppercase tracking-wider text-[#b0b0b0]/40 border-b border-[#1a1a1a]/50">
          <span>Action</span>
          <span>Shortcut</span>
        </div>

        {visibleActions.map((action) => (
          <div
            key={action.id}
            className={`grid grid-cols-[1.4fr_1fr] items-center gap-3 px-4 py-3 border-b border-[#1a1a1a]/30 last:border-b-0 transition-colors ${
              recording === action.id ? "bg-[#00ff41]/10" : "hover:bg-[#1a1a1a]/40"
            }`}
          >
            <div className="min-w-0">
              <div className="text-sm text-dark-100 font-medium">{action.label}</div>
              <div className="text-[11px] text-[#b0b0b0]/40 mt-0.5">{action.category}</div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                ref={(node) => { recordButtonRefs.current[action.id] = node; }}
                onClick={() => setRecording(action.id)}
                onKeyDown={recording === action.id ? (e) => handleRecord(action.id, e) : undefined}
                className={`flex-1 text-left rounded-sm border px-3 py-2 text-sm cursor-pointer transition-colors ${
                  recording === action.id
                    ? "border-[#00ff41]/40 text-[#00ff41] bg-[#00ff41]/10"
                    : "border-[#1a1a1a]/40 text-[#e0e0e0] bg-[#0d0d0d] hover:bg-[#0d0d0d]/80"
                }`}
              >
                {recording === action.id ? "Press new shortcut..." : merged[action.id]}
              </button>
              <button
                type="button"
                onClick={() => handleResetAction(action.id)}
                className="text-[11px] text-[#b0b0b0]/60 hover:text-[#e0e0e0] cursor-pointer"
              >
                Reset
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MemoryEditor({ memory, onSaveMemory, onResetMemory }) {
  const normalized = normalizeUserMemory(memory);
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState("preferences");
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [expandedSections, setExpandedSections] = useState({});
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const MAX_VISIBLE_MEMORY_CHIPS = 8;
  const [importState, setImportState] = useState({
    open: false,
    method: "ai",
    rawText: "",
    extracted: normalizeUserMemory(DEFAULT_USER_MEMORY),
    review: false,
    fileName: "",
    aiStep: "prompt",
  });

  const categoryMeta = {
    preferences: {
      icon: "ðŸŸ¡",
      accent: "text-amber-300",
      border: "border-amber-500/20",
      bg: "bg-amber-500/10",
      placeholder: "User prefers short answers",
    },
    coding: {
      icon: "ðŸŸ¢",
      accent: "text-emerald-300",
      border: "border-emerald-500/20",
      bg: "bg-emerald-500/10",
      placeholder: "User prefers Python",
    },
    context: {
      icon: "ðŸ”µ",
      accent: "text-sky-300",
      border: "border-sky-500/20",
      bg: "bg-sky-500/10",
      placeholder: "User is building an AI app",
    },
  };

  const totalMemories = MEMORY_CATEGORY_DEFS.reduce(
    (sum, section) => sum + (normalized[section.id]?.length || 0),
    0
  );
  const extractedCount = MEMORY_CATEGORY_DEFS.reduce(
    (sum, section) => sum + (importState.extracted[section.id]?.length || 0),
    0
  );
  const quickPresets = [
    {
      label: "I am a programmer",
      memory: {
        preferences: [],
        coding: ["User prefers clean, readable code"],
        context: ["User is a programmer"],
      },
    },
    {
      label: "I am a student",
      memory: {
        preferences: ["User prefers step-by-step explanations"],
        coding: [],
        context: ["User is a student"],
      },
    },
    {
      label: "I want short answers",
      memory: {
        preferences: ["User prefers short answers"],
        coding: [],
        context: [],
      },
    },
  ];

  const saveMemory = async (nextMemory) => {
    setError("");
    setNotice("");
    await onSaveMemory?.(normalizeUserMemory(nextMemory));
  };

  const handleExportMemory = async () => {
    setError("");
    setNotice("");

    const stamp = new Date();
    const fileDate = stamp.toISOString().slice(0, 10);
    const suggestedName = `openrouter-memory-${fileDate}.json`;
    const exportPayload = {
      exportedAt: stamp.toISOString(),
      memory: normalized,
    };
    const content = JSON.stringify(exportPayload, null, 2);

    try {
      if (window.electronAPI?.exportMemory) {
        const result = await window.electronAPI.exportMemory({
          suggestedName,
          content,
        });

        if (result?.canceled) {
          setNotice("Export canceled.");
          return;
        }

        if (!result?.ok) {
          throw new Error(result?.error || "Could not export memory.");
        }

        setNotice(result?.path ? `Memory exported: ${result.path}` : "Memory exported.");
        return;
      }

      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = suggestedName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setNotice("Memory exported.");
    } catch (exportErr) {
      setError(exportErr?.message || "Could not export memory.");
    }
  };

  const handleAdd = async () => {
    const value = draft.trim();
    if (!value) return;
    if (isSensitiveMemoryText(value)) {
      setError("Sensitive info like keys, passwords, email addresses, or phone numbers will not be stored.");
      return;
    }

    const next = mergeUserMemory(normalized, {
      ...DEFAULT_USER_MEMORY,
      [category]: [value],
      autoMode: normalized.autoMode,
    });

    if (JSON.stringify(next) === JSON.stringify(normalized)) {
      setError("That memory is already saved.");
      return;
    }

    await saveMemory(next);
    setDraft("");
  };

  const openImportModal = () => {
    setError("");
    setImportState({
      open: true,
      method: "ai",
      rawText: "",
      extracted: normalizeUserMemory(DEFAULT_USER_MEMORY),
      review: false,
      fileName: "",
      aiStep: "prompt",
    });
  };

  const fallbackCopyWithExecCommand = (text) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  };

  const handleCopyPrompt = async () => {
    const text = AI_IMPORT_PROMPT;
    setError("");

    let copiedOk = false;

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copiedOk = true;
      } catch {}
    }

    if (!copiedOk && window.electronAPI?.writeClipboardText) {
      try {
        const result = await window.electronAPI.writeClipboardText(text);
        copiedOk = !!result?.ok;
      } catch {}
    }

    if (!copiedOk) {
      try {
        copiedOk = fallbackCopyWithExecCommand(text);
      } catch {
        copiedOk = false;
      }
    }

    if (!copiedOk) {
      setError("Clipboard permission denied. Copy the prompt manually from the box.");
      return;
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const goToPasteChatExport = () => {
    setImportState((current) => ({
      ...current,
      method: "paste",
      aiStep: "response",
      review: false,
    }));
    setError("");
  };

  const closeImportModal = () => {
    setImportState((current) => ({
      ...current,
      open: false,
      review: false,
    }));
  };

  const handleAnalyzeImport = () => {
    if (!importState.rawText.trim()) {
      setError(importState.method === "ai"
        ? "Paste the AI response first."
        : "Add some text, upload a file, or choose a quick setup preset first.");
      return;
    }

    const extracted = importState.method === "ai"
      ? parseStructuredAIResponse(importState.rawText)
      : extractMemoryFromImport(importState.rawText);
    setImportState((current) => ({
      ...current,
      extracted,
      review: true,
    }));
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setImportState((current) => ({
        ...current,
        method: "upload",
        rawText: text,
        fileName: file.name,
        review: false,
        extracted: normalizeUserMemory(DEFAULT_USER_MEMORY),
      }));
      setError("");
    } catch {
      setError("Could not read that file.");
    } finally {
      event.target.value = "";
    }
  };

  const handleApplyPreset = (preset) => {
    const summary = [
      ...preset.memory.preferences,
      ...preset.memory.coding,
      ...preset.memory.context,
    ].join("\n");

    setImportState((current) => ({
      ...current,
      method: "quick",
      rawText: summary,
      extracted: normalizeUserMemory({
        ...DEFAULT_USER_MEMORY,
        ...preset.memory,
        autoMode: normalized.autoMode,
      }),
      review: true,
      fileName: "",
    }));
    setError("");
  };

  const handleImportReviewChange = (sectionId, value) => {
    setImportState((current) => ({
      ...current,
      extracted: normalizeUserMemory({
        ...current.extracted,
        [sectionId]: value
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    }));
  };

  const handleSaveImport = async () => {
    const next = mergeUserMemory(normalized, {
      ...importState.extracted,
      autoMode: normalized.autoMode,
    });

    if (JSON.stringify(next) === JSON.stringify(normalized)) {
      setError("Nothing new to import.");
      return;
    }

    await saveMemory(next);
    closeImportModal();
  };

  const handleDelete = async (sectionId, index) => {
    await saveMemory(removeUserMemoryEntry(normalized, sectionId, index));
  };

  const handleEditSave = async () => {
    if (!editing) return;
    const value = editing.value.trim();
    if (!value) return;
    if (isSensitiveMemoryText(value)) {
      setError("Sensitive info like keys, passwords, email addresses, or phone numbers will not be stored.");
      return;
    }

    const next = updateUserMemoryEntry(normalized, editing.category, editing.index, value);
    await saveMemory(next);
    setEditing(null);
  };

  const handleClearAll = async () => {
    const shouldClear = window.confirm("Clear all saved memory?");
    if (!shouldClear) return;
    setEditing(null);
    setDraft("");
    setError("");
    await onResetMemory?.();
  };

  return (
    <section className="space-y-4">

      {/* ── Header row ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🧠 </span>
          <h3 className="text-sm font-semibold text-dark-100">Memory</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => saveMemory({ ...normalized, autoMode: !normalized.autoMode })}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              normalized.autoMode
                ? "text-[#00ff41] bg-[#00ff41]/10"
                : "text-[#b0b0b0]/60 hover:text-[#e0e0e0]"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${normalized.autoMode ? "bg-[#00ff41]" : "bg-dark-600"}`} />
            Auto
          </button>
          <button
            type="button"
            onClick={openImportModal}
            className="relative text-xs font-medium text-[#00ff41] px-3 py-1.5 rounded-full border border-[#00ff41]/40 bg-[#00ff41]/10 hover:bg-[#00ff41]/20 hover:border-[#00ff41]/60 shadow-[0_0_10px_rgba(234,179,8,0.15)] hover:shadow-[0_0_16px_rgba(234,179,8,0.28)] transition-all cursor-pointer"
          >
            Import
          </button>
          <button
            type="button"
            onClick={handleExportMemory}
            className="text-xs font-medium text-sky-200 px-3 py-1.5 rounded-full border border-sky-500/35 bg-sky-500/10 hover:bg-sky-500/18 hover:border-sky-400/55 transition-all cursor-pointer"
          >
            Export
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs text-[#b0b0b0]/40 hover:text-red-400 px-3 py-1.5 rounded-full transition-colors cursor-pointer"
          >
            Clear
          </button>
        </div>
      </div>

      {notice && <p className="text-xs text-emerald-300">{notice}</p>}

      {/* ── Add Memory ── */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-3 py-2.5 text-xs text-[#e0e0e0] focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40 cursor-pointer"
          >
            {MEMORY_CATEGORY_DEFS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <input
            ref={inputRef}
            type="text"
            placeholder={categoryMeta[category]?.placeholder || "Type memory..."}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-3 py-2.5 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40"
          />
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.1, ease }}
            onClick={handleAdd}
            className="bg-[#00ff41] hover:bg-[#00ff41] text-black font-medium rounded-sm px-4 py-2.5 text-sm cursor-pointer transition-colors"
          >
            Add
          </motion.button>
        </div>

        {/* Suggestions */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] text-[#b0b0b0]/30 self-center">💡¡</span>
          {MEMORY_CATEGORY_DEFS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setCategory(item.id);
                setDraft(categoryMeta[item.id]?.placeholder || "");
                inputRef.current?.focus();
              }}
              className="text-[11px] text-[#b0b0b0]/60 hover:text-dark-100 bg-[#111111]/60 hover:bg-[#111111] border border-[#1a1a1a]/40 hover:border-[#1a1a1a]/60 rounded-full px-2.5 py-1 cursor-pointer transition-colors"
            >
              {categoryMeta[item.id]?.placeholder || item.label}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {/* ── Memory List ── */}
      {totalMemories === 0 ? (
        <div className="py-10 text-center space-y-3">
          <div className="text-2xl">🧠 </div>
          <p className="text-sm text-[#b0b0b0]/60">No memory yet</p>
          <p className="text-xs text-[#b0b0b0]/30">Import from another AI or add manually above</p>
          <div className="flex justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={openImportModal}
              className="text-xs text-[#e0e0e0] hover:text-white border border-[#1a1a1a]/50 hover:border-[#1a1a1a] rounded-sm px-3 py-1.5 cursor-pointer transition-colors"
            >
              Import Memory
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              className="text-xs text-black bg-[#00ff41] hover:bg-[#00ff41] rounded-sm px-3 py-1.5 cursor-pointer font-medium transition-colors"
            >
              Add Memory
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {MEMORY_CATEGORY_DEFS.map((section) => {
            const entries = normalized[section.id] || [];
            if (entries.length === 0) return null;
            const meta = categoryMeta[section.id];
            const isExpanded = !!expandedSections[section.id];
            const hiddenCount = Math.max(0, entries.length - MAX_VISIBLE_MEMORY_CHIPS);
            const visibleEntries = isExpanded
              ? entries.map((entry, index) => ({ entry, index }))
              : entries.slice(0, MAX_VISIBLE_MEMORY_CHIPS).map((entry, index) => ({ entry, index }));
            return (
              <div key={section.id} className="space-y-2">
                <p className={`text-[11px] font-medium uppercase tracking-wider ${meta.accent}`}>
                  {section.label}
                  <span className="ml-1 text-[10px] text-[#b0b0b0]/40 normal-case tracking-normal">({entries.length})</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {visibleEntries.map(({ entry, index }) => {
                    const isEditing = editing?.category === section.id && editing?.index === index;
                    return isEditing ? (
                      <div
                        key={`${section.id}-${index}`}
                        className="w-full flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={editing.value}
                          onChange={(e) => setEditing((current) => ({ ...current, value: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") handleEditSave(); if (e.key === "Escape") setEditing(null); }}
                          className="flex-1 bg-[#111111] border border-[#00ff41]/40 rounded-sm px-3 py-1.5 text-sm text-white focus:outline-none"
                          autoFocus
                        />
                        <button type="button" onClick={handleEditSave} className="text-[11px] text-[#00ff41] hover:text-[#00ff41] cursor-pointer">Save</button>
                        <button type="button" onClick={() => setEditing(null)} className="text-[11px] text-[#b0b0b0]/40 hover:text-[#b0b0b0] cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <div
                        key={`${section.id}-${index}`}
                        className={`group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs border transition-colors ${meta.bg} ${meta.border} hover:border-white/20`}
                      >
                        <span className="text-dark-100 truncate max-w-[240px]">{entry}</span>
                        <button
                          type="button"
                          onClick={() => { setError(""); setEditing({ category: section.id, index, value: entry }); }}
                          className="text-[10px] text-[#b0b0b0]/40 hover:text-[#e0e0e0] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label={`Edit ${entry}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(section.id, index)}
                          className="text-[#b0b0b0]/40 hover:text-red-400 cursor-pointer leading-none"
                          aria-label={`Delete ${entry}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  {hiddenCount > 0 && !isExpanded && (
                    <button
                      type="button"
                      onClick={() => setExpandedSections((prev) => ({ ...prev, [section.id]: true }))}
                      className="inline-flex items-center rounded-full px-3 py-1.5 text-xs border border-[#1a1a1a]/60 text-[#b0b0b0] hover:text-dark-100 hover:border-dark-500/70 bg-[#111111]/70 hover:bg-[#111111] transition-colors cursor-pointer"
                    >
                      +{hiddenCount} more
                    </button>
                  )}
                  {hiddenCount > 0 && isExpanded && (
                    <button
                      type="button"
                      onClick={() => setExpandedSections((prev) => ({ ...prev, [section.id]: false }))}
                      className="inline-flex items-center rounded-full px-3 py-1.5 text-xs border border-[#1a1a1a]/60 text-[#b0b0b0] hover:text-dark-100 hover:border-dark-500/70 bg-[#111111]/70 hover:bg-[#111111] transition-colors cursor-pointer"
                    >
                      Show less
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {importState.open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease }}
            className="fixed inset-0 z-50 bg-[#0a0a0a]/95  flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2, ease }}
              className="w-full max-w-3xl bg-[#0d0d0d] border border-[#1a1a1a]/60 rounded-sm shadow-2xl shadow-black/30 overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]/50">
                <div>
                  <h4 className="text-sm font-semibold text-dark-100">Import Memory</h4>
                  <p className="text-xs text-[#b0b0b0]/40 mt-1">Bring preferences from Claude, ChatGPT, or any notes you already have.</p>
                </div>
                <button
                  type="button"
                  onClick={closeImportModal}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-sm text-[#b0b0b0]/60 hover:text-dark-100 hover:bg-[#111111] cursor-pointer"
                  aria-label="Close import dialog"
                >
                  ×
                </button>
              </div>

              <div className="px-5 py-4 space-y-4 max-h-[75vh] overflow-y-auto">
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "ai", label: "Import from AI" },
                    { id: "paste", label: "Paste Chat Export" },
                    { id: "upload", label: "Upload File" },
                    { id: "quick", label: "Quick Setup" },
                  ].map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setImportState((current) => ({ ...current, method: method.id, review: false, aiStep: "prompt" }))}
                      className={`rounded-sm px-3 py-2 text-xs font-medium cursor-pointer border transition-colors ${
                        importState.method === method.id
                          ? "bg-[#00ff41]/18 text-[#00ff41] border-[#00ff41]/30"
                          : "bg-[#111111] text-[#b0b0b0] border-[#1a1a1a]/50 hover:border-[#1a1a1a]/60"
                      }`}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>

                {importState.method === "ai" && !importState.review && (
                  <div className="space-y-4">
                    {/* Step tabs */}
                    <div className="flex gap-1 bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-sm p-1">
                      <button
                        type="button"
                        onClick={() => setImportState((s) => ({ ...s, aiStep: "prompt" }))}
                        className={`flex-1 rounded-sm px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                          importState.aiStep !== "response"
                            ? "bg-[#00ff41]/18 text-[#00ff41]"
                            : "text-[#b0b0b0]/60 hover:text-[#e0e0e0] hover:bg-[#111111]"
                        }`}
                      >
                        1. Generate Prompt
                      </button>
                      <button
                        type="button"
                        onClick={goToPasteChatExport}
                        className={`flex-1 rounded-sm px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                          importState.aiStep === "response"
                            ? "bg-[#00ff41]/18 text-[#00ff41]"
                            : "text-[#b0b0b0]/60 hover:text-[#e0e0e0] hover:bg-[#111111]"
                        }`}
                      >
                        2. Paste Chat Export
                      </button>
                    </div>

                    {importState.aiStep !== "response" && (
                      <div className="space-y-3">
                        <p className="text-xs text-[#b0b0b0]/60">
                          Copy this prompt and paste it into ChatGPT, Claude, or any AI that knows your history. Then come back and paste the response.
                        </p>
                        <div className="bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-sm px-4 py-4">
                          <pre className="text-xs text-[#e0e0e0] whitespace-pre-wrap font-mono leading-relaxed">{AI_IMPORT_PROMPT}</pre>
                        </div>
                        <div className="flex justify-between items-center">
                          <p className="text-[11px] text-[#b0b0b0]/40">Ask it to analyze your conversation history</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={handleCopyPrompt}
                              className={`text-sm font-medium rounded-sm px-4 py-2 cursor-pointer transition-colors ${
                                copied
                                  ? "text-emerald-300 bg-emerald-500/12 border border-emerald-500/20"
                                  : "text-black bg-[#00ff41] hover:bg-[#00ff41]"
                              }`}
                            >
                              {copied ? " Copied!" : "Copy Prompt"}
                            </button>
                            <button
                              type="button"
                              onClick={goToPasteChatExport}
                              className="text-sm text-[#e0e0e0] bg-[#111111] hover:bg-[#1a1a1a] border border-[#1a1a1a]/50 rounded-sm px-4 py-2 cursor-pointer"
                            >
                              Next: Paste Chat Export
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {importState.aiStep === "response" && (
                      <div className="space-y-3">
                        <p className="text-xs text-[#b0b0b0]/60">
                          Paste the AI's response below. It should follow the Preferences / Coding Style / Context format.
                        </p>
                        <textarea
                          rows={10}
                          value={importState.rawText}
                          onChange={(e) => setImportState((current) => ({ ...current, rawText: e.target.value, review: false }))}
                          placeholder={"Preferences:\n* prefers short answers\n\nCoding Style:\n* prefers Python\n\nContext:\n* building AI app"}
                          className="w-full bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-sm px-3 py-3 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40 resize-none font-mono"
                        />
                        <div className="flex justify-between items-center">
                          <button
                            type="button"
                            onClick={() => setImportState((s) => ({ ...s, aiStep: "prompt" }))}
                            className="text-xs text-[#b0b0b0]/60 hover:text-[#e0e0e0] cursor-pointer"
                          >
                            Back to prompt
                          </button>
                          <button
                            type="button"
                            onClick={handleAnalyzeImport}
                            className="text-sm text-black bg-[#00ff41] hover:bg-[#00ff41] rounded-sm px-4 py-2 cursor-pointer font-medium"
                          >
                            Analyze Response
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {importState.method === "paste" && (
                  <div className="space-y-3">
                    <textarea
                      rows={10}
                      value={importState.rawText}
                      onChange={(e) => setImportState((current) => ({ ...current, rawText: e.target.value, review: false }))}
                      placeholder="Paste a ChatGPT conversation, Claude export, or any text that shows how you like answers and what you work on."
                      className="w-full bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-sm px-3 py-3 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40 resize-none"
                    />
                    <p className="text-[11px] text-[#b0b0b0]/40">
                      Example: "I usually write Python and prefer concise answers."
                    </p>
                  </div>
                )}

                {importState.method === "upload" && (
                  <div className="space-y-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.json,.md"
                      onChange={handleImportFile}
                      className="hidden"
                    />
                    <div className="bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-sm px-4 py-5 text-center">
                      <p className="text-sm text-[#e0e0e0]">Upload a `.txt`, `.json`, or `.md` file</p>
                      <p className="text-[11px] text-[#b0b0b0]/40 mt-1">Great for exported chats, notes, and setup files.</p>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-4 text-sm text-black bg-[#00ff41] hover:bg-[#00ff41] rounded-sm px-4 py-2 cursor-pointer font-medium"
                      >
                        Choose File
                      </button>
                      {importState.fileName && (
                        <p className="text-[11px] text-[#b0b0b0]/60 mt-3">Loaded: {importState.fileName}</p>
                      )}
                    </div>
                  </div>
                )}

                {importState.method === "quick" && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {quickPresets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => handleApplyPreset(preset)}
                        className="text-left bg-[#0a0a0a] border border-[#1a1a1a]/50 hover:border-[#00ff41]/30 rounded-sm px-4 py-4 cursor-pointer transition-colors"
                      >
                        <div className="text-sm font-medium text-dark-100">{preset.label}</div>
                        <div className="text-[11px] text-[#b0b0b0]/40 mt-2">
                          {[
                            ...preset.memory.preferences,
                            ...preset.memory.coding,
                            ...preset.memory.context,
                          ].join(" * ")}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {!importState.review && importState.method !== "ai" && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleAnalyzeImport}
                      className="text-sm text-black bg-[#00ff41] hover:bg-[#00ff41] rounded-sm px-4 py-2 cursor-pointer font-medium"
                    >
                      Analyze Import
                    </button>
                  </div>
                )}

                {importState.review && (
                  <div className="space-y-4">
                    <div className="bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-sm px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h5 className="text-sm font-medium text-dark-100">We found {extractedCount} memory items</h5>
                          <p className="text-[11px] text-[#b0b0b0]/40 mt-1">Review or edit before saving. Nothing is stored until you confirm.</p>
                        </div>
                      </div>
                    </div>

                    {MEMORY_CATEGORY_DEFS.map((section) => (
                      <div key={section.id} className="space-y-2">
                        <div className="text-xs font-medium text-[#b0b0b0]">{section.label}</div>
                        <textarea
                          rows={Math.max(3, importState.extracted[section.id].length || 1)}
                          value={importState.extracted[section.id].join("\n")}
                          onChange={(e) => handleImportReviewChange(section.id, e.target.value)}
                          placeholder={`No ${section.label.toLowerCase()} found`}
                          className="w-full bg-[#0a0a0a] border border-[#1a1a1a]/50 rounded-sm px-3 py-2.5 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40 resize-none"
                        />
                      </div>
                    ))}

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setImportState((current) => ({ ...current, review: false }))}
                        className="text-sm text-[#b0b0b0] bg-[#111111] hover:bg-[#1a1a1a] border border-[#1a1a1a]/50 rounded-sm px-4 py-2 cursor-pointer"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveImport}
                        className="text-sm text-black bg-[#00ff41] hover:bg-[#00ff41] rounded-sm px-4 py-2 cursor-pointer font-medium"
                      >
                        Save Imported Memory
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

const USAGE_PROVIDER_META = {
  ollama: { label: "Ollama", color: "#22c55e" },
  openrouter: { label: "OpenRouter", color: "#7c6ff7" },
  huggingface: { label: "HuggingFace", color: "#f5a623" },
  openai: { label: "OpenAI", color: "#10a37f" },
  anthropic: { label: "Anthropic", color: "#c96442" },
};

function formatUsageInt(value) {
  return (Number(value) || 0).toLocaleString();
}

function formatUsageCost(value) {
  const amount = Number(value) || 0;
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function formatUsagePercent(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "n/a";
  if (amount >= 100 || Math.abs(amount - Math.round(amount)) < 0.01) return `${Math.round(amount)}%`;
  if (amount >= 10) return `${amount.toFixed(1)}%`;
  return `${amount.toFixed(2)}%`;
}

function usagePercentWidth(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.max(0, Math.min(100, amount));
}

function formatUsedLimit(used, limit) {
  const usedNumber = Number(used);
  const limitNumber = Number(limit);

  if (!Number.isFinite(usedNumber) && !Number.isFinite(limitNumber)) return "";
  if (Number.isFinite(usedNumber) && Number.isFinite(limitNumber) && limitNumber > 0) {
    return `${formatUsageInt(usedNumber)} / ${formatUsageInt(limitNumber)}`;
  }
  if (Number.isFinite(usedNumber)) return `${formatUsageInt(usedNumber)} used`;
  if (Number.isFinite(limitNumber)) return `${formatUsageInt(limitNumber)} limit`;
  return "";
}

function SidebarUsageSnapshotPanel({ usageSnapshot }) {
  if (!usageSnapshot) return null;

  return (
    <section className="rounded-sm border border-[#1a1a1a]/50 bg-[#111111] p-4 space-y-3">
      <div>
        <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">Usage Snapshot</h3>
        <p className="text-[11px] text-[#b0b0b0]/40 mt-1">Same summary as the sidebar usage panel.</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider">Session</p>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#b0b0b0]/60">Cost</span>
          <span className={`font-medium ${usageSnapshot.sessionCostHasValue ? "text-emerald-400" : "text-[#b0b0b0]/60"}`}>
            {usageSnapshot.sessionCostLabel}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#b0b0b0]/60">Model</span>
          <span className="text-[#e0e0e0] font-medium truncate max-w-[180px] text-right">
            {usageSnapshot.selectedModelLabel}
          </span>
        </div>
        {usageSnapshot.monthlyLabel && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#b0b0b0]/60">~Monthly</span>
            <span className={`font-medium ${usageSnapshot.monthlyIsPaid ? "text-amber-300" : "text-[#b0b0b0]/40"}`}>
              {usageSnapshot.monthlyLabel}
            </span>
          </div>
        )}
      </div>

      {Array.isArray(usageSnapshot.providerRows) && usageSnapshot.providerRows.length > 0 && (
        <div className="space-y-1.5 border-t border-white/[0.04] pt-2">
          <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider">Providers</p>
          {usageSnapshot.providerRows.map((row) => (
            <div key={row.provider} className="flex items-center justify-between text-[11px] py-0.5">
              <span className="text-[#b0b0b0]/60">{row.label}</span>
              <span className={`font-medium ${row.hasCost ? "text-emerald-400" : "text-[#b0b0b0]/40"}`}>
                {row.costLabel}
              </span>
            </div>
          ))}
        </div>
      )}

      {usageSnapshot.creditsLabel && (
        <div className="space-y-1.5 border-t border-white/[0.04] pt-2">
          <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider">Credits</p>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#b0b0b0]/60">OpenRouter</span>
            <span className="text-emerald-400 font-medium">{usageSnapshot.creditsLabel}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function SessionUsagePanel({ providerUsage = {}, providers = {} }) {
  const orderedProviders = ["ollama", "openrouter", "huggingface", "openai", "anthropic"];

  const rows = orderedProviders
    .map((provider) => {
      const usage = providerUsage?.[provider] || {};
      const meta = USAGE_PROVIDER_META[provider] || { label: provider, color: "#64748b" };

      return {
        provider,
        label: meta.label,
        color: meta.color,
        connected: !!providers?.[provider],
        requests: Number(usage.requests) || 0,
        promptTokens: Number(usage.promptTokens) || 0,
        completionTokens: Number(usage.completionTokens) || 0,
        cost: Number(usage.cost) || 0,
      };
    })
    .filter(
      (row) =>
        row.connected ||
        row.requests > 0 ||
        row.promptTokens > 0 ||
        row.completionTokens > 0 ||
        row.cost > 0
    );

  if (rows.length === 0) {
    return (
      <div className="rounded-sm border border-[#1a1a1a]/50 bg-[#111111] p-6 text-center space-y-2">
        <svg className="w-8 h-8 mx-auto text-[#b0b0b0]/40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 14l3-3 3 2 4-5" />
        </svg>
        <p className="text-sm text-[#b0b0b0]/60">No session usage yet. Start chatting to populate usage stats.</p>
      </div>
    );
  }

  const totals = rows.reduce(
    (acc, row) => ({
      requests: acc.requests + row.requests,
      promptTokens: acc.promptTokens + row.promptTokens,
      completionTokens: acc.completionTokens + row.completionTokens,
      cost: acc.cost + row.cost,
    }),
    { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 }
  );

  return (
    <div className="space-y-3">
      <section className="rounded-sm border border-[#1a1a1a]/50 bg-[#111111] p-4 space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">Session Usage</h3>
          <p className="text-[11px] text-[#b0b0b0]/40 mt-1">Tracked locally for this app session history, including Ollama.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#0d0d0d]/50 border border-[#1a1a1a]/30 rounded-sm px-3 py-2">
            <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider">Requests</p>
            <p className="text-sm font-semibold text-dark-100 mt-0.5">{formatUsageInt(totals.requests)}</p>
          </div>
          <div className="bg-[#0d0d0d]/50 border border-[#1a1a1a]/30 rounded-sm px-3 py-2">
            <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider">Cost</p>
            <p className="text-sm font-semibold text-dark-100 mt-0.5">{formatUsageCost(totals.cost)}</p>
          </div>
          <div className="bg-[#0d0d0d]/50 border border-[#1a1a1a]/30 rounded-sm px-3 py-2">
            <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider">Prompt Tokens</p>
            <p className="text-sm font-semibold text-dark-100 mt-0.5">{formatUsageInt(totals.promptTokens)}</p>
          </div>
          <div className="bg-[#0d0d0d]/50 border border-[#1a1a1a]/30 rounded-sm px-3 py-2">
            <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider">Completion Tokens</p>
            <p className="text-sm font-semibold text-dark-100 mt-0.5">{formatUsageInt(totals.completionTokens)}</p>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        {rows.map((row) => (
          <div key={row.provider} className="rounded-sm border border-[#1a1a1a]/50 bg-[#111111] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: row.color }} />
                <span className="text-sm font-semibold text-dark-100">{row.label}</span>
                {row.connected && (
                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5 font-medium">Connected</span>
                )}
              </div>
              <span className="text-[11px] text-[#b0b0b0]/60">{formatUsageInt(row.requests)} req</span>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="text-[11px] text-[#b0b0b0]/60">In: <span className="text-[#e0e0e0]">{formatUsageInt(row.promptTokens)}</span></div>
              <div className="text-[11px] text-[#b0b0b0]/60">Out: <span className="text-[#e0e0e0]">{formatUsageInt(row.completionTokens)}</span></div>
              <div className="text-[11px] text-[#b0b0b0]/60">Cost: <span className="text-[#e0e0e0]">{formatUsageCost(row.cost)}</span></div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function OllamaCloudUsagePanel({ ollamaValue }) {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const rawValue = String(ollamaValue || "").trim();
  const looksLikeUrl =
    /^https?:\/\//i.test(rawValue) ||
    rawValue.includes("localhost") ||
    rawValue.includes("127.0.0.1");

  useEffect(() => {
    let cancelled = false;

    if (!rawValue) {
      setUsage(null);
      setErr("");
      setLoading(false);
      return () => { cancelled = true; };
    }

    if (looksLikeUrl) {
      setUsage(null);
      setErr("Cloud usage requires an Ollama API key. Local host URLs do not expose cloud usage limits.");
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    setErr("");

    fetchOllamaCloudUsage(rawValue)
      .then((result) => {
        if (cancelled) return;
        setUsage(result || null);
        setErr("");
      })
      .catch((error) => {
        if (cancelled) return;
        setUsage(null);
        setErr(error?.message || "Could not fetch Ollama cloud usage.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rawValue, looksLikeUrl, refreshToken]);

  const openOllamaSettings = () => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal("https://ollama.com/settings");
    } else {
      window.open("https://ollama.com/settings", "_blank", "noopener");
    }
  };

  if (!rawValue) {
    return (
      <div className="rounded-sm border border-[#1a1a1a]/50 bg-[#111111] p-6 text-center space-y-2">
        <svg className="w-8 h-8 mx-auto text-[#b0b0b0]/40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        <p className="text-sm text-[#b0b0b0]/60">Connect your Ollama cloud API key in General settings to view cloud usage percentage.</p>
      </div>
    );
  }

  const session = usage?.session || {};
  const weekly = usage?.weekly || {};
  const hasMetrics = !!usage?.available;

  const rows = [
    { label: "Session usage", value: session.percentUsed, resetsIn: session.resetsIn, usedLimit: formatUsedLimit(session.used, session.limit) },
    { label: "Weekly usage", value: weekly.percentUsed, resetsIn: weekly.resetsIn, usedLimit: formatUsedLimit(weekly.used, weekly.limit) },
  ];

  return (
    <section className="rounded-sm border border-[#22c55e]/20 bg-[#22c55e]/[0.04] p-4 space-y-4">
      <div className="flex items-center gap-2.5">
        <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e] shrink-0" />
        <span className="text-sm font-semibold text-dark-100">Ollama Cloud Usage</span>
        {usage?.plan && (
          <span className="text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 font-medium">
            {usage.plan}
          </span>
        )}
        {loading && <span className="text-[11px] text-[#b0b0b0]/40 ml-auto">Loading…</span>}
        {!loading && (
          <button
            type="button"
            onClick={() => setRefreshToken((token) => token + 1)}
            className="ml-auto text-[11px] text-emerald-300/80 hover:text-emerald-200 font-medium cursor-pointer"
          >
            Refresh
          </button>
        )}
      </div>

      <p className="text-[11px] text-[#b0b0b0]/40">
        Cloud models and capabilities contribute to session and weekly limits on your Ollama account.
      </p>

      {err && (
        <p className="text-xs text-red-400">{err}</p>
      )}

      {!loading && usage && !hasMetrics && !err && (
        <p className="text-xs text-[#b0b0b0]/60">
          Usage percentages are not exposed by this Ollama account API response. Open your account page for live quota details.
        </p>
      )}

      {hasMetrics && (
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-[#e0e0e0]">{row.label}</span>
              <span className="text-sm text-dark-100">{formatUsagePercent(row.value)} used</span>
            </div>

            <div className="w-full h-2 rounded-full bg-[#0d0d0d]/70 border border-[#1a1a1a]/40 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500/80 to-lime-400/80 rounded-full transition-all duration-500"
                style={{ width: `${usagePercentWidth(row.value)}%` }}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[#b0b0b0]/40">{row.resetsIn ? `Resets in ${row.resetsIn}` : "Reset schedule unavailable"}</span>
              {row.usedLimit && (
                <span className="text-[11px] text-[#b0b0b0]/40">{row.usedLimit}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      )}

      <button
        type="button"
        onClick={openOllamaSettings}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm border border-[#22c55e]/30 text-[#22c55e]/90 hover:bg-[#22c55e]/10 text-xs font-medium cursor-pointer transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
        Open Ollama Account Usage
      </button>
    </section>
  );
}

// ── HuggingFace Usage Tab ─────────────────────────────────────────────────────

function HFUsageTab({ hfKey }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!hfKey) return;
    setLoading(true); setErr("");
    fetch("https://huggingface.co/api/whoami-v2", {
      headers: { Authorization: `Bearer ${hfKey}` },
    })
      .then((r) => r.json())
      .then((data) => { setInfo(data); setLoading(false); })
      .catch(() => { setErr("Could not fetch account info."); setLoading(false); });
  }, [hfKey]);

  const openBilling = () => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal("https://huggingface.co/settings/billing");
    } else {
      window.open("https://huggingface.co/settings/billing", "_blank", "noopener");
    }
  };
  const openZeroGPU = () => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal("https://huggingface.co/settings/inference-api");
    } else {
      window.open("https://huggingface.co/settings/inference-api", "_blank", "noopener");
    }
  };

  if (!hfKey) {
    return (
      <div className="rounded-sm border border-[#1a1a1a]/50 bg-[#111111] p-6 text-center space-y-2">
        <svg className="w-8 h-8 mx-auto text-[#b0b0b0]/40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        <p className="text-sm text-[#b0b0b0]/60">Connect your HuggingFace key in General settings to view usage.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Account card */}
      <div className="rounded-sm border border-[#f5a623]/20 bg-[#f5a623]/[0.04] p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#f5a623] shrink-0" />
          <span className="text-sm font-semibold text-dark-100">HuggingFace Account</span>
          {loading && <span className="text-[11px] text-[#b0b0b0]/40 ml-auto">Loading…</span>}
        </div>

        {err && <p className="text-xs text-red-400">{err}</p>}

        {info && !loading && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {info.avatarUrl && (
                <img src={info.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
              )}
              <div>
                <p className="text-sm font-medium text-white">{info.fullname || info.name}</p>
                <p className="text-[11px] text-[#b0b0b0]/60">@{info.name}</p>
              </div>
              <span className="ml-auto text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 font-medium">Connected</span>
            </div>
            {info.email && (
              <p className="text-[11px] text-[#b0b0b0]/40">{info.email}</p>
            )}
          </div>
        )}
      </div>

      {/* Live usage — links to HF pages */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={openBilling}
          className="rounded-sm border border-[#1a1a1a]/50 bg-[#111111] p-4 text-left hover:border-[#f5a623]/30 hover:bg-[#f5a623]/[0.03] transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-[#f5a623]/70" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
            </svg>
            <span className="text-xs font-semibold text-[#e0e0e0] group-hover:text-white transition-colors">Billing & Credits</span>
            <svg className="w-3 h-3 text-[#b0b0b0]/40 ml-auto group-hover:text-[#b0b0b0]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </div>
          <p className="text-[11px] text-[#b0b0b0]/40">View balance, credits, and payment history on HuggingFace</p>
        </button>

        <button
          onClick={openZeroGPU}
          className="rounded-sm border border-[#1a1a1a]/50 bg-[#111111] p-4 text-left hover:border-sky-500/30 hover:bg-sky-500/[0.03] transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-sky-400/70" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
            <span className="text-xs font-semibold text-[#e0e0e0] group-hover:text-white transition-colors">Inference API</span>
            <svg className="w-3 h-3 text-[#b0b0b0]/40 ml-auto group-hover:text-[#b0b0b0]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </div>
          <p className="text-[11px] text-[#b0b0b0]/40">View ZeroGPU quota and inference usage limits</p>
        </button>
      </div>

      {/* Hub rate limits info */}
      <div className="rounded-sm border border-[#1a1a1a]/50 bg-[#111111] p-4 space-y-3">
        <p className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">Hub Rate Limits (free tier)</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Hub APIs", limit: "1k req / 5 min" },
            { label: "Resolvers", limit: "5k req / 5 min" },
            { label: "Pages", limit: "200 req / 5 min" },
          ].map((item) => (
            <div key={item.label} className="bg-[#0d0d0d]/50 border border-[#1a1a1a]/30 rounded-sm p-3 text-center">
              <p className="text-[11px] font-medium text-[#e0e0e0]">{item.label}</p>
              <p className="text-[10px] text-[#b0b0b0]/40 mt-0.5">{item.limit}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-[#b0b0b0]/40">Rate limits reset every 5 minutes. Upgrade your HF plan for higher limits.</p>
      </div>

      {/* Quick link */}
      <button
        onClick={openBilling}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm border border-[#f5a623]/20 text-[#f5a623]/80 hover:bg-[#f5a623]/10 text-xs font-medium cursor-pointer transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
        Open HuggingFace Billing Dashboard
      </button>
    </div>
  );
}

// ── Appearance Controls ─────────────────────────────────────────────────────

const ACCENT_COLORS = [
  { id: "green", label: "Matrix", color: "#00ff41" },
  { id: "cyan", label: "Cyan", color: "#00d4ff" },
  { id: "purple", label: "Violet", color: "#a855f7" },
  { id: "orange", label: "Amber", color: "#f59e0b" },
  { id: "rose", label: "Rose", color: "#f43f5e" },
  { id: "blue", label: "Blue", color: "#3b82f6" },
];

const THEME_VARS = {
  dark:     { "--bg-primary": "#0a0a0a", "--bg-secondary": "#111111", "--bg-tertiary": "#1a1a1a" },
  midnight: { "--bg-primary": "#060612", "--bg-secondary": "#0d0d1a", "--bg-tertiary": "#16162a" },
  oled:     { "--bg-primary": "#000000", "--bg-secondary": "#0a0a0a", "--bg-tertiary": "#111111" },
};

function buildThemeOverrideCSS(themeId, accentHex) {
  const vars = THEME_VARS[themeId] || THEME_VARS.dark;
  const p = vars["--bg-primary"];
  const s = vars["--bg-secondary"];
  const t = vars["--bg-tertiary"];
  const a = accentHex || "#00ff41";
  const aGlow = a + "40";

  // Only override if non-default
  const isDark = themeId === "dark" || !themeId;
  const isGreen = !accentHex || accentHex === "#00ff41";
  if (isDark && isGreen) return "";

  let css = `:root { --bg-primary:${p}; --bg-secondary:${s}; --bg-tertiary:${t}; --accent:${a}; --accent-glow:${aGlow}; }\n`;

  // Theme background overrides
  if (!isDark) {
    css += `
/* Primary bg overrides */
.bg-\\[\\#0a0a0a\\], .bg-\\[\\#0a0a0a\\]\\/95 { background-color: ${p} !important; }
.bg-\\[\\#0d0d0d\\] { background-color: ${p} !important; }
.bg-\\[\\#111111\\], .bg-\\[\\#111\\]\\/50, .bg-\\[\\#111\\]\\/30 { background-color: ${s} !important; }
.bg-\\[\\#1a1a1a\\], .bg-\\[\\#1a1a1a\\]\\/50 { background-color: ${t} !important; }
.border-\\[\\#1a1a1a\\], .border-\\[\\#1a1a1a\\]\\/50, .border-\\[\\#1a1a1a\\]\\/40 { border-color: ${t} !important; }
.border-\\[\\#2a2a2a\\] { border-color: color-mix(in srgb, ${t} 70%, white 10%) !important; }
body { background-color: ${p} !important; }
::-webkit-scrollbar-track { background: ${p} !important; }
::-webkit-scrollbar-thumb { background: ${t} !important; }
`;
  }

  // Accent color overrides
  if (!isGreen) {
    css += `
/* Accent color overrides */
.text-\\[\\#00ff41\\] { color: ${a} !important; }
.text-\\[\\#00ff41\\]\\/50, .text-\\[\\#00ff41\\]\\/60, .text-\\[\\#00ff41\\]\\/70, .text-\\[\\#00ff41\\]\\/80, .text-\\[\\#00ff41\\]\\/90 { color: ${a} !important; opacity: inherit; }
.bg-\\[\\#00ff41\\] { background-color: ${a} !important; }
.bg-\\[\\#00ff41\\]\\/5, .bg-\\[\\#00ff41\\]\\/10, .bg-\\[\\#00ff41\\]\\/15, .bg-\\[\\#00ff41\\]\\/20 { background-color: color-mix(in srgb, ${a} 15%, transparent) !important; }
.border-\\[\\#00ff41\\]\\/20, .border-\\[\\#00ff41\\]\\/30, .border-\\[\\#00ff41\\]\\/40 { border-color: color-mix(in srgb, ${a} 30%, transparent) !important; }
.text-glow-green { text-shadow: 0 0 8px color-mix(in srgb, ${a} 30%, transparent) !important; }
.terminal-cursor { background: ${a} !important; }
.ring-\\[\\#00ff41\\]\\/40, .focus\\:ring-\\[\\#00ff41\\]\\/40:focus { --tw-ring-color: color-mix(in srgb, ${a} 40%, transparent) !important; }
input[type="range"]::-webkit-slider-thumb { border-color: ${a} !important; }
`;
  }

  return css;
}

function applyThemeOverrides(themeId, accentHex) {
  const css = buildThemeOverrideCSS(themeId, accentHex);
  let el = document.getElementById("kp-theme-overrides");
  if (!el) {
    el = document.createElement("style");
    el.id = "kp-theme-overrides";
    document.head.appendChild(el);
  }
  el.textContent = css;
}

function applyTheme(themeId) {
  const accentId = (() => { try { return localStorage.getItem("kp_accent_color") || "green"; } catch { return "green"; } })();
  const accentHex = ACCENT_COLORS.find((c) => c.id === accentId)?.color || "#00ff41";
  applyThemeOverrides(themeId, accentHex);
}

function applyAccentColor(colorHex) {
  const themeId = (() => { try { return localStorage.getItem("kp_theme") || "dark"; } catch { return "dark"; } })();
  applyThemeOverrides(themeId, colorHex);
}

function AppearanceSelector({ label, description, storageKey, defaultValue, options }) {
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem(storageKey) || defaultValue; } catch { return defaultValue; }
  });
  const handleSelect = (value) => {
    setSelected(value);
    try { localStorage.setItem(storageKey, value); } catch {}
    if (storageKey === "kp_theme") applyTheme(value);
  };
  return (
    <div className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-4 py-3 space-y-2">
      <div>
        <span className="text-sm text-[#e0e0e0] font-medium">{label}</span>
        <p className="text-[11px] text-[#b0b0b0]/40 mt-0.5">{description}</p>
      </div>
      <div className="flex bg-[#0d0d0d] border border-[#1a1a1a]/40 rounded-sm p-0.5 gap-0.5">
        {options.map((opt) => (
          <motion.button
            key={opt.value}
            type="button"
            onClick={() => handleSelect(opt.value)}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.12, ease }}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-sm px-2.5 py-2 text-xs font-medium cursor-pointer transition-all ${
              selected === opt.value
                ? "bg-[#00ff41]/15 text-[#00ff41]"
                : "text-[#b0b0b0]/50 hover:text-[#e0e0e0] hover:bg-[#1a1a1a]/40"
            }`}
          >
            {opt.color && (
              <span
                className="w-2.5 h-2.5 rounded-full border border-white/10 shrink-0"
                style={{ backgroundColor: opt.color }}
              />
            )}
            {opt.label}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function AccentColorPicker() {
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem("kp_accent_color") || "green"; } catch { return "green"; }
  });
  const handleSelect = (colorId) => {
    setSelected(colorId);
    const def = ACCENT_COLORS.find((c) => c.id === colorId);
    try { localStorage.setItem("kp_accent_color", colorId); } catch {}
    if (def) applyAccentColor(def.color);
  };
  return (
    <div className="flex items-center gap-2">
      {ACCENT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => handleSelect(c.id)}
          title={c.label}
          className={`relative w-7 h-7 rounded-full cursor-pointer transition-all ${
            selected === c.id ? "ring-2 ring-offset-2 ring-offset-[#111] scale-110" : "hover:scale-110"
          }`}
          style={{
            backgroundColor: c.color,
            ringColor: c.color,
          }}
        >
          {selected === c.id && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <svg className="w-3.5 h-3.5 text-black" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </motion.div>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Generation Parameter Slider ─────────────────────────────────────────────

function GenerationSlider({ label, description, storageKey, defaultValue, min, max, step, formatValue }) {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v !== null ? Number(v) : defaultValue;
    } catch { return defaultValue; }
  });
  const handleChange = (e) => {
    const v = Number(e.target.value);
    setValue(v);
    try { localStorage.setItem(storageKey, String(v)); } catch {}
  };
  const handleReset = () => {
    setValue(defaultValue);
    try { localStorage.setItem(storageKey, String(defaultValue)); } catch {}
  };
  const displayValue = formatValue ? formatValue(value) : value;
  const isDefault = Math.abs(value - defaultValue) < 0.001;
  return (
    <div className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-[#e0e0e0] font-medium">{label}</span>
          <p className="text-[11px] text-[#b0b0b0]/40 mt-0.5">{description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-mono text-[#00ff41] font-semibold min-w-[3ch] text-right">{displayValue}</span>
          {!isDefault && (
            <button
              type="button"
              onClick={handleReset}
              className="text-[9px] text-[#b0b0b0]/40 hover:text-[#e0e0e0] cursor-pointer transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        className="w-full h-1 rounded-full appearance-none cursor-pointer bg-[#1a1a1a] accent-[#00ff41]"
        style={{
          background: `linear-gradient(to right, #00ff41 0%, #00ff41 ${((value - min) / (max - min)) * 100}%, #1a1a1a ${((value - min) / (max - min)) * 100}%, #1a1a1a 100%)`
        }}
      />
      <div className="flex justify-between text-[9px] text-[#b0b0b0]/25 font-mono">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ── Token Optimizer Settings ────────────────────────────────────────────────

function OptimizerToggle({ label, description, storageKey, defaultValue = false, color = "#00ff41" }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === null) return defaultValue;
      return v !== "false";
    } catch { return defaultValue; }
  });
  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try { localStorage.setItem(storageKey, next ? "true" : "false"); } catch {}
  };
  return (
    <div className="flex items-center justify-between bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-4 py-3">
      <div className="min-w-0 pr-3">
        <span className="text-sm text-[#e0e0e0] font-medium">{label}</span>
        <p className="text-[11px] text-[#b0b0b0]/40 mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        onClick={toggle}
        className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors shrink-0 ${
          enabled ? "" : "bg-[#1a1a1a]"
        }`}
        style={enabled ? { backgroundColor: color + "99" } : undefined}
      >
        <motion.div
          animate={{ x: enabled ? 20 : 2 }}
          transition={{ duration: 0.15, ease }}
          className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
        />
      </button>
    </div>
  );
}

function OptimizerNumberInput({ label, description, storageKey, defaultValue, min, max, step = 1 }) {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v !== null ? Number(v) : defaultValue;
    } catch { return defaultValue; }
  });
  const handleChange = (e) => {
    let v = Number(e.target.value);
    if (Number.isFinite(v)) {
      v = Math.max(min, Math.min(max, v));
      setValue(v);
      try { localStorage.setItem(storageKey, String(v)); } catch {}
    }
  };
  return (
    <div className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-4 py-3 space-y-2">
      <div>
        <span className="text-sm text-[#e0e0e0] font-medium">{label}</span>
        <p className="text-[11px] text-[#b0b0b0]/40 mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          className="w-24 bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[11px] text-[#b0b0b0]/40">{min}–{max}</span>
      </div>
    </div>
  );
}

function OptimizerSettings() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("kp_token_usage_stats_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        const entries = Object.entries(parsed);
        let totalSamples = 0;
        let totalTokens = 0;
        let totalSavings = 0;

        entries.forEach(([, entry]) => {
          totalSamples += entry.sampleCount || 0;
          totalTokens += (entry.avgTotalTokens || 0) * (entry.sampleCount || 0);
          totalSavings += (entry.avgSavingsPercent || 0) * (entry.sampleCount || 0);
        });

        setStats({
          models: entries.length,
          totalSamples,
          avgTokens: totalSamples > 0 ? Math.round(totalTokens / totalSamples) : 0,
          avgSavings: totalSamples > 0 ? Math.round(totalSavings / totalSamples) : 0,
        });
      }
    } catch {}
  }, []);

  const handleResetStats = () => {
    if (!window.confirm("Reset all token usage statistics? This will clear prediction data.")) return;
    try {
      localStorage.removeItem("kp_token_usage_stats_v1");
      localStorage.removeItem("kp_prompt_distill_cache_v1");
      setStats(null);
    } catch {}
  };

  return (
    <div className="space-y-6">
      {/* Predictive Stats Card */}
      <section className="rounded-sm border border-purple-500/15 bg-purple-500/[0.03] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">📊</span>
            <h3 className="text-sm font-semibold text-purple-200">Token Intelligence</h3>
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.12, ease }}
            onClick={handleResetStats}
            className="text-[11px] text-red-400/70 hover:text-red-400 border border-red-500/15 hover:border-red-500/30 rounded-sm px-2.5 py-1.5 cursor-pointer transition-colors"
          >
            Reset Stats
          </motion.button>
        </div>
        {stats ? (
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Models Tracked", value: stats.models, color: "text-purple-300" },
              { label: "Total Requests", value: stats.totalSamples, color: "text-cyan-300" },
              { label: "Avg Tokens/Req", value: stats.avgTokens.toLocaleString(), color: "text-emerald-300" },
              { label: "Avg Savings", value: `${stats.avgSavings}%`, color: "text-amber-300" },
            ].map((item) => (
              <div key={item.label} className="bg-[#111]/50 rounded-sm border border-white/[0.04] p-2.5">
                <div className="text-[9px] text-[#b0b0b0]/40 uppercase tracking-wider font-mono">{item.label}</div>
                <div className={`text-lg font-semibold font-mono mt-0.5 ${item.color}`}>{item.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#b0b0b0]/40 italic">No usage data yet. Stats will appear after a few chat exchanges.</p>
        )}
      </section>

      {/* Core Modules */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">Core Optimization</h3>
        <p className="text-xs text-[#b0b0b0]/60">
          Controls how aggressively the engine compresses context and manages token budgets.
        </p>
        <div className="space-y-2">
          <OptimizerToggle
            label="Deep Analysis Auto-Detect"
            description="Automatically expand token window when complex tasks are detected"
            storageKey="kp_deep_auto_detect"
            defaultValue={true}
            color="#00d4ff"
          />
          <OptimizerToggle
            label="Token Budget Meter"
            description="Show the real-time token usage meter above the input"
            storageKey="kp_show_budget_meter"
            defaultValue={true}
            color="#00ff41"
          />
          <OptimizerNumberInput
            label="History Window Size"
            description="Number of recent messages kept in full context (others get summarized)"
            storageKey="kp_history_window"
            defaultValue={18}
            min={4}
            max={200}
          />
          <OptimizerNumberInput
            label="Min Response Tokens (Deep)"
            description="Minimum response token budget during deep analysis mode"
            storageKey="kp_deep_min_tokens"
            defaultValue={16384}
            min={1024}
            max={65536}
            step={1024}
          />
        </div>
      </section>

      {/* Experimental Features */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">Experimental</h3>
          <span className="text-[9px] bg-purple-500/15 text-purple-300 border border-purple-500/20 rounded-full px-1.5 py-0.5 font-medium">BETA</span>
        </div>
        <p className="text-xs text-[#b0b0b0]/60">
          Cutting-edge features that use AI to optimize your workflow. May use extra API calls.
        </p>
        <div className="space-y-2">
          <OptimizerToggle
            label="Prompt Optimizer"
            description="Use a cheap model to compress verbose prompts before sending (saves tokens)"
            storageKey="kp_experimental_distill"
            defaultValue={true}
            color="#a855f7"
          />
          <OptimizerToggle
            label="Semantic Response Cache"
            description="Cache responses and match semantically similar queries to avoid redundant API calls"
            storageKey="kp_experimental_semantic_cache"
            defaultValue={false}
            color="#f59e0b"
          />
        </div>
      </section>
    </div>
  );
}

export default function SettingsPanel({
  providers, onSaveProviderKey, onRemoveProviderKey, onResetAll,
  onClose, modelPref, onSaveModelPref,
  customCommands, onSaveCustomCommands,
  systemPrompt, onSaveSystemPrompt, defaultSystemPrompt,
  advisorPrefs, onSaveAdvisorPrefs,
  shortcuts, onSaveShortcuts, onResetShortcuts,
  memory, onSaveMemory, onResetMemory,
  providerUsage,
  usageSnapshot,
  personas, onSavePersonas, models,
  folders, onSaveFolders,
}) {
  // Custom commands editor state
  const [editingCmd, setEditingCmd] = useState(null);
  const [cmdError, setCmdError] = useState("");
  const [activeTab, setActiveTab] = useState("general");

  // Terminal auto-run setting
  const [autoRun, setAutoRunState] = useState(getAutoRun);
  const handleAutoRunToggle = () => {
    const next = !autoRun;
    setAutoRun(next);      // persist + broadcast to all TerminalPanels
    setAutoRunState(next);
  };

  // System prompt editor
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(systemPrompt || "");

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const TABS = [
    { id: "general", label: "General", icon: "⚙️" },
    { id: "optimizer", label: "Optimizer", icon: "⚡" },
    { id: "personas", label: "Personas", icon: "🎭" },
    { id: "folders", label: "Chat Folders", labelShort: "Folders", icon: "📁" },
    { id: "usage", label: "Usage & Cost", labelShort: "Usage", icon: "📊" },
    { id: "memory", label: "Global Memory", labelShort: "Memory", icon: "🧠" },
    { id: "shortcuts", label: "Shortcuts", icon: "⌨️" },
    { id: "about", label: "About", icon: "ℹ️" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 md:p-12 font-sans">
      {/* Blur Backdrop */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        className="absolute inset-0 bg-[#000000]/70 backdrop-blur-md"
      />
      
      {/* Modal Container */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex flex-col md:flex-row w-full max-w-5xl h-[85vh] max-h-[850px] bg-theme-primary border border-white/[0.08] shadow-2xl rounded-xl overflow-hidden"
        style={{ backgroundColor: "var(--bg-primary, #0a0a0a)" }}
      >
        {/* Close Button Top Right */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 shrink-0 rounded-full text-[#b0b0b0]/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          aria-label="Close Settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Left Nav Sidebar */}
        <div className="w-full md:w-56 shrink-0 bg-[#000000]/20 border-b md:border-b-0 md:border-r border-white/[0.06] flex flex-col">
          <div className="p-5 md:pt-8 md:px-5 pb-2">
            <h2 className="text-white font-bold text-lg tracking-wide">Settings</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5" style={{ scrollbarWidth: "none" }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? "bg-[var(--accent, #00ff41)]/15 text-[var(--accent, #00ff41)]"
                    : "text-[#b0b0b0]/70 hover:text-[#e0e0e0] hover:bg-white/5"
                }`}
              >
                <span className="text-base">{tab.icon}</span>
                <span className="truncate hidden md:inline">{tab.label}</span>
                <span className="truncate md:hidden">{tab.labelShort || tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Content Pane */}
        <div className="flex-1 overflow-y-auto relative bg-[var(--bg-primary, #0a0a0a)] p-6 md:p-10">
          <div className="max-w-2xl mx-auto space-y-8 pb-10">
          
          {activeTab === "general" && (
          <>
          {/* API Providers */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">
              API Providers
            </h3>
            <p className="text-xs text-[#b0b0b0]/60">
              Connect one or more providers. Models from all connected providers are available in the model selector.
            </p>
            <div className="space-y-2.5">
              {PROVIDER_DEFS.map((def) => (
                <ProviderRow
                  key={def.id}
                  def={def}
                  currentKey={providers?.[def.id] || null}
                  onSave={onSaveProviderKey}
                  onRemove={onRemoveProviderKey}
                />
              ))}
            </div>
          </section>

          {/* Model suggestion preference */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">
              Smart Suggestions
            </h3>
            <p className="text-xs text-[#b0b0b0]/60">
              Choose which type of model the auto-suggest recommends. Higher-parameter models are always preferred.
            </p>
            <div className="flex bg-[#111111] border border-[#1a1a1a]/50 rounded-sm p-1 gap-1">
              {[
                { value: "auto", label: "Auto", desc: "Free first" },
                { value: "free", label: "Free", desc: "Free only" },
                { value: "paid", label: "Paid", desc: "Paid only" },
              ].map(({ value, label, desc }) => (
                <motion.button
                  key={value}
                  type="button"
                  onClick={() => onSaveModelPref(value)}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.12, ease }}
                  className={`flex-1 rounded-sm px-3 py-2.5 text-sm font-medium cursor-pointer transition-all ${
                    modelPref === value
                      ? "bg-[#00ff41]/20 text-[#00ff41] shadow-sm"
                      : "text-[#b0b0b0]/60 hover:text-[#e0e0e0] hover:bg-[#1a1a1a]/50"
                  }`}
                >
                  <span className="block">{label}</span>
                  <span className="block text-[10px] opacity-60 mt-0.5">{desc}</span>
                </motion.button>
              ))}
            </div>
          </section>

          {/* Model Advisor Preferences */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">
              Model Advisor
            </h3>
            <p className="text-xs text-[#b0b0b0]/60">
              The advisor card appears after each response with cost info and model suggestions.
            </p>
            <div className="space-y-2.5">
              {/* Prefer Free toggle */}
              <div className="flex items-center justify-between bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-4 py-3">
                <div>
                  <span className="text-sm text-[#e0e0e0] font-medium">Prefer Free Models</span>
                  <p className="text-[11px] text-[#b0b0b0]/40 mt-0.5">Always suggest free alternatives first</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSaveAdvisorPrefs?.({ ...advisorPrefs, preferFree: !advisorPrefs?.preferFree })}
                  className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors ${
                    advisorPrefs?.preferFree ? "bg-emerald-500/60" : "bg-[#1a1a1a]"
                  }`}
                >
                  <motion.div
                    animate={{ x: advisorPrefs?.preferFree ? 20 : 2 }}
                    transition={{ duration: 0.15, ease }}
                    className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
                  />
                </button>
              </div>
              {/* Prefer Best Quality toggle */}
              <div className="flex items-center justify-between bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-4 py-3">
                <div>
                  <span className="text-sm text-[#e0e0e0] font-medium">Prefer Best Quality</span>
                  <p className="text-[11px] text-[#b0b0b0]/40 mt-0.5">Prioritize highest-capability models</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSaveAdvisorPrefs?.({ ...advisorPrefs, preferBest: !advisorPrefs?.preferBest })}
                  className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors ${
                    advisorPrefs?.preferBest ? "bg-purple-500/60" : "bg-[#1a1a1a]"
                  }`}
                >
                  <motion.div
                    animate={{ x: advisorPrefs?.preferBest ? 20 : 2 }}
                    transition={{ duration: 0.15, ease }}
                    className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
                  />
                </button>
              </div>
              {/* Show Advisor toggle */}
              <div className="flex items-center justify-between bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-4 py-3">
                <div>
                  <span className="text-sm text-[#e0e0e0] font-medium">Show Advisor Card</span>
                  <p className="text-[11px] text-[#b0b0b0]/40 mt-0.5">Display model advisor below each response</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSaveAdvisorPrefs?.({ ...advisorPrefs, showAdvisor: !advisorPrefs?.showAdvisor })}
                  className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors ${
                    advisorPrefs?.showAdvisor !== false ? "bg-[#00ff41]/60" : "bg-[#1a1a1a]"
                  }`}
                >
                  <motion.div
                    animate={{ x: (advisorPrefs?.showAdvisor !== false) ? 20 : 2 }}
                    transition={{ duration: 0.15, ease }}
                    className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
                  />
                </button>
              </div>

              {/* Monthly Budget */}
              <div className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-4 py-3 space-y-2">
                <div>
                  <span className="text-sm text-[#e0e0e0] font-medium">Monthly Budget</span>
                  <p className="text-[11px] text-[#b0b0b0]/40 mt-0.5">Set a spending limit — advisor suggests models that fit your budget</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#b0b0b0]">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="e.g. 5.00"
                    value={advisorPrefs?.monthlyBudget || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      onSaveAdvisorPrefs?.({ ...advisorPrefs, monthlyBudget: val === "" ? null : parseFloat(val) });
                    }}
                    className="flex-1 bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[11px] text-[#b0b0b0]/40">/month</span>
                </div>
                {advisorPrefs?.monthlyBudget > 0 && (
                  <p className="text-[10px] text-[#00ff41]/70">Budget: ${Number(advisorPrefs.monthlyBudget).toFixed(2)}/mo — paid suggestions will respect this limit</p>
                )}
              </div>
            </div>
          </section>

          {/* Terminal */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">Terminal</h3>
            <p className="text-xs text-[#b0b0b0]/60">
              Control whether shell commands suggested by the AI run automatically or wait for your approval.
            </p>
            <div className="flex items-center justify-between rounded-sm bg-[#111111] border border-[#1a1a1a]/50 px-4 py-3">
              <div>
                <p className="text-sm text-dark-100 font-medium">Auto-run commands</p>
                <p className="text-xs text-[#b0b0b0]/60 mt-0.5">
                  {autoRun ? "Commands execute immediately — like Claude Code" : "Commands wait for your approval before running"}
                </p>
              </div>
              <button
                onClick={handleAutoRunToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  autoRun ? "bg-emerald-500" : "bg-dark-600"
                }`}
                role="switch"
                aria-checked={autoRun}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    autoRun ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {autoRun && (
              <p className="text-[11px] text-amber-400/70 flex items-center gap-1.5">
                <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                Auto-run is ON. You can still click Edit or Kill on any command panel.
              </p>
            )}
          </section>

          {/* Advanced Model Controls */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">
              Generation Parameters
            </h3>
            <p className="text-xs text-[#b0b0b0]/60">
              Adjust the default creativity and randomness of model responses. Higher temperature = more creative, lower = more focused.
            </p>
            <GenerationSlider
              label="Temperature"
              storageKey="kp_gen_temperature"
              defaultValue={0.7}
              min={0}
              max={2}
              step={0.05}
              description="Controls randomness. 0 = deterministic, 2 = very random."
              formatValue={(v) => v.toFixed(2)}
            />
            <GenerationSlider
              label="Top-P"
              storageKey="kp_gen_top_p"
              defaultValue={1.0}
              min={0}
              max={1}
              step={0.05}
              description="Nucleus sampling. Lower values narrow token selection."
              formatValue={(v) => v.toFixed(2)}
            />
            <GenerationSlider
              label="Frequency Penalty"
              storageKey="kp_gen_frequency_penalty"
              defaultValue={0}
              min={-2}
              max={2}
              step={0.1}
              description="Penalize tokens based on frequency. Positive reduces repetition."
              formatValue={(v) => v.toFixed(1)}
            />
          </section>

          {/* System Prompt */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">
                System Prompt
              </h3>
              {!editingPrompt && (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.12, ease }}
                  onClick={() => { setEditingPrompt(true); setPromptDraft(systemPrompt || ""); }}
                  className="text-[11px] text-[#00ff41] hover:text-[#00ff41] font-medium cursor-pointer flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path strokeLinecap="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit
                </motion.button>
              )}
            </div>
            <p className="text-xs text-[#b0b0b0]/60">
              Instructions sent with every message. Guides the AI's reasoning and output format.
            </p>

            {editingPrompt ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease }}
                className="space-y-3"
              >
                <textarea
                  rows={8}
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  className="w-full bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40 resize-none font-mono text-[12px] leading-5"
                />
                <div className="flex gap-2">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.12, ease }}
                    onClick={() => { onSaveSystemPrompt(promptDraft); setEditingPrompt(false); }}
                    className="flex-1 bg-gradient-to-r from-[#00cc33] to-[#00ff41] text-black font-medium rounded-sm px-3 py-2 text-sm cursor-pointer"
                  >
                    Save
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.12, ease }}
                    onClick={() => { setPromptDraft(defaultSystemPrompt); }}
                    className="px-3 py-2 text-sm text-[#b0b0b0]/60 hover:text-[#e0e0e0] cursor-pointer"
                  >
                    Reset Default
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.12, ease }}
                    onClick={() => setEditingPrompt(false)}
                    className="px-3 py-2 text-sm text-[#b0b0b0]/60 hover:text-[#e0e0e0] cursor-pointer"
                  >
                    Cancel
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <div className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-4 py-3 max-h-[120px] overflow-y-auto">
                <pre className="text-[11px] text-[#b0b0b0] whitespace-pre-wrap font-mono leading-4">{systemPrompt}</pre>
              </div>
            )}
          </section>

          {/* ── Custom Commands (Skills) ─────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">
                Custom Commands
              </h3>
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.12, ease }}
                onClick={() => { setEditingCmd({ name: "", description: "", promptTemplate: "" }); setCmdError(""); }}
                className="text-[11px] text-[#00ff41] hover:text-[#00ff41] font-medium cursor-pointer flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" d="M12 5v14m-7-7h14" />
                </svg>
                Add Command
              </motion.button>
            </div>
            <p className="text-xs text-[#b0b0b0]/60">
              Create custom slash commands. Use <code className="text-[#00ff41]/80">{'{{fileName}}'}</code> and <code className="text-[#00ff41]/80">{'{{code}}'}</code> as placeholders in the prompt template.
            </p>

            {/* Built-in commands (read-only display) */}
            <div className="space-y-1.5">
              {["explain", "fix", "summarize"].map((name) => (
                <div key={name} className="bg-[#111111]/50 border border-[#1a1a1a]/30 rounded-sm px-3 py-2 flex items-center gap-3">
                  <span className="font-mono text-xs text-[#00ff41] font-semibold">/{name}</span>
                  <span className="text-[11px] text-[#b0b0b0]/40 flex-1">Built-in</span>
                  <span className="text-[10px] text-[#b0b0b0]/30 bg-[#1a1a1a]/40 rounded px-1.5 py-0.5">read-only</span>
                </div>
              ))}
            </div>

            {/* User custom commands */}
            <div className="space-y-1.5">
              {(customCommands || []).map((cmd, idx) => (
                <div key={idx} className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 flex items-center gap-3">
                  <span className="font-mono text-xs text-[#00ff41] font-semibold">/{cmd.name}</span>
                  <span className="text-[11px] text-[#b0b0b0]/60 flex-1 truncate">{cmd.description}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditingCmd({ ...cmd, idx }); setCmdError(""); }}
                      className="text-[#b0b0b0]/40 hover:text-[#b0b0b0] cursor-pointer p-0.5"
                      aria-label="Edit command"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path strokeLinecap="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        const next = customCommands.filter((_, i) => i !== idx);
                        onSaveCustomCommands(next);
                      }}
                      className="text-[#b0b0b0]/40 hover:text-red-400 cursor-pointer p-0.5"
                      aria-label="Delete command"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Editor modal */}
            <AnimatePresence>
              {editingCmd && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.2, ease }}
                  className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm p-4 space-y-3"
                >
                  <h4 className="text-xs font-semibold text-[#e0e0e0]">
                    {editingCmd.idx !== undefined ? "Edit Command" : "New Command"}
                  </h4>
                  <input
                    type="text"
                    placeholder="Command name (e.g. review)"
                    value={editingCmd.name}
                    onChange={(e) => setEditingCmd((c) => ({ ...c, name: e.target.value.replace(/[^a-zA-Z0-9-_]/g, "") }))}
                    className="w-full bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40"
                  />
                  <input
                    type="text"
                    placeholder="Short description"
                    value={editingCmd.description}
                    onChange={(e) => setEditingCmd((c) => ({ ...c, description: e.target.value }))}
                    className="w-full bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40"
                  />
                  <textarea
                    rows={4}
                    placeholder={"Prompt template...\nUse {{fileName}} and {{code}} as placeholders."}
                    value={editingCmd.promptTemplate}
                    onChange={(e) => setEditingCmd((c) => ({ ...c, promptTemplate: e.target.value }))}
                    className="w-full bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[#00ff41]/40 resize-none"
                  />
                  {cmdError && (
                    <p className="text-xs text-red-400">{cmdError}</p>
                  )}
                  <div className="flex gap-2">
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.12, ease }}
                      onClick={() => {
                        const name = editingCmd.name.trim().toLowerCase();
                        if (!name) { setCmdError("Name is required."); return; }
                        if (["explain", "fix", "summarize"].includes(name)) { setCmdError("Cannot override built-in commands."); return; }
                        if (!editingCmd.promptTemplate.trim()) { setCmdError("Prompt template is required."); return; }
                        const entry = { name, description: editingCmd.description.trim(), promptTemplate: editingCmd.promptTemplate };
                        let next;
                        if (editingCmd.idx !== undefined) {
                          next = [...customCommands];
                          next[editingCmd.idx] = entry;
                        } else {
                          if (customCommands.some((c) => c.name === name)) { setCmdError("Command already exists."); return; }
                          next = [...customCommands, entry];
                        }
                        onSaveCustomCommands(next);
                        setEditingCmd(null);
                        setCmdError("");
                      }}
                      className="flex-1 bg-gradient-to-r from-[#00cc33] to-[#00ff41] text-black font-medium rounded-sm px-3 py-2 text-sm cursor-pointer"
                    >
                      {editingCmd.idx !== undefined ? "Update" : "Create"}
                    </motion.button>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.12, ease }}
                      onClick={() => { setEditingCmd(null); setCmdError(""); }}
                      className="px-3 py-2 text-sm text-[#b0b0b0]/60 hover:text-[#e0e0e0] cursor-pointer"
                    >
                      Cancel
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Appearance */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">
              Appearance
            </h3>
            <p className="text-xs text-[#b0b0b0]/60">
              Customize the look and feel of the interface.
            </p>

            {/* Theme */}
            <AppearanceSelector
              label="Theme"
              description="Background darkness level"
              storageKey="kp_theme"
              defaultValue="dark"
              options={[
                { value: "dark", label: "Dark", color: "#0a0a0a" },
                { value: "midnight", label: "Midnight", color: "#060612" },
                { value: "oled", label: "OLED", color: "#000000" },
              ]}
            />

            {/* Accent Color */}
            <div className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm px-4 py-3 space-y-2">
              <div>
                <span className="text-sm text-[#e0e0e0] font-medium">Accent Color</span>
                <p className="text-[11px] text-[#b0b0b0]/40 mt-0.5">Primary highlight color for buttons, indicators, and active elements</p>
              </div>
              <AccentColorPicker />
            </div>

            {/* Font Size */}
            <GenerationSlider
              label="Font Size"
              storageKey="kp_font_size"
              defaultValue={14}
              min={12}
              max={18}
              step={1}
              description="Base font size for chat messages"
              formatValue={(v) => `${v}px`}
            />

            {/* Chat Density */}
            <AppearanceSelector
              label="Chat Density"
              description="Spacing between messages"
              storageKey="kp_chat_density"
              defaultValue="comfortable"
              options={[
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
                { value: "spacious", label: "Spacious" },
              ]}
            />

            {/* Send Shortcut */}
            <AppearanceSelector
              label="Send Shortcut"
              description="Key combination to send messages"
              storageKey="kp_send_shortcut"
              defaultValue="enter"
              options={[
                { value: "enter", label: "Enter" },
                { value: "ctrl+enter", label: "Ctrl+Enter" },
              ]}
            />

            {/* Auto-scroll */}
            <OptimizerToggle
              label="Auto-scroll"
              description="Automatically scroll to the bottom when new content arrives"
              storageKey="kp_auto_scroll"
              defaultValue={true}
              color="#00ff41"
            />

            {/* Notification Sound */}
            <OptimizerToggle
              label="Notification Sound"
              description="Play a sound when the AI finishes responding while the app is in the background"
              storageKey="kp_notification_sound"
              defaultValue={false}
              color="#f59e0b"
            />
          </section>

          {/* Reset all */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">
              Reset All Keys
            </h3>
            <p className="text-xs text-[#b0b0b0]/60">
              Clear all stored API keys and return to the provider selection screen.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.15, ease }}
              onClick={onResetAll}
              className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/30 font-medium rounded-sm px-4 py-2.5 text-sm cursor-pointer w-full"
            >
              Remove All Keys
            </motion.button>
          </section>
          </>
          )}

          {activeTab === "usage" && (
            <div className="space-y-5">
              <SidebarUsageSnapshotPanel usageSnapshot={usageSnapshot} />
              <OllamaCloudUsagePanel ollamaValue={providers?.ollama || null} />
              <SessionUsagePanel providerUsage={providerUsage} providers={providers} />
              <HFUsageTab hfKey={providers?.huggingface || null} />
            </div>
          )}

          {activeTab === "optimizer" && (
            <OptimizerSettings />
          )}

          {activeTab === "shortcuts" && (
            <ShortcutEditor
              shortcuts={shortcuts}
              onSaveShortcuts={onSaveShortcuts}
              onResetShortcuts={onResetShortcuts}
            />
          )}

          {activeTab === "memory" && (
            <MemoryEditor
              memory={memory}
              onSaveMemory={onSaveMemory}
              onResetMemory={onResetMemory}
            />
          )}
          {activeTab === "personas" && (
            <PersonaEditor 
              personas={personas} 
              onSavePersonas={onSavePersonas} 
              models={models} 
            />
          )}
          {activeTab === "folders" && (
            <FolderEditor 
              folders={folders} 
              onSaveFolders={onSaveFolders} 
            />
          )}

          {activeTab === "about" && (
            <div className="space-y-6 text-center py-10">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-[#00ff41]/10 rounded-full mb-2">
                <span className="text-[#00ff41] font-mono text-xl font-bold">kp</span>
              </div>
              <h3 className="text-xl font-bold text-white tracking-widest">KritakaPrajna</h3>
              <p className="text-sm text-[#b0b0b0]/60">A powerful, configurable AI workspace</p>
              <div className="pt-4 border-t border-white/[0.04] mt-4">
                <span className="text-xs text-[#00ff41]/80 block mb-2 font-medium tracking-wide">👨‍💻 Made by Parikshit</span>
                <span className="text-xs text-[#b0b0b0]/40">Version 3.0.0</span>
              </div>
            </div>
          )}

        </div>
      </div>
      </motion.div>
    </div>
  );
}

