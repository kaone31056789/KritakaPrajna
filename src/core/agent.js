import { createStore, readJSON, readRaw, writeRaw, persistJSON, generateId } from "./store";
import { AgentLoop, ToolExecutor } from "../utils/agentLoop";
import { findModelBySelection } from "../api/providerRouter";
import { modelsStore } from "./models";
import { keysStore } from "./keys";
import { setIsland, clearIsland } from "./island";
import { toast } from "../ui/Toaster";
import { calculateCost, addLifetimeCost, addMonthlySpend } from "../utils/costTracker";
import { recordProviderUsage } from "../utils/usageTracker";

/* Agent mode — wired directly to the in-app AgentLoop (files, terminal, web via IPC). */

const WORKSPACE_KEY = "openrouter_agent_workspace";
const AGENT_CHATS_KEY = "openrouter_agent_chats";
const AGENT_ACTIVE_KEY = "openrouter_agent_active_chat";

export const agentStore = createStore({
  workspacePath: readRaw(WORKSPACE_KEY, "") || "",
  chats: readJSON(AGENT_CHATS_KEY, []) || [],
  activeChatId: readRaw(AGENT_ACTIVE_KEY, "") || "",
  status: "idle", // idle | running | done | error
  plan: [],
  currentStep: "",
  timeline: [], // { id, kind: 'status'|'tool'|'terminal', ... }
  terminalLines: [],
  stats: { filesChanged: 0, added: 0, removed: 0, files: [] },
  // Token/cost usage for the CURRENT run — mirrors chat's cost tracker.
  // `estimated` is true when the provider omitted usage and we fell back to a length estimate.
  usage: { promptTokens: 0, completionTokens: 0, cost: 0, turns: 0, estimated: false },
  permissionRequest: null, // { toolCall, category, target, stepLabel }
  executionMode: "plan_first",
  autoExecute: false,
  error: "",
  awaitingPlanApproval: false, // plan-first: a plan is written to PLAN.md and waiting on Proceed/Cancel
  planFile: "", // absolute path of the PLAN.md under review
  pendingTask: "", // the original task prompt, replayed on Proceed
  focusFile: null, // { path, nonce } — signals the UI to open this file in the Files tab
  checkpoint: "", // git snapshot hash taken before the run's first mutation — enables Revert
  reverting: false,
});

agentStore.subscribe(() => {
  persistJSON(AGENT_CHATS_KEY, agentStore.get().chats);
});

let abortController = null;
let permissionResolve = null;

/* ── Workspace ── */

/* Re-arm the main-process write/read scope (allowedBasePath). This MUST run
   whenever a workspace is active — on app boot for a restored path, and before
   every run — otherwise the folder picker dialog is the only thing that arms it,
   so a restored workspace silently denies all file reads/writes. */
export async function armWorkspace(path) {
  const target = String(path || agentStore.get().workspacePath || "").trim();
  if (!target || !window.electronAPI?.setWorkspaceBase) return false;
  try {
    const r = await window.electronAPI.setWorkspaceBase(target);
    return r?.ok !== false;
  } catch {
    return false;
  }
}

/* Called once on app boot so a restored workspace is immediately usable. */
export function initAgentWorkspace() {
  const p = agentStore.get().workspacePath;
  if (p) armWorkspace(p);
}

export async function pickWorkspace() {
  if (!window.electronAPI?.selectFolder) {
    toast.error("Folder picking needs the desktop app");
    return;
  }
  const result = await window.electronAPI.selectFolder();
  const path = typeof result === "string" ? result : result?.path || result?.filePaths?.[0];
  if (!path) return;
  try {
    await window.electronAPI.setWorkspaceBase?.(path);
  } catch {}
  agentStore.set({ workspacePath: path });
  writeRaw(WORKSPACE_KEY, path);
  toast.success("Workspace connected", { description: path });
}

/* ── Agent chats ── */

export function newAgentChat() {
  const id = generateId();
  agentStore.set((s) => ({
    chats: [{ id, title: "New task", messages: [], createdAt: Date.now() }, ...s.chats],
    activeChatId: id,
    plan: [],
    timeline: [],
    terminalLines: [],
    stats: { filesChanged: 0, added: 0, removed: 0, files: [] },
    error: "",
    status: "idle",
  }));
  writeRaw(AGENT_ACTIVE_KEY, id);
  return id;
}

export function setActiveAgentChat(id) {
  agentStore.set({
    activeChatId: id,
    plan: [],
    timeline: [],
    terminalLines: [],
    stats: { filesChanged: 0, added: 0, removed: 0, files: [] },
    error: "",
    status: "idle",
  });
  writeRaw(AGENT_ACTIVE_KEY, id);
}

export function deleteAgentChat(id) {
  agentStore.set((s) => {
    const chats = s.chats.filter((c) => c.id !== id);
    const activeChatId = s.activeChatId === id ? chats[0]?.id || "" : s.activeChatId;
    writeRaw(AGENT_ACTIVE_KEY, activeChatId);
    return { chats, activeChatId };
  });
}

export function setExecutionMode(mode) {
  agentStore.set({ executionMode: mode === "direct" ? "direct" : "plan_first" });
}

export function setAutoExecute(value) {
  agentStore.set({ autoExecute: !!value });
}

/* ── Permission bridge (UI modal answers via resolvePermission) ── */

export function resolvePermission(allowed) {
  agentStore.set({ permissionRequest: null });
  const resolve = permissionResolve;
  permissionResolve = null;
  resolve?.({ allowed });
}

/* ── Run ── */

function pushTimeline(entry) {
  agentStore.set((s) => ({
    timeline: [...s.timeline.slice(-160), { id: generateId(), at: Date.now(), ...entry }],
  }));
}

function appendAgentMessage(chatId, message) {
  agentStore.set((s) => ({
    chats: s.chats.map((c) => {
      if (c.id !== chatId) return c;
      const messages = [...(c.messages || []), message];
      const title =
        c.title === "New task" && message.role === "user"
          ? String(message.content).slice(0, 44) || "New task"
          : c.title;
      return { ...c, messages, title };
    }),
  }));
}

export function stopAgent() {
  abortController?.abort();
  if (permissionResolve) resolvePermission(false);
}

/* Restore the workspace to the pre-run git checkpoint — undoes everything the
   agent changed in the last run (tracked edits restored, new files removed). */
export async function revertToCheckpoint() {
  const s = agentStore.get();
  const hash = String(s.checkpoint || "").trim();
  const cwd = String(s.workspacePath || "").trim();
  if (!hash || !cwd || s.status === "running" || s.reverting) return false;

  agentStore.set({ reverting: true });
  setIsland({ text: "Reverting agent changes…", tone: "accent", spinning: true });
  try {
    await armWorkspace(cwd);
    const executor = new ToolExecutor({
      workspacePath: cwd,
      electronAPI: window.electronAPI,
      onTerminalLine: (line) => {
        agentStore.set((st) => ({ terminalLines: [...st.terminalLines.slice(-400), String(line)] }));
      },
    });

    // Restore every file recorded in the snapshot, then delete files the run
    // created afterwards (they're absent from the snapshot tree). NEVER run a
    // blanket `git clean` — it would also delete the user's own pre-existing
    // untracked files. Restrict cleanup to paths the agent actually touched.
    const restore = await executor.runCommand(`git checkout ${hash} -- .`, cwd);
    if (!restore?.success) {
      agentStore.set({ reverting: false, error: `Revert failed: ${restore?.error || "git checkout failed"}` });
      setIsland({ text: "Revert failed", tone: "err", spinning: false });
      return false;
    }
    const touched = (s.stats?.files || []).filter(Boolean);
    if (touched.length) {
      const quoted = touched.map((p) => `"${String(p).replace(/"/g, '\\"')}"`).join(" ");
      // Only removes those paths if they're untracked (i.e. created by the run);
      // files restored by the checkout above are tracked and left alone.
      await executor.runCommand(`git clean -fd -- ${quoted}`, cwd);
    }

    agentStore.set({ reverting: false, checkpoint: "", stats: { filesChanged: 0, added: 0, removed: 0, files: [] } });
    setIsland({ text: "Workspace reverted to checkpoint", tone: "ok", spinning: false });
    return true;
  } catch (err) {
    agentStore.set({ reverting: false, error: `Revert failed: ${String(err?.message || err)}` });
    setIsland({ text: "Revert failed", tone: "err", spinning: false });
    return false;
  }
}

// Build an absolute path from the workspace root + a name, using whichever
// separator the root already uses. PLAN.md is the only caller today.
function joinPath(base, name) {
  const b = String(base || "").replace(/[\\/]+$/, "");
  const sep = b.includes("\\") ? "\\" : "/";
  return `${b}${sep}${name}`;
}

// Render approved-plan steps as an editable Markdown checklist. The user can
// hand-edit this before proceeding, so keep the shape dead simple.
function buildPlanMarkdown(steps, task) {
  const lines = ["# Plan", ""];
  if (task) lines.push(`**Task:** ${task}`, "");
  (steps || []).forEach((step, i) => {
    const text = typeof step === "string" ? step : step?.text || `Step ${i + 1}`;
    lines.push(`${i + 1}. ${text}`);
  });
  lines.push("", "---", "_Edit the steps above, then press Proceed to execute — or Cancel to discard._", "");
  return lines.join("\n");
}

// Resolve platform/shell once — shared by the initial run and the proceed pass.
async function getPlatform() {
  let platform = { platform: "win32", preferredShell: "powershell" };
  try {
    if (window.electronAPI?.getPlatformInfo) platform = await window.electronAPI.getPlatformInfo();
  } catch {}
  const osName =
    platform.platform === "darwin" ? "macOS" : platform.platform === "linux" ? "Linux" : "Windows";
  const shell = platform.preferredShell || (platform.platform === "win32" ? "PowerShell" : "bash");
  return { osName, shell };
}

// Construct an AgentLoop wired to the store. `executionMode` is passed
// explicitly so the proceed pass can force "direct" (no re-plan / no gate).
function createAgentLoop({ model, workspacePath, osName, shell, executionMode, autoExecute }) {
  return new AgentLoop({
    model,
    providerKeys: keysStore.get().providers,
    workspacePath,
    electronAPI: window.electronAPI,
    osName,
    shell,
    executionMode,
    autoExecute: autoExecute ?? agentStore.get().autoExecute,
    signal: abortController.signal,
    requestPermission: (request) =>
      new Promise((resolve) => {
        permissionResolve = resolve;
        agentStore.set({ permissionRequest: request });
        setIsland({ text: `Awaiting approval: ${request.category}`, tone: "err", spinning: false });
      }),
    onStatus: (line) => {
      agentStore.set({ currentStep: line });
      setIsland({ text: `Agent: ${line}`, tone: "accent", spinning: true });
    },
    onPlan: (steps) => {
      agentStore.set({ plan: steps });
      pushTimeline({ kind: "status", text: `Plan created (${steps.length} steps)` });
    },
    onStep: ({ step, details }) => {
      agentStore.set({ currentStep: details || step || "" });
    },
    onText: (textValue) => {
      pushTimeline({ kind: "status", text: String(textValue).slice(0, 220) });
    },
    onToolExecution: (evt) => {
      pushTimeline({ kind: "tool", ...evt });
      if (evt.status === "success" && evt.meta?.path) {
        agentStore.set((st) => {
          const files = st.stats.files.includes(evt.meta.path)
            ? st.stats.files
            : [...st.stats.files, evt.meta.path];
          return {
            stats: {
              filesChanged: files.length,
              added: st.stats.added + (evt.meta.added || 0),
              removed: st.stats.removed + (evt.meta.removed || 0),
              files,
            },
          };
        });
      }
    },
    onTerminalLine: (line) => {
      agentStore.set((st) => ({ terminalLines: [...st.terminalLines.slice(-400), String(line)] }));
    },
    // Snapshot hash captured by the loop before its first mutating tool.
    onCheckpoint: (hash) => {
      agentStore.set({ checkpoint: String(hash || "") });
    },
    // Per-turn token usage → running cost. Mirrors the chat cost tracker:
    // real usage from the provider when present, otherwise a length estimate.
    onUsage: (usage) => {
      if (!usage) return;
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;
      const turnCost = usage.cost ?? calculateCost(usage, model.pricing);
      agentStore.set((st) => ({
        usage: {
          promptTokens: st.usage.promptTokens + promptTokens,
          completionTokens: st.usage.completionTokens + completionTokens,
          cost: st.usage.cost + (turnCost || 0),
          turns: st.usage.turns + 1,
          estimated: st.usage.estimated || !!usage.estimated,
        },
      }));
      recordProviderUsage(model._provider, usage, turnCost || 0);
      if (turnCost > 0) {
        addLifetimeCost(turnCost);
        addMonthlySpend(turnCost);
      }
    },
  });
}

// Append the assistant's final message and surface the run-summary toast.
/* Desktop notification when a run finishes while the window is unfocused —
   long agent runs usually mean the user has tabbed away. */
function notifyRunFinished(ok, description) {
  try {
    if (typeof Notification === "undefined" || document.hasFocus()) return;
    const title = ok ? "Agent run complete" : "Agent run failed";
    const fire = () => new Notification(title, { body: String(description || "").slice(0, 180), silent: false });
    if (Notification.permission === "granted") fire();
    else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((p) => { if (p === "granted") fire(); }).catch(() => {});
    }
  } catch { /* notifications unavailable in this environment — non-fatal */ }
}

function appendAssistantResult(chatId, result) {
  const finalText = result.finalText || "Done.";
  appendAgentMessage(chatId, {
    role: "assistant",
    content: finalText,
    ts: Date.now(),
    _agentMeta: { iterations: result.iterations, stats: agentStore.get().stats },
  });
  agentStore.set({ status: "done", currentStep: "" });
  const st = agentStore.get().stats;
  const summary =
    st.filesChanged > 0 ? `${st.filesChanged} file(s) · +${st.added} −${st.removed}` : undefined;
  toast.success("Agent run complete", { description: summary });
  notifyRunFinished(true, summary || finalText);
}

// Normalize a thrown/aborted run into store state + a toast.
function handleRunError(err) {
  const aborted = abortController?.signal?.aborted;
  agentStore.set({
    status: aborted ? "idle" : "error",
    error: aborted ? "" : String(err?.message || "Agent crashed."),
    currentStep: "",
  });
  if (!aborted) toast.error("Agent error", { description: String(err?.message || "") });
}

// Plan-first: the loop stopped after producing a plan. Write it to PLAN.md,
// open that file in the UI, and park the run awaiting Proceed/Cancel.
async function presentPlanForApproval(chatId, result, task) {
  const { workspacePath } = agentStore.get();
  const planFile = joinPath(workspacePath, "PLAN.md");
  const markdown = buildPlanMarkdown(result.planSteps, task);
  let wrote = false;
  try {
    const res = await window.electronAPI?.writeFile?.(planFile, markdown);
    wrote = res?.success !== false;
  } catch {
    wrote = false;
  }

  appendAgentMessage(chatId, {
    role: "assistant",
    content: wrote
      ? "I've written a plan to `PLAN.md` and opened it for review. Edit the steps if you like, then press **Proceed** to execute or **Cancel** to discard."
      : `Here's the plan for review. Press **Proceed** to execute or **Cancel** to discard.\n\n${markdown}`,
    ts: Date.now(),
    _agentMeta: { iterations: result.iterations, planReview: true },
  });

  agentStore.set({
    status: "idle",
    currentStep: "",
    awaitingPlanApproval: true,
    planFile: wrote ? planFile : "",
    pendingTask: task,
    // Nudge the UI to open the plan file in the Files tab.
    focusFile: wrote ? { path: planFile, nonce: Date.now() } : null,
  });
  clearIsland();
  toast("Plan ready for review", { description: "Edit PLAN.md, then Proceed or Cancel." });
}

export async function runAgent(text) {
  const prompt = String(text || "").trim();
  if (!prompt) return;

  const s = agentStore.get();
  if (s.status === "running") return;
  if (s.awaitingPlanApproval) {
    toast.error("Resolve the pending plan first", {
      description: "Proceed or Cancel the current plan.",
    });
    return;
  }
  if (!s.workspacePath) {
    toast.error("Pick a workspace folder first");
    return;
  }

  // Re-arm the main-process file scope every run — a restored workspace never
  // went through the picker dialog, so without this all reads/writes are denied.
  await armWorkspace(s.workspacePath);

  const { models, selectedId } = modelsStore.get();
  const model = findModelBySelection(models, selectedId);
  if (!model) {
    toast.error("Select a model first");
    return;
  }

  let chatId = s.activeChatId;
  if (!chatId || !s.chats.some((c) => c.id === chatId)) chatId = newAgentChat();

  const contextMessages = (agentStore.get().chats.find((c) => c.id === chatId)?.messages || []).filter(
    (m) => m.role === "user" || m.role === "assistant"
  );
  appendAgentMessage(chatId, { role: "user", content: prompt, ts: Date.now() });

  abortController = new AbortController();
  agentStore.set({
    status: "running",
    error: "",
    plan: [],
    timeline: [],
    terminalLines: [],
    stats: { filesChanged: 0, added: 0, removed: 0, files: [] },
    // Fresh task → reset the per-run usage meter (lifetime cost persists separately).
    usage: { promptTokens: 0, completionTokens: 0, cost: 0, turns: 0, estimated: false },
    focusFile: null,
    checkpoint: "",
  });
  setIsland({ text: "Agent: starting…", tone: "accent", spinning: true });

  // Plan-first is the ceremony for the FIRST turn of a task: describe → plan →
  // approve → execute. Once a task is underway, follow-up turns ("continue",
  // "also add X") continue the work directly instead of re-planning and bouncing
  // back to review on every write (the user supervises live with Stop, and a
  // proper permission modal still guards writes when Auto-approve is off). Want a
  // fresh plan? Start a New task. This is what stops the "asks every time" loop.
  const isFollowUp = contextMessages.length > 0;
  const effectiveMode =
    agentStore.get().executionMode === "plan_first" && !isFollowUp ? "plan_first" : "direct";

  const { osName, shell } = await getPlatform();
  const loop = createAgentLoop({
    model,
    workspacePath: s.workspacePath,
    osName,
    shell,
    executionMode: effectiveMode,
  });

  try {
    const result = await loop.run({ userMessage: prompt, contextMessages });
    if (result.success && result.awaitingApproval) {
      // Plan-first stopped after the plan — park it for Proceed/Cancel.
      await presentPlanForApproval(chatId, result, prompt);
    } else if (result.success) {
      appendAssistantResult(chatId, result);
    } else {
      agentStore.set({ status: "error", error: result.error || "Agent failed.", currentStep: "" });
      toast.error("Agent run failed", { description: result.error });
      notifyRunFinished(false, result.error || "Agent failed.");
    }
  } catch (err) {
    handleRunError(err);
  } finally {
    abortController = null;
    // Keep the island up while a plan waits on the user; otherwise clear it.
    if (!agentStore.get().awaitingPlanApproval) clearIsland();
  }
}

// Proceed: the user approved (and possibly edited) PLAN.md. Read it back and
// execute it as a direct-mode run so the loop follows the plan without
// re-planning or re-gating at the first write.
export async function proceedWithPlan() {
  const s = agentStore.get();
  if (!s.awaitingPlanApproval || s.status === "running") return;
  if (!s.workspacePath) {
    toast.error("Pick a workspace folder first");
    return;
  }

  await armWorkspace(s.workspacePath);

  const { models, selectedId } = modelsStore.get();
  const model = findModelBySelection(models, selectedId);
  if (!model) {
    toast.error("Select a model first");
    return;
  }

  // Prefer the on-disk PLAN.md (captures the user's edits); fall back to the task.
  let planText = "";
  if (s.planFile) {
    try {
      const res = await window.electronAPI?.readFile?.(s.planFile);
      if (res?.success !== false) planText = String(res?.content ?? res ?? "");
    } catch {}
  }

  let chatId = s.activeChatId;
  if (!chatId || !s.chats.some((c) => c.id === chatId)) chatId = newAgentChat();

  const contextMessages = (agentStore.get().chats.find((c) => c.id === chatId)?.messages || []).filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  const execPrompt = planText.trim()
    ? `The plan below was approved. Execute it now, step by step. Do not re-plan — make the changes directly.\n\n${planText.trim()}`
    : `The plan was approved. Execute the task now, step by step, making the changes directly:\n\n${s.pendingTask || ""}`;

  appendAgentMessage(chatId, {
    role: "user",
    content: "Proceed with the approved plan.",
    ts: Date.now(),
  });

  abortController = new AbortController();
  agentStore.set({
    status: "running",
    error: "",
    timeline: [],
    terminalLines: [],
    stats: { filesChanged: 0, added: 0, removed: 0, files: [] },
    awaitingPlanApproval: false,
    focusFile: null,
  });
  setIsland({ text: "Agent: executing plan…", tone: "accent", spinning: true });

  const { osName, shell } = await getPlatform();
  const loop = createAgentLoop({
    model,
    workspacePath: s.workspacePath,
    osName,
    shell,
    executionMode: "direct", // approved — run straight through, no re-plan
    // The user already reviewed and approved the whole plan, so that approval
    // IS the authorization. Execute straight through without re-prompting for
    // every write/command — otherwise "Plan first" asks for approval twice.
    autoExecute: true,
  });

  try {
    const result = await loop.run({ userMessage: execPrompt, contextMessages });
    if (result.success) {
      appendAssistantResult(chatId, result);
    } else {
      agentStore.set({ status: "error", error: result.error || "Agent failed.", currentStep: "" });
      toast.error("Agent run failed", { description: result.error });
      notifyRunFinished(false, result.error || "Agent failed.");
    }
  } catch (err) {
    handleRunError(err);
  } finally {
    abortController = null;
    agentStore.set({ planFile: "", pendingTask: "" });
    clearIsland();
  }
}

// Cancel: discard the pending plan and return to idle. Nothing is executed.
export function cancelPlan() {
  const s = agentStore.get();
  if (!s.awaitingPlanApproval) return;
  if (s.activeChatId) {
    appendAgentMessage(s.activeChatId, {
      role: "assistant",
      content: "Plan cancelled. Nothing was executed.",
      ts: Date.now(),
    });
  }
  agentStore.set({
    status: "idle",
    currentStep: "",
    awaitingPlanApproval: false,
    planFile: "",
    pendingTask: "",
    focusFile: null,
  });
  clearIsland();
  toast("Plan cancelled");
}
