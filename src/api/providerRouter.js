/**
 * providerRouter.js
 *
 * Aggregates models from all active providers and routes streaming requests
 * to the correct provider API. Each model object carries a `_provider` field
 * that determines which API client handles the call.
 *
 * Provider keys shape:  { openrouter, openai, anthropic, huggingface, ollama }
 * Each value is a provider credential/config string (API key or endpoint) or null/undefined.
 */

import { fetchModels as fetchOpenRouterModels, streamMessage as streamOpenRouter, fetchCredits, generateImage as generateImageOR } from "./openrouter";
import { fetchModels as fetchOpenAIModels, streamMessage as streamOpenAI } from "./openai";
import { fetchModels as fetchAnthropicModels, streamMessage as streamAnthropic } from "./anthropic";
import { fetchModels as fetchHFModels, streamMessage as streamHF, generateImage as generateImageHF, IMAGE_GEN_MODELS as HF_IMAGE_MODELS } from "./huggingface";
import { fetchModels as fetchOllamaModels, streamMessage as streamOllama } from "./ollama";

export { fetchCredits };

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
 * @param {object} providerKeys - { openrouter, openai, anthropic, huggingface, ollama }
 * @returns {Promise<Array>} Flat array of model objects with `_provider` set
 */
export async function fetchAllModels(providerKeys) {
  const providerOrder = ["openrouter", "openai", "anthropic", "huggingface", "ollama"];
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
    providerKeys?.huggingface ? fetchHFModels(providerKeys.huggingface)                                                                      : Promise.resolve([]),
    providerKeys?.ollama      ? fetchOllamaModels(providerKeys.ollama)                                                                       : Promise.resolve([]),
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
    ...(providerKeys?.huggingface ? HF_IMAGE_MODELS : []),
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
  const key = providerKeys?.[provider];

  if (!key) {
    throw new Error(`No API key configured for ${providerLabel(provider)}.`);
  }

  switch (provider) {
    case "openrouter":  return streamOpenRouter(key, model.id, messages, opts);
    case "openai":      return streamOpenAI(key, model.id, messages, opts);
    case "anthropic":   return streamAnthropic(key, model.id, messages, opts);
    case "huggingface": return streamHF(key, model.id, messages, opts);
    case "ollama":      return streamOllama(key, model.id, messages, opts);
    default:            throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── Fallback suggestion ──────────────────────────────────────────────────────

/**
 * When a provider fails, suggest an equivalent model from another active provider.
 *
 * @param {Array}  models       - Full combined model list
 * @param {string} failedId     - Model ID that failed
 * @param {object} providerKeys - Active provider keys
 * @returns {{ model: object, message: string } | null}
 */
export function suggestFallbackAcrossProviders(models, failedId, providerKeys) {
  const failed = findModelBySelection(models, failedId);
  if (!failed) return null;

  const failedProvider = failed._provider;
  const activeProviders = Object.entries(providerKeys || {})
    .filter(([, key]) => !!key)
    .map(([p]) => p)
    .filter((p) => p !== failedProvider);

  if (activeProviders.length === 0) return null;

  // Find a similarly-capable model from another active provider
  const candidates = models.filter(
    (m) => m._provider !== failedProvider && activeProviders.includes(m._provider)
  );

  if (candidates.length === 0) return null;

  const pick = candidates[0];
  return {
    model: pick,
    message: `${providerLabel(failedProvider)} is unavailable. Try ${pick.name || pick.id} via ${providerLabel(pick._provider)}?`,
  };
}
