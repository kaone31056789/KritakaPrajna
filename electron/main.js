const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage, session, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const https = require("https");
const http = require("http");
const { URL: NodeURL } = require("url");
const Store = require("electron-store");
// electron-updater is lazy-required inside setupAutoUpdater so it initializes
// after app.whenReady() — importing at top level causes a crash in dev mode.
let autoUpdater;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// New store file (config-v2) avoids reading the old AES-encrypted config.json
const store = new Store({
  name: "config-v2",
  schema: {
    apiKeyEncrypted:         { type: "string", default: "" }, // OpenRouter (legacy)
    openaiKeyEncrypted:      { type: "string", default: "" },
    anthropicKeyEncrypted:   { type: "string", default: "" },
    huggingfaceKeyEncrypted: { type: "string", default: "" },
    ollamaKeyEncrypted:      { type: "string", default: "" },
    keyboardShortcuts:       { type: "object", default: {} },
    userMemory:              {
      type: "object",
      default: {
        preferences: [],
        coding: [],
        context: [],
        autoMode: true,
      },
    },
  },
});

function getApiKey() {
  const encrypted = store.get("apiKeyEncrypted");
  if (!encrypted) return null;
  if (!safeStorage.isEncryptionAvailable()) return encrypted; // fallback: plaintext
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return null;
  }
}

function setApiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is not available on this system. API keys cannot be saved.");
  }
  store.set("apiKeyEncrypted", safeStorage.encryptString(key).toString("base64"));
}

function removeApiKey() {
  store.delete("apiKeyEncrypted");
}

// ── Multi-provider key helpers ───────────────────────────────────────────────
const PROVIDER_KEY_MAP = {
  openrouter:   "apiKeyEncrypted",
  openai:       "openaiKeyEncrypted",
  anthropic:    "anthropicKeyEncrypted",
  huggingface:  "huggingfaceKeyEncrypted",
  ollama:       "ollamaKeyEncrypted",
};

function getProviderKey(provider) {
  const field = PROVIDER_KEY_MAP[provider];
  if (!field) return null;
  const stored = store.get(field);
  if (!stored) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    return stored; // Fallback to plaintext
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    return stored; // If decrypt fails, maybe it was stored as plaintext
  }
}

function setProviderKey(provider, key) {
  const field = PROVIDER_KEY_MAP[provider];
  if (!field) return;
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: store plaintext if secure storage missing
    store.set(field, key);
    return;
  }
  store.set(field, safeStorage.encryptString(key).toString("base64"));
}

function removeProviderKey(provider) {
  const field = PROVIDER_KEY_MAP[provider];
  if (field) store.delete(field);
}

function getAllProviderKeys() {
  return {
    openrouter:  getProviderKey("openrouter"),
    openai:      getProviderKey("openai"),
    anthropic:   getProviderKey("anthropic"),
    huggingface: getProviderKey("huggingface"),
    ollama:      getProviderKey("ollama"),
  };
}

function getKeyboardShortcuts() {
  return store.get("keyboardShortcuts") || {};
}

function setKeyboardShortcuts(shortcuts) {
  if (!shortcuts || typeof shortcuts !== "object" || Array.isArray(shortcuts)) return;
  const MAX_ENTRIES = 100;
  const MAX_LEN = 200;
  const sanitized = {};
  for (const [k, v] of Object.entries(shortcuts).slice(0, MAX_ENTRIES)) {
    if (typeof k === "string" && typeof v === "string" && k.length <= MAX_LEN && v.length <= MAX_LEN) {
      sanitized[k] = v;
    }
  }
  store.set("keyboardShortcuts", sanitized);
}

function resetKeyboardShortcuts() {
  store.delete("keyboardShortcuts");
}

function getUserMemory() {
  const memory = store.get("userMemory");
  return {
    preferences: Array.isArray(memory?.preferences) ? memory.preferences : [],
    coding: Array.isArray(memory?.coding) ? memory.coding : [],
    context: Array.isArray(memory?.context) ? memory.context : [],
    autoMode: memory?.autoMode !== false,
  };
}

function setUserMemory(memory) {
  const MAX_ITEMS = 50;
  const MAX_STR = 500;
  const sanitizeArr = (arr) =>
    Array.isArray(arr)
      ? arr.slice(0, MAX_ITEMS).map((s) => (typeof s === "string" ? s.slice(0, MAX_STR) : "")).filter(Boolean)
      : [];
  store.set("userMemory", {
    preferences: sanitizeArr(memory?.preferences),
    coding:      sanitizeArr(memory?.coding),
    context:     sanitizeArr(memory?.context),
    autoMode:    memory?.autoMode !== false,
  });
}

function resetUserMemory() {
  store.delete("userMemory");
}


// Tracks the folder the user explicitly opened — used to scope file write access
let allowedBasePath = null;

let mainWindow = null;

// ── OpenCode persistent agent process manager ───────────────────────────────
const OPENCODE_MAX_STDIO_BUFFER = 1024 * 1024; // keep 1 MB rolling buffer per stream
const OPENCODE_READY_TIMEOUT_MS = 12000;
const OPENCODE_MAX_RUN_OUTPUT_CHARS = 250000;
const opencodeState = {
  proc: null,
  restartTimer: null,
  shuttingDown: false,
  ready: false,
  startedAt: 0,
  stdoutBuffer: "",
  stderrBuffer: "",
  requestSessionMap: new Map(), // requestId -> sessionId
  chatSessionMap: new Map(), // chatSessionId -> opencode session id
  activeRuns: new Map(), // requestId -> run state
  serverUrl: "",
  lastError: "",
  missingBinary: false,
  spawnSpec: null,
  runtimeDownloadPromise: null,
};

function safeString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveBundledOpenCodeSpec() {
  try {
    const cliPath = require.resolve("opencode-ai/bin/opencode");
    return {
      command: process.execPath,
      args: [cliPath],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      source: "bundled",
    };
  } catch {
    return null;
  }
}

function getOpenCodeBinaryName() {
  return process.platform === "win32" ? "opencode.exe" : "opencode";
}

function getOpenCodePackageCandidates() {
  const platformMap = {
    win32: "windows",
    darwin: "darwin",
    linux: "linux",
  };
  const archMap = {
    x64: "x64",
    arm64: "arm64",
    arm: "arm",
  };

  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];
  if (!platform || !arch) return [];

  const base = `opencode-${platform}-${arch}`;
  const candidates = [base];
  if (arch === "x64") candidates.push(`${base}-baseline`);
  if (platform === "linux") {
    candidates.push(`${base}-musl`);
    if (arch === "x64") candidates.push(`${base}-baseline-musl`);
  }

  return [...new Set(candidates)];
}

function getBundledOpenCodeVersion() {
  try {
    const pkg = require("opencode-ai/package.json");
    const version = String(pkg?.version || "").trim();
    if (version) return version;
  } catch {}
  return "1.3.17";
}

function resolveBundledOpenCodeBinarySpec() {
  const binaryName = getOpenCodeBinaryName();
  for (const pkgName of getOpenCodePackageCandidates()) {
    try {
      const binaryPath = require.resolve(`${pkgName}/bin/${binaryName}`);
      return {
        command: binaryPath,
        args: [],
        env: {},
        source: "bundled-binary",
        packageName: pkgName,
      };
    } catch {}
  }
  return null;
}

function getDownloadedOpenCodeBinaryPaths() {
  if (!app?.isReady?.()) return [];

  const runtimeRoot = path.join(app.getPath("userData"), "opencode-runtime");
  const binaryName = getOpenCodeBinaryName();
  const version = getBundledOpenCodeVersion();

  return getOpenCodePackageCandidates().map((pkgName) => ({
    pkgName,
    version,
    filePath: path.join(runtimeRoot, `${pkgName}@${version}`, binaryName),
  }));
}

function resolveDownloadedOpenCodeSpec() {
  for (const entry of getDownloadedOpenCodeBinaryPaths()) {
    try {
      fs.accessSync(entry.filePath, fs.constants.F_OK);
      return {
        command: entry.filePath,
        args: [],
        env: {},
        source: "downloaded",
        packageName: entry.pkgName,
      };
    } catch {}
  }
  return null;
}

function downloadFileToPath(url, destination, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new NodeURL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.get(
      parsed,
      {
        headers: {
          "User-Agent": "KritakaPrajna/2",
        },
      },
      (response) => {
        const statusCode = Number(response.statusCode || 0);
        if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
          if (redirectDepth >= 5) {
            response.resume();
            reject(new Error("Too many redirects while downloading OpenCode runtime."));
            return;
          }
          const nextUrl = new NodeURL(response.headers.location, parsed).toString();
          response.resume();
          resolve(downloadFileToPath(nextUrl, destination, redirectDepth + 1));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`OpenCode runtime download failed (${statusCode}).`));
          return;
        }

        const tmpFile = `${destination}.tmp-${Date.now()}`;
        const out = fs.createWriteStream(tmpFile);

        out.on("error", (err) => {
          try { fs.unlinkSync(tmpFile); } catch {}
          reject(err);
        });

        response.on("error", (err) => {
          try { fs.unlinkSync(tmpFile); } catch {}
          reject(err);
        });

        out.on("finish", () => {
          out.close(() => {
            try {
              fs.renameSync(tmpFile, destination);
              resolve(destination);
            } catch (err) {
              try { fs.unlinkSync(tmpFile); } catch {}
              reject(err);
            }
          });
        });

        response.pipe(out);
      }
    );

    request.on("error", reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error("OpenCode runtime download timed out."));
    });
  });
}

async function ensureDownloadedOpenCodeSpec() {
  const cached = resolveDownloadedOpenCodeSpec();
  if (cached) return cached;

  if (!app?.isReady?.()) return null;
  if (opencodeState.runtimeDownloadPromise) return opencodeState.runtimeDownloadPromise;

  const downloadTask = (async () => {
    const version = getBundledOpenCodeVersion();
    const targets = getDownloadedOpenCodeBinaryPaths();
    if (targets.length === 0) return null;

    let lastError = "";
    sendOpenCodeStatus("runtime_download_start", { version });

    for (const target of targets) {
      const url = `https://cdn.jsdelivr.net/npm/${target.pkgName}@${version}/bin/${getOpenCodeBinaryName()}`;

      try {
        await fs.promises.mkdir(path.dirname(target.filePath), { recursive: true });
        await downloadFileToPath(url, target.filePath);
        if (process.platform !== "win32") {
          try {
            await fs.promises.chmod(target.filePath, 0o755);
          } catch {}
        }

        const spec = {
          command: target.filePath,
          args: [],
          env: {},
          source: "downloaded",
          packageName: target.pkgName,
        };

        sendOpenCodeStatus("runtime_downloaded", {
          packageName: target.pkgName,
          version,
        });

        return spec;
      } catch (err) {
        lastError = String(err?.message || err || "");
      }
    }

    if (lastError) {
      sendOpenCodeStatus("runtime_download_failed", { message: lastError });
    }

    return null;
  })();

  opencodeState.runtimeDownloadPromise = downloadTask;
  try {
    return await downloadTask;
  } finally {
    opencodeState.runtimeDownloadPromise = null;
  }
}

function sanitizeOpenCodePayload(payload = {}) {
  const provider = String(payload?.provider || "").trim();
  const model = String(payload?.model || "").trim();
  const providerConfig = payload?.providerConfig && typeof payload.providerConfig === "object"
    ? payload.providerConfig
    : {};
  return {
    requestId: String(payload?.requestId || "").trim(),
    sessionId: String(payload?.sessionId || "").trim(),
    prompt: safeString(payload?.prompt),
    workspacePath: String(payload?.workspacePath || "").trim(),
    context: Array.isArray(payload?.context) ? payload.context : [],
    memory: payload?.memory && typeof payload.memory === "object" ? payload.memory : {},
    model,
    provider,
    providerConfig,
    policy: {
      noAutoRun: true,
      avoidReplanning: true,
      maxPlanDepth: 4,
      optimizeLatency: true,
      optimizeCost: true,
    },
  };
}

function buildOpenCodeSpawnSpec() {
  const envRaw = process.env.OPENCODE_CMD;
  if (typeof envRaw === "string") {
    const raw = envRaw.trim();
    if (raw) {
      if (raw.startsWith("[") || raw.startsWith("{")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return {
              command: String(parsed[0] || "opencode"),
              args: parsed.slice(1).map((a) => String(a || "")),
              env: {},
              source: "env",
            };
          }
        } catch {}
      }
      const parts = raw.split(/\s+/).filter(Boolean);
      return { command: parts[0] || "opencode", args: parts.slice(1), env: {}, source: "env" };
    }
  }

  const bundledBinary = resolveBundledOpenCodeBinarySpec();
  if (bundledBinary) return bundledBinary;

  const downloaded = resolveDownloadedOpenCodeSpec();
  if (downloaded) return downloaded;

  const bundled = resolveBundledOpenCodeSpec();
  if (bundled) return bundled;

  return { command: "opencode", args: [], env: {}, source: "global" };
}

function buildOpenCodeServeSpec() {
  const base = buildOpenCodeSpawnSpec();
  return {
    ...base,
    args: [...(Array.isArray(base.args) ? base.args : []), "serve", "--port", "0", "--hostname", "127.0.0.1", "--print-logs"],
  };
}

function buildOpenCodeRunSpec({ serverUrl, provider, model, opencodeSessionId, prompt }) {
  const base = buildOpenCodeSpawnSpec();
  const args = [
    ...(Array.isArray(base.args) ? base.args : []),
    "run",
    "--format",
    "json",
    "--agent",
    "plan",
    "--attach",
    String(serverUrl || ""),
  ];

  if (opencodeSessionId) {
    args.push("--session", String(opencodeSessionId));
  }

  const providerName = String(provider || "").trim();
  const modelName = String(model || "").trim();
  if (providerName && modelName) {
    const normalizedModel = modelName.includes("::")
      ? modelName.split("::").slice(1).join("::")
      : modelName;
    const providerPrefix = `${providerName}/`;
    const modelRef = normalizedModel.startsWith(providerPrefix)
      ? normalizedModel
      : `${providerPrefix}${normalizedModel}`;
    args.push("--model", modelRef);
  }

  args.push(String(prompt || ""));

  return {
    ...base,
    args,
  };
}

function buildProviderEnv(provider, providerConfig = {}) {
  const key = String(providerConfig?.key || "").trim();
  if (!key) return {};

  switch (String(provider || "")) {
    case "openrouter":
      return { OPENROUTER_API_KEY: key };
    case "openai":
      return { OPENAI_API_KEY: key };
    case "anthropic":
      return { ANTHROPIC_API_KEY: key };
    case "huggingface":
      return {
        HF_TOKEN: key,
        HUGGING_FACE_HUB_TOKEN: key,
        HUGGINGFACE_API_KEY: key,
      };
    case "ollama":
      return /^https?:\/\//i.test(key)
        ? { OLLAMA_HOST: key }
        : { OLLAMA_API_KEY: key };
    default:
      return {};
  }
}

function extractSuggestedCommand(text = "") {
  const sample = String(text || "");
  const fenceMatch = sample.match(/```(?:powershell|bash|sh|cmd|shell|zsh)?\s*\n([\s\S]*?)```/i);
  if (!fenceMatch) return "";
  const block = String(fenceMatch[1] || "").trim();
  return block;
}

function isMissingBinaryError(message = "") {
  const msg = String(message || "").toLowerCase();
  return (
    msg.includes("enoent") ||
    msg.includes("not recognized") ||
    msg.includes("not found") ||
    msg.includes("cannot find")
  );
}

function isMissingOpenCodeRuntimeMessage(message = "") {
  const msg = String(message || "").toLowerCase();
  return (
    msg.includes("failed to install the right version of the opencode cli") ||
    msg.includes("manually installing")
  );
}

function buildOpenCodeMissingBinaryMessage() {
  const source = String(opencodeState.spawnSpec?.source || "");
  const command = String(opencodeState.spawnSpec?.command || "opencode");
  if (source === "downloaded") {
    return "Downloaded OpenCode runtime is unavailable. The app will retry downloading it automatically.";
  }
  if (source === "bundled-binary") {
    return "Bundled OpenCode platform runtime is missing. The app will download a runtime automatically.";
  }
  if (source === "bundled") {
    return "Bundled OpenCode runtime wrapper is present but platform binary is missing. The app will download it automatically.";
  }
  if (source === "env") {
    return `OpenCode command from OPENCODE_CMD failed to start. Tried: ${command}`;
  }
  return `OpenCode binary not found on PATH. Tried: ${command}. The app will auto-download a runtime.`;
}

function sendOpenCodeStatus(type, details = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("opencode-status", {
      type,
      timestamp: Date.now(),
      ...details,
    });
  }
}

function sendOpenCodeEvent(event = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("opencode-event", {
      timestamp: Date.now(),
      ...event,
    });
  }
}

function resolveOpenCodeSessionId(eventObj = {}) {
  const candidate =
    eventObj?.sessionID ||
    eventObj?.sessionId ||
    eventObj?.session ||
    eventObj?.data?.sessionID ||
    eventObj?.data?.sessionId ||
    eventObj?.data?.session;
  return String(candidate || "").trim();
}

function extractRunText(payload = {}) {
  const seen = new WeakSet();

  const pick = (value) => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);

    if (Array.isArray(value)) {
      const parts = value
        .map((item) => pick(item))
        .map((part) => String(part || ""))
        .filter((part) => part.trim().length > 0);
      return parts.join("");
    }

    if (typeof value !== "object") return "";
    if (seen.has(value)) return "";
    seen.add(value);

    const candidates = [
      value.text,
      value.message,
      value.delta,
      value.output,
      value.chunk,
      value.content,
      value.response,
      value.result,
      value.answer,
      value.value,
      value.part,
      value.parts,
      value.items,
      value.data,
    ];

    for (const candidate of candidates) {
      const text = pick(candidate);
      if (String(text || "").trim().length > 0) return text;
    }

    return "";
  };

  return String(pick(payload) || "");
}

function humanizeEventTypeLabel(value = "") {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  return cleaned
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

function appendRunOutput(runState, text) {
  const chunk = String(text || "");
  if (!chunk) return;

  runState.outputText += chunk;
  if (runState.outputText.length > OPENCODE_MAX_RUN_OUTPUT_CHARS) {
    runState.outputText = runState.outputText.slice(-OPENCODE_MAX_RUN_OUTPUT_CHARS);
  }
}

function normalizeFinalRunText(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      const extracted = String(extractRunText(parsed) || "").trim();
      if (extracted) return extracted;
    } catch {}
  }

  return raw;
}

function emitOpenCodeRunTerminalEvent(requestId, chatSessionId, stream, text) {
  const terminalText = String(text || "").trim();
  if (!terminalText) return;

  const suggestedCommand = extractSuggestedCommand(terminalText);
  sendOpenCodeEvent({
    type: "terminal",
    requestId,
    sessionId: chatSessionId,
    data: {
      stream,
      text: terminalText,
      ...(suggestedCommand ? { suggestedCommand } : {}),
    },
  });
}

function processOpenCodeRunJsonEvent({ requestId, chatSessionId, runState, eventObj }) {
  const rawType = String(eventObj?.type || eventObj?.event || "").toLowerCase().trim();
  const type = (rawType || "").replace(/-/g, "_") || "step_update";
  const data = eventObj?.data && typeof eventObj.data === "object" ? eventObj.data : eventObj;

  const openCodeSessionId = resolveOpenCodeSessionId(eventObj) || resolveOpenCodeSessionId(data);
  if (openCodeSessionId) {
    runState.opencodeSessionId = openCodeSessionId;
    opencodeState.chatSessionMap.set(chatSessionId, openCodeSessionId);
  }

  if (type === "plan") {
    sendOpenCodeEvent({ type: "plan", requestId, sessionId: chatSessionId, data });
    return;
  }

  if (!rawType) {
    const text = extractRunText(data);
    if (text) {
      appendRunOutput(runState, text);
      emitOpenCodeRunTerminalEvent(requestId, chatSessionId, "stdout", text);
      return;
    }
  }

  if (type === "result" || type === "done" || type === "final") {
    const text = extractRunText(data) || extractRunText(eventObj);
    if (text) {
      appendRunOutput(runState, text);
      emitOpenCodeRunTerminalEvent(requestId, chatSessionId, "stdout", text);
    }
    return;
  }

  if (type === "step_start") {
    const step = safeString(
      data?.title ||
      data?.step ||
      data?.name ||
      data?.part?.title ||
      data?.part?.name ||
      humanizeEventTypeLabel(data?.part?.type || eventObj?.part?.type) ||
      "Working"
    );
    sendOpenCodeEvent({
      type: "step_start",
      requestId,
      sessionId: chatSessionId,
      data: { step, title: step },
    });
    return;
  }

  if (type === "step_finish") {
    const details = safeString(
      data?.message ||
      data?.details ||
      data?.part?.reason ||
      ""
    ).trim();
    if (details) {
      sendOpenCodeEvent({
        type: "step_update",
        requestId,
        sessionId: chatSessionId,
        data: {
          step: safeString(data?.title || data?.step || data?.name || ""),
          details,
        },
      });
    }
    const text = extractRunText(data) || extractRunText(eventObj);
    if (text) {
      appendRunOutput(runState, text);
      emitOpenCodeRunTerminalEvent(requestId, chatSessionId, "stdout", text);
    }
    return;
  }

  if (type === "text" || type === "delta" || type === "assistant" || type === "output" || type === "message") {
    const text = extractRunText(data) || extractRunText(eventObj);
    if (text) {
      appendRunOutput(runState, text);
      emitOpenCodeRunTerminalEvent(requestId, chatSessionId, "stdout", text);
    }
    return;
  }

  if (type === "terminal" || type === "stdout" || type === "stderr") {
    const text = extractRunText(data) || extractRunText(eventObj);
    if (text) {
      const stream = type === "stderr" ? "stderr" : "stdout";
      emitOpenCodeRunTerminalEvent(requestId, chatSessionId, stream, text);
      if (stream === "stdout") appendRunOutput(runState, text);
    }
    return;
  }

  if (type === "error" || type === "fatal") {
    const message = safeString(data?.message || data?.error || eventObj?.message || eventObj?.error || eventObj).trim() || "Agent failed.";
    runState.hadError = true;
    runState.errorMessage = message;
    sendOpenCodeEvent({
      type: "error",
      requestId,
      sessionId: chatSessionId,
      data: { message },
    });
    return;
  }

  const details = safeString(data?.message || data?.details || extractRunText(data) || "").trim();
  if (details) {
    sendOpenCodeEvent({
      type: "step_update",
      requestId,
      sessionId: chatSessionId,
      data: {
        step: safeString(data?.title || data?.step || data?.name || ""),
        details,
      },
    });
  }
}

function processOpenCodeRunLine({ requestId, chatSessionId, runState, stream, line }) {
  const textLine = String(line || "").trim();
  if (!textLine) return;

  let parsed = null;
  if (textLine.startsWith("{")) {
    try {
      parsed = JSON.parse(textLine);
    } catch {}
  }

  if (parsed && typeof parsed === "object") {
    processOpenCodeRunJsonEvent({ requestId, chatSessionId, runState, eventObj: parsed });
    return;
  }

  emitOpenCodeRunTerminalEvent(requestId, chatSessionId, stream, textLine);
  if (stream === "stdout") appendRunOutput(runState, `${textLine}\n`);
}

function consumeOpenCodeRunChunk({ requestId, chatSessionId, runState, stream, chunk }) {
  const key = stream === "stderr" ? "stderrBuffer" : "stdoutBuffer";
  runState[key] += chunk.toString("utf-8");

  if (runState[key].length > OPENCODE_MAX_STDIO_BUFFER) {
    runState[key] = runState[key].slice(-OPENCODE_MAX_STDIO_BUFFER);
  }

  const lines = runState[key].split(/\r?\n/);
  runState[key] = lines.pop() || "";

  for (const line of lines) {
    processOpenCodeRunLine({ requestId, chatSessionId, runState, stream, line });
  }
}

function flushOpenCodeRunRemainder(requestId, runState) {
  const chatSessionId = runState.chatSessionId;
  if (runState.stdoutBuffer) {
    processOpenCodeRunLine({
      requestId,
      chatSessionId,
      runState,
      stream: "stdout",
      line: runState.stdoutBuffer,
    });
    runState.stdoutBuffer = "";
  }

  if (runState.stderrBuffer) {
    processOpenCodeRunLine({
      requestId,
      chatSessionId,
      runState,
      stream: "stderr",
      line: runState.stderrBuffer,
    });
    runState.stderrBuffer = "";
  }
}

function finalizeOpenCodeRun(requestId, runState, code, signal) {
  if (!runState) return;

  flushOpenCodeRunRemainder(requestId, runState);
  opencodeState.activeRuns.delete(requestId);

  const chatSessionId = runState.chatSessionId;
  const exitCode = Number.isInteger(code) ? code : -1;
  const stderrTail = String(runState.stderrTail || "").trim();

  if (runState.hadError || exitCode !== 0) {
    const message = runState.errorMessage || stderrTail || `OpenCode run stopped (exit ${exitCode}).`;
    if (!runState.hadError) {
      sendOpenCodeEvent({
        type: "error",
        requestId,
        sessionId: chatSessionId,
        data: { message },
      });
    }
    sendOpenCodeStatus("run_stopped", {
      requestId,
      sessionId: chatSessionId,
      code: exitCode,
      signal: signal || null,
      message,
    });
    return;
  }

  const finalText = normalizeFinalRunText(runState.outputText);
  if (!finalText) {
    const message = "Agent returned an empty response. Try another model or provider.";
    sendOpenCodeEvent({
      type: "error",
      requestId,
      sessionId: chatSessionId,
      data: { message },
    });
    sendOpenCodeStatus("run_stopped", {
      requestId,
      sessionId: chatSessionId,
      code: 0,
      signal: signal || null,
      message,
    });
    return;
  }

  sendOpenCodeEvent({
    type: "result",
    requestId,
    sessionId: chatSessionId,
    data: { text: finalText },
  });

  sendOpenCodeStatus("run_stopped", {
    requestId,
    sessionId: chatSessionId,
    code: 0,
    signal: signal || null,
  });
}

function handleOpenCodeStdoutChunk(chunk) {
  const rawText = chunk.toString("utf-8");
  opencodeState.stdoutBuffer += rawText;
  if (opencodeState.stdoutBuffer.length > OPENCODE_MAX_STDIO_BUFFER) {
    opencodeState.stdoutBuffer = opencodeState.stdoutBuffer.slice(-OPENCODE_MAX_STDIO_BUFFER);
  }

  const lines = opencodeState.stdoutBuffer.split(/\r?\n/);
  opencodeState.stdoutBuffer = lines.pop() || "";

  for (const line of lines) {
    const text = String(line || "").trim();
    if (!text) continue;

    const urlMatch = text.match(/opencode server listening on\s+(https?:\/\/\S+)/i);
    if (urlMatch?.[1]) {
      const url = String(urlMatch[1]).trim();
      opencodeState.serverUrl = url;
      opencodeState.ready = true;
      sendOpenCodeStatus("ready", { url });
    }

    sendOpenCodeEvent({
      type: "terminal",
      requestId: "__server",
      sessionId: "",
      data: { stream: "stdout", text },
    });
  }
}

function handleOpenCodeStderrChunk(chunk) {
  const rawText = chunk.toString("utf-8");
  opencodeState.stderrBuffer += rawText;
  if (opencodeState.stderrBuffer.length > OPENCODE_MAX_STDIO_BUFFER) {
    opencodeState.stderrBuffer = opencodeState.stderrBuffer.slice(-OPENCODE_MAX_STDIO_BUFFER);
  }

  const lines = opencodeState.stderrBuffer.split(/\r?\n/);
  opencodeState.stderrBuffer = lines.pop() || "";

  for (const line of lines) {
    const text = String(line || "").trim();
    if (!text) continue;

    const urlMatch = text.match(/opencode server listening on\s+(https?:\/\/\S+)/i);
    if (urlMatch?.[1]) {
      const url = String(urlMatch[1]).trim();
      opencodeState.serverUrl = url;
      opencodeState.ready = true;
      sendOpenCodeStatus("ready", { url });
    }

    sendOpenCodeEvent({
      type: "terminal",
      requestId: "__server",
      sessionId: "",
      data: { stream: "stderr", text },
    });
  }
}

function ensureOpenCodeProcess() {
  if (opencodeState.proc && !opencodeState.proc.killed) return true;

  const spec = buildOpenCodeServeSpec();
  opencodeState.missingBinary = false;
  opencodeState.spawnSpec = spec;
  opencodeState.serverUrl = "";

  let proc;
  try {
    proc = spawn(spec.command, spec.args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        ...(spec.env || {}),
      },
    });
  } catch (err) {
    opencodeState.lastError = err?.message || "Failed to start OpenCode process";
    opencodeState.missingBinary = isMissingBinaryError(opencodeState.lastError);
    sendOpenCodeStatus("spawn_error", { message: opencodeState.lastError });
    return false;
  }

  opencodeState.proc = proc;
  opencodeState.ready = false;
  opencodeState.startedAt = Date.now();
  opencodeState.stdoutBuffer = "";
  opencodeState.stderrBuffer = "";
  opencodeState.lastError = "";

  proc.once("spawn", () => {
    sendOpenCodeStatus("started", {
      command: spec.command,
      args: spec.args,
      pid: proc.pid,
      source: spec.source || "unknown",
    });
  });

  proc.stdout.on("data", handleOpenCodeStdoutChunk);
  proc.stderr.on("data", handleOpenCodeStderrChunk);

  proc.on("error", (err) => {
    opencodeState.lastError = err?.message || "OpenCode process error";
    if (isMissingBinaryError(opencodeState.lastError)) {
      opencodeState.missingBinary = true;
    }
    sendOpenCodeStatus("spawn_error", { message: opencodeState.lastError });
  });

  proc.on("close", (code, signal) => {
    const stderrTail = String(opencodeState.stderrBuffer || "")
      .trim()
      .split(/\r?\n/)
      .slice(-1)[0] || "";
    const detailMessage = opencodeState.lastError || stderrTail || "OpenCode process stopped.";
    if (isMissingOpenCodeRuntimeMessage(detailMessage)) {
      opencodeState.missingBinary = true;
    }
    const shouldRestart =
      !opencodeState.shuttingDown &&
      !opencodeState.missingBinary &&
      !isMissingBinaryError(detailMessage);

    for (const [requestId, runState] of opencodeState.activeRuns.entries()) {
      if (runState.proc && !runState.proc.killed) {
        try {
          runState.proc.kill("SIGTERM");
        } catch {}
      }
      sendOpenCodeEvent({
        type: "error",
        requestId,
        sessionId: runState.chatSessionId,
        data: { message: "OpenCode process stopped." },
      });
    }
    opencodeState.activeRuns.clear();

    opencodeState.proc = null;
    opencodeState.ready = false;
    opencodeState.serverUrl = "";
    sendOpenCodeStatus("stopped", {
      code: code ?? -1,
      signal: signal || null,
      message: detailMessage,
      command: opencodeState.spawnSpec?.command || "opencode",
    });

    if (shouldRestart) {
      clearTimeout(opencodeState.restartTimer);
      opencodeState.restartTimer = setTimeout(() => {
        ensureOpenCodeProcess();
      }, 1200);
    }
  });

  return true;
}

async function ensureOpenCodeReady(timeoutMs = OPENCODE_READY_TIMEOUT_MS) {
  let started = ensureOpenCodeProcess();

  if (!started && opencodeState.missingBinary) {
    const downloaded = await ensureDownloadedOpenCodeSpec();
    if (downloaded) {
      started = ensureOpenCodeProcess();
    }
  }

  if (!started) return false;
  if (opencodeState.ready && opencodeState.serverUrl) return true;

  const startTs = Date.now();
  while (Date.now() - startTs < timeoutMs) {
    if (!opencodeState.proc || opencodeState.proc.killed) {
      if (opencodeState.missingBinary) {
        const downloaded = await ensureDownloadedOpenCodeSpec();
        if (downloaded) {
          const restarted = ensureOpenCodeProcess();
          if (restarted) continue;
        }
      }
      return false;
    }
    if (opencodeState.ready && opencodeState.serverUrl) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return !!(opencodeState.ready && opencodeState.serverUrl);
}

function stopOpenCodeProcess() {
  opencodeState.shuttingDown = true;
  clearTimeout(opencodeState.restartTimer);

  for (const [, runState] of opencodeState.activeRuns.entries()) {
    if (runState.abortController && typeof runState.abortController.abort === "function") {
      try {
        runState.abortController.abort();
      } catch {}
    }
    if (runState.proc && !runState.proc.killed) {
      try {
        runState.proc.kill("SIGTERM");
        if (process.platform === "win32") runState.proc.kill("SIGKILL");
      } catch {}
    }
  }
  opencodeState.activeRuns.clear();

  if (opencodeState.proc && !opencodeState.proc.killed) {
    try {
      opencodeState.proc.kill("SIGTERM");
      if (process.platform === "win32") opencodeState.proc.kill("SIGKILL");
    } catch {}
  }

  opencodeState.proc = null;
  opencodeState.ready = false;
  opencodeState.serverUrl = "";
}

function createWindow() {
  Menu.setApplicationMenu(null);

  // ── CSP: restrict what the renderer can load/connect to ────────────────────
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob: https:; " +
          "connect-src https://openrouter.ai https://api.openai.com https://api.anthropic.com https://router.huggingface.co https://huggingface.co https://ollama.com http://127.0.0.1:11434 http://localhost:11434; " +
          "font-src 'self' data:; " +
          "media-src blob:; " +
          "object-src 'none'; " +
          "base-uri 'none';",
        ],
      },
    });
  });

  // ── Block all permission requests (camera, mic, geolocation, etc.) ──────────
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  const win = new BrowserWindow({
    title: "KritakaPrajna",
    width: 1000,
    height: 700,
    frame: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "../assets/logo.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
      backgroundThrottling: false,
    },
  });

  mainWindow = win;

  // ── Block renderer from navigating away from the app ────────────────────────
  win.webContents.on("will-navigate", (event, url) => {
    const appUrl = app.isPackaged ? "file://" : "http://localhost:3000";
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
    }
  });

  // ── Block new windows / popups ───────────────────────────────────────────────
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "../build/index.html"));
  } else {
    win.loadURL("http://localhost:3000");
  }
}

// ── IPC handlers — registered inside app.whenReady() to guarantee ipcMain is live
function registerIpcHandlers() {

// ── IPC: pick a folder ──────────────────────────────────────────────────────
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  allowedBasePath = result.filePaths[0]; // update write-access scope
  return allowedBasePath;
});

ipcMain.handle("set-workspace-base", async (_event, folderPath) => {
  const raw = typeof folderPath === "string" ? folderPath.trim() : "";
  if (!raw) {
    return { ok: false, error: "Workspace path is required." };
  }

  try {
    const resolved = path.resolve(raw);
    const stat = await fs.promises.stat(resolved);
    if (!stat.isDirectory()) {
      return { ok: false, error: "Workspace path must be a directory." };
    }
    allowedBasePath = resolved;
    return { ok: true, path: allowedBasePath };
  } catch (err) {
    return { ok: false, error: err?.message || "Unable to set workspace base path." };
  }
});

// ── Path validation helper ───────────────────────────────────────────────────
function isSameOrSubPath(basePath, targetPath) {
  const baseResolved = path.resolve(String(basePath || ""));
  const targetResolved = path.resolve(String(targetPath || ""));
  if (!baseResolved || !targetResolved) return false;

  if (process.platform === "win32") {
    const baseLower = baseResolved.toLowerCase();
    const targetLower = targetResolved.toLowerCase();
    return targetLower === baseLower || targetLower.startsWith(baseLower + path.sep.toLowerCase());
  }

  return targetResolved === baseResolved || targetResolved.startsWith(baseResolved + path.sep);
}

function isPathAllowed(targetPath) {
  if (!allowedBasePath) return false;
  return isSameOrSubPath(allowedBasePath, targetPath);
}

// ── IPC: read directory tree (1 level deep for lazy loading) ────────────────
ipcMain.handle("read-dir", async (_event, dirPath) => {
  if (!isPathAllowed(dirPath)) return [];
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        isDir: e.isDirectory(),
      }));
  } catch {
    return [];
  }
});

// ── IPC: read a file (with size limit) ──────────────────────────────────────
ipcMain.handle("read-file", async (_event, filePath) => {
  if (!isPathAllowed(filePath)) return { error: "Access denied: file is outside the opened folder", content: null, size: 0 };
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return { error: "File too large (max 5 MB)", content: null, size: stat.size };
    }
    const content = await fs.promises.readFile(filePath, "utf-8");
    return { error: null, content, size: stat.size };
  } catch (err) {
    return { error: err.message, content: null, size: 0 };
  }
});

// ── IPC: extract text from PDF (buffer — works for any user-selected file) ───
ipcMain.handle("extract-pdf-text-buffer", async (_event, arrayBuffer) => {
  try {
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > MAX_FILE_SIZE) {
      return { error: "PDF too large (max 5 MB)", text: null };
    }
    if (typeof globalThis.DOMMatrix === "undefined") {
      globalThis.DOMMatrix = class DOMMatrix {
        constructor(init) {
          this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0;
          this.m11=1;this.m12=0;this.m13=0;this.m14=0;
          this.m21=0;this.m22=1;this.m23=0;this.m24=0;
          this.m31=0;this.m32=0;this.m33=1;this.m34=0;
          this.m41=0;this.m42=0;this.m43=0;this.m44=1;
          if (Array.isArray(init) && init.length === 6) {
            [this.a,this.b,this.c,this.d,this.e,this.f]=init;
          }
        }
        multiply() { return new globalThis.DOMMatrix(); }
        translate(x=0,y=0) { return new globalThis.DOMMatrix([this.a,this.b,this.c,this.d,this.e+x,this.f+y]); }
        scale(sx=1,sy=1) { return new globalThis.DOMMatrix([this.a*sx,this.b,this.c,this.d*sy,this.e,this.f]); }
        rotate() { return new globalThis.DOMMatrix(); }
        transformPoint(p={}) { return { x: (p.x||0)*this.a+this.e, y: (p.y||0)*this.d+this.f, w: p.w||1 }; }
        static fromMatrix(m) { return new globalThis.DOMMatrix(); }
        static fromFloat32Array(a) { return new globalThis.DOMMatrix(Array.from(a)); }
        static fromFloat64Array(a) { return new globalThis.DOMMatrix(Array.from(a)); }
      };
    }
    const _pdfMod = require("pdf-parse");
    const pdfParse = typeof _pdfMod === "function" ? _pdfMod : (_pdfMod.default || _pdfMod);
    const pagerender = (pageData) =>
      pageData.getTextContent().then((tc) => {
        let lastY = null, text = "";
        for (const item of tc.items) {
          if (lastY !== null && item.transform[5] !== lastY) text += "\n";
          text += item.str;
          lastY = item.transform[5];
        }
        return text;
      });
    const data = await pdfParse(buffer, { pagerender });
    return { error: null, text: data.text, pages: data.numpages };
  } catch (err) {
    return { error: err.message, text: null };
  }
});

// ── IPC: extract text from PDF ──────────────────────────────────────────────
ipcMain.handle("extract-pdf-text", async (_event, filePath) => {
  if (!isPathAllowed(filePath)) return { error: "Access denied: file is outside the opened folder", text: null };
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return { error: "PDF too large (max 5 MB)", text: null };
    }
    // pdf-parse uses PDF.js which needs DOMMatrix — polyfill it for Node/Electron main process
    if (typeof globalThis.DOMMatrix === "undefined") {
      globalThis.DOMMatrix = class DOMMatrix {
        constructor(init) {
          this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0;
          this.m11=1;this.m12=0;this.m13=0;this.m14=0;
          this.m21=0;this.m22=1;this.m23=0;this.m24=0;
          this.m31=0;this.m32=0;this.m33=1;this.m34=0;
          this.m41=0;this.m42=0;this.m43=0;this.m44=1;
          if (Array.isArray(init) && init.length === 6) {
            [this.a,this.b,this.c,this.d,this.e,this.f]=init;
          }
        }
        multiply() { return new globalThis.DOMMatrix(); }
        translate(x=0,y=0) { return new globalThis.DOMMatrix([this.a,this.b,this.c,this.d,this.e+x,this.f+y]); }
        scale(sx=1,sy=1) { return new globalThis.DOMMatrix([this.a*sx,this.b,this.c,this.d*sy,this.e,this.f]); }
        rotate() { return new globalThis.DOMMatrix(); }
        transformPoint(p={}) { return { x: (p.x||0)*this.a+this.e, y: (p.y||0)*this.d+this.f, w: p.w||1 }; }
        static fromMatrix(m) { return new globalThis.DOMMatrix(); }
        static fromFloat32Array(a) { return new globalThis.DOMMatrix(Array.from(a)); }
        static fromFloat64Array(a) { return new globalThis.DOMMatrix(Array.from(a)); }
      };
    }
    const _pdfMod = require("pdf-parse");
    const pdfParse = typeof _pdfMod === "function" ? _pdfMod : (_pdfMod.default || _pdfMod);
    const buffer = await fs.promises.readFile(filePath);
    const pagerender = (pageData) =>
      pageData.getTextContent().then((tc) => {
        let lastY = null, text = "";
        for (const item of tc.items) {
          if (lastY !== null && item.transform[5] !== lastY) text += "\n";
          text += item.str;
          lastY = item.transform[5];
        }
        return text;
      });
    const data = await pdfParse(buffer, { pagerender });
    return { error: null, text: data.text, pages: data.numpages };
  } catch (err) {
    return { error: err.message, text: null };
  }
});

// ── IPC: write file (for diff accept) ───────────────────────────────────────
ipcMain.handle("write-file", async (_event, filePath, content) => {
  try {
    const resolved = path.resolve(filePath);
    // Only allow writes inside the folder the user explicitly opened
    if (!allowedBasePath) {
      return { success: false, error: "No folder open — open a project folder before accepting diffs." };
    }
    if (!isSameOrSubPath(allowedBasePath, resolved)) {
      return { success: false, error: "Write denied: path is outside your opened folder." };
    }
    await fs.promises.writeFile(resolved, content, "utf-8");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: secure API key store (OS credential store via safeStorage) ─────────
ipcMain.handle("store-get-key", () => getApiKey());
ipcMain.handle("store-set-key", (_event, key) => { setApiKey(key); });
ipcMain.handle("store-remove-key", () => { removeApiKey(); });

// ── IPC: multi-provider key management ──────────────────────────────────────
const VALID_PROVIDERS = new Set(["openrouter", "openai", "anthropic", "huggingface", "ollama"]);
ipcMain.handle("provider-get-key", (_event, provider) => {
  if (!VALID_PROVIDERS.has(provider)) return null;
  return getProviderKey(provider);
});
ipcMain.handle("provider-set-key", (_event, provider, key) => {
  if (!VALID_PROVIDERS.has(provider)) return;
  if (typeof key !== "string" || key.length > 256) return;
  setProviderKey(provider, key);
});
ipcMain.handle("provider-remove-key", (_event, provider) => {
  if (!VALID_PROVIDERS.has(provider)) return;
  removeProviderKey(provider);
});
ipcMain.handle("providers-get-all", () => getAllProviderKeys());
ipcMain.handle("shortcuts-get-all", () => getKeyboardShortcuts());
ipcMain.handle("shortcuts-set-all", (_event, shortcuts) => { setKeyboardShortcuts(shortcuts); });
ipcMain.handle("shortcuts-reset-all", () => { resetKeyboardShortcuts(); });
ipcMain.handle("memory-get", () => getUserMemory());
ipcMain.handle("memory-set", (_event, memory) => { setUserMemory(memory); });
ipcMain.handle("memory-reset", () => { resetUserMemory(); });
ipcMain.handle("memory-export", async (_event, payload) => {
  try {
    const suggestedRaw = typeof payload?.suggestedName === "string" ? payload.suggestedName.trim() : "openrouter-memory.json";
    const safeFileName = (suggestedRaw || "openrouter-memory.json")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
      .slice(0, 120);
    const fileName = safeFileName.toLowerCase().endsWith(".json") ? safeFileName : `${safeFileName}.json`;
    const content = typeof payload?.content === "string" ? payload.content : "{}";

    const result = await dialog.showSaveDialog({
      title: "Export Memory",
      defaultPath: path.join(app.getPath("documents"), fileName),
      filters: [
        { name: "JSON Files", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    await fs.promises.writeFile(result.filePath, content, "utf-8");
    return { ok: true, canceled: false, path: result.filePath };
  } catch (err) {
    return { ok: false, canceled: false, error: err?.message || "Failed to export memory." };
  }
});
ipcMain.handle("ollama-api-request", async (_event, payload) => {
  try {
    const baseUrl = String(payload?.baseUrl || "").trim();
    const pathPart = String(payload?.path || "").trim();
    const method = String(payload?.method || "GET").toUpperCase();
    const reqHeaders = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
    const body = typeof payload?.body === "string" ? payload.body : "";
    const customTimeoutMs = Number(payload?.timeoutMs);

    if (!baseUrl) return { ok: false, status: 0, error: "Missing baseUrl", text: "" };

    let base;
    try { base = new NodeURL(baseUrl); }
    catch { return { ok: false, status: 0, error: "Invalid baseUrl", text: "" }; }

    if (base.protocol !== "http:" && base.protocol !== "https:") {
      return { ok: false, status: 0, error: "Unsupported protocol", text: "" };
    }

    const allowedHost =
      base.hostname === "ollama.com" ||
      base.hostname === "localhost" ||
      base.hostname === "127.0.0.1";

    if (!allowedHost) {
      return { ok: false, status: 0, error: "Host is not allowed", text: "" };
    }

    let target;
    try {
      target = new NodeURL(pathPart || "/", base.href);
    } catch {
      return { ok: false, status: 0, error: "Invalid request path", text: "" };
    }

    const client = target.protocol === "https:" ? https : http;
    const isChatRequest = /^\/api\/chat(?:$|[/?#])/i.test(target.pathname || "");
    const timeoutMs = Number.isFinite(customTimeoutMs) && customTimeoutMs >= 1000
      ? Math.min(customTimeoutMs, 15 * 60 * 1000)
      : isChatRequest
        ? 5 * 60 * 1000
        : WEB_FETCH_TIMEOUT_MS;

    const result = await new Promise((resolve) => {
      let settled = false;
      const request = client.request(
        target,
        {
          method,
          headers: {
            "User-Agent": BROWSER_UA,
            ...reqHeaders,
          },
          timeout: timeoutMs,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            if (settled) return;
            settled = true;
            const text = Buffer.concat(chunks).toString("utf-8");
            const status = Number(response.statusCode) || 0;
            resolve({
              ok: status >= 200 && status < 300,
              status,
              text,
              error: "",
            });
          });
        }
      );

      request.on("timeout", () => {
        request.destroy(new Error("Request timed out"));
      });

      request.on("error", (err) => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, status: 0, text: "", error: err?.message || "Request failed" });
      });

      if (body) request.write(body);
      request.end();
    });

    return result;
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: err?.message || "Unknown Ollama request error",
    };
  }
});
ipcMain.handle("clipboard-write-text", (_event, text) => {
  try {
    const MAX_CLIPBOARD = 1_000_000; // 1 MB cap
    const str = typeof text === "string" ? text : String(text || "");
    clipboard.writeText(str.slice(0, MAX_CLIPBOARD));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "Clipboard write failed" };
  }
});

// ── IPC: window controls ────────────────────────────────────────────────────
ipcMain.handle("window-minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle("window-maximize", () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle("window-close", () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle("get-platform-info", () => {
  const platform = process.platform;
  const preferredShell =
    platform === "win32"
      ? "powershell"
      : platform === "darwin"
        ? "zsh"
        : "bash";

  return {
    platform,
    arch: process.arch,
    release: os.release(),
    preferredShell,
    isWindows: platform === "win32",
    isMac: platform === "darwin",
    isLinux: platform === "linux",
  };
});

const NATIVE_AGENT_MAX_CONTEXT_MESSAGES = 16;
const NATIVE_AGENT_TIMEOUT_MS = 120000;

function normalizeAgentContentPart(part) {
  if (!part) return "";
  if (typeof part === "string") return part;
  if (part.type === "text" && typeof part.text === "string") return part.text;
  if (part.type === "image_url") return "[Image omitted]";
  if (typeof part.text === "string") return part.text;
  return "";
}

function normalizeAgentMessageContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(normalizeAgentContentPart).filter(Boolean).join("\n");
}

function normalizeAgentContextMessages(context) {
  if (!Array.isArray(context)) return [];
  return context
    .map((msg) => {
      const role = msg?.role === "assistant" ? "assistant" : msg?.role === "system" ? "system" : "user";
      const content = normalizeAgentMessageContent(msg?.content).trim();
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);
}

function summarizeAgentMemory(memory = {}) {
  const lines = [];
  const prefs = Array.isArray(memory.preferences) ? memory.preferences.slice(0, 5) : [];
  const coding = Array.isArray(memory.coding) ? memory.coding.slice(0, 5) : [];
  const context = Array.isArray(memory.context) ? memory.context.slice(0, 5) : [];

  if (prefs.length > 0) lines.push(`Preferences: ${prefs.join("; ")}`);
  if (coding.length > 0) lines.push(`Coding notes: ${coding.join("; ")}`);
  if (context.length > 0) lines.push(`Context notes: ${context.join("; ")}`);

  return lines.join("\n");
}

function normalizeProviderModelId(provider, modelId) {
  const raw = String(modelId || "").trim();
  if (!raw) return "";
  const cleaned = raw.includes("::") ? raw.split("::").slice(1).join("::") : raw;
  if (provider === "huggingface" && !cleaned.includes(":")) {
    return `${cleaned}:fastest`;
  }
  return cleaned;
}

function createAgentTimeoutSignal(parentSignal, timeoutMs = NATIVE_AGENT_TIMEOUT_MS) {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    },
  };
}

function parseProviderError(rawText, fallback = "Request failed") {
  const text = String(rawText || "").trim();
  if (!text) return fallback;
  try {
    const json = JSON.parse(text);
    return String(
      json?.error?.message ||
      json?.error ||
      json?.message ||
      json?.detail ||
      text ||
      fallback
    );
  } catch {
    return text;
  }
}

function extractOpenAICompatText(json = {}) {
  const message = json?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => {
        if (typeof part?.text === "string") return part.text;
        if (part?.type === "text" && typeof part?.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }

  const fallback = json?.choices?.[0]?.text;
  if (typeof fallback === "string") return fallback.trim();
  return "";
}

async function requestOpenAICompatibleCompletion({ endpoint, headers, body, signal, providerLabel }) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`${providerLabel} ${res.status}: ${parseProviderError(raw)}`);
  }

  let json;
  try {
    json = JSON.parse(raw || "{}");
  } catch {
    throw new Error(`${providerLabel}: invalid JSON response.`);
  }

  const text = extractOpenAICompatText(json);
  if (!text) {
    throw new Error(`${providerLabel} returned an empty response.`);
  }

  return text;
}

function toAnthropicMessages(messages = []) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
}

function extractAnthropicText(json = {}) {
  if (!Array.isArray(json?.content)) return "";
  return json.content
    .map((part) => (part?.type === "text" && typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function resolveOllamaConnection(configValue) {
  const raw = String(configValue || "").trim();
  if (!raw) return { baseUrl: "http://127.0.0.1:11434", apiKey: "" };

  const looksLikeUrl =
    /^https?:\/\//i.test(raw) ||
    raw.includes("localhost") ||
    raw.includes("127.0.0.1");

  if (looksLikeUrl) {
    const baseUrl = (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, "");
    return { baseUrl, apiKey: "" };
  }

  return { baseUrl: "https://ollama.com", apiKey: raw };
}

async function requestAgentCompletion({ provider, model, key, messages, signal }) {
  const normalizedProvider = String(provider || "openrouter").trim() || "openrouter";
  const normalizedModel = normalizeProviderModelId(normalizedProvider, model);
  if (!normalizedModel) throw new Error("Model is required for Agent mode.");

  const timed = createAgentTimeoutSignal(signal, NATIVE_AGENT_TIMEOUT_MS);
  try {
    if (normalizedProvider === "openrouter") {
      if (!key) throw new Error("OpenRouter API key is missing.");
      return await requestOpenAICompatibleCompletion({
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://KritakaPrajna.app",
          "X-Title": "KritakaPrajna",
        },
        body: {
          model: normalizedModel,
          messages,
          stream: false,
          max_tokens: 1400,
          temperature: 0.2,
          top_p: 0.9,
        },
        signal: timed.signal,
        providerLabel: "OpenRouter",
      });
    }

    if (normalizedProvider === "openai") {
      if (!key) throw new Error("OpenAI API key is missing.");
      return await requestOpenAICompatibleCompletion({
        endpoint: "https://api.openai.com/v1/chat/completions",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: {
          model: normalizedModel,
          messages,
          stream: false,
          max_tokens: 1400,
          temperature: 0.2,
          top_p: 0.9,
        },
        signal: timed.signal,
        providerLabel: "OpenAI",
      });
    }

    if (normalizedProvider === "huggingface") {
      if (!key) throw new Error("Hugging Face API key is missing.");
      return await requestOpenAICompatibleCompletion({
        endpoint: "https://router.huggingface.co/v1/chat/completions",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: {
          model: normalizedModel,
          messages,
          stream: false,
          max_tokens: 1400,
          temperature: 0.2,
          top_p: 0.9,
        },
        signal: timed.signal,
        providerLabel: "HuggingFace",
      });
    }

    if (normalizedProvider === "anthropic") {
      if (!key) throw new Error("Anthropic API key is missing.");

      const system = messages.find((m) => m.role === "system")?.content || "";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: normalizedModel,
          max_tokens: 1400,
          temperature: 0.2,
          messages: toAnthropicMessages(messages),
          ...(system ? { system } : {}),
        }),
        signal: timed.signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`Anthropic ${res.status}: ${parseProviderError(raw)}`);
      }

      let json;
      try {
        json = JSON.parse(raw || "{}");
      } catch {
        throw new Error("Anthropic: invalid JSON response.");
      }

      const text = extractAnthropicText(json);
      if (!text) {
        throw new Error("Anthropic returned an empty response.");
      }

      return text;
    }

    if (normalizedProvider === "ollama") {
      const { baseUrl, apiKey } = resolveOllamaConnection(key);
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: normalizedModel,
          messages: messages.filter((m) => m.role === "system" || m.role === "assistant" || m.role === "user"),
          stream: false,
          options: {
            num_predict: 1400,
            temperature: 0.2,
            top_p: 0.9,
          },
        }),
        signal: timed.signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`Ollama ${res.status}: ${parseProviderError(raw)}`);
      }

      let json;
      try {
        json = JSON.parse(raw || "{}");
      } catch {
        throw new Error("Ollama: invalid JSON response.");
      }

      const text = String(json?.message?.content || json?.response || "").trim();
      if (!text) {
        throw new Error("Ollama returned an empty response.");
      }

      return text;
    }

    throw new Error(`Unsupported provider for Agent mode: ${normalizedProvider}`);
  } finally {
    timed.cleanup();
  }
}

function normalizePlanItems(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|;/)
      : [];

  return source
    .map((item) => String(item == null ? "" : item).replace(/^[\-\s\d\.\)]+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function buildFallbackPlan(prompt = "") {
  const codingLike = /\b(code|bug|fix|refactor|build|test|error|file|workspace|compile)\b/i.test(String(prompt));
  if (codingLike) {
    return [
      "Understand the coding task and constraints",
      "Identify relevant files or components",
      "Propose concrete implementation steps",
      "Deliver the final solution and checks",
    ];
  }

  return [
    "Understand the request",
    "Plan the response",
    "Provide the best actionable answer",
  ];
}

function extractJsonCandidate(rawText = "") {
  const text = String(rawText || "").trim();
  if (!text) return "";

  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  if (text.startsWith("{") && text.endsWith("}")) return text;

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return text.slice(first, last + 1).trim();
  }

  return "";
}

function parseAgentModelResponse(rawText, prompt) {
  const raw = String(rawText || "").trim();
  const jsonCandidate = extractJsonCandidate(raw);

  let parsed = null;
  if (jsonCandidate) {
    try {
      parsed = JSON.parse(jsonCandidate);
    } catch {}
  }

  const plan = normalizePlanItems(parsed?.plan || parsed?.steps || parsed?.todo);
  const answerCandidate =
    parsed?.answer ||
    parsed?.response ||
    parsed?.result ||
    parsed?.final ||
    parsed?.text ||
    "";
  let answer = String(answerCandidate || "").trim();
  if (!answer) answer = raw;

  const step = String(parsed?.step || parsed?.currentStep || parsed?.current_step || "").trim();
  let command = String(parsed?.command || parsed?.suggestedCommand || "").trim();
  if (!command) command = extractSuggestedCommand(answer);

  return {
    plan: plan.length > 0 ? plan : buildFallbackPlan(prompt),
    step,
    answer,
    command,
  };
}

function buildNativeAgentMessages(data) {
  const memorySummary = summarizeAgentMemory(data.memory);
  const contextMessages = normalizeAgentContextMessages(data.context).slice(-NATIVE_AGENT_MAX_CONTEXT_MESSAGES);

  const systemPrompt = [
    "You are KritakaPrajna Agent, an in-app coding assistant.",
    "Return ONLY valid JSON without markdown fences.",
    "JSON schema:",
    '{"plan":["step 1","step 2"],"step":"current step","answer":"final answer","command":"optional shell command"}',
    "Rules:",
    "- plan must contain 2-6 concise actionable steps.",
    "- answer must be practical and directly useful.",
    "- command must be empty unless a shell command is clearly needed.",
  ].join("\n");

  const requestSections = [];
  if (data.workspacePath) {
    requestSections.push(`Workspace folder: ${data.workspacePath}`);
  }
  if (memorySummary) {
    requestSections.push(`User memory:\n${memorySummary}`);
  }
  requestSections.push(`User request:\n${String(data.prompt || "").trim()}`);
  requestSections.push("Output JSON only.");

  return [
    { role: "system", content: systemPrompt },
    ...contextMessages,
    { role: "user", content: requestSections.join("\n\n") },
  ];
}

async function runNativeAgentRequest(data, runState) {
  const requestId = data.requestId;
  const sessionId = data.sessionId;

  try {
    sendOpenCodeStatus("run_started", {
      requestId,
      sessionId,
      pid: process.pid,
      provider: data.provider,
      model: data.model,
      cwd: data.workspacePath || null,
      source: "native-agent",
    });

    sendOpenCodeEvent({
      type: "step_start",
      requestId,
      sessionId,
      data: { step: "Planning response" },
    });

    const messages = buildNativeAgentMessages(data);
    const rawResponse = await requestAgentCompletion({
      provider: data.provider,
      model: data.model,
      key: data.providerConfig?.key,
      messages,
      signal: runState.abortController?.signal,
    });

    if (runState.cancelled || runState.abortController?.signal?.aborted) {
      sendOpenCodeStatus("run_stopped", {
        requestId,
        sessionId,
        code: 130,
        signal: "SIGTERM",
        message: "Agent run cancelled.",
      });
      return;
    }

    const parsed = parseAgentModelResponse(rawResponse, data.prompt);
    sendOpenCodeEvent({
      type: "plan",
      requestId,
      sessionId,
      data: { steps: parsed.plan },
    });

    sendOpenCodeEvent({
      type: "step_start",
      requestId,
      sessionId,
      data: { step: parsed.step || "Drafting final answer" },
    });

    if (parsed.command) {
      sendOpenCodeEvent({
        type: "terminal",
        requestId,
        sessionId,
        data: {
          text: `Suggested command:\n${parsed.command}`,
          suggestedCommand: parsed.command,
        },
      });
    }

    const finalText = normalizeFinalRunText(parsed.answer);
    if (!finalText) {
      throw new Error("Agent returned an empty response.");
    }

    sendOpenCodeEvent({
      type: "result",
      requestId,
      sessionId,
      data: { text: finalText },
    });

    sendOpenCodeStatus("run_stopped", {
      requestId,
      sessionId,
      code: 0,
      signal: null,
      source: "native-agent",
    });
  } catch (err) {
    const aborted = runState.cancelled || runState.abortController?.signal?.aborted;
    const message = String(err?.message || "Agent run failed.");
    if (!aborted) {
      sendOpenCodeEvent({
        type: "error",
        requestId,
        sessionId,
        data: { message },
      });
    }
    sendOpenCodeStatus("run_stopped", {
      requestId,
      sessionId,
      code: aborted ? 130 : 1,
      signal: aborted ? "SIGTERM" : null,
      message: aborted ? "Agent run cancelled." : message,
      source: "native-agent",
    });
  } finally {
    opencodeState.activeRuns.delete(requestId);
    opencodeState.requestSessionMap.delete(requestId);
  }
}

ipcMain.handle("opencode-start", async () => {
  const ok = await ensureOpenCodeReady(6000);
  const baseError = opencodeState.lastError || "";
  const installHint = opencodeState.missingBinary
    ? buildOpenCodeMissingBinaryMessage()
    : "";
  return {
    ok,
    running: !!opencodeState.proc,
    pid: opencodeState.proc?.pid || null,
    ready: !!opencodeState.ready,
    url: opencodeState.serverUrl || "",
    error: installHint || baseError || "",
    missingBinary: opencodeState.missingBinary,
  };
});

ipcMain.handle("opencode-run", async (_event, payload) => {
  const ready = await ensureOpenCodeReady();
  if (!ready) {
    const installHint = opencodeState.missingBinary
      ? buildOpenCodeMissingBinaryMessage()
      : "OpenCode process unavailable.";
    return { ok: false, error: installHint || opencodeState.lastError || "OpenCode process unavailable." };
  }

  const data = sanitizeOpenCodePayload(payload);
  if (!data.requestId) return { ok: false, error: "Missing requestId." };
  if (!data.sessionId) return { ok: false, error: "Missing sessionId." };
  if (!data.prompt.trim()) return { ok: false, error: "Prompt is empty." };

  let runCwd = "";
  if (data.workspacePath) {
    const candidate = path.resolve(data.workspacePath);
    try {
      const stat = await fs.promises.stat(candidate);
      if (!stat.isDirectory()) {
        return { ok: false, error: "Workspace path must be a folder." };
      }
      runCwd = candidate;
      allowedBasePath = candidate;
    } catch {
      return { ok: false, error: "Selected workspace folder does not exist." };
    }
  } else if (allowedBasePath) {
    runCwd = path.resolve(allowedBasePath);
  }

  opencodeState.requestSessionMap.set(data.requestId, data.sessionId);
  const chatSessionId = data.sessionId;
  const mappedOpenCodeSessionId = String(opencodeState.chatSessionMap.get(chatSessionId) || "").trim();
  const runSpec = buildOpenCodeRunSpec({
    serverUrl: opencodeState.serverUrl,
    provider: data.provider,
    model: data.model,
    opencodeSessionId: mappedOpenCodeSessionId,
    prompt: data.prompt,
  });

  let runProc;
  try {
    runProc = spawn(runSpec.command, runSpec.args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      ...(runCwd ? { cwd: runCwd } : {}),
      env: {
        ...process.env,
        ...(runSpec.env || {}),
        ...buildProviderEnv(data.provider, data.providerConfig),
      },
    });
  } catch (err) {
    const message = err?.message || "Failed to start OpenCode run.";
    if (isMissingBinaryError(message)) {
      opencodeState.missingBinary = true;
    }
    return { ok: false, error: message };
  }

  const runState = {
    proc: runProc,
    chatSessionId: data.sessionId,
    opencodeSessionId: mappedOpenCodeSessionId,
    stdoutBuffer: "",
    stderrBuffer: "",
    stderrTail: "",
    outputText: "",
    hadError: false,
    errorMessage: "",
  };
  opencodeState.activeRuns.set(data.requestId, runState);

  runProc.once("spawn", () => {
    sendOpenCodeStatus("run_started", {
      requestId: data.requestId,
      sessionId: chatSessionId,
      pid: runProc.pid,
      provider: data.provider,
      model: data.model,
      cwd: runCwd || null,
    });
  });

  runProc.stdout.on("data", (chunk) => {
    consumeOpenCodeRunChunk({
      requestId: data.requestId,
      chatSessionId,
      runState,
      stream: "stdout",
      chunk,
    });
  });

  runProc.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf-8");
    runState.stderrTail = (runState.stderrTail + text).slice(-OPENCODE_MAX_STDIO_BUFFER);

    consumeOpenCodeRunChunk({
      requestId: data.requestId,
      chatSessionId,
      runState,
      stream: "stderr",
      chunk,
    });
  });

  runProc.on("error", (err) => {
    const message = err?.message || "OpenCode run process error.";
    runState.hadError = true;
    runState.errorMessage = message;
    sendOpenCodeEvent({
      type: "error",
      requestId: data.requestId,
      sessionId: chatSessionId,
      data: { message },
    });
  });

  runProc.on("close", (code, signal) => {
    finalizeOpenCodeRun(data.requestId, runState, code, signal);
  });

  return { ok: true };
});

ipcMain.handle("opencode-reset-session", (_event, sessionId) => {
  const sid = String(sessionId || "").trim();
  if (!sid) return { ok: false, error: "Missing sessionId." };

  for (const [requestId, mappedSessionId] of opencodeState.requestSessionMap.entries()) {
    if (mappedSessionId === sid) {
      opencodeState.requestSessionMap.delete(requestId);
    }
  }

  for (const [requestId, runState] of opencodeState.activeRuns.entries()) {
    if (runState.chatSessionId !== sid) continue;
    if (runState.proc && !runState.proc.killed) {
      try {
        runState.proc.kill("SIGTERM");
      } catch {}
    }
    opencodeState.activeRuns.delete(requestId);
  }

  opencodeState.chatSessionMap.delete(sid);

  return { ok: true };
});

// ── IPC: manual update check ────────────────────────────────────────────────
ipcMain.handle("check-for-updates", () => {
  autoUpdater?.checkForUpdates().catch(() => {});
});

ipcMain.handle("get-app-version", () => app.getVersion());

// ── IPC: web page fetching ───────────────────────────────────────────────────

const WEB_FETCH_MAX_BYTES = 512 * 1024; // 512 KB cap
const WEB_FETCH_TIMEOUT_MS = 12000;
const WEB_FETCH_MAX_REDIRECTS = 4;
const WEB_FETCH_FULL_TEXT_CAP = 12000; // chars sent to AI

function isPrivateHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127\./.test(hostname) ||
    /^0\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname)
  );
}

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return "";
  return m[1]
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .trim();
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|aside|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function hasAssetLikePath(pathName = "") {
  return /\.(?:css|js|mjs|map|json|xml|rss|atom|txt|ico|png|jpe?g|gif|webp|svg|bmp|woff2?|ttf|eot|otf|mp4|webm|mp3|m4a|wav|avi|mov)(?:$|[?#])/i.test(pathName);
}

function hasAssetLikeContentType(contentType = "") {
  return /(text\/css|javascript|image\/|font\/|audio\/|video\/|application\/(?:javascript|json|xml|octet-stream))/i.test(contentType);
}

/**
 * Fetch a URL in the main process (no CORS/CSP constraints).
 * Follows up to WEB_FETCH_MAX_REDIRECTS redirects.
 */
function fetchUrl(rawUrl, redirectsLeft = WEB_FETCH_MAX_REDIRECTS) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new NodeURL(rawUrl); } catch {
      return resolve({ ok: false, error: "Invalid URL." });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return resolve({ ok: false, error: "Only http/https URLs are supported." });
    }
    if (isPrivateHost(parsed.hostname)) {
      return resolve({ ok: false, error: "Fetching private network addresses is not allowed." });
    }

    const client = parsed.protocol === "https:" ? https : http;
    let settled = false;
    let body = Buffer.alloc(0);

    const req = client.get(
      rawUrl,
      {
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "text/html,text/plain;q=0.8,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: WEB_FETCH_TIMEOUT_MS,
      },
      (res) => {
        // Follow redirect
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          res.resume(); // drain
          if (!location || redirectsLeft <= 0) {
            return resolve({ ok: false, error: "Too many redirects or missing Location header." });
          }
          // Resolve relative redirect
          let nextUrl;
          try { nextUrl = new NodeURL(location, rawUrl).toString(); } catch {
            return resolve({ ok: false, error: "Invalid redirect URL." });
          }
          return fetchUrl(nextUrl, redirectsLeft - 1).then(resolve);
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return resolve({ ok: false, error: `HTTP ${res.statusCode}` });
        }

        const contentType = res.headers["content-type"] || "";

        const resolveFromBody = () => {
          const raw = body.toString("utf-8");
          const normalizedContentType = String(contentType || "").toLowerCase();
          const isHtml = /text\/html/i.test(normalizedContentType) || (!normalizedContentType && /<(html|body|article|main)\b/i.test(raw));
          const isText = isHtml || /text\//i.test(normalizedContentType) || !normalizedContentType;
          const looksAssetByType = hasAssetLikeContentType(normalizedContentType);
          const looksAssetByPath = hasAssetLikePath(parsed.pathname || "") || /^\/(?:rs|rp)\//i.test(parsed.pathname || "");

          if (looksAssetByType || looksAssetByPath) {
            return resolve({ ok: false, error: "Non-article resource skipped." });
          }

          const title = isHtml ? extractTitle(raw) : "";
          const text = isHtml ? stripHtml(raw) : isText ? raw.trim() : "[Binary content]";

          // Avoid returning anti-bot challenge pages as "content" sources.
          const challengeSnippet = `${title}\n${text.slice(0, 1200)}`;
          const isSearchEngineChallenge =
            /(duckduckgo\.com|bing\.com|google\.)/i.test(parsed.hostname) &&
            /(captcha|verify (you )?are (human|not a robot)|are you (human|a robot)|unusual traffic|bot challenge|hcaptcha|g-recaptcha|cf-challenge|cloudflare challenge)/i.test(challengeSnippet);
          if (isSearchEngineChallenge) {
            return resolve({ ok: false, error: "Search engine challenge page blocked." });
          }

          const excerpt = text.slice(0, 400).trim();
          const fullText = text.slice(0, WEB_FETCH_FULL_TEXT_CAP).trim();
          const isLikelyArticle = (isHtml || /text\/plain/i.test(normalizedContentType)) && fullText.length >= 180;
          resolve({
            ok: true,
            url: rawUrl,
            finalUrl: parsed.href,
            domain: parsed.hostname,
            title: title || parsed.hostname,
            excerpt,
            fullText,
            contentType: normalizedContentType,
            isHtml,
            isLikelyArticle,
          });
        };

        res.on("data", (chunk) => {
          if (settled) return;
          body = Buffer.concat([body, chunk]);
          if (body.length > WEB_FETCH_MAX_BYTES) {
            settled = true;
            req.destroy();
            // Return what we have so far rather than erroring
            resolveFromBody();
          }
        });

        res.on("end", () => {
          if (settled) return; // already resolved from size cap
          settled = true;
          resolveFromBody();
        });

        res.on("error", (err) => {
          if (settled) return;
          settled = true;
          resolve({ ok: false, error: err.message });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      if (!settled) { settled = true; resolve({ ok: false, error: "Request timed out." }); }
    });

    req.on("error", (err) => {
      if (!settled) { settled = true; resolve({ ok: false, error: err.message }); }
    });
  });
}

ipcMain.handle("web-fetch", async (_event, rawUrl) => {
  if (!rawUrl || typeof rawUrl !== "string" || rawUrl.length > 2048) {
    return { ok: false, error: "Invalid URL." };
  }
  return fetchUrl(rawUrl.trim());
});

// ── DDG result URL extractor ─────────────────────────────────────────────────

function parseDDGResultUrls(html) {
  const seen = new Set();
  const urls = [];

  // 1. Match uddg= redirect params (both relative /l/?uddg= and absolute //duckduckgo.com/l/?uddg=)
  const uddgRe = /[?&]uddg=([^&"'\s>]+)/gi;
  for (const match of html.matchAll(uddgRe)) {
    if (urls.length >= 8) break;
    try {
      const url = decodeURIComponent(match[1]);
      if (url.startsWith("http") && !seen.has(url)) { seen.add(url); urls.push(url); }
    } catch {}
  }

  // 2. Fallback: direct href="https://..." links (DDG lite, or any format)
  if (urls.length < 3) {
    const directRe = /href="(https?:\/\/(?!(?:[a-z0-9-]+\.)?duckduckgo\.com)[^"#]{12,300})"/gi;
    for (const match of html.matchAll(directRe)) {
      if (urls.length >= 8) break;
      const url = match[1];
      if (!seen.has(url)) { seen.add(url); urls.push(url); }
    }
  }

  return urls;
}

function normalizeResultUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  let url = rawUrl.replace(/&amp;/g, "&").trim();
  try { url = decodeURIComponent(url); } catch {}
  if (url.startsWith("//")) url = `https:${url}`;
  if (!/^https?:\/\//i.test(url)) return "";
  return url;
}

function decodeBingRedirectUrl(rawUrl) {
  const direct = normalizeResultUrl(rawUrl);
  if (!direct) return "";
  let parsed;
  try { parsed = new NodeURL(direct); } catch { return direct; }

  if (!/bing\.com$/i.test(parsed.hostname)) return direct;
  if (!parsed.pathname.startsWith("/ck/a")) return direct;

  const u = parsed.searchParams.get("u");
  if (!u) return direct;

  // Bing often wraps target as base64 with "a1" prefix.
  let candidate = u;
  if (/^a1/i.test(candidate)) {
    candidate = candidate.slice(2);
    try { candidate = Buffer.from(candidate, "base64").toString("utf-8"); } catch {}
  }
  try { candidate = decodeURIComponent(candidate); } catch {}
  return /^https?:\/\//i.test(candidate) ? candidate : direct;
}

function parseBingResultUrls(html) {
  const seen = new Set();
  const urls = [];

  // Primary: organic result blocks
  const blockRe = /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<\/li>/gi;
  for (const blockMatch of html.matchAll(blockRe)) {
    if (urls.length >= 8) break;
    const a = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"/i.exec(blockMatch[0])
      || /<a[^>]+href="([^"]+)"/i.exec(blockMatch[0]);
    if (!a) continue;
    const decoded = decodeBingRedirectUrl(a[1]);
    if (!decoded || seen.has(decoded)) continue;
    seen.add(decoded);
    urls.push(decoded);
  }

  // Fallback: any absolute links
  if (urls.length < 3) {
    const directRe = /href="(https?:\/\/[^"<>]+)"/gi;
    for (const match of html.matchAll(directRe)) {
      if (urls.length >= 8) break;
      const decoded = decodeBingRedirectUrl(match[1]);
      if (!decoded || seen.has(decoded)) continue;
      if (/https?:\/\/(?:www\.)?(?:bing|go\.microsoft)\./i.test(decoded)) continue;
      seen.add(decoded);
      urls.push(decoded);
    }
  }

  return urls;
}

function parseGoogleResultUrls(html) {
  const seen = new Set();
  const urls = [];

  // Google web result redirect links: /url?q=<target>
  const wrappedRe = /href="\/url\?q=([^"&]+)[^"]*"/gi;
  for (const match of html.matchAll(wrappedRe)) {
    if (urls.length >= 8) break;
    let candidate = match[1];
    try { candidate = decodeURIComponent(candidate); } catch {}
    if (!/^https?:\/\//i.test(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    urls.push(candidate);
  }

  // Fallback: direct absolute links
  if (urls.length < 3) {
    const directRe = /href="(https?:\/\/[^"<>]+)"/gi;
    for (const match of html.matchAll(directRe)) {
      if (urls.length >= 8) break;
      const candidate = normalizeResultUrl(match[1]);
      if (!candidate || seen.has(candidate)) continue;
      if (/https?:\/\/(?:www\.)?google\./i.test(candidate)) continue;
      seen.add(candidate);
      urls.push(candidate);
    }
  }

  return urls;
}

function shouldSkipResultUrl(url) {
  let parsed;
  try { parsed = new NodeURL(url); } catch { return true; }

  if (isPrivateHost(parsed.hostname)) return true;

  const host = parsed.hostname.toLowerCase();
  const pathName = (parsed.pathname || "").toLowerCase();

  if (hasAssetLikePath(pathName) || /^\/(?:rs|rp)\//i.test(pathName)) return true;
  if (host === "bing.com" || host.endsWith(".bing.com")) return true;

  const lowValueHosts = new Set([
    "support.google.com",
    "accounts.google.com",
    "myaccount.google.com",
    "policies.google.com",
    "consent.google.com",
    "webcache.googleusercontent.com",
    "translate.google.com",
    "images.google.com",
    "r.bing.com",
    "c.bing.com",
    "th.bing.com",
    "cn.bing.com",
  ]);
  if (lowValueHosts.has(host)) return true;

  // DDG result pages are frequently challenge/redirect pages here.
  if (host.includes("duckduckgo.com")) return true;

  if (host.includes("google.") && (pathName === "/search" || pathName === "/url")) return true;
  if (host.includes("bing.com") && (pathName === "/search" || pathName.startsWith("/news/search") || pathName.startsWith("/images/search") || pathName.startsWith("/ck/a"))) return true;
  if (host.includes("msn.com") && pathName.includes("/search")) return true;
  if (host.includes("go.microsoft.com")) return true;

  return false;
}

function extractQueryKeywords(query) {
  if (!query || typeof query !== "string") return [];
  const stopwords = new Set([
    "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "at", "by", "from", "with",
    "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "about", "latest",
    "current", "recent", "small", "short", "mini", "points", "point", "bullet", "bullets", "brief",
  ]);

  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length >= 3 && !stopwords.has(t));

  return [...new Set(tokens)].slice(0, 8);
}

function isSourceRelevantToQuery(source, keywords) {
  if (!source || !Array.isArray(keywords) || keywords.length === 0) return true;
  const text = `${source.title || ""}\n${source.excerpt || ""}\n${String(source.fullText || "").slice(0, 2500)}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) score += 1;
  }
  return score > 0;
}

function isGoogleChallengeText(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase();
  const strong = /(unusual traffic|our systems have detected unusual traffic|not a robot|i'?m not a robot|captcha|security check|verify you are human)/i;
  const hints = /(about this page|checks to see if it'?s really you sending the requests|enable javascript to continue|this page appears when google automatically detects requests|service\/retry\/enablejs|\/sorry\/index|detected unusual traffic from your computer network|please click here if you are not redirected)/i;
  return strong.test(t) || (hints.test(t) && t.includes("google"));
}

function isLowQualityGoogleContext(text) {
  if (!text || typeof text !== "string") return true;
  const t = text.toLowerCase();
  if (isGoogleChallengeText(t)) return true;

  const boilerplate = /(service\/retry\/enablejs|\/sorry\/index|enable javascript|please click here if you are not redirected|about this page)/i;
  const markupNoise = (t.match(/<style|<script|display\s*:\s*none|position\s*:\s*absolute|@media|var\s+[a-z_$][\w$]*\s*=/gi) || []).length;

  return boilerplate.test(t) || markupNoise >= 2;
}

function isNewsLikeQuery(query) {
  if (!query || typeof query !== "string") return false;
  return /\b(news|headlines?|latest|recent|today|now|live|breaking|update|updates|current affairs?|war|conflict|election|x\.com|twitter)\b/i.test(query);
}

function isXUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /^https?:\/\/(?:www\.)?x\.com\//i.test(url);
}

async function collectSearchResultUrls(query, opts = {}) {
  const {
    maxUrls = 8,
    perEngine = 3,
    includeX = false,
    includeGoogle = true,
    engineMode = "multi",
  } = opts;
  const encoded = encodeURIComponent(query);
  const useBingMsnOnly = engineMode === "bing-msn-only";

  const engines = [];
  if (!useBingMsnOnly) {
    engines.push(
      { name: "ddg-lite", url: `https://lite.duckduckgo.com/lite/?q=${encoded}`, parser: parseDDGResultUrls },
      { name: "ddg-html", url: `https://html.duckduckgo.com/html/?q=${encoded}&kl=us-en`, parser: parseDDGResultUrls }
    );
  }

  engines.push(
    { name: "bing-web", url: `https://www.bing.com/search?q=${encoded}&setlang=en-us&cc=US`, parser: parseBingResultUrls },
    { name: "msn-web", url: `https://www.bing.com/search?q=${encoded}&form=MSNVS`, parser: parseBingResultUrls }
  );

  if (includeGoogle && !useBingMsnOnly) {
    engines.push({ name: "google-web", url: `https://www.google.com/search?q=${encoded}&hl=en&num=10&pws=0&safe=off`, parser: parseGoogleResultUrls });
  }

  const pages = await Promise.all(
    engines.map(async (engine) => {
      const html = await rawFetchHtml(engine.url, 350 * 1024);
      return { ...engine, html };
    })
  );

  const resultUrls = [];
  const seen = new Set();

  for (const engine of pages) {
    const parsedUrls = engine.parser(engine.html || "");
    for (const rawUrl of parsedUrls.slice(0, perEngine)) {
      const normalized = normalizeResultUrl(rawUrl);
      if (!normalized || shouldSkipResultUrl(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      resultUrls.push(normalized);
      if (resultUrls.length >= maxUrls) return resultUrls;
    }
  }

  // Optional X.com expansion for news/current-events queries.
  if (includeX && resultUrls.length < maxUrls) {
    const xEncoded = encodeURIComponent(`${query} site:x.com`);
    const xHtml = await rawFetchHtml(`https://www.bing.com/search?q=${xEncoded}&setlang=en-us&cc=US`, 350 * 1024);
    const xUrls = parseBingResultUrls(xHtml)
      .map((u) => normalizeResultUrl(u))
      .filter((u) => !!u && isXUrl(u));

    for (const xUrl of xUrls.slice(0, 3)) {
      if (seen.has(xUrl)) continue;
      seen.add(xUrl);
      resultUrls.push(xUrl);
      if (resultUrls.length >= maxUrls) break;
    }
  }

  return resultUrls;
}

function selectValidArticleSources(fetched, query, opts = {}) {
  const { minFullText = 0, clipFullText = 0 } = opts;
  const validSources = fetched
    .filter((r) => {
      if (!(r.ok && r.fullText && r.isLikelyArticle !== false)) return false;
      if (minFullText > 0 && String(r.fullText || "").length < minFullText) return false;

      const host = String(r.domain || "").toLowerCase();
      if (host.includes("google.")) {
        const probe = `${r.title || ""}\n${r.excerpt || ""}\n${String(r.fullText || "").slice(0, 2800)}`;
        if (isGoogleChallengeText(probe)) return false;
      }
      return true;
    });

  const keywords = extractQueryKeywords(query);
  const relevant = validSources.filter((s) => isSourceRelevantToQuery(s, keywords));
  const chosen = relevant.length > 0 ? relevant : validSources;

  return chosen.map((r, i) => {
    const next = { ...r, index: i + 1 };
    if (clipFullText > 0 && typeof next.fullText === "string") {
      next.fullText = next.fullText.slice(0, clipFullText);
    }
    return next;
  });
}

async function fetchAndSelectArticleSources(urls, query, opts = {}) {
  const { maxFetch = 5, minFullText = 0, clipFullText = 0 } = opts;
  if (!Array.isArray(urls) || urls.length === 0) return [];

  const fetched = await Promise.all(
    urls.slice(0, maxFetch).map((url) => fetchUrl(url).catch(() => ({ ok: false, url })))
  );

  return selectValidArticleSources(fetched, query, { minFullText, clipFullText });
}

// Shared raw HTTP fetcher for search pages (follows one redirect level)
function rawFetchHtml(url, maxBytes = 300 * 1024) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new NodeURL(url); } catch { return resolve(""); }
    const client = parsed.protocol === "https:" ? https : http;
    let body = Buffer.alloc(0);
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const req = client.get(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "DNT": "1",
      },
      timeout: 8000,
    }, (res) => {
      // Follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return rawFetchHtml(res.headers.location, maxBytes).then(finish);
      }
      res.on("data", (chunk) => {
        if (settled) return;
        body = Buffer.concat([body, chunk]);
        if (body.length > maxBytes) { req.destroy(); finish(body.toString("utf-8")); }
      });
      res.on("end",  () => finish(body.toString("utf-8")));
      res.on("error", () => finish(""));
    });
    req.on("error",   () => finish(""));
    req.on("timeout", () => { req.destroy(); finish(""); });
  });
}

// ── web-search: real multi-engine search (DDG + Bing/MSN + Google HTML) ─────

ipcMain.handle("web-search", async (_event, query) => {
  if (!query || typeof query !== "string" || query.length > 300) {
    return { ok: false, error: "Invalid query." };
  }

  const includeX = isNewsLikeQuery(query);
  const primaryUrls = await collectSearchResultUrls(query, {
    maxUrls: 7,
    perEngine: 3,
    includeX,
    includeGoogle: true,
  });
  let sources = await fetchAndSelectArticleSources(primaryUrls, query, {
    maxFetch: 5,
    minFullText: 160,
  });

  // If Google path is blocked/challenged, force a non-Google second pass.
  if (sources.length === 0) {
    const altUrls = await collectSearchResultUrls(query, {
      maxUrls: 9,
      perEngine: 4,
      includeX,
      includeGoogle: false,
    });
    sources = await fetchAndSelectArticleSources(altUrls, query, {
      maxFetch: 6,
      minFullText: 160,
    });
  }

  // Final fallback: force Bing/MSN-only search and relax length threshold.
  if (sources.length === 0) {
    const bingMsnUrls = await collectSearchResultUrls(query, {
      maxUrls: 10,
      perEngine: 5,
      includeX,
      includeGoogle: false,
      engineMode: "bing-msn-only",
    });
    const bingMsnSources = await fetchAndSelectArticleSources(bingMsnUrls, query, {
      maxFetch: 7,
      minFullText: 120,
    });
    if (bingMsnSources.length > 0) {
      sources = bingMsnSources.map((src) => ({ ...src, _searchFallback: "bing_msn" }));
    }
  }

  return { ok: true, query, sources };
});

// ── deep-search: multi-query multi-engine article research ───────────────────
//
// Builds 3 complementary queries, runs DDG + Bing/MSN + Google HTML for each,
// deduplicates URLs, fetches full article pages, returns rich context.

ipcMain.handle("deep-search", async (_event, query) => {
  if (!query || typeof query !== "string" || query.length > 300) {
    return { ok: false, error: "Invalid query." };
  }

  // Build 3 complementary sub-queries for broader coverage
  const subQueries = [
    query,
    `${query} 2025 latest`,
    `${query} analysis causes background`,
  ];

  const includeX = isNewsLikeQuery(query);

  const flattenDedupUrls = (urlBatches, limit = 10) => {
    const seen = new Set();
    const merged = [];
    for (const urls of urlBatches) {
      for (const url of urls) {
        if (seen.has(url)) continue;
        seen.add(url);
        merged.push(url);
        if (merged.length >= limit) return merged;
      }
    }
    return merged;
  };

  const runBatch = async (includeGoogle) => Promise.all(
    subQueries.map((q) => collectSearchResultUrls(q, {
      maxUrls: 7,
      perEngine: 3,
      includeX,
      includeGoogle,
    }))
  );

  let batchUrls = await runBatch(true);
  let allUrls = flattenDedupUrls(batchUrls, 10);

  if (allUrls.length === 0) {
    batchUrls = await runBatch(false);
    allUrls = flattenDedupUrls(batchUrls, 10);
  }

  if (allUrls.length === 0) return { ok: false, error: "No results found." };

  let sources = await fetchAndSelectArticleSources(allUrls, query, {
    maxFetch: 10,
    minFullText: 200,
    clipFullText: 5000,
  });

  if (sources.length === 0) {
    const altUrls = await collectSearchResultUrls(query, {
      maxUrls: 10,
      perEngine: 4,
      includeX,
      includeGoogle: false,
    });
    sources = await fetchAndSelectArticleSources(altUrls, query, {
      maxFetch: 10,
      minFullText: 200,
      clipFullText: 5000,
    });
  }

  if (sources.length === 0) {
    const bingMsnBatches = await Promise.all(
      subQueries.map((q) =>
        collectSearchResultUrls(q, {
          maxUrls: 8,
          perEngine: 4,
          includeX,
          includeGoogle: false,
          engineMode: "bing-msn-only",
        })
      )
    );
    const bingMsnUrls = flattenDedupUrls(bingMsnBatches, 12);
    const bingMsnSources = await fetchAndSelectArticleSources(bingMsnUrls, query, {
      maxFetch: 10,
      minFullText: 180,
      clipFullText: 5000,
    });
    if (bingMsnSources.length > 0) {
      sources = bingMsnSources.map((src) => ({ ...src, _searchFallback: "bing_msn" }));
    }
  }

  if (sources.length === 0) return { ok: false, error: "No results found." };
  return { ok: true, query, sources };
});

// ── IPC: open URL in system browser ─────────────────────────────────────────
ipcMain.handle("open-external", async (_event, url) => {
  if (typeof url !== "string" || !/^(https?:\/\/|mailto:)/i.test(url)) return;
  const { shell } = require("electron");
  await shell.openExternal(url);
});

// ── IPC: Google AI Mode scrape via hidden BrowserWindow ──────────────────────
//
// Loads Google search in a hidden renderer (real Chromium → no bot detection,
// JavaScript renders AI Overview) then extracts the AI overview / featured
// snippet text and the top organic result snippets.

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadUrlWithTimeout(win, url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      win.webContents.removeListener("did-finish-load", onFinish);
      win.webContents.removeListener("did-fail-load", onFail);
      resolve(result);
    };

    const onFinish = () => finish({ ok: true });
    const onFail = (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame === false) return;
      finish({ ok: false, error: `Failed to load Google page (${errorCode}): ${errorDescription}` });
    };

    const timer = setTimeout(() => finish({ ok: false, error: "Google page load timeout." }), timeoutMs);
    win.webContents.once("did-finish-load", onFinish);
    win.webContents.on("did-fail-load", onFail);

    win.loadURL(url).catch((err) => finish({ ok: false, error: err.message || "Google load failed." }));
  });
}

const GOOGLE_CONSENT_SCRIPT = `
(() => {
  const txt = (el) => String(el?.innerText || el?.textContent || el?.value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const nodes = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"]'));
  const btn = nodes.find((el) => {
    const t = txt(el);
    return /accept all|i agree|agree|allow all|consent|accept/i.test(t);
  });
  if (btn) {
    btn.click();
    return true;
  }
  return false;
})()
`;

const GOOGLE_EXTRACT_SCRIPT = `
(() => {
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const textOf = (el) => clean(el?.innerText || el?.textContent || "");
  const isLowValueGoogleLink = (href, title) => {
    const t = String(title || '').toLowerCase();
    if (/privacy|terms|cookie|consent|help|about google/i.test(t)) return true;
    try {
      const u = new URL(href);
      const host = String(u.hostname || '').toLowerCase();
      const path = String(u.pathname || '').toLowerCase();
      if (
        host === 'support.google.com' ||
        host === 'accounts.google.com' ||
        host === 'myaccount.google.com' ||
        host === 'policies.google.com' ||
        host === 'consent.google.com' ||
        host === 'websearch.google.com'
      ) return true;
      if (host.includes('google.') && (path === '/search' || path === '/url')) return true;
    } catch (_) {
      return true;
    }
    return false;
  };

  const snippetSelectors = [
    '.VwiC3b', '.yXK7lf', '.MUxGbd', '.lyLwlc', '.hgKElc', '.IZ6rdc', '.s3v9rd'
  ];

  const resultCards = Array.from(document.querySelectorAll('div.g, div.MjjYud, div.Gx5Zad'))
    .map((card) => {
      const title = textOf(card.querySelector('h3'));
      const link = card.querySelector('a[href^="http"]')?.href || '';
      let snippet = '';
      for (const sel of snippetSelectors) {
        const t = textOf(card.querySelector(sel));
        if (t.length > 20) { snippet = t; break; }
      }
      return { title, snippet, link };
    })
    .filter((item) => item.title && item.link && !isLowValueGoogleLink(item.link, item.title))
    .slice(0, 8);

  let aiText = '';
  const aiHeading = Array.from(document.querySelectorAll('h1,h2,h3,span,div'))
    .find((el) => /\bAI Overview\b/i.test(textOf(el)));
  if (aiHeading) {
    const scope = aiHeading.closest('section, article, div') || aiHeading.parentElement;
    aiText = textOf(scope).slice(0, 7000);
  }

  if (!aiText) {
    const fallbackSummary = Array.from(document.querySelectorAll('[data-attrid="wa:/description"], .kno-rdesc span, .hgKElc, .IZ6rdc'))
      .map((el) => textOf(el))
      .filter((t) => t.length > 40)
      .slice(0, 6)
      .join('\n\n');
    aiText = fallbackSummary.slice(0, 4000);
  }

  const parts = [];
  if (aiText && aiText.length > 40) {
    parts.push('AI Overview\n' + aiText);
  }

  if (resultCards.length > 0) {
    const lines = resultCards.map((r, i) => {
      const snippet = r.snippet ? ('\n' + r.snippet) : '';
      return (i + 1) + '. ' + r.title + snippet + '\nSource: ' + r.link;
    });
    parts.push('Top web results\n' + lines.join('\n\n'));
  }

  const bodyText = String(document.body?.innerText || document.body?.textContent || '')
    .split(/\n+/)
    .map((line) => clean(line))
    .filter((line) => line.length >= 40)
    .slice(0, 140)
    .join('\n')
    .slice(0, 9000);

  return {
    ai: aiText.length > 40,
    label: aiText.length > 40 ? 'Google AI Mode' : 'Google Web Snippets',
    text: parts.join('\n\n---\n\n').slice(0, 12000),
    items: resultCards,
    bodyText,
  };
})()
`;

async function tryGoogleAiModeSearch(query, opts = {}) {
  const encoded = encodeURIComponent(query);
  const searchUrl = `https://www.google.com/search?q=${encoded}&hl=en&gl=US&pws=0&safe=off`;
  const timeoutMs = Number(opts?.timeoutMs) > 0
    ? Math.min(Math.max(Number(opts.timeoutMs), 6000), 18000)
    : 12000;

  let probe = null;
  try {
    probe = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    probe.webContents.setUserAgent(BROWSER_UA);
    probe.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    const loaded = await loadUrlWithTimeout(probe, searchUrl, timeoutMs);
    if (!loaded.ok) return loaded;

    await waitMs(1300);

    try {
      const clicked = await probe.webContents.executeJavaScript(GOOGLE_CONSENT_SCRIPT, true);
      if (clicked) await waitMs(1200);
    } catch {}

    let payload = null;
    try {
      payload = await probe.webContents.executeJavaScript(GOOGLE_EXTRACT_SCRIPT, true);
    } catch {}

    if (!payload || typeof payload !== "object") {
      payload = { ai: false, label: "Google Web Snippets", text: "", items: [], bodyText: "" };
    }

    let screenshotDataUrl = "";
    try {
      const shot = await probe.webContents.capturePage();
      if (shot && !shot.isEmpty()) {
        const resized = shot.getSize().width > 1280 ? shot.resize({ width: 1280 }) : shot;
        let jpeg = resized.toJPEG(62);
        if (jpeg.length > 700 * 1024) {
          jpeg = resized.toJPEG(45);
        }
        screenshotDataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      }
    } catch {}

    const extractedText = String(payload.text || "").trim();
    let bodyFallbackText = String(payload.bodyText || "").trim();

    if (bodyFallbackText.length < 120) {
      try {
        const genericBody = await probe.webContents.executeJavaScript(`
(() => String(document.body?.innerText || document.body?.textContent || '')
  .replace(/\\s+/g, ' ')
  .trim()
  .slice(0, 9000))()
`, true);
        if (typeof genericBody === "string" && genericBody.trim().length > bodyFallbackText.length) {
          bodyFallbackText = genericBody.trim();
        }
      } catch {}
    }

    const organicItems = Array.isArray(payload.items) ? payload.items : [];
    const organicLines = organicItems
      .filter((item) => item && item.title && item.link && /^https?:\/\//i.test(item.link))
      .filter((item) => {
        const u = String(item.link).toLowerCase();
        return !/google\.[^/]+\/(search|sorry|service\/retry|url)/i.test(u);
      })
      .slice(0, 6)
      .map((item, idx) => {
        const snippet = item.snippet ? `\n${String(item.snippet).slice(0, 260)}` : "";
        return `${idx + 1}. ${item.title}${snippet}\nSource: ${item.link}`;
      });

    let finalText =
      extractedText.length >= 80
        ? extractedText
        : (bodyFallbackText.length >= 120
          ? `Google page text\n${bodyFallbackText}`
          : (screenshotDataUrl
            ? "Google search screenshot captured. Use attached screenshot context."
            : ""));

    if (isLowQualityGoogleContext(finalText)) {
      if (organicLines.length > 0) {
        finalText = `Top web results\n${organicLines.join("\n\n")}`;
      } else {
        return { ok: false, error: "Google context quality too low." };
      }
    }

    const challengeProbe = `${extractedText}\n${bodyFallbackText}\n${finalText}`.slice(0, 4500);
    if (isGoogleChallengeText(challengeProbe)) {
      return { ok: false, error: "Google challenge page blocked." };
    }

    if (!finalText && !screenshotDataUrl) {
      return { ok: false, error: "No Google AI screenshot or text content found." };
    }

    return {
      ok: true,
      query,
      type: "google_ai_mode",
      label: payload.label || "Google AI Mode",
      detailed: !!opts.detailed,
      text: String(finalText).slice(0, 12000),
      items: Array.isArray(payload.items) ? payload.items : [],
      source: searchUrl,
      screenshotDataUrl: screenshotDataUrl || null,
    };
  } catch (err) {
    return { ok: false, error: err.message || "Google AI mode scrape failed." };
  } finally {
    try {
      if (probe && !probe.isDestroyed()) probe.destroy();
    } catch {}
  }
}
//
// ── RSS item parser (no external deps) ───────────────────────────────────────

function stripHtmlTags(str) {
  return (str || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/\s+/g, " ").trim();
}

function parseRssItems(xml, max = 8) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  for (const m of xml.matchAll(itemRe)) {
    if (items.length >= max) break;
    const raw = m[1];
    const pick = (re) => { const x = re.exec(raw); return x ? stripHtmlTags(x[1]) : ""; };
    const title = pick(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const desc  = pick(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    const pub   = pick(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const link  = pick(/<link>([\s\S]*?)<\/link>/i) ||
                  pick(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/i);
    if (title.length > 5) items.push({ title, desc: desc.slice(0, 300), pub, link });
  }
  return items;
}

// ── News result filter ────────────────────────────────────────────────────────
// Remove entertainment/gaming/sports noise from news results

const NOISE_PATTERNS = [
  /\b(gta|fortnite|minecraft|roblox|call of duty|league of legends|valorant|gaming)\b/i,
  /\b(nba|nfl|mlb|nhl|epl|premier league|la liga|serie a|bundesliga|champions league)\b.*\b(score|result|match|game|goal)\b/i,
  /\b(celebrity|kardashian|taylor swift|beyonce|drake|kanye)\b/i,
  /\b(box office|movie review|film review|trailer|season \d+|episode \d+)\b/i,
  /\bwelcome week\b/i,
  /\b(exam|ssc|railway exam|upsc|jee|neet)\b/i,  // competitive exam spam
  /\b(horoscope|astrology|zodiac)\b/i,
];

function isNoiseItem(item) {
  const text = (item.title + " " + item.desc).toLowerCase();
  return NOISE_PATTERNS.some((re) => re.test(text));
}

// Detect broad "current affairs" query that should use curated world news feeds
function isBroadNewsQuery(query) {
  return /\b(current affairs?|recent affairs?|world news|latest news|top news|today.?s news|this week.?s news|news of the week|headlines?|breaking news|geopolit|international news)\b/i.test(query);
}

// ── IPC: fast news search via RSS ────────────────────────────────────────────
ipcMain.handle("google-ai-search", async (_event, query, opts = {}) => {
  if (!query || typeof query !== "string" || query.length > 300) {
    return { ok: false, error: "Invalid query." };
  }

  const mode = typeof opts.mode === "string" ? opts.mode : "auto";

  // 1) Try Google AI mode / top web snippets first (no account, no API).
  if (mode !== "news") {
    const aiResult = await tryGoogleAiModeSearch(query, opts);
    if (aiResult?.ok && aiResult.text) {
      return aiResult;
    }
    if (mode === "ai") {
      return { ok: false, error: aiResult?.error || "Google AI mode returned no content." };
    }
  }

  // 2) Fallback to RSS news aggregation for news mode / auto fallback.
  const detailed = !!opts.detailed;
  const encoded = encodeURIComponent(query);
  const broad = isBroadNewsQuery(query);

  const MAX_ITEMS = 25;

  // ── Feed selection ──────────────────────────────────────────────────────────
  // Broad current-affairs: use 10 curated world/geopolitics feeds for maximum coverage.
  // Specific topics: use Google/Bing News search RSS + 2 curated feeds.
  const feeds = broad
    ? [
        { url: `https://feeds.bbci.co.uk/news/world/rss.xml`,                    label: "BBC World" },
        { url: `https://feeds.reuters.com/Reuters/worldNews`,                     label: "Reuters World" },
        { url: `https://feeds.apnews.com/rss/apf-topnews`,                       label: "AP News" },
        { url: `https://www.aljazeera.com/xml/rss/all.xml`,                      label: "Al Jazeera" },
        { url: `https://rss.nytimes.com/services/xml/rss/nyt/World.xml`,         label: "NYT World" },
        { url: `https://www.theguardian.com/world/rss`,                          label: "Guardian World" },
        { url: `https://rss.dw.com/rdf/rss-en-world`,                            label: "DW World" },
        { url: `https://feeds.bbci.co.uk/news/politics/rss.xml`,                 label: "BBC Politics" },
        { url: `https://feeds.reuters.com/Reuters/PoliticsNews`,                 label: "Reuters Politics" },
        { url: `https://www.middleeasteye.net/rss`,                              label: "Middle East Eye" },
        { url: `https://feeds.france24.com/rss/en/world`,                        label: "France24 World" },
        { url: `https://feeds.bbci.co.uk/news/rss.xml`,                         label: "BBC Top Stories" },
      ]
    : [
        { url: `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`, label: "Google News" },
        { url: `https://www.bing.com/news/search?q=${encoded}&format=RSS`,        label: "Bing News" },
        { url: `https://feeds.bbci.co.uk/news/world/rss.xml`,                    label: "BBC World" },
        { url: `https://feeds.reuters.com/Reuters/worldNews`,                     label: "Reuters World" },
        { url: `https://www.aljazeera.com/xml/rss/all.xml`,                      label: "Al Jazeera" },
      ];

  // Fetch all feeds in parallel, parse up to 20 items each
  const rssResults = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const xml = await rawFetchHtml(feed.url, 200 * 1024);
        const items = parseRssItems(xml, 20).filter((it) => !isNoiseItem(it));
        return { label: feed.label, items };
      } catch {
        return { label: feed.label, items: [] };
      }
    })
  );

  // Merge all feeds, dedupe by title prefix, collect up to MAX_ITEMS
  let best;
  {
    const seen = new Set();
    const merged = [];
    rssResults.sort((a, b) => b.items.length - a.items.length);
    for (const r of rssResults) {
      for (const item of r.items) {
        const key = item.title.slice(0, 55).toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
        if (merged.length >= MAX_ITEMS) break;
      }
      if (merged.length >= MAX_ITEMS) break;
    }
    const sourceNames = [...new Set(rssResults.filter(r => r.items.length > 0).map(r => r.label))].slice(0, 5).join(" · ");
    best = { label: sourceNames || "World News", items: merged };
  }

  if (!best || best.items.length === 0) {
    return { ok: false, error: "No news found." };
  }

  const topItems = best.items.slice(0, detailed ? 5 : MAX_ITEMS);

  // ── Detailed mode: fetch full article text for top 5 results ─────────────
  let articleTexts = [];
  if (detailed) {
    const linkItems = topItems.filter((it) => it.link && it.link.startsWith("http"));
    const fetched = await Promise.all(
      linkItems.slice(0, 5).map((it) =>
        fetchUrl(it.link)
          .then((r) => r.ok && r.fullText ? { title: it.title, pub: it.pub, text: r.fullText.slice(0, 3000) } : null)
          .catch(() => null)
      )
    );
    articleTexts = fetched.filter(Boolean);
  }

  // Format headlines for AI
  let text;
  if (detailed && articleTexts.length > 0) {
    const articleSection = articleTexts
      .map((a, i) => `## ${i + 1}. ${a.title}${a.pub ? ` (${a.pub.replace(/ \+\d{4}$/, "").trim()})` : ""}\n\n${a.text}`)
      .join("\n\n---\n\n");
    const titledArticles = new Set(articleTexts.map((a) => a.title.slice(0, 40).toLowerCase()));
    const remaining = best.items
      .filter((it) => !titledArticles.has(it.title.slice(0, 40).toLowerCase()))
      .slice(0, 20)
      .map((it, i) => `${articleTexts.length + i + 1}. **${it.title}**${it.pub ? ` (${it.pub.replace(/ \+\d{4}$/, "").trim()})` : ""}\n${it.desc}`)
      .join("\n\n");
    text = articleSection + (remaining ? "\n\n---\n\n**Additional headlines:**\n\n" + remaining : "");
  } else {
    text = topItems
      .map((it, i) => `${i + 1}. **${it.title}**${it.pub ? ` (${it.pub.replace(/ \+\d{4}$/, "").trim()})` : ""}\n${it.desc}`)
      .join("\n\n");
  }

  return {
    ok: true,
    query,
    type: "news_rss",
    label: best.label,
    detailed,
    text,
    items: best.items,
  };
});

// ── IPC: terminal command execution ─────────────────────────────────────────
const BLOCKED_PATTERNS = [
  /rm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\b/i, // rm -rf / rm -fr
  /\brm\s+.*-r\b/i,
  /\bsudo\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bmkfs\b/i,
  /\bformat\s+[a-z]:/i,                   // format C:
  /\bdel\s+\/[sf]/i,                       // del /s or del /f
  /\brd\s+\/s\b/i,                         // rd /s
  /\brmdir\s+\/s\b/i,
  /:\(\)\s*\{.*:\|.*\}/,                   // fork bomb :(){:|:&};:
  /\bdd\s+if=/i,
  />\s*\/dev\/(sd|hd|nvme|sda)/i,
  /\bchmod\s+-R\s+777\s*\/\b/i,
  /\bchown\s+-R\s+root\b/i,
  /\biptables\s+-F\b/i,
  /curl\s+.*\|\s*ba?sh/i,                  // curl | bash
  /wget\s+.*\|\s*ba?sh/i,
  /\bpkill\s+-9\s+-1\b/i,                  // kill all processes
  /\bkill\s+-9\s+-1\b/i,
];

const BLOCKED_REASONS = [
  "rm -rf (recursive force delete)",
  "rm -r (recursive delete)",
  "sudo (privilege escalation)",
  "shutdown",
  "reboot",
  "halt",
  "mkfs (disk format)",
  "format drive",
  "del /f or /s (force delete)",
  "rd /s (recursive directory delete)",
  "rmdir /s",
  "fork bomb",
  "dd disk write",
  "write to raw device",
  "chmod 777 on system path",
  "chown root",
  "iptables -F (flush firewall)",
  "pipe curl to shell",
  "pipe wget to shell",
  "pkill -9 -1 (kill all)",
  "kill -9 -1 (kill all)",
];

function checkDangerousCommand(cmd) {
  for (let i = 0; i < BLOCKED_PATTERNS.length; i++) {
    if (BLOCKED_PATTERNS[i].test(cmd)) return BLOCKED_REASONS[i];
  }
  return null;
}

const activeTerminals = new Map();
let nextTerminalId = 1;

ipcMain.handle("terminal-execute", async (_event, { command, cwd }) => {
  if (!command || typeof command !== "string" || command.length > 2000) {
    return { ok: false, error: "Invalid command." };
  }
  const danger = checkDangerousCommand(command);
  if (danger) {
    return { ok: false, error: `Blocked — ${danger} is not allowed.` };
  }

  const id = nextTerminalId++;
  const opts = {
    windowsHide: true,
    env: process.env,
  };
  if (cwd && typeof cwd === "string") opts.cwd = cwd;

  let proc;
  try {
    if (process.platform === "win32") {
      // Run through PowerShell explicitly so the in-app terminal matches user expectations on Windows.
      proc = spawn(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        opts
      );
    } else {
      proc = spawn(command, [], { ...opts, shell: true });
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  activeTerminals.set(id, proc);

  const send = (type, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal-output", { id, type, data });
    }
  };

  proc.stdout.on("data", (chunk) => send("stdout", chunk.toString()));
  proc.stderr.on("data", (chunk) => send("stderr", chunk.toString()));

  proc.on("close", (code) => {
    activeTerminals.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal-done", { id, code: code ?? -1 });
    }
  });

  proc.on("error", (err) => {
    activeTerminals.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal-done", { id, code: -1, error: err.message });
    }
  });

  return { ok: true, id };
});

ipcMain.handle("terminal-kill", (_event, id) => {
  const proc = activeTerminals.get(id);
  if (!proc) return { ok: false };
  try {
    proc.kill("SIGTERM");
    // On Windows SIGTERM is not always honoured — escalate
    if (process.platform === "win32") proc.kill("SIGKILL");
  } catch {}
  activeTerminals.delete(id);
  return { ok: true };
});

} // end registerIpcHandlers

// ── Auto-updater setup ──────────────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater = require("electron-updater").autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus("checking");
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus("available", info.version);
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update Available",
        message: `A new version (v${info.version}) is available. Download now?`,
        buttons: ["Download", "Later"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus("not-available");
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus("downloading", Math.round(progress.percent));
  });

  autoUpdater.on("update-downloaded", () => {
    sendUpdateStatus("downloaded");
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update Ready",
        message: "Update downloaded. The app will restart to install it.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("error", (err) => {
    sendUpdateStatus("error", err.message);
  });

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
}

function sendUpdateStatus(status, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", { status, data });
  }
}

// Store installs (WindowsApps path) are updated by the Microsoft Store — skip electron-updater
function isStoreBuild() {
  return app.getPath("exe").includes("WindowsApps");
}

app.whenReady().then(() => {
  opencodeState.shuttingDown = false;
  registerIpcHandlers();
  createWindow();
  ensureOpenCodeProcess();
  if (app.isPackaged && !isStoreBuild()) {
    setupAutoUpdater();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopOpenCodeProcess();
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  stopOpenCodeProcess();
});
