"use strict"

const { app, BrowserWindow, WebContentsView, ipcMain, screen } = require("electron")
const path = require("path")
const fs = require("fs")

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() }

app.on("second-instance", () => {
  if (appWindow && !appWindow.isDestroyed()) {
    if (appWindow.isMinimized()) appWindow.restore()
    appWindow.focus()
  }
})

// ---------------------------------------------------------------------------
// Constants & paths
// ---------------------------------------------------------------------------

const DEV = process.argv.includes("--dev")

// In dev mode, point at the local Next.js server so changes are reflected live.
// In production (packaged app), always talk to the live Vercel deployment.
const BASE_URL = DEV
  ? "http://127.0.0.1:3000"
  : "https://real-verdict-roi.vercel.app"

const LISTING_RE =
  /zillow\.com\/homedetails|redfin\.com\/[A-Z]{2}\/|realtor\.com\/realestateandhomes-detail|homes\.com\/property|trulia\.com\/p\//i

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json")

// Login window dimensions
const LOGIN_W = 420
const LOGIN_H = 560

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) } catch { return {} }
}

function writeConfig(data) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8")
  } catch (err) { console.error("[config] write error:", err) }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Single window that morphs between login (small) and main app (large).
 * No window swapping — just resize + navigate.
 * @type {BrowserWindow | null}
 */
let appWindow = null

/** @type {WebContentsView | null} */
let browserView = null

let isMainMode = false   // tracks whether window is currently in main-app mode

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

function centeredBounds(w, h) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  return {
    x: Math.round((sw - w) / 2),
    y: Math.round((sh - h) / 2),
    width: w,
    height: h,
  }
}

// ---------------------------------------------------------------------------
// Single app window
// ---------------------------------------------------------------------------

function createAppWindow() {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.focus()
    return
  }

  isMainMode = false

  appWindow = new BrowserWindow({
    ...centeredBounds(LOGIN_W, LOGIN_H),
    resizable: false,
    show: false,
    backgroundColor: "#09090b",
    // hiddenInset from the start so traffic lights are always in place
    // and the window can expand into main-app mode without recreating it.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 8 },
    // macOS: pass the first click straight to the web content instead of
    // just focusing the window.  Without this the user has to click twice
    // before any button or input responds, making the login form feel broken.
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Reveal once the first paint is ready (no blank flash)
  appWindow.once("ready-to-show", () => {
    if (appWindow && !appWindow.isDestroyed()) appWindow.show()
  })

  appWindow.loadURL(`${BASE_URL}/login?source=electron`)

  appWindow.on("resize", () => syncBrowserViewBounds())
  appWindow.on("move",   () => syncBrowserViewBounds())
  appWindow.on("closed", () => {
    destroyBrowserView()
    appWindow = null
    isMainMode = false
    app.quit()
  })

  // Catch any navigation that lands on an app page while still in login mode.
  // This covers: OAuth callback redirect → /search (server-side redirect that
  // bypasses the IPC path), and any other case where the window ends up on an
  // authenticated app page without going through the auth:signed-in IPC.
  appWindow.webContents.on("did-navigate", (_event, url) => {
    if (isMainMode) return
    try {
      const u = new URL(url)
      const isOurHost = DEV
        ? (u.hostname === "127.0.0.1")
        : (u.hostname === "real-verdict-roi.vercel.app")
      const isAppPage = !u.pathname.startsWith("/login") &&
                        !u.pathname.startsWith("/auth")
      if (isOurHost && isAppPage) {
        expandToMainApp()
      }
    } catch { /* ignore unparseable URLs */ }
  })
}

/**
 * Expand the window into full main-app mode after a successful sign-in.
 * Resizes to 1400×900 then navigates to /search.
 */
function expandToMainApp() {
  if (!appWindow || appWindow.isDestroyed()) return
  if (isMainMode) { appWindow.focus(); return }
  isMainMode = true

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const w = Math.min(1400, sw - 60)
  const h = Math.min(900,  sh - 60)

  appWindow.setResizable(true)
  appWindow.setMinimumSize(900, 600)
  // Resize first (no animation — keep it simple and reliable), then load.
  appWindow.setBounds(centeredBounds(w, h))
  appWindow.loadURL(`${BASE_URL}/search`)

  if (DEV) appWindow.webContents.openDevTools({ mode: "detach" })
}

/**
 * Shrink the window back to login mode after sign-out.
 * Animates to 420×560, then navigates to /login.
 */
function shrinkToLogin() {
  if (!appWindow || appWindow.isDestroyed()) return
  destroyBrowserView()
  isMainMode = false

  // Clear the minimum size before shrinking, then lock resizing
  appWindow.setMinimumSize(0, 0)
  appWindow.setResizable(false)
  appWindow.setBounds(centeredBounds(LOGIN_W, LOGIN_H), true)  // animated

  // Navigate after the animation has started so it doesn't flash
  setTimeout(() => {
    if (appWindow && !appWindow.isDestroyed()) {
      appWindow.loadURL(`${BASE_URL}/login?source=electron`)
    }
  }, 250)
}

// ---------------------------------------------------------------------------
// WebContentsView
// ---------------------------------------------------------------------------

let pendingBounds = null

function syncBrowserViewBounds() {
  if (!browserView || !pendingBounds) return
  browserView.setBounds(pendingBounds)
}

function createBrowserView() {
  if (browserView) return
  browserView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  browserView.webContents.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
  )
  appWindow.contentView.addChildView(browserView)

  const sendNav = () => {
    if (!appWindow || !browserView) return
    const url = browserView.webContents.getURL()
    appWindow.webContents.send("browser:nav-update", {
      url, title: browserView.webContents.getTitle(),
      isListing: LISTING_RE.test(url), loading: false,
    })
  }
  browserView.webContents.on("did-navigate",         sendNav)
  browserView.webContents.on("did-navigate-in-page", sendNav)
  browserView.webContents.on("page-title-updated",   sendNav)
  browserView.webContents.on("did-start-loading", () => {
    appWindow?.webContents.send("browser:nav-update", { loading: true })
  })
  browserView.webContents.on("did-stop-loading", sendNav)
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    browserView?.webContents.loadURL(url)
    return { action: "deny" }
  })
}

function destroyBrowserView() {
  if (!browserView) return
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.contentView.removeChildView(browserView)
  }
  try { browserView.webContents.close() } catch { /* already closed */ }
  browserView = null
  pendingBounds = null
}

function hideBrowserView() {
  if (!browserView) return
  browserView.setBounds({ x: 0, y: 0, width: 1, height: 1 })
}

function showBrowserView() {
  if (!browserView || !pendingBounds) return
  syncBrowserViewBounds()
}

// ---------------------------------------------------------------------------
// IPC — browser panel
// ---------------------------------------------------------------------------

ipcMain.handle("browser:create", (_e, bounds) => {
  if (browserView) { pendingBounds = bounds; syncBrowserViewBounds(); return { reused: true } }
  createBrowserView(); pendingBounds = bounds; syncBrowserViewBounds()
  return { reused: false }
})
ipcMain.handle("browser:destroy",      () => destroyBrowserView())
ipcMain.handle("browser:hide",         () => hideBrowserView())
ipcMain.handle("browser:show", (_e, bounds) => {
  if (!browserView) return { exists: false }
  pendingBounds = bounds; showBrowserView()
  const url = browserView.webContents.getURL()
  return { exists: true, url, title: browserView.webContents.getTitle(), isListing: LISTING_RE.test(url) }
})
ipcMain.handle("browser:get-state", () => {
  if (!browserView) return { exists: false }
  const url = browserView.webContents.getURL()
  return { exists: true, url, title: browserView.webContents.getTitle(), isListing: LISTING_RE.test(url) }
})
ipcMain.handle("browser:navigate",     (_e, url) => browserView?.webContents.loadURL(url))
ipcMain.handle("browser:back",         () => { if (browserView?.webContents.canGoBack())    browserView.webContents.goBack()    })
ipcMain.handle("browser:forward",      () => { if (browserView?.webContents.canGoForward()) browserView.webContents.goForward() })
ipcMain.handle("browser:reload",       () => browserView?.webContents.reload())
ipcMain.handle("browser:bounds-update", (_e, bounds) => { pendingBounds = bounds; syncBrowserViewBounds() })

ipcMain.handle("browser:extract-dom", async () => {
  if (!browserView) return null
  try {
    return await browserView.webContents.executeJavaScript(`
      (() => {
        const clone = document.body.cloneNode(true)
        clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]').forEach(el => el.remove())
        return { url: window.location.href, title: document.title, text: (clone.innerText||"").slice(0,30000) }
      })()
    `)
  } catch (err) { console.error("[electron] extract-dom:", err); return null }
})

ipcMain.handle("browser:analyze", async () => {
  if (!browserView) return { error: "No browser session active." }
  let dom
  try {
    dom = await browserView.webContents.executeJavaScript(`
      (() => {
        const clone = document.body.cloneNode(true)
        clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]').forEach(el => el.remove())
        return { url: window.location.href, title: document.title, text: (clone.innerText||"").slice(0,30000) }
      })()
    `)
  } catch { return { error: "Could not read the page. Try reloading it." } }

  if (!dom || dom.text.length < 50)
    return { error: "Not enough page content. Make sure you're on a property listing." }

  // Read stored API keys to forward as request headers.
  // The Vercel API route checks these headers before falling back to env vars,
  // so user-supplied keys work even though this is a serverless deployment.
  const config = readConfig()
  const headers = { "Content-Type": "application/json" }
  if (config.anthropicApiKey) headers["X-Anthropic-Key"] = config.anthropicApiKey
  if (config.openaiApiKey)    headers["X-OpenAI-Key"]    = config.openaiApiKey

  try {
    const res = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: dom.url, title: dom.title, text: dom.text }),
      signal: AbortSignal.timeout(45_000),
    })
    const body = await res.json()
    if (!res.ok) return { error: body?.error ?? `Server error ${res.status}` }
    return body
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error." }
  }
})

// ---------------------------------------------------------------------------
// IPC — auth
// ---------------------------------------------------------------------------

ipcMain.handle("auth:signed-in",  () => expandToMainApp())
ipcMain.handle("auth:signed-out", () => shrinkToLogin())

/**
 * OAuth popup flow for Electron.
 *
 * Opens a dedicated BrowserWindow so the login window never navigates away.
 * Session cookies are shared across all BrowserWindows in the default
 * Electron session, so once the popup processes /auth/callback the main
 * window can navigate to the app and find itself authenticated.
 *
 * Detection strategy — three layers:
 *
 * 1. did-redirect-navigation: fires for EVERY server-side HTTP redirect
 *    BEFORE it completes.  Catches callback → /search redirect early.
 *
 * 2. did-navigate: fires once the navigation COMMITS (final URL after all
 *    redirects).  Catches the /search landing as a fallback.
 *
 * 3. did-navigate-in-page: hash-fragment / SPA navigation fallback.
 *
 * In all cases, once we detect a URL on our app host we hand it to the
 * main window and close the popup.  The main window's own did-navigate
 * listener then calls expandToMainApp().
 */
ipcMain.handle("auth:open-oauth", (_e, oauthUrl) => {
  return new Promise((resolve) => {
    const popup = new BrowserWindow({
      width: 520,
      height: 680,
      resizable: false,
      title: "Sign in with Google",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      parent: appWindow ?? undefined,
      modal: false,
    })

    popup.setMenuBarVisibility(false)

    // Spoof a standard Chrome user-agent.  Google rejects OAuth requests from
    // user-agents that contain "Electron" (embedded WebView policy).
    const chromeUA =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    popup.webContents.setUserAgent(chromeUA)
    popup.loadURL(oauthUrl)

    let resolved = false
    const finish = (url) => {
      if (resolved) return
      resolved = true
      // Load the callback / app URL in the main window so the session cookie
      // gets applied and the window navigates to the authenticated app.
      appWindow?.loadURL(url)
      popup.destroy()
      resolve({ ok: true })
    }

    const appHost = DEV ? "127.0.0.1" : "real-verdict-roi.vercel.app"

    const checkUrl = (url) => {
      try {
        const u = new URL(url)
        // Any URL on our app host means OAuth is done (or the callback has
        // been hit).  Hand it to the main window.
        if (u.hostname === appHost) {
          finish(url)
        }
      } catch { /* ignore */ }
    }

    // Layer 1: server-side redirects (fires BEFORE the redirect completes)
    popup.webContents.on("did-redirect-navigation", (_e, url) => checkUrl(url))

    // Layer 2: committed navigation (final URL after all redirects)
    popup.webContents.on("did-navigate", (_e, url) => checkUrl(url))

    // Layer 3: SPA / hash navigation
    popup.webContents.on("did-navigate-in-page", (_e, url) => checkUrl(url))

    popup.on("closed", () => {
      if (!resolved) resolve({ cancelled: true })
    })
  })
})

// ---------------------------------------------------------------------------
// IPC — config / API keys
// ---------------------------------------------------------------------------

ipcMain.handle("config:get", () => readConfig())
ipcMain.handle("config:set-openai-key", (_e, key) => {
  const config = readConfig()
  config.openaiApiKey = key
  writeConfig(config)
  return { ok: true }
})
ipcMain.handle("config:has-openai-key", () => {
  const config = readConfig()
  return !!(config.openaiApiKey || process.env.OPENAI_API_KEY)
})
ipcMain.handle("config:set-anthropic-key", (_e, key) => {
  const config = readConfig()
  config.anthropicApiKey = key
  writeConfig(config)
  return { ok: true }
})
ipcMain.handle("config:has-anthropic-key", () => {
  const config = readConfig()
  return !!(config.anthropicApiKey || process.env.ANTHROPIC_API_KEY)
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  createAppWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createAppWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
