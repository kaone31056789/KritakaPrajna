import { createStore, readJSON, persistJSON, generateId } from "./store";

/* Prompt library — reusable prompt snippets with tags, search, and usage tracking. */

const PROMPTS_KEY = "kp_prompt_library";

const SEED_PROMPTS = [
  {
    id: "seed-explain",
    title: "Explain like I'm busy",
    body: "Explain the following in 3 short paragraphs: what it is, why it matters, and one practical takeaway. No fluff.\n\n",
    tags: ["writing", "learning"],
    uses: 0,
    seed: true,
  },
  {
    id: "seed-review",
    title: "Code review",
    body: "Review this code for bugs, edge cases, and readability. Rank findings by severity, quote the exact lines, and suggest minimal fixes.\n\n```\n\n```",
    tags: ["code"],
    uses: 0,
    seed: true,
  },
  {
    id: "seed-rewrite",
    title: "Rewrite, keep my voice",
    body: "Rewrite the text below to be clearer and tighter without changing its meaning or tone. Return only the rewrite.\n\n",
    tags: ["writing"],
    uses: 0,
    seed: true,
  },
];

function loadPrompts() {
  const saved = readJSON(PROMPTS_KEY, null);
  if (Array.isArray(saved)) return saved;
  return SEED_PROMPTS.map((p) => ({ ...p, createdAt: Date.now(), updatedAt: Date.now() }));
}

export const promptsStore = createStore({
  prompts: loadPrompts(),
});

function write(prompts) {
  promptsStore.set({ prompts });
  persistJSON(PROMPTS_KEY, prompts);
}

export function createPrompt({ title, body, tags = [] }) {
  const prompt = {
    id: generateId(),
    title: (title || "Untitled prompt").trim(),
    body: body || "",
    tags,
    uses: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  write([prompt, ...promptsStore.get().prompts]);
  return prompt;
}

export function updatePrompt(id, patch) {
  write(
    promptsStore.get().prompts.map((p) =>
      p.id === id ? { ...p, ...patch, seed: false, updatedAt: Date.now() } : p
    )
  );
}

export function deletePrompt(id) {
  write(promptsStore.get().prompts.filter((p) => p.id !== id));
}

export function recordPromptUse(id) {
  write(
    promptsStore.get().prompts.map((p) => (p.id === id ? { ...p, uses: (p.uses || 0) + 1 } : p))
  );
}

export function searchPrompts(prompts, query) {
  const q = (query || "").trim().toLowerCase();
  const list = [...prompts].sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!q) return list;
  return list.filter(
    (p) =>
      p.title.toLowerCase().includes(q) ||
      p.body.toLowerCase().includes(q) ||
      (p.tags || []).some((t) => t.toLowerCase().includes(q))
  );
}
