import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../../core/store";
import {
  agentStore,
  pickWorkspace,
  runAgent,
  stopAgent,
  newAgentChat,
  setActiveAgentChat,
  deleteAgentChat,
  setExecutionMode,
  setAutoExecute,
  resolvePermission,
} from "../../core/agent";
import { EASE_OUT } from "../../design/motion";
import Icon from "../../ui/icons";
import {
  NeuButton,
  NeuToggle,
  Segmented,
  NeuModal,
  NeuBadge,
  Spinner,
  SectionLabel,
  EmptyState,
  IconButton,
} from "../../ui/primitives";
import Markdown from "../../ui/Markdown";

const TOOL_ICONS = {
  read_file: "file",
  write_file: "edit",
  edit_file: "edit",
  list_directory: "folder",
  search_files: "search",
  run_command: "terminal",
  search_web: "globe",
};

const STATUS_TONES = {
  running: "text-accent",
  success: "text-ok",
  error: "text-err",
  denied: "text-err",
};

function WorkspaceCard() {
  const { workspacePath } = useStore(agentStore, (s) => ({ workspacePath: s.workspacePath }));
  const name = workspacePath ? workspacePath.split(/[\\/]/).filter(Boolean).pop() : "";
  return (
    <button
      type="button"
      onClick={pickWorkspace}
      className={`pressable w-full rounded-sm p-3.5 text-left ${
        workspacePath ? "neu-raised-sm" : "bg-deep [box-shadow:var(--neu-inset-sm)]"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-xs flex items-center justify-center ${workspacePath ? "bg-accent-soft text-accent" : "bg-surface-2 text-faint"}`}>
          <Icon name="folder" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-hi truncate">{name || "Pick a workspace"}</p>
          <p className="text-[10px] text-faint truncate">{workspacePath || "The agent works inside this folder"}</p>
        </div>
        <Icon name="chevronRight" size={13} className="text-faint" />
      </div>
    </button>
  );
}

function TaskList() {
  const { chats, activeChatId } = useStore(agentStore, (s) => ({ chats: s.chats, activeChatId: s.activeChatId }));
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 mt-2">
      <SectionLabel className="px-1 pb-1">Tasks</SectionLabel>
      {chats.length === 0 && <p className="text-[11.5px] text-faint px-1 pt-2">No tasks yet.</p>}
      {chats.map((c) => (
        <div key={c.id} className="relative group">
          <button
            type="button"
            onClick={() => setActiveAgentChat(c.id)}
            className={`w-full flex items-center gap-2 px-3 h-9 rounded-sm text-left ${
              c.id === activeChatId
                ? "bg-deep [box-shadow:var(--neu-inset-sm)] text-hi"
                : "text-body hover:bg-surface-2"
            }`}
          >
            <Icon name="agent" size={13} className={c.id === activeChatId ? "text-accent" : "text-faint"} />
            <span className="flex-1 truncate text-[12px]">{c.title}</span>
          </button>
          <button
            type="button"
            aria-label="Delete task"
            onClick={() => deleteAgentChat(c.id)}
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-faint hover:text-err"
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function PlanCard({ plan }) {
  if (plan.length === 0) return null;
  return (
    <div className="neu-raised-sm rounded-sm p-3.5">
      <SectionLabel className="pb-2 block">Plan</SectionLabel>
      <div className="flex flex-col gap-1.5">
        {plan.map((step, i) => {
          const done = step.status === "done" || step.status === "completed";
          const active = step.status === "in_progress" || step.status === "active";
          return (
            <div key={i} className="flex items-start gap-2">
              <span
                className={`mt-[3px] w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 text-[8px] ${
                  done ? "bg-ok-soft text-ok" : active ? "bg-accent-soft text-accent" : "bg-surface-2 text-faint"
                }`}
              >
                {done ? <Icon name="check" size={8} /> : i + 1}
              </span>
              <span className={`text-[11.5px] leading-snug ${done ? "text-faint line-through" : active ? "text-hi" : "text-body"}`}>
                {step.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Timeline({ timeline }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [timeline]);
  if (timeline.length === 0) return null;
  return (
    <div className="neu-raised-sm rounded-sm p-3.5 min-h-0 flex flex-col">
      <SectionLabel className="pb-2 block">Activity</SectionLabel>
      <div ref={ref} className="overflow-y-auto max-h-[240px] flex flex-col gap-1.5 pr-1">
        {timeline.map((e) => (
          <div key={e.id} className="flex items-start gap-2">
            {e.kind === "tool" ? (
              <>
                <Icon
                  name={TOOL_ICONS[e.tool] || "zap"}
                  size={12}
                  className={`mt-[2px] shrink-0 ${STATUS_TONES[e.status] || "text-dim"}`}
                />
                <span className="text-[11px] leading-snug text-body min-w-0">
                  <span className="text-hi font-medium">{e.tool}</span>{" "}
                  <span className="text-faint break-all">{e.target}</span>
                  {e.meta?.added != null && (
                    <span className="text-ok"> +{e.meta.added}</span>
                  )}
                  {e.meta?.removed != null && e.meta.removed > 0 && (
                    <span className="text-err"> −{e.meta.removed}</span>
                  )}
                  {e.status === "denied" && <NeuBadge tone="err" className="ml-1.5">denied</NeuBadge>}
                  {e.status === "error" && <NeuBadge tone="err" className="ml-1.5">failed</NeuBadge>}
                </span>
              </>
            ) : (
              <>
                <Icon name="info" size={11} className="mt-[2px] shrink-0 text-faint" />
                <span className="text-[11px] leading-snug text-dim break-words min-w-0">{e.text}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Terminal({ lines }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  if (lines.length === 0) return null;
  return (
    <div className="rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] p-3 min-h-0">
      <SectionLabel className="pb-1.5 block">Terminal</SectionLabel>
      <div ref={ref} className="overflow-y-auto max-h-[180px] font-mono text-[10.5px] leading-relaxed text-body whitespace-pre-wrap break-all">
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

function StatsPill({ stats, status }) {
  if (stats.filesChanged === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className={`neu-raised-sm rounded-sm p-3.5 ${status === "done" ? "[box-shadow:var(--neu-raised-sm),0_0_16px_var(--accent-glow)]" : ""}`}
    >
      <SectionLabel className="pb-2 block">Changes</SectionLabel>
      <div className="flex items-center gap-3 text-[12px]">
        <span className="flex items-center gap-1 text-hi">
          <Icon name="file" size={12} className="text-accent" /> {stats.filesChanged}
        </span>
        <span className="text-ok font-mono">+{stats.added}</span>
        <span className="text-err font-mono">−{stats.removed}</span>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {stats.files.slice(0, 6).map((f) => (
          <span key={f} className="text-[10.5px] font-mono text-dim truncate">{f}</span>
        ))}
        {stats.files.length > 6 && (
          <span className="text-[10px] text-faint">+{stats.files.length - 6} more</span>
        )}
      </div>
    </motion.div>
  );
}

function PermissionModal() {
  const { permissionRequest } = useStore(agentStore, (s) => ({ permissionRequest: s.permissionRequest }));
  const req = permissionRequest;
  return (
    <NeuModal
      open={!!req}
      onClose={() => resolvePermission(false)}
      title="Agent needs permission"
      width={440}
      footer={
        <>
          <NeuButton variant="ghost" onClick={() => resolvePermission(false)}>Deny</NeuButton>
          <NeuButton variant="accent" icon="check" onClick={() => resolvePermission(true)}>Allow</NeuButton>
        </>
      }
    >
      {req && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xs bg-accent-soft text-accent flex items-center justify-center">
              <Icon name={TOOL_ICONS[req.toolCall?.tool] || "shield"} size={17} />
            </span>
            <div>
              <p className="text-[13.5px] font-semibold text-hi">{req.stepLabel || req.toolCall?.tool}</p>
              <p className="text-[11px] text-faint">Category: {req.category}</p>
            </div>
          </div>
          <div className="rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] p-3 font-mono text-[11px] text-body break-all">
            {req.target}
          </div>
          <p className="text-[11.5px] text-dim leading-relaxed">
            Allowing remembers this target for the rest of the run. Deny sends the refusal back to
            the agent so it can adjust.
          </p>
        </div>
      )}
    </NeuModal>
  );
}

export default function AgentScreen() {
  const state = useStore(agentStore);
  const [text, setText] = useState("");
  const running = state.status === "running";
  const activeChat = state.chats.find((c) => c.id === state.activeChatId);
  const messages = activeChat?.messages || [];
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, state.status]);

  const submit = () => {
    const t = text.trim();
    if (!t || running) return;
    setText("");
    runAgent(t);
  };

  return (
    <div className="h-full flex min-h-0">
      {/* Left — workspace + tasks */}
      <aside className="w-[240px] shrink-0 border-r border-line p-3 flex flex-col min-h-0">
        <WorkspaceCard />
        <NeuButton variant="raised" size="sm" icon="plus" className="w-full mt-2.5" onClick={newAgentChat}>
          New task
        </NeuButton>
        <TaskList />
      </aside>

      {/* Center — conversation + composer */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          {messages.length === 0 ? (
            <EmptyState
              icon="agent"
              title="Autonomous agent"
              hint="Give it a task — it reads and edits files, runs terminal commands, and searches the web inside your workspace, asking before anything destructive."
              className="h-full"
            />
          ) : (
            <div className="max-w-[760px] mx-auto flex flex-col gap-4 px-6 py-6">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end pl-12">
                    <div className="rounded-sm rounded-br-[6px] bg-deep [box-shadow:var(--neu-inset-sm)] px-4 py-2.5 text-[13px] text-hi whitespace-pre-wrap break-words max-w-[80%]">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex pr-12">
                    <div className="neu-raised rounded-sm rounded-bl-[6px] px-4 py-3.5 max-w-[88%] min-w-0">
                      <Markdown>{typeof m.content === "string" ? m.content : ""}</Markdown>
                      {m._agentMeta?.stats?.filesChanged > 0 && (
                        <p className="mt-2 text-[10.5px] text-faint">
                          {m._agentMeta.stats.filesChanged} file(s) changed · +{m._agentMeta.stats.added} −{m._agentMeta.stats.removed}
                        </p>
                      )}
                    </div>
                  </div>
                )
              )}
              {running && (
                <div className="flex items-center gap-2.5 pl-1">
                  <Spinner size={13} />
                  <span className="text-[12px] text-dim">{state.currentStep || "Working…"}</span>
                </div>
              )}
              {state.error && (
                <div className="flex items-start gap-2.5 text-[12.5px] text-err neu-raised-sm rounded-sm px-4 py-3">
                  <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                  {state.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="px-6 pb-5 pt-2">
          <div className="max-w-[760px] mx-auto rounded-lg bg-surface [box-shadow:var(--neu-raised)]">
            <div className="px-4 pt-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                placeholder={state.workspacePath ? "Describe a task for the agent…" : "Pick a workspace first, then describe a task…"}
                className="w-full bg-transparent border-none outline-none resize-none text-[13.5px] text-hi placeholder:text-faint leading-relaxed"
              />
            </div>
            <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-1">
              <Segmented
                size="sm"
                value={state.executionMode}
                onChange={setExecutionMode}
                options={[
                  { value: "plan_first", label: "Plan first", icon: "layers" },
                  { value: "direct", label: "Direct", icon: "zap" },
                ]}
              />
              <NeuToggle checked={state.autoExecute} onChange={setAutoExecute} label="Auto-approve" />
              <div className="flex-1" />
              {running ? (
                <button
                  type="button"
                  aria-label="Stop agent"
                  onClick={stopAgent}
                  className="pressable h-10 px-5 rounded-full flex items-center gap-2 bg-err-soft text-err [box-shadow:var(--neu-raised-sm)] text-[13px] font-medium"
                >
                  <Icon name="stop" size={14} /> Stop
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Run agent"
                  disabled={!text.trim() || !state.workspacePath}
                  onClick={submit}
                  className="pressable h-10 px-5 rounded-full flex items-center gap-2 text-accent-ink text-[13px] font-semibold disabled:opacity-40 disabled:pointer-events-none"
                  style={{
                    background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
                    boxShadow: "var(--neu-raised-sm), 0 2px 12px var(--accent-glow)",
                  }}
                >
                  <Icon name="agent" size={15} /> Run agent
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right — live activity */}
      <aside className="w-[300px] shrink-0 border-l border-line p-3 flex flex-col gap-3 overflow-y-auto min-h-0">
        <AnimatePresence>
          {running && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="neu-raised-sm rounded-sm p-3.5 flex items-center gap-2.5"
            >
              <Spinner size={14} />
              <span className="text-[11.5px] text-body leading-snug min-w-0">{state.currentStep || "Running…"}</span>
            </motion.div>
          )}
        </AnimatePresence>
        <PlanCard plan={state.plan} />
        <StatsPill stats={state.stats} status={state.status} />
        <Timeline timeline={state.timeline} />
        <Terminal lines={state.terminalLines} />
        {state.plan.length === 0 && state.timeline.length === 0 && state.terminalLines.length === 0 && !running && (
          <EmptyState icon="gauge" title="Live activity" hint="Plans, tool calls, file diffs and terminal output appear here during a run." />
        )}
      </aside>

      <PermissionModal />
    </div>
  );
}
