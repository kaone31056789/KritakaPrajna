import { createStore } from "./store";
import { keysStore, setProviderKey } from "./keys";
import { loadModels } from "./models";
import { getOcrConfig, setOcrConfig } from "./ocr";
import { settingsStore } from "./settings";

/*
 * Local model runtime (bundled Ollama) — renderer-side store + actions.
 *
 * The main process owns the runtime lifecycle (electron/localRuntime.js) and
 * exposes it via window.electronAPI.local* bridges. This store mirrors that
 * state for the UI and drives pull/delete/serve/stop.
 *
 * Integration: the app already treats Ollama as a first-class provider
 * (see api/providerRouter.js). When the bundled runtime is serving we point the
 * shared `ollama` provider slot at the local server, so the EXISTING provider
 * pipeline (fetchAllModels → picker → routeStream) surfaces and runs local
 * models with no duplicated plumbing.
 *
 * Layering: this module is pure core — no ui/* imports. Toasts/UX live in the
 * Local Models settings tab.
 */

export const LOCAL_BASE_URL = "http://127.0.0.1:11434";

export function hasLocalRuntime() {
  return typeof window !== "undefined" && !!window.electronAPI?.localServe;
}

/** True for a bare loopback base URL (so we only auto-manage a local ollama slot). */
function isLocalUrl(u) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?\/?$/i.test(String(u || ""));
}

/** True for any loopback URL, including ones with a path (e.g. /v1). */
function isLoopbackUrl(u) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(u || ""));
}

// ── Local vision OCR (Phase 3) ───────────────────────────────────────────────
// Ollama serves an OpenAI-compatible endpoint at BASE_URL/v1, which core/ocr.js
// already speaks. Pointing OCR there + an installed vision model = offline OCR.

export const LOCAL_OCR_BASE = `${LOCAL_BASE_URL}/v1`;

// Installed model names/families that accept image input (vision) for OCR.
const VISION_MODEL_RE =
  /(llava|bakllava|moondream|minicpm-?v|llama-?3\.2-vision|qwen2(\.5)?-vl|granite.*vision|vision)/i;

/** First installed vision-capable model name, or "" if none. */
export function findInstalledVisionModel(installed = localModelsStore.get().installed) {
  const hit = (installed || []).find(
    (m) => VISION_MODEL_RE.test(m.name || "") || VISION_MODEL_RE.test(m.family || "")
  );
  return hit ? hit.name : "";
}

/** True when OCR is currently pointed at THIS bundled runtime. */
export function isLocalOCRActive(cfg = getOcrConfig()) {
  return /\/\/(127\.0\.0\.1|localhost):11434(\/|$)/i.test(String(cfg.url || ""));
}

/**
 * Point the OCR engine at a local vision model served by the bundled runtime.
 * mode "auto" keeps the Tesseract fallback if the runtime is ever unreachable.
 * @returns {{ ok: boolean, model?: string, error?: string }}
 */
export function wireLocalOCR(model) {
  const visionModel = String(model || "").trim() || findInstalledVisionModel();
  if (!visionModel) {
    return { ok: false, error: "No local vision model installed — pull LLaVA or Moondream first." };
  }
  setOcrConfig({ url: LOCAL_OCR_BASE, model: visionModel, mode: "auto", key: "" });
  return { ok: true, model: visionModel };
}

/**
 * Auto-wire local OCR only when it's safe: no OCR endpoint set yet, or the one
 * set already points at our loopback runtime. Never clobbers a user's real
 * remote OCR endpoint (e.g. a hosted Unlimited-OCR / vLLM endpoint).
 */
export function maybeAutoWireLocalOCR() {
  const visionModel = findInstalledVisionModel();
  if (!visionModel) return { ok: false, error: "no-vision-model" };
  const cfg = getOcrConfig();
  if (cfg.url && !isLoopbackUrl(cfg.url)) return { ok: false, error: "custom-endpoint-present" };
  return wireLocalOCR(visionModel);
}

/** Revert OCR to the built-in engine if it was pointed at our runtime. */
export function unwireLocalOCR() {
  if (isLocalOCRActive()) setOcrConfig({ url: "" });
}

/**
 * Curated, on-demand pullable models. Sizes are approximate download hints.
 * Vision models are what unlock local OCR (Phase 3).
 */
export const CATALOG = [
  // ── Chat / general ──
  { name: "tinyllama",          label: "TinyLlama 1.1B",      size: "~640 MB", sizeGB: 0.6,  tag: "chat",      note: "Smallest usable chat model" },
  { name: "gemma3:1b",          label: "Gemma 3 1B",          size: "~815 MB", sizeGB: 0.8,  tag: "chat",      note: "Newest compact Google model" },
  { name: "qwen2.5:0.5b",       label: "Qwen 2.5 0.5B",       size: "~400 MB", sizeGB: 0.4,  tag: "chat",      note: "Ultra-light multilingual chat" },
  { name: "llama3.2:1b",        label: "Llama 3.2 1B",        size: "~1.3 GB", sizeGB: 1.3,  tag: "chat",      note: "Tiny, fast general chat" },
  { name: "gemma2:2b",          label: "Gemma 2 2B",          size: "~1.6 GB", sizeGB: 1.6,  tag: "chat",      note: "Compact Google model" },
  { name: "smollm2:1.7b",       label: "SmolLM2 1.7B",        size: "~1.8 GB", sizeGB: 1.8,  tag: "chat",      note: "Efficient small model" },
  { name: "qwen2.5:3b",         label: "Qwen 2.5 3B",         size: "~1.9 GB", sizeGB: 1.9,  tag: "chat",      note: "Strong multilingual chat" },
  { name: "llama3.2:3b",        label: "Llama 3.2 3B",        size: "~2.0 GB", sizeGB: 2.0,  tag: "chat",      note: "Balanced general chat" },
  { name: "phi3.5:3.8b",        label: "Phi-3.5 Mini",        size: "~2.2 GB", sizeGB: 2.2,  tag: "chat",      note: "Reasoning-focused small model" },
  { name: "qwen3:4b",           label: "Qwen 3 4B",           size: "~2.6 GB", sizeGB: 2.6,  tag: "chat",      note: "Latest-gen small Qwen" },
  { name: "gemma3:4b",          label: "Gemma 3 4B",          size: "~3.3 GB", sizeGB: 3.3,  tag: "chat",      note: "Great quality for its size, vision-capable" },
  { name: "mistral:7b",         label: "Mistral 7B",          size: "~4.4 GB", sizeGB: 4.4,  tag: "chat",      note: "Classic all-round 7B" },
  { name: "qwen2.5:7b",         label: "Qwen 2.5 7B",         size: "~4.7 GB", sizeGB: 4.7,  tag: "chat",      note: "Strong general 7B" },
  { name: "hermes3:8b",         label: "Hermes 3 8B",         size: "~4.7 GB", sizeGB: 4.7,  tag: "chat",      note: "Instruction-tuned Llama variant" },
  { name: "llama3.1:8b",        label: "Llama 3.1 8B",        size: "~4.9 GB", sizeGB: 4.9,  tag: "chat",      note: "Very popular general model" },
  { name: "qwen3:8b",           label: "Qwen 3 8B",           size: "~5.2 GB", sizeGB: 5.2,  tag: "chat",      note: "Latest-gen mid-size Qwen" },
  { name: "mistral-nemo:12b",   label: "Mistral Nemo 12B",    size: "~7.1 GB", sizeGB: 7.1,  tag: "chat",      note: "Long-context mid-size model" },
  { name: "gemma3:12b",         label: "Gemma 3 12B",         size: "~8.1 GB", sizeGB: 8.1,  tag: "chat",      note: "High quality, vision-capable" },
  { name: "qwen2.5:14b",        label: "Qwen 2.5 14B",        size: "~9.0 GB", sizeGB: 9.0,  tag: "chat",      note: "Strong mid-size model" },
  { name: "phi4:14b",           label: "Phi-4 14B",           size: "~9.1 GB", sizeGB: 9.1,  tag: "chat",      note: "Microsoft's strongest small model" },
  { name: "qwen3:14b",          label: "Qwen 3 14B",          size: "~9.3 GB", sizeGB: 9.3,  tag: "chat",      note: "Latest-gen 14B" },
  { name: "gemma3:27b",         label: "Gemma 3 27B",         size: "~17 GB",  sizeGB: 17,   tag: "chat",      note: "Near-frontier open model" },
  { name: "qwen2.5:32b",        label: "Qwen 2.5 32B",        size: "~20 GB",  sizeGB: 20,   tag: "chat",      note: "Large, high-quality model" },
  { name: "qwen3:32b",          label: "Qwen 3 32B",          size: "~20 GB",  sizeGB: 20,   tag: "chat",      note: "Latest-gen large Qwen" },
  { name: "llama3.3:70b",       label: "Llama 3.3 70B",       size: "~43 GB",  sizeGB: 43,   tag: "chat",      note: "Frontier-class, needs a big machine" },
  // ── Coding ──
  { name: "qwen2.5-coder:1.5b", label: "Qwen2.5 Coder 1.5B",  size: "~1.0 GB", sizeGB: 1.0,  tag: "code",      note: "Lightweight local coding" },
  { name: "starcoder2:3b",      label: "StarCoder2 3B",       size: "~1.7 GB", sizeGB: 1.7,  tag: "code",      note: "Fast code completion" },
  { name: "qwen2.5-coder:3b",   label: "Qwen2.5 Coder 3B",    size: "~1.9 GB", sizeGB: 1.9,  tag: "code",      note: "Small but capable coder" },
  { name: "codellama:7b",       label: "Code Llama 7B",       size: "~3.8 GB", sizeGB: 3.8,  tag: "code",      note: "Meta's code model" },
  { name: "qwen2.5-coder:7b",   label: "Qwen2.5 Coder 7B",    size: "~4.7 GB", sizeGB: 4.7,  tag: "code",      note: "Capable local coding" },
  { name: "codegemma:7b",       label: "CodeGemma 7B",        size: "~5.0 GB", sizeGB: 5.0,  tag: "code",      note: "Google's code model" },
  { name: "codellama:13b",      label: "Code Llama 13B",      size: "~7.4 GB", sizeGB: 7.4,  tag: "code",      note: "Larger code model" },
  { name: "deepseek-coder-v2:16b", label: "DeepSeek Coder V2 16B", size: "~8.9 GB", sizeGB: 8.9, tag: "code",  note: "Top-tier open code model (MoE)" },
  { name: "qwen2.5-coder:14b",  label: "Qwen2.5 Coder 14B",   size: "~9.0 GB", sizeGB: 9.0,  tag: "code",      note: "Strong mid-size coder" },
  { name: "qwen2.5-coder:32b",  label: "Qwen2.5 Coder 32B",   size: "~20 GB",  sizeGB: 20,   tag: "code",      note: "Best open local coder" },
  // ── Vision (enables local OCR) ──
  { name: "moondream",          label: "Moondream 2",         size: "~1.7 GB", sizeGB: 1.7,  tag: "vision",    note: "Tiny vision model for OCR" },
  { name: "granite3.2-vision",  label: "Granite 3.2 Vision",  size: "~2.4 GB", sizeGB: 2.4,  tag: "vision",    note: "IBM doc-understanding model" },
  { name: "llava:7b",           label: "LLaVA 7B",            size: "~4.7 GB", sizeGB: 4.7,  tag: "vision",    note: "Vision model — enables local OCR" },
  { name: "minicpm-v:8b",       label: "MiniCPM-V 8B",        size: "~5.5 GB", sizeGB: 5.5,  tag: "vision",    note: "Strong OCR and image chat" },
  { name: "qwen2.5vl:7b",       label: "Qwen2.5-VL 7B",       size: "~6.0 GB", sizeGB: 6.0,  tag: "vision",    note: "Excellent document/image reading" },
  { name: "llama3.2-vision:11b", label: "Llama 3.2 Vision 11B", size: "~7.8 GB", sizeGB: 7.8, tag: "vision",   note: "Meta's vision model" },
  { name: "llava:13b",          label: "LLaVA 13B",           size: "~8.0 GB", sizeGB: 8.0,  tag: "vision",    note: "Larger vision model" },
  // ── Reasoning ──
  { name: "deepseek-r1:1.5b",   label: "DeepSeek R1 1.5B",    size: "~1.1 GB", sizeGB: 1.1,  tag: "reasoning", note: "Tiny thinking model" },
  { name: "phi4-mini-reasoning", label: "Phi-4 Mini Reasoning", size: "~3.2 GB", sizeGB: 3.2, tag: "reasoning", note: "Small math/logic specialist" },
  { name: "deepseek-r1:7b",     label: "DeepSeek R1 7B",      size: "~4.7 GB", sizeGB: 4.7,  tag: "reasoning", note: "Solid local reasoning" },
  { name: "deepseek-r1:8b",     label: "DeepSeek R1 8B",      size: "~5.2 GB", sizeGB: 5.2,  tag: "reasoning", note: "Llama-based R1 distill" },
  { name: "deepseek-r1:14b",    label: "DeepSeek R1 14B",     size: "~9.0 GB", sizeGB: 9.0,  tag: "reasoning", note: "Strong step-by-step reasoning" },
  { name: "deepseek-r1:32b",    label: "DeepSeek R1 32B",     size: "~20 GB",  sizeGB: 20,   tag: "reasoning", note: "Heavy-duty reasoning" },
  { name: "qwq:32b",            label: "QwQ 32B",             size: "~20 GB",  sizeGB: 20,   tag: "reasoning", note: "Qwen reasoning specialist" },
  { name: "deepseek-r1:70b",    label: "DeepSeek R1 70B",     size: "~43 GB",  sizeGB: 43,   tag: "reasoning", note: "Frontier-class reasoning" },
  // ── Embeddings ──
  { name: "all-minilm",         label: "All-MiniLM",          size: "~46 MB",  sizeGB: 0.05, tag: "embed",     note: "Tiny sentence embeddings" },
  { name: "nomic-embed-text",   label: "Nomic Embed",         size: "~274 MB", sizeGB: 0.27, tag: "embed",     note: "Text embeddings" },
  { name: "mxbai-embed-large",  label: "MxBai Embed Large",   size: "~670 MB", sizeGB: 0.67, tag: "embed",     note: "High-quality embeddings" },
  { name: "bge-m3",             label: "BGE-M3",              size: "~1.2 GB", sizeGB: 1.2,  tag: "embed",     note: "Multilingual embeddings" },
];

/** Category tags present in CATALOG, in display order. */
export const CATALOG_TAGS = ["chat", "code", "vision", "reasoning", "embed"];

/**
 * Estimate whether a catalog entry can run on the detected hardware.
 * Rule of thumb: a q4 GGUF needs roughly its file size in memory plus ~1.5 GB
 * of overhead (KV cache + runtime). If GPU VRAM covers the model size it will
 * be GPU-accelerated; otherwise it runs on CPU/RAM (slower but works).
 *
 * @param {{sizeGB?: number}} entry - CATALOG entry
 * @param {{totalMemMB?: number, vramMB?: number}|null} hw - detectHardware() result
 * @returns {{level: "fits"|"tight"|"heavy"|"unknown", label: string}}
 */
export function modelFit(entry, hw) {
  const sizeGB = Number(entry?.sizeGB) || 0;
  const ramGB = hw?.totalMemMB ? hw.totalMemMB / 1024 : 0;
  if (!sizeGB || !ramGB) return { level: "unknown", label: "" };
  const needGB = sizeGB * 1.15 + 1.5;
  const vramGB = hw?.vramMB ? hw.vramMB / 1024 : 0;
  const gpu = vramGB >= sizeGB * 0.9;
  if (needGB <= ramGB * 0.7) return { level: "fits", label: gpu ? "Fits · GPU" : "Fits your PC" };
  if (needGB <= ramGB) return { level: "tight", label: "Tight fit" };
  return { level: "heavy", label: "Too heavy" };
}

/** Largest model download (GB) that comfortably fits the detected hardware. */
export function maxComfortableModelGB(hw) {
  const ramGB = hw?.totalMemMB ? hw.totalMemMB / 1024 : 0;
  if (!ramGB) return 0;
  return Math.max(0, (ramGB * 0.7 - 1.5) / 1.15);
}

export const localModelsStore = createStore({
  supported: hasLocalRuntime(),
  status: "unknown",   // unknown | stopped | starting | serving | error | unsupported
  running: false,
  version: "",
  source: "",          // bundled | system | none
  installed: [],       // [{ name, size, family, parameterSize, quantization, modifiedAt }]
  pulls: {},           // { [name]: { percent, status, completed, total, error } }
  busy: false,
  error: "",
});

/* ── progress relay (bind once) ── */

let progressBound = false;
function bindProgress() {
  if (progressBound || !hasLocalRuntime() || !window.electronAPI?.onLocalPullProgress) return;
  progressBound = true;
  window.electronAPI.onLocalPullProgress((data) => {
    const { model, status, percent, completed, total } = data || {};
    if (!model) return;
    localModelsStore.set((s) => ({
      pulls: {
        ...s.pulls,
        [model]: { ...(s.pulls[model] || {}), status, percent, completed, total },
      },
    }));
  });
}
bindProgress();

/* ── helpers ── */

function reloadPickerModels() {
  // Re-fetch the merged catalog so newly pulled/removed local models flow into
  // the picker via the shared ollama provider slot.
  try {
    loadModels(keysStore.get().providers);
  } catch {
    /* non-fatal */
  }
}

/* ── actions ── */

export async function refreshStatus() {
  if (!hasLocalRuntime()) {
    localModelsStore.set({ supported: false, status: "unsupported" });
    return;
  }
  try {
    const res = await window.electronAPI.localStatus();
    if (res?.ok) {
      localModelsStore.set({
        supported: true,
        status: res.running ? "serving" : "stopped",
        running: !!res.running,
        version: res.version || "",
        source: res.source || "",
        modelsDir: res.modelsDir || "",
        error: "",
      });
      if (res.running) await refreshInstalled();
    } else {
      localModelsStore.set({ status: "error", error: res?.error || "Status check failed" });
    }
  } catch (err) {
    localModelsStore.set({ status: "error", error: err?.message || "Status check failed" });
  }
}

export async function refreshInstalled() {
  if (!hasLocalRuntime()) return [];
  const res = await window.electronAPI.localList();
  if (res?.ok) {
    localModelsStore.set({ installed: res.models || [] });
    return res.models || [];
  }
  return [];
}

export async function startRuntime() {
  if (!hasLocalRuntime()) {
    return { ok: false, error: "Local runtime is only available in the desktop app." };
  }
  localModelsStore.set({ status: "starting", busy: true, error: "" });
  try {
    const res = await window.electronAPI.localServe(settingsStore.get().localRuntime);
    if (res?.ok) {
      // Point the shared ollama provider slot at the bundled server — but never
      // clobber a user's cloud Ollama key (only take an empty or loopback slot).
      const currentKey = keysStore.get().providers.ollama;
      if (!currentKey || isLocalUrl(currentKey)) {
        await setProviderKey("ollama", LOCAL_BASE_URL);
      }
      localModelsStore.set({ status: "serving", running: true, busy: false, error: "" });
      await refreshInstalled();
      reloadPickerModels();
      maybeAutoWireLocalOCR(); // opt-in offline OCR if a vision model is present
    } else {
      localModelsStore.set({ status: "error", busy: false, error: res?.error || "Failed to start local runtime." });
    }
    return res;
  } catch (err) {
    const error = err?.message || "Failed to start local runtime.";
    localModelsStore.set({ status: "error", busy: false, error });
    return { ok: false, error };
  }
}

export async function stopRuntime() {
  if (!hasLocalRuntime()) return { ok: false };
  localModelsStore.set({ busy: true });
  try {
    const res = await window.electronAPI.localStop();
    localModelsStore.set({ status: "stopped", running: false, busy: false });
    return res;
  } catch (err) {
    localModelsStore.set({ status: "stopped", running: false, busy: false });
    return { ok: false, error: err?.message };
  }
}

export async function pullModel(name) {
  const model = String(name || "").trim();
  if (!model) return { ok: false, error: "No model specified." };
  if (!hasLocalRuntime()) return { ok: false, error: "Local runtime unavailable." };
  bindProgress();
  localModelsStore.set((s) => ({
    pulls: { ...s.pulls, [model]: { percent: null, status: "starting", completed: 0, total: 0, error: "" } },
  }));
  try {
    const res = await window.electronAPI.localPull(model);
    if (res?.ok) {
      localModelsStore.set((s) => ({
        pulls: { ...s.pulls, [model]: { ...(s.pulls[model] || {}), percent: 100, status: "done", error: "" } },
      }));
      await refreshInstalled();
      reloadPickerModels();
      maybeAutoWireLocalOCR(); // a freshly-pulled vision model can drive OCR
    } else {
      localModelsStore.set((s) => ({
        pulls: { ...s.pulls, [model]: { ...(s.pulls[model] || {}), status: "error", error: res?.error || "Pull failed." } },
      }));
    }
    return res;
  } catch (err) {
    const error = err?.message || "Pull failed.";
    localModelsStore.set((s) => ({
      pulls: { ...s.pulls, [model]: { ...(s.pulls[model] || {}), status: "error", error } },
    }));
    return { ok: false, error };
  }
}

/** Clear a finished/errored pull entry from the progress map. */
export function dismissPull(name) {
  const model = String(name || "").trim();
  localModelsStore.set((s) => {
    if (!(model in s.pulls)) return s;
    const pulls = { ...s.pulls };
    delete pulls[model];
    return { pulls };
  });
}

export async function deleteModel(name) {
  const model = String(name || "").trim();
  if (!model) return { ok: false };
  if (!hasLocalRuntime()) return { ok: false, error: "Local runtime unavailable." };
  const res = await window.electronAPI.localDelete(model);
  if (res?.ok) {
    await refreshInstalled();
    reloadPickerModels();
  }
  return res;
}

/** True if a catalog/model name is already installed. */
export function isInstalled(installed, name) {
  const target = String(name || "").trim();
  return (installed || []).some((m) => m.name === target || m.name === `${target}:latest`);
}
