import React, { useMemo } from "react";
import { useStore } from "../../core/store";
import { chatsStore } from "../../core/chats";
import { sendStore } from "../../core/send";
import { estimateTokensFromMessages } from "../../utils/tokenOptimizer";
import { formatCost } from "../../utils/costTracker";
import Icon from "../../ui/icons";
import Sidebar from "./Sidebar";
import Messages from "./Messages";
import Composer from "./Composer";

/* ── Live token/cost HUD ──
   Slim strip above the thread: estimated context tokens, cumulative chat
   spend, message count. Recomputes on every store tick, so the token count
   climbs in real time while a reply streams in. */

function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function ChatHUD() {
  const { chat } = useStore(chatsStore, (s) => ({
    chat: s.chats.find((c) => c.id === s.activeChatId) || null,
  }));
  const runs = useStore(sendStore, (s) => s.runs);

  const messages = chat?.messages || [];
  const tokens = useMemo(() => estimateTokensFromMessages(messages), [messages]);
  const cost = useMemo(
    () => messages.reduce((sum, m) => sum + (m?._meta?.cost || 0), 0),
    [messages]
  );

  if (!chat) return null;
  const streaming = !!runs[chat.id];

  return (
    <div className="h-9 shrink-0 flex items-center justify-between gap-3 px-4 border-b border-line">
      <span className="truncate text-[12px] text-dim">{chat.title || "New chat"}</span>
      <div className="flex items-center gap-4 text-[11px] font-mono text-faint shrink-0">
        {streaming && (
          <span className="flex items-center gap-1.5" style={{ color: "var(--accent)" }}>
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: "var(--accent)" }}
            />
            live
          </span>
        )}
        <span className="flex items-center gap-1.5" title="Estimated context tokens">
          <Icon name="cpu" size={12} />
          {fmtTokens(tokens)} tok
        </span>
        <span className="flex items-center gap-1.5" title="Chat spend (API cost)">
          <Icon name="dollar" size={12} />
          {formatCost(cost)}
        </span>
        <span title="Messages in this chat">{messages.length} msg</span>
      </div>
    </div>
  );
}

export default function ChatScreen() {
  return (
    <div className="h-full flex min-h-0">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <ChatHUD />
        <div className="flex-1 min-h-0">
          <Messages />
        </div>
        <Composer />
      </div>
    </div>
  );
}
