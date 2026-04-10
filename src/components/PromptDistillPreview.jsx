import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { estimateTokensFromText } from "../utils/tokenOptimizer";

const ease = [0.4, 0, 0.2, 1];
const DISTILL_MIN_CHARS = 100; // Only distill prompts longer than this
const DEBOUNCE_MS = 800;

const DISTILL_SYSTEM_PROMPT =
  "Rewrite the following user request in the most concise form possible. " +
  "Preserve ALL requirements, constraints, specifics, code snippets, and technical details. " +
  "Remove filler words, pleasantries, redundant phrasing, and excessive explanation. " +
  "Return ONLY the rewritten request with no additional commentary.";

/**
 * PromptDistillPreview — Shows a "before vs after" prompt optimization preview.
 * Appears above the input when the user types a long prompt.
 *
 * Props:
 * - inputText: current draft text
 * - routeChat: function to route a non-streaming chat completion
 * - cheapModel: the model to use for distillation
 * - providers: provider keys
 * - onUseDistilled: callback(distilledText) when user clicks "Use Improved"
 * - enabled: feature toggle
 */
export default function PromptDistillPreview({
  inputText = "",
  routeChat,
  cheapModel,
  providers,
  onUseDistilled,
  enabled = false,
}) {
  const [distilled, setDistilled] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const lastTextRef = useRef("");

  // Reset when input changes significantly
  useEffect(() => {
    if (!enabled) return;
    const text = String(inputText || "").trim();

    // If text changed, reset dismissed state
    if (text !== lastTextRef.current) {
      lastTextRef.current = text;
      if (text.length < DISTILL_MIN_CHARS) {
        setDistilled(null);
        setLoading(false);
        return;
      }

      setDismissed(false);
      setDistilled(null);

      // Debounce the distillation request
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        runDistillation(text);
      }, DEBOUNCE_MS);
    }

    return () => clearTimeout(debounceRef.current);
  }, [inputText, enabled]); // eslint-disable-line

  async function runDistillation(text) {
    if (!routeChat || !cheapModel || !providers) return;

    // Abort previous
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const messages = [
        { role: "system", content: DISTILL_SYSTEM_PROMPT },
        { role: "user", content: text },
      ];

      const originalTokens = estimateTokensFromText(text);

      const result = await routeChat(providers, cheapModel, messages, {
        maxTokens: Math.min(originalTokens, 1024),
        temperature: 0.3,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      const distilledText = String(result?.text || "").trim();
      if (!distilledText || distilledText.length >= text.length * 0.9) {
        // Not worth it
        setDistilled(null);
        setLoading(false);
        return;
      }

      const distilledTokens = estimateTokensFromText(distilledText);
      const saved = originalTokens - distilledTokens;
      const percent = Math.round((saved / originalTokens) * 100);

      if (percent < 10) {
        setDistilled(null);
        setLoading(false);
        return;
      }

      setDistilled({
        original: text,
        improved: distilledText,
        originalTokens,
        improvedTokens: distilledTokens,
        savedTokens: saved,
        savedPercent: percent,
      });
    } catch {
      // Silently fail
      setDistilled(null);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }

  if (!enabled || dismissed || (!distilled && !loading)) return null;
  if (String(inputText || "").trim().length < DISTILL_MIN_CHARS) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8, height: 0 }}
        animate={{ opacity: 1, y: 0, height: "auto" }}
        exit={{ opacity: 0, y: 8, height: 0 }}
        transition={{ duration: 0.2, ease }}
        className="mx-4 mb-2 overflow-hidden"
      >
        <div className="rounded-md border border-purple-500/20 bg-[#0d0d0d]/90 backdrop-blur-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.04]">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-purple-300 font-semibold uppercase tracking-wider font-mono">
                🧪 Prompt Optimizer
              </span>
              {loading && (
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-purple-400"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="text-[#666] hover:text-[#999] transition-colors cursor-pointer text-xs"
              title="Dismiss"
            >
              ✕
            </button>
          </div>

          {loading && !distilled && (
            <div className="px-3 py-3 text-[11px] text-[#999] font-mono flex items-center gap-2">
              <motion.div
                className="w-3 h-3 rounded-full border-2 border-purple-400/30 border-t-purple-400"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
              />
              Analyzing prompt for optimization...
            </div>
          )}

          {distilled && (
            <div className="px-3 py-2 space-y-2">
              {/* Stats bar */}
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span className="text-[#999]">
                  Original: <span className="text-[#ccc]">{distilled.originalTokens}</span> tokens
                </span>
                <span className="text-purple-300">→</span>
                <span className="text-[#999]">
                  Improved: <span className="text-emerald-300">{distilled.improvedTokens}</span> tokens
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/15 text-[9px] font-semibold">
                  −{distilled.savedPercent}% ({distilled.savedTokens} tokens saved)
                </span>
              </div>

              {/* Before / After */}
              <div className="grid grid-cols-2 gap-2">
                {/* Original */}
                <div className="rounded border border-white/[0.04] bg-[#111]/50 p-2">
                  <span className="block text-[8px] text-[#666] uppercase tracking-wider font-mono mb-1">
                    Original
                  </span>
                  <p className="text-[10px] text-[#999] leading-relaxed font-mono whitespace-pre-wrap break-words" style={{ maxHeight: "80px", overflow: "auto" }}>
                    {distilled.original.length > 300
                      ? distilled.original.slice(0, 300) + "..."
                      : distilled.original}
                  </p>
                </div>

                {/* Improved */}
                <div className="rounded border border-emerald-500/10 bg-emerald-500/[0.02] p-2">
                  <span className="block text-[8px] text-emerald-400/60 uppercase tracking-wider font-mono mb-1">
                    Improved
                  </span>
                  <p className="text-[10px] text-[#ccc] leading-relaxed font-mono whitespace-pre-wrap break-words" style={{ maxHeight: "80px", overflow: "auto" }}>
                    {distilled.improved.length > 300
                      ? distilled.improved.slice(0, 300) + "..."
                      : distilled.improved}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setDismissed(true)}
                  className="px-2.5 py-1 rounded text-[10px] text-[#999] hover:text-[#ccc] border border-white/[0.06] hover:border-white/[0.1] transition-colors cursor-pointer font-mono"
                >
                  Keep Original
                </button>
                <motion.button
                  onClick={() => {
                    onUseDistilled?.(distilled.improved);
                    setDismissed(true);
                  }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="px-3 py-1 rounded text-[10px] font-semibold cursor-pointer font-mono transition-colors"
                  style={{
                    backgroundColor: "rgba(52, 211, 153, 0.15)",
                    color: "#34d399",
                    border: "1px solid rgba(52, 211, 153, 0.25)",
                  }}
                >
                  Use Improved (−{distilled.savedPercent}%)
                </motion.button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
