export const USER_MEMORY_STORAGE_KEY = "openrouter_user_memory";

export const DEFAULT_USER_MEMORY = {
  preferences: [],
  coding: [],
  context: [],
  autoMode: true,
  pending: [], // LLM-suggested memories awaiting user review: {id, category, text, source, ts}
};

export const MAX_PENDING_MEMORY = 20;
// Decay cap per saved category — oldest entries fall off once the cap is hit,
// so long-lived memory stays fresh without unbounded growth.
export const MAX_SAVED_MEMORY = 30;

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

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

function canonicalizeMemoryEntry(category, rawEntry) {
  const entry = cleanEntry(rawEntry);
  if (!entry) return "";

  const lower = entry.toLowerCase();

  if (category === "preferences") {
    if (/\b(short|brief|concise|one[- ]sentence|one sentence|tldr)\b/.test(lower)) {
      return "User prefers short answers";
    }
    if (/\b(step[- ]by[- ]step|walk me through|break it down|one step at a time|structured steps?)\b/.test(lower)) {
      return "User prefers step-by-step explanations";
    }
    if (/\b(detailed|in[- ]depth|thorough|deep analysis|elaborate|expanded explanation)\b/.test(lower)) {
      return "User prefers detailed explanations";
    }
    if (/\b(code[- ]first|code only|only code|just the code|skip explanation|no explanation)\b/.test(lower)) {
      return "User prefers code-first answers";
    }
    const langMatch = lower.match(/\b(?:responses?|answers?)\s+in\s+([a-z]+)\b|\bin\s+(hindi|spanish|french|german|arabic|portuguese|japanese|chinese|korean)\b/i);
    const lang = langMatch?.[1] || langMatch?.[2];
    if (lang) {
      return `User prefers responses in ${toTitleCase(lang)}`;
    }
    if (/\b(source|sources|citation|citations|references|web source|current web)\b/.test(lower)) {
      return "User requests current web sources and citations";
    }
  }

  if (category === "coding") {
    if (/\bclean code|readable|well[- ]structured|maintainable|best practices\b/.test(lower)) {
      return "User prefers clean, readable code";
    }
    if (/\b(with comments|add comments|include comments|commented code|comment the code)\b/.test(lower)) {
      return "User likes code with comments";
    }
    if (/\b(functional|arrow functions?|avoid classes?|no class)\b/.test(lower)) {
      return "User prefers functional programming style";
    }
    if (/\b(async\/await|promises?)\b/.test(lower)) {
      return "User prefers async/await patterns";
    }
    if (/\b(node\.?js|node js|node)\b/.test(lower)) {
      return "User uses Node.js";
    }
    if (/\bkali linux\b/.test(lower)) {
      return "User works with Kali Linux";
    }
    if (/\brufus\b.*\bbootable usb\b|\bbootable usb\b.*\brufus\b/.test(lower)) {
      return "User uses Rufus for bootable USB creation";
    }

    const languagePatterns = [
      { pattern: /\bpython\b/, memory: "User prefers Python" },
      { pattern: /\btypescript\b|\bts\b/, memory: "User prefers TypeScript" },
      { pattern: /\bjavascript\b|\bjs\b/, memory: "User prefers JavaScript" },
      { pattern: /\bc\+\+\b|\bcpp\b/, memory: "User prefers C++" },
      { pattern: /\bc#\b|\bcsharp\b|\.net\b/, memory: "User prefers C#" },
      { pattern: /\bjava\b/, memory: "User prefers Java" },
      { pattern: /\brust\b/, memory: "User prefers Rust" },
      { pattern: /\bgolang\b|\bgo language\b|\bgo code\b/, memory: "User prefers Go" },
      { pattern: /\bphp\b/, memory: "User prefers PHP" },
      { pattern: /\bruby\b/, memory: "User prefers Ruby" },
      { pattern: /\bswift\b/, memory: "User prefers Swift" },
      { pattern: /\bkotlin\b/, memory: "User prefers Kotlin" },
      { pattern: /\bsql\b|\bpostgres\b|\bmysql\b|\bsqlite\b/, memory: "User prefers SQL" },
    ];
    for (const item of languagePatterns) {
      if (item.pattern.test(lower)) return item.memory;
    }
  }

  if (category === "context") {
    if (/\b(dsa|data structures?|algorithms?|competitive programming|leetcode|hackerrank)\b/.test(lower)) {
      return "User is practicing DSA / competitive programming";
    }
    if (/\b(graph algorithms?|graph theory)\b/.test(lower)) {
      return "User is learning graph algorithms";
    }
    if (/\b(interview|interview prep|coding interview|job interview)\b/.test(lower)) {
      return "User is preparing for coding interviews";
    }
    if (/\b(ai app|ai assistant|ai chatbot|llm app|openrouter|openai api|anthropic api|gemini api)\b/.test(lower)) {
      return "User is building an AI application";
    }
    if (/\b(machine learning|\bml\b|deep learning|neural network|pytorch|tensorflow|\bai\b)\b/.test(lower)) {
      return "User works in machine learning / AI";
    }
    if (/\b(terminal commands?|command line|cli|shell commands?)\b/.test(lower)) {
      return "User is working with terminal commands";
    }
    if (/\b(us[- ]iran relations?|iran[- ]us relations?)\b/.test(lower)) {
      return "User researches US-Iran relations";
    }
  }

  return entry;
}

function simplifyToken(token) {
  if (token.length <= 4) return token;
  if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}

function entrySignature(category, rawEntry) {
  const canonical = canonicalizeMemoryEntry(category, rawEntry).toLowerCase();
  const normalized = canonical
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b(one sentence|one-sentence)\b/g, " short ")
    .replace(/\bbrief\b|\bconcise\b/g, " short ")
    .replace(/\banswers?\b/g, " response ")
    .replace(/\bexplanations?\b/g, " explanation ")
    .replace(/\s+/g, " ")
    .trim();

  const stopwords = new Set([
    "user",
    "prefers",
    "prefer",
    "likes",
    "like",
    "wants",
    "requests",
    "is",
    "are",
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "in",
    "for",
    "of",
    "with",
    "using",
    "works",
    "work",
    "codes",
    "code",
    "response",
    "style",
  ]);

  const tokens = normalized
    .split(" ")
    .map((t) => simplifyToken(t.trim()))
    .filter((t) => t && !stopwords.has(t));

  return Array.from(new Set(tokens)).sort().join("|");
}

function dedupeMemoryCategory(entries, category) {
  const deduped = [];
  const seenKeys = new Set();
  const seenSignatures = new Set();

  for (const rawEntry of entries || []) {
    const canonical = canonicalizeMemoryEntry(category, rawEntry);
    if (!canonical) continue;

    const key = normalizeEntryKey(canonical);
    if (!key || seenKeys.has(key)) continue;

    const signature = entrySignature(category, canonical);
    if (signature && seenSignatures.has(signature)) continue;

    seenKeys.add(key);
    if (signature) seenSignatures.add(signature);
    deduped.push(canonical);
  }

  // Recency-based decay: newest entries live at the end; drop the oldest overflow.
  return deduped.length > MAX_SAVED_MEMORY ? deduped.slice(-MAX_SAVED_MEMORY) : deduped;
}

/**
 * Normalize the pending-review queue: drop empty/sensitive/overlong items,
 * dedupe against saved categories and within the queue itself, cap the size.
 */
function normalizePendingList(rawPending, normalizedCategories) {
  if (!Array.isArray(rawPending)) return [];
  const seenKeys = new Set();
  for (const def of MEMORY_CATEGORY_DEFS) {
    for (const entry of normalizedCategories[def.id] || []) {
      seenKeys.add(normalizeEntryKey(entry));
    }
  }
  const out = [];
  for (const item of rawPending) {
    const text = cleanEntry(item?.text);
    if (!text || text.length > 160 || isSensitiveMemoryText(text)) continue;
    const key = normalizeEntryKey(text);
    if (seenKeys.has(key)) continue; // already saved or already queued
    seenKeys.add(key);
    const category = MEMORY_CATEGORY_DEFS.some((d) => d.id === item?.category)
      ? item.category
      : "context";
    out.push({
      id: String(item?.id || `pm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
      category,
      text,
      source: typeof item?.source === "string" && item.source ? item.source : "auto",
      ts: Number.isFinite(item?.ts) ? item.ts : Date.now(),
    });
    if (out.length >= MAX_PENDING_MEMORY) break;
  }
  return out;
}

export function normalizeUserMemory(memory) {
  const source = memory || {};
  const normalized = {
    preferences: dedupeMemoryCategory(Array.isArray(source.preferences) ? source.preferences : [], "preferences"),
    coding: dedupeMemoryCategory(Array.isArray(source.coding) ? source.coding : [], "coding"),
    context: dedupeMemoryCategory(Array.isArray(source.context) ? source.context : [], "context"),
    autoMode: source.autoMode !== false,
  };
  normalized.pending = normalizePendingList(source.pending, normalized);
  return normalized;
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

  const result = {
    preferences: mergeCategoryEntries(base.preferences, incoming.preferences, "preferences"),
    coding: mergeCategoryEntries(base.coding, incoming.coding, "coding"),
    context: mergeCategoryEntries(base.context, incoming.context, "context"),
    autoMode: nextAutoMode,
  };
  // Keep the base's review queue, minus anything that just became a saved entry
  result.pending = normalizePendingList(base.pending, result);
  return result;
}

const REMEMBER_RE = /^(?:please\s+)?remember(?:\s+that)?[:,]?\s+(.{3,240})$/i;
const FORGET_RE = /^(?:please\s+)?forget(?:\s+about)?[:,]?\s+(.{2,240})$/i;

/** Detect an explicit remember/forget instruction. Returns {action, payload} or null. */
export function parseExplicitMemoryCommand(text) {
  const value = cleanEntry(text);
  if (!value) return null;
  const rem = value.match(REMEMBER_RE);
  if (rem) return { action: "remember", payload: cleanEntry(rem[1]) };
  const fog = value.match(FORGET_RE);
  if (fog) return { action: "forget", payload: cleanEntry(fog[1]) };
  return null;
}

/** Best-fit category for an explicitly remembered fact. */
export function categorizeExplicitMemory(payload) {
  const lower = String(payload || "").toLowerCase();
  if (
    /\b(code|coding|python|typescript|javascript|java|rust|c\+\+|c#|golang|php|ruby|swift|kotlin|sql|comments?|functions?|class(es)?|indent|tabs?|spaces)\b/.test(
      lower
    )
  ) {
    return "coding";
  }
  if (/\b(answers?|responses?|replies|explain|explanations?|tone|format|language|short|brief|detailed|step)\b/.test(lower)) {
    return "preferences";
  }
  return "context";
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

const RELEVANCE_STOPWORDS = new Set(
  "the a an and or but for with without from into onto this that these those is are was were be been being have has had do does did will would can could should may might must not no yes you your yours i me my mine we our ours it its they them their what which who whom how when where why please tell give make want need like just also very really about".split(
    " "
  )
);

function tokenizeForRelevance(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length >= 3 && !RELEVANCE_STOPWORDS.has(w))
  );
}

/**
 * Score one memory entry against the current message tokens.
 * Returns 0..1-ish overlap ratio (relative to the smaller token set).
 */
export function scoreMemoryRelevance(entry, contextTokens) {
  if (!contextTokens || contextTokens.size === 0) return 0;
  const entryTokens = tokenizeForRelevance(entry);
  if (entryTokens.size === 0) return 0;
  let hits = 0;
  for (const t of entryTokens) if (contextTokens.has(t)) hits += 1;
  return hits / Math.min(entryTokens.size, contextTokens.size);
}

/**
 * Pick the memory entries worth injecting for the current message.
 * - preferences/coding: broadly applicable style defaults — always kept (capped).
 * - context: project/goal facts — ranked by relevance to the message; falls
 *   back to the most recent few when the message carries no usable signal.
 */
export function selectRelevantMemory(memory, contextText, opts = {}) {
  const normalized = normalizeUserMemory(memory);
  const maxStyle = Number.isFinite(opts.maxStyle) ? opts.maxStyle : 6;
  const maxContext = Number.isFinite(opts.maxContext) ? opts.maxContext : 4;
  const tokens = tokenizeForRelevance(contextText);

  const context = normalized.context || [];
  let pickedContext;
  if (tokens.size === 0 || context.length <= maxContext) {
    pickedContext = context.slice(-maxContext); // newest entries live at the end
  } else {
    const scored = context.map((entry, i) => ({ entry, i, score: scoreMemoryRelevance(entry, tokens) }));
    const relevant = scored.filter((s) => s.score > 0.15);
    const base = relevant.length > 0 ? relevant : scored.slice(-maxContext);
    pickedContext = base
      .sort((a, b) => b.score - a.score || b.i - a.i) // relevance, then recency
      .slice(0, maxContext)
      .sort((a, b) => a.i - b.i) // restore stored order for a stable prompt
      .map((s) => s.entry);
  }

  return {
    preferences: (normalized.preferences || []).slice(0, maxStyle),
    coding: (normalized.coding || []).slice(0, maxStyle),
    context: pickedContext,
  };
}
