import React, { useState, useEffect, useRef, useCallback } from "react";

const SHELL_LANGUAGES = new Set([
  "bash", "sh", "shell", "zsh", "fish",
  "cmd", "batch", "bat",
  "powershell", "ps", "ps1",
  "terminal", "console", "command",
]);

export const AUTORUN_KEY = "kp_terminal_autorun";

export function getAutoRun() {
  return localStorage.getItem(AUTORUN_KEY) === "true";
}
export function setAutoRun(val) {
  localStorage.setItem(AUTORUN_KEY, val ? "true" : "false");
  window.dispatchEvent(new CustomEvent("kp-autorun-change", { detail: val }));
}

/** Returns true if this code-block language should be treated as a shell command */
export function isShellLanguage(lang) {
  return SHELL_LANGUAGES.has((lang || "").toLowerCase());
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconPlay() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function IconStop() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}
function IconX() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ── Mode toggle pill ───────────────────────────────────────────────────────────

function ModeToggle({ autoRun, onChange }) {
  return (
    <button
      onClick={() => onChange(!autoRun)}
      title={autoRun ? "Auto-run is ON — click to switch to Ask mode" : "Ask mode — click to enable Auto-run"}
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-semibold border transition-colors font-mono ${
        autoRun
          ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
          : "bg-[#1a1a1a] border-[#2a2a2a] text-[#b0b0b0]/50 hover:text-[#e0e0e0] hover:bg-[#2a2a2a]"
      }`}
    >
      {autoRun ? (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Auto-run
        </>
      ) : (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-[#b0b0b0]/30" />
          Ask
        </>
      )}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * Interactive terminal panel rendered inside AI message code blocks.
 *
 * Modes (stored in localStorage):
 *   Auto-run — executes the command immediately on mount
 *   Ask      — shows Run / Edit / Cancel buttons (default)
 */
export default function TerminalPanel({ command: initialCommand, language }) {
  const [cmd, setCmd] = useState(initialCommand);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(initialCommand);
  const [status, setStatus] = useState("idle"); // idle | running | done | blocked | dismissed
  const [output, setOutput] = useState([]);
  const [exitCode, setExitCode] = useState(null);
  const [processId, setProcessId] = useState(null);
  const [blockReason, setBlockReason] = useState("");
  const [autoRun, setAutoRunState] = useState(getAutoRun);

  const outputRef = useRef(null);
  const hasAutoRan = useRef(false);
  const isElectron = !!window.electronAPI?.executeCommand;

  // Listen for global toggle changes from Settings panel
  useEffect(() => {
    const handler = (e) => setAutoRunState(e.detail);
    window.addEventListener("kp-autorun-change", handler);
    return () => window.removeEventListener("kp-autorun-change", handler);
  }, []);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // Subscribe to IPC events for *this* process
  useEffect(() => {
    if (!isElectron || processId === null) return;
    const unsubOutput = window.electronAPI.onTerminalOutput(({ id, type, data }) => {
      if (id !== processId) return;
      setOutput((prev) => [...prev, { type, text: data }]);
    });
    const unsubDone = window.electronAPI.onTerminalDone(({ id, code, error }) => {
      if (id !== processId) return;
      if (error) setOutput((prev) => [...prev, { type: "stderr", text: error }]);
      setExitCode(code);
      setStatus("done");
      // Dispatch output so ChatApp can feed it back to the AI
      setOutput((prev) => {
        const fullOutput = prev.map((l) => l.text).join("") + (error ? error : "");
        window.dispatchEvent(new CustomEvent("kp-command-done", {
          detail: { cmd, output: fullOutput, exitCode: code ?? -1 },
        }));
        return prev;
      });
    });
    return () => { unsubOutput(); unsubDone(); };
  }, [processId, isElectron]);

  const handleRun = useCallback(async (cmdOverride) => {
    if (!isElectron) return;
    const toRun = cmdOverride || cmd;
    setOutput([]);
    setExitCode(null);
    setStatus("running");
    const result = await window.electronAPI.executeCommand(toRun);
    if (!result.ok) {
      setBlockReason(result.error);
      setStatus("blocked");
      // Feed blocked error back to AI
      window.dispatchEvent(new CustomEvent("kp-command-done", {
        detail: { cmd: toRun, output: result.error, exitCode: -1, blocked: true },
      }));
      return;
    }
    setProcessId(result.id);
  }, [cmd, isElectron]);

  // Auto-run on mount if enabled
  useEffect(() => {
    if (!autoRun || !isElectron || hasAutoRan.current || status !== "idle") return;
    hasAutoRan.current = true;
    // Small delay so the UI renders first
    const t = setTimeout(() => handleRun(cmd), 300);
    return () => clearTimeout(t);
  }, [autoRun, isElectron, handleRun, cmd, status]);

  const handleKill = useCallback(async () => {
    if (!isElectron || processId === null) return;
    await window.electronAPI.killCommand(processId);
    setOutput((prev) => [...prev, { type: "info", text: "Process terminated by user." }]);
    setStatus("done");
    setExitCode(-1);
  }, [processId, isElectron]);

  const handleEditSave = useCallback(() => {
    const next = editDraft.trim() || cmd;
    setCmd(next);
    setEditing(false);
  }, [editDraft, cmd]);

  const handleEditKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
    if (e.key === "Escape") { setEditing(false); setEditDraft(cmd); }
  }, [handleEditSave, cmd]);

  const handleToggleMode = useCallback((val) => {
    setAutoRun(val);      // persist + broadcast
    setAutoRunState(val); // local update
  }, []);

  if (status === "dismissed") return null;

  const langLabel = (language || "Shell").charAt(0).toUpperCase() + (language || "Shell").slice(1);

  return (
    <div className="my-3 rounded-sm overflow-hidden border border-[#00ff41]/25 bg-[#0d0d0d]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#00ff41]/[0.08] border-b border-[#00ff41]/20 inner-highlight">
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-[#00ff41]/80" fill="currentColor" viewBox="0 0 24 24">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span className="text-[11px] font-semibold text-[#00ff41]/90 tracking-wide uppercase font-mono">
            Suggested Command
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isElectron && (
            <ModeToggle autoRun={autoRun} onChange={handleToggleMode} />
          )}
          <span className="text-[10px] text-[#00ff41]/50 font-mono">{langLabel}</span>
        </div>
      </div>

      {/* ── Auto-run countdown banner ── */}
      {autoRun && status === "running" && hasAutoRan.current && (
        <div className="px-3 py-1 bg-emerald-500/[0.06] border-b border-emerald-500/10 text-[11px] text-emerald-400/70 flex items-center gap-1.5 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Auto-running…
        </div>
      )}

      {/* ── Command display / edit ── */}
      <div className="px-3 py-2.5 border-b border-[#1a1a1a]">
        {editing ? (
          <textarea
            autoFocus
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={handleEditKeyDown}
            rows={Math.min(editDraft.split("\n").length + 1, 6)}
            className="w-full bg-transparent text-[#00ff41] font-mono text-[13px] resize-none outline-none"
            spellCheck={false}
          />
        ) : (
          <pre className="font-mono text-[13px] text-[#00ff41] whitespace-pre-wrap break-all leading-relaxed">
            {cmd}
          </pre>
        )}
      </div>

      {/* ── Action buttons — shown in Ask mode when idle/blocked ── */}
      {!autoRun && (status === "idle" || status === "blocked") && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a1a]">
          {isElectron ? (
            <>
              {editing ? (
                <>
                  <button
                    onClick={handleEditSave}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[12px] font-medium bg-[#00ff41]/20 text-[#00ff41] hover:bg-[#00ff41]/30 transition-colors font-mono"
                  >
                    <IconPlay /> Save &amp; Run
                  </button>
                  <button
                    onClick={() => { setEditing(false); setEditDraft(cmd); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[12px] text-[#b0b0b0]/50 hover:text-[#e0e0e0] hover:bg-[#1a1a1a] transition-colors font-mono"
                  >
                    Cancel edit
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleRun()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[12px] font-medium bg-[#00ff41]/20 text-[#00ff41] hover:bg-[#00ff41]/30 transition-colors font-mono"
                  >
                    <IconPlay /> Run
                  </button>
                  <button
                    onClick={() => { setEditing(true); setEditDraft(cmd); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[12px] text-[#b0b0b0] hover:text-[#e0e0e0] hover:bg-[#1a1a1a] transition-colors font-mono"
                  >
                    <IconEdit /> Edit
                  </button>
                  <button
                    onClick={() => setStatus("dismissed")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[12px] text-[#b0b0b0]/50 hover:text-[#e0e0e0] hover:bg-[#1a1a1a] transition-colors font-mono"
                  >
                    <IconX /> Cancel
                  </button>
                </>
              )}
            </>
          ) : (
            <span className="text-[11px] text-[#b0b0b0]/40 italic font-mono">
              Terminal execution is only available in the desktop app.
            </span>
          )}
          {status === "blocked" && (
            <span className="ml-2 text-[11px] text-red-400 font-mono">Blocked: {blockReason}</span>
          )}
        </div>
      )}

      {/* ── Auto-run mode: Edit / Cancel while idle ── */}
      {autoRun && status === "idle" && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a1a]">
          <button
            onClick={() => { setEditing((v) => !v); setEditDraft(cmd); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[12px] text-[#b0b0b0] hover:text-[#e0e0e0] hover:bg-[#1a1a1a] transition-colors font-mono"
          >
            <IconEdit /> Edit before run
          </button>
          <button
            onClick={() => setStatus("dismissed")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[12px] text-[#b0b0b0]/50 hover:text-[#e0e0e0] hover:bg-[#1a1a1a] transition-colors font-mono"
          >
            <IconX /> Cancel
          </button>
        </div>
      )}

      {/* ── Running bar ── */}
      {status === "running" && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a1a]">
          <span className="flex items-center gap-1.5 text-[11px] text-[#00ff41]/70 font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00ff41] animate-pulse" />
            Running…
          </span>
          <button
            onClick={handleKill}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[12px] text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors font-mono"
          >
            <IconStop /> Kill
          </button>
        </div>
      )}

      {/* ── Blocked error in auto-run mode ── */}
      {status === "blocked" && autoRun && (
        <div className="px-3 py-2 border-b border-red-500/10 text-[11px] text-red-400 font-mono">
          Blocked: {blockReason}
        </div>
      )}

      {/* ── Output ── */}
      {(output.length > 0 || status === "done") && (
        <div
          ref={outputRef}
          className="max-h-64 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed shadow-inner-shadow"
          style={{ background: "#050505" }}
        >
          {output.map((line, i) => (
            <div
              key={i}
              className={
                line.type === "stderr"
                  ? "text-red-400 whitespace-pre-wrap"
                  : line.type === "info"
                  ? "text-[#b0b0b0]/50 italic whitespace-pre-wrap"
                  : "text-[#00ff41]/90 whitespace-pre-wrap"
              }
            >
              {line.text}
            </div>
          ))}

          {status === "done" && exitCode !== null && (
            <div className="mt-1.5 pt-1.5 border-t border-[#1a1a1a]">
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-sm font-mono ${
                  exitCode === 0
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-red-500/15 text-red-400"
                }`}
              >
                {exitCode === 0 ? (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                exit {exitCode}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
