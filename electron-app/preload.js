"use strict"

const { contextBridge, ipcRenderer } = require("electron")

if (typeof document !== "undefined" && document.documentElement) {
  document.documentElement.classList.add("electron", "dark")
}

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Browser panel lifecycle ───────────────────────────────────────────────
  // Layout descriptor: `{ panelWidth }`. Toolbar height is hardcoded on
  // main (TOOLBAR_H=40) so the renderer doesn't have to plumb it through.
  createBrowser:  (layout) => ipcRenderer.invoke("browser:create", layout),
  destroyBrowser: ()       => ipcRenderer.invoke("browser:destroy"),
  hideBrowser:    ()       => ipcRenderer.invoke("browser:hide"),
  showBrowser:    (layout) => ipcRenderer.invoke("browser:show", layout),
  getState:       ()       => ipcRenderer.invoke("browser:get-state"),

  // ── Navigation ────────────────────────────────────────────────────────────
  navigate:    (url) => ipcRenderer.invoke("browser:navigate", url),
  back:        ()    => ipcRenderer.invoke("browser:back"),
  forward:     ()    => ipcRenderer.invoke("browser:forward"),
  reload:      ()    => ipcRenderer.invoke("browser:reload"),
  setLayout:   (layout) => ipcRenderer.invoke("browser:set-layout", layout),

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

// ── Shell API ────────────────────────────────────────────────────────────────
// Exposed only to the SHELL HTML (electron-app/shell/index.html) — the Next.js
// app uses electronAPI above instead.  Both APIs share a single preload so the
// appWindow's webContents can serve both /login (Next.js) and shell.html
// without recreating the window.
contextBridge.exposeInMainWorld("shellAPI", {
  navigate:         (route)  => ipcRenderer.invoke("shell:navigate", route),
  setContentBounds: (bounds) => ipcRenderer.invoke("shell:content-bounds", bounds),

  // Sidebar state is owned by main process — both the shell HTML and the
  // Next.js Toolbar read/write through these.  Main broadcasts changes to
  // both via "sidebar:state".
  toggleSidebar:    ()       => ipcRenderer.invoke("sidebar:toggle"),
  setSidebar:       (open)   => ipcRenderer.invoke("sidebar:set", open),
  getSidebarState:  ()       => ipcRenderer.invoke("sidebar:get-state"),

  onActiveRoute: (cb) => {
    const h = (_e, route) => cb(route)
    ipcRenderer.on("shell:active-route", h)
    return () => ipcRenderer.removeListener("shell:active-route", h)
  },
  onSidebarState: (cb) => {
    const h = (_e, open) => cb(open)
    ipcRenderer.on("sidebar:state", h)
    return () => ipcRenderer.removeListener("sidebar:state", h)
  },
})
