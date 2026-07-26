import { createStore, readJSON, readRaw, writeRaw, writeJSON, persistJSON, generateId } from "./store";

/* Chats, folders, personas — legacy v3 storage keys, so existing data loads as-is. */

const CHATS_KEY = "openrouter_chats";
const ACTIVE_CHAT_KEY = "openrouter_active_chat";
const PERSONAS_KEY = "kp_chat_personas";
const ACTIVE_PERSONA_KEY = "kp_active_persona";
const FOLDERS_KEY = "kp_chat_folders";

/**
 * The user's actual intent text for a message. Prefers what they typed
 * (`_displayText`), and strips any inlined "[Attached file: …]```…```" dumps so
 * titles reflect the message rather than the raw file contents.
 */
export function userMessageText(msg) {
  if (!msg) return "";
  let text = typeof msg._displayText === "string" ? msg._displayText : "";
  if (!text) {
    if (typeof msg.content === "string") text = msg.content;
    else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((p) => p?.type === "text")
        .map((p) => p.text || "")
        .join(" ");
    }
  }
  return text
    .replace(/\[Attached file:[^\]]*\]\s*```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A clean, human label built from a message's attachments (file name, sans extension). */
export function attachmentLabel(msg) {
  const atts = Array.isArray(msg?._attachments) ? msg._attachments : [];
  if (atts.length === 0) return "";
  const base = String(atts[0]?.name || "file")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[._-]+/g, " ")
    .trim();
  return atts.length > 1 ? `${base} +${atts.length - 1} more` : base || "file";
}

export function deriveTitle(messages = []) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New chat";
  // Name the thread after what the user typed; if they only attached a file,
  // use the file name instead of the raw "[Attached file: …]" marker.
  let text = userMessageText(firstUser);
  if (!text) {
    text =
      attachmentLabel(firstUser) ||
      (Array.isArray(firstUser.content) && firstUser.content.some((p) => p?.type === "image_url")
        ? "Image message"
        : "");
  }
  return text.length > 44 ? `${text.slice(0, 44)}…` : text || "New chat";
}

export const chatsStore = createStore({
  chats: readJSON(CHATS_KEY, []) || [],
  activeChatId: readRaw(ACTIVE_CHAT_KEY, "") || "",
  folders: readJSON(FOLDERS_KEY, []) || [],
  personas: readJSON(PERSONAS_KEY, []) || [],
  activePersonaId: readRaw(ACTIVE_PERSONA_KEY, "") || "",
});

chatsStore.subscribe(() => {
  const s = chatsStore.get();
  persistJSON(CHATS_KEY, s.chats);
});

export function setActiveChat(id) {
  chatsStore.set({ activeChatId: id });
  writeRaw(ACTIVE_CHAT_KEY, id || "");
}

export function newChat({ personaId = "" } = {}) {
  const id = generateId();
  const chat = { id, title: "New chat", messages: [], personaId, createdAt: Date.now() };
  chatsStore.set((s) => ({ chats: [chat, ...s.chats] }));
  setActiveChat(id);
  return id;
}

export function deleteChat(id) {
  chatsStore.set((s) => {
    const chats = s.chats.filter((c) => c.id !== id);
    const activeChatId = s.activeChatId === id ? chats[0]?.id || "" : s.activeChatId;
    writeRaw(ACTIVE_CHAT_KEY, activeChatId);
    return { chats, activeChatId };
  });
}

export function patchChat(id, patch) {
  chatsStore.set((s) => ({
    chats: s.chats.map((c) => (c.id === id ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c)),
  }));
}

export function renameChat(id, title) {
  patchChat(id, { title: String(title || "").trim() || "New chat", titleLocked: true });
}

/** Set an auto-generated title — but never override a chat the user manually renamed. */
export function applyAutoTitle(id, title) {
  const t = String(title || "").trim();
  if (!t) return;
  chatsStore.set((s) => ({
    chats: s.chats.map((c) =>
      c.id === id && !c.titleLocked ? { ...c, title: t, autoTitled: true } : c
    ),
  }));
}

export function togglePinChat(id) {
  patchChat(id, (c) => ({ pinned: !c.pinned }));
}

export function setChatFolder(id, folderId) {
  patchChat(id, { folderId: folderId || null });
}

/** Append a message; creates the chat first if it doesn't exist yet. */
export function appendMessage(chatId, message) {
  const stamped = message.ts ? message : { ...message, ts: Date.now() };
  chatsStore.set((s) => {
    const exists = s.chats.some((c) => c.id === chatId);
    if (!exists) {
      const chat = {
        id: chatId,
        title: deriveTitle([stamped]),
        messages: [stamped],
        createdAt: Date.now(),
      };
      return { chats: [chat, ...s.chats] };
    }
    return {
      chats: s.chats.map((c) => {
        if (c.id !== chatId) return c;
        const messages = [...(c.messages || []), stamped];
        return { ...c, messages, title: c.title === "New chat" ? deriveTitle(messages) : c.title };
      }),
    };
  });
}

/** Patch the message at `index` (or the last message when index is -1). */
export function patchMessage(chatId, index, patch) {
  chatsStore.set((s) => ({
    chats: s.chats.map((c) => {
      if (c.id !== chatId) return c;
      const messages = [...(c.messages || [])];
      const i = index === -1 ? messages.length - 1 : index;
      if (i < 0 || i >= messages.length) return c;
      messages[i] = { ...messages[i], ...(typeof patch === "function" ? patch(messages[i]) : patch) };
      return { ...c, messages };
    }),
  }));
}

export function truncateMessages(chatId, count) {
  chatsStore.set((s) => ({
    chats: s.chats.map((c) =>
      c.id === chatId ? { ...c, messages: (c.messages || []).slice(0, count) } : c
    ),
  }));
}

/* ── Folders ── */

export function createFolder(name) {
  const folder = { id: generateId(), name: String(name || "Folder").trim() };
  chatsStore.set((s) => {
    const folders = [...s.folders, folder];
    writeJSON(FOLDERS_KEY, folders);
    return { folders };
  });
  return folder.id;
}

export function renameFolder(id, name) {
  chatsStore.set((s) => {
    const folders = s.folders.map((f) => (f.id === id ? { ...f, name } : f));
    writeJSON(FOLDERS_KEY, folders);
    return { folders };
  });
}

export function deleteFolder(id) {
  chatsStore.set((s) => {
    const folders = s.folders.filter((f) => f.id !== id);
    writeJSON(FOLDERS_KEY, folders);
    return {
      folders,
      chats: s.chats.map((c) => (c.folderId === id ? { ...c, folderId: null } : c)),
    };
  });
}

/* ── Personas ── */

export function savePersona(persona) {
  chatsStore.set((s) => {
    const exists = s.personas.some((p) => p.id === persona.id);
    const personas = exists
      ? s.personas.map((p) => (p.id === persona.id ? { ...p, ...persona } : p))
      : [...s.personas, { ...persona, id: persona.id || generateId() }];
    writeJSON(PERSONAS_KEY, personas);
    return { personas };
  });
}

export function deletePersona(id) {
  chatsStore.set((s) => {
    const personas = s.personas.filter((p) => p.id !== id);
    writeJSON(PERSONAS_KEY, personas);
    return {
      personas,
      activePersonaId: s.activePersonaId === id ? "" : s.activePersonaId,
    };
  });
}

export function setActivePersona(id) {
  chatsStore.set({ activePersonaId: id || "" });
  writeRaw(ACTIVE_PERSONA_KEY, id || "");
}

/* ── Selectors ── */

export function getActiveChat(state = chatsStore.get()) {
  return state.chats.find((c) => c.id === state.activeChatId) || null;
}

export function searchChats(state, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return state.chats;
  return state.chats.filter((c) => {
    if ((c.title || "").toLowerCase().includes(q)) return true;
    return (c.messages || []).some((m) => {
      const text = typeof m.content === "string" ? m.content : "";
      return text.toLowerCase().includes(q);
    });
  });
}
