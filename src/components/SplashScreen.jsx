import React from "react";
import { motion } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

/**
 * Minimal mandala-inspired geometric SVG icon.
 * Eight-petal lotus/chakra with concentric rings.
 */
function MandalaIcon() {
  return (
    <svg
      className="w-20 h-20"
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer glow ring */}
      <circle cx="50" cy="50" r="44" stroke="#f59e0b" strokeWidth="0.5" opacity="0.3" />
      <circle cx="50" cy="50" r="38" stroke="#fbbf24" strokeWidth="0.5" opacity="0.2" />

      {/* Eight petals - lotus/chakra pattern */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <ellipse
          key={angle}
          cx="50"
          cy="26"
          rx="6"
          ry="16"
          fill="url(#saffronGrad)"
          opacity="0.6"
          transform={`rotate(${angle} 50 50)`}
        />
      ))}

      {/* Inner ring */}
      <circle cx="50" cy="50" r="14" stroke="#f59e0b" strokeWidth="1" opacity="0.5" />

      {/* Center dot */}
      <circle cx="50" cy="50" r="4" fill="#fbbf24" opacity="0.9" />

      <defs>
        <radialGradient id="saffronGrad" cx="50%" cy="30%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.1" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export default function SplashScreen({ onDone }) {
  React.useEffect(() => {
    const timer = setTimeout(onDone, 1800);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-dark-950"
    >
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.2, ease }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-saffron-500/5 animate-glow-pulse blur-3xl"
        />
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.2, ease, delay: 0.3 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full bg-kp-indigo-900/20 animate-glow-pulse blur-2xl"
        />
      </div>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease, delay: 0.15 }}
        className="relative flex flex-col items-center gap-6"
      >
        <MandalaIcon />

        <div className="text-center">
          <h1 className="font-serif text-4xl font-semibold text-white tracking-wide">
            KritakaPrajna
          </h1>
          <p className="mt-2 text-sm text-saffron-400/70 tracking-widest uppercase">
            Artificial Intelligence, Refined
          </p>
        </div>

        {/* Subtle loading bar */}
        <div className="w-32 h-0.5 rounded-full bg-dark-700 overflow-hidden mt-2">
          <motion.div
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.6, ease: [0.4, 0, 0.2, 1] }}
            className="h-full bg-gradient-to-r from-saffron-500 to-saffron-400 rounded-full"
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
