import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../../core/store";
import {
  imagesStore,
  listImageModels,
  selectImageModel,
  getSelectedImageModel,
  removeImage,
  clearGallery,
  generateImage,
} from "../../core/images";
import { modelsStore, modelDisplayName, isFreeModel } from "../../core/models";
import { keysStore } from "../../core/keys";
import { providerLabel } from "../../api/providerRouter";
import { setView } from "../../core/nav";
import { EASE_OUT, T_SLOW } from "../../design/motion";
import Icon from "../../ui/icons";
import { NeuButton, IconButton, SectionLabel, EmptyState, NeuBadge, NeuPopover, NeuTooltip } from "../../ui/primitives";
import { toast } from "../../ui/Toaster";
import BrandIcon from "../../ui/BrandIcon";

/* ═══ Image Studio — prompt → picture, with a persisted gallery ═══ */

function timeLabel(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return "just now";
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function downloadImage(item) {
  try {
    const a = document.createElement("a");
    const ext = /^data:image\/(\w+)/.exec(item.url)?.[1] || "png";
    a.href = item.url;
    a.download = `kritaka-${new Date(item.ts).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("Image saved");
  } catch {
    toast.error("Could not save image");
  }
}

/* ─── Model picker ─── */

function ModelPicker() {
  const { selectedId } = useStore(imagesStore, (s) => ({ selectedId: s.selectedId }));
  useStore(modelsStore, (s) => ({ n: (s.models || []).length })); // re-render when models load
  const [open, setOpen] = useState(false);
  const models = listImageModels();
  const current = getSelectedImageModel();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="neu-raised-sm rounded-lg px-3 h-9 flex items-center gap-2 text-[12.5px] font-medium text-body hover:text-hi transition-colors"
        title="Choose an image model"
      >
        {current ? (
          <>
            <BrandIcon model={current} size={15} />
            <span className="max-w-[220px] truncate">{modelDisplayName(current)}</span>
            {isFreeModel(current) && <NeuBadge tone="ok">Free</NeuBadge>}
          </>
        ) : (
          <span className="text-faint">No image models</span>
        )}
        <Icon name="chevronDown" size={13} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <NeuPopover open={open} onClose={() => setOpen(false)} anchor="bottom-end" width={320}>
        <div className="max-h-[320px] overflow-y-auto p-1.5">
          {models.length === 0 && (
            <p className="text-[12px] text-dim px-3 py-4 text-center">
              No image-generation models found. Add a provider API key in Settings.
            </p>
          )}
          {models.map((m) => {
            const active = m.id === (current?.id || null);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  selectImageModel(m.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
                  active ? "neu-inset text-hi" : "hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-body"
                }`}
              >
                <BrandIcon model={m} size={16} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-medium truncate">{modelDisplayName(m)}</span>
                  <span className="block text-[10.5px] text-faint">{providerLabel(m._provider)}</span>
                </span>
                {isFreeModel(m) && <NeuBadge tone="ok">Free</NeuBadge>}
                {active && <Icon name="check" size={14} className="text-accent shrink-0" />}
              </button>
            );
          })}
        </div>
      </NeuPopover>
    </div>
  );
}

/* ─── Gallery card ─── */

function GalleryCard({ item, onReuse }) {
  return (
    <motion.figure
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: T_SLOW, ease: EASE_OUT }}
      className="group neu-raised rounded-xl overflow-hidden flex flex-col"
    >
      <div className="relative bg-[var(--surface-2,rgba(0,0,0,0.06))]">
        <img src={item.url} alt={item.prompt} loading="lazy" className="w-full aspect-square object-cover block" />
        <div className="absolute inset-x-0 bottom-0 p-2 flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/55 to-transparent">
          <NeuTooltip label="Save image">
            <IconButton name="download" size={14} onClick={() => downloadImage(item)} label="Save image" />
          </NeuTooltip>
          <NeuTooltip label="Reuse prompt">
            <IconButton name="refresh" size={14} onClick={() => onReuse(item.prompt)} label="Reuse prompt" />
          </NeuTooltip>
          <NeuTooltip label="Copy prompt">
            <IconButton
              name="copy"
              size={14}
              onClick={() => {
                navigator.clipboard?.writeText(item.prompt);
                toast.success("Prompt copied");
              }}
              label="Copy prompt"
            />
          </NeuTooltip>
          <NeuTooltip label="Delete">
            <IconButton name="trash" size={14} onClick={() => removeImage(item.id)} label="Delete image" />
          </NeuTooltip>
        </div>
      </div>
      <figcaption className="px-3 py-2.5">
        <p className="text-[12px] text-body leading-snug line-clamp-2" title={item.prompt}>
          {item.prompt}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-faint">
          <span className="truncate">{item.modelName}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{timeLabel(item.ts)}</span>
          {item.cost > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0">${item.cost.toFixed(4)}</span>
            </>
          )}
        </p>
      </figcaption>
    </motion.figure>
  );
}

/* ─── Screen ─── */

export default function ImagesScreen() {
  const { items, busy, error } = useStore(imagesStore, (s) => ({ items: s.items, busy: s.busy, error: s.error }));
  const { providers } = useStore(keysStore, (s) => ({ providers: s.providers }));
  const [prompt, setPrompt] = useState("");
  const taRef = useRef(null);
  const hasKey = Object.values(providers || {}).some(Boolean);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const run = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    const item = await generateImage(text);
    if (item) setPrompt("");
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      run();
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-6 pt-5 pb-4 flex items-end justify-between gap-4">
        <div>
          <SectionLabel>Image Studio</SectionLabel>
          <h1 className="font-display font-semibold text-[19px] text-hi mt-1">Bring an idea to life</h1>
        </div>
        <div className="flex items-center gap-2">
          <ModelPicker />
          {items.length > 0 && (
            <NeuTooltip label="Clear gallery">
              <IconButton
                name="trash"
                onClick={() => {
                  clearGallery();
                  toast.success("Gallery cleared");
                }}
                label="Clear gallery"
              />
            </NeuTooltip>
          )}
        </div>
      </header>

      {/* Prompt bar */}
      <div className="shrink-0 px-6 pb-4">
        <div className="neu-inset rounded-xl p-3 flex items-end gap-3">
          <textarea
            ref={taRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Describe the image you want — subject, style, lighting, mood…"
            className="flex-1 bg-transparent resize-none outline-none text-[13.5px] text-hi placeholder:text-faint leading-relaxed max-h-[120px]"
            disabled={busy}
          />
          <NeuButton variant="accent" icon="wand" loading={busy} onClick={run} disabled={!prompt.trim()} className="shrink-0">
            {busy ? "Generating…" : "Generate"}
          </NeuButton>
        </div>
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="mt-2 text-[12px] text-err flex items-center gap-1.5"
              role="alert"
            >
              <Icon name="alert" size={13} className="shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Gallery */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        {items.length === 0 ? (
          <EmptyState
            icon="image"
            title={busy ? "Painting pixels…" : "Nothing here yet"}
            hint={
              hasKey
                ? "Generated images land here. They stay on this device — the newest dozen survive a restart."
                : "Add a provider API key in Settings, then pick an image model and describe what you want to see."
            }
            action={
              !hasKey && (
                <NeuButton icon="key" onClick={() => setView("settings")}>
                  Open Settings
                </NeuButton>
              )
            }
          />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            <AnimatePresence initial={false}>
              {items.map((it) => (
                <GalleryCard key={it.id} item={it} onReuse={(p) => { setPrompt(p); taRef.current?.focus(); }} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
