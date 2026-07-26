// ── Local model runtime manager ─────────────────────────────────────────────
// Owns the lifecycle of a bundled (or system-installed) Ollama runtime and talks
// to its HTTP API on 127.0.0.1:11434. Design rules:
//   • Never throw across the IPC boundary — every method resolves a result object.
//   • Never auto-start: the renderer starts the runtime on demand (matches the
//     app's "no surprise heavy processes" ethos).
//   • Decoupled from electron — callers pass resourcesPath / modelsDir, so this
//     module stays unit-testable.
//
// The heavy binary is NOT committed to the repo; electron-builder ships it via
// `extraResources` → resources/ollama/<bin>. In dev (or if absent) we fall back
// to a system-installed `ollama` on PATH.

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 11434;
const BASE_URL = `http://${HOST}:${PORT}`;
const IS_WIN = process.platform === "win32";
const BIN_NAME = IS_WIN ? "ollama.exe" : "ollama";
const SERVE_READY_TIMEOUT_MS = 20000;
const MODEL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,190}$/;

let serverProc = null;   // child process — only set when WE spawned `ollama serve`
let startedByUs = false;

// ── binary resolution ───────────────────────────────────────────────────────
function bundledBinaryPath(resourcesPath) {
  // electron-builder extraResources: ./resources/ollama/* → <resourcesPath>/ollama/*
  return resourcesPath ? path.join(resourcesPath, "ollama", BIN_NAME) : "";
}

function resolveBinary(resourcesPath) {
  try {
    const p = bundledBinaryPath(resourcesPath);
    if (p && fs.existsSync(p)) return { path: p, source: "bundled" };
  } catch {}
  // System fallback — spawn by bare name and let the OS resolve it via PATH.
  return { path: BIN_NAME, source: "system" };
}

// ── low-level HTTP to the Ollama API ────────────────────────────────────────
function apiRequest(pathPart, { method = "GET", body, timeoutMs = 8000, onLine } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let req;
    try {
      req = http.request(
        `${BASE_URL}${pathPart}`,
        {
          method,
          headers: body ? { "Content-Type": "application/json" } : {},
          timeout: timeoutMs,
        },
        (res) => {
          const status = Number(res.statusCode) || 0;
          if (onLine) {
            // Stream NDJSON — Ollama emits one JSON object per line (e.g. /api/pull).
            let buf = "";
            res.on("data", (c) => {
              buf += c.toString("utf-8");
              let idx;
              while ((idx = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (line) { try { onLine(JSON.parse(line)); } catch {} }
              }
            });
            res.on("end", () => {
              const tail = buf.trim();
              if (tail) { try { onLine(JSON.parse(tail)); } catch {} }
              done({ ok: status >= 200 && status < 300, status });
            });
          } else {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf-8");
              let json = null;
              try { json = text ? JSON.parse(text) : null; } catch {}
              done({ ok: status >= 200 && status < 300, status, json, text });
            });
          }
        }
      );
    } catch (err) {
      return done({ ok: false, status: 0, error: err?.message || "request failed" });
    }
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", (err) => done({ ok: false, status: 0, error: err?.message || "request failed" }));
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

async function isRunning() {
  const res = await apiRequest("/api/version", { timeoutMs: 2500 });
  return res.ok;
}

// Cheap detection of a system-installed ollama when nothing is serving yet.
function probeVersion(binPath, useShell) {
  return new Promise((resolve) => {
    let out = "";
    let proc;
    try {
      proc = spawn(binPath, ["--version"], { windowsHide: true, shell: useShell });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 4000);
    proc.stdout?.on("data", (c) => (out += c.toString()));
    proc.on("error", () => { clearTimeout(timer); resolve(null); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const m = out.match(/\d+\.\d+\.\d+/);
      if (m) return resolve(m[0]);
      resolve(code === 0 ? "unknown" : null);
    });
  });
}

// ── public API ──────────────────────────────────────────────────────────────
async function status({ resourcesPath } = {}) {
  const bin = resolveBinary(resourcesPath);
  const running = await isRunning();
  let version = null;
  let installed = bin.source === "bundled";

  if (running) {
    const res = await apiRequest("/api/version", { timeoutMs: 2500 });
    version = res.json?.version || "unknown";
    installed = true;
  } else if (bin.source === "system") {
    // Not serving — probe whether a system ollama exists at all.
    version = await probeVersion(bin.path, IS_WIN);
    installed = version != null;
  }

  return {
    ok: true,
    installed,
    running,
    source: installed ? bin.source : "none",
    binaryPath: bin.source === "bundled" ? bin.path : BIN_NAME,
    version,
    baseUrl: BASE_URL,
    startedByUs,
  };
}

// Advanced runtime knobs (mirrors what the Ollama app / LM Studio expose).
// Only whitelisted values become env vars — never arbitrary user strings.
const KV_CACHE_TYPES = new Set(["f16", "q8_0", "q4_0"]);
function buildRuntimeEnv(opts = {}) {
  const env = {};
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? String(Math.floor(Number(v))) : null);
  const ctx = num(opts.contextLength);
  if (ctx) env.OLLAMA_CONTEXT_LENGTH = ctx;
  const parallel = num(opts.numParallel);
  if (parallel) env.OLLAMA_NUM_PARALLEL = parallel;
  const maxLoaded = num(opts.maxLoadedModels);
  if (maxLoaded) env.OLLAMA_MAX_LOADED_MODELS = maxLoaded;
  if (typeof opts.keepAlive === "string" && /^(-1|\d+[smh]?)$/.test(opts.keepAlive.trim())) {
    env.OLLAMA_KEEP_ALIVE = opts.keepAlive.trim();
  }
  if (opts.flashAttention === true) env.OLLAMA_FLASH_ATTENTION = "1";
  if (opts.flashAttention === false) env.OLLAMA_FLASH_ATTENTION = "0";
  if (KV_CACHE_TYPES.has(opts.kvCacheType)) env.OLLAMA_KV_CACHE_TYPE = opts.kvCacheType;
  return env;
}

let lastOptionsSig = null;

async function ensureServe({ resourcesPath, modelsDir, runtimeOptions } = {}) {
  const optionsEnv = buildRuntimeEnv(runtimeOptions);
  const sig = JSON.stringify(optionsEnv);
  if (await isRunning()) {
    // Options changed and we own the server → restart so they take effect.
    // A server we didn't start (user's own Ollama) is left untouched.
    if (startedByUs && serverProc && lastOptionsSig !== null && sig !== lastOptionsSig) {
      try { serverProc.kill(); } catch {}
      serverProc = null;
      startedByUs = false;
      await new Promise((r) => setTimeout(r, 750));
    } else {
      return { ok: true, running: true, startedByUs, baseUrl: BASE_URL };
    }
  }
  const bin = resolveBinary(resourcesPath);

  // OLLAMA_ORIGINS lets the renderer call /v1 directly (e.g. local-vision OCR)
  // without a CORS preflight rejection. Safe: the server binds to 127.0.0.1 only.
  const env = { ...process.env, OLLAMA_HOST: `${HOST}:${PORT}`, OLLAMA_ORIGINS: "*", ...optionsEnv };
  lastOptionsSig = sig;
  if (modelsDir) {
    try { fs.mkdirSync(modelsDir, { recursive: true }); } catch {}
    env.OLLAMA_MODELS = modelsDir;
  }

  try {
    // Bundled binary is an absolute path (no shell). System fallback on Windows
    // needs the shell to resolve the bare name via PATH.
    const useShell = bin.source === "system" && IS_WIN;
    serverProc = spawn(bin.path, ["serve"], {
      windowsHide: true,
      env,
      shell: useShell,
      stdio: "ignore",
      detached: false,
    });
  } catch (err) {
    serverProc = null;
    return { ok: false, error: err?.message || "Failed to start local runtime" };
  }

  startedByUs = true;
  serverProc.on("exit", () => { serverProc = null; startedByUs = false; });
  serverProc.on("error", () => { serverProc = null; startedByUs = false; });

  // Poll for readiness.
  const deadline = Date.now() + SERVE_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isRunning()) {
      return { ok: true, running: true, startedByUs: true, baseUrl: BASE_URL };
    }
    if (!serverProc) break; // process died early
  }
  return { ok: false, error: "Local runtime did not become ready in time." };
}

function stop() {
  if (serverProc && startedByUs) {
    try {
      serverProc.kill("SIGTERM");
      if (IS_WIN) serverProc.kill("SIGKILL");
    } catch {}
  }
  serverProc = null;
  startedByUs = false;
  return { ok: true };
}

async function listModels() {
  const res = await apiRequest("/api/tags", { timeoutMs: 8000 });
  if (!res.ok) {
    return { ok: false, error: res.error || `List failed (HTTP ${res.status})`, models: [] };
  }
  const models = Array.isArray(res.json?.models)
    ? res.json.models.map((m) => ({
        name: m.name,
        size: m.size ?? null,
        family: m.details?.family ?? null,
        parameterSize: m.details?.parameter_size ?? null,
        quantization: m.details?.quantization_level ?? null,
        modifiedAt: m.modified_at ?? null,
      }))
    : [];
  return { ok: true, models };
}

async function pull(model, onProgress) {
  const name = String(model || "").trim();
  if (!MODEL_NAME_RE.test(name)) {
    return { ok: false, error: "Invalid model name." };
  }
  let lastStatus = "";
  const res = await apiRequest("/api/pull", {
    method: "POST",
    body: { name, stream: true },
    timeoutMs: 60 * 60 * 1000, // model pulls can be long
    onLine: (obj) => {
      if (obj?.error) { lastStatus = `error: ${obj.error}`; }
      const total = Number(obj?.total) || 0;
      const completed = Number(obj?.completed) || 0;
      const percent = total > 0 ? Math.round((completed / total) * 100) : null;
      if (typeof obj?.status === "string") lastStatus = obj.status;
      if (typeof onProgress === "function") {
        onProgress({ status: lastStatus, percent, completed, total });
      }
    },
  });
  if (!res.ok) {
    return { ok: false, error: res.error || `Pull failed (HTTP ${res.status})`, status: lastStatus };
  }
  if (lastStatus.startsWith("error:")) {
    return { ok: false, error: lastStatus.slice(7).trim() || "Pull failed" };
  }
  return { ok: true, status: lastStatus || "success" };
}

async function remove(model) {
  const name = String(model || "").trim();
  if (!MODEL_NAME_RE.test(name)) {
    return { ok: false, error: "Invalid model name." };
  }
  const res = await apiRequest("/api/delete", {
    method: "DELETE",
    body: { name },
    timeoutMs: 15000,
  });
  if (!res.ok) {
    return { ok: false, error: res.error || `Delete failed (HTTP ${res.status})` };
  }
  return { ok: true };
}

module.exports = {
  status,
  ensureServe,
  stop,
  listModels,
  pull,
  remove,
  BASE_URL,
};
