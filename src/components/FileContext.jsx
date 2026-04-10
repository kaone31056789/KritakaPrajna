import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];
const api = window.electronAPI;

const BINARY_EXTS = new Set(["png","jpg","jpeg","gif","webp","ico","bmp","tiff","woff","woff2","ttf","eot","mp3","mp4","wav","zip","tar","gz","exe","dll","bin","so","dylib"]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function fileExt(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function baseName(filePath) {
  const sep = filePath.includes("\\") ? "\\" : "/";
  return filePath.split(sep).pop();
}

// ── File-type color mapping ─────────────────────────────────────────────────

const EXT_COLORS = {
  js: "text-yellow-400",
  jsx: "text-yellow-400",
  ts: "text-blue-400",
  tsx: "text-blue-400",
  py: "text-green-400",
  css: "text-pink-400",
  scss: "text-pink-400",
  html: "text-orange-400",
  json: "text-amber-300",
  md: "text-dark-200",
  yml: "text-purple-400",
  yaml: "text-purple-400",
  xml: "text-orange-300",
  svg: "text-emerald-400",
  png: "text-teal-400",
  jpg: "text-teal-400",
  jpeg: "text-teal-400",
  gif: "text-teal-400",
  webp: "text-teal-400",
  pdf: "text-red-400",
  txt: "text-dark-300",
  csv: "text-lime-400",
  sh: "text-green-300",
  bat: "text-green-300",
  env: "text-dark-400",
  lock: "text-dark-500",
  gitignore: "text-dark-500",
};

function extColor(name) {
  const ext = fileExt(name);
  return EXT_COLORS[ext] || "text-dark-400";
}

// Short file-type badge label (shown on hover or as a tiny badge)
function extLabel(name) {
  const ext = fileExt(name);
  return ext ? ext.toUpperCase() : "";
}

// ── Icons ───────────────────────────────────────────────────────────────────

function FolderIcon({ open }) {
  return open ? (
    <svg className="w-4 h-4 text-[#00ff41] shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v1H2V6z" />
      <path fillRule="evenodd" d="M2 9h16l-1.5 7H3.5L2 9z" clipRule="evenodd" opacity="0.7" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-[#00ff41]/70 shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}

function FileTypeIcon({ name }) {
  const color = extColor(name);
  return (
    <svg className={`w-4 h-4 shrink-0 ${color}`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
      <polyline strokeLinecap="round" strokeLinejoin="round" points="14 2 14 8 20 8" />
    </svg>
  );
}

function ChevronIcon({ expanded }) {
  return (
    <svg
      className={`w-3 h-3 text-dark-500 shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
      fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ── Tree node ───────────────────────────────────────────────────────────────

function TreeNode({ entry, depth, onFileClick, selectedPath }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState(null);
  const [loadingDir, setLoadingDir] = useState(false);

  const toggleDir = useCallback(async () => {
    if (!entry.isDir) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!children) {
      setLoadingDir(true);
      const items = await api.readDir(entry.path);
      setChildren(items);
      setLoadingDir(false);
    }
    setExpanded(true);
  }, [entry, expanded, children]);

  const handleClick = () => {
    if (entry.isDir) {
      toggleDir();
    } else {
      onFileClick(entry);
    }
  };

  const isSelected = selectedPath === entry.path;

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={`group w-full flex items-center gap-1.5 py-[5px] rounded-sm transition-colors cursor-pointer text-left ${
          isSelected
            ? "bg-[#00ff41]/10 text-[#00ff41]"
            : "text-dark-200 hover:bg-dark-700/40 hover:text-dark-100"
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px`, paddingRight: "8px" }}
      >
        {entry.isDir && <ChevronIcon expanded={expanded} />}
        {entry.isDir ? <FolderIcon open={expanded} /> : <FileTypeIcon name={entry.name} />}
        <span className="truncate text-[12px] flex-1">{entry.name}</span>
        {loadingDir && (
          <span className="shrink-0">
            <svg className="w-3 h-3 animate-spin text-[#00ff41]/60" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </span>
        )}
        {!entry.isDir && (
          <span className={`text-[9px] font-medium opacity-0 group-hover:opacity-60 transition-opacity ${extColor(entry.name)}`}>
            {extLabel(entry.name)}
          </span>
        )}
      </button>

      <AnimatePresence>
        {expanded && children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease }}
            className="overflow-hidden"
          >
            {children.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                onFileClick={onFileClick}
                selectedPath={selectedPath}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function FileContext({ onAttach }) {
  const [rootPath, setRootPath] = useState(null);
  const [rootEntries, setRootEntries] = useState([]);
  const [preview, setPreview] = useState(null); // { name, path, content, size, error }
  const [loadingFile, setLoadingFile] = useState(false);

  const handleSelectFolder = useCallback(async () => {
    if (!api) return;
    const folder = await api.selectFolder();
    if (!folder) return;
    setRootPath(folder);
    setPreview(null);
    const entries = await api.readDir(folder);
    setRootEntries(entries);
  }, []);

  const handleFileClick = useCallback(async (entry) => {
    if (!api) return;
    const ext = fileExt(entry.name);

    if (BINARY_EXTS.has(ext)) {
      setPreview({ name: entry.name, path: entry.path, content: null, size: 0, error: "Binary file — cannot attach as text" });
      return;
    }

    setLoadingFile(true);
    let content = null, size = 0, error = null, extra = "";

    if (ext === "pdf") {
      const result = await api.extractPdfText(entry.path);
      error = result.error;
      content = result.text || null;
      size = content?.length || 0;
      if (!error && result.pages) extra = ` (${result.pages} page${result.pages !== 1 ? "s" : ""})`;
    } else {
      const result = await api.readFile(entry.path);
      error = result.error;
      content = result.content || null;
      size = result.size || 0;
    }

    setPreview({ name: entry.name, path: entry.path, content, size, error, extra });

    if (content && !error && onAttach) {
      onAttach({ name: entry.name, path: entry.path, content });
    }
    setLoadingFile(false);
  }, [onAttach]);

  // Not in Electron
  if (!api) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-dark-500 text-center">File context is only available in the desktop app</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[#00ff41]/60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="text-[11px] uppercase tracking-wider text-dark-400 font-semibold">Files</span>
        </div>
        <motion.button
          type="button"
          onClick={handleSelectFolder}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          className="flex items-center gap-1.5 text-[10px] font-medium text-[#00ff41] hover:text-[#00ff41]/80 bg-[#00ff41]/10 hover:bg-[#00ff41]/20 rounded-sm px-2.5 py-1.5 cursor-pointer transition-all border border-[#00ff41]/10 hover:border-[#00ff41]/20"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
            {rootPath ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            )}
          </svg>
          {rootPath ? "Change" : "Open Folder"}
        </motion.button>
      </div>

      {/* Root path breadcrumb */}
      <AnimatePresence>
        {rootPath && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15, ease }}
            className="px-3 pb-2 overflow-hidden"
          >
            <div className="flex items-center gap-1.5 bg-dark-800/60 rounded-sm px-2.5 py-1.5 border border-dark-700/30">
              <svg className="w-3 h-3 text-dark-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <p className="text-[10px] text-dark-400 truncate" title={rootPath}>
                {rootPath}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File tree or empty state */}
      {rootEntries.length > 0 ? (
        <div className="flex-1 overflow-y-auto px-1.5 pb-2 min-h-0 scrollbar-thin">
          {rootEntries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              onFileClick={handleFileClick}
              selectedPath={preview?.path}
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-3">
          <div className="w-10 h-10 rounded-sm bg-dark-800/60 border border-dark-700/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-dark-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <p className="text-[11px] text-dark-500 text-center leading-relaxed">
            {rootPath ? "This folder is empty" : "Open a folder to browse\nand attach project files"}
          </p>
        </div>
      )}

      {/* File preview panel */}
      <AnimatePresence>
        {(preview || loadingFile) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease }}
            className="border-t border-[#00ff41]/10 overflow-hidden"
          >
            {loadingFile ? (
              <div className="px-3 py-4 flex items-center justify-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin text-[#00ff41]/60" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs text-dark-400">Reading file…</span>
              </div>
            ) : preview?.error ? (
              <div className="px-3 py-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-xs text-red-400">{preview.error}</p>
                </div>
                <button
                  onClick={() => setPreview(null)}
                  className="text-[10px] text-dark-500 hover:text-dark-300 transition-colors cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            ) : preview?.content != null ? (
              <div className="flex flex-col max-h-[200px]">
                {/* Preview header */}
                <div className="flex items-center justify-between px-3 py-2 bg-dark-800/40">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileTypeIcon name={preview.name} />
                    <span className="text-[11px] text-dark-100 truncate font-medium">{preview.name}</span>
                    <span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 ${extColor(preview.name)} bg-dark-700/50`}>
                      {extLabel(preview.name) || "FILE"}
                    </span>
                    <span className="text-[10px] text-dark-500">{formatSize(preview.size)}{preview.extra || ""}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 rounded-sm px-2.5 py-1.5 border border-emerald-500/20">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Attached
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreview(null)}
                      className="text-dark-500 hover:text-dark-300 p-1 rounded-md hover:bg-dark-700/50 transition-all cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                {/* Code preview */}
                <pre className="flex-1 overflow-auto px-3 py-2 text-[11px] leading-relaxed text-dark-300 font-mono whitespace-pre bg-dark-900/40">
                  {preview.content.length > 50000
                    ? preview.content.slice(0, 50000) + "\n\n… (truncated)"
                    : preview.content}
                </pre>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

