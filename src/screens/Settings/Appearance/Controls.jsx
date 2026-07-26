import React, { useState } from "react";
import { useStore } from "../../../core/store";
import { themeStore, setAccent } from "../../../core/theme";
import {
  appearanceStore,
  setMode,
  setGroup,
  resetSection,
  rememberAccent,
  recordThemeChange,
  DEFAULTS,
} from "../../../core/appearance";
import { ACCENT_PRESETS } from "../../../design/themes";
import { contrastRatio, contrastGrade, readableInk, parseColor } from "../../../utils/contrast";
import Icon from "../../../ui/icons";
import { Segmented, NeuButton, NeuInput, NeuToggle, NeuBadge, NeuTooltip } from "../../../ui/primitives";

/* ═══ Shared shells ═════════════════════════════════════════════════════════
   One collapsible section and one slider row, so eight control groups do not
   grow eight slightly different layouts. */

export function Section({ id, title, hint, children, defaultOpen = false, onReset, dirty }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `sec-${id}`;
  return (
    <section className="neu-raised-sm rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          className="pressable flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Icon
            name="chevronRight"
            size={14}
            className="text-dim shrink-0"
            style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform var(--t) var(--ease-out)" }}
          />
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold text-hi truncate">{title}</span>
            {hint && <span className="block text-[11.5px] text-faint truncate">{hint}</span>}
          </span>
        </button>
        {dirty && (
          <NeuTooltip label="Changed from the default">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--accent)" }} />
          </NeuTooltip>
        )}
        {onReset && dirty && (
          <NeuButton size="sm" variant="ghost" onClick={onReset}>
            Reset
          </NeuButton>
        )}
      </div>
      {open && (
        <div id={panelId} className="px-4 pb-4 flex flex-col gap-4">
          {children}
        </div>
      )}
    </section>
  );
}

export function SliderRow({ label, hint, value, min, max, step, onChange, format, onReset, isDefault }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[12.5px] font-medium text-dim">{label}</span>
        <span className="flex items-center gap-2">
          <span className="text-[12px] font-mono text-accent tabular-nums">{format(value)}</span>
          {!isDefault && onReset && (
            <button
              type="button"
              onClick={onReset}
              aria-label={`Reset ${label}`}
              className="pressable text-faint hover:text-accent"
            >
              <Icon name="refresh" size={12} />
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        className="w-full"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="text-[11px] text-faint mt-1">{hint}</p>}
    </div>
  );
}

const Row = ({ label, hint, children }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="min-w-0">
      <span className="block text-[12.5px] font-medium text-dim">{label}</span>
      {hint && <span className="block text-[11px] text-faint">{hint}</span>}
    </span>
    <span className="shrink-0">{children}</span>
  </div>
);

/* ═══ 1 · Display mode ══════════════════════════════════════════════════════ */

export function DisplayModeSelector() {
  const { mode } = useStore(appearanceStore, (s) => ({ mode: s.mode }));
  return (
    <Section
      id="mode"
      title="Display mode"
      hint="System follows the OS · Auto follows the clock · OLED is true black"
      dirty={mode !== DEFAULTS.mode}
      onReset={() => setMode(DEFAULTS.mode)}
    >
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "system", label: "System", icon: "cpu" },
          { value: "light", label: "Light", icon: "sun" },
          { value: "dark", label: "Dark", icon: "moon" },
          { value: "oled", label: "OLED", icon: "zap" },
          { value: "auto", label: "Auto", icon: "clock" },
        ]}
      />
    </Section>
  );
}

/* ═══ 2 · Accent colour ═════════════════════════════════════════════════════ */

const toRgb = (hex) => {
  const p = parseColor(hex);
  return p ? `${p[0]}, ${p[1]}, ${p[2]}` : "";
};

export function AccentColorEditor() {
  const { accent } = useStore(themeStore, (s) => ({ accent: s.accent }));
  const { recentAccents } = useStore(appearanceStore, (s) => ({ recentAccents: s.recentAccents }));
  const [draft, setDraft] = useState("");

  // Read the live value so the readouts describe what is on screen, whether it
  // came from an override or from the skin itself.
  const live =
    accent ||
    (typeof getComputedStyle !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
      : "");

  const ink = readableInk(live);
  const grade = contrastGrade(contrastRatio(live, ink));
  const onSurface = contrastGrade(
    contrastRatio(live, getComputedStyle(document.documentElement).getPropertyValue("--surface").trim())
  );

  const pick = (hex) => {
    recordThemeChange();
    setAccent(hex);
    rememberAccent(hex);
  };

  const commitHex = () => {
    const v = draft.trim().replace(/^#?/, "#");
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      pick(v);
      setDraft("");
    }
  };

  const invalid = draft.trim() !== "" && !/^#?[0-9a-fA-F]{6}$/.test(draft.trim());

  return (
    <Section
      id="accent"
      title="Accent colour"
      hint="Used for emphasis, focus and every active state"
      dirty={!!accent}
      onReset={() => {
        recordThemeChange();
        setAccent("");
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="w-11 h-11 rounded-sm shrink-0 flex items-center justify-center text-[11px] font-bold"
          style={{ background: live, color: ink, boxShadow: "var(--neu-raised-sm)" }}
        >
          Aa
        </span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-mono text-hi">{live || "—"}</p>
          <p className="text-[11px] text-faint font-mono">rgb({toRgb(live)})</p>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <NeuTooltip label={`Text on the accent: ${grade.label}`}>
            <NeuBadge tone={grade.ok ? "ok" : "err"}>ink {grade.level}</NeuBadge>
          </NeuTooltip>
          <NeuTooltip label={`Accent against panels: ${onSurface.label}`}>
            <NeuBadge tone={onSurface.ok ? "ok" : "err"}>panel {onSurface.level}</NeuBadge>
          </NeuTooltip>
        </div>
      </div>

      {!onSurface.ok && (
        <p className="text-[11.5px] text-err flex items-start gap-1.5">
          <Icon name="alert" size={12} className="mt-[2px] shrink-0" />
          <span>
            This accent only reaches {onSurface.label} against panel backgrounds — below the 4.5:1 WCAG AA minimum for
            body text. Fine for large shapes, hard to read as small text.
          </span>
        </p>
      )}

      <div>
        <p className="text-[11.5px] text-faint mb-2">Presets</p>
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((p) => (
            <NeuTooltip key={p.hex} label={p.name}>
              <button
                type="button"
                aria-label={p.name}
                onClick={() => pick(p.hex)}
                className="pressable w-7 h-7 rounded-full"
                style={{
                  background: p.hex,
                  boxShadow:
                    live.toLowerCase() === p.hex.toLowerCase()
                      ? "0 0 0 2px var(--bg), 0 0 0 4px var(--accent)"
                      : "var(--neu-raised-sm)",
                }}
              />
            </NeuTooltip>
          ))}
          <NeuTooltip label="Pick any colour">
            <label className="pressable w-7 h-7 rounded-full relative cursor-pointer flex items-center justify-center"
              style={{ background: "var(--surface)", boxShadow: "var(--neu-raised-sm)" }}>
              <Icon name="palette" size={13} className="text-dim" />
              <input
                type="color"
                aria-label="Custom accent colour"
                value={/^#[0-9a-fA-F]{6}$/.test(live) ? live : "#888888"}
                onChange={(e) => pick(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </label>
          </NeuTooltip>
        </div>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="min-w-[150px] flex-1">
          <NeuInput
            label="HEX"
            placeholder={live || "#ffb454"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitHex}
            onKeyDown={(e) => e.key === "Enter" && commitHex()}
          />
        </div>
        <NeuButton size="sm" onClick={commitHex} disabled={invalid || !draft.trim()}>
          Apply
        </NeuButton>
      </div>
      {invalid && <p className="text-[11.5px] text-err">Enter six hex digits, like #ffb454.</p>}

      {recentAccents.length > 0 && (
        <div>
          <p className="text-[11.5px] text-faint mb-2">Recently used</p>
          <div className="flex flex-wrap gap-2">
            {recentAccents.map((c) => (
              <NeuTooltip key={c} label={c}>
                <button
                  type="button"
                  aria-label={`Use ${c}`}
                  onClick={() => pick(c)}
                  className="pressable w-6 h-6 rounded-sm"
                  style={{ background: c, boxShadow: "var(--neu-raised-sm)" }}
                />
              </NeuTooltip>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

/* ═══ 4 · Surface and shape ═════════════════════════════════════════════════ */

const pct = (v) => `${Math.round(v * 100)}%`;

export function SurfaceControls() {
  const { shape } = useStore(appearanceStore, (s) => ({ shape: s.shape }));
  const d = DEFAULTS.shape;
  const set = (patch) => setGroup("shape", patch);
  const dirty = Object.keys(d).some((k) => shape[k] !== d[k]);

  return (
    <Section id="surface" title="Surface and shape" hint="Corners, depth and how solid panels feel" dirty={dirty} onReset={() => resetSection("shape")}>
      <SliderRow
        label="Corner radius" value={shape.radius} min={0} max={2} step={0.05}
        format={pct} isDefault={shape.radius === d.radius}
        onReset={() => set({ radius: d.radius })} onChange={(v) => set({ radius: v })}
        hint="Scales each theme's own radii — 0% is square, 200% is very rounded"
      />
      <SliderRow
        label="Card elevation" value={shape.elevation} min={0} max={2} step={0.05}
        format={(v) => (v === 0 ? "flat" : pct(v))} isDefault={shape.elevation === d.elevation}
        onReset={() => set({ elevation: d.elevation })} onChange={(v) => set({ elevation: v })}
      />
      <SliderRow
        label="Shadow intensity" value={shape.shadow} min={0} max={2} step={0.05}
        format={pct} isDefault={shape.shadow === d.shadow}
        onReset={() => set({ shadow: d.shadow })} onChange={(v) => set({ shadow: v })}
      />
      <Row label="Borders" hint="Hairlines between surfaces">
        <NeuToggle checked={shape.border} onChange={(v) => set({ border: v })} />
      </Row>
      {shape.border && (
        <SliderRow
          label="Border thickness" value={shape.borderWidth} min={0.5} max={3} step={0.5}
          format={(v) => `${v}px`} isDefault={shape.borderWidth === d.borderWidth}
          onReset={() => set({ borderWidth: d.borderWidth })} onChange={(v) => set({ borderWidth: v })}
        />
      )}
      <SliderRow
        label="Glass blur" value={shape.blur} min={0} max={24} step={1}
        format={(v) => `${v}px`} isDefault={shape.blur === d.blur}
        onReset={() => set({ blur: d.blur })} onChange={(v) => set({ blur: v })}
      />
      <SliderRow
        label="Surface transparency" value={shape.transparency} min={0} max={0.6} step={0.02}
        format={pct} isDefault={shape.transparency === d.transparency}
        onReset={() => set({ transparency: d.transparency })} onChange={(v) => set({ transparency: v })}
      />
      <Row label="Interface density">
        <Segmented
          size="sm" value={shape.density} onChange={(v) => set({ density: v })}
          options={[
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
            { value: "spacious", label: "Spacious" },
          ]}
        />
      </Row>
    </Section>
  );
}

/* ═══ 5 · Typography ════════════════════════════════════════════════════════ */

const FONT_OPTIONS = [
  { value: "", label: "Theme default" },
  { value: "system", label: "System UI" },
  { value: "inter", label: "Inter" },
  { value: "jakarta", label: "Plus Jakarta Sans" },
  { value: "grotesk", label: "Space Grotesk" },
  { value: "rounded", label: "Nunito" },
  { value: "serif", label: "Georgia" },
  { value: "mono", label: "JetBrains Mono" },
];

function FontSelect({ label, value, onChange }) {
  return (
    <Row label={label}>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="neu-raised-sm rounded-sm px-2.5 py-1.5 text-[12px] text-hi bg-surface"
        style={{ minWidth: 170 }}
      >
        {FONT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Row>
  );
}

export function TypographyControls() {
  const { type } = useStore(appearanceStore, (s) => ({ type: s.type }));
  const d = DEFAULTS.type;
  const set = (patch) => setGroup("type", patch);
  const dirty = Object.keys(d).some((k) => type[k] !== d[k]);

  return (
    <Section id="type" title="Typography" hint="Fonts fall back safely — an unavailable face never breaks the layout" dirty={dirty} onReset={() => resetSection("type")}>
      <FontSelect label="Interface font" value={type.ui} onChange={(v) => set({ ui: v })} />
      <FontSelect label="Reading font" value={type.reading} onChange={(v) => set({ reading: v })} />
      <FontSelect label="Monospace font" value={type.mono} onChange={(v) => set({ mono: v })} />
      <SliderRow
        label="Font size" value={type.size} min={0.85} max={1.3} step={0.01}
        format={pct} isDefault={type.size === d.size}
        onReset={() => set({ size: d.size })} onChange={(v) => set({ size: v })}
      />
      <Row label="Font weight">
        <Segmented
          size="sm" value={String(type.weight)} onChange={(v) => set({ weight: Number(v) })}
          options={[
            { value: "-1", label: "Light" },
            { value: "0", label: "Normal" },
            { value: "1", label: "Bold" },
          ]}
        />
      </Row>
      <SliderRow
        label="Line height" value={type.lineHeight} min={1.2} max={2} step={0.05}
        format={(v) => v.toFixed(2)} isDefault={type.lineHeight === d.lineHeight}
        onReset={() => set({ lineHeight: d.lineHeight })} onChange={(v) => set({ lineHeight: v })}
      />
      <SliderRow
        label="Letter spacing" value={type.letterSpacing} min={-0.02} max={0.1} step={0.005}
        format={(v) => `${v.toFixed(3)}em`} isDefault={type.letterSpacing === d.letterSpacing}
        onReset={() => set({ letterSpacing: d.letterSpacing })} onChange={(v) => set({ letterSpacing: v })}
      />
      <SliderRow
        label="Heading scale" value={type.headingScale} min={0.8} max={1.5} step={0.05}
        format={pct} isDefault={type.headingScale === d.headingScale}
        onReset={() => set({ headingScale: d.headingScale })} onChange={(v) => set({ headingScale: v })}
      />

      <div className="neu-inset rounded-sm p-3.5">
        <p className="text-[10px] uppercase tracking-[0.14em] text-faint mb-2">Preview</p>
        <h3 className="font-display font-bold text-hi mb-1" style={{ fontSize: `calc(1.15rem * var(--kp-heading-scale, 1))` }}>
          The quick brown fox
        </h3>
        <p className="text-[12.5px] text-body mb-2">
          Jumps over the lazy dog while the interface keeps its rhythm at every size.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-faint">Label</span>
          <span className="neu-raised-sm rounded-sm px-2.5 py-1 text-[11.5px] text-hi">Button</span>
        </div>
        <code className="block font-mono text-[11.5px] text-accent bg-deep rounded-xs px-2.5 py-1.5">
          const theme = "yours";
        </code>
      </div>
    </Section>
  );
}

/* ═══ 6 · Motion ════════════════════════════════════════════════════════════ */

export function MotionControls() {
  const { motion } = useStore(appearanceStore, (s) => ({ motion: s.motion }));
  const d = DEFAULTS.motion;
  const set = (patch) => setGroup("motion", patch);
  const dirty = Object.keys(d).some((k) => motion[k] !== d[k]);
  const still = motion.level === "none";

  return (
    <Section id="motion" title="Motion" hint="The system's reduce-motion setting always wins over these" dirty={dirty} onReset={() => resetSection("motion")}>
      <Row label="Motion level">
        <Segmented
          size="sm" value={motion.level} onChange={(v) => set({ level: v })}
          options={[
            { value: "full", label: "Full" },
            { value: "reduced", label: "Reduced" },
            { value: "none", label: "None" },
          ]}
        />
      </Row>
      {!still && (
        <>
          <SliderRow
            label="Animation intensity" value={motion.intensity} min={0} max={1.5} step={0.05}
            format={pct} isDefault={motion.intensity === d.intensity}
            onReset={() => set({ intensity: d.intensity })} onChange={(v) => set({ intensity: v })}
          />
          <SliderRow
            label="Animation speed" value={motion.speed} min={0.5} max={2} step={0.05}
            format={(v) => `${v.toFixed(2)}×`} isDefault={motion.speed === d.speed}
            onReset={() => set({ speed: d.speed })} onChange={(v) => set({ speed: v })}
            hint="Higher is faster — durations are divided by this"
          />
          <SliderRow
            label="Hover strength" value={motion.hover} min={0} max={2} step={0.05}
            format={pct} isDefault={motion.hover === d.hover}
            onReset={() => set({ hover: d.hover })} onChange={(v) => set({ hover: v })}
          />
          <Row label="Page transition">
            <Segmented
              size="sm" value={motion.transition} onChange={(v) => set({ transition: v })}
              options={[
                { value: "fade", label: "Fade" },
                { value: "slide", label: "Slide" },
                { value: "scale", label: "Scale" },
                { value: "none", label: "None" },
              ]}
            />
          </Row>
        </>
      )}
    </Section>
  );
}

/* ═══ 7 · Background ════════════════════════════════════════════════════════ */

export function BackgroundControls() {
  const { background } = useStore(appearanceStore, (s) => ({ background: s.background }));
  const d = DEFAULTS.background;
  const set = (patch) => setGroup("background", patch);
  const dirty = Object.keys(d).some((k) => background[k] !== d[k]);

  return (
    <Section id="bg" title="Background" hint="Sits behind the interface, never behind the text" dirty={dirty} onReset={() => resetSection("background")}>
      <Row label="Style">
        <Segmented
          size="sm" value={background.kind} onChange={(v) => set({ kind: v })}
          options={[
            { value: "solid", label: "Solid" },
            { value: "gradient", label: "Gradient" },
            { value: "mesh", label: "Mesh" },
            { value: "image", label: "Image" },
          ]}
        />
      </Row>
      {background.kind === "image" && (
        <NeuInput
          label="Image URL"
          placeholder="https://…"
          value={background.image}
          onChange={(e) => set({ image: e.target.value })}
        />
      )}
      <SliderRow
        label="Noise texture" value={background.noise} min={0} max={0.5} step={0.01}
        format={pct} isDefault={background.noise === d.noise}
        onReset={() => set({ noise: d.noise })} onChange={(v) => set({ noise: v })}
      />
      <SliderRow
        label="Brightness" value={background.brightness} min={0.4} max={1.4} step={0.02}
        format={pct} isDefault={background.brightness === d.brightness}
        onReset={() => set({ brightness: d.brightness })} onChange={(v) => set({ brightness: v })}
      />
      <SliderRow
        label="Opacity" value={background.opacity} min={0} max={1} step={0.02}
        format={pct} isDefault={background.opacity === d.opacity}
        onReset={() => set({ opacity: d.opacity })} onChange={(v) => set({ opacity: v })}
        hint="The layer fades toward the flat page colour, so text contrast is unaffected"
      />
    </Section>
  );
}

/* ═══ 8 · Accessibility ═════════════════════════════════════════════════════ */

export function AccessibilityControls() {
  const { a11y } = useStore(appearanceStore, (s) => ({ a11y: s.a11y }));
  const d = DEFAULTS.a11y;
  const set = (patch) => setGroup("a11y", patch);
  const dirty = Object.keys(d).some((k) => a11y[k] !== d[k]);

  return (
    <Section id="a11y" title="Accessibility" hint="These override the styling choices above wherever they conflict" dirty={dirty} onReset={() => resetSection("a11y")}>
      <Row label="High contrast" hint="Flattens the ink ladder and hardens borders">
        <NeuToggle checked={a11y.highContrast} onChange={(v) => set({ highContrast: v })} />
      </Row>
      <SliderRow
        label="Text size" value={a11y.textScale} min={1} max={1.5} step={0.05}
        format={pct} isDefault={a11y.textScale === d.textScale}
        onReset={() => set({ textScale: d.textScale })} onChange={(v) => set({ textScale: v })}
        hint="Multiplies on top of the typography size above"
      />
      <Row label="Strong focus ring" hint="Thick, always-visible keyboard outline">
        <NeuToggle checked={a11y.strongFocus} onChange={(v) => set({ strongFocus: v })} />
      </Row>
      <Row label="Reduce transparency" hint="Turns off glass blur and see-through panels">
        <NeuToggle checked={a11y.reduceTransparency} onChange={(v) => set({ reduceTransparency: v })} />
      </Row>
      <Row label="Reduce motion" hint="Stops animation regardless of the motion settings">
        <NeuToggle checked={a11y.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
      </Row>
      <Row label="Colour vision" hint="Moves success and error apart from red/green">
        <Segmented
          size="sm" value={a11y.colorBlind} onChange={(v) => set({ colorBlind: v })}
          options={[
            { value: "none", label: "Default" },
            { value: "deuteranopia", label: "Deutan" },
            { value: "protanopia", label: "Protan" },
            { value: "tritanopia", label: "Tritan" },
          ]}
        />
      </Row>
    </Section>
  );
}
