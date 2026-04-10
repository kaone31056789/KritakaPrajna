import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

const BOOT_LINES = [
  { text: "[ OK ] Loading modules...", delay: 0 },
  { text: "[ OK ] Initializing runtime...", delay: 300 },
  { text: "[ OK ] Connecting providers...", delay: 600 },
  { text: "", delay: 900 },
  { text: ">_ KritakaPrajna v3.0.0", delay: 1000, highlight: true },
];

function BootSequence() {
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    const timers = BOOT_LINES.map((line, i) =>
      setTimeout(() => setVisibleLines(i + 1), line.delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="font-mono text-[13px] leading-relaxed text-left">
      {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className={line.highlight ? "text-[#00ff41] text-glow-green font-bold mt-2 text-[16px]" : "text-[#b0b0b0]"}
        >
          {line.text && (
            <>
              {!line.highlight && (
                <span className="text-[#00ff41]">{line.text.slice(0, 6)}</span>
              )}
              {line.highlight ? line.text : (
                <span>{line.text.slice(6)}</span>
              )}
            </>
          )}
        </motion.div>
      ))}
      {visibleLines >= BOOT_LINES.length && (
        <span className="terminal-cursor" />
      )}
    </div>
  );
}

export default function SplashScreen({ onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1800);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0a0a0a]"
    >
      {/* Content */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease, delay: 0.1 }}
        className="relative flex flex-col items-center gap-6 max-w-md px-8"
      >
        <BootSequence />

        {/* Loading bar */}
        <div className="w-48 h-[2px] bg-[#1a1a1a] overflow-hidden mt-3">
          <motion.div
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.5, ease: [0.4, 0, 0.2, 1] }}
            className="h-full bg-[#00ff41]"
          />
        </div>

        <p className="text-[10px] text-[#00ff41]/50 tracking-[0.2em] uppercase">
          SYSTEM READY
        </p>
      </motion.div>
    </motion.div>
  );
}
