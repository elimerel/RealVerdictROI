"use strict"

const { contextBridge, ipcRenderer } = require("electron")

// Mark the document as running inside Electron before the page loads.
// This lets CSS and JS avoid flash-of-wrong-layout without needing IPC.
if (typeof document !== "undefined" && document.documentElement) {
  document.documentElement.classList.add("electron")
}

// Expose a typed, locked-down API to the renderer process.
// Nothing from Node/Electron leaks through — only these explicit channels.
contextBridge.exposeInMainWorld("electronAPI", {
  // --- Browser panel lifecycle ---
  createBrowser: (bounds) => ipcRenderer.invoke("browser:create", bounds),
  destroyBrowser: () => ipcRenderer.invoke("browser:destroy"),
  hideBrowser: () => ipcRenderer.invoke("browser:hide"),
  showBrowser: (bounds) => ipcRenderer.invoke("browser:show", bounds),
  getState: () => ipcRenderer.invoke("browser:get-state"),

  // --- Navigation ---
  navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),

  // --- Layout sync ---
  updateBounds: (bounds) => ipcRenderer.invoke("browser:bounds-update", bounds),

  // --- Property extraction ---
  extractDom: () => ipcRenderer.invoke("browser:extract-dom"),
  // Extract DOM + call /api/extract — all from main process, no CORS
  analyze: () => ipcRenderer.invoke("browser:analyze"),
  // Last extraction round-trip trace, surfaced via the ⌘⇧D debug drawer
  extractDebug: () => ipcRenderer.invoke("extract:debug:last"),

  // --- Events from main → renderer ---
  onNavUpdate: (cb) => {
    const handler = (_event, payload) => cb(payload)
    ipcRenderer.on("browser:nav-update", handler)
    return () => ipcRenderer.removeListener("browser:nav-update", handler)
  },

  // --- Auth events ---
  signedIn: () => ipcRenderer.invoke("auth:signed-in"),
  signedOut: () => ipcRenderer.invoke("auth:signed-out"),
  // Opens a dedicated popup window for OAuth (Google, etc.) so the login
  // window never navigates away from the app to an auth provider.
  openOAuth: (url) => ipcRenderer.invoke("auth:open-oauth", url),

  // --- Config / API keys ---
  getConfig: () => ipcRenderer.invoke("config:get"),
  setOpenAIKey: (key) => ipcRenderer.invoke("config:set-openai-key", key),
  hasOpenAIKey: () => ipcRenderer.invoke("config:has-openai-key"),
  setAnthropicKey: (key) => ipcRenderer.invoke("config:set-anthropic-key", key),
  hasAnthropicKey: () => ipcRenderer.invoke("config:has-anthropic-key"),
})
