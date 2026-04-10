import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export const DEFAULT_PERSONAS = [
  {
    id: "default",
    name: "Default Assistant",
    emoji: "🤖",
    systemPrompt: "",
    modelId: null,
    temperature: null,
    topP: null,
  },
  {
    id: "code_wizard",
    name: "Code Wizard",
    emoji: "🧙‍♂️",
    systemPrompt: "You are an elite Staff Software Engineer. Provide concise, production-ready code with no boilerplate. Focus on extremely high-quality architecture and performance.",
    modelId: null,
    temperature: 0.1,
    topP: 0.8,
  },
  {
    id: "creative_writer",
    name: "Creative Writer",
    emoji: "✍️",
    systemPrompt: "You are a creative storytelling assistant. Use evocative imagery, rich vocabulary, and varying sentence structures. Avoid corporate speak.",
    modelId: null,
    temperature: 0.9,
    topP: 0.95,
  },
  {
    id: "tutor",
    name: "Tutor",
    emoji: "🎓",
    systemPrompt: "You are a patient, encouraging tutor. Explain concepts extremely simply using analogies. Do not just give the answer; try to guide the user to the answer.",
    modelId: null,
    temperature: 0.6,
    topP: 1.0,
  }
];

export default function PersonaEditor({ personas, onSavePersonas, models }) {
  const [editingPersona, setEditingPersona] = useState(null);
  const [errorPrompt, setErrorPrompt] = useState("");

  const EMOJI_LIST = ["🤖", "🧙‍♂️", "✍️", "🎓", "🎨", "🔬", "📊", "💻", "🔥", "🚀", "💡", "🧠", "🛠️", "💬", "⚡"];

  const handleCreateNew = () => {
    setEditingPersona({
      id: `p_${Date.now()}`,
      name: "New Persona",
      emoji: "🤖",
      systemPrompt: "",
      modelId: null,
      temperature: null,
      topP: null,
      isNew: true,
    });
    setErrorPrompt("");
  };

  const handleSave = () => {
    if (!editingPersona.name.trim()) {
      setErrorPrompt("Name is required");
      return;
    }
    
    let nextPersonas = [...personas];
    if (editingPersona.isNew) {
      const { isNew, ...rest } = editingPersona;
      nextPersonas.push(rest);
    } else {
      const idx = nextPersonas.findIndex((p) => p.id === editingPersona.id);
      if (idx !== -1) nextPersonas[idx] = { ...editingPersona };
    }
    
    onSavePersonas(nextPersonas);
    setEditingPersona(null);
  };

  const handleDelete = (id) => {
    if (id === "default") return;
    if (!window.confirm("Are you sure you want to delete this Persona?")) return;
    const nextPersonas = personas.filter((p) => p.id !== id);
    onSavePersonas(nextPersonas);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-[#b0b0b0] uppercase tracking-wider">
            Chat Personas
          </h3>
          <p className="text-xs text-[#b0b0b0]/60 mt-1">
            Create pre-configured AI profiles with custom prompts and parameter overrides.
          </p>
        </div>
        {!editingPersona && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleCreateNew}
            className="bg-[#00ff41]/10 hover:bg-[#00ff41]/20 text-[#00ff41] border border-[#00ff41]/20 rounded-sm px-3 py-1.5 text-xs font-medium cursor-pointer flex items-center gap-1.5 transition-colors"
          >
            <span>+</span> Create Persona
          </motion.button>
        )}
      </div>

      <AnimatePresence mode="popLayout">
        {editingPersona ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm p-4 sm:p-5 space-y-5"
          >
            <div className="flex items-center gap-4">
              <div className="shrink-0 relative group">
                <div className="w-12 h-12 bg-[#0d0d0d] border border-white/[0.08] rounded-full flex items-center justify-center text-xl shadow-inner">
                  {editingPersona.emoji}
                </div>
                <select
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  value={editingPersona.emoji}
                  onChange={(e) => setEditingPersona({ ...editingPersona, emoji: e.target.value })}
                >
                  {EMOJI_LIST.map((em) => <option key={em} value={em}>{em}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-[#b0b0b0]/60 uppercase tracking-wider block mb-1">Persona Name</label>
                <input
                  type="text"
                  value={editingPersona.name}
                  onChange={(e) => setEditingPersona({ ...editingPersona, name: e.target.value })}
                  className="w-full bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-sm text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[var(--accent,#00ff41)]/40"
                  placeholder="e.g. Code Wizard"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-[#b0b0b0]/60 uppercase tracking-wider block mb-1">System Prompt Override</label>
              <textarea
                rows={4}
                value={editingPersona.systemPrompt}
                onChange={(e) => setEditingPersona({ ...editingPersona, systemPrompt: e.target.value })}
                className="w-full bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-[12px] text-white placeholder-[#b0b0b0]/30 focus:outline-none focus:ring-1 focus:ring-[var(--accent,#00ff41)]/40 resize-y font-mono leading-relaxed"
                placeholder="Leave blank to use the global Settings system prompt..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-[#b0b0b0]/60 uppercase tracking-wider block mb-1">Preferred Model (Optional)</label>
                <select
                  value={editingPersona.modelId || ""}
                  onChange={(e) => setEditingPersona({ ...editingPersona, modelId: e.target.value || null })}
                  className="w-full bg-[#0d0d0d] border border-[#1a1a1a]/50 rounded-sm px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-[var(--accent,#00ff41)]/40 cursor-pointer"
                >
                  <option value="">(Inherit Active Model)</option>
                  {(models || []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-[#b0b0b0]/60 uppercase tracking-wider block">Temperature</label>
                    <span className="text-[10px] text-[#b0b0b0] font-mono">{editingPersona.temperature ?? "Inherit"}</span>
                  </div>
                  <input
                    type="range"
                    min="0" max="2" step="0.05"
                    value={editingPersona.temperature ?? -1}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setEditingPersona({ ...editingPersona, temperature: val < 0 ? null : val });
                    }}
                    className="w-full mt-1.5 h-1 bg-[#1a1a1a] rounded-full appearance-none cursor-pointer outline-none slider-thumb-accent"
                  />
                  <div className="flex justify-between mt-1 text-[9px] text-[#b0b0b0]/40">
                    <span>Inherit (-1)</span>
                    <span>2.0</span>
                  </div>
                </div>
              </div>
            </div>

            {errorPrompt && <p className="text-xs text-red-400">{errorPrompt}</p>}
            
            <div className="flex gap-2 pt-2 border-t border-white/[0.04]">
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={handleSave}
                className="flex-1 bg-[var(--accent,#00ff41)]/20 text-[var(--accent,#00ff41)] font-medium rounded-sm px-4 py-2 text-sm cursor-pointer"
              >
                Save Persona
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => setEditingPersona(null)}
                className="px-4 py-2 text-sm text-[#b0b0b0]/60 hover:text-[#e0e0e0] border border-transparent hover:bg-white/5 rounded-sm cursor-pointer"
              >
                Cancel
              </motion.button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            {personas.map((persona) => (
              <div key={persona.id} className="bg-[#111111] border border-[#1a1a1a]/50 rounded-sm p-4 flex flex-col group hover:border-white/[0.08] transition-colors relative">
                <div className="flex items-start gap-3">
                  <span className="text-2xl mt-0.5">{persona.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-white truncate">{persona.name}</h4>
                    <p className="text-[11px] text-[#b0b0b0]/50 mt-1 line-clamp-2 leading-relaxed">
                      {persona.systemPrompt || "Uses the global default system prompt."}
                    </p>
                  </div>
                </div>
                
                <div className="mt-4 pt-3 border-t border-[#1a1a1a]/50 flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {persona.modelId && (
                      <span className="text-[9px] bg-white/[0.04] text-[#b0b0b0]/60 px-1.5 py-0.5 rounded uppercase font-mono truncate max-w-[80px]" title={persona.modelId}>
                        {persona.modelId.split("/").pop()}
                      </span>
                    )}
                    {persona.temperature !== null && (
                      <span className="text-[9px] bg-white/[0.04] text-[#b0b0b0]/60 px-1.5 py-0.5 rounded uppercase font-mono">
                        T={persona.temperature}
                      </span>
                    )}
                  </div>
                  
                  <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingPersona({ ...persona }); setErrorPrompt(""); }}
                      className="text-[#b0b0b0]/40 hover:text-[#b0b0b0] p-1.5 cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path strokeLinecap="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    {persona.id !== "default" && (
                      <button
                        onClick={() => handleDelete(persona.id)}
                        className="text-[#b0b0b0]/40 hover:text-red-400 p-1.5 cursor-pointer"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
