import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchModels } from "../api/openrouter";

const ease = [0.4, 0, 0.2, 1];

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 5) + "••••" + key.slice(-4);
}

export default function SettingsPanel({ apiKey, onSaveKey, onRemoveKey, onClose, modelPref, onSaveModelPref, customCommands, onSaveCustomCommands, systemPrompt, onSaveSystemPrompt, defaultSystemPrompt }) {
  const [newKey, setNewKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });

  // Custom commands editor state
  const [editingCmd, setEditingCmd] = useState(null);
  const [cmdError, setCmdError] = useState("");

  // System prompt editor
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(systemPrompt || "");

  const handleReplace = async (e) => {
    e.preventDefault();
    const trimmed = newKey.trim();
    if (!trimmed) return;

    setValidating(true);
    setStatus({ type: "", message: "" });

    try {
      await fetchModels(trimmed);
      onSaveKey(trimmed);
      setNewKey("");
      setStatus({ type: "success", message: "API key validated and saved." });
    } catch {
      setStatus({ type: "error", message: "Invalid key — could not fetch models." });
    } finally {
      setValidating(false);
    }
  };

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

          {/* Current key */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
              Current API Key
            </h3>
            <div className="bg-dark-800 border border-dark-700/50 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="font-mono text-sm text-dark-200 truncate flex-1">
                {maskKey(apiKey)}
              </span>
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5 font-medium shrink-0">
                Active
              </span>
            </div>
          </section>

          {/* Replace key */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
              Replace API Key
            </h3>
            <form onSubmit={handleReplace} className="space-y-3">
              <input
                type="password"
                placeholder="sk-or-..."
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                disabled={validating}
                className="w-full bg-dark-800 border border-dark-700/50 rounded-xl px-4 py-3 text-sm text-white placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-saffron-500 focus:border-transparent transition-all disabled:opacity-50"
              />
              <motion.button
                type="submit"
                disabled={!newKey.trim() || validating}
                whileHover={{ scale: 1.02, boxShadow: "0 0 16px rgba(245,158,11,0.2)" }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.15, ease }}
                className="bg-gradient-to-r from-saffron-600 to-saffron-500 hover:from-saffron-500 hover:to-saffron-400 disabled:opacity-40 text-dark-950 font-medium rounded-xl px-4 py-2.5 text-sm cursor-pointer w-full shadow-md shadow-saffron-500/20"
              >
                {validating ? "Validating…" : "Save New Key"}
              </motion.button>
            </form>

            {status.message && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease }}
                className={`text-sm rounded-lg px-3 py-2 ${
                  status.type === "success"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border border-red-500/20"
                }`}
              >
                {status.message}
              </motion.div>
            )}
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

          {/* Remove key */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
              Remove API Key
            </h3>
            <p className="text-xs text-dark-400">
              This will clear your stored key and return you to the onboarding screen.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.15, ease }}
              onClick={onRemoveKey}
              className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/30 font-medium rounded-xl px-4 py-2.5 text-sm cursor-pointer w-full"
            >
              Remove Key
            </motion.button>
          </section>

        </div>
      </div>
    </div>
  );
}
