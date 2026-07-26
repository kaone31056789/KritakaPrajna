/**
 * providerRouter.js
 *
 * Aggregates models from all active providers and routes streaming requests
 * to the correct provider API. Each model object carries a `_provider` field
 * that determines which API client handles the call.
 *
 * Provider keys shape:  { openrouter, openai, anthropic, huggingface, ollama, nvidia }
 * Each value is a provider credential/config string (API key or endpoint) or null/undefined.
 */

import { fetchModels as fetchOpenRouterModels, streamMessage as streamOpenRouter, fetchCredits, generateImage as generateImageOR, IMAGE_GEN_MODELS as OR_IMAGE_MODELS } from "./openrouter";
import { fetchModels as fetchOpenAIModels, streamMessage as streamOpenAI } from "./openai";
import { fetchModels as fetchAnthropicModels, streamMessage as streamAnthropic } from "./anthropic";
import { fetchModels as fetchHFModels, streamMessage as streamHF, generateImage as generateImageHF, IMAGE_GEN_MODELS as HF_IMAGE_MODELS } from "./huggingface";
import { fetchModels as fetchOllamaModels, streamMessage as streamOllama } from "./ollama";
import { fetchModels as fetchNvidiaModels, streamMessage as streamNvidia } from "./nvidia";
import { supportsVision } from "../utils/smartModelSelect";
import { isModelUnavailable } from "../utils/rateLimiter";

export { fetchCredits };

// ── Bundled local runtime (Electron-managed Ollama on loopback) ──────────────

const LOCAL_RUNTIME_URL = "http://127.0.0.1:11434";

/** True when the value already points at a local/loopback endpoint. */
function isLocalUrlValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)([:/]|$)/i.test(raw);
}

/** True when running inside Electron with the local runtime bridge exposed. */
function hasLocalRuntimeBridge() {
  try {
    return typeof window !== "undefined" && !!window.electronAPI?.localStatus;
  } catch {
    return false;
  }
}

export function toSelectionId(model) {
  if (!model) return "";
  return model._selectionId || `${model._provider || "openrouter"}::${model.id}`;
}

export function withSelectionMeta(model) {
  if (!model) return model;
  return { ...model, _selectionId: toSelectionId(model) };
}

export function findModelBySelection(models, selectionId) {
  return models.find((m) => m._selectionId === selectionId || m.id === selectionId) || null;
}

// ── Provider metadata ────────────────────────────────────────────────────────

export const PROVIDER_META = {
  openrouter:  { label: "OpenRouter",       color: "#7c6ff7", hasSuggestions: true  },
  openai:      { label: "OpenAI API",       color: "#10a37f", hasSuggestions: false },
  anthropic:   { label: "Anthropic API",    color: "#c96442", hasSuggestions: false },
  huggingface: { label: "HuggingFace",      color: "#f5a623", hasSuggestions: true  },
  ollama:      { label: "Ollama",           color: "#22c55e", hasSuggestions: true  },
  nvidia:      { label: "Nvidia NIM",       color: "#76b900", hasSuggestions: false },
  local:       { label: "Local",            color: "#38bdf8", hasSuggestions: false },
};

export function providerLabel(provider) {
  return PROVIDER_META[provider]?.label || provider;
}

export function hasSuggestions(provider) {
  return PROVIDER_META[provider]?.hasSuggestions ?? false;
}

function inferImageOutputCapability(model) {
  const modality = String(model?.architecture?.modality || "").toLowerCase();
  const outputs = Array.isArray(model?.architecture?.output_modalities)
    ? model.architecture.output_modalities.map((m) => String(m).toLowerCase())
    : [];
  return outputs.includes("image") || modality.includes("->image");
}

// ── Fetch models from all active providers ───────────────────────────────────

/**
 * Fetch and merge models from every provider that has a key.
 * Each model gets a `_provider` tag so the router knows which API to call.
 *
 * @param {object} providerKeys - { openrouter, openai, anthropic, huggingface, ollama, nvidia }
 * @returns {Promise<Array>} Flat array of model objects with `_provider` set
 */
export async function fetchAllModels(providerKeys) {
  const providerOrder = ["openrouter", "openai", "anthropic", "huggingface", "ollama", "nvidia", "local"];
  const results = await Promise.allSettled([
    providerKeys?.openrouter
      ? fetchOpenRouterModels(providerKeys.openrouter).then((ms) =>
          ms.map((m) => ({
            ...m,
            _provider: "openrouter",
            _isImageGen: !!m._isImageGen || inferImageOutputCapability(m),
          }))
        )
      : Promise.resolve([]),
    providerKeys?.openai      ? fetchOpenAIModels(providerKeys.openai)                                                                       : Promise.resolve([]),
    providerKeys?.anthropic   ? fetchAnthropicModels(providerKeys.anthropic)                                                                 : Promise.resolve([]),
    // HuggingFace: always fetch — the Hub catalog is public and fetchHFModels
    // falls back to a curated free list, so models show even before a key is set.
    fetchHFModels(providerKeys?.huggingface || ""),
    providerKeys?.ollama      ? fetchOllamaModels(providerKeys.ollama)                                                                       : Promise.resolve([]),
    providerKeys?.nvidia      ? fetchNvidiaModels(providerKeys.nvidia)                                                                       : Promise.resolve([]),
    // Bundled local runtime: always merged when running under Electron, unless
    // the Ollama slot already points at a local URL (avoids duplicate entries).
    hasLocalRuntimeBridge() && !isLocalUrlValue(providerKeys?.ollama)
      ? fetchOllamaModels(LOCAL_RUNTIME_URL)
          .then((ms) =>
            ms
              .filter((m) => !m._isImageGen)
              .map((m) => ({ ...m, _provider: "local", _isLocal: true }))
          )
          .catch(() => []) // runtime not serving — nothing to merge
      : Promise.resolve([]),
  ]);

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const provider = providerOrder[index] || `provider-${index}`;
      console.warn(`[${provider}] model fetch failed`, result.reason);
    }
  });

  const chatModels = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .map(withSelectionMeta);

  // Append image and video generation models for active providers
  const imageModels = [
    ...(providerKeys?.openrouter ? OR_IMAGE_MODELS : []),
    ...HF_IMAGE_MODELS,
  ].map(withSelectionMeta);

  // De-duplicate by selection id so image model metadata wins when ids overlap.
  const mergedBySelection = new Map();

  for (const model of chatModels) {
    mergedBySelection.set(model._selectionId, model);
  }

  for (const model of imageModels) {
    const existing = mergedBySelection.get(model._selectionId);
    mergedBySelection.set(
      model._selectionId,
      existing ? { ...existing, ...model } : model
    );
  }

  return Array.from(mergedBySelection.values());
}

/** Returns true if the model is an image generation model */
export function isImageGenModel(model) {
  return !!model?._isImageGen;
}

/** Generate an image — routes to the correct provider */
export async function routeImageGen(providerKeys, model, prompt) {
  const provider = model?._provider || "openrouter";
  const key = providerKeys?.[provider];
  if (!key) throw new Error(`No API key configured for ${providerLabel(provider)}.`);
  switch (provider) {
    case "openrouter":  return generateImageOR(key, model.id, prompt);
    case "huggingface": return generateImageHF(key, model.id, prompt);
    default: throw new Error(`Image generation not supported for ${provider}`);
  }
}

// ── Stream routing ───────────────────────────────────────────────────────────

/**
 * Route a streaming chat request to the right provider based on model._provider.
 *
 * @param {object} providerKeys - All provider keys
 * @param {object} model        - Model object (must have `_provider` and `id`)
 * @param {Array}  messages     - Chat messages array
 * @param {object} opts         - { onChunk, signal }
 * @returns {Promise<{text: string, usage: object|null}>}
 */
export async function routeStream(providerKeys, model, messages, opts = {}) {
  const provider = model?._provider || "openrouter";
  // Local models always stream against the bundled loopback runtime — no key needed.
  const key = provider === "local" ? LOCAL_RUNTIME_URL : providerKeys?.[provider];

  if (!key) {
    throw new Error(`No API key configured for ${providerLabel(provider)}.`);
  }

  switch (provider) {
    case "openrouter":  return streamOpenRouter(key, model.id, messages, opts);
    case "openai":      return streamOpenAI(key, model.id, messages, opts);
    case "anthropic":   return streamAnthropic(key, model.id, messages, opts);
    case "huggingface": return streamHF(key, model.id, messages, opts);
    case "ollama":      return streamOllama(key, model.id, messages, opts);
    case "local":       return streamOllama(LOCAL_RUNTIME_URL, model.id, messages, opts);
    case "nvidia":      return streamNvidia(key, model.id, messages, opts);
    default:            throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── Fallback suggestion ──────────────────────────────────────────────────────

/**
 * When a provider fails, suggest an equivalent model from another active provider.
 *
 * The pick is capability-aware (a vision task never falls back to a text-only
 * model) and health-aware (models currently rate-limited / cooling down are
 * skipped when a healthy alternative exists), so a failover lands on a model
 * that can actually handle the same turn.
 *
 * @param {Array}  models       - Full combined model list (already value/rank-ordered upstream)
 * @param {string} failedId     - Model ID/selection that failed
 * @param {object} providerKeys - Active provider keys
 * @param {object} [opts]
 * @param {boolean} [opts.needsVision] - The turn carries an image; require image input
 * @returns {{ model: object, message: string } | null}
 */
export function suggestFallbackAcrossProviders(models, failedId, providerKeys, opts = {}) {
  const failed = findModelBySelection(models, failedId);
  if (!failed) return null;

  const failedProvider = failed._provider;
  const activeProviders = Object.entries(providerKeys || {})
    .filter(([, key]) => !!key)
    .map(([p]) => p)
    .filter((p) => p !== failedProvider);

  if (activeProviders.length === 0) return null;

  // Candidates from any *other* active provider…
  let candidates = models.filter(
    (m) => m._provider !== failedProvider && activeProviders.includes(m._provider)
  );
  // …that can actually handle the turn (don't hand an image to a text-only model).
  if (opts.needsVision) candidates = candidates.filter((m) => supportsVision(m));

  if (candidates.length === 0) return null;

  // Prefer a model that isn't itself rate-limited; only fall through to a
  // cooling-down one if nothing healthier is available.
  const healthy = candidates.filter((m) => !isModelUnavailable(m._selectionId || m.id));
  const pick = healthy[0] || candidates[0];

  return {
    model: pick,
    message: `${providerLabel(failedProvider)} is unavailable. Try ${pick.name || pick.id} via ${providerLabel(pick._provider)}?`,
  };
}
