import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { computeDiff } from "../utils/diffEngine";

const ease = [0.4, 0, 0.2, 1];

function LineNum({ n }) {
  return (
    <span className="inline-block w-8 text-right pr-2 text-[11px] text-dark-600 select-none shrink-0 font-mono">
      {n}
    </span>
  );
}

/** Side-by-side diff viewer with accept/reject */
export default function DiffViewer({ original, modified, fileName, filePath, onAccept, onReject }) {
  const [copied, setCopied] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const diff = useMemo(() => computeDiff(original, modified), [original, modified]);

  // Build left (original) and right (modified) line arrays with alignment
  const { leftLines, rightLines } = useMemo(() => {
    const left = [];
    const right = [];
    let leftNum = 0;
    let rightNum = 0;

    for (const entry of diff) {
      if (entry.type === "equal") {
        leftNum++;
        rightNum++;
        left.push({ num: leftNum, text: entry.value, type: "equal" });
        right.push({ num: rightNum, text: entry.value, type: "equal" });
      } else if (entry.type === "remove") {
        leftNum++;
        left.push({ num: leftNum, text: entry.value, type: "remove" });
        right.push({ num: null, text: "", type: "pad" });
      } else if (entry.type === "add") {
        rightNum++;
        left.push({ num: null, text: "", type: "pad" });
        right.push({ num: rightNum, text: entry.value, type: "add" });
      }
    }
    return { leftLines: left, rightLines: right };
  }, [diff]);

  const stats = useMemo(() => {
    let adds = 0, removes = 0;
    for (const d of diff) {
      if (d.type === "add") adds++;
      if (d.type === "remove") removes++;
    }
    return { adds, removes };
  }, [diff]);

  const handleCopy = () => {
    navigator.clipboard.writeText(modified).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleAccept = () => {
    setAccepted(true);
    onAccept?.(modified, filePath);
  };

  const lineBg = (type) => {
    switch (type) {
      case "add": return "bg-emerald-500/10";
      case "remove": return "bg-red-500/10";
      case "pad": return "bg-dark-800/30";
      default: return "";
    }
  };

  const lineTextColor = (type) => {
    switch (type) {
      case "add": return "text-emerald-300";
      case "remove": return "text-red-300";
      default: return "text-dark-200";
    }
  };

  const linePrefix = (type) => {
    switch (type) {
      case "add": return "+";
      case "remove": return "−";
      default: return " ";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease }}
      className="rounded-xl border border-dark-700/40 overflow-hidden bg-dark-900 my-2"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-dark-800/60 border-b border-dark-700/30">
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-saffron-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-xs text-dark-200 font-medium truncate max-w-[200px]">
            {fileName || "Diff View"}
          </span>
          <span className="text-[10px] text-dark-500 ml-1">
            <span className="text-emerald-400">+{stats.adds}</span>
            {" "}
            <span className="text-red-400">−{stats.removes}</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="text-[10px] text-dark-400 hover:text-dark-200 px-2 py-1 rounded-md hover:bg-white/[0.05] transition-colors cursor-pointer flex items-center gap-1"
          >
            {copied ? (
              <>
                <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Side-by-side diff */}
      <div className="flex overflow-x-auto max-h-[400px] overflow-y-auto text-[12px] font-mono leading-5">
        {/* Left: Original */}
        <div className="flex-1 min-w-0 border-r border-dark-700/30">
          <div className="px-1 py-0.5 text-[10px] text-dark-500 bg-dark-800/40 border-b border-dark-700/20 text-center uppercase tracking-wider">
            Original
          </div>
          {leftLines.map((line, i) => (
            <div key={i} className={`flex items-start min-h-[20px] ${lineBg(line.type)}`}>
              <LineNum n={line.num || ""} />
              <span className={`flex-1 pr-2 ${lineTextColor(line.type)}`}>
                <span className={`inline-block w-3 text-center ${line.type === "remove" ? "text-red-400 font-bold" : "text-dark-700"}`}>
                  {linePrefix(line.type)}
                </span>
                {line.text}
              </span>
            </div>
          ))}
        </div>

        {/* Right: Modified */}
        <div className="flex-1 min-w-0">
          <div className="px-1 py-0.5 text-[10px] text-dark-500 bg-dark-800/40 border-b border-dark-700/20 text-center uppercase tracking-wider">
            Modified
          </div>
          {rightLines.map((line, i) => (
            <div key={i} className={`flex items-start min-h-[20px] ${lineBg(line.type)}`}>
              <LineNum n={line.num || ""} />
              <span className={`flex-1 pr-2 ${lineTextColor(line.type)}`}>
                <span className={`inline-block w-3 text-center ${line.type === "add" ? "text-emerald-400 font-bold" : "text-dark-700"}`}>
                  {linePrefix(line.type)}
                </span>
                {line.text}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <AnimatePresence>
        {!accepted ? (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease }}
            className="flex items-center gap-2 px-3 py-2.5 bg-dark-800/40 border-t border-dark-700/30"
          >
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.12, ease }}
              onClick={handleAccept}
              className="flex items-center gap-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/20 rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.12, ease }}
              onClick={() => onReject?.()}
              className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
              Reject
            </motion.button>
            <span className="text-[10px] text-dark-500 ml-auto">
              {filePath ? "Will write to file" : "Copy to use"}
            </span>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease }}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-500/5 border-t border-emerald-500/10"
          >
            <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-xs text-emerald-400">
              {filePath ? "Changes applied to file" : "Code copied to clipboard"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
