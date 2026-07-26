import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../../core/store";
import { agentStore, armWorkspace } from "../../core/agent";
import Icon from "../../ui/icons";
import { EASE_OUT, T } from "../../design/motion";
import { Spinner, EmptyState } from "../../ui/primitives";
import { CodeView } from "../../ui/Markdown";
import { toast } from "../../ui/Toaster";

/* ── Agent file tree ──
   A lazy, master-detail workspace browser. Directories load one level at a
   time via the read-dir IPC (which already hides dot-files + node_modules and
   returns absolute paths); selecting a file streams it through read-file into
   a read-only preview. Guarded for the web build, where electronAPI is absent. */

const CODE_EXT = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "json", "css", "scss", "html", "htm",
  "py", "rb", "go", "rs", "java", "c", "h", "cpp", "sh", "yml", "yaml", "toml",
  "xml", "svg", "vue", "svelte", "php", "sql",
]);

function fileIcon(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m && CODE_EXT.has(m[1].toLowerCase()) ? "code" : "file";
}

// Map file extension → Prism language registered in Markdown.jsx. Unknown
// extensions fall back to "text" (plain, no colouring — never an error).
const EXT_LANG = {
  js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "tsx", json: "json", css: "css", scss: "css",
  html: "markup", htm: "markup", xml: "markup", svg: "markup", vue: "markup", svelte: "markup",
  py: "python", go: "go", rs: "rust", java: "java",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",
  sql: "sql", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
  yml: "yaml", yaml: "yaml", md: "markdown", markdown: "markdown",
};
function langFromName(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? EXT_LANG[m[1].toLowerCase()] || "text" : "text";
}

const HIGHLIGHT_MAX = 200000; // don't syntax-highlight very large files (perf)

function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function TreeNode({ node, depth, onOpenFile, activePath }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (children) {
      setOpen((o) => !o);
      return;
    }
    setLoading(true);
    const res = await window.electronAPI?.readDir?.(node.path);
    setChildren(Array.isArray(res) ? res : []);
    setLoading(false);
    setOpen(true);
  }, [children, node.path]);

  const pad = { paddingLeft: 8 + depth * 12 };

  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          onClick={toggle}
          style={pad}
          className="w-full flex items-center gap-1.5 h-7 pr-2 rounded-xs text-left text-body hover:bg-surface-2"
        >
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: T, ease: EASE_OUT }}
            className="flex shrink-0"
          >
            <Icon name="chevronRight" size={11} className="text-faint" />
          </motion.span>
          <Icon name="folder" size={13} className="text-accent shrink-0" />
          <span className="truncate text-[12px]">{node.name}</span>
          {loading && <Spinner size={10} className="ml-auto" />}
        </button>
        <AnimatePresence initial={false}>
          {open && children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: T, ease: EASE_OUT }}
              className="overflow-hidden"
            >
              {children.length === 0 ? (
                <p
                  style={{ paddingLeft: 8 + (depth + 1) * 12 }}
                  className="text-[11px] text-faint h-6 flex items-center"
                >
                  empty
                </p>
              ) : (
                children.map((c) => (
                  <TreeNode
                    key={c.path}
                    node={c}
                    depth={depth + 1}
                    onOpenFile={onOpenFile}
                    activePath={activePath}
                  />
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const active = activePath === node.path;
  return (
    <button
      type="button"
      onClick={() => onOpenFile(node)}
      style={pad}
      className={`w-full flex items-center gap-1.5 h-7 pr-2 rounded-xs text-left ${
        active ? "bg-deep [box-shadow:var(--neu-inset-sm)] text-hi" : "text-body hover:bg-surface-2"
      }`}
    >
      <span className="w-[11px] shrink-0" />
      <Icon name={fileIcon(node.name)} size={12} className={`shrink-0 ${active ? "text-accent" : "text-faint"}`} />
      <span className="truncate text-[12px]">{node.name}</span>
    </button>
  );
}

export default function FileTree({ workspacePath, focusPath }) {
  const [roots, setRoots] = useState(null);
  const [preview, setPreview] = useState(null); // { path, name, content, error, loading, size }
  const [nonce, setNonce] = useState(0); // bump to force a full reload (remounts nodes)
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Auto-refresh whenever the agent writes files: filesChanged is a monotonic
  // counter in the agent store, so a change means new/edited files on disk.
  const filesChanged = useStore(agentStore, (s) => s.stats?.filesChanged || 0);
  useEffect(() => {
    if (filesChanged > 0) setNonce((n) => n + 1);
  }, [filesChanged]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!workspacePath) {
        setRoots([]);
        return;
      }
      setRoots(null);
      // Ensure the main-process scope is armed before reading — a restored
      // workspace otherwise returns [] and looks like an empty folder.
      await armWorkspace(workspacePath);
      const r = await window.electronAPI?.readDir?.(workspacePath);
      if (live) setRoots(Array.isArray(r) ? r : []);
    })();
    return () => {
      live = false;
    };
  }, [workspacePath, nonce]);

  const openFile = useCallback(async (node) => {
    setEditing(false);
    setPreview({ path: node.path, name: node.name, loading: true });
    const res = await window.electronAPI?.readFile?.(node.path);
    setPreview({
      path: node.path,
      name: node.name,
      content: res?.content ?? "",
      error: res?.error,
      size: res?.size,
    });
  }, []);

  // Auto-open a specific file when asked (e.g. PLAN.md right after planning).
  useEffect(() => {
    if (focusPath?.path) {
      openFile({ path: focusPath.path, name: focusPath.path.split(/[\\/]/).pop() });
    }
  }, [focusPath?.path, focusPath?.nonce, openFile]);

  const startEdit = () => {
    setDraft(preview?.content ?? "");
    setEditing(true);
  };

  const save = async () => {
    if (!preview || saving) return;
    setSaving(true);
    try {
      const res = await window.electronAPI?.writeFile?.(preview.path, draft);
      if (!res || res.success === false) throw new Error(res?.error || "Write failed");
      setPreview((p) => ({ ...p, content: draft, size: new TextEncoder().encode(draft).length }));
      setEditing(false);
      toast.success("Saved");
      reload();
    } catch (e) {
      toast.error("Save failed", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (!workspacePath) {
    return (
      <EmptyState
        icon="folder"
        title="No workspace"
        hint="Pick a workspace folder to browse its files."
        className="h-full"
      />
    );
  }

  return (
    <div className="h-full flex min-h-0">
      {/* Tree */}
      <div className="w-[260px] shrink-0 border-r border-line flex flex-col min-h-0">
        <div className="flex items-center gap-1.5 h-8 px-3 shrink-0 border-b border-line">
          <Icon name="folder" size={12} className="text-accent shrink-0" />
          <span className="text-[11px] font-medium text-hi truncate flex-1">
            {workspacePath.split(/[\\/]/).filter(Boolean).pop()}
          </span>
          <button
            type="button"
            onClick={reload}
            title="Refresh files"
            className="w-6 h-6 flex items-center justify-center rounded-xs text-faint hover:text-hi hover:bg-surface-2"
          >
            <Icon name="refresh" size={12} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto py-2" key={nonce}>
          {roots === null ? (
            <div className="flex items-center gap-2 px-3 h-8 text-faint text-[12px]">
              <Spinner size={12} /> Loading…
            </div>
          ) : roots.length === 0 ? (
            <p className="px-3 text-[12px] text-faint">Empty folder.</p>
          ) : (
            roots.map((n) => (
              <TreeNode key={n.path} node={n} depth={0} onOpenFile={openFile} activePath={preview?.path} />
            ))
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {!preview ? (
          <EmptyState
            icon="eye"
            title="No file open"
            hint="Select a file from the tree to preview it."
            className="h-full"
          />
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 h-10 border-b border-line shrink-0">
              <Icon name={fileIcon(preview.name)} size={13} className="text-accent shrink-0" />
              <span className="text-[12.5px] font-medium text-hi truncate">{preview.name}</span>
              {preview.size != null && (
                <span className="text-[10.5px] text-faint ml-1 shrink-0">{fmtSize(preview.size)}</span>
              )}
              <div className="flex-1" />
              {!preview.loading &&
                !preview.error &&
                (editing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      disabled={saving}
                      className="h-7 px-2.5 flex items-center rounded-xs text-[11.5px] text-faint hover:text-hi hover:bg-surface-2 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={save}
                      disabled={saving}
                      className="h-7 px-3 flex items-center gap-1.5 rounded-xs text-[11.5px] text-accent-ink font-medium disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
                    >
                      {saving ? <Spinner size={11} /> : <Icon name="check" size={12} />} Save
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={startEdit}
                    title="Edit this file"
                    className="h-7 px-2.5 flex items-center gap-1.5 rounded-xs text-[11.5px] text-body hover:text-hi hover:bg-surface-2"
                  >
                    <Icon name="edit" size={12} /> Edit
                  </button>
                ))}
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              {preview.loading ? (
                <div className="flex items-center gap-2 p-4 text-faint text-[12px]">
                  <Spinner size={12} /> Reading…
                </div>
              ) : preview.error ? (
                <div className="p-4 text-[12px] text-err">{preview.error}</div>
              ) : editing ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="w-full h-full min-h-0 p-4 bg-transparent border-none outline-none resize-none font-mono text-[12px] leading-relaxed text-hi"
                />
              ) : preview.content === "" ? (
                <div className="p-4 text-[12px] text-faint">Empty file.</div>
              ) : preview.content.length > HIGHLIGHT_MAX ? (
                <pre className="p-4 font-mono text-[11.5px] leading-relaxed text-body whitespace-pre min-w-0">
                  {preview.content}
                </pre>
              ) : (
                <CodeView language={langFromName(preview.name)} value={preview.content} showLineNumbers />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
