import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { EASE_OUT } from "../design/motion";
import Icon from "./icons";
import { Spinner } from "./primitives";

/* Sonner-principle toast store: call toast() from anywhere, render <Toaster /> once. */

let toasts = [];
let listeners = new Set();
let idCounter = 0;

function emit() {
  toasts = [...toasts];
  listeners.forEach((l) => l());
}

function push(kind, message, opts = {}) {
  const id = ++idCounter;
  toasts.push({
    id,
    kind,
    message,
    description: opts.description,
    duration: opts.duration ?? (kind === "error" ? 5200 : 3200),
    createdAt: Date.now(),
  });
  if (toasts.length > 5) toasts.splice(0, toasts.length - 5);
  emit();
  return id;
}

export const toast = Object.assign((msg, opts) => push("default", msg, opts), {
  success: (msg, opts) => push("success", msg, opts),
  error: (msg, opts) => push("error", msg, opts),
  info: (msg, opts) => push("info", msg, opts),
  loading: (msg, opts) => push("loading", msg, { duration: Infinity, ...opts }),
  dismiss: (id) => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  },
  update: (id, patch) => {
    const t = toasts.find((x) => x.id === id);
    if (t) {
      Object.assign(t, patch, { createdAt: Date.now() });
      emit();
    }
  },
});

const KIND_META = {
  default: { icon: "spark", cls: "text-accent" },
  success: { icon: "check", cls: "text-ok" },
  error: { icon: "alert", cls: "text-err" },
  info: { icon: "info", cls: "text-info" },
  loading: { icon: null, cls: "text-accent" },
};

function Toast({ t }) {
  const remaining = useRef(t.duration);
  const startedAt = useRef(Date.now());
  const timer = useRef(null);

  useEffect(() => {
    remaining.current = t.duration;
    startedAt.current = Date.now();
    if (!Number.isFinite(t.duration)) return undefined;
    timer.current = setTimeout(() => toast.dismiss(t.id), t.duration);
    return () => clearTimeout(timer.current);
  }, [t.id, t.duration, t.createdAt]);

  // Pause on hover — invisible edge-case handling users never notice
  const pause = () => {
    if (!Number.isFinite(t.duration)) return;
    clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
  };
  const resume = () => {
    if (!Number.isFinite(t.duration)) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => toast.dismiss(t.id), Math.max(600, remaining.current));
  };

  const meta = KIND_META[t.kind] || KIND_META.default;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.13, ease: EASE_OUT } }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.15, right: 0.6 }}
      onDragEnd={(e, info) => {
        // Momentum dismissal: quick flick counts even below distance threshold
        if (info.offset.x > 90 || info.velocity.x > 450) toast.dismiss(t.id);
      }}
      onMouseEnter={pause}
      onMouseLeave={resume}
      className="pointer-events-auto flex items-start gap-3 w-[330px] px-4 py-3.5 rounded bg-surface [box-shadow:var(--neu-raised-lg)] cursor-grab active:cursor-grabbing"
    >
      <span className={`mt-0.5 shrink-0 ${meta.cls}`}>
        {t.kind === "loading" ? <Spinner size={15} /> : <Icon name={meta.icon} size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-hi leading-snug">{t.message}</p>
        {t.description && <p className="mt-0.5 text-[12px] text-dim leading-snug">{t.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => toast.dismiss(t.id)}
        className="shrink-0 text-faint hover:text-hi transition-colors duration-100 mt-0.5"
        aria-label="Dismiss"
      >
        <Icon name="close" size={13} />
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const items = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts
  );

  return createPortal(
    <div
      className="fixed bottom-5 right-5 flex flex-col items-end gap-2.5 pointer-events-none"
      style={{ zIndex: "var(--z-toast)" }}
    >
      <AnimatePresence mode="popLayout">
        {items.map((t) => (
          <Toast key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}
