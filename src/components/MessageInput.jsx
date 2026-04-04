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
  sendShortcut = "Ctrl+Enter",
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

  return (
    <div data-message-composer className="shrink-0 pb-5 pt-2 px-4">
      <div className="max-w-3xl mx-auto relative">
        {showReasoningControl && (
          <div className="mb-2 px-1">
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
            {reasoningDepth === "deep" && (
              <p className="mt-1.5 text-[10px] text-saffron-300/80">
                Deep reasoning may increase cost and response time.
              </p>
            )}
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
      </div>
    </div>
  );
}
