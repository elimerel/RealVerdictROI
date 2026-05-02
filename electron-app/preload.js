"use strict"

const { contextBridge, ipcRenderer } = require("electron")

if (typeof document !== "undefined" && document.documentElement) {
  document.documentElement.classList.add("electron")
}

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Browser panel lifecycle ───────────────────────────────────────────────
  createBrowser:  (bounds) => ipcRenderer.invoke("browser:create", bounds),
  destroyBrowser: ()        => ipcRenderer.invoke("browser:destroy"),
  hideBrowser:    ()        => ipcRenderer.invoke("browser:hide"),
  showBrowser:    (bounds)  => ipcRenderer.invoke("browser:show", bounds),
  getState:       ()        => ipcRenderer.invoke("browser:get-state"),

  // ── Navigation ────────────────────────────────────────────────────────────
  navigate:    (url) => ipcRenderer.invoke("browser:navigate", url),
  back:        ()    => ipcRenderer.invoke("browser:back"),
  forward:     ()    => ipcRenderer.invoke("browser:forward"),
  reload:      ()    => ipcRenderer.invoke("browser:reload"),
  updateBounds:(bounds) => ipcRenderer.invoke("browser:bounds-update", bounds),

  // ── Extraction ────────────────────────────────────────────────────────────
  extractDom:   () => ipcRenderer.invoke("browser:extract-dom"),
  analyze:      () => ipcRenderer.invoke("browser:analyze"),
  extractDebug: () => ipcRenderer.invoke("extract:debug:last"),

  // ── Nav update (main → renderer) ─────────────────────────────────────────
  onNavUpdate: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on("browser:nav-update", h)
    return () => ipcRenderer.removeListener("browser:nav-update", h)
  },

  onFocusUrlbar: (cb) => {
    const h = () => cb()
    ipcRenderer.on("browser:focus-urlbar", h)
    return () => ipcRenderer.removeListener("browser:focus-urlbar", h)
  },

  // ── Panel state (main → renderer) ────────────────────────────────────────
  onPanelAnalyzing: (cb) => {
    const h = () => cb()
    ipcRenderer.on("panel:analyzing", h)
    return () => ipcRenderer.removeListener("panel:analyzing", h)
  },

  onPanelReady: (cb) => {
    const h = (_e, result) => cb(result)
    ipcRenderer.on("panel:ready", h)
    return () => ipcRenderer.removeListener("panel:ready", h)
  },

  onPanelHide: (cb) => {
    const h = () => cb()
    ipcRenderer.on("panel:hide", h)
    return () => ipcRenderer.removeListener("panel:hide", h)
  },

  onPanelError: (cb) => {
    const h = (_e, message) => cb(message)
    ipcRenderer.on("panel:error", h)
    return () => ipcRenderer.removeListener("panel:error", h)
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  signedIn:  () => ipcRenderer.invoke("auth:signed-in"),
  signedOut: () => ipcRenderer.invoke("auth:signed-out"),
  openOAuth: (url) => ipcRenderer.invoke("auth:open-oauth", url),

  // ── Config / API keys ─────────────────────────────────────────────────────
  getConfig:       () => ipcRenderer.invoke("config:get"),
  setOpenAIKey:    (key) => ipcRenderer.invoke("config:set-openai-key", key),
  hasOpenAIKey:    () => ipcRenderer.invoke("config:has-openai-key"),
  setAnthropicKey: (key) => ipcRenderer.invoke("config:set-anthropic-key", key),
  hasAnthropicKey: () => ipcRenderer.invoke("config:has-anthropic-key"),
})
