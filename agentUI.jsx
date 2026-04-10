import { useState, useRef, useEffect } from "react";

// ── Colors ────────────────────────────────────────────────────
const C = {
  bg: "#0f1117", bgCard: "#161920", bgEl: "#1c1f28",
  border: "#252a35", text: "#c9d1d9", textDim: "#6b7280", textBright: "#e6edf3",
  accent: "#3b82f6", agent: "#a855f7", agentDim: "rgba(168,85,247,0.1)",
  agentBorder: "rgba(168,85,247,0.25)",
  green: "#22c55e", greenDim: "rgba(34,197,94,0.1)",
  orange: "#f59e0b", orangeDim: "rgba(245,158,11,0.1)",
  red: "#ef4444", userBubble: "#f59e0b",
  vsEditorBg: "#1e1e1e", vsSidebarBg: "#252526", vsActivityBg: "#333333",
  vsBorder: "#3c3c3c", vsTabBg: "#2d2d2d", vsTabActive: "#1e1e1e",
  vsAccent: "#007acc", vsHover: "#2a2d2e", vsGreen: "#23d18b",
  vsText: "#cccccc", vsTextDim: "#858585", vsTextBright: "#e0e0e0",
};

// ── Icons (compact) ───────────────────────────────────────────
const Ic = {
  send: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>,
  attach: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>,
  web: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
  copy: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
  refresh: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
  settings: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4"/></svg>,
  chevDown: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 6 8 10 12 6"/></svg>,
  chevRight: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 4 10 8 6 12"/></svg>,
  close: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>,
  terminal: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  file: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>,
  folder: <svg width="14" height="14" viewBox="0 0 24 24" fill="#C09553" stroke="none"><path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>,
  folderOpen: <svg width="14" height="14" viewBox="0 0 24 24" fill="#D4A964" stroke="none"><path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v1H8.5a2 2 0 00-1.8 1.1L4 18H3a1 1 0 01-1-1V6z"/><path d="M6.5 11h15a1 1 0 01.96 1.28l-2.5 8.5A1 1 0 0119 21.5H5.5L8.5 11z" opacity="0.8"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  git: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 012 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>,
  sparkle: <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z"/></svg>,
  check: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
  xMark: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  shield: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  zap: <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  chat: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  loading: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>,
  edit: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
};

const getFileIcon = (name) => {
  const ext = name?.split(".").pop()?.toLowerCase();
  const map = { jsx: ["#61DAFB","JSX"], js: ["#F7DF1E","JS"], json: ["#559E3C","{}"], css: ["#2DA0D1","#"], md: ["#777","M"] };
  const [c, l] = map[ext] || ["#888", "F"];
  return <svg width="14" height="14" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill={c}/><text x="8" y="12" textAnchor="middle" fontSize={l.length > 2 ? "6" : "8"} fontWeight="bold" fill={ext === "js" ? "#333" : "#fff"}>{l}</text></svg>;
};

// ── Data ──────────────────────────────────────────────────────
const TREE = [
  { n: "src", t: "f", ch: [
    { n: "api", t: "f", ch: [{ n: "anthropic.js", t: "l" }, { n: "huggingface.js", t: "l" }, { n: "ollama.js", t: "l" }] },
    { n: "components", t: "f", ch: [{ n: "ChatApp.jsx", t: "l" }, { n: "AgentWorkspace.jsx", t: "l" }] },
    { n: "utils", t: "f", ch: [{ n: "streamParser.js", t: "l" }, { n: "memory.js", t: "l" }] },
    { n: "App.js", t: "l" }, { n: "index.css", t: "l" },
  ]},
  { n: "package.json", t: "l" }, { n: "README.md", t: "l" },
];
const CHATS = ["hello", "diff between dfs and...", "diff between dfs and...", "hi", "what is the diff b/w..."];
const DEMO_CHAT = [
  { role: "user", text: "what can you do" },
  { role: "ai", text: "Hello! I see you're in the 'test' workspace. I can help with Node.js coding, graph algorithms, DSA practice, terminal commands, or other tasks. What would you like to work on?" },
];
const AGENT_MSGS = [
  { role: "user", text: "Add dark mode toggle to this app" },
  { role: "thinking", text: "Analyzing workspace structure..." },
  { role: "action", aType: "read", target: "src/components/ChatApp.jsx", text: "Reading current implementation..." },
  { role: "plan", steps: [
    { text: "Read project structure", status: "done" },
    { text: "Analyze ChatApp.jsx", status: "done" },
    { text: "Create DarkModeContext.jsx", status: "pending", perm: true, action: "create" },
    { text: "Modify App.js with provider", status: "wait", perm: true, action: "edit" },
    { text: "Update CSS variables", status: "wait", perm: true, action: "edit" },
  ]},
  { role: "action", aType: "create", target: "src/utils/DarkModeContext.jsx", text: "Creating DarkModeContext...",
    code: "import { createContext, useContext, useState } from 'react';\n\nconst DarkModeContext = createContext();\n\nexport function DarkModeProvider({ children }) {\n  const [dark, setDark] = useState(true);\n  return (\n    <DarkModeContext.Provider value={{ dark, toggle: () => setDark(!dark) }}>\n      {children}\n    </DarkModeContext.Provider>\n  );\n}",
    perm: true },
];
const TERM = [
  { c: true, t: "PS C:\\Users\\parik\\project> npm start" },
  { c: false, t: "[start-react] Compiled successfully!" },
  { c: false, t: "[start-react] Local:  http://localhost:3000" },
  { c: false, t: "[start-electron] Electron app started" },
];
const CODE = [
  "import React, { useState, useEffect } from 'react';",
  "import { useDarkMode } from '../utils/DarkModeContext';",
  "", "export default function ChatApp({ providers }) {",
  "  const [messages, setMessages] = useState([]);",
  "  const [input, setInput] = useState('');",
  "  const { dark, toggle } = useDarkMode();",
  "", "  const handleSend = async () => {",
  "    if (!input.trim()) return;",
  "    const userMsg = { role: 'user', text: input };",
  "    setMessages(prev => [...prev, userMsg]);",
  "    setInput('');",
  "    try {",
  "      const resp = await onMessage(input);",
  "      setMessages(p => [...p, resp]);",
  "    } catch (err) {",
  "      console.error('Failed:', err);",
  "    }",
  "  };",
  "", "  return (",
  "    <div className={dark ? 'dark' : 'light'}>",
  "      {/* render chat */}",
  "    </div>", "  );", "}",
];

// ── Sub-components ────────────────────────────────────────────
function TreeItem({ node, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);
  const isF = node.t === "f";
  return (<div>
    <div onClick={() => isF && setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 4, padding: `2px 0 2px ${8 + depth * 14}px`, cursor: "pointer", fontSize: 12, color: C.vsText, userSelect: "none" }}
      onMouseEnter={e => e.currentTarget.style.background = C.vsHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      {isF ? (open ? Ic.chevDown : Ic.chevRight) : <span style={{ width: 11 }}/>}
      <span style={{ display: "flex", alignItems: "center", marginRight: 3 }}>{isF ? (open ? Ic.folderOpen : Ic.folder) : getFileIcon(node.n)}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.n}</span>
    </div>
    {isF && open && node.ch?.map((c, i) => <TreeItem key={i} node={c} depth={depth + 1}/>)}
  </div>);
}

function PermBox({ action, target }) {
  const col = { create: C.green, edit: C.orange, terminal: C.accent }[action] || C.agent;
  const lab = { create: "Create File", edit: "Edit File", terminal: "Run Command" }[action] || action;
  return (<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: C.agentDim, border: `1px solid ${C.agentBorder}`, borderRadius: 7, margin: "5px 0", flexWrap: "wrap" }}>
    <span style={{ color: col, display: "flex" }}>{Ic.shield}</span>
    <div style={{ flex: 1, fontSize: 11, color: C.text, minWidth: 80 }}>
      <span style={{ fontWeight: 600, color: col }}>{lab}</span><span style={{ color: C.textDim }}> — {target}</span>
    </div>
    <div style={{ display: "flex", gap: 4 }}>
      <button style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 10px", borderRadius: 5, background: C.green, color: "#fff", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{Ic.check} Allow</button>
      <button style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 10px", borderRadius: 5, background: "transparent", color: C.red, border: `1px solid ${C.red}`, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{Ic.xMark} Deny</button>
    </div>
  </div>);
}

function PlanCard({ steps }) {
  const sI = (s) => s === "done" ? <span style={{ color: C.green }}>{Ic.check}</span> : s === "pending" ? <span style={{ color: C.orange, display: "inline-flex", animation: "kspin 1.5s linear infinite" }}>{Ic.loading}</span> : <span style={{ color: C.textDim, fontSize: 10 }}>○</span>;
  return (<div style={{ background: C.agentDim, border: `1px solid ${C.agentBorder}`, borderRadius: 8, padding: "10px 12px", margin: "6px 0" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8, fontSize: 11, fontWeight: 700, color: C.agent }}>{Ic.sparkle} EXECUTION PLAN</div>
    {steps.map((s, i) => (<div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "3px 0", opacity: s.status === "wait" ? 0.35 : 1 }}>
      <div style={{ marginTop: 1, flexShrink: 0 }}>{sI(s.status)}</div>
      <div style={{ flex: 1, fontSize: 12, color: s.status === "done" ? C.textDim : C.text, textDecoration: s.status === "done" ? "line-through" : "none" }}>{s.text}</div>
      {s.perm && s.status !== "done" && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: C.orangeDim, color: C.orange, fontWeight: 600 }}>approval</span>}
    </div>))}
  </div>);
}

// ══════════════════════════════════════════════════════════════
export default function App() {
  const [mode, setMode] = useState("chat");
  const [input, setInput] = useState("");
  const [chatMsgs, setChatMsgs] = useState(DEMO_CHAT);
  const [autoExec, setAutoExec] = useState(false);
  const [termOpen, setTermOpen] = useState(true);
  const [sideOpen, setSideOpen] = useState(true);
  const [sideTab, setSideTab] = useState("explorer");
  const chatEnd = useRef(null);
  const isAgent = mode === "agent";

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs]);

  const send = () => {
    if (!input.trim()) return;
    if (!isAgent) setChatMsgs(p => [...p, { role: "user", text: input.trim() }, { role: "ai", text: "I can help with that! Let me think..." }]);
    setInput("");
  };

  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: "'Segoe UI',-apple-system,sans-serif", fontSize: 13, overflow: "hidden" }}>

      {/* Title Bar */}
      <div style={{ height: 36, background: isAgent ? "#1e1e1e" : C.bgCard, display: "flex", alignItems: "center", padding: "0 10px", gap: 6, borderBottom: `1px solid ${isAgent ? C.vsBorder : C.border}`, flexShrink: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ color: C.orange }}>{Ic.sparkle}</span>
          <span style={{ fontWeight: 700, fontSize: 12.5, color: C.textBright }}>KritakaPrajna</span>
        </span>
        <div style={{ display: "flex", marginLeft: 12, gap: 2, padding: "2px", borderRadius: 6, background: isAgent ? "#2a2a2a" : C.bgEl }}>
          <button onClick={() => setMode("chat")} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 14px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 700, background: !isAgent ? C.green : "transparent", color: !isAgent ? "#fff" : C.textDim }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: !isAgent ? "#fff" : C.textDim }}/>Chat
          </button>
          <button onClick={() => setMode("agent")} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 14px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 700, background: isAgent ? C.agent : "transparent", color: isAgent ? "#fff" : C.textDim }}>
            {Ic.zap} Agent
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 10, padding: "3px 8px", borderRadius: 5, fontSize: 11, cursor: "pointer", background: isAgent ? "#2a2a2a" : C.bgEl, color: C.textDim }}>
          DeepSeek V3.2 <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: C.greenDim, color: C.green, fontWeight: 700, marginLeft: 3 }}>Free</span> {Ic.chevDown}
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{ padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: C.greenDim, color: C.green }}>Ready</div>
      </div>

      {/* ══ CHAT MODE ══ */}
      {!isAgent && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 190, background: C.bgCard, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ padding: "12px 12px 8px", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.orange }}>{Ic.sparkle}</span><span style={{ fontWeight: 700, color: C.textBright, fontSize: 13 }}>KritakaPrajna</span>
            </div>
            <div style={{ margin: "0 8px 10px", padding: "7px 10px", borderRadius: 5, cursor: "pointer", background: C.bgEl, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.text }}>{Ic.plus} New Chat</div>
            <div style={{ padding: "0 12px", fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: 0.8, marginBottom: 4 }}>CHATS</div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 4px" }}>
              {CHATS.map((h, i) => (
                <div key={i} style={{ padding: "6px 8px", fontSize: 12, color: C.text, cursor: "pointer", borderRadius: 4, marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", background: i === 0 ? "rgba(59,130,246,0.1)" : "transparent", borderLeft: i === 0 ? `2px solid ${C.accent}` : "2px solid transparent" }}
                  onMouseEnter={e => { if (i) e.currentTarget.style.background = C.bgEl; }} onMouseLeave={e => { if (i) e.currentTarget.style.background = "transparent"; }}>
                  {i === 0 && <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: C.orange, marginRight: 5 }}/>}{h}
                </div>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 12px", fontSize: 10 }}>
              <div style={{ fontWeight: 700, color: C.orange, marginBottom: 4 }}>USAGE</div>
              <div style={{ display: "flex", justifyContent: "space-between", color: C.textDim, marginBottom: 2 }}><span>Model</span><span style={{ color: C.text, fontSize: 9 }}>huggingface:deeps...</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", color: C.textDim }}><span>Cost</span><span style={{ color: C.green }}>Free</span></div>
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, padding: "6px 12px", display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textDim }}>{Ic.settings} Settings <span style={{ fontSize: 9, marginLeft: "auto" }}>v2.8.5</span></div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 0" }}>
              {chatMsgs.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", padding: "3px 20px", marginBottom: 6 }}>
                  {m.role !== "user" && <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, marginRight: 8, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${C.agent}, ${C.accent})`, color: "#fff" }}>{Ic.sparkle}</div>}
                  <div style={{ maxWidth: "70%", padding: "8px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.55, background: m.role === "user" ? C.userBubble : C.bgEl, color: m.role === "user" ? "#fff" : C.text, borderBottomRightRadius: m.role === "user" ? 3 : 12, borderBottomLeftRadius: m.role === "user" ? 12 : 3 }}>
                    {m.text}
                    {m.role !== "user" && <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 10, color: C.textDim }}>
                      <span style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>{Ic.copy} Copy</span>
                      <span style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>{Ic.refresh} Regenerate</span>
                    </div>}
                  </div>
                </div>
              ))}
              <div ref={chatEnd}/>
            </div>
            <div style={{ padding: "10px 20px 14px", borderTop: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                {["REPLY", "Short", "Medium", "Long"].map((l, i) => (
                  <span key={l} style={{ padding: "2px 8px", borderRadius: 3, fontSize: 10, cursor: "pointer", fontWeight: 600, background: i === 3 ? C.accent : C.bgEl, color: i === 3 ? "#fff" : C.textDim, border: `1px solid ${i === 3 ? C.accent : C.border}` }}>{l}</span>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.bgCard, borderRadius: 10, padding: "8px 12px", border: `1px solid ${C.border}` }}>
                <span style={{ cursor: "pointer", color: C.textDim, display: "flex" }}>{Ic.attach}</span>
                <span style={{ cursor: "pointer", color: C.textDim, display: "flex", alignItems: "center", gap: 3, fontSize: 11 }}>{Ic.web} Web</span>
                <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); send(); }}}
                  placeholder="Ask anything..." style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 13, fontFamily: "inherit" }}/>
                <button onClick={send} style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: input.trim() ? C.orange : C.bgEl, color: "#fff", cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>{Ic.send}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ AGENT MODE ══ */}
      {isAgent && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 40, background: C.vsActivityBg, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4, flexShrink: 0, borderRight: `1px solid ${C.vsBorder}` }}>
            {[{ id: "explorer", icon: Ic.file }, { id: "search", icon: Ic.search }, { id: "git", icon: Ic.git }, { id: "chat", icon: Ic.chat }].map(it => {
              const act = sideTab === it.id && sideOpen;
              return (<div key={it.id} onClick={() => { if (sideTab === it.id && sideOpen) setSideOpen(false); else { setSideTab(it.id); setSideOpen(true); }}}
                style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: act ? "#fff" : C.vsTextDim, borderLeft: act ? "2px solid #fff" : "2px solid transparent" }}
                onMouseEnter={e => e.currentTarget.style.color = "#fff"} onMouseLeave={e => { if (!act) e.currentTarget.style.color = C.vsTextDim; }}>{it.icon}</div>);
            })}
            <div style={{ flex: 1 }}/>
            <div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", color: C.vsTextDim, cursor: "pointer" }}>{Ic.settings}</div>
          </div>
          {sideOpen && (
            <div style={{ width: 200, background: C.vsSidebarBg, borderRight: `1px solid ${C.vsBorder}`, display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" }}>
              <div style={{ height: 30, display: "flex", alignItems: "center", paddingLeft: 14, fontSize: 10, fontWeight: 600, letterSpacing: 1, color: C.vsTextDim, textTransform: "uppercase" }}>
                {sideTab === "explorer" ? "Explorer" : sideTab === "chat" ? "Agent History" : sideTab}
              </div>
              {sideTab === "explorer" && <div style={{ flex: 1, overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 8px", fontSize: 10, fontWeight: 700, color: C.vsTextBright, background: "#2a2a2a" }}>{Ic.chevDown} WORKSPACE</div>
                {TREE.map((n, i) => <TreeItem key={i} node={n}/>)}
              </div>}
              {sideTab === "chat" && <div style={{ flex: 1, overflowY: "auto", padding: "2px 4px" }}>
                {["Add dark mode toggle", "Fix build errors", "Refactor API layer"].map((t, i) => (
                  <div key={i} style={{ padding: "5px 8px", fontSize: 11.5, color: C.vsText, cursor: "pointer", borderRadius: 3, display: "flex", alignItems: "center", gap: 4 }}
                    onMouseEnter={e => e.currentTarget.style.background = C.vsHover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{Ic.sparkle} {t}</div>
                ))}
              </div>}
            </div>
          )}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Editor */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: `1px solid ${C.vsBorder}`, minWidth: 0 }}>
                <div style={{ height: 30, background: C.vsTabBg, display: "flex", alignItems: "stretch", borderBottom: `1px solid ${C.vsBorder}`, flexShrink: 0 }}>
                  {["ChatApp.jsx", "AgentWorkspace.jsx"].map((t, i) => (
                    <div key={t} style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 10px", fontSize: 11.5, background: i === 0 ? C.vsTabActive : C.vsTabBg, color: i === 0 ? C.vsTextBright : C.vsTextDim, borderRight: `1px solid ${C.vsBorder}`, borderTop: i === 0 ? `2px solid ${C.vsAccent}` : "2px solid transparent", cursor: "pointer" }}>
                      {getFileIcon(t)} {t}
                    </div>
                  ))}
                </div>
                <div style={{ flex: 1, background: C.vsEditorBg, overflowY: "auto", padding: "10px 0", fontFamily: "'Cascadia Code','Fira Code',Consolas,monospace", fontSize: 12, lineHeight: 1.55 }}>
                  {CODE.map((line, i) => (
                    <div key={i} style={{ display: "flex", minHeight: 18 }}>
                      <span style={{ width: 44, textAlign: "right", paddingRight: 14, color: C.vsTextDim, fontSize: 11, userSelect: "none" }}>{i + 1}</span>
                      <span style={{ color: /^(import|export|const|let|var|try|catch|return|if|async|await|function)\b/.test(line.trim().split(/\s/)[0] || "") ? "#569CD6" : line.includes("'") ? "#CE9178" : line.includes("//") || line.includes("{/*") ? "#6A9955" : C.vsText }}>{line}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Agent Panel */}
              <div style={{ width: 340, display: "flex", flexDirection: "column", background: C.vsEditorBg, flexShrink: 0 }}>
                <div style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px", borderBottom: `1px solid ${C.vsBorder}`, flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: C.agent }}>{Ic.sparkle} AGENT</div>
                  <div onClick={() => setAutoExec(!autoExec)} style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 3, fontSize: 10, cursor: "pointer", fontWeight: 700, background: autoExec ? C.greenDim : C.orangeDim, color: autoExec ? C.green : C.orange, border: `1px solid ${autoExec ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)"}` }}>
                    {autoExec ? Ic.zap : Ic.shield} {autoExec ? "Auto" : "Ask"}
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
                  {AGENT_MSGS.map((m, i) => {
                    if (m.role === "user") return <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}><div style={{ padding: "7px 12px", borderRadius: 10, borderBottomRightRadius: 3, background: C.accent, color: "#fff", fontSize: 12, maxWidth: "85%" }}>{m.text}</div></div>;
                    if (m.role === "thinking") return <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0", marginBottom: 6, fontSize: 11.5, color: C.agent, fontStyle: "italic" }}><span style={{ display: "inline-flex", animation: "kspin 1.5s linear infinite" }}>{Ic.loading}</span>{m.text}</div>;
                    if (m.role === "plan") return <PlanCard key={i} steps={m.steps}/>;
                    if (m.role === "action") return (<div key={i} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textDim, marginBottom: 3 }}>
                        <span style={{ color: m.aType === "read" ? C.accent : m.aType === "create" ? C.green : C.orange, display: "flex" }}>{m.aType === "read" ? Ic.file : m.aType === "create" ? Ic.plus : Ic.edit}</span>
                        <span style={{ fontWeight: 600, color: C.text }}>{m.target}</span>
                      </div>
                      <div style={{ fontSize: 12, color: C.text, marginBottom: 4 }}>{m.text}</div>
                      {m.code && <div style={{ borderRadius: 6, overflow: "hidden", margin: "4px 0", border: `1px solid ${C.vsBorder}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: C.vsTabBg, fontSize: 11, color: C.vsTextDim, borderBottom: `1px solid ${C.vsBorder}` }}>{getFileIcon(m.target)} {m.target}</div>
                        <pre style={{ background: "#0d1117", padding: "8px 12px", margin: 0, fontSize: 11, lineHeight: 1.5, overflowX: "auto", fontFamily: "'Cascadia Code',Consolas,monospace", color: "#e6edf3", whiteSpace: "pre-wrap" }}><code>{m.code}</code></pre>
                      </div>}
                      {m.perm && !autoExec && <PermBox action={m.aType} target={m.target}/>}
                    </div>);
                    return null;
                  })}
                </div>
                <div style={{ padding: "8px 10px", borderTop: `1px solid ${C.vsBorder}`, flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#2a2d33", borderRadius: 7, padding: "7px 10px", border: `1px solid ${C.vsBorder}` }}>
                    <span style={{ color: C.vsTextDim, display: "flex", cursor: "pointer" }}>{Ic.attach}</span>
                    <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); send(); }}}
                      placeholder="Ask agent to do something..." style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.vsText, fontSize: 12, fontFamily: "inherit" }}/>
                    <button onClick={send} style={{ width: 26, height: 26, borderRadius: 5, border: "none", background: input.trim() ? C.agent : "transparent", color: input.trim() ? "#fff" : C.vsTextDim, cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>{Ic.send}</button>
                  </div>
                </div>
              </div>
            </div>
            {/* Terminal */}
            {termOpen && <div style={{ height: 130, background: C.vsEditorBg, display: "flex", flexDirection: "column", flexShrink: 0, borderTop: `2px solid ${C.vsBorder}` }}>
              <div style={{ height: 28, display: "flex", alignItems: "center", borderBottom: `1px solid ${C.vsBorder}`, paddingLeft: 10 }}>
                {["PROBLEMS", "OUTPUT", "TERMINAL"].map(t => <div key={t} style={{ padding: "0 10px", height: "100%", display: "flex", alignItems: "center", fontSize: 10, fontWeight: 600, color: t === "TERMINAL" ? C.vsTextBright : C.vsTextDim, borderBottom: t === "TERMINAL" ? `2px solid ${C.vsAccent}` : "2px solid transparent" }}>{t}</div>)}
                <div style={{ flex: 1 }}/><div onClick={() => setTermOpen(false)} style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", borderRadius: 3, color: C.vsTextDim, marginRight: 6 }}>{Ic.close}</div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "4px 12px", fontFamily: "'Cascadia Code',Consolas,monospace", fontSize: 11.5, lineHeight: 1.5 }}>
                {TERM.map((l, i) => <div key={i} style={{ color: l.c ? C.vsGreen : C.vsText }}>{l.t}</div>)}
                <div style={{ display: "flex", alignItems: "center", marginTop: 2 }}><span style={{ color: C.vsGreen }}>PS {">"} </span><span style={{ borderLeft: "1.5px solid #ccc", height: 13, marginLeft: 3, animation: "kblink 1s step-end infinite" }}/></div>
              </div>
            </div>}
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div style={{ height: 20, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px", fontSize: 10.5, flexShrink: 0, background: isAgent ? C.agent : C.vsAccent, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>{isAgent ? <>{Ic.sparkle} Agent</> : <>{Ic.git} main*</>}</span>
          {isAgent && <span style={{ fontSize: 9, opacity: 0.85 }}>{autoExec ? "Auto-execute" : "Permission mode"}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isAgent && !termOpen && <span onClick={() => setTermOpen(true)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>{Ic.terminal} Terminal</span>}
          <span>{Ic.sparkle} KritakaPrajna</span>
          <span style={{ fontSize: 9, opacity: 0.6 }}>Made by Parikshit</span>
        </div>
      </div>

      <style>{`
        @keyframes kblink { 50% { opacity: 0 } }
        @keyframes kspin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #424242; border-radius: 3px; }
        input::placeholder { color: #6b7280; }
      `}</style>
    </div>
  );
}
