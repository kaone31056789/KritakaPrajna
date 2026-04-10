import React, { useState } from "react";

function GlobeIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <path strokeLinecap="round" d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
    </svg>
  );
}

function ChevronIcon({ expanded }) {
  return (
    <svg className={`w-3 h-3 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
      fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function detectSearchStatus(sources, isGoogleNewsMode) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return { label: "No sources", tone: "muted", footer: "No live sources captured" };
  }

  if (isGoogleNewsMode) {
    return { label: "Google News", tone: "google", footer: "Google News RSS mode" };
  }

  const hasGoogleAiMode = sources.some((s) => String(s?._googleType || "").toLowerCase() === "google_ai_mode");
  const hasGoogleOverview = sources.some((s) => String(s?._googleType || "").toLowerCase() === "ai_overview");
  const hasGoogleSnippets = sources.some((s) => String(s?._googleType || "").toLowerCase() === "web_snippets");
  const hasGoogleScreenshot = sources.some((s) =>
    typeof s?._googleScreenshotDataUrl === "string" && s._googleScreenshotDataUrl.startsWith("data:image/")
  );
  const hasGoogleDomain = sources.some((s) => {
    const host = String(s?.domain || "").toLowerCase();
    return host === "google.com" || host.endsWith(".google.com");
  });
  const hasBingMsnFallbackTag = sources.some(
    (s) => String(s?._searchFallback || "").toLowerCase() === "bing_msn"
  );
  const hasBingOrMsn = sources.some((s) => {
    const host = String(s?.domain || "").toLowerCase();
    return host === "bing.com" || host.endsWith(".bing.com") || host === "msn.com" || host.endsWith(".msn.com");
  });

  if (hasGoogleAiMode) {
    return {
      label: "Google AI: On",
      tone: "google",
      footer: hasGoogleScreenshot ? "Google AI mode with screenshot context" : "Google AI mode",
    };
  }

  if (hasGoogleOverview || hasGoogleSnippets || hasGoogleDomain) {
    return {
      label: "Google Fallback",
      tone: "warning",
      footer: hasGoogleScreenshot
        ? "Google fallback snippets with screenshot context"
        : "Google fallback snippets",
    };
  }

  if (hasBingOrMsn || hasBingMsnFallbackTag) {
    return {
      label: "Bing/MSN Fallback",
      tone: "warning",
      footer: "Google unavailable, Bing/MSN fallback",
    };
  }

  return { label: "Web Sources", tone: "muted", footer: "General web crawl sources" };
}

function statusBadgeClass(tone) {
  switch (tone) {
    case "google":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-400/25";
    case "warning":
      return "bg-[#ffb000]/15 text-[#ffb000] border border-[#ffb000]/30";
    default:
      return "bg-[#00d4ff]/10 text-[#00d4ff]/80 border border-[#00d4ff]/20";
  }
}

/** Single source row inside the collapsible list */
function SourceRow({ source, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const displayUrl = source.url.length > 55 ? source.url.slice(0, 52) + "…" : source.url;

  if (!source.ok) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400/70 font-mono">
        <span className="w-4 h-4 flex items-center justify-center rounded-sm bg-red-500/10 text-[10px] font-bold shrink-0">
          {source.index}
        </span>
        <span className="truncate">{source.url}</span>
        <span className="ml-auto shrink-0 text-red-500/60">{source.error}</span>
      </div>
    );
  }

  return (
    <div className="border-b border-[#00d4ff]/10 last:border-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#00d4ff]/[0.05] transition-colors text-left"
      >
        {/* Index badge */}
        <span className="w-4 h-4 flex items-center justify-center rounded-sm bg-[#00d4ff]/15 text-[#00d4ff] text-[10px] font-bold shrink-0 font-mono">
          {source.index}
        </span>
        <span className="font-medium text-[#00d4ff]/80 text-[12px] shrink-0 font-mono">{source.domain}</span>
        <span className="text-[#00d4ff]/40 text-[11px] truncate flex-1 font-mono">{displayUrl}</span>
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-1">
          {source.title && source.title !== source.domain && (
            <p className="text-[11px] font-medium text-[#e0e0e0]/60 leading-snug font-mono">
              {source.title.slice(0, 100)}
            </p>
          )}
          {source.excerpt && (
            <p className="text-[11px] text-[#b0b0b0] leading-relaxed font-mono">
              {source.excerpt}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Web result group card shown above user message bubbles.
 * Accepts an array of source objects (one per fetched article).
 */
export default function WebResultCard({ results }) {
  const [open, setOpen] = useState(false);

  // Support both array (multi-source search) and single result (legacy)
  const sources = Array.isArray(results) ? results : [results];
  const goodCount = sources.filter((s) => s.ok).length;
  const domains = [...new Set(sources.filter((s) => s.ok).map((s) => s.domain))].slice(0, 4);

  // Detect News RSS result
  const isGoogleAI = sources.length === 1 && sources[0]?._googleType === "news_rss";
  const rawLabel = isGoogleAI ? (sources[0]._newsLabel || "News") : null;
  // Shorten long multi-source labels for display
  const googleTypeLabel = rawLabel?.includes("·") ? "World News" : rawLabel;
  const fullLabel = rawLabel; // full label for tooltip
  const newsItems = isGoogleAI ? (sources[0]._newsItems || []) : [];
  const searchStatus = detectSearchStatus(sources, isGoogleAI);

  return (
    <div className={`rounded-sm border overflow-hidden text-[12px] w-full max-w-[900px] shadow-elevation-1 hover:shadow-elevation-2 transition-shadow font-mono ${
      isGoogleAI
        ? "border-emerald-500/20 bg-emerald-500/[0.03]"
        : "border-[#00d4ff]/20 bg-[#00d4ff]/[0.03]"
    }`}>
      {/* ── Header ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 transition-colors text-left ${
          isGoogleAI ? "hover:bg-emerald-500/[0.06]" : "hover:bg-[#00d4ff]/[0.06]"
        }`}
      >
        {isGoogleAI ? (
          /* Google "G" icon */
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        ) : (
          <span className="text-[#00d4ff]/80"><GlobeIcon /></span>
        )}

        {/* Label / domain pills */}
        {isGoogleAI ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-emerald-300/90 text-[11px] font-semibold" title={fullLabel}>{googleTypeLabel}</span>
            <span className="px-1.5 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-400/70 text-[10px] font-medium shrink-0">
              {newsItems.length} headlines
            </span>
            {sources[0]?._searchQuery && (
              <span className="text-emerald-500/40 text-[10px] truncate">· {sources[0]._searchQuery}</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
            {domains.map((d) => (
              <span key={d} className="px-1.5 py-0.5 rounded-sm bg-[#00d4ff]/10 text-[#00d4ff]/80 text-[10px] font-medium shrink-0">
                {d}
              </span>
            ))}
            {goodCount > domains.length && (
              <span className="text-[#00d4ff]/40 text-[10px]">+{goodCount - domains.length} more</span>
            )}
          </div>
        )}

        {!isGoogleAI && (
          <div className="flex items-center gap-1.5 shrink-0 mr-1">
            <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-semibold ${statusBadgeClass(searchStatus.tone)}`}>
              {searchStatus.label}
            </span>
            <span className="text-[#00d4ff]/40 text-[10px]">
              {goodCount} source{goodCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
        <ChevronIcon expanded={open} />
      </button>

      {/* ── News headlines (RSS result) or source list ── */}
      {open && (
        <div className={`border-t ${isGoogleAI ? "border-emerald-500/10" : "border-[#00d4ff]/10"}`}>
          {isGoogleAI && newsItems.length > 0 ? (
            <div className="divide-y divide-emerald-500/[0.08]">
              {newsItems.slice(0, 6).map((item, i) => (
                <div key={i} className="px-3 py-2 space-y-0.5">
                  <p className="text-[11px] font-medium text-emerald-200/80 leading-snug">{item.title}</p>
                  {item.desc && (
                    <p className="text-[10px] text-[#b0b0b0] leading-relaxed line-clamp-2">{item.desc}</p>
                  )}
                  {item.pub && (
                    <p className="text-[10px] text-emerald-600/50">{item.pub.replace(/ \+\d{4}$/, "").trim()}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            sources.map((s, i) => (
              <SourceRow key={i} source={s} defaultExpanded={sources.length === 1} />
            ))
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div className={`px-3 py-1.5 border-t text-[10px] flex items-center gap-1 font-mono ${
        isGoogleAI
          ? "border-emerald-500/10 text-emerald-500/40"
          : "border-[#00d4ff]/10 text-[#00d4ff]/40"
      }`}>
        {isGoogleAI ? (
          <span>📡 Live RSS · {googleTypeLabel} · refined by AI</span>
        ) : (
          <>
            <span>🌐 Live web search</span>
            <span className="ml-1">· {searchStatus.footer}</span>
            {sources[0]?._searchQuery && (
              <span className="italic ml-1">· "{sources[0]._searchQuery}"</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
