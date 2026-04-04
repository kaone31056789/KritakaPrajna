import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 5) + "••••" + key.slice(-4);
}

const PROVIDER_DEFS = [
  { id: "openrouter",  label: "OpenRouter",    placeholder: "sk-or-v1-...", color: "#7c6ff7", note: "500+ models via single key" },
  { id: "openai",      label: "OpenAI",         placeholder: "sk-proj-...", color: "#10a37f", note: "GPT-4o, o1, o3-mini" },
  { id: "anthropic",   label: "Anthropic",      placeholder: "sk-ant-...",  color: "#c96442", note: "Claude Opus, Sonnet, Haiku" },
  { id: "huggingface", label: "HuggingFace",    placeholder: "hf_...",      color: "#f5a623", note: "Popular open models, free + paid router options" },
];

function ProviderRow({ def, currentKey, onSave, onRemove }) {
  const [draft, setDraft]       = useState("");
  const [mode, setMode]         = useState("idle");   // "idle" | "adding" | "replacing"
  const [busy, setBusy]         = useState(false);
  const [err,  setErr]          = useState("");

  const isConnected = !!currentKey;

  const handleSave = async (e) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    setBusy(true); setErr("");
    try {
      await onSave(def.id, trimmed);
      setDraft(""); setMode("idle");
    } catch {
      setErr("Failed to save — check your key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-dark-800 border border-dark-700/50 rounded-xl p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-2.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: def.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-dark-100">{def.label}</span>
            {isConnected ? (
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5 font-medium">✓ Connected</span>
            ) : (
              <span className="text-[10px] text-dark-500 bg-dark-700/50 border border-dark-600/30 rounded-full px-1.5 py-0.5 font-medium">✗ Not connected</span>
            )}
          </div>
          <p className="text-[11px] text-dark-500 mt-0.5">{def.note}</p>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {!isConnected && mode === "idle" && (
            <button type="button" onClick={() => setMode("adding")}
              className="text-[11px] text-saffron-400 hover:text-saffron-300 font-medium cursor-pointer px-2 py-1 rounded-lg hover:bg-saffron-500/10">
              Add Key
            </button>
          )}
          {isConnected && mode === "idle" && (
            <>
              <button type="button" onClick={() => { setDraft(""); setMode("replacing"); }}
                className="text-[11px] text-dark-400 hover:text-dark-200 font-medium cursor-pointer px-2 py-1 rounded-lg hover:bg-dark-700">
                Replace
              </button>
              <button type="button" onClick={() => onRemove(def.id)}
                className="text-[11px] text-red-400/70 hover:text-red-400 font-medium cursor-pointer px-2 py-1 rounded-lg hover:bg-red-500/10">
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {/* Masked current key */}
      {isConnected && mode === "idle" && (
        <div className="font-mono text-xs text-dark-400 bg-dark-900/50 border border-dark-700/30 rounded-lg px-3 py-2">
          {maskKey(currentKey)}
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
              type="password"
              placeholder={def.placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              autoFocus
              className="w-full bg-dark-900 border border-dark-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-saffron-500/50 disabled:opacity-50"
            />
            {err && <p className="text-xs text-red-400">{err}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={!draft.trim() || busy}
                className="flex-1 bg-gradient-to-r from-saffron-600 to-saffron-500 disabled:opacity-40 text-dark-950 font-medium rounded-lg px-3 py-2 text-xs cursor-pointer">
                {busy ? "Saving…" : (mode === "adding" ? "Save Key" : "Replace Key")}
              </button>
              <button type="button" onClick={() => { setMode("idle"); setDraft(""); setErr(""); }}
                className="px-3 py-2 text-xs text-dark-400 hover:text-dark-200 cursor-pointer">
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
          <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
            Keyboard Shortcuts
          </h3>
          <p className="text-xs text-dark-400 mt-1">
            Customize shortcuts for chat, navigation, and model actions.
          </p>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.12, ease }}
          onClick={handleResetAll}
          className="text-[11px] text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/30 rounded-lg px-3 py-2 cursor-pointer"
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
        className="w-full bg-dark-900 border border-dark-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-saffron-500/50"
      />

      <div className="overflow-hidden rounded-xl border border-dark-700/50 bg-dark-800">
        <div className="grid grid-cols-[1.4fr_1fr] px-4 py-2 text-[11px] uppercase tracking-wider text-dark-500 border-b border-dark-700/50">
          <span>Action</span>
          <span>Shortcut</span>
        </div>

        {visibleActions.map((action) => (
          <div
            key={action.id}
            className={`grid grid-cols-[1.4fr_1fr] items-center gap-3 px-4 py-3 border-b border-dark-700/30 last:border-b-0 transition-colors ${
              recording === action.id ? "bg-saffron-500/10" : "hover:bg-dark-700/40"
            }`}
          >
            <div className="min-w-0">
              <div className="text-sm text-dark-100 font-medium">{action.label}</div>
              <div className="text-[11px] text-dark-500 mt-0.5">{action.category}</div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                ref={(node) => { recordButtonRefs.current[action.id] = node; }}
                onClick={() => setRecording(action.id)}
                onKeyDown={recording === action.id ? (e) => handleRecord(action.id, e) : undefined}
                className={`flex-1 text-left rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                  recording === action.id
                    ? "border-saffron-500/40 text-saffron-300 bg-saffron-500/10"
                    : "border-dark-600/40 text-dark-200 bg-dark-900 hover:bg-dark-900/80"
                }`}
              >
                {recording === action.id ? "Press new shortcut..." : merged[action.id]}
              </button>
              <button
                type="button"
                onClick={() => handleResetAction(action.id)}
                className="text-[11px] text-dark-400 hover:text-dark-200 cursor-pointer"
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
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [copied, setCopied] = useState(false);
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
      icon: "🟡",
      accent: "text-amber-300",
      border: "border-amber-500/20",
      bg: "bg-amber-500/10",
      placeholder: "User prefers short answers",
    },
    coding: {
      icon: "🟢",
      accent: "text-emerald-300",
      border: "border-emerald-500/20",
      bg: "bg-emerald-500/10",
      placeholder: "User prefers Python",
    },
    context: {
      icon: "🔵",
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
    await onSaveMemory?.(normalizeUserMemory(nextMemory));
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
          <span className="text-base">🧠</span>
          <h3 className="text-sm font-semibold text-dark-100">Memory</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => saveMemory({ ...normalized, autoMode: !normalized.autoMode })}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              normalized.autoMode
                ? "text-saffron-300 bg-saffron-500/10"
                : "text-dark-400 hover:text-dark-200"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${normalized.autoMode ? "bg-saffron-400" : "bg-dark-600"}`} />
            Auto
          </button>
          <button
            type="button"
            onClick={openImportModal}
            className="relative text-xs font-medium text-saffron-300 px-3 py-1.5 rounded-full border border-saffron-500/40 bg-saffron-500/10 hover:bg-saffron-500/20 hover:border-saffron-400/60 shadow-[0_0_10px_rgba(234,179,8,0.15)] hover:shadow-[0_0_16px_rgba(234,179,8,0.28)] transition-all cursor-pointer"
          >
            Import
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs text-dark-500 hover:text-red-400 px-3 py-1.5 rounded-full transition-colors cursor-pointer"
          >
            Clear
          </button>
        </div>
      </div>

      {/* ── Add Memory ── */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-dark-800 border border-dark-700/50 rounded-xl px-3 py-2.5 text-xs text-dark-200 focus:outline-none focus:ring-1 focus:ring-saffron-500/40 cursor-pointer"
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
            className="flex-1 bg-dark-800 border border-dark-700/50 rounded-xl px-3 py-2.5 text-sm text-white placeholder-dark-600 focus:outline-none focus:ring-1 focus:ring-saffron-500/40"
          />
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.1, ease }}
            onClick={handleAdd}
            className="bg-saffron-500 hover:bg-saffron-400 text-dark-950 font-medium rounded-xl px-4 py-2.5 text-sm cursor-pointer transition-colors"
          >
            Add
          </motion.button>
        </div>

        {/* Suggestions */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] text-dark-600 self-center">💡</span>
          {MEMORY_CATEGORY_DEFS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setCategory(item.id);
                setDraft(categoryMeta[item.id]?.placeholder || "");
                inputRef.current?.focus();
              }}
              className="text-[11px] text-dark-400 hover:text-dark-100 bg-dark-800/60 hover:bg-dark-800 border border-dark-700/40 hover:border-dark-600/60 rounded-full px-2.5 py-1 cursor-pointer transition-colors"
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
          <div className="text-2xl">🧠</div>
          <p className="text-sm text-dark-400">No memory yet</p>
          <p className="text-xs text-dark-600">Import from another AI or add manually above</p>
          <div className="flex justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={openImportModal}
              className="text-xs text-dark-200 hover:text-white border border-dark-700/50 hover:border-dark-600 rounded-xl px-3 py-1.5 cursor-pointer transition-colors"
            >
              Import Memory
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              className="text-xs text-dark-950 bg-saffron-500 hover:bg-saffron-400 rounded-xl px-3 py-1.5 cursor-pointer font-medium transition-colors"
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
            return (
              <div key={section.id} className="space-y-2">
                <p className={`text-[11px] font-medium uppercase tracking-wider ${meta.accent}`}>{section.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {entries.map((entry, index) => {
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
                          className="flex-1 bg-dark-800 border border-saffron-500/40 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
                          autoFocus
                        />
                        <button type="button" onClick={handleEditSave} className="text-[11px] text-saffron-300 hover:text-saffron-200 cursor-pointer">Save</button>
                        <button type="button" onClick={() => setEditing(null)} className="text-[11px] text-dark-500 hover:text-dark-300 cursor-pointer">Cancel</button>
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
                          className="text-[10px] text-dark-500 hover:text-dark-200 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label={`Edit ${entry}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(section.id, index)}
                          className="text-dark-500 hover:text-red-400 cursor-pointer leading-none"
                          aria-label={`Delete ${entry}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
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
            className="fixed inset-0 z-50 bg-dark-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2, ease }}
              className="w-full max-w-3xl bg-dark-900 border border-dark-700/60 rounded-2xl shadow-2xl shadow-black/30 overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700/50">
                <div>
                  <h4 className="text-sm font-semibold text-dark-100">Import Memory</h4>
                  <p className="text-xs text-dark-500 mt-1">Bring preferences from Claude, ChatGPT, or any notes you already have.</p>
                </div>
                <button
                  type="button"
                  onClick={closeImportModal}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-xl text-dark-400 hover:text-dark-100 hover:bg-dark-800 cursor-pointer"
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
                      className={`rounded-xl px-3 py-2 text-xs font-medium cursor-pointer border transition-colors ${
                        importState.method === method.id
                          ? "bg-saffron-500/18 text-saffron-300 border-saffron-500/30"
                          : "bg-dark-800 text-dark-300 border-dark-700/50 hover:border-dark-600/60"
                      }`}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>

                {importState.method === "ai" && !importState.review && (
                  <div className="space-y-4">
                    {/* Step tabs */}
                    <div className="flex gap-1 bg-dark-950 border border-dark-700/50 rounded-xl p-1">
                      <button
                        type="button"
                        onClick={() => setImportState((s) => ({ ...s, aiStep: "prompt" }))}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                          importState.aiStep !== "response"
                            ? "bg-saffron-500/18 text-saffron-300"
                            : "text-dark-400 hover:text-dark-200 hover:bg-dark-800"
                        }`}
                      >
                        1. Generate Prompt
                      </button>
                      <button
                        type="button"
                        onClick={goToPasteChatExport}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                          importState.aiStep === "response"
                            ? "bg-saffron-500/18 text-saffron-300"
                            : "text-dark-400 hover:text-dark-200 hover:bg-dark-800"
                        }`}
                      >
                        2. Paste Chat Export
                      </button>
                    </div>

                    {importState.aiStep !== "response" && (
                      <div className="space-y-3">
                        <p className="text-xs text-dark-400">
                          Copy this prompt and paste it into ChatGPT, Claude, or any AI that knows your history. Then come back and paste the response.
                        </p>
                        <div className="bg-dark-950 border border-dark-700/50 rounded-xl px-4 py-4">
                          <pre className="text-xs text-dark-200 whitespace-pre-wrap font-mono leading-relaxed">{AI_IMPORT_PROMPT}</pre>
                        </div>
                        <div className="flex justify-between items-center">
                          <p className="text-[11px] text-dark-500">Ask it to analyze your conversation history</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={handleCopyPrompt}
                              className={`text-sm font-medium rounded-xl px-4 py-2 cursor-pointer transition-colors ${
                                copied
                                  ? "text-emerald-300 bg-emerald-500/12 border border-emerald-500/20"
                                  : "text-dark-950 bg-saffron-500 hover:bg-saffron-400"
                              }`}
                            >
                              {copied ? "✓ Copied!" : "Copy Prompt"}
                            </button>
                            <button
                              type="button"
                              onClick={goToPasteChatExport}
                              className="text-sm text-dark-200 bg-dark-800 hover:bg-dark-700 border border-dark-600/50 rounded-xl px-4 py-2 cursor-pointer"
                            >
                              Next → Paste Chat Export
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {importState.aiStep === "response" && (
                      <div className="space-y-3">
                        <p className="text-xs text-dark-400">
                          Paste the AI's response below. It should follow the Preferences / Coding Style / Context format.
                        </p>
                        <textarea
                          rows={10}
                          value={importState.rawText}
                          onChange={(e) => setImportState((current) => ({ ...current, rawText: e.target.value, review: false }))}
                          placeholder={"Preferences:\n* prefers short answers\n\nCoding Style:\n* prefers Python\n\nContext:\n* building AI app"}
                          className="w-full bg-dark-950 border border-dark-700/50 rounded-xl px-3 py-3 text-sm text-white placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-saffron-500/50 resize-none font-mono"
                        />
                        <div className="flex justify-between items-center">
                          <button
                            type="button"
                            onClick={() => setImportState((s) => ({ ...s, aiStep: "prompt" }))}
                            className="text-xs text-dark-400 hover:text-dark-200 cursor-pointer"
                          >
                            ← Back to prompt
                          </button>
                          <button
                            type="button"
                            onClick={handleAnalyzeImport}
                            className="text-sm text-dark-950 bg-saffron-500 hover:bg-saffron-400 rounded-xl px-4 py-2 cursor-pointer font-medium"
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
                      className="w-full bg-dark-950 border border-dark-700/50 rounded-xl px-3 py-3 text-sm text-white placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-saffron-500/50 resize-none"
                    />
                    <p className="text-[11px] text-dark-500">
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
                    <div className="bg-dark-950 border border-dark-700/50 rounded-2xl px-4 py-5 text-center">
                      <p className="text-sm text-dark-200">Upload a `.txt`, `.json`, or `.md` file</p>
                      <p className="text-[11px] text-dark-500 mt-1">Great for exported chats, notes, and setup files.</p>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-4 text-sm text-dark-950 bg-saffron-500 hover:bg-saffron-400 rounded-xl px-4 py-2 cursor-pointer font-medium"
                      >
                        Choose File
                      </button>
                      {importState.fileName && (
                        <p className="text-[11px] text-dark-400 mt-3">Loaded: {importState.fileName}</p>
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
                        className="text-left bg-dark-950 border border-dark-700/50 hover:border-saffron-500/30 rounded-2xl px-4 py-4 cursor-pointer transition-colors"
                      >
                        <div className="text-sm font-medium text-dark-100">{preset.label}</div>
                        <div className="text-[11px] text-dark-500 mt-2">
                          {[
                            ...preset.memory.preferences,
                            ...preset.memory.coding,
                            ...preset.memory.context,
                          ].join(" • ")}
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
                      className="text-sm text-dark-950 bg-saffron-500 hover:bg-saffron-400 rounded-xl px-4 py-2 cursor-pointer font-medium"
                    >
                      Analyze Import
                    </button>
                  </div>
                )}

                {importState.review && (
                  <div className="space-y-4">
                    <div className="bg-dark-950 border border-dark-700/50 rounded-2xl px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h5 className="text-sm font-medium text-dark-100">We found {extractedCount} memory items</h5>
                          <p className="text-[11px] text-dark-500 mt-1">Review or edit before saving. Nothing is stored until you confirm.</p>
                        </div>
                      </div>
                    </div>

                    {MEMORY_CATEGORY_DEFS.map((section) => (
                      <div key={section.id} className="space-y-2">
                        <div className="text-xs font-medium text-dark-300">{section.label}</div>
                        <textarea
                          rows={Math.max(3, importState.extracted[section.id].length || 1)}
                          value={importState.extracted[section.id].join("\n")}
                          onChange={(e) => handleImportReviewChange(section.id, e.target.value)}
                          placeholder={`No ${section.label.toLowerCase()} found`}
                          className="w-full bg-dark-950 border border-dark-700/50 rounded-xl px-3 py-2.5 text-sm text-white placeholder-dark-600 focus:outline-none focus:ring-1 focus:ring-saffron-500/50 resize-none"
                        />
                      </div>
                    ))}

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setImportState((current) => ({ ...current, review: false }))}
                        className="text-sm text-dark-300 bg-dark-800 hover:bg-dark-700 border border-dark-700/50 rounded-xl px-4 py-2 cursor-pointer"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveImport}
                        className="text-sm text-dark-950 bg-saffron-500 hover:bg-saffron-400 rounded-xl px-4 py-2 cursor-pointer font-medium"
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

export default function SettingsPanel({
  providers, onSaveProviderKey, onRemoveProviderKey, onResetAll,
  onClose, modelPref, onSaveModelPref,
  customCommands, onSaveCustomCommands,
  systemPrompt, onSaveSystemPrompt, defaultSystemPrompt,
  advisorPrefs, onSaveAdvisorPrefs,
  shortcuts, onSaveShortcuts, onResetShortcuts,
  memory, onSaveMemory, onResetMemory,
}) {
  // Custom commands editor state
  const [editingCmd, setEditingCmd] = useState(null);
  const [cmdError, setCmdError] = useState("");
  const [activeTab, setActiveTab] = useState("general");

  // System prompt editor
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(systemPrompt || "");

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-dark-950">
      {/* Header — glassmorphism */}
      <header className="flex items-center gap-3 px-5 py-3 glass border-b border-white/[0.06] shrink-0">
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.15, ease }}
          onClick={onClose}
          className="text-dark-300 hover:text-dark-100 cursor-pointer"
          aria-label="Back to chat"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </motion.button>
        <h2 className="text-white font-semibold text-sm">Settings</h2>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-lg mx-auto space-y-8">
          <div className="flex bg-dark-800 border border-dark-700/50 rounded-xl p-1 gap-1">
            {[
              { id: "general", label: "General" },
              { id: "memory", label: "Memory" },
              { id: "shortcuts", label: "Keyboard Shortcuts" },
            ].map((tab) => (
              <motion.button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.12, ease }}
                className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium cursor-pointer transition-all ${
                  activeTab === tab.id
                    ? "bg-saffron-500/20 text-saffron-300 shadow-sm"
                    : "text-dark-400 hover:text-dark-200 hover:bg-dark-700/50"
                }`}
              >
                {tab.label}
              </motion.button>
            ))}
          </div>

          {activeTab === "general" && (
          <>
          {/* API Providers */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
              API Providers
            </h3>
            <p className="text-xs text-dark-400">
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
            <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
              Smart Suggestions
            </h3>
            <p className="text-xs text-dark-400">
              Choose which type of model the auto-suggest recommends. Higher-parameter models are always preferred.
            </p>
            <div className="flex bg-dark-800 border border-dark-700/50 rounded-xl p-1 gap-1">
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
                  className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium cursor-pointer transition-all ${
                    modelPref === value
                      ? "bg-saffron-500/20 text-saffron-300 shadow-sm"
                      : "text-dark-400 hover:text-dark-200 hover:bg-dark-700/50"
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
            <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
              Model Advisor
            </h3>
            <p className="text-xs text-dark-400">
              The advisor card appears after each response with cost info and model suggestions.
            </p>
            <div className="space-y-2.5">
              {/* Prefer Free toggle */}
              <div className="flex items-center justify-between bg-dark-800 border border-dark-700/50 rounded-xl px-4 py-3">
                <div>
                  <span className="text-sm text-dark-200 font-medium">Prefer Free Models</span>
                  <p className="text-[11px] text-dark-500 mt-0.5">Always suggest free alternatives first</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSaveAdvisorPrefs?.({ ...advisorPrefs, preferFree: !advisorPrefs?.preferFree })}
                  className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors ${
                    advisorPrefs?.preferFree ? "bg-emerald-500/60" : "bg-dark-700"
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
              <div className="flex items-center justify-between bg-dark-800 border border-dark-700/50 rounded-xl px-4 py-3">
                <div>
                  <span className="text-sm text-dark-200 font-medium">Prefer Best Quality</span>
                  <p className="text-[11px] text-dark-500 mt-0.5">Prioritize highest-capability models</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSaveAdvisorPrefs?.({ ...advisorPrefs, preferBest: !advisorPrefs?.preferBest })}
                  className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors ${
                    advisorPrefs?.preferBest ? "bg-purple-500/60" : "bg-dark-700"
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
              <div className="flex items-center justify-between bg-dark-800 border border-dark-700/50 rounded-xl px-4 py-3">
                <div>
                  <span className="text-sm text-dark-200 font-medium">Show Advisor Card</span>
                  <p className="text-[11px] text-dark-500 mt-0.5">Display model advisor below each response</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSaveAdvisorPrefs?.({ ...advisorPrefs, showAdvisor: !advisorPrefs?.showAdvisor })}
                  className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors ${
                    advisorPrefs?.showAdvisor !== false ? "bg-saffron-500/60" : "bg-dark-700"
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
              <div className="bg-dark-800 border border-dark-700/50 rounded-xl px-4 py-3 space-y-2">
                <div>
                  <span className="text-sm text-dark-200 font-medium">Monthly Budget</span>
                  <p className="text-[11px] text-dark-500 mt-0.5">Set a spending limit — advisor suggests models that fit your budget</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-dark-300">$</span>
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
                    className="flex-1 bg-dark-900 border border-dark-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-saffron-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[11px] text-dark-500">/month</span>
                </div>
                {advisorPrefs?.monthlyBudget > 0 && (
                  <p className="text-[10px] text-saffron-400/70">Budget: ${Number(advisorPrefs.monthlyBudget).toFixed(2)}/mo — paid suggestions will respect this limit</p>
                )}
              </div>
            </div>
          </section>

          {/* System Prompt */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
                System Prompt
              </h3>
              {!editingPrompt && (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.12, ease }}
                  onClick={() => { setEditingPrompt(true); setPromptDraft(systemPrompt || ""); }}
                  className="text-[11px] text-saffron-400 hover:text-saffron-300 font-medium cursor-pointer flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path strokeLinecap="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit
                </motion.button>
              )}
            </div>
            <p className="text-xs text-dark-400">
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
                  className="w-full bg-dark-900 border border-dark-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-saffron-500/50 resize-none font-mono text-[12px] leading-5"
                />
                <div className="flex gap-2">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.12, ease }}
                    onClick={() => { onSaveSystemPrompt(promptDraft); setEditingPrompt(false); }}
                    className="flex-1 bg-gradient-to-r from-saffron-600 to-saffron-500 text-dark-950 font-medium rounded-lg px-3 py-2 text-sm cursor-pointer"
                  >
                    Save
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.12, ease }}
                    onClick={() => { setPromptDraft(defaultSystemPrompt); }}
                    className="px-3 py-2 text-sm text-dark-400 hover:text-dark-200 cursor-pointer"
                  >
                    Reset Default
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.12, ease }}
                    onClick={() => setEditingPrompt(false)}
                    className="px-3 py-2 text-sm text-dark-400 hover:text-dark-200 cursor-pointer"
                  >
                    Cancel
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <div className="bg-dark-800 border border-dark-700/50 rounded-xl px-4 py-3 max-h-[120px] overflow-y-auto">
                <pre className="text-[11px] text-dark-300 whitespace-pre-wrap font-mono leading-4">{systemPrompt}</pre>
              </div>
            )}
          </section>

          {/* ── Custom Commands (Skills) ─────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
                Custom Commands
              </h3>
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.12, ease }}
                onClick={() => { setEditingCmd({ name: "", description: "", promptTemplate: "" }); setCmdError(""); }}
                className="text-[11px] text-saffron-400 hover:text-saffron-300 font-medium cursor-pointer flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" d="M12 5v14m-7-7h14" />
                </svg>
                Add Command
              </motion.button>
            </div>
            <p className="text-xs text-dark-400">
              Create custom slash commands. Use <code className="text-saffron-400/80">{'{{fileName}}'}</code> and <code className="text-saffron-400/80">{'{{code}}'}</code> as placeholders in the prompt template.
            </p>

            {/* Built-in commands (read-only display) */}
            <div className="space-y-1.5">
              {["explain", "fix", "summarize"].map((name) => (
                <div key={name} className="bg-dark-800/50 border border-dark-700/30 rounded-lg px-3 py-2 flex items-center gap-3">
                  <span className="font-mono text-xs text-saffron-400 font-semibold">/{name}</span>
                  <span className="text-[11px] text-dark-500 flex-1">Built-in</span>
                  <span className="text-[10px] text-dark-600 bg-dark-700/40 rounded px-1.5 py-0.5">read-only</span>
                </div>
              ))}
            </div>

            {/* User custom commands */}
            <div className="space-y-1.5">
              {(customCommands || []).map((cmd, idx) => (
                <div key={idx} className="bg-dark-800 border border-dark-700/50 rounded-lg px-3 py-2 flex items-center gap-3">
                  <span className="font-mono text-xs text-saffron-400 font-semibold">/{cmd.name}</span>
                  <span className="text-[11px] text-dark-400 flex-1 truncate">{cmd.description}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditingCmd({ ...cmd, idx }); setCmdError(""); }}
                      className="text-dark-500 hover:text-dark-300 cursor-pointer p-0.5"
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
                      className="text-dark-500 hover:text-red-400 cursor-pointer p-0.5"
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
                  className="bg-dark-800 border border-dark-700/50 rounded-xl p-4 space-y-3"
                >
                  <h4 className="text-xs font-semibold text-dark-200">
                    {editingCmd.idx !== undefined ? "Edit Command" : "New Command"}
                  </h4>
                  <input
                    type="text"
                    placeholder="Command name (e.g. review)"
                    value={editingCmd.name}
                    onChange={(e) => setEditingCmd((c) => ({ ...c, name: e.target.value.replace(/[^a-zA-Z0-9-_]/g, "") }))}
                    className="w-full bg-dark-900 border border-dark-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-saffron-500/50"
                  />
                  <input
                    type="text"
                    placeholder="Short description"
                    value={editingCmd.description}
                    onChange={(e) => setEditingCmd((c) => ({ ...c, description: e.target.value }))}
                    className="w-full bg-dark-900 border border-dark-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-saffron-500/50"
                  />
                  <textarea
                    rows={4}
                    placeholder={"Prompt template...\nUse {{fileName}} and {{code}} as placeholders."}
                    value={editingCmd.promptTemplate}
                    onChange={(e) => setEditingCmd((c) => ({ ...c, promptTemplate: e.target.value }))}
                    className="w-full bg-dark-900 border border-dark-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:ring-1 focus:ring-saffron-500/50 resize-none"
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
                      className="flex-1 bg-gradient-to-r from-saffron-600 to-saffron-500 text-dark-950 font-medium rounded-lg px-3 py-2 text-sm cursor-pointer"
                    >
                      {editingCmd.idx !== undefined ? "Update" : "Create"}
                    </motion.button>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.12, ease }}
                      onClick={() => { setEditingCmd(null); setCmdError(""); }}
                      className="px-3 py-2 text-sm text-dark-400 hover:text-dark-200 cursor-pointer"
                    >
                      Cancel
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Reset all */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
              Reset All Keys
            </h3>
            <p className="text-xs text-dark-400">
              Clear all stored API keys and return to the provider selection screen.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.15, ease }}
              onClick={onResetAll}
              className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/30 font-medium rounded-xl px-4 py-2.5 text-sm cursor-pointer w-full"
            >
              Remove All Keys
            </motion.button>
          </section>
          </>
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

        </div>
      </div>
    </div>
  );
}
