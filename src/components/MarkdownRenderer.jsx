import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { safeCopyText } from "../utils/clipboard";
import TerminalPanel, { isShellLanguage } from "./TerminalPanel";

/** VSCode Dark+ theme with app background */
const codeTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
    background: "#1e1e1e",
    margin: 0,
    padding: "1rem",
    fontSize: "13px",
    lineHeight: "1.6",
  },
  'code[class*="language-"]': {
    ...vscDarkPlus['code[class*="language-"]'],
    background: "none",
    fontSize: "13px",
    lineHeight: "1.6",
  },
};

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await safeCopyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-[11px] text-dark-400 hover:text-dark-200 transition-colors cursor-pointer px-2 py-1 rounded hover:bg-white/[0.06]"
      aria-label="Copy code"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-emerald-400">Copied!</span>
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function CodeBlock({ language, children }) {
  const code = String(children).replace(/\n$/, "");
  const lang = language || "text";
  const displayLang = lang.charAt(0).toUpperCase() + lang.slice(1);

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/[0.06] bg-[#1e1e1e]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-white/[0.06]">
        <span className="text-[11px] text-dark-400 font-mono font-medium tracking-wide">
          {displayLang}
        </span>
        <CopyButton text={code} />
      </div>
      {/* Code body */}
      <SyntaxHighlighter
        style={codeTheme}
        language={lang}
        PreTag="div"
        showLineNumbers={code.split("\n").length > 3}
        lineNumberStyle={{ color: "#858585", fontSize: "11px", paddingRight: "1em", userSelect: "none" }}
        wrapLines
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

/** Replace common LaTeX math symbols with readable equivalents */
function preprocessLatex(text) {
  return text
    .replace(/\$\\rightarrow\$/g, "â†’")
    .replace(/\$\\leftarrow\$/g, "â†")
    .replace(/\$\\Rightarrow\$/g, "=>")
    .replace(/\$\\Leftarrow\$/g, "<=")
    .replace(/\$\\leftrightarrow\$/g, "â†”")
    .replace(/\$\\Leftrightarrow\$/g, "<=>")
    .replace(/\$\\uparrow\$/g, "â†‘")
    .replace(/\$\\downarrow\$/g, "â†“")
    .replace(/\$\\to\$/g, "â†’")
    .replace(/\$\\gets\$/g, "â†");
}

function extractNodeText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join(" ");
  if (React.isValidElement(node)) return extractNodeText(node.props?.children);
  return "";
}

const SOURCE_HEADING_SET = new Set([
  "source",
  "sources",
  "reference",
  "references",
  "citation",
  "citations",
]);

function normalizeHeadingLine(line) {
  if (typeof line !== "string") return "";
  return line
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.+)\*\*:?\s*$/, "$1")
    .replace(/^__(.+)__:?\s*$/, "$1")
    .replace(/[:\s]+$/, "")
    .toLowerCase();
}

function normalizeExternalUrl(value) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim().replace(/[<>()\[\]{}]/g, "");
  if (!trimmed) return "";

  if (/^mailto:/i.test(trimmed)) return trimmed;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/[),.;:!?]+$/g, "");
  }

  const domainMatch = trimmed.match(/([a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[\w\-./?%&=+#~:]*)?)/i);
  if (!domainMatch) return "";

  const hostPath = domainMatch[1].replace(/[),.;:!?]+$/g, "");
  return hostPath ? `https://${hostPath}` : "";
}

async function openExternalUrl(url, event) {
  const safeHref = normalizeExternalUrl(url);
  if (!safeHref) {
    if (event) event.preventDefault();
    return;
  }

  if (window.electronAPI?.openExternal) {
    if (event) event.preventDefault();
    try {
      await window.electronAPI.openExternal(safeHref);
      return;
    } catch {
      // Fall through to browser behavior if bridge call fails.
    }
  }

  window.open(safeHref, "_blank", "noopener,noreferrer");
}

function parseSourceLine(line, fallbackIndex) {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();

  let match = trimmed.match(/^(?:[-*]\s*)?\[(\d+)\]\s+(.+)$/);
  if (!match) {
    match = trimmed.match(/^(?:[-*]\s*)?(\d+)[\.)]\s+(.+)$/);
  }
  if (!match) return null;

  const parsedIndex = Number(match[1]);
  const details = String(match[2] || "").trim();

  let label = details;
  let url = "";

  const markdownLinkMatch = details.match(/\[([^\]]+)\]\(([^)\s]+)\)/i);
  if (markdownLinkMatch) {
    label = markdownLinkMatch[1].trim();
    url = normalizeExternalUrl(markdownLinkMatch[2]);
  } else {
    url = normalizeExternalUrl(details);
    if (url) {
      const stripped = details.replace(url, "").replace(/[\s\--—:|]+$/, "").trim();
      if (stripped) {
        label = stripped;
      }
    }
  }

  return {
    index: Number.isFinite(parsedIndex) && parsedIndex > 0 ? parsedIndex : fallbackIndex,
    label: label || details,
    url,
    rawText: trimmed,
  };
}

function splitContentAndSources(rawContent) {
  const original = String(rawContent || "");
  const lines = original.split(/\r?\n/);

  let headingIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const normalized = normalizeHeadingLine(lines[i]);
    if (SOURCE_HEADING_SET.has(normalized)) {
      headingIndex = i;
      break;
    }
  }

  if (headingIndex === -1) {
    return { markdown: original, sources: [] };
  }

  const parsedSources = [];
  let scanIndex = headingIndex + 1;

  while (scanIndex < lines.length) {
    const currentLine = lines[scanIndex];
    const trimmed = currentLine.trim();

    if (!trimmed) {
      // Keep scanning through blank separators so all source rows are captured.
      scanIndex += 1;
      continue;
    }

    if (/^#{1,6}\s+\S+/.test(trimmed) && parsedSources.length > 0) {
      break;
    }

    const source = parseSourceLine(trimmed, parsedSources.length + 1);
    if (!source) {
      if (parsedSources.length === 0) {
        return { markdown: original, sources: [] };
      }
      break;
    }

    parsedSources.push(source);
    scanIndex += 1;
  }

  if (parsedSources.length === 0) {
    return { markdown: original, sources: [] };
  }

  const markdown = [...lines.slice(0, headingIndex), ...lines.slice(scanIndex)]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { markdown, sources: parsedSources };
}

function SourceDeepDivePanel({ sources }) {
  if (!Array.isArray(sources) || sources.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-sky-400/25 bg-gradient-to-br from-sky-500/[0.12] via-cyan-500/[0.05] to-transparent p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-sky-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125V5.25m-9 12h8.25m-8.25 3h12a2.25 2.25 0 002.25-2.25V8.25a2.25 2.25 0 00-.659-1.591l-2.841-2.841A2.25 2.25 0 0013.159 3H6.75A2.25 2.25 0 004.5 5.25v13.5A2.25 2.25 0 006.75 21z" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-100">Sources</span>
        </div>
        <span className="text-[9px] text-sky-200/70">
          {sources.length} source{sources.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="mt-1.5 space-y-1">
        {sources.map((source) => {
          const sourceHref =
            normalizeExternalUrl(source.url || source.label || source.rawText) ||
            (source.label ? `https://www.bing.com/search?q=${encodeURIComponent(source.label)}` : "");
          return (
            <div
              key={`${source.index}-${source.rawText}`}
              className="w-full flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-sky-500/[0.08] px-2 py-1.5"
            >
              <span className="w-4 h-4 rounded-full bg-sky-500/20 text-sky-100 text-[9px] font-semibold flex items-center justify-center shrink-0">
                {source.index}
              </span>

              <a
                href={sourceHref || "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => openExternalUrl(sourceHref, event)}
                className={`min-w-0 flex-1 text-left rounded-md px-1 py-0 transition-colors leading-tight ${
                  sourceHref
                    ? "hover:bg-sky-500/[0.16]"
                    : "opacity-70 pointer-events-none"
                }`}
                title={sourceHref ? "Open source website" : "Source URL unavailable"}
              >
                <p className="text-[11px] text-sky-50/95 font-medium truncate">{source.label || source.rawText}</p>
                {sourceHref && <p className="text-[9px] text-sky-200/65 truncate">{sourceHref}</p>}
              </a>

            </div>
          );
        })}
      </div>

      <p className="mt-1.5 text-[9px] text-sky-200/70">
        Click source name to open website.
      </p>
    </div>
  );
}

/**
 * Renders markdown content with syntax-highlighted code blocks.
 * Designed for AI assistant messages.
 */
export default function MarkdownRenderer({ content, onPointClick, sourceUrlMap = null }) {
  if (!content || typeof content !== "string") return null;

  const processed = preprocessLatex(content);
  const { markdown, sources } = splitContentAndSources(processed);
  const resolvedSources = sources.map((source) => {
    if (source?.url) return source;
    const mappedUrl = sourceUrlMap?.[String(source?.index)];
    if (!mappedUrl) return source;
    return { ...source, url: mappedUrl };
  });

  return (
    <>
      {markdown && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, inline, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              const lang = match ? match[1] : null;
              const code = String(children).replace(/\n$/, "");

              if (!inline && lang && isShellLanguage(lang)) {
                return <TerminalPanel command={code} language={lang} />;
              }
              if (!inline && lang) {
                return <CodeBlock language={lang}>{children}</CodeBlock>;
              }
              if (!inline && !lang && code.includes("\n")) {
                return <CodeBlock language="text">{children}</CodeBlock>;
              }
              // Inline code
              return (
                <code
                  className="bg-white/[0.08] text-[#00ff41] rounded px-1.5 py-0.5 text-[13px] font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            // Headings
            h1: ({ children }) => <h1 className="text-lg font-bold text-white mt-4 mb-2">{children}</h1>,
            h2: ({ children }) => <h2 className="text-base font-bold text-white mt-3 mb-1.5">{children}</h2>,
            h3: ({ children }) => <h3 className="text-sm font-bold text-white mt-2.5 mb-1">{children}</h3>,
            // Paragraph
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            // Lists
            ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
            ol: ({ children }) => <ol className="kp-ol">{children}</ol>,
            li: ({ children }) => {
              const pointText = extractNodeText(children).replace(/\s+/g, " ").trim();
              const clickable = typeof onPointClick === "function" && pointText.length >= 8;

              const triggerPoint = (event) => {
                if (!clickable) return;
                const target = event?.target;
                if (target instanceof HTMLElement && target.closest("a, button, code, pre")) return;
                onPointClick(pointText);
              };

              return (
                <li
                  className={`kp-li text-dark-100 ${clickable ? "kp-point-clickable" : ""}`}
                  onClick={clickable ? triggerPoint : undefined}
                  onKeyDown={clickable ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      triggerPoint(event);
                    }
                  } : undefined}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  title={clickable ? "Click for deep analysis" : undefined}
                >
                  {children}
                </li>
              );
            },
            // Blockquote
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-[#00ff41]/40 pl-3 my-2 text-[#b0b0b0] italic">
                {children}
              </blockquote>
            ),
            // Table
            table: ({ children }) => (
              <div className="overflow-x-auto my-2">
                <table className="w-full text-sm border-collapse">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
            th: ({ children }) => (
              <th className="border border-white/[0.08] px-3 py-1.5 text-left text-dark-200 font-medium text-xs">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-white/[0.08] px-3 py-1.5 text-[#b0b0b0] text-xs">{children}</td>
            ),
            // Link
            a: ({ href, children }) => {
              const safeHref = normalizeExternalUrl(href || "");

              return (
                <a
                  href={safeHref || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => openExternalUrl(safeHref, event)}
                  className="text-[#00ff41] hover:text-[#00ff41] underline underline-offset-2 transition-colors"
                >
                  {children}
                </a>
              );
            },
            // Horizontal rule
            hr: () => <hr className="border-white/[0.08] my-3" />,
            // Strong / Em
            strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
            em: ({ children }) => <em className="text-dark-200">{children}</em>,
          }}
        >
          {markdown}
        </ReactMarkdown>
      )}

      <SourceDeepDivePanel sources={resolvedSources} />
    </>
  );
}

