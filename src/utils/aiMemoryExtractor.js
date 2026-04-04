/**
 * aiMemoryExtractor.js
 *
 * Uses a small free AI model in the background to intelligently extract
 * memory from a conversation exchange. Falls back silently if unavailable.
 */

const HF_API = "https://router.huggingface.co/v1/chat/completions";

// Free HuggingFace models for background memory extraction (small = fast)
const HF_FREE_MODELS = [
  "Qwen/Qwen2.5-7B-Instruct",
  "meta-llama/Llama-3.2-3B-Instruct",
  "HuggingFaceTB/SmolLM2-1.7B-Instruct",
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

async function callChatAPI(url, apiKey, model, messages, headers = {}) {
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
      max_tokens: 256,
      temperature: 0.2,
      stream: false,
    }),
    signal: AbortSignal.timeout(15000), // 15s timeout
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content || null;
}

async function extractViaHuggingFace(apiKey, userMessage, aiResponse) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(userMessage, aiResponse) },
  ];
  for (const model of HF_FREE_MODELS) {
    try {
      const text = await callChatAPI(HF_API, apiKey, `${model}:fastest`, messages);
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
    if (providerKeys?.huggingface) {
      return await extractViaHuggingFace(providerKeys.huggingface, userMessage, aiResponse);
    }
  } catch {
    // Silent failure — never disrupt the main chat
  }
  return null;
}
