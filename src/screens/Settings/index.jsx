import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore, generateId } from "../../core/store";
import { keysStore, setProviderKey, removeProviderKey, EMPTY_PROVIDERS } from "../../core/keys";
import { settingsStore, setSetting, resetSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "../../core/settings";
import { chatsStore, savePersona, deletePersona } from "../../core/chats";
import { memoryStore, saveMemory, resetMemory, approvePendingEntry, rejectPendingEntry, clearPendingEntries, queuePendingCandidates } from "../../core/memory";
import { MEMORY_CATEGORY_DEFS, extractMemoryFromImport } from "../../utils/userMemory";
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
import { themeStore, setTheme, switchSkin, setAccent, setBg, setSurface, resetColors } from "../../core/theme";
import { THEMES, ACCENT_PRESETS } from "../../design/themes";
import {
  educationStore,
  candidatesFor,
  eligibleFor,
  setPins,
  clearPins,
  JOBS,
  TIERS,
} from "../../core/education";
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
  NeuTooltip,
} from "../../ui/primitives";
import BrandIcon from "../../ui/BrandIcon";
import AppearanceSettings from "./Appearance";
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
import { getOcrConfig, setOcrConfig, ocrEndpointConfigured, DEFAULT_OCR_MODEL } from "../../core/ocr";
import { detectHardware, describeHardware, recommendOcrPolicy } from "../../utils/hardware";
import {
  localModelsStore,
  CATALOG,
  CATALOG_TAGS,
  modelFit,
  maxComfortableModelGB,
  hasLocalRuntime,
  refreshStatus,
  startRuntime,
  stopRuntime,
  pullModel,
  deleteModel,
  isInstalled,
  findInstalledVisionModel,
  wireLocalOCR,
  isLocalOCRActive,
} from "../../core/localModels";

const TABS = [
  { value: "providers", label: "Providers", icon: "key" },
  { value: "local", label: "Local Models", icon: "cpu" },
  { value: "appearance", label: "Appearance", icon: "wand" },
  { value: "behavior", label: "Behavior", icon: "settings" },
  { value: "study", label: "Study Routing", icon: "book" },
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
    <div className="neu-raised-sm rounded-sm p-4 flex items-center gap-3.5">
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
      {current ? (
        <NeuButton
          size="sm"
          variant="danger"
          icon="trash"
          aria-label={`Disconnect ${meta.label}`}
          className="w-9 px-0 shrink-0"
          onClick={async () => {
            await removeProviderKey(id);
            toast.info(`${meta.label} disconnected`);
            loadModels(keysStore.get().providers);
          }}
        />
      ) : (
        // Reserve the delete-button footprint so Save + input edges align across all rows
        <span aria-hidden="true" className="w-9 shrink-0" />
      )}
    </div>
  );
}

/* ── Local Models (bundled runtime) ── */

const LOCAL_TAG_LABEL = { chat: "Chat", code: "Code", vision: "Vision", reasoning: "Reasoning", embed: "Embed" };

function formatModelBytes(n) {
  const b = Number(n || 0);
  if (!b) return "";
  const gb = b / 1e9;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(b / 1e6)} MB`;
}

function LocalPullBar({ pull }) {
  if (!pull) return null;
  const pct = typeof pull.percent === "number" ? pull.percent : null;
  const err = pull.status === "error";
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded-full bg-deep [box-shadow:var(--neu-inset-sm)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${err ? "bg-err" : "bg-accent"} ${pct === null && !err ? "w-1/3 animate-pulse" : ""}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className={`mt-1 text-[10px] ${err ? "text-err" : "text-faint"}`}>
        {err
          ? pull.error || "Pull failed"
          : `${pull.status || "pulling"}${pct !== null ? ` · ${pct}%` : ""}`}
      </p>
    </div>
  );
}

function LocalModelsTab() {
  const st = useStore(localModelsStore);
  const supported = hasLocalRuntime();
  const [libQuery, setLibQuery] = useState("");
  const [libTag, setLibTag] = useState("all");
  const [hw, setHw] = useState(null);
  const rt = useStore(settingsStore).localRuntime;
  const patchRt = (patch) => setSetting("localRuntime", { ...rt, ...patch });

  useEffect(() => {
    if (supported) refreshStatus();
  }, [supported]);

  useEffect(() => {
    let alive = true;
    detectHardware().then((h) => { if (alive) setHw(h); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!supported) {
    return (
      <EmptyState
        icon="cpu"
        title="Local models need the desktop app"
        hint="Run KritakaPrajna as the installed desktop app to download and run models fully offline — no API key required."
      />
    );
  }

  const serving = st.status === "serving";

  // Library list: filtered by search + category, sorted best-fit-first then smallest-first.
  const libraryModels = (() => {
    const q = libQuery.trim().toLowerCase();
    const fitRank = { fits: 0, tight: 1, unknown: 2, heavy: 3 };
    return CATALOG.filter((c) => {
      if (libTag !== "all" && c.tag !== libTag) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        (c.note || "").toLowerCase().includes(q)
      );
    }).sort((a, b) => {
      const fa = fitRank[modelFit(a, hw).level] ?? 2;
      const fb = fitRank[modelFit(b, hw).level] ?? 2;
      if (fa !== fb) return fa - fb;
      return (a.sizeGB || 0) - (b.sizeGB || 0);
    });
  })();

  const toggleRuntime = async () => {
    if (serving) {
      await stopRuntime();
      toast.info("Local runtime stopped");
    } else {
      const res = await startRuntime();
      if (res?.ok) toast.success("Local runtime started");
      else toast.error("Couldn't start local runtime", { description: res?.error || "" });
    }
  };

  const onPull = async (name) => {
    const res = await pullModel(name);
    if (res?.ok) toast.success(`${name} ready`);
    else toast.error(`Failed to pull ${name}`, { description: res?.error || "" });
  };

  const onDelete = async (name) => {
    const res = await deleteModel(name);
    if (res?.ok) toast.info(`${name} removed`);
    else toast.error(`Failed to remove ${name}`, { description: res?.error || "" });
  };

  const badge = serving
    ? { tone: "ok", text: st.version ? `Serving · v${st.version}` : "Serving" }
    : st.status === "starting"
      ? { tone: "info", text: "Starting…" }
      : st.status === "error"
        ? { tone: "err", text: "Error" }
        : { tone: "neutral", text: "Stopped" };

  return (
    <div className="space-y-6">
      <div className="neu-raised-sm rounded-sm p-4">
        <div className="flex items-center gap-3.5 flex-wrap">
          <Icon name="cpu" size={22} className="text-accent" />
          <div className="flex-1 min-w-[180px]">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-hi">Local runtime</p>
              <NeuBadge tone={badge.tone}>{badge.text}</NeuBadge>
            </div>
            <p className="text-[10.5px] text-faint mt-0.5">
              {serving
                ? "Bundled engine is running. Local models appear in the model picker."
                : "Start the bundled engine to run models locally — offline and private."}
            </p>
          </div>
          <NeuButton
            size="sm"
            variant={serving ? "danger" : "accent"}
            icon={serving ? "stop" : "zap"}
            loading={st.busy}
            onClick={toggleRuntime}
          >
            {serving ? "Stop" : "Start"}
          </NeuButton>
          <NeuButton size="sm" variant="ghost" icon="refresh" onClick={() => refreshStatus()} />
        </div>
        {st.error && <p className="mt-2 text-[10.5px] text-err">{st.error}</p>}
      </div>

      <div>
        <SectionLabel>Installed models</SectionLabel>
        {st.modelsDir && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <p
              className="text-[10px] text-faint font-mono flex-1 min-w-[180px] truncate"
              title={st.modelsDir}
            >
              Stored in: {st.modelsDir}
            </p>
            <NeuButton
              size="sm"
              variant="ghost"
              icon="folder"
              onClick={() => window.electronAPI?.localOpenModelsDir?.()}
            >
              Open folder
            </NeuButton>
          </div>
        )}
        {st.installed.length === 0 ? (
          <p className="text-[11px] text-faint mt-2">
            {serving
              ? "No models installed yet — pull one below."
              : "Start the runtime to see installed models."}
          </p>
        ) : (
          <div className="space-y-2 mt-2">
            {st.installed.map((m) => (
              <div key={m.name} className="neu-raised-sm rounded-sm p-3 flex items-center gap-3 flex-wrap">
                <Icon name="cpu" size={15} className="text-dim" />
                <div className="flex-1 min-w-[160px]">
                  <p className="text-[12px] font-mono text-hi">{m.name}</p>
                  <p className="text-[10px] text-faint">
                    {[formatModelBytes(m.size), m.parameterSize, m.quantization]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <NeuButton size="sm" variant="danger" icon="trash" onClick={() => onDelete(m.name)} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionLabel>Runtime settings</SectionLabel>
        <p className="text-[10.5px] text-faint mt-1 mb-2">
          Advanced knobs, like the Ollama app. Default = let the runtime decide. Items marked ↻
          apply after the runtime restarts; GPU layers and CPU threads apply on the next message.
        </p>
        <div className="neu-raised-sm rounded-sm p-4 space-y-3">
          {[
            {
              label: "Context length ↻",
              value: String(rt.contextLength || 0),
              onChange: (v) => patchRt({ contextLength: Number(v) }),
              options: [
                { value: "0", label: "Default" },
                { value: "4096", label: "4k" },
                { value: "8192", label: "8k" },
                { value: "16384", label: "16k" },
                { value: "32768", label: "32k" },
              ],
            },
            {
              label: "Keep model loaded ↻",
              value: rt.keepAlive || "",
              onChange: (v) => patchRt({ keepAlive: v }),
              options: [
                { value: "", label: "Default" },
                { value: "5m", label: "5 min" },
                { value: "30m", label: "30 min" },
                { value: "-1", label: "Forever" },
              ],
            },
            {
              label: "KV cache quantization ↻",
              value: rt.kvCacheType || "",
              onChange: (v) => patchRt({ kvCacheType: v }),
              options: [
                { value: "", label: "Default" },
                { value: "f16", label: "f16" },
                { value: "q8_0", label: "q8_0" },
                { value: "q4_0", label: "q4_0" },
              ],
            },
            {
              label: "Flash attention ↻",
              value: rt.flashAttention === null || rt.flashAttention === undefined ? "" : rt.flashAttention ? "on" : "off",
              onChange: (v) => patchRt({ flashAttention: v === "" ? null : v === "on" }),
              options: [
                { value: "", label: "Default" },
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ],
            },
            {
              label: "Parallel requests ↻",
              value: String(rt.numParallel || 0),
              onChange: (v) => patchRt({ numParallel: Number(v) }),
              options: [
                { value: "0", label: "Default" },
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "4", label: "4" },
              ],
            },
            {
              label: "Max loaded models ↻",
              value: String(rt.maxLoadedModels || 0),
              onChange: (v) => patchRt({ maxLoadedModels: Number(v) }),
              options: [
                { value: "0", label: "Default" },
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
              ],
            },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11.5px] text-dim">{row.label}</p>
              <Segmented size="sm" value={row.value} onChange={row.onChange} options={row.options} />
            </div>
          ))}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <NeuInput
                label="GPU layers (num_gpu)"
                type="number"
                min="0"
                placeholder="auto"
                value={rt.numGpu ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  patchRt({ numGpu: v === "" ? null : Math.max(0, Math.floor(Number(v) || 0)) });
                }}
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <NeuInput
                label="CPU threads (num_thread)"
                type="number"
                min="0"
                placeholder="auto"
                value={rt.numThread || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  patchRt({ numThread: v === "" ? 0 : Math.max(0, Math.floor(Number(v) || 0)) });
                }}
              />
            </div>
          </div>
          {serving && (
            <p className="text-[10px] text-faint">
              ↻ settings apply after the runtime restarts — stop and start it above.
            </p>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>Model library</SectionLabel>
        <p className="text-[10.5px] text-faint mt-1 mb-2">
          Downloaded on demand. Vision models enable offline OCR.
          {hw && (
            <>
              {" "}Detected: <span className="text-dim">{describeHardware(hw)}</span>
              {maxComfortableModelGB(hw) > 0 &&
                ` — models up to ~${Math.max(1, Math.floor(maxComfortableModelGB(hw)))} GB download run comfortably.`}
            </>
          )}
        </p>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <input
            value={libQuery}
            onChange={(e) => setLibQuery(e.target.value)}
            placeholder="Search models…"
            className="flex-1 min-w-[160px] h-8 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[11.5px] text-hi placeholder:text-faint px-3 focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)]"
          />
          {["all", ...CATALOG_TAGS].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setLibTag(t)}
              className={`px-2.5 py-1 rounded-full text-[10.5px] font-semibold tracking-wide transition-colors ${
                libTag === t ? "bg-accent-soft text-accent" : "bg-surface-2 text-dim hover:text-hi"
              }`}
            >
              {t === "all" ? "All" : LOCAL_TAG_LABEL[t] || t}
            </button>
          ))}
        </div>
        <div className="space-y-4">
          {CATALOG_TAGS.map((tag) => {
            // Group the (already search/tag-filtered) library by category so the
            // list reads as Chat / Code / Vision / Reasoning / Embed sections
            // instead of one scrambled column. Empty groups are skipped.
            const group = libraryModels.filter((c) => c.tag === tag);
            if (group.length === 0) return null;
            return (
              <div key={tag}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-faint mb-1.5 pl-0.5">
                  {LOCAL_TAG_LABEL[tag] || tag}
                </p>
                <div className="space-y-2">
                  {group.map((c) => {
                    const installed = isInstalled(st.installed, c.name);
                    const pull = st.pulls[c.name];
                    const pulling = pull && pull.status !== "error" && pull.status !== "done";
                    return (
                      <div key={c.name} className="neu-raised-sm rounded-sm p-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex-1 min-w-[180px]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-[12px] font-semibold text-hi">{c.label}</p>
                              {(() => {
                                const fit = modelFit(c, hw);
                                if (fit.level === "unknown") return null;
                                const tone =
                                  fit.level === "fits" ? "ok" : fit.level === "tight" ? "info" : "err";
                                return <NeuBadge tone={tone}>{fit.label}</NeuBadge>;
                              })()}
                              <span className="text-[10px] font-mono text-faint">{c.name}</span>
                            </div>
                            <p className="text-[10.5px] text-faint mt-0.5">
                              {c.note} · {c.size}
                            </p>
                          </div>
                          {installed ? (
                            <NeuBadge tone="ok">Installed</NeuBadge>
                          ) : (
                            <NeuButton
                              size="sm"
                              variant="raised"
                              icon="download"
                              loading={pulling}
                              disabled={!serving || pulling}
                              onClick={() => onPull(c.name)}
                            >
                              {pulling ? "Pulling" : "Pull"}
                            </NeuButton>
                          )}
                        </div>
                        {pull && !installed && <LocalPullBar pull={pull} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {libraryModels.length === 0 && (
            <p className="text-[11px] text-faint">No models match your search.</p>
          )}
        </div>
        {!serving && <p className="text-[10px] text-faint mt-2">Start the runtime to pull models.</p>}
      </div>
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
  const importInputRef = useRef(null);

  const handleExport = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      preferences: memory.preferences || [],
      coding: memory.coding || [],
      context: memory.context || [],
      autoMode: memory.autoMode !== false,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kritaka-memory.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Memory exported");
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const candidates = [];
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* not JSON — treat as plain text */ }
      if (parsed && typeof parsed === "object") {
        for (const def of MEMORY_CATEGORY_DEFS) {
          const list = Array.isArray(parsed[def.id]) ? parsed[def.id] : [];
          for (const entry of list) {
            if (typeof entry === "string") candidates.push({ category: def.id, text: entry, source: "import" });
          }
        }
      } else {
        const extracted = extractMemoryFromImport(text);
        for (const def of MEMORY_CATEGORY_DEFS) {
          for (const entry of extracted[def.id] || []) {
            candidates.push({ category: def.id, text: entry, source: "import" });
          }
        }
      }
      if (candidates.length === 0) {
        toast.info("No memory entries found in that file");
        return;
      }
      const added = queuePendingCandidates(candidates);
      if (added > 0) toast.success(`${added} suggestion${added === 1 ? "" : "s"} queued for review`);
      else toast.info("Nothing new to import — entries already saved");
    } catch (err) {
      toast.error("Import failed", { description: err?.message || "Could not read file" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="neu-raised-sm rounded-sm p-4 flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-hi">Auto-capture memory</p>
          <p className="text-[11px] text-faint">Learn preferences from your conversations automatically.</p>
        </div>
        <NeuToggle checked={!!memory.autoMode} onChange={(v) => saveMemory({ ...memory, autoMode: v })} />
      </div>
      <div className="neu-raised-sm rounded-sm p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-semibold text-hi">Backup</p>
          <p className="text-[10.5px] text-faint">Export saved memory as JSON, or import from a JSON/text file (imported entries go to review).</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <NeuButton size="sm" onClick={handleExport}>
            <Icon name="download" size={12} /> Export
          </NeuButton>
          <NeuButton size="sm" onClick={() => importInputRef.current?.click()}>
            <Icon name="refresh" size={12} /> Import
          </NeuButton>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.txt,.md,application/json,text/plain"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>
      {(memory.pending || []).length > 0 && (
        <div className="neu-raised-sm rounded-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-[12.5px] font-semibold text-hi">Suggested memories</p>
              <p className="text-[10.5px] text-faint">AI-suggested facts awaiting your review — nothing is saved until you approve it.</p>
            </div>
            <div className="flex items-center gap-2">
              <NeuBadge>{memory.pending.length}</NeuBadge>
              <button
                type="button"
                className="text-[10.5px] text-faint hover:text-err"
                onClick={() => { clearPendingEntries(); toast.info("Suggestions dismissed"); }}
              >
                Dismiss all
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {memory.pending.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-xs bg-deep [box-shadow:var(--neu-inset-sm)] px-3 py-2">
                <span className="text-[9.5px] uppercase tracking-wide text-faint shrink-0 w-[72px]">
                  {(MEMORY_CATEGORY_DEFS.find((d) => d.id === item.category) || {}).label || item.category}
                </span>
                <span className="flex-1 text-[12px] text-body break-words">{item.text}</span>
                <button
                  type="button"
                  aria-label="Approve suggestion"
                  onClick={() => { approvePendingEntry(item.id); toast.success("Memory saved"); }}
                  className="text-faint hover:text-ok shrink-0"
                >
                  <Icon name="check" size={13} />
                </button>
                <button
                  type="button"
                  aria-label="Reject suggestion"
                  onClick={() => rejectPendingEntry(item.id)}
                  className="text-faint hover:text-err shrink-0"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
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

function OcrSettings() {
  const [cfg, setCfg] = useState(() => getOcrConfig());
  const [hw, setHw] = useState(null);

  useEffect(() => {
    let alive = true;
    detectHardware().then((h) => { if (alive) setHw(h); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const hasEndpoint = ocrEndpointConfigured(cfg);
  const useModel = cfg.mode !== "simple"; // ON = local model (auto/endpoint); OFF = Tesseract
  const policy = hw ? recommendOcrPolicy(hw) : null;
  const localVision = hasLocalRuntime() ? findInstalledVisionModel() : "";
  const localActive = isLocalOCRActive(cfg);

  const update = (patch) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      setOcrConfig(next);
      return next;
    });
  };

  return (
    <div className="neu-raised-sm rounded-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12.5px] font-semibold text-hi">Text extraction (OCR)</p>
        <NeuToggle checked={useModel} onChange={(v) => update({ mode: v ? "auto" : "simple" })} />
      </div>
      <p className="text-[11.5px] text-dim mb-3 leading-relaxed">
        {useModel
          ? hasEndpoint
            ? "Using the local OCR model when its endpoint is reachable; falls back to the built-in engine if not."
            : "Set the endpoint below to use the local OCR model. Until then, the built-in engine (Tesseract) is used."
          : "Using the built-in engine (Tesseract) only. Turn on to prefer the local OCR model once its endpoint is set."}
      </p>

      {hw && (
        <div className="flex items-start gap-2 mb-3 text-[11px] text-faint">
          <Icon name="info" size={12} className="mt-0.5 shrink-0" />
          <span>
            {describeHardware(hw)} —{" "}
            {policy?.localOffer === "one-tap"
              ? "capable of running the local model."
              : policy?.localOffer === "offer-with-warning"
                ? "may run the local model, but could be slow."
                : "the local GPU model is unlikely to run well here; the built-in engine is recommended."}
          </span>
        </div>
      )}

      {useModel && (
        <div className="flex flex-col gap-2.5">
          {localActive ? (
            <div className="flex items-start gap-2 text-[11px] text-accent">
              <Icon name="check" size={12} className="mt-0.5 shrink-0" />
              <span>Using local vision model ({cfg.model}) via the bundled runtime — fully offline.</span>
            </div>
          ) : localVision ? (
            <button
              type="button"
              onClick={() => {
                const r = wireLocalOCR(localVision);
                if (r.ok) { setCfg(getOcrConfig()); toast.success(`OCR now uses local ${r.model}`); }
                else toast.error(r.error || "Could not enable local OCR");
              }}
              className="neu-raised-sm rounded-sm px-3 py-2 text-[11.5px] text-accent text-left"
            >
              Use local vision model ({localVision}) — runs OCR fully offline
            </button>
          ) : null}
          <NeuInput
            label="Endpoint URL"
            value={cfg.url}
            onChange={(e) => update({ url: e.target.value })}
            placeholder="http://localhost:10000/v1"
          />
          <NeuInput
            label="Model name"
            value={cfg.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder={DEFAULT_OCR_MODEL}
          />
          <NeuInput
            label="API key (optional)"
            value={cfg.key}
            onChange={(e) => update({ key: e.target.value })}
            placeholder="Bearer token, if required"
          />
        </div>
      )}
    </div>
  );
}

/* ── Study routing ──────────────────────────────────────────────────────────
   The Education Hub routes each job to the best model it can find in the tier
   you picked. This is where you overrule it. Pins lead the chain; the auto
   picks stay behind them, because a pinned free endpoint that rate-limits must
   not take the whole run down with it.
   ───────────────────────────────────────────────────────────────────────── */

function JobRouting({ tier, job }) {
  const { pins } = useStore(educationStore, (s) => ({ pins: s.pins }));
  const { models } = useStore(modelsStore, (s) => ({ models: s.models }));
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  const pinned = pins[`${tier}:${job}`] || [];
  const meta = JOBS[job];

  // candidatesFor/eligibleFor read the stores directly; pinned + models are here
  // as the change triggers, not as arguments.
  const chain = useMemo(() => candidatesFor(job, tier), [job, tier, pinned, models]);
  const eligible = useMemo(() => eligibleFor(job, tier), [job, tier, models]);
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return eligible
      .filter((m) => !pinned.includes(m.id))
      .filter((m) => !needle || `${m.id} ${m.name || ""}`.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [eligible, pinned, q]);

  const move = (i, d) => {
    const next = [...pinned];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setPins(tier, job, next);
  };

  return (
    <div className="neu-raised-sm rounded-sm p-4">
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-[12.5px] font-semibold text-hi">{meta.label}</p>
        <div className="flex items-center gap-2">
          {meta.vision && <NeuBadge tone="info">needs vision</NeuBadge>}
          {pinned.length > 0 && (
            <NeuButton size="sm" variant="ghost" onClick={() => setPins(tier, job, [])}>
              Use automatic
            </NeuButton>
          )}
        </div>
      </div>
      <p className="text-[11px] text-lo mb-3">
        {eligible.length} model{eligible.length === 1 ? "" : "s"} qualify in this tier
      </p>

      {pinned.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {pinned.map((id, i) => {
            const m = byId.get(id);
            return (
              <div key={id} className="flex items-center gap-2 neu-inset rounded-sm px-2.5 py-1.5">
                <span className="text-[10px] font-mono text-lo w-4 shrink-0">{i + 1}</span>
                <span className={`text-[11.5px] truncate flex-1 ${m ? "text-hi" : "text-lo line-through"}`}>
                  {m ? modelDisplayName(m) : id}
                </span>
                {!m && <NeuBadge tone="err">not available</NeuBadge>}
                <IconButton
                  name="chevronDown"
                  size={13}
                  label="Move up"
                  className="rotate-180 shrink-0"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                />
                <IconButton
                  name="chevronDown"
                  size={13}
                  label="Move down"
                  className="shrink-0"
                  disabled={i === pinned.length - 1}
                  onClick={() => move(i, 1)}
                />
                <IconButton
                  name="close"
                  size={13}
                  label="Unpin"
                  className="shrink-0"
                  onClick={() => setPins(tier, job, pinned.filter((x) => x !== id))}
                />
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="flex flex-col gap-2">
          <NeuInput
            autoFocus
            value={q}
            placeholder="Search this tier…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setAdding(false), setQ(""))}
          />
          <div className="max-h-[240px] overflow-y-auto flex flex-col gap-1 pr-1">
            {options.length === 0 && (
              <p className="text-[11px] text-lo px-1 py-2">
                {eligible.length === 0
                  ? "No model in this tier clears the fitness bar yet — connect a provider, or try another tier."
                  : "Nothing matches."}
              </p>
            )}
            {options.map((m) => (
              <button
                key={m.id}
                type="button"
                className="neu-raised-sm rounded-sm px-2.5 py-2 text-left hover:brightness-110 transition"
                onClick={() => {
                  setPins(tier, job, [...pinned, m.id]);
                  setQ("");
                  setAdding(false);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-hi truncate flex-1">{modelDisplayName(m)}</span>
                  <span className="text-[10px] font-mono text-lo shrink-0">{Math.round(m._eduScore)}</span>
                </div>
                {m._eduWhy && <p className="text-[10.5px] text-lo mt-0.5 truncate">{m._eduWhy}</p>}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <NeuButton size="sm" variant="ghost" icon="pin" onClick={() => setAdding(true)}>
            Pin a model
          </NeuButton>
          <p className="text-[11px] text-lo truncate flex-1 min-w-[140px]">
            {chain.length
              ? `Runs: ${chain.slice(0, 3).map(modelDisplayName).join(" → ")}${chain.length > 3 ? ` → +${chain.length - 3}` : ""}`
              : "Nothing available — connect a provider."}
          </p>
        </div>
      )}
    </div>
  );
}

function StudyRoutingTab() {
  const { tier } = useStore(educationStore, (s) => ({ tier: s.tier }));
  const [view, setView] = useState(tier);
  const { pins } = useStore(educationStore, (s) => ({ pins: s.pins }));
  const pinCount = Object.values(pins).reduce((n, v) => n + (v?.length || 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="neu-raised-sm rounded-sm p-4">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div>
            <p className="text-[12.5px] font-semibold text-hi">Which models run the Education Hub</p>
            <p className="text-[11px] text-lo mt-0.5">
              Each tier picks its own models automatically. Pin one to put it first — the rest of the chain
              stays behind it as fallback.
            </p>
          </div>
          {pinCount > 0 && (
            <NeuButton size="sm" variant="ghost" onClick={() => { clearPins(); toast.info("All pins cleared"); }}>
              Clear all {pinCount}
            </NeuButton>
          )}
        </div>
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={TIERS.map((t) => ({ value: t.id, label: t.label }))}
        />
        <p className="text-[11px] text-lo mt-2">
          {TIERS.find((t) => t.id === view)?.hint}
          {view !== tier && " — not the tier the hub is set to right now"}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.keys(JOBS).map((job) => (
          <JobRouting key={`${view}:${job}`} tier={view} job={job} />
        ))}
      </div>
    </div>
  );
}

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

      <OcrSettings />

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
          <p className="text-[12.5px] font-semibold text-hi mb-2.5">On provider failure</p>
          <Segmented
            size="sm"
            value={s.failoverMode}
            onChange={(v) => setSetting("failoverMode", v)}
            options={[
              { value: "notify", label: "Notify" },
              { value: "silent", label: "Silent" },
              { value: "never", label: "Never" },
            ]}
          />
          <p className="text-[11px] text-faint mt-2">
            {s.failoverMode === "never"
              ? "Show the error — never reroute to a different model."
              : s.failoverMode === "silent"
              ? "Reroute to a healthy, capable model automatically (no banner)."
              : "Reroute to a healthy, capable model and show which one answered."}
          </p>
        </div>
      </div>

      <div className="neu-raised-sm rounded-sm p-4">
        <p className="text-[12.5px] font-semibold text-hi mb-1">Conversation context</p>
        <p className="text-[11px] text-faint mb-3">
          How much of the conversation is sent back to the model each turn.
        </p>
        <Segmented
          size="sm"
          value={s.contextMode}
          onChange={(v) => setSetting("contextMode", v)}
          options={[
            { value: "full", label: "Full" },
            { value: "smart", label: "Smart" },
            { value: "fixed", label: "Fixed" },
          ]}
        />
        <p className="text-[11px] text-faint mt-2">
          {s.contextMode === "full"
            ? "Send the whole conversation, sized to the model's context window — most faithful, higher cost."
            : s.contextMode === "fixed"
            ? "Send only the most recent turns (fixed window) — cheapest, may forget earlier context."
            : "Compress and trim older turns to fit the window — balances memory and cost."}
        </p>

        <div className="flex items-center justify-between mt-4">
          <div className="pr-3">
            <p className="text-[12px] font-semibold text-hi">Keep files in context</p>
            <p className="text-[11px] text-faint mt-0.5">
              Never compress messages that carry an upload, so attachments stay readable the whole chat.
            </p>
          </div>
          <NeuToggle checked={s.keepFilesInContext} onChange={(v) => setSetting("keepFilesInContext", v)} />
        </div>

        {s.contextMode === "smart" && (
          <div className="mt-4">
            <p className="text-[12px] font-semibold text-hi mb-2">Compression strength</p>
            <Segmented
              size="sm"
              value={s.tokenMode}
              onChange={(v) => setSetting("tokenMode", v)}
              options={[
                { value: "off", label: "Off" },
                { value: "balanced", label: "Balanced" },
                { value: "aggressive", label: "Aggressive" },
              ]}
            />
          </div>
        )}
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
      <div className="max-w-[780px] mx-auto px-8 pt-8">
        <SectionLabel>Settings</SectionLabel>
        <h1 className="font-display font-bold text-[24px] text-hi mt-1 mb-6">Make it yours</h1>
      </div>
      {/* The tab bar gets the whole pane rather than the 780px reading column —
          nine tabs do not fit in the column, and a clipped tab reads as broken.
          Still scrollable for windows too narrow even for the full width. */}
      <div className="mb-6 px-8 overflow-x-auto">
        <div className="flex w-max min-w-full justify-center">
          <Segmented value={tab} onChange={setTab} options={TABS} size="sm" />
        </div>
      </div>
      {/* Appearance is a two-column editor and needs the width; the rest are
          single-column reading and stay in the narrow column. */}
      <div className={`${tab === "appearance" ? "max-w-[1460px]" : "max-w-[780px]"} mx-auto px-8 pb-8`}>
        {tab === "providers" && (
          <div className="flex flex-col gap-3">
            {/* Key-bearing providers only. The bundled local runtime has no key —
                it lives on its own tab. */}
            {Object.keys(EMPTY_PROVIDERS).map((id) => (
              <ProviderRow key={id} id={id} />
            ))}
          </div>
        )}
        {tab === "local" && <LocalModelsTab />}
        {tab === "appearance" && <AppearanceSettings />}
        {tab === "behavior" && <BehaviorTab />}
        {tab === "study" && <StudyRoutingTab />}
        {tab === "personas" && <PersonasTab />}
        {tab === "memory" && <MemoryTab />}
        {tab === "usage" && <UsageTab />}
        {tab === "backup" && <BackupTab />}
      </div>
    </div>
  );
}
