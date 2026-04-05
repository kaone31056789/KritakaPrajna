/**
 * intentDetector.js
 *
 * Lightweight intent detection for automatically deciding when to inject
 * terminal hints or perform web fetches before sending to the AI.
 */

// ── Terminal intent ───────────────────────────────────────────────────────────

const TERMINAL_PATTERNS = [
  /\b(run|execute|check|install|uninstall|start|stop|restart|build|compile|test|deploy)\b/i,
  /\bin (the )?terminal\b/i,
  /\bin (the )?command( ?line)?\b/i,
  /\bshell\b/i,
  /\bcli\b/i,
  /\bcmd\b/i,
  /\bpowershell\b/i,
  /\bnpm (install|run|start|build|test)\b/i,
  /\bnpx\b/i,
  /\bpip install\b/i,
  /\bpython\b.*\brun\b/i,
  /\b(is|are) .* installed\b/i,
  /\bversion\b.*\binstalled\b/i,
  /\binstalled\b.*\bversion\b/i,
  /\bcheck .*(version|install|path)\b/i,
  /\bhow (do i|to) (run|install|check|use)\b/i,
  /\bwhich command\b/i,
  /\bwhat command\b/i,
  /\bgive me (a |the )?command\b/i,
  /\bshow (me )?(the )?command\b/i,
];

/** Returns true if the message is asking about running a terminal command. */
export function isTerminalIntent(text) {
  if (!text) return false;
  return TERMINAL_PATTERNS.some((re) => re.test(text));
}

// ── Web / real-time intent ────────────────────────────────────────────────────

const WEB_PATTERNS = [
  /\b(latest|newest|current|recent|updated?)\b.{0,40}\b(version|release|update|docs?|documentation)\b/i,
  /\b(version|release|update)\b.{0,40}\b(latest|newest|current|recent)\b/i,
  /\bwhat('s| is) (the )?(latest|current|newest)\b/i,
  /\bis .* (still |now )?(supported|maintained|deprecated|dead|alive)\b/i,
  /\bchangelog\b/i, /\brelease notes?\b/i, /\bnews\b/i, /\bright now\b/i,
  /\bas of (today|now|recently)\b/i, /\btoday\b/i,
  /\bcurrent (status|state|version|situation)\b/i,
  // Explicit search/browse requests
  /\bwebsearch\b/i,
  /\bsearch (the web|online|the internet|for)\b/i,
  /\blook (it )?up( online| on the web)?\b/i,
  /\bbrowse (the web|online|the internet)\b/i,
  /\bfind (me )?(information|info|details|news) (about|on|regarding)\b/i,
  /\b(from|on|via) (the )?(web|internet|online)\b/i,
  // Real-time / time-relative
  /\bcurrent affairs?\b/i, /\brecent affairs?\b/i,
  /\bthis (week|month|year)\b/i, /\blast (week|month|year)\b/i,
  /\bwhat('s| is| are) (happening|going on)\b/i, /\bwhat happened\b/i,
  /\brecent (events?|news|happenings?|updates?|developments?|affairs?)\b/i,
  /\blatest (news|updates?|events?|developments?|headlines?)\b/i,
  /\bany (news|updates?) (on|about|regarding)\b/i,
  /\bbreaking news\b/i, /\bheadlines?\b/i,
  // Review / analysis of real-world topics → also triggers web search
  /\b(review|analysis|analyze|analyse|breakdown|explain|summary|summarize|overview|brief|report) (of|on|about) .{3,}/i,
  /\b(what is|what are|who is|who are|tell me about) .{3,}/i,
  // Geopolitics / world events — always fetch live data
  /\b(war|conflict|ceasefire|invasion|occupation|airstrike|missile|sanction|blockade|siege|coup|protest|uprising|revolution|treaty|alliance|summit|election|vote|crisis)\b/i,
  /\b(iran|iraq|ukraine|russia|china|israel|palestine|gaza|syria|yemen|north korea|taiwan|india|pakistan|nato|un|opec|brics)\b/i,
  /\b(strait of hormuz|red sea|south china sea|persian gulf|black sea|suez|taiwan strait)\b/i,
  /\b(economy|recession|inflation|gdp|unemployment|federal reserve|interest rate|oil price|stock market|trade deal)\b/i,
  /\b(climate|earthquake|hurricane|flood|wildfire|disaster|pandemic|outbreak|epidemic)\b/i,
];

/** Returns true if the message likely needs real-time web information. */
export function isWebIntent(text) {
  if (!text) return false;
  return WEB_PATTERNS.some((re) => re.test(text));
}

// ── Real-world topic detection (for always-search mode) ───────────────────────

const REAL_WORLD_PATTERNS = [
  /\b(who|what|when|where|why|how) (is|are|was|were|did|does|do)\b/i,
  /\b(tell me|explain|describe|give me|show me)\b/i,
  /\b[A-Z][a-z]+ (war|crisis|conflict|deal|summit|election|agreement)\b/,
];

export function isRealWorldQuery(text) {
  if (!text) return false;
  return REAL_WORLD_PATTERNS.some((re) => re.test(text));
}

// ── Detailed / deep-dive intent ──────────────────────────────────────────────

const DETAILED_PATTERNS = [
  /\bdetailed?\b/i,
  /\bin[- ]depth\b/i,
  /\bdeep[- ]dive\b/i,
  /\bcomprehensive\b/i,
  /\bfull (analysis|review|breakdown|explanation|report)\b/i,
  /\banalyze\b/i,
  /\banalysis\b/i,
  /\bbreak(down| it down)\b/i,
  /\bthorough\b/i,
  /\bextensive\b/i,
  /\bexplain in detail\b/i,
  /\bin detail\b/i,
  /\bmore details?\b/i,
  /\bfull (article|text|content|story)\b/i,
  /\bdeep analysis\b/i,
  /\bdetailed review\b/i,
];

/** Returns true if the message is asking for detailed/in-depth information. */
export function isDetailedIntent(text) {
  if (!text) return false;
  return DETAILED_PATTERNS.some((re) => re.test(text));
}

// ── News-specific intent (used to avoid always forcing news feeds) ──────────

const NEWS_PATTERNS = [
  /\bnews\b/i,
  /\bheadlines?\b/i,
  /\bbreaking\b/i,
  /\bcurrent affairs?\b/i,
  /\brecent affairs?\b/i,
  /\blatest (news|headlines?|updates?|developments?)\b/i,
  /\b(today|this week|last week|this month|latest)\b.{0,24}\b(news|events?|headlines?|updates?)\b/i,
  /\b(top|world|international)\b.{0,24}\bnews\b/i,
];

/** Returns true when the user explicitly wants news/headline style results. */
export function isNewsIntent(text) {
  if (!text) return false;
  return NEWS_PATTERNS.some((re) => re.test(text));
}

// ── Search query builder ──────────────────────────────────────────────────────

/**
 * Build a DuckDuckGo search query from the user's message.
 * Strips common filler words to get a tighter query.
 */
export function buildSearchQuery(text) {
  return text
    // Strip leading search verbs
    .replace(/^(websearch\s*|web search\s*|search (the web|online|the internet|for)?( and)?( tell me| give me| show me| find)?|browse (the web|online)?|look (it )?up|find (me )?|tell me about|can you (search|find|look up)|please (search|find|look up))\s*/i, "")
    // Strip "make a detailed review of / detailed analysis of / comprehensive breakdown of" etc.
    .replace(/^(make |give me |write |do |create )?(a |an )?(detailed?|comprehensive|in[- ]depth|thorough|full|deep) (review|analysis|breakdown|report|summary|overview|study|assessment) (of|on|about)\s*/i, "")
    // Strip generic filler openers
    .replace(/^(what('s| is)|how (do i|to)|can you|please|tell me( about)?)\s+/i, "")
    // Strip formatting instructions that should not become search terms
    .replace(/\b(in |as )?(small|short|mini) points?\b/gi, "")
    .replace(/\b(in )?(bullet|numbered) points?\b/gi, "")
    .replace(/\b(points?|bullets?)\b$/i, "")
    .replace(/\b(briefly|concisely|in short)\b/gi, "")
    // Strip trailing noise: "from web", "from the internet", "on it", "and give mini points on it", etc.
    .replace(/\s+(from (the )?(web|internet|online)|on it|and give.*|give.*points.*|give.*summary.*|give.*bullets?.*|in (bullet|mini|short|brief).*)$/i, "")
    // Strip "from last/this week/month/year" at end if preceded by topic
    .replace(/\s+(from )?(last|this) (week|month|year)$/i, "")
    .replace(/\?+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 100);
}
