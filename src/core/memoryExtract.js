import { routeStream } from "../api/providerRouter";
import { pickCheapestSummaryModel } from "../utils/tokenOptimizer";
import { MEMORY_CATEGORY_DEFS, isSensitiveMemoryText, MAX_PENDING_MEMORY } from "../utils/userMemory";
import { memoryStore, queuePendingCandidates } from "./memory";

/*
 * LLM-based memory extraction — complements the regex heuristics in
 * utils/userMemory.js. Runs best-effort in the background after an exchange,
 * on a cheap/free model, and never writes memory directly: candidates land in
 * the pending review queue (memory.pending) for the user to approve/reject.
 */

const CATEGORY_IDS = MEMORY_CATEGORY_DEFS.map((d) => d.id);

const EXTRACT_INTERVAL_MS = 90_000; // at most one extraction call per 90s
const MIN_USER_TEXT_CHARS = 40; // skip low-signal messages
let lastExtractAt = 0;
let inFlight = false;

const EXTRACT_SYSTEM_PROMPT =
  "You extract durable user facts from one chat exchange for long-term memory. " +
  'Reply with ONLY a JSON array, no prose. Each item: {"category": "preferences" | "coding" | "context", "text": "..."}. ' +
  "Rules: at most 3 items; each text is a short third-person fact under 120 characters " +
  '(e.g. "User prefers concise answers"). Only include stable preferences, coding-style defaults, ' +
  "or ongoing goals/projects the USER stated themselves. Ignore one-off requests, questions, " +
  "assistant output, and anything sensitive (real names, contact info, credentials, health, finances). " +
  "If nothing qualifies, reply [].";

/** Parse the model reply into clean candidate objects (may return []). */
function parseCandidates(raw) {
  const s = String(raw || "");
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end <= start) return [];

  let arr;
  try {
    arr = JSON.parse(s.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const out = [];
  for (const item of arr.slice(0, 3)) {
    const text = String(item?.text || "").replace(/\s+/g, " ").trim();
    if (!text || text.length < 8 || text.length > 140) continue;
    if (isSensitiveMemoryText(text)) continue;
    const category = CATEGORY_IDS.includes(item?.category) ? item.category : "context";
    out.push({ category, text, source: "llm", ts: Date.now() });
  }
  return out;
}

/**
 * Fire-and-forget LLM extraction for a completed exchange.
 * Throttled, autoMode-gated, and silent on any failure.
 */
export async function maybeExtractMemoryLLM(providers, models, fallbackModel, userText, aiText) {
  try {
    const { memory } = memoryStore.get();
    if (!memory.autoMode) return;
    if ((memory.pending || []).length >= MAX_PENDING_MEMORY) return; // queue full

    const text = String(userText || "").trim();
    if (text.length < MIN_USER_TEXT_CHARS) return;

    const now = Date.now();
    if (inFlight || now - lastExtractAt < EXTRACT_INTERVAL_MS) return;
    inFlight = true;
    lastExtractAt = now;

    // Free/cheapest model so background extraction never costs real money
    const model = pickCheapestSummaryModel(models, providers) || fallbackModel;
    if (!model) return;

    const convo =
      `User: ${text.slice(0, 1200)}` +
      (aiText ? `\n\nAssistant: ${String(aiText).slice(0, 400)}` : "");

    const { text: raw } = await routeStream(
      providers,
      model,
      [
        { role: "system", content: EXTRACT_SYSTEM_PROMPT },
        { role: "user", content: convo },
      ],
      { reasoningDepth: "off", maxTokens: 160, temperature: 0, onChunk: () => {} }
    );

    const candidates = parseCandidates(raw);
    if (candidates.length > 0) queuePendingCandidates(candidates);
  } catch {
    /* best-effort — never surface extraction errors */
  } finally {
    inFlight = false;
  }
}
