import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import CodeEditor from "react-simple-code-editor";
import hljs from "highlight.js/lib/common";
import { FileIcon, defaultStyles } from "react-file-icon";
import MarkdownRenderer from "./MarkdownRenderer";
import { safeCopyText } from "../utils/clipboard";
import "highlight.js/styles/github-dark.css";

const C = {
  mainBg: "#0a0a0a",
  panelBg: "#111111",
  activityBg: "#0d0d0d",
  border: "#1a1a1a",
  tabBg: "#111111",
  accent: "#00ff41",
  accentSoft: "rgba(0,255,65,0.15)",
  accentText: "#00ff41",
  text: "#b0b0b0",
  textDim: "#666666",
  textBright: "#e0e0e0",
  editorBg: "#0a0a0a",
  terminalBg: "#050505",
  green: "#00ff41",
  orange: "#00d4ff",
  blue: "#00d4ff",
};

function modelSelectionId(model) {
  return model?._selectionId || model?.id || "";
}

function modelDisplayName(model) {
  if (!model) return "";
  const raw = String(model?.name || model?.id || "");
  const trimmed = raw.includes("/") ? raw.split("/").slice(1).join("/") : raw;
  return trimmed || raw;
}

function modelProviderLabel(provider) {
  switch (provider) {
    case "openrouter":
      return "OpenRouter";
    case "huggingface":
      return "Hugging Face";
    case "ollama":
      return "Ollama";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    default:
      return provider || "Model";
  }
}

function isFreePricedModel(model) {
  const prompt = Number(model?.pricing?.prompt);
  const completion = Number(model?.pricing?.completion);
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
}

const ACTIVITY_ITEMS = [
  {
    id: "explorer",
    title: "Explorer",
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A2.5 2.5 0 015.5 5h4.8c.4 0 .8.16 1.08.44l1.2 1.2c.28.28.66.44 1.06.44h4.86A2.5 2.5 0 0121 9.58v8.92A2.5 2.5 0 0118.5 21h-13A2.5 2.5 0 013 18.5v-11z" />
      </svg>
    ),
  },
  {
    id: "search",
    title: "Search",
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="11" cy="11" r="7" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 20l-3.5-3.5" />
      </svg>
    ),
  },
  {
    id: "git",
    title: "Source Control",
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="18" cy="18" r="2.5" />
        <circle cx="6" cy="6" r="2.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 6h6a2 2 0 012 2v7.5M6 8.5V21" />
      </svg>
    ),
  },
  {
    id: "chat",
    title: "Chat",
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
];

const SETTINGS_ICON = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.33 4.32a1.75 1.75 0 013.34 0l.2.82a1.75 1.75 0 002.46 1.16l.74-.42a1.75 1.75 0 012.37 2.37l-.42.74a1.75 1.75 0 001.16 2.46l.82.2a1.75 1.75 0 010 3.34l-.82.2a1.75 1.75 0 00-1.16 2.46l.42.74a1.75 1.75 0 01-2.37 2.37l-.74-.42a1.75 1.75 0 00-2.46 1.16l-.2.82a1.75 1.75 0 01-3.34 0l-.2-.82a1.75 1.75 0 00-2.46-1.16l-.74.42a1.75 1.75 0 01-2.37-2.37l.42-.74a1.75 1.75 0 00-1.16-2.46l-.82-.2a1.75 1.75 0 010-3.34l.82-.2a1.75 1.75 0 001.16-2.46l-.42-.74a1.75 1.75 0 012.37-2.37l.74.42a1.75 1.75 0 002.46-1.16l.2-.82z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const FOLDER_ICON = (
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A2.5 2.5 0 015.5 5h4.8c.4 0 .8.16 1.08.44l1.2 1.2c.28.28.66.44 1.06.44h4.86A2.5 2.5 0 0121 9.58v8.92A2.5 2.5 0 0118.5 21h-13A2.5 2.5 0 013 18.5v-11z" />
  </svg>
);

const EDITOR_LINES = [
  "import React from 'react';",
  "",
  "export default function AgentIdeWorkspace() {",
  "  return (",
  "    <div className='agent-shell'>",
  "      {/* UI-only shell while execution flow is rebuilt */}",
  "    </div>",
  "  );",
  "}",
];

const TERMINAL_LINES = [
  "[agent] Ready.",
  "$ Ready.",
];

const MIN_TERMINAL_HEIGHT = 140;
const MAX_TERMINAL_HEIGHT = 520;

function pathBaseName(rawPath = "") {
  const normalized = String(rawPath || "").replace(/[\\/]+$/, "");
  if (!normalized) return "";
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || normalized;
}

function fileExtension(fileName = "") {
  const value = String(fileName || "").trim();
  const dot = value.lastIndexOf(".");
  if (dot < 0 || dot === value.length - 1) return "";
  return value.slice(dot + 1).toLowerCase();
}

const EDITOR_LANGUAGE_MAP = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  json: "json",
  md: "markdown",
  html: "html",
  css: "css",
  scss: "scss",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  sh: "shell",
  bash: "shell",
  ps1: "powershell",
  bat: "bat",
  sql: "sql",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  php: "php",
  rb: "ruby",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  dart: "dart",
  vue: "html",
  svelte: "html",
  toml: "ini",
  ini: "ini",
  dockerfile: "dockerfile",
};

const HIGHLIGHT_LANGUAGE_MAP = {
  javascript: "javascript",
  typescript: "typescript",
  python: "python",
  json: "json",
  markdown: "markdown",
  html: "xml",
  xml: "xml",
  css: "css",
  scss: "scss",
  yaml: "yaml",
  shell: "bash",
  powershell: "bash",
  bat: "bash",
  sql: "sql",
  java: "java",
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  go: "go",
  rust: "rust",
  php: "php",
  ruby: "ruby",
  plaintext: "plaintext",
};

const FILE_ICON_STYLE_ALIASES = {
  tsx: "ts",
  yaml: "yml",
  htm: "html",
};

function detectEditorLanguage(fileName = "") {
  const lowerName = String(fileName || "").trim().toLowerCase();
  if (!lowerName) return "plaintext";

  if (lowerName === "dockerfile") return "dockerfile";

  const ext = fileExtension(lowerName);
  return EDITOR_LANGUAGE_MAP[ext] || EDITOR_LANGUAGE_MAP[lowerName] || "plaintext";
}

function detectHighlightLanguage(editorLanguage = "") {
  const key = String(editorLanguage || "").trim().toLowerCase();
  return HIGHLIGHT_LANGUAGE_MAP[key] || "plaintext";
}

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function highlightWithHljs(code = "", language = "plaintext") {
  const safeCode = String(code ?? "");
  const normalizedLanguage = String(language || "").trim().toLowerCase();

  try {
    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return hljs.highlight(safeCode, { language: normalizedLanguage, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(safeCode).value;
  } catch {
    return escapeHtml(safeCode);
  }
}

function getFileIconConfig(fileName = "") {
  const lowerName = String(fileName || "").trim().toLowerCase();
  const ext = fileExtension(lowerName);

  const namedStyle = defaultStyles[lowerName];
  if (namedStyle) {
    return { extension: ext || lowerName, style: namedStyle };
  }

  const extStyle = defaultStyles[ext];
  if (extStyle) {
    return { extension: ext, style: extStyle };
  }

  const aliasKey = FILE_ICON_STYLE_ALIASES[ext] || FILE_ICON_STYLE_ALIASES[lowerName];
  const aliasStyle = aliasKey ? defaultStyles[aliasKey] : null;
  if (aliasStyle) {
    return { extension: aliasKey, style: aliasStyle };
  }

  return { extension: ext || "txt", style: defaultStyles.txt || defaultStyles.document };
}

function LanguageFileIcon({ fileName, size = 14 }) {
  const config = getFileIconConfig(fileName);
  return (
    <span
      aria-hidden
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      title={fileName}
    >
      <FileIcon extension={config.extension} {...config.style} />
    </span>
  );
}

function LoadingSpinner({ size = 12, accent = C.accentText }) {
  return (
    <span
      className="animate-spin"
      aria-hidden
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "999px",
        border: `2px solid rgba(255,255,255,0.18)`,
        borderTopColor: accent,
        display: "inline-block",
      }}
    />
  );
}

function sanitizeAssistantMessageText(value = "") {
  let output = String(value || "").trim();
  if (!output) return "";

  output = output
    .replace(/<\/?plan>/gi, "")
    .replace(/<step[^>]*>/gi, "")
    .replace(/<\/step>/gi, "")
    .replace(/^\s*\*\*REPORT\*\*\s*$/gim, "## Report")
    .trim();

  return output;
}

// ── Chat-style helpers for agent panel ──────────────────────────────────────
const agentEase = [0.4, 0, 0.2, 1];
const agentMsgVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: agentEase } },
};

function parseThinking(content) {
  if (typeof content !== "string") return { thinking: null, isThinking: false, rest: content };
  const openIdx = content.indexOf("<think>");
  if (openIdx === -1) return { thinking: null, isThinking: false, rest: content };
  const closeIdx = content.indexOf("</think>", openIdx);
  if (closeIdx === -1) {
    return { thinking: content.slice(openIdx + 7), isThinking: true, rest: content.slice(0, openIdx) };
  }
  return {
    thinking: content.slice(openIdx + 7, closeIdx),
    isThinking: false,
    rest: (content.slice(0, openIdx) + content.slice(closeIdx + 8)).trimStart(),
  };
}

function AgentThinkingBlock({ content, isThinking }) {
  const [expanded, setExpanded] = useState(isThinking);
  useEffect(() => { if (!isThinking) setExpanded(false); }, [isThinking]);

  return (
    <div className="mb-2 rounded-lg border overflow-hidden" style={{ borderColor: "rgba(139,92,246,0.15)", background: "rgba(139,92,246,0.06)" }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors"
        style={{ background: "transparent", border: "none", cursor: "pointer" }}
      >
        {isThinking ? (
          <span className="inline-flex gap-0.5" style={{ color: C.accent }}>
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, ease: agentEase, delay: 0 }}>●</motion.span>
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, ease: agentEase, delay: 0.2 }}>●</motion.span>
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, ease: agentEase, delay: 0.4 }}>●</motion.span>
          </span>
        ) : (
          <svg className="w-3 h-3" style={{ color: C.textDim }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        )}
        <span className="text-[10px] font-medium" style={{ color: C.textDim }}>
          {isThinking ? "Thinking..." : "Thought"}
        </span>
        {!isThinking && (
          <svg
            className={`w-2.5 h-2.5 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
            style={{ color: C.textDim }}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="agent-thinking-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: agentEase }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2 text-[11px] leading-relaxed italic" style={{ color: C.textDim, borderTop: `1px solid rgba(139,92,246,0.1)`, paddingTop: "6px" }}>
              <MarkdownRenderer content={content} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentAiIcon() {
  return (
    <div
      className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5 rounded-sm"
      style={{ background: "rgba(0,255,65,0.1)", border: "1px solid rgba(0,255,65,0.3)" }}
    >
      <span className="font-mono text-[9px] font-bold text-[#00ff41] tracking-tighter ml-[1px]">
        &gt;_
      </span>
    </div>
  );
}

function AgentCopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleCopy = async () => {
    const ok = await safeCopyText(text);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setCopied(false); timerRef.current = null; }, 1400);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-colors"
      style={{
        color: copied ? C.green : C.textDim,
        background: copied ? "rgba(52,211,153,0.1)" : "transparent",
        border: "none",
        cursor: "pointer",
      }}
    >
      {copied ? (
        <>
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function AgentMessageContent({ content }) {
  if (typeof content !== "string") return String(content || "");
  const { thinking, isThinking, rest } = parseThinking(content);
  return (
    <>
      {thinking != null && <AgentThinkingBlock content={thinking} isThinking={isThinking} />}
      {rest && <MarkdownRenderer content={rest} />}
    </>
  );
}

function WorkspaceNode({
  node,
  depth = 0,
  expandedDirs,
  loadingDirs,
  treeByPath,
  onToggleDir,
  onOpenFile,
  activeFilePath,
}) {
  const isFolder = !!node?.isDir;
  const isOpen = !!expandedDirs[node.path];
  const isLoading = !!loadingDirs[node.path];
  const children = treeByPath[node.path] || [];
  const isActiveFile = !isFolder && activeFilePath === node.path;

  return (
    <div>
      <button
        type="button"
        onClick={() => (isFolder ? onToggleDir?.(node) : onOpenFile?.(node))}
        className="w-full h-7 px-1.5 text-left flex items-center gap-1.5 rounded-md hover:bg-dark-800/40 transition-colors"
        style={{
          paddingLeft: `${6 + depth * 14}px`,
          color: isActiveFile ? C.accentText : C.text,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontSize: "12px",
        }}
        title={node.path}
      >
        <span style={{ width: "10px", color: C.textDim }}>{isFolder ? (isOpen ? "v" : ">") : ""}</span>
        <span style={{ width: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", color: isFolder ? C.orange : C.textDim }}>
          {isFolder ? FOLDER_ICON : <LanguageFileIcon fileName={node.name} />}
        </span>
        <span className="truncate" style={{ fontWeight: isActiveFile ? 600 : 400 }}>{node.name}</span>
      </button>

      {isFolder && isOpen && (
        <div>
          {isLoading && (
            <div className="h-5 flex items-center gap-1.5 text-[10px]" style={{ paddingLeft: `${20 + depth * 14}px`, color: C.textDim }}>
              <LoadingSpinner size={10} accent={C.accent} />
              Loading...
            </div>
          )}

          {!isLoading && children.map((child) => (
            <WorkspaceNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              loadingDirs={loadingDirs}
              treeByPath={treeByPath}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
              activeFilePath={activeFilePath}
            />
          ))}

          {!isLoading && children.length === 0 && (
            <div className="h-5 flex items-center text-[10px]" style={{ paddingLeft: `${20 + depth * 14}px`, color: C.textDim }}>
              Empty folder
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlanStep({ step, index }) {
  const color =
    step.state === "done"
      ? C.green
      : step.state === "pending"
        ? C.accent
        : C.textDim;

  const marker =
    step.state === "done"
      ? "ok"
      : step.state === "pending"
        ? ".."
        : "--";

  return (
    <div className="h-5 flex items-center gap-2 text-[11px]" style={{ color: C.text }}>
      <span style={{ width: "20px", color }}>{marker}</span>
      <span style={{ color: step.state === "done" ? C.textDim : C.text }}>
        {index + 1}. {step.text}
      </span>
    </div>
  );
}

// ── Collapsible config toolbar with mode toggles + plan section ──
function AgentConfigToolbar({ executionMode, setExecutionMode, requireApproval, setRequireApproval, normalizedPlan, summarizedRunStats }) {
  const [configOpen, setConfigOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const hasPlan = normalizedPlan.length > 0;
  const hasChanges = summarizedRunStats.filesChanged > 0;

  return (
    <div className="shrink-0 border-b" style={{ borderColor: C.border }}>
      {/* Compact toolbar row */}
      <div className="h-8 px-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setExecutionMode(executionMode === "direct" ? "plan_first" : "direct")}
          className="h-5 px-2 text-[10px] rounded border transition-colors"
          style={{
            borderColor: "rgba(139,92,246,0.25)",
            color: C.accentText,
            background: "rgba(139,92,246,0.1)",
            cursor: "pointer",
          }}
          title={`Mode: ${executionMode === "direct" ? "Direct" : "Plan First"}`}
        >
          {executionMode === "direct" ? "Direct" : "Plan First"}
        </button>

        <button
          type="button"
          onClick={() => setRequireApproval(!requireApproval)}
          className="h-5 px-2 text-[10px] rounded border transition-colors"
          style={{
            borderColor: requireApproval ? "rgba(52,211,153,0.3)" : "rgba(255,255,255,0.1)",
            color: requireApproval ? "#6ee7b7" : C.textDim,
            background: requireApproval ? "rgba(16,185,129,0.08)" : "transparent",
            cursor: "pointer",
          }}
          title={requireApproval ? "Approval required" : "No approval required"}
        >
          {requireApproval ? "Approval On" : "Approval Off"}
        </button>

        <div className="flex-1" />

        {/* Plan toggle */}
        <button
          type="button"
          onClick={() => setPlanOpen((v) => !v)}
          className="h-5 px-2 text-[10px] rounded border transition-colors flex items-center gap-1"
          style={{
            borderColor: hasPlan ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.1)",
            color: hasPlan ? C.accentText : C.textDim,
            background: hasPlan ? "rgba(139,92,246,0.08)" : "transparent",
            cursor: "pointer",
          }}
        >
          Plan {normalizedPlan.length > 0 ? `(${normalizedPlan.length})` : ""}
          <svg
            className={`w-2.5 h-2.5 transition-transform ${planOpen ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Config gear toggle */}
        <button
          type="button"
          onClick={() => setConfigOpen((v) => !v)}
          className="h-5 w-5 flex items-center justify-center rounded transition-colors"
          style={{ color: C.textDim, cursor: "pointer" }}
          title="Config"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Expanded config section */}
      <AnimatePresence initial={false}>
        {configOpen && (
          <motion.div
            key="agent-config-expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15, ease: agentEase }}
            className="overflow-hidden"
          >
            <div className="px-3 py-2 space-y-2 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: C.textDim }}>Execution Mode</div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setExecutionMode("direct")}
                  className="h-6 px-2 text-[11px] border rounded-md"
                  style={{
                    borderColor: executionMode === "direct" ? C.accent : C.border,
                    color: executionMode === "direct" ? C.accentText : C.textDim,
                    background: executionMode === "direct" ? C.accentSoft : "transparent",
                    cursor: "pointer",
                  }}
                >
                  Direct
                </button>
                <button
                  type="button"
                  onClick={() => setExecutionMode("plan_first")}
                  className="h-6 px-2 text-[11px] border rounded-md"
                  style={{
                    borderColor: executionMode === "plan_first" ? C.accent : C.border,
                    color: executionMode === "plan_first" ? C.accentText : C.textDim,
                    background: executionMode === "plan_first" ? C.accentSoft : "transparent",
                    cursor: "pointer",
                  }}
                >
                  Plan First
                </button>
              </div>
              <label className="h-5 flex items-center gap-2 text-[11px]" style={{ color: C.text }}>
                <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} />
                Require approval for major actions
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded plan section */}
      <AnimatePresence initial={false}>
        {planOpen && (
          <motion.div
            key="agent-plan-expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15, ease: agentEase }}
            className="overflow-hidden"
          >
            <div className="px-3 py-2 border-t" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(15,23,42,0.4)" }}>
              <div className="border p-2 rounded-lg" style={{ borderColor: C.border, background: "rgba(2,6,23,0.55)" }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: C.textDim }}>Task Plan</span>
                  <span className="text-[9px]" style={{ color: C.textDim }}>{normalizedPlan.length} step{normalizedPlan.length === 1 ? "" : "s"}</span>
                </div>
                {normalizedPlan.length > 0 ? (
                  normalizedPlan.map((step, stepIndex) => (
                    <PlanStep key={`plan-step-${stepIndex}`} step={step} index={stepIndex} />
                  ))
                ) : (
                  <p className="text-[10px]" style={{ color: C.textDim }}>Waiting for plan...</p>
                )}

                {(hasChanges || summarizedRunStats.changedFiles.length > 0) && (
                  <div className="mt-2 pt-2 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="text-[10px] inline-flex items-center gap-2" style={{ color: C.textBright }}>
                      <span>Files: {summarizedRunStats.filesChanged}</span>
                      <span style={{ color: "#86efac" }}>+{summarizedRunStats.linesAdded}</span>
                      <span style={{ color: "#fca5a5" }}>-{summarizedRunStats.linesRemoved}</span>
                    </div>
                    {summarizedRunStats.changedFiles.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {summarizedRunStats.changedFiles.map((entry, idx) => (
                          <div key={`changed-${idx}`} className="text-[9px] flex items-center justify-between gap-2" style={{ color: C.textDim }}>
                            <span className="truncate">{entry.path}</span>
                            <span className="shrink-0" style={{ color: C.text }}>+{Math.max(0, Number(entry.added) || 0)} / -{Math.max(0, Number(entry.removed) || 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AgentIdeWorkspace({
  agentModels = [],
  selectedModel = "",
  onSelectModel,
  messages = [],
  agentPlan = [],
  agentCurrentStep = "",
  agentStepDetails = "",
  agentTerminalLines = [],
  agentSessionStatus = "idle",
  agentError = "",
  agentRunStats = null,
  agentPendingCommand = "",
  agentCommandDraft = "",
  onSetAgentCommandDraft,
  onAllowCommand,
  onDenyCommand,
  onQueueCommand,
  agentWorkspacePath,
  onPickWorkspace,
  onClearWorkspace,
  onRunTask,
  onSwitchMode,
  onOpenSettings,
  onStopAgent,
}) {
  const [activityTab, setActivityTab] = useState("explorer");
  const [sideOpen, setSideOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [executionMode, setExecutionMode] = useState("plan_first");
  const [requireApproval, setRequireApproval] = useState(true);
  const [agentInput, setAgentInput] = useState("");
  const [agentInputFocused, setAgentInputFocused] = useState(false);
  const [treeByPath, setTreeByPath] = useState({});
  const [expandedDirs, setExpandedDirs] = useState({});
  const [loadingDirs, setLoadingDirs] = useState({});
  const [activeFilePath, setActiveFilePath] = useState("");
  const [activeFileName, setActiveFileName] = useState("");
  const [activeFileContent, setActiveFileContent] = useState("");
  const [editorDraft, setEditorDraft] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [openFileTabs, setOpenFileTabs] = useState([]);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const terminalResizeRef = useRef({ active: false, startY: 0, startHeight: 220 });
  const agentMessagesEndRef = useRef(null);
  const agentChatBottomRef = useRef(null);
  const agentInputRef = useRef(null);

  const loadFileContent = async (filePath) => {
    const target = String(filePath || "").trim();
    if (!target || !window.electronAPI?.readFile) return;

    setLoadingFile(true);
    try {
      const result = await window.electronAPI.readFile(target);
      if (result?.error) {
        const fallback = `// ${result.error}`;
        setActiveFileContent(fallback);
        setEditorDraft(fallback);
        setEditorDirty(false);
      } else {
        const content = String(result?.content || "");
        setActiveFileContent(content);
        setEditorDraft(content);
        setEditorDirty(false);
      }
    } catch {
      const fallback = "// Failed to read file";
      setActiveFileContent(fallback);
      setEditorDraft(fallback);
      setEditorDirty(false);
    } finally {
      setLoadingFile(false);
    }
  };

  const selectedAgentModel = useMemo(() => {
    if (!Array.isArray(agentModels) || agentModels.length === 0) return null;
    return (
      agentModels.find((model) => modelSelectionId(model) === selectedModel || model.id === selectedModel) || null
    );
  }, [agentModels, selectedModel]);

  const workspaceRoot = useMemo(() => {
    const rootPath = String(agentWorkspacePath || "").trim();
    if (!rootPath) return null;
    return {
      name: pathBaseName(rootPath),
      path: rootPath,
      isDir: true,
    };
  }, [agentWorkspacePath]);

  const editorText = useMemo(() => {
    if (loadingFile) {
      return "// Loading file...";
    }

    if (activeFilePath) {
      return String(editorDraft || "");
    }

    const workspaceName = workspaceRoot?.name || "No workspace";
    return [
      "// Select a file from Explorer to preview",
      `// Workspace: ${workspaceName}`,
      "",
      ...EDITOR_LINES,
    ].join("\n");
  }, [activeFilePath, editorDraft, loadingFile, workspaceRoot]);

  const editorLines = useMemo(() => {
    return String(editorText || "").split(/\r?\n/);
  }, [editorText]);

  const activeEditorLanguage = useMemo(() => {
    const name = activeFileName || pathBaseName(activeFilePath);
    return detectEditorLanguage(name);
  }, [activeFileName, activeFilePath]);

  const activeHighlightLanguage = useMemo(() => {
    return detectHighlightLanguage(activeEditorLanguage);
  }, [activeEditorLanguage]);

  const highlightEditorCode = useCallback((code) => {
    return highlightWithHljs(code, activeHighlightLanguage);
  }, [activeHighlightLanguage]);

  const loadDirectory = async (dirPath) => {
    const targetPath = String(dirPath || "").trim();
    if (!targetPath || !window.electronAPI?.readDir) return;

    setLoadingDirs((prev) => ({ ...prev, [targetPath]: true }));

    try {
      const entries = await window.electronAPI.readDir(targetPath);
      const safeEntries = Array.isArray(entries) ? entries : [];
      setTreeByPath((prev) => ({ ...prev, [targetPath]: safeEntries }));
    } catch {
      setTreeByPath((prev) => ({ ...prev, [targetPath]: [] }));
    } finally {
      setLoadingDirs((prev) => ({ ...prev, [targetPath]: false }));
    }
  };

  const refreshWorkspaceTree = async () => {
    if (!workspaceRoot?.path) return;

    const dirsToReload = Object.keys(expandedDirs).filter((dirPath) => expandedDirs[dirPath]);
    const targets = dirsToReload.length > 0 ? dirsToReload : [workspaceRoot.path];

    await Promise.all(targets.map((dirPath) => loadDirectory(dirPath)));
  };

  const handleToggleDir = async (node) => {
    if (!node?.isDir) return;
    const dirPath = String(node.path || "").trim();
    if (!dirPath) return;

    const willOpen = !expandedDirs[dirPath];
    setExpandedDirs((prev) => ({ ...prev, [dirPath]: willOpen }));

    if (willOpen && !treeByPath[dirPath]) {
      await loadDirectory(dirPath);
    }
  };

  const handleOpenFile = async (node) => {
    if (!node || node.isDir) return;

    const filePath = String(node.path || "").trim();
    if (!filePath) return;

    const fileName = String(node.name || pathBaseName(filePath) || "File");

    setOpenFileTabs((prev) => {
      if (prev.some((tab) => tab.path === filePath)) return prev;
      return [...prev, { path: filePath, name: fileName }];
    });

    setActiveFilePath(filePath);
    setActiveFileName(fileName);

    await loadFileContent(filePath);
  };

  const handleSelectFileTab = async (tab) => {
    const filePath = String(tab?.path || "").trim();
    if (!filePath) return;

    setActiveFilePath(filePath);
    setActiveFileName(String(tab?.name || pathBaseName(filePath) || "File"));
    await loadFileContent(filePath);
  };

  const handleCloseFileTab = async (filePath) => {
    const closingPath = String(filePath || "").trim();
    if (!closingPath) return;

    setOpenFileTabs((prev) => {
      const next = prev.filter((tab) => tab.path !== closingPath);
      return next;
    });

    if (activeFilePath !== closingPath) return;

    const remaining = openFileTabs.filter((tab) => tab.path !== closingPath);
    if (remaining.length === 0) {
      setActiveFilePath("");
      setActiveFileName("");
      setActiveFileContent("");
      setEditorDraft("");
      setEditorDirty(false);
      return;
    }

    const nextTab = remaining[remaining.length - 1];
    setActiveFilePath(nextTab.path);
    setActiveFileName(nextTab.name);
    await loadFileContent(nextTab.path);
  };

  useEffect(() => {
    const rootPath = String(agentWorkspacePath || "").trim();

    setTreeByPath({});
    setExpandedDirs({});
    setLoadingDirs({});
    setActiveFilePath("");
    setActiveFileName("");
    setActiveFileContent("");
    setEditorDraft("");
    setEditorDirty(false);
    setSaveMessage("");
    setLoadingFile(false);
    setOpenFileTabs([]);

    if (!rootPath) return;

    setExpandedDirs({ [rootPath]: true });
    loadDirectory(rootPath);
  }, [agentWorkspacePath]);

  const handleEditorChange = (nextValue) => {
    setEditorDraft(nextValue);
    if (!activeFilePath) {
      setEditorDirty(false);
      return;
    }
    setEditorDirty(nextValue !== String(activeFileContent || ""));
    if (saveMessage) setSaveMessage("");
  };

  const handleSaveActiveFile = async () => {
    if (!activeFilePath || !window.electronAPI?.writeFile || savingFile) return;
    if (!editorDirty) return;

    setSavingFile(true);
    try {
      const result = await window.electronAPI.writeFile(activeFilePath, editorDraft);
      if (!result?.success) {
        setSaveMessage(String(result?.error || "Save failed"));
        return;
      }
      setActiveFileContent(editorDraft);
      setEditorDirty(false);
      setSaveMessage("Saved");
      await refreshWorkspaceTree();
    } catch {
      setSaveMessage("Save failed");
    } finally {
      setSavingFile(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!activeFilePath) return;
      const isSave = (event.ctrlKey || event.metaKey) && String(event.key || "").toLowerCase() === "s";
      if (!isSave) return;
      event.preventDefault();
      handleSaveActiveFile();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFilePath, editorDraft, editorDirty, savingFile]);

  useEffect(() => {
    if (!saveMessage) return;
    const timer = setTimeout(() => setSaveMessage(""), 1800);
    return () => clearTimeout(timer);
  }, [saveMessage]);

  useEffect(() => {
    if (agentSessionStatus !== "done") return;
    if (!workspaceRoot?.path) return;

    const timer = setTimeout(async () => {
      await refreshWorkspaceTree();

      if (activeFilePath && !editorDirty) {
        await loadFileContent(activeFilePath);
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [agentSessionStatus, workspaceRoot?.path, activeFilePath, editorDirty]);

  useEffect(() => {
    if (!workspaceRoot?.path) return;

    const changeOps = Math.max(0, Number(agentRunStats?.changeOps) || 0);
    if (changeOps <= 0) return;

    const timer = setTimeout(async () => {
      await refreshWorkspaceTree();

      if (activeFilePath && !editorDirty) {
        await loadFileContent(activeFilePath);
      }
    }, 140);

    return () => clearTimeout(timer);
  }, [agentRunStats, workspaceRoot?.path, activeFilePath, editorDirty]);

  useEffect(() => {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const onMouseMove = (event) => {
      if (!terminalResizeRef.current.active) return;
      const deltaY = event.clientY - terminalResizeRef.current.startY;
      const nextHeight = clamp(
        terminalResizeRef.current.startHeight - deltaY,
        MIN_TERMINAL_HEIGHT,
        MAX_TERMINAL_HEIGHT
      );
      setTerminalHeight(nextHeight);
    };

    const onMouseUp = () => {
      terminalResizeRef.current.active = false;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const handleActivitySelect = (tabId) => {
    if (activityTab === tabId && sideOpen) {
      setSideOpen(false);
      return;
    }
    setActivityTab(tabId);
    setSideOpen(true);

    if (tabId === "chat") {
      onSwitchMode?.("chat");
    }
    if (tabId === "settings") {
      onOpenSettings?.();
    }
  };

  const pushLocalTask = () => {
    const text = String(agentInput || "").trim();
    if (!text) return;
    onRunTask?.(text, {
      executionMode,
      requireApproval,
    });
    setAgentInput("");
  };

  const canSendAgentTask = String(agentInput || "").trim().length > 0;

  const recentConversation = useMemo(() => {
    return (messages || [])
      .filter((message) => message?.role === "user" || message?.role === "assistant")
      .map((message, index) => ({
        id: `${message?.role || "msg"}-${index}`,
        role: message?.role || "assistant",
        text: String(message?.content || "").trim(),
        displayText:
          message?.role === "assistant"
            ? sanitizeAssistantMessageText(message?.content || "")
            : String(message?.content || "").trim(),
      }))
      .filter((entry) => entry.displayText.length > 0);
  }, [messages]);

  const normalizedPlan = useMemo(() => {
    if (!Array.isArray(agentPlan)) return [];
    return agentPlan
      .map((step, index) => {
        if (typeof step === "string") {
          return { text: step, state: "pending" };
        }
        const text = String(step?.text || step?.title || `Step ${index + 1}`).trim();
        const rawStatus = String(step?.status || step?.state || "pending").toLowerCase();
        const state = rawStatus === "done" || rawStatus === "completed"
          ? "done"
          : rawStatus === "error"
            ? "waiting"
            : rawStatus === "running"
              ? "pending"
              : rawStatus;
        return { text, state };
      })
      .filter((step) => step.text.length > 0);
  }, [agentPlan]);

  const terminalLinesToRender = useMemo(() => {
    const lines = Array.isArray(agentTerminalLines) ? agentTerminalLines : [];
    if (lines.length > 0) return lines;
    return TERMINAL_LINES;
  }, [agentTerminalLines]);

  const statusLabel = useMemo(() => {
    const state = String(agentSessionStatus || "idle").toLowerCase();
    if (state === "running") return "Running";
    if (state === "done") return "Done";
    if (state === "error") return "Error";
    if (state === "awaiting-approval") return "Awaiting Approval";
    return "Idle";
  }, [agentSessionStatus]);

  const isAgentBusy = useMemo(() => {
    const state = String(agentSessionStatus || "idle").toLowerCase();
    return state === "running" || state === "awaiting-approval";
  }, [agentSessionStatus]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (agentChatBottomRef.current) {
      agentChatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [recentConversation, isAgentBusy, agentPendingCommand]);

  const summarizedRunStats = useMemo(() => {
    const base = {
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
      changeOps: 0,
      changedFiles: [],
    };

    if (!agentRunStats || typeof agentRunStats !== "object") return base;

    return {
      filesChanged: Math.max(0, Number(agentRunStats.filesChanged) || 0),
      linesAdded: Math.max(0, Number(agentRunStats.linesAdded) || 0),
      linesRemoved: Math.max(0, Number(agentRunStats.linesRemoved) || 0),
      changeOps: Math.max(0, Number(agentRunStats.changeOps) || 0),
      changedFiles: Array.isArray(agentRunStats.changedFiles) ? agentRunStats.changedFiles.slice(0, 5) : [],
    };
  }, [agentRunStats]);

  return (
    <div
      className="flex-1 min-h-0 flex flex-col bg-dark-950 font-sans"
      style={{
        background: C.mainBg,
        color: C.text,
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: "13px",
      }}
    >
      {/* BETA NOTICE BANNER */}
      <div className="shrink-0 bg-kp-indigo-500/10 border-b border-kp-indigo-400/20 px-4 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-kp-indigo-300 bg-kp-indigo-500/20 px-1.5 py-0.5 rounded-sm">Beta Development</span>
          <span className="text-[11px] text-kp-indigo-200/70 font-medium">Experimental features under active development. Some capabilities may be limited or unstable.</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-kp-indigo-300/40 font-mono tracking-tight">VERSION 3.0.0-BETA.1</span>
        </div>
      </div>

      <style>{`
        .agent-code-editor-pre,
        .agent-code-editor-textarea {
          margin: 0;
          min-height: 100%;
          white-space: pre;
          word-break: normal;
          overflow-wrap: normal;
        }

        .agent-code-editor-pre {
          background: transparent !important;
          color: #d4d4d4 !important;
          pointer-events: none;
        }

        .agent-code-editor-textarea {
          outline: none !important;
          color: transparent !important;
          -webkit-text-fill-color: transparent !important;
          caret-color: #e2e8f0;
        }

        .agent-markdown-content p {
          margin: 0 0 0.4rem 0;
          line-height: 1.55;
        }

        .agent-markdown-content p:last-child {
          margin-bottom: 0;
        }

        .agent-markdown-content ul,
        .agent-markdown-content ol {
          margin: 0.35rem 0 0.45rem 1rem;
          padding: 0;
        }

        .agent-markdown-content h1,
        .agent-markdown-content h2,
        .agent-markdown-content h3,
        .agent-markdown-content h4 {
          margin-top: 0.35rem;
          margin-bottom: 0.35rem;
        }

        .agent-markdown-content pre {
          margin: 0.5rem 0;
        }

        .agent-code-editor-pre .hljs-comment,
        .agent-code-editor-pre .hljs-quote {
          color: #6a9955 !important;
        }

        .agent-code-editor-pre .hljs-keyword,
        .agent-code-editor-pre .hljs-selector-tag,
        .agent-code-editor-pre .hljs-literal,
        .agent-code-editor-pre .hljs-name {
          color: #c586c0 !important;
        }

        .agent-code-editor-pre .hljs-string,
        .agent-code-editor-pre .hljs-attr,
        .agent-code-editor-pre .hljs-regexp,
        .agent-code-editor-pre .hljs-symbol,
        .agent-code-editor-pre .hljs-bullet {
          color: #ce9178 !important;
        }

        .agent-code-editor-pre .hljs-number,
        .agent-code-editor-pre .hljs-literal {
          color: #b5cea8 !important;
        }

        .agent-code-editor-pre .hljs-title,
        .agent-code-editor-pre .hljs-title.class_,
        .agent-code-editor-pre .hljs-title.function_,
        .agent-code-editor-pre .hljs-built_in {
          color: #dcdcaa !important;
        }

        .agent-code-editor-pre .hljs-operator,
        .agent-code-editor-pre .hljs-punctuation,
        .agent-code-editor-pre .hljs-meta {
          color: #d4d4d4 !important;
        }

        .agent-code-editor-pre .hljs-variable,
        .agent-code-editor-pre .hljs-property,
        .agent-code-editor-pre .hljs-params,
        .agent-code-editor-pre .hljs-type {
          color: #9cdcfe !important;
        }
      `}</style>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <aside
          className="w-11 border-r flex flex-col items-center py-1.5"
          style={{ background: C.activityBg, borderColor: C.border, boxShadow: "inset -1px 0 0 rgba(255,255,255,0.04), 1px 0 0 rgba(0,0,0,0.3)" }}
        >
          {ACTIVITY_ITEMS.map((item) => {
            const active = sideOpen && activityTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={item.title}
                onClick={() => handleActivitySelect(item.id)}
                className="w-9 h-9 border-l-2 flex items-center justify-center transition-colors"
                style={{
                  borderLeftColor: active ? C.accent : "transparent",
                  color: active ? C.textBright : C.textDim,
                  background: active ? C.accentSoft : "transparent",
                  borderTop: "none",
                  borderRight: "none",
                  borderBottom: "none",
                  cursor: "pointer",
                }}
              >
                {item.icon}
              </button>
            );
          })}

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => onOpenSettings?.()}
            className="w-9 h-9 flex items-center justify-center"
            title="Settings"
            style={{
              color: C.textDim,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            {SETTINGS_ICON}
          </button>
        </aside>

        {sideOpen && (
          <aside
            className="w-[280px] border-r flex flex-col min-h-0 bg-dark-900/90"
            style={{ background: C.panelBg, borderColor: C.border }}
          >
            <div
              className="h-8 px-2.5 border-b uppercase tracking-wider text-[11px] flex items-center"
              style={{ borderColor: C.border, color: C.textDim }}
            >
              {activityTab === "explorer" ? "🧭 Explorer" : activityTab === "search" ? "🔎 Search" : "🌿 Source Control"}
            </div>

            {activityTab === "explorer" ? (
              <div className="flex-1 overflow-y-auto py-1 px-1">
                <div className="px-2 py-2 border-b border-white/[0.06] mb-1 space-y-1">
                  <div className="text-[11px] uppercase tracking-wider" style={{ color: C.textDim }}>
                    📂 Workspace Folder
                  </div>

                  <div
                    className="h-7 px-2 rounded-md border border-white/[0.08] bg-dark-900/60 text-[11px] flex items-center truncate"
                    title={agentWorkspacePath || "No workspace selected"}
                    style={{ color: agentWorkspacePath ? C.text : C.textDim }}
                  >
                    {agentWorkspacePath || "No workspace selected"}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onPickWorkspace?.()}
                      className="h-7 px-2.5 rounded-md text-[11px] border border-white/[0.08] bg-dark-800/55 text-dark-200 hover:bg-dark-700/60 transition-colors cursor-pointer"
                    >
                      📂 Open Folder
                    </button>

                    {agentWorkspacePath && (
                      <button
                        type="button"
                        onClick={() => refreshWorkspaceTree()}
                        className="h-7 px-2.5 rounded-md text-[11px] border border-white/[0.08] bg-dark-800/40 text-dark-200 hover:bg-dark-700/55 transition-colors cursor-pointer"
                        title="Refresh workspace tree"
                      >
                        ↻ Refresh
                      </button>
                    )}

                    {agentWorkspacePath && (
                      <button
                        type="button"
                        onClick={() => onClearWorkspace?.()}
                        className="h-7 px-2.5 rounded-md text-[11px] border border-white/[0.08] bg-dark-800/40 text-dark-300 hover:bg-dark-700/55 transition-colors cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className="h-6 px-2 text-[11px] font-semibold uppercase tracking-wider flex items-center"
                  style={{ color: C.textDim }}
                >
                  Workspace
                </div>

                {workspaceRoot ? (
                  <WorkspaceNode
                    node={workspaceRoot}
                    depth={0}
                    expandedDirs={expandedDirs}
                    loadingDirs={loadingDirs}
                    treeByPath={treeByPath}
                    onToggleDir={handleToggleDir}
                    onOpenFile={handleOpenFile}
                    activeFilePath={activeFilePath}
                  />
                ) : (
                  <div className="px-2 py-2 text-[11px]" style={{ color: C.textDim }}>
                    Open a folder to load workspace files.
                  </div>
                )}
              </div>
            ) : activityTab === "search" ? (
              <div className="p-2 text-[11px]" style={{ color: C.textDim }}>
                Search UI placeholder
              </div>
            ) : (
              <div className="p-2 text-[11px]" style={{ color: C.textDim }}>
                Source control UI placeholder
              </div>
            )}
          </aside>
        )}

        <section className="flex-1 min-h-0 flex flex-col" style={{ background: C.editorBg }}>
          <section className="flex-1 min-h-0 flex flex-col" style={{ background: C.editorBg }}>
            <div className="h-9 border-b flex items-stretch bg-dark-900/70" style={{ borderColor: C.border, background: C.tabBg }}>
              <div className="flex-1 min-w-0 flex items-stretch overflow-x-auto">
                {openFileTabs.length === 0 ? (
                  <div className="h-full px-3 text-[12px] flex items-center" style={{ color: C.textDim }}>
                    🗂️ Open a file from Explorer
                  </div>
                ) : (
                  openFileTabs.map((tab) => {
                    const active = tab.path === activeFilePath;
                    return (
                      <div
                        key={tab.path}
                        className="h-full pl-3 pr-1 text-[12px] border-r truncate max-w-[260px] flex items-center gap-2"
                        style={{
                          borderColor: C.border,
                          color: active ? C.textBright : C.textDim,
                          background: active ? C.editorBg : C.tabBg,
                          borderTop: active ? `2px solid ${C.accent}` : "2px solid transparent",
                        }}
                        title={tab.path}
                      >
                        <LanguageFileIcon fileName={tab.name || pathBaseName(tab.path)} />
                        <button
                          type="button"
                          onClick={() => handleSelectFileTab(tab)}
                          className="truncate text-left cursor-pointer"
                          style={{ color: "inherit", background: "transparent", border: "none" }}
                        >
                          {tab.name || pathBaseName(tab.path)}
                          {active && editorDirty ? " •" : ""}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCloseFileTab(tab.path)}
                          className="w-5 h-5 rounded text-[11px] cursor-pointer"
                          style={{ color: C.textDim, background: "transparent", border: "none" }}
                          title="Close"
                        >
                          x
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="h-full px-2 flex items-center gap-2 border-l" style={{ borderColor: C.border }}>
                {!!saveMessage && (
                  <span className="text-[11px]" style={{ color: saveMessage === "Saved" ? C.green : "#fca5a5" }}>
                    {saveMessage}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSaveActiveFile}
                  disabled={!activeFilePath || !editorDirty || savingFile}
                  className="h-6 px-2.5 text-[11px] rounded-md border"
                  style={{
                    borderColor: C.border,
                    color: !activeFilePath || !editorDirty ? C.textDim : C.textBright,
                    background: !activeFilePath || !editorDirty ? "transparent" : "rgba(15,23,42,0.8)",
                    cursor: !activeFilePath || !editorDirty ? "not-allowed" : "pointer",
                    opacity: savingFile ? 0.7 : 1,
                  }}
                  title={activeFilePath ? "Save file (Ctrl+S)" : "Open a file to save"}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {savingFile && <LoadingSpinner size={10} accent={C.textBright} />}
                    {savingFile ? "Saving..." : "Save"}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 font-mono text-[13px] leading-[1.45]">
              {activeFilePath ? (
                loadingFile ? (
                  <div className="h-full w-full flex items-center justify-center" style={{ background: C.editorBg, color: C.textDim }}>
                    <span className="inline-flex items-center gap-2 text-[12px]">
                      <LoadingSpinner size={12} accent={C.accent} />
                      Loading file...
                    </span>
                  </div>
                ) : (
                  <div className="h-full min-h-0 overflow-auto" style={{ background: C.editorBg }}>
                    <CodeEditor
                      value={editorDraft}
                      onValueChange={(nextValue) => handleEditorChange(String(nextValue ?? ""))}
                      highlight={highlightEditorCode}
                      padding={12}
                      className="h-full min-h-0"
                      textareaClassName="agent-code-editor-textarea"
                      preClassName={`agent-code-editor-pre hljs language-${activeHighlightLanguage}`}
                      style={{
                        minHeight: "100%",
                        fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
                        fontSize: 13,
                        lineHeight: "22px",
                        color: C.text,
                        background: "transparent",
                      }}
                    />
                  </div>
                )
              ) : (
                <div className="h-full min-h-0 overflow-y-auto px-3 py-2" style={{ color: C.text }}>
                  {editorLines.map((line, index) => (
                    <div key={`preview-${index}`} className="h-6 whitespace-pre">
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {terminalOpen && (
            <div
              role="separator"
              onMouseDown={(event) => {
                event.preventDefault();
                terminalResizeRef.current.active = true;
                terminalResizeRef.current.startY = event.clientY;
                terminalResizeRef.current.startHeight = terminalHeight;
              }}
              className="h-1 cursor-row-resize shrink-0"
              style={{ background: "#1d2337" }}
              title="Resize terminal"
            />
          )}

          {terminalOpen && (
            <section
              className="border-t flex flex-col min-h-0 shrink-0 bg-dark-900/40"
              style={{ borderColor: C.border, background: C.editorBg, height: `${terminalHeight}px` }}
            >
              <div className="h-9 border-b px-2.5 flex items-center" style={{ borderColor: C.border }}>
                <div className="h-full px-2 text-[11px] font-semibold flex items-center" style={{ color: C.textBright, borderBottom: `2px solid ${C.accent}` }}>
                  💻 TERMINAL
                </div>

                {isAgentBusy && (
                  <span className="ml-2 text-[11px] inline-flex items-center gap-1.5" style={{ color: C.textDim }}>
                    <LoadingSpinner size={10} accent={C.accent} />
                    Running...
                  </span>
                )}

                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setTerminalOpen(false)}
                  className="h-6 px-2.5 text-[11px] rounded-md"
                  style={{ color: C.textDim, background: "transparent", border: "none", cursor: "pointer" }}
                >
                  Close
                </button>
              </div>

              <div
                className="flex-1 overflow-y-auto px-3 py-1.5 font-mono text-[12px] leading-[1.45] shadow-inner-shadow"
                style={{ background: C.terminalBg, color: C.text }}
              >
                {terminalLinesToRender.map((line, index) => (
                  <div key={`term-${index}`} style={{ color: line.startsWith("$") ? C.green : C.text }}>
                    {line}
                  </div>
                ))}
              </div>
            </section>
          )}
        </section>

        <aside
          className="w-[420px] border-l flex flex-col min-h-0"
          style={{ background: C.editorBg, borderColor: C.border }}
        >
          {/* ── Slim header: status + model selector ── */}
          <div
            className="h-9 px-3 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: C.border }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <AgentAiIcon />
              <span className="text-[12px] font-semibold truncate" style={{ color: C.textBright }}>
                Agent
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-md border shrink-0"
                style={{
                  borderColor: "rgba(139,92,246,0.35)",
                  background: "rgba(139,92,246,0.15)",
                  color: C.accentText,
                }}
              >
                <span className="inline-flex items-center gap-1">
                  {isAgentBusy && <LoadingSpinner size={8} accent={C.accentText} />}
                  {statusLabel}
                </span>
              </span>
            </div>
            <select
              value={selectedAgentModel ? modelSelectionId(selectedAgentModel) : String(selectedModel || "")}
              onChange={(event) => {
                const nextModel = String(event.target.value || "");
                if (!nextModel) return;
                onSelectModel?.(nextModel);
              }}
              className="h-6 max-w-[160px] rounded border bg-transparent px-1.5 text-[10px] outline-none truncate shrink-0"
              style={{ borderColor: C.border, color: C.textDim }}
              title={selectedAgentModel ? `${modelDisplayName(selectedAgentModel)} - ${modelProviderLabel(selectedAgentModel?._provider || "")}` : "Select model"}
            >
              {!agentModels.length && <option value="">No models</option>}
              {!!selectedModel && !selectedAgentModel && (
                <option value={String(selectedModel)}>Current model</option>
              )}
              {(agentModels || []).map((model) => {
                const id = modelSelectionId(model);
                const provider = modelProviderLabel(model?._provider || "");
                const freeTag = isFreePricedModel(model) ? "Free" : "Paid";
                return (
                  <option key={id || model.id} value={id || model.id}>
                    {modelDisplayName(model)} - {provider} - {freeTag}
                  </option>
                );
              })}
            </select>
          </div>

          {/* ── Collapsible config toolbar ── */}
          <AgentConfigToolbar
            executionMode={executionMode}
            setExecutionMode={setExecutionMode}
            requireApproval={requireApproval}
            setRequireApproval={setRequireApproval}
            normalizedPlan={normalizedPlan}
            summarizedRunStats={summarizedRunStats}
          />

          {/* ── Chat-style scrollable messages area ── */}
          <div className="flex-1 min-h-0 overflow-y-auto" ref={agentMessagesEndRef}>
            <div className="px-3 py-3 space-y-3">

              {/* Status indicators */}
              {isAgentBusy && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]"
                  style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", color: C.accentText }}
                >
                  <LoadingSpinner size={11} accent={C.accentText} />
                  Agent is working...
                  {!!agentCurrentStep && <span className="truncate" style={{ color: C.textDim }}> — {agentCurrentStep}</span>}
                </motion.div>
              )}

              {!!agentError && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="px-3 py-2 rounded-lg text-[11px]"
                  style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5" }}
                >
                  {agentError}
                </motion.div>
              )}

              {/* Chat-style messages */}
              {recentConversation.length === 0 && !isAgentBusy && !agentError && !agentPendingCommand && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="relative">
                    <div className="absolute inset-0 w-10 h-10 mx-auto rounded-sm blur-xl" style={{ background: "rgba(0,255,65,0.15)" }} />
                    <div
                      className="w-12 h-12 flex items-center justify-center relative rounded-sm"
                      style={{ border: "1px solid rgba(0,255,65,0.3)" }}
                    >
                      <span className="font-mono text-xl font-bold text-[#00ff41] tracking-tighter">
                        &gt;_
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px]" style={{ color: C.textDim }}>Ask the agent to plan or execute a task</span>
                  <div className="flex items-center gap-1">
                    <span className="w-1 h-1 rounded-none" style={{ background: "rgba(0,255,65,0.3)" }} />
                    <span className="w-1.5 h-1.5 rounded-none" style={{ background: "rgba(0,255,65,0.5)" }} />
                    <span className="w-1 h-1 rounded-none" style={{ background: "rgba(0,255,65,0.3)" }} />
                  </div>
                </div>
              )}

              {recentConversation.map((entry, idx) => {
                const isUser = entry.role === "user";
                const isLast = idx === recentConversation.length - 1;
                const isStreaming = isAgentBusy && !isUser && isLast;
                const sanitizedText = isUser ? entry.displayText : sanitizeAssistantMessageText(entry.displayText);

                return (
                  <motion.div
                    key={entry.id}
                    variants={agentMsgVariants}
                    initial="hidden"
                    animate="visible"
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {isUser ? (
                      /* ── User bubble (right-aligned, purple accent) ── */
                      <div className="max-w-[88%]">
                        <div
                          className="px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words"
                          style={{
                            background: "rgba(139,92,246,0.18)",
                            color: "#e9d5ff",
                            borderRadius: "14px 14px 4px 14px",
                            border: "1px solid rgba(139,92,246,0.28)",
                          }}
                        >
                          {sanitizedText}
                        </div>
                      </div>
                    ) : (
                      /* ── Agent bubble (left-aligned, avatar + markdown) ── */
                      <div className="flex items-start gap-2 max-w-[94%]">
                        <AgentAiIcon />
                        <div className="flex flex-col items-start gap-0.5 min-w-0">
                          <div
                            className="text-[12px] leading-relaxed break-words markdown-body"
                            style={{
                              background: "rgba(255,255,255,0.03)",
                              color: C.text,
                              borderRadius: "4px 14px 14px 14px",
                              border: "1px solid rgba(255,255,255,0.08)",
                              padding: "8px 12px",
                            }}
                          >
                            {sanitizedText ? (
                              <AgentMessageContent content={sanitizedText} />
                            ) : (
                              <span className="inline-flex gap-0.5" style={{ color: C.accent }}>
                                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, ease: agentEase }}>●</motion.span>
                                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, ease: agentEase, delay: 0.2 }}>●</motion.span>
                                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, ease: agentEase, delay: 0.4 }}>●</motion.span>
                              </span>
                            )}
                            {isStreaming && sanitizedText && (
                              <motion.span
                                animate={{ opacity: [1, 0] }}
                                transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
                                className="inline-block w-0.5 h-3.5 ml-0.5 align-text-bottom"
                                style={{ background: C.accent }}
                              />
                            )}
                          </div>
                          {/* Action buttons */}
                          {!isStreaming && sanitizedText && (
                            <AgentCopyButton text={sanitizedText} />
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}

              {/* Approval request card */}
              {!!agentPendingCommand && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl p-3 space-y-2"
                  style={{ background: "rgba(15,23,42,0.7)", border: `1px solid ${C.border}` }}
                >
                  <div className="text-[11px] uppercase tracking-wider font-medium" style={{ color: C.accentText }}>
                    Approval Required
                  </div>
                  <input
                    value={String(agentCommandDraft || agentPendingCommand || "")}
                    onChange={(event) => onSetAgentCommandDraft?.(event.target.value)}
                    className="w-full h-8 px-2.5 rounded-lg border bg-dark-900/70 text-[12px] outline-none"
                    style={{ borderColor: C.border, color: C.text }}
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onAllowCommand?.()}
                      className="h-7 px-3 text-[11px] rounded-lg border transition-colors"
                      style={{ borderColor: "rgba(52,211,153,0.4)", color: "#6ee7b7", background: "rgba(16,185,129,0.14)", cursor: "pointer" }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => onDenyCommand?.()}
                      className="h-7 px-3 text-[11px] rounded-lg border transition-colors"
                      style={{ borderColor: "rgba(239,68,68,0.35)", color: "#fca5a5", background: "rgba(239,68,68,0.1)", cursor: "pointer" }}
                    >
                      Deny
                    </button>
                    <button
                      type="button"
                      onClick={() => onQueueCommand?.(String(agentCommandDraft || agentPendingCommand || ""))}
                      className="h-7 px-3 text-[11px] rounded-lg border transition-colors"
                      style={{ borderColor: C.border, color: C.textDim, background: "transparent", cursor: "pointer" }}
                    >
                      Queue
                    </button>
                  </div>
                </motion.div>
              )}

              <div ref={agentChatBottomRef} />
            </div>
          </div>

          {/* ── Chat-style input bar ── */}
          <div className="px-3 py-2.5 shrink-0 border-t" style={{ borderColor: C.border }}>
            <div
              className="flex items-end gap-2 rounded-sm border transition-colors"
              style={{
                borderColor: agentInputFocused ? "rgba(0,255,65,0.5)" : "rgba(255,255,255,0.12)",
                background: "rgba(10,10,10,0.8)",
                boxShadow: agentInputFocused ? "0 0 12px rgba(0,255,65,0.12)" : "none",
                padding: "6px 6px 6px 14px",
              }}
            >
              <textarea
                ref={agentInputRef}
                value={agentInput}
                onChange={(event) => {
                  setAgentInput(event.target.value);
                  const el = event.target;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 120) + "px";
                }}
                onFocus={() => setAgentInputFocused(true)}
                onBlur={() => setAgentInputFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    pushLocalTask();
                  }
                }}
                rows={1}
                placeholder="Ask the agent..."
                aria-label="Agent message"
                className="flex-1 resize-none bg-transparent border-none outline-none text-[12px] leading-5 py-1"
                style={{ color: C.text, maxHeight: "120px" }}
              />
              {isAgentBusy ? (
                <button
                  type="button"
                  onClick={() => onStopAgent?.()}
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors"
                  style={{ background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", cursor: "pointer" }}
                  title="Stop"
                >
                  <svg className="w-3 h-3" style={{ color: "#fca5a5" }} fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pushLocalTask}
                  disabled={!canSendAgentTask}
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all"
                  style={{
                    background: canSendAgentTask ? C.accent : "rgba(139,92,246,0.15)",
                    border: "none",
                    cursor: canSendAgentTask ? "pointer" : "not-allowed",
                    opacity: canSendAgentTask ? 1 : 0.5,
                  }}
                  title="Send"
                >
                  <svg className="w-3.5 h-3.5" style={{ color: "#fff" }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              )}
            </div>
            <div className="mt-1 px-1 text-[9px]" style={{ color: C.textDim }}>
              Enter to send · Shift+Enter for newline
            </div>
          </div>
        </aside>
      </div>

      <div
        className="h-6 px-2.5 flex items-center justify-between text-[11px] shadow-elevation-1"
        style={{ background: "#6d28d9", color: "#ffffff" }}
      >
        <div className="flex items-center gap-3">
          <span>🤖 Agent</span>
          <span>{executionMode === "direct" ? "Direct" : "Plan First"}</span>
          <span>{requireApproval ? "Approval On" : "Approval Off"}</span>
          <button
            type="button"
            onClick={() => setTerminalOpen((prev) => !prev)}
            className="h-5 px-2 rounded border border-white/25 text-[10px]"
            style={{ color: "#ffffff", background: "rgba(255,255,255,0.12)", cursor: "pointer" }}
          >
            {terminalOpen ? "Hide Terminal" : "Show Terminal"}
          </button>
        </div>
        <div>KritakaPrajna</div>
      </div>
    </div>
  );
}
