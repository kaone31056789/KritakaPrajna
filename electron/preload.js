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
  exportMemory: (payload) => ipcRenderer.invoke("memory-export", payload),
  // Ollama API proxy (main-process request to avoid renderer CORS issues)
  ollamaApiRequest: (payload) => ipcRenderer.invoke("ollama-api-request", payload),
  // File system
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  readDir: (dirPath) => ipcRenderer.invoke("read-dir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
  extractPdfText: (filePath) => ipcRenderer.invoke("extract-pdf-text", filePath),
  extractPdfTextFromBuffer: (arrayBuffer) => ipcRenderer.invoke("extract-pdf-text-buffer", arrayBuffer),
  writeFile: (filePath, content) => ipcRenderer.invoke("write-file", filePath, content),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard-write-text", text),
  // Window controls
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  getPlatformInfo: () => ipcRenderer.invoke("get-platform-info"),
  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },
  // Web page fetching (runs in main process, bypasses CORS/CSP)
  fetchWebPage: (url) => ipcRenderer.invoke("web-fetch", url),
  // Real web search: DDG → parse result URLs → fetch articles in parallel
  searchWeb: (query) => ipcRenderer.invoke("web-search", query),
  // Fast news RSS search (detailed mode fetches full article text)
  googleAiSearch: (query, opts) => ipcRenderer.invoke("google-ai-search", query, opts),
  // Deep multi-query article research (DDG × 3 queries, for detailed analysis)
  deepSearch: (query) => ipcRenderer.invoke("deep-search", query),
  // Open URL in system browser
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  // Terminal command execution
  executeCommand: (command, cwd) => ipcRenderer.invoke("terminal-execute", { command, cwd }),
  killCommand: (id) => ipcRenderer.invoke("terminal-kill", id),
  onTerminalOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("terminal-output", handler);
    return () => ipcRenderer.removeListener("terminal-output", handler);
  },
  onTerminalDone: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("terminal-done", handler);
    return () => ipcRenderer.removeListener("terminal-done", handler);
  },
});
