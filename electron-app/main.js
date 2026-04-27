"use strict"

const { app, BrowserWindow, WebContentsView, ipcMain, utilityProcess, screen } = require("electron")
const path = require("path")
const http = require("http")
const net = require("net")
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

const LISTING_RE =
  /zillow\.com\/homedetails|redfin\.com\/[A-Z]{2}\/|realtor\.com\/realestateandhomes-detail|homes\.com\/property|trulia\.com\/p\//i

const nextRoot = app.isPackaged
  ? path.join(process.resourcesPath, "nextapp")
  : path.join(__dirname, "..")

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json")
const LOADING_FILE = path.join(__dirname, "loading.html")

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

/** @type {import("electron").UtilityProcess | null} */
let serverProcess = null

let PORT = 3000
let serverReady = false
let isMainMode = false   // tracks whether window is currently in main-app mode

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

function isPortInUse(port) {
  return new Promise((resolve) => {
    const t = net.createServer()
    t.once("error", () => resolve(true))
    t.once("listening", () => { t.close(); resolve(false) })
    t.listen(port, "127.0.0.1")
  })
}

async function findFreePort(start = 3000) {
  let port = start
  while (await isPortInUse(port)) {
    port++
    if (port > start + 50) throw new Error("No free port in range")
  }
  return port
}

// ---------------------------------------------------------------------------
// Next.js server
// ---------------------------------------------------------------------------

function startNextServer(port) {
  const config = readConfig()

  if (!app.isPackaged) {
    const { spawn } = require("child_process")
    const proc = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
      cwd: nextRoot, shell: true,
      env: { ...process.env, PORT: String(port) },
    })
    proc.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`))
    proc.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`))
    return proc
  }

  const serverJs = path.join(nextRoot, "server.js")
  const child = utilityProcess.fork(serverJs, [], {
    cwd: nextRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      NEXT_SHARP_PATH: "",
      USER_DATA_PATH: app.getPath("userData"),
      ...(config.openaiApiKey    ? { OPENAI_API_KEY:    config.openaiApiKey    } : {}),
      ...(config.anthropicApiKey ? { ANTHROPIC_API_KEY: config.anthropicApiKey } : {}),
    },
    stdio: "pipe",
  })
  child.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`))
  child.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`))
  return child
}

function waitForServer(port, maxMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + maxMs
    function probe() {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) return resolve()
        retry()
      })
      req.on("error", retry)
      req.setTimeout(1000, () => { req.destroy(); retry() })
    }
    function retry() {
      if (Date.now() > deadline) return reject(new Error("Next.js server timed out"))
      setTimeout(probe, 1000)
    }
    probe()
  })
}

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

  if (!serverReady) {
    appWindow.loadFile(LOADING_FILE)
    // waitForServer() in app.whenReady() will navigate to /login once ready
  } else {
    appWindow.loadURL(`http://127.0.0.1:${PORT}/login?source=electron`)
  }

  appWindow.on("resize", () => syncBrowserViewBounds())
  appWindow.on("move",   () => syncBrowserViewBounds())
  appWindow.on("closed", () => {
    destroyBrowserView()
    appWindow = null
    isMainMode = false
    app.quit()
  })

  // Catch OAuth callback redirects: after Google (or any provider) redirects
  // back through /auth/callback, Next.js issues a server-side redirect to
  // /search.  That navigation bypasses the IPC path, so the small login window
  // would end up showing the full app crammed into 420×560.
  // Solution: watch for the window landing on any app-page while still in
  // login mode and call expandToMainApp(true) — resize only, no extra loadURL.
  appWindow.webContents.on("did-navigate", (_event, url) => {
    if (isMainMode) return
    try {
      const u = new URL(url)
      const isOurServer = u.hostname === "127.0.0.1" && u.port === String(PORT)
      const isAppPage   = !u.pathname.startsWith("/login") &&
                          !u.pathname.startsWith("/auth")
      if (isOurServer && isAppPage) {
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
  appWindow.loadURL(`http://127.0.0.1:${PORT}/search`)

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
      appWindow.loadURL(`http://127.0.0.1:${PORT}/login?source=electron`)
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

  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
 * window can navigate to /search and find itself authenticated.
 *
 * Detection strategy — three layers:
 *
 * 1. did-redirect-navigation: fires for EVERY server-side HTTP redirect
 *    BEFORE it completes.  Catches Google → /auth/callback redirect early.
 *
 * 2. did-navigate: fires once the navigation COMMITS (final URL after all
 *    redirects).  Catches the /search landing as a fallback.
 *
 * 3. did-navigate-in-page: hash-fragment / SPA navigation fallback.
 *
 * In all cases, once we detect a URL on our local server we hand it to the
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
      // If the URL is the auth callback, load it in the main window so the
      // session cookie gets set, then the main window redirects to /search.
      // If it's already /search (or any app page), load it directly — the
      // session cookie was already set by the callback the popup processed.
      appWindow?.loadURL(url)
      popup.destroy()
      resolve({ ok: true })
    }

    const checkUrl = (url) => {
      try {
        const u = new URL(url)
        // Any URL on our local server means OAuth is done (or the callback
        // has been hit).  Hand it to the main window.
        if (u.hostname === "127.0.0.1" && u.port === String(PORT)) {
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

app.whenReady().then(async () => {
  try { PORT = await findFreePort(3000) } catch { PORT = 3000 }

  serverProcess = startNextServer(PORT)

  // Boot server in the background; navigate to /login once ready
  waitForServer(PORT).then(() => {
    serverReady = true
    if (appWindow && !appWindow.isDestroyed() && !isMainMode) {
      appWindow.loadURL(`http://127.0.0.1:${PORT}/login?source=electron`)
      // Bring the window to the front after navigation so the first click
      // lands on the form rather than just focusing the window.
      appWindow.once("did-finish-load", () => {
        if (appWindow && !appWindow.isDestroyed()) appWindow.focus()
      })
    }
  }).catch((err) => {
    console.error("[electron] server failed to start:", err.message)
  })

  // Create the single app window (shows loading screen while server boots)
  createAppWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createAppWindow()
  })
})

app.on("window-all-closed", () => {
  serverProcess?.kill()
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  serverProcess?.kill()
})
