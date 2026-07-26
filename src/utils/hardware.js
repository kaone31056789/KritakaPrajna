// src/utils/hardware.js
// Hardware capability detection → tiers that drive OCR engine policy.
//
// HONEST SCOPE: a "strong" tier means "worth OFFERING the local GPU OCR model",
// NOT "guaranteed to run it". A detected GPU may still be an integrated chip,
// lack VRAM, or lack CUDA. We never auto-download or auto-run a heavy model on
// the strength of detection alone — callers gate that behind one-time consent.
//
// Data source priority:
//   1. Electron main `getGpuInfo` IPC (vendor IDs + best-effort Windows VRAM)
//   2. Renderer WebGL UNMASKED_RENDERER_WEBGL fallback (name only, no VRAM)

// Rough VRAM floors to reason about a ~3.3B VLM (Q4 ≈ 2GB weights + overhead,
// fp16 ≈ 6.7GB). These are deliberately conservative "offer" thresholds.
const VRAM_OFFER_FLOOR_MB = 3500; // ≥ ~4GB card → offer local model
const VRAM_COMFORT_MB = 7000;     // ≥ ~8GB card → comfortable

function gb(mb) {
  return Math.max(1, Math.round((mb || 0) / 1024));
}

function classifyFromGpuInfo(info) {
  const gpus = (info && info.gpus) || [];
  const discrete = gpus.find((g) => g.discrete) || null;
  const best = gpus.reduce(
    (a, g) => ((g.vramMB || 0) > ((a && a.vramMB) || 0) ? g : a),
    null
  );
  const vramMB = (discrete && discrete.vramMB) || (best && best.vramMB) || null;

  let tier, reason;
  if (discrete && (vramMB == null || vramMB >= VRAM_COMFORT_MB)) {
    tier = "strong";
    reason = `discrete ${discrete.vendor.toUpperCase()} GPU${vramMB ? ` (~${gb(vramMB)}GB VRAM)` : " (VRAM unknown)"}`;
  } else if (discrete && vramMB >= VRAM_OFFER_FLOOR_MB) {
    tier = "moderate";
    reason = `discrete ${discrete.vendor.toUpperCase()} GPU, limited VRAM (~${gb(vramMB)}GB)`;
  } else if (discrete) {
    tier = "weak";
    reason = `discrete GPU but very low VRAM (~${vramMB}MB) — likely too small for a 3.3B model`;
  } else {
    tier = "weak";
    reason = "no discrete GPU detected (integrated graphics only)";
  }

  return {
    tier,
    reason,
    vendor: discrete ? discrete.vendor : gpus[0] ? gpus[0].vendor : "unknown",
    gpuName: (discrete && discrete.name) || (best && best.name) || (info && info.glRenderer) || null,
    vramMB,
    totalMemMB: (info && info.totalMemMB) || null,
    cpuCount: (info && info.cpuCount) || null,
    discrete: !!discrete,
    source: "electron",
  };
}

// Renderer-only fallback when the Electron GPU IPC is unavailable (e.g. web build).
// No VRAM signal here, so we deliberately NEVER claim "strong".
function classifyFromWebGL() {
  let renderer = null;
  let vendor = "unknown";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
  } catch {
    /* ignore — treat as unknown */
  }
  const r = (renderer || "").toLowerCase();
  if (/(nvidia|geforce|rtx|gtx|quadro|tesla)/.test(r)) vendor = "nvidia";
  else if (/(radeon|amd|firepro)/.test(r)) vendor = "amd";
  else if (/intel/.test(r)) vendor = "intel";
  const discrete = vendor === "nvidia" || vendor === "amd";

  return {
    tier: discrete ? "moderate" : "weak",
    reason: discrete
      ? `WebGL reports a ${vendor.toUpperCase()} GPU (VRAM unknown — cannot confirm capacity)`
      : "WebGL shows integrated or unknown graphics",
    vendor,
    gpuName: renderer,
    vramMB: null,
    totalMemMB: typeof navigator !== "undefined" && navigator.deviceMemory ? navigator.deviceMemory * 1024 : null,
    cpuCount: typeof navigator !== "undefined" ? navigator.hardwareConcurrency || null : null,
    discrete,
    source: "webgl",
  };
}

// Hardware doesn't change while the app runs, but detection is expensive
// (Electron getGPUInfo + a PowerShell CIM query can take seconds on Windows).
// Cache the in-flight promise for the session and persist the last result so
// screens that mount repeatedly (Settings → Local Models) open instantly.
const HW_CACHE_KEY = "kp_hw_cache_v1";
let hwPromise = null;

function readHwCache() {
  try {
    const raw = localStorage.getItem(HW_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.tier ? parsed : null;
  } catch {
    return null;
  }
}

function writeHwCache(hw) {
  try {
    // `raw` can be large (full GPU feature status) — persist the summary only.
    const { raw, ...summary } = hw || {};
    localStorage.setItem(HW_CACHE_KEY, JSON.stringify(summary));
  } catch {
    /* storage full/unavailable — cache is best-effort */
  }
}

async function detectHardwareUncached() {
  const api = typeof window !== "undefined" ? window.electronAPI : null;
  if (api && typeof api.getGpuInfo === "function") {
    try {
      const info = await api.getGpuInfo();
      if (info && info.ok) return { ...classifyFromGpuInfo(info), raw: info };
    } catch {
      /* fall through to WebGL */
    }
  }
  return classifyFromWebGL();
}

// Detect hardware and return a normalized capability descriptor.
// Resolves instantly from the persisted summary when available while a real
// detection refreshes the cache in the background (first call per session).
export async function detectHardware({ force = false } = {}) {
  if (!force && hwPromise) return hwPromise;
  const cached = force ? null : readHwCache();
  const fresh = detectHardwareUncached()
    .then((hw) => {
      writeHwCache(hw);
      hwPromise = Promise.resolve(hw); // future callers get the real thing
      return hw;
    })
    .catch(() => cached || classifyFromWebGL());
  hwPromise = cached ? Promise.resolve(cached) : fresh;
  return hwPromise;
}

// Map a hardware descriptor → OCR engine policy.
//   engine     : which engine to use by default ('local' GPU model | 'simple' Tesseract)
//   localOffer : how to surface the heavy local model in the UI
//                 'one-tap'            → strong machine: enable in one tap (still one download consent)
//                 'offer-with-warning' → moderate: offer, but warn it may be slow
//                 'ask'                → weak/unknown: default simple, offer only if user insists
//   note       : human-readable reason (for tooltips / consent copy)
export function recommendOcrPolicy(hw) {
  if (!hw) return { engine: "simple", localOffer: "ask", note: "hardware unknown" };
  if (hw.tier === "strong") return { engine: "local", localOffer: "one-tap", note: hw.reason };
  if (hw.tier === "moderate") return { engine: "simple", localOffer: "offer-with-warning", note: hw.reason };
  return { engine: "simple", localOffer: "ask", note: hw.reason };
}

// Short human summary for settings UI, e.g. "NVIDIA GPU (~8GB VRAM) · 16GB RAM".
export function describeHardware(hw) {
  if (!hw) return "Unknown hardware";
  const parts = [];
  if (hw.gpuName) parts.push(hw.gpuName);
  else if (hw.vendor && hw.vendor !== "unknown") parts.push(`${hw.vendor.toUpperCase()} GPU`);
  else parts.push("No discrete GPU");
  if (hw.vramMB) parts.push(`~${gb(hw.vramMB)}GB VRAM`);
  if (hw.totalMemMB) parts.push(`${gb(hw.totalMemMB)}GB RAM`);
  return parts.join(" · ");
}
