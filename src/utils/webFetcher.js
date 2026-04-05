/**
 * webFetcher.js
 *
 * Real web search: query → DuckDuckGo → parse result URLs → fetch articles in
 * parallel → inject numbered sources into AI context (Perplexity-style).
 */

// ── URL extraction ────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"'`)\]},;]+/gi;

export function extractUrlsFromText(text) {
  if (!text || typeof text !== "string") return [];
  const matches = [...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,!?;:]+$/, ""));
  return [...new Set(matches)].slice(0, 5);
}

// ── Slash command detection ───────────────────────────────────────────────────

const SEARCH_CMD_RE = /^\/(?:search|browse|web|fetch)\s+(.+)/i;

export function parseWebCommand(text) {
  if (!text) return null;
  const m = SEARCH_CMD_RE.exec(text.trim());
  if (!m) return null;
  const value = m[1].trim();
  return /^https?:\/\//i.test(value)
    ? { type: "url", value }
    : { type: "search", value };
}

// ── Core fetch helpers ────────────────────────────────────────────────────────

export async function fetchWebPage(url) {
  if (!window.electronAPI?.fetchWebPage) {
    return { ok: false, error: "Web fetching is only available in the desktop app." };
  }
  try {
    return await window.electronAPI.fetchWebPage(url);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function buildSearchUrl(query) {
  return `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
}

// ── Real web search (Perplexity-style) ───────────────────────────────────────

/**
 * Search the web for a query.
 * Uses the main process `web-search` IPC which:
 *   1. Fetches DuckDuckGo HTML results
 *   2. Parses result URLs
 *   3. Fetches top 4 article pages in parallel
 *   4. Returns structured sources
 */
async function realWebSearch(query) {
  if (!window.electronAPI?.searchWeb) return [];
  try {
    const result = await window.electronAPI.searchWeb(query);
    if (!result?.ok) return [];
    return result.sources || [];
  } catch {
    return [];
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Resolve all web content for a user message.
 * Returns an array of source objects: { ok, url, domain, title, excerpt, fullText, index }
 */
export async function fetchAllWebContent(text) {
  const cmd = parseWebCommand(text);

  // Explicit /browse URL
  if (cmd?.type === "url") {
    const r = await fetchWebPage(cmd.value);
    return [{ ...r, url: cmd.value, index: 1 }];
  }

  // Explicit /search query
  if (cmd?.type === "search") {
    return realWebSearch(cmd.value);
  }

  // Inline URLs — fetch each directly
  const urls = extractUrlsFromText(text);
  if (urls.length > 0) {
    const results = await Promise.all(urls.map((url) => fetchWebPage(url)));
    return results.map((r, i) => ({ ...r, index: i + 1 }));
  }

  return [];
}

/**
 * Fast Google AI Mode search: loads Google in a hidden Electron window,
 * extracts the AI Overview or top snippets, returns a single synthetic source.
 * Falls back to DDG article search if not in Electron or if it fails.
 */
export async function googleAiSearch(query, opts = {}) {
  if (!window.electronAPI?.googleAiSearch) return null;
  try {
    const result = await window.electronAPI.googleAiSearch(query, opts);
    const extractedText = String(result?.text || "").trim();
    const screenshotDataUrl =
      typeof result?.screenshotDataUrl === "string" && result.screenshotDataUrl.startsWith("data:image/")
        ? result.screenshotDataUrl
        : null;

    if (!result?.ok || (!extractedText && !screenshotDataUrl)) return null;

    // Wrap as a single source object compatible with buildWebContext.
    const isNews = result.type === "news_rss";
    const label = result.label || (isNews ? "Google News" : "Google AI Mode");
    const targetUrl = isNews
      ? `https://news.google.com/search?q=${encodeURIComponent(query)}`
      : (result.source || `https://www.google.com/search?q=${encodeURIComponent(query)}`);
    const fullText = extractedText || "Google search screenshot captured. Use screenshot context.";

    const wrapped = {
      ok: true,
      url: targetUrl,
      domain: "google.com",
      title: `${label}: ${query}`,
      excerpt: fullText.slice(0, 200),
      fullText,
      index: 1,
      _searchQuery: query,
      _googleType: result.type,
      _sourceLabel: label,
      _googleScreenshotDataUrl: screenshotDataUrl,
    };

    if (isNews) {
      wrapped._newsLabel = label;
      wrapped._newsItems = result.items || [];
    } else {
      wrapped._googleItems = result.items || [];
    }

    return [{
      ...wrapped,
    }];
  } catch {
    return null;
  }
}

function isChallengeLikeGoogleSource(source) {
  if (!source || typeof source !== "object") return false;
  const host = String(source.domain || "").toLowerCase();
  if (!host.includes("google.")) return false;
  const text = `${source.title || ""}\n${source.excerpt || ""}\n${String(source.fullText || "").slice(0, 3000)}`.toLowerCase();
  const challenge = /(unusual traffic|our systems have detected unusual traffic|not a robot|captcha|about this page|checks to see if it'?s really you sending the requests|service\/retry\/enablejs|\/sorry\/index|enable javascript|please click here if you are not redirected)/i.test(text);
  const markupNoise = /<style|<script|display\s*:\s*none|position\s*:\s*absolute|@media|var\s+[a-z_$][\w$]*\s*=/i.test(text);

  const hasOrganicItems = Array.isArray(source._googleItems) && source._googleItems.some((item) => {
    const link = String(item?.link || "").toLowerCase();
    return !!item?.title && /^https?:\/\//.test(link) && !/google\.[^/]+\/(search|sorry|service\/retry|url)/i.test(link);
  });

  return challenge || (!hasOrganicItems && markupNoise);
}

/**
 * Perform a broad web search for a plain-language query (no URL).
 * Prioritizes general web crawling, then optionally augments with live news.
 */
export async function webSearch(query, opts = {}) {
  const { detailed = false, includeNews = false } = opts;

  const [aiModeRaw, generalResultsRaw] = await Promise.all([
    googleAiSearch(query, { detailed, mode: "ai" }),
    realWebSearch(query),
  ]);

  const aiMode = (aiModeRaw || []).filter((s) => !isChallengeLikeGoogleSource(s));
  const generalResults = (generalResultsRaw || []).filter((s) => !isChallengeLikeGoogleSource(s));

  // Prefer Google AI mode when available, then merge in article crawl results.
  if (aiMode && aiMode.length > 0) {
    if (includeNews && (detailed || generalResults.length < 2)) {
      const newsResults = await googleAiSearch(query, { detailed, mode: "news" });
      if (newsResults && newsResults.length > 0) {
        return mergeWebSources(aiMode, generalResults, newsResults);
      }
    }
    return mergeWebSources(aiMode, generalResults);
  }

  // For deep/current-affairs style prompts, augment general web with live news.
  if (includeNews && (detailed || generalResults.length < 3)) {
    const newsResults = await googleAiSearch(query, { detailed, mode: "news" });
    if (newsResults && newsResults.length > 0) {
      return mergeWebSources(generalResults, newsResults);
    }
  }

  if (generalResults.length > 0) return generalResults;

  // Final fallback when only news feeds are reachable.
  if (includeNews) {
    const newsOnly = await googleAiSearch(query, { detailed, mode: "news" });
    if (newsOnly && newsOnly.length > 0) return newsOnly;
  }

  return [];
}

/**
 * Deep multi-query research: runs 3 complementary DDG searches in parallel,
 * fetches up to 7 full articles. Use for detailed analysis requests.
 */
export async function deepArticleSearch(query) {
  if (!window.electronAPI?.deepSearch) return [];
  try {
    const result = await window.electronAPI.deepSearch(query);
    if (!result?.ok) return [];
    return result.sources || [];
  } catch {
    return [];
  }
}

/**
 * Merge multiple source arrays, dedupe by URL/title key, and reindex for context citations.
 */
export function mergeWebSources(...sourceArrays) {
  const merged = [];
  const seen = new Set();

  for (const arr of sourceArrays) {
    if (!Array.isArray(arr)) continue;
    for (const src of arr) {
      if (!src || typeof src !== "object") continue;
      const key = String(src.url || src.finalUrl || src.title || src.domain || "")
        .trim()
        .toLowerCase();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push({ ...src });
    }
  }

  return merged.map((src, index) => ({ ...src, index: index + 1 }));
}

// ── Context formatting ────────────────────────────────────────────────────────

/**
 * Format sources into a numbered context block to prepend to the AI message.
 * Each source gets a [N] index so the AI can cite them.
 * Pass opts.detailed = true for deep analysis mode (more text, richer instructions).
 */
export function buildWebContext(sources, opts = {}) {
  const { detailed = false } = opts;
  const good = sources.filter((s) => s.ok && s.fullText);
  if (good.length === 0) return "";

  // Keep context compact so the model does not emit oversized source lists.
  const maxSources = detailed ? 6 : 4;
  const limited = good.slice(0, maxSources);

  // Check if this is a Google news RSS summary block
  const isGoogleAI = good.length === 1 && good[0]._googleType === "news_rss";

  if (isGoogleAI) {
    const src = good[0];
    const label = src._newsLabel || "News";
    const isDetailed = src.fullText?.includes("## ") && src.fullText?.includes("---");
    const count = (src._newsItems || []).length;
    return (
      `🌐 LIVE ${isDetailed ? "DETAILED " : ""}NEWS — ${label}:\n\n` +
      src.fullText +
      `\n\n---\n` +
      `INSTRUCTIONS: You have been given ${count} REAL-TIME live news headlines and descriptions above. ` +
      `Do NOT say you cannot access the internet — you have live data. ` +
      (isDetailed
        ? `Provide a thorough, in-depth analysis of each article. Cover ALL topics.`
        : `Present ALL ${count} items as numbered mini-points (aim for 20-25 points). ` +
          `Group by category (Geopolitics, Conflicts, Economy, Science, etc.). ` +
          `Do NOT skip any headline. Each point should be 1-2 sentences.`) +
      `\n\n`
    );
  }

  const textCap = detailed ? 5000 : 3000;
  const blocks = limited.map((s) => {
    const header = `[${s.index}] ${s.title || s.domain} — ${s.url}`;
    const body = s.fullText.slice(0, textCap);
    return `${header}\n${body}`;
  });

  const sourceList = limited.map((s) => `[${s.index}] ${s.domain} — ${s.url}`).join("\n");

  const instructions = detailed
    ? `INSTRUCTIONS: You have been given ${limited.length} FULL ARTICLES fetched live. ` +
      `Provide a comprehensive, in-depth analysis. Cover all key angles: background/history, current situation, ` +
      `key players, causes, consequences, and future outlook. ` +
      `Cite sources as [1], [2] etc. Do NOT say you cannot access the internet — you have live data. ` +
      `Keep source citations compact: no duplicate source names and maximum 5 unique source lines in any final list.`
    : `Cite sources as [1], [2] etc. at the end of relevant sentences. Do NOT say you cannot access the internet when web sources are present. Keep citations compact with no duplicate source lines.`;

  return (
    `🌐 WEB SOURCES (fetched live):\n\n` +
    blocks.join("\n\n---\n\n") +
    `\n\n--- Sources ---\n${sourceList}\n\n` +
    instructions +
    `\n--- end web context ---\n\n`
  );
}
