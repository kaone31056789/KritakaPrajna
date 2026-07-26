import React, { useState } from "react";
import { useStore } from "../../../core/store";
import { themeStore } from "../../../core/theme";
import {
  appearanceStore,
  applyCustomTokens,
  saveCustomTheme,
  deleteCustomTheme,
  importTheme,
  exportTheme,
  CUSTOM_TOKENS,
  ESSENTIAL_TOKENS,
} from "../../../core/appearance";
import { THEMES } from "../../../design/themes";
import Icon from "../../../ui/icons";
import { NeuButton, NeuInput, NeuTooltip, NeuModal, IconButton } from "../../../ui/primitives";
import { toast } from "../../../ui/Toaster";

/* ═══ TokenEditorPanel ══════════════════════════════════════════════════════
   Customising a theme belongs next to the thing you are customising, not
   behind a "create custom theme" card and a modal. This edits the live
   interface directly: change a token and the app and the preview above both
   move, because both read the same CSS variable.

   Saving is what turns a set of edits into a named theme you can come back to.
   Reset drops the edits and hands the colours back to the theme.
   ═══════════════════════════════════════════════════════════════════════════ */

const liveValue = (varName) => {
  if (typeof getComputedStyle === "undefined") return "#888888";
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || "#888888";
};

export default function TokenEditorPanel({ skin }) {
  const { custom } = useStore(appearanceStore, (s) => ({ custom: s.custom }));
  const { skin: appliedSkin } = useStore(themeStore, (s) => ({ skin: s.skin }));
  const [open, setOpen] = useState(false);
  const [edits, setEdits] = useState({});
  const [name, setName] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [json, setJson] = useState("");
  // Re-read computed values after each change without holding a copy of them.
  const [, bump] = useState(0);

  const dirty = Object.keys(edits).length > 0;
  const themeName = THEMES.find((t) => t.id === skin)?.name || skin;
  const saved = Object.values(custom);

  const setToken = (key, value) => {
    const next = { ...edits, [key]: value };
    setEdits(next);
    applyCustomTokens(next);
    bump((n) => n + 1);
  };

  const resetToken = (key) => {
    const next = { ...edits };
    delete next[key];
    setEdits(next);
    applyCustomTokens(Object.keys(next).length ? next : null);
    bump((n) => n + 1);
  };

  const resetAllTokens = () => {
    setEdits({});
    applyCustomTokens(null);
    bump((n) => n + 1);
    toast.info("Colours handed back to the theme");
  };

  const save = () => {
    if (!dirty) return;
    const id = saveCustomTheme({ name: name.trim() || `${themeName} (custom)`, from: appliedSkin, tokens: edits });
    setName("");
    toast.success(`Saved as "${custom[id]?.name || name.trim() || `${themeName} (custom)`}"`);
  };

  const load = (t) => {
    setEdits(t.tokens);
    applyCustomTokens(t.tokens);
    bump((n) => n + 1);
  };

  const doImport = () => {
    const res = importTheme(json);
    if (!res.ok) return toast.error(res.error);
    load(appearanceStore.get().custom[res.id]);
    setImportOpen(false);
    setJson("");
    toast.success(
      `Imported ${res.imported} token${res.imported === 1 ? "" : "s"}` +
        (res.rejected.length ? ` · ${res.rejected.length} skipped as invalid` : "")
    );
  };

  return (
    <div className="neu-raised-sm rounded-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="pressable flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Icon
            name="chevronRight"
            size={13}
            className="text-dim shrink-0"
            style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform var(--t) var(--ease-out)" }}
          />
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold text-hi truncate">Customise colours</span>
            <span className="block text-[11px] text-faint truncate">
              {dirty
                ? `${Object.keys(edits).length} changed on ${themeName}`
                : `The five that matter · ${themeName}`}
            </span>
          </span>
        </button>
        {/* Also in the header, not only under the list: the list can be long
            enough to push the buttons out of reach. */}
        {dirty && (
          <NeuTooltip label="Hand every colour back to the theme">
            <span>
              <NeuButton size="sm" variant="ghost" icon="refresh" onClick={resetAllTokens}>
                Reset
              </NeuButton>
            </span>
          </NeuTooltip>
        )}
        {dirty && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--accent)" }} />}
      </div>

      {open && (
        <div className="px-3.5 pb-3.5 flex flex-col gap-3">
          {/* Five rows need no scroller; seventeen do, or the Save and Reset
              row below is pushed past the bottom of the sticky rail and there
              is no way to reach it. */}
          <div
            className="grid grid-cols-1 gap-1.5"
            style={showAll ? { maxHeight: "38vh", overflowY: "auto", paddingRight: 4 } : undefined}
          >
            {(showAll ? CUSTOM_TOKENS : CUSTOM_TOKENS.filter((t) => ESSENTIAL_TOKENS.includes(t.key))).map((t) => {
              const value = edits[t.key] || liveValue(t.varName);
              const overridden = !!edits[t.key];
              return (
                <div key={t.key} className="flex items-center gap-2.5 neu-inset rounded-sm px-2.5 py-1.5">
                  <label
                    className="relative w-6 h-6 rounded-xs shrink-0 cursor-pointer"
                    style={{ background: value, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)" }}
                  >
                    <span className="sr-only">{t.label}</span>
                    <input
                      type="color"
                      aria-label={t.label}
                      value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#888888"}
                      onChange={(e) => setToken(t.key, e.target.value)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </label>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] text-hi truncate">{t.label}</span>
                    <span className="block text-[10px] font-mono text-faint truncate">{value}</span>
                  </span>
                  {overridden && (
                    <IconButton name="refresh" size={11} label={`Reset ${t.label}`} onClick={() => resetToken(t.key)} />
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="pressable text-[11.5px] text-dim hover:text-accent self-start flex items-center gap-1"
          >
            <Icon name="chevronDown" size={11} style={{ transform: showAll ? "rotate(180deg)" : "none" }} />
            {showAll ? "Show the essentials only" : `All ${CUSTOM_TOKENS.length} colours`}
          </button>

          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <NeuInput
                label="Save as"
                placeholder={`${themeName} (custom)`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            </div>
            <NeuButton size="sm" onClick={save} disabled={!dirty}>
              Save
            </NeuButton>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <NeuButton size="sm" variant="ghost" icon="refresh" onClick={resetAllTokens} disabled={!dirty}>
              Reset
            </NeuButton>
            <NeuButton size="sm" variant="ghost" icon="plus" onClick={() => setImportOpen(true)}>
              Import
            </NeuButton>
            <NeuButton
              size="sm"
              variant="ghost"
              icon="copy"
              disabled={!dirty}
              onClick={() => {
                const id = saveCustomTheme({ name: name.trim() || `${themeName} (custom)`, from: appliedSkin, tokens: edits });
                navigator.clipboard?.writeText(exportTheme(id));
                toast.success("Theme JSON copied");
              }}
            >
              Copy JSON
            </NeuButton>
          </div>

          {saved.length > 0 && (
            <div>
              <p className="text-[11px] text-faint mb-1.5">Saved themes</p>
              <div className="flex flex-col gap-1.5">
                {saved.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 neu-raised-sm rounded-sm px-2.5 py-1.5">
                    <span className="flex h-3.5 w-8 rounded-xs overflow-hidden shrink-0">
                      {CUSTOM_TOKENS.slice(0, 4).map((k) => (
                        <span key={k.key} className="flex-1" style={{ background: t.tokens[k.key] || "var(--surface-2)" }} />
                      ))}
                    </span>
                    <button type="button" onClick={() => load(t)} className="pressable text-[11.5px] text-hi truncate flex-1 text-left">
                      {t.name}
                    </button>
                    <NeuTooltip label="Export as JSON">
                      <IconButton
                        name="download"
                        size={12}
                        label={`Export ${t.name}`}
                        onClick={() => {
                          const blob = new Blob([exportTheme(t.id)], { type: "application/json" });
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = `${t.name.replace(/\W+/g, "-").toLowerCase()}.json`;
                          a.click();
                          URL.revokeObjectURL(a.href);
                        }}
                      />
                    </NeuTooltip>
                    <IconButton
                      name="trash"
                      size={12}
                      tone="danger"
                      label={`Delete ${t.name}`}
                      onClick={() => {
                        if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
                        deleteCustomTheme(t.id);
                        toast.info("Theme deleted");
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {importOpen && (
        <NeuModal open onClose={() => setImportOpen(false)} title="Import theme JSON">
          <textarea
            className="w-full neu-inset rounded-sm p-3 text-[12px] font-mono text-hi bg-deep"
            rows={9}
            aria-label="Theme JSON"
            placeholder={'{ "name": "My theme", "tokens": { "accent": "#ffb454" } }'}
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          <p className="text-[11px] text-faint mt-2">
            Only recognised colour tokens are applied, and every value is checked before it reaches a CSS variable.
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <NeuButton size="sm" variant="ghost" onClick={() => setImportOpen(false)}>
              Cancel
            </NeuButton>
            <NeuButton size="sm" onClick={doImport} disabled={!json.trim()}>
              Import
            </NeuButton>
          </div>
        </NeuModal>
      )}
    </div>
  );
}
