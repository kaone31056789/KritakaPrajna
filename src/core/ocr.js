/*
 * OCR service — backend-agnostic text extraction from images.
 *
 * Policy (mode):
 *   "auto"     → use the configured Unlimited-OCR endpoint if present,
 *                otherwise fall back to the local Tesseract.js engine.
 *   "endpoint" → force the Unlimited-OCR endpoint (errors if unconfigured).
 *   "simple"   → force local Tesseract.js (no key, offline, any hardware).
 *
 * The endpoint backend speaks OpenAI-compatible /chat/completions with a base64
 * image_url, so it works against a self-hosted SGLang/vLLM server, a HuggingFace
 * dedicated Inference Endpoint, or (Phase 2) a local runner at localhost:PORT.
 *
 * NOTE: baidu/Unlimited-OCR is a ~3.3B custom-code GPU model. It CANNOT run in
 * the Electron renderer, so we never load its weights here — we only call it
 * over HTTP when an endpoint is configured. The "simple" backend (Tesseract.js)
 * is the only path that runs fully in-app with no GPU / no key.
 */

const LS = {
  mode: "ocr_mode", // "auto" | "endpoint" | "simple"
  url: "ocr_endpoint_url", // e.g. http://localhost:10000/v1  OR a HF endpoint URL
  key: "ocr_endpoint_key", // bearer token for the endpoint (optional)
  model: "ocr_endpoint_model", // served model name
};

export const DEFAULT_OCR_MODEL = "baidu/Unlimited-OCR";
export const DEFAULT_OCR_PROMPT =
  "<image>\nOCR this image. Output only the extracted text, preserving the original reading order. Do not add commentary.";

function readSetting(key, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Resolve OCR config from localStorage, with optional per-call overrides. */
export function getOcrConfig(overrides = {}) {
  return {
    mode: overrides.mode || readSetting(LS.mode, "auto"),
    url: String(overrides.url ?? readSetting(LS.url, "")).trim(),
    key: overrides.key ?? readSetting(LS.key, ""),
    model: String(overrides.model || readSetting(LS.model, "") || DEFAULT_OCR_MODEL).trim(),
  };
}

/** Persist OCR config (only the provided fields). */
export function setOcrConfig(cfg = {}) {
  try {
    if (cfg.mode != null) localStorage.setItem(LS.mode, cfg.mode);
    if (cfg.url != null) localStorage.setItem(LS.url, cfg.url);
    if (cfg.key != null) localStorage.setItem(LS.key, cfg.key);
    if (cfg.model != null) localStorage.setItem(LS.model, cfg.model);
  } catch {}
}

/** Normalize an endpoint base to an OpenAI-compatible chat/completions URL. */
function chatCompletionsUrl(base) {
  const b = String(base || "").replace(/\/+$/, "");
  if (!b) return "";
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/v1$/.test(b)) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

/** True when an OCR endpoint URL is configured (endpoint backend is available). */
export function ocrEndpointConfigured(cfg = getOcrConfig()) {
  return !!chatCompletionsUrl(cfg.url);
}

function extractContentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p?.text || "").join("");
  return "";
}

async function ocrViaEndpoint({ dataUrl, prompt, cfg, signal }) {
  const url = chatCompletionsUrl(cfg.url);
  if (!url) throw new Error("OCR endpoint URL not configured");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model || DEFAULT_OCR_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt || DEFAULT_OCR_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0,
      stream: false,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`OCR endpoint error: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return extractContentText(json?.choices?.[0]?.message?.content);
}

async function ocrViaSimple({ dataUrl, lang = "eng", signal }) {
  let Tesseract;
  try {
    ({ default: Tesseract } = await import("tesseract.js"));
  } catch {
    throw new Error("Simple OCR engine not installed. Run: npm i tesseract.js");
  }
  if (signal?.aborted) throw new Error("OCR aborted");
  const { data } = await Tesseract.recognize(dataUrl, lang);
  return data?.text || "";
}

/**
 * Extract text from a base64 image data URL using the active OCR backend.
 * Returns { text, backend, model }. Never silently swaps backends without
 * reporting which one actually ran (via the returned `backend`).
 *
 * @param {{ dataUrl: string, prompt?: string, lang?: string }} input
 * @param {{ overrides?: object, signal?: AbortSignal }} [opts]
 */
export async function runOCR({ dataUrl, prompt, lang } = {}, { overrides = {}, signal } = {}) {
  if (!dataUrl || typeof dataUrl !== "string") {
    throw new Error("runOCR requires an image dataUrl");
  }
  const cfg = getOcrConfig(overrides);
  const hasEndpoint = ocrEndpointConfigured(cfg);

  let backend;
  if (cfg.mode === "endpoint") backend = "endpoint";
  else if (cfg.mode === "simple") backend = "simple";
  else backend = hasEndpoint ? "endpoint" : "simple"; // auto

  if (backend === "endpoint") {
    if (!hasEndpoint) {
      throw new Error("OCR mode is 'endpoint' but no endpoint URL is configured");
    }
    try {
      const text = await ocrViaEndpoint({ dataUrl, prompt, cfg, signal });
      return { text, backend: "endpoint", model: cfg.model || DEFAULT_OCR_MODEL };
    } catch (err) {
      // Forced 'endpoint' mode (or a user abort) surfaces the error. In 'auto'
      // mode a down/unreachable endpoint must NOT block OCR — degrade to the
      // built-in engine, honoring the Settings promise: "falls back to the
      // built-in engine if not [reachable]".
      if (cfg.mode === "endpoint" || signal?.aborted) throw err;
      // fall through to the simple engine
    }
  }

  const text = await ocrViaSimple({ dataUrl, lang, signal });
  return { text, backend: "simple", model: "tesseract.js" };
}
