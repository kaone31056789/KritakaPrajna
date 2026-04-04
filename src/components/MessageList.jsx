import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatCost } from "../utils/costTracker";
import { extractAllCodeBlocks } from "../utils/diffEngine";
import { safeCopyText } from "../utils/clipboard";
import DiffViewer from "./DiffViewer";
import MarkdownRenderer from "./MarkdownRenderer";

const ease = [0.4, 0, 0.2, 1];
const msgVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease } },
};

/** Split <think>…</think> from the rest of the message */
function parseThinking(content) {
  if (typeof content !== "string") return { thinking: null, isThinking: false, rest: content };
  const openIdx = content.indexOf("<think>");
  if (openIdx === -1) return { thinking: null, isThinking: false, rest: content };
  const closeIdx = content.indexOf("</think>", openIdx);
  if (closeIdx === -1) {
    // Still streaming the thinking block
    return { thinking: content.slice(openIdx + 7), isThinking: true, rest: content.slice(0, openIdx) };
  }
  return {
    thinking: content.slice(openIdx + 7, closeIdx),
    isThinking: false,
    rest: (content.slice(0, openIdx) + content.slice(closeIdx + 8)).trimStart(),
  };
}

function ThinkingBlock({ content, isThinking }) {
  const [expanded, setExpanded] = useState(isThinking);

  // Auto-collapse when thinking finishes
  useEffect(() => {
    if (!isThinking) setExpanded(false);
  }, [isThinking]);

  return (
    <div className="mb-3 rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
      >
        {isThinking ? (
          <span className="inline-flex gap-0.5 text-saffron-400/70">
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, ease, delay: 0 }}>●</motion.span>
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, ease, delay: 0.2 }}>●</motion.span>
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, ease, delay: 0.4 }}>●</motion.span>
          </span>
        ) : (
          <svg className="w-3.5 h-3.5 text-dark-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        )}
        <span className="text-[11px] text-dark-400 font-medium">
          {isThinking ? "Thinking…" : "Thought"}
        </span>
        {!isThinking && (
          <svg
            className={`w-3 h-3 text-dark-500 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="thinking-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 text-[12px] text-dark-400 leading-relaxed border-t border-white/[0.04] pt-2 italic">
              <MarkdownRenderer content={content} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MandalaLogo() {
  return (
    <svg className="w-16 h-16 text-saffron-500" viewBox="0 0 100 100" fill="none">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <ellipse key={a} cx="50" cy="26" rx="6" ry="16" fill="currentColor" opacity="0.5" transform={`rotate(${a} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="14" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <circle cx="50" cy="50" r="4" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function AiIcon() {
  return (
    <div className="w-6 h-6 rounded-full bg-kp-indigo-700 flex items-center justify-center shrink-0 mt-0.5">
      <svg className="w-3 h-3 text-saffron-400" viewBox="0 0 100 100" fill="none">
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <ellipse key={a} cx="50" cy="28" rx="5" ry="14" fill="currentColor" opacity="0.7" transform={`rotate(${a} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="6" fill="currentColor" opacity="0.9" />
      </svg>
    </div>
  );
}

function usageTokenCount(usage) {
  if (!usage) return 0;
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  const image = Number(usage.image_tokens) || Number(usage?.completion_tokens_details?.image_tokens) || 0;
  if (completion === 0 && image > 0) return prompt + image;
  return prompt + completion;
}

function costLabel(message) {
  const cost = Number(message?.cost);
  if (message?.isFree && (!Number.isFinite(cost) || cost === 0)) return "Free";
  if (Number.isFinite(cost)) return `Cost: ${formatCost(cost)}`;
  return "Cost: --";
}

/** Render message content — handles both plain strings and multimodal arrays */
function MessageContent({ content, isAssistant = false }) {
  if (typeof content === "string") {
    if (isAssistant) {
      const { thinking, isThinking, rest } = parseThinking(content);
      return (
        <>
          {thinking != null && <ThinkingBlock content={thinking} isThinking={isThinking} />}
          {rest && <MarkdownRenderer content={rest} />}
        </>
      );
    }
    return content;
  }
  if (!Array.isArray(content)) return String(content || "");

  return content.map((part, idx) => {
    if (part.type === "text") {
      if (isAssistant) {
        const { thinking, isThinking, rest } = parseThinking(part.text);
        return (
          <React.Fragment key={idx}>
            {thinking != null && <ThinkingBlock content={thinking} isThinking={isThinking} />}
            {rest && <MarkdownRenderer content={rest} />}
          </React.Fragment>
        );
      }
      return <span key={idx}>{part.text}</span>;
    }
    if (part.type === "image_url" && part.image_url?.url) {
      return (
        <img
          key={idx}
          src={part.image_url.url}
          alt="uploaded"
          className="max-w-[240px] max-h-[180px] rounded-lg object-contain my-1"
        />
      );
    }
    return null;
  });
}

export default function MessageList({ messages, loading, onRefine, onRetry, onRegenerate, lastError }) {
  const bottomRef = useRef(null);
  const copyResetTimerRef = useRef(null);
  const [dismissedDiffs, setDismissedDiffs] = useState(new Set());
  const [showDiff, setShowDiff] = useState(new Set());
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null);

  const handleAcceptDiff = useCallback(async (code, filePath) => {
    if (filePath && window.electronAPI?.writeFile) {
      const result = await window.electronAPI.writeFile(filePath, code);
      if (!result.success) {
        // Fallback to clipboard
        await safeCopyText(code);
      }
    } else {
      await safeCopyText(code);
    }
  }, []);

  const handleRejectDiff = useCallback((msgIdx) => {
    setDismissedDiffs((prev) => new Set(prev).add(msgIdx));
    setShowDiff((prev) => { const n = new Set(prev); n.delete(msgIdx); return n; });
  }, []);

  const toggleDiff = useCallback((msgIdx) => {
    setShowDiff((prev) => {
      const n = new Set(prev);
      n.has(msgIdx) ? n.delete(msgIdx) : n.add(msgIdx);
      return n;
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const handleCopyMessage = useCallback(async (msgIdx, text) => {
    const ok = await safeCopyText(text);
    if (!ok) return;

    setCopiedMsgIdx(msgIdx);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = setTimeout(() => {
      setCopiedMsgIdx(null);
      copyResetTimerRef.current = null;
    }, 1400);
  }, []);

  /* ── Empty / Welcome State ── */
  if (messages.length === 0 && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="flex flex-col items-center gap-5 max-w-sm text-center px-6"
        >
          {/* Glow backdrop */}
          <div className="relative">
            <div className="absolute inset-0 w-16 h-16 mx-auto rounded-full bg-saffron-500/10 blur-2xl" />
            <MandalaLogo />
          </div>

          <div>
            <h1 className="font-serif text-3xl font-semibold text-white tracking-wide">
              KritakaPrajna
            </h1>
            <p className="mt-1.5 text-sm text-saffron-400/70 tracking-widest uppercase">
              Artificial Intelligence, Refined
            </p>
          </div>

          <p className="text-sm text-dark-300 leading-relaxed">
            Select a model and start chatting
          </p>

          {/* Decorative dots */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-1 h-1 rounded-full bg-saffron-500/30" />
            <span className="w-1.5 h-1.5 rounded-full bg-saffron-500/50" />
            <span className="w-1 h-1 rounded-full bg-saffron-500/30" />
          </div>
        </motion.div>
      </div>
    );
  }

  /* ── Messages ── */
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
        {messages.map((msg, i) => {
          const isUser = msg.role === "user";
          const isStreaming = loading && !isUser && i === messages.length - 1;
          return (
            <motion.div
              key={i}
              variants={msgVariants}
              initial="hidden"
              animate="visible"
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              {isUser ? (
                <div className="flex flex-col items-end gap-1.5 max-w-[80%]">
                  {/* Attachment chips */}
                  {msg._attachments?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {msg._attachments.map((a, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 text-[11px] bg-saffron-700/60 text-saffron-100 rounded-lg px-2 py-1"
                        >
                          {a.type === "image" ? (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path strokeLinecap="round" d="M21 15l-5-5L5 21" />
                            </svg>
                          ) : a.type === "pdf" ? (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                          )}
                          {a.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Message text */}
                  {(msg._displayText || typeof msg.content === "string") && (
                    <div className="bg-saffron-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 min-w-[56px] text-sm leading-relaxed whitespace-pre-wrap break-words shadow-lg shadow-saffron-900/20">
                      <MessageContent content={msg._displayText ?? msg.content} />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-start gap-1 max-w-[85%]">
                  <div className="flex items-start gap-2.5">
                    <AiIcon />
                    <div
                      className="bg-dark-800/70 text-dark-100 border border-dark-700/30 rounded-2xl rounded-tl-sm px-4 py-2.5 min-w-[56px] text-sm leading-relaxed break-words markdown-body"
                    >
                      {msg._imageUrl ? (
                        <img
                          src={msg._imageUrl}
                          alt="Generated image"
                          className="max-w-full rounded-xl object-contain"
                          style={{ maxHeight: 480 }}
                        />
                      ) : (typeof msg.content === "string" ? msg.content : msg.content?.length) ? (
                        <MessageContent content={msg.content} isAssistant />
                      ) : (
                        <span className="inline-flex gap-1 text-saffron-400/60">
                          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, ease }}>●</motion.span>
                          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, ease, delay: 0.2 }}>●</motion.span>
                          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, ease, delay: 0.4 }}>●</motion.span>
                        </span>
                      )}
                      {isStreaming && msg.content && (
                        <motion.span
                          animate={{ opacity: [1, 0] }}
                          transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
                          className="inline-block w-0.5 h-4 bg-saffron-400 ml-0.5 align-text-bottom"
                        />
                      )}
                    </div>
                  </div>
                  {/* Per-message cost */}
                  {!isStreaming && (msg.content || msg._imageUrl) && (msg.cost > 0 || msg.isFree || msg.usage) && (
                    <span className="text-[11px] text-dark-400 select-none" style={{ marginLeft: '34px' }}>
                      {costLabel(msg)}
                      {msg.usage && usageTokenCount(msg.usage) > 0 && (
                        <span className="ml-2 text-dark-400/70">
                          · {usageTokenCount(msg.usage)} tokens
                        </span>
                      )}
                    </span>
                  )}
                  {/* Action buttons: Copy + Refine + Regenerate + Retry */}
                  {!isStreaming && msg.content && (
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap" style={{ marginLeft: '34px' }}>
                      <button
                        onClick={async () => {
                          const text = typeof msg.content === "string" ? msg.content : "";
                          await handleCopyMessage(i, text);
                        }}
                        className={`flex items-center gap-1 text-[10px] cursor-pointer px-1.5 py-1 rounded-md transition-colors ${
                          copiedMsgIdx === i
                            ? "text-emerald-400 bg-emerald-500/[0.08]"
                            : "text-dark-500 hover:text-dark-300 hover:bg-white/[0.04]"
                        }`}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {copiedMsgIdx === i ? (
                            <motion.span
                              key="copied"
                              initial={{ opacity: 0, scale: 0.85 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.85 }}
                              transition={{ duration: 0.16, ease }}
                              className="flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Copied
                            </motion.span>
                          ) : (
                            <motion.span
                              key="copy"
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.9 }}
                              transition={{ duration: 0.14, ease }}
                              className="flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <rect x="9" y="9" width="13" height="13" rx="2" />
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                              </svg>
                              Copy
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </button>
                      <button
                        onClick={() => onRefine?.(i)}
                        disabled={loading}
                        className="flex items-center gap-1 text-[10px] text-dark-500 hover:text-saffron-400 disabled:opacity-30 cursor-pointer px-1.5 py-1 rounded-md hover:bg-saffron-500/[0.06] transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Refine
                      </button>
                      {/* Regenerate — re-send same prompt with same model */}
                      {i === messages.length - 1 && (
                        <button
                          onClick={() => onRegenerate?.("same")}
                          disabled={loading}
                          className="flex items-center gap-1 text-[10px] text-dark-500 hover:text-emerald-400 disabled:opacity-30 cursor-pointer px-1.5 py-1 rounded-md hover:bg-emerald-500/[0.06] transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Regenerate
                        </button>
                      )}
                      {/* Retry with better model */}
                      {i === messages.length - 1 && (
                        <button
                          onClick={() => onRegenerate?.("better")}
                          disabled={loading}
                          className="flex items-center gap-1 text-[10px] text-dark-500 hover:text-purple-400 disabled:opacity-30 cursor-pointer px-1.5 py-1 rounded-md hover:bg-purple-500/[0.06] transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          Retry Better Model
                        </button>
                      )}
                    </div>
                  )}
                  {/* Error with retry buttons */}
                  {!isStreaming && msg._error && (
                    <div className="mt-1.5" style={{ marginLeft: '34px' }}>
                      <div className="flex items-center gap-2 text-xs text-red-400 mb-2">
                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <span>{msg._error}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onRetry?.("same")}
                          disabled={loading}
                          className="flex items-center gap-1.5 text-[11px] font-medium text-saffron-300 bg-saffron-500/10 hover:bg-saffron-500/20 border border-saffron-500/20 rounded-lg px-3 py-1.5 cursor-pointer disabled:opacity-30 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Retry Same Model
                        </button>
                        <button
                          onClick={() => onRetry?.("better")}
                          disabled={loading}
                          className="flex items-center gap-1.5 text-[11px] font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg px-3 py-1.5 cursor-pointer disabled:opacity-30 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          Retry Better Model
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Diff viewer for /fix and code-containing responses */}
                  {!isStreaming && msg._originalFile && msg.content && (() => {
                    const blocks = extractAllCodeBlocks(typeof msg.content === "string" ? msg.content : "");
                    const bestBlock = blocks.length > 0 ? blocks.reduce((a, b) => a.code.length > b.code.length ? a : b) : null;
                    if (!bestBlock || dismissedDiffs.has(i)) return null;
                    const isDiffOpen = showDiff.has(i);
                    return (
                      <div style={{ marginLeft: '34px', marginTop: '4px' }} className="w-full">
                        <button
                          onClick={() => toggleDiff(i)}
                          className="flex items-center gap-1.5 text-[11px] text-saffron-400 hover:text-saffron-300 cursor-pointer mb-1 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          {isDiffOpen ? "Hide Diff" : "View Diff"}
                        </button>
                        <AnimatePresence>
                          {isDiffOpen && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2, ease }}
                              className="overflow-hidden"
                            >
                              <DiffViewer
                                original={msg._originalFile.content}
                                modified={bestBlock.code}
                                fileName={msg._originalFile.name}
                                filePath={msg._originalFile.path}
                                onAccept={(code, path) => handleAcceptDiff(code, path)}
                                onReject={() => handleRejectDiff(i)}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })()}
                </div>
              )}
            </motion.div>
          );
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
