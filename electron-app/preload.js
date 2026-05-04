"use strict"

const { contextBridge, ipcRenderer } = require("electron")

if (typeof document !== "undefined" && document.documentElement) {
  document.documentElement.classList.add("electron", "dark")
}

// ── Shortcut bridge ────────────────────────────────────────────────────────
// Menu accelerators in main.js broadcast `shortcut:*` events. The renderer
// has many components that may want to react (AppLayout, CommandPalette,
// BrowsePage, etc.). Rather than re-binding ipcRenderer.on in every one,
// expose a tiny pub/sub on window.__rvOnShortcut.

const shortcutListeners = new Set()
ipcRenderer.on("shortcut:navigate",       (_e, route) => fanout("navigate", route))
ipcRenderer.on("shortcut:toggle-sidebar", ()          => fanout("toggle-sidebar"))
ipcRenderer.on("shortcut:open-palette",   ()          => fanout("open-palette"))
ipcRenderer.on("shortcut:save-listing",   ()          => fanout("save-listing"))
ipcRenderer.on("shortcut:reanalyze",      ()          => fanout("reanalyze"))

function fanout(kind, arg) {
  for (const cb of shortcutListeners) {
    try { cb(kind, arg) } catch { /* swallow listener errors */ }
  }
}

contextBridge.exposeInMainWorld("__rvOnShortcut", (cb) => {
  shortcutListeners.add(cb)
  return () => { shortcutListeners.delete(cb) }
})

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Browser panel lifecycle ────────────────────────────────────────────────
  // Layout descriptor: { sidebarWidth, panelWidth }
  // Main computes browserView's bounds from this + the window's content
  // size on every change. Send on settle (drag end / sidebar toggle), not
  // per-frame — main animates between values.
  createBrowser:  (layout) => ipcRenderer.invoke("browser:create", layout),
  destroyBrowser: ()       => ipcRenderer.invoke("browser:destroy"),
  hideBrowser:    ()       => ipcRenderer.invoke("browser:hide"),
  showBrowser:    (layout) => ipcRenderer.invoke("browser:show", layout),
  getState:       ()       => ipcRenderer.invoke("browser:get-state"),

  // ── Tabs ────────────────────────────────────────────────────────────────
  listTabs:       ()       => ipcRenderer.invoke("browser:tabs:list"),
  newTab:         (url)    => ipcRenderer.invoke("browser:tabs:create", url ? { url } : {}),
  closeTab:       (id)     => ipcRenderer.invoke("browser:tabs:close", id),
  activateTab:    (id)     => ipcRenderer.invoke("browser:tabs:activate", id),
  onTabsState:    (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on("browser:tabs:state", h)
    return () => ipcRenderer.removeListener("browser:tabs:state", h)
  },

  // ── Navigation ────────────────────────────────────────────────────────────
  navigate:    (url)    => ipcRenderer.invoke("browser:navigate", url),
  back:        ()       => ipcRenderer.invoke("browser:back"),
  forward:     ()       => ipcRenderer.invoke("browser:forward"),
  reload:      ()       => ipcRenderer.invoke("browser:reload"),
  setLayout:   (layout) => ipcRenderer.invoke("browser:set-layout", layout),

  // ── Extraction ────────────────────────────────────────────────────────────
  extractDom:   () => ipcRenderer.invoke("browser:extract-dom"),
  analyze:      () => ipcRenderer.invoke("browser:analyze"),
  // User-initiated reanalyze. Drives the panel through the full broadcast
  // flow (panel:analyzing → panel:ready / panel:error). Fire-and-forget
  // from the renderer's perspective — listen for panel:ready / panel:error.
  reanalyze:    () => ipcRenderer.invoke("browser:reanalyze"),
  extractDebug: () => ipcRenderer.invoke("extract:debug:last"),

  // ── AI tagging — fire-and-forget after a save to enrich the deal ─────────
  tagDeal:      (payload) => ipcRenderer.invoke("ai:tag-deal", payload),

  // ── AI greeting — once-per-day, drives the Browse start-screen subhead ───
  generateGreeting: (context) => ipcRenderer.invoke("ai:greeting", context),

  // ── AI compare — short factual diff across 2-4 deals ─────────────────────
  compareDeals: (deals) => ipcRenderer.invoke("ai:compare-deals", deals),

  // ── AI palette query — free-form question or navigation hint ─────────────
  askQuery: (query, context) => ipcRenderer.invoke("ai:answer-query", { query, context }),

  // ── AI chat — conversational Q&A about the current listing ──────────────
  chatDeal: (query, context, history) =>
    ipcRenderer.invoke("ai:chat-deal", { query, context, history }),

  // ── Watch — re-fetch + re-extract each watched deal in a hidden view ────
  checkWatchedDeals: (deals) => ipcRenderer.invoke("watch:check-all", deals),

  // ── Live macro rates — drives the sidebar market context band ───────────
  getMortgageRate: () => ipcRenderer.invoke("rates:get-mortgage"),

  // ── Nav update (main → renderer) ──────────────────────────────────────────
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

  // ── Panel state (main → renderer) ─────────────────────────────────────────
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

  // AI tool-use bridge — when the chat handler in main detects an
  // adjust_scenario tool call from Anthropic, it forwards the changes
  // here so the active panel can apply them via applyScenarioFromBus.
  onApplyScenario: (cb) => {
    const h = (_e, changes) => cb(changes)
    ipcRenderer.on("ai:apply-scenario", h)
    return () => ipcRenderer.removeListener("ai:apply-scenario", h)
  },

  // Download lifecycle events fired by the embedded BrowserView's session.
  // Payload: { state: "started"|"completed"|"cancelled"|"interrupted",
  //            filename, savePath, totalBytes? }. Renderer surfaces a small
  //            toast for "started" and "completed" states.
  onDownloadState: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on("download:state", h)
    return () => ipcRenderer.removeListener("download:state", h)
  },

  // Theme system. The renderer's theme picker calls setTheme; main applies
  // vibrancy + nativeTheme + window background, persists, and broadcasts
  // theme:changed so the React tree can flip its <html> class.
  getTheme:        ()      => ipcRenderer.invoke("theme:get"),
  setTheme:        (theme) => ipcRenderer.invoke("theme:set", { theme }),
  onThemeChanged:  (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on("theme:changed", h)
    return () => ipcRenderer.removeListener("theme:changed", h)
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  signedIn:  ()    => ipcRenderer.invoke("auth:signed-in"),
  signedOut: ()    => ipcRenderer.invoke("auth:signed-out"),
  openOAuth: (url) => ipcRenderer.invoke("auth:open-oauth", url),

  // ── Config / API keys ─────────────────────────────────────────────────────
  getConfig:       ()    => ipcRenderer.invoke("config:get"),
  setOpenAIKey:    (key) => ipcRenderer.invoke("config:set-openai-key", key),
  hasOpenAIKey:    ()    => ipcRenderer.invoke("config:has-openai-key"),
  setAnthropicKey: (key) => ipcRenderer.invoke("config:set-anthropic-key", key),
  hasAnthropicKey: ()    => ipcRenderer.invoke("config:has-anthropic-key"),

  // ── Investment defaults — feed into the analysis pipeline ────────────────
  getInvestmentPrefs: ()       => ipcRenderer.invoke("config:get-investment-prefs"),
  setInvestmentPrefs: (patch)  => ipcRenderer.invoke("config:set-investment-prefs", patch),
})
