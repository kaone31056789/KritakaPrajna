import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p?.type === "text" ? p.text : typeof p === "string" ? p : ""))
      .filter(Boolean)
      .join(" ");
  }
  return String(content || "");
}

function highlightMatch(text, query) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return (
    <>
      {before}
      <span className="text-[#00ff41] bg-[#00ff41]/15 font-semibold">{match}</span>
      {after}
    </>
  );
}

export default function ChatSearch({ chats, onSelectChat, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return [];

    const matches = [];
    for (const chat of chats) {
      if (!chat?.messages?.length) continue;

      // Check chat title
      const titleMatch = (chat.title || "").toLowerCase().includes(q);

      // Search messages
      for (let i = 0; i < chat.messages.length; i++) {
        const msg = chat.messages[i];
        const text = extractText(msg._displayText ?? msg.content);
        const lower = text.toLowerCase();
        const idx = lower.indexOf(q);
        if (idx === -1 && !titleMatch) continue;
        if (idx === -1) continue;

        // Extract context snippet around match
        const start = Math.max(0, idx - 60);
        const end = Math.min(text.length, idx + q.length + 80);
        const snippet = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");

        matches.push({
          chatId: chat.id,
          chatTitle: chat.title || "Untitled",
          msgIdx: i,
          role: msg.role,
          snippet,
          query: q,
        });

        if (matches.length >= 50) break;
      }
      if (matches.length >= 50) break;
    }

    return matches;
  }, [query, chats]);

  const groupedByChat = useMemo(() => {
    const groups = {};
    for (const r of results) {
      if (!groups[r.chatId]) {
        groups[r.chatId] = { chatId: r.chatId, chatTitle: r.chatTitle, results: [] };
      }
      groups[r.chatId].results.push(r);
    }
    return Object.values(groups);
  }, [results]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Search panel */}
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.97 }}
        transition={{ duration: 0.2, ease }}
        className="relative w-full max-w-2xl mx-4 rounded-md border border-[#1a1a1a] bg-[#0a0a0a] shadow-2xl overflow-hidden"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1a1a1a]">
          <svg className="w-5 h-5 text-[#b0b0b0]/50 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search across all chats…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-[15px] text-[#e0e0e0] placeholder-[#b0b0b0]/30 focus:outline-none font-mono"
          />
          <div className="flex items-center gap-2 shrink-0">
            {query && (
              <span className="text-[10px] text-[#b0b0b0]/40 font-mono">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
            )}
            <button
              onClick={onClose}
              className="text-[#b0b0b0]/40 hover:text-[#e0e0e0] transition-colors cursor-pointer text-xs font-mono px-2 py-1 rounded hover:bg-[#1a1a1a]"
            >
              ESC
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {query.trim().length >= 2 && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg className="w-10 h-10 text-[#b0b0b0]/20 mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" />
                <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
              </svg>
              <p className="text-sm text-[#b0b0b0]/40 font-mono">No results for "{query}"</p>
              <p className="text-xs text-[#b0b0b0]/25 mt-1 font-mono">Try a different search term</p>
            </div>
          )}

          {!query.trim() && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-[#b0b0b0]/40 font-mono">Type to search across all conversations</p>
              <p className="text-xs text-[#b0b0b0]/25 mt-1 font-mono">Searches message content and chat titles</p>
            </div>
          )}

          {groupedByChat.map((group) => (
            <div key={group.chatId} className="border-b border-[#1a1a1a]/50 last:border-b-0">
              {/* Chat title header */}
              <div className="px-4 py-2 bg-[#111]/50 sticky top-0">
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-[#b0b0b0]/30 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span className="text-[11px] text-[#b0b0b0]/60 font-medium font-mono truncate">{group.chatTitle}</span>
                  <span className="text-[9px] text-[#b0b0b0]/30 font-mono shrink-0">{group.results.length} match{group.results.length !== 1 ? "es" : ""}</span>
                </div>
              </div>

              {/* Message results */}
              {group.results.slice(0, 5).map((result, idx) => (
                <button
                  key={`${result.chatId}-${result.msgIdx}-${idx}`}
                  onClick={() => { onSelectChat?.(result.chatId); onClose?.(); }}
                  className="w-full text-left px-4 py-2.5 hover:bg-[#1a1a1a]/40 transition-colors cursor-pointer group"
                >
                  <div className="flex items-start gap-2.5">
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                      result.role === "user"
                        ? "text-[#00ff41]/70 bg-[#00ff41]/10 border border-[#00ff41]/15"
                        : "text-[#00d4ff]/70 bg-[#00d4ff]/10 border border-[#00d4ff]/15"
                    }`}>
                      {result.role === "user" ? "YOU" : "AI"}
                    </span>
                    <p className="text-[12px] text-[#b0b0b0]/70 leading-relaxed font-mono break-words min-w-0 group-hover:text-[#e0e0e0] transition-colors">
                      {highlightMatch(result.snippet, result.query)}
                    </p>
                  </div>
                </button>
              ))}
              {group.results.length > 5 && (
                <div className="px-4 py-1.5 text-[10px] text-[#b0b0b0]/30 font-mono">
                  +{group.results.length - 5} more matches
                </div>
              )}
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
