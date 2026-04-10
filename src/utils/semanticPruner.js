/**
 * semanticPruner.js
 *
 * TF-IDF based semantic history pruning.
 * Instead of a fixed sliding window (keep last N), this module scores every
 * message by relevance to the current query and keeps the most useful ones
 * within a token budget.
 */

// ── Text helpers ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a","an","the","is","it","in","on","at","to","for","of","and","or","but",
  "not","this","that","with","from","by","as","be","was","were","been","are",
  "have","has","had","do","does","did","will","would","can","could","should",
  "may","might","shall","i","you","he","she","we","they","me","him","her",
  "us","them","my","your","his","its","our","their","what","which","who",
  "how","when","where","why","if","then","so","just","also","very","too",
  "more","most","some","any","all","each","every","no","yes","ok","okay",
  "sure","thanks","thank","please","hello","hi","hey",
]);

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const ERROR_RE = /\b(error|exception|traceback|failed|failure|crash|bug|issue|warning|undefined|null|NaN)\b/i;
const ACKNOWLEDGMENT_RE = /^(ok|okay|sure|got it|thanks|thank you|understood|alright|perfect|great|nice|cool|yes|yep|yeah|no problem|np|ty)[\s.!]*$/i;

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text || "" : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

// ── TF-IDF engine ───────────────────────────────────────────────────────────

function buildTermFrequency(terms) {
  const tf = new Map();
  for (const t of terms) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  // Normalize
  const max = Math.max(...tf.values(), 1);
  for (const [k, v] of tf) {
    tf.set(k, v / max);
  }
  return tf;
}

function buildIDF(documents) {
  const df = new Map();
  const N = documents.length;

  for (const doc of documents) {
    const seen = new Set(doc);
    for (const term of seen) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  const idf = new Map();
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }
  return idf;
}

function buildTFIDFVector(tf, idf) {
  const vec = new Map();
  for (const [term, tfVal] of tf) {
    const idfVal = idf.get(term) || 1;
    vec.set(term, tfVal * idfVal);
  }
  return vec;
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, val] of vecA) {
    normA += val * val;
    const bVal = vecB.get(term);
    if (bVal !== undefined) {
      dot += val * bVal;
    }
  }

  for (const val of vecB.values()) {
    normB += val * val;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ── Message importance scoring ──────────────────────────────────────────────

function hasCodeBlock(text) {
  return CODE_BLOCK_RE.test(text);
}

function hasError(text) {
  return ERROR_RE.test(text);
}

function isAcknowledgment(text) {
  const trimmed = String(text || "").trim();
  return trimmed.length < 60 && ACKNOWLEDGMENT_RE.test(trimmed);
}

/**
 * Score each message by relevance to the current query.
 *
 * Score = w_relevance × cosine_sim + w_recency × recency + w_role × role_bonus + w_content × content_bonus
 *
 * @param {Array} messages - Chat history messages
 * @param {string} currentQuery - The new user query
 * @param {Object} options
 * @returns {Array<{ index, message, score, reason }>}
 */
function scoreMessages(messages, currentQuery, options = {}) {
  const {
    relevanceWeight = 0.50,
    recencyWeight = 0.25,
    roleWeight = 0.10,
    contentWeight = 0.15,
  } = options;

  if (!messages || messages.length === 0) return [];

  const queryTerms = tokenize(currentQuery);
  const queryTF = buildTermFrequency(queryTerms);

  // Build document term lists for all messages
  const docTerms = messages.map((msg) => tokenize(extractText(msg?.content)));
  const allDocs = [...docTerms, queryTerms]; // Include query in IDF calculation
  const idf = buildIDF(allDocs);

  const queryVec = buildTFIDFVector(queryTF, idf);

  return messages.map((msg, index) => {
    const text = extractText(msg?.content);
    const terms = docTerms[index];
    const tf = buildTermFrequency(terms);
    const vec = buildTFIDFVector(tf, idf);

    // 1. Relevance (cosine similarity)
    const relevance = cosineSimilarity(queryVec, vec);

    // 2. Recency (exponential decay, more recent = higher)
    const age = messages.length - 1 - index;
    const recency = Math.exp(-age * 0.12);

    // 3. Role bonus (assistant responses typically carry more info)
    const roleBonus = msg?.role === "assistant" ? 0.6 : msg?.role === "system" ? 1.0 : 0.4;

    // 4. Content bonus (code blocks, errors are high-value)
    let contentBonus = 0.3; // baseline
    if (hasCodeBlock(text)) contentBonus = 1.0;
    else if (hasError(text)) contentBonus = 0.9;
    else if (isAcknowledgment(text)) contentBonus = 0.0;
    else if (text.length > 500) contentBonus = 0.5; // longer = more info
    else if (text.length < 20) contentBonus = 0.1;

    const score =
      relevanceWeight * relevance +
      recencyWeight * recency +
      roleWeight * roleBonus +
      contentWeight * contentBonus;

    let reason = "relevance";
    if (recency > relevance && recency > contentBonus) reason = "recent";
    if (contentBonus >= 0.9) reason = hasCodeBlock(text) ? "code" : "error";
    if (isAcknowledgment(text)) reason = "acknowledgment";
    if (msg?.role === "system") reason = "system";

    return { index, message: msg, score, reason, tokens: estimateTokens(text) };
  });
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Semantically prune conversation history.
 * Keeps the most relevant messages to the current query within a token budget.
 *
 * @param {Array} messages - Full message history
 * @param {string} currentQuery - The user's new message
 * @param {Object} options
 * @param {number} options.maxMessages - Max messages to keep (default 18)
 * @param {number} options.maxTokenBudget - Max tokens for history (default 12000)
 * @param {number} options.alwaysKeepLast - Always keep last N messages (default 4)
 * @param {boolean} options.preserveCodeBlocks - Never drop messages with code (default true)
 * @param {boolean} options.deepAnalysis - If true, use larger windows (default false)
 * @returns {{ kept: Array, dropped: Array, scores: Array, stats: Object }}
 */
export function semanticPrune(messages, currentQuery, options = {}) {
  const {
    maxMessages = 18,
    maxTokenBudget = 12000,
    alwaysKeepLast = 4,
    preserveCodeBlocks = true,
    deepAnalysis = false,
  } = options;

  // Deep analysis mode: expand the window significantly
  const effectiveMaxMessages = deepAnalysis ? Math.max(maxMessages, 40) : maxMessages;
  const effectiveMaxTokens = deepAnalysis ? Math.max(maxTokenBudget, 32000) : maxTokenBudget;

  if (!messages || messages.length === 0) {
    return { kept: [], dropped: [], scores: [], stats: { total: 0, kept: 0, dropped: 0, tokensUsed: 0 } };
  }

  // If within budget, keep everything
  if (messages.length <= effectiveMaxMessages) {
    const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(extractText(m?.content)), 0);
    if (totalTokens <= effectiveMaxTokens) {
      return {
        kept: [...messages],
        dropped: [],
        scores: scoreMessages(messages, currentQuery),
        stats: { total: messages.length, kept: messages.length, dropped: 0, tokensUsed: totalTokens },
      };
    }
  }

  const scored = scoreMessages(messages, currentQuery, {
    relevanceWeight: deepAnalysis ? 0.55 : 0.50,
    recencyWeight: deepAnalysis ? 0.20 : 0.25,
    contentWeight: deepAnalysis ? 0.18 : 0.15,
  });

  // Partition into "must keep" and "candidates"
  const mustKeep = new Set();
  const lastN = Math.min(alwaysKeepLast, messages.length);

  // Always keep system messages
  scored.forEach(({ index, message }) => {
    if (message?.role === "system") mustKeep.add(index);
  });

  // Always keep last N messages
  for (let i = messages.length - lastN; i < messages.length; i++) {
    if (i >= 0) mustKeep.add(i);
  }

  // Preserve code blocks and error messages
  if (preserveCodeBlocks) {
    scored.forEach(({ index, message }) => {
      const text = extractText(message?.content);
      if (hasCodeBlock(text) || hasError(text)) {
        mustKeep.add(index);
      }
    });
  }

  // Sort remaining candidates by score (descending)
  const candidates = scored
    .filter(({ index }) => !mustKeep.has(index))
    .sort((a, b) => b.score - a.score);

  // Fill up to budget
  const keptIndices = new Set(mustKeep);
  let tokensUsed = 0;

  // Count must-keep tokens first
  for (const idx of mustKeep) {
    tokensUsed += scored[idx]?.tokens || 0;
  }

  // Add candidates by score until we hit limits
  for (const candidate of candidates) {
    if (keptIndices.size >= effectiveMaxMessages) break;
    if (tokensUsed + candidate.tokens > effectiveMaxTokens) continue;

    // Skip pure acknowledgments if we're getting tight
    if (candidate.reason === "acknowledgment" && keptIndices.size > effectiveMaxMessages * 0.7) continue;

    keptIndices.add(candidate.index);
    tokensUsed += candidate.tokens;
  }

  // Build result preserving original order
  const kept = [];
  const dropped = [];

  messages.forEach((msg, idx) => {
    if (keptIndices.has(idx)) {
      kept.push(msg);
    } else {
      dropped.push(msg);
    }
  });

  return {
    kept,
    dropped,
    scores: scored,
    stats: {
      total: messages.length,
      kept: kept.length,
      dropped: dropped.length,
      tokensUsed,
      deepAnalysis,
    },
  };
}

/**
 * Quick relevance check — is the current query related to recent conversation?
 * Used to decide if we should use semantic pruning vs. simple window.
 */
export function queryRelatedness(messages, query) {
  if (!messages || messages.length < 3 || !query) return 1.0;

  const last3 = messages.slice(-3);
  const scored = scoreMessages(last3, query);
  const avgRelevance = scored.reduce((sum, s) => sum + s.score, 0) / scored.length;
  return avgRelevance;
}
