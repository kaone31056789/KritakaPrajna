import React, { useEffect, useState } from "react";
import { useStore } from "../../../core/store";
import { themeStore } from "../../../core/theme";
import {
  appearanceStore,
  historyStore,
  undo,
  redo,
  resetAll,
  applyPreset,
  resolveMode,
  DEFAULTS,
} from "../../../core/appearance";
import { THEMES } from "../../../design/themes";
import Icon from "../../../ui/icons";
import { NeuButton, NeuBadge, NeuTooltip, SectionLabel } from "../../../ui/primitives";
import { toast } from "../../../ui/Toaster";
import LiveInterfacePreview from "./Preview";
import ThemeLibrary from "./ThemeLibrary";
import TokenEditorPanel from "./TokenEditorPanel";
import {
  DisplayModeSelector,
  AccentColorEditor,
  SurfaceControls,
  TypographyControls,
  MotionControls,
  BackgroundControls,
  AccessibilityControls,
} from "./Controls";

/* ═══ AppearanceSettings ════════════════════════════════════════════════════
   Controls on the left, a sticky miniature of the real app on the right.

   Every control writes a CSS custom property on <html>, so the preview needs
   no wiring to any of them: it inherits the same tokens the rest of the
   interface does. The one thing it overrides is data-skin, which is how the
   Preview button can show an unapplied theme without changing the app.
   ═══════════════════════════════════════════════════════════════════════════ */

function AppearanceHeader({ dirty }) {
  const { canUndo, canRedo } = useStore(historyStore);
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
      <div>
        <SectionLabel>Appearance</SectionLabel>
        <h2 className="font-display font-bold text-[19px] text-hi mt-0.5">Make it yours</h2>
        <p className="text-[12px] text-faint mt-0.5">
          Every change applies live and is saved as you go — the preview is the real interface.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {dirty && <NeuBadge tone="accent">Customised</NeuBadge>}
        <NeuTooltip label="Undo (Ctrl+Z)">
          <span>
            <NeuButton size="sm" variant="ghost" icon="refresh" disabled={!canUndo} onClick={undo}>
              Undo
            </NeuButton>
          </span>
        </NeuTooltip>
        <NeuTooltip label="Redo (Ctrl+Shift+Z)">
          <span>
            <NeuButton size="sm" variant="ghost" disabled={!canRedo} onClick={redo}>
              Redo
            </NeuButton>
          </span>
        </NeuTooltip>
        {dirty && (
          <NeuTooltip label="Every appearance setting back to its default — saved custom themes are kept">
            <span>
              <NeuButton
                size="sm"
                variant="danger"
                icon="trash"
                onClick={() => {
                  if (!window.confirm("Reset every appearance setting back to its default? Your saved custom themes are kept.")) return;
                  resetAll();
                  toast.info("Appearance reset");
                }}
              >
                Reset all
              </NeuButton>
            </span>
          </NeuTooltip>
        )}
      </div>
    </div>
  );
}

function useIsCustomised() {
  const a = useStore(appearanceStore);
  const { accent, bg, surface } = useStore(themeStore, (s) => ({ accent: s.accent, bg: s.bg, surface: s.surface }));
  const groupChanged = (g) => Object.keys(DEFAULTS[g]).some((k) => a[g][k] !== DEFAULTS[g][k]);
  return (
    !!accent ||
    !!bg ||
    !!surface ||
    a.mode !== DEFAULTS.mode ||
    ["shape", "type", "motion", "background", "a11y"].some(groupChanged)
  );
}

export default function AppearanceSettings() {
  const { skin } = useStore(themeStore, (s) => ({ skin: s.skin }));
  const { mode } = useStore(appearanceStore, (s) => ({ mode: s.mode }));
  const [previewSkin, setPreviewSkin] = useState(null);
  const dirty = useIsCustomised();

  // Undo/redo from the keyboard, scoped to this page.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return; // let the field have it
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = previewSkin || skin;
  const current = THEMES.find((t) => t.id === shown);

  return (
    <div className="kp-appearance-grid">
      {/* ── Controls ── */}
      <div className="flex flex-col gap-4 min-w-0">
        <AppearanceHeader dirty={dirty} />
        <DisplayModeSelector />
        <AccentColorEditor />
        <ThemeLibrary onPreview={(id) => setPreviewSkin((p) => (p === id ? null : id))} />
        <SurfaceControls />
        <TypographyControls />
        <MotionControls />
        <BackgroundControls />
        <AccessibilityControls />
      </div>

      {/* ── Sticky preview + the editor for whatever is on screen ── */}
      <aside className="kp-appearance-aside flex flex-col gap-4">
        <div
          className="neu-raised-sm rounded-sm p-3.5 flex flex-col gap-3"
          style={previewSkin ? { boxShadow: "var(--neu-raised-sm), 0 0 0 2px var(--accent)" } : undefined}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-hi truncate">
                {previewSkin ? "Previewing (not applied)" : "Live preview"}
              </p>
              <p className="text-[11px] text-faint truncate">
                {current?.name} · {current?.motion}
              </p>
            </div>
            {previewSkin && (
              <div className="flex items-center gap-1.5 shrink-0">
                <NeuButton size="sm" variant="accent" onClick={() => { applyPreset(previewSkin); setPreviewSkin(null); }}>
                  Apply
                </NeuButton>
                <NeuButton size="sm" variant="ghost" aria-label="Stop previewing" onClick={() => setPreviewSkin(null)}>
                  <Icon name="close" size={12} />
                </NeuButton>
              </div>
            )}
          </div>
          <LiveInterfacePreview skin={shown} mode={resolveMode(mode)} />
          <p className="text-[10.5px] text-faint">
            Rendered from the same tokens as the app — what you see here is what ships.
          </p>
        </div>

        <TokenEditorPanel skin={shown} />
      </aside>
    </div>
  );
}
