import React, { useEffect, useMemo, useRef, useState } from "react";
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
  proceedWithPlan,
  cancelPlan,
  revertToCheckpoint,
} from "../../core/agent";
import { splitReasoning } from "../../core/send";
import { modelsStore, getSelectedModel, modelDisplayName } from "../../core/models";
import { formatCost } from "../../utils/costTracker";
import { EASE_OUT, T } from "../../design/motion";
import Icon from "../../ui/icons";
import BrandIcon from "../../ui/BrandIcon";
import ModelPicker from "../Chat/ModelPicker";
import {
  NeuButton,
  NeuToggle,
  Segmented,
  NeuModal,
  NeuBadge,
  Spinner,
  SectionLabel,
  EmptyState,
} from "../../ui/primitives";
import Markdown from "../../ui/Markdown";
import Reasoning from "../Chat/Reasoning";
import FileTree from "./FileTree";

const TOOL_ICONS = {
  read_file: "file",
  write_file: "edit",
  edit_file: "edit",
  list_directory: "folder",
  search_files: "search",
  run_command: "terminal",
  search_web: "globe",
};

const TOOL_LABELS = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  list_directory: "List",
  search_files: "Search",
  run_command: "Run",
  search_web: "Search web",
};

const STATUS_TONES = {
  running: "text-accent",
  success: "text-ok",
  error: "text-err",
  denied: "text-err",
};

const prettyTool = (t) => TOOL_LABELS[t] || t;

/** Compact token count: 1234 → "1.2k", 1_500_000 → "1.5M". */
function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n || 0);
}

/** Build the OS-appropriate absolute path from the workspace + a relative path. */
function joinPath(base, rel) {
  if (!base) return rel;
  const sep = base.includes("\\") ? "\\" : "/";
  const b = base.replace(/[\\/]+$/, "");
  const r = String(rel || "").replace(/^[\\/]+/, "").replace(/[\\/]/g, sep);
  return `${b}${sep}${r}`;
}

/** Collapse the run timeline into one card per touched path with summed counts. */
function aggregateChanges(timeline) {
  const map = new Map();
  for (const e of timeline) {
    if (e.kind !== "tool") continue;
    const p = e.meta?.path;
    if (!p) continue;
    if (e.status && e.status !== "success") continue;
    const cur = map.get(p) || { path: p, added: 0, removed: 0, created: false, edits: 0 };
    cur.added += e.meta.added || 0;
    cur.removed += e.meta.removed || 0;
    cur.created = cur.created || !!e.meta.created;
    cur.edits += 1;
    map.set(p, cur);
  }
  return [...map.values()];
}

/* ── Left sidebar pieces ─────────────────────────────────────────────────── */

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
        <span
          className={`w-8 h-8 rounded-xs flex items-center justify-center ${
            workspacePath ? "bg-accent-soft text-accent" : "bg-surface-2 text-faint"
          }`}
        >
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
            className={`w-full flex items-center gap-2 pl-3 pr-8 h-9 rounded-sm text-left ${
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
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-xs flex items-center justify-center text-faint opacity-0 group-hover:opacity-100 hover:text-err hover:bg-surface-2 transition-opacity"
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Output tab pieces ───────────────────────────────────────────────────── */

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
              <span
                className={`text-[11.5px] leading-snug ${
                  done ? "text-faint line-through" : active ? "text-hi" : "text-body"
                }`}
              >
                {step.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionRow({ e }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: T, ease: EASE_OUT }}
      className="flex items-start gap-2"
    >
      {e.kind === "tool" ? (
        <>
          <span
            className={`mt-[1px] w-5 h-5 rounded-xs bg-surface-2 flex items-center justify-center shrink-0 ${
              STATUS_TONES[e.status] || "text-dim"
            }`}
          >
            <Icon name={TOOL_ICONS[e.tool] || "spark"} size={11} />
          </span>
          <span className="text-[11.5px] leading-5 text-body min-w-0">
            <span className="text-hi font-medium">{prettyTool(e.tool)}</span>{" "}
            <span className="text-faint break-all">{e.target}</span>
            {e.meta?.added != null && <span className="text-ok"> +{e.meta.added}</span>}
            {e.meta?.removed > 0 && <span className="text-err"> −{e.meta.removed}</span>}
            {e.status === "denied" && (
              <NeuBadge tone="err" className="ml-1.5">
                denied
              </NeuBadge>
            )}
            {e.status === "error" && (
              <NeuBadge tone="err" className="ml-1.5">
                failed
              </NeuBadge>
            )}
          </span>
        </>
      ) : (
        <>
          <span className="mt-[1px] w-5 h-5 rounded-xs bg-surface-2 flex items-center justify-center shrink-0 text-faint">
            <Icon name="info" size={11} />
          </span>
          <span className="text-[11.5px] leading-5 text-dim break-words min-w-0">{e.text}</span>
        </>
      )}
    </motion.div>
  );
}

function TerminalPeek({ lines }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  if (!lines || lines.length === 0) return null;
  const recent = lines.slice(-8);
  return (
    <div className="mt-1.5 rounded-xs bg-deep [box-shadow:var(--neu-inset-sm)] overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 h-6 border-b border-line/60">
        <Icon name="terminal" size={10} className="text-faint" />
        <span className="text-[9.5px] font-medium uppercase tracking-wide text-faint">Terminal</span>
      </div>
      <div ref={ref} className="max-h-28 overflow-auto px-2.5 py-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-all">
        {recent.map((l, i) => (
          <div key={i} className={l.startsWith("$") ? "text-accent" : l.startsWith("!") ? "text-err" : "text-body"}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityStream({ timeline, running, currentStep, terminalLines }) {
  if (!running && timeline.length === 0) return null;
  return (
    <div className="neu-raised-sm rounded-sm p-3.5 flex flex-col gap-1.5">
      <SectionLabel className="pb-1 block">Activity</SectionLabel>
      {timeline.map((e) => (
        <ActionRow key={e.id} e={e} />
      ))}
      <TerminalPeek lines={terminalLines} />
      {running && (
        <div className="flex items-center gap-2 mt-0.5">
          <Spinner size={12} />
          <span className="text-[12px] text-dim reason-shimmer">{currentStep || "Working…"}</span>
        </div>
      )}
    </div>
  );
}

// Finish line — a soft animated divider + "Done" badge that lands when a run
// completes, so the eye can find where the last task ended at a glance.
function FinishDivider({ stats }) {
  const changed = stats?.filesChanged > 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
      className="flex items-center gap-3 py-0.5 select-none"
    >
      <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, var(--line-strong))" }} />
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ok">
        <motion.span
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.12, type: "spring", stiffness: 420, damping: 14 }}
          className="flex"
        >
          <Icon name="check" size={13} />
        </motion.span>
        Done
        {changed && (
          <span className="text-faint font-normal">
            · {stats.filesChanged} file{stats.filesChanged > 1 ? "s" : ""} · <span className="text-ok">+{stats.added}</span>{" "}
            <span className="text-err">−{stats.removed}</span>
          </span>
        )}
      </span>
      <div className="h-px flex-1" style={{ background: "linear-gradient(to left, transparent, var(--line-strong))" }} />
    </motion.div>
  );
}

function AssistantBubble({ content, meta }) {
  const raw = typeof content === "string" ? content : "";
  const { reasoning, answer, pending, hasReasoning } = useMemo(() => splitReasoning(raw), [raw]);
  const stats = meta?.stats;
  return (
    <div className="flex pr-10">
      <div className="min-w-0 w-full max-w-[92%]">
        {hasReasoning && <Reasoning text={reasoning} thinking={pending} />}
        {answer ? (
          <div
            className="neu-raised rounded-sm rounded-bl-[6px] px-4 py-3.5 min-w-0"
            style={{ borderLeft: "2px solid color-mix(in srgb, var(--accent) 55%, transparent)" }}
          >
            <Markdown>{answer}</Markdown>
            {stats?.filesChanged > 0 && (
              <p className="mt-2 text-[10.5px] text-faint">
                {stats.filesChanged} file{stats.filesChanged > 1 ? "s" : ""} changed · +{stats.added} −{stats.removed}
              </p>
            )}
          </div>
        ) : (
          !hasReasoning && <div className="text-[12px] text-faint italic px-1">No response.</div>
        )}
      </div>
    </div>
  );
}

/* ── Changes tab pieces ──────────────────────────────────────────────────── */

function ChangeCard({ change, workspacePath }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null); // { content, error, loading }
  const name = change.path.split(/[\\/]/).pop();
  const dir = change.path.slice(0, change.path.length - name.length).replace(/[\\/]+$/, "");

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !file) {
      setFile({ loading: true });
      const abs = joinPath(workspacePath, change.path);
      const res = await window.electronAPI?.readFile?.(abs);
      setFile({ content: res?.content ?? "", error: res?.error });
    }
  };

  return (
    <div className="neu-raised-sm rounded-sm overflow-hidden">
      <button type="button" onClick={toggle} className="w-full flex items-center gap-2.5 px-3.5 h-11 text-left">
        <span
          className={`w-6 h-6 rounded-xs flex items-center justify-center shrink-0 ${
            change.created ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent"
          }`}
        >
          <Icon name={change.created ? "plus" : "edit"} size={12} />
        </span>
        <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
          <span className="text-[12.5px] font-medium text-hi truncate">{name}</span>
          {dir && <span className="text-[10.5px] text-faint truncate">{dir}</span>}
        </span>
        <NeuBadge tone={change.created ? "ok" : "neutral"}>{change.created ? "new" : "edited"}</NeuBadge>
        <span className="text-ok font-mono text-[11.5px]">+{change.added}</span>
        <span className="text-err font-mono text-[11.5px]">−{change.removed}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="flex shrink-0"
        >
          <Icon name="chevronDown" size={13} className="text-faint" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="overflow-hidden border-t border-line"
          >
            {!file || file.loading ? (
              <div className="p-3 text-faint text-[12px] flex items-center gap-2">
                <Spinner size={11} /> Reading…
              </div>
            ) : file.error ? (
              <div className="p-3 text-err text-[12px]">{file.error}</div>
            ) : (
              <pre className="m-2 p-3.5 max-h-[360px] overflow-auto font-mono text-[11px] leading-relaxed text-body whitespace-pre bg-deep [box-shadow:var(--neu-inset-sm)] rounded-sm">
                {file.content || "Empty file."}
              </pre>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* Revert-to-checkpoint — two-click arm/confirm since this rewrites the tree.
   Only shown once a run has a checkpoint and isn't actively running. */
function RevertButton() {
  const checkpoint = useStore(agentStore, (s) => s.checkpoint);
  const reverting = useStore(agentStore, (s) => s.reverting);
  const status = useStore(agentStore, (s) => s.status);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  if (!checkpoint || status === "running") return null;
  return (
    <button
      type="button"
      disabled={reverting}
      title="Restore every file to the git checkpoint taken before this run's first change"
      onClick={() => {
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        revertToCheckpoint();
      }}
      className={`pressable h-7 px-3 rounded-full flex items-center gap-1.5 text-[11.5px] font-medium [box-shadow:var(--neu-raised-sm)] disabled:opacity-50 ${
        armed ? "bg-err-soft text-err" : "text-faint hover:text-body"
      }`}
    >
      <Icon name="history" size={12} />
      {reverting ? "Reverting…" : armed ? "Confirm revert?" : "Revert all"}
    </button>
  );
}

function ChangesView({ changes, workspacePath }) {
  if (changes.length === 0) {
    return (
      <EmptyState
        icon="code"
        title="No changes yet"
        hint="Files the agent creates or edits show up here with per-file line counts — click one to preview it."
        className="h-full"
      />
    );
  }
  const added = changes.reduce((n, c) => n + c.added, 0);
  const removed = changes.reduce((n, c) => n + c.removed, 0);
  return (
    <div className="max-w-[min(1600px,96%)] mx-auto p-5 flex flex-col gap-2.5">
      <div className="flex items-center gap-3 text-[12.5px] mb-1">
        <span className="text-hi font-medium">
          {changes.length} file{changes.length > 1 ? "s" : ""} changed
        </span>
        <span className="text-ok font-mono">+{added}</span>
        <span className="text-err font-mono">−{removed}</span>
        <div className="flex-1" />
        <RevertButton />
      </div>
      {changes.map((c) => (
        <ChangeCard key={c.path} change={c} workspacePath={workspacePath} />
      ))}
    </div>
  );
}

function TerminalView({ lines }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  if (lines.length === 0) {
    return (
      <EmptyState
        icon="terminal"
        title="No terminal output"
        hint="Commands the agent runs and their output stream here."
        className="h-full"
      />
    );
  }
  return (
    <div
      ref={ref}
      className="h-full overflow-auto bg-deep [box-shadow:var(--neu-inset-sm)] p-4 font-mono text-[11px] leading-relaxed text-body whitespace-pre-wrap break-all"
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

/* ── Tab bar ─────────────────────────────────────────────────────────────── */

const TABS = [
  { id: "output", label: "Output", icon: "chat" },
  { id: "changes", label: "Changes", icon: "code" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
];

function TabBar({ tab, setTab, changesCount, terminalActive, running }) {
  const usage = useStore(agentStore, (s) => s.usage);
  const totalTokens = usage.promptTokens + usage.completionTokens;
  return (
    <div className="flex items-center gap-1 px-3 h-11 border-b border-line shrink-0">
      {TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative flex items-center gap-1.5 h-8 px-3 rounded-sm text-[12px] font-medium ${
              active ? "text-hi" : "text-faint hover:text-body"
            }`}
          >
            <Icon name={t.icon} size={13} className={active ? "text-accent" : ""} />
            {t.label}
            {t.id === "changes" && changesCount > 0 && (
              <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent-soft text-accent text-[9.5px] font-semibold flex items-center justify-center tabular-nums">
                {changesCount}
              </span>
            )}
            {t.id === "terminal" && terminalActive && (
              <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-accent" />
            )}
            {t.id === "output" && running && (
              <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-accent animate-breathe" />
            )}
            {active && (
              <motion.span
                layoutId="agentTab"
                className="absolute left-2 right-2 -bottom-[7px] h-[2px] rounded-full bg-accent"
                transition={{ duration: 0.2, ease: EASE_OUT }}
              />
            )}
          </button>
        );
      })}

      <div className="flex-1" />

      {/* Live token/cost meter for the current run — mirrors the chat HUD. */}
      {usage.turns > 0 && (
        <div className="flex items-center gap-3 text-[11px] font-mono text-faint shrink-0 pr-1">
          <span className="flex items-center gap-1.5" title="Tokens used this run (prompt + completion)">
            <Icon name="cpu" size={12} />
            {fmtTokens(totalTokens)} tok
          </span>
          <span
            className="flex items-center gap-1.5"
            title={
              usage.estimated
                ? "Estimated cost this run — provider omitted usage, so tokens are approximated"
                : "API cost this run"
            }
            style={running ? { color: "var(--accent)" } : undefined}
          >
            <Icon name="dollar" size={12} />
            {formatCost(usage.cost)}
            {usage.estimated && <span className="text-[9px] opacity-70 ml-0.5">est</span>}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Permission modal ────────────────────────────────────────────────────── */

// Human-readable preview of exactly what the tool call will do, so approval is
// an informed decision rather than a blind "Allow".
function describeToolCall(tc) {
  if (!tc) return "";
  const a = tc.args || tc.arguments || {};
  switch (tc.tool) {
    case "write_file":
    case "edit_file":
      return `Write to ${a.path || a.file_path || "a file"}`;
    case "run_command":
      return a.command || "Run a shell command";
    case "read_file":
      return `Read ${a.path || a.file_path || "a file"}`;
    case "delete_file":
      return `Delete ${a.path || a.file_path || "a file"}`;
    default:
      return tc.command || a.command || "";
  }
}

function PermissionModal() {
  const { permissionRequest, plan } = useStore(agentStore, (s) => ({
    permissionRequest: s.permissionRequest,
    plan: s.plan,
  }));
  const req = permissionRequest;
  const detail = describeToolCall(req?.toolCall);
  const cmd = req?.toolCall?.args?.command || req?.toolCall?.arguments?.command;
  return (
    <NeuModal
      open={!!req}
      onClose={() => resolvePermission(false)}
      title="Approve this step?"
      width={460}
      footer={
        <>
          <NeuButton variant="ghost" onClick={() => resolvePermission(false)}>
            Deny
          </NeuButton>
          <NeuButton variant="accent" icon="check" onClick={() => resolvePermission(true)}>
            Allow &amp; run
          </NeuButton>
        </>
      }
    >
      {req && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xs bg-accent-soft text-accent flex items-center justify-center shrink-0">
              <Icon name={TOOL_ICONS[req.toolCall?.tool] || "shield"} size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-hi truncate">{req.stepLabel || req.toolCall?.tool}</p>
              <p className="text-[11px] text-faint">{detail || `Category: ${req.category}`}</p>
            </div>
          </div>

          {/* What will run */}
          <div className="rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] p-3 font-mono text-[11px] text-body break-all whitespace-pre-wrap">
            {cmd || req.target}
          </div>

          {/* The plan this step belongs to, so the user sees the whole intent */}
          {plan && plan.length > 0 && (
            <div className="rounded-sm neu-raised-sm p-3">
              <SectionLabel className="pb-1.5 block">Plan</SectionLabel>
              <div className="flex flex-col gap-1">
                {plan.map((step, i) => {
                  const done = step.status === "done" || step.status === "completed";
                  const active = step.status === "in_progress" || step.status === "active";
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <span
                        className={`mt-[3px] w-3 h-3 rounded-full flex items-center justify-center shrink-0 text-[7px] ${
                          done ? "bg-ok-soft text-ok" : active ? "bg-accent-soft text-accent" : "bg-surface-2 text-faint"
                        }`}
                      >
                        {done ? <Icon name="check" size={7} /> : i + 1}
                      </span>
                      <span className={`text-[11px] leading-snug ${active ? "text-hi" : done ? "text-faint line-through" : "text-body"}`}>
                        {step.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[11.5px] text-dim leading-relaxed">
            Allowing remembers this target for the rest of the run. Deny sends the refusal back to the agent so it can
            adjust.
          </p>
        </div>
      )}
    </NeuModal>
  );
}

/* ── Screen ──────────────────────────────────────────────────────────────── */

export default function AgentScreen() {
  const state = useStore(agentStore);
  const [text, setText] = useState("");
  const [tab, setTab] = useState("output");
  const [focusPath, setFocusPath] = useState(null);
  const [modelOpen, setModelOpen] = useState(false);
  const { models, selectedId } = useStore(modelsStore, (s) => ({ models: s.models, selectedId: s.selectedId }));
  const agentModel = getSelectedModel({ models, selectedId });
  const running = state.status === "running";
  const awaitingPlan = state.awaitingPlanApproval;
  const activeChat = state.chats.find((c) => c.id === state.activeChatId);
  const messages = activeChat?.messages || [];
  const scrollRef = useRef(null);
  const focusNonceRef = useRef(0);

  const changes = useMemo(() => aggregateChanges(state.timeline), [state.timeline]);

  useEffect(() => {
    if (tab === "output" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, state.status, state.timeline.length, tab]);

  // When the agent asks the UI to surface a file (e.g. PLAN.md is ready),
  // jump to the Files tab and hand the path to the tree so it opens it. The
  // nonce guard means re-opening the same path still re-triggers.
  useEffect(() => {
    const f = state.focusFile;
    if (f?.path && f.nonce !== focusNonceRef.current) {
      focusNonceRef.current = f.nonce;
      setFocusPath({ path: f.path, nonce: f.nonce });
      setTab("files");
    }
  }, [state.focusFile]);

  const submit = () => {
    const t = text.trim();
    if (!t || running) return;
    setText("");
    setTab("output");
    runAgent(t);
  };

  const showEmpty = messages.length === 0 && !running && state.timeline.length === 0;

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

      {/* Center — tabbed workspace + composer */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <TabBar
          tab={tab}
          setTab={setTab}
          changesCount={changes.length}
          terminalActive={state.terminalLines.length > 0}
          running={running}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "output" && (
            <div ref={scrollRef} className="h-full overflow-y-auto">
              {showEmpty ? (
                <EmptyState
                  icon="agent"
                  title="Autonomous agent"
                  hint="Give it a task — it reads and edits files, runs terminal commands, and searches the web inside your workspace, asking before anything destructive."
                  className="h-full"
                />
              ) : (
                <div className="max-w-[min(1600px,96%)] mx-auto flex flex-col gap-4 px-6 py-6">
                  <PlanCard plan={state.plan} />
                  {messages.map((m, i) =>
                    m.role === "user" ? (
                      <div key={i} className="flex justify-end pl-12">
                        <div
                          className="rounded-sm rounded-br-[6px] [box-shadow:var(--neu-inset-sm)] px-4 py-2.5 text-[13px] text-hi whitespace-pre-wrap break-words max-w-[80%]"
                          style={{ background: "color-mix(in srgb, var(--accent) 14%, var(--bg-deep))" }}
                        >
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <AssistantBubble key={i} content={m.content} meta={m._agentMeta} />
                    )
                  )}
                  <ActivityStream
                    timeline={state.timeline}
                    running={running}
                    currentStep={state.currentStep}
                    terminalLines={state.terminalLines}
                  />
                  {!running && state.timeline?.length > 0 && !state.error && (
                    <FinishDivider
                      stats={
                        [...messages].reverse().find((m) => m.role === "assistant" && m._agentMeta)
                          ?._agentMeta?.stats
                      }
                    />
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
          )}

          {tab === "changes" && (
            <div className="h-full overflow-y-auto">
              <ChangesView changes={changes} workspacePath={state.workspacePath} />
            </div>
          )}

          {tab === "files" && (
            <FileTree workspacePath={state.workspacePath} focusPath={focusPath} />
          )}

          {tab === "terminal" && <TerminalView lines={state.terminalLines} />}
        </div>

        {/* Plan review — shown while a plan waits on the user's decision */}
        <AnimatePresence initial={false}>
          {awaitingPlan && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="overflow-hidden border-t border-line"
            >
              <div className="max-w-[min(1600px,96%)] mx-auto px-6 py-3 flex items-center gap-3">
                <span className="w-8 h-8 rounded-xs bg-accent-soft text-accent flex items-center justify-center shrink-0">
                  <Icon name="layers" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold text-hi">Plan ready for review</p>
                  <p className="text-[11px] text-faint truncate">
                    Edit <span className="font-mono">PLAN.md</span> in the Files tab, then proceed or cancel.
                  </p>
                </div>
                <NeuButton variant="ghost" size="sm" icon="x" onClick={cancelPlan}>
                  Cancel
                </NeuButton>
                <NeuButton variant="accent" size="sm" icon="check" onClick={proceedWithPlan}>
                  Proceed
                </NeuButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Composer */}
        <div className="px-6 pb-5 pt-3 border-t border-line">
          <div className="max-w-[min(1600px,96%)] mx-auto rounded-lg bg-surface [box-shadow:var(--neu-raised)]">
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
                placeholder={
                  state.workspacePath ? "Describe a task for the agent…" : "Pick a workspace first, then describe a task…"
                }
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
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setModelOpen((o) => !o)}
                  className="pressable flex items-center gap-2 h-8 pl-2 pr-3 rounded-full bg-deep [box-shadow:var(--neu-inset-sm)] hover:[box-shadow:var(--neu-inset-sm),0_0_8px_var(--accent-glow)]"
                  style={{ transition: "box-shadow 180ms var(--ease-out)" }}
                  title="Choose the model the agent uses"
                >
                  {agentModel ? <BrandIcon model={agentModel} seed={agentModel._selectionId} size={16} /> : <Icon name="cpu" size={14} className="text-dim" />}
                  <span className="text-[11.5px] text-body max-w-[150px] truncate">
                    {agentModel ? modelDisplayName(agentModel) : "Pick a model"}
                  </span>
                  <Icon name="chevronDown" size={11} className="text-faint" />
                </button>
                <ModelPicker open={modelOpen} onClose={() => setModelOpen(false)} anchor="top-start" />
              </div>
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

      <PermissionModal />
    </div>
  );
}
