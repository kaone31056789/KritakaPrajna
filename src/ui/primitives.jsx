import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { EASE_OUT, T, T_FAST, modalPop, backdropFade, SPRING_SNAPPY } from "../design/motion";
import Icon from "./icons";

/* ═══ Spinner — fast spin reads as faster loading ═══ */
export function Spinner({ size = 14, className = "" }) {
  return (
    <span
      className={`inline-block animate-spin-fast rounded-full border-2 border-line-strong border-t-accent ${className}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

/* ═══ NeuButton ═══ */
const BTN_SIZES = {
  sm: "h-8 px-3 text-[12.5px] gap-1.5",
  md: "h-10 px-4 text-[13.5px] gap-2",
  lg: "h-12 px-6 text-[14.5px] gap-2.5",
};

export function NeuButton({
  children,
  variant = "raised", // raised | accent | ghost | danger
  size = "md",
  icon,
  iconRight,
  loading = false,
  disabled = false,
  className = "",
  ...rest
}) {
  const base =
    "pressable inline-flex items-center justify-center font-medium rounded-sm select-none whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none";
  const variants = {
    raised:
      "bg-surface text-body hover:text-hi [box-shadow:var(--neu-raised-sm)] hover:[box-shadow:var(--neu-raised)]",
    accent:
      "text-accent-ink font-semibold [background:linear-gradient(135deg,var(--accent),var(--accent-2))] [box-shadow:var(--neu-raised-sm),0_2px_14px_var(--accent-glow)] hover:[box-shadow:var(--neu-raised),0_4px_20px_var(--accent-glow)]",
    ghost: "bg-transparent text-dim hover:text-hi hover:bg-surface-2",
    danger: "bg-surface text-err [box-shadow:var(--neu-raised-sm)] hover:bg-err-soft",
  };
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`${base} ${BTN_SIZES[size]} ${variants[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size={13} /> : icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={size === "sm" ? 14 : 16} /> : null}
    </button>
  );
}

/* ═══ IconButton ═══ */
export function IconButton({ name, size = 16, label, active = false, tone = "default", className = "", ...rest }) {
  const tones = {
    default: active ? "text-accent" : "text-dim hover:text-hi",
    danger: "text-dim hover:text-err",
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`pressable inline-flex items-center justify-center w-8 h-8 rounded-xs ${
        active ? "bg-deep [box-shadow:var(--neu-inset-sm)]" : "hover:bg-surface-2"
      } ${tones[tone]} ${className}`}
      {...rest}
    >
      <Icon name={name} size={size} />
    </button>
  );
}

/* ═══ NeuInput / NeuTextArea — inset wells ═══ */
export const NeuInput = React.forwardRef(function NeuInput(
  { label, hint, icon, className = "", inputClassName = "", ...rest },
  ref
) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="block mb-1.5 text-[12px] font-medium text-dim">{label}</span>}
      <div className="relative">
        {icon && (
          <Icon name={icon} size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        )}
        <input
          ref={ref}
          className={`w-full h-10 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[13.5px] text-hi placeholder:text-faint px-4 ${
            icon ? "pl-9" : ""
          } transition-shadow duration-150 focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)] ${inputClassName}`}
          {...rest}
        />
      </div>
      {hint && <span className="block mt-1 text-[11px] text-faint">{hint}</span>}
    </label>
  );
});

export const NeuTextArea = React.forwardRef(function NeuTextArea({ label, className = "", ...rest }, ref) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="block mb-1.5 text-[12px] font-medium text-dim">{label}</span>}
      <textarea
        ref={ref}
        className="w-full rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[13.5px] text-hi placeholder:text-faint px-4 py-3 resize-none transition-shadow duration-150 focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)]"
        {...rest}
      />
    </label>
  );
});

/* ═══ NeuToggle — pill with sprung knob ═══ */
export function NeuToggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`pressable inline-flex items-center gap-2.5 disabled:opacity-45 ${label ? "" : ""}`}
    >
      <span
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
          checked ? "" : "bg-deep"
        }`}
        style={{
          boxShadow: "var(--neu-inset-sm)",
          background: checked ? "linear-gradient(135deg, var(--accent), var(--accent-2))" : undefined,
        }}
      >
        <motion.span
          className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-surface-3"
          style={{ boxShadow: "var(--neu-raised-sm)" }}
          animate={{ left: checked ? 22 : 3 }}
          transition={SPRING_SNAPPY}
        />
      </span>
      {label && <span className="text-[13px] text-body">{label}</span>}
    </button>
  );
}

/* ═══ NeuSlider ═══ */
export function NeuSlider({ label, value, min = 0, max = 100, step = 1, onChange, format = (v) => v }) {
  return (
    <div>
      {label && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-dim">{label}</span>
          <span className="text-[12px] font-mono text-accent">{format(value)}</span>
        </div>
      )}
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
      />
    </div>
  );
}

/* ═══ Segmented — animated inset indicator ═══ */
let segCounter = 0;
export function Segmented({ options, value, onChange, size = "md", className = "" }) {
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = `seg-${++segCounter}`;
  return (
    <div
      className={`inline-flex items-center gap-1 p-1 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] ${className}`}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(opt.value)}
            className={`pressable relative rounded-xs font-medium whitespace-nowrap ${
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3.5 text-[12.5px]"
            } ${active ? "text-hi" : "text-dim hover:text-body"}`}
          >
            {active && (
              <motion.span
                layoutId={idRef.current}
                className="absolute inset-0 rounded-xs bg-surface-2"
                style={{ boxShadow: "var(--neu-raised-sm)" }}
                transition={{ duration: T, ease: EASE_OUT }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {opt.icon && <Icon name={opt.icon} size={13} />}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ═══ NeuBadge ═══ */
export function NeuBadge({ children, tone = "neutral", className = "" }) {
  const tones = {
    neutral: "bg-surface-2 text-dim",
    accent: "bg-accent-soft text-accent",
    ok: "bg-ok-soft text-ok",
    err: "bg-err-soft text-err",
    info: "bg-info-soft text-info",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-wide ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ═══ NeuCard ═══ */
export function NeuCard({ children, className = "", inset = false, ...rest }) {
  return (
    <div
      className={`${inset ? "neu-inset" : "neu-raised"} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ═══ NeuModal — portal, centered origin (modals stay centered per Emil) ═══ */
export function NeuModal({ open, onClose, title, children, width = 480, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 flex items-center justify-center p-6"
          style={{ zIndex: "var(--z-modal)" }}
          {...backdropFade}
        >
          <div
            className="absolute inset-0"
            style={{ background: "var(--backdrop)", backdropFilter: "blur(8px)" }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative neu-raised-lg max-h-[85vh] flex flex-col"
            style={{ width, maxWidth: "94vw" }}
            {...modalPop}
          >
            {title && (
              <div className="flex items-center justify-between px-6 pt-5 pb-1">
                <h2 className="font-display font-semibold text-[16px] text-hi">{title}</h2>
                <IconButton name="close" label="Close" onClick={onClose} />
              </div>
            )}
            <div className="px-6 py-4 overflow-y-auto min-h-0">{children}</div>
            {footer && <div className="px-6 pb-5 pt-2 flex items-center justify-end gap-2.5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/* ═══ NeuPopover — origin-aware scale from trigger ═══ */
export function NeuPopover({ open, onClose, anchor = "bottom-start", children, className = "", width, portal = false, anchorRef }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    };
    const onKey = (e) => e.key === "Escape" && onClose?.();
    const onScroll = (e) => {
      if (portal && ref.current && !ref.current.contains(e.target)) onClose?.();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    if (portal) window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      if (portal) window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, onClose, portal]);

  const placements = {
    "bottom-start": { pos: "top-full left-0 mt-2", origin: "top left" },
    "bottom-end": { pos: "top-full right-0 mt-2", origin: "top right" },
    "top-start": { pos: "bottom-full left-0 mb-2", origin: "bottom left" },
    "top-end": { pos: "bottom-full right-0 mb-2", origin: "bottom right" },
    "right-start": { pos: "left-full top-0 ml-2", origin: "top left" },
  };
  const p = placements[anchor] || placements["bottom-start"];

  /* Portal mode — fixed position measured from the trigger, so overflow/scroll
     containers (like the chat sidebar) can never clip the menu. */
  let fixedStyle = null;
  let origin = p.origin;
  if (portal && anchorRef?.current) {
    const r = anchorRef.current.getBoundingClientRect();
    const gap = 6;
    const estH = 280;
    const openUp = r.bottom + estH > window.innerHeight && r.top > estH;
    const end = anchor.endsWith("end");
    fixedStyle = {
      position: "fixed",
      top: openUp ? "auto" : r.bottom + gap,
      bottom: openUp ? window.innerHeight - r.top + gap : "auto",
      left: end ? "auto" : r.left,
      right: end ? window.innerWidth - r.right : "auto",
    };
    origin = `${openUp ? "bottom" : "top"} ${end ? "right" : "left"}`;
  }

  const node = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          className={`${portal ? "" : `absolute ${p.pos}`} neu-raised-lg p-1.5 ${className}`}
          style={{ zIndex: "var(--z-popover)", transformOrigin: origin, width, ...(fixedStyle || {}) }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: T_FAST, ease: EASE_OUT } }}
          transition={{ duration: T, ease: EASE_OUT }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
  return portal ? createPortal(node, document.body) : node;
}

/* Menu item for popovers */
export function MenuItem({ icon, children, danger = false, onClick, right }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 h-9 rounded-xs text-[13px] text-left transition-colors duration-100 ${
        danger ? "text-err hover:bg-err-soft" : "text-body hover:text-hi hover:bg-surface-2"
      }`}
    >
      {icon && <Icon name={icon} size={15} className={danger ? "" : "text-dim"} />}
      <span className="flex-1">{children}</span>
      {right}
    </button>
  );
}

/* ═══ NeuTooltip — delayed first open, instant for subsequent (Emil) ═══ */
let lastTooltipHidden = 0;

export function NeuTooltip({ label, side = "top", children }) {
  const [show, setShow] = useState(false);
  const timer = useRef(null);

  const onEnter = useCallback(() => {
    const instant = Date.now() - lastTooltipHidden < 350;
    if (instant) setShow(true);
    else timer.current = setTimeout(() => setShow(true), 450);
  }, []);
  const onLeave = useCallback(() => {
    clearTimeout(timer.current);
    if (show) lastTooltipHidden = Date.now();
    setShow(false);
  }, [show]);

  const pos =
    side === "right"
      ? "left-full top-1/2 -translate-y-1/2 ml-2.5"
      : side === "bottom"
      ? "top-full left-1/2 -translate-x-1/2 mt-2"
      : "bottom-full left-1/2 -translate-x-1/2 mb-2";

  return (
    <span className="relative inline-flex" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
      <AnimatePresence>
        {show && label && (
          <motion.span
            className={`absolute ${pos} px-2.5 py-1.5 rounded-xs bg-surface-3 text-hi text-[11.5px] font-medium whitespace-nowrap pointer-events-none [box-shadow:var(--neu-raised-sm)]`}
            style={{ zIndex: "var(--z-popover)" }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.125, ease: EASE_OUT }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/* ═══ Skeleton ═══ */
export function Skeleton({ className = "" }) {
  return (
    <div
      className={`rounded-xs animate-shimmer ${className}`}
      style={{
        background:
          "linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%)",
        backgroundSize: "200% 100%",
      }}
    />
  );
}

/* ═══ GradientOrb — procedural avatar from any string (models, providers, personas) ═══ */
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function GradientOrb({ seed = "", size = 28, className = "", glow = false }) {
  const h = hashString(String(seed));
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + (h % 80)) % 360;
  const angle = h % 180;
  return (
    <span
      className={`inline-block rounded-full shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(${angle}deg, hsl(${hue1} 65% 62%), hsl(${hue2} 70% 48%))`,
        boxShadow: glow
          ? `var(--neu-raised-sm), 0 0 12px hsla(${hue1}, 70%, 55%, 0.35)`
          : "var(--neu-raised-sm)",
      }}
      aria-hidden="true"
    />
  );
}

/* ═══ Kbd ═══ */
export function Kbd({ children }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-[6px] bg-surface-2 [box-shadow:var(--neu-raised-sm)] text-[10.5px] font-mono font-medium text-dim">
      {children}
    </kbd>
  );
}

/* ═══ EmptyState ═══ */
export function EmptyState({ icon = "spark", title, hint, action, className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}>
      <div className="w-14 h-14 rounded-lg neu-inset flex items-center justify-center mb-4 float-idle">
        <Icon name={icon} size={24} className="text-faint" />
      </div>
      <p className="font-display font-semibold text-[15px] text-hi mb-1">{title}</p>
      {hint && <p className="text-[12.5px] text-dim max-w-[300px] leading-relaxed">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ═══ SectionLabel — eyebrow tag ═══ */
export function SectionLabel({ children, className = "" }) {
  return (
    <span
      className={`inline-block text-[10px] font-semibold uppercase tracking-[0.18em] text-faint ${className}`}
    >
      {children}
    </span>
  );
}
