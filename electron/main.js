const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage, session } = require("electron");
const path = require("path");
const fs = require("fs");
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
  store.set("keyboardShortcuts", shortcuts || {});
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
  store.set("userMemory", {
    preferences: Array.isArray(memory?.preferences) ? memory.preferences : [],
    coding: Array.isArray(memory?.coding) ? memory.coding : [],
    context: Array.isArray(memory?.context) ? memory.context : [],
    autoMode: memory?.autoMode !== false,
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
  // PDF extraction is read-only on a user-selected file — no folder-scope restriction needed.
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

// ── IPC: window controls ────────────────────────────────────────────────────
ipcMain.handle("window-minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle("window-maximize", () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle("window-close", () => { if (mainWindow) mainWindow.close(); });

// ── IPC: manual update check ────────────────────────────────────────────────
ipcMain.handle("check-for-updates", () => {
  autoUpdater?.checkForUpdates().catch(() => {});
});

ipcMain.handle("get-app-version", () => app.getVersion());

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
