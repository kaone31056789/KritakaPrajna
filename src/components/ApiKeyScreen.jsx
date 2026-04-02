import React, { useState } from "react";
import { motion } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

function MandalaSmall() {
  return (
    <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <ellipse
          key={angle}
          cx="50"
          cy="26"
          rx="6"
          ry="16"
          fill="url(#saffGrad)"
          opacity="0.6"
          transform={`rotate(${angle} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="14" stroke="#f59e0b" strokeWidth="1" opacity="0.5" />
      <circle cx="50" cy="50" r="4" fill="#fbbf24" opacity="0.9" />
      <defs>
        <radialGradient id="saffGrad" cx="50%" cy="30%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.1" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export default function ApiKeyScreen({ onSave }) {
  const [key, setKey] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-dark-950">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-saffron-500/5 blur-3xl pointer-events-none" />

      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
        className="relative bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl shadow-black/40 p-8 w-full max-w-md flex flex-col gap-6"
      >
        {/* Logo icon */}
        <div className="mx-auto">
          <MandalaSmall />
        </div>

        <div>
          <h1 className="font-serif text-2xl font-semibold text-white text-center tracking-wide">
            KritakaPrajna
          </h1>
          <p className="text-dark-200 text-center text-sm mt-1.5">
            Enter your OpenRouter API key to get started.
          </p>
        </div>

        <input
          type="password"
          placeholder="sk-or-..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="bg-dark-700 border border-dark-500 rounded-xl px-4 py-3 text-sm text-white placeholder-dark-300 focus:outline-none focus:ring-2 focus:ring-saffron-500 focus:border-transparent transition-all"
        />

        <motion.button
          type="submit"
          disabled={!key.trim()}
          whileHover={{ scale: 1.02, boxShadow: "0 0 16px rgba(245,158,11,0.2)" }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.15, ease }}
          className="bg-gradient-to-r from-saffron-600 to-saffron-500 hover:from-saffron-500 hover:to-saffron-400 disabled:opacity-40 disabled:hover:from-saffron-600 disabled:hover:to-saffron-500 text-dark-950 font-semibold rounded-xl px-4 py-3 text-sm cursor-pointer shadow-lg shadow-saffron-500/20"
        >
          Save &amp; Continue
        </motion.button>
      </motion.form>
    </div>
  );
}
