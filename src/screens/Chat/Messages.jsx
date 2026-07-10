import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useStore } from "../../core/store";
import { chatsStore, getActiveChat } from "../../core/chats";
import { sendStore, regenerateMessage, editAndResend, extractText, sendMessage } from "../../core/send";
import { modelsStore, selectModel } from "../../core/models";
import { formatCost } from "../../utils/costTracker";
import { EASE_OUT } from "../../design/motion";
import Icon from "../../ui/icons";
import { GradientOrb, IconButton, EmptyState, NeuButton } from "../../ui/primitives";
import BrandIcon from "../../ui/BrandIcon";
import Markdown from "../../ui/Markdown";
import { toast } from "../../ui/Toaster";
import { LogoMark } from "../../ui/Logo";

async function copyText(text) {
  try {
    if (window.electronAPI?.writeClipboardText) await window.electronAPI.writeClipboardText(text);
    else await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Copy failed");
  }
}

/* ── Time helpers ── */
const timeOf = (m) =>
  m?.ts ? new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

function DayDivider({ ts }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <span className="flex-1 h-px" style={{ background: "var(--line)" }} />
      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-faint">{dayLabel(ts)}</span>
      <span className="flex-1 h-px" style={{ background: "var(--line)" }} />
    </div>
  );
}

/* ── Error decoding — status code → human title + actionable hint ── */
const ERROR_HINTS = {
  400: ["Bad request", "The provider rejected the payload — try a shorter prompt or a different model."],
  401: ["Unauthorized", "The provider rejected your API key — add or update it in Settings → Providers."],
  402: ["Out of credits", "Your balance is empty with this provider — top up, or switch providers."],
  403: ["Forbidden", "This key doesn't have access to the selected model."],
  404: ["Model not found", "This model may have been retired — pick another from the model menu."],
  408: ["Timed out", "The provider took too long — retry, or switch models."],
  429: ["Rate limited", "Too many requests — wait a moment, or try the fallback model."],
  500: ["Provider error", "The provider is having a moment — retry, or try the fallback."],
  502: ["Bad gateway", "The provider is having a moment — retry, or try the fallback."],
  503: ["Provider down", "The provider is overloaded right now — retry, or try the fallback."],
};

function decodeError(err) {
  const match = /\b([45]\d\d)\b/.exec(err || "");
  const hit = match ? ERROR_HINTS[match[1]] : null;
  return {
    code: match ? match[1] : null,
    title: hit ? hit[0] : "Request failed",
    hint: hit ? hit[1] : null,
  };
}

/* ── User bubble — accent-tinted card, right aligned ── */
function UserMessage({ chatId, index, message }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const text = extractText(message);
  const images = Array.isArray(message.content)
    ? message.content.filter((p) => p.type === "image_url").map((p) => p.image_url?.url)
    : [];

  return (
    <div className="msg-block enter-rise flex justify-end pl-14 group">
      <div className="max-w-[78%] flex flex-col items-end gap-1.5">
        {images.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-end">
            {images.map((src, i) => (
              <img key={i} src={src} alt="attachment" className="max-h-40 rounded-sm [box-shadow:var(--neu-raised-sm)]" />
            ))}
          </div>
        )}
        {editing ? (
          <div className="w-full min-w-[340px]">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(8, Math.max(2, draft.split("\n").length))}
              className="w-full rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[13.5px] text-hi p-3.5 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  setEditing(false);
                  editAndResend(chatId, index, draft);
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="flex justify-end gap-2 mt-1.5">
              <NeuButton size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</NeuButton>
              <NeuButton size="sm" variant="accent" icon="send" onClick={() => { setEditing(false); editAndResend(chatId, index, draft); }}>
                Resend
              </NeuButton>
            </div>
          </div>
        ) : (
          text && (
            <div className="msg-user rounded-sm rounded-br-[6px] px-4 py-2.5 text-[13.5px] text-hi whitespace-pre-wrap break-words">
              {text}
            </div>
          )
        )}
        {!editing && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100" style={{ transition: "opacity 140ms var(--ease-out)" }}>
            {timeOf(message) && <span className="text-[10.5px] text-faint mr-1">{timeOf(message)}</span>}
            <IconButton name="copy" size={13} label="Copy" onClick={() => copyText(text)} />
            <IconButton name="edit" size={13} label="Edit & resend" onClick={() => { setDraft(text); setEditing(true); }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Assistant message — raised card with meta footer ── */
function AssistantMessage({ chatId, index, message, busy, grouped }) {
  const meta = message._meta;
  const text = extractText(message);

  const orbSeed = meta ? `${meta.provider}::${meta.modelId}` : "kp-assistant";
  const brandModel = meta
    ? { id: meta.modelId, name: meta.modelName, provider: meta.provider }
    : null;

  return (
    <div className="msg-block enter-rise flex gap-3 pr-10 group">
      {grouped ? (
        <span className="w-[22px] shrink-0" aria-hidden="true" />
      ) : (
        <span className="shrink-0 mt-1.5" aria-hidden="true">
          <BrandIcon model={brandModel} seed={orbSeed} size={22} />
        </span>
      )}
      <div className="max-w-[88%] min-w-0 flex flex-col gap-1.5">
        <div
          className="msg-assistant rounded-sm rounded-bl-[6px] px-4 py-3.5 relative"
          style={
            message.error
              ? {
                  background: "var(--err-soft)",
                  boxShadow:
                    "inset 0 0 0 1px color-mix(in srgb, var(--err) 22%, transparent), inset 3px 0 0 0 var(--err)",
                }
              : undefined
          }
        >
          {message.error ? (
            <div className="flex flex-col gap-2.5">
              {(() => {
                const err = decodeError(message.error);
                return (
                  <div className="flex items-start gap-2.5">
                    <span
                      className="w-7 h-7 rounded-xs flex items-center justify-center shrink-0"
                      style={{ background: "color-mix(in srgb, var(--err) 16%, transparent)" }}
                    >
                      <Icon name="alert" size={14} className="text-err" />
                    </span>
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <span className="text-[12.5px] font-semibold text-err flex items-center gap-1.5 flex-wrap">
                        {err.title}
                        {err.code && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-px rounded-full text-err"
                            style={{ background: "color-mix(in srgb, var(--err) 14%, transparent)" }}
                          >
                            {err.code}
                          </span>
                        )}
                      </span>
                      <span className="text-[11.5px] text-dim break-words">{message.error}</span>
                      {err.hint && <span className="text-[11.5px] text-faint">{err.hint}</span>}
                    </div>
                  </div>
                );
              })()}
              {text && <Markdown>{text}</Markdown>}
              <div className="flex gap-2 pl-[38px]">
                <NeuButton size="sm" icon="refresh" onClick={() => regenerateMessage(chatId, index)}>
                  Retry
                </NeuButton>
                {message._fallback && (
                  <NeuButton
                    size="sm"
                    variant="accent"
                    icon="zap"
                    onClick={() => {
                      selectModel(message._fallback.selectionId);
                      regenerateMessage(chatId, index);
                    }}
                  >
                    Try fallback model
                  </NeuButton>
                )}
              </div>
            </div>
          ) : (
            <>
              {message._images?.map((src, i) => (
                <img key={i} src={src} alt="generated" className="max-w-full rounded-sm mb-2 [box-shadow:var(--neu-raised-sm)]" />
              ))}
              <Markdown>{text}</Markdown>
              {message.streaming && (
                <span className="inline-block w-[7px] h-[15px] ml-1 align-text-bottom rounded-[2px] bg-accent animate-breathe" />
              )}
            </>
          )}
        </div>

        {!message.streaming && !message.error && (
          <div className="flex items-center gap-2.5 pl-1 opacity-0 group-hover:opacity-100" style={{ transition: "opacity 140ms var(--ease-out)" }}>
            {meta && (
              <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
                <BrandIcon
                  model={{ id: meta.modelId, name: meta.modelName, provider: meta.provider }}
                  seed={`${meta.provider}::${meta.modelId}`}
                  size={12}
                />
                <span className="truncate max-w-[180px]">{meta.modelName}</span>
                {typeof meta.elapsedMs === "number" && <span>· {(meta.elapsedMs / 1000).toFixed(1)}s</span>}
                {meta.cost > 0 && <span>· {formatCost(meta.cost)}</span>}
                {meta.webSources?.length > 0 && (
                  <span className="flex items-center gap-0.5 text-info">
                    <Icon name="globe" size={10} /> {meta.webSources.length}
                  </span>
                )}
              </span>
            )}
            {timeOf(message) && <span className="text-[10.5px] text-faint">{timeOf(message)}</span>}
            <span className="flex gap-0.5">
              <IconButton name="copy" size={13} label="Copy" onClick={() => copyText(text)} />
              <IconButton name="refresh" size={13} label="Regenerate" disabled={busy} onClick={() => regenerateMessage(chatId, index)} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const MemoUser = memo(UserMessage);
const MemoAssistant = memo(AssistantMessage);

const SUGGESTIONS = [
  { icon: "code", text: "Explain this code and suggest improvements" },
  { icon: "wand", text: "Brainstorm names for a new project" },
  { icon: "globe", text: "What happened in tech news today?" },
  { icon: "brain", text: "Teach me something surprising in 3 paragraphs" },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Empty({ onPick }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
        className="w-16 h-16 rounded-xl neu-raised flex items-center justify-center mb-5"
      >
        <LogoMark size={38} glow />
      </motion.div>
      <h1 className="font-display font-semibold text-[22px] text-hi mb-1.5">{greeting()} — how can I help?</h1>
      <p className="text-[13px] text-dim mb-7">Ask anything — or try one of these.</p>
      <motion.div
        className="grid grid-cols-2 gap-3 w-full max-w-[560px]"
        initial="initial"
        animate="animate"
        variants={{ animate: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } } }}
      >
        {SUGGESTIONS.map((s) => (
          <motion.button
            key={s.text}
            type="button"
            variants={{ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT } } }}
            onClick={() => onPick(s.text)}
            className="pressable neu-raised-sm rounded-sm px-4 py-3.5 text-left flex items-start gap-3 hover:[box-shadow:var(--neu-raised)]"
          >
            <Icon name={s.icon} size={16} className="text-accent mt-0.5 shrink-0" />
            <span className="text-[12.5px] text-body leading-snug">{s.text}</span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}

export default function Messages() {
  const { chat } = useStore(chatsStore, (s) => ({ chat: getActiveChat(s) }));
  const runs = useStore(sendStore, (s) => s.runs);
  const busy = !!runs[chat?.id];
  const scrollRef = useRef(null);
  const pinnedToBottom = useRef(true);

  const messages = chat?.messages || [];

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Stick to bottom while streaming, but never fight the user's scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!chat || messages.length === 0) {
    return <Empty onPick={(text) => sendMessage({ chatId: chat?.id, text })} />;
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div className="max-w-[768px] mx-auto flex flex-col px-6 py-7">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !!(m.ts && prev?.ts && new Date(m.ts).toDateString() !== new Date(prev.ts).toDateString());
          const grouped = !newDay && !!prev && prev.role === m.role;
          return (
            <React.Fragment key={i}>
              {newDay && <DayDivider ts={m.ts} />}
              <div className={i === 0 ? "" : grouped ? "mt-1.5" : "mt-5"}>
                {m.role === "user" ? (
                  <MemoUser chatId={chat.id} index={i} message={m} />
                ) : (
                  <MemoAssistant chatId={chat.id} index={i} message={m} busy={busy} grouped={grouped} />
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
