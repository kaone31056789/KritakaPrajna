import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { EASE_OUT } from "../design/motion";
import { LogoMark } from "../ui/Logo";

/* First-boot splash — a rare moment, so it earns a little delight. ~1.3s total. */

export default function Splash({ onDone }) {
  useEffect(() => {
    const t = setTimeout(() => onDone?.(), 1300);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-bg">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
        className="w-20 h-20 rounded-xl neu-raised-lg flex items-center justify-center"
      >
        <motion.span
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.15, ease: EASE_OUT }}
          className="flex"
        >
          <LogoMark size={46} />
        </motion.span>
      </motion.div>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.3, ease: EASE_OUT }}
        className="mt-5 font-display font-semibold text-[17px] tracking-wide"
      >
        <span className="text-hi">Kritaka</span>
        <span
          className="bg-clip-text text-transparent"
          style={{ backgroundImage: "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
        >
          Prajna
        </span>
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.45 }}
        className="mt-1 text-[11.5px] text-faint tracking-[0.2em] uppercase"
      >
        Soft Machine
      </motion.p>
    </div>
  );
}
