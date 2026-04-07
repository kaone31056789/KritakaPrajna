import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { eventToShortcut, normalizeShortcutString } from "../utils/keyboardShortcuts";

const ease = [0.4, 0, 0.2, 1];

const ACCEPTED_TYPES = ".png,.jpg,.jpeg,.gif,.webp,.txt,.js,.jsx,.ts,.tsx,.py,.json,.md,.css,.html,.xml,.yaml,.yml,.csv,.pdf";

export default function MessageInput({
  onSend,
  onStop,
  onUpload,
  loading,
  disabled,
  commandHints: externalHints,
  onTextChange,
  showReasoningControl = false,
  reasoningDepth = "balanced",
  onReasoningDepthChange,
  responseLength = "medium",
  onResponseLengthChange,
  estimatedTokens = 0,
  lastSentTokens = 0,
  lastReceivedTokens = 0,
  sendShortcut = "Ctrl+Enter",
  webSearchEnabled = true,
  webSearchMode = "fast",
  onWebSearchToggle,
  onWebSearchModeChange,
}) {
  const SLASH_COMMANDS = externalHints || [
    { cmd: "/explain", desc: "Explain a file", arg: "<file>" },
    { cmd: "/fix", desc: "Find & fix bugs", arg: "<file>" },
    { cmd: "/summarize", desc: "Summarize a file", arg: "<file>" },
  ];
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  /* Auto-resize textarea up to ~5 lines */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [text]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSend(text);
    setText("");
  };

  const handleKeyDown = (e) => {
    const shortcut = eventToShortcut(e);
    if (shortcut && shortcut === normalizeShortcutString(sendShortcut)) {
      e.preventDefault();
      handleSubmit(e);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && normalizeShortcutString(sendShortcut) === "Ctrl+Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && onUpload) {
      onUpload(files);
    }
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  // Command hint matching
  const commandHints = useMemo(() => {
    const trimmed = text.trim().toLowerCase();
    if (!trimmed.startsWith("/")) return [];
    // Only show hints while typing the command (before a space after arg)
    const hasSpace = trimmed.indexOf(" ") > 0;
    if (hasSpace) return [];
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(trimmed));
  }, [text, SLASH_COMMANDS]);

  const applyCommand = (cmd) => {
    setText(cmd + " ");
    textareaRef.current?.focus();
  };

  const showWebModeControl = webSearchEnabled && onWebSearchModeChange;
  const showResponseLengthControl = !!onResponseLengthChange;
  const showControlBar = showReasoningControl || showWebModeControl || showResponseLengthControl;

  return (
    <div data-message-composer className="shrink-0 pb-5 pt-2 px-4">
      <div className="max-w-[1400px] mx-auto relative w-full">
        {showControlBar && (
          <div className="mb-2 px-1 flex flex-wrap items-center gap-2 justify-between">
            {showReasoningControl && (
              <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-[11px] text-dark-400"
                title="Controls how deeply the AI thinks before answering"
              >
                Reasoning:
              </span>
              {[
                { id: "fast", label: "Fast" },
                { id: "balanced", label: "Balanced" },
                { id: "deep", label: "Deep" },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  title="Controls how deeply the AI thinks before answering"
                  onClick={() => onReasoningDepthChange?.(option.id)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all cursor-pointer ${
                    reasoningDepth === option.id
                      ? "text-saffron-200 border-saffron-400/35 bg-saffron-500/14 shadow-[0_0_18px_rgba(245,158,11,0.12)]"
                      : "text-dark-400 border-white/[0.08] bg-white/[0.02] hover:text-dark-200 hover:bg-white/[0.04]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
              </div>
            )}

            {showWebModeControl && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease }}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-sky-500/25 bg-dark-900/70 backdrop-blur-md px-2 py-1 shadow-[0_8px_24px_rgba(2,6,23,0.45)]"
                title="Web search mode"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-300/80 px-1">
                  Web
                </span>
                <div className="inline-flex items-center gap-0.5 h-7 rounded-full border border-white/[0.07] bg-white/[0.03] p-0.5">
                  {[
                    { id: "fast", label: "Fast" },
                    { id: "deep", label: "Deep" },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onWebSearchModeChange(mode.id)}
                      className={`h-6 px-2.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer ${
                        webSearchMode === mode.id
                          ? "text-sky-200 bg-sky-500/20 border border-sky-400/30"
                          : "text-dark-400 hover:text-dark-200 hover:bg-white/[0.05] border border-transparent"
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {showResponseLengthControl && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease }}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-amber-500/25 bg-dark-900/70 backdrop-blur-md px-2 py-1 shadow-[0_8px_24px_rgba(2,6,23,0.45)]"
                title="Response length"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/85 px-1">
                  Reply
                </span>
                <div className="inline-flex items-center gap-0.5 h-7 rounded-full border border-white/[0.07] bg-white/[0.03] p-0.5">
                  {[
                    { id: "short", label: "Short", hint: "~128" },
                    { id: "medium", label: "Medium", hint: "~512" },
                    { id: "long", label: "Long", hint: "~1024" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onResponseLengthChange(option.id)}
                      className={`h-6 px-2.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer ${
                        responseLength === option.id
                          ? "text-amber-200 bg-amber-500/20 border border-amber-400/30"
                          : "text-dark-400 hover:text-dark-200 hover:bg-white/[0.05] border border-transparent"
                      }`}
                      title={`${option.label} response (${option.hint} tokens)`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        )}

        {showReasoningControl && reasoningDepth === "deep" && (
          <div className="mb-2 px-1">
            <p className="text-[10px] text-saffron-300/80">
              Deep reasoning may increase cost and response time.
            </p>
          </div>
        )}

        {/* Command hints popover */}
        <AnimatePresence>
          {commandHints.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15, ease }}
              className="absolute bottom-full mb-2 left-3 z-20 bg-dark-800 border border-dark-700/50 rounded-xl shadow-xl shadow-black/30 overflow-hidden min-w-[220px]"
            >
              {commandHints.map((hint) => (
                <button
                  key={hint.cmd}
                  type="button"
                  onClick={() => applyCommand(hint.cmd)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-dark-700/50 transition-colors cursor-pointer"
                >
                  <span className="text-saffron-400 font-mono text-xs font-semibold">{hint.cmd}</span>
                  <span className="text-dark-400 text-[11px] font-mono">{hint.arg}</span>
                  <span className="text-dark-500 text-[11px] ml-auto">{hint.desc}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.form
          onSubmit={handleSubmit}
          animate={{
            boxShadow: focused
              ? "0 0 0 2px rgba(245, 158, 11, 0.25)"
              : "0 0 0 0px rgba(245, 158, 11, 0)",
          }}
          transition={{ duration: 0.2, ease }}
          className="flex items-center gap-2 rounded-full py-1.5 pl-2.5 pr-1.5"
          style={{
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(255, 255, 255, 0.02)",
          }}
        >
          {/* Upload button */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES}
            onChange={handleFileChange}
            className="hidden"
          />
          <motion.button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            whileHover={{ scale: 1.08, backgroundColor: "rgba(255,255,255,0.08)" }}
            whileTap={{ scale: 0.94 }}
            transition={{ duration: 0.15, ease }}
            disabled={disabled}
            className="w-9 h-9 flex items-center justify-center rounded-full text-dark-400 hover:text-dark-200 disabled:opacity-30 cursor-pointer shrink-0 transition-colors"
            aria-label="Upload files"
          >
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </motion.button>

          {/* Web search toggle */}
          {onWebSearchToggle && (
            <motion.button
              type="button"
              onClick={onWebSearchToggle}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.94 }}
              transition={{ duration: 0.15, ease }}
              title={webSearchEnabled ? "Web search: On (click to disable)" : "Web search: Off (click to enable)"}
              className={`flex items-center gap-1 px-2 h-7 rounded-full text-[11px] font-medium cursor-pointer shrink-0 transition-all border ${
                webSearchEnabled
                  ? "text-sky-300 bg-sky-500/10 border-sky-500/25 shadow-[0_0_10px_rgba(14,165,233,0.15)]"
                  : "text-dark-500 bg-transparent border-white/[0.06] hover:text-dark-300"
              }`}
            >
              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
              </svg>
              <span>Web</span>
            </motion.button>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Ask anything..."
            value={text}
            onChange={(e) => { setText(e.target.value); onTextChange?.(e.target.value); }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            className="flex-1 resize-none bg-transparent text-[15px] text-white placeholder-dark-400 focus:outline-none disabled:opacity-50 leading-relaxed py-2.5 px-1 max-h-[140px]"
          />
          {loading ? (
            <motion.button
              type="button"
              onClick={onStop}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.15, ease }}
              className="w-10 h-10 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full cursor-pointer shrink-0"
              aria-label="Stop generating"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </motion.button>
          ) : (
            <motion.button
              type="submit"
              disabled={disabled || !text.trim()}
              whileHover={{ scale: 1.06, backgroundColor: "#fbbf24" }}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.15, ease }}
              className="w-10 h-10 flex items-center justify-center bg-saffron-500 disabled:opacity-25 disabled:hover:bg-saffron-500 text-dark-950 rounded-full cursor-pointer shrink-0"
              aria-label="Send message"
              title={`Send (${sendShortcut})`}
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
              </svg>
            </motion.button>
          )}
        </motion.form>

        <div className="mt-1.5 px-1 flex items-center justify-between text-[10px]">
          <span className={estimatedTokens > 3000 ? "text-amber-300" : "text-dark-500"}>
            Est. input: ~{Math.max(0, Math.round(Number(estimatedTokens) || 0))} tokens
          </span>
          <span className="text-dark-500">
            Last: {Math.max(0, Math.round(Number(lastSentTokens) || 0))} in / {Math.max(0, Math.round(Number(lastReceivedTokens) || 0))} out
          </span>
        </div>
      </div>
    </div>
  );
}
