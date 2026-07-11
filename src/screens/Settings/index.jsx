import React, { useMemo, useRef, useState } from "react";
import { useStore, generateId } from "../../core/store";
import { keysStore, setProviderKey, removeProviderKey } from "../../core/keys";
import { settingsStore, setSetting, resetSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "../../core/settings";
import { chatsStore, savePersona, deletePersona } from "../../core/chats";
import { memoryStore, saveMemory, resetMemory } from "../../core/memory";
import { MEMORY_CATEGORY_DEFS } from "../../utils/userMemory";
import { loadProviderUsage, providerUsageRows } from "../../utils/usageTracker";
import {
  loadLifetimeCost,
  resetLifetimeCost,
  formatCost,
  getMonthlySpend,
  resetMonthlySpend,
} from "../../utils/costTracker";
import { PROVIDER_META } from "../../api/providerRouter";
import { modelsStore, modelDisplayName } from "../../core/models";
import { loadModels } from "../../core/models";
import { EASE_OUT } from "../../design/motion";
import { themeStore, setTheme, switchSkin, setAccent } from "../../core/theme";
import { THEMES, ACCENT_PRESETS } from "../../design/themes";
import Icon from "../../ui/icons";
import {
  Segmented,
  NeuButton,
  NeuInput,
  NeuTextArea,
  NeuToggle,
  NeuSlider,
  GradientOrb,
  SectionLabel,
  NeuBadge,
  EmptyState,
  IconButton,
  NeuModal,
} from "../../ui/primitives";
import BrandIcon from "../../ui/BrandIcon";
import { toast } from "../../ui/Toaster";
import {
  createBackupFile,
  decodeBackupFile,
  restorePayload,
  downloadTextFile,
  defaultBackupFilename,
  backupHasKeys,
  summarizePayload,
  passphraseStrength,
  MIN_PASSPHRASE_LENGTH,
} from "../../core/backup";
import { isCryptoAvailable } from "../../core/crypto";

const TABS = [
  { value: "providers", label: "Providers", icon: "key" },
  { value: "appearance", label: "Appearance", icon: "wand" },
  { value: "behavior", label: "Behavior", icon: "settings" },
  { value: "personas", label: "Personas", icon: "brain" },
  { value: "memory", label: "Memory", icon: "bookmark" },
  { value: "usage", label: "Usage", icon: "gauge" },
  { value: "backup", label: "Backup", icon: "shield" },
];

/* ── Providers ── */

function ProviderRow({ id }) {
  const { providers } = useStore(keysStore, (s) => ({ providers: s.providers }));
  const meta = PROVIDER_META[id];
  const current = providers[id];
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);

  const save = async () => {
    if (!draft.trim()) return;
    await setProviderKey(id, draft.trim());
    setDraft("");
    toast.success(`${meta.label} connected`);
    loadModels(keysStore.get().providers);
  };

  return (
    <div className="neu-raised-sm rounded-sm p-4 flex items-center gap-3.5 flex-wrap">
      <BrandIcon provider={id} seed={`provider-${id}`} size={26} glow={!!current} />
      <div className="w-[130px]">
        <p className="text-[13px] font-semibold text-hi">{meta.label}</p>
        {current ? (
          <p className="text-[10px] font-mono text-ok">•••{String(current).slice(-4)}</p>
        ) : (
          <p className="text-[10px] text-faint">not connected</p>
        )}
      </div>
      <div className="relative flex-1 min-w-[220px]">
        <input
          type={show ? "text" : "password"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={current ? "Replace key…" : id === "ollama" ? "http://localhost:11434" : "Paste API key…"}
          className="w-full h-9 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[12px] font-mono text-hi placeholder:text-faint pl-3.5 pr-9 focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)]"
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <button type="button" aria-label="Show key" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-body">
          <Icon name={show ? "eyeOff" : "eye"} size={13} />
        </button>
      </div>
      <NeuButton size="sm" variant="accent" disabled={!draft.trim()} onClick={save}>
        Save
      </NeuButton>
      {current && (
        <NeuButton
          size="sm"
          variant="danger"
          icon="trash"
          onClick={async () => {
            await removeProviderKey(id);
            toast.info(`${meta.label} disconnected`);
            loadModels(keysStore.get().providers);
          }}
        />
      )}
    </div>
  );
}

/* ── Personas ── */

function PersonaEditorModal({ persona, onClose }) {
  const { models } = useStore(modelsStore, (s) => ({ models: s.models }));
  const [name, setName] = useState(persona?.name || "");
  const [prompt, setPrompt] = useState(persona?.systemPrompt || "");
  const [modelId, setModelId] = useState(persona?.modelId || "");

  return (
    <NeuModal
      open
      onClose={onClose}
      title={persona?.id ? "Edit persona" : "New persona"}
      width={520}
      footer={
        <>
          <NeuButton variant="ghost" onClick={onClose}>Cancel</NeuButton>
          <NeuButton
            variant="accent"
            icon="check"
            disabled={!name.trim()}
            onClick={() => {
              savePersona({ id: persona?.id || generateId(), name: name.trim(), systemPrompt: prompt, modelId });
              toast.success("Persona saved");
              onClose();
            }}
          >
            Save persona
          </NeuButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <NeuInput label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Code Reviewer" />
        <NeuTextArea
          label="System prompt"
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="How should this persona behave?"
        />
        <label className="block">
          <span className="block mb-1.5 text-[12px] font-medium text-dim">Pinned model (optional)</span>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full h-10 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[13px] text-hi px-3.5"
          >
            <option value="">Use current model</option>
            {models.slice(0, 200).map((m) => (
              <option key={m._selectionId} value={m._selectionId}>
                {modelDisplayName(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </NeuModal>
  );
}

function PersonasTab() {
  const { personas } = useStore(chatsStore, (s) => ({ personas: s.personas }));
  const [editing, setEditing] = useState(null); // null | {} | persona

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <NeuButton variant="accent" size="sm" icon="plus" onClick={() => setEditing({})}>
          New persona
        </NeuButton>
      </div>
      {personas.length === 0 && (
        <EmptyState icon="brain" title="No personas yet" hint="Personas are reusable system prompts — a reviewer, a translator, a rubber duck." />
      )}
      {personas.map((p) => (
        <div key={p.id} className="neu-raised-sm rounded-sm p-4 flex items-center gap-3.5">
          <GradientOrb seed={`persona-${p.id}`} size={26} />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-hi">{p.name}</p>
            <p className="text-[11px] text-faint truncate">{p.systemPrompt || "No system prompt"}</p>
          </div>
          <IconButton name="edit" label="Edit" onClick={() => setEditing(p)} />
          <IconButton name="trash" label="Delete" tone="danger" onClick={() => { deletePersona(p.id); toast.info("Persona deleted"); }} />
        </div>
      ))}
      {editing !== null && <PersonaEditorModal persona={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ── Memory ── */

function MemoryTab() {
  const { memory } = useStore(memoryStore, (s) => ({ memory: s.memory }));
  return (
    <div className="flex flex-col gap-4">
      <div className="neu-raised-sm rounded-sm p-4 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-hi">Auto-capture memory</p>
          <p className="text-[11px] text-faint">Learn preferences from your conversations automatically.</p>
        </div>
        <NeuToggle checked={!!memory.autoMode} onChange={(v) => saveMemory({ ...memory, autoMode: v })} />
      </div>
      {MEMORY_CATEGORY_DEFS.map((def) => {
        const entries = memory[def.id] || [];
        return (
          <div key={def.id} className="neu-raised-sm rounded-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[12.5px] font-semibold text-hi">{def.label}</p>
                <p className="text-[10.5px] text-faint">{def.description}</p>
              </div>
              <NeuBadge>{entries.length}</NeuBadge>
            </div>
            {entries.length === 0 ? (
              <p className="text-[11.5px] text-faint">Nothing stored.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {entries.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-xs bg-deep [box-shadow:var(--neu-inset-sm)] px-3 py-2">
                    <span className="flex-1 text-[12px] text-body break-words">{entry}</span>
                    <button
                      type="button"
                      aria-label="Remove memory"
                      onClick={() => saveMemory({ ...memory, [def.id]: entries.filter((_, j) => j !== i) })}
                      className="text-faint hover:text-err shrink-0"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <NeuButton variant="danger" size="sm" icon="trash" className="self-start" onClick={() => { resetMemory(); toast.info("Memory cleared"); }}>
        Clear all memory
      </NeuButton>
    </div>
  );
}

/* ── Appearance ── */

function ThemeCard({ t, active, mode, onPick }) {
  const sw = mode === "light" ? t.light : t.dark;
  return (
    <button
      type="button"
      onClick={onPick}
      title={t.tag}
      aria-pressed={active}
      className="pressable text-left p-3.5"
      style={{
        background: "var(--surface)",
        borderRadius: "var(--r-sm)",
        boxShadow: active ? "var(--neu-raised-sm), 0 0 0 2px var(--accent)" : "var(--neu-raised-sm)",
        transition: "box-shadow var(--t) var(--ease-out)",
      }}
    >
      <div
        className="flex items-stretch gap-1 mb-2.5 h-7 overflow-hidden"
        style={{ borderRadius: "calc(var(--r-xs) / 1.5)" }}
      >
        {sw.map((c, i) => (
          <span
            key={i}
            className="flex-1"
            style={{ background: c, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)" }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <p className="text-[12.5px] font-semibold text-hi leading-tight flex-1 min-w-0 truncate">{t.name}</p>
        {active && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--accent)" }} />}
      </div>
      <p className="text-[10.5px] text-faint mt-0.5 truncate">{t.motion}</p>
    </button>
  );
}

function AccentPanel() {
  const { accent } = useStore(themeStore);
  return (
    <div className="neu-raised-sm rounded-sm p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <div>
          <p className="text-[12.5px] font-semibold text-hi">Accent color</p>
          <p className="text-[11px] text-faint">
            Overrides the theme's accent everywhere — or leave it on the theme default.
          </p>
        </div>
        {accent && (
          <NeuButton size="sm" variant="ghost" onClick={() => setAccent("")}>
            Theme default
          </NeuButton>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.hex}
            type="button"
            title={p.name}
            aria-label={`Accent ${p.name}`}
            onClick={() => setAccent(p.hex)}
            className="w-7 h-7 rounded-full transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2"
            style={{
              background: p.hex,
              boxShadow:
                accent === p.hex
                  ? `0 0 0 2px var(--bg-primary), 0 0 0 4px ${p.hex}`
                  : "inset 0 1px 2px rgba(0,0,0,0.25)",
            }}
          />
        ))}
        <label
          className="relative w-7 h-7 rounded-full overflow-hidden cursor-pointer transition-transform hover:scale-110 neu-raised-sm"
          title="Custom color"
          style={{
            background:
              accent && !ACCENT_PRESETS.some((p) => p.hex === accent)
                ? accent
                : "conic-gradient(#e8674a, #e4c65b, #7bc86c, #4aa8e8, #9b6ce8, #e8506e, #e8674a)",
            boxShadow:
              accent && !ACCENT_PRESETS.some((p) => p.hex === accent)
                ? `0 0 0 2px var(--bg-primary), 0 0 0 4px ${accent}`
                : undefined,
          }}
        >
          <input
            type="color"
            value={accent || "#e8674a"}
            onChange={(e) => setAccent(e.target.value)}
            aria-label="Custom accent color"
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        {accent && (
          <span className="text-[10.5px] font-mono text-dim ml-1">{accent}</span>
        )}
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { theme, skin } = useStore(themeStore);
  const current = THEMES.find((t) => t.id === skin);
  return (
    <div className="flex flex-col gap-5">
      <div className="neu-raised-sm rounded-sm p-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[12.5px] font-semibold text-hi">Mode</p>
          <p className="text-[11px] text-faint">Every theme ships a dark and a light variant.</p>
        </div>
        <Segmented
          size="sm"
          value={theme}
          onChange={(v) => setTheme(v)}
          options={[
            { value: "dark", label: "Dark", icon: "moon" },
            { value: "light", label: "Light", icon: "sun" },
          ]}
        />
      </div>

      <AccentPanel />

      <div>
        <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <div>
            <p className="text-[12.5px] font-semibold text-hi">Theme</p>
            <p className="text-[11px] text-faint">
              20 design languages — each with its own color, shape and motion personality.
            </p>
          </div>
          {current && (
            <p className="text-[10.5px] font-mono text-dim">
              {current.name} · <span className="text-accent">{current.motion}</span>
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <ThemeCard key={t.id} t={t} mode={theme} active={skin === t.id} onPick={() => switchSkin(t.id)} />
          ))}
        </div>
        {current && (
          <p className="mt-3 text-[11px] text-faint italic">“{current.tag}”</p>
        )}
      </div>
    </div>
  );
}

/* ── Behavior ── */

function BehaviorTab() {
  const s = useStore(settingsStore);
  return (
    <div className="flex flex-col gap-5">
      <div className="neu-raised-sm rounded-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12.5px] font-semibold text-hi">System prompt</p>
          {s.systemPrompt !== DEFAULT_SYSTEM_PROMPT && (
            <NeuButton size="sm" variant="ghost" onClick={() => { resetSystemPrompt(); toast.info("System prompt reset"); }}>
              Reset to default
            </NeuButton>
          )}
        </div>
        <NeuTextArea rows={7} value={s.systemPrompt} onChange={(e) => setSetting("systemPrompt", e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="neu-raised-sm rounded-sm p-4">
          <p className="text-[12.5px] font-semibold text-hi mb-2.5">Response length</p>
          <Segmented
            size="sm"
            value={s.responseLength}
            onChange={(v) => setSetting("responseLength", v)}
            options={[
              { value: "short", label: "Short" },
              { value: "medium", label: "Medium" },
              { value: "long", label: "Long" },
            ]}
          />
        </div>
        <div className="neu-raised-sm rounded-sm p-4">
          <p className="text-[12.5px] font-semibold text-hi mb-2.5">Reasoning depth</p>
          <Segmented
            size="sm"
            value={s.reasoningDepth}
            onChange={(v) => setSetting("reasoningDepth", v)}
            options={[
              { value: "fast", label: "Fast" },
              { value: "balanced", label: "Balanced" },
              { value: "deep", label: "Deep" },
            ]}
          />
        </div>
        <div className="neu-raised-sm rounded-sm p-4">
          <p className="text-[12.5px] font-semibold text-hi mb-2.5">Send with</p>
          <Segmented
            size="sm"
            value={s.sendKey}
            onChange={(v) => setSetting("sendKey", v)}
            options={[
              { value: "enter", label: "Enter" },
              { value: "mod-enter", label: "Ctrl+Enter" },
            ]}
          />
        </div>
        <div className="neu-raised-sm rounded-sm p-4">
          <p className="text-[12.5px] font-semibold text-hi mb-2.5">Web search</p>
          <Segmented
            size="sm"
            value={s.webMode}
            onChange={(v) => setSetting("webMode", v)}
            options={[
              { value: "auto", label: "Auto" },
              { value: "always", label: "Always" },
              { value: "off", label: "Off" },
            ]}
          />
        </div>
        <div className="neu-raised-sm rounded-sm p-4">
          <p className="text-[12.5px] font-semibold text-hi mb-2.5">Density</p>
          <Segmented
            size="sm"
            value={s.density}
            onChange={(v) => setSetting("density", v)}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </div>
        <div className="neu-raised-sm rounded-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12.5px] font-semibold text-hi">Auto failover</p>
              <p className="text-[11px] text-faint mt-0.5">Retry once on another provider when a request fails</p>
            </div>
            <NeuToggle checked={s.autoFailover} onChange={(v) => setSetting("autoFailover", v)} />
          </div>
        </div>
      </div>

      <div className="neu-raised-sm rounded-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[12.5px] font-semibold text-hi">Monthly cost cap</p>
            <p className="text-[11px] text-faint mt-0.5">
              Paid models are blocked once month-to-date spend hits the cap. 0 = no cap.
              {" "}Spent this month: <span className="text-hi font-semibold">{formatCost(getMonthlySpend())}</span>
            </p>
          </div>
          <NeuButton
            size="sm"
            variant="ghost"
            onClick={() => { resetMonthlySpend(); toast.info("Monthly spend counter reset"); }}
          >
            Reset counter
          </NeuButton>
        </div>
        <div className="flex items-center gap-2 max-w-[220px]">
          <span className="text-[13px] text-dim">$</span>
          <NeuInput
            type="number"
            min="0"
            step="0.5"
            value={s.costCapMonthly || ""}
            placeholder="No cap"
            onChange={(e) => setSetting("costCapMonthly", Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
      </div>

      <div className="neu-raised-sm rounded-sm p-4 flex flex-col gap-4">
        <NeuSlider
          label="History window (messages sent per request)"
          min={4}
          max={40}
          value={s.historyWindow}
          onChange={(v) => setSetting("historyWindow", v)}
        />
        <NeuSlider
          label="Max input characters"
          min={1000}
          max={48000}
          step={1000}
          value={s.maxUserChars}
          onChange={(v) => setSetting("maxUserChars", v)}
          format={(v) => `${(v / 1000).toFixed(0)}k`}
        />
      </div>
    </div>
  );
}

/* ── Usage ── */

function UsageTab() {
  const [nonce, setNonce] = useState(0);
  const rows = useMemo(
    () => providerUsageRows(loadProviderUsage(), Object.keys(PROVIDER_META)).filter((r) => r.requests > 0),
    [nonce]
  );
  const lifetime = useMemo(() => loadLifetimeCost(), [nonce]);
  const maxCost = Math.max(0.000001, ...rows.map((r) => r.cost || 0));

  return (
    <div className="flex flex-col gap-4">
      <div className="neu-raised-sm rounded-sm p-5 flex items-center gap-4">
        <span className="w-11 h-11 rounded-sm bg-accent-soft text-accent flex items-center justify-center">
          <Icon name="dollar" size={20} />
        </span>
        <div className="flex-1">
          <p className="text-[11px] uppercase tracking-[0.15em] text-faint">Lifetime spend</p>
          <p className="font-display font-bold text-[24px] text-hi">{formatCost(lifetime)}</p>
        </div>
        <NeuButton size="sm" variant="ghost" onClick={() => { resetLifetimeCost(0); setNonce((n) => n + 1); }}>
          Reset
        </NeuButton>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="gauge" title="No usage yet" hint="Send some messages and per-provider usage shows up here." />
      ) : (
        rows.map((r) => (
          <div key={r.provider} className="neu-raised-sm rounded-sm p-4">
            <div className="flex items-center gap-2.5 mb-2">
              <BrandIcon provider={r.provider} seed={`provider-${r.provider}`} size={18} />
              <p className="text-[12.5px] font-semibold text-hi flex-1">{PROVIDER_META[r.provider]?.label || r.provider}</p>
              <span className="text-[11px] font-mono text-dim">{r.requests} req</span>
              <span className="text-[11px] font-mono text-accent">{formatCost(r.cost || 0)}</span>
            </div>
            <div className="h-[6px] rounded-full bg-deep [box-shadow:var(--neu-inset-sm)] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(3, ((r.cost || 0) / maxCost) * 100)}%`,
                  background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
                  transition: "width 400ms var(--ease-out)",
                }}
              />
            </div>
            <p className="mt-1.5 text-[10.5px] font-mono text-faint">
              {r.promptTokens?.toLocaleString?.() || 0} in · {r.completionTokens?.toLocaleString?.() || 0} out
            </p>
          </div>
        ))
      )}
    </div>
  );
}

/* ── Backup ── */

function PassField({ label, value, onChange, show, onToggleShow, placeholder, hint }) {
  return (
    <label className="block">
      <span className="block mb-1.5 text-[12px] font-medium text-dim">{label}</span>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full h-10 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[13.5px] text-hi placeholder:text-faint pl-4 pr-10 transition-shadow duration-150 focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)]"
        />
        {onToggleShow && (
          <button
            type="button"
            aria-label="Toggle passphrase visibility"
            onClick={onToggleShow}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-body"
          >
            <Icon name={show ? "eyeOff" : "eye"} size={14} />
          </button>
        )}
      </div>
      {hint && <span className="block mt-1 text-[11px] text-err">{hint}</span>}
    </label>
  );
}

function StrengthMeter({ pw }) {
  const { score, label } = passphraseStrength(pw);
  if (!pw) return null;
  const tone = score <= 1 ? "var(--err)" : score === 2 ? "var(--accent-2)" : "var(--ok)";
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${i < score ? "" : "bg-deep"}`}
            style={
              i < score
                ? { background: tone, transition: "background 200ms var(--ease-out)" }
                : { boxShadow: "var(--neu-inset-sm)" }
            }
          />
        ))}
      </div>
      <span className="text-[10.5px] font-medium" style={{ color: tone }}>{label}</span>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-dim">{label}</span>
      <span className="font-mono font-semibold text-hi">{value}</span>
    </div>
  );
}

function ExportBackupModal({ onClose }) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [includeKeys, setIncludeKeys] = useState(false);
  const [busy, setBusy] = useState(false);

  const strength = passphraseStrength(pass);
  const mismatch = confirm.length > 0 && confirm !== pass;
  const canCreate = strength.ok && pass === confirm && !busy;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const text = await createBackupFile({ passphrase: pass, includeKeys });
      downloadTextFile(text, defaultBackupFilename());
      toast.success("Backup created", {
        description: includeKeys ? "Encrypted .kpbak saved — includes API keys." : "Encrypted .kpbak saved.",
      });
      onClose();
    } catch (e) {
      toast.error("Backup failed", { description: e.message });
      setBusy(false);
    }
  };

  return (
    <NeuModal
      open
      onClose={onClose}
      title="Create encrypted backup"
      width={480}
      footer={
        <>
          <NeuButton variant="ghost" onClick={onClose}>Cancel</NeuButton>
          <NeuButton variant="accent" icon="shield" loading={busy} disabled={!canCreate} onClick={create}>
            Create backup
          </NeuButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-dim leading-relaxed">
          Your data is encrypted with a passphrase using AES-256. The file can't be recovered if you forget it — keep it somewhere safe.
        </p>
        <div>
          <PassField
            label="Passphrase"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            show={show}
            onToggleShow={() => setShow((s) => !s)}
            placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
          />
          <StrengthMeter pw={pass} />
        </div>
        <PassField
          label="Confirm passphrase"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          show={show}
          placeholder="Re-enter passphrase"
          hint={mismatch ? "Passphrases don't match" : undefined}
        />
        <div className="neu-raised-sm rounded-sm p-3.5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[12.5px] font-semibold text-hi">Include API keys</p>
            <p className="text-[11px] text-faint mt-0.5">Off by default. Only for a private, personal backup.</p>
          </div>
          <NeuToggle checked={includeKeys} onChange={setIncludeKeys} />
        </div>
        {includeKeys && (
          <div className="flex items-start gap-2 text-[11.5px] text-err">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
            <span>Anyone with this file and the passphrase can use your API keys.</span>
          </div>
        )}
      </div>
    </NeuModal>
  );
}

function ImportBackupModal({ onClose }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [payload, setPayload] = useState(null);
  const [restoreKeys, setRestoreKeys] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    try {
      const text = await file.text();
      setFileName(file.name);
      setFileText(text);
      setPayload(null);
      setConfirmed(false);
      setRestoreKeys(false);
    } catch {
      toast.error("Couldn't read that file");
    }
  };

  const decrypt = async () => {
    if (!fileText || !pass || busy) return;
    setBusy(true);
    try {
      setPayload(await decodeBackupFile(fileText, pass));
    } catch (err) {
      toast.error("Couldn't open backup", { description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!payload || !confirmed || busy) return;
    setBusy(true);
    try {
      await restorePayload(payload, { restoreKeys });
      toast.success("Backup restored", { description: "Reloading…" });
      setTimeout(() => window.location.reload(), 650);
    } catch (err) {
      toast.error("Restore failed", { description: err.message });
      setBusy(false);
    }
  };

  const sum = payload ? summarizePayload(payload) : null;
  const hasKeys = payload ? backupHasKeys(payload) : false;

  return (
    <NeuModal
      open
      onClose={onClose}
      title="Restore from backup"
      width={480}
      footer={
        payload ? (
          <>
            <NeuButton variant="ghost" onClick={onClose}>Cancel</NeuButton>
            <NeuButton variant="accent" icon="refresh" loading={busy} disabled={!confirmed || busy} onClick={restore}>
              Restore &amp; reload
            </NeuButton>
          </>
        ) : (
          <>
            <NeuButton variant="ghost" onClick={onClose}>Cancel</NeuButton>
            <NeuButton variant="accent" icon="key" loading={busy} disabled={!fileText || !pass || busy} onClick={decrypt}>
              Decrypt &amp; preview
            </NeuButton>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <input ref={fileRef} type="file" accept=".kpbak,application/json" className="hidden" onChange={onFile} />
        {!payload ? (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="pressable neu-raised-sm rounded-sm p-4 flex items-center gap-3 text-left w-full"
            >
              <span className="w-9 h-9 rounded-sm bg-accent-soft text-accent flex items-center justify-center shrink-0">
                <Icon name="file" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-hi truncate">{fileName || "Choose a .kpbak file"}</p>
                <p className="text-[11px] text-faint">{fileName ? "Tap to choose a different file" : "Select the backup file to restore"}</p>
              </div>
            </button>
            <PassField
              label="Passphrase"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              show={show}
              onToggleShow={() => setShow((s) => !s)}
              placeholder="Backup passphrase"
            />
          </>
        ) : (
          <>
            <div className="neu-raised-sm rounded-sm p-4">
              <p className="text-[11px] uppercase tracking-[0.15em] text-faint mb-2.5">Backup contents</p>
              <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[12px]">
                <SummaryRow label="Chats" value={sum.chats} />
                <SummaryRow label="Prompts" value={sum.prompts} />
                <SummaryRow label="Personas" value={sum.personas} />
                <SummaryRow label="Agent chats" value={sum.agentChats} />
              </div>
              {sum.createdAt && (
                <p className="text-[10.5px] text-faint mt-3">
                  Created {new Date(sum.createdAt).toLocaleString()}
                  {sum.appVersion ? ` · v${sum.appVersion}` : ""}
                </p>
              )}
            </div>
            {hasKeys && (
              <div className="neu-raised-sm rounded-sm p-3.5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12.5px] font-semibold text-hi">Also restore API keys</p>
                  <p className="text-[11px] text-faint mt-0.5">
                    Backup holds {sum.providerKeyCount} saved key{sum.providerKeyCount === 1 ? "" : "s"}.
                  </p>
                </div>
                <NeuToggle checked={restoreKeys} onChange={setRestoreKeys} />
              </div>
            )}
            <div className="flex items-start gap-2 text-[11.5px] text-err">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span>Restoring replaces all current chats, settings and data in this app. This can't be undone.</span>
            </div>
            <button type="button" onClick={() => setConfirmed((c) => !c)} className="flex items-center gap-2.5 text-left">
              <span
                className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center shrink-0"
                style={
                  confirmed
                    ? { background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }
                    : { background: "var(--surface)", boxShadow: "var(--neu-inset-sm)" }
                }
              >
                {confirmed && <Icon name="check" size={12} className="text-accent-ink" />}
              </span>
              <span className="text-[12px] text-body">I understand this will overwrite my current data.</span>
            </button>
          </>
        )}
      </div>
    </NeuModal>
  );
}

function BackupTab() {
  const [mode, setMode] = useState(null); // null | "export" | "import"

  if (!isCryptoAvailable()) {
    return (
      <EmptyState
        icon="shield"
        title="Encryption unavailable"
        hint="Secure backup needs the Web Crypto API, which isn't available in this environment."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="neu-raised-sm rounded-sm p-5">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-10 h-10 rounded-sm bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <Icon name="shield" size={20} />
          </span>
          <div>
            <p className="text-[13.5px] font-semibold text-hi">Encrypted backup</p>
            <p className="text-[11.5px] text-faint">Chats, prompts, personas and settings — saved to a locked .kpbak file.</p>
          </div>
        </div>
        <p className="text-[11.5px] text-dim leading-relaxed mt-2">
          Files are encrypted with AES-256 behind your passphrase. API keys are excluded unless you opt in, and refetchable caches are left out to keep files small.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="neu-raised-sm rounded-sm p-4 flex flex-col gap-3">
          <div>
            <p className="text-[12.5px] font-semibold text-hi flex items-center gap-1.5">
              <Icon name="download" size={15} className="text-accent" /> Export
            </p>
            <p className="text-[11px] text-faint mt-1">Create an encrypted snapshot to store or move to another machine.</p>
          </div>
          <NeuButton variant="accent" size="sm" icon="shield" className="self-start" onClick={() => setMode("export")}>
            Create backup…
          </NeuButton>
        </div>
        <div className="neu-raised-sm rounded-sm p-4 flex flex-col gap-3">
          <div>
            <p className="text-[12.5px] font-semibold text-hi flex items-center gap-1.5">
              <Icon name="refresh" size={15} className="text-accent" /> Import
            </p>
            <p className="text-[11px] text-faint mt-1">Restore from a .kpbak file. This overwrites everything currently in the app.</p>
          </div>
          <NeuButton variant="raised" size="sm" icon="file" className="self-start" onClick={() => setMode("import")}>
            Restore from backup…
          </NeuButton>
        </div>
      </div>

      {mode === "export" && <ExportBackupModal onClose={() => setMode(null)} />}
      {mode === "import" && <ImportBackupModal onClose={() => setMode(null)} />}
    </div>
  );
}

/* ── Screen ── */

export default function SettingsScreen() {
  const [tab, setTab] = useState("providers");
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[780px] mx-auto px-8 py-8">
        <SectionLabel>Settings</SectionLabel>
        <h1 className="font-display font-bold text-[24px] text-hi mt-1 mb-6">Make it yours</h1>
        <Segmented value={tab} onChange={setTab} options={TABS} className="mb-6" />
        {tab === "providers" && (
          <div className="flex flex-col gap-3">
            {Object.keys(PROVIDER_META).map((id) => (
              <ProviderRow key={id} id={id} />
            ))}
          </div>
        )}
        {tab === "appearance" && <AppearanceTab />}
        {tab === "behavior" && <BehaviorTab />}
        {tab === "personas" && <PersonasTab />}
        {tab === "memory" && <MemoryTab />}
        {tab === "usage" && <UsageTab />}
        {tab === "backup" && <BackupTab />}
      </div>
    </div>
  );
}
