// Inline model advice chip — watches the active chat, detects the task type,
// and suggests a meaningfully better model (advisor score + live rankings).
// Session-dismissable per chat+suggestion; never interrupts a running stream.
import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../../core/store";
import { chatsStore } from "../../core/chats";
import { modelsStore, selectModel, modelDisplayName } from "../../core/models";
import { sendStore } from "../../core/send";
import { rankModels } from "../../core/advisor";
import { rankingsStore } from "../../core/rankings";
import { supportsTask } from "../../utils/smartModelSelect";
import { EASE_OUT } from "../../design/motion";
import Icon from "../../ui/icons";
import BrandIcon from "../../ui/BrandIcon";
import { toast } from "../../ui/Toaster";

// Dismissed suggestion keys for this session: `${chatId}|${modelId}|${task}`
const dismissed = new Set();

const CODE_RE =
  /```|\b(function|const |import |class |def |bug|error|stack trace|compile|refactor|regex|sql|typescript|javascript|python|react|api endpoint)\b/i;

function detectTask(chat) {
  let text = "";
  let vision = false;
  for (const m of (chat.messages || []).slice(-8)) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") text += ` ${m.content}`;
    else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p?.type === "text") text += ` ${p.text || ""}`;
        else if (p?.type === "image_url" || p?.type === "image") vision = true;
      }
    }
    if (Array.isArray(m.uploads) && m.uploads.some((u) => u?.type === "image")) vision = true;
  }
  if (vision) return "vision";
  if (CODE_RE.test(text)) return "coding";
  return "general";
}

export default function ModelAdvice() {
  const { chats, activeChatId } = useStore(chatsStore, (s) => ({
    chats: s.chats,
    activeChatId: s.activeChatId,
  }));
  const { models, selectedId } = useStore(modelsStore, (s) => ({
    models: s.models,
    selectedId: s.selectedId,
  }));
  const runs = useStore(sendStore, (s) => s.runs);
  const { rankUpdatedAt } = useStore(rankingsStore, (s) => ({ rankUpdatedAt: s.updatedAt }));
  const [, bump] = useState(0);

  const busy = !!runs[activeChatId];
  const chat = chats.find((c) => c.id === activeChatId);
  const msgCount = chat?.messages?.length || 0;

  const suggestion = useMemo(() => {
    if (!chat || msgCount < 2 || !models.length || !selectedId) return null;
    const task = detectTask(chat);
    const ranked = rankModels(models, { task, priority: "balanced", limit: models.length });
    if (!ranked.length) return null;
    const top = ranked[0];
    if (top.model._selectionId === selectedId) return null;
    const current = ranked.find((e) => e.model._selectionId === selectedId);
    if (!current) return null;
    const delta = top.score - current.score;
    const visionGap = task === "vision" && !supportsTask(current.model, "vision");
    if (delta < 12 && !visionGap) return null;
    return { task, top, delta, key: `${activeChatId}|${top.model._selectionId}|${task}` };
  }, [chat, msgCount, models, selectedId, activeChatId, rankUpdatedAt]);

  const visible = !!suggestion && !busy && !dismissed.has(suggestion.key);

  const apply = () => {
    dismissed.add(suggestion.key);
    selectModel(suggestion.top.model._selectionId);
    toast.success(`Switched to ${modelDisplayName(suggestion.top.model)}`);
  };

  const dismiss = () => {
    dismissed.add(suggestion.key);
    bump((n) => n + 1);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: 4, height: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="overflow-hidden"
        >
          <div className="max-w-[880px] mx-auto mb-2 flex items-center gap-2 pl-3 pr-1.5 h-9 rounded-full bg-deep [box-shadow:var(--neu-inset-sm)]">
            <Icon name="spark" size={13} className="text-accent shrink-0" />
            <span className="text-[11.5px] text-dim truncate shrink-0">
              Better fit for {suggestion.task === "general" ? "this chat" : `this ${suggestion.task} chat`}:
            </span>
            <BrandIcon model={suggestion.top.model} seed={suggestion.top.model._selectionId} size={16} />
            <span className="text-[11.5px] text-body font-medium truncate">
              {modelDisplayName(suggestion.top.model)}
            </span>
            {suggestion.top.rankInfo && (
              <span className="text-[10px] font-mono text-accent shrink-0">
                #{suggestion.top.rankInfo.rank} this week
              </span>
            )}
            {suggestion.delta > 0 && (
              <span className="text-[10px] font-mono text-ok shrink-0">+{suggestion.delta}</span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={apply}
              className="pressable shrink-0 h-7 px-3 rounded-full text-[11px] font-medium text-accent-ink"
              style={{
                background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
                boxShadow: "var(--neu-raised-sm)",
              }}
            >
              Switch
            </button>
            <button
              type="button"
              aria-label="Dismiss suggestion"
              onClick={dismiss}
              className="pressable shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-faint hover:text-body"
            >
              <Icon name="close" size={11} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
