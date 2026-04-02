const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Secure API key store
  getApiKey: () => ipcRenderer.invoke("store-get-key"),
  setApiKey: (key) => ipcRenderer.invoke("store-set-key", key),
  removeApiKey: () => ipcRenderer.invoke("store-remove-key"),
  // File system
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  readDir: (dirPath) => ipcRenderer.invoke("read-dir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
  extractPdfText: (filePath) => ipcRenderer.invoke("extract-pdf-text", filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke("write-file", filePath, content),
  // Window controls
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },
});
