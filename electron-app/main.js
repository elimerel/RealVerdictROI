"use strict"

const { app, BrowserWindow, WebContentsView, ipcMain, shell, session } = require("electron")
const { spawn } = require("child_process")
const path = require("path")
const http = require("http")
const net = require("net")

// ---------------------------------------------------------------------------
// Single-instance lock — prevents "multiplied itself" on repeat clicks
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  // process exits here; nothing below runs in the second instance
}

// If a second instance tries to launch, just focus the existing window
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEV = process.argv.includes("--dev")

// Regex matching individual property listing pages
const LISTING_RE =
  /zillow\.com\/homedetails|redfin\.com\/[A-Z]{2}\/|realtor\.com\/realestateandhomes-detail|homes\.com\/property|trulia\.com\/p\//i

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const nextRoot = app.isPackaged
  ? path.join(process.resourcesPath, "nextapp")
  : path.join(__dirname, "..")

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {BrowserWindow | null} */
let mainWindow = null

/** @type {WebContentsView | null} */
let browserView = null

/** @type {import("child_process").ChildProcess | null} */
let serverProcess = null

/** The port the Next.js server is actually running on */
let PORT = 3000

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

/** Returns true if something is already listening on `port`. */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once("error", () => resolve(true))
    tester.once("listening", () => { tester.close(); resolve(false) })
    tester.listen(port, "127.0.0.1")
  })
}

/** Find a free port starting from `start`. */
async function findFreePort(start = 3000) {
  let port = start
  while (await isPortInUse(port)) {
    port++
    if (port > start + 50) throw new Error("No free port found in range")
  }
  return port
}

// Path to the bundled loading screen HTML file
const LOADING_FILE = path.join(__dirname, "loading.html")

// ---------------------------------------------------------------------------
// Next.js server
// ---------------------------------------------------------------------------

function startNextServer(port) {
  let proc

  if (app.isPackaged) {
    const serverJs = path.join(nextRoot, "server.js")
    proc = spawn(process.execPath, [serverJs], {
      cwd: nextRoot,
      env: {
        ...process.env,
        // ELECTRON_RUN_AS_NODE makes the Electron binary behave like plain Node.js
        // so it can run the Next.js standalone server.js without Electron overhead
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
        NEXT_SHARP_PATH: "",
      },
    })
  } else {
    proc = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
      cwd: nextRoot,
      shell: true,
      env: { ...process.env, PORT: String(port) },
    })
  }

  proc.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`))
  proc.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`))
  proc.on("error", (err) => console.error("[next] spawn error:", err))

  return proc
}

/** Poll until the Next.js server responds, then resolve. */
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
      if (Date.now() > deadline) return reject(new Error("Next.js server did not start in time"))
      setTimeout(probe, 1000)
    }
    probe()
  })
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Show loading screen immediately — no blank window while server boots
  mainWindow.loadFile(LOADING_FILE)

  if (DEV) mainWindow.webContents.openDevTools({ mode: "detach" })

  mainWindow.on("closed", () => {
    destroyBrowserView()
    mainWindow = null
  })

  mainWindow.on("resize", () => syncBrowserViewBounds())
  mainWindow.on("move", () => syncBrowserViewBounds())
}

// ---------------------------------------------------------------------------
// WebContentsView (embedded browser panel)
// ---------------------------------------------------------------------------

let pendingBounds = null

function syncBrowserViewBounds() {
  if (!browserView || !pendingBounds) return
  const { x, y, width, height } = pendingBounds
  browserView.setBounds({ x, y, width, height })
}

function createBrowserView() {
  if (browserView) return

  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  browserView.webContents.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
  )

  mainWindow.contentView.addChildView(browserView)

  const sendNav = () => {
    if (!mainWindow || !browserView) return
    const url = browserView.webContents.getURL()
    const title = browserView.webContents.getTitle()
    const isListing = LISTING_RE.test(url)
    mainWindow.webContents.send("browser:nav-update", { url, title, isListing, loading: false })
  }

  browserView.webContents.on("did-navigate", sendNav)
  browserView.webContents.on("did-navigate-in-page", sendNav)
  browserView.webContents.on("page-title-updated", sendNav)
  browserView.webContents.on("did-start-loading", () => {
    mainWindow?.webContents.send("browser:nav-update", { loading: true })
  })
  browserView.webContents.on("did-stop-loading", sendNav)
  browserView.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[browser] did-fail-load:", code, desc, url)
  })

  browserView.webContents.setWindowOpenHandler(({ url }) => {
    browserView?.webContents.loadURL(url)
    return { action: "deny" }
  })
}

function destroyBrowserView() {
  if (!browserView) return
  if (mainWindow) mainWindow.contentView.removeChildView(browserView)
  browserView.webContents.close()
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
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("browser:create", (_e, bounds) => {
  if (browserView) {
    pendingBounds = bounds
    syncBrowserViewBounds()
    return { reused: true }
  }
  createBrowserView()
  pendingBounds = bounds
  syncBrowserViewBounds()
  return { reused: false }
})

ipcMain.handle("browser:destroy", () => { destroyBrowserView() })

ipcMain.handle("browser:hide", () => { hideBrowserView() })

ipcMain.handle("browser:show", (_e, bounds) => {
  if (!browserView) return { exists: false }
  pendingBounds = bounds
  showBrowserView()
  const url = browserView.webContents.getURL()
  const title = browserView.webContents.getTitle()
  const isListing = LISTING_RE.test(url)
  return { exists: true, url, title, isListing }
})

ipcMain.handle("browser:get-state", () => {
  if (!browserView) return { exists: false }
  const url = browserView.webContents.getURL()
  const title = browserView.webContents.getTitle()
  const isListing = LISTING_RE.test(url)
  return { exists: true, url, title, isListing }
})

ipcMain.handle("browser:navigate", (_e, url) => {
  if (!browserView) return
  browserView.webContents.loadURL(url)
})

ipcMain.handle("browser:back", () => {
  if (browserView?.webContents.canGoBack()) browserView.webContents.goBack()
})

ipcMain.handle("browser:forward", () => {
  if (browserView?.webContents.canGoForward()) browserView.webContents.goForward()
})

ipcMain.handle("browser:reload", () => { browserView?.webContents.reload() })

ipcMain.handle("browser:bounds-update", (_e, bounds) => {
  pendingBounds = bounds
  syncBrowserViewBounds()
})

ipcMain.handle("browser:extract-dom", async () => {
  if (!browserView) return null
  try {
    return await browserView.webContents.executeJavaScript(`
      (() => {
        const clone = document.body.cloneNode(true)
        clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]')
             .forEach(el => el.remove())
        return { url: window.location.href, title: document.title, text: (clone.innerText||"").slice(0,30000) }
      })()
    `)
  } catch (err) {
    console.error("[electron] extract-dom error:", err)
    return null
  }
})

ipcMain.handle("browser:analyze", async () => {
  if (!browserView) return { error: "No browser session active." }

  let dom
  try {
    dom = await browserView.webContents.executeJavaScript(`
      (() => {
        const clone = document.body.cloneNode(true)
        clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]')
             .forEach(el => el.remove())
        return { url: window.location.href, title: document.title, text: (clone.innerText||"").slice(0,30000) }
      })()
    `)
  } catch (err) {
    console.error("[electron] analyze: executeJavaScript failed:", err)
    return { error: "Could not read the page. Try reloading it." }
  }

  if (!dom || dom.text.length < 50) {
    return { error: "Not enough page content to analyze. Make sure you're on a property listing." }
  }

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
    console.error("[ipc] browser:analyze — fetch error:", err)
    return { error: err instanceof Error ? err.message : "Network error reaching analysis server." }
  }
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  // Find a free port first so we never collide with a leftover process
  try {
    PORT = await findFreePort(3000)
  } catch {
    PORT = 3000
  }

  // Show the window immediately with a loading screen — no blank stare
  createWindow()

  // Boot the server in the background
  serverProcess = startNextServer(PORT)

  waitForServer(PORT).then(() => {
    // Boot straight into the app, not the marketing homepage
    if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${PORT}/search`)
  }).catch((err) => {
    console.error("[electron]", err.message)
    // Fall back to the loading screen; it will show "Starting up…" which is
    // better than a black window. The user can quit and reopen.
    if (mainWindow) mainWindow.loadFile(LOADING_FILE)
  })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      waitForServer(PORT).then(() => {
        if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${PORT}/search`)
      }).catch(() => {})
    }
  })
})

app.on("window-all-closed", () => {
  serverProcess?.kill()
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  serverProcess?.kill()
})
