import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

function TerminalPrompt() {
  return (
    <span className="text-[#00ff41] text-2xl font-bold text-glow-green">&gt;_</span>
  );
}

const PROVIDERS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "500+ models, free tier available",
    placeholder: "sk-or-v1-...",
    color: "#7c6ff7",
    badge: "Recommended",
    badgeColor: "text-[#00ff41] bg-[#00ff41]/10 border-[#00ff41]/20",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/><path d="M2 12h20"/>
      </svg>
    ),
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o, o1, o3-mini",
    placeholder: "sk-proj-...",
    color: "#10a37f",
    badge: null,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.032.067L9.846 19.92a4.497 4.497 0 0 1-6.246-1.616zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
      </svg>
    ),
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude Opus, Sonnet, Haiku",
    placeholder: "sk-ant-...",
    color: "#c96442",
    badge: null,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.304 3.541L12.3 16.963l-1.59-4.327L14.59 3.54h2.714zm-10.608 0h2.715l4.88 13.422-1.59 4.496-6.005-17.918zM12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0z"/>
      </svg>
    ),
  },
  {
    id: "huggingface",
    label: "HuggingFace",
    description: "Llama, Qwen, DeepSeek & more",
    placeholder: "hf_...",
    color: "#f5a623",
    badge: "Free Models",
    badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 6.628 5.374 12 12 12 6.628 0 12-5.372 12-12C24 5.373 18.628 0 12 0zm-1.35 5.4c.36 0 .66.12.9.36.24.24.36.54.36.9s-.12.66-.36.9c-.24.24-.54.36-.9.36s-.66-.12-.9-.36c-.24-.24-.36-.54-.36-.9s.12-.66.36-.9c.24-.24.54-.36.9-.36zm2.7 0c.36 0 .66.12.9.36.24.24.36.54.36.9s-.12.66-.36.9c-.24.24-.54.36-.9.36s-.66-.12-.9-.36c-.24-.24-.36-.54-.36-.9s.12-.66.36-.9c.24-.24.54-.36.9-.36zm-4.65 3.9c1.02 0 1.95.39 2.64 1.02.24-.12.48-.18.75-.18.27 0 .51.06.75.18.69-.63 1.62-1.02 2.64-1.02 2.16 0 3.9 1.74 3.9 3.9 0 1.98-1.47 3.6-3.36 3.87v.03c0 2.01-1.62 3.63-3.63 3.63S8.37 18.99 8.37 16.98v-.03C6.48 16.68 5.01 15.06 5.01 13.2c0-2.16 1.74-3.9 3.9-3.9z"/>
      </svg>
    ),
  },
  {
    id: "ollama",
    label: "Ollama",
    description: "Cloud models via Ollama API key",
    placeholder: "ollama_...",
    color: "#22c55e",
    badge: "Cloud",
    badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l8 4v6c0 5-3.4 8.8-8 10-4.6-1.2-8-5-8-10V6l8-4z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 12h7M12 8.5v7" />
      </svg>
    ),
  },
];

export default function ApiKeyScreen({ onSave, initialProviders = {} }) {
  const [selected, setSelected] = useState(() => {
    const pre = new Set(
      Object.entries(initialProviders)
        .filter(([, v]) => !!v)
        .map(([k]) => k)
    );
    return pre.size > 0 ? pre : new Set(["openrouter"]);
  });
  const [keys, setKeys] = useState({
    openrouter:  initialProviders.openrouter  || "",
    openai:      initialProviders.openai      || "",
    anthropic:   initialProviders.anthropic   || "",
    huggingface: initialProviders.huggingface || "",
    ollama:      initialProviders.ollama      || "",
  });

  const toggleProvider = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const canContinue = [...selected].some((id) => keys[id]?.trim());

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canContinue) return;
    const result = {};
    for (const id of selected) {
      const trimmed = keys[id]?.trim();
      if (trimmed) {
        result[id] = trimmed;
      }
    }
    onSave(result);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-[#0a0a0a] overflow-y-auto py-8">
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
        className="relative bg-[#111111] border border-[#1a1a1a] rounded-sm shadow-elevation-4 p-8 w-full max-w-lg flex flex-col gap-6 mx-4"
      >
        {/* Logo + heading */}
        <div className="flex flex-col items-center gap-2">
          <TerminalPrompt />
          <h1 className="font-mono text-xl font-bold text-[#00ff41] tracking-wider text-glow-green">KritakaPrajna</h1>
          <p className="text-[#b0b0b0] text-center text-sm">
            Select one or more API providers to get started.
          </p>
        </div>

        {/* Provider cards */}
        <div className="grid grid-cols-2 gap-2.5">
          {PROVIDERS.map((p) => {
            const isOn = selected.has(p.id);
            return (
              <motion.button
                key={p.id}
                type="button"
                onClick={() => toggleProvider(p.id)}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.12, ease }}
                className={`relative flex flex-col gap-1.5 rounded-sm border px-4 py-3 text-left cursor-pointer transition-all ${
                  isOn
                    ? "border-[#00ff41]/40 bg-[#00ff41]/5 shadow-3d-button-active"
                    : "border-[#1a1a1a] bg-[#0a0a0a] shadow-elevation-1 hover:border-[#2a2a2a] hover:bg-[#111111]"
                }`}
              >
                {/* Checkmark */}
                <div className={`absolute top-2.5 right-2.5 w-4 h-4 rounded-sm flex items-center justify-center transition-colors ${
                  isOn ? "bg-[#00ff41]" : "border border-[#2a2a2a]"
                }`}>
                  {isOn && (
                    <svg className="w-2.5 h-2.5 text-black" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>

                {/* Icon */}
                <span style={{ color: p.color }} className="opacity-90">{p.icon}</span>

                {/* Label + badge */}
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold text-[#e0e0e0]">{p.label}</span>
                    {p.badge && (
                      <span className={`text-[9px] font-medium border rounded-sm px-1.5 py-0.5 leading-none ${p.badgeColor}`}>
                        {p.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#b0b0b0] mt-0.5">{p.description}</p>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Key inputs */}
        <AnimatePresence mode="sync">
          {PROVIDERS.filter((p) => selected.has(p.id)).map((p) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease }}
              className="overflow-hidden -mt-2"
            >
              <div className="pt-0.5">
                <label className="block text-xs font-medium text-[#b0b0b0] mb-1.5">
                  <span style={{ color: p.color }}>$</span> {p.label} API Key
                </label>
                <input
                  type="password"
                  placeholder={p.placeholder}
                  value={keys[p.id]}
                  onChange={(e) => setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-sm px-4 py-2.5 text-sm text-[#e0e0e0] placeholder-[#b0b0b0]/40 focus:outline-none focus:border-[#00ff41]/40 transition-all shadow-inner-shadow font-mono"
                />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Submit */}
        <motion.button
          type="submit"
          disabled={!canContinue}
          whileHover={{ scale: 1.02, boxShadow: "0 0 16px rgba(0,255,65,0.15)" }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.15, ease }}
          className="bg-[#00ff41] hover:bg-[#00cc33] disabled:opacity-40 text-black font-bold rounded-sm px-4 py-3 text-sm cursor-pointer shadow-3d-button active:shadow-3d-button-active font-mono tracking-wide"
        >
          [ ENTER ]
        </motion.button>

        <p className="text-center text-[11px] text-[#b0b0b0]/50">
          Keys are encrypted and stored locally — never sent to us.
        </p>
      </motion.form>
    </div>
  );
}
