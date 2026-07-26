import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Icon from "../../ui/icons";
import { EASE_OUT, T } from "../../design/motion";

/* ── Reasoning panel ──
   Renders a model's chain of thought as a collapsible card that lives above
   the answer. While the model is still thinking it shimmers and streams live;
   once the answer starts it auto-collapses to a quiet summary chip. The user
   can expand/collapse at any time (that choice then sticks). */

export default function Reasoning({ text, thinking }) {
  const [open, setOpen] = useState(!!thinking);
  const [touched, setTouched] = useState(false);
  const bodyRef = useRef(null);

  // Auto: open while thinking, collapse when it finishes — until the user takes over.
  useEffect(() => {
    if (!touched) setOpen(!!thinking);
  }, [thinking, touched]);

  // Keep the newest reasoning line in view while it streams.
  useEffect(() => {
    if (thinking && open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, thinking, open]);

  const steps = text ? text.split(/\n+/).filter((l) => l.trim()).length : 0;

  return (
    <div className="reason-card rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] overflow-hidden mb-2.5">
      <button
        type="button"
        onClick={() => {
          setTouched(true);
          setOpen((o) => !o);
        }}
        className="w-full flex items-center gap-2 px-3 h-9 text-left select-none"
      >
        <Icon
          name="brain"
          size={13}
          className={thinking ? "text-accent animate-breathe" : "text-dim"}
        />
        <span className={`text-[11.5px] font-medium ${thinking ? "reason-shimmer" : "text-dim"}`}>
          {thinking ? "Thinking…" : "Reasoning"}
        </span>
        {!thinking && steps > 0 && (
          <span className="text-[10.5px] text-faint tabular-nums">
            · {steps} step{steps > 1 ? "s" : ""}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[10px] text-faint">{open ? "Hide" : "Show"}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="flex"
        >
          <Icon name="chevronDown" size={13} className="text-faint" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: T, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div
              ref={bodyRef}
              className="px-3.5 pb-3 max-h-[340px] overflow-y-auto border-t border-line"
            >
              <div className="pt-2.5 text-[12.5px] leading-relaxed text-dim whitespace-pre-wrap break-words">
                {text}
                {thinking && (
                  <span className="inline-block w-[6px] h-[13px] ml-0.5 align-text-bottom rounded-[2px] bg-accent animate-breathe" />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
