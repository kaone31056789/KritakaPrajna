const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Secure API key store (OpenRouter legacy)
  getApiKey: () => ipcRenderer.invoke("store-get-key"),
  setApiKey: (key) => ipcRenderer.invoke("store-set-key", key),
  removeApiKey: () => ipcRenderer.invoke("store-remove-key"),
  // Multi-provider key management
  getProviderKey: (provider) => ipcRenderer.invoke("provider-get-key", provider),
  setProviderKey: (provider, key) => ipcRenderer.invoke("provider-set-key", provider, key),
  removeProviderKey: (provider) => ipcRenderer.invoke("provider-remove-key", provider),
  getAllProviderKeys: () => ipcRenderer.invoke("providers-get-all"),
  // Keyboard shortcuts
  getAllShortcuts: () => ipcRenderer.invoke("shortcuts-get-all"),
  setAllShortcuts: (shortcuts) => ipcRenderer.invoke("shortcuts-set-all", shortcuts),
  resetAllShortcuts: () => ipcRenderer.invoke("shortcuts-reset-all"),
  // User memory
  getMemory: () => ipcRenderer.invoke("memory-get"),
  setMemory: (memory) => ipcRenderer.invoke("memory-set", memory),
  resetMemory: () => ipcRenderer.invoke("memory-reset"),
  // File system
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  readDir: (dirPath) => ipcRenderer.invoke("read-dir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
  extractPdfText: (filePath) => ipcRenderer.invoke("extract-pdf-text", filePath),
  extractPdfTextFromBuffer: (arrayBuffer) => ipcRenderer.invoke("extract-pdf-text-buffer", arrayBuffer),
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
