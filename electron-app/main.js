"use strict"

const { app, BrowserWindow, WebContentsView, ipcMain, utilityProcess } = require("electron")
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
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
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

// Config file lives in the user's Application Support folder — persists across updates
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json")

// ---------------------------------------------------------------------------
// Config helpers (API keys, preferences)
// ---------------------------------------------------------------------------

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
  } catch {
    return {}
  }
}

function writeConfig(data) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8")
  } catch (err) {
    console.error("[config] write error:", err)
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {BrowserWindow | null} */
let mainWindow = null

/** @type {WebContentsView | null} */
let browserView = null

/** @type {import("electron").UtilityProcess | null} */
let serverProcess = null

let PORT = 3000

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
// Loading screen
// ---------------------------------------------------------------------------

const LOADING_FILE = path.join(__dirname, "loading.html")

// ---------------------------------------------------------------------------
// Next.js server via utilityProcess (no Dock icon, no ELECTRON_RUN_AS_NODE)
// ---------------------------------------------------------------------------

function startNextServer(port) {
  const config = readConfig()
  const serverJs = app.isPackaged
    ? path.join(nextRoot, "server.js")
    : path.join(nextRoot, "node_modules", ".bin", "next") // unused in dev path

  if (!app.isPackaged) {
    // Dev: fall back to spawn for `npm run dev`
    const { spawn } = require("child_process")
    const proc = spawn("npm", ["run", "dev", "--", "-p", String(port)], {
      cwd: nextRoot,
      shell: true,
      env: { ...process.env, PORT: String(port) },
    })
    proc.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`))
    proc.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`))
    return proc
  }

  // Production: utilityProcess runs a Node.js script without showing in the Dock
  const child = utilityProcess.fork(serverJs, [], {
    cwd: nextRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      NEXT_SHARP_PATH: "",
      // Inject stored API keys into the server's environment
      ...(config.openaiApiKey ? { OPENAI_API_KEY: config.openaiApiKey } : {}),
    },
    stdio: "pipe",
  })

  child.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`))
  child.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`))
  child.on("exit", (code) => console.log(`[next] exited with code ${code}`))

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
  mainWindow.contentView.addChildView(browserView)

  const sendNav = () => {
    if (!mainWindow || !browserView) return
    const url = browserView.webContents.getURL()
    mainWindow.webContents.send("browser:nav-update", {
      url, title: browserView.webContents.getTitle(),
      isListing: LISTING_RE.test(url), loading: false,
    })
  }
  browserView.webContents.on("did-navigate", sendNav)
  browserView.webContents.on("did-navigate-in-page", sendNav)
  browserView.webContents.on("page-title-updated", sendNav)
  browserView.webContents.on("did-start-loading", () => {
    mainWindow?.webContents.send("browser:nav-update", { loading: true })
  })
  browserView.webContents.on("did-stop-loading", sendNav)
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
// IPC — browser panel
// ---------------------------------------------------------------------------

ipcMain.handle("browser:create", (_e, bounds) => {
  if (browserView) { pendingBounds = bounds; syncBrowserViewBounds(); return { reused: true } }
  createBrowserView(); pendingBounds = bounds; syncBrowserViewBounds()
  return { reused: false }
})
ipcMain.handle("browser:destroy", () => destroyBrowserView())
ipcMain.handle("browser:hide", () => hideBrowserView())
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
ipcMain.handle("browser:navigate", (_e, url) => browserView?.webContents.loadURL(url))
ipcMain.handle("browser:back", () => { if (browserView?.webContents.canGoBack()) browserView.webContents.goBack() })
ipcMain.handle("browser:forward", () => { if (browserView?.webContents.canGoForward()) browserView.webContents.goForward() })
ipcMain.handle("browser:reload", () => browserView?.webContents.reload())
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
  } catch (err) { console.error("[electron] extract-dom error:", err); return null }
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
  } catch (err) { return { error: "Could not read the page. Try reloading it." } }

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
// IPC — config (API keys)
// ---------------------------------------------------------------------------

ipcMain.handle("config:get", () => readConfig())

ipcMain.handle("config:set-openai-key", (_e, key) => {
  const config = readConfig()
  config.openaiApiKey = key
  writeConfig(config)
  // The key takes effect on the NEXT server start; if user just set it, prompt to restart
  return { ok: true }
})

ipcMain.handle("config:has-openai-key", () => {
  const config = readConfig()
  return !!(config.openaiApiKey || process.env.OPENAI_API_KEY)
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  try { PORT = await findFreePort(3000) } catch { PORT = 3000 }

  createWindow()

  serverProcess = startNextServer(PORT)

  waitForServer(PORT).then(() => {
    if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${PORT}/search`)
  }).catch((err) => {
    console.error("[electron]", err.message)
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
