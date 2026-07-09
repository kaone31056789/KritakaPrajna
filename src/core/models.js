import { createStore, readRaw, writeRaw } from "./store";
import { fetchAllModels, findModelBySelection, toSelectionId } from "../api/providerRouter";
import { supportsTask } from "../utils/smartModelSelect";

/* Model catalog from all active providers + current selection. */

const LAST_MODEL_KEY = "openrouter_last_model";
const TASK_PREF_KEY = "openrouter_task_pref";

export const modelsStore = createStore({
  models: [],
  loading: false,
  error: "",
  selectedId: readRaw(LAST_MODEL_KEY, "") || "",
  task: readRaw(TASK_PREF_KEY, "general") || "general",
});

export async function loadModels(providers) {
  modelsStore.set({ loading: true, error: "" });
  try {
    const models = await fetchAllModels(providers);
    const { selectedId } = modelsStore.get();
    let nextSelected = selectedId;
    if (!findModelBySelection(models, selectedId)) {
      // Restore failed → pick a sensible default: first free-ish model, else first
      const free = models.find((m) => {
        const p = m.pricing || {};
        return Number(p.prompt || 0) === 0 && Number(p.completion || 0) === 0;
      });
      nextSelected = toSelectionId(free || models[0]) || "";
    }
    modelsStore.set({ models, loading: false, selectedId: nextSelected });
    if (nextSelected) writeRaw(LAST_MODEL_KEY, nextSelected);
    return models;
  } catch (err) {
    modelsStore.set({ loading: false, error: err?.message || "Failed to load models" });
    return [];
  }
}

export function selectModel(selectionId) {
  modelsStore.set({ selectedId: selectionId });
  writeRaw(LAST_MODEL_KEY, selectionId);
}

export function setTask(task) {
  modelsStore.set({ task });
  writeRaw(TASK_PREF_KEY, task);
}

export function getSelectedModel(state = modelsStore.get()) {
  return findModelBySelection(state.models, state.selectedId);
}

export function modelsForTask(state = modelsStore.get()) {
  const list = state.models.filter((m) => supportsTask(m, state.task));
  return list.length > 0 ? list : state.models;
}

export function modelDisplayName(model) {
  if (!model) return "";
  return model.name || model.id || "";
}

export function isFreeModel(model) {
  const p = model?.pricing || {};
  return Number(p.prompt || 0) === 0 && Number(p.completion || 0) === 0;
}

export function formatPrice(perToken) {
  const perM = Number(perToken || 0) * 1_000_000;
  if (perM === 0) return "free";
  if (perM < 0.01) return `<$0.01/M`;
  return `$${perM >= 10 ? perM.toFixed(0) : perM.toFixed(2)}/M`;
}

export function contextLabel(model) {
  const len = Number(model?.context_length || model?.top_provider?.context_length || 0);
  if (!len) return "";
  if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(1)}M ctx`;
  if (len >= 1000) return `${Math.round(len / 1000)}K ctx`;
  return `${len} ctx`;
}
