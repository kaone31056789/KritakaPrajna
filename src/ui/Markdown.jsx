import React, { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import Icon from "./icons";
import { toast } from "./Toaster";

const LANGS = { jsx, javascript, typescript, tsx, python, bash, powershell, json, css, markup, java, c, cpp, csharp, go, rust, sql, yaml, diff };
Object.entries(LANGS).forEach(([name, lang]) => SyntaxHighlighter.registerLanguage(name, lang));
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("py", python);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("html", markup);
SyntaxHighlighter.registerLanguage("xml", markup);
SyntaxHighlighter.registerLanguage("cs", csharp);
SyntaxHighlighter.registerLanguage("yml", yaml);

/* Theme-aware Prism style built on CSS variables — flips with the theme for free. */
const v = (name) => `var(--syn-${name})`;
const synStyle = {
  'code[class*="language-"]': { color: v("text"), background: "none", fontFamily: "var(--font-mono)", fontSize: "12.5px", lineHeight: 1.65 },
  'pre[class*="language-"]': { color: v("text"), background: "none", margin: 0 },
  comment: { color: v("comment"), fontStyle: "italic" },
  prolog: { color: v("comment") },
  doctype: { color: v("comment") },
  cdata: { color: v("comment") },
  punctuation: { color: v("punct") },
  property: { color: v("attr") },
  tag: { color: v("tag") },
  boolean: { color: v("number") },
  number: { color: v("number") },
  constant: { color: v("number") },
  symbol: { color: v("number") },
  selector: { color: v("string") },
  "attr-name": { color: v("attr") },
  string: { color: v("string") },
  char: { color: v("string") },
  builtin: { color: v("function") },
  operator: { color: v("punct") },
  entity: { color: v("attr") },
  url: { color: v("string") },
  variable: { color: v("text") },
  atrule: { color: v("keyword") },
  "attr-value": { color: v("string") },
  keyword: { color: v("keyword") },
  function: { color: v("function") },
  "class-name": { color: v("attr") },
  regex: { color: v("string") },
  important: { color: v("tag") },
  inserted: { color: v("string") },
  deleted: { color: v("tag") },
};

function CodeBlock({ language, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (window.electronAPI?.writeClipboardText) await window.electronAPI.writeClipboardText(value);
      else await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed");
    }
  };
  return (
    <div className="rounded-sm overflow-hidden bg-deep [box-shadow:var(--neu-inset-sm)]">
      <div className="flex items-center justify-between px-3.5 h-8 border-b border-line">
        <span className="text-[10.5px] font-mono uppercase tracking-[0.12em] text-faint">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="pressable flex items-center gap-1.5 text-[11px] text-dim hover:text-hi"
        >
          <Icon name={copied ? "check" : "copy"} size={12.5} className={copied ? "text-ok" : ""} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="overflow-x-auto px-3.5 py-3">
        <SyntaxHighlighter language={language || "text"} style={synStyle} PreTag="div">
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

/* ── Inline diff viewer ──
   Renders ```diff / ```patch blocks as a proper diff: whole-line +/- tinting,
   sign gutter, hunk/file headers, and an add/del count in the chrome. */
function parseDiffLines(value) {
  return value.split("\n").map((raw) => {
    if (raw.startsWith("+++") || raw.startsWith("---")) return { t: "file", raw };
    if (raw.startsWith("@@")) return { t: "hunk", raw };
    if (/^(diff |index |new file|deleted file|rename |similarity |old mode|new mode)/.test(raw))
      return { t: "meta", raw };
    if (raw.startsWith("+")) return { t: "add", raw };
    if (raw.startsWith("-")) return { t: "del", raw };
    return { t: "ctx", raw };
  });
}

const DIFF_ROW = {
  add: { bg: "color-mix(in srgb, var(--ok) 11%, transparent)", sign: "var(--ok)" },
  del: { bg: "color-mix(in srgb, var(--err) 11%, transparent)", sign: "var(--err)" },
};

function DiffBlock({ value }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => parseDiffLines(value), [value]);
  const adds = lines.filter((l) => l.t === "add").length;
  const dels = lines.filter((l) => l.t === "del").length;
  const copy = async () => {
    try {
      if (window.electronAPI?.writeClipboardText) await window.electronAPI.writeClipboardText(value);
      else await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed");
    }
  };
  return (
    <div className="rounded-sm overflow-hidden bg-deep [box-shadow:var(--neu-inset-sm)]">
      <div className="flex items-center justify-between px-3.5 h-8 border-b border-line">
        <span className="flex items-center gap-2.5 text-[10.5px] font-mono uppercase tracking-[0.12em] text-faint">
          diff
          <span className="normal-case tracking-normal">
            <span style={{ color: "var(--ok)" }}>+{adds}</span>{" "}
            <span style={{ color: "var(--err)" }}>−{dels}</span>
          </span>
        </span>
        <button
          type="button"
          onClick={copy}
          className="pressable flex items-center gap-1.5 text-[11px] text-dim hover:text-hi"
        >
          <Icon name={copied ? "check" : "copy"} size={12.5} className={copied ? "text-ok" : ""} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="overflow-x-auto py-2">
        {lines.map((ln, i) => {
          if (ln.t === "hunk")
            return (
              <div key={i} className="px-3.5 font-mono text-[12px] leading-[1.8] whitespace-pre" style={{ color: "var(--accent)" }}>
                {ln.raw}
              </div>
            );
          if (ln.t === "file" || ln.t === "meta")
            return (
              <div key={i} className="px-3.5 font-mono text-[12px] leading-[1.8] whitespace-pre text-faint">
                {ln.raw}
              </div>
            );
          const row = DIFF_ROW[ln.t];
          const sign = ln.t === "add" ? "+" : ln.t === "del" ? "−" : " ";
          return (
            <div
              key={i}
              className="flex px-3.5 font-mono text-[12.5px] leading-[1.65]"
              style={row ? { background: row.bg } : undefined}
            >
              <span className="w-4 shrink-0 select-none" style={row ? { color: row.sign } : undefined}>
                {sign}
              </span>
              <span className="whitespace-pre flex-1" style={{ color: "var(--syn-text)" }}>
                {ln.raw ? ln.raw.slice(1) : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const components = {
  code({ inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const value = String(children).replace(/\n$/, "");
    if (!inline && (match?.[1] === "diff" || match?.[1] === "patch")) {
      return <DiffBlock value={value} />;
    }
    if (!inline && (match || value.includes("\n"))) {
      return <CodeBlock language={match?.[1]} value={value} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (window.electronAPI?.openExternal) window.electronAPI.openExternal(href);
          else window.open(href, "_blank", "noopener");
        }}
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    );
  },
};

function Markdown({ children }) {
  return (
    <div className="markdown-body text-[13.5px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
