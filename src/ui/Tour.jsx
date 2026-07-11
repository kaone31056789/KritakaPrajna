import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE_OUT } from "../design/motion";
import Icon from "./icons";
import { LogoMark } from "./Logo";

/* First-run onboarding tour — sequential coach cards. Shows once; the
   completion flag lives in localStorage under `kp_tour_done`. */

const FLAG = "kp_tour_done";

const STEPS = [
  {
    icon: null, // logo
    title: "Welcome to KritakaPrajna",
    body: "Your multi-provider AI workspace — OpenRouter, HuggingFace and NVIDIA models behind one beautiful chat.",
  },
  {
    icon: "chat",
    title: "Chats that stay organized",
    body: "Pin, rename and group conversations into folders from the sidebar. Recent chats resume right from the home screen.",
  },
  {
    icon: "wand",
    title: "A composer with superpowers",
    body: "Attach files, switch personas, toggle web search and pick reasoning depth — all without leaving the message box.",
  },
  {
    icon: "command",
    title: "Ctrl+K runs everything",
    body: "The command palette switches themes, skins, accents, models and thinking depth in a keystroke — grouped and recent-first.",
  },
  {
    icon: "palette",
    title: "Make it yours",
    body: "20 themes with light & dark variants, an accent color picker and adaptive density live in Settings. Enjoy the ride.",
  },
];

export function tourDone() {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return true;
  }
}

function markDone() {
  try {
    localStorage.setItem(FLAG, "1");
  } catch {}
}

export default function Tour() {
  const [open, setOpen] = useState(() => !tourDone());
  const [step, setStep] = useState(0);
  if (!open) return null;

  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const close = () => {
    markDone();
    setOpen(false);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[220] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ background: "color-mix(in srgb, var(--bg) 62%, transparent)", backdropFilter: "blur(6px)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
        className="neu-raised rounded-md w-[380px] max-w-[calc(100vw-48px)] p-6 relative"
        style={{ background: "var(--surface)" }}
      >
        <button
          type="button"
          onClick={close}
          className="absolute top-3 right-3 text-faint hover:text-hi text-[11px] px-2 py-1 rounded-full pressable"
        >
          Skip
        </button>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <div className="w-12 h-12 rounded-xl neu-raised-sm flex items-center justify-center mb-4">
              {s.icon ? <Icon name={s.icon} size={22} className="text-accent" /> : <LogoMark size={30} glow />}
            </div>
            <h2 className="font-display font-semibold text-[17px] text-hi mb-1.5">{s.title}</h2>
            <p className="text-[12.5px] text-body leading-relaxed mb-5">{s.body}</p>
          </motion.div>
        </AnimatePresence>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                aria-label={`Step ${i + 1}`}
                className="rounded-full transition-all"
                style={{
                  width: i === step ? 16 : 6,
                  height: 6,
                  background: i === step ? "var(--accent)" : "var(--line-strong)",
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="pressable neu-raised-sm rounded-full px-3.5 py-1.5 text-[12px] text-body"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? close() : setStep(step + 1))}
              className="pressable rounded-full px-4 py-1.5 text-[12px] font-semibold"
              style={{ background: "var(--accent)", color: "var(--accent-ink, #fff)" }}
            >
              {last ? "Get started" : "Next"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
