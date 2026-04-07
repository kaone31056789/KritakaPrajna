import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { filterModelsForTask } from "../utils/smartModelSelect";

const ease = [0.4, 0, 0.2, 1];
const FAVORITES_KEY = "openrouter_favorites";
const MAX_FAVORITES = 10;
const SOURCE_PROVIDER_ORDER = ["openrouter", "huggingface", "ollama", "openai", "anthropic"];

const SOURCE_LABELS = {
  openrouter: "OpenRouter",
  huggingface: "Hugging Face",
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

const SOURCE_COLORS = {
  openrouter: "#60a5fa",
  huggingface: "#c084fc",
  ollama: "#22c55e",
  openai: "#34d399",
  anthropic: "#fb923c",
};

const FAMILY_PATTERNS = [
  { key: "qwen", label: "Qwen", patterns: ["qwen"] },
  { key: "gemma", label: "Gemma", patterns: ["gemma"] },
  { key: "llama", label: "LLaMA", patterns: ["llama"] },
  { key: "mixtral", label: "Mixtral", patterns: ["mixtral"] },
  { key: "mistral", label: "Mistral", patterns: ["mistral", "ministral", "magistral"] },
  { key: "deepseek", label: "DeepSeek", patterns: ["deepseek"] },
  { key: "claude", label: "Claude", patterns: ["claude"] },
  { key: "gpt", label: "GPT", patterns: ["gpt", "o1", "o3", "o4"] },
  { key: "gemini", label: "Gemini", patterns: ["gemini"] },
  { key: "phi", label: "Phi", patterns: ["phi"] },
  { key: "glm", label: "GLM", patterns: ["glm"] },
  { key: "kimi", label: "Kimi", patterns: ["kimi", "moonshot"] },
];

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

function selectionId(model) {
  return model?._selectionId || model?.id || "";
}

function sourceLabel(key) {
  return SOURCE_LABELS[key] || key;
}

function shortName(model) {
  if (model.name) return model.name;
  const id = model.id;
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(slash + 1) : id;
}

function displayName(model) {
  return shortName(model).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function highlightMatch(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-saffron-500/30 text-saffron-300 rounded-sm">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

function isFreeModel(model) {
  const p = model?.pricing;
  if (!p) return false;
  return Number(p.prompt) === 0 && Number(p.completion) === 0;
}

function supportsMeaningfulPricing(provider) {
  return provider === "openrouter" || provider === "huggingface" || provider === "ollama";
}

function familyForModel(model) {
  const text = `${model.id} ${model.name || ""}`.toLowerCase();
  const match = FAMILY_PATTERNS.find((family) => family.patterns.some((pattern) => text.includes(pattern)));
  return match || { key: "other", label: "Other Models" };
}

function sortModels(provider, models) {
  return [...models].sort((a, b) => {
    if (supportsMeaningfulPricing(provider)) {
      const aFree = isFreeModel(a) ? 0 : 1;
      const bFree = isFreeModel(b) ? 0 : 1;
      if (aFree !== bFree) return aFree - bFree;
    }
    if (provider === "huggingface") {
      const aDownloads = typeof a._downloads === "number" ? a._downloads : -1;
      const bDownloads = typeof b._downloads === "number" ? b._downloads : -1;
      if (aDownloads !== bDownloads) return bDownloads - aDownloads;
    }
    return displayName(a).localeCompare(displayName(b));
  });
}

function buildProviderGroups(models) {
  const providerBuckets = {};
  for (const model of models) {
    const provider = model._provider || "openrouter";
    if (!providerBuckets[provider]) providerBuckets[provider] = [];
    providerBuckets[provider].push(model);
  }

  return SOURCE_PROVIDER_ORDER
    .filter((provider) => providerBuckets[provider]?.length)
    .map((provider) => {
      const families = {};
      for (const model of sortModels(provider, providerBuckets[provider])) {
        const family = familyForModel(model);
        if (!families[family.key]) families[family.key] = { ...family, models: [] };
        families[family.key].models.push(model);
      }

      return {
        key: provider,
        label: sourceLabel(provider),
        color: SOURCE_COLORS[provider] || "#888",
        showPricing: supportsMeaningfulPricing(provider),
        families: Object.values(families),
        count: providerBuckets[provider].length,
      };
    });
}

function ChevronIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
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

// Estimate monthly cost — uses real avg tokens/msg when available, falls back to 500+800
function modelEstMonthly(model, avgTokens) {
  const p = model?.pricing;
  if (!p) return null;
  const prompt     = Number(p.prompt)     || 0;
  const completion = Number(p.completion) || 0;
  if (prompt === 0 && completion === 0) return 0;
  const avgPrompt     = avgTokens?.prompt     || 500;
  const avgCompletion = avgTokens?.completion || 800;
  const costPerMsg = prompt * avgPrompt + completion * avgCompletion;
  return costPerMsg * 600; // 20 msgs/day × 30 days
}

function fmtPerMillion(pricePerToken) {
  const m = Number(pricePerToken) * 1_000_000;
  if (!m) return null;
  if (m < 0.01) return `$${m.toFixed(4)}`;
  if (m < 1)   return `$${m.toFixed(3)}`;
  if (m < 10)  return `$${m.toFixed(2)}`;
  return `$${m.toFixed(1)}`;
}

function PricingBadge({ model, compact = false, showCost = false }) {
  if (!model) return null;
  const provider = model._provider || "openrouter";
  if (!supportsMeaningfulPricing(provider)) return null;

  const free = isFreeModel(model);

  if (!free && showCost && model.pricing) {
    const inp = fmtPerMillion(model.pricing.prompt);
    const out = fmtPerMillion(model.pricing.completion);
    const label = (inp && out) ? `${inp} · ${out} /1M` : inp ? `${inp}/1M` : "Paid";
    return (
      <span className="shrink-0 text-[10px] px-2 py-0.5 font-medium rounded-full leading-none bg-amber-500/15 text-amber-300 whitespace-nowrap">
        {label}
      </span>
    );
  }

  return (
    <span className={`shrink-0 text-[10px] px-2 py-0.5 font-medium rounded-full leading-none ${free ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-300"}`}>
      {free ? "Free" : "Paid"}
    </span>
  );
}

function FavoriteItem({ model, selected, search, isFavorite, onSelect, onToggleFav, selectedItemRef, monthlyBudget, avgMsgTokens }) {
  const provider = model._provider || "openrouter";
  return (
    <li
      ref={selected ? selectedItemRef : null}
      onClick={onSelect}
      className={`px-3 py-2.5 cursor-pointer flex items-center gap-2 border-b border-white/[0.03] ${selected ? "bg-saffron-500/12 text-saffron-300" : "text-dark-200 hover:bg-dark-700/70"}`}
    >
      <div className="flex flex-col min-w-0 flex-1 gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-medium">{highlightMatch(displayName(model), search)}</span>
          <PricingBadge model={model} compact />
        </div>
        <div className="flex items-center gap-2 text-xs text-dark-400 min-w-0">
          <span className="truncate">{sourceLabel(provider)}</span>
          <span className="truncate">{highlightMatch(model.id, search)}</span>
        </div>
      </div>
      <BudgetIndicator model={model} monthlyBudget={monthlyBudget} avgMsgTokens={avgMsgTokens} />
      <StarIcon filled={isFavorite} className={isFavorite ? "text-saffron-400" : "text-dark-500 hover:text-saffron-400"} onClick={onToggleFav} />
    </li>
  );
}

function BudgetIndicator({ model, monthlyBudget, avgMsgTokens }) {
  if (!monthlyBudget || monthlyBudget <= 0) return null;
  // Show for any model — free ones always fit, paid ones need pricing data
  if (isFreeModel(model)) return (
    <span className="shrink-0 text-[11px] font-bold text-emerald-400" title="Free — fits any budget">✓</span>
  );
  const p = model?.pricing;
  if (!p || (Number(p.prompt) === 0 && Number(p.completion) === 0)) return null;
  const est = modelEstMonthly(model, avgMsgTokens);
  if (est === null) return null;
  const fits = est <= monthlyBudget;
  const estLabel = est < 0.01 ? "<$0.01" : `$${est.toFixed(2)}`;
  return (
    <span
      className={`shrink-0 text-[11px] font-bold ${fits ? "text-emerald-400" : "text-red-400"}`}
      title={`~${estLabel}/mo · budget $${monthlyBudget}/mo`}
    >
      {fits ? "✓" : "✗"}
    </span>
  );
}

function ModelRow({ model, selected, search, isFavorite, onSelect, onToggleFav, selectedItemRef, monthlyBudget, avgMsgTokens }) {
  return (
    <li
      ref={selected ? selectedItemRef : null}
      onClick={onSelect}
      className={`px-4 py-2 cursor-pointer flex items-center gap-2 ${selected ? "bg-saffron-500/12 text-saffron-300" : "text-dark-200 hover:bg-dark-700/60"}`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="truncate text-sm">{highlightMatch(displayName(model), search)}</span>
        <PricingBadge model={model} compact />
      </div>
      <BudgetIndicator model={model} monthlyBudget={monthlyBudget} avgMsgTokens={avgMsgTokens} />
      <StarIcon filled={isFavorite} className={isFavorite ? "text-saffron-400" : "text-dark-500 hover:text-saffron-400"} onClick={onToggleFav} />
    </li>
  );
}

export default function ModelSelector({ models, selected, onSelect, selectedModel, selectedTask = "text-generation", onTaskChange, openSignal = 0, monthlyBudget = null, providerUsage = null }) {
  const [open, setOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pricingFilter, setPricingFilter] = useState("all");
  const [warnModel, setWarnModel] = useState(null); // { id, name, est }
  const [collapsedProviders, setCollapsedProviders] = useState({});
  const [favorites, setFavorites] = useState(loadFavorites);
  const [listMaxHeight, setListMaxHeight] = useState(520);
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const selectedItemRef = useRef(null);
  const dropdownPanelRef = useRef(null);
  const dropdownHeaderRef = useRef(null);

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const toggleFavorite = useCallback((modelId) => {
    setFavorites((prev) => {
      const next = prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [modelId, ...prev].slice(0, MAX_FAVORITES);
      saveFavorites(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setTaskOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
      setTimeout(() => selectedItemRef.current?.scrollIntoView({ block: "nearest" }), 0);
    } else {
      setSearch("");
      setPricingFilter("all");
    }
  }, [open]);

  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  const recalcListMaxHeight = useCallback(() => {
    if (!open) return;

    const panelTop = dropdownPanelRef.current?.getBoundingClientRect().top;
    if (!Number.isFinite(panelTop)) return;

    const headerHeight = dropdownHeaderRef.current?.getBoundingClientRect().height || 120;
    const composerTop = document.querySelector("[data-message-composer]")?.getBoundingClientRect().top;
    const lowerBoundary = Number.isFinite(composerTop) ? composerTop - 10 : window.innerHeight - 24;

    const availableForList = Math.floor(lowerBoundary - panelTop - headerHeight);
    const boundedHeight = Math.min(520, Math.max(140, availableForList));
    setListMaxHeight(boundedHeight);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const update = () => recalcListMaxHeight();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, recalcListMaxHeight, warnModel]);

  // Derive avg tokens/msg from real usage data so budget indicator reflects actual behaviour
  const avgMsgTokens = useMemo(() => {
    if (!providerUsage) return null;
    let totalReqs = 0, totalPrompt = 0, totalCompletion = 0;
    for (const row of Object.values(providerUsage)) {
      totalReqs       += row.requests         || 0;
      totalPrompt     += row.promptTokens     || 0;
      totalCompletion += row.completionTokens || 0;
    }
    if (totalReqs === 0) return null;
    return {
      prompt:     Math.round(totalPrompt     / totalReqs),
      completion: Math.round(totalCompletion / totalReqs),
    };
  }, [providerUsage]);

  const taskFiltered = useMemo(() => filterModelsForTask(models, selectedTask), [models, selectedTask]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return taskFiltered.filter((model) => {
      const provider = model._provider || "openrouter";
      const family = familyForModel(model).label.toLowerCase();
      const haystack = `${model.id} ${displayName(model)} ${sourceLabel(provider)} ${family}`.toLowerCase();
      if (term && !haystack.includes(term)) return false;
      if (pricingFilter === "free") return supportsMeaningfulPricing(provider) && isFreeModel(model);
      if (pricingFilter === "paid") return supportsMeaningfulPricing(provider) && !isFreeModel(model);
      return true;
    });
  }, [taskFiltered, search, pricingFilter]);

  const providerGroups = useMemo(() => buildProviderGroups(filtered), [filtered]);

  const favoriteModels = useMemo(() => {
    const filteredSet = new Set(filtered.map((m) => selectionId(m)));
    return favorites
      .filter((id) => filteredSet.has(id))
      .map((id) => filtered.find((m) => selectionId(m) === id))
      .filter(Boolean);
  }, [favorites, filtered]);

  const selectedObj = selectedModel || models.find((m) => selectionId(m) === selected || m.id === selected);
  const currentProvider = selectedObj?._provider || "openrouter";
  const taskMenuOptions = [
    { id: "text-generation", label: "Text to Text" },
    { id: "text-to-image", label: "Image Generation" },
    { id: "image-to-text", label: "Image to Text" },
    { id: "image-to-image", label: "Image to Image" },
    { id: "text-to-speech", label: "Text to Speech" },
  ];
  const currentTask = taskMenuOptions.find((task) => task.id === selectedTask);

  const handleSelect = (id) => {
    onSelect(id);
    setWarnModel(null);
    setOpen(false);
  };

  const trySelect = (model) => {
    if (monthlyBudget > 0 && !isFreeModel(model)) {
      const est = modelEstMonthly(model, avgMsgTokens);
      if (est !== null && est > monthlyBudget) {
        setWarnModel({ id: selectionId(model), name: displayName(model), est });
        return;
      }
    }
    handleSelect(selectionId(model));
  };

  return (
    <div ref={containerRef} className="flex items-center gap-2 min-w-0 flex-1">
      <div className="relative w-[180px] shrink-0">
        <button
          type="button"
          onClick={() => setTaskOpen((v) => !v)}
          className="h-10 w-full flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 cursor-pointer"
        >
          <span className="truncate text-sm font-medium text-dark-100">{currentTask?.label || "Text to Text"}</span>
          <motion.span animate={{ rotate: taskOpen ? 180 : 0 }} transition={{ duration: 0.2, ease }} className="text-dark-400">
            <ChevronIcon className="w-4 h-4" />
          </motion.span>
        </button>

        <AnimatePresence>
          {taskOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease }}
              className="absolute z-50 mt-2 w-full bg-dark-800 border border-white/[0.08] rounded-xl shadow-xl shadow-black/30 overflow-hidden"
            >
              {taskMenuOptions.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => {
                    onTaskChange?.(task.id);
                    setTaskOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 text-sm transition-colors cursor-pointer ${
                    selectedTask === task.id
                      ? "bg-saffron-500/16 text-saffron-300"
                      : "text-dark-200 hover:bg-dark-700/70"
                  }`}
                >
                  {task.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative min-w-0 flex-1 max-w-[560px]">
        <motion.button
          type="button"
          onClick={() => setOpen((o) => !o)}
          whileHover={{ scale: 1.005 }}
          whileTap={{ scale: 0.995 }}
          transition={{ duration: 0.15, ease }}
          className="h-10 w-full flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 cursor-pointer"
        >
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <span className="text-sm font-semibold text-dark-100 truncate">{selectedObj ? displayName(selectedObj) : "Select a model"}</span>
            <span className="text-xs text-dark-400 truncate">{sourceLabel(currentProvider)}</span>
          </div>
          <PricingBadge model={selectedObj} compact showCost />
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2, ease }} className="text-dark-400">
            <ChevronIcon className="w-4 h-4" />
          </motion.span>
        </motion.button>

        <AnimatePresence>
          {open && (
            <motion.div
              ref={dropdownPanelRef}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease }}
              className="absolute z-50 mt-2 w-full min-w-[420px] max-w-[720px] bg-dark-800 border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/40 overflow-hidden"
            >
              <div ref={dropdownHeaderRef} className="p-3 border-b border-white/[0.06] space-y-2">
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search models, families, providers..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600/50 rounded-xl px-3 py-2 text-sm text-dark-100 placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-saffron-500 focus:border-transparent"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-dark-500">Task: {currentTask?.label || "Text Generation"}</span>
                  <div className="flex gap-1">
                    {["all", "free", "paid"].map((filterValue) => (
                      <button
                        key={filterValue}
                        type="button"
                        onClick={() => setPricingFilter(filterValue)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer transition-colors ${pricingFilter === filterValue ? "bg-saffron-500/20 text-saffron-300 border border-saffron-500/30" : "bg-dark-700/60 text-dark-400 border border-transparent hover:text-dark-200 hover:bg-dark-700"}`}
                      >
                        {filterValue === "all" ? "All" : filterValue === "free" ? "Free" : "Paid"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Budget warning banner */}
                {warnModel && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl bg-red-500/10 border border-red-500/25 px-3 py-2.5 space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-red-400 text-sm shrink-0">⚠️</span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-red-300">{warnModel.name}</p>
                        <p className="text-[11px] text-red-400/80 mt-0.5">
                          ~${warnModel.est.toFixed(2)}/mo estimated — exceeds your ${monthlyBudget}/mo budget
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setWarnModel(null)}
                        className="flex-1 text-[11px] text-dark-300 bg-dark-700 hover:bg-dark-600 rounded-lg py-1.5 cursor-pointer transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelect(warnModel.id)}
                        className="flex-1 text-[11px] text-red-200 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg py-1.5 cursor-pointer transition-colors font-medium"
                      >
                        Use Anyway
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>

              <div className="overflow-y-auto py-2" style={{ maxHeight: `${listMaxHeight}px` }}>
                {filtered.length === 0 && <div className="px-4 py-6 text-sm text-dark-400 text-center">No models available for this task</div>}

                {favoriteModels.length > 0 && (
                  <div className="mb-3 px-2">
                    <div className="flex items-center gap-2 px-2 py-2 border-b border-white/[0.05]">
                      <span className="text-saffron-400 text-sm">★</span>
                      <span className="text-sm font-semibold text-saffron-400">Favorites</span>
                    </div>
                    <ul>
                      {favoriteModels.map((model) => (
                        <FavoriteItem
                          key={`fav-${selectionId(model)}`}
                          model={model}
                          selected={selectionId(model) === selected}
                          search={search}
                          isFavorite={true}
                          onSelect={() => trySelect(model)}
                          onToggleFav={() => toggleFavorite(selectionId(model))}
                          selectedItemRef={selectedItemRef}
                          monthlyBudget={monthlyBudget}
                          avgMsgTokens={avgMsgTokens}
                        />
                      ))}
                    </ul>
                  </div>
                )}

                {providerGroups.map((provider) => {
                  const isCollapsed = collapsedProviders[provider.key] && !search;
                  return (
                    <div key={provider.key} className="mb-3 px-2">
                      <button
                        type="button"
                        onClick={() => setCollapsedProviders((prev) => ({ ...prev, [provider.key]: !prev[provider.key] }))}
                        className="w-full flex items-center gap-2 px-2 py-2.5 border-b border-white/[0.05] hover:bg-dark-700/40 rounded-t-xl cursor-pointer"
                      >
                        <ChevronIcon className={`w-4 h-4 text-dark-400 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: provider.color }} />
                        <span className="text-sm font-semibold text-dark-200">{provider.label}</span>
                        <span className="text-[11px] text-dark-500 ml-auto">{provider.count}</span>
                      </button>

                      {!isCollapsed && (
                        <div className="rounded-b-xl overflow-hidden border-x border-b border-white/[0.03] bg-dark-900/20">
                          {provider.families.map((family) => (
                            <div key={`${provider.key}-${family.key}`} className="border-t border-white/[0.03] first:border-t-0">
                              <div className="px-4 py-2 text-xs font-semibold text-dark-400 bg-dark-900/40">{family.label}</div>
                              <ul>
                                {family.models.map((model) => (
                                  <ModelRow
                                    key={selectionId(model)}
                                    model={model}
                                    selected={selectionId(model) === selected}
                                    search={search}
                                    isFavorite={favSet.has(selectionId(model))}
                                    onSelect={() => trySelect(model)}
                                    onToggleFav={() => toggleFavorite(selectionId(model))}
                                    selectedItemRef={selectedItemRef}
                                    monthlyBudget={monthlyBudget}
                                    avgMsgTokens={avgMsgTokens}
                                  />
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
