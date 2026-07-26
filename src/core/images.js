import { routeImageGen, isImageGenModel } from "../api/providerRouter";
import { createStore, generateId, readRaw, writeRaw } from "./store";
import { keysStore } from "./keys";
import { modelsStore } from "./models";
import { calculateCost, addLifetimeCost, addMonthlySpend } from "../utils/costTracker";
import { recordProviderUsage } from "../utils/usageTracker";

/* Image space — generation state + persisted gallery. */

const GALLERY_KEY = "kp_image_gallery";
const MAX_GALLERY = 48; // in-memory cap
const MAX_PERSISTED = 12; // dataURLs are heavy — persist only the newest few

function loadGallery() {
  const raw = readRaw(GALLERY_KEY, null);
  if (!Array.isArray(raw)) return [];
  return raw.filter((it) => it && typeof it.url === "string" && it.url.startsWith("data:"));
}

export const imagesStore = createStore({
  items: loadGallery(), // [{ id, prompt, url, modelId, modelName, provider, ts, cost }]
  busy: false,
  error: null,
  selectedId: readRaw("kp_image_model", null),
});

/** Persist the newest slice; on quota failure keep halving until it fits. */
function persistGallery(items) {
  let slice = items.slice(0, MAX_PERSISTED);
  while (slice.length > 0) {
    try {
      writeRaw(GALLERY_KEY, slice);
      return;
    } catch {
      slice = slice.slice(0, Math.floor(slice.length / 2));
    }
  }
  try {
    writeRaw(GALLERY_KEY, []);
  } catch {}
}

/** All image-generation models currently known (both providers, key or not). */
export function listImageModels() {
  return (modelsStore.get().models || []).filter((m) => isImageGenModel(m));
}

export function selectImageModel(id) {
  imagesStore.set({ selectedId: id, error: null });
  writeRaw("kp_image_model", id);
}

export function getSelectedImageModel() {
  const { selectedId } = imagesStore.get();
  const models = listImageModels();
  return models.find((m) => m.id === selectedId) || models[0] || null;
}

export function removeImage(id) {
  imagesStore.set((s) => {
    const items = s.items.filter((it) => it.id !== id);
    persistGallery(items);
    return { items };
  });
}

export function clearGallery() {
  imagesStore.set({ items: [] });
  persistGallery([]);
}

/** Generate one image with the selected model. Returns the gallery item or null. */
export async function generateImage(prompt) {
  const cleaned = String(prompt || "").trim();
  if (!cleaned) return null;
  const model = getSelectedImageModel();
  if (!model) {
    imagesStore.set({ error: "No image models available — add a provider API key in Settings." });
    return null;
  }
  const providers = keysStore.get().providers;
  if (!providers?.[model._provider]) {
    imagesStore.set({ error: `No API key for ${model._provider} — add it in Settings.` });
    return null;
  }

  imagesStore.set({ busy: true, error: null });
  try {
    const result = await routeImageGen(providers, model, cleaned);
    if (!result?.imageUrl) throw new Error(result?.text || "The model returned no image.");
    const usage = result?.usage || null;
    const cost = result?.cost ?? calculateCost(usage, model.pricing);
    recordProviderUsage(model._provider, usage || {}, cost || 0);
    if (cost > 0) {
      addLifetimeCost(cost);
      addMonthlySpend(cost);
    }
    const item = {
      id: generateId(),
      prompt: cleaned,
      url: result.imageUrl,
      modelId: model.id,
      modelName: model.name || model.id,
      provider: model._provider,
      ts: Date.now(),
      cost: cost || 0,
    };
    imagesStore.set((s) => {
      const items = [item, ...s.items].slice(0, MAX_GALLERY);
      persistGallery(items);
      return { items, busy: false };
    });
    return item;
  } catch (err) {
    imagesStore.set({ busy: false, error: String(err?.message || err) });
    return null;
  }
}
