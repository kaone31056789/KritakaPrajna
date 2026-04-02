const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const store = new Store({
  encryptionKey: "kritakaprajna-v1",
  schema: {
    apiKey: { type: "string", default: "" },
  },
});

let mainWindow = null;

function createWindow() {
  Menu.setApplicationMenu(null);

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
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow = win;

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "../build/index.html"));
  } else {
    win.loadURL("http://localhost:3000");
  }
}

// ── IPC: pick a folder ──────────────────────────────────────────────────────
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ── IPC: read directory tree (1 level deep for lazy loading) ────────────────
ipcMain.handle("read-dir", async (_event, dirPath) => {
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

// ── IPC: extract text from PDF ──────────────────────────────────────────────
ipcMain.handle("extract-pdf-text", async (_event, filePath) => {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return { error: "PDF too large (max 5 MB)", text: null };
    }
    const pdfParse = require("pdf-parse");
    const buffer = await fs.promises.readFile(filePath);
    const data = await pdfParse(buffer);
    return { error: null, text: data.text, pages: data.numpages };
  } catch (err) {
    return { error: err.message, text: null };
  }
});

// ── IPC: write file (for diff accept) ───────────────────────────────────────
ipcMain.handle("write-file", async (_event, filePath, content) => {
  try {
    const resolved = path.resolve(filePath);
    await fs.promises.writeFile(resolved, content, "utf-8");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: secure API key store ───────────────────────────────────────────────
ipcMain.handle("store-get-key", () => store.get("apiKey") || null);
ipcMain.handle("store-set-key", (_event, key) => { store.set("apiKey", key); });
ipcMain.handle("store-remove-key", () => { store.delete("apiKey"); });

// ── IPC: window controls ────────────────────────────────────────────────────
ipcMain.handle("window-minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle("window-maximize", () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle("window-close", () => { if (mainWindow) mainWindow.close(); });

// ── Auto-updater setup ──────────────────────────────────────────────────────
function setupAutoUpdater() {
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

// ── IPC: manual update check ────────────────────────────────────────────────
ipcMain.handle("check-for-updates", () => {
  autoUpdater.checkForUpdates().catch(() => {});
});

ipcMain.handle("get-app-version", () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) {
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
