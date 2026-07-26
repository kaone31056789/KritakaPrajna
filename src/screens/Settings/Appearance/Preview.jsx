import React from "react";
import Icon from "../../../ui/icons";

/* ═══ LiveInterfacePreview ══════════════════════════════════════════════════
   A miniature of the real app, built from the same tokens the real app uses.

   The trick that makes this honest: skin rules in themes.css are plain
   attribute selectors ([data-skin="og"][data-theme="light"]), not html-scoped.
   So putting data-skin + data-theme on this element resolves that skin's entire
   palette inside it — no duplicated colour tables, and a new skin appears here
   the moment it is added to themes.css.

   Everything else the user can change is stamped on <html> and inherits down,
   which is why every control moves this panel without any of them knowing it
   exists.
   ═══════════════════════════════════════════════════════════════════════════ */

function Chip({ children, tone = "surface" }) {
  const bg = tone === "accent" ? "var(--accent-soft)" : "var(--surface-2)";
  const fg = tone === "accent" ? "var(--accent)" : "var(--text-dim)";
  return (
    <span
      style={{ background: bg, color: fg, borderRadius: "var(--r-pill)" }}
      className="px-2 py-[3px] text-[10px] font-semibold"
    >
      {children}
    </span>
  );
}

function Panel({ children, className = "", style }) {
  return (
    <div
      className={className}
      style={{
        background: "var(--surface)",
        boxShadow: "var(--neu-raised-sm)",
        borderRadius: "var(--r-sm)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * @param {object} p
 * @param {string} p.skin   theme id to render in
 * @param {string} p.mode   "dark" | "light"
 * @param {boolean} p.compact  card-sized rather than full panel
 */
/**
 * The card-sized variant. Deliberately not the full preview scaled down: with
 * 27 cards on screen the icon components alone were the cost, so this draws the
 * same silhouette out of plain divs. It still resolves the real theme tokens,
 * which is what a card has to prove.
 */
const CardPreview = React.memo(function CardPreview({ skin, mode }) {
  const bar = (w, c, h = 4) => (
    <span style={{ display: "block", width: w, height: h, borderRadius: 2, background: c }} />
  );
  return (
    <div
      className="kp-preview-scope overflow-hidden"
      data-skin={skin}
      data-theme={mode}
      style={{ borderRadius: "var(--r-sm)" }}
      role="img"
      aria-label={`${skin} theme preview`}
    >
      <div className="flex" style={{ height: 104 }}>
        <div
          className="shrink-0 flex flex-col gap-1.5 items-center"
          style={{ background: "var(--bg-deep)", width: 22, padding: "8px 5px" }}
        >
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: "var(--r-xs)",
                background: i === 0 ? "var(--accent-soft)" : "var(--surface)",
                boxShadow: i === 0 ? "none" : "var(--neu-raised-sm)",
              }}
            />
          ))}
        </div>
        <div className="flex-1 min-w-0 flex flex-col" style={{ background: "var(--bg)", padding: 8, gap: 6 }}>
          <span
            style={{
              color: "var(--text-hi)",
              fontFamily: "var(--font-display)",
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.01em",
            }}
          >
            KritakaPrajna
          </span>
          <div className="flex justify-end">
            <span
              style={{
                background: "var(--accent)",
                borderRadius: "var(--r-sm)",
                padding: "4px 7px",
                display: "flex",
                gap: 3,
              }}
            >
              {bar(18, "var(--accent-ink)", 3)}
              {bar(9, "var(--accent-ink)", 3)}
            </span>
          </div>
          <div
            style={{
              background: "var(--surface)",
              boxShadow: "var(--neu-raised-sm)",
              borderRadius: "var(--r-sm)",
              padding: "5px 7px",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            {bar("100%", "var(--text)", 3)}
            {bar("62%", "var(--text-dim)", 3)}
          </div>
          <div className="flex-1" />
          <div
            className="flex items-center"
            style={{
              background: "var(--bg-deep)",
              boxShadow: "var(--neu-inset-sm)",
              borderRadius: "var(--r-sm)",
              padding: "4px 6px",
              gap: 6,
            }}
          >
            {bar(34, "var(--text-faint)", 3)}
            <span className="flex-1" />
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--accent)" }} />
          </div>
        </div>
      </div>
    </div>
  );
});

function FullPreview({ skin, mode, compact = false }) {
  const scale = compact ? 0.72 : 1;
  const f = (n) => `${Math.round(n * scale)}px`;

  return (
    <div
      className="kp-preview-scope overflow-hidden"
      data-skin={skin}
      data-theme={mode}
      style={{ borderRadius: "var(--r-sm)", boxShadow: "var(--neu-raised-sm)" }}
      aria-label={`Preview of the ${skin} theme in ${mode} mode`}
      role="img"
    >
      <div className="flex" style={{ minHeight: compact ? 108 : 420 }}>
        {/* ── Sidebar ── */}
        <div
          className="shrink-0 flex flex-col items-center gap-1.5"
          style={{ background: "var(--bg-deep)", width: f(38), padding: `${f(8)} ${f(5)}` }}
        >
          {["chat", "book", "image", "advisor"].map((n, i) => (
            <span
              key={n}
              className="flex items-center justify-center"
              style={{
                width: f(22),
                height: f(22),
                borderRadius: "var(--r-xs)",
                background: i === 0 ? "var(--bg-deep)" : "var(--surface)",
                boxShadow: i === 0 ? "var(--neu-inset-sm)" : "var(--neu-raised-sm)",
                color: i === 0 ? "var(--accent)" : "var(--text-dim)",
              }}
            >
              <Icon name={n} size={Math.round(12 * scale)} />
            </span>
          ))}
        </div>

        <div className="flex-1 min-w-0 flex flex-col" style={{ background: "var(--bg)" }}>
          {/* ── Top nav ── */}
          <div
            className="flex items-center justify-between shrink-0"
            style={{ padding: `${f(7)} ${f(10)}`, borderBottom: "1px solid var(--line)" }}
          >
            <span style={{ color: "var(--text-hi)", fontSize: f(11), fontWeight: 700, fontFamily: "var(--font-display)" }}>
              KritakaPrajna
            </span>
            {!compact && (
              <span className="flex items-center gap-1.5">
                <Chip tone="accent">Ready</Chip>
                <span
                  className="flex items-center gap-1 px-2 py-1"
                  style={{ background: "var(--surface)", boxShadow: "var(--neu-raised-sm)", borderRadius: "var(--r-xs)", color: "var(--text-dim)", fontSize: f(9) }}
                >
                  Opus 5 <Icon name="chevronDown" size={9} />
                </span>
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-2" style={{ padding: f(10) }}>
            {/* ── Chat messages ── */}
            <div className="flex justify-end">
              <span
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-ink)",
                  borderRadius: "var(--r-sm)",
                  padding: `${f(5)} ${f(8)}`,
                  fontSize: f(10),
                  maxWidth: "72%",
                }}
              >
                How do I center a div?
              </span>
            </div>
            <Panel style={{ padding: `${f(6)} ${f(9)}`, maxWidth: "86%" }}>
              <p style={{ color: "var(--text)", fontSize: f(10), lineHeight: 1.55 }}>
                Flexbox is the shortest route — one line on the parent.
              </p>
            </Panel>

            {!compact && (
              <>
                {/* ── Code block ── */}
                <div
                  style={{
                    background: "var(--bg-deep)",
                    borderRadius: "var(--r-xs)",
                    padding: `${f(7)} ${f(9)}`,
                    fontFamily: "var(--font-mono)",
                    fontSize: f(9.5),
                    lineHeight: 1.6,
                  }}
                >
                  <div>
                    <span style={{ color: "var(--syn-punct)" }}>.box</span>{" "}
                    <span style={{ color: "var(--syn-punct)" }}>{"{"}</span>
                  </div>
                  <div style={{ paddingLeft: f(10) }}>
                    <span style={{ color: "var(--syn-attr)" }}>display</span>
                    <span style={{ color: "var(--syn-punct)" }}>: </span>
                    <span style={{ color: "var(--syn-string)" }}>grid</span>
                    <span style={{ color: "var(--syn-punct)" }}>;</span>
                  </div>
                  <div style={{ paddingLeft: f(10) }}>
                    <span style={{ color: "var(--syn-attr)" }}>place-items</span>
                    <span style={{ color: "var(--syn-punct)" }}>: </span>
                    <span style={{ color: "var(--syn-string)" }}>center</span>
                    <span style={{ color: "var(--syn-punct)" }}>;</span>
                  </div>
                  <div style={{ color: "var(--syn-punct)" }}>{"}"}</div>
                </div>

                {/* ── Cards ── */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Tokens", value: "18.4k", tone: "var(--ok)" },
                    { label: "Spend", value: "$0.29", tone: "var(--accent)" },
                  ].map((c) => (
                    <Panel key={c.label} style={{ padding: f(8) }}>
                      <p style={{ color: "var(--text-faint)", fontSize: f(8.5), letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        {c.label}
                      </p>
                      <p style={{ color: c.tone, fontSize: f(14), fontWeight: 700, fontFamily: "var(--font-display)" }}>
                        {c.value}
                      </p>
                    </Panel>
                  ))}
                </div>

                {/* ── Notification + modal ── */}
                <div className="flex items-center gap-2">
                  <Panel className="flex items-center gap-1.5 flex-1 min-w-0" style={{ padding: `${f(6)} ${f(8)}` }}>
                    <span style={{ color: "var(--ok)", display: "flex" }}>
                      <Icon name="check" size={Math.round(11 * scale)} />
                    </span>
                    <span style={{ color: "var(--text)", fontSize: f(9.5) }} className="truncate">
                      Theme applied
                    </span>
                  </Panel>
                  <Panel style={{ padding: `${f(6)} ${f(8)}` }}>
                    <span style={{ color: "var(--text-dim)", fontSize: f(9.5) }}>Modal</span>
                  </Panel>
                </div>

                {/* ── Buttons ── */}
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      background: "var(--accent)",
                      color: "var(--accent-ink)",
                      borderRadius: "var(--r-sm)",
                      padding: `${f(5)} ${f(11)}`,
                      fontSize: f(10),
                      fontWeight: 600,
                    }}
                  >
                    Send
                  </span>
                  <span
                    style={{
                      background: "var(--surface)",
                      boxShadow: "var(--neu-raised-sm)",
                      color: "var(--text)",
                      borderRadius: "var(--r-sm)",
                      padding: `${f(5)} ${f(11)}`,
                      fontSize: f(10),
                    }}
                  >
                    Cancel
                  </span>
                </div>
              </>
            )}

            <div className="flex-1" />

            {/* ── Input ── */}
            <div
              className="flex items-center gap-2"
              style={{
                background: "var(--bg-deep)",
                boxShadow: "var(--neu-inset-sm)",
                borderRadius: "var(--r-sm)",
                padding: `${f(6)} ${f(9)}`,
              }}
            >
              <span style={{ color: "var(--text-faint)", fontSize: f(10) }} className="flex-1 truncate">
                Ask anything…
              </span>
              <span
                className="flex items-center justify-center"
                style={{
                  width: f(18),
                  height: f(18),
                  borderRadius: "var(--r-pill)",
                  background: "var(--accent)",
                  color: "var(--accent-ink)",
                }}
              >
                <Icon name="send" size={Math.round(10 * scale)} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Cards get the cheap silhouette; the sticky panel gets the real thing. */
export default React.memo(function LiveInterfacePreview({ skin, mode, compact = false }) {
  return compact ? <CardPreview skin={skin} mode={mode} /> : <FullPreview skin={skin} mode={mode} />;
});
