import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.4, 0, 0.2, 1];

// --- Helpers ----------------------------------------------------------------

const FAVORITES_KEY = "openrouter_favorites";
const MAX_FAVORITES = 10;

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids.slice(0, MAX_FAVORITES)));
}

function highlightMatch(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-saffron-500/30 text-saffron-300 rounded-sm">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

/** Returns true if both prompt and completion pricing are "0" or 0 */
function isFreeModel(model) {
  const p = model?.pricing;
  if (!p) return false;
  return Number(p.prompt) === 0 && Number(p.completion) === 0;
}

const KNOWN_PROVIDERS = ["openai", "anthropic", "mistralai", "google"];

function getProvider(model) {
  const slash = model.id.indexOf("/");
  if (slash > 0) return model.id.slice(0, slash);
  return null;
}

function providerLabel(key) {
  const labels = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    mistralai: "Mistral AI",
    google: "Google",
    others: "Others",
  };
  return labels[key] || key;
}

/** Strip "provider/" prefix to get the short model name */
function shortName(id) {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(slash + 1) : id;
}

/**
 * Group an array of models into { key, label, models[] }[]
 * Known providers appear first in a fixed order, then "others".
 */
function groupModels(models) {
  const buckets = {};
  for (const m of models) {
    const provider = getProvider(m) || "others";
    const key = KNOWN_PROVIDERS.includes(provider) ? provider : "others";
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(m);
  }

  const order = [...KNOWN_PROVIDERS, "others"];
  return order
    .filter((k) => buckets[k]?.length)
    .map((k) => ({
      key: k,
      label: providerLabel(k),
      models: buckets[k].sort((a, b) => {
        const aFree = isFreeModel(a) ? 0 : 1;
        const bFree = isFreeModel(b) ? 0 : 1;
        if (aFree !== bFree) return aFree - bFree;
        return a.id.localeCompare(b.id);
      }),
    }));
}

// --- Icons ------------------------------------------------------------------

function ChevronIcon({ className }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function StarIcon({ filled, className, onClick }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`shrink-0 p-0.5 rounded hover:scale-110 transition-transform cursor-pointer ${className || ""}`}
      aria-label={filled ? "Remove from favorites" : "Add to favorites"}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    </button>
  );
}

// --- Model item -------------------------------------------------------------

function PricingBadge({ model }) {
  const free = isFreeModel(model);
  return (
    <span
      className={`shrink-0 text-[10px] font-medium rounded-full px-1.5 py-0.5 leading-none ${
        free
          ? "bg-emerald-500/15 text-emerald-400"
          : "bg-dark-600/60 text-dark-300"
      }`}
    >
      {free ? "Free" : "Paid"}
    </span>
  );
}

function ModelItem({ model, isSelected, isFavorite, search, onSelect, onToggleFav, selectedItemRef }) {
  return (
    <li
      ref={isSelected ? selectedItemRef : null}
      onClick={onSelect}
      className={`pl-8 pr-3 py-2 cursor-pointer text-sm flex items-center gap-2 transition-colors ${
        isSelected
          ? "bg-saffron-500/15 text-saffron-300"
          : "text-dark-200 hover:bg-dark-700"
      }`}
    >
      <div className="flex flex-col gap-0.5 min-w-0 flex-1 overflow-hidden">
        <span className="truncate font-medium flex items-center gap-1.5">
          <span className="truncate">{highlightMatch(shortName(model.id), search)}</span>
          <PricingBadge model={model} />
        </span>
        <span className="text-xs text-dark-400 truncate block">
          {highlightMatch(model.id, search)}
        </span>
      </div>
      <StarIcon
        filled={isFavorite}
        className={isFavorite ? "text-saffron-400" : "text-dark-500 hover:text-saffron-400"}
        onClick={onToggleFav}
      />
    </li>
  );
}

// --- Component --------------------------------------------------------------

export default function ModelSelector({ models, selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pricingFilter, setPricingFilter] = useState("all"); // "all" | "free" | "paid"
  const [collapsed, setCollapsed] = useState({});
  const [favorites, setFavorites] = useState(loadFavorites);
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const selectedItemRef = useRef(null);

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const toggleFavorite = useCallback((modelId) => {
    setFavorites((prev) => {
      let next;
      if (prev.includes(modelId)) {
        next = prev.filter((id) => id !== modelId);
      } else {
        next = [modelId, ...prev].slice(0, MAX_FAVORITES);
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search input & scroll to selected item when dropdown opens
  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
      setTimeout(() => {
        selectedItemRef.current?.scrollIntoView({ block: "nearest" });
      }, 0);
    } else {
      setSearch("");
      setPricingFilter("all");
    }
  }, [open]);

  // Filter models by search + pricing
  const filtered = useMemo(
    () =>
      models.filter((m) => {
        if (!m.id.toLowerCase().includes(search.toLowerCase())) return false;
        if (pricingFilter === "free" && !isFreeModel(m)) return false;
        if (pricingFilter === "paid" && isFreeModel(m)) return false;
        return true;
      }),
    [models, search, pricingFilter]
  );

  const groups = useMemo(() => groupModels(filtered), [filtered]);

  // Favorites list: only show models that still exist in the full model list and match the search
  const favoriteModels = useMemo(() => {
    const filteredSet = new Set(filtered.map((m) => m.id));
    return favorites
      .filter((id) => filteredSet.has(id))
      .map((id) => filtered.find((m) => m.id === id));
  }, [favorites, filtered]);

  const isSearching = search.length > 0;

  const toggleGroup = (key) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectedLabel = selected || "Select a model…";

  return (
    <div ref={containerRef} className="relative min-w-[320px] max-w-md">
      {/* Trigger button */}
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        transition={{ duration: 0.15, ease }}
        className="w-full flex items-center justify-between gap-2 border border-dark-700/50 rounded-xl px-4 py-2.5 text-sm bg-dark-800/60 hover:bg-dark-800 hover:border-dark-600/60 focus:outline-none focus:ring-2 focus:ring-saffron-500/40 cursor-pointer"
      >
        <span className="truncate text-left text-dark-100">
          {models.length === 0 ? "Loading models…" : selectedLabel}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease }}
        >
          <ChevronIcon className="w-4 h-4 shrink-0 text-dark-400" />
        </motion.span>
      </motion.button>

      {/* Dropdown */}
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease }}
          className="absolute z-50 mt-1 w-[420px] bg-dark-800 border border-dark-600/50 rounded-xl shadow-2xl shadow-black/40 flex flex-col overflow-hidden"
        >
          {/* Search + pricing filter */}
          <div className="p-2 border-b border-dark-700 space-y-2">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600/50 rounded-lg px-3 py-1.5 text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-saffron-500 focus:border-transparent"
            />
            <div className="flex gap-1">
              {["all", "free", "paid"].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPricingFilter(f)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer transition-colors ${
                    pricingFilter === f
                      ? "bg-saffron-500/20 text-saffron-300 border border-saffron-500/30"
                      : "bg-dark-700/60 text-dark-400 border border-transparent hover:text-dark-200 hover:bg-dark-700"
                  }`}
                >
                  {f === "all" ? "All" : f === "free" ? "🟢 Free" : "💰 Paid"}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable list */}
          <div className="max-h-80 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-sm text-dark-400 text-center">
                No results found
              </div>
            )}

            {/* ★ Favorites section */}
            {favoriteModels.length > 0 && (
              <div>
                <div className="w-full flex items-center gap-2 px-3 py-2 bg-saffron-500/10 border-b border-saffron-500/20">
                  <span className="text-saffron-400 text-sm">★</span>
                  <span className="text-xs font-semibold text-saffron-400 uppercase tracking-wide">
                    Favorites
                  </span>
                  <span className="text-[10px] text-saffron-500/60 ml-auto">
                    {favoriteModels.length}
                  </span>
                </div>
                <ul>
                  {favoriteModels.map((m) => (
                    <ModelItem
                      key={`fav-${m.id}`}
                      model={m}
                      isSelected={m.id === selected}
                      isFavorite={true}
                      search={search}
                      onSelect={() => { onSelect(m.id); setOpen(false); }}
                      onToggleFav={() => toggleFavorite(m.id)}
                      selectedItemRef={selectedItemRef}
                    />
                  ))}
                </ul>
                <div className="border-b border-dark-700 mx-3 my-1" />
              </div>
            )}

            {/* Provider groups */}
            {groups.map((group) => {
              const isCollapsed = !isSearching && collapsed[group.key];

              return (
                <div key={group.key}>
                  {/* Group header */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-dark-700/50 hover:bg-dark-700 transition-colors cursor-pointer sticky top-0 z-10"
                  >
                    <ChevronIcon
                      className={`w-3.5 h-3.5 text-dark-400 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    />
                    <span className="text-xs font-semibold text-dark-300 uppercase tracking-wide">
                      {group.label}
                    </span>
                    <span className="text-[10px] text-dark-500 ml-auto">
                      {group.models.length}
                    </span>
                  </button>

                  {/* Group items */}
                  {!isCollapsed && (
                    <ul>
                      {group.models.map((m) => (
                        <ModelItem
                          key={m.id}
                          model={m}
                          isSelected={m.id === selected}
                          isFavorite={favSet.has(m.id)}
                          search={search}
                          onSelect={() => { onSelect(m.id); setOpen(false); }}
                          onToggleFav={() => toggleFavorite(m.id)}
                          selectedItemRef={selectedItemRef}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
