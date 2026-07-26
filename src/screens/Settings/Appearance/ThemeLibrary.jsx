import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../../core/store";
import { themeStore } from "../../../core/theme";
import {
  appearanceStore,
  applyPreset,
  toggleFavourite,
  resolveMode,
  THEME_CATEGORIES,
  CATEGORY_LIST,
} from "../../../core/appearance";
import { THEMES } from "../../../design/themes";
import Icon from "../../../ui/icons";
import { NeuButton, NeuInput, NeuBadge, NeuTooltip, Segmented, IconButton } from "../../../ui/primitives";
import LiveInterfacePreview from "./Preview";
import { Section } from "./Controls";

/* How many cards to paint per batch — one xl row is three. */
const PAGE = 9;

/* ═══ ThemeCard ═════════════════════════════════════════════════════════════
   Every card renders the real miniature in its own theme, so no two look the
   same unless the themes themselves do. The palette strip and the compat
   badges come from the registry, which is also what themes.css is built from. */

function ThemeCard({ theme, mode, active, favourite, onApply, onPreview, onFavourite }) {
  const sw = mode === "light" ? theme.light : theme.dark;
  const category = THEME_CATEGORIES[theme.id] || "Experimental";

  return (
    <div
      className="rounded-sm overflow-hidden flex flex-col"
      style={{
        background: "var(--surface)",
        boxShadow: active ? "var(--neu-raised-sm), 0 0 0 2px var(--accent)" : "var(--neu-raised-sm)",
        transition: "box-shadow var(--t) var(--ease-out)",
      }}
    >
      <div className="relative">
        <LiveInterfacePreview skin={theme.id} mode={mode} compact />
        {active && (
          <span
            className="absolute top-2 right-2 flex items-center gap-1 px-2 py-[3px] rounded-full text-[10px] font-semibold"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            <Icon name="check" size={10} /> Active
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-hi truncate">{theme.name}</p>
            <p className="text-[11px] text-faint line-clamp-2">{theme.tag}</p>
          </div>
          <IconButton
            name={favourite ? "pin" : "bookmark"}
            size={14}
            label={favourite ? `Unfavourite ${theme.name}` : `Favourite ${theme.name}`}
            tone="default"
            active={favourite}
            className="shrink-0"
            onClick={onFavourite}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="flex h-3 rounded-xs overflow-hidden shrink-0" style={{ width: 40 }}>
            {sw.map((c, i) => (
              <span key={i} className="flex-1" style={{ background: c }} />
            ))}
          </span>
          <NeuBadge tone="neutral">{category}</NeuBadge>
          <NeuTooltip label="Ships a dark and a light variant">
            <span className="text-[10px] text-faint flex items-center gap-0.5">
              <Icon name="moon" size={9} />
              <Icon name="sun" size={9} />
            </span>
          </NeuTooltip>
        </div>

        <div className="flex items-center gap-2 mt-auto pt-1">
          <NeuButton size="sm" variant={active ? "ghost" : "accent"} className="flex-1" onClick={onApply} disabled={active}>
            {active ? "Applied" : "Apply"}
          </NeuButton>
          <NeuButton size="sm" variant="ghost" onClick={onPreview}>
            Preview
          </NeuButton>
        </div>
      </div>
    </div>
  );
}

/* ═══ ThemeToolbar ══════════════════════════════════════════════════════════ */

const SORTS = [
  { value: "default", label: "Curated" },
  { value: "az", label: "A–Z" },
  { value: "recent", label: "Recent" },
];

function ThemeToolbar({ q, setQ, cat, setCat, sort, setSort, favesOnly, setFavesOnly, count }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <NeuInput
            icon="search"
            placeholder="Search themes…"
            aria-label="Search themes"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Segmented size="sm" value={sort} onChange={setSort} options={SORTS} />
        <NeuButton
          size="sm"
          variant={favesOnly ? "accent" : "ghost"}
          icon="pin"
          onClick={() => setFavesOnly((f) => !f)}
        >
          Favourites
        </NeuButton>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {CATEGORY_LIST.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            aria-pressed={cat === c}
            className={`pressable px-2.5 py-1 rounded-pill text-[11.5px] ${
              cat === c ? "text-accent" : "text-dim hover:text-hi"
            }`}
            style={{
              background: cat === c ? "var(--accent-soft)" : "var(--surface)",
              boxShadow: cat === c ? "none" : "var(--neu-raised-sm)",
            }}
          >
            {c}
          </button>
        ))}
        <span className="text-[11px] text-faint ml-auto">{count} shown</span>
      </div>
    </div>
  );
}

/* ═══ ThemeGrid ═════════════════════════════════════════════════════════════ */

export default function ThemeLibrary({ onPreview }) {
  const { skin } = useStore(themeStore, (s) => ({ skin: s.skin }));
  const { mode, favourites, recent } = useStore(appearanceStore, (s) => ({
    mode: s.mode,
    favourites: s.favourites,
    recent: s.recent,
  }));
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState("default");
  const [favesOnly, setFavesOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef(null);

  const resolved = resolveMode(mode);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = THEMES.filter((t) => {
      if (favesOnly && !favourites.includes(t.id)) return false;
      if (cat !== "All" && (THEME_CATEGORIES[t.id] || "Experimental") !== cat) return false;
      if (needle && !`${t.name} ${t.tag} ${t.motion}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (sort === "az") out = [...out].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "recent") {
      out = [...out].sort((a, b) => {
        const ia = recent.indexOf(a.id);
        const ib = recent.indexOf(b.id);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
    }
    return out;
  }, [q, cat, sort, favesOnly, favourites, recent]);

  // A new filter is a new list — start it from the top again.
  useEffect(() => setShown(PAGE), [q, cat, sort, favesOnly]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= list.length) return undefined;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setShown((n) => n + PAGE),
      { rootMargin: "300px" } // fetch the next row before it is reached
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, list.length]);

  return (
    <Section
      id="library"
      title="Theme library"
      hint={`${THEMES.length} design languages — colours are customised in the panel beside the preview`}
    >
      <ThemeToolbar
        q={q}
        setQ={setQ}
        cat={cat}
        setCat={setCat}
        sort={sort}
        setSort={setSort}
        favesOnly={favesOnly}
        setFavesOnly={setFavesOnly}
        count={list.length}
      />

      {list.length === 0 && <p className="text-[12px] text-faint py-6 text-center">No theme matches that.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.slice(0, shown).map((t) => (
          <ThemeCard
            key={t.id}
            theme={t}
            mode={resolved}
            active={skin === t.id}
            favourite={favourites.includes(t.id)}
            onApply={() => applyPreset(t.id)}
            onPreview={() => onPreview(t.id)}
            onFavourite={() => toggleFavourite(t.id)}
          />
        ))}
      </div>

      {/* Progressive rendering rather than a windowed list: the grid is short
          enough that a sentinel costs nothing, and every card keeps its real
          height so scroll position never jumps. */}
      {shown < list.length && (
        <div ref={sentinel} className="flex items-center justify-center py-4 text-[11.5px] text-faint">
          Loading {list.length - shown} more…
        </div>
      )}
    </Section>
  );
}
