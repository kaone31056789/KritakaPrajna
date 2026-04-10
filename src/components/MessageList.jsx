import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatCost } from "../utils/costTracker";
import { extractAllCodeBlocks } from "../utils/diffEngine";
import { safeCopyText } from "../utils/clipboard";
import DiffViewer from "./DiffViewer";
import MarkdownRenderer from "./MarkdownRenderer";
import WebResultCard from "./WebResultCard";

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
    <div className="mb-3 rounded-sm border border-[#1a1a1a] bg-[#111111] overflow-hidden shadow-inner-shadow">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
      >
        {isThinking ? (
          <span className="inline-flex gap-0.5 text-[#00ff41]/70">
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, ease, delay: 0 }}>●</motion.span>
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, ease, delay: 0.2 }}>●</motion.span>
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, ease, delay: 0.4 }}>●</motion.span>
          </span>
        ) : (
          <svg className="w-3.5 h-3.5 text-[#b0b0b0]/50" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        )}
        <span className="text-[11px] text-[#b0b0b0]/50 font-medium font-mono">
          {isThinking ? "Thinking…" : "Thought"}
        </span>
        {!isThinking && (
          <svg
            className={`w-3 h-3 text-[#b0b0b0]/30 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
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
            <div className="px-3 pb-3 text-[12px] text-[#b0b0b0]/50 leading-relaxed border-t border-[#1a1a1a] pt-2 italic font-mono">
              <MarkdownRenderer content={content} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TerminalLogo() {
  return (
    <div className="w-16 h-16 flex items-center justify-center rounded-sm border border-[#1a1a1a] bg-[#111111]">
      <span className="text-[#00ff41] text-3xl font-mono font-bold text-glow-green">&gt;_</span>
    </div>
  );
}

function AiIcon() {
  return (
    <div className="w-6 h-6 rounded-sm bg-[#111111] border border-[#00ff41]/20 flex items-center justify-center shrink-0 mt-0.5 shadow-elevation-1">
      <span className="text-[#00ff41] text-[11px] font-mono font-bold">&gt;</span>
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

function buildSourceUrlMapFromResults(results = []) {
  const map = {};
  if (!Array.isArray(results)) return map;
  results.forEach((src, idx) => {
    if (!src || !src.url) return;
    const index = Number(src.index) > 0 ? Number(src.index) : idx + 1;
    map[String(index)] = src.url;
  });
  return map;
}

function findNearestSourceUrlMap(messages, assistantMsgIndex) {
  for (let i = assistantMsgIndex - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate?.role !== "user") continue;
    if (Array.isArray(candidate?._webResults) && candidate._webResults.length > 0) {
      return buildSourceUrlMapFromResults(candidate._webResults);
    }
  }
  return {};
}

/** Render message content — handles both plain strings and multimodal arrays */
function MessageContent({ content, isAssistant = false, onPointClick, sourceUrlMap = null }) {
  if (typeof content === "string") {
    if (isAssistant) {
      const { thinking, isThinking, rest } = parseThinking(content);
      return (
        <>
          {thinking != null && <ThinkingBlock content={thinking} isThinking={isThinking} />}
          {rest && <MarkdownRenderer content={rest} onPointClick={onPointClick} sourceUrlMap={sourceUrlMap} />}
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
            {rest && <MarkdownRenderer content={rest} onPointClick={onPointClick} sourceUrlMap={sourceUrlMap} />}
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
          className="max-w-[240px] max-h-[180px] rounded-sm object-contain my-1"
        />
      );
    }
    return null;
  });
}

export default function MessageList({ messages, loading, onRefine, onRetry, onRegenerate, onPointDeepDive, lastError, onEditMessage, onBranchFromMessage, onToggleBookmark, onResolveComparison }) {
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
    const starters = [
      { icon: "💡", label: "Explain", prompt: "Explain how ", color: "text-amber-300", border: "border-amber-500/15", bg: "hover:bg-amber-500/[0.04]" },
      { icon: "💻", label: "Write Code", prompt: "Write a ", color: "text-emerald-300", border: "border-emerald-500/15", bg: "hover:bg-emerald-500/[0.04]" },
      { icon: "📊", label: "Analyze", prompt: "Analyze this: ", color: "text-sky-300", border: "border-sky-500/15", bg: "hover:bg-sky-500/[0.04]" },
      { icon: "✨", label: "Creative", prompt: "Write a creative ", color: "text-purple-300", border: "border-purple-500/15", bg: "hover:bg-purple-500/[0.04]" },
    ];
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="flex flex-col items-center gap-6 max-w-lg text-center px-6"
        >
          {/* Terminal prompt icon */}
          <div className="relative">
            <div className="absolute inset-0 w-16 h-16 mx-auto rounded-sm bg-[#00ff41]/5 blur-2xl" />
            <TerminalLogo />
          </div>

          <div>
            <h1 className="font-mono text-3xl font-bold text-[#00ff41] tracking-wide text-glow-green">
              KritakaPrajna
            </h1>
            <p className="mt-1.5 text-sm text-[#00ff41]/50 tracking-widest uppercase font-mono">
              SYSTEM INITIALIZED
            </p>
          </div>

          <p className="text-sm text-[#b0b0b0] leading-relaxed font-mono">
            Select a model and start chatting — or pick a starter below
          </p>

          {/* Conversation Starters */}
          <div className="grid grid-cols-2 gap-2 w-full">
            {starters.map((s) => (
              <motion.button
                key={s.label}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.12, ease }}
                onClick={() => {
                  const textarea = document.querySelector('[data-message-composer] textarea');
                  if (textarea) {
                    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                    setter.call(textarea, s.prompt);
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    setTimeout(() => { textarea.focus(); textarea.setSelectionRange(s.prompt.length, s.prompt.length); }, 50);
                  }
                }}
                className={`flex items-center gap-2.5 px-3.5 py-3 rounded-sm border ${s.border} ${s.bg} bg-[#111]/30 text-left cursor-pointer transition-all group`}
              >
                <span className="text-lg">{s.icon}</span>
                <div className="min-w-0">
                  <span className={`text-sm font-medium ${s.color} font-mono`}>{s.label}</span>
                  <p className="text-[10px] text-[#b0b0b0]/30 font-mono truncate group-hover:text-[#b0b0b0]/50 transition-colors">{s.prompt}…</p>
                </div>
              </motion.button>
            ))}
          </div>

          {/* Terminal cursor */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="terminal-cursor" />
          </div>
        </motion.div>
      </div>
    );
  }

  /* ── Messages ── */
  return (
    <div className="flex-1 overflow-y-auto relative">
      {messages?.some(m => m.bookmarked) && (
        <div className="sticky top-2 z-20 flex justify-center mb-[-2rem] pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-1.5 p-1 bg-[#111111]/90 backdrop-blur-md border border-amber-500/30 rounded-full shadow-lg">
            <span className="pl-2 pr-1 text-[10px] uppercase font-bold tracking-wider text-amber-500/80">Bookmarks:</span>
            {messages.map((m, i) => m.bookmarked ? (
              <button
                key={i}
                onClick={() => document.getElementById(`msg-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="w-5 h-5 flex items-center justify-center rounded-full bg-amber-500/20 text-amber-400 hover:bg-amber-500/50 hover:text-white transition-colors cursor-pointer border border-amber-500/30"
                title={`Jump to message ${i + 1}`}
              >
                <span className="text-[10px] font-bold">{i + 1}</span>
              </button>
            ) : null)}
          </div>
        </div>
      )}
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5 w-full pt-8">
        {messages.map((msg, i) => {
          if (msg._hidden) return null;

          if (msg.role === "comparison") {
              return (
                 <div key={i} className="flex flex-col gap-3 my-4 w-full" id={`msg-${i}`}>
                     <div className="flex items-center justify-between text-[#b0b0b0] text-[10px] uppercase tracking-wider font-mono px-1">
                         <span className="text-indigo-400 font-bold flex items-center gap-2">
                             <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                             Parallel Comparison Mode actively testing {msg.models.length} models
                         </span>
                         <span>Prompt: {msg.originalText && msg.originalText.length > 50 ? msg.originalText.slice(0, 50) + "..." : msg.originalText}</span>
                     </div>
                     <div className="flex flex-col md:flex-row gap-3 w-full">
                        {msg.models.map((m, mIdx) => (
                           <div key={mIdx} className={`flex-1 min-w-0 bg-[#0a0a0a] border ${m.status === 'streaming' ? 'border-indigo-500/50 shadow-glow-indigo' : 'border-[#1a1a1a]'} rounded shadow-elevation-2 flex flex-col relative`}>
                               <div className="flex border-b border-[#1a1a1a] items-center justify-between px-3 py-2 bg-[#111]">
                                   <div className="flex flex-col">
                                       <span className="text-xs font-bold text-[#e0e0e0] flex items-center gap-2">
                                           {m.status === 'streaming' && <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />}
                                           {m.id}
                                       </span>
                                       {m.status === 'done' && (
                                           <span className="text-[9px] text-[#b0b0b0]/60 font-mono mt-0.5">
                                               {m.cost > 0 ? `Cost: ${m.cost.toFixed(4)}` : "Free"} 
                                               {m.usage && ` • ${m.usage.completion_tokens || 0} tokens`}
                                           </span>
                                       )}
                                   </div>
                               </div>
                               <div className="p-4 text-sm text-[#e0e0e0] overflow-y-auto leading-relaxed markdown-body max-h-[60vh]">
                                   <MessageContent content={m.content || "Waiting..."} />
                               </div>
                               <div className="mt-auto p-3 border-t border-[#1a1a1a] bg-[#111]">
                                   <button 
                                      disabled={m.status === 'streaming'}
                                      onClick={() => onResolveComparison?.(i, mIdx)}
                                      className="w-full py-2 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 font-bold text-[11px] uppercase tracking-wider rounded transition-colors hover:bg-indigo-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                   >
                                      {m.status === 'streaming' ? 'Streaming...' : 'Keep This Response'}
                                   </button>
                               </div>
                           </div>
                        ))}
                     </div>
                 </div>
              );
          }

          const isUser = msg.role === "user";
          const isStreaming = loading && !isUser && i === messages.length - 1;
          const isDeepAnalysis = !isUser && !!msg._deepAnalysis;
          const sourceUrlMap = isUser ? null : findNearestSourceUrlMap(messages, i);
          return (
            <motion.div
              key={i}
              id={`msg-${i}`}
              variants={msgVariants}
              initial="hidden"
              animate="visible"
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              {isUser ? (
                <div className="flex flex-col items-end gap-1.5 max-w-[92%] lg:max-w-[95%]">
                  {/* Attachment chips */}
                  {msg._attachments?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {msg._attachments.map((a, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 text-[11px] bg-[#1a1a1a] text-[#00ff41] border border-[#00ff41]/20 rounded-sm px-2 py-1 font-mono"
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
                  {/* Web result card — single card for all sources */}
                  {msg._webResults?.length > 0 && (
                    <WebResultCard results={msg._webResults} />
                  )}
                  {msg._webSearchAttempted && (!msg._webResults || msg._webResults.length === 0) && (
                    <div className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-sm border border-[#00d4ff]/20 bg-[#00d4ff]/[0.08] text-[#00d4ff]/80 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff]/80" />
                      Web searched, but no reliable live sources were found.
                    </div>
                  )}
                  {/* Message text */}
                  {(msg._displayText || typeof msg.content === "string") && (
                    <div className="group/usermsg relative">
                      <div className="bg-[#1a1a1a] text-[#e0e0e0] border border-[#2a2a2a] rounded-sm px-4 py-2.5 min-w-[56px] text-sm leading-relaxed whitespace-pre-wrap break-words shadow-elevation-2 inner-highlight font-mono">
                        <span className="text-[#00ff41] text-[10px] font-bold mr-2">user@kp ~$</span>
                        <MessageContent content={msg._displayText ?? msg.content} />
                      </div>
                      {/* User message hover actions */}
                      <div className="absolute -bottom-6 right-0 hidden group-hover/usermsg:flex items-center gap-0.5 bg-[#111] border border-[#1a1a1a] rounded-sm px-1 py-0.5 shadow-elevation-3 z-10">
                        <button
                          onClick={async () => {
                            const text = typeof (msg._displayText ?? msg.content) === "string" ? (msg._displayText ?? msg.content) : "";
                            await handleCopyMessage(i, text);
                          }}
                          className="flex items-center gap-1 text-[10px] text-[#b0b0b0]/60 hover:text-[#e0e0e0] cursor-pointer px-1.5 py-1 rounded-sm hover:bg-[#1a1a1a] transition-colors font-mono"
                          title="Copy message"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                          </svg>
                          {copiedMsgIdx === i ? "Copied" : "Copy"}
                        </button>
                        {onToggleBookmark && (
                          <button
                            onClick={() => onToggleBookmark(i)}
                            className={`flex items-center gap-1 text-[10px] cursor-pointer px-1.5 py-1 rounded-sm transition-colors font-mono ${
                              msg.bookmarked 
                                ? "text-amber-400 bg-amber-400/[0.15] hover:bg-amber-400/20" 
                                : "text-[#b0b0b0]/60 hover:text-amber-400 hover:bg-amber-400/[0.08]"
                            }`}
                            title={msg.bookmarked ? "Remove Bookmark" : "Bookmark message"}
                          >
                            <svg className="w-3 h-3" fill={msg.bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={msg.bookmarked ? "1" : "2"} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                            </svg>
                            {msg.bookmarked ? "Bookmarked" : "Bookmark"}
                          </button>
                        )}
                        {onEditMessage && (
                          <button
                            onClick={() => onEditMessage(i)}
                            disabled={loading}
                            className="flex items-center gap-1 text-[10px] text-[#b0b0b0]/60 hover:text-[#00ff41] disabled:opacity-30 cursor-pointer px-1.5 py-1 rounded-sm hover:bg-[#00ff41]/[0.06] transition-colors font-mono"
                            title="Edit & resend this message"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                              <path strokeLinecap="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                            Edit
                          </button>
                        )}
                        {onBranchFromMessage && (
                          <button
                            onClick={() => onBranchFromMessage(i)}
                            disabled={loading}
                            className="flex items-center gap-1 text-[10px] text-[#b0b0b0]/60 hover:text-purple-300 disabled:opacity-30 cursor-pointer px-1.5 py-1 rounded-sm hover:bg-purple-500/[0.06] transition-colors font-mono"
                            title="Branch conversation from here"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                            </svg>
                            Branch
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-start gap-1 max-w-[94%] lg:max-w-[96%]">
                  <div className="flex items-start gap-2.5">
                    <AiIcon />
                    <div
                      className={`text-[#e0e0e0] rounded-sm px-4 py-2.5 min-w-[56px] text-sm leading-relaxed break-words markdown-body border font-mono ${
                        isDeepAnalysis
                          ? "bg-[#111111] border-[#00d4ff]/20 shadow-[0_8px_24px_rgba(0,0,0,0.35),0_0_12px_rgba(0,212,255,0.05)]"
                          : "bg-[#111111] border-[#1a1a1a] shadow-elevation-2 inner-highlight"
                      }`}
                    >
                      {isDeepAnalysis && (
                        <div className="mb-2 flex items-center gap-2 text-[10px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-300/90" />
                          <span className="font-medium tracking-wide uppercase text-[#00d4ff]/90 font-mono">Deep Analysis</span>
                          <span className="h-px flex-1 bg-[#00d4ff]/20" />
                        </div>
                      )}
                      {/* Auto-retry indicator */}
                      {msg._retrying && (
                        <div className="flex items-center gap-2 text-[11px] text-amber-400/80 font-mono">
                          <motion.svg
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-3.5 h-3.5 shrink-0"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </motion.svg>
                          <span>Auto-retrying ({msg._retrying.attempt}/{msg._retrying.maxAutoRetries})…</span>
                        </div>
                      )}
                      {/* Partial response indicator */}
                      {msg._partial && msg.content && !msg._retrying && (
                        <div className="mb-2 flex items-center gap-2 text-[10px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />
                          <span className="font-medium tracking-wide uppercase text-amber-400/70 font-mono">Partial Response</span>
                          <span className="h-px flex-1 bg-amber-400/15" />
                        </div>
                      )}
                      {msg._imageUrl ? (
                        <img
                          src={msg._imageUrl}
                          alt="Generated image"
                          className="max-w-full rounded-sm object-contain"
                          style={{ maxHeight: 480 }}
                        />
                      ) : (typeof msg.content === "string" ? msg.content : msg.content?.length) ? (
                        <MessageContent
                          content={msg.content}
                          isAssistant
                          onPointClick={onPointDeepDive}
                          sourceUrlMap={sourceUrlMap}
                        />
                      ) : !msg._retrying ? (
                        <span className="inline-flex gap-1 text-[#00ff41]/60">
                          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, ease }}>●</motion.span>
                          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, ease, delay: 0.2 }}>●</motion.span>
                          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, ease, delay: 0.4 }}>●</motion.span>
                        </span>
                      ) : null}
                      {isStreaming && msg.content && (
                        <motion.span
                          animate={{ opacity: [1, 0] }}
                          transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
                          className="inline-block w-0.5 h-4 bg-[#00ff41] ml-0.5 align-text-bottom"
                        />
                      )}
                    </div>
                  </div>
                  {/* Per-message cost */}
                  {!isStreaming && (msg.content || msg._imageUrl) && (msg.cost > 0 || msg.isFree || msg.usage) && (
                    <span className="text-[11px] text-[#b0b0b0]/50 select-none font-mono" style={{ marginLeft: '34px' }}>
                      {costLabel(msg)}
                      {msg.usage && usageTokenCount(msg.usage) > 0 && (
                        <span className="ml-2 text-[#b0b0b0]/40">
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
                            : "text-[#b0b0b0]/40 hover:text-[#e0e0e0] hover:bg-[#1a1a1a]"
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
                      {onToggleBookmark && (
                        <button
                          onClick={() => onToggleBookmark(i)}
                          className={`flex items-center gap-1 text-[10px] cursor-pointer px-1.5 py-1 rounded-sm transition-colors font-mono ${
                            msg.bookmarked 
                              ? "text-amber-400 bg-amber-400/[0.15] hover:bg-amber-400/20" 
                              : "text-[#b0b0b0]/40 hover:text-amber-400 hover:bg-amber-400/[0.08]"
                          }`}
                          title={msg.bookmarked ? "Remove Bookmark" : "Bookmark message"}
                        >
                          <svg className="w-3 h-3" fill={msg.bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={msg.bookmarked ? "1" : "2"} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                          </svg>
                          {msg.bookmarked ? "Bookmarked" : "Bookmark"}
                        </button>
                      )}
                      <button
                        onClick={() => onRefine?.(i)}
                        disabled={loading}
                        className="flex items-center gap-1 text-[10px] text-[#b0b0b0]/40 hover:text-[#00ff41] disabled:opacity-30 cursor-pointer px-1.5 py-1 rounded-sm hover:bg-[#00ff41]/[0.06] transition-colors font-mono"
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
                          className="flex items-center gap-1 text-[10px] text-[#b0b0b0]/40 hover:text-emerald-400 disabled:opacity-30 cursor-pointer px-1.5 py-1 rounded-sm hover:bg-emerald-500/[0.06] transition-colors font-mono"
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
                          className="flex items-center gap-1 text-[10px] text-[#b0b0b0]/40 hover:text-[#00d4ff] disabled:opacity-30 cursor-pointer px-1.5 py-1 rounded-sm hover:bg-[#00d4ff]/[0.06] transition-colors font-mono"
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
                          className="flex items-center gap-1.5 text-[11px] font-medium text-[#00ff41] bg-[#00ff41]/10 hover:bg-[#00ff41]/20 border border-[#00ff41]/20 rounded-sm px-3 py-1.5 cursor-pointer disabled:opacity-30 transition-colors font-mono"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Retry Same Model
                        </button>
                        <button
                          onClick={() => onRetry?.("better")}
                          disabled={loading}
                          className="flex items-center gap-1.5 text-[11px] font-medium text-[#00d4ff] bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20 border border-[#00d4ff]/20 rounded-sm px-3 py-1.5 cursor-pointer disabled:opacity-30 transition-colors font-mono"
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
                          className="flex items-center gap-1.5 text-[11px] text-[#00ff41] hover:text-[#00ff41]/80 cursor-pointer mb-1 transition-colors font-mono"
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
