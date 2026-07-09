import React, { useMemo, useState } from "react";
import { useStore } from "../../core/store";
import { modelsStore, selectModel, modelDisplayName, isFreeModel, formatPrice, contextLabel } from "../../core/models";
import { providerLabel } from "../../api/providerRouter";
import { rankingsStore, topRankedModels } from "../../core/rankings";
import Icon from "../../ui/icons";
import BrandIcon from "../../ui/BrandIcon";
import { NeuPopover, NeuBadge } from "../../ui/primitives";

/* Model picker popover — search, live "Top this week" shortcuts, grouped by
   provider, price + context chips. Enter selects the first match. */

function ModelRow({ m, active, badge = null, onPick }) {
  return (
    <button
      type="button"
      onClick={() => onPick(m)}
      className={`w-full flex items-center gap-2.5 px-2.5 h-10 rounded-xs text-left ${
        active ? "bg-deep [box-shadow:var(--neu-inset-sm)]" : "hover:bg-surface-2"
      }`}
      style={{ transition: "background 120ms var(--ease-out)" }}
    >
      <BrandIcon model={m} seed={m._selectionId} size={18} />
      <span className={`flex-1 truncate text-[12.5px] ${active ? "text-hi" : "text-body"}`}>
        {modelDisplayName(m)}
      </span>
      {badge}
      {m._isImageGen && <Icon name="image" size={12} className="text-info" />}
      {isFreeModel(m) ? (
        <NeuBadge tone="ok">free</NeuBadge>
      ) : (
        <span className="text-[10px] font-mono text-faint">{formatPrice(m.pricing?.prompt)}</span>
      )}
      <span className="text-[10px] font-mono text-faint w-[52px] text-right">{contextLabel(m)}</span>
      {active && <Icon name="check" size={13} className="text-accent" />}
    </button>
  );
}

export default function ModelPicker({ open, onClose, anchor = "top-start", onSelect }) {
  const { models, selectedId } = useStore(modelsStore, (s) => ({ models: s.models, selectedId: s.selectedId }));
  const { rankCount } = useStore(rankingsStore, (s) => ({ rankCount: s.items.length }));
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = q
      ? models.filter((m) => `${modelDisplayName(m)} ${m.id} ${m._provider}`.toLowerCase().includes(q))
      : models;
    return list.slice(0, 120);
  }, [models, query]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const m of filtered) {
      if (!map.has(m._provider)) map.set(m._provider, []);
      map.get(m._provider).push(m);
    }
    return [...map.entries()];
  }, [filtered]);

  // Live "most used this week" shortcuts (hidden while searching).
  const top = useMemo(
    () => (query.trim() ? [] : topRankedModels(models, 6)),
    [models, query, rankCount]
  );

  const pick = (m) => {
    selectModel(m._selectionId);
    onSelect?.(m);
    onClose?.();
  };

  const onKeyDown = (e) => {
    if (e.key !== "Enter") return;
    const first = query.trim() ? filtered[0] : top[0]?.model || filtered[0];
    if (first) {
      e.preventDefault();
      pick(first);
    }
  };

  return (
    <NeuPopover open={open} onClose={onClose} anchor={anchor} width={380} className="!p-0">
      <div className="flex items-center gap-2.5 px-4 h-11 border-b border-line">
        <Icon name="search" size={14} className="text-faint shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search models…"
          className="flex-1 bg-transparent border-none outline-none text-[13px] text-hi placeholder:text-faint"
        />
        <span className="text-[10.5px] text-faint">{models.length}</span>
      </div>
      <div className="max-h-[380px] overflow-y-auto p-1.5">
        {groups.length === 0 && <p className="text-center text-[12.5px] text-faint py-6">No models found.</p>}

        {top.length > 0 && (
          <div>
            <p className="px-2.5 pt-2.5 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-accent">
              Top this week
            </p>
            {top.map(({ model: m, info }) => (
              <ModelRow
                key={`top-${m._selectionId}`}
                m={m}
                active={m._selectionId === selectedId}
                onPick={pick}
                badge={<span className="text-[9.5px] font-mono text-accent shrink-0">#{info.rank}</span>}
              />
            ))}
          </div>
        )}

        {groups.map(([provider, list]) => (
          <div key={provider}>
            <p className="px-2.5 pt-2.5 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-faint">
              {providerLabel(provider)}
            </p>
            {list.map((m) => (
              <ModelRow key={m._selectionId} m={m} active={m._selectionId === selectedId} onPick={pick} />
            ))}
          </div>
        ))}
      </div>
    </NeuPopover>
  );
}
