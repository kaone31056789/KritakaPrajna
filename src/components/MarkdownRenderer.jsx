import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { safeCopyText } from "../utils/clipboard";

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
    .replace(/\$\\rightarrow\$/g, "→")
    .replace(/\$\\leftarrow\$/g, "←")
    .replace(/\$\\Rightarrow\$/g, "⇒")
    .replace(/\$\\Leftarrow\$/g, "⇐")
    .replace(/\$\\leftrightarrow\$/g, "↔")
    .replace(/\$\\Leftrightarrow\$/g, "⟺")
    .replace(/\$\\uparrow\$/g, "↑")
    .replace(/\$\\downarrow\$/g, "↓")
    .replace(/\$\\to\$/g, "→")
    .replace(/\$\\gets\$/g, "←");
}

/**
 * Renders markdown content with syntax-highlighted code blocks.
 * Designed for AI assistant messages.
 */
export default function MarkdownRenderer({ content }) {
  if (!content || typeof content !== "string") return null;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          if (!inline && match) {
            return <CodeBlock language={match[1]}>{children}</CodeBlock>;
          }
          if (!inline && !match && String(children).includes("\n")) {
            return <CodeBlock language="text">{children}</CodeBlock>;
          }
          // Inline code
          return (
            <code
              className="bg-white/[0.08] text-saffron-300 rounded px-1.5 py-0.5 text-[13px] font-mono"
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
        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-dark-100">{children}</li>,
        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-saffron-500/40 pl-3 my-2 text-dark-300 italic">
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
          <td className="border border-white/[0.08] px-3 py-1.5 text-dark-300 text-xs">{children}</td>
        ),
        // Link
        a: ({ href, children }) => (
          <a
            href={/^(https?:|mailto:)/i.test(href || "") ? href : "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-saffron-400 hover:text-saffron-300 underline underline-offset-2 transition-colors"
          >
            {children}
          </a>
        ),
        // Horizontal rule
        hr: () => <hr className="border-white/[0.08] my-3" />,
        // Strong / Em
        strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
        em: ({ children }) => <em className="text-dark-200">{children}</em>,
      }}
    >
      {preprocessLatex(content)}
    </ReactMarkdown>
  );
}
