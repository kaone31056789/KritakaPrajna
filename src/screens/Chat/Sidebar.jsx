import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../../core/store";
import {
  chatsStore,
  newChat,
  setActiveChat,
  deleteChat,
  renameChat,
  togglePinChat,
  setChatFolder,
  createFolder,
  deleteFolder,
  searchChats,
} from "../../core/chats";
import { chatToMarkdown, regenerateTitle } from "../../core/send";
import { EASE_OUT, T } from "../../design/motion";
import Icon from "../../ui/icons";
import { NeuButton, NeuInput, NeuModal, NeuPopover, MenuItem, SectionLabel } from "../../ui/primitives";
import { toast } from "../../ui/Toaster";

function ChatRow({ chat, active, folders }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title || "");
  const [confirmDel, setConfirmDel] = useState(false);
  const menuBtnRef = useRef(null);

  useEffect(() => {
    if (!confirmDel) return undefined;
    const t = setTimeout(() => setConfirmDel(false), 2400);
    return () => clearTimeout(t);
  }, [confirmDel]);

  const commitRename = () => {
    renameChat(chat.id, draft);
    setRenaming(false);
  };

  const exportChat = async () => {
    const md = chatToMarkdown(chat);
    try {
      if (window.electronAPI?.writeClipboardText) await window.electronAPI.writeClipboardText(md);
      else await navigator.clipboard.writeText(md);
      toast.success("Chat copied as Markdown");
    } catch {
      toast.error("Export failed");
    }
  };

  const downloadFile = (content, ext, mime) => {
    try {
      const name = `${(chat.title || "chat").replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "chat"}.${ext}`;
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Exported ${name}`);
    } catch {
      toast.error("Export failed");
    }
  };

  const exportMarkdownFile = () => downloadFile(chatToMarkdown(chat), "md", "text/markdown");
  const exportJsonFile = () =>
    downloadFile(JSON.stringify(chat, null, 2), "json", "application/json");

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => setActiveChat(chat.id)}
        className={`w-full flex items-center gap-2 pl-3 pr-9 h-9 rounded-sm text-left ${
          active ? "bg-deep [box-shadow:var(--neu-inset-sm)] text-hi" : "text-body hover:bg-surface-2 hover:text-hi"
        }`}
        style={{ transition: "background 140ms var(--ease-out), color 140ms var(--ease-out)" }}
      >
        {chat.pinned && <Icon name="pin" size={11} className="text-accent shrink-0" />}
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent border-none outline-none text-[12.5px] text-hi min-w-0"
          />
        ) : (
          <span className={`flex-1 truncate text-[12.5px] ${chat.special ? "text-accent" : ""}`}>
            {chat.special && <Icon name="spark" size={11} className="inline-block mr-1 -mt-0.5 text-accent" />}
            {chat.title || "New chat"}
          </span>
        )}
      </button>
      {/* Quick actions — pin + delete revealed on hover inside a solid floating
          chip, so the icons read clearly instead of ghosting over the title.
          confirmDel forces the chip open so the confirm state is always seen. */}
      <div
        className={`absolute right-9 top-1/2 -translate-y-1/2 flex items-center gap-0.5 px-1 h-7 rounded-full bg-surface-2 [box-shadow:var(--neu-raised-sm)] ${
          confirmDel ? "opacity-100" : "opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
        }`}
        style={{ transition: "opacity 120ms var(--ease-out)" }}
      >
        <button
          type="button"
          aria-label={chat.pinned ? "Unpin chat" : "Pin chat"}
          title={chat.pinned ? "Unpin chat" : "Pin chat"}
          onClick={(e) => {
            e.stopPropagation();
            togglePinChat(chat.id);
            toast.success(chat.pinned ? "Chat unpinned" : "Chat pinned");
          }}
          className={`pressable w-6 h-6 rounded-xs flex items-center justify-center ${
            chat.pinned ? "text-accent" : "text-dim hover:text-accent"
          }`}
        >
          <Icon name="pin" size={12} />
        </button>
        <button
          type="button"
          aria-label={confirmDel ? "Click again to confirm delete" : "Delete chat"}
          title={confirmDel ? "Click again to confirm" : "Delete chat"}
          onClick={(e) => {
            e.stopPropagation();
            if (confirmDel) {
              deleteChat(chat.id);
              toast.success("Chat deleted");
            } else {
              setConfirmDel(true);
            }
          }}
          className={`pressable w-6 h-6 rounded-xs flex items-center justify-center ${
            confirmDel ? "text-err" : "text-dim hover:text-err"
          }`}
          style={
            confirmDel
              ? { background: "var(--err-soft)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--err) 35%, transparent)" }
              : undefined
          }
        >
          <Icon name="trash" size={12} />
        </button>
      </div>
      {/* Kebab stays visible at rest so the full action menu (Pin / Delete /
          Rename / Export) is always discoverable — no hover guessing. */}
      <button
        type="button"
        ref={menuBtnRef}
        aria-label="Chat menu"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((o) => !o);
        }}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-xs flex items-center justify-center hover:text-hi hover:bg-surface-3 ${
          menuOpen || active ? "text-hi" : "text-dim"
        }`}
        style={{ opacity: 1, transition: "color 120ms var(--ease-out), background 120ms var(--ease-out)" }}
      >
        <Icon name="dots" size={18} strokeWidth={2.25} />
      </button>
      <NeuPopover portal anchorRef={menuBtnRef} open={menuOpen} onClose={() => setMenuOpen(false)} anchor="bottom-end" width={190}>
        <MenuItem icon="pin" onClick={() => { togglePinChat(chat.id); setMenuOpen(false); }}>
          {chat.pinned ? "Unpin" : "Pin"}
        </MenuItem>
        <MenuItem icon="edit" onClick={() => { setDraft(chat.title || ""); setRenaming(true); setMenuOpen(false); }}>
          Rename
        </MenuItem>
        <MenuItem icon="wand" onClick={() => { setMenuOpen(false); toast.info("Renaming with AI…"); regenerateTitle(chat.id); }}>
          Rename with AI
        </MenuItem>
        <MenuItem icon="download" onClick={() => { exportMarkdownFile(); setMenuOpen(false); }}>
          Export as Markdown
        </MenuItem>
        <MenuItem icon="file" onClick={() => { exportJsonFile(); setMenuOpen(false); }}>
          Export as JSON
        </MenuItem>
        <MenuItem icon="copy" onClick={() => { exportChat(); setMenuOpen(false); }}>
          Copy as Markdown
        </MenuItem>
        {folders.length > 0 && (
          <div className="my-1 border-t border-line pt-1">
            {folders.map((f) => (
              <MenuItem
                key={f.id}
                icon="folder"
                onClick={() => { setChatFolder(chat.id, chat.folderId === f.id ? null : f.id); setMenuOpen(false); }}
              >
                {chat.folderId === f.id ? `✓ ${f.name}` : f.name}
              </MenuItem>
            ))}
          </div>
        )}
        <div className="my-1 border-t border-line pt-1">
          <MenuItem icon="trash" danger onClick={() => { deleteChat(chat.id); toast.success("Chat deleted"); setMenuOpen(false); }}>
            Delete
          </MenuItem>
        </div>
      </NeuPopover>
    </div>
  );
}

export default function Sidebar() {
  const state = useStore(chatsStore);
  const [query, setQuery] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState({});
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderName, setFolderName] = useState("");

  const submitFolder = () => {
    const name = folderName.trim();
    if (!name) return;
    createFolder(name);
    setFolderName("");
    setFolderModalOpen(false);
  };

  const filtered = useMemo(() => searchChats(state, query), [state, query]);

  const pinned = filtered.filter((c) => c.pinned);
  const byFolder = useMemo(() => {
    const map = new Map();
    for (const f of state.folders) map.set(f.id, []);
    const loose = [];
    for (const c of filtered) {
      if (c.pinned) continue;
      if (c.folderId && map.has(c.folderId)) map.get(c.folderId).push(c);
      else loose.push(c);
    }
    return { map, loose };
  }, [filtered, state.folders]);

  return (
    <aside className="app-sidebar w-[248px] shrink-0 h-full flex flex-col border-r border-line">
      <div className="p-3 pb-2 flex flex-col gap-2.5">
        <NeuButton variant="accent" icon="plus" className="w-full" onClick={() => newChat()}>
          New chat
        </NeuButton>
        <div className="relative">
          <Icon name="search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full h-8 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[12px] text-hi placeholder:text-faint pl-8 pr-3 focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)]"
            style={{ transition: "box-shadow 150ms var(--ease-out)" }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-0.5">
        {pinned.length > 0 && (
          <>
            <SectionLabel className="px-1 pt-2 pb-1">Pinned</SectionLabel>
            {pinned.map((c) => (
              <ChatRow key={c.id} chat={c} active={c.id === state.activeChatId} folders={state.folders} />
            ))}
          </>
        )}

        {state.folders.map((f) => {
          const chats = byFolder.map.get(f.id) || [];
          const collapsed = collapsedFolders[f.id];
          return (
            <div key={f.id} className="pt-2">
              <div className="group/folder flex items-center gap-1 px-1 pb-1">
                <button
                  type="button"
                  onClick={() => setCollapsedFolders((s) => ({ ...s, [f.id]: !s[f.id] }))}
                  className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-faint hover:text-dim"
                >
                  <motion.span animate={{ rotate: collapsed ? 0 : 90 }} transition={{ duration: T, ease: EASE_OUT }} className="flex">
                    <Icon name="chevronRight" size={10} />
                  </motion.span>
                  {f.name}
                  <span className="text-faint/60 normal-case tracking-normal">({chats.length})</span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete folder ${f.name}`}
                  onClick={() => deleteFolder(f.id)}
                  className="ml-auto opacity-0 group-hover/folder:opacity-100 text-faint hover:text-err"
                >
                  <Icon name="trash" size={11} />
                </button>
              </div>
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: T, ease: EASE_OUT }}
                    className="overflow-hidden flex flex-col gap-0.5"
                  >
                    {chats.map((c) => (
                      <ChatRow key={c.id} chat={c} active={c.id === state.activeChatId} folders={state.folders} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {byFolder.loose.length > 0 && (
          <>
            <SectionLabel className="px-1 pt-2 pb-1">Chats</SectionLabel>
            {byFolder.loose.map((c) => (
              <ChatRow key={c.id} chat={c} active={c.id === state.activeChatId} folders={state.folders} />
            ))}
          </>
        )}

        {filtered.length === 0 && (
          <p className="text-[12px] text-faint text-center pt-8">
            {query ? "No chats match." : "No chats yet — start one."}
          </p>
        )}
      </div>

      <div className="p-3 pt-0">
        <button
          type="button"
          onClick={() => { setFolderName(""); setFolderModalOpen(true); }}
          className="pressable w-full h-8 rounded-sm flex items-center justify-center gap-1.5 text-[11.5px] text-faint hover:text-body"
        >
          <Icon name="folder" size={13} /> New folder
        </button>
      </div>

      <NeuModal
        open={folderModalOpen}
        onClose={() => setFolderModalOpen(false)}
        title="New folder"
        width={360}
        footer={
          <>
            <NeuButton variant="ghost" onClick={() => setFolderModalOpen(false)}>Cancel</NeuButton>
            <NeuButton variant="accent" onClick={submitFolder} disabled={!folderName.trim()}>Create</NeuButton>
          </>
        }
      >
        <NeuInput
          autoFocus
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submitFolder(); }
          }}
          placeholder="Folder name"
        />
      </NeuModal>
    </aside>
  );
}
