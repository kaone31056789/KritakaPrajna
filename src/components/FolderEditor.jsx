import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const PRESET_COLORS = [
  "#00ff41", "#00d4ff", "#ff00d4", "#ff9900", "#ff3333", "#ce00ff", "#00ffcc", "#ffffff"
];

export const DEFAULT_FOLDERS = [];

export default function FolderEditor({ folders = [], onSaveFolders }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);

  const handleAddNew = () => {
    const newFolder = {
      id: "folder_" + Date.now(),
      name: "New Folder",
      color: "#00d4ff",
    };
    setEditingId(newFolder.id);
    setDraft({ ...newFolder });
  };

  const handleSelect = (f) => {
    setEditingId(f.id);
    setDraft({ ...f });
  };

  const handleSaveDraft = () => {
    if (!draft.name.trim()) return;
    
    let next;
    const exists = folders.some((f) => f.id === draft.id);
    if (exists) {
      next = folders.map((f) => (f.id === draft.id ? draft : f));
    } else {
      next = [...folders, draft];
    }
    onSaveFolders(next);
    setEditingId(null);
    setDraft(null);
  };

  const handleDelete = (id) => {
    if (!window.confirm("Are you sure you want to delete this folder? Chats inside will be moved to the uncategorized section.")) return;
    const next = folders.filter((f) => f.id !== id);
    onSaveFolders(next);
    if (editingId === id) {
      setEditingId(null);
      setDraft(null);
    }
  };

  return (
    <div className="w-full max-w-2xl text-sm font-mono flex flex-col h-full gap-5">
      <div className="flex items-center justify-between border-b border-white/5 pb-3">
        <div>
          <h2 className="text-[#e0e0e0] font-semibold text-lg flex items-center gap-2">
            📂 Chat Folders
          </h2>
          <p className="text-[#b0b0b0]/60 text-xs mt-1">
            Create folders to organize your pinned and recent chats.
          </p>
        </div>
      </div>

      <div className="flex gap-4 min-h-[300px]">
        {/* Left: Folders List */}
        <div className="w-1/3 flex flex-col gap-2 border-r border-white/5 pr-4">
          <button
            onClick={handleAddNew}
            className="w-full py-2 px-3 rounded-sm border border-dashed border-white/20 text-[#b0b0b0] hover:text-[#e0e0e0] hover:border-white/40 hover:bg-white/5 transition-colors text-left flex items-center gap-2"
          >
            <span className="text-xl leading-none">+</span> New Folder
          </button>

          <div className="flex-1 overflow-y-auto space-y-1 mt-2">
            {folders.length === 0 && (
              <div className="text-xs text-[#b0b0b0]/40 italic p-2 hidden">No folders yet</div>
            )}
            {folders.map((f) => (
              <div
                key={f.id}
                onClick={() => handleSelect(f)}
                className={`flex items-center justify-between px-3 py-2 rounded-sm cursor-pointer transition-all ${
                  editingId === f.id
                    ? "bg-[#111111] border border-white/10 text-white"
                    : "hover:bg-white/5 text-[#b0b0b0]"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
                  <span className="truncate">{f.name}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(f.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-1"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Editor */}
        <div className="w-2/3 pl-2">
          <AnimatePresence mode="wait">
            {!editingId ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center h-full text-[#b0b0b0]/40 text-xs italic"
              >
                Select a folder to edit or create a new one.
              </motion.div>
            ) : (
              <motion.div
                key="editor"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs uppercase tracking-wider text-[#b0b0b0]/60 mb-2">
                    Folder Name
                  </label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-sm px-3 py-2 text-sm text-[#e0e0e0] placeholder-[#b0b0b0]/30 focus:outline-none focus:border-[#00ff41]/50 focus:ring-1 focus:ring-[#00ff41]/50 transition-all font-mono"
                    placeholder="e.g. Work Projects"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-[#b0b0b0]/60 mb-2">
                    Accent Color
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setDraft({ ...draft, color: c })}
                        className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${
                          draft.color === c ? "border-[#e0e0e0] scale-110" : "border-transparent hover:scale-110"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-xs text-[#b0b0b0]/60">Custom:</span>
                    <input
                      type="color"
                      value={draft.color}
                      onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                      className="bg-transparent border-0 w-8 h-8 cursor-pointer p-0"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5 flex gap-3">
                  <button
                    onClick={handleSaveDraft}
                    disabled={!draft.name.trim()}
                    className="flex-1 py-2 px-4 rounded-sm bg-[#00ff41]/10 text-[#00ff41] hover:bg-[#00ff41]/20 border border-[#00ff41]/20 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Save Folder
                  </button>
                  <button
                    onClick={() => {
                        setEditingId(null);
                        setDraft(null);
                    }}
                    className="py-2 px-4 rounded-sm border border-white/10 text-[#b0b0b0] hover:text-[#e0e0e0] hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
