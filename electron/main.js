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
};

function getProviderKey(provider) {
  const field = PROVIDER_KEY_MAP[provider];
  if (!field) return null;
  const encrypted = store.get(field);
  if (!encrypted) return null;
  if (!safeStorage.isEncryptionAvailable()) return encrypted;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return null;
  }
}

function setProviderKey(provider, key) {
  const field = PROVIDER_KEY_MAP[provider];
  if (!field) return;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is not available on this system. API keys cannot be saved.");
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
          "connect-src https://openrouter.ai https://api.openai.com https://api.anthropic.com https://router.huggingface.co https://huggingface.co; " +
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

// ── Path validation helper ───────────────────────────────────────────────────
function isPathAllowed(targetPath) {
  if (!allowedBasePath) return false;
  const resolved = path.resolve(targetPath);
  const base = path.resolve(allowedBasePath);
  return resolved === base || resolved.startsWith(base + path.sep);
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
    const base = path.resolve(allowedBasePath);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
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
const VALID_PROVIDERS = new Set(["openrouter", "openai", "anthropic", "huggingface"]);
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
    shell: true,
    windowsHide: true,
    env: process.env,
  };
  if (cwd && typeof cwd === "string") opts.cwd = cwd;

  let proc;
  try {
    proc = spawn(command, [], opts);
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
  registerIpcHandlers();
  createWindow();
  if (app.isPackaged && !isStoreBuild()) {
    setupAutoUpdater();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
