"use strict"

const { app, BrowserWindow, WebContentsView, ipcMain, screen, session, Menu, nativeTheme } = require("electron")
const path = require("path")
const fs = require("fs")

// Pinned to the Chromium version inside the current Electron build so the
// embedded browser presents a clean, indistinguishable Chrome user-agent
// to Zillow / Redfin / etc. Computed once at module load so we don't pay
// the cost on every navigation.
//   - Pulls the major Chrome version (e.g. "130") from process.versions.chrome
//   - Falls back to a recent stable major if process.versions.chrome is
//     unavailable (shouldn't happen in any real Electron build)
const CHROMIUM_MAJOR = (process.versions.chrome || "130").split(".")[0]
const CHROME_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  `Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36`

// Load .env.local from the repo root in dev so the Anthropic / OpenAI keys
// reach the main process. Without this, only the Next.js renderer sees env
// vars and the Electron-side extractor falls back to "no_key".
//
// In packaged production builds, the user supplies their key via Settings
// (config.json under userData) — this dotenv import is a no-op when there's
// no .env file to read, so it's safe to keep enabled in both environments.
try {
  const dotenvCandidates = [
    path.join(__dirname, "..", ".env.local"),
    path.join(__dirname, "..", ".env"),
  ]
  for (const f of dotenvCandidates) {
    if (fs.existsSync(f)) {
      require("dotenv").config({ path: f, override: false })
    }
  }
} catch (err) {
  console.warn("[main] dotenv load skipped:", err?.message ?? err)
}

// ---------------------------------------------------------------------------
// Native app menu
//
// Without a menu, macOS apps lack Edit (Cut/Copy/Paste), Window (Minimize),
// and the standard Cmd+Q quit handling. This makes the app feel broken to
// any Mac user who reaches for those shortcuts instinctively.
// ---------------------------------------------------------------------------

function buildAppMenu() {
  const isMac = process.platform === "darwin"

  return Menu.buildFromTemplate([
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    }] : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Back",
          accelerator: "CmdOrCtrl+[",
          click: () => {
            if (browserView?.webContents.canGoBack()) browserView.webContents.goBack()
          },
        },
        {
          label: "Forward",
          accelerator: "CmdOrCtrl+]",
          click: () => {
            if (browserView?.webContents.canGoForward()) browserView.webContents.goForward()
          },
        },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            // If the browser panel is active, reload the listing page.
            // Otherwise reload the app window (useful when the app itself glitches).
            if (browserView) browserView.webContents.reload()
            else appWindow?.webContents.reload()
          },
        },
        { type: "separator" },
        {
          label: "Open URL Bar",
          accelerator: "CmdOrCtrl+L",
          click: () => appWindow?.webContents.send("browser:focus-urlbar"),
        },
        { type: "separator" },
        {
          label: "Developer Tools",
          accelerator: "CmdOrCtrl+Alt+I",
          click: () => appWindow?.webContents.openDevTools({ mode: "detach" }),
        },
        {
          label: "Developer Tools (Browser Panel)",
          click: () => browserView?.webContents.openDevTools({ mode: "detach" }),
          visible: DEV,
        },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [
          { type: "separator" },
          { role: "front" },
          { type: "separator" },
          { role: "window" },
        ] : [{ role: "close" }]),
      ],
    },
  ])
}

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
// In production (packaged app), load the canonical deployment at realverdict.app
// unless REALVERDICT_APP_URL overrides (e.g. staging).
//
// Use "localhost" (not 127.0.0.1) so that:
//   1. Supabase OAuth callbacks registered for http://localhost:3000/auth/callback
//      actually match this window's origin — Supabase rejects redirects whose
//      hostname isn't on its allowlist, and the dashboard convention is
//      `localhost`.
//   2. The cookie jar matches: cookies set by the Supabase JS client on
//      `localhost` (origin of NEXT_PUBLIC_APP_URL) are visible to subsequent
//      requests from this window. Loading from `127.0.0.1` puts cookies in a
//      separate jar — that's the silent root cause of the "sign in loops back
//      to login" bug.
//
// Production points at the canonical custom domain. Override with
// REALVERDICT_APP_URL when testing against a preview deployment.
const PRODUCTION_APP_URL = (
  process.env.REALVERDICT_APP_URL || "https://realverdict.app"
).replace(/\/$/, "")
/** Hostnames that identify our own deployment (OAuth finish, nav guards). */
const PRODUCTION_APP_HOSTS = (() => {
  const s = new Set(["realverdict.app", "www.realverdict.app"])
  try {
    s.add(new URL(PRODUCTION_APP_URL).hostname)
  } catch { /* ignore */ }
  return s
})()
const BASE_URL = DEV ? "http://localhost:3000" : PRODUCTION_APP_URL

// URL hint for "should we auto-run extraction on this page?". A loose hint
// — the AI does the actual classification after reading the rendered DOM.
// We're permissive here so custom MLS / IDX / broker pages still trigger.
// Hosts on NEVER_HOSTS get a hard no.
const KNOWN_LISTING_HOSTS = /(?:^|\.)(zillow|redfin|realtor|homes|trulia|movoto|loopnet|compass)\.com$/i
const LISTING_PATH_HINTS = /\/(homedetails|home|property|listing|for-sale|for-rent|realestateandhomes-detail|idx|mls|properties)\/[a-z0-9-]/i
const NEVER_HOSTS = /(?:^|\.)(google|bing|duckduckgo|twitter|x|facebook|instagram|linkedin|youtube|reddit|nytimes|wikipedia|github|stackoverflow|apple|microsoft)\.[a-z.]+$/i
const AUTH_SUBDOMAINS = /^(identity|auth|accounts|login|sso|oauth|secure|signin|signup)\./i

function shouldAutoExtract(url) {
  try {
    const u = new URL(url)
    if (NEVER_HOSTS.test(u.hostname)) return false
    if (AUTH_SUBDOMAINS.test(u.hostname)) return false
    if (KNOWN_LISTING_HOSTS.test(u.hostname)) return true
    return LISTING_PATH_HINTS.test(u.pathname)
  } catch { return false }
}

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json")

// Login window dimensions
const LOGIN_W = 420
const LOGIN_H = 560

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function readConfig() {
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) } catch { /* no config yet */ }
  // Fall through to env vars when settings are blank — matters for dev
  // where keys live in .env.local, and for users who set the key in their
  // shell rather than the Settings UI.
  if (!cfg.anthropicApiKey && process.env.ANTHROPIC_API_KEY) {
    cfg.anthropicApiKey = process.env.ANTHROPIC_API_KEY
  }
  if (!cfg.openaiApiKey && process.env.OPENAI_API_KEY) {
    cfg.openaiApiKey = process.env.OPENAI_API_KEY
  }
  return cfg
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
// Window state persistence
//
// The main app window remembers its size and position between launches. The
// login window stays centered at fixed dimensions because it's modal-feeling
// — making it appear in the same spot every time keeps the launch UX
// predictable.
//
// Bounds live in the same config.json that already stores API keys. We
// validate against the current display layout so an unplugged external
// monitor doesn't hide the window off-screen.
// ---------------------------------------------------------------------------

const MAIN_DEFAULT_W = 1400
const MAIN_DEFAULT_H = 900
const MAIN_MIN_W     = 1100
const MAIN_MIN_H     = 700

function isBoundsOnScreen(bounds) {
  if (!bounds || typeof bounds.x !== "number") return false
  // The window is "on screen" if any display contains its top-left point.
  // This catches the unplugged-monitor case without forcing the window to
  // be entirely inside one display (multi-monitor setups intentionally
  // straddle edges).
  return screen.getAllDisplays().some(({ bounds: b }) => {
    return bounds.x >= b.x - 50 &&
           bounds.x <= b.x + b.width  - 50 &&
           bounds.y >= b.y - 50 &&
           bounds.y <= b.y + b.height - 50
  })
}

function readMainBounds() {
  const cfg = readConfig()
  const saved = cfg.mainWindowBounds
  if (!saved || !isBoundsOnScreen(saved)) {
    return centeredBounds(MAIN_DEFAULT_W, MAIN_DEFAULT_H)
  }
  return {
    x: saved.x,
    y: saved.y,
    width:  Math.max(MAIN_MIN_W, saved.width  || MAIN_DEFAULT_W),
    height: Math.max(MAIN_MIN_H, saved.height || MAIN_DEFAULT_H),
  }
}

function writeMainBoundsDebounced(bounds) {
  // Debounce — writing on every drag pixel is wasteful. 600ms after the
  // last move/resize event is short enough that a quit-immediately-after-
  // resize still persists, but doesn't flood disk during continuous drags.
  clearTimeout(writeMainBoundsDebounced._t)
  writeMainBoundsDebounced._t = setTimeout(() => {
    const cfg = readConfig()
    cfg.mainWindowBounds = bounds
    writeConfig(cfg)
  }, 600)
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
    // transparent + vibrancy gives us real macOS glass on the toolbar/panel.
    // backgroundColor must be absent (or fully transparent) for vibrancy to show.
    transparent: true,
    vibrancy: "sidebar",
    visualEffectState: "active",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 10 },
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,   // keeps preload isolated from page JS
      nodeIntegration: false,   // page JS cannot access Node APIs
      sandbox: false,           // MUST be explicit: Electron 20+ defaults to
                                // sandbox:true, which blocks loading preload
                                // scripts from inside an ASAR archive.
                                // contextIsolation:true is the real security
                                // boundary — sandbox adds nothing here.
    },
  })

  // Stamp a recognizable token onto the user-agent string. The login page
  // checks for it server-side and unconditionally renders the compact form
  // — so even if the user is bounced from a server-side `redirect("/login")`
  // (which strips ?source=electron), the small window never shows the
  // website-styled login card crammed into 420×560.
  //
  // We DON'T stamp "RealVerdictDesktop/1.0" onto the user-agent anymore —
  // that suffix made the embedded browser trivially fingerprintable and
  // single-tool-targetable by Zillow/Redfin. Instead we set a clean
  // Chromium UA AND inject a private custom request header on the app
  // window's session, which only realverdict.* endpoints read. Every
  // outbound request from the app window carries this header, but only
  // OUR backend knows or looks for it.
  try {
    appWindow.webContents.setUserAgent(CHROME_DESKTOP_UA)
  } catch { /* best-effort */ }
  try {
    const ses = appWindow.webContents.session
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      // Only stamp our own surfaces — never leak the marker to third-party
      // sites the user navigates to inside the embedded browser.
      const url = details.url || ""
      const isOwnHost =
        url.startsWith(BASE_URL) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url) ||
        /^https?:\/\/([a-z0-9-]+\.)*realverdict\.(app|com)(:|\/)/i.test(url)
      const headers = { ...details.requestHeaders }
      if (isOwnHost) headers["X-RealVerdict-Desktop"] = "1"
      callback({ requestHeaders: headers })
    })
  } catch (err) {
    console.warn("[main] failed to install request header:", err?.message ?? err)
  }

  // Cmd+Option+I (macOS) / Ctrl+Alt+I (Win/Linux) opens DevTools in any build.
  // Useful for diagnosing preload / IPC issues without a dev flag.
  appWindow.webContents.on("before-input-event", (_e, input) => {
    if (
      input.type === "keyDown" &&
      input.key === "I" &&
      (input.meta || input.control) &&
      input.alt
    ) {
      appWindow?.webContents.openDevTools({ mode: "detach" })
    }
  })

  // Reveal once the first paint is ready (no blank flash)
  appWindow.once("ready-to-show", () => {
    if (appWindow && !appWindow.isDestroyed()) appWindow.show()
  })

  appWindow.loadURL(`${BASE_URL}/login?source=electron`)

  const persistMainBounds = () => {
    if (!appWindow || appWindow.isDestroyed() || !isMainMode) return
    writeMainBoundsDebounced(appWindow.getBounds())
  }

  appWindow.on("resize", () => { syncBrowserViewBounds(); persistMainBounds() })
  appWindow.on("move",   () => { syncBrowserViewBounds(); persistMainBounds() })
  appWindow.on("close", () => {
    // Final, immediate write before tear-down — the debounced write may
    // not have fired if the user resized then immediately quit.
    if (appWindow && !appWindow.isDestroyed() && isMainMode) {
      const cfg = readConfig()
      cfg.mainWindowBounds = appWindow.getBounds()
      writeConfig(cfg)
    }
  })
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
        ? (u.hostname === "localhost" || u.hostname === "127.0.0.1")
        : PRODUCTION_APP_HOSTS.has(u.hostname)
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
 * Resizes to 1400×900 then navigates to /deals.
 */
// Timestamp of the last loadURL("/research") triggered by expandToMainApp.
// Used to suppress the re-entrant call that fires when ElectronExpand mounts
// on the freshly loaded /research page (isMainMode is already true by then).
let lastExpandNavMs = 0
const EXPAND_NAV_COOLDOWN_MS = 4000

function expandToMainApp() {
  if (!appWindow || appWindow.isDestroyed()) return

  if (isMainMode) {
    appWindow.focus()
    // Guard against:
    //   (a) hot-reload: renderer restarts on /deals while main never quit
    //   (b) macOS activate: window focused on /deals from last session
    // Use a cooldown so the re-entrant ElectronExpand mount on /research
    // doesn't trigger another loadURL and create an infinite loop.
    const now = Date.now()
    if (now - lastExpandNavMs > EXPAND_NAV_COOLDOWN_MS) {
      try {
        const pathname = new URL(appWindow.webContents.getURL()).pathname
        if (pathname !== "/browse") {
          lastExpandNavMs = now
          appWindow.loadURL(`${BASE_URL}/browse`)
        }
      } catch { /* ignore unparseable URL */ }
    }
    return
  }

  isMainMode = true
  lastExpandNavMs = Date.now()  // suppress the re-entrant ElectronExpand call

  appWindow.setResizable(true)
  appWindow.setMinimumSize(MAIN_MIN_W, MAIN_MIN_H)
  // Restore the user's last window size + position. If they've never opened
  // the app before, or the saved bounds are off-screen (unplugged monitor),
  // readMainBounds() falls back to a centered default.
  // `true` = animated resize on macOS — the window smoothly expands while
  // the page loads in the background rather than snapping.
  appWindow.setBounds(readMainBounds(), true)
  appWindow.loadURL(`${BASE_URL}/browse`)

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

  // Clear the minimum size before shrinking, then lock resizing.
  // `true` = animated — the window shrinks smoothly rather than snapping.
  appWindow.setMinimumSize(0, 0)
  appWindow.setResizable(false)
  appWindow.setBounds(centeredBounds(LOGIN_W, LOGIN_H), true)

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
  // Clean Chrome UA pinned to the current Chromium major. Identical to
  // what the user would send from a regular Chrome session — no Electron
  // suffix, no product marker. Required so listings sites don't flag
  // the WebContentsView as an embedded WebView.
  browserView.webContents.setUserAgent(CHROME_DESKTOP_UA)
  appWindow.contentView.addChildView(browserView)

  // Send a navigation state snapshot to the renderer.
  // ready=true is ONLY set from did-stop-loading; all other events update the
  // URL/title but intentionally leave loading:true so the React browserLoading
  // gate prevents analysis from firing before the page is fully rendered.
  const sendNav = (ready = false) => {
    if (!appWindow || !browserView) return
    const url = browserView.webContents.getURL()
    appWindow.webContents.send("browser:nav-update", {
      url,
      title:     browserView.webContents.getTitle(),
      isListing: shouldAutoExtract(url),
      canGoBack: browserView.webContents.canGoBack(),
      canGoForward: browserView.webContents.canGoForward(),
      ...(ready ? { loading: false } : {}),   // only did-stop-loading clears the loading flag
    })
  }
  browserView.webContents.on("did-navigate",         () => sendNav(false))
  browserView.webContents.on("did-navigate-in-page", () => sendNav(false))
  browserView.webContents.on("page-title-updated",   () => sendNav(false))
  browserView.webContents.on("did-start-loading", () => {
    appWindow?.webContents.send("browser:nav-update", { loading: true })
  })
  browserView.webContents.on("did-stop-loading", () => {
    sendNav(true)
    autoAnalyze()
  })
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    browserView?.webContents.loadURL(url)
    return { action: "deny" }
  })

  // Intercept keyboard shortcuts that should act on the app frame rather
  // than the embedded page. The browser view normally swallows these.
  browserView.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return
    const mod = process.platform === "darwin" ? input.meta : input.control

    // Cmd/Ctrl+L — focus OUR URL bar (not Chromium's invisible address bar).
    // preventDefault stops Chromium from handling it as "select all in URL bar"
    // which would be a no-op anyway since there's no visible URL bar in the view.
    if (mod && !input.shift && !input.alt && input.key === "l") {
      event.preventDefault()
      appWindow?.webContents.send("browser:focus-urlbar")
      return
    }

    // Cmd/Ctrl+Opt+I — DevTools for the browser panel itself.
    if (mod && input.alt && input.key === "I") {
      event.preventDefault()
      browserView.webContents.openDevTools({ mode: "detach" })
    }
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
  return {
    exists: true,
    url,
    title: browserView.webContents.getTitle(),
    isListing: shouldAutoExtract(url),
    canGoBack: browserView.webContents.canGoBack(),
    canGoForward: browserView.webContents.canGoForward(),
  }
})
ipcMain.handle("browser:get-state", () => {
  if (!browserView) return { exists: false }
  const url = browserView.webContents.getURL()
  return {
    exists: true,
    url,
    title: browserView.webContents.getTitle(),
    isListing: shouldAutoExtract(url),
    canGoBack: browserView.webContents.canGoBack(),
    canGoForward: browserView.webContents.canGoForward(),
  }
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

// ---------------------------------------------------------------------------
// Claude Haiku extraction — called directly from the Electron main process.
//
// Reads page text from the already-loaded webview (no scraping, no outbound
// URL fetch) and sends it to Anthropic's API.  Returns a parsed JSON object
// with exact field names or null on failure.
//
// Using Haiku: small payload (a listing page as plain text ≈ 3–5k tokens),
// fast (~1–2 s), cheap.  No round trip to the Next.js server.
// ---------------------------------------------------------------------------

// Site-neutral extraction prompt. Mirrors lib/extractor/prompt.ts — kept
// inline here because main.js is CommonJS and can't import the TS module.
// Plain JSON output (not Anthropic tool-use), so the wide schema doesn't
// trip Anthropic's property cap.
const HAIKU_EXTRACTION_PROMPT = `You are RealVerdict's listing reader. Take the rendered text of a web page and return ONE JSON object — nothing else, no markdown, no commentary.

OUTPUT SHAPE
{
  "kind": "listing-rental" | "listing-flip" | "listing-land" | "listing-newbuild" | "listing-multifamily" | "search-results" | "neighborhood" | "agent-profile" | "captcha" | "non-real-estate" | "unknown",
  "confidence": "high" | "medium" | "low",
  "facts": {
    "address":            string | null,
    "city":               string | null,
    "state":              string | null,
    "zip":                string | null,
    "listPrice":          number | null,
    "originalListPrice":  number | null,
    "daysOnMarket":       number | null,
    "priceHistoryNote":   string | null,
    "beds":               number | null,
    "baths":              number | null,
    "fullBaths":          number | null,
    "halfBaths":          number | null,
    "sqft":               number | null,
    "lotSqft":            number | null,
    "yearBuilt":          number | null,
    "garageSpaces":       number | null,
    "stories":            number | null,
    "propertyType":       string | null,
    "monthlyRent":        number | null,
    "monthlyHOA":         number | null,
    "annualPropertyTax":  number | null,
    "annualInsuranceEst": number | null,
    "conditionTag":       string | null,
    "riskFlags":          string[],
    "mlsNumber":          string | null,
    "listingDate":        string | null,
    "schoolRating":       number | null,
    "walkScore":          number | null,
    "siteName":           string | null
  },
  "meta": { /* per-field { confidence, note } overrides; omit if not needed */ },
  "take": string | null
}

KIND CLASSIFICATION
- "listing-rental":     a single for-sale residential property where rental underwriting makes sense (single family, condo, townhouse). Default when in doubt and a single property is shown.
- "listing-flip":       single property; page emphasizes ARV / "investor special" / "as-is" / "needs work" / fix-and-flip framing.
- "listing-land":       raw land, lot, "build your dream home".
- "listing-newbuild":   new construction, pre-construction, builder spec home.
- "listing-multifamily": 2-4 unit residential. NOT large apartment buildings.
- "search-results":     multiple properties shown. Set every fact to null.
- "neighborhood":       neighborhood / market / city overview. Set every fact to null.
- "agent-profile":      agent, office, or company page. Set every fact to null.
- "captcha":            human-verification, "press & hold", access-denied. Set every fact to null.
- "non-real-estate":    clearly not real estate. Set every fact to null.
- "unknown":            you genuinely cannot tell.

EXTRACTION RULES
- Return null for any field NOT explicitly stated on the page. NEVER estimate, infer, or invent.
- Money values: plain numbers, no $, no commas, no formatting.
- Lot size: convert acres to square feet (1 acre = 43,560).

CONTENT-USAGE RULES (read carefully)
RealVerdict only stores STRUCTURED FACTS and SHORT FACTUAL TAGS in
your own words. We do NOT republish marketing copy from the listing.
- riskFlags: short FACTUAL tags YOU GENERATE, max 3 words each, in
  your own words. Examples: "flood zone", "septic", "high HOA",
  "leasehold", "busy road", "tenant-occupied", "needs roof",
  "pre-1978". DO NOT lift sentences or marketing phrases from the
  listing copy. Empty array if nothing applies.
- conditionTag: a SHORT 1-3 word factual tag YOU GENERATE about
  property condition. Acceptable: "move-in ready", "needs work",
  "recently renovated", "as-is", "tear-down", "new construction",
  or null. NEVER paraphrase the listing's marketing copy.
- siteName: the platform as it appears.

DO NOT EXTRACT (deliberately omitted from the schema):
- Marketing descriptions / "about this home" / agent remarks
- Photos, captions, image URLs
- Walkthroughs, virtual-tour text, broker commentary

RENT — CRITICAL
- monthlyRent is ONLY a labeled rental estimate ("Rent Zestimate", "Estimated rent", "Rental estimate", "Market rent").
- NEVER use a mortgage payment, "Est. payment", "Monthly payment", or "P&I" as rent.
- If no rental estimate is shown, set monthlyRent to null.

CONFIDENCE
- Overall: "high" if address+listPrice are clear; "medium" if one is unclear; "low" if both missing or kind is not a listing.

SITE HINTS (only when visible; never invent)
- Zillow:      "Listed for", "Zestimate", "Rent Zestimate". Tax under "Public tax history". HOA in monthly cost breakdown.
- Redfin:      "Listed", "Redfin Estimate". HOA in fees table. Tax under "Property history".
- Realtor.com: "List Price", payment calculator carries tax / insurance / HOA.
- Homes.com:   "Asking", "Tax history". Rent rarely shown.
- Trulia:      "List price", "Estimated monthly rent". Some rent fields are mortgage estimates — only use the explicitly labeled rental figure.
- Compass:     "List Price". Listing remarks under "About this home".
- LoopNet:     "Asking Price". Cap rate sometimes shown directly.

TAKE
- "take" is one short sentence (12-22 words) on how the deal looks at face value. Plain language, no advice.
- Set take to null when kind is not a listing.`

/**
 * Call Anthropic's claude-haiku-4-5 directly from the Electron main process.
 * Bypasses the Next.js server entirely — the page text is already on this
 * machine and goes straight to Anthropic.
 *
 * @param {string} apiKey  Anthropic API key from local config
 * @param {{ url: string, title: string, text: string }} dom  Page content
 * @returns {Promise<object|null>}  Parsed extraction JSON or null
 */
// Anthropic requires dated model IDs for stable accuracy (the bare
// "claude-haiku-4-5" 404s on the public API). The dated form below is
// the version pinned in REALVERDICT_CONTEXT.md and in lib/extractor.
// Override at runtime via ANTHROPIC_MODEL env var if Anthropic rolls a
// newer build.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001"

// Last raw extraction round-trip — exposed via ipc "extract:debug:last"
// so the renderer can show a debug drawer instead of the user staring at
// "couldn't confidently read this listing" with no recourse.
let lastExtractDebug = null

async function callAnthropicHaiku(apiKey, dom) {
  const userMessage =
    `Page URL: ${dom.url}\nPage title: ${dom.title}\n\nPage text:\n${dom.text.slice(0, 22000)}`

  const reqStartedAt = Date.now()
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1800,
      system: HAIKU_EXTRACTION_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    lastExtractDebug = {
      stage: "anthropic-error",
      status: res.status,
      body: errText.slice(0, 600),
      model: ANTHROPIC_MODEL,
      durationMs: Date.now() - reqStartedAt,
      pageTextLength: dom.text.length,
    }
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`)
  }

  const response = await res.json()
  const text = response.content?.[0]?.text ?? ""
  const stopReason = response.stop_reason ?? null
  const usage = response.usage ?? null

  // Strip optional markdown fences before parsing
  const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  const match = jsonText.match(/\{[\s\S]*\}/)

  lastExtractDebug = {
    stage: "anthropic-ok",
    model: ANTHROPIC_MODEL,
    durationMs: Date.now() - reqStartedAt,
    pageTextLength: dom.text.length,
    stopReason,
    usage,
    rawText: text.slice(0, 4000),
    parsedJson: match ? match[0].slice(0, 3000) : null,
  }

  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch (err) {
    lastExtractDebug.parseError = err?.message ?? String(err)
    return null
  }
}

// Prevents concurrent auto-analysis runs (one at a time)
let autoAnalyzing = false

// ---------------------------------------------------------------------------
// Auto-analysis — fires on every did-stop-loading.
//
// Flow:
//   1. If URL doesn't look like a listing → send panel:hide
//   2. Send panel:analyzing (panel slides in with loading state)
//   3. Extract DOM → Haiku extraction → POST /api/analyze
//   4. Send panel:ready with full PanelResult, or panel:error on failure
// ---------------------------------------------------------------------------

async function autoAnalyze() {
  if (!browserView || !appWindow || autoAnalyzing) return

  const url = browserView.webContents.getURL()
  if (!shouldAutoExtract(url)) {
    appWindow.webContents.send("panel:hide")
    return
  }

  autoAnalyzing = true
  appWindow.webContents.send("panel:analyzing")
  lastExtractDebug = { stage: "started", at: new Date().toISOString() }

  try {
    // Wait for DOM to hydrate (SPAs fire did-stop-loading early)
    const POLL_TARGET_LEN = 1200
    const POLL_DEADLINE_MS = 18_000
    const pollStart = Date.now()
    let dom = null
    let highWater = 0

    while (Date.now() - pollStart < POLL_DEADLINE_MS) {
      try {
        dom = await browserView.webContents.executeJavaScript(`
          (() => {
            const clone = document.body.cloneNode(true)
            clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]').forEach(el => el.remove())
            return { url: window.location.href, title: document.title, text: (clone.innerText||"").slice(0,25000) }
          })()
        `)
      } catch { dom = null }
      const len = dom?.text?.length ?? 0
      if (len > highWater) highWater = len
      if (len >= POLL_TARGET_LEN) break
      await new Promise((r) => setTimeout(r, 750))
    }

    if (!dom || (dom.text?.length ?? 0) < 200) {
      appWindow.webContents.send("panel:error", "Couldn't read enough page content. Try refreshing the listing.")
      return
    }

    if (looksLikeCaptcha(dom.title, dom.text)) {
      appWindow.webContents.send("panel:error", "Verify you're not a robot, then the panel will populate.")
      return
    }

    const sig = scanSignals(dom.text, dom.url)
    if (sig.looksLikeSearchResults || !sig.looksLikeListing) {
      appWindow.webContents.send("panel:hide")
      return
    }

    const config = readConfig()
    const hostname = (() => { try { return new URL(dom.url).hostname.replace("www.", "") } catch { return "listing" } })()

    let extracted = null
    if (config.anthropicApiKey) {
      extracted = await callAnthropicHaiku(config.anthropicApiKey, dom)
    }

    if (!extracted) {
      appWindow.webContents.send("panel:error", "Add an Anthropic key in Settings to enable auto-analysis.")
      return
    }

    const extractResult = postProcess(extracted, hostname, "anthropic")
    if (!extractResult?.ok) {
      appWindow.webContents.send("panel:error", extractResult?.message ?? "Couldn't read this listing.")
      return
    }

    // POST to /api/analyze — runs FRED + HUD FMR enrichment + calculations
    const analyzeRes = await fetch(`${BASE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction: extractResult }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!analyzeRes.ok) {
      const body = await analyzeRes.json().catch(() => ({}))
      appWindow.webContents.send("panel:error", body?.message ?? "Analysis failed. Please try again.")
      return
    }

    const panelResult = await analyzeRes.json()
    appWindow.webContents.send("panel:ready", panelResult)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[autoAnalyze] error:", msg)
    appWindow.webContents.send("panel:error", "Something went wrong. Try refreshing the page.")
  } finally {
    autoAnalyzing = false
  }
}

// ---------------------------------------------------------------------------
// IPC — browser:analyze
//
// Extracts the fully-loaded page text from the embedded webview and sends it
// to Claude Haiku for structured extraction.  No scraping, no URL fetching,
// no round trip to the Next.js server.  The data is already on the machine.
//
// Key points:
// - Always uses Claude Haiku (fast, cheap, markup-agnostic)
// - Works on Zillow, Redfin, Realtor.com, and any other listing site
// - Falls back to /api/extract (OpenAI) only when no Anthropic key is set
// - RentCast is never called automatically (cost leak prevention)
// ---------------------------------------------------------------------------

// Tagged error codes the renderer maps to calm UI copy. Mirrors the values
// in lib/extractor/types.ts.
function userMessageFor(code) {
  switch (code) {
    case "no_key":              return "Add an Anthropic or OpenAI key in Settings to enable listing analysis."
    case "page_too_short":      return "Couldn't read enough page content. Try refreshing the listing."
    case "no_signals":          return "This doesn't look like a single listing. Open a property page to analyze it."
    case "search_results_page": return "Looks like a search results page. Open a listing to analyze it."
    case "captcha":             return "Verify you're not a robot to continue. The panel will populate once the listing loads."
    case "low_confidence":      return "Couldn't confidently read this listing — try refreshing or paste the URL."
    case "schema_too_complex":  return "Couldn't fully read this listing — try refreshing or paste the URL."
    case "network":             return "Network issue talking to the AI. Retry in a moment."
    default:                    return "Couldn't read this page. Try refreshing or paste the URL."
  }
}

// Strict captcha patterns. Mirrors lib/extractor/heuristics.ts. The previous
// looser version (bare /captcha/i) fired on real Zillow pages because the
// site's footer/cookie chrome contains the word "captcha".
const CAPTCHA_PATTERNS = [
  /press\s*&?\s*hold\s+to\s+confirm/i,
  /please\s+(confirm|verify)\s+you\s+are\s+(a\s+)?human/i,
  /verify\s+you('|’)?re\s+a\s+human/i,
  /are\s+you\s+a\s+robot\??/i,
  /unusual\s+traffic\s+from\s+your\s+computer\s+network/i,
  /this\s+page\s+is\s+protected\s+by\s+(captcha|recaptcha|hcaptcha|cloudflare)/i,
  /access\s+to\s+this\s+page\s+has\s+been\s+denied/i,
  /\bcaptcha\b/i,
  /please\s+complete\s+the\s+security\s+check/i,
  /checking\s+your\s+browser\s+before\s+accessing/i,
]

function looksLikeCaptcha(title, text) {
  const head = `${title || ""}\n${(text || "").slice(0, 2000)}`
  const isShort = (text || "").length < 600
  for (const re of CAPTCHA_PATTERNS) {
    if (!re.test(head)) continue
    // Bare /\bcaptcha\b/ is too loose on long pages — only accept it when
    // the page is short (i.e. content was actually blocked).
    if (re.source === "\\bcaptcha\\b" && !isShort) continue
    return true
  }
  return false
}

// Stage 2 — page signal scan. Mirrors lib/extractor/signals.ts. Only run
// the LLM when the page actually looks like a single listing. Saves spend
// on borderline pages and prevents the model from guessing when there's
// nothing to read.
const SIGNAL_PATTERNS = [
  { id: "list-price",   re: /\b(list(ed)?\s+price|listing\s+price|asking\s+price|listed\s+for)\b/i, w: 3 },
  { id: "for-sale",     re: /\bfor\s+sale\b/i,                                                      w: 2 },
  { id: "zestimate",    re: /\b(zestimate|redfin\s+estimate|realtor\.com\s+estimate)\b/i,           w: 3 },
  { id: "rent-est",     re: /\b(rent\s+zestimate|rental\s+estimate|estimated\s+rent|market\s+rent)\b/i, w: 2 },
  { id: "mls",          re: /\bmls\s*#?\s*[A-Z0-9-]+/i,                                             w: 3 },
  { id: "days-on-mkt",  re: /\bdays?\s+on\s+(zillow|market|redfin)/i,                               w: 2 },
  { id: "year-built",   re: /\byear\s+built\b/i,                                                     w: 2 },
  { id: "lot-size",     re: /\blot\s+(size|sq\s*ft|acres?)\b/i,                                      w: 1 },
  { id: "hoa",          re: /\bhoa\b|\bhomeowners?\s+association\b/i,                               w: 1 },
  { id: "property-tax", re: /\b(property\s+tax(es)?|annual\s+tax(es)?|tax\s+history)\b/i,           w: 1 },
  { id: "beds",         re: /\b\d+\s*(bed|br|beds|bedrooms?)\b/i,                                   w: 2 },
  { id: "baths",        re: /\b\d+(\.\d+)?\s*(bath|ba|baths|bathrooms?)\b/i,                        w: 2 },
  { id: "sqft",         re: /\b\d{3,5}\s*(sq\s*\.?\s*ft|sqft|square\s*feet)\b/i,                    w: 2 },
  { id: "price-shape",  re: /\$[\s]*\d{2,3}(?:,\d{3}){1,3}/,                                         w: 2 },
  { id: "street-name",  re: /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Ter|Terrace|Cir|Circle|Pkwy|Parkway)\b/, w: 2 },
]
const SEARCH_RESULTS_PATTERNS = [
  /\b\d{2,5}\s+(homes?|properties|listings?|results?)\s+(for\s+sale|matched|found|available)/i,
  /\bsort\s+by:?\s*(price|beds|sqft|newest|relevance)/i,
  /\bshowing\s+\d+\s*(-|–|to)\s*\d+\s+of\s+\d+/i,
  /\bsave\s+search\b/i,
  /\bprice\s+range\b.*\bbeds\b.*\bbaths\b/i,
]
const SIGNAL_THRESHOLD = 6

// URL paths that ARE a single listing (not a search results page) on the
// major sites. When the URL matches one of these, we trust it over the
// page-content heuristics — Zillow / Redfin / Realtor all sprinkle 8+
// related-property prices on a real listing page (carousels, "similar
// homes", price-history table) which would otherwise trip the
// "looks like search results" guard and starve the LLM call.
const STRONG_LISTING_URL_PATTERNS = [
  /\/homedetails\//i,                   // zillow.com/homedetails/<addr>/<zpid>
  /\/home\/[a-z0-9-]+/i,                // redfin.com/<state>/<city>/home/<id>
  /\/realestateandhomes-detail\//i,     // realtor.com
  /\/property\/[a-z0-9-]+/i,            // homes.com / generic
  /\/property-detail\//i,
  /\/listing\/[a-z0-9-]+/i,
]

function isStrongListingUrl(url) {
  try {
    const u = new URL(url)
    return STRONG_LISTING_URL_PATTERNS.some((re) => re.test(u.pathname))
  } catch { return false }
}

function scanSignals(text, url) {
  const t = text || ""
  let score = 0
  for (const sig of SIGNAL_PATTERNS) {
    if (sig.re.test(t)) score += sig.w
  }
  const strongUrl = isStrongListingUrl(url || "")
  const priceCount = (t.match(/\$\s*\d{2,3}(?:,\d{3}){1,3}/g) || []).length

  // Only treat the page as "search results" when an EXPLICIT search-results
  // phrase shows up. Pure price-count is too noisy: a real Zillow listing
  // will have 12+ price snippets from "similar homes" + price history.
  let looksLikeSearchResults = false
  for (const re of SEARCH_RESULTS_PATTERNS) {
    if (re.test(t)) { looksLikeSearchResults = true; break }
  }
  // For unknown URLs (custom MLS / broker pages) where we can't trust the
  // path, fall back to the price-count heuristic — but only at a higher
  // ceiling so it stays a real signal of "many listings on one page".
  if (!strongUrl && priceCount > 14) looksLikeSearchResults = true

  // Strong listing URLs lower the listing-signal bar — the URL itself is
  // worth ~3 points of evidence.
  const effectiveThreshold = strongUrl ? 3 : SIGNAL_THRESHOLD

  return {
    score,
    strongUrl,
    priceCount,
    looksLikeListing: score >= effectiveThreshold,
    looksLikeSearchResults,
  }
}

// Returns an ExtractResult — discriminated union of {ok:true, ...} or
// {ok:false, errorCode, message, ...}. The renderer NEVER sees a raw API
// error.
ipcMain.handle("browser:analyze", async () => {
  if (!browserView) {
    return { ok: false, errorCode: "unknown", message: userMessageFor("unknown") }
  }
  lastExtractDebug = { stage: "started", at: new Date().toISOString() }

  // Wait for the page to finish loading. Zillow / Redfin etc. fire
  // did-stop-loading on the SPA shell long before the React listing
  // body has hydrated, so we then poll the DOM until either:
  //   - innerText length > 1200 chars (a real listing has 2-15k), OR
  //   - 18 seconds have elapsed.
  // 18s feels long but we only burn it on slow connections; on a real
  // listing the body is usually present within 1-3 polls.
  if (browserView.webContents.isLoading()) {
    await new Promise((resolve) => {
      const h = () => resolve()
      browserView.webContents.once("did-stop-loading", h)
      setTimeout(() => { try { browserView.webContents.off("did-stop-loading", h) } catch {} resolve() }, 12_000)
    })
  } else {
    await new Promise((r) => setTimeout(r, 600))
  }

  // Pull the rendered DOM text, polling up to 18s for it to be substantial.
  // We strip nav/header/footer/script/style so the model gets the listing
  // content, not the site chrome.
  const POLL_TARGET_LEN = 1200
  const POLL_DEADLINE_MS = 18_000
  const pollStart = Date.now()
  let dom = null
  let domErr = null
  // Poll loop — first attempt happens immediately, then every 750ms.
  // Logs the high-water-mark length so the debug drawer can show
  // "we waited and the page never grew past N chars".
  let highWater = 0
  while (Date.now() - pollStart < POLL_DEADLINE_MS) {
    try {
      dom = await browserView.webContents.executeJavaScript(`
        (() => {
          const clone = document.body.cloneNode(true)
          clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]').forEach(el => el.remove())
          return { url: window.location.href, title: document.title, text: (clone.innerText||"").slice(0,25000) }
        })()
      `)
      domErr = null
    } catch (err) {
      domErr = err?.message ?? String(err)
      dom = null
    }
    const len = dom?.text?.length ?? 0
    if (len > highWater) highWater = len
    if (len >= POLL_TARGET_LEN) break
    await new Promise((r) => setTimeout(r, 750))
  }

  if (domErr) {
    lastExtractDebug = { stage: "dom-extract-failed", error: domErr, highWater }
    return { ok: false, errorCode: "page_too_short", message: userMessageFor("page_too_short") }
  }

  if (!dom || !dom.text || dom.text.length < 200) {
    lastExtractDebug = {
      stage: "page-too-short",
      pageTextLength: dom?.text?.length ?? 0,
      highWater,
      waitedMs: Date.now() - pollStart,
      url: dom?.url ?? null,
      title: dom?.title ?? null,
    }
    return { ok: false, errorCode: "page_too_short", message: userMessageFor("page_too_short") }
  }

  // Pre-flight: captcha / verification screen.
  if (looksLikeCaptcha(dom.title, dom.text)) {
    lastExtractDebug = { stage: "captcha-detected", title: dom.title, url: dom.url }
    return { ok: false, errorCode: "captcha", message: userMessageFor("captcha") }
  }

  // Stage 2: page signal scan. Skip the LLM when the page doesn't
  // actually look like a single listing.
  const sig = scanSignals(dom.text, dom.url)
  lastExtractDebug = {
    stage: "signal-scan",
    url: dom.url,
    pageTextLength: dom.text.length,
    signalScore: sig.score,
    strongUrl: sig.strongUrl,
    priceCount: sig.priceCount,
    looksLikeListing: sig.looksLikeListing,
    looksLikeSearchResults: sig.looksLikeSearchResults,
  }
  if (sig.looksLikeSearchResults) {
    return { ok: false, errorCode: "search_results_page", message: userMessageFor("search_results_page") }
  }
  if (!sig.looksLikeListing) {
    return { ok: false, errorCode: "no_signals", message: userMessageFor("no_signals") }
  }

  const config = readConfig()
  const hostname = (() => { try { return new URL(dom.url).hostname.replace("www.", "") } catch { return "the listing" } })()

  // Stage 3: LLM deep read. Prefer Anthropic Haiku locally.
  if (config.anthropicApiKey) {
    try {
      const extracted = await callAnthropicHaiku(config.anthropicApiKey, dom)
      const result = postProcess(extracted, hostname, "anthropic")
      if (result) return result
      return { ok: false, errorCode: "low_confidence", message: userMessageFor("low_confidence") }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[browser:analyze] extractor error:", msg)
      let code = "unknown"
      if (/too many properties|tool input schema|input_schema/i.test(msg)) code = "schema_too_complex"
      else if (/network|fetch|ETIMEDOUT|ECONNRESET|abort/i.test(msg))      code = "network"
      return { ok: false, errorCode: code, message: userMessageFor(code) }
    }
  }

  // Fallback: forward to /api/extract (server-side; uses OpenAI).
  if (!config.openaiApiKey) {
    return { ok: false, errorCode: "no_key", message: userMessageFor("no_key") }
  }

  try {
    const res = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenAI-Key": config.openaiApiKey,
      },
      body: JSON.stringify({ url: dom.url, title: dom.title, text: dom.text }),
      signal: AbortSignal.timeout(30_000),
    })
    const body = await res.json().catch(() => ({}))
    // /api/extract returns the same ExtractResult shape we use here.
    if (body && typeof body === "object") return body
    return { ok: false, errorCode: "unknown", message: userMessageFor("unknown") }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network"
    const code = /network|fetch|ETIMEDOUT|ECONNRESET|abort/i.test(msg) ? "network" : "unknown"
    return { ok: false, errorCode: code, message: userMessageFor(code) }
  }
})

// ---------------------------------------------------------------------------
// Post-processing: convert raw model JSON into an ExtractResult.
// Mirrors lib/extractor/index.ts coercion logic.
// ---------------------------------------------------------------------------
function postProcess(raw, hostname, modelUsed) {
  if (!raw || typeof raw !== "object") return null

  const num = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string") {
      const c = v.replace(/[$,\s]/g, "")
      if (!c || c.toLowerCase() === "null" || c.toLowerCase() === "n/a") return null
      const n = parseFloat(c)
      return Number.isFinite(n) ? n : null
    }
    return null
  }
  const str = (v) => {
    if (typeof v !== "string") return null
    const t = v.trim()
    if (!t || t.toLowerCase() === "null" || t.toLowerCase() === "n/a") return null
    return t
  }
  const arr = (v) => Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 10) : []
  /** Risk-flag whitelist: bounded to short FACTUAL tags (≤3 words,
   *  ≤32 chars). Hard cap of 8 entries. This is a defense-in-depth
   *  net so that even if the model drifts and returns a paraphrase of
   *  marketing copy, we never persist verbatim listing text. The
   *  legal posture is "we only store short factual tags." */
  const flagArr = (v) => {
    if (!Array.isArray(v)) return []
    return v
      .map(str)
      .filter(Boolean)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 32 && s.split(/\s+/).length <= 3)
      .slice(0, 8)
  }
  const conf = (v) => (v === "high" || v === "medium" || v === "low") ? v : "low"

  const validKinds = new Set([
    "listing-rental","listing-flip","listing-land","listing-newbuild",
    "listing-multifamily","search-results","neighborhood","agent-profile",
    "captcha","non-real-estate","unknown",
  ])
  const kind = validKinds.has(raw.kind) ? raw.kind : "unknown"
  const confidence = conf(raw.confidence)
  const f = raw.facts || {}

  const facts = {
    address:            str(f.address),
    city:               str(f.city),
    state:              str(f.state),
    zip:                str(f.zip),
    listPrice:          num(f.listPrice ?? f.price),
    originalListPrice:  num(f.originalListPrice),
    daysOnMarket:       num(f.daysOnMarket),
    priceHistoryNote:   str(f.priceHistoryNote),
    beds:               num(f.beds ?? f.bedrooms),
    baths:              num(f.baths ?? f.bathrooms),
    fullBaths:          num(f.fullBaths),
    halfBaths:          num(f.halfBaths),
    sqft:               num(f.sqft ?? f.squareFeet),
    lotSqft:            num(f.lotSqft),
    yearBuilt:          num(f.yearBuilt),
    garageSpaces:       num(f.garageSpaces),
    stories:            num(f.stories),
    propertyType:       str(f.propertyType),
    monthlyRent:        num(f.monthlyRent ?? f.rent),
    monthlyHOA:         num(f.monthlyHOA ?? f.hoa),
    annualPropertyTax:  num(f.annualPropertyTax ?? f.tax ?? f.propertyTax),
    annualInsuranceEst: num(f.annualInsuranceEst ?? f.insurance),
    // Accept the new conditionTag OR legacy conditionNotes — for
    // back-compat with model outputs that haven't updated yet.
    conditionTag:       str(f.conditionTag ?? f.conditionNotes),
    riskFlags:          flagArr(f.riskFlags),
    mlsNumber:          str(f.mlsNumber),
    listingDate:        str(f.listingDate),
    schoolRating:       num(f.schoolRating),
    walkScore:          num(f.walkScore),
    siteName:           str(f.siteName) || hostname,
  }
  const take = str(raw.take)

  if (kind === "captcha")        return { ok: false, errorCode: "captcha", message: userMessageFor("captcha") }
  if (kind === "search-results") return { ok: false, errorCode: "search_results_page", message: userMessageFor("search_results_page") }

  const isListingKind = String(kind).startsWith("listing-")
  const hasUsable =
    (facts.listPrice && facts.listPrice > 1000) ||
    (facts.address && facts.address.length > 5)

  if (!isListingKind || !hasUsable || confidence === "low") {
    return { ok: false, errorCode: "low_confidence", message: userMessageFor("low_confidence"), partial: facts }
  }

  // Default per-field meta. Same defaults as lib/extractor/index.ts.
  const meta = {}
  const addMeta = (k, c, note) => {
    const v = facts[k]
    const has = Array.isArray(v) ? v.length > 0 : v != null
    if (has) meta[k] = { source: "listing", confidence: c, note }
  }
  addMeta("listPrice", "high")
  addMeta("address", "high")
  addMeta("beds", "high")
  addMeta("baths", "high")
  addMeta("sqft", "high")
  addMeta("yearBuilt", "high")
  addMeta("monthlyHOA", "high")
  addMeta("annualPropertyTax", "high")
  addMeta("mlsNumber", "high")
  addMeta("monthlyRent", "medium", "Rental estimate from listing — verify against local comps before offering.")
  addMeta("annualInsuranceEst", "medium", "Listing-side insurance estimate — your actual quote may differ.")
  addMeta("schoolRating", "medium")
  addMeta("walkScore", "medium")
  // Apply model overrides on top.
  if (raw.meta && typeof raw.meta === "object") {
    for (const [k, v] of Object.entries(raw.meta)) {
      if (!v || typeof v !== "object") continue
      meta[k] = { source: "listing", confidence: conf(v.confidence), note: str(v.note) || undefined }
    }
  }

  return { ok: true, kind, confidence, facts, meta, take, modelUsed }
}

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

    // Standard Chrome user-agent. Google rejects OAuth requests from
    // user-agents that contain "Electron" (embedded WebView policy), so
    // we send the same clean Chromium UA the rest of the app uses.
    popup.webContents.setUserAgent(CHROME_DESKTOP_UA)
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

    const appHosts = DEV
      ? new Set(["localhost", "127.0.0.1"])
      : PRODUCTION_APP_HOSTS

    const checkUrl = (url) => {
      try {
        const u = new URL(url)
        // Any URL on our app host means OAuth is done (or the callback has
        // been hit).  Hand it to the main window.
        if (appHosts.has(u.hostname)) {
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

// Returns the most recent extraction round-trip trace. The renderer's
// debug drawer (⌘⇧D in /research) reads this so the user can see exactly
// why a listing failed instead of staring at a generic error message.
ipcMain.handle("extract:debug:last", () => {
  return lastExtractDebug ?? { stage: "idle", note: "No extraction has run yet." }
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  nativeTheme.themeSource = "dark"
  Menu.setApplicationMenu(buildAppMenu())
  createAppWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow()
    } else if (appWindow && !appWindow.isDestroyed() && isMainMode) {
      // macOS: user clicked the dock icon while the window was in the background.
      // Always surface /research so investors land at their analysis tool,
      // not wherever they happened to navigate last session.
      appWindow.focus()
      try {
        const pathname = new URL(appWindow.webContents.getURL()).pathname
        if (pathname !== "/research") {
          lastExpandNavMs = Date.now()
          appWindow.loadURL(`${BASE_URL}/research`)
        }
      } catch { /* ignore */ }
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
