import React, { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchModels, streamMessage, fetchCredits } from "../api/openrouter";
import ModelSelector from "./ModelSelector";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import SettingsPanel from "./SettingsPanel";
import FileContext from "./FileContext";
import SmartModelBanner from "./SmartModelBanner";
import PromptBanners from "./PromptBanners";
import ModelAdvisorPanel, { AdvisorToggle } from "./ModelAdvisorCard";
import TitleBar from "./TitleBar";
import KPLogo from "./KPLogo";
import { detectTaskType, selectSmartModel, qualityScore } from "../utils/smartModelSelect";
import { calculateCost, isModelFree, formatCost, calcSessionCost } from "../utils/costTracker";
import { parseCommand, buildCommandPrompt, resolveFromAttachments, loadCustomCommands, saveCustomCommands, getAllCommandHints } from "../utils/commandParser";
import { recordSuccess, recordFailure, isModelUnavailable, findFallbackModel, findCheapestModel, getModelHealth } from "../utils/rateLimiter";
import { generateAdvisorData } from "../utils/modelAdvisor";

const ease = [0.4, 0, 0.2, 1];
const CHATS_KEY = "openrouter_chats";
const ACTIVE_CHAT_KEY = "openrouter_active_chat";
const MODEL_PREF_KEY = "openrouter_model_pref";
const SYSTEM_PROMPT_KEY = "openrouter_system_prompt";
const ADVISOR_PREFS_KEY = "openrouter_advisor_prefs";

const DEFAULT_SYSTEM_PROMPT = `You are KritakaPrajna, an expert AI coding assistant. Follow this reasoning framework for every request:

## Approach
1. **Analyze** — Understand the intent, identify the core problem, and note constraints.
2. **Reason** — Think step-by-step. Consider edge cases, trade-offs, and alternatives.
3. **Solve** — Produce a clear, correct solution.

## Output Format
- Start with a brief explanation of what you found or what you're doing and why.
- Then provide the updated/complete code in a fenced code block.
- If there are multiple issues, list each one before the fix.
- Be concise but thorough. Prefer minimal, targeted changes over rewrites.`;

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

function saveChats(chats) {
  localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

function loadActiveId() {
  return localStorage.getItem(ACTIVE_CHAT_KEY) || "";
}

function saveActiveId(id) {
  localStorage.setItem(ACTIVE_CHAT_KEY, id);
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

function fileExt(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function ChatApp({ apiKey, onSaveKey, onResetKey }) {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [chats, setChats] = useState(loadChats);
  const [activeChatId, setActiveChatId] = useState(loadActiveId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [uploads, setUploads] = useState([]); // { id, name, type, dataUrl?, content?, size, ext }
  const [smartSuggestion, setSmartSuggestion] = useState(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [modelPref, setModelPref] = useState(() => localStorage.getItem(MODEL_PREF_KEY) || "auto");
  const [lifetimeCost, setLifetimeCost] = useState(null); // { total_credits, total_usage } from API
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [customCommands, setCustomCommands] = useState(loadCustomCommands);
  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem(SYSTEM_PROMPT_KEY) || DEFAULT_SYSTEM_PROMPT);
  const [advisorPrefs, setAdvisorPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(ADVISOR_PREFS_KEY)) || { preferFree: false, preferBest: false, showAdvisor: true }; }
    catch { return { preferFree: false, preferBest: false, showAdvisor: true }; }
  });
  const abortRef = useRef(null);

  // ── Last request tracking (for retry/regenerate) ──
  const lastRequestRef = useRef(null); // { text, uploads, attachedFiles, modelUsed, chatId }

  // ── Prompt-based banners state ──
  const [taskBanner, setTaskBanner] = useState(null); // { visible, taskType, suggestedModelId }
  const [rateLimitBanner, setRateLimitBanner] = useState(null); // { visible, modelId, fallbackModelId }
  const [cheapestBanner, setCheapestBanner] = useState(null); // { visible, cheapestLabel, cheapestModelId, currentModelId }
  const [lastError, setLastError] = useState(null);
  const [advisorOpen, setAdvisorOpen] = useState(false);

  // Current chat's messages
  const activeChat = chats.find((c) => c.id === activeChatId);
  const messages = activeChat?.messages || [];

  // Latest advisor data from the most recent AI message
  const latestAdvisor = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i]._advisorData) return messages[i]._advisorData;
    }
    return null;
  }, [messages]);

  // Persist chats to localStorage whenever they change
  useEffect(() => {
    saveChats(chats);
  }, [chats]);

  useEffect(() => {
    saveActiveId(activeChatId);
  }, [activeChatId]);

  // Recompute smart suggestion when uploads/attachments/model change
  useEffect(() => {
    const taskType = detectTaskType("", uploads, attachedFiles);
    if (taskType === "general" && uploads.length === 0 && attachedFiles.length === 0) {
      setSmartSuggestion(null);
      return;
    }
    const suggestion = selectSmartModel(models, taskType, selectedModel, modelPref);
    setSmartSuggestion(suggestion);
    setSuggestionDismissed(false);
  }, [uploads, attachedFiles, models, selectedModel, modelPref]);

  // Fetch models on mount
  useEffect(() => {
    let cancelled = false;
    setError("");
    fetchModels(apiKey)
      .then((data) => {
        if (cancelled) return;
        const sorted = data.sort((a, b) => a.id.localeCompare(b.id));
        setModels(sorted);
        const free = sorted.find((m) => {
          const p = m.pricing;
          return p && Number(p.prompt) === 0 && Number(p.completion) === 0;
        });
        setSelectedModel(free ? free.id : sorted[0]?.id || "");
      })
      .catch((err) => {
        if (!cancelled) setError("Failed to load models. Check your API key.");
        console.error(err);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  // Fetch account credits from OpenRouter API
  useEffect(() => {
    if (!apiKey) return;
    fetchCredits(apiKey).then((c) => { if (c) setLifetimeCost(c); });
  }, [apiKey]);

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
        // Extract text via Electron IPC if available
        if (electronApi?.extractPdfText && file.path) {
          const result = await electronApi.extractPdfText(file.path);
          if (result.text) {
            setUploads((prev) => [...prev, { ...base, type: "pdf", content: result.text }]);
          } else {
            setUploads((prev) => [...prev, { ...base, type: "pdf", content: null, error: result.error }]);
          }
        } else {
          setUploads((prev) => [...prev, { ...base, type: "pdf", content: null, error: "PDF reading requires desktop app" }]);
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

  const handleSend = useCallback(
    async (text) => {
      if (!text.trim() || !selectedModel) return;

      // ── Slash command parsing ──
      const parsed = parseCommand(text, customCommands);
      let processedText = text;

      if (parsed) {
        // Try to resolve file from attachments first
        let fileData = resolveFromAttachments(parsed.filePath, attachedFiles, uploads);

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

      // Run smart detection at send time (considers text for coding keywords)
      const taskType = detectTaskType(processedText, uploads, attachedFiles);

      // ── Show task suggestion banner (coding/vision/document) ──
      if (taskType !== "general") {
        const suggestion = selectSmartModel(models, taskType, selectedModel, modelPref);
        if (!suggestion.currentOk && suggestion.recommended) {
          setTaskBanner({
            visible: true,
            taskType,
            suggestedModelId: suggestion.recommended.id,
            onSwitch: () => {
              setSelectedModel(suggestion.recommended.id);
              setTaskBanner(null);
            },
            onIgnore: () => setTaskBanner(null),
          });
          // Auto-switch to the recommended model if it's free, or if preference is paid
          if ((suggestion.free && suggestion.recommended.id === suggestion.free.id) || modelPref === "paid") {
            setSelectedModel(suggestion.recommended.id);
          }
        }
      }

      // ── Show cheapest model banner ──
      const cheapest = findCheapestModel(models, taskType, null);
      if (cheapest && cheapest.model.id !== selectedModel) {
        setCheapestBanner({
          visible: true,
          cheapestLabel: cheapest.costLabel,
          cheapestModelId: cheapest.model.id,
          currentModelId: selectedModel,
          onUseCheapest: () => {
            setSelectedModel(cheapest.model.id);
            setCheapestBanner(null);
          },
          onKeepCurrent: () => setCheapestBanner(null),
        });
      }

      // ── Check rate limit before sending ──
      if (isModelUnavailable(selectedModel)) {
        const fallback = findFallbackModel(models, selectedModel, taskType, qualityScore);
        setRateLimitBanner({
          visible: true,
          modelId: selectedModel,
          fallbackModelId: fallback?.id || null,
          onSwitch: () => {
            if (fallback) setSelectedModel(fallback.id);
            setRateLimitBanner(null);
          },
          onDismiss: () => setRateLimitBanner(null),
        });
      }

      let chatId = activeChatId;

      // If no active chat, create one
      if (!chatId) {
        chatId = generateId();
        const newChat = { id: chatId, title: "New Chat", messages: [] };
        setChats((prev) => [newChat, ...prev]);
        setActiveChatId(chatId);
      }

      // Collect all context: sidebar files + uploaded files/PDFs as text, images as image_url
      const imageUploads = uploads.filter((u) => u.type === "image" && u.dataUrl);
      const textUploads = uploads.filter((u) => u.type !== "image" && u.content);

      // Build the text portion — use processedText if command was parsed
      let textContent = parsed ? processedText : text.trim();

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

      // Clear all attachments
      setAttachedFiles([]);
      setUploads([]);

      const userMsg = { role: "user", content };
      const aiMsg = { role: "assistant", content: "" };

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
        text,
        uploads: [...uploads],
        attachedFiles: [...attachedFiles],
        modelUsed: selectedModel,
        chatId,
      };

      const startTime = Date.now();
      const controller = new AbortController();
      abortRef.current = controller;

      // Build the messages to send (without the empty AI placeholder)
      const history = [...(chats.find((c) => c.id === chatId)?.messages || []), userMsg];
      const systemMsg = { role: "system", content: systemPrompt };
      const toSend = [systemMsg, ...history];

      try {
        const result = await streamMessage(apiKey, selectedModel, toSend, {
          signal: controller.signal,
          onChunk: (fullText) => {
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
        });

        // Calculate and store cost on the AI message
        const currentModelObj = models.find((m) => m.id === selectedModel);
        const pricing = currentModelObj?.pricing;
        // Prefer actual cost from OpenRouter API, fall back to local calculation
        const apiCost = result.usage?.cost;
        const cost = (apiCost != null && apiCost >= 0) ? apiCost : calculateCost(result.usage, pricing);
        const free = isModelFree(pricing);

        // Record success for rate limiter
        const responseTime = Date.now() - startTime;
        recordSuccess(selectedModel, responseTime);

        // Generate advisor data
        const taskTypeForAdvisor = detectTaskType(processedText || text, uploads, attachedFiles);
        const advisor = generateAdvisorData({
          models,
          currentModelId: selectedModel,
          taskType: taskTypeForAdvisor,
          cost,
          usage: result.usage,
          pricing,
          preference: advisorPrefs?.preferBest ? "best" : advisorPrefs?.preferFree ? "free" : modelPref,
          monthlyBudget: advisorPrefs?.monthlyBudget || null,
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
              usage: result.usage,
              _modelUsed: selectedModel,
              _advisorData: advisor,
            };
            return { ...c, messages: next };
          })
        );

        // Refresh credits from API
        fetchCredits(apiKey).then((c) => { if (c) setLifetimeCost(c); });
      } catch (err) {
        if (err.name === "AbortError") {
          // keep partial response
        } else {
          const errMsg = err.message || "Failed to get a response. Please try again.";
          setError(errMsg);
          setLastError(errMsg);

          // Record failure for rate limiter
          recordFailure(selectedModel, errMsg);

          // Show rate limit banner with fallback suggestion on any model error
          const taskType = detectTaskType(text, uploads, attachedFiles);
          const fallback = findFallbackModel(models, selectedModel, taskType, qualityScore);
          if (fallback) {
            setRateLimitBanner({
              visible: true,
              modelId: selectedModel,
              fallbackModelId: fallback.id,
              onSwitch: () => {
                setSelectedModel(fallback.id);
                setRateLimitBanner(null);
              },
              onDismiss: () => setRateLimitBanner(null),
            });
          }

          // Store error on the AI message (instead of removing it) for retry UI
          setChats((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              const last = c.messages[c.messages.length - 1];
              if (last?.role === "assistant" && !last.content) {
                const next = [...c.messages];
                next[next.length - 1] = { ...last, _error: errMsg };
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
      }
    },
    [apiKey, selectedModel, activeChatId, chats, attachedFiles, uploads, models, systemPrompt, advisorPrefs, modelPref]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * Retry or regenerate last request.
   * @param {"same"|"better"} mode - "same" retries with same model, "better" picks a better one
   */
  const handleRetryOrRegenerate = useCallback(
    (mode) => {
      const last = lastRequestRef.current;
      if (!last) return;

      // Remove the last AI message (error or completed)
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== activeChatId) return c;
          const msgs = [...c.messages];
          // Remove last assistant message
          if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant") {
            msgs.pop();
          }
          return { ...c, messages: msgs };
        })
      );

      // If "better", try to pick a better model
      if (mode === "better") {
        const taskType = detectTaskType(last.text, last.uploads, last.attachedFiles);
        const suggestion = selectSmartModel(models, taskType, selectedModel, modelPref);
        if (suggestion.recommended && suggestion.recommended.id !== selectedModel) {
          setSelectedModel(suggestion.recommended.id);
        } else {
          // Fallback: find any available model that's not the current one
          const fallback = findFallbackModel(models, selectedModel, taskType, qualityScore);
          if (fallback) {
            setSelectedModel(fallback.id);
          }
        }
      }

      setError("");
      setLastError(null);

      // Re-send the original text (handleSend will rebuild everything)
      // Use a small timeout to let state settle after model change
      setTimeout(() => {
        handleSend(last.text);
      }, 50);
    },
    [activeChatId, models, selectedModel, modelPref, handleSend]
  );

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

  /** Called from ModelAdvisorCard — switch to a suggested model for next message */
  const handleAdvisorSwitch = useCallback((modelId) => {
    setSelectedModel(modelId);
  }, []);

  const handleNewChat = () => {
    handleStop();
    const newChat = { id: generateId(), title: "New Chat", messages: [] };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setError("");
  };

  const handleSelectChat = (id) => {
    if (id === activeChatId) return;
    handleStop();
    setActiveChatId(id);
    setError("");
  };

  const handleAcceptSuggestion = useCallback((modelId) => {
    setSelectedModel(modelId);
    setSmartSuggestion(null);
    setSuggestionDismissed(false);
  }, []);

  const handleDismissSuggestion = useCallback(() => {
    setSuggestionDismissed(true);
  }, []);

  /** Debounced live detection of task type from input text */
  const inputDebounceRef = useRef(null);
  const handleInputTextChange = useCallback((text) => {
    clearTimeout(inputDebounceRef.current);
    inputDebounceRef.current = setTimeout(() => {
      if (!text || text.length < 10) {
        setTaskBanner(null);
        setCheapestBanner(null);
        return;
      }

      const taskType = detectTaskType(text, uploads, attachedFiles);
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
            setSelectedModel(suggestion.recommended.id);
            setTaskBanner(null);
          },
          onIgnore: () => setTaskBanner(null),
        });
      } else {
        setTaskBanner(null);
      }

      // Show cheapest banner for detected task
      const cheapest = findCheapestModel(models, taskType, null);
      if (cheapest && cheapest.model.id !== selectedModel) {
        setCheapestBanner({
          visible: true,
          cheapestLabel: cheapest.costLabel,
          cheapestModelId: cheapest.model.id,
          currentModelId: selectedModel,
          onUseCheapest: () => {
            setSelectedModel(cheapest.model.id);
            setCheapestBanner(null);
          },
          onKeepCurrent: () => setCheapestBanner(null),
        });
      } else {
        setCheapestBanner(null);
      }
    }, 500); // 500ms debounce
  }, [models, selectedModel, modelPref, uploads, attachedFiles]);

  const handleDeleteChat = (id) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (activeChatId === id) {
      const remaining = chats.filter((c) => c.id !== id);
      setActiveChatId(remaining[0]?.id || "");
    }
  };

  return (
    <div className="h-full flex flex-col bg-dark-950">
      <TitleBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <div className="flex flex-1 min-h-0">
      {/* ── Sidebar ── */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarOpen ? 260 : 0, opacity: sidebarOpen ? 1 : 0 }}
        transition={{ duration: 0.25, ease }}
        className="shrink-0 bg-dark-900 border-r border-white/[0.06] flex flex-col overflow-hidden"
      >
        {/* Brand header */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <KPLogo size={32} className="rounded-lg shadow-md shadow-saffron-500/20" />
            <span className="font-serif text-white font-semibold text-sm tracking-wide">KritakaPrajna</span>
          </div>
        </div>

        {/* New Chat button */}
        <div className="px-3 pb-3">
          <motion.button
            whileHover={{ scale: 1.01, backgroundColor: "rgba(30, 41, 59, 0.8)" }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.15, ease }}
            onClick={handleNewChat}
            className="w-full flex items-center gap-2.5 text-sm text-dark-100 bg-dark-800/60 hover:bg-dark-800 rounded-xl px-3 py-2.5 cursor-pointer border border-dark-700/40 hover:border-dark-600/60"
          >
            <svg className="w-4 h-4 text-dark-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </motion.button>
        </div>

        {/* Chat list */}
        <div className="px-3 flex-1 overflow-y-auto">
          <div className="text-[11px] uppercase tracking-wider text-dark-400 font-medium px-2 mb-2">
            Chats
          </div>

          {chats.length === 0 && (
            <p className="text-xs text-dark-500 px-2 py-3">No conversations yet</p>
          )}

          <div className="space-y-1">
            {chats.map((chat) => {
              const isActive = chat.id === activeChatId;
              return (
                <motion.div
                  key={chat.id}
                  layout
                  onClick={() => handleSelectChat(chat.id)}
                  className={`group text-sm rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors ${
                    isActive
                      ? "bg-dark-800/50 text-dark-100 border border-saffron-500/15"
                      : "text-dark-300 hover:bg-dark-800/30 hover:text-dark-100 border border-transparent"
                  }`}
                >
                  {isActive && (
                    <div className="w-1.5 h-1.5 rounded-full bg-saffron-500/60 shrink-0" />
                  )}
                  <span className="truncate flex-1">{chat.title}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteChat(chat.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-dark-600/60 text-dark-400 hover:text-red-400 transition-all cursor-pointer"
                    aria-label="Delete chat"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Bottom: file context + cost + settings */}
        <div className="border-t border-white/[0.06]">
          <FileContext onAttach={handleAttachFile} />
        </div>

        {/* Cost tracker */}
        <div className="px-3 py-2.5 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 mb-1.5">
            <svg className="w-3.5 h-3.5 text-dark-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[10px] uppercase tracking-wider text-dark-500 font-semibold">Usage</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-dark-400">Session</span>
            <span className="text-dark-200 font-medium">{formatCost(calcSessionCost(chats))}</span>
          </div>
          {lifetimeCost && (
            <>
              <div className="flex items-center justify-between text-[11px] mt-0.5">
                <span className="text-dark-400">Total Used</span>
                <span className="text-dark-200 font-medium">{formatCost(lifetimeCost.total_usage || 0)}</span>
              </div>
              {lifetimeCost.total_credits > 0 && (
                <div className="flex items-center justify-between text-[11px] mt-0.5">
                  <span className="text-dark-400">Credits Left</span>
                  <span className="text-emerald-300 font-medium">{formatCost(Math.max(0, (lifetimeCost.total_credits || 0) - (lifetimeCost.total_usage || 0)))}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-3 py-3 border-t border-white/[0.06]">
          <motion.button
            whileHover={{ scale: 1.01, backgroundColor: "rgba(30, 41, 59, 0.6)" }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.15, ease }}
            onClick={() => { setShowSettings(true); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-2.5 text-xs rounded-xl px-3 py-2.5 cursor-pointer ${
              showSettings
                ? "text-saffron-400 bg-saffron-500/10"
                : "text-dark-300 hover:text-dark-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </motion.button>
        </div>

        <div className="px-3 pb-3 text-center">
          <span className="text-[10px] text-dark-500">Made by Parikshit</span>
        </div>
      </motion.aside>

      {/* ── Main area ── */}
      <AnimatePresence mode="wait">
      {showSettings ? (
        <motion.div
          key="settings"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.25, ease }}
          className="flex-1 flex flex-col min-w-0"
        >
        <SettingsPanel
          apiKey={apiKey}
          onSaveKey={onSaveKey}
          onRemoveKey={onResetKey}
          onClose={() => { setShowSettings(false); setSidebarOpen(true); }}
          modelPref={modelPref}
          onSaveModelPref={(v) => { setModelPref(v); localStorage.setItem(MODEL_PREF_KEY, v); }}
          customCommands={customCommands}
          onSaveCustomCommands={(cmds) => { setCustomCommands(cmds); saveCustomCommands(cmds); }}
          systemPrompt={systemPrompt}
          onSaveSystemPrompt={(p) => { setSystemPrompt(p); localStorage.setItem(SYSTEM_PROMPT_KEY, p); }}
          defaultSystemPrompt={DEFAULT_SYSTEM_PROMPT}
          advisorPrefs={advisorPrefs}
          onSaveAdvisorPrefs={(prefs) => { setAdvisorPrefs(prefs); localStorage.setItem(ADVISOR_PREFS_KEY, JSON.stringify(prefs)); }}
        />
        </motion.div>
      ) : (
      <motion.div
        key="chat"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.25, ease }}
        className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-dark-950 via-dark-950 to-dark-900/50"
      >
        {/* Top bar */}
        <header className="flex items-center gap-4 px-5 py-3 glass border-b border-white/[0.06] shrink-0">
          <ModelSelector
            models={models}
            selected={selectedModel}
            onSelect={setSelectedModel}
          />
          {selectedModel && (() => {
            const m = models.find((mod) => mod.id === selectedModel);
            const p = m?.pricing;
            const promptCost = Number(p?.prompt) || 0;
            const completionCost = Number(p?.completion) || 0;
            const per1M = (promptCost + completionCost) * 1_000_000;
            const currentIsFree = per1M === 0;
            return (
              <div className="flex items-center gap-2.5 min-w-0 hidden sm:flex">
                <span className="text-xs text-dark-400 truncate max-w-[300px]">
                  {selectedModel}
                </span>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${
                  currentIsFree
                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
                    : "text-saffron-300 bg-saffron-500/10 border-saffron-500/20"
                }`}>
                  {currentIsFree ? "Free" : `$${per1M < 0.01 ? per1M.toFixed(4) : per1M.toFixed(2)}/1M tokens`}
                </span>
              </div>
            );
          })()}
        </header>

        {/* Smart model suggestion */}
        {!suggestionDismissed && (
          <SmartModelBanner
            suggestion={smartSuggestion}
            onAccept={handleAcceptSuggestion}
            onDismiss={handleDismissSuggestion}
          />
        )}

        {/* Prompt-based banners: task suggestion, rate limit, cheapest model */}
        <PromptBanners
          taskSuggestion={taskBanner}
          rateLimitWarning={rateLimitBanner}
          cheapestModel={cheapestBanner}
        />

        {/* Error banner */}
        <AnimatePresence>
        {error && (
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
                  className="text-xs font-medium text-saffron-300 bg-saffron-500/15 hover:bg-saffron-500/25 rounded-lg px-2.5 py-1 cursor-pointer disabled:opacity-30 transition-colors"
                >
                  Retry
                </button>
                <button
                  onClick={() => handleRetry("better")}
                  disabled={loading}
                  className="text-xs font-medium text-purple-300 bg-purple-500/15 hover:bg-purple-500/25 rounded-lg px-2.5 py-1 cursor-pointer disabled:opacity-30 transition-colors"
                >
                  Try Better Model
                </button>
              </div>
            )}
          </motion.div>
        )}
        </AnimatePresence>

        {/* Messages */}
        <MessageList
          messages={messages}
          loading={loading}
          lastError={lastError}
          onRetry={handleRetry}
          onRegenerate={handleRegenerate}
          onRefine={(msgIdx) => {
            const aiMsg = messages[msgIdx];
            if (!aiMsg || aiMsg.role !== "assistant" || !aiMsg.content) return;
            handleSend("Refine your previous answer: be more precise, fix any issues, and improve the code quality. Keep the same format.");
          }}
        />

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
              <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
                {/* Sidebar-attached text files */}
                {attachedFiles.map((f) => (
                  <span
                    key={"af-" + f.path}
                    className="inline-flex items-center gap-1.5 text-xs bg-saffron-500/10 text-saffron-300 border border-saffron-500/20 rounded-lg px-2.5 py-1"
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
                    className="relative group inline-flex items-center gap-2 text-xs bg-dark-800/60 border border-white/[0.06] rounded-lg px-2 py-1.5"
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
                      <div className="w-8 h-8 rounded bg-dark-700/60 flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4 text-dark-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex flex-col min-w-0">
                      <span className="text-dark-200 truncate max-w-[100px]">{u.name}</span>
                      <span className="text-[10px] text-dark-500">{formatSize(u.size)}</span>
                    </div>
                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => handleRemoveUpload(u.id)}
                      className="ml-1 text-dark-500 hover:text-red-400 transition-colors cursor-pointer shrink-0"
                      aria-label={`Remove ${u.name}`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    {/* Error badge for failed PDFs */}
                    {u.error && (
                      <span className="text-[9px] text-red-400/80" title={u.error}>⚠</span>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input */}
        <MessageInput onSend={handleSend} onUpload={handleUpload} loading={loading} onStop={handleStop} disabled={loading || !selectedModel} commandHints={getAllCommandHints(customCommands)} onTextChange={handleInputTextChange} />
      </motion.div>
      )}
      </AnimatePresence>

      {/* Right-side advisor slider */}
      {!showSettings && advisorPrefs?.showAdvisor !== false && (
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
    </div>
  );
}
