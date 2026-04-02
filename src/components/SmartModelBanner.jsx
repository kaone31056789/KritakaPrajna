import React from "react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

const TASK_ICONS = {
  vision: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  document: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  coding: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  general: null,
};

const TASK_LABELS = {
  vision: "Vision",
  document: "Document",
  coding: "Code",
  general: "General",
};

function shortName(id) {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(slash + 1) : id;
}

/**
 * A compact banner that shows smart model recommendations.
 *
 * Props:
 *   suggestion - Result from selectSmartModel()
 *   onAccept(modelId) - Called when user clicks to switch model
 *   onDismiss() - Called when user clicks dismiss
 */
export default function SmartModelBanner({ suggestion, onAccept, onDismiss }) {
  if (!suggestion || !suggestion.reason || suggestion.currentOk) return null;

  const { recommended, free, paid, reason, taskType } = suggestion;
  const isFreeRec = free && recommended?.id === free.id;
  const icon = TASK_ICONS[taskType];
  const label = TASK_LABELS[taskType];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.25, ease }}
        className="shrink-0 overflow-hidden"
      >
        <div className={`flex items-center gap-3 px-5 py-2.5 text-sm border-b ${
          isFreeRec
            ? "bg-emerald-500/[0.07] border-emerald-500/20 text-emerald-300"
            : "bg-saffron-500/[0.07] border-saffron-500/20 text-saffron-300"
        }`}>
          {/* Task badge */}
          {icon && (
            <span className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-2 py-0.5 ${
              isFreeRec ? "bg-emerald-500/15" : "bg-saffron-500/15"
            }`}>
              {icon}
              {label}
            </span>
          )}

          {/* Message */}
          <span className="flex-1 text-xs">{reason}</span>

          {/* Accept button */}
          {recommended && (
            <motion.button
              type="button"
              onClick={() => onAccept(recommended.id)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`text-xs font-medium rounded-lg px-3 py-1.5 cursor-pointer transition-colors ${
                isFreeRec
                  ? "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300"
                  : "bg-saffron-500/20 hover:bg-saffron-500/30 text-saffron-300"
              }`}
            >
              Use {shortName(recommended.id)}
              {isFreeRec && <span className="ml-1 opacity-70">(Free)</span>}
            </motion.button>
          )}

          {/* Dismiss */}
          <button
            type="button"
            onClick={onDismiss}
            className="text-dark-500 hover:text-dark-300 transition-colors cursor-pointer p-0.5"
            aria-label="Dismiss suggestion"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
