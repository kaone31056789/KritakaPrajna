import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function PersonaSelector({ personas, activePersonaId, onSelect }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  const active = personas.find(p => p.id === activePersonaId) || personas.find(p => p.id === "default");

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 h-8 px-3 rounded text-sm text-left transition-colors cursor-pointer border ${
          open 
            ? "bg-[var(--accent,#00ff41)]/10 border-[var(--accent,#00ff41)]/30 text-[var(--accent,#00ff41)]" 
            : "bg-[#0d0d0d] border-[#1a1a1a]/50 text-white hover:bg-[#111111]"
        }`}
      >
        <span className="text-base leading-none">{active?.emoji || "🤖"}</span>
        <span className="font-medium hidden sm:block truncate max-w-[120px]">{active?.name || "Default Assistant"}</span>
        <svg
          className={`w-3.5 h-3.5 text-[#b0b0b0]/50 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-1.5 w-[240px] bg-[#0d0d0d] border border-[#1a1a1a] shadow-xl rounded-md overflow-hidden z-50 flex flex-col max-h-[300px]"
          >
            <div className="px-3 py-2 border-b border-[#1a1a1a] bg-[#111111]">
              <span className="text-[10px] uppercase tracking-wider text-[#b0b0b0]/60 font-semibold">Switch Persona</span>
            </div>
            <div className="flex-1 overflow-y-auto w-full p-1 scrollbar-hide">
              {personas.map((p) => {
                const isActive = p.id === (activePersonaId || "default");
                return (
                  <button
                    key={p.id}
                    className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-sm transition-colors cursor-pointer ${
                      isActive ? "bg-[var(--accent,#00ff41)]/10 text-[var(--accent,#00ff41)]" : "text-white hover:bg-white/[0.04]"
                    }`}
                    onClick={() => {
                      onSelect(p.id);
                      setOpen(false);
                    }}
                  >
                    <span className="text-xl">{p.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      {p.id !== "default" && (
                        <p className="text-[10px] text-[#b0b0b0]/50 truncate mt-0.5">
                          {p.modelId ? p.modelId.split("/").pop() : "Global Model"}
                          {p.temperature != null ? ` · T=${p.temperature}` : ""}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
