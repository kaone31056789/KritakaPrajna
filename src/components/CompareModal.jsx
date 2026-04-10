import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { isModelFree } from "../utils/costTracker";

const ease = [0.4, 0, 0.2, 1];

const SOURCE_LABELS = {
  openrouter: "OpenRouter",
  huggingface: "Hugging Face",
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

const SOURCE_COLORS = {
  openrouter: "#60a5fa",
  huggingface: "#c084fc",
  ollama: "#22c55e",
  openai: "#34d399",
  anthropic: "#fb923c",
};

function displayName(model) {
  const name = model.name || model.id;
  const slash = name.indexOf("/");
  const short = slash > 0 ? name.slice(slash + 1) : name;
  return short.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function selId(m) { return m._selectionId || m.id; }

function fmtPerMillion(pricePerToken) {
  const m = Number(pricePerToken) * 1_000_000;
  if (!m) return null;
  if (m < 0.01) return `$${m.toFixed(4)}`;
  if (m < 1) return `$${m.toFixed(3)}`;
  if (m < 10) return `$${m.toFixed(2)}`;
  return `$${m.toFixed(1)}`;
}

/* ── Inline Model Picker ── */
function ModelPicker({ models, value, onChange, label, placeholder, excludeId }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    let list = models;
    if (excludeId) list = list.filter(m => selId(m) !== excludeId);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m => (m.name || m.id).toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    }
    // Sort: free first, then alphabetical
    return [...list].sort((a, b) => {
      const af = isModelFree(a.pricing) ? 0 : 1;
      const bf = isModelFree(b.pricing) ? 0 : 1;
      if (af !== bf) return af - bf;
      return displayName(a).localeCompare(displayName(b));
    });
  }, [models, excludeId, search]);

  const selectedModel = models.find(m => selId(m) === value);

  return (
    <div className="relative" ref={panelRef}>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[#b0b0b0] mb-2">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 bg-[#111] border border-[#1a1a1a] rounded-sm px-3 py-2.5 text-sm text-left cursor-pointer hover:border-indigo-500/40 transition-colors"
      >
        {selectedModel ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: SOURCE_COLORS[selectedModel._provider] || "#888" }} />
            <span className="truncate text-[#e0e0e0] font-medium">{displayName(selectedModel)}</span>
            {isModelFree(selectedModel.pricing) ? (
              <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">FREE</span>
            ) : selectedModel.pricing?.prompt ? (
              <span className="shrink-0 text-[9px] font-mono text-amber-400/80">{fmtPerMillion(selectedModel.pricing.prompt)}/M</span>
            ) : null}
          </div>
        ) : (
          <span className="text-[#b0b0b0]/40">{placeholder || "Select a model..."}</span>
        )}
        <svg className={`w-4 h-4 text-[#b0b0b0]/40 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease }}
            className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded-sm shadow-2xl overflow-hidden max-h-[320px] flex flex-col"
          >
            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a1a] bg-[#111]">
              <svg className="w-3.5 h-3.5 text-[#b0b0b0]/40 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
              </svg>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="flex-1 bg-transparent text-sm text-[#e0e0e0] placeholder-[#b0b0b0]/30 focus:outline-none"
              />
              {search && (
                <button onClick={() => setSearch("")} className="text-[#b0b0b0]/40 hover:text-white text-xs cursor-pointer">✕</button>
              )}
            </div>

            {/* Model List */}
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-[#b0b0b0]/40">No models found</div>
              ) : (
                filtered.map(m => {
                  const sid = selId(m);
                  const isSelected = sid === value;
                  const free = isModelFree(m.pricing);
                  const provider = m._provider || "openrouter";
                  return (
                    <button
                      key={sid}
                      type="button"
                      onClick={() => { onChange(sid); setOpen(false); setSearch(""); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer transition-colors ${
                        isSelected 
                          ? "bg-indigo-500/15 text-indigo-300" 
                          : "text-[#e0e0e0] hover:bg-[#1a1a1a]/70"
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: SOURCE_COLORS[provider] || "#888" }} />
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium">{displayName(m)}</span>
                          {free ? (
                            <span className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 uppercase">Free</span>
                          ) : m.pricing?.prompt ? (
                            <span className="shrink-0 text-[9px] font-mono text-amber-400/70">{fmtPerMillion(m.pricing.prompt)}/M</span>
                          ) : null}
                        </div>
                        <span className="text-[10px] text-[#b0b0b0]/40 truncate">{SOURCE_LABELS[provider] || provider} · {m.id}</span>
                      </div>
                      {isSelected && (
                        <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-3 py-1.5 border-t border-[#1a1a1a] bg-[#111] text-[9px] text-[#b0b0b0]/30 font-mono flex justify-between">
              <span>{filtered.length} models</span>
              <span>{filtered.filter(m => isModelFree(m.pricing)).length} free</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Compare Modal ── */
export default function CompareModal({ isOpen, onClose, models, onCompare }) {
  const [targetA, setTargetA] = useState("");
  const [targetB, setTargetB] = useState("");
  const [prompt, setPrompt] = useState("");

  if (!isOpen) return null;

  const handleStart = () => {
    if (!targetA || !targetB || !prompt.trim()) return;
    onCompare(prompt.trim(), [targetA, targetB]);
    setPrompt("");
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-md shadow-2xl w-full max-w-2xl overflow-visible font-sans"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a] bg-[#111111] rounded-t-md">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
              <div>
                <h3 className="text-[#e0e0e0] font-semibold tracking-wide">Quick Model Compare</h3>
                <p className="text-[11px] text-[#b0b0b0]/60 mt-0.5">Test two models simultaneously against the same prompt</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-[#b0b0b0]/50 hover:text-white p-1 rounded-sm hover:bg-[#1a1a1a] transition-colors cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <ModelPicker
                models={models}
                value={targetA}
                onChange={setTargetA}
                label="Model A"
                placeholder="Pick your champion..."
              />
              <ModelPicker
                models={models}
                value={targetB}
                onChange={setTargetB}
                label={<>Model B <span className="text-indigo-400 normal-case tracking-normal ml-1">(Challenger)</span></>}
                placeholder="Pick the challenger..."
                excludeId={targetA}
              />
            </div>

            <div className={!targetA || !targetB ? "opacity-30 pointer-events-none transition-opacity" : "transition-opacity"}>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[#b0b0b0] mb-2">The Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What do you want to ask them?"
                className="w-full bg-[#111] border border-[#1a1a1a] rounded-sm px-4 py-3 text-sm text-[#e0e0e0] focus:outline-none focus:border-indigo-500/50 resize-y min-h-[100px] placeholder-[#b0b0b0]/30"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleStart();
                  }
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[#1a1a1a] bg-[#111111] rounded-b-md">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold tracking-wide text-[#b0b0b0] hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleStart}
              disabled={!targetA || !targetB || !prompt.trim()}
              className="px-5 py-2 text-xs font-bold tracking-wide text-white bg-indigo-600 hover:bg-indigo-500 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              ⚡ Start Comparison
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
