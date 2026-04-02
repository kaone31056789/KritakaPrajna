import React from "react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

function shortName(id) {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(slash + 1) : id;
}

/**
 * Banner: "This looks like a coding task. Use a coding model?"
 */
export function TaskSuggestionBanner({ taskType, suggestedModelId, onSwitch, onIgnore }) {
  if (!taskType || taskType === "general" || !suggestedModelId) return null;

  const labels = {
    coding: { icon: "💡", text: "This looks like a coding task. Use a coding model?" },
    vision: { icon: "👁️", text: "This looks like a vision task. Switch to a vision model?" },
    document: { icon: "📄", text: "This looks like a document task. Use a document-capable model?" },
  };

  const { icon, text } = labels[taskType] || labels.coding;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease }}
      className="shrink-0 overflow-hidden"
    >
      <div className="flex items-center gap-3 px-5 py-2.5 text-sm border-b bg-saffron-500/[0.07] border-saffron-500/20">
        <span className="text-base">{icon}</span>
        <span className="flex-1 text-xs text-saffron-300">{text}</span>
        <motion.button
          type="button"
          onClick={onSwitch}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="text-xs font-medium rounded-lg px-3 py-1.5 cursor-pointer bg-saffron-500/20 hover:bg-saffron-500/30 text-saffron-300 transition-colors"
        >
          Switch to {shortName(suggestedModelId)}
        </motion.button>
        <button
          type="button"
          onClick={onIgnore}
          className="text-xs text-dark-400 hover:text-dark-200 cursor-pointer transition-colors px-2 py-1"
        >
          Ignore
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Banner: "⚠️ This model is currently busy. Try another?"
 */
export function RateLimitBanner({ modelId, fallbackModelId, onSwitch, onDismiss }) {
  if (!modelId) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease }}
      className="shrink-0 overflow-hidden"
    >
      <div className="flex items-center gap-3 px-5 py-2.5 text-sm border-b bg-amber-500/[0.07] border-amber-500/20">
        <span className="text-base">⚠️</span>
        <span className="flex-1 text-xs text-amber-300">
          <strong>{shortName(modelId)}</strong> is currently busy or rate-limited. Try another model?
        </span>
        {fallbackModelId && (
          <motion.button
            type="button"
            onClick={onSwitch}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="text-xs font-medium rounded-lg px-3 py-1.5 cursor-pointer bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition-colors"
          >
            Switch to {shortName(fallbackModelId)}
          </motion.button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-dark-400 hover:text-dark-200 cursor-pointer transition-colors px-2 py-1"
        >
          Dismiss
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Banner: "💰 Cheapest model available for this task: Mixtral (Free)"
 */
export function CheapestModelBanner({ cheapestLabel, cheapestModelId, currentModelId, onUseCheapest, onKeepCurrent }) {
  if (!cheapestLabel || !cheapestModelId || cheapestModelId === currentModelId) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease }}
      className="shrink-0 overflow-hidden"
    >
      <div className="flex items-center gap-3 px-5 py-2.5 text-sm border-b bg-emerald-500/[0.07] border-emerald-500/20">
        <span className="text-base">💰</span>
        <span className="flex-1 text-xs text-emerald-300">
          Cheapest model for this task: <strong>{cheapestLabel}</strong>
        </span>
        <motion.button
          type="button"
          onClick={onUseCheapest}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="text-xs font-medium rounded-lg px-3 py-1.5 cursor-pointer bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-colors"
        >
          Use Cheapest
        </motion.button>
        <button
          type="button"
          onClick={onKeepCurrent}
          className="text-xs text-dark-400 hover:text-dark-200 cursor-pointer transition-colors px-2 py-1"
        >
          Keep Current
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Combined banner container that shows all active banners stacked.
 */
export default function PromptBanners({
  taskSuggestion,
  rateLimitWarning,
  cheapestModel,
}) {
  const hasAny = taskSuggestion?.visible || rateLimitWarning?.visible || cheapestModel?.visible;
  if (!hasAny) return null;

  return (
    <AnimatePresence>
      {taskSuggestion?.visible && (
        <TaskSuggestionBanner key="task" {...taskSuggestion} />
      )}
      {rateLimitWarning?.visible && (
        <RateLimitBanner key="rate" {...rateLimitWarning} />
      )}
      {cheapestModel?.visible && (
        <CheapestModelBanner key="cheap" {...cheapestModel} />
      )}
    </AnimatePresence>
  );
}
