"use strict"

const { contextBridge, ipcRenderer } = require("electron")

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

  // --- Events from main → renderer ---
  onNavUpdate: (cb) => {
    const handler = (_event, payload) => cb(payload)
    ipcRenderer.on("browser:nav-update", handler)
    return () => ipcRenderer.removeListener("browser:nav-update", handler)
  },
})
