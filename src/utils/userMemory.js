export const USER_MEMORY_STORAGE_KEY = "openrouter_user_memory";

export const DEFAULT_USER_MEMORY = {
  preferences: [],
  coding: [],
  context: [],
  autoMode: true,
};

export const MEMORY_CATEGORY_DEFS = [
  {
    id: "preferences",
    label: "Preferences",
    description: "How the assistant should respond and format answers.",
  },
  {
    id: "coding",
    label: "Coding Style",
    description: "Languages and code-style defaults to prefer.",
  },
  {
    id: "context",
    label: "Context Memory",
    description: "Ongoing goals or projects the app should remember.",
  },
];

const LANGUAGE_PATTERNS = [
  { pattern: /\bpython\b/i, memory: "User prefers Python" },
  { pattern: /\btypescript\b|\btype script\b/i, memory: "User prefers TypeScript" },
  { pattern: /\bjavascript\b|\bjava script\b/i, memory: "User prefers JavaScript" },
  { pattern: /\bc\+\+\b|\bcpp\b/i, memory: "User prefers C++" },
  { pattern: /\bc#\b|\bc sharp\b/i, memory: "User prefers C#" },
  { pattern: /\bjava\b/i, memory: "User prefers Java" },
  { pattern: /\brust\b/i, memory: "User prefers Rust" },
  { pattern: /\bgo\b|\bgolang\b/i, memory: "User prefers Go" },
];

const AUTO_MEMORY_RULES = {
  preferences: [
    {
      pattern: /\b(keep it short|short answers?|brief answers?|be concise|concise reply|keep answers concise)\b/i,
      memory: "User prefers short answers",
    },
    {
      pattern: /\b(step[- ]by[- ]step|walk me through|explain step by step)\b/i,
      memory: "User prefers step-by-step explanations",
    },
    {
      pattern: /\b(detailed answers?|in[- ]depth explanation|explain in detail|go deeper)\b/i,
      memory: "User prefers detailed explanations",
    },
    {
      pattern: /\b(just the code|code only|only code|skip the explanation)\b/i,
      memory: "User prefers code-first answers",
    },
  ],
  coding: [
    {
      pattern: /\b(with comments|add comments|include comments|comment the code)\b/i,
      memory: "User likes code with comments",
    },
    {
      pattern: /\b(clean code|readable code|best practices|well-structured code)\b/i,
      memory: "User prefers clean, readable code",
    },
  ],
  context: [
    {
      pattern: /\b(dsa|data structures and algorithms|leetcode)\b/i,
      memory: "User is preparing for DSA",
    },
    {
      pattern: /\b(building an ai app|building an ai chatbot|multi ai chatbot|ai assistant app)\b/i,
      memory: "User is building an AI app",
    },
    {
      pattern: /\b(interview prep|coding interview|job interview)\b/i,
      memory: "User is preparing for coding interviews",
    },
  ],
};

function cleanEntry(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

function normalizeEntryKey(text) {
  return cleanEntry(text).toLowerCase();
}

export function normalizeUserMemory(memory) {
  const source = memory || {};
  return {
    preferences: Array.isArray(source.preferences) ? source.preferences.map(cleanEntry).filter(Boolean) : [],
    coding: Array.isArray(source.coding) ? source.coding.map(cleanEntry).filter(Boolean) : [],
    context: Array.isArray(source.context) ? source.context.map(cleanEntry).filter(Boolean) : [],
    autoMode: source.autoMode !== false,
  };
}

export function hasUserMemory(memory) {
  const normalized = normalizeUserMemory(memory);
  return MEMORY_CATEGORY_DEFS.some((category) => normalized[category.id].length > 0);
}

export function isSensitiveMemoryText(text) {
  const value = cleanEntry(text);
  if (!value) return true;

  return (
    /\b(password|passcode|otp|secret|private key|api key|token)\b/i.test(value) ||
    /sk-[a-z0-9_-]{8,}/i.test(value) ||
    /hf_[a-z0-9]{8,}/i.test(value) ||
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(value) ||
    /\b(?:\+?\d[\d -]{7,}\d)\b/.test(value)
  );
}

function getConflictGroup(category, entry) {
  const value = normalizeEntryKey(entry);

  if (category === "preferences") {
    if (/short answers?|concise/.test(value) || /detailed explanations?|in-depth/.test(value)) {
      return "response-length";
    }
    if (/step-by-step/.test(value)) return "explanation-style";
    if (/code-first|only code/.test(value)) return "output-style";
  }

  if (category === "coding") {
    if (/prefers python|prefers typescript|prefers javascript|prefers c\+\+|prefers c#|prefers java|prefers rust|prefers go/.test(value)) {
      return "language";
    }
    if (/with comments/.test(value)) return "comments";
  }

  return null;
}

function mergeCategoryEntries(existingEntries, incomingEntries, category) {
  let next = [...(existingEntries || [])];

  for (const rawEntry of incomingEntries || []) {
    const entry = cleanEntry(rawEntry);
    if (!entry || isSensitiveMemoryText(entry)) continue;

    const conflictGroup = getConflictGroup(category, entry);
    if (conflictGroup) {
      next = next.filter((existing) => getConflictGroup(category, existing) !== conflictGroup);
    }

    const duplicate = next.some((existing) => normalizeEntryKey(existing) === normalizeEntryKey(entry));
    if (!duplicate) next.push(entry);
  }

  return next;
}

export function mergeUserMemory(baseMemory, additions) {
  const base = normalizeUserMemory(baseMemory);
  const incoming = normalizeUserMemory(additions);
  const nextAutoMode =
    additions && Object.prototype.hasOwnProperty.call(additions, "autoMode")
      ? additions.autoMode !== false
      : base.autoMode;

  return {
    preferences: mergeCategoryEntries(base.preferences, incoming.preferences, "preferences"),
    coding: mergeCategoryEntries(base.coding, incoming.coding, "coding"),
    context: mergeCategoryEntries(base.context, incoming.context, "context"),
    autoMode: nextAutoMode,
  };
}

export function updateUserMemoryEntry(memory, category, index, nextValue) {
  const normalized = normalizeUserMemory(memory);
  if (!normalized[category]) return normalized;

  const nextEntries = normalized[category].filter((_, itemIndex) => itemIndex !== index);
  return mergeUserMemory(
    {
      ...normalized,
      [category]: nextEntries,
    },
    {
      ...DEFAULT_USER_MEMORY,
      [category]: [nextValue],
      autoMode: normalized.autoMode,
    }
  );
}

export function removeUserMemoryEntry(memory, category, index) {
  const normalized = normalizeUserMemory(memory);
  if (!normalized[category]) return normalized;

  return {
    ...normalized,
    [category]: normalized[category].filter((_, itemIndex) => itemIndex !== index),
  };
}

export function detectMemoryFromMessage(text) {
  const value = cleanEntry(text);
  if (!value || isSensitiveMemoryText(value)) return normalizeUserMemory(DEFAULT_USER_MEMORY);

  const detected = normalizeUserMemory(DEFAULT_USER_MEMORY);

  for (const rule of AUTO_MEMORY_RULES.preferences) {
    if (rule.pattern.test(value)) detected.preferences.push(rule.memory);
  }

  for (const rule of AUTO_MEMORY_RULES.coding) {
    if (rule.pattern.test(value)) detected.coding.push(rule.memory);
  }

  for (const rule of AUTO_MEMORY_RULES.context) {
    if (rule.pattern.test(value)) detected.context.push(rule.memory);
  }

  for (const language of LANGUAGE_PATTERNS) {
    if (language.pattern.test(value)) {
      detected.coding.push(language.memory);
      break;
    }
  }

  return normalizeUserMemory(detected);
}

function extractTextChunks(value, chunks = []) {
  if (!value) return chunks;

  if (typeof value === "string") {
    const cleaned = cleanEntry(value);
    if (cleaned && !isSensitiveMemoryText(cleaned)) chunks.push(cleaned);
    return chunks;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => extractTextChunks(item, chunks));
    return chunks;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((item) => extractTextChunks(item, chunks));
    return chunks;
  }

  return chunks;
}

function inferContextMemory(text) {
  const value = cleanEntry(text);
  if (!value || isSensitiveMemoryText(value)) return [];

  const results = [];
  const lower = value.toLowerCase();

  if (/i am a programmer|i'm a programmer|software engineer|developer/.test(lower)) {
    results.push("User is a programmer");
  }
  if (/i am a student|i'm a student|studying|college|school/.test(lower)) {
    results.push("User is a student");
  }
  if (/building|working on|creating/.test(lower) && /app|project|chatbot|assistant|website/.test(lower)) {
    results.push(value);
  }

  return results;
}

export function extractMemoryFromImport(source) {
  const normalized = normalizeUserMemory(DEFAULT_USER_MEMORY);
  const chunks = extractTextChunks(source).slice(0, 80);

  for (const chunk of chunks) {
    const detected = detectMemoryFromMessage(chunk);
    normalized.preferences.push(...detected.preferences);
    normalized.coding.push(...detected.coding);
    normalized.context.push(...detected.context);

    if (/prefers|likes|usually|always|tends to|wants/i.test(chunk)) {
      const lower = chunk.toLowerCase();
      if (/short|concise|brief/.test(lower)) normalized.preferences.push("User prefers short answers");
      if (/step[- ]by[- ]step|detailed|in depth/.test(lower)) normalized.preferences.push("User prefers step-by-step explanations");
      if (/python|javascript|typescript|c\+\+|cpp|rust|java|go|golang|c#/.test(lower)) {
        const languageDetected = detectMemoryFromMessage(chunk);
        normalized.coding.push(...languageDetected.coding);
      }
    }

    normalized.context.push(...inferContextMemory(chunk));
  }

  return mergeUserMemory(DEFAULT_USER_MEMORY, normalized);
}

export function parseStructuredAIResponse(text) {
  if (!text || typeof text !== "string") return normalizeUserMemory(DEFAULT_USER_MEMORY);

  const result = { preferences: [], coding: [], context: [] };

  const SECTION_PATTERNS = [
    { id: "preferences", pattern: /^preferences?(\s+memory)?:?\s*$/i },
    { id: "coding", pattern: /^coding(\s+style)?:?\s*$/i },
    { id: "context", pattern: /^context(\s+memory)?:?\s*$/i },
  ];

  let currentSection = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let sectionMatched = false;
    for (const { id, pattern } of SECTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        currentSection = id;
        sectionMatched = true;
        break;
      }
    }
    if (sectionMatched) continue;

    if (currentSection) {
      const match = trimmed.match(/^(?:[-*•]|\d+[.)]) +(.+)/);
      if (match) {
        const entry = cleanEntry(match[1]);
        if (entry && !isSensitiveMemoryText(entry)) {
          result[currentSection].push(entry);
        }
      }
    }
  }

  return mergeUserMemory(DEFAULT_USER_MEMORY, result);
}

function buildMemorySection(title, entries) {
  if (!entries.length) return "";
  return `${title}:\n${entries.map((entry) => `- ${entry}`).join("\n")}`;
}

export function buildSystemPromptWithMemory(basePrompt, memory) {
  const normalized = normalizeUserMemory(memory);
  const sections = [
    buildMemorySection("User Preferences", normalized.preferences),
    buildMemorySection("Coding Style", normalized.coding),
    buildMemorySection("Context Memory", normalized.context),
  ].filter(Boolean);

  if (!sections.length) return basePrompt;

  const memoryBlock = [
    "## User Memory",
    "You MUST follow these remembered user preferences unless the latest user message explicitly overrides them.",
    "Use this memory to adapt answer length, explanation style, coding defaults, and project context.",
    "Do not mention the memory unless it is directly relevant to the answer.",
    "",
    ...sections,
  ].join("\n");

  const prompt = cleanEntry(basePrompt) ? String(basePrompt).trim() : "";
  return prompt ? `${prompt}\n\n${memoryBlock}` : memoryBlock;
}
