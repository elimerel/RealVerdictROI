"use strict"

const { app, BrowserWindow, WebContentsView, ipcMain, shell, session } = require("electron")
const { spawn } = require("child_process")
const path = require("path")
const http = require("http")

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = 3000
const DEV = process.argv.includes("--dev")

// Regex matching individual property listing pages (same as Chrome extension)
const LISTING_RE =
  /zillow\.com\/homedetails|redfin\.com\/[A-Z]{2}\/|realtor\.com\/realestateandhomes-detail|homes\.com\/property|trulia\.com\/p\//i

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// In production the Next.js standalone build lives in extraResources/nextapp.
// In dev we run next start from the repo root (parent of electron-app/).
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

// ---------------------------------------------------------------------------
// Next.js server
// ---------------------------------------------------------------------------

function startNextServer() {
  let proc

  if (app.isPackaged) {
    // Standalone output: run the self-contained server.js
    const serverJs = path.join(nextRoot, "server.js")
    proc = spawn(process.execPath, [serverJs], {
      cwd: nextRoot,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "production",
        // Point Next.js at the static assets inside the standalone bundle
        NEXT_SHARP_PATH: "",
      },
    })
  } else {
    // Dev: use next dev from the repo root
    proc = spawn("npm", ["run", "dev", "--", "-p", String(PORT)], {
      cwd: nextRoot,
      shell: true,
      env: { ...process.env, PORT: String(PORT) },
    })
  }

  proc.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`))
  proc.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`))

  return proc
}

/** Poll until the Next.js server responds, then resolve. */
function waitForServer(maxMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + maxMs
    function probe() {
      const req = http.get(`http://localhost:${PORT}/`, (res) => {
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

  mainWindow.loadURL(`http://localhost:${PORT}`)

  // Open DevTools in dev mode
  if (DEV) mainWindow.webContents.openDevTools({ mode: "detach" })

  mainWindow.on("closed", () => {
    destroyBrowserView()
    mainWindow = null
  })

  // Keep the browser view in sync when the window moves or resizes
  mainWindow.on("resize", () => syncBrowserViewBounds())
  mainWindow.on("move", () => syncBrowserViewBounds())
}

// ---------------------------------------------------------------------------
// WebContentsView (embedded browser panel)
// ---------------------------------------------------------------------------

/** Last bounds sent from the renderer (CSS pixels, relative to BrowserWindow). */
let pendingBounds = null

function syncBrowserViewBounds() {
  if (!browserView || !pendingBounds) return
  const { x, y, width, height } = pendingBounds
  console.log("[browser] setBounds →", x, y, width, height)
  browserView.setBounds({ x, y, width, height })
}

function createBrowserView() {
  if (browserView) return // already exists

  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Spoof a normal Chrome user-agent so real estate sites don't block us
  browserView.webContents.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
  )

  mainWindow.contentView.addChildView(browserView)
  console.log("[browser] WebContentsView created and added to contentView")

  // Relay navigation events back to the renderer
  const sendNav = () => {
    if (!mainWindow || !browserView) return
    const url = browserView.webContents.getURL()
    const title = browserView.webContents.getTitle()
    const isListing = LISTING_RE.test(url)
    console.log("[browser] nav-update →", url)
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

  // Open target=_blank links in the view itself, not a new window
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

// Hide view off-screen (preserves state/URL so the user can come back)
function hideBrowserView() {
  if (!browserView) return
  browserView.setBounds({ x: 0, y: 0, width: 1, height: 1 })
}

// Restore view to its last known bounds
function showBrowserView() {
  if (!browserView || !pendingBounds) return
  syncBrowserViewBounds()
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("browser:create", (_e, bounds) => {
  console.log("[ipc] browser:create bounds =", JSON.stringify(bounds))
  // Reuse existing view if one already exists (user returned to Research page)
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

ipcMain.handle("browser:destroy", () => {
  destroyBrowserView()
})

// Called when the Research page unmounts — keeps the view alive but invisible
ipcMain.handle("browser:hide", () => {
  hideBrowserView()
})

// Called when the Research page remounts — restores the view
ipcMain.handle("browser:show", (_e, bounds) => {
  if (!browserView) return { exists: false }
  pendingBounds = bounds
  showBrowserView()
  const url = browserView.webContents.getURL()
  const title = browserView.webContents.getTitle()
  const isListing = LISTING_RE.test(url)
  return { exists: true, url, title, isListing }
})

// Returns current browser state without changing anything
ipcMain.handle("browser:get-state", () => {
  if (!browserView) return { exists: false }
  const url = browserView.webContents.getURL()
  const title = browserView.webContents.getTitle()
  const isListing = LISTING_RE.test(url)
  return { exists: true, url, title, isListing }
})

ipcMain.handle("browser:navigate", (_e, url) => {
  console.log("[ipc] browser:navigate →", url)
  if (!browserView) return
  browserView.webContents.loadURL(url)
})

ipcMain.handle("browser:back", () => {
  if (browserView?.webContents.canGoBack()) browserView.webContents.goBack()
})

ipcMain.handle("browser:forward", () => {
  if (browserView?.webContents.canGoForward()) browserView.webContents.goForward()
})

ipcMain.handle("browser:reload", () => {
  browserView?.webContents.reload()
})

ipcMain.handle("browser:bounds-update", (_e, bounds) => {
  pendingBounds = bounds
  syncBrowserViewBounds()
})

// Extract DOM text from the embedded browser
ipcMain.handle("browser:extract-dom", async () => {
  console.log("[ipc] browser:extract-dom — view exists:", !!browserView)
  if (!browserView) return null
  try {
    const result = await browserView.webContents.executeJavaScript(`
      (() => {
        const clone = document.body.cloneNode(true)
        clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]')
             .forEach(el => el.remove())
        return {
          url:   window.location.href,
          title: document.title,
          text:  (clone.innerText || "").slice(0, 30000),
        }
      })()
    `)
    console.log("[ipc] extract-dom got", result?.text?.length ?? 0, "chars from", result?.url)
    return result
  } catch (err) {
    console.error("[electron] extract-dom error:", err)
    return null
  }
})

// Extract DOM + call /api/extract from the main process (no CORS restrictions)
ipcMain.handle("browser:analyze", async () => {
  if (!browserView) return { error: "No browser session active." }

  // Step 1: read the DOM
  let dom
  try {
    dom = await browserView.webContents.executeJavaScript(`
      (() => {
        const clone = document.body.cloneNode(true)
        clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]')
             .forEach(el => el.remove())
        return {
          url:   window.location.href,
          title: document.title,
          text:  (clone.innerText || "").slice(0, 30000),
        }
      })()
    `)
  } catch (err) {
    console.error("[electron] analyze: executeJavaScript failed:", err)
    return { error: "Could not read the page. Try reloading it." }
  }

  if (!dom || dom.text.length < 50) {
    return { error: "Not enough page content to analyze. Make sure you're on a property listing." }
  }

  console.log("[ipc] browser:analyze — sending", dom.text.length, "chars to extract API")

  // Step 2: call the extract API from the main process (bypasses CORS)
  try {
    const res = await fetch(`http://localhost:${PORT}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: dom.url, title: dom.title, text: dom.text }),
      signal: AbortSignal.timeout(45_000),
    })
    const body = await res.json()
    if (!res.ok) {
      console.error("[ipc] browser:analyze — API error:", res.status, body)
      return { error: body?.error ?? `Server error ${res.status}` }
    }
    console.log("[ipc] browser:analyze — success, address:", body?.address)
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
  serverProcess = startNextServer()

  try {
    await waitForServer()
  } catch (err) {
    console.error("[electron]", err.message)
    // Show the window anyway — Next.js may still be booting
  }

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  serverProcess?.kill()
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  serverProcess?.kill()
})
