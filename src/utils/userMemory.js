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

// Detect language from code fences (```python, ```js, etc.) or natural mentions
const LANGUAGE_PATTERNS = [
  { pattern: /```python|in python|using python|write.*python|python code|python script|\.py\b/i, memory: "User prefers Python" },
  { pattern: /```typescript|in typescript|using typescript|\.tsx?\b|tsconfig/i, memory: "User prefers TypeScript" },
  { pattern: /```javascript|in javascript|using javascript|\.jsx?\b|node\.?js|npm |yarn /i, memory: "User prefers JavaScript" },
  { pattern: /```cpp|```c\+\+|\bc\+\+\b|\bcpp\b/i, memory: "User prefers C++" },
  { pattern: /```csharp|```c#|\bc#\b|\.net\b|asp\.net/i, memory: "User prefers C#" },
  { pattern: /```java\b|in java\b|using java\b|spring boot|\.java\b/i, memory: "User prefers Java" },
  { pattern: /```rust|in rust|using rust|\.rs\b|cargo\.toml/i, memory: "User prefers Rust" },
  { pattern: /```go\b|in golang|using go\b|\.go\b|go mod/i, memory: "User prefers Go" },
  { pattern: /```php|in php|using php|laravel|symfony|\.php\b/i, memory: "User prefers PHP" },
  { pattern: /```ruby|in ruby|using ruby|rails|\.rb\b/i, memory: "User prefers Ruby" },
  { pattern: /```swift|in swift|using swift|swiftui|xcode/i, memory: "User prefers Swift" },
  { pattern: /```kotlin|in kotlin|using kotlin|android studio/i, memory: "User prefers Kotlin" },
  { pattern: /```sql|in sql|using sql|postgresql|mysql|sqlite/i, memory: "User prefers SQL" },
];

// Detect framework/stack from natural usage
const FRAMEWORK_PATTERNS = [
  { pattern: /\breact\b.*\b(component|hook|jsx|useState|useEffect)\b|\b(component|hook|jsx|useState|useEffect)\b.*\breact\b/i, memory: "User works with React" },
  { pattern: /\bnext\.?js\b|nextjs|app router|server component/i, memory: "User works with Next.js" },
  { pattern: /\bvue\b.*\b(component|composable|v-model)\b|\bvuejs\b/i, memory: "User works with Vue" },
  { pattern: /\bangular\b.*\b(component|service|module|directive)\b/i, memory: "User works with Angular" },
  { pattern: /\bdjango\b|\bflask\b|\bfastapi\b/i, memory: "User works with Python web frameworks" },
  { pattern: /\belectron\b.*\b(ipc|renderer|main process)\b/i, memory: "User is building an Electron app" },
  { pattern: /\bdocker\b|\bkubernetes\b|\bk8s\b/i, memory: "User works with containers/DevOps" },
];

const AUTO_MEMORY_RULES = {
  preferences: [
    {
      pattern: /\b(keep it short|short answers?|brief|be concise|concise|tldr|don'?t explain|no explanation)\b/i,
      memory: "User prefers short answers",
    },
    {
      pattern: /\b(step[- ]by[- ]step|walk me through|explain.*step|one step at a time|break it down)\b/i,
      memory: "User prefers step-by-step explanations",
    },
    {
      pattern: /\b(detailed|in[- ]depth|go deeper|explain more|elaborate|thorough)\b/i,
      memory: "User prefers detailed explanations",
    },
    {
      pattern: /\b(just the code|code only|only.*code|skip.*explanation|no explanation|show.*code)\b/i,
      memory: "User prefers code-first answers",
    },
    {
      pattern: /\b(in (hindi|spanish|french|german|arabic|portuguese|japanese|chinese|korean))\b/i,
      memory: (m) => `User prefers responses in ${m[2].charAt(0).toUpperCase() + m[2].slice(1)}`,
    },
  ],
  coding: [
    {
      pattern: /\b(with comments|add comments|include comments|comment the code|commented)\b/i,
      memory: "User likes code with comments",
    },
    {
      pattern: /\b(clean code|readable|best practices|well[- ]structured|maintainable)\b/i,
      memory: "User prefers clean, readable code",
    },
    {
      pattern: /\b(functional|arrow functions?|no class|avoid class)\b/i,
      memory: "User prefers functional programming style",
    },
    {
      pattern: /\b(async\/await|promises?|async functions?)\b/i,
      memory: "User prefers async/await patterns",
    },
  ],
  context: [
    {
      pattern: /\b(dsa|data structures?|algorithms?|leetcode|hackerrank|competitive programming)\b/i,
      memory: "User is practicing DSA / competitive programming",
    },
    {
      pattern: /\b(ai app|ai chatbot|ai assistant|llm app|openrouter|openai api|anthropic api|gemini api)\b/i,
      memory: "User is building an AI application",
    },
    {
      pattern: /\b(interview|interview prep|coding interview|job interview|hiring)\b/i,
      memory: "User is preparing for coding interviews",
    },
    {
      pattern: /\b(machine learning|ml model|deep learning|neural network|training|pytorch|tensorflow)\b/i,
      memory: "User works in machine learning / AI",
    },
    {
      pattern: /\b(startup|side project|freelance|client project|production app)\b/i,
      memory: "User is working on a professional/production project",
    },
    {
      pattern: /\b(beginner|just started|learning to code|new to programming|student)\b/i,
      memory: "User is learning to code",
    },
    {
      pattern: /\b(senior|experienced|years of experience|professional developer|software engineer)\b/i,
      memory: "User is an experienced developer",
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
    const m = value.match(rule.pattern);
    if (m) {
      detected.preferences.push(typeof rule.memory === "function" ? rule.memory(m) : rule.memory);
    }
  }

  for (const rule of AUTO_MEMORY_RULES.coding) {
    if (rule.pattern.test(value)) detected.coding.push(rule.memory);
  }

  for (const rule of AUTO_MEMORY_RULES.context) {
    if (rule.pattern.test(value)) detected.context.push(rule.memory);
  }

  // Detect language — stop at first match to avoid duplicates
  for (const lang of LANGUAGE_PATTERNS) {
    if (lang.pattern.test(value)) {
      detected.coding.push(lang.memory);
      break;
    }
  }

  // Detect framework/stack (can match multiple)
  for (const fw of FRAMEWORK_PATTERNS) {
    if (fw.pattern.test(value)) detected.context.push(fw.memory);
  }

  return normalizeUserMemory(detected);
}

/**
 * Scan both user message AND AI response to pick up patterns.
 * Call this after a successful AI reply.
 */
export function detectMemoryFromExchange(userText, aiText) {
  const fromUser = detectMemoryFromMessage(userText || "");
  // Scan AI response for language/framework clues (the AI often mentions what lang to use)
  const fromAI = detectMemoryFromMessage(aiText || "");
  // Only carry over coding/context from AI response, not preferences
  fromAI.preferences = [];
  return mergeUserMemory(fromUser, fromAI);
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
