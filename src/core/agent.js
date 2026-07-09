import { createStore, readJSON, readRaw, writeRaw, persistJSON, generateId } from "./store";
import { AgentLoop } from "../utils/agentLoop";
import { findModelBySelection } from "../api/providerRouter";
import { modelsStore } from "./models";
import { keysStore } from "./keys";
import { setIsland, clearIsland } from "./island";
import { toast } from "../ui/Toaster";

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
  permissionRequest: null, // { toolCall, category, target, stepLabel }
  executionMode: "plan_first",
  autoExecute: false,
  error: "",
});

agentStore.subscribe(() => {
  persistJSON(AGENT_CHATS_KEY, agentStore.get().chats);
});

let abortController = null;
let permissionResolve = null;

/* ── Workspace ── */

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

export async function runAgent(text) {
  const prompt = String(text || "").trim();
  if (!prompt) return;

  const s = agentStore.get();
  if (s.status === "running") return;
  if (!s.workspacePath) {
    toast.error("Pick a workspace folder first");
    return;
  }

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
  });
  setIsland({ text: "Agent: starting…", tone: "accent", spinning: true });

  let platform = { platform: "win32", preferredShell: "powershell" };
  try {
    if (window.electronAPI?.getPlatformInfo) platform = await window.electronAPI.getPlatformInfo();
  } catch {}
  const osName = platform.platform === "darwin" ? "macOS" : platform.platform === "linux" ? "Linux" : "Windows";
  const shell = platform.preferredShell || (platform.platform === "win32" ? "PowerShell" : "bash");

  const loop = new AgentLoop({
    model,
    providerKeys: keysStore.get().providers,
    workspacePath: s.workspacePath,
    electronAPI: window.electronAPI,
    osName,
    shell,
    executionMode: agentStore.get().executionMode,
    autoExecute: agentStore.get().autoExecute,
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
  });

  try {
    const result = await loop.run({ userMessage: prompt, contextMessages });
    if (result.success) {
      const finalText = result.finalText || "Done.";
      appendAgentMessage(chatId, {
        role: "assistant",
        content: finalText,
        ts: Date.now(),
        _agentMeta: { iterations: result.iterations, stats: agentStore.get().stats },
      });
      agentStore.set({ status: "done", currentStep: "" });
      const st = agentStore.get().stats;
      toast.success("Agent run complete", {
        description:
          st.filesChanged > 0 ? `${st.filesChanged} file(s) · +${st.added} −${st.removed}` : undefined,
      });
    } else {
      agentStore.set({ status: "error", error: result.error || "Agent failed.", currentStep: "" });
      toast.error("Agent run failed", { description: result.error });
    }
  } catch (err) {
    const aborted = abortController?.signal?.aborted;
    agentStore.set({
      status: aborted ? "idle" : "error",
      error: aborted ? "" : String(err?.message || "Agent crashed."),
      currentStep: "",
    });
    if (!aborted) toast.error("Agent error", { description: String(err?.message || "") });
  } finally {
    abortController = null;
    clearIsland();
  }
}
