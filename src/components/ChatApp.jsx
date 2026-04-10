import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchAllModels, routeStream, fetchCredits, suggestFallbackAcrossProviders, findModelBySelection, toSelectionId, isImageGenModel, routeImageGen } from "../api/providerRouter";
import ModelSelector from "./ModelSelector";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import AgentIdeWorkspace from "./AgentIdeWorkspace";
import SettingsPanel from "./SettingsPanel";
import SmartModelBanner from "./SmartModelBanner";
import PromptBanners from "./PromptBanners";
import ModelAdvisorPanel, { AdvisorToggle } from "./ModelAdvisorCard";
import TitleBar from "./TitleBar";
import KPLogo from "./KPLogo";
import PersonaSelector from "./PersonaSelector";
import CompareModal from "./CompareModal";
import { DEFAULT_PERSONAS } from "./PersonaEditor";
import { detectTaskType, detectUiTask, selectSmartModel, qualityScore, filterModelsForTask, supportsTask, uiTaskToAdvisorTask } from "../utils/smartModelSelect";
import { calculateCost, isModelFree, formatCost, calcSessionCost, estimateUsageFromMessages } from "../utils/costTracker";
import { parseCommand, buildCommandPrompt, resolveFromAttachments, loadCustomCommands, saveCustomCommands, getAllCommandHints } from "../utils/commandParser";
import { recordSuccess, recordFailure, isModelUnavailable, findFallbackModel, findCheapestModel, getModelHealth } from "../utils/rateLimiter";
import { generateAdvisorData } from "../utils/modelAdvisor";
import { loadLiveRankingSignals } from "../utils/advisorRanking";
import { loadProviderUsage, providerUsageRows, recordProviderUsage } from "../utils/usageTracker";
import { supportsReasoningModel } from "../utils/reasoningControls";
import { fetchCloudUsage as fetchOllamaCloudUsage } from "../api/ollama";
import { eventToShortcut, mergeShortcuts, normalizeShortcutString } from "../utils/keyboardShortcuts";
import {
  USER_MEMORY_STORAGE_KEY,
  DEFAULT_USER_MEMORY,
  normalizeUserMemory,
  mergeUserMemory,
  detectMemoryFromMessage,
  buildSystemPromptWithMemory,
  hasUserMemory,
} from "../utils/userMemory";
import { extractMemoryWithAI } from "../utils/aiMemoryExtractor";
import { fetchAllWebContent, buildWebContext, parseWebCommand, extractUrlsFromText, fetchWebPage, webSearch, deepArticleSearch, mergeWebSources } from "../utils/webFetcher";
import { isTerminalIntent, isWebIntent, isDetailedIntent, isRealWorldQuery, isNewsIntent, buildSearchQuery } from "../utils/intentDetector";
import {
  DEFAULT_TOKEN_OPTIMIZATION_CONFIG,
  buildFallbackHistorySummary,
  buildHistorySummaryPrompt,
  buildSlidingWindowHistory,
  compressSystemPrompt,
  enforceInputTokenBudget,
  estimateTokensFromMessages,
  estimateTokensFromText,
  normalizeUserInputForSend,
  pickCheapestSummaryModel,
  resolveAdaptiveTokenBudgets,
  resolveGenerationSettings,
  shouldRelaxTokenMode,
  tieredCompress,
  resolveDeepAnalysisConfig,
} from "../utils/tokenOptimizer";
import {
  getCachedResponseEntry,
  loadSessionResponseCache,
  makeResponseCacheKey,
  setCachedResponseEntry,
  findSemanticMatch,
  isSemanticCacheEnabled,
} from "../utils/responseCache";
import { semanticPrune } from "../utils/semanticPruner";
import { recordTokenUsage, predictTokenBudget } from "../utils/tokenPredictor";
import { isDistillationEnabled } from "../utils/promptDistiller";
import TokenBudgetMeter from "./TokenBudgetMeter";
import PromptDistillPreview from "./PromptDistillPreview";
import ChatSearch from "./ChatSearch";
import { mapOpenCodeEvent } from "../utils/opencodeStreamParser";
import { AgentLoop } from "../utils/agentLoop";

const ease = [0.4, 0, 0.2, 1];
const CHATS_KEY = "openrouter_chats";
const ACTIVE_CHAT_KEY = "openrouter_active_chat";
const SECONDARY_CHAT_KEY = "openrouter_secondary_chat";
const LAST_MODEL_KEY = "openrouter_last_model";
const MODEL_PREF_KEY = "openrouter_model_pref";
const TASK_PREF_KEY = "openrouter_task_pref";
const REASONING_DEPTH_KEY = "openrouter_reasoning_depth";
const SYSTEM_PROMPT_KEY = "openrouter_system_prompt";
const PERSONAS_KEY = "kp_chat_personas";
const FOLDERS_KEY = "kp_chat_folders";
const ADVISOR_PREFS_KEY = "openrouter_advisor_prefs";
const RESPONSE_LENGTH_KEY = "openrouter_response_length";
const HISTORY_WINDOW_KEY = "openrouter_history_window";
const MAX_INPUT_TOKENS_KEY = "openrouter_max_input_tokens";
const MAX_USER_CHARS_KEY = "openrouter_max_user_chars";
const MODE_KEY = "openrouter_interaction_mode";
const AGENT_WORKSPACE_KEY = "openrouter_agent_workspace";
const AGENT_CHATS_KEY = "openrouter_agent_chats";
const AGENT_ACTIVE_CHAT_KEY = "openrouter_agent_active_chat";
const AGENT_UI_ONLY_MODE = true;

// TOKEN OPTIMIZATION: concise default system instructions (bullet-heavy, low token overhead).
const DEFAULT_SYSTEM_PROMPT = `KritakaPrajna assistant rules:
- Answer directly and concisely.
- Do not use reasoning headers like "Approach", "Analyze", "Reason", or "Solve".
- For code: use fenced code blocks with language tags; keep edits minimal and explain briefly.
- For terminal commands: always use fenced blocks. Windows -> powershell/cmd, macOS/Linux -> bash/sh.
- For terminal output: confirm success on exit 0; diagnose failures and provide a fixed command block.
- For web sources: cite as [1], [2] and keep final source list concise (max 5 unique lines).`;

const WEB_INTENT_HINT = `\n\n[SYSTEM NOTE: The user is asking for real-time or recent information. Web search was attempted but returned no results. Do NOT say you cannot browse the internet. Instead, answer using your training knowledge up to your cutoff date, clearly state your knowledge cutoff, and provide your best answer with any relevant details you know. If specific recent events are beyond your cutoff, say so briefly and give context from what you do know.]`;
const EXPLICIT_WEB_TRIGGER_RE = /\b(websearch|web\s*search|search (the )?(web|internet|online)|browse (the )?(web|internet|online)|look (it )?up( online| on (the )?web)?|find (latest|recent|current) (news|updates?|info|information)|do (a )?web\s*search|use (the )?web|from (the )?web)\b/i;

function detectPlatformFromNavigator() {
  const ua = String(navigator?.userAgent || "").toLowerCase();
  if (ua.includes("windows")) return "win32";
  if (ua.includes("mac os") || ua.includes("macos")) return "darwin";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

function platformToOsName(platform) {
  const value = String(platform || "").toLowerCase();
  if (value === "win32") return "Windows";
  if (value === "darwin") return "macOS";
  if (value === "linux") return "Linux";
  return "Unknown";
}

function platformToShell(platform, preferredShell) {
  const preferred = String(preferredShell || "").trim();
  if (preferred) return preferred;
  return String(platform || "").toLowerCase() === "win32" ? "PowerShell" : "bash";
}

function buildTerminalIntentHint(platformInfo) {
  const platform = platformInfo?.platform || detectPlatformFromNavigator();
  if (platform === "win32") {
    return `\n\n[SYSTEM NOTE: The user wants a terminal command on Windows. Use Windows-native commands and respond with a \`\`\`powershell fenced block (or \`\`\`cmd when needed). Do NOT use Linux/macOS commands like sudo, apt, or bash unless the user explicitly asks for WSL/Linux.]`;
  }
  if (platform === "darwin") {
    return `\n\n[SYSTEM NOTE: The user wants a terminal command on macOS. Use macOS-compatible commands and respond with a \`\`\`bash or \`\`\`sh fenced block.]`;
  }
  return `\n\n[SYSTEM NOTE: The user wants a terminal command. Respond with the command inside a \`\`\`bash or \`\`\`sh fenced code block — not as plain text or inline code.]`;
}

function preferredTerminalFence(platformInfo) {
  const platform = platformInfo?.platform || detectPlatformFromNavigator();
  return platform === "win32" ? "powershell" : "bash";
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadChats() {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadAgentChats() {
  try {
    const raw = localStorage.getItem(AGENT_CHATS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveChats(chats) {
  localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

function saveAgentChats(chats) {
  localStorage.setItem(AGENT_CHATS_KEY, JSON.stringify(chats));
}

function loadActiveId() {
  return localStorage.getItem(ACTIVE_CHAT_KEY) || "";
}

function loadAgentActiveId() {
  return localStorage.getItem(AGENT_ACTIVE_CHAT_KEY) || "";
}

function saveActiveId(id) {
  localStorage.setItem(ACTIVE_CHAT_KEY, id);
}

function saveAgentActiveId(id) {
  localStorage.setItem(AGENT_ACTIVE_CHAT_KEY, id || "");
}

function loadSecondaryId() {
  return localStorage.getItem(SECONDARY_CHAT_KEY) || "";
}

function saveSecondaryId(id) {
  localStorage.setItem(SECONDARY_CHAT_KEY, id || "");
}

function loadNumericSetting(key, fallback, min = 1, max = 200000) {
  try {
    const parsed = Number(localStorage.getItem(key));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  } catch {
    return fallback;
  }
}

function loadResponseLengthSetting() {
  try {
    const raw = String(localStorage.getItem(RESPONSE_LENGTH_KEY) || "").trim();
    if (["short", "medium", "long"].includes(raw)) return raw;
  } catch { }
  return "medium";
}

/** Derive a title from the first user message, or fallback */
function deriveTitle(messages) {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New Chat";
  // content may be an array (multimodal) or string
  const raw = Array.isArray(first.content)
    ? first.content.find((p) => p.type === "text")?.text || ""
    : first.content;
  const text = raw.slice(0, 50);
  return text.length < raw.length ? text + "…" : text;
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5 MB

/** Extract text from a PDF file entirely in the renderer using pdfjs-dist */
async function parsePdfFile(file) {
  const pdfjsLib = await import("pdfjs-dist");
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url
    ).href;
  }
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ").trim();
    if (pageText) pages.push(pageText);
  }
  return pages.join("\n\n");
}

function fileExt(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function modelSelectionId(model) {
  return model?._selectionId || model?.id || "";
}

function providerLabel(provider) {
  switch (provider) {
    case "openrouter": return "OpenRouter";
    case "huggingface": return "Hugging Face";
    case "ollama": return "Ollama";
    case "openai": return "OpenAI";
    case "anthropic": return "Anthropic";
    default: return provider || "Unknown";
  }
}

function isOllamaCloudKeyConfig(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return !/^https?:\/\//i.test(raw) && !raw.includes("localhost") && !raw.includes("127.0.0.1");
}

const DEEP_ANALYSIS_UI_RE = /\b(deep analysis|analyze deeply|in-depth analysis|detailed analysis|thorough analysis|deep dive|strategic analysis|comprehensive analysis)\b/i;
function isDeepAnalysisPrompt(value) {
  return DEEP_ANALYSIS_UI_RE.test(String(value || ""));
}

function formatCloudUsagePercent(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "n/a";
  if (amount >= 99.95) return "100%";
  if (amount >= 10) return `${Math.round(amount)}%`;
  if (amount >= 1) return `${amount.toFixed(1)}%`;
  return `${amount.toFixed(2)}%`;
}

function isFreePricedModel(model) {
  const prompt = Number(model?.pricing?.prompt);
  const completion = Number(model?.pricing?.completion);
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
}

export default function ChatApp({ providers, onSaveProviderKey, onRemoveProviderKey, onResetAll }) {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(LAST_MODEL_KEY) || "");
  const [selectedTask, setSelectedTask] = useState(() => {
    const savedTask = localStorage.getItem(TASK_PREF_KEY) || "text-generation";
    return (savedTask === "more" || savedTask === "any-to-any") ? "text-generation" : savedTask;
  });
  const [reasoningDepth, setReasoningDepth] = useState(() => localStorage.getItem(REASONING_DEPTH_KEY) || "balanced");
  const [chats, setChats] = useState(loadChats);
  const [personas, setPersonas] = useState(() => {
    try {
      const stored = localStorage.getItem(PERSONAS_KEY);
      return stored ? JSON.parse(stored) : DEFAULT_PERSONAS;
    } catch {
      return DEFAULT_PERSONAS;
    }
  });
  const handleSavePersonas = (p) => {
    setPersonas(p);
    localStorage.setItem(PERSONAS_KEY, JSON.stringify(p));
  };
  const [folders, setFolders] = useState(() => {
    try {
      const stored = localStorage.getItem(FOLDERS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const handleSaveFolders = (f) => {
    setFolders(f);
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(f));
  };
  const [activeChatId, setActiveChatId] = useState(loadActiveId);
  const [agentChats, setAgentChats] = useState(loadAgentChats);
  const [activeAgentChatId, setActiveAgentChatId] = useState(loadAgentActiveId);
  const [secondaryChatId, setSecondaryChatId] = useState(loadSecondaryId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [retryModelSearch, setRetryModelSearch] = useState("");
  const [retryModelFilter, setRetryModelFilter] = useState("all");
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [uploads, setUploads] = useState([]); // { id, name, type, dataUrl?, content?, size, ext }
  const [smartSuggestion, setSmartSuggestion] = useState(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [modelPref, setModelPref] = useState(() => localStorage.getItem(MODEL_PREF_KEY) || "auto");
  const [lifetimeCost, setLifetimeCost] = useState(null); // { total_credits, total_usage } from API
  const [appVersion, setAppVersion] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [customCommands, setCustomCommands] = useState(loadCustomCommands);
  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem(SYSTEM_PROMPT_KEY) || DEFAULT_SYSTEM_PROMPT);
  const [responseLength, setResponseLength] = useState(loadResponseLengthSetting);
  const [advisorPrefs, setAdvisorPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(ADVISOR_PREFS_KEY)) || { preferFree: false, preferBest: false, showAdvisor: true }; }
    catch { return { preferFree: false, preferBest: false, showAdvisor: true }; }
  });
  const [tokenNotice, setTokenNotice] = useState("");
  const [draftInputText, setDraftInputText] = useState("");
  const [lastTokenStats, setLastTokenStats] = useState({ sent: 0, received: 0 });
  const [tokenBudgetInfo, setTokenBudgetInfo] = useState(null);
  const abortRef = useRef(null);
  const responseCacheRef = useRef(loadSessionResponseCache());
  const systemPromptCacheRef = useRef(new Map());

  // ── Last request tracking (for retry/regenerate) ──
  const lastRequestRef = useRef(null); // { text, uploads, attachedFiles, modelUsed, chatId }

  // ── Terminal output feedback: read AI output and react ──────────────────────
  // Ref so the event handler always sees the latest handleSend without re-subscribing
  const handleSendRef = useRef(null);

  // ── Prompt-based banners state ──
  const [taskBanner, setTaskBanner] = useState(null); // { visible, taskType, suggestedModelId }
  const [rateLimitBanner, setRateLimitBanner] = useState(null); // { visible, modelId, fallbackModelId }
  const [cheapestBanner, setCheapestBanner] = useState(null); // { visible, cheapestLabel, cheapestModelId, currentModelId }
  const [lastError, setLastError] = useState(null);

  const [isSearching, setIsSearching] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareTargetChatId, setCompareTargetChatId] = useState(null);

  const [searchingChatId, setSearchingChatId] = useState(null);
  const [webPreparingChatId, setWebPreparingChatId] = useState(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [webSearchMode, setWebSearchMode] = useState(() => {
    try { return localStorage.getItem("kp_web_mode") === "deep" ? "deep" : "fast"; } catch { return "fast"; }
  });
  const [interactionMode, setInteractionMode] = useState(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      return saved === "agent" ? "agent" : "chat";
    } catch {
      return "chat";
    }
  });
  const [agentWorkspacePath, setAgentWorkspacePath] = useState(() => {
    try {
      return String(localStorage.getItem(AGENT_WORKSPACE_KEY) || "").trim();
    } catch {
      return "";
    }
  });
  const [agentPlan, setAgentPlan] = useState([]);
  const [agentCurrentStep, setAgentCurrentStep] = useState("");
  const [agentStepDetails, setAgentStepDetails] = useState("");
  const [agentTerminalLines, setAgentTerminalLines] = useState([]);
  const [agentPendingCommand, setAgentPendingCommand] = useState("");
  const [agentCommandDraft, setAgentCommandDraft] = useState("");
  const [agentSessionStatus, setAgentSessionStatus] = useState("idle");
  const [agentError, setAgentError] = useState("");
  const [agentRunStats, setAgentRunStats] = useState({
    filesChanged: 0,
    linesAdded: 0,
    linesRemoved: 0,
    changeOps: 0,
    changedFiles: [],
  });
  const [agentRequestId, setAgentRequestId] = useState("");
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorSignals, setAdvisorSignals] = useState({});
  const [providerUsage, setProviderUsage] = useState(() => loadProviderUsage());
  const [ollamaCloudUsage, setOllamaCloudUsage] = useState(null);
  const [shortcuts, setShortcuts] = useState(() => mergeShortcuts({}));
  const [modelSelectorOpenSignal, setModelSelectorOpenSignal] = useState(0);
  const [userMemory, setUserMemory] = useState(DEFAULT_USER_MEMORY);
  const [platformInfo, setPlatformInfo] = useState(null);
  const userMemoryRef = useRef(DEFAULT_USER_MEMORY);
  const searchTokenRef = useRef(0);
  const agentTerminalRunIdsRef = useRef(new Set());
  const agentLoopAbortRef = useRef(null);
  const agentPermissionRequestRef = useRef(null);

  const currentChatPersonaId = useMemo(() => {
    if (interactionMode === "agent") {
      return agentChats.find(c => c.id === activeAgentChatId)?.personaId || "default";
    }
    return chats.find(c => c.id === activeChatId)?.personaId || "default";
  }, [chats, activeChatId, agentChats, activeAgentChatId, interactionMode]);

  const handleUpdateChatPersona = (personaId) => {
    if (interactionMode === "agent") {
      setAgentChats(prev => prev.map(c => c.id === activeAgentChatId ? { ...c, personaId } : c));
    } else {
      setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, personaId } : c));
    }
  };

  // TOKEN OPTIMIZATION: configurable defaults persisted via localStorage keys.
  const historyWindowSize = loadNumericSetting(
    HISTORY_WINDOW_KEY,
    DEFAULT_TOKEN_OPTIMIZATION_CONFIG.historyWindowSize,
    4,
    60
  );
  const maxInputTokens = loadNumericSetting(
    MAX_INPUT_TOKENS_KEY,
    DEFAULT_TOKEN_OPTIMIZATION_CONFIG.maxInputTokens,
    1000,
    200000
  );
  const maxUserChars = loadNumericSetting(
    MAX_USER_CHARS_KEY,
    DEFAULT_TOKEN_OPTIMIZATION_CONFIG.maxUserChars,
    2000,
    250000
  );

  // Current chat's messages
  const activeChat = chats.find((c) => c.id === activeChatId);
  const messages = activeChat?.messages || [];
  const activeAgentChat = agentChats.find((c) => c.id === activeAgentChatId);
  const agentMessages = activeAgentChat?.messages || [];
  const secondaryChat = chats.find((c) => c.id === secondaryChatId && c.id !== activeChatId) || null;
  const splitViewActive = !!secondaryChat;

  const retryPickerModels = React.useMemo(() => {
    const term = String(retryModelSearch || "").trim().toLowerCase();
    return models.filter((model) => {
      const isFree = isFreePricedModel(model);
      if (retryModelFilter === "free" && !isFree) return false;
      if (retryModelFilter === "paid" && isFree) return false;

      if (!term) return true;
      const haystack = `${model?.name || ""} ${model?.id || ""} ${providerLabel(model?._provider || "")}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [models, retryModelSearch, retryModelFilter]);

  // Latest advisor data from the most recent AI message
  const latestAdvisor = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i]._advisorData) return messages[i]._advisorData;
    }
    return null;
  }, [messages]);

  const usageSnapshot = React.useMemo(() => {
    const sessionCostValue = calcSessionCost(chats);
    const selectedModelLabel = selectedModel
      ? providerLabel(selectedModel.split("/")[0]) || selectedModel.split("/")[0]
      : "—";

    let monthlyLabel = null;
    let monthlyIsPaid = false;

    const currentModelObj = findModelBySelection(models, selectedModel);
    const pricing = currentModelObj?.pricing;
    if (pricing) {
      const promptPrice = Number(pricing.prompt) || 0;
      const completionPrice = Number(pricing.completion) || 0;

      if (promptPrice === 0 && completionPrice === 0) {
        monthlyLabel = "Free";
      } else {
        const connectedProviders = Object.entries(providers || {})
          .filter(([, key]) => !!key)
          .map(([provider]) => provider);

        const allRows = providerUsageRows(providerUsage, connectedProviders);
        const totalCost = allRows.reduce((sum, row) => sum + row.cost, 0);
        const totalReqs = allRows.reduce((sum, row) => sum + row.requests, 0);
        const MSGS_PER_DAY = 20;

        let monthly;
        if (totalReqs > 0) {
          monthly = (totalCost / totalReqs) * MSGS_PER_DAY * 30;
        } else {
          monthly = ((promptPrice * 500) + (completionPrice * 800)) * MSGS_PER_DAY * 30;
        }

        const label = monthly < 0.001
          ? "<$0.01"
          : monthly < 1
            ? `$${monthly.toFixed(2)}`
            : `$${monthly.toFixed(1)}`;

        monthlyLabel = `${label}/mo`;
        monthlyIsPaid = true;
      }
    }

    const providerRows = providerUsageRows(
      providerUsage,
      Object.entries(providers || {}).filter(([, key]) => !!key).map(([provider]) => provider)
    )
      .filter((row) => row.requests > 0)
      .map((row) => ({
        provider: row.provider,
        label: providerLabel(row.provider),
        costLabel: row.cost > 0 ? formatCost(row.cost) : "Free",
        hasCost: row.cost > 0,
      }));

    const creditsValue = (lifetimeCost && lifetimeCost.total_credits > 0)
      ? Math.max(0, (lifetimeCost.total_credits || 0) - (lifetimeCost.total_usage || 0))
      : null;

    return {
      sessionCostLabel: formatCost(sessionCostValue),
      sessionCostHasValue: sessionCostValue > 0,
      selectedModelLabel,
      monthlyLabel,
      monthlyIsPaid,
      providerRows,
      creditsLabel: creditsValue == null ? null : formatCost(creditsValue),
    };
  }, [chats, lifetimeCost, models, providerUsage, providers, selectedModel]);

  // Persist chats to localStorage whenever they change
  useEffect(() => {
    saveChats(chats);
  }, [chats]);

  useEffect(() => {
    saveAgentChats(agentChats);
  }, [agentChats]);

  useEffect(() => {
    saveActiveId(activeChatId);
  }, [activeChatId]);

  useEffect(() => {
    saveAgentActiveId(activeAgentChatId);
  }, [activeAgentChatId]);

  useEffect(() => {
    saveSecondaryId(secondaryChatId);
  }, [secondaryChatId]);

  // Apply saved theme + accent color on startup using dynamic CSS overrides
  useEffect(() => {
    try {
      const theme = localStorage.getItem("kp_theme") || "dark";
      const accentId = localStorage.getItem("kp_accent_color") || "green";
      const COLORS = { green: "#00ff41", cyan: "#00d4ff", purple: "#a855f7", orange: "#f59e0b", rose: "#f43f5e", blue: "#3b82f6" };
      const accentHex = COLORS[accentId] || "#00ff41";

      const THEMES = {
        dark: { p: "#0a0a0a", s: "#111111", t: "#1a1a1a" },
        midnight: { p: "#060612", s: "#0d0d1a", t: "#16162a" },
        oled: { p: "#000000", s: "#0a0a0a", t: "#111111" },
      };
      const tv = THEMES[theme] || THEMES.dark;
      const isDark = theme === "dark";
      const isGreen = accentId === "green";

      if (!isDark || !isGreen) {
        let css = `:root { --bg-primary:${tv.p}; --bg-secondary:${tv.s}; --bg-tertiary:${tv.t}; --accent:${accentHex}; --accent-glow:${accentHex}40; }\n`;
        if (!isDark) {
          css += `.bg-\\[\\#0a0a0a\\],.bg-\\[\\#0a0a0a\\]\\/95{background-color:${tv.p}!important}.bg-\\[\\#0d0d0d\\]{background-color:${tv.p}!important}.bg-\\[\\#111111\\],.bg-\\[\\#111\\]\\/50,.bg-\\[\\#111\\]\\/30{background-color:${tv.s}!important}.bg-\\[\\#1a1a1a\\],.bg-\\[\\#1a1a1a\\]\\/50{background-color:${tv.t}!important}.border-\\[\\#1a1a1a\\],.border-\\[\\#1a1a1a\\]\\/50,.border-\\[\\#1a1a1a\\]\\/40{border-color:${tv.t}!important}.border-\\[\\#2a2a2a\\]{border-color:color-mix(in srgb,${tv.t} 70%,white 10%)!important}body{background-color:${tv.p}!important}::-webkit-scrollbar-track{background:${tv.p}!important}::-webkit-scrollbar-thumb{background:${tv.t}!important}\n`;
        }
        if (!isGreen) {
          css += `.text-\\[\\#00ff41\\]{color:${accentHex}!important}.text-\\[\\#00ff41\\]\\/50,.text-\\[\\#00ff41\\]\\/60,.text-\\[\\#00ff41\\]\\/70,.text-\\[\\#00ff41\\]\\/80,.text-\\[\\#00ff41\\]\\/90{color:${accentHex}!important}.bg-\\[\\#00ff41\\]{background-color:${accentHex}!important}.bg-\\[\\#00ff41\\]\\/5,.bg-\\[\\#00ff41\\]\\/10,.bg-\\[\\#00ff41\\]\\/15,.bg-\\[\\#00ff41\\]\\/20{background-color:color-mix(in srgb,${accentHex} 15%,transparent)!important}.border-\\[\\#00ff41\\]\\/20,.border-\\[\\#00ff41\\]\\/30,.border-\\[\\#00ff41\\]\\/40{border-color:color-mix(in srgb,${accentHex} 30%,transparent)!important}.text-glow-green{text-shadow:0 0 8px color-mix(in srgb,${accentHex} 30%,transparent)!important}.terminal-cursor{background:${accentHex}!important}input[type="range"]::-webkit-slider-thumb{border-color:${accentHex}!important}\n`;
        }
        let el = document.getElementById("kp-theme-overrides");
        if (!el) { el = document.createElement("style"); el.id = "kp-theme-overrides"; document.head.appendChild(el); }
        el.textContent = css;
      }
    } catch { }
  }, []);

  useEffect(() => {
    if (!secondaryChatId) return;
    if (!chats.some((c) => c.id === secondaryChatId) || secondaryChatId === activeChatId) {
      setSecondaryChatId("");
    }
  }, [secondaryChatId, chats, activeChatId]);

  const resetAgentUiState = useCallback(() => {
    setAgentPlan([]);
    setAgentCurrentStep("");
    setAgentStepDetails("");
    setAgentTerminalLines([]);
    setAgentPendingCommand("");
    setAgentCommandDraft("");
    setAgentError("");
    setAgentRequestId("");
    setAgentSessionStatus("idle");
    agentTerminalRunIdsRef.current = new Set();
  }, []);

  useEffect(() => {
    if (interactionMode !== "agent") return;
    resetAgentUiState();
  }, [activeAgentChatId, interactionMode, resetAgentUiState]);

  useEffect(() => {
    if (AGENT_UI_ONLY_MODE) return () => { };

    let cancelled = false;

    const fallbackPlatform = {
      platform: detectPlatformFromNavigator(),
      preferredShell: detectPlatformFromNavigator() === "win32" ? "powershell" : "bash",
    };

    const loadPlatformInfo = async () => {
      try {
        if (window.electronAPI?.getPlatformInfo) {
          const info = await window.electronAPI.getPlatformInfo();
          if (!cancelled && info?.platform) {
            setPlatformInfo(info);
            return;
          }
        }
      } catch {
        // fallback below
      }

      if (!cancelled) setPlatformInfo(fallbackPlatform);
    };

    loadPlatformInfo();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadVersion = async () => {
      try {
        if (window.electronAPI?.getAppVersion) {
          const version = await window.electronAPI.getAppVersion();
          if (!cancelled && typeof version === "string") {
            setAppVersion(version.trim());
          }
        }
      } catch {
        if (!cancelled) setAppVersion("");
      }
    };

    loadVersion();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedModel) return;
    localStorage.setItem(LAST_MODEL_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem(TASK_PREF_KEY, selectedTask);
  }, [selectedTask]);

  useEffect(() => {
    localStorage.setItem(REASONING_DEPTH_KEY, reasoningDepth);
  }, [reasoningDepth]);

  useEffect(() => {
    localStorage.setItem(RESPONSE_LENGTH_KEY, responseLength);
  }, [responseLength]);

  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, interactionMode); } catch { }
  }, [interactionMode]);

  useEffect(() => {
    try {
      if (agentWorkspacePath) {
        localStorage.setItem(AGENT_WORKSPACE_KEY, agentWorkspacePath);
      } else {
        localStorage.removeItem(AGENT_WORKSPACE_KEY);
      }
    } catch { }
  }, [agentWorkspacePath]);

  useEffect(() => {
    let cancelled = false;

    const syncWorkspaceBase = async () => {
      const workspace = String(agentWorkspacePath || "").trim();
      if (!workspace || !window.electronAPI?.setWorkspaceBase) return;

      try {
        const result = await window.electronAPI.setWorkspaceBase(workspace);
        if (cancelled) return;
        if (!result?.ok && result?.error) {
          setAgentError(String(result.error));
        }
      } catch {
        // Ignore sync failures here; explicit file operations surface actionable errors.
      }
    };

    syncWorkspaceBase();
    return () => {
      cancelled = true;
    };
  }, [agentWorkspacePath]);

  useEffect(() => {
    let cancelled = false;
    const loadShortcuts = async () => {
      try {
        const raw = window.electronAPI?.getAllShortcuts
          ? await window.electronAPI.getAllShortcuts()
          : JSON.parse(localStorage.getItem("openrouter_keyboard_shortcuts") || "{}");
        if (!cancelled) setShortcuts(mergeShortcuts(raw));
      } catch {
        if (!cancelled) setShortcuts(mergeShortcuts({}));
      }
    };
    loadShortcuts();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadUserMemoryState = async () => {
      try {
        const raw = window.electronAPI?.getMemory
          ? await window.electronAPI.getMemory()
          : JSON.parse(localStorage.getItem(USER_MEMORY_STORAGE_KEY) || "null");
        const normalized = normalizeUserMemory(raw);
        if (!cancelled) setUserMemory(normalized);
        localStorage.setItem(USER_MEMORY_STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        const normalized = normalizeUserMemory(DEFAULT_USER_MEMORY);
        if (!cancelled) setUserMemory(normalized);
      }
    };
    loadUserMemoryState();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    userMemoryRef.current = userMemory;
  }, [userMemory]);

  // Fail-safe: clear stuck search indicator if a web request hangs too long.
  useEffect(() => {
    if (!isSearching) return;
    const timeout = setTimeout(() => {
      setIsSearching(false);
      setSearchingChatId(null);
      searchTokenRef.current += 1;
    }, 25000);
    return () => clearTimeout(timeout);
  }, [isSearching]);

  useEffect(() => {
    if (!tokenNotice) return;
    const timeout = setTimeout(() => setTokenNotice(""), 4200);
    return () => clearTimeout(timeout);
  }, [tokenNotice]);

  useEffect(() => {
    let cancelled = false;

    if (AGENT_UI_ONLY_MODE) {
      return () => { cancelled = true; };
    }

    if (interactionMode !== "agent") {
      setAgentError("");
      return () => { cancelled = true; };
    }

    const boot = async () => {
      if (!window.electronAPI?.openCodeStart) return;
      try {
        const result = await window.electronAPI.openCodeStart();
        if (cancelled) return;
        if (!result?.ok) {
          // Keep Agent UI usable; hard-fail only when an active request fails.
          setAgentSessionStatus("idle");
          setAgentError("");
          if (result?.error) {
            setAgentTerminalLines((prev) =>
              prev.length > 0 ? prev : [`! ${String(result.error)}`]
            );
          }
        }
      } catch (err) {
        if (cancelled) return;
        setAgentSessionStatus("idle");
        setAgentError("");
      }
    };

    boot();

    const offStatus = window.electronAPI?.onOpenCodeStatus
      ? window.electronAPI.onOpenCodeStatus((evt) => {
        if (cancelled) return;
        const type = String(evt?.type || "");
        if (type === "started") {
          setAgentSessionStatus((prev) => (prev === "running" ? prev : "ready"));
          setAgentError("");
          return;
        }
        if (type === "error" || type === "spawn_error") {
          const message = String(evt?.message || "Agent engine error.");
          if (agentRequestId) {
            setAgentSessionStatus("error");
            setAgentError(message);
          } else {
            setAgentSessionStatus("idle");
            setAgentError("");
            setAgentTerminalLines((prev) =>
              prev.length > 0 ? prev : [`! ${message}`]
            );
          }
          return;
        }
        if (type === "stopped") {
          const message = String(evt?.message || "Agent engine stopped.");
          if (agentRequestId) {
            setAgentSessionStatus("error");
            setAgentError(message);
          } else {
            setAgentSessionStatus("idle");
            setAgentError("");
          }
          return;
        }
        if (type === "disabled") {
          setAgentSessionStatus("error");
          setAgentError(String(evt?.message || "Agent engine is unavailable."));
        }
      })
      : () => { };

    const offEvents = window.electronAPI?.onOpenCodeEvent
      ? window.electronAPI.onOpenCodeEvent((evt) => {
        if (cancelled) return;
        if (interactionMode !== "agent") return;
        if (agentRequestId && evt?.requestId && evt.requestId !== agentRequestId) return;
        if (activeAgentChatId && evt?.sessionId && evt.sessionId !== activeAgentChatId) return;

        const mapped = mapOpenCodeEvent(evt);
        if (mapped.type === "plan") {
          setAgentPlan(mapped.plan || []);
          return;
        }
        if (mapped.type === "step_start") {
          setAgentCurrentStep(mapped.step || "");
          setAgentStepDetails("");
          return;
        }
        if (mapped.type === "step_update") {
          if (mapped.step) setAgentCurrentStep(mapped.step);
          if (mapped.details) setAgentStepDetails(mapped.details);
          return;
        }
        if (mapped.type === "terminal") {
          if (mapped.command) {
            setAgentPendingCommand(mapped.command);
            setAgentCommandDraft(mapped.command);
          }
          if (mapped.text) {
            setAgentTerminalLines((prev) => [...prev, mapped.text]);
          }
          return;
        }
        if (mapped.type === "result") {
          setAgentSessionStatus("done");
          const text = String(mapped.text || "").trim();
          if (text) {
            setAgentChats((prevChats) =>
              prevChats.map((c) => {
                if (c.id !== activeAgentChatId) return c;
                const nextMessages = [...(c.messages || []), { role: "assistant", content: text }];
                return { ...c, messages: nextMessages, title: deriveTitle(nextMessages) };
              })
            );
          }
          return;
        }
        if (mapped.type === "error") {
          setAgentSessionStatus("error");
          setAgentError(String(mapped.text || "Agent failed."));
        }
      })
      : () => { };

    const offTerminalOutput = window.electronAPI?.onTerminalOutput
      ? window.electronAPI.onTerminalOutput(({ id, type, data }) => {
        if (!agentTerminalRunIdsRef.current.has(id)) return;
        const prefix = type === "stderr" ? "!" : "$";
        setAgentTerminalLines((prev) => [...prev, `${prefix} ${String(data || "")}`]);
      })
      : () => { };

    const offTerminalDone = window.electronAPI?.onTerminalDone
      ? window.electronAPI.onTerminalDone(({ id, code, error }) => {
        if (!agentTerminalRunIdsRef.current.has(id)) return;
        agentTerminalRunIdsRef.current.delete(id);
        if (error) {
          setAgentTerminalLines((prev) => [...prev, `! ${error}`]);
        }
        setAgentTerminalLines((prev) => [...prev, `> command finished (exit ${code ?? -1})`]);
      })
      : () => { };

    return () => {
      cancelled = true;
      offStatus();
      offEvents();
      offTerminalOutput();
      offTerminalDone();
    };
  }, [interactionMode, agentRequestId, activeAgentChatId]);

  // Recompute smart suggestion when uploads/attachments/model change
  useEffect(() => {
    const taskType = uiTaskToAdvisorTask(selectedTask, "", uploads, attachedFiles);
    if (taskType === "general" && uploads.length === 0 && attachedFiles.length === 0) {
      setSmartSuggestion(null);
      return;
    }
    const suggestion = selectSmartModel(models, taskType, selectedModel, modelPref);
    setSmartSuggestion(suggestion);
    setSuggestionDismissed(false);
  }, [uploads, attachedFiles, models, selectedModel, modelPref, selectedTask]);

  // Fetch models from all active providers on mount / when providers change
  useEffect(() => {
    let cancelled = false;
    setError("");
    fetchAllModels(providers)
      .then((data) => {
        if (cancelled) return;
        const sorted = [...data];
        setModels(sorted);
        if (sorted.length === 0) {
          setSelectedModel("");
          return;
        }

        // Restore the user's last selected model when available.
        const lastUsedModelId = localStorage.getItem(LAST_MODEL_KEY);
        const restored = lastUsedModelId ? findModelBySelection(sorted, lastUsedModelId) : null;
        if (restored) {
          setSelectedModel(toSelectionId(restored));
          if (isImageGenModel(restored) && selectedTask !== "text-to-image") {
            setSelectedTask("text-to-image");
          }
          return;
        }

        // Default to a model matching the current task.
        const taskModels = filterModelsForTask(sorted, selectedTask);
        const pool = taskModels.length > 0 ? taskModels : sorted;
        // TOKEN OPTIMIZATION: default to the cheapest available model.
        const cheapest = findCheapestModel(pool, "general");
        setSelectedModel(cheapest?.model ? toSelectionId(cheapest.model) : toSelectionId(pool[0]) || "");
      })
      .catch((err) => {
        if (!cancelled) setError("Failed to load models. Check your API keys.");
        console.error(err);
      });
    return () => { cancelled = true; };
  }, [providers]);

  useEffect(() => {
    let cancelled = false;
    if (models.length === 0) {
      setAdvisorSignals({});
      return;
    }

    loadLiveRankingSignals(models)
      .then((signals) => {
        if (!cancelled) setAdvisorSignals(signals || {});
      })
      .catch(() => {
        if (!cancelled) setAdvisorSignals({});
      });

    return () => { cancelled = true; };
  }, [models]);

  // Fetch account credits (OpenRouter only)
  useEffect(() => {
    const orKey = providers?.openrouter;
    if (!orKey) return;
    fetchCredits(orKey).then((c) => { if (c) setLifetimeCost(c); });
  }, [providers?.openrouter]);

  // Fetch Ollama cloud usage percentages for sidebar display when using cloud API key.
  useEffect(() => {
    let cancelled = false;
    const ollamaValue = String(providers?.ollama || "").trim();

    if (!ollamaValue) {
      setOllamaCloudUsage(null);
      return () => { cancelled = true; };
    }

    if (!isOllamaCloudKeyConfig(ollamaValue)) {
      setOllamaCloudUsage({ status: "local" });
      return () => { cancelled = true; };
    }

    setOllamaCloudUsage((prev) => ({
      status: "loading",
      sessionPercent: prev?.sessionPercent ?? null,
      weeklyPercent: prev?.weeklyPercent ?? null,
      sessionReset: prev?.sessionReset || "",
      weeklyReset: prev?.weeklyReset || "",
    }));

    fetchOllamaCloudUsage(ollamaValue)
      .then((result) => {
        if (cancelled) return;

        const sessionPercent = Number(result?.session?.percentUsed);
        const weeklyPercent = Number(result?.weekly?.percentUsed);

        setOllamaCloudUsage({
          status: result?.available ? "ready" : "partial",
          sessionPercent: Number.isFinite(sessionPercent) ? sessionPercent : null,
          weeklyPercent: Number.isFinite(weeklyPercent) ? weeklyPercent : null,
          sessionReset: String(result?.session?.resetsIn || ""),
          weeklyReset: String(result?.weekly?.resetsIn || ""),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setOllamaCloudUsage((prev) => ({
          status: "error",
          sessionPercent: prev?.sessionPercent ?? null,
          weeklyPercent: prev?.weeklyPercent ?? null,
          sessionReset: prev?.sessionReset || "",
          weeklyReset: prev?.weeklyReset || "",
        }));
      });

    return () => { cancelled = true; };
  }, [providers?.ollama]);

  useEffect(() => {
    const autoTask = detectUiTask("", uploads, attachedFiles);
    if (autoTask !== selectedTask && (uploads.length > 0 || attachedFiles.length > 0)) {
      setSelectedTask(autoTask);
    }
  }, [uploads, attachedFiles, selectedTask]);

  useEffect(() => {
    if (!models.length || !selectedModel) return;

    const current = findModelBySelection(models, selectedModel);
    if (!current) {
      const taskModels = filterModelsForTask(models, selectedTask);
      const pool = taskModels.length > 0 ? taskModels : models;
      const cheapest = findCheapestModel(pool, "general");
      const fallback = cheapest?.model || pool[0];

      if (fallback) {
        setSelectedModel(toSelectionId(fallback));
        setTokenNotice(`Selected model was unavailable. Switched to ${fallback.name || fallback.id}.`);
      }
      return;
    }

    const taskModels = filterModelsForTask(models, selectedTask);
    if (taskModels.length === 0) return;
    if (current && taskModels.some((m) => modelSelectionId(m) === modelSelectionId(current))) return;

    const freeTaskModel = taskModels.find((m) => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);
    setSelectedModel(toSelectionId(freeTaskModel || taskModels[0]));
  }, [models, selectedTask, selectedModel]);

  // Helper: update messages for the active chat
  const updateActiveMessages = useCallback(
    (updater) => {
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== activeChatId) return c;
          const newMsgs = typeof updater === "function" ? updater(c.messages) : updater;
          return { ...c, messages: newMsgs, title: deriveTitle(newMsgs) };
        })
      );
    },
    [activeChatId]
  );

  const handleAttachFile = useCallback((file) => {
    setAttachedFiles((prev) => {
      if (prev.some((f) => f.path === file.path)) return prev;
      return [...prev, file];
    });
  }, []);

  const handleRemoveFile = useCallback((filePath) => {
    setAttachedFiles((prev) => prev.filter((f) => f.path !== filePath));
  }, []);

  const handleRemoveUpload = useCallback((id) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }, []);

  /** Process files selected via the upload button */
  const handleUpload = useCallback(async (files) => {
    const electronApi = window.electronAPI;

    for (const file of files) {
      if (file.size > MAX_UPLOAD_SIZE) continue; // skip oversized

      const ext = fileExt(file.name);
      const id = generateId();
      const base = { id, name: file.name, size: file.size, ext };

      if (IMAGE_EXTS.includes(ext)) {
        // Read image as base64 data URL
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        setUploads((prev) => [...prev, { ...base, type: "image", dataUrl }]);
      } else if (ext === "pdf") {
        try {
          const text = await parsePdfFile(file);
          if (text) {
            setUploads((prev) => [...prev, { ...base, type: "pdf", content: text }]);
          } else {
            setUploads((prev) => [...prev, { ...base, type: "pdf", content: null, error: "No text found — PDF may be image-based" }]);
          }
        } catch (err) {
          setUploads((prev) => [...prev, { ...base, type: "pdf", content: null, error: err.message }]);
        }
      } else {
        // Read as text
        const content = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsText(file);
        });
        if (content !== null) {
          setUploads((prev) => [...prev, { ...base, type: "file", content }]);
        }
      }
    }
  }, []);

  const handleSaveMemory = useCallback(async (nextMemory) => {
    const normalized = normalizeUserMemory(nextMemory);
    const currentNormalized = normalizeUserMemory(userMemoryRef.current);
    if (JSON.stringify(normalized) === JSON.stringify(currentNormalized)) {
      return;
    }

    setUserMemory(normalized);
    localStorage.setItem(USER_MEMORY_STORAGE_KEY, JSON.stringify(normalized));
    if (window.electronAPI?.setMemory) {
      await window.electronAPI.setMemory(normalized);
    }
  }, []);

  const handleResetMemory = useCallback(async () => {
    const normalized = normalizeUserMemory(DEFAULT_USER_MEMORY);
    setUserMemory(normalized);
    localStorage.removeItem(USER_MEMORY_STORAGE_KEY);
    if (window.electronAPI?.resetMemory) {
      await window.electronAPI.resetMemory();
    }
  }, []);

  const getOptimizedSystemPrompt = useCallback((basePrompt, memoryState) => {
    // TOKEN OPTIMIZATION: cache compressed system prompts so we do not rebuild each request.
    const mergedPrompt = buildSystemPromptWithMemory(basePrompt, memoryState);
    const cacheKey = `${basePrompt}::${JSON.stringify(memoryState || {})}`;
    if (systemPromptCacheRef.current.has(cacheKey)) {
      return systemPromptCacheRef.current.get(cacheKey);
    }

    const compressed = compressSystemPrompt(mergedPrompt);
    systemPromptCacheRef.current.set(cacheKey, compressed);

    // Keep cache bounded.
    if (systemPromptCacheRef.current.size > 24) {
      const firstKey = systemPromptCacheRef.current.keys().next().value;
      systemPromptCacheRef.current.delete(firstKey);
    }

    return compressed;
  }, []);

  const summarizeOverflowHistory = useCallback(
    async ({ overflowMessages, existingSummary, signal }) => {
      if (!Array.isArray(overflowMessages) || overflowMessages.length === 0) {
        return existingSummary || "";
      }

      const fallback = buildFallbackHistorySummary(
        overflowMessages,
        existingSummary,
        DEFAULT_TOKEN_OPTIMIZATION_CONFIG.summaryCharLimit
      );

      const summaryModel = pickCheapestSummaryModel(models, providers);
      if (!summaryModel) return fallback;

      const prompt = buildHistorySummaryPrompt(
        overflowMessages,
        existingSummary,
        DEFAULT_TOKEN_OPTIMIZATION_CONFIG.summaryCharLimit
      );

      try {
        const result = await routeStream(
          providers,
          summaryModel,
          [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          {
            signal,
            reasoningDepth: "fast",
            maxTokens: DEFAULT_TOKEN_OPTIMIZATION_CONFIG.summaryMaxTokens,
            temperature: 0.2,
            topP: 0.8,
          }
        );

        const summary = String(result?.text || "").trim();
        if (!summary) return fallback;
        return summary.slice(0, DEFAULT_TOKEN_OPTIMIZATION_CONFIG.summaryCharLimit);
      } catch {
        return fallback;
      }
    },
    [models, providers]
  );

  const composerTokenStats = React.useMemo(() => {
    const selectedModelObj = findModelBySelection(models, selectedModel);
    const modelContextRaw = Number(selectedModelObj?.context_length);
    const modelContextTokens = Number.isFinite(modelContextRaw) && modelContextRaw > 0
      ? modelContextRaw
      : null;

    const tokenBudgets = resolveAdaptiveTokenBudgets(draftInputText, {
      maxInputTokens,
      maxUserChars,
      modelContextTokens,
    });
    const contextWindowLimitTokens = Number.isFinite(tokenBudgets.maxInputTokens)
      ? tokenBudgets.maxInputTokens
      : (modelContextTokens || 0);

    const normalized = normalizeUserInputForSend(draftInputText, { maxChars: tokenBudgets.maxUserChars });
    if (!normalized.text) {
      return {
        estimatedTokens: 0,
        contextWindowLimitTokens,
        relaxed: tokenBudgets.relaxed,
      };
    }

    const chatHistory = messages.filter((m) => m.role === "user" || m.role === "assistant");
    const windowed = buildSlidingWindowHistory(chatHistory, historyWindowSize);

    const estimateMessages = [
      {
        role: "system",
        content: getOptimizedSystemPrompt(systemPrompt, userMemory),
      },
      ...windowed.recentMessages,
      { role: "user", content: normalized.text },
    ];

    return {
      estimatedTokens: estimateTokensFromMessages(estimateMessages),
      contextWindowLimitTokens,
      relaxed: tokenBudgets.relaxed,
    };
  }, [
    draftInputText,
    maxInputTokens,
    maxUserChars,
    selectedModel,
    messages,
    historyWindowSize,
    getOptimizedSystemPrompt,
    systemPrompt,
    userMemory,
    models,
  ]);

  const latestUserDisplayText = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg?.role !== "user") continue;
      const text = String(msg?._displayText || msg?.content || "").trim();
      if (text) return text;
    }
    return "";
  }, [messages]);

  const showDeepAnalysisVisualizer =
    reasoningDepth === "deep" ||
    composerTokenStats.relaxed ||
    shouldRelaxTokenMode(latestUserDisplayText) ||
    (loading && shouldRelaxTokenMode(lastRequestRef.current?.text || ""));

  const handleSend = useCallback(
    async (text, opts = {}) => {
      let chatId = opts.targetChatId || activeChatId;
      const targetChatObj = chats.find(c => c.id === chatId);
      const activePersonaIdInChat = targetChatObj?.personaId || (chatId === activeChatId ? currentChatPersonaId : "default");
      const personaSelected = personas.find(p => p.id === activePersonaIdInChat);

      let requestedModelSelection = opts.modelOverride || selectedModel;
      if (personaSelected && personaSelected.modelId) {
        requestedModelSelection = personaSelected.modelId;
      }
      if (!requestedModelSelection) return;
      const bypassCache = !!opts.bypassCache;
      const selectedModelObj = findModelBySelection(models, requestedModelSelection);

      const tokenBudgets = resolveAdaptiveTokenBudgets(text, {
        maxInputTokens,
        maxUserChars,
        modelContextTokens: selectedModelObj?.context_length,
      });

      // TOKEN OPTIMIZATION: normalize noisy input without hard trimming.
      const normalizedInput = normalizeUserInputForSend(text, { maxChars: tokenBudgets.maxUserChars });
      if (!normalizedInput.text.trim()) return;

      if (normalizedInput.condensed) {
        setTokenNotice(`Applied semantic input condensation to reduce ${normalizedInput.condensedChars} chars without hard trimming.`);
      } else if (tokenBudgets.relaxed) {
        setTokenNotice("Deep/code mode enabled: unlimited input context and aggressive compression disabled.");
      } else {
        setTokenNotice("");
      }

      setDraftInputText("");
      const sendText = normalizedInput.text;

      // ── Slash command parsing ──
      let fileData = null;
      const parsed = parseCommand(sendText, customCommands);
      let processedText = sendText;

      if (parsed) {
        if (parsed.noFile) {
          // No-arg commands: promptTemplate is the full prompt, no file needed
          processedText = buildCommandPrompt(parsed.command, "", "", parsed.rest, customCommands);
        } else {
          // Try to resolve file from attachments first
          fileData = resolveFromAttachments(parsed.filePath, attachedFiles, uploads);

          // If not found in attachments, try reading via Electron IPC
          if (!fileData && window.electronAPI) {
            try {
              const result = await window.electronAPI.readFile(parsed.filePath);
              if (result.content && !result.error) {
                const sep = parsed.filePath.includes("\\") ? "\\" : "/";
                const fileName = parsed.filePath.split(sep).pop();
                fileData = { name: fileName, content: result.content };
              }
            } catch {
              // File not found — show error
            }
          }

          if (fileData) {
            processedText = buildCommandPrompt(parsed.command, fileData.name, fileData.content, parsed.rest, customCommands);
          } else {
            setError(`File not found: ${parsed.filePath}. Attach a file or provide a full path.`);
            return;
          }
        }
      }

      // Run smart detection at send time (considers text for coding keywords)
      const lockTaskToSelectedModel = selectedTask === "text-to-image" || isImageGenModel(selectedModelObj);
      const autoTask = detectUiTask(processedText, uploads, attachedFiles);
      const effectiveTask = lockTaskToSelectedModel ? selectedTask : autoTask;
      if (!lockTaskToSelectedModel && autoTask !== selectedTask) setSelectedTask(autoTask);
      const taskType = uiTaskToAdvisorTask(effectiveTask, processedText, uploads, attachedFiles);

      // ── Show task suggestion banner (coding/vision/document) ──
      if (taskType !== "general") {
        const suggestion = selectSmartModel(models, taskType, requestedModelSelection, modelPref);
        if (!suggestion.currentOk && suggestion.recommended) {
          setTaskBanner({
            visible: true,
            taskType,
            suggestedModelId: suggestion.recommended.id,
            onSwitch: () => {
              setSelectedModel(toSelectionId(suggestion.recommended));
              setTaskBanner(null);
            },
            onIgnore: () => setTaskBanner(null),
          });
          // Auto-switch to the recommended model if it's free, or if preference is paid
          if ((suggestion.free && suggestion.recommended.id === suggestion.free.id) || modelPref === "paid") {
            setSelectedModel(toSelectionId(suggestion.recommended));
          }
        }
      }

      // ── Show cheapest model banner ──
      const cheapest = findCheapestModel(models, taskType, (m) => supportsTask(m, effectiveTask));
      if (cheapest && toSelectionId(cheapest.model) !== requestedModelSelection) {
        setCheapestBanner({
          visible: true,
          cheapestLabel: cheapest.costLabel,
          cheapestModelId: cheapest.model.id,
          currentModelId: requestedModelSelection,
          onUseCheapest: () => {
            setSelectedModel(toSelectionId(cheapest.model));
            setCheapestBanner(null);
          },
          onKeepCurrent: () => setCheapestBanner(null),
        });
      }

      // ── Check rate limit before sending ──
      if (isModelUnavailable(requestedModelSelection)) {
        const fallback = findFallbackModel(models, requestedModelSelection, taskType, qualityScore);
        setRateLimitBanner({
          visible: true,
          modelId: requestedModelSelection,
          fallbackModelId: fallback?.id || null,
          onSwitch: () => {
            if (fallback) setSelectedModel(toSelectionId(fallback));
            setRateLimitBanner(null);
          },
          onDismiss: () => setRateLimitBanner(null),
        });
      }

      if (opts.targetChatId && opts.targetChatId !== activeChatId) {
        setActiveChatId(opts.targetChatId);
      }

      // If no active chat, create one
      if (!chatId) {
        chatId = generateId();
        const newChat = { id: chatId, title: "New Chat", messages: [], personaId: activePersonaIdInChat };
        setChats((prev) => [newChat, ...prev]);
        setActiveChatId(chatId);
      }

      // Collect all context: sidebar files + uploaded files/PDFs as text, images as image_url
      const imageUploads = uploads.filter((u) => u.type === "image" && u.dataUrl);
      const textUploads = uploads.filter((u) => u.type !== "image" && u.content);

      // Build the text portion — use processedText if command was parsed
      let textContent = parsed ? processedText : sendText.trim();
      const selectedSupportsVision = !!selectedModelObj && supportsTask(selectedModelObj, "image-to-text");
      let googleScreenshotForModel = null;

      // ── Intent detection & tool injection ────────────────────────────────────
      // Runs on every message (not just slash commands) to give the AI context
      // about available tools and optionally pre-fetch web results.
      let webResults = [];
      let didAttemptWebSearch = false;
      const rawText = sendText.trim();
      let advisorContext = {
        webSearchUsed: false,
        webSearchMode: webSearchMode === "deep" ? "deep" : "fast",
        explicitWebIntent: false,
        terminalIntent: false,
        reasoningDepth,
      };

      if (!parsed) {
        const hasWebCommand = !!parseWebCommand(rawText);
        const hasUrls = extractUrlsFromText(rawText).length > 0;
        const detailed = isDetailedIntent(rawText);
        // Expand web intent: explicit keywords OR (detailed + real-world topic)
        const webIntent = isWebIntent(rawText) || (detailed && isRealWorldQuery(rawText));
        const newsIntent = isNewsIntent(rawText);
        const geopoliticsIntent = /\b(war|conflict|ceasefire|invasion|occupation|airstrike|missile|sanction|blockade|siege|coup|protest|uprising|revolution|treaty|alliance|summit|election|vote|crisis|iran|iraq|ukraine|russia|china|israel|palestine|gaza|syria|yemen|north korea|taiwan|india|pakistan|nato|un|opec|brics|geopolit)\b/i.test(rawText);
        const shouldIncludeNews = newsIntent || geopoliticsIntent;
        const utilityIntent = /\b(download|install|installer|setup|how (do i|to)|steps?|guide|tutorial|official (site|website)|where can i download)\b/i.test(rawText);
        const terminalIntent = isTerminalIntent(rawText);
        const terminalHint = buildTerminalIntentHint(platformInfo);
        const explicitWebPrompt = hasWebCommand || EXPLICIT_WEB_TRIGGER_RE.test(rawText);
        const query = buildSearchQuery(rawText) || rawText.slice(0, 100);
        const forceDeepMode = webSearchMode === "deep";
        const shouldDoDeepSearch = detailed || forceDeepMode;
        advisorContext = {
          ...advisorContext,
          terminalIntent,
          explicitWebIntent: explicitWebPrompt,
          webSearchMode: shouldDoDeepSearch ? "deep" : "fast",
        };
        // Web mode is strictly user-controlled: no autonomous or prompt-based bypass.
        const webModeActive =
          webSearchEnabled &&
          !terminalIntent &&
          rawText.length >= 3;
        const shouldUseDetailedContext = shouldDoDeepSearch;

        const startSearchRun = () => {
          const token = ++searchTokenRef.current;
          setSearchingChatId(chatId);
          setIsSearching(true);
          return token;
        };
        const stopSearchRun = (token) => {
          if (searchTokenRef.current === token) {
            setIsSearching(false);
            setSearchingChatId(null);
          }
        };

        // ── Web: fetch URLs / commands / comprehensive web-intent research
        if (webSearchEnabled && (hasWebCommand || hasUrls) && window.electronAPI?.fetchWebPage) {
          const token = startSearchRun();
          didAttemptWebSearch = true;
          try { webResults = await fetchAllWebContent(rawText); } finally { stopSearchRun(token); }
        } else if (webModeActive && !hasUrls) {
          // Default: fast general web search. Deep mode is only used when user explicitly asks for details.
          const token = startSearchRun();
          didAttemptWebSearch = true;
          try {
            if (shouldDoDeepSearch) {
              const tasks = [];
              if (window.electronAPI?.deepSearch) {
                tasks.push(deepArticleSearch(query));
              }
              if (window.electronAPI?.googleAiSearch || window.electronAPI?.searchWeb) {
                tasks.push(webSearch(query, { detailed: true, includeNews: shouldIncludeNews }));
              }

              if (tasks.length > 0) {
                const settled = await Promise.allSettled(tasks);
                const arrays = settled
                  .filter((r) => r.status === "fulfilled" && Array.isArray(r.value))
                  .map((r) => r.value);
                webResults = mergeWebSources(...arrays);
              }
            } else if (window.electronAPI?.googleAiSearch || window.electronAPI?.searchWeb) {
              // Fast path for normal prompts: broad web crawl, add news only when explicitly requested.
              webResults = await webSearch(query, { detailed: false, includeNews: shouldIncludeNews });
            }

            // If explicit web intent produced no results, try one deeper fallback.
            if (webResults.length === 0 && webIntent && window.electronAPI?.deepSearch) {
              const fallbackDeep = await deepArticleSearch(query);
              webResults = mergeWebSources(fallbackDeep);
            }

            // Non-news fallback: retry broader deep crawl for utility/how-to prompts.
            if (
              webResults.length === 0 &&
              webSearchEnabled &&
              !newsIntent &&
              utilityIntent &&
              window.electronAPI?.deepSearch
            ) {
              const fallbackUtility = await deepArticleSearch(query);
              webResults = mergeWebSources(fallbackUtility);
            }

            // Last-resort fallback: when Web mode is ON, allow news-backed fallback
            // only for explicit news prompts.
            if (
              webResults.length === 0 &&
              webSearchEnabled &&
              shouldIncludeNews &&
              (window.electronAPI?.googleAiSearch || window.electronAPI?.searchWeb)
            ) {
              const fallbackAny = await webSearch(query, {
                detailed: shouldDoDeepSearch,
                includeNews: true,
              });
              webResults = mergeWebSources(fallbackAny);
            }
          } finally {
            stopSearchRun(token);
          }
        }

        // Prepend web context to the message sent to AI
        advisorContext = {
          ...advisorContext,
          webSearchUsed: webResults.length > 0,
        };

        if (webResults.length > 0) {
          const webContext = buildWebContext(webResults, { detailed: shouldUseDetailedContext });
          if (webContext) textContent = webContext + textContent;

          if (selectedSupportsVision) {
            const withShot = webResults.find(
              (s) => typeof s?._googleScreenshotDataUrl === "string" && s._googleScreenshotDataUrl.startsWith("data:image/")
            );
            if (withShot?._googleScreenshotDataUrl) {
              googleScreenshotForModel = withShot._googleScreenshotDataUrl;
              textContent =
                `[WEB NOTE: A live Google search screenshot is attached as additional context. Use copied web text for citations.]\n\n` +
                textContent;
            }
          }
        }

        // ── Terminal: inject hint only when NOT a web search request
        // (avoids the model suggesting terminal commands for web queries)
        if (terminalIntent && !webIntent) {
          textContent = textContent + terminalHint;
        }

        // ── Web intent but search returned nothing: nudge AI to acknowledge its limits
        if (webIntent && didAttemptWebSearch && webResults.length === 0) {
          textContent = textContent + WEB_INTENT_HINT;
        }
      }

      // Prepend sidebar-attached file blocks (skip if command already injected file)
      if (!parsed && attachedFiles.length > 0) {
        const blocks = attachedFiles
          .map((f) => `📎 FILE: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``)
          .join("\n\n");
        textContent = blocks + "\n\n" + textContent;
      }

      // Prepend uploaded text/PDF file blocks (skip if command already injected file)
      if (!parsed && textUploads.length > 0) {
        const blocks = textUploads
          .map((u) => `📎 ${u.type === "pdf" ? "PDF" : "FILE"}: ${u.name}\n\`\`\`\n${u.content}\n\`\`\``)
          .join("\n\n");
        textContent = blocks + "\n\n" + textContent;
      }

      // Build the user message content — multimodal array if images present, else string
      let content;
      if (imageUploads.length > 0) {
        content = [
          ...imageUploads.map((u) => ({
            type: "image_url",
            image_url: { url: u.dataUrl },
          })),
          { type: "text", text: textContent },
        ];
      } else {
        content = textContent;
      }

      const modelOnlyImages =
        googleScreenshotForModel && selectedSupportsVision
          ? [{ type: "image_url", image_url: { url: googleScreenshotForModel } }]
          : [];

      const contentForSend = modelOnlyImages.length === 0
        ? content
        : Array.isArray(content)
          ? [...modelOnlyImages, ...content]
          : [...modelOnlyImages, { type: "text", text: textContent }];

      const autoMemory = userMemory.autoMode ? detectMemoryFromMessage(sendText.trim()) : DEFAULT_USER_MEMORY;
      const effectiveMemory =
        userMemory.autoMode && hasUserMemory(autoMemory)
          ? mergeUserMemory(userMemory, autoMemory)
          : userMemory;

      if (userMemory.autoMode && hasUserMemory(autoMemory)) {
        handleSaveMemory(effectiveMemory).catch(() => { });
      }

      // Clear all attachments
      setAttachedFiles([]);
      setUploads([]);

      // Build display-only metadata (what the user sees in the bubble)
      const allAttachments = [
        ...attachedFiles.map((f) => ({ name: f.name, type: "file" })),
        ...uploads.map((u) => ({ name: u.name, type: u.type })),
      ];
      const deepAnalysisMode = isDeepAnalysisPrompt(processedText || sendText);
      const userMsg = {
        role: "user",
        content,
        _displayText: sendText.trim(),
        _attachments: allAttachments.length > 0 ? allAttachments : undefined,
        _webResults: webResults.length > 0 ? webResults : undefined,
        _webSearchAttempted: didAttemptWebSearch,
        _deepAnalysis: deepAnalysisMode,
        _hidden: opts.silent || false,
      };
      const aiMsg = { role: "assistant", content: "", _deepAnalysis: deepAnalysisMode };

      // If a /fix command was used, attach original file data for diff viewer
      if (parsed && fileData) {
        aiMsg._originalFile = {
          name: fileData.name,
          content: fileData.content,
          path: parsed.filePath,
          command: parsed.command,
        };
      }

      // Add user + empty AI message
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          const newMsgs = [...c.messages, userMsg, aiMsg];
          return { ...c, messages: newMsgs, title: deriveTitle(newMsgs) };
        })
      );

      setError("");
      setLastError(null);
      setLoading(true);

      // ── Store last request for retry/regenerate ──
      lastRequestRef.current = {
        text: sendText,
        uploads: [...uploads],
        attachedFiles: [...attachedFiles],
        modelUsed: requestedModelSelection,
        chatId,
      };

      const startTime = Date.now();
      const controller = new AbortController();
      abortRef.current = controller;

      // Build the outbound user message (without the empty AI placeholder)
      const outboundUserMsg = contentForSend === content
        ? userMsg
        : { ...userMsg, content: contentForSend };

      const currentModelObj = findModelBySelection(models, requestedModelSelection);
      const providerForRequest = currentModelObj?._provider || "openrouter";
      const baseGenerationSettings = resolveGenerationSettings(providerForRequest, responseLength);

      // Integrate Token Optimizer with Reply Length Toggle
      let baseMaxTokens = baseGenerationSettings.maxTokens;
      if (tokenBudgetInfo) {
        const predictedMax = tokenBudgetInfo.p95Completion || tokenBudgetInfo.completion || baseMaxTokens;
        if (responseLength === "short") baseMaxTokens = Math.max(128, Math.floor(predictedMax * 0.5));
        else if (responseLength === "long") baseMaxTokens = Math.min(16384, Math.floor(predictedMax * 2));
        else baseMaxTokens = Math.max(256, predictedMax);
      }

      const safeMaxTokens = currentModelObj?.top_provider?.max_completion_tokens || 8192;
      const generationSettings = tokenBudgets.relaxed
        ? {
          ...baseGenerationSettings,
          maxTokens: Math.min(safeMaxTokens, Math.max(baseMaxTokens, 4096))
        }
        : { ...baseGenerationSettings, maxTokens: Math.min(baseMaxTokens, safeMaxTokens) };

      // Apply user-defined generation parameter overrides from Settings or Persona
      try {
        if (personaSelected?.temperature != null) {
          generationSettings.temperature = personaSelected.temperature;
        } else {
          const userTemp = localStorage.getItem("kp_gen_temperature");
          if (userTemp !== null) generationSettings.temperature = Number(userTemp);
        }

        if (personaSelected?.topP != null) {
          generationSettings.topP = personaSelected.topP;
        } else {
          const userTopP = localStorage.getItem("kp_gen_top_p");
          if (userTopP !== null) generationSettings.topP = Number(userTopP);
        }

        const userFreqPenalty = localStorage.getItem("kp_gen_frequency_penalty");
        if (userFreqPenalty !== null) {
          const fp = Number(userFreqPenalty);
          if (fp !== 0) generationSettings.frequencyPenalty = fp;
        }
      } catch { }

      // TOKEN OPTIMIZATION: session cache shortcut for repeated prompts.
      const cacheKey = makeResponseCacheKey({
        chatId,
        provider: providerForRequest,
        modelId: currentModelObj?.id || requestedModelSelection,
        userText: processedText,
      });
      const cachedEntry = bypassCache ? null : getCachedResponseEntry(responseCacheRef.current, cacheKey);
      if (cachedEntry) {
        const cachedText = String(cachedEntry.response || "").trim() || "(No response)";
        const cachedUsage = cachedEntry.usage || null;
        const sentTokens = cachedUsage?.prompt_tokens || estimateTokensFromText(processedText);
        const receivedTokens = cachedUsage?.completion_tokens || estimateTokensFromText(cachedText);

        setChats((prev) =>
          prev.map((c) => {
            if (c.id !== chatId) return c;
            const next = [...c.messages];
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              content: cachedText,
              usage: cachedUsage,
              _cached: true,
              _modelUsed: currentModelObj?._selectionId || requestedModelSelection,
            };
            return { ...c, messages: next };
          })
        );

        setLastTokenStats({ sent: sentTokens, received: receivedTokens });
        console.info("[TOKEN OPTIMIZATION] cache hit: response served from session cache.");
        abortRef.current = null;
        setLoading(false);
        recordSuccess(requestedModelSelection, Date.now() - startTime);
        return;
      }

      // TOKEN OPTIMIZATION: sliding history window + rolling summary context.
      const chatSnapshot = chats.find((c) => c.id === chatId);
      const apiHistory = [...(chatSnapshot?.messages || []), outboundUserMsg]
        .filter((m) => m.role === "user" || m.role === "assistant");

      const canWebSearch = tokenBudgets.relaxed || (maxInputTokens >= 4000);

      const firstWindow = tokenBudgets.relaxed
        ? { recentMessages: apiHistory, overflowMessages: [], overflowCount: 0 }
        : buildSlidingWindowHistory(apiHistory, historyWindowSize);
      let summaryText = String(chatSnapshot?._historySummary || "");
      let summaryCursor = Number(chatSnapshot?._historyCursor || 0);
      if (!Number.isFinite(summaryCursor) || summaryCursor < 0) summaryCursor = 0;
      if (summaryCursor > firstWindow.overflowCount) summaryCursor = firstWindow.overflowCount;

      if (!tokenBudgets.relaxed && firstWindow.overflowCount > summaryCursor) {
        const newlyOverflowed = apiHistory.slice(summaryCursor, firstWindow.overflowCount);
        summaryText = await summarizeOverflowHistory({
          overflowMessages: newlyOverflowed,
          existingSummary: summaryText,
          signal: controller.signal,
        });
        summaryCursor = firstWindow.overflowCount;

        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId
              ? { ...c, _historySummary: summaryText, _historyCursor: summaryCursor }
              : c
          )
        );
      }

      const secondWindow = tokenBudgets.relaxed
        ? { recentMessages: apiHistory, overflowMessages: [], overflowCount: 0 }
        : buildSlidingWindowHistory(apiHistory, historyWindowSize);
      const effectiveSystemPromptText = (personaSelected && personaSelected.systemPrompt?.trim())
        ? personaSelected.systemPrompt
        : systemPrompt;
      const optimizedSystemPrompt = getOptimizedSystemPrompt(effectiveSystemPromptText, effectiveMemory);
      const promptHash = `${optimizedSystemPrompt.length}:${optimizedSystemPrompt.slice(0, 64)}`;
      const canUsePromptReference = chatSnapshot?._systemPromptHash === promptHash;
      const systemSeed = canUsePromptReference
        ? "Continue following the established system directives for this chat: concise answers, fenced code blocks, and strict shell/web formatting rules."
        : optimizedSystemPrompt;
      const systemWithSummary = !tokenBudgets.relaxed && summaryText
        ? `${systemSeed}\n\n[Condensed conversation context]\n${summaryText}`
        : systemSeed;

      if (!canUsePromptReference) {
        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId
              ? { ...c, _systemPromptHash: promptHash }
              : c
          )
        );
      }

      let toSend = [
        { role: "system", content: systemWithSummary },
        ...secondWindow.recentMessages,
      ];

      // TOKEN OPTIMIZATION: detect deep analysis mode for expanded window
      const deepConfig = resolveDeepAnalysisConfig(processedText || sendText, {
        historyWindowSize, maxInputTokens, maxUserChars,
      });

      // TOKEN OPTIMIZATION: apply tiered compression (L0-L3) before budget enforcement
      const tiered = tieredCompress(toSend, {
        targetTokens: deepConfig.deepAnalysis ? deepConfig.maxInputTokens : tokenBudgets.maxInputTokens,
        maxLevel: deepConfig.deepAnalysis ? 1 : 3, // Be conservative in deep analysis
        deepAnalysis: deepConfig.deepAnalysis,
      });
      toSend = tiered.messages;

      const budgetApplied = enforceInputTokenBudget(toSend, deepConfig.deepAnalysis ? deepConfig.maxInputTokens : tokenBudgets.maxInputTokens);
      toSend = budgetApplied.messages;

      if (tiered.savings.tokens > 0) {
        setTokenNotice(`Tiered compression (${tiered.compressionLog.map(l => l.name).join(' → ')}) saved ~${tiered.savings.tokens} tokens (${tiered.savings.percentage}%).`);
      } else if (!tokenBudgets.relaxed && budgetApplied.compressedCount > 0) {
        setTokenNotice(`Compressed ${budgetApplied.compressedCount} older message(s) to fit context budget without removing turns.`);
      } else if (!tokenBudgets.relaxed && budgetApplied.overBudget) {
        setTokenNotice("Context is still large. Some providers may be slower for this request.");
      } else if (deepConfig.deepAnalysis) {
        setTokenNotice("Deep analysis mode: expanded context window (40 msgs / 32K tokens).");
      }

      // TOKEN OPTIMIZATION: update budget info for the meter UI
      const prediction = predictTokenBudget(
        currentModelObj?.id || requestedModelSelection,
        effectiveTask || "general"
      );
      setTokenBudgetInfo({
        estimatedTokens: budgetApplied.estimatedTokens,
        maxTokens: deepConfig.deepAnalysis ? deepConfig.maxInputTokens : tokenBudgets.maxInputTokens,
        compressionLevel: tiered.level,
        savings: tiered.savings,
        compressionLog: tiered.compressionLog,
        deepAnalysis: deepConfig.deepAnalysis,
        segments: {
          system: estimateTokensFromText(systemWithSummary),
          summary: estimateTokensFromText(summaryText || ""),
          history: budgetApplied.estimatedTokens - estimateTokensFromText(systemWithSummary),
        },
        prediction,
      });

      setLastTokenStats((prev) => ({ ...prev, sent: budgetApplied.estimatedTokens }));
      console.info(`[TOKEN OPTIMIZATION] estimated prompt tokens: ${budgetApplied.estimatedTokens}, compression: L${tiered.level}, saved: ${tiered.savings.tokens} tokens (${tiered.savings.percentage}%)${deepConfig.deepAnalysis ? ' [DEEP MODE]' : ''}`);

      try {
        const shouldRunImageGeneration =
          !!currentModelObj &&
          (
            isImageGenModel(currentModelObj) ||
            (effectiveTask === "text-to-image" && supportsTask(currentModelObj, "text-to-image"))
          );

        // ── Image generation ──────────────────────────────────────────────────
        if (shouldRunImageGeneration) {
          const imageResult = await routeImageGen(providers, currentModelObj, textContent);
          const imageUrl = imageResult?.imageUrl;
          const pricing = currentModelObj?.pricing;
          const resolvedUsage = imageResult?.usage && (
            (imageResult.usage.prompt_tokens || 0) > 0 ||
            (imageResult.usage.completion_tokens || 0) > 0 ||
            (imageResult.usage.image_tokens || 0) > 0
          )
            ? imageResult.usage
            : estimateUsageFromMessages([{ role: "user", content: textContent }], "");
          const apiCost = imageResult?.cost ?? imageResult?.usage?.cost;
          const cost = (apiCost != null && apiCost >= 0) ? apiCost : calculateCost(resolvedUsage, pricing);
          const free = isModelFree(pricing);
          const usageSnapshot = recordProviderUsage(currentModelObj?._provider || "openrouter", resolvedUsage, cost);
          setProviderUsage(usageSnapshot);
          setLastTokenStats({
            sent: resolvedUsage?.prompt_tokens || estimateTokensFromText(textContent),
            received:
              resolvedUsage?.completion_tokens ||
              resolvedUsage?.image_tokens ||
              0,
          });

          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              const next = [...c.messages];
              next[next.length - 1] = {
                ...next[next.length - 1],
                content: "",
                _imageUrl: imageUrl,
                cost,
                isFree: free,
                usage: resolvedUsage,
                _modelUsed: currentModelObj?._selectionId || requestedModelSelection,
              };
              return { ...c, messages: next };
            })
          );
          setLoading(false);
          recordSuccess(requestedModelSelection, Date.now() - startTime);
          return;
        }


        if (didAttemptWebSearch) {
          setWebPreparingChatId(chatId);
        }

        let receivedFirstChunk = false;

        const result = await routeStream(
          providers,
          currentModelObj || { id: requestedModelSelection.includes("::") ? requestedModelSelection.split("::").slice(1).join("::") : requestedModelSelection, _provider: "openrouter" },
          toSend,
          {
            signal: controller.signal,
            reasoningDepth,
            maxTokens: generationSettings.maxTokens,
            temperature: generationSettings.temperature,
            topP: generationSettings.topP,
            ...(generationSettings.frequencyPenalty ? { frequencyPenalty: generationSettings.frequencyPenalty } : {}),
            onChunk: (fullText) => {
              if (!receivedFirstChunk) {
                receivedFirstChunk = true;
                setWebPreparingChatId((prev) => (prev === chatId ? null : prev));
              }
              setChats((prev) =>
                prev.map((c) => {
                  if (c.id !== chatId) return c;
                  const next = [...c.messages];
                  const last = next[next.length - 1];
                  next[next.length - 1] = { ...last, content: fullText };
                  return { ...c, messages: next };
                })
              );
            },
          }
        );

        // Calculate and store cost on the AI message
        const pricing = currentModelObj?.pricing;
        const resolvedUsage = result.usage && ((result.usage.prompt_tokens || 0) > 0 || (result.usage.completion_tokens || 0) > 0)
          ? result.usage
          : estimateUsageFromMessages(toSend, result.text);
        // Prefer actual cost from OpenRouter API, fall back to local calculation
        const apiCost = result.usage?.cost;
        const cost = (apiCost != null && apiCost >= 0) ? apiCost : calculateCost(resolvedUsage, pricing);
        const free = isModelFree(pricing);
        const usageSnapshot = recordProviderUsage(currentModelObj?._provider || "openrouter", resolvedUsage, cost);
        setProviderUsage(usageSnapshot);

        const receivedTokens = resolvedUsage?.completion_tokens || estimateTokensFromText(result.text || "");
        const sentTokens = resolvedUsage?.prompt_tokens || budgetApplied.estimatedTokens;
        setLastTokenStats({ sent: sentTokens, received: receivedTokens });
        console.info(`[TOKEN OPTIMIZATION] tokens sent≈${sentTokens} received≈${receivedTokens}`);

        // TOKEN OPTIMIZATION: record usage for predictive budgeting
        recordTokenUsage(
          currentModelObj?.id || requestedModelSelection,
          effectiveTask || "general",
          resolvedUsage,
          { level: tiered.level, savingsPercent: tiered.savings.percentage }
        );

        responseCacheRef.current = setCachedResponseEntry(responseCacheRef.current, cacheKey, {
          response: result.text || "",
          usage: resolvedUsage,
          modelUsed: currentModelObj?._selectionId || requestedModelSelection,
        });

        // Record success for rate limiter
        const responseTime = Date.now() - startTime;
        recordSuccess(requestedModelSelection, responseTime);

        // Generate advisor data
        const taskTypeForAdvisor = uiTaskToAdvisorTask(effectiveTask, processedText || sendText, uploads, attachedFiles);
        const advisor = generateAdvisorData({
          models,
          currentModelId: currentModelObj?._selectionId || requestedModelSelection,
          taskType: taskTypeForAdvisor,
          cost,
          usage: resolvedUsage,
          pricing,
          preference: advisorPrefs?.preferBest ? "best" : advisorPrefs?.preferFree ? "free" : modelPref,
          monthlyBudget: advisorPrefs?.monthlyBudget || null,
          rankingSignals: advisorSignals,
          advisorContext,
        });

        setChats((prev) =>
          prev.map((c) => {
            if (c.id !== chatId) return c;
            const next = [...c.messages];
            const lastMsg = next[next.length - 1];
            next[next.length - 1] = {
              ...lastMsg,
              cost: cost,
              isFree: free,
              usage: resolvedUsage,
              _modelUsed: currentModelObj?._selectionId || requestedModelSelection,
              _advisorData: advisor,
            };
            return { ...c, messages: next };
          })
        );


        // Play notification sound if enabled and app is in background
        try {
          const soundEnabled = localStorage.getItem("kp_notification_sound") === "true";
          if (soundEnabled && document.hidden) {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();
            osc.connect(gainNode);
            gainNode.connect(ctx.destination);

            // Gentle double chime
            osc.type = "sine";
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);

            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
            gainNode.gain.setTargetAtTime(0, ctx.currentTime + 0.1, 0.1);

            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.5);

            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.type = "sine";
            osc2.frequency.setValueAtTime(1000, ctx.currentTime + 0.15);
            osc2.frequency.exponentialRampToValueAtTime(1600, ctx.currentTime + 0.25);
            gain2.gain.setValueAtTime(0, ctx.currentTime + 0.15);
            gain2.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.2);
            gain2.gain.setTargetAtTime(0, ctx.currentTime + 0.25, 0.15);

            osc2.start(ctx.currentTime + 0.15);
            osc2.stop(ctx.currentTime + 0.8);
          }
        } catch (err) {
          console.warn("Could not play notification sound:", err);
        }

        // Use a free HuggingFace model in the background to extract memory from this exchange
        if (userMemory.autoMode) {
          extractMemoryWithAI(providers, sendText.trim(), result.text || "").then((aiMemory) => {
            if (aiMemory && hasUserMemory(aiMemory)) {
              const merged = mergeUserMemory(userMemoryRef.current, aiMemory);
              handleSaveMemory(merged).catch(() => { });
            }
          }).catch(() => { });
        }

        // Refresh OpenRouter credits if key is present
        if (providers?.openrouter) {
          fetchCredits(providers.openrouter).then((c) => { if (c) setLifetimeCost(c); });
        }
      } catch (err) {
        if (err.name === "AbortError") {
          // Keep partial response — stream recovery: if we got partial content, preserve it
          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              const last = c.messages[c.messages.length - 1];
              if (last?.role === "assistant" && last.content) {
                const next = [...c.messages];
                next[next.length - 1] = { ...last, _partial: true };
                return { ...c, messages: next };
              }
              return c;
            })
          );
        } else {
          const errMsg = err.message || "Failed to get a response. Please try again.";

          // Auto-retry for transient/rate-limit errors
          const isRetryable = /429|rate.?limit|too many|503|502|500|overloaded|capacity|server error/i.test(errMsg);
          const retryAttempt = (opts?.retryAttempt || 0);
          const maxAutoRetries = 3;

          if (isRetryable && retryAttempt < maxAutoRetries && !abortRef.current?.signal?.aborted) {
            const delayMs = Math.min(2000 * Math.pow(2, retryAttempt), 16000);
            const attempt = retryAttempt + 1;
            console.log(`[AutoRetry] Attempt ${attempt}/${maxAutoRetries} in ${delayMs}ms...`);

            // Show retry progress on the message
            setChats((prev) =>
              prev.map((c) => {
                if (c.id !== chatId) return c;
                const last = c.messages[c.messages.length - 1];
                if (last?.role === "assistant") {
                  const next = [...c.messages];
                  next[next.length - 1] = { ...last, content: "", _retrying: { attempt, maxAutoRetries, delayMs } };
                  return { ...c, messages: next };
                }
                return c;
              })
            );

            // Wait then retry
            await new Promise((r) => setTimeout(r, delayMs));

            // Clear the AI placeholder so handleSend creates a new one
            setChats((prev) =>
              prev.map((c) => {
                if (c.id !== chatId) return c;
                const msgs = c.messages.filter((m, idx) => !(idx === c.messages.length - 1 && m.role === "assistant" && m._retrying));
                return { ...c, messages: msgs };
              })
            );

            setLoading(false);
            abortRef.current = null;

            // Re-send with incremented retry
            try {
              handleSend(sendText, { ...opts, retryAttempt: attempt, targetChatId: chatId });
            } catch { }
            return;
          }

          setError(errMsg);
          setLastError(errMsg);

          // Record failure for rate limiter
          recordFailure(requestedModelSelection, errMsg);

          // Show rate limit banner — prefer same-provider fallback, then cross-provider
          const taskType = uiTaskToAdvisorTask(selectedTask, sendText, uploads, attachedFiles);
          const sameProviderFallback = findFallbackModel(models.filter((m) => supportsTask(m, selectedTask)), requestedModelSelection, taskType, qualityScore);
          const crossProviderFallback = !sameProviderFallback
            ? suggestFallbackAcrossProviders(models, requestedModelSelection, providers)
            : null;
          const fallback = sameProviderFallback || crossProviderFallback?.model;
          const fallbackMsg = crossProviderFallback?.message;
          if (fallback) {
            setRateLimitBanner({
              visible: true,
              modelId: requestedModelSelection,
              fallbackModelId: fallback.id,
              crossProviderMessage: fallbackMsg || null,
              onSwitch: () => {
                setSelectedModel(toSelectionId(fallback));
                setRateLimitBanner(null);
              },
              onDismiss: () => setRateLimitBanner(null),
            });
          }

          // Store error on the AI message (instead of removing it) for retry UI
          // Stream recovery: preserve partial content if any was received
          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              const last = c.messages[c.messages.length - 1];
              if (last?.role === "assistant") {
                const next = [...c.messages];
                const hasPartial = !!last.content;
                next[next.length - 1] = {
                  ...last,
                  _error: hasPartial
                    ? `Stream interrupted: ${errMsg} (partial response preserved)`
                    : errMsg,
                  _partial: hasPartial,
                };
                return { ...c, messages: next };
              }
              return c;
            })
          );
          console.error(err);
        }
      } finally {
        abortRef.current = null;
        setLoading(false);
        setWebPreparingChatId((prev) => (prev === chatId ? null : prev));
      }
    },
    [
      providers,
      selectedModel,
      activeChatId,
      chats,
      attachedFiles,
      uploads,
      models,
      systemPrompt,
      advisorPrefs,
      modelPref,
      advisorSignals,
      reasoningDepth,
      userMemory,
      webSearchMode,
      platformInfo,
      handleSaveMemory,
      selectedTask,
      maxUserChars,
      maxInputTokens,
      historyWindowSize,
      responseLength,
      summarizeOverflowHistory,
      getOptimizedSystemPrompt,
    ]
  );


  const handleCompareStart = useCallback(async (text, compareTargets) => {
    const chatId = compareTargetChatId || activeChatId;
    if (!chatId) return;

    const initialModels = compareTargets.map(id => ({
      id,
      content: "",
      cost: 0,
      status: "streaming",
      usage: null,
      _modelObj: findModelBySelection(models, id) || { id, _provider: "openrouter" }
    }));

    setChats(prev => prev.map(c => {
      if (c.id !== chatId) return c;
      const newMsgs = [
        ...(c.messages || []),
        { role: "user", content: text },
        { role: "comparison", models: initialModels, originalText: text } // add original text so we can re-extract context if needed
      ];
      return { ...c, messages: newMsgs };
    }));

    setLoading(true);
    const controller = new AbortController();

    const promptData = [{ role: "user", content: text }];

    Promise.allSettled(compareTargets.map((modelId, index) => {
      const obj = initialModels[index]._modelObj;
      return routeStream(providers, obj, promptData, {
        signal: controller.signal,
        maxTokens: 4000,
        onChunk: (chunk) => {
          setChats(prev => prev.map(c => {
            if (c.id !== chatId) return c;
            const next = [...c.messages];
            const last = next[next.length - 1];
            if (last && last.role === "comparison") {
              const nextModels = [...last.models];
              if (nextModels[index]) nextModels[index] = { ...nextModels[index], content: chunk };
              next[next.length - 1] = { ...last, models: nextModels };
            }
            return { ...c, messages: next };
          }));
        }
      }).then(res => {
        const usage = res.usage || estimateUsageFromMessages(promptData, res.text);
        const cost = calculateCost(usage, obj.pricing);
        setChats(prev => prev.map(c => {
          if (c.id !== chatId) return c;
          const next = [...c.messages];
          const last = next[next.length - 1];
          if (last && last.role === "comparison") {
            const nextModels = [...last.models];
            if (nextModels[index]) nextModels[index] = { ...nextModels[index], content: res.text || "", status: "done", usage, cost };
            next[next.length - 1] = { ...last, models: nextModels };
          }
          return { ...c, messages: next };
        }));
      }).catch(err => {
        setChats(prev => prev.map(c => {
          if (c.id !== chatId) return c;
          const next = [...c.messages];
          const last = next[next.length - 1];
          if (last && last.role === "comparison") {
            const nextModels = [...last.models];
            if (nextModels[index]) nextModels[index] = { ...nextModels[index], status: "error", content: "Error: " + err.message };
            next[next.length - 1] = { ...last, models: nextModels };
          }
          return { ...c, messages: next };
        }));
      });
    })).finally(() => {
      setLoading(false);
    });
  }, [activeChatId, compareTargetChatId, chats, models, providers]);

  const handleResolveComparison = useCallback((chatId, messageIndex, winningModelIndex) => {
    setChats(prev => prev.map(c => {
      if (c.id !== chatId) return c;
      const next = [...c.messages];
      const comparativeMsg = next[messageIndex];
      if (comparativeMsg && comparativeMsg.role === "comparison") {
        const winner = comparativeMsg.models[winningModelIndex];
        // Transform the message block transparently into a standard assistant reply
        next[messageIndex] = {
          role: "assistant",
          content: winner.content,
          usage: winner.usage,
          cost: winner.cost,
          isFree: isModelFree(winner._modelObj?.pricing),
          _modelUsed: winner.id,
          _convertedFromCompare: true
        };
      }
      return { ...c, messages: next };
    }));
  }, []);

  const handleAgentSend = useCallback(async (text, opts = {}) => {

    const sendText = String(text || "").trim();
    if (!sendText) return;

    const executionMode = opts.executionMode === "direct" ? "direct" : "plan_first";
    const requireApproval = opts.requireApproval !== false;

    let workspacePath = String(agentWorkspacePath || "").trim();
    if (!workspacePath && opts.workspacePath) {
      workspacePath = String(opts.workspacePath || "").trim();
    }
    if (!workspacePath) {
      setAgentSessionStatus("idle");
      setAgentError("Select a workspace folder in Agent mode before running.");
      return;
    }

    const requestedModelSelection = opts.modelOverride || selectedModel;
    if (!requestedModelSelection) {
      setAgentError("Select an agent-compatible model before running.");
      return;
    }

    const currentModelObj = findModelBySelection(models, requestedModelSelection);
    if (!currentModelObj) {
      setAgentError("Selected model is unavailable. Choose another model.");
      return;
    }

    let chatId = opts.targetChatId || activeAgentChatId;
    if (!chatId) {
      chatId = generateId();
      setActiveAgentChatId(chatId);
    } else if (chatId !== activeAgentChatId) {
      setActiveAgentChatId(chatId);
    }

    const contextMessages = (agentChats.find((c) => c.id === chatId)?.messages || []).filter(
      (m) => m.role === "user" || m.role === "assistant"
    );

    const requestId = generateId();
    setAgentRequestId(requestId);
    setAgentSessionStatus("running");
    setAgentError("");
    setAgentPlan([]);
    setAgentCurrentStep("Preparing agent run");
    setAgentStepDetails("");
    setAgentPendingCommand("");
    setAgentCommandDraft("");
    setAgentTerminalLines([]);
    setAgentRunStats({
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
      changeOps: 0,
      changedFiles: [],
    });

    if (agentPermissionRequestRef.current?.resolve) {
      try {
        agentPermissionRequestRef.current.resolve({ allowed: false });
      } catch { }
      agentPermissionRequestRef.current = null;
    }

    agentLoopAbortRef.current?.abort();
    const abortController = new AbortController();
    agentLoopAbortRef.current = abortController;

    setAgentChats((prevChats) => {
      const existing = prevChats.find((chat) => chat.id === chatId);
      if (!existing) {
        const initialMessages = [{ role: "user", content: sendText }];
        const newChat = { id: chatId, title: deriveTitle(initialMessages), messages: initialMessages };
        return [newChat, ...prevChats];
      }

      return prevChats.map((chat) => {
        if (chat.id !== chatId) return chat;
        const nextMessages = [...(chat.messages || []), { role: "user", content: sendText }];
        return { ...chat, messages: nextMessages, title: deriveTitle(nextMessages) };
      });
    });

    try {
      const platform = platformInfo?.platform || detectPlatformFromNavigator();
      const osName = platformToOsName(platform);
      const shellName = platformToShell(platform, platformInfo?.preferredShell);

      const loop = new AgentLoop({
        model: currentModelObj,
        providerKeys: providers,
        workspacePath,
        electronAPI: window.electronAPI,
        osName,
        shell: shellName,
        executionMode,
        autoExecute: !requireApproval,
        signal: abortController.signal,
        onStatus: (textValue) => {
          const textLine = String(textValue || "").trim();
          if (!textLine) return;
          setAgentStepDetails(textLine);
        },
        onPlan: (steps) => {
          setAgentPlan(Array.isArray(steps) ? steps : []);
        },
        onStep: ({ step, details }) => {
          if (step) setAgentCurrentStep(String(step));
          if (details) setAgentStepDetails(String(details));
        },
        onText: (textValue) => {
          const textLine = String(textValue || "").trim();
          if (!textLine) return;
          setAgentStepDetails(textLine);
        },
        onToolExecution: ({ tool, category, target, status, text: statusText, meta }) => {
          const marker = status === "error" ? "!" : status === "success" ? "ok" : status === "denied" ? "--" : ">";
          const line = `${marker} [${category || "ACTION"}] ${tool || "tool"} ${target || ""}`.trim();
          setAgentTerminalLines((prev) => [...prev, line]);

          if (status === "success" && meta && (meta.tool === "write_file" || meta.tool === "edit_file")) {
            const changedPath = String(meta.path || target || "").trim();
            const added = Math.max(0, Number(meta.added) || 0);
            const removed = Math.max(0, Number(meta.removed) || 0);
            const created = !!meta.created;

            if (changedPath) {
              const label = created ? "created" : "updated";
              setAgentTerminalLines((prev) => [
                ...prev,
                `~ ${label} ${changedPath} (+${added} -${removed})`,
              ]);
            }

            setAgentRunStats((prev) => {
              const previousFiles = Array.isArray(prev.changedFiles) ? [...prev.changedFiles] : [];
              const index = previousFiles.findIndex((entry) => entry.path === changedPath);

              if (index >= 0) {
                const existing = previousFiles[index];
                previousFiles[index] = {
                  ...existing,
                  added: Math.max(0, Number(existing.added) || 0) + added,
                  removed: Math.max(0, Number(existing.removed) || 0) + removed,
                  created: existing.created || created,
                  ops: Math.max(0, Number(existing.ops) || 0) + 1,
                };
              } else if (changedPath) {
                previousFiles.push({
                  path: changedPath,
                  added,
                  removed,
                  created,
                  ops: 1,
                });
              }

              return {
                filesChanged: previousFiles.length,
                linesAdded: Math.max(0, Number(prev.linesAdded) || 0) + added,
                linesRemoved: Math.max(0, Number(prev.linesRemoved) || 0) + removed,
                changeOps: Math.max(0, Number(prev.changeOps) || 0) + 1,
                changedFiles: previousFiles.slice(0, 10),
              };
            });
          }

          if (statusText) {
            setAgentStepDetails(String(statusText));
          }
        },
        onTerminalLine: (line) => {
          const safeLine = String(line || "").trim();
          if (!safeLine) return;
          setAgentTerminalLines((prev) => [...prev, safeLine]);
        },
        requestPermission: ({ toolCall, category, target }) =>
          new Promise((resolvePermission) => {
            if (String(category || "").toUpperCase() === "READ") {
              resolvePermission({ allowed: true });
              return;
            }

            const toolName = String(toolCall?.tool || "action").trim();
            const targetLabel = String(target || toolCall?.params?.path || toolCall?.params?.command || toolName).trim();
            const draftText =
              toolName === "run_command"
                ? String(toolCall?.params?.command || "").trim()
                : `${toolName} ${targetLabel}`.trim();

            agentPermissionRequestRef.current = {
              resolve: resolvePermission,
              toolCall,
              category,
              target: targetLabel,
            };

            setAgentPendingCommand(targetLabel || toolName);
            setAgentCommandDraft(draftText);
            setAgentCurrentStep("Awaiting approval");
            setAgentStepDetails(`${category || "ACTION"}: ${targetLabel || toolName}`);
            setAgentSessionStatus("awaiting-approval");
            setAgentTerminalLines((prev) => [
              ...prev,
              `> approval required: [${category || "ACTION"}] ${targetLabel || toolName}`,
            ]);
          }),
      });

      const result = await loop.run({ userMessage: sendText, contextMessages });
      if (abortController.signal.aborted) return;

      if (!result?.success) {
        throw new Error(String(result?.error || "Agent run failed."));
      }

      const finalText = String(result.finalText || "").trim();
      if (finalText) {
        setAgentChats((prevChats) =>
          prevChats.map((chat) => {
            if (chat.id !== chatId) return chat;
            const nextMessages = [...(chat.messages || []), { role: "assistant", content: finalText }];
            return { ...chat, messages: nextMessages, title: deriveTitle(nextMessages) };
          })
        );
      }

      setAgentSessionStatus("done");
      setAgentCurrentStep("");
      setAgentStepDetails("");
      setAgentPendingCommand("");
      setAgentCommandDraft("");
      setAgentRequestId("");
    } catch (err) {
      if (abortController.signal.aborted) {
        setAgentSessionStatus("idle");
        setAgentError("");
        return;
      }
      setAgentSessionStatus("error");
      setAgentError(String(err?.message || "Agent run failed."));
    } finally {
      if (agentLoopAbortRef.current === abortController) {
        agentLoopAbortRef.current = null;
      }
      if (agentPermissionRequestRef.current?.resolve && abortController.signal.aborted) {
        try {
          agentPermissionRequestRef.current.resolve({ allowed: false });
        } catch { }
        agentPermissionRequestRef.current = null;
      }
      setAgentRequestId((prev) => (prev === requestId ? "" : prev));
    }
  }, [activeAgentChatId, agentChats, agentWorkspacePath, models, platformInfo, providers, selectedModel]);

  const handleModeAwareSend = useCallback((text, opts = {}) => {
    if (interactionMode === "agent") {
      return handleAgentSend(text, opts);
    }
    return handleSend(text, opts);
  }, [interactionMode, handleAgentSend, handleSend]);

  const handleAgentAllowCommand = useCallback(async () => {
    const pending = agentPermissionRequestRef.current;
    if (pending?.resolve) {
      const toolName = String(pending.toolCall?.tool || "").trim();
      const draft = String(agentCommandDraft || "").trim();

      if (toolName === "run_command" && !draft) return;

      const overrides = toolName === "run_command" ? { command: draft } : null;
      const approvalLine = toolName === "run_command"
        ? `> approved command: ${draft}`
        : `> approved action: ${pending.category || "ACTION"} ${pending.target || toolName}`;

      setAgentTerminalLines((prev) => [...prev, approvalLine]);
      setAgentPendingCommand("");
      setAgentCommandDraft("");
      setAgentSessionStatus("running");

      agentPermissionRequestRef.current = null;
      pending.resolve({ allowed: true, overrides });
      return;
    }

    const cmd = String(agentCommandDraft || agentPendingCommand || "").trim();
    if (!cmd || !window.electronAPI?.executeCommand) return;

    const cwd = String(agentWorkspacePath || "").trim() || undefined;
    const result = await window.electronAPI.executeCommand(cmd, cwd);
    if (!result?.ok) {
      setAgentTerminalLines((prev) => [...prev, `! ${result?.error || "Command failed to start."}`]);
      return;
    }

    agentTerminalRunIdsRef.current.add(result.id);
    setAgentTerminalLines((prev) => [...prev, `$ ${cmd}`]);
    setAgentPendingCommand("");
  }, [agentCommandDraft, agentPendingCommand, agentWorkspacePath]);

  const handlePickAgentWorkspace = useCallback(async () => {
    try {
      const folder = await window.electronAPI?.selectFolder?.();
      if (!folder) return;
      const nextPath = String(folder);
      setAgentWorkspacePath(nextPath);
      if (window.electronAPI?.setWorkspaceBase) {
        await window.electronAPI.setWorkspaceBase(nextPath);
      }
      setAgentError("");
    } catch (err) {
      setAgentError(String(err?.message || "Failed to select workspace folder."));
    }
  }, []);

  const handleClearAgentWorkspace = useCallback(() => {
    setAgentWorkspacePath("");
  }, []);

  const handleAgentDenyCommand = useCallback(() => {
    const pending = agentPermissionRequestRef.current;
    if (pending?.resolve) {
      setAgentTerminalLines((prev) => [...prev, "> action denied by user"]);
      setAgentPendingCommand("");
      setAgentCommandDraft("");
      setAgentSessionStatus("running");
      agentPermissionRequestRef.current = null;
      pending.resolve({ allowed: false });
      return;
    }

    setAgentTerminalLines((prev) => [...prev, "> command denied by user"]);
    setAgentPendingCommand("");
    setAgentCommandDraft("");
  }, []);

  const handleQueueAgentCommand = useCallback((commandText) => {
    const command = String(commandText || "").trim();
    if (!command) return;
    setAgentPendingCommand(command);
    setAgentCommandDraft(command);
    setAgentTerminalLines((prev) => [...prev, `> queued command: ${command}`]);
  }, []);

  const handleAgentResetSession = useCallback(async (chatId) => {
    if (!chatId) return;
    resetAgentUiState();
    if (agentPermissionRequestRef.current?.resolve) {
      try {
        agentPermissionRequestRef.current.resolve({ allowed: false });
      } catch { }
      agentPermissionRequestRef.current = null;
    }
    agentLoopAbortRef.current?.abort();
    agentLoopAbortRef.current = null;
  }, [resetAgentUiState]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    agentLoopAbortRef.current?.abort();
    agentLoopAbortRef.current = null;
    if (agentPermissionRequestRef.current?.resolve) {
      try {
        agentPermissionRequestRef.current.resolve({ allowed: false });
      } catch { }
      agentPermissionRequestRef.current = null;
    }
    searchTokenRef.current += 1;
    setIsSearching(false);
    setSearchingChatId(null);
    setWebPreparingChatId(null);
    setLoading(false);
    if (interactionMode === "agent") {
      setAgentSessionStatus("idle");
    }
  }, [interactionMode]);

  /**
   * Retry or regenerate last request.
   * @param {"same"|"better"} mode
   */
  const handleRetryOrRegenerate = useCallback(
    (mode) => {
      const last = lastRequestRef.current;
      if (!last) return;

      if (mode === "better") {
        // Open model picker — user chooses the model, then we regenerate
        setRetryModelSearch("");
        setRetryModelFilter("all");
        setModelPickerOpen(true);
        return;
      }

      // Remove last AI + user messages so handleSend re-adds them cleanly
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== activeChatId) return c;
          const msgs = [...c.messages];
          if (msgs[msgs.length - 1]?.role === "assistant") msgs.pop();
          if (msgs[msgs.length - 1]?.role === "user") msgs.pop();
          return { ...c, messages: msgs };
        })
      );

      setError("");
      setLastError(null);
      setTimeout(() => handleSend(last.text, { bypassCache: true }), 50);
    },
    [activeChatId, handleSend]
  );

  const selectModelAndSyncTask = useCallback((modelSelId) => {
    setSelectedModel(modelSelId);

    const chosen = findModelBySelection(models, modelSelId);
    if (!chosen) return;

    if (isImageGenModel(chosen)) {
      if (selectedTask !== "text-to-image") setSelectedTask("text-to-image");
      return;
    }

    if (selectedTask === "text-to-image") {
      setSelectedTask("text-generation");
    }
  }, [models, selectedTask]);

  /** Called when user picks a model from the picker and wants to retry */
  const handleRetryWithModel = useCallback(
    (modelSelId) => {
      const last = lastRequestRef.current;
      if (!last) return;
      setModelPickerOpen(false);
      selectModelAndSyncTask(modelSelId);

      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== activeChatId) return c;
          const msgs = [...c.messages];
          if (msgs[msgs.length - 1]?.role === "assistant") msgs.pop();
          if (msgs[msgs.length - 1]?.role === "user") msgs.pop();
          return { ...c, messages: msgs };
        })
      );

      setError("");
      setLastError(null);
      setTimeout(() => handleSend(last.text, { modelOverride: modelSelId, bypassCache: true }), 80);
    },
    [activeChatId, handleSend, selectModelAndSyncTask]
  );

  // Keep ref current so the event handler never captures a stale closure
  useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

  // Listen for terminal command completions and feed output back to the AI
  useEffect(() => {
    const shellFence = preferredTerminalFence(platformInfo);

    const handler = (e) => {
      const { cmd, output, exitCode, blocked } = e.detail || {};
      if (!cmd || !handleSendRef.current) return;

      const trimmedOutput = (output || "").slice(0, 4000); // cap size
      const status = blocked
        ? `Command was blocked by safety filter.`
        : exitCode === 0
          ? `Command succeeded (exit 0).`
          : `Command failed (exit ${exitCode}).`;

      const feedbackText =
        `Terminal command completed:\n` +
        `\`\`\`\n$ ${cmd}\n${trimmedOutput}\n\`\`\`\n` +
        `${status}\n\n` +
        (exitCode !== 0 || blocked
          ? `Analyze this output. If a tool is missing or an error occurred, diagnose it and provide a fix as a \`\`\`${shellFence} code block.`
          : `Briefly confirm what this output means in one sentence.`);

      handleSendRef.current(feedbackText, { silent: true });
    };

    window.addEventListener("kp-command-done", handler);
    return () => window.removeEventListener("kp-command-done", handler);
  }, [platformInfo]);

  /** Called from MessageList retry buttons (on error messages) */
  const handleRetry = useCallback(
    (mode) => handleRetryOrRegenerate(mode),
    [handleRetryOrRegenerate]
  );

  /** Called from MessageList regenerate buttons (on completed messages) */
  const handleRegenerate = useCallback(
    (mode) => handleRetryOrRegenerate(mode),
    [handleRetryOrRegenerate]
  );

  /** Called when user clicks a generated key point to request an in-depth follow-up. */
  const handlePointDeepDive = useCallback((pointText, targetChatId = activeChatId) => {
    const topic = String(pointText || "").replace(/\s+/g, " ").trim();
    if (!topic) return;

    const deepPrompt =
      `Provide a deep analysis of this specific point using current web sources:\n\n` +
      `"${topic}"\n\n` +
      `Cover background, latest developments, key actors, evidence, competing perspectives, risks, and near-term outlook. ` +
      `Cite sources as [1], [2], etc.`;

    // Run as hidden follow-up so only the assistant output is shown.
    handleModeAwareSend(deepPrompt, { silent: true, targetChatId });
  }, [handleModeAwareSend, activeChatId]);

  /** Called from ModelAdvisorCard — switch to a suggested model for next message */
  const handleAdvisorSwitch = useCallback((modelId) => {
    selectModelAndSyncTask(modelId);
  }, [selectModelAndSyncTask]);

  const handleNewChat = () => {
    const newChat = { id: generateId(), title: "New Chat", messages: [] };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setError("");
    if (interactionMode === "agent") {
      handleAgentResetSession(newChat.id);
    }
  };

  const handleSelectChat = (id) => {
    if (id === activeChatId) return;
    if (secondaryChatId === id && activeChatId) {
      setSecondaryChatId(activeChatId);
    }
    setActiveChatId(id);
    setError("");
  };

  const handleRenameChat = useCallback((chatId, nextTitle) => {
    const title = String(nextTitle || "").trim();
    if (!chatId || !title) return;
    setChats((prev) =>
      prev.map((chat) => (chat.id === chatId ? { ...chat, title } : chat))
    );
  }, []);

  const handleToggleSecondaryChat = useCallback((id) => {
    if (!id || id === activeChatId) {
      setSecondaryChatId("");
      return;
    }
    setSecondaryChatId((prev) => (prev === id ? "" : id));
  }, [activeChatId]);

  const handleAcceptSuggestion = useCallback((modelId) => {
    selectModelAndSyncTask(modelId);
    setSmartSuggestion(null);
    setSuggestionDismissed(false);
  }, [selectModelAndSyncTask]);

  const handleDismissSuggestion = useCallback(() => {
    setSuggestionDismissed(true);
  }, []);

  /** Debounced live detection of task type from input text */
  const inputDebounceRef = useRef(null);
  const handleInputTextChange = useCallback((text) => {
    setDraftInputText(text || "");
    clearTimeout(inputDebounceRef.current);
    inputDebounceRef.current = setTimeout(() => {
      if (!text || text.length < 10) {
        setTaskBanner(null);
        setCheapestBanner(null);
        return;
      }

      const nextTask = detectUiTask(text, uploads, attachedFiles);
      const currentModel = findModelBySelection(models, selectedModel);
      const lockTaskToSelectedModel = selectedTask === "text-to-image" || isImageGenModel(currentModel);
      const effectiveTask = lockTaskToSelectedModel ? selectedTask : nextTask;

      if (!lockTaskToSelectedModel && nextTask !== selectedTask) setSelectedTask(nextTask);
      const taskType = uiTaskToAdvisorTask(effectiveTask, text, uploads, attachedFiles);
      if (taskType === "general") {
        setTaskBanner(null);
        setCheapestBanner(null);
        return;
      }

      const suggestion = selectSmartModel(models, taskType, selectedModel, modelPref);
      if (!suggestion.currentOk && suggestion.recommended) {
        setTaskBanner({
          visible: true,
          taskType,
          suggestedModelId: suggestion.recommended.id,
          onSwitch: () => {
            setSelectedModel(toSelectionId(suggestion.recommended));
            setTaskBanner(null);
          },
          onIgnore: () => setTaskBanner(null),
        });
      } else {
        setTaskBanner(null);
      }

      // Show cheapest banner for detected task
      const cheapest = findCheapestModel(models, taskType, (m) => supportsTask(m, effectiveTask));
      if (cheapest && toSelectionId(cheapest.model) !== selectedModel) {
        setCheapestBanner({
          visible: true,
          cheapestLabel: cheapest.costLabel,
          cheapestModelId: cheapest.model.id,
          currentModelId: selectedModel,
          onUseCheapest: () => {
            setSelectedModel(toSelectionId(cheapest.model));
            setCheapestBanner(null);
          },
          onKeepCurrent: () => setCheapestBanner(null),
        });
      } else {
        setCheapestBanner(null);
      }
    }, 500); // 500ms debounce
  }, [models, selectedModel, modelPref, uploads, attachedFiles, selectedTask]);

  const handleUseDistilled = useCallback((improvedText) => {
    setDraftInputText(improvedText);
    // Sync the textarea in MessageInput
    const textarea = document.querySelector('[data-message-composer] textarea');
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, improvedText);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, []);

  /** Edit a user message — truncate history to that point and pre-fill the input */
  const handleEditMessage = useCallback((msgIdx) => {
    const chat = chats.find((c) => c.id === activeChatId);
    if (!chat) return;
    const msg = chat.messages[msgIdx];
    if (!msg || msg.role !== "user") return;

    const editText = typeof msg._displayText === "string" ? msg._displayText
      : typeof msg.content === "string" ? msg.content : "";

    // Truncate chat history to just before this message
    setChats((prev) =>
      prev.map((c) =>
        c.id === activeChatId
          ? { ...c, messages: c.messages.slice(0, msgIdx) }
          : c
      )
    );

    // Pre-fill the input with the message text
    setDraftInputText(editText);
    const textarea = document.querySelector('[data-message-composer] textarea');
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, editText);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => textarea.focus(), 50);
    }
  }, [chats, activeChatId]);

  /** Branch the conversation from a specific message into a new chat */
  const handleBranchFromMessage = useCallback((msgIdx) => {
    const chat = chats.find((c) => c.id === activeChatId);
    if (!chat) return;

    const branchedMessages = chat.messages.slice(0, msgIdx + 1).map((m) => ({ ...m }));
    const branchTitle = `Branch: ${chat.title || "Chat"}`;
    const newChat = {
      id: generateId(),
      title: branchTitle,
      messages: branchedMessages,
    };

    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
  }, [chats, activeChatId]);

  const handleTogglePin = (id, e) => {
    e.stopPropagation();
    if (interactionMode === "agent") {
      setAgentChats((prev) => prev.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c));
    } else {
      setChats((prev) => prev.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c));
    }
  };

  const handleUpdateChatFolder = (id, folderId) => {
    if (interactionMode === "agent") {
      setAgentChats((prev) => prev.map(c => c.id === id ? { ...c, folderId } : c));
    } else {
      setChats((prev) => prev.map(c => c.id === id ? { ...c, folderId } : c));
    }
  };

  const handleToggleBookmark = (chatId, msgIndex) => {
    const updateChats = (prev) => prev.map(c => {
      if (c.id !== chatId) return c;
      const newMsgs = [...(c.messages || [])];
      if (newMsgs[msgIndex]) Object.assign(newMsgs[msgIndex], { bookmarked: !newMsgs[msgIndex].bookmarked });
      return { ...c, messages: newMsgs };
    });
    if (interactionMode === "agent") setAgentChats(updateChats);
    else setChats(updateChats);
  };

  const handleDeleteChat = (id) => {
    if (interactionMode === "agent") {
      handleAgentResetSession(id);
    }
    setChats((prev) => {
      const remaining = prev.filter((c) => c.id !== id);

      if (secondaryChatId === id) {
        setSecondaryChatId("");
      }

      if (activeChatId === id) {
        const nextActive = remaining[0]?.id || "";
        setActiveChatId(nextActive);

        if (secondaryChatId && (secondaryChatId === id || secondaryChatId === nextActive)) {
          const nextSecondary = remaining.find((c) => c.id !== nextActive)?.id || "";
          setSecondaryChatId(nextSecondary);
        }
      }

      return remaining;
    });
  };

  /** Export a chat as Markdown */
  const handleExportChat = useCallback(async (chatId) => {
    const chat = chats.find((c) => c.id === chatId);
    if (!chat || !chat.messages?.length) return;

    const lines = [`# ${chat.title || "Untitled Chat"}\n`, `_Exported: ${new Date().toISOString()}_\n\n---\n`];
    for (const msg of chat.messages) {
      if (msg._hidden) continue;
      const role = msg.role === "user" ? "**You**" : "**AI**";
      const text = typeof msg.content === "string" ? msg.content
        : Array.isArray(msg.content) ? msg.content.map((p) => p?.text || "").filter(Boolean).join("\n") : "";
      if (!text.trim()) continue;
      lines.push(`${role}:\n\n${text}\n\n---\n`);
    }

    const content = lines.join("\n");
    const fileName = `${(chat.title || "chat").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50)}_${new Date().toISOString().slice(0, 10)}.md`;

    try {
      if (window.electronAPI?.exportMemory) {
        const result = await window.electronAPI.exportMemory({ suggestedName: fileName, content });
        if (result?.ok) return;
      }
    } catch { }

    // Browser fallback
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [chats]);

  const handleSaveShortcuts = useCallback(async (nextShortcuts) => {
    const merged = mergeShortcuts(nextShortcuts);
    setShortcuts(merged);
    try {
      if (window.electronAPI?.setAllShortcuts) {
        await window.electronAPI.setAllShortcuts(merged);
      } else {
        localStorage.setItem("openrouter_keyboard_shortcuts", JSON.stringify(merged));
      }
    } catch {
      localStorage.setItem("openrouter_keyboard_shortcuts", JSON.stringify(merged));
    }
  }, []);

  const handleResetShortcuts = useCallback(async () => {
    const resetValue = mergeShortcuts({});
    setShortcuts(resetValue);
    try {
      if (window.electronAPI?.resetAllShortcuts) {
        await window.electronAPI.resetAllShortcuts();
      } else {
        localStorage.removeItem("openrouter_keyboard_shortcuts");
      }
    } catch {
      localStorage.removeItem("openrouter_keyboard_shortcuts");
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      const shortcut = eventToShortcut(event);
      if (!shortcut) return;

      const target = event.target;
      const typingTarget = target instanceof HTMLElement && (
        target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.isContentEditable
      );

      // Do not execute global chat shortcuts while inside Settings.
      if (showSettings) return;

      const matches = (actionId) => normalizeShortcutString(shortcuts[actionId]) === shortcut;

      if (typingTarget && !matches("openSettings")) {
        // Allow Ctrl+Shift+F even from a textarea
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
          event.preventDefault();
          setShowChatSearch(true);
          return;
        }
        return;
      }

      // Global Ctrl+Shift+F search
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setShowChatSearch(true);
        return;
      }

      if (matches("openSettings")) {
        event.preventDefault();
        setShowSettings(true);
        setSidebarOpen(false);
        return;
      }

      if (matches("toggleSidebar")) {
        event.preventDefault();
        if (!showSettings) setSidebarOpen((v) => !v);
        return;
      }

      if (matches("newChat")) {
        event.preventDefault();
        if (interactionMode === "chat" && !loading) handleNewChat();
        return;
      }

      if (matches("retryResponse")) {
        event.preventDefault();
        if (interactionMode === "chat" && !loading && lastRequestRef.current) handleRetry("same");
        return;
      }

      if (matches("openModelSelector")) {
        event.preventDefault();
        if (interactionMode === "chat" && !showSettings) setModelSelectorOpenSignal((v) => v + 1);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, showSettings, loading, handleRetry, interactionMode]);

  const renderChatPane = (chat, paneLabel) => {
    if (!chat) return null;
    const paneChatId = chat.id;
    const paneMessages = chat.messages || [];
    const paneActive = paneChatId === activeChatId;

    return (
      <div
        key={`pane-${paneLabel}-${paneChatId}`}
        className={`min-h-0 flex flex-col rounded-sm border overflow-hidden ${paneActive
            ? "border-[#00ff41]/20 bg-[#0d0d0d]/45"
            : "border-white/[0.07] bg-[#0d0d0d]/30"
          }`}
      >
        <div
          onClick={() => handleSelectChat(paneChatId)}
          className={`shrink-0 px-4 py-2.5 border-b cursor-pointer ${paneActive
              ? "border-[#00ff41]/15 bg-[#00ff41]/[0.06]"
              : "border-white/[0.05] bg-[#0d0d0d]/40 hover:bg-[#111111]/45"
            }`}
          title={paneActive ? "Active chat" : "Click to focus this chat"}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#e0e0e0] truncate">{chat.title || "New Chat"}</span>
            <span className={`text-[10px] uppercase tracking-wider ${paneActive ? "text-[#00ff41]" : "text-[#b0b0b0]/40"}`}>
              {paneActive ? "Active" : "Side"}
            </span>
          </div>
        </div>

        <MessageList
          messages={paneMessages}
          loading={loading && paneActive}
          lastError={paneActive ? lastError : null}
          onRetry={handleRetry}
          onRegenerate={handleRegenerate}
          onPointDeepDive={(pointText) => handlePointDeepDive(pointText, paneChatId)}
          onRefine={(msgIdx) => {
            const aiMsg = paneMessages[msgIdx];
            if (!aiMsg || aiMsg.role !== "assistant" || !aiMsg.content) return;
            handleSend(
              "Refine your previous answer: be more precise, fix any issues, and improve the code quality. Keep the same format.",
              { targetChatId: paneChatId }
            );
          }}
          onEditMessage={paneActive ? handleEditMessage : null}
          onBranchFromMessage={paneActive ? handleBranchFromMessage : null}
          onToggleBookmark={(msgIdx) => handleToggleBookmark(paneChatId, msgIdx)}
          onResolveComparison={(msgIdx, winIdx) => handleResolveComparison(paneChatId, msgIdx, winIdx)}
        />
      </div>
    );
  };

  const agentSelectableModels = React.useMemo(() => {
    const filtered = filterModelsForTask(models, "text-generation");
    return filtered.length > 0 ? filtered : models;
  }, [models]);

  if (interactionMode === "agent") {
    const agentTitleCenter = (
      <div className="h-8 flex items-center justify-center">
        <div className="inline-flex items-center h-7 rounded-sm border border-white/[0.08] bg-[#0d0d0d]/70 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setInteractionMode("chat")}
            className="px-2.5 h-6 rounded-md text-[11px] transition-colors cursor-pointer text-[#b0b0b0] hover:text-[#e0e0e0]"
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setInteractionMode("agent")}
            className="px-2.5 h-6 rounded-md text-[11px] transition-colors cursor-pointer bg-kp-indigo-500/20 text-kp-indigo-200 border border-kp-indigo-400/35"
          >
            Agent (Beta)
          </button>
        </div>
      </div>
    );

    return (
      <motion.div
        key="mode-agent"
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.24, ease }}
        className="h-full flex flex-col bg-[#0a0a0a]"
      >
        <TitleBar
          sidebarOpen={false}
          onToggleSidebar={() => { }}
          toggleShortcut={shortcuts.toggleSidebar}
          showSidebarToggle={false}
          menuItems={[]}
          centerContent={agentTitleCenter}
        />
        <div className="flex flex-1 min-h-0">
          <motion.div
            key="agent"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25, ease }}
            className="flex-1 flex flex-col min-w-0 bg-[#090d14]"
          >
            <AgentIdeWorkspace
              chats={agentChats}
              activeChatId={activeAgentChatId}
              agentModels={agentSelectableModels}
              selectedModel={selectedModel}
              onSelectModel={selectModelAndSyncTask}
              messages={agentMessages}
              agentPlan={agentPlan}
              agentCurrentStep={agentCurrentStep}
              agentStepDetails={agentStepDetails}
              agentTerminalLines={agentTerminalLines}
              agentSessionStatus={agentSessionStatus}
              agentError={agentError}
              agentRunStats={agentRunStats}
              agentPendingCommand={agentPendingCommand}
              agentCommandDraft={agentCommandDraft}
              onSetAgentCommandDraft={setAgentCommandDraft}
              onAllowCommand={handleAgentAllowCommand}
              onDenyCommand={handleAgentDenyCommand}
              onQueueCommand={handleQueueAgentCommand}
              agentWorkspacePath={agentWorkspacePath}
              onPickWorkspace={handlePickAgentWorkspace}
              onClearWorkspace={handleClearAgentWorkspace}
              onRunTask={handleAgentSend}
              onSwitchMode={setInteractionMode}
              onOpenSettings={() => setShowSettings(true)}
              onSelectTab={handleSelectChat}
              onRenameTab={handleRenameChat}
            />
          </motion.div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="mode-chat"
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.24, ease }}
      className="h-full flex flex-col bg-[#0a0a0a]"
    >
      <TitleBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} toggleShortcut={shortcuts.toggleSidebar} />
      <div className="flex flex-1 min-h-0">
        {/* ── Sidebar ── */}
        <motion.aside
          initial={false}
          animate={{
            width: sidebarOpen && interactionMode === "chat" ? 260 : 0,
            opacity: sidebarOpen && interactionMode === "chat" ? 1 : 0,
          }}
          transition={{ duration: 0.25, ease }}
          className={`shrink-0 bg-[#0a0a0a] border-r border-[#1a1a1a] flex flex-col overflow-hidden ${interactionMode === "chat" ? "" : "pointer-events-none"}`}
          style={{ boxShadow: sidebarOpen ? "4px 0 12px rgba(0,0,0,0.3)" : "none" }}
        >
          {/* Brand header */}
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center gap-2.5">
              <KPLogo size={32} className="rounded-sm shadow-glow-green" />
              <span className="font-mono text-[#00ff41] font-bold text-sm tracking-wider text-glow-green">KritakaPrajna</span>
            </div>
          </div>
          <div className="separator-fade mx-3" />

          {/* Primary sidebar action */}
          <div className="px-3 pb-3">
            {interactionMode === "chat" ? (
              <>
                <motion.button
                  whileHover={{ scale: 1.01, backgroundColor: "rgba(30, 41, 59, 0.8)" }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.15, ease }}
                  onClick={handleNewChat}
                  title={`New Chat (${shortcuts.newChat})`}
                  className="w-full flex items-center gap-2.5 text-sm text-[#e0e0e0] bg-[#111111] hover:bg-[#1a1a1a] rounded-sm px-3 py-2.5 cursor-pointer border border-[#1a1a1a] hover:border-[#2a2a2a] shadow-elevation-1 hover:shadow-elevation-2 transition-all font-mono"
                >
                  <svg className="w-4 h-4 text-[#b0b0b0]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  New Chat
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.15, ease }}
                  onClick={() => setShowChatSearch(true)}
                  title="Search chats (Ctrl+Shift+F)"
                  className="w-full flex items-center gap-2.5 text-sm text-[#b0b0b0]/60 hover:text-[#e0e0e0] bg-transparent hover:bg-[#1a1a1a]/50 rounded-sm px-3 py-2 cursor-pointer transition-all font-mono mt-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="8" />
                    <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
                  </svg>
                  Search
                  <span className="ml-auto text-[9px] text-[#b0b0b0]/25 font-mono">⌃⇧F</span>
                </motion.button>
              </>
            ) : (
              <motion.button
                whileHover={{ scale: 1.01, backgroundColor: "rgba(14, 116, 144, 0.24)" }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.15, ease }}
                onClick={handlePickAgentWorkspace}
                title="Choose workspace folder for Agent mode"
                className="w-full flex items-center gap-2.5 text-sm text-sky-100 bg-sky-500/15 hover:bg-sky-500/20 rounded-sm px-3 py-2.5 cursor-pointer border border-sky-500/30 hover:border-sky-400/40"
              >
                <svg className="w-4 h-4 text-sky-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A2.25 2.25 0 015.25 5.25h4.77c.36 0 .71.14.98.39l1.26 1.2c.27.26.63.41 1 .41h5.49A2.25 2.25 0 0121 9.5v9.25A2.25 2.25 0 0118.75 21H5.25A2.25 2.25 0 013 18.75V7.5z" />
                </svg>
                {agentWorkspacePath ? "Change Workspace" : "Choose Workspace"}
              </motion.button>
            )}
          </div>

          {/* Mode-aware list panel */}
          <div className="px-3 flex-1 overflow-y-auto">
            {interactionMode === "chat" ? (
              <>
                <div className="text-[11px] uppercase tracking-wider text-[#b0b0b0]/60 font-medium px-2 mb-2">
                  Chats
                </div>

                {chats.length === 0 && (
                  <p className="text-xs text-[#b0b0b0]/40 px-2 py-3">No conversations yet</p>
                )}

                <div className="space-y-3 pb-4">
                  {(() => {
                    const pinned = chats.filter(c => c.pinned);

                    const folderGroups = folders.map(f => ({
                      ...f,
                      chats: chats.filter(c => !c.pinned && c.folderId === f.id)
                    })).filter(g => g.chats.length > 0);

                    const unpinned = chats.filter(c => !c.pinned && !c.folderId);

                    const renderGroup = (groupChats, label, folderId = null, color = null) => (
                      groupChats.length > 0 ? (
                        <div key={label}>
                          <div className="text-[10px] uppercase tracking-wider text-[#b0b0b0]/50 font-semibold px-3 mb-1.5 flex items-center gap-1.5">
                            {label === "Pinned" ? "📌 " : folderId ? (
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                            ) : ""}
                            {label}
                          </div>
                          <div className="space-y-0.5">
                            {groupChats.map((chat) => {
                              const isActive = chat.id === activeChatId;
                              const isSecondary = chat.id === secondaryChatId;
                              return (
                                <motion.div
                                  key={chat.id}
                                  layout
                                  onClick={() => handleSelectChat(chat.id)}
                                  className={`group text-sm rounded-sm px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors font-mono ${isActive
                                      ? "bg-[#111111] text-[#00ff41] border border-[#00ff41]/20"
                                      : isSecondary
                                        ? "bg-[#00d4ff]/[0.07] text-[#00d4ff] border border-[#00d4ff]/20"
                                        : "text-[#b0b0b0] hover:bg-[#111111] hover:text-[#e0e0e0] border border-transparent"
                                    }`}
                                >
                                  {(isActive || isSecondary) && (
                                    <div className="w-1.5 h-1.5 rounded-sm bg-[#00ff41] shrink-0" />
                                  )}
                                  <span className="truncate flex-1 min-w-0">{chat.title}</span>

                                  {/* Quick Actions */}
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">

                                    {folders.length > 0 && !chat.pinned && (
                                      <div className="relative flex items-center justify-center p-1 rounded hover:bg-white/10" title="Move to Folder" onClick={e => e.stopPropagation()}>
                                        <select
                                          value={chat.folderId || ""}
                                          onChange={(e) => handleUpdateChatFolder(chat.id, e.target.value)}
                                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                        >
                                          <option value="">No Folder</option>
                                          {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                        </select>
                                        <span className="text-[#b0b0b0]/60 flex items-center justify-center text-[11px] pointer-events-none">📂</span>
                                      </div>
                                    )}

                                    <button
                                      type="button"
                                      onClick={(e) => handleTogglePin(chat.id, e)}
                                      className={`p-1 rounded transition-colors cursor-pointer ${chat.pinned ? "text-amber-400 hover:bg-amber-400/10 opacity-100" : "text-[#b0b0b0]/60 hover:bg-white/10 hover:text-white"
                                        }`}
                                      title={chat.pinned ? "Unpin chat" : "Pin chat"}
                                    >
                                      <svg className="w-3.5 h-3.5" fill="currentColor" stroke="currentColor" strokeWidth={0.5} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleSecondaryChat(chat.id);
                                      }}
                                      className="p-1 text-[#b0b0b0]/60 hover:text-sky-300 rounded hover:bg-sky-400/10 transition-colors cursor-pointer"
                                      title="Open in split view"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25v13.5A2.25 2.25 0 0118.75 21H5.25A2.25 2.25 0 013 18.75V5.25z" />
                                        <path strokeLinecap="round" d="M12 3v18" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExportChat(chat.id);
                                      }}
                                      className="p-1 text-[#b0b0b0]/60 hover:text-emerald-400 rounded hover:bg-emerald-400/10 transition-colors cursor-pointer"
                                      title="Export chat"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteChat(chat.id);
                                      }}
                                      className="p-1 text-[#b0b0b0]/60 hover:text-red-400 rounded hover:bg-red-400/10 transition-colors cursor-pointer"
                                      title="Delete chat"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null
                    );

                    return (
                      <>
                        {renderGroup(pinned, "Pinned")}
                        {folderGroups.map(fg => renderGroup(fg.chats, fg.name, fg.id, fg.color))}
                        {renderGroup(unpinned, "Recent")}
                      </>
                    );
                  })()}
                </div>

                {splitViewActive && secondaryChat && (
                  <div className="mt-3 px-2 py-2 rounded-sm border border-sky-500/20 bg-sky-500/[0.06] flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-sky-300/80 font-semibold">Split View</p>
                      <p className="text-[11px] text-sky-100/80 truncate">Secondary: {secondaryChat.title}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSecondaryChatId("")}
                      className="shrink-0 px-2 py-1 text-[10px] rounded-md text-sky-200 hover:text-white hover:bg-sky-500/20 border border-sky-500/25 cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-[11px] uppercase tracking-wider text-sky-300/80 font-medium px-2 mb-2">
                  Workspace
                </div>

                <div className="rounded-sm border border-sky-500/20 bg-sky-500/[0.06] px-3 py-3">
                  <p className="text-[11px] text-[#b0b0b0] break-all min-h-[18px]">
                    {agentWorkspacePath || "No workspace selected"}
                  </p>
                  {agentWorkspacePath ? (
                    <button
                      type="button"
                      onClick={handleClearAgentWorkspace}
                      className="mt-2 h-7 px-2.5 rounded-md text-[11px] font-medium text-[#e0e0e0] bg-[#1a1a1a]/40 hover:bg-[#1a1a1a]/60 cursor-pointer"
                    >
                      Clear
                    </button>
                  ) : (
                    <p className="mt-2 text-[11px] text-[#b0b0b0]/40">
                      Pick a folder to let the agent inspect and run commands in that workspace.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Usage panel */}
          <div className="px-3 pt-3 pb-2 border-t border-white/[0.06] space-y-3">

            {/* Section label */}
            <p
              className="text-[10px] uppercase tracking-wider font-semibold text-amber-300"
              style={{ textShadow: "0 0 8px rgba(251,191,36,0.7), 0 0 20px rgba(251,191,36,0.35)" }}
            >
              Usage
            </p>

            {/* ── Session ── */}
            <div className="space-y-1.5">
              <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider">Session</p>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#b0b0b0]/60">Cost</span>
                <span className={`font-medium ${calcSessionCost(chats) > 0 ? "text-emerald-400" : "text-[#b0b0b0]/60"}`}>
                  {formatCost(calcSessionCost(chats))}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#b0b0b0]/60">Model</span>
                <span className="text-[#e0e0e0] font-medium truncate max-w-[110px] text-right">
                  {selectedModel
                    ? providerLabel(selectedModel.split("/")[0]) || selectedModel.split("/")[0]
                    : "—"}
                </span>
              </div>
              {/* ── Monthly estimate ── */}
              {(() => {
                const currentModelObj = findModelBySelection(models, selectedModel);
                const pricing = currentModelObj?.pricing;
                if (!pricing) return null;
                const promptPrice = Number(pricing.prompt) || 0;
                const completionPrice = Number(pricing.completion) || 0;
                if (promptPrice === 0 && completionPrice === 0) return (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#b0b0b0]/60">~Monthly</span>
                    <span className="text-[#b0b0b0]/40 font-medium">Free</span>
                  </div>
                );
                // Use recorded avg cost/request if available, else estimate from pricing
                const allRows = providerUsageRows(
                  providerUsage,
                  Object.entries(providers || {}).filter(([, k]) => !!k).map(([p]) => p)
                );
                const totalCost = allRows.reduce((s, r) => s + r.cost, 0);
                const totalReqs = allRows.reduce((s, r) => s + r.requests, 0);
                const MSGS_PER_DAY = 20;
                let monthly;
                if (totalReqs > 0) {
                  monthly = (totalCost / totalReqs) * MSGS_PER_DAY * 30;
                } else {
                  // ~500 prompt + ~800 completion tokens per message
                  monthly = ((promptPrice * 500) + (completionPrice * 800)) * MSGS_PER_DAY * 30;
                }
                const label = monthly < 0.001
                  ? "<$0.01"
                  : monthly < 1
                    ? `$${monthly.toFixed(2)}`
                    : `$${monthly.toFixed(1)}`;
                return (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#b0b0b0]/60">~Monthly</span>
                    <span className="text-amber-300 font-medium" title="Estimate: 20 msgs/day × 30 days">{label}/mo</span>
                  </div>
                );
              })()}
            </div>

            {/* ── Providers ── */}
            {isOllamaCloudKeyConfig(providers?.ollama) && (Number.isFinite(Number(ollamaCloudUsage?.sessionPercent)) || Number.isFinite(Number(ollamaCloudUsage?.weeklyPercent))) && (
              <div className="space-y-1.5 border-t border-white/[0.04] pt-2">
                <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider">Ollama Cloud</p>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#b0b0b0]/60">Session</span>
                  <span className="text-emerald-300 font-medium">{formatCloudUsagePercent(ollamaCloudUsage?.sessionPercent)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#b0b0b0]/60">Weekly</span>
                  <span className="text-emerald-300 font-medium">{formatCloudUsagePercent(ollamaCloudUsage?.weeklyPercent)}</span>
                </div>
                {ollamaCloudUsage?.status === "loading" && (
                  <p className="text-[10px] text-[#b0b0b0]/40">Syncing cloud usage...</p>
                )}
              </div>
            )}

            {/* ── Providers ── */}
            {(() => {
              const rows = providerUsageRows(
                providerUsage,
                Object.entries(providers || {}).filter(([, key]) => !!key).map(([provider]) => provider)
              ).filter((row) => row.requests > 0);
              if (!rows.length) return null;
              return (
                <div className="space-y-1.5">
                  <div className="border-t border-white/[0.04] pt-2">
                    <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider mb-1.5">Providers</p>
                    {rows.map((row) => (
                      <div key={row.provider} className="flex items-center justify-between text-[11px] py-0.5">
                        <span className="text-[#b0b0b0]/60">{providerLabel(row.provider)}</span>
                        <span className={`font-medium ${row.cost > 0 ? "text-emerald-400" : "text-[#b0b0b0]/40"}`}>
                          {row.cost > 0 ? formatCost(row.cost) : "Free"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Credits ── */}
            {lifetimeCost && lifetimeCost.total_credits > 0 && (
              <div className="border-t border-white/[0.04] pt-2 space-y-1.5">
                <p className="text-[10px] text-[#b0b0b0]/40 uppercase tracking-wider">Credits</p>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#b0b0b0]/60">OpenRouter</span>
                  <span className="text-emerald-400 font-medium">
                    {formatCost(Math.max(0, (lifetimeCost.total_credits || 0) - (lifetimeCost.total_usage || 0)))}
                  </span>
                </div>
              </div>
            )}

          </div>

          <div className="px-3 py-3 border-t border-white/[0.06]">
            <motion.button
              whileHover={{ scale: 1.01, backgroundColor: "rgba(30, 41, 59, 0.6)" }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.15, ease }}
              onClick={() => { setShowSettings(true); setSidebarOpen(false); }}
              title={`Settings (${shortcuts.openSettings})`}
              className={`w-full flex items-center gap-2.5 text-xs rounded-sm px-3 py-2.5 cursor-pointer ${showSettings
                  ? "text-[#00ff41] bg-[#00ff41]/10"
                  : "text-[#b0b0b0] hover:text-[#e0e0e0]"
                }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="inline-flex items-center gap-1.5">
                <span>Settings</span>
                {appVersion && (
                  <span
                    className="text-[10px] font-semibold text-[#00ff41]"
                    style={{ textShadow: "0 0 6px rgba(251,191,36,0.85), 0 0 14px rgba(251,191,36,0.45)" }}
                  >
                    v{appVersion}
                  </span>
                )}
              </span>
            </motion.button>
          </div>

          <div className="px-3 pb-3 text-center">
            <span
              className="text-[10px] font-medium text-[#00ff41]"
              style={{ textShadow: "0 0 8px rgba(251,191,36,0.8), 0 0 20px rgba(251,191,36,0.4), 0 0 40px rgba(251,191,36,0.15)" }}
            >
              Made by Parikshit
            </span>
          </div>
        </motion.aside>

        {/* ── Main area ── */}
        <motion.div
          key="chat"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.25, ease }}
          className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-dark-950 via-dark-950 to-dark-900/50"
        >
          {/* Top bar */}
          {interactionMode === "agent" ? (
            <header className="h-10 px-3 border-b border-white/[0.08] bg-[#0a0a0a]/95 flex items-center gap-3 shrink-0">
              <div className="hidden md:flex items-center gap-2 pr-2 border-r border-white/[0.08] shrink-0">
                <KPLogo size={16} className="rounded-sm" />
                <span className="text-[11px] font-semibold text-[#e0e0e0] tracking-wide">KritakaPrajna</span>
              </div>

              <div className="hidden md:flex items-center gap-0.5 text-[11px] text-[#b0b0b0]">
                {[
                  "File",
                  "Edit",
                  "View",
                  "Terminal",
                  "Agent",
                  "Help",
                ].map((menuItem) => (
                  <button
                    key={menuItem}
                    type="button"
                    className="h-6 px-2.5 rounded-md border border-transparent hover:border-kp-indigo-400/20 hover:bg-kp-indigo-500/10 hover:text-kp-indigo-200 cursor-pointer transition-colors"
                  >
                    {menuItem}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center h-8 border border-white/[0.08] bg-white/[0.02] p-0.5">
                <button
                  type="button"
                  onClick={() => setInteractionMode("chat")}
                  className={`px-2.5 h-6 text-[11px] transition-colors cursor-pointer ${interactionMode === "chat"
                      ? "bg-[#00ff41]/20 text-[#00ff41] border border-[#00ff41]/35"
                      : "text-[#b0b0b0] hover:text-[#e0e0e0]"
                    }`}
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setInteractionMode("agent")}
                  className={`px-2.5 h-6 text-[11px] transition-colors cursor-pointer ${interactionMode === "agent"
                      ? "rounded-md bg-kp-indigo-500/20 text-kp-indigo-200 border border-kp-indigo-400/35"
                      : "text-[#b0b0b0] hover:text-[#e0e0e0]"
                    }`}
                >
                  Agent (Beta)
                </button>
              </div>

              <div className="ml-auto flex items-center gap-2 min-w-0 w-[540px] max-w-[65vw]">
                <PersonaSelector personas={personas} activePersonaId={currentChatPersonaId} onSelect={handleUpdateChatPersona} />
                <div className="flex-1 min-w-0">
                  <ModelSelector
                    models={models}
                    selected={selectedModel}
                    selectedModel={findModelBySelection(models, selectedModel)}
                    onSelect={selectModelAndSyncTask}
                    selectedTask={selectedTask}
                    onTaskChange={setSelectedTask}
                    openSignal={modelSelectorOpenSignal}
                    monthlyBudget={advisorPrefs?.monthlyBudget || null}
                    providerUsage={providerUsage}
                  />
                </div>
              </div>
            </header>
          ) : (
            <header className="flex items-center gap-4 px-5 py-3 glass border-b border-white/[0.06] shrink-0">
              <div className="inline-flex items-center h-9 rounded-sm border border-white/[0.08] bg-[#0d0d0d]/70 p-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setInteractionMode("chat")}
                  className={`px-3 h-7 rounded-sm text-xs font-medium transition-colors cursor-pointer ${interactionMode === "chat"
                      ? "bg-[#00ff41]/20 text-[#00ff41] border border-[#00ff41]/35"
                      : "text-[#b0b0b0] hover:text-[#e0e0e0]"
                    }`}
                >
                  💬 Chat
                </button>
                <button
                  type="button"
                  onClick={() => setInteractionMode("agent")}
                  className={`px-3 h-7 rounded-sm text-xs font-medium transition-colors cursor-pointer ${interactionMode === "agent"
                      ? "bg-kp-indigo-500/20 text-kp-indigo-200 border border-kp-indigo-400/35"
                      : "text-[#b0b0b0] hover:text-[#e0e0e0]"
                    }`}
                >
                  ⚡ Agent (Beta)
                </button>
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2 justify-center max-w-[700px] px-4">
                <PersonaSelector personas={personas} activePersonaId={currentChatPersonaId} onSelect={handleUpdateChatPersona} />
                <div className="flex-1 min-w-0">
                  <ModelSelector
                    models={models}
                    selected={selectedModel}
                    selectedModel={findModelBySelection(models, selectedModel)}
                    onSelect={selectModelAndSyncTask}
                    selectedTask={selectedTask}
                    onTaskChange={setSelectedTask}
                    openSignal={modelSelectorOpenSignal}
                    monthlyBudget={advisorPrefs?.monthlyBudget || null}
                    providerUsage={providerUsage}
                  />
                </div>
              </div>
              {selectedModel && (() => {
                const health = getModelHealth(selectedModel);
                return (
                  <div className="hidden md:flex shrink-0">
                    <span className={`text-[11px] font-medium px-3 py-2 rounded-sm border ${!health.available
                        ? "text-red-300 bg-red-500/10 border-red-500/20"
                        : health.slow
                          ? "text-amber-300 bg-amber-500/10 border-amber-500/20"
                          : "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
                      }`}>
                      {!health.available ? "Limited" : health.slow ? "Slow" : "Ready"}
                    </span>
                  </div>
                );
              })()}
            </header>
          )}

          {/* Smart model suggestion */}
          {interactionMode === "chat" && !suggestionDismissed && (
            <SmartModelBanner
              suggestion={smartSuggestion}
              onAccept={handleAcceptSuggestion}
              onDismiss={handleDismissSuggestion}
            />
          )}

          {/* Prompt-based banners: task suggestion, rate limit, cheapest model */}
          {interactionMode === "chat" && (
            <PromptBanners
              taskSuggestion={taskBanner}
              rateLimitWarning={rateLimitBanner}
              cheapestModel={cheapestBanner}
            />
          )}

          {/* Error banner */}
          <AnimatePresence>
            {interactionMode === "chat" && error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease }}
                className="bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm px-5 py-2.5 shrink-0 overflow-hidden flex items-center gap-3"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span className="flex-1">{error}</span>
                {lastRequestRef.current && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleRetry("same")}
                      disabled={loading}
                      className="text-xs font-medium text-[#00ff41] bg-[#00ff41]/15 hover:bg-[#00ff41]/25 rounded-sm px-2.5 py-1 cursor-pointer disabled:opacity-30 transition-colors"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => handleRetry("better")}
                      disabled={loading}
                      className="text-xs font-medium text-purple-300 bg-purple-500/15 hover:bg-purple-500/25 rounded-sm px-2.5 py-1 cursor-pointer disabled:opacity-30 transition-colors"
                    >
                      Try Better Model
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {interactionMode === "agent" && agentError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease }}
                className="bg-red-500/10 border-b border-red-500/20 text-red-300 text-sm px-5 py-2.5 shrink-0 overflow-hidden flex items-center justify-between gap-3"
              >
                <span className="flex-1">{agentError}</span>
                <button
                  type="button"
                  onClick={() => setInteractionMode("chat")}
                  className="text-xs font-medium text-kp-indigo-200 bg-kp-indigo-500/20 hover:bg-kp-indigo-500/30 rounded-sm px-2.5 py-1 cursor-pointer"
                >
                  Switch to chat
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {interactionMode === "chat" && tokenNotice && !error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease }}
                className="bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs px-5 py-2 shrink-0 overflow-hidden"
              >
                {tokenNotice}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages */}
          {interactionMode === "agent" ? (
            <AgentIdeWorkspace
              chats={agentChats}
              activeChatId={activeAgentChatId}
              agentModels={agentSelectableModels}
              selectedModel={selectedModel}
              onSelectModel={selectModelAndSyncTask}
              messages={agentMessages}
              agentPlan={agentPlan}
              agentCurrentStep={agentCurrentStep}
              agentStepDetails={agentStepDetails}
              agentTerminalLines={agentTerminalLines}
              agentSessionStatus={agentSessionStatus}
              agentError={agentError}
              agentRunStats={agentRunStats}
              agentPendingCommand={agentPendingCommand}
              agentCommandDraft={agentCommandDraft}
              onSetAgentCommandDraft={setAgentCommandDraft}
              onAllowCommand={handleAgentAllowCommand}
              onDenyCommand={handleAgentDenyCommand}
              onQueueCommand={handleQueueAgentCommand}
              agentWorkspacePath={agentWorkspacePath}
              onPickWorkspace={handlePickAgentWorkspace}
              onClearWorkspace={handleClearAgentWorkspace}
              onRunTask={handleAgentSend}
              onSwitchMode={setInteractionMode}
              onOpenSettings={() => setShowSettings(true)}
              onSelectTab={handleSelectChat}
              onCreateTab={handleNewChat}
              onCloseTab={handleDeleteChat}
              onRenameTab={handleRenameChat}
            />
          ) : splitViewActive ? (
            <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-3 px-3 py-3">
              {renderChatPane(activeChat, "primary")}
              {renderChatPane(secondaryChat, "secondary")}
            </div>
          ) : (
            <MessageList
              messages={messages}
              loading={loading}
              lastError={lastError}
              onRetry={handleRetry}
              onRegenerate={handleRegenerate}
              onPointDeepDive={handlePointDeepDive}
              onRefine={(msgIdx) => {
                const aiMsg = messages[msgIdx];
                if (!aiMsg || aiMsg.role !== "assistant" || !aiMsg.content) return;
                handleSend("Refine your previous answer: be more precise, fix any issues, and improve the code quality. Keep the same format.");
              }}
              onEditMessage={handleEditMessage}
              onBranchFromMessage={handleBranchFromMessage}
              onToggleBookmark={(msgIdx) => handleToggleBookmark(activeChatId, msgIdx)}
              onResolveComparison={(msgIdx, winIdx) => handleResolveComparison(activeChatId, msgIdx, winIdx)}
            />
          )}

          {/* Web search animation */}
          <AnimatePresence>
            {interactionMode === "chat" && (((isSearching && searchingChatId === activeChatId) || (loading && webPreparingChatId === activeChatId))) && (
              <motion.div
                key="searching"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2, ease }}
                className="flex justify-end px-6 pb-2 shrink-0"
              >
                <div className="flex items-center gap-2.5 bg-sky-500/[0.08] border border-sky-500/20 rounded-sm rounded-br-sm px-4 py-2.5 max-w-[80%]">
                  {/* Animated globe */}
                  <div className="relative shrink-0 w-4 h-4">
                    <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" />
                      <path strokeLinecap="round" d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
                    </svg>
                    <motion.div
                      className="absolute inset-0 rounded-full border border-sky-400/30"
                      animate={{ scale: [1, 1.6, 1.6], opacity: [0.6, 0, 0] }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
                    />
                  </div>
                  <span className="text-[12px] text-sky-300/80 font-medium">
                    {isSearching
                      ? (webSearchMode === "deep" ? "Deep web research" : "Searching the web")
                      : "Preparing answer from web context"}
                  </span>
                  {/* Pulsing dots */}
                  <span className="flex gap-0.5 items-center">
                    {[0, 0.2, 0.4].map((delay, i) => (
                      <motion.span
                        key={i}
                        className="w-1 h-1 rounded-full bg-sky-400/60"
                        animate={{ opacity: [0.2, 1, 0.2] }}
                        transition={{ duration: 1, repeat: Infinity, ease, delay }}
                      />
                    ))}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Attached files & uploads preview */}
          <AnimatePresence>
            {(attachedFiles.length > 0 || uploads.length > 0) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease }}
                className="px-5 pt-2 pb-1 shrink-0 overflow-hidden"
              >
                <div className="max-w-[1400px] mx-auto flex flex-wrap gap-2 w-full">
                  {/* Sidebar-attached text files */}
                  {attachedFiles.map((f) => (
                    <span
                      key={"af-" + f.path}
                      className="inline-flex items-center gap-1.5 text-xs bg-[#00ff41]/10 text-[#00ff41] border border-[#00ff41]/20 rounded-sm px-2.5 py-1"
                    >
                      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="truncate max-w-[120px]">{f.name}</span>
                      <button type="button" onClick={() => handleRemoveFile(f.path)} className="ml-0.5 hover:text-red-400 transition-colors cursor-pointer" aria-label={`Remove ${f.name}`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </span>
                  ))}

                  {/* Uploaded items */}
                  {uploads.map((u) => (
                    <div
                      key={u.id}
                      className="relative group inline-flex items-center gap-2 text-xs bg-[#111111]/60 border border-white/[0.06] rounded-sm px-2 py-1.5"
                    >
                      {/* Thumbnail or icon */}
                      {u.type === "image" && u.dataUrl ? (
                        <img
                          src={u.dataUrl}
                          alt={u.name}
                          className="w-8 h-8 rounded object-cover shrink-0"
                        />
                      ) : u.type === "pdf" ? (
                        <div className="w-8 h-8 rounded bg-red-500/15 flex items-center justify-center shrink-0">
                          <span className="text-[9px] font-bold text-red-400">PDF</span>
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded bg-[#1a1a1a]/60 flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-[#b0b0b0]/60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="text-[#e0e0e0] truncate max-w-[100px]">{u.name}</span>
                        <span className="text-[10px] text-[#b0b0b0]/40">{formatSize(u.size)}</span>
                      </div>
                      {/* Remove button */}
                      <button
                        type="button"
                        onClick={() => handleRemoveUpload(u.id)}
                        className="ml-1 text-[#b0b0b0]/40 hover:text-red-400 transition-colors cursor-pointer shrink-0"
                        aria-label={`Remove ${u.name}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      {/* Error badge for failed PDFs */}
                      {u.error && (
                        <span className="text-[9px] text-red-400/80" title={u.error}>⚠️</span>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {interactionMode === "chat" && splitViewActive && activeChat && (
            <div className="px-5 pt-1 pb-0.5 shrink-0">
              <div className="max-w-[1400px] mx-auto text-[11px] text-sky-300/75">
                Sending to: <span className="text-sky-200 font-medium">{activeChat.title || "New Chat"}</span>
              </div>
            </div>
          )}

          {/* Prompt Distillation Preview */}
          {interactionMode === "chat" && !loading && (
            <PromptDistillPreview
              inputText={draftInputText}
              routeChat={routeStream}
              cheapModel={pickCheapestSummaryModel(models, providers)}
              providers={providers}
              onUseDistilled={handleUseDistilled}
              enabled={isDistillationEnabled()}
            />
          )}

          {/* Token Budget Meter */}
          {interactionMode === "chat" && (
            <TokenBudgetMeter budgetInfo={tokenBudgetInfo} visible={!!tokenBudgetInfo} />
          )}

          {/* Input */}
          <MessageInput
            onSend={handleModeAwareSend}
            onUpload={handleUpload}
            loading={loading}
            onStop={handleStop}
            disabled={loading || !selectedModel}
            commandHints={getAllCommandHints(customCommands)}
            onTextChange={handleInputTextChange}
            showReasoningControl={supportsReasoningModel(findModelBySelection(models, selectedModel))}
            reasoningDepth={reasoningDepth}
            onReasoningDepthChange={setReasoningDepth}
            responseLength={responseLength}
            onResponseLengthChange={setResponseLength}
            estimatedTokens={composerTokenStats.estimatedTokens}
            contextWindowLimitTokens={composerTokenStats.contextWindowLimitTokens}
            showDeepAnalysisVisualizer={showDeepAnalysisVisualizer}
            lastSentTokens={lastTokenStats.sent}
            lastReceivedTokens={lastTokenStats.received}
            sendShortcut={shortcuts.sendMessage}
            webSearchEnabled={webSearchEnabled}
            webSearchMode={webSearchMode}
            onWebSearchToggle={() => {
              setWebSearchEnabled((prev) => !prev);
            }}
            onWebSearchModeChange={(mode) => {
              const nextMode = mode === "deep" ? "deep" : "fast";
              setWebSearchMode(nextMode);
              try { localStorage.setItem("kp_web_mode", nextMode); } catch { }
            }}
            onCompareActive={() => { setShowCompareModal(true); }}
          />
        </motion.div>

        {/* Right-side advisor slider */}
        {interactionMode === "chat" && advisorPrefs?.showAdvisor !== false && (
          <>
            <AdvisorToggle
              open={advisorOpen}
              onClick={() => setAdvisorOpen((v) => !v)}
              hasData={!!latestAdvisor}
            />
            <ModelAdvisorPanel
              advisorData={latestAdvisor}
              onSwitchModel={handleAdvisorSwitch}
              loading={loading}
              open={advisorOpen}
              onClose={() => setAdvisorOpen(false)}
              models={models}
              selectedModel={selectedModel}
            />
          </>
        )}
      </div>

      {/* Model picker modal for "Retry Better Model" */}
      <AnimatePresence>
        {modelPickerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 "
            onClick={() => setModelPickerOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#0d0d0d] border border-white/[0.08] rounded-sm shadow-2xl w-[420px] max-h-[70vh] flex flex-col overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Choose a model to retry with</p>
                  <p className="text-xs text-[#b0b0b0]/60 mt-0.5">Pick any available model</p>
                </div>
                <button onClick={() => setModelPickerOpen(false)} className="text-[#b0b0b0]/40 hover:text-[#e0e0e0] p-1 rounded-sm hover:bg-white/[0.05] cursor-pointer transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="px-4 py-3 border-b border-white/[0.06] space-y-2.5">
                <input
                  type="text"
                  value={retryModelSearch}
                  onChange={(e) => setRetryModelSearch(e.target.value)}
                  placeholder="Search by model, id, or provider"
                  className="w-full h-9 rounded-sm border border-white/[0.08] bg-[#111111]/70 px-3 text-sm text-[#e0e0e0] placeholder:text-[#b0b0b0]/40 outline-none focus:border-[#00ff41]/40"
                />
                <div className="flex items-center gap-2">
                  {[
                    { id: "all", label: "All" },
                    { id: "free", label: "Free" },
                    { id: "paid", label: "Paid" },
                  ].map((opt) => {
                    const active = retryModelFilter === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setRetryModelFilter(opt.id)}
                        className={`px-2.5 h-7 rounded-md text-[11px] border transition-colors cursor-pointer ${active
                            ? "border-[#00ff41]/35 bg-[#00ff41]/15 text-[#00ff41]"
                            : "border-white/[0.08] bg-[#111111]/60 text-[#b0b0b0] hover:bg-[#1a1a1a]/70"
                          }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <span className="ml-auto text-[10px] text-[#b0b0b0]/40">{retryPickerModels.length} models</span>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-2">
                {retryPickerModels.length === 0 && (
                  <div className="px-3 py-8 text-center text-xs text-[#b0b0b0]/40">No models match your filters.</div>
                )}
                {retryPickerModels.map((m) => {
                  const sid = toSelectionId(m);
                  const isCurrent = sid === selectedModel;
                  const free = isFreePricedModel(m);
                  return (
                    <button
                      key={sid}
                      onClick={() => handleRetryWithModel(sid)}
                      disabled={isCurrent}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-left transition-colors cursor-pointer mb-0.5 ${isCurrent
                          ? "opacity-40 cursor-not-allowed bg-white/[0.02]"
                          : "hover:bg-white/[0.05]"
                        }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{m.name || m.id}</p>
                        <p className="text-[10px] text-[#b0b0b0]/40 truncate">{providerLabel(m._provider)} · {m.id}</p>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md border shrink-0 ${free
                          ? "text-emerald-300 border-emerald-400/25 bg-emerald-500/10"
                          : "text-amber-300 border-amber-400/25 bg-amber-500/10"
                        }`}>
                        {free ? "Free" : "Paid"}
                      </span>
                      {isCurrent && <span className="text-[10px] text-[#b0b0b0]/40 shrink-0">current</span>}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Chat Search Overlay */}
      <AnimatePresence>
        {showChatSearch && (
          <ChatSearch
            chats={chats}
            onSelectChat={(chatId) => {
              setActiveChatId(chatId);
              setShowChatSearch(false);
            }}
            onClose={() => setShowChatSearch(false)}
          />
        )}
      </AnimatePresence>

      {/* Global Settings Overlay */}
      <AnimatePresence>
        {showSettings && (
          <SettingsPanel
            providers={providers}
            onSaveProviderKey={onSaveProviderKey}
            onRemoveProviderKey={onRemoveProviderKey}
            onResetAll={onResetAll}
            onClose={() => setShowSettings(false)}
            modelPref={modelPref}
            onSaveModelPref={(v) => { setModelPref(v); localStorage.setItem(MODEL_PREF_KEY, v); }}
            customCommands={customCommands}
            onSaveCustomCommands={(cmds) => { setCustomCommands(cmds); saveCustomCommands(cmds); }}
            systemPrompt={systemPrompt}
            onSaveSystemPrompt={(p) => { setSystemPrompt(p); localStorage.setItem(SYSTEM_PROMPT_KEY, p); }}
            defaultSystemPrompt={DEFAULT_SYSTEM_PROMPT}
            advisorPrefs={advisorPrefs}
            onSaveAdvisorPrefs={(prefs) => { setAdvisorPrefs(prefs); localStorage.setItem(ADVISOR_PREFS_KEY, JSON.stringify(prefs)); }}
            shortcuts={shortcuts}
            onSaveShortcuts={handleSaveShortcuts}
            onResetShortcuts={handleResetShortcuts}
            memory={userMemory}
            onSaveMemory={handleSaveMemory}
            onResetMemory={handleResetMemory}
            providerUsage={providerUsage}
            usageSnapshot={usageSnapshot}
            personas={personas}
            onSavePersonas={handleSavePersonas}
            models={models}
            folders={folders}
            onSaveFolders={handleSaveFolders}
          />
        )}
      </AnimatePresence>

      {/* Model Compare Modal */}
      <CompareModal
        isOpen={showCompareModal}
        onClose={() => setShowCompareModal(false)}
        models={models}
        onCompare={handleCompareStart}
      />
    </motion.div>
  );
}

