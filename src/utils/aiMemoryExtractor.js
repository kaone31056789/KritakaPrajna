/**
 * aiMemoryExtractor.js
 *
 * Uses a small free AI model in the background to intelligently extract
 * memory from a conversation exchange. Falls back silently if unavailable.
 */

import { detectMemoryFromExchange, hasUserMemory, normalizeUserMemory } from "./userMemory";

const HF_API = "https://router.huggingface.co/v1/chat/completions";
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

// Free HuggingFace models for background memory extraction (small = fast)
const HF_MEMORY_MODEL_PRIORITY = [
  // User-requested priority order
  "deepseek-ai/DeepSeek-R1",
  "deepseek-ai/DeepSeek-V3",

  // Fallbacks
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
  "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
  "deepseek-ai/DeepSeek-V3.2-Exp",
  "Qwen/Qwen2.5-7B-Instruct",
  "meta-llama/Llama-3.2-3B-Instruct",
  "HuggingFaceTB/SmolLM2-1.7B-Instruct",
];

const OPENROUTER_MEMORY_MODEL_PRIORITY = [
  // User-requested order first
  "deepseek/deepseek-r1:free",
  "deepseek/deepseek-chat-v3-0324:free",

  // Broad fallback pool
  "qwen/qwen-2.5-7b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
];

const SYSTEM_PROMPT = `You are a memory extraction assistant. Your ONLY job is to analyze a conversation and extract useful, reusable facts about the user.

Output ONLY a valid JSON object. No explanation, no markdown, no extra text.

Schema:
{
  "preferences": [],   // How the user likes responses: e.g. "User prefers short answers", "User prefers step-by-step explanations"
  "coding": [],        // Languages/frameworks/style: e.g. "User codes in Python", "User works with React and TypeScript"
  "context": []        // What they're building or their role: e.g. "User is building a chat app", "User is preparing for interviews"
}

Rules:
- Only include facts that are genuinely useful to remember long-term
- Ignore one-off questions that reveal nothing about the user's patterns
- Each fact must be under 12 words and start with "User"
- If nothing useful, output {}
- Never include passwords, API keys, emails, or phone numbers`;

function buildUserPrompt(userMessage, aiResponse) {
  const maxLen = 800;
  const truncatedUser = (userMessage || "").slice(0, maxLen);
  const truncatedAI = (aiResponse || "").slice(0, maxLen);
  return `User said: "${truncatedUser}"\n\nAI replied: "${truncatedAI}"`;
}

function parseJsonResponse(text) {
  if (!text) return null;
  // Strip markdown fences if present
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  // Find first { ... }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return {
      preferences: Array.isArray(parsed.preferences) ? parsed.preferences.filter(Boolean) : [],
      coding: Array.isArray(parsed.coding) ? parsed.coding.filter(Boolean) : [],
      context: Array.isArray(parsed.context) ? parsed.context.filter(Boolean) : [],
      autoMode: true,
    };
  } catch {
    return null;
  }
}

function createTimeoutController(timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function extractChatTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part?.text || "";
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

async function callOpenAICompatibleChat(url, apiKey, model, messages, headers = {}) {
  const timeout = createTimeoutController(15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 220,
        temperature: 0.2,
        stream: false,
      }),
      signal: timeout.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status}: ${body}`);
    }

    const json = await res.json();
    return extractChatTextFromContent(json?.choices?.[0]?.message?.content);
  } finally {
    timeout.clear();
  }
}

async function callChatAPI(url, apiKey, model, messages, headers = {}) {
  return callOpenAICompatibleChat(url, apiKey, model, messages, headers);
}

async function extractViaHuggingFace(apiKey, userMessage, aiResponse) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(userMessage, aiResponse) },
  ];
  for (const model of HF_MEMORY_MODEL_PRIORITY) {
    try {
      const text = await callChatAPI(HF_API, apiKey, model, messages);
      const parsed = parseJsonResponse(text);
      if (parsed) return parsed;
    } catch {
      // try next model
    }
  }
  return null;
}

async function extractViaOpenRouter(apiKey, userMessage, aiResponse) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(userMessage, aiResponse) },
  ];

  for (const model of OPENROUTER_MEMORY_MODEL_PRIORITY) {
    if (!model.endsWith(":free")) continue;
    try {
      const text = await callChatAPI(OPENROUTER_API, apiKey, model, messages, {
        "HTTP-Referer": "https://kritakaprajna.app",
        "X-Title": "KritakaPrajna",
      });
      const parsed = parseJsonResponse(text);
      if (parsed) return parsed;
    } catch {
      // try next model
    }
  }

  return null;
}

/**
 * Extract memory from a conversation exchange using a free background AI.
 * Returns a partial userMemory object, or null if extraction fails.
 *
 * @param {object} providerKeys - { openrouter, huggingface, ... }
 * @param {string} userMessage  - The user's message text
 * @param {string} aiResponse   - The AI's response text
 */
export async function extractMemoryWithAI(providerKeys, userMessage, aiResponse) {
  try {
    const keys = providerKeys || {};

    // Free-only priority: OpenRouter ':free' models, then HuggingFace free-tier models.
    if (providerKeys?.openrouter) {
      const memory = await extractViaOpenRouter(keys.openrouter, userMessage, aiResponse);
      if (memory && hasUserMemory(memory)) return normalizeUserMemory(memory);
    }

    if (providerKeys?.huggingface) {
      const memory = await extractViaHuggingFace(keys.huggingface, userMessage, aiResponse);
      if (memory && hasUserMemory(memory)) return normalizeUserMemory(memory);
    }
  } catch {
    // Silent failure — never disrupt the main chat
  }

  // Deterministic fallback so auto-memory still works without model/API success.
  const heuristic = detectMemoryFromExchange(userMessage || "", aiResponse || "");
  return hasUserMemory(heuristic) ? normalizeUserMemory(heuristic) : null;
}
