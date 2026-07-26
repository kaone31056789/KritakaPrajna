import { createStore, generateId, readJSON, writeJSON, readRaw, writeRaw } from "./store";
import { keysStore } from "./keys";
import { modelsStore, isFreeModel } from "./models";
import { rankInfoFor, usageScore } from "./rankings";
import { routeStream, isImageGenModel } from "../api/providerRouter";
import { supportsVision, extractParamBillions } from "../utils/smartModelSelect";
import { supportsReasoningModel } from "../utils/reasoningControls";
import { calculateCost, addLifetimeCost, addMonthlySpend, tokenPrice } from "../utils/costTracker";
import { recordProviderUsage } from "../utils/usageTracker";
import { runOCR } from "./ocr";
import { settingsStore } from "./settings";
import { webSearch, deepArticleSearch } from "../utils/webFetcher";
import { estimateTokensFromText } from "../utils/tokenOptimizer";
import { review, retrievability, RATING, DAY } from "./fsrs";

/* ═══ Education Hub ═══════════════════════════════════════════════════════
   Notes / lecture decks / past papers in, study material out: flashcards,
   quizzes, or a full timed exam paper. Answers can be typed here or shot as
   a photo of a handwritten sheet — a vision model transcribes and maps them
   back to question numbers, then grades against the paper's own mark scheme.

   Model choice is deliberately narrowed: study material lives or dies on
   long-context comprehension and careful marking, so the picker only offers
   models that clear a fitness bar (see scoreEducationModel).
   ═══════════════════════════════════════════════════════════════════════ */

const SETS_KEY = "kp_edu_sets";
const SRC_KEY = "kp_edu_sources";
const MODEL_KEY = "kp_edu_model";
const SPEND_KEY = "kp_edu_spend";
const FORMAT_KEY = "kp_edu_paper_format";
const RETENTION_KEY = "kp_edu_retention";
const RECALL_KEY = "kp_edu_recall_mode";
const LOG_KEY = "kp_edu_log";
const PINS_KEY = "kp_edu_pins";
const MAX_LOG = 4000; // ~a year of heavy study, two numbers per entry

const NO_SPEND = { inTokens: 0, outTokens: 0, cost: 0, runs: 0 };

const MAX_SOURCE_CHARS = 400000; // per source, in memory
const CHARS_PER_TOKEN = 3.5; // rough English average
const MAX_CHUNKS = 8; // per source
const MAX_TOTAL_PASSES = 24; // across ALL sources — the ceiling for a 10-file drop
const READ_WORKERS = 4; // models to spread a single document across
const MAX_IN_FLIGHT = 6; // concurrent requests; beyond this free tiers just 429
const MIN_CHUNK_CHARS = 15000; // below this, splitting costs coherence and buys no speed
const COMPREHEND_TOKENS = 9000; // a digest of a full chunk, with room for a reasoning preamble
const MAX_SETS = 40;

export const educationStore = createStore({
  sources: readJSON(SRC_KEY, []) || [], // [{ id, name, kind, text, chars, ts }]
  sets: readJSON(SETS_KEY, []) || [], // [{ id, kind, title, ts, modelName, payload }]
  activeSetId: null,
  tier: ["free", "paid", "premium"].includes(readRaw(MODEL_KEY, "free"))
    ? readRaw(MODEL_KEY, "free")
    : "free",
  route: {}, // job → model name that actually answered, for the "who did what" line
  paperFormat: readRaw(FORMAT_KEY, ""), // your institution's exam pattern, in your words
  retention: Number(readRaw(RETENTION_KEY, "0.9")) || 0.9, // FSRS target recall probability
  recallMode: readRaw(RECALL_KEY, "flip") === "type" ? "type" : "flip",
  log: readJSON(LOG_KEY, []) || [], // [{ t: timestamp, g: grade }] — streaks and history
  pins: readJSON(PINS_KEY, {}) || {}, // "tier:job" → [modelId] — your picks, ahead of the auto chain
  busy: false,
  phase: "", // "reading" | "comprehending" | "generating" | "transcribing" | "grading"
  progress: null, // { label, step, total, model, attempt, of, startedAt } — live run detail
  error: null,
  attempt: null, // { setId, startedAt, limitSec, answers, submitted, result, transcribed }
  spend: { ...NO_SPEND, ...(readJSON(SPEND_KEY, null) || {}) }, // hub-only running total
});

function persistSets(sets) {
  try {
    writeJSON(SETS_KEY, sets.slice(0, MAX_SETS));
  } catch {
    try {
      writeJSON(SETS_KEY, sets.slice(0, 8));
    } catch {}
  }
}

function persistLog(log) {
  try {
    writeJSON(LOG_KEY, log);
  } catch {
    try {
      writeJSON(LOG_KEY, log.slice(-500));
    } catch {}
  }
}

function persistSources(sources) {
  // Source text can be megabytes. Persist a bounded copy; drop the text (never
  // the entry) if it still will not fit, so the list stays truthful about what
  // was loaded even when the body had to be shed.
  const slim = sources.map((s) => ({ ...s, text: s.text.slice(0, 60000) }));
  try {
    writeJSON(SRC_KEY, slim);
  } catch {
    try {
      writeJSON(SRC_KEY, sources.map((s) => ({ ...s, text: "" })));
    } catch {}
  }
}

/* ─── Routing ───────────────────────────────────────────────────────────────
   No model picker. You choose a tier — Free or Paid — and each job inside the
   hub is routed to the model best suited to it, with a fallback chain behind
   it because free endpoints rate-limit and go down constantly.

   "Best, not old": generation is the dominant term, so a current-generation
   model always outranks a well-known older one, and the live OpenRouter usage
   feed refines the order further whenever it has loaded.
   ─────────────────────────────────────────────────────────────────────────── */

const GENERATION = [
  [/gpt-5|(^|[^a-z])o[45]-|claude-(opus|sonnet)-4|gemini-3|grok-4|deepseek-(v3\.[2-9]|r1-0[5-9])|qwen3-(max|next)|llama-4|kimi-k2|glm-4\.[6-9]|minimax-m2|mistral-medium-3|nemotron-3/i, 100],
  [/gpt-4\.1|(^|[^a-z])o3|claude-3\.7|gemini-2\.5|deepseek-(r1|v3)|qwen3|grok-3|glm-4\.5|command-a|nemotron/i, 78],
  [/gpt-4o|claude-3\.5|gemini-2\.0|llama-3\.3|qwen2\.5-(32|72)|mistral-large|command-r-plus/i, 52],
  [/llama-3\.1|claude-3-|gemini-1\.5|mixtral|qwen2-/i, 26],
];

// A distill carries its parent's name, so it inherits the parent's generation
// score while being a materially weaker model. Dock it back.
const DISTILL = /distill/i;

function generationScore(model) {
  const hay = `${model.id} ${model.name || ""}`;
  for (const [re, val] of GENERATION) if (re.test(hay)) return val;
  return 0;
}

// The shared supportsReasoningModel() gates the API `reasoning_effort` flag, so
// it is deliberately conservative AND provider-scoped — it only credits Claude
// when _provider is literally "anthropic", which misses the same model served
// through OpenRouter. Here we only need a preference signal, so match on the id
// regardless of route, and cover the rest of the current crop while we are at it.
const EXTRA_REASONERS =
  /claude-(opus|sonnet)-4|claude-3[.-]7|gemini-3|gemini-2\.5-pro|nemotron|minimax-m2|glm-4\.[5-9]|deepseek-v3\.[2-9]|qwq|magistral|gpt-oss|seed-oss|exaone-deep|phi-4-reasoning|skywork-o/i;

function isReasoner(model) {
  return supportsReasoningModel(model) || EXTRA_REASONERS.test(`${model.id} ${model.name || ""}`);
}

/*
 * Guard, safety, embedding, rerank and classifier endpoints are not chat models
 * — they answer with a label or a vector and can never return JSON. One in the
 * chain silently burns a fallback slot, and eight of them fail a whole run.
 *
 * Providers do keep their own exclusion lists, but those are prefix-based and go
 * stale the moment a new version ships: nvidia.js lists "nemotron-content-safety"
 * and the live catalogue served "nemotron-3.5-content-safety", which sailed
 * through. Matching on the capability word instead holds across versions and
 * across providers.
 */
const NOT_A_CHAT_MODEL =
  /guard|safety|shield|moderation|censor|\bembed|embedding|rerank|retriev|classifier|gliner|nvclip|reward-model|\bocr\b|whisper|parakeet|\btts\b|speech|diarize/i;

export function isChatModel(model) {
  return !NOT_A_CHAT_MODEL.test(`${model?.id || ""} ${model?.name || ""}`);
}

function contextTokens(model) {
  return Number(model?.context_length || model?.contextLength || 0) || 0;
}

/* ─── Tiers ─────────────────────────────────────────────────────────────────
   Free   — nothing that costs money.
   Paid   — value: strong reasoning per dollar, with a hard price ceiling, so a
            daily habit does not quietly turn into a flagship-sized bill.
   Paid+  — no ceiling. The best model available for each job, price ignored.
   ─────────────────────────────────────────────────────────────────────────── */

export const TIERS = [
  { id: "free", label: "Free", hint: "no spend at all" },
  { id: "paid", label: "Paid", hint: "$0.0001–$5 per million tokens — best reasoning per dollar" },
  { id: "premium", label: "Paid+", hint: "$5+ per million tokens — flagships only, nothing free" },
];

const TIER_IDS = TIERS.map((t) => t.id);

/** Blended $ per million tokens — this workload is input-heavy, output-structured. */
export function blendedCost(model) {
  const p = tokenPrice(model?.pricing, "prompt");
  const c = tokenPrice(model?.pricing, "completion");
  // A price the catalogue will not state is not a cheap price. Failing closed
  // keeps "unknown cost" out of the value tier instead of letting it win it.
  if (p === null || c === null) return Infinity;
  return (p * 0.7 + c * 0.3) * 1e6;
}

/* The tiers are price bands, in blended $ per million tokens. Quality is what
   scoreEducationModel decides *within* a band; the band decides what you are
   willing to spend before quality is even considered. */
const PAID_MIN = 0.0001; // below this it is free in all but name
const PAID_MAX = 5; // above this it is a Paid+ proposition, not a daily driver
const PREMIUM_MIN = 5; // Paid+ is the flagship shelf

/**
 * Whether a model's price puts it in this tier's band.
 *
 * Each band is exclusive, so choosing a tier is a real choice about spending.
 * In particular a free model has no business in Paid+: if you have said price
 * is no object, you want the model the price was buying.
 */
export function inPriceBand(model, tier) {
  const cost = blendedCost(model);
  if (!Number.isFinite(cost)) return false; // unstated price — never assume
  if (tier === "free") return isFreeModel(model);
  if (tier === "premium") return cost >= PREMIUM_MIN;
  return cost > PAID_MIN && cost < PAID_MAX;
}

/**
 * Reward cheap-and-capable within the Paid band. Everything here already costs
 * real money, so the bonus is graded across the band rather than handed to
 * whatever is nearest free.
 */
function valueBonus(model) {
  const cost = blendedCost(model);
  if (!Number.isFinite(cost)) return 0;
  return Math.max(0, Math.round(12 * (1 - cost / PAID_MAX)));
}

/** What each job actually needs. Marking cares about judgement, not context. */
export const JOBS = {
  comprehend: { label: "Reading your notes", ctxWeight: 1, vision: false },
  author: { label: "Writing your material", ctxWeight: 0.8, vision: false },
  mark: { label: "Marking", ctxWeight: 0.45, vision: false },
  read: { label: "Reading handwriting", ctxWeight: 0.3, vision: true },
};

/**
 * Score a model for one job. `why` is the human-readable reason it was chosen,
 * surfaced in the UI so routing is never a black box.
 */
export function scoreEducationModel(model, job = "author", tier = "paid") {
  if (!model || isImageGenModel(model) || !isChatModel(model)) return { score: -1, why: [] };
  const spec = JOBS[job] || JOBS.author;
  if (spec.vision && !supportsVision(model)) return { score: -1, why: [] };

  const why = [];
  let score = 0;

  const gen = generationScore(model);
  if (gen >= 100) { score += 44; why.push("current generation"); }
  else if (gen >= 78) { score += 33; why.push("recent generation"); }
  else if (gen >= 52) { score += 18; why.push("last generation"); }
  else if (gen >= 26) { score += 6; }

  // Live popularity is a decent proxy for "actually works well right now".
  const rank = rankInfoFor(model)?.rank;
  if (rank) {
    score += Math.round((usageScore(rank) - 30) / 6); // 0…12
    if (rank <= 20) why.push(`top-${rank <= 10 ? "10" : "20"} in use`);
  }

  const ctx = contextTokens(model);
  let ctxPts = 0;
  if (ctx >= 200000) { ctxPts = 30; why.push("200k+ context"); }
  else if (ctx >= 128000) { ctxPts = 26; why.push("128k context"); }
  else if (ctx >= 64000) { ctxPts = 19; why.push("64k context"); }
  else if (ctx >= 32000) { ctxPts = 12; }
  else if (ctx >= 16000) { ctxPts = 5; }
  score += Math.round(ctxPts * spec.ctxWeight);

  if (spec.vision && supportsVision(model)) why.push("reads handwriting");
  else if (supportsVision(model)) score += 4;

  // Setting and marking exam questions is reasoning work. Weight it heavily
  // enough that a reasoning model beats a bigger-name instruct model.
  if (isReasoner(model)) {
    score += job === "mark" ? 26 : 20;
    why.push("reasoning model");
  }

  // Small models write shallow, boilerplate questions. The parameter count in
  // the name is a blunt instrument but a reliable one — a 17B MoE should not
  // outrank a frontier reasoner just because its family is new.
  const params = extractParamBillions(model);
  if (params > 0) {
    if (params < 20) score -= 20;
    else if (params < 35) score -= 9;
    else if (params >= 100) { score += 6; why.push(`${Math.round(params)}B`); }
  }
  if (DISTILL.test(`${model.id} ${model.name || ""}`)) score -= 12;

  // Only the value tier trades quality against price. Paid+ ignores cost
  // entirely so nothing cheap outranks a flagship on economics alone.
  if (tier === "paid") {
    const v = valueBonus(model);
    score += v;
    if (v >= 9) why.push("great value");
  }

  return { score, why };
}

// Free endpoints are thinner on the ground, so the bar is lower there — the
// fallback chain is what makes up the difference.
// Paid+ sets the highest bar because it has the whole catalogue to choose from;
// free sets the lowest because the chain's depth is what makes up the shortfall.
const BAR = { free: 22, paid: 34, premium: 40 };
// Doubles as the parallel-read worker pool, so depth buys speed as well as
// resilience — hence more than a fallback chain alone would need.
const CHAIN_DEPTH = 8;

function usableProviders() {
  const providers = keysStore.get().providers || {};
  return (m) => m._provider === "local" || !!providers[m._provider];
}

/**
 * The ordered fallback chain for one job in one tier — best first.
 * @param {"author"|"mark"|"read"} job
 * @param {"free"|"paid"} tier
 */
/**
 * Every model this tier would consider for this job, best first — uncapped and
 * undeduped. candidatesFor() turns this into a runnable chain; Settings shows it
 * whole so you can pick from the same list the router sees.
 */
export function eligibleFor(job, tier = educationStore.get().tier) {
  const hasKey = usableProviders();
  const bar = BAR[tier] ?? BAR.paid;
  const out = [];
  for (const m of modelsStore.get().models || []) {
    if (!hasKey(m)) continue;
    if (!inPriceBand(m, tier)) continue;
    const { score, why } = scoreEducationModel(m, job, tier);
    if (score < bar) continue;
    out.push({ ...m, _eduScore: score, _eduWhy: why });
  }
  return out.sort((a, b) => b._eduScore - a._eduScore);
}

export function candidatesFor(job, tier = educationStore.get().tier) {
  const hasKey = usableProviders();
  const out = eligibleFor(job, tier);

  // Your picks lead. They skip the fitness bar and the tier filters — you asked
  // for them by name — but they are still only reachable through a provider you
  // hold a key for, and the auto chain stays behind them, because a pinned free
  // endpoint that 429s must not take the whole run down with it.
  const chain = [];
  const seen = new Set();
  const take = (m) => {
    const family = String(m.id).split(":")[0].replace(/[-.]\d+[a-z]*$/i, "");
    if (seen.has(family)) return;
    seen.add(family);
    chain.push(m);
  };

  const byId = new Map((modelsStore.get().models || []).map((m) => [m.id, m]));
  for (const id of pinnedFor(tier, job)) {
    const m = byId.get(id);
    if (!m || !hasKey(m)) continue;
    if (job === "read" && !supportsVision(m)) continue; // cannot read handwriting; would fail every time
    const { why } = scoreEducationModel(m, job, tier);
    take({ ...m, _eduScore: 999, _eduWhy: why || "your pick", _pinned: true });
  }

  // One entry per family — a chain of six GPT-5.6 variants is not a fallback.
  for (const m of out) {
    if (chain.length >= CHAIN_DEPTH) break;
    take(m);
  }
  return chain;
}

export function setTier(tier) {
  if (!TIER_IDS.includes(tier)) return;
  educationStore.set({ tier, error: null });
  writeRaw(MODEL_KEY, tier);
}

/* ─── Your overrides ────────────────────────────────────────────────────────
   The tiers pick well on their own, but they pick from what a catalogue says.
   Pinning lets you put a model you trust at the head of a job's chain without
   giving up the fallback behind it. Stored per tier AND per job, because the
   model you want reading a 200-page PDF is rarely the one you want marking a
   two-line answer.
   ───────────────────────────────────────────────────────────────────────── */

const pinKey = (tier, job) => `${tier}:${job}`;

export function pinnedFor(tier, job) {
  const v = educationStore.get().pins[pinKey(tier, job)];
  return Array.isArray(v) ? v : [];
}

export function setPins(tier, job, ids) {
  if (!TIER_IDS.includes(tier) || !JOBS[job]) return;
  const pins = { ...educationStore.get().pins };
  const clean = [...new Set((ids || []).filter(Boolean))].slice(0, CHAIN_DEPTH);
  if (clean.length) pins[pinKey(tier, job)] = clean;
  else delete pins[pinKey(tier, job)];
  educationStore.set({ pins });
  try {
    writeJSON(PINS_KEY, pins);
  } catch {}
}

export function clearPins() {
  educationStore.set({ pins: {} });
  try {
    writeJSON(PINS_KEY, {});
  } catch {}
}

/* ─── Sources ───────────────────────────────────────────────────────────── */

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "heic", "heif", "tiff", "tif"]);

// A past paper is worth far more than its content — it carries your board's
// house style: section layout, mark split, how questions are actually phrased.
const PAST_PAPER_RE =
  /question\s*paper|previous\s*year|\bpyq\b|end[\s-]?sem|mid[\s-]?sem|model\s*paper|sample\s*paper|exam(ination)?\s*(paper|20\d\d)|board\s*paper|\bqp[\s._-]/i;

export function looksLikePastPaper(name = "", text = "") {
  if (PAST_PAPER_RE.test(name)) return true;
  const head = String(text).slice(0, 3000);
  // Two independent exam-sheet signals in the opening pages, not just one word.
  const signals = [
    /time\s*allowed|duration\s*[:—-]|max(imum)?\s*marks|total\s*marks/i,
    /answer\s+(any|all)\s|attempt\s+(any|all)\s/i,
    /section\s*[-–—]?\s*[abc]\b/i,
    /\[\s*\d{1,2}\s*marks?\s*\]|\(\s*\d{1,2}\s*marks?\s*\)/i,
  ].filter((re) => re.test(head)).length;
  return signals >= 2;
}

const PAGE_TRANSCRIBE_PROMPT =
  "Transcribe this page of course material completely. Include every heading, paragraph, bullet, " +
  "caption and table — read tables row by row. Write formulas out in plain readable notation. " +
  "For any diagram, chart or figure, describe what it shows and what it is teaching, because that " +
  "content has to survive into the transcript. Output the transcription only: no commentary, no " +
  "summary, no markdown fences.";

/**
 * Stage one of the pipeline: get the page into text.
 *
 * A vision model beats Tesseract badly on anything that is not clean printed
 * prose — formulas, tables, figures, handwriting — and unlike OCR it can say
 * what a diagram is teaching. Tesseract stays as the fallback for when the tier
 * has no vision model or the call fails.
 */
async function transcribePage(dataUrl) {
  if (candidatesFor("read").length > 0) {
    try {
      const { text } = await runJob(
        "read",
        [
          {
            role: "user",
            content: [
              { type: "text", text: PAGE_TRANSCRIBE_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        { maxTokens: 4000, phase: "reading" }
      );
      if (String(text || "").trim()) return { text: String(text), by: "vision model" };
    } catch {
      /* fall through to OCR rather than losing the page */
    }
  }
  const res = await runOCR({ dataUrl });
  return { text: res.text || "", by: res.backend === "endpoint" ? "OCR endpoint" : "Tesseract" };
}

/** Read one dropped file into plain text (PDF/PPTX/DOCX via main, images via OCR). */
export async function addSource(file) {
  beginRun();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const isImage = file.type.startsWith("image/") || IMAGE_EXTS.has(ext);
  educationStore.set({ busy: true, phase: "reading", error: null });

  try {
    let text = "";
    let kind = "notes";
    let readBy = null;

    if (isImage) {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("Could not read image"));
        r.readAsDataURL(file);
      });
      const res = await transcribePage(dataUrl);
      text = res.text;
      readBy = res.by;
      kind = "scan";
    } else if (window.electronAPI?.extractFileText) {
      const buf = await file.arrayBuffer();
      const res = await window.electronAPI.extractFileText(buf, file.name, file.type);
      if (res?.error) throw new Error(res.error);
      text = res?.text || "";
      kind = /\.pptx?$/i.test(file.name) ? "slides" : res?.kind === "pdf" ? "pdf" : "notes";
    } else {
      text = await file.text();
    }

    text = String(text || "").trim();
    if (!text) throw new Error(`No readable text in ${file.name}`);

    const source = {
      id: generateId(),
      name: file.name,
      kind,
      text: text.slice(0, MAX_SOURCE_CHARS),
      chars: text.length,
      ts: Date.now(),
      isPastPaper: looksLikePastPaper(file.name, text),
      ...(readBy ? { readBy } : {}),
    };
    educationStore.set((s) => {
      const sources = [...s.sources, source];
      persistSources(sources);
      return { sources, busy: false, phase: "", progress: null };
    });
    return source;
  } catch (err) {
    if (wasStopped(err)) return;
    educationStore.set({ busy: false, phase: "", progress: null, error: String(err?.message || err) });
    return null;
  }
}

/**
 * Study a topic you have no notes for: research it on the web and add the
 * result as a source. If the web turns up nothing usable, fall back to a plain
 * directive so the model works from its own knowledge rather than failing.
 */
export async function researchTopic(topic) {
  const q = String(topic || "").trim();
  if (!q) return null;
  beginRun();
  educationStore.set({ busy: true, phase: "researching", error: null });

  try {
    let hits = [];
    try {
      hits = (await webSearch(q, { detailed: true })) || [];
    } catch {
      hits = [];
    }
    let good = hits.filter((s) => s?.ok && s.fullText);

    if (good.length === 0) {
      try {
        good = ((await deepArticleSearch(q)) || []).filter((s) => s?.ok && s.fullText);
      } catch {
        good = [];
      }
    }

    const text = good.length
      ? good
          .slice(0, 6)
          .map((s) => `## ${s.title || s.url}\n${s.url || ""}\n\n${s.fullText}`)
          .join("\n\n---\n\n")
      : `TOPIC: ${q}\n\nNo web sources were reachable. Draw on your own knowledge of this topic ` +
        `and cover it the way a course would: core definitions, the main methods or processes, ` +
        `worked examples, and the comparisons a student is expected to be able to make.`;

    const source = {
      id: generateId(),
      name: q,
      kind: good.length ? "web" : "topic",
      text: text.slice(0, MAX_SOURCE_CHARS),
      chars: text.length,
      ts: Date.now(),
      sourceCount: good.length,
    };
    educationStore.set((s) => {
      const sources = [...s.sources, source];
      persistSources(sources);
      return { sources, busy: false, phase: "" };
    });
    return source;
  } catch (err) {
    if (wasStopped(err)) return;
    educationStore.set({ busy: false, phase: "", error: String(err?.message || err) });
    return null;
  }
}

export function removeSource(id) {
  educationStore.set((s) => {
    const sources = s.sources.filter((x) => x.id !== id);
    persistSources(sources);
    return { sources };
  });
}

export function clearSources() {
  educationStore.set({ sources: [] });
  persistSources([]);
}

/** Correct the auto-detection — you know what a past paper looks like better than a regex. */
export function togglePastPaper(id) {
  educationStore.set((s) => {
    const sources = s.sources.map((x) => (x.id === id ? { ...x, isPastPaper: !x.isPastPaper } : x));
    persistSources(sources);
    return { sources };
  });
}

export function setPaperFormat(text) {
  const v = String(text || "");
  educationStore.set({ paperFormat: v });
  writeRaw(FORMAT_KEY, v);
}

/**
 * The house style to write the paper in: what you told us about your exam
 * pattern, plus the opening of any past paper you uploaded so the model can
 * copy the real section layout, mark split and phrasing rather than invent one.
 */
function examFormatBlock() {
  const { sources, paperFormat } = educationStore.get();
  const parts = [];

  if (paperFormat.trim()) {
    parts.push(`HOW THIS INSTITUTION SETS PAPERS (follow this exactly):\n${paperFormat.trim()}`);
  }

  const papers = sources.filter((s) => s.isPastPaper);
  if (papers.length) {
    const per = Math.floor(9000 / papers.length);
    parts.push(
      `PAST PAPERS — copy this house style: the section layout, the mark split, how questions are ` +
        `worded and numbered, the instruction lines. Do NOT reuse their questions; set new ones on ` +
        `the material.\n\n` +
        papers.map((p) => `--- ${p.name} ---\n${p.text.slice(0, per)}`).join("\n\n")
    );
  }
  return parts.join("\n\n");
}

/**
 * Take a budget-sized sample spread across the WHOLE document.
 *
 * Taking the first N characters is what made early versions quiz the cover
 * page — "Subject Name", "University Name" — because the front of any course
 * PDF is a title page, a syllabus header and a contents list. Even windows
 * reach the actual teaching material in the middle and end too.
 */
function sampleText(text, budget) {
  if (text.length <= budget) return text;
  const windows = 6;
  const size = Math.floor(budget / windows);
  // Start a little past the front matter, and leave the trailing window flush
  // with the end so appendices and worked examples are reachable.
  const from = Math.min(Math.floor(text.length * 0.05), 4000);
  const span = text.length - from - size;
  const stride = windows > 1 ? Math.floor(span / (windows - 1)) : 0;
  const parts = [];
  for (let i = 0; i < windows; i++) {
    const start = from + i * stride;
    parts.push(text.slice(start, start + size).trim());
  }
  return parts.filter(Boolean).join("\n\n[…]\n\n");
}

/** Everything loaded, labelled by origin, at full length. */
function allMaterial() {
  return educationStore
    .get()
    .sources.map((s) => `--- ${s.kind.toUpperCase()}: ${s.name} ---\n${s.text}`)
    .join("\n\n");
}

/* ─── Token budget ──────────────────────────────────────────────────────────
   The hub honours the app's own token mode. Reading is the expensive half, so
   "aggressive" buys back most of the saving by sending less of each pass —
   coverage stays whole-document because chunking samples across it either way.
   ─────────────────────────────────────────────────────────────────────────── */

const TOKEN_MODE_FACTOR = { off: 1, balanced: 0.75, aggressive: 0.45 };

/** How much source text this model can actually take, leaving room to answer. */
function promptBudgetChars(model) {
  const ctx = contextTokens(model) || 32000;
  const mode = settingsStore.get().tokenMode || "balanced";
  const raw = ctx * CHARS_PER_TOKEN * 0.45 * (TOKEN_MODE_FACTOR[mode] ?? 0.75);
  const cap = settingsStore.get().maxInputTokens;
  const ceiling = cap > 0 ? cap * CHARS_PER_TOKEN * 0.8 : Infinity;
  return Math.max(8000, Math.floor(Math.min(raw, ceiling)));
}

// Apostrophes are dropped rather than spaced, so "Ohm's Law" and "Ohms Law"
// collapse together — that exact split is what two readers produce for one topic.
const normKey = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/*
 * Front matter, dropped structurally rather than by asking nicely.
 *
 * The comprehension prompt already tells the model to ignore cover pages and
 * course codes, and it still returns a "Course Information" topic — which then
 * becomes "What is the subject name and code for this practical file?". An
 * instruction is a request; this is a filter. It runs after comprehension so a
 * bad read cannot reach the authoring pass at all.
 */
const ADMIN_TOPIC =
  /^(course|subject|paper|unit|module)\s*(information|details|code|name|title)|^(student|candidate)\s|^(index|contents|table of contents|title page|front page|cover)|certificate|acknowledg|declaration|bonafide|^submitted (by|to)|^(name|roll|enrol|registration|semester|session|batch|branch|department|faculty|institute|university|college)\b|marks? distribution|scheme of (study|examination)|^syllabus$|^preface$|^index$|\b(document|file|report|submission)\s*(metadata|structure|information|details|overview|format)\b|^(metadata|front matter|administrative)/i;

const ADMIN_POINT =
  /\b(roll|enrol(l)?ment|registration)\s*(no|number)|\bsubmitted (by|to)\b|\bbonafide\b|\bsignature\b|\bpage \d+\b|^\s*(name|class|section|batch|semester|session|department|branch|college|university)\s*[:—-]/i;

/** Strip administrative topics and metadata points from a digest. */
export function dropFrontMatter(topics) {
  const out = [];
  for (const t of topics || []) {
    if (!t?.name || ADMIN_TOPIC.test(String(t.name).trim())) continue;
    const clean = {
      ...t,
      points: (t.points || []).filter((p) => !ADMIN_POINT.test(String(p))),
      terms: (t.terms || []).filter((p) => !ADMIN_POINT.test(String(p))),
      examples: (t.examples || []).filter((p) => !ADMIN_POINT.test(String(p))),
    };
    // A topic whose every point was metadata was a front-matter topic wearing
    // a content-sounding name.
    if (clean.points.length + clean.terms.length + clean.examples.length === 0) continue;
    out.push(clean);
  }
  return out;
}

/**
 * Merge the digests coming back from parallel readers.
 *
 * Chunks overlap at their seams and textbooks repeat themselves, so the raw
 * union carries the same topic several times over. Deduping here is the single
 * cheapest saving available: the authoring prompt is built from this.
 */
export function mergeTopics(topics) {
  const byKey = new Map();
  for (const t of topics || []) {
    const key = normKey(t?.name);
    if (!key) continue;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        name: t.name,
        points: [...(t.points || [])],
        terms: [...(t.terms || [])],
        examples: [...(t.examples || [])],
      });
      continue;
    }
    for (const field of ["points", "terms", "examples"]) {
      const seen = new Set(cur[field].map(normKey));
      for (const v of t[field] || []) {
        const k = normKey(v);
        if (k && !seen.has(k)) {
          cur[field].push(v);
          seen.add(k);
        }
      }
    }
  }
  return [...byKey.values()];
}

/**
 * Fit the digest into a token budget by taking detail round-robin across
 * topics. Truncating the list instead would silently drop whole subjects from
 * the end of the syllabus — breadth matters more than depth on any one topic.
 */
export function trimDigest(topics, maxTokens) {
  const full = digestBlock(topics);
  if (estimateTokensFromText(full) <= maxTokens) return { topics, trimmed: false };

  const kept = topics.map((t) => ({ ...t, points: [], terms: [], examples: [] }));
  let used = estimateTokensFromText(digestBlock(kept));
  let added = true;

  for (let depth = 0; added; depth++) {
    added = false;
    for (let i = 0; i < topics.length; i++) {
      for (const field of ["points", "terms", "examples"]) {
        const item = topics[i][field]?.[depth];
        if (item == null) continue;
        const cost = estimateTokensFromText(String(item)) + 2;
        if (used + cost > maxTokens) return { topics: kept, trimmed: true };
        kept[i][field].push(item);
        used += cost;
        added = true;
      }
    }
  }
  return { topics: kept, trimmed: true };
}

/**
 * Split the material into passes the model can genuinely read end to end.
 * Beyond MAX_CHUNKS passes each chunk is sampled internally, so coverage stays
 * whole-document even for a textbook against a small context window.
 */
function chunkMaterial(text, budget, workers = 1, cap = MAX_CHUNKS) {
  // How many passes the context window forces…
  const needed = Math.ceil(text.length / budget);
  // …versus how many the document is big enough to usefully support. Splitting
  // a document that already fits still pays off when workers are idle: the same
  // tokens in more, smaller passes finish in a fraction of the wall-clock, and
  // each model reads its own section closely rather than skimming everything.
  const useful = Math.floor(text.length / MIN_CHUNK_CHARS);
  const n = Math.min(cap, MAX_CHUNKS, Math.max(1, Math.min(needed, cap), Math.min(workers, useful)));
  if (n <= 1) return [text];

  const size = Math.ceil(text.length / n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const slice = text.slice(i * size, (i + 1) * size);
    out.push(slice.length > budget ? sampleText(slice, budget) : slice);
  }
  return out;
}

/* ─── Model plumbing ────────────────────────────────────────────────────── */

/** Pull the first balanced JSON object/array out of a model reply. */
export function parseJsonReply(raw) {
  const s = String(raw || "").replace(/```(?:json)?/gi, "");
  const first = Math.min(
    ...[s.indexOf("{"), s.indexOf("[")].filter((i) => i !== -1).concat([Infinity])
  );
  if (!Number.isFinite(first)) return null;
  const open = s[first];
  const close = open === "{" ? "}" : "]";
  const last = s.lastIndexOf(close);
  if (last <= first) return null;
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
}

/* ─── Stopping a run ────────────────────────────────────────────────────────
   The hub runs one job at a time — `busy` is a single flag — so one controller
   covers it. Every call the run makes carries this signal, including the
   parallel read workers, so stopping cancels the in-flight requests rather
   than just hiding the progress bar while tokens keep being billed.
   ───────────────────────────────────────────────────────────────────────── */

let runAbort = null;

function beginRun() {
  runAbort?.abort();
  runAbort = new AbortController();
}

/** True once the user has pressed Stop — checked before spending anything more. */
const stopped = () => !!runAbort?.signal.aborted;

/** Distinguish "you stopped it" from "it broke", so Stop never shows an error. */
export function wasStopped(err) {
  return err?.name === "AbortError" || String(err?.message || err) === STOP_MESSAGE;
}

const STOP_MESSAGE = "Stopped";

export function stopRun() {
  if (!runAbort) return;
  runAbort.abort();
  runAbort = null;
  educationStore.set({ busy: false, phase: "", progress: null, error: null });
}

/** One model, one call. Books the tokens and cost against the hub's own meter. */
async function callModel(model, messages, maxTokens) {
  if (stopped()) throw new Error(STOP_MESSAGE);
  const providers = keysStore.get().providers;
  const { text, usage } = await routeStream(providers, model, messages, {
    reasoningDepth: "off",
    temperature: 0.2,
    maxTokens,
    onChunk: () => {},
    signal: runAbort?.signal,
  });

  const cost = calculateCost(usage, model.pricing) || 0;
  recordProviderUsage(model._provider, usage || {}, cost);
  if (cost > 0) {
    addLifetimeCost(cost);
    addMonthlySpend(cost);
  }

  const spent = {
    inTokens: usage?.prompt_tokens || 0,
    outTokens: usage?.completion_tokens || 0,
    cost,
  };
  educationStore.set((s) => {
    const spend = {
      inTokens: s.spend.inTokens + spent.inTokens,
      outTokens: s.spend.outTokens + spent.outTokens,
      cost: s.spend.cost + spent.cost,
      runs: s.spend.runs + 1,
    };
    writeJSON(SPEND_KEY, spend);
    return { spend };
  });

  return { text, spent, model };
}

/**
 * Run one job through its fallback chain. Free endpoints rate-limit and drop
 * out constantly, so a refusal from the best model is not the end of the job —
 * it moves down the chain and reports which model actually answered.
 *
 * `validate` lets a caller reject a reply that arrived fine but was unusable
 * (bad JSON), so a model that answers with prose is failed over too.
 */
async function runOnChain(chain, job, messages, { maxTokens = 4000, validate, quiet = false } = {}) {
  let lastErr = null;
  for (let n = 0; n < chain.length; n++) {
    const model = chain[n];
    if (!quiet) {
      setProgress({ model: model.name || model.id, attempt: n + 1, of: chain.length, retrying: n > 0 });
    }
    try {
      const res = await callModel(model, messages, maxTokens);
      const parsed = validate ? validate(res.text) : res.text;
      if (parsed == null) throw new Error(`${model.name || model.id} did not return usable output`);
      educationStore.set((s) => ({ route: { ...s.route, [job]: model.name || model.id } }));
      return { ...res, parsed };
    } catch (err) {
      // Stopping must end the run, not demote it to the next model in the chain.
      if (wasStopped(err)) throw err;
      lastErr = err;
    }
  }
  throw new Error(
    `${JOBS[job]?.label || job} failed on all ${chain.length} available model${chain.length === 1 ? "" : "s"}. ` +
      `Last error: ${String(lastErr?.message || lastErr)}`
  );
}

function noModelsError(tier) {
  return new Error(
    tier === "free"
      ? "No free model is available for this right now. Switch to Paid, or add an OpenRouter key."
      : tier === "paid"
      ? "Nothing between $0.0001 and $5 per million tokens is available for this. Try Paid+, or add another provider key."
      : "Paid+ only offers models above $5 per million tokens, and none is reachable with your current keys. Try Paid, or add an OpenRouter key."
  );
}

async function runJob(job, messages, { maxTokens = 4000, phase, validate } = {}) {
  const tier = educationStore.get().tier;
  const chain = candidatesFor(job, tier);
  if (chain.length === 0) throw noModelsError(tier);
  educationStore.set({ busy: true, phase, error: null });
  return runOnChain(chain, job, messages, { maxTokens, validate });
}

/** Start the chain at a different model per worker, keeping the rest as backup. */
export function rotate(arr, n) {
  if (arr.length < 2) return arr;
  const k = n % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

export function resetEduSpend() {
  educationStore.set({ spend: { ...NO_SPEND } });
  writeJSON(SPEND_KEY, { ...NO_SPEND });
}

/** "12.4k" / "834" — token counts read better rounded. */
export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

/** Sub-cent costs still matter when they repeat — never round them to "$0.00". */
export function formatSpend(cost) {
  const v = Number(cost) || 0;
  if (v === 0) return "free";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

/* ─── Generation ────────────────────────────────────────────────────────── */

export const KIND_LABEL = { flashcards: "Flashcards", quiz: "Quiz", paper: "Exam paper" };

// Every item carries the topic it came from, so a card can be traced back to
// what the material actually taught rather than taken on trust.
const SHAPES = {
  flashcards:
    '{"title":"...","cards":[{"q":"front of card","a":"back of card","hint":"optional one-liner","topic":"the topic this came from"}]}',
  quiz:
    '{"title":"...","questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"why":"why the answer is right","topic":"the topic this came from"}]}',
  paper:
    '{"title":"...","durationMin":60,"totalMarks":50,"sections":[' +
    '{"name":"Section A — Multiple choice","instructions":"...","questions":[' +
    '{"n":1,"q":"...","marks":1,"type":"mcq","options":["A","B","C","D"],"answer":0,' +
    '"expects":"why that option is correct","topic":"the topic this came from"}]},' +
    '{"name":"Section B — Written","instructions":"...","questions":[' +
    '{"n":6,"q":"...","marks":5,"type":"short","expects":"what a full-mark answer must contain",' +
    '"topic":"the topic this came from"}]}]}',
};

// Course material is often full of code, and a question about a program is
// unreadable as one run-on line. Both the asking and the answering side need
// real fences so the UI can syntax-highlight them.
/* The shape above is a template, and a weaker model will sometimes hand it
   straight back — "...", four options literally called A/B/C/D, one question
   where thirty were asked. That parses as valid JSON, so without a content
   check it sails past the fallback chain and gets saved as a real deck. */

const PLACEHOLDER =
  /^\s*(\.\.\.|…|string|text|question|answer|front of card|back of card|optional one-liner|the topic this came from|why the answer is right|what a full-mark answer must contain|[a-d])\s*$/i;

const isPlaceholder = (v) => !String(v || "").trim() || PLACEHOLDER.test(String(v));

/*
 * The last line of defence, and the one that actually holds.
 *
 * Filtering by topic name was too fragile: the model labelled a whole batch of
 * cover-page questions "Document Metadata" and "Document Structure", names no
 * hand-written list of admin words was ever going to contain. So this checks
 * the QUESTION itself. Whatever the topic was called, a question about page
 * counts, supervising faculty, a UID or a subject code printed on the cover is
 * not a question about the subject.
 */
const META_QUESTION =
  /how many (total )?pages|number of pages|\bcover page\b|\btitle page\b|\bfront page\b|(subject|course|unit|paper|class) code\b|\bUID\b|\broll\s*(no|number)|enrol(l)?ment\s*(no|number)|registration\s*(no|number)|which faculty|faculty member|supervis(ing|or|ed by)|submitted (by|to)|name of the (university|college|institute|department|student|faculty)|university institute|academic batch|which (semester|session|batch)\b|student'?s? (name|uid|details)|this (practical )?file (contains|was|is|has)|according to the (cover|title|front)|listed (on|in) the (cover|title|index)|table of contents|as (shown|printed|written) on the (cover|title|front)/i;

export const isMetaQuestion = (q) => META_QUESTION.test(String(q || ""));

/*
 * A cover-page TITLE is not shaped like a question, so it needs its own test.
 * "Chandigarh University Practical File … — Student: Parikshit Dahiya
 * (24BET10298)" describes the document, not what the deck teaches.
 */
const META_TITLE =
  /\b(practical|assignment|lab)\s*(file|record|report)\b|\bstudent\s*[:—–-]|\bUID\s*[:—–-]?\s*\d|\b\d{2}[A-Z]{2,4}\d{4,}\b|submitted (by|to)\b/i;

export const isMetaTitle = (t) => {
  const s = String(t || "");
  return META_TITLE.test(s) || META_QUESTION.test(s);
};

/** Real content, in roughly the quantity asked for — or hand it to the next model. */
export function validateSet(kind, wanted = 1, topics = 0) {
  // Thin material cannot support a big deck. A 1,500-character practical file
  // yields one topic; demanding twelve cards from it fails every model in the
  // chain forever. Expect a realistic share of what is actually there.
  const realistic = topics > 0 ? Math.min(wanted, Math.max(3, topics * 2)) : wanted;
  const enough = (n) => n >= Math.max(1, Math.ceil(realistic * 0.4));

  return (raw) => {
    const p = parseJsonReply(raw);
    if (!p) return null;

    // The title is written from the material too, so it inherits the same
    // problem — "Practical File: … — Student: … (24BET10298)" is a cover page.
    const title = isMetaTitle(p.title) ? "" : p.title;

    if (kind === "flashcards") {
      const cards = (p.cards || []).filter(
        (c) => !isPlaceholder(c?.q) && !isPlaceholder(c?.a) && !isMetaQuestion(c?.q)
      );
      return enough(cards.length) ? { ...p, title, cards } : null;
    }

    if (kind === "quiz") {
      const questions = (p.questions || []).filter(
        (q) =>
          !isPlaceholder(q?.q) &&
          !isMetaQuestion(q?.q) &&
          Array.isArray(q.options) &&
          q.options.length >= 2 &&
          // Options literally named "A", "B", "C", "D" are the template, not answers.
          !q.options.every(isPlaceholder) &&
          Number.isInteger(q.answer) &&
          q.answer >= 0 &&
          q.answer < q.options.length
      );
      return enough(questions.length) ? { ...p, title, questions } : null;
    }

    const sections = (p.sections || [])
      .map((sec) => ({
        ...sec,
        questions: (sec.questions || []).filter((q) => !isPlaceholder(q?.q) && !isMetaQuestion(q?.q)),
      }))
      .filter((sec) => sec.questions.length > 0);
    const total = sections.reduce((n, s) => n + s.questions.length, 0);
    return enough(total) ? { ...p, title, sections } : null;
  };
}

const CODE_RULE =
  "Whenever a question or answer involves code, a program, a snippet or terminal output, wrap it in " +
  "a fenced block with the language tag (```c, ```python, ```sql and so on). Never inline a multi-line " +
  "program into a sentence. Keep the surrounding explanation outside the fence.";

/**
 * Build a study set from the loaded sources.
 * @param {{ kind: string, count: number, difficulty: string, minutes?: number }} opts
 */
const DIGEST_SHAPE =
  '{"topics":[{"name":"topic as the material teaches it","points":["substantive fact, rule or step"],' +
  '"terms":["term — definition"],"examples":["worked example or application"]}]}';

/**
 * Pass one: actually read the material.
 *
 * Generating questions straight from raw text produces shallow, boilerplate
 * cards — worse, it latches onto whatever sits at the top of the file. So the
 * model first has to produce a structured account of what the material teaches,
 * and only that account is allowed to become questions.
 *
 * The account is cached against the source, because re-reading a 200-page PDF
 * on every generation is the difference between a demo and something you can
 * afford to run daily.
 */
function comprehendPrompt(chunk, i, n) {
  const part = n > 1 ? ` (part ${i + 1} of ${n})` : "";
  return (
      `Read this course material${part} carefully and write down what it actually teaches.\n\n` +
      `For every distinct topic, capture the substantive content: the rules, definitions, methods, ` +
      `steps, comparisons, formulas and worked examples a student is expected to master. Be specific ` +
      `and concrete — "Kirchhoff's current law: the sum of currents into a node is zero" is useful, ` +
      `"discusses circuit laws" is not.\n\n` +
      `Ignore completely: cover pages, the subject or course name, university and department names, ` +
      `unit codes, semester or exam-session labels, author and edition details, tables of contents, ` +
      `page headers and footers, and any other administrative front matter. None of it is content.\n\n` +
      `Reply with ONLY this JSON, no prose and no code fence:\n${DIGEST_SHAPE}\n\n` +
      `MATERIAL:\n${chunk}`
  );
}

/**
 * Recover a digest from a reply that was cut off mid-JSON.
 *
 * Reasoning models spend part of the output budget thinking before they emit
 * anything, so a long chunk can run out of tokens partway through the topic
 * array. Throwing that away wastes the whole (expensive) pass, when everything
 * up to the last complete topic is perfectly good.
 */
export function salvageTopics(raw) {
  const s = String(raw || "");
  const key = s.indexOf('"topics"');
  if (key === -1) return null;
  const arrStart = s.indexOf("[", key);
  if (arrStart === -1) return null;

  for (let i = s.lastIndexOf("}"); i > arrStart; i = s.lastIndexOf("}", i - 1)) {
    try {
      const arr = JSON.parse(`${s.slice(arrStart, i + 1)}]`);
      if (Array.isArray(arr) && arr.length && arr.some((t) => t?.name)) {
        return { topics: arr.filter((t) => t?.name), salvaged: true };
      }
    } catch {
      /* keep walking back to the previous closing brace */
    }
  }
  return null;
}

const validDigest = (raw) => {
  const p = parseJsonReply(raw);
  if (Array.isArray(p?.topics) && p.topics.length) return p;
  return salvageTopics(raw);
};

/** Bounded-concurrency map. Unbounded Promise.all on ten PDFs just gets rate-limited. */
async function runPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (err) {
        out[i] = { ok: false, err };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/**
 * Read every chunk at once, each starting on a different model.
 *
 * Passes were sequential, which made a long document as slow as the sum of its
 * parts. Chunk i now starts on chain[i] and keeps the rest of the chain as its
 * own fallback, so a big deck reads in roughly the time of its slowest pass —
 * and because each worker hits a different endpoint, free-tier rate limits get
 * spread instead of stacked.
 */
async function readInParallel(jobs, chain, label) {
  educationStore.set({ busy: true, phase: "comprehending", error: null });
  const workers = Math.min(jobs.length, chain.length);
  setProgress({
    label,
    step: 0,
    total: jobs.length,
    found: 0,
    parallel: workers,
    model: chain.slice(0, workers).map((m) => m.name || m.id).join(" · "),
  });

  const settled = await runPool(jobs, MAX_IN_FLIGHT, async (job, i) => {
    const { parsed } = await runOnChain(
      rotate(chain, i),
      "comprehend",
      [{ role: "user", content: comprehendPrompt(job.chunk, job.i, job.n) }],
      { maxTokens: COMPREHEND_TOKENS, validate: validDigest, quiet: jobs.length > 1 }
    );
    // Parallel writers, so count up through the store rather than a local.
    educationStore.set((s) => {
      const p = s.progress || {};
      return { progress: { ...p, step: (p.step || 0) + 1, found: (p.found || 0) + parsed.topics.length } };
    });
    return parsed.topics;
  });

  // Stopping is not partial failure — do not carry on with whatever landed
  // before the abort, because the next stage would spend on it.
  if (stopped()) throw new Error(STOP_MESSAGE);

  // A pass that fails must not destroy the run. Losing one section of a long
  // document is a far better outcome than throwing away every token already
  // spent on the sections that read fine.
  const failed = settled.filter((r) => !r.ok);
  if (failed.length === settled.length) throw failed[0].err;
  if (failed.length > 0) {
    educationStore.set((s) => ({ progress: { ...(s.progress || {}), failedPasses: failed.length } }));
  }
  return settled.map((r) => (r.ok ? r.value : []));
}

/**
 * Read every source that has not been read yet, caching each one's digest so a
 * second deck off the same notes costs one call instead of five.
 */
async function comprehendSources() {
  const { sources, tier } = educationStore.get();
  const chain = candidatesFor("comprehend", tier);
  if (chain.length === 0) throw noModelsError(tier);
  const budget = promptBudgetChars(chain[0]);

  // Flatten every unread chunk from every source into ONE parallel batch, so
  // three files do not read one after another either.
  const cached = [];
  const unread = [];
  for (const src of sources) {
    if (Array.isArray(src.digest) && src.digest.length) cached.push(...src.digest);
    else unread.push(src);
  }
  if (unread.length === 0) return { topics: cached, cachedAll: true };

  // Share a fixed pass budget across however many files were dropped, so ten
  // PDFs cost about the same as one big one rather than ten times as much.
  const perSource = Math.max(1, Math.floor(MAX_TOTAL_PASSES / unread.length));

  const jobs = [];
  for (const src of unread) {
    const chunks = chunkMaterial(
      `--- ${src.kind.toUpperCase()}: ${src.name} ---\n${src.text}`,
      budget,
      Math.min(chain.length, READ_WORKERS, perSource),
      perSource
    );
    chunks.forEach((chunk, i) => jobs.push({ srcId: src.id, chunk, i, n: chunks.length }));
  }

  const label =
    jobs.length > 1
      ? `Reading ${unread.length > 1 ? `${unread.length} files` : "your material"} — ${jobs.length} passes across ` +
        `${Math.min(jobs.length, chain.length, MAX_IN_FLIGHT)} models`
      : "Reading your material";
  const perJob = await readInParallel(jobs, chain, label);

  // Regroup by source so each one's digest can be cached independently.
  const bySource = new Map();
  jobs.forEach((job, i) => {
    if (!bySource.has(job.srcId)) bySource.set(job.srcId, []);
    bySource.get(job.srcId).push(...perJob[i]);
  });

  educationStore.set((s) => {
    const next = s.sources.map((x) => {
      const topics = bySource.get(x.id);
      // Only cache a digest that actually has something in it — caching an
      // empty result would mark a file permanently read with nothing learned.
      return topics && topics.length ? { ...x, digest: topics } : x;
    });
    persistSources(next);
    return { sources: next };
  });

  return { topics: [...cached, ...perJob.flat()], cachedAll: false };
}

/** Render the digest back into prompt text for the authoring pass. */
function digestBlock(topics) {
  return topics
    .map((t) => {
      const lines = [`### ${t.name}`];
      for (const p of t.points || []) lines.push(`- ${p}`);
      for (const term of t.terms || []) lines.push(`- TERM: ${term}`);
      for (const ex of t.examples || []) lines.push(`- EXAMPLE: ${ex}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export async function generateSet({ kind, count, difficulty, minutes = 60 }) {
  beginRun();
  const material = allMaterial();
  if (!material.trim()) {
    educationStore.set({ error: "Add some notes, slides or a past paper first." });
    return null;
  }

  const ask_ =
    kind === "paper"
      ? `Write a complete ${minutes}-minute exam paper of about ${count} questions. Open with a ` +
        `multiple-choice section worth 1 mark each (type "mcq", exactly four options, "answer" is the ` +
        `0-based index of the correct one), then a written section of short and long answers worth ` +
        `more marks. Number questions continuously across sections and make the marks sum sensibly.`
      : kind === "quiz"
      ? `Write ${count} multiple-choice questions with exactly four options each. "answer" is the 0-based index of the correct option.`
      : `Write ${count} flashcards. Fronts are single recall prompts, backs are complete but tight.`;

  try {
    setProgress({ label: "Starting", step: 0, total: 1, startedAt: Date.now() });

    // Pass one — read it (or reuse what was read last time).
    const { topics: readTopics, cachedAll } = await comprehendSources();
    const topics = dropFrontMatter(mergeTopics(readTopics));
    if (topics.length === 0) {
      throw new Error(
        "Only front matter was found — cover pages, course codes, an index. Nothing teachable to build from."
      );
    }
    const merged = readTopics.length - topics.length;
    setProgress({
      label: cachedAll
        ? "Using what was already read"
        : `Read ${topics.length} topics${merged > 0 ? ` (${merged} duplicates merged)` : ""}`,
      found: topics.length,
    });

    // Pass two — write from that understanding, with the source still to hand
    // if the authoring model has room for it.
    const writer = candidatesFor("author")[0];
    const budgetTokens = Math.floor(promptBudgetChars(writer || {}) / CHARS_PER_TOKEN);

    // Reserve a fifth of the window for instructions and the reply.
    const { topics: fitted, trimmed } = trimDigest(topics, Math.floor(budgetTokens * 0.8));
    const digest = digestBlock(fitted);

    // The digest IS the comprehension — re-sending the raw source on top of it
    // is the most expensive thing this prompt could do. Only attach it when the
    // digest is small enough that original wording still adds something.
    const room = budgetTokens - estimateTokensFromText(digest);
    const excerpt =
      !trimmed && room > 3000
        ? `\n\nSOURCE MATERIAL (for wording and detail):\n${sampleText(material, room * CHARS_PER_TOKEN)}`
        : "";

    // A paper is judged on whether it looks like YOUR exam, so the house style
    // goes in ahead of everything else and outranks the generic shape below.
    const format = kind === "paper" ? examFormatBlock() : "";

    const prompt =
      // Voice matters: a flat summariser writes flat questions. A tutor who has
      // taught the course writes ones worth answering.
      `You are a demanding subject tutor who has taught this course for years, and you have already ` +
      `read this material. Below is your own account of what it teaches.\n\n` +
      `Write the way a good examiner does: direct, specific, in the vocabulary of the subject itself. ` +
      `Never ask something whose answer is a label rather than an idea — if the answer could be read ` +
      `off a cover page, an index or a course handbook, it is not a question.\n\n` +
      `${ask_}\n` +
      (format
        ? `\nThe structure below overrides the default shape wherever the two disagree — match the ` +
          `real paper's sections, mark distribution and wording conventions.\n\n${format}\n\n`
        : "") +
      `Difficulty: ${difficulty}. Draw across ALL ${topics.length} topics rather than clustering on ` +
      `the first few, and base every question on a specific point, term or example listed below — ` +
      `never on the document's title, course code, institution or any other front matter.\n\n` +
      `${CODE_RULE}\n\n` +
      `Reply with ONLY this JSON shape — the JSON itself must not be fenced, though code inside the ` +
      `string values should be. Every "..." below is a placeholder you must replace with real ` +
      `content from the material; returning the template itself, or option labels literally called ` +
      `A/B/C/D, is a failed answer:\n${SHAPES[kind]}\n\n` +
      `WHAT THE MATERIAL TEACHES:\n${digest}${excerpt}`;

    setProgress({
      label: `Writing ${count} ${kind === "flashcards" ? "cards" : "questions"} from ${topics.length} topics`,
      step: 1,
      total: 1,
    });

    const { parsed: payload, spent, model } = await runJob("author", [{ role: "user", content: prompt }], {
      maxTokens: kind === "paper" ? 8000 : 6000,
      phase: "generating",
      validate: validateSet(kind, count, topics.length),
    });

    const set = {
      id: generateId(),
      kind,
      title: payload.title || `${KIND_LABEL[kind]} — ${new Date().toLocaleDateString()}`,
      ts: Date.now(),
      modelName: model.name || model.id,
      tier: educationStore.get().tier,
      difficulty,
      spent,
      topicCount: topics.length,
      trimmed,
      payload,
    };
    educationStore.set((s) => {
      const sets = [set, ...s.sets].slice(0, MAX_SETS);
      persistSets(sets);
      return { sets, activeSetId: set.id, busy: false, phase: "", progress: null };
    });
    return set;
  } catch (err) {
    if (wasStopped(err)) return;
    educationStore.set({ busy: false, phase: "", progress: null, error: String(err?.message || err) });
    return null;
  }
}

/* ─── Spaced repetition ─────────────────────────────────────────────────────
   FSRS-6 (see ./fsrs.js). A deck you page through once is a toy; scheduling is
   what makes it worth opening tomorrow — and which scheduler decides whether
   the intervals it hands you are any good.
   ─────────────────────────────────────────────────────────────────────────── */

export const GRADE = RATING; // 1 again · 2 hard · 3 good · 4 easy

/** How much you intend to remember. 0.90 for a term, 0.95 the week of an exam. */
export function setRetention(r) {
  const v = Math.min(0.97, Math.max(0.7, Number(r) || 0.9));
  educationStore.set({ retention: v });
  writeRaw(RETENTION_KEY, String(v));
}

export function scheduleNext(prev, grade, retention) {
  return review(prev, grade, { retention: retention ?? educationStore.get().retention });
}

export function reviewCard(setId, index, grade) {
  educationStore.set((s) => {
    const sets = s.sets.map((set) =>
      set.id === setId
        ? {
            ...set,
            review: {
              ...(set.review || {}),
              [index]: review(set.review?.[index], grade, { retention: s.retention }),
            },
          }
        : set
    );
    persistSets(sets);
    // A card's state records only its LAST review, so streaks and history need
    // their own log. Two numbers per entry keeps a year of study under 10 KB.
    const log = [...s.log, { t: Date.now(), g: grade }].slice(-MAX_LOG);
    persistLog(log);
    return { sets, log };
  });
}

/* ─── Study statistics ──────────────────────────────────────────────────────
   All derived from FSRS state, which is the point of having it: stability per
   card makes "what will I have forgotten by Friday" answerable rather than a
   guess from counting cards.
   ─────────────────────────────────────────────────────────────────────────── */

const startOfDay = (ts) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Every scheduled card across every deck, flattened. */
function allScheduled(sets) {
  const out = [];
  for (const set of sets || []) {
    if (set.kind !== "flashcards") continue;
    const total = (set.payload?.cards || []).length;
    for (let i = 0; i < total; i++) out.push(set.review?.[i] || null);
  }
  return out;
}

/** Cards due right now, across every deck. */
export function dueAcross(sets, now = Date.now()) {
  return allScheduled(sets).filter((r) => !r || (r.due ?? 0) <= now).length;
}

/**
 * How many cards come due on each of the next `days` days.
 *
 * Unseen cards land on day 0 — they are due now by definition — so the first
 * bar is the real backlog rather than an empty-looking start.
 */
export function forecast(sets, days = 14, now = Date.now()) {
  const base = startOfDay(now);
  const bins = new Array(days).fill(0);
  for (const r of allScheduled(sets)) {
    const due = r?.due ?? now;
    const offset = Math.floor((startOfDay(due) - base) / DAY);
    if (offset < 0) bins[0] += 1;
    else if (offset < days) bins[offset] += 1;
  }
  return bins;
}

/**
 * Predicted average recall across the deck for each of the next `days` days,
 * assuming you review nothing. This is the forgetting curve for your actual
 * collection rather than for one idealised card.
 */
export function retentionForecast(sets, days = 30, now = Date.now()) {
  const seen = allScheduled(sets).filter((r) => r && r.stability > 0);
  if (seen.length === 0) return [];
  return Array.from({ length: days }, (_, d) => {
    const at = now + d * DAY;
    const sum = seen.reduce(
      (acc, r) => acc + retrievability((at - (r.lastReview || now)) / DAY, r.stability),
      0
    );
    return sum / seen.length;
  });
}

/** Reviews per day for the last `days` days — the streak view. */
export function activity(log, days = 91, now = Date.now()) {
  const base = startOfDay(now) - (days - 1) * DAY;
  const bins = new Array(days).fill(0);
  for (const entry of log || []) {
    const offset = Math.floor((startOfDay(entry.t) - base) / DAY);
    if (offset >= 0 && offset < days) bins[offset] += 1;
  }
  return bins;
}

/** Consecutive days ending today (or yesterday) with at least one review. */
export function streak(log, now = Date.now()) {
  if (!log?.length) return 0;
  const days = new Set(log.map((e) => startOfDay(e.t)));
  const today = startOfDay(now);
  // Today not started yet should not break a run — count from yesterday.
  let cursor = days.has(today) ? today : today - DAY;
  let n = 0;
  while (days.has(cursor)) {
    n += 1;
    cursor -= DAY;
  }
  return n;
}

/** Headline numbers for the dashboard. */
export function studySummary(sets, log, now = Date.now()) {
  const scheduled = allScheduled(sets);
  const seen = scheduled.filter((r) => r && r.stability > 0);
  const recall = seen.length
    ? seen.reduce((a, r) => a + retrievability((now - (r.lastReview || now)) / DAY, r.stability), 0) /
      seen.length
    : null;
  return {
    total: scheduled.length,
    seen: seen.length,
    due: dueAcross(sets, now),
    recall,
    streak: streak(log, now),
    reviewsToday: (log || []).filter((e) => startOfDay(e.t) === startOfDay(now)).length,
    // A card lapsed three or more times is usually a badly written card.
    leeches: scheduled.filter((r) => (r?.lapses || 0) >= 3).length,
  };
}

/* ─── Free recall ───────────────────────────────────────────────────────────
   Flipping a card and self-grading is the weakest form of retrieval there is:
   you look at the answer, decide you knew it, and move on. Writing the answer
   first and having it marked is what the testing-effect literature actually
   measures — short-answer beats recognition, and testing WITH feedback beats
   testing without it. That is the whole reason this costs a model call.
   ─────────────────────────────────────────────────────────────────────────── */

export const RECALL_MODES = [
  { id: "flip", label: "Flip", hint: "reveal and grade yourself — free" },
  { id: "type", label: "Type", hint: "write it, get it marked — one call per card" },
];

export function setRecallMode(mode) {
  if (mode !== "flip" && mode !== "type") return;
  educationStore.set({ recallMode: mode });
  writeRaw(RECALL_KEY, mode);
}

/** Confidence stated before the answer is revealed — surfaces miscalibration. */
export const CONFIDENCE = [
  { id: "guess", label: "Guessing" },
  { id: "unsure", label: "Not sure" },
  { id: "sure", label: "Confident" },
];

/**
 * Mark a written answer against the card.
 *
 * Returns a verdict, what was missing, and a suggested FSRS grade — suggested
 * rather than applied, because you are still the one who knows whether you
 * actually knew it.
 */
export async function markRecall({ question, expected, answer, hintUsed = false }) {
  const written = String(answer || "").trim();
  if (!written) return null;

  const prompt =
    `Mark this flashcard answer. Be fair but not generous: a near-miss is partial, not correct.\n\n` +
    `QUESTION:\n${question}\n\nEXPECTED ANSWER:\n${expected}\n\nWHAT THEY WROTE:\n${written.slice(0, 4000)}\n\n` +
    `Say specifically what was absent or wrong — "incorrect" teaches nothing. If it is fully right, ` +
    `say so in a few words and leave nothing to add.\n\n` +
    `Reply with ONLY this JSON, no prose and no code fence:\n` +
    `{"verdict":"correct"|"partial"|"wrong","missing":"one or two sentences","grade":1}\n` +
    `grade: 1 wrong · 2 right but incomplete or laboured · 3 right · 4 right, complete and fluent.`;

  try {
    const { parsed, spent } = await runJob("mark", [{ role: "user", content: prompt }], {
      maxTokens: 700,
      phase: "grading",
      validate: (raw) => {
        const p = parseJsonReply(raw);
        if (!p || !["correct", "partial", "wrong"].includes(p.verdict)) return null;
        return p;
      },
    });

    const grade = Math.min(4, Math.max(1, Math.round(Number(parsed.grade) || 1)));
    educationStore.set({ busy: false, phase: "", progress: null });
    return {
      verdict: parsed.verdict,
      missing: String(parsed.missing || "").trim(),
      // Revealing the hint caps the grade: cued recall helps today and costs you
      // in a month, so it must not be able to earn the longest interval.
      grade: hintUsed ? Math.min(grade, 2) : grade,
      hintUsed,
      spent,
    };
  } catch (err) {
    if (wasStopped(err)) return;
    educationStore.set({ busy: false, phase: "", progress: null, error: String(err?.message || err) });
    return null;
  }
}

/** Cards this deck is most likely to have forgotten — the honest weak list. */
export function resetReview(setId) {
  educationStore.set((s) => {
    const sets = s.sets.map((set) => (set.id === setId ? { ...set, review: {} } : set));
    persistSets(sets);
    return { sets };
  });
}

/** Indexes of cards due now — unseen cards count as due. */
export function dueIndexes(set, now = Date.now()) {
  const cards = set?.payload?.cards || [];
  const review = set?.review || {};
  return cards.map((_, i) => i).filter((i) => !review[i] || (review[i].due ?? 0) <= now);
}

/** When the next card comes back, or null if the deck is unstarted. */
export function nextDueAt(set) {
  const due = Object.values(set?.review || {})
    .map((r) => r?.due)
    .filter((d) => typeof d === "number");
  return due.length ? Math.min(...due) : null;
}

export function dueLabel(ts) {
  if (!ts) return "";
  const d = ts - Date.now();
  if (d <= 0) return "now";
  if (d < 3600000) return `${Math.max(1, Math.round(d / 60000))}m`;
  if (d < DAY) return `${Math.round(d / 3600000)}h`;
  return `${Math.round(d / DAY)}d`;
}

export function removeSet(id) {
  educationStore.set((s) => {
    const sets = s.sets.filter((x) => x.id !== id);
    persistSets(sets);
    return { sets, activeSetId: s.activeSetId === id ? null : s.activeSetId };
  });
}

export function openSet(id) {
  educationStore.set({ activeSetId: id, attempt: null, error: null });
}

/** Flatten a paper's sections into one ordered question list. */
export function paperQuestions(set) {
  if (!set || set.kind !== "paper") return [];
  const out = [];
  for (const sec of set.payload?.sections || []) {
    for (const q of sec.questions || []) out.push({ ...q, section: sec.name });
  }
  return out.map((q, i) => ({ ...q, n: q.n ?? i + 1 }));
}

/* ─── Attempt ───────────────────────────────────────────────────────────── */

export function startAttempt(setId, limitMin) {
  educationStore.set({
    attempt: {
      setId,
      startedAt: Date.now(),
      limitSec: Math.max(1, Number(limitMin) || 60) * 60,
      answers: {},
      submitted: false,
      result: null,
      transcribed: null,
    },
    error: null,
  });
}

export function setAnswer(n, text) {
  educationStore.set((s) =>
    s.attempt ? { attempt: { ...s.attempt, answers: { ...s.attempt.answers, [n]: text } } } : {}
  );
}

export function abandonAttempt() {
  educationStore.set({ attempt: null });
}

/**
 * Read a photo of a handwritten answer sheet and fill the answer boxes.
 * A vision model transcribes and maps answers to question numbers directly —
 * far better on handwriting than plain OCR, which is kept as the fallback for
 * when no vision model is available.
 */
export async function ingestAnswerSheet(dataUrl) {
  const { attempt, sets } = educationStore.get();
  if (!attempt) return null;
  beginRun();
  const set = sets.find((s) => s.id === attempt.setId);
  const questions = paperQuestions(set);
  const numbers = questions.map((q) => q.n);

  const instruction =
    `This is a photo of a handwritten exam answer sheet. Transcribe it and map each answer to its ` +
    `question number. Valid question numbers: ${numbers.join(", ")}. Preserve the candidate's own ` +
    `wording, including mistakes — do not correct or improve anything. Omit questions left blank.\n\n` +
    `Reply with ONLY this JSON: {"answers":{"1":"transcribed text","2":"..."}}`;

  const canSee = candidatesFor("read").length > 0;

  try {
    let parsed;
    if (canSee) {
      // A vision model reads the handwriting directly — far better than OCR.
      ({ parsed } = await runJob(
        "read",
        [
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        { maxTokens: 4000, phase: "transcribing", validate: parseJsonReply }
      ));
    } else {
      // Nothing in this tier can see. Fall back to OCR, then have a text model
      // clean up and split the result by question number.
      educationStore.set({ busy: true, phase: "transcribing", error: null });
      const ocr = await runOCR({ dataUrl });
      ({ parsed } = await runJob(
        "author",
        [{ role: "user", content: `${instruction}\n\nOCR TEXT:\n${ocr.text || ""}` }],
        { maxTokens: 4000, phase: "transcribing", validate: parseJsonReply }
      ));
    }

    const answers = parsed?.answers;
    if (!answers || typeof answers !== "object") {
      throw new Error("Could not read any answers from that photo.");
    }

    const valid = new Set(numbers.map(String));
    const merged = {};
    for (const [k, v] of Object.entries(answers)) {
      if (valid.has(String(k)) && String(v || "").trim()) merged[k] = String(v).trim();
    }
    if (Object.keys(merged).length === 0) throw new Error("No answers matched a question number.");

    educationStore.set((s) => ({
      busy: false,
      phase: "",
      attempt: s.attempt
        ? {
            ...s.attempt,
            answers: { ...s.attempt.answers, ...merged },
            transcribed: Object.keys(merged).length,
          }
        : s.attempt,
    }));
    return merged;
  } catch (err) {
    if (wasStopped(err)) return;
    educationStore.set({ busy: false, phase: "", error: String(err?.message || err) });
    return null;
  }
}

/** Mark the current attempt against the paper's own mark scheme. */
export async function gradeAttempt() {
  const { attempt, sets } = educationStore.get();
  if (!attempt) return null;
  beginRun();
  const set = sets.find((s) => s.id === attempt.setId);
  const questions = paperQuestions(set);

  const script = questions
    .map((q) => {
      // A transcribed sheet can run long; a 5-mark answer never needs 20k chars.
      const cap = Math.max(800, (Number(q.marks) || 1) * 500);
      const a = String(attempt.answers[q.n] || "").trim().slice(0, cap);
      const correct =
        q.type === "mcq" && Array.isArray(q.options) && q.options[q.answer] != null
          ? `Correct option: ${"ABCD"[q.answer] || q.answer}) ${q.options[q.answer]}\n`
          : "";
      return (
        `Q${q.n} [${q.marks ?? 0} marks] ${q.q}\n` +
        correct +
        (q.expects ? `Mark scheme: ${q.expects}\n` : "") +
        `Candidate: ${a || "(left blank)"}`
      );
    })
    .join("\n\n");

  const prompt =
    `You are marking an exam. Award marks per question against the mark scheme, being fair but not ` +
    `generous — a blank answer scores zero. Give one or two sentences of feedback per question saying ` +
    `what was missing.\n\n` +
    `Reply with ONLY this JSON, no prose:\n` +
    `{"perQuestion":[{"n":1,"awarded":3,"outOf":5,"feedback":"..."}],"summary":"two or three sentences on what to revise"}\n\n` +
    `PAPER AND ANSWERS:\n${script}`;

  try {
    const { parsed, spent, model } = await runJob("mark", [{ role: "user", content: prompt }], {
      maxTokens: 4000,
      phase: "grading",
      // A reply without per-question marks is unusable — fail over rather than accept it.
      validate: (raw) => {
        const p = parseJsonReply(raw);
        return Array.isArray(p?.perQuestion) ? p : null;
      },
    });
    const per = parsed.perQuestion;

    const total = per.reduce((n, r) => n + (Number(r.awarded) || 0), 0);
    const outOf =
      per.reduce((n, r) => n + (Number(r.outOf) || 0), 0) ||
      questions.reduce((n, q) => n + (Number(q.marks) || 0), 0);

    const result = {
      perQuestion: per,
      summary: parsed.summary || "",
      total,
      outOf,
      spent,
      markedBy: model.name || model.id,
    };
    educationStore.set((s) => ({
      busy: false,
      phase: "",
      attempt: s.attempt ? { ...s.attempt, submitted: true, result } : s.attempt,
    }));
    return result;
  } catch (err) {
    if (wasStopped(err)) return;
    educationStore.set({ busy: false, phase: "", error: String(err?.message || err) });
    return null;
  }
}

export function dismissError() {
  educationStore.set({ error: null });
}

/** Publish what the current run is doing, so a long pass never looks frozen. */
function setProgress(patch) {
  educationStore.set((s) => ({
    progress: patch === null ? null : { startedAt: Date.now(), ...(s.progress || {}), ...patch },
  }));
}
