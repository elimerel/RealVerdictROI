"use strict"

const { app, BrowserWindow, WebContentsView, ipcMain, screen, session, Menu, nativeTheme, clipboard, shell } = require("electron")
const path = require("path")
const fs = require("fs")

// electron-liquid-glass attempted and abandoned — the package's addView API
// adds NSGlassEffectView on top of WebContentsView in z-order with no exposed
// way to push it behind, which breaks all click events.  Sticking with native
// `vibrancy:"sidebar"` which is well-supported in Electron and does its job.

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

// Anti-fingerprint: disable the AutomationControlled blink feature so
// `navigator.webdriver` doesn't get flipped to true by Chromium itself,
// and so Cloudflare Turnstile / similar bot-detection systems stop
// flagging the embedded WebContentsView on first paint. Combined with
// the embed-preload that hard-defines navigator.webdriver = undefined,
// this keeps the embed's surface roughly indistinguishable from a real
// Chrome user-agent. Must run BEFORE app.whenReady() to take effect.
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled")

// Force the macOS menu-bar label and Dock title to "RealVerdict".
// In dev (`electron .`), Electron defaults app.name to the package.json
// "name" field — "realverdict-desktop" — which makes the macOS app menu
// say "Realverdict-Desktop". Setting it explicitly ensures the dev
// build matches the production build (which uses productName via
// electron-builder). Must run BEFORE app.whenReady().
app.setName("RealVerdict")

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
          click: () => broadcast("browser:focus-urlbar"),
        },
        {
          label: "Command Palette",
          accelerator: "CmdOrCtrl+K",
          click: () => broadcast("shortcut:open-palette"),
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
    // ── Go menu — route navigation + sidebar toggle. Menu accelerators are
    // OS-level so they fire even when the embedded browserView has focus
    // (which is most of the time once the user is on a listing).
    {
      label: "Go",
      submenu: [
        { label: "Browse",   accelerator: "CmdOrCtrl+1", click: () => broadcast("shortcut:navigate", "/browse")   },
        { label: "Pipeline", accelerator: "CmdOrCtrl+2", click: () => broadcast("shortcut:navigate", "/pipeline") },
        { label: "Settings", accelerator: "CmdOrCtrl+3", click: () => broadcast("shortcut:navigate", "/settings") },
        { type: "separator" },
        {
          label: "Toggle Sidebar",
          accelerator: "CmdOrCtrl+\\",
          click: () => broadcast("shortcut:toggle-sidebar"),
        },
      ],
    },
    // ── Tab menu — multi-tab keyboard shortcuts. New / close are OS-level
    // accelerators; next/prev fire even from inside a Zillow page.
    {
      label: "Tab",
      submenu: [
        {
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => createTab(undefined, { activate: true }),
        },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => { if (activeTabId) closeTab(activeTabId) },
        },
        { type: "separator" },
        {
          label: "Next Tab",
          accelerator: "Ctrl+Tab",
          click: () => stepActiveTab(+1),
        },
        {
          label: "Previous Tab",
          accelerator: "Ctrl+Shift+Tab",
          click: () => stepActiveTab(-1),
        },
      ],
    },
    // ── Deal menu — pipeline-related shortcuts. Save flows through here so
    // it works even when focus is inside the embedded browser.
    {
      label: "Deal",
      submenu: [
        {
          label: "Save Current Listing",
          accelerator: "CmdOrCtrl+S",
          click: () => broadcast("shortcut:save-listing"),
        },
        {
          label: "Re-analyze",
          accelerator: "Shift+CmdOrCtrl+R",
          click: () => broadcast("shortcut:reanalyze"),
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
const NEVER_HOSTS     = /(?:^|\.)(google|bing|duckduckgo|twitter|x|facebook|instagram|linkedin|youtube|reddit|nytimes|wikipedia|github|stackoverflow|apple|microsoft)\.[a-z.]+$/i
const AUTH_SUBDOMAINS = /^(identity|auth|accounts|login|sso|oauth|secure|signin|signup)\./i

// Listing-DETAIL URL patterns — each entry requires an ID-shaped tail
// so search/agent/region/map/saved pages can't slip through. The old
// "host is on a known site → auto-analyze" rule made the panel flicker
// on Zillow city pages, Redfin map views, Realtor agent profiles, etc.,
// because the heuristic accepted ANY URL on those hosts. The new rule
// is structural: a real listing has an ID in the URL, anything else is
// some other surface on the same site.
const LISTING_DETAIL_URL = new RegExp([
  // Zillow:    /homedetails/<slug>/<id>_zpid/
  String.raw`/homedetails/.+/\d+_zpid\b`,
  // Redfin:    /<state>/<city>/<address>/home/<id>
  String.raw`/home/\d+\b`,
  // Realtor:   /realestateandhomes-detail/<slug>_M<id>
  String.raw`/realestateandhomes-detail/.*M\d+`,
  // Trulia:    /p/<state>/<city>/<id>
  String.raw`/p/[A-Za-z]{2}/[A-Za-z0-9-]+/\d+`,
  // LoopNet:   /Listing/<id>/<slug>
  String.raw`/Listing/\d+`,
  // Generic / custom MLS / broker IDX
  String.raw`/(?:listing|property|properties|idx|mls)/[A-Za-z0-9-]+`,
].join("|"), "i")

function shouldAutoExtract(url) {
  try {
    const u = new URL(url)
    if (NEVER_HOSTS.test(u.hostname)) return false
    if (AUTH_SUBDOMAINS.test(u.hostname)) return false
    return LISTING_DETAIL_URL.test(u.pathname)
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
// Theme
//
// Five user-pickable themes (System / Dark / Warm Charcoal / Cinema /
// Light) — each maps to a distinct combination of vibrancy material,
// nativeTheme.themeSource, and BrowserWindow backgroundColor.
//
// "system" is special: it follows macOS appearance preferences via
// nativeTheme.shouldUseDarkColors, and re-resolves whenever the OS
// flips. The persisted choice is stored in config.json under `theme`.
// The resolved (concrete) variant gets broadcast to the renderer as
// `theme:changed` so the React tree can flip its <html> class to
// match the new token set.
// ---------------------------------------------------------------------------

const THEME_OPTIONS = ["system", "dark", "charcoal-warm", "light"]
const DEFAULT_THEME = "dark"

/** macOS vibrancy material per resolved theme. */
function vibrancyForTheme(resolved) {
  if (resolved === "light") return "light"
  return "sidebar"
}

/** Window backgroundColor fallback (visible only when vibrancy is briefly
 *  unavailable, e.g. during resize). Matches each theme's bg token. */
function backgroundForTheme(resolved) {
  switch (resolved) {
    case "light":            return "#f5f5f7"
    case "charcoal-warm":    return "#16120e"
    case "dark":
    default:                 return "#0a0a0c"
  }
}

/** "system" resolves to "dark" or "light" based on the OS preference;
 *  every other option resolves to itself. */
function resolveTheme(picked) {
  if (picked === "system") {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light"
  }
  if (THEME_OPTIONS.includes(picked) && picked !== "system") return picked
  return DEFAULT_THEME
}

let _systemListenerAttached = false
function ensureSystemThemeListener() {
  if (_systemListenerAttached) return
  _systemListenerAttached = true
  nativeTheme.on("updated", () => {
    const cfg = readConfig()
    if (cfg.theme !== "system") return
    applyTheme("system", { broadcastOnly: true })
  })
}

/** Apply a theme natively. Updates vibrancy, backgroundColor,
 *  nativeTheme.themeSource. Optionally persists to config and
 *  broadcasts the resolved value to the renderer. */
function applyTheme(picked, opts = {}) {
  const resolved = resolveTheme(picked)
  if (appWindow && !appWindow.isDestroyed()) {
    try { appWindow.setVibrancy(vibrancyForTheme(resolved)) } catch (err) {
      console.warn("[theme] setVibrancy failed:", err?.message ?? err)
    }
    try { appWindow.setBackgroundColor(backgroundForTheme(resolved)) } catch {}
  }
  nativeTheme.themeSource = resolved === "light" ? "light" : "dark"

  if (!opts.broadcastOnly) {
    const cfg = readConfig()
    cfg.theme = THEME_OPTIONS.includes(picked) ? picked : DEFAULT_THEME
    writeConfig(cfg)
    if (picked === "system") ensureSystemThemeListener()
  }

  broadcast("theme:changed", { picked, resolved })
}

ipcMain.handle("theme:get", () => {
  const cfg = readConfig()
  const picked = THEME_OPTIONS.includes(cfg.theme) ? cfg.theme : DEFAULT_THEME
  return { picked, resolved: resolveTheme(picked) }
})

ipcMain.handle("theme:set", (_e, payload) => {
  const picked = (payload && typeof payload.theme === "string") ? payload.theme : DEFAULT_THEME
  console.log("[theme] set:", picked, "→ resolved:", resolveTheme(picked))
  applyTheme(picked)
  return { ok: true, resolved: resolveTheme(picked) }
})

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
// IPC send helper
// ---------------------------------------------------------------------------
// Single-renderer model: appWindow.webContents IS the React app. No fan-out
// needed — kept as a helper so call sites stay short.
function broadcast(channel, ...args) {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.webContents.send(channel, ...args)
  }
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
    backgroundColor: "#0a0a0c",
    vibrancy: "sidebar",
    visualEffectState: "active",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
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

  appWindow.on("resize", () => {
    // Main owns layout — recompute synchronously on every native resize
    // tick from getContentBounds() + cached sidebar/panel state. This
    // skips the shell's DOM ResizeObserver + IPC roundtrip, keeping the
    // embedded views glued to the window edge without a frame of lag.
    // Window resize cancels any sidebar toggle tween in flight.
    cancelBvAnim()
    applyBrowserViewLayout()
    persistMainBounds()
  })
  appWindow.on("move", () => { persistMainBounds() })
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
 * Resizes to 1400×900 then navigates to /browse (unless already there).
 */
function expandToMainApp() {
  if (!appWindow || appWindow.isDestroyed()) return

  // Already in main mode — just focus. The Next.js app holds whatever
  // route the user was on (sidebar nav uses Next router).
  if (isMainMode) {
    appWindow.focus()
    return
  }

  isMainMode = true

  appWindow.setResizable(true)
  appWindow.setMinimumSize(MAIN_MIN_W, MAIN_MIN_H)
  appWindow.setBounds(readMainBounds(), true)

  // Skip the loadURL when the window already navigated to /browse via a
  // server-side redirect from /login (existing session). Only trigger a
  // fresh load when expansion was prompted by an explicit sign-in IPC.
  let alreadyOnApp = false
  try {
    const u = new URL(appWindow.webContents.getURL())
    alreadyOnApp =
      !u.pathname.startsWith("/login") && !u.pathname.startsWith("/auth")
  } catch { /* ignore */ }
  if (!alreadyOnApp) {
    appWindow.loadURL(`${BASE_URL}/browse`)
  }

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

// Toolbar height in CSS pixels — must match the React Toolbar's height
// (52px). If this drifts, browserView overlaps the bottom strip of the
// toolbar and intercepts clicks meant for the URL bar / nav buttons.
// Chrome heights above the embedded BrowserView. Must match the
// renderer's layout exactly:
//   - AppTopBar: 52px (always present, holds URL toolbar in Browse).
//   - BrowseTabsRow: 40px (always 40 in Browse mode — collapses to 0
//     on other routes, but BrowserView is only shown on Browse so
//     we always assume the 40 here).
// Total chrome above the BrowserView = 110px in Browse:
//   36px tab strip + 42px URL toolbar + 32px bookmarks bar.
//   Wexond / classic-Chrome proportions — denser, more tool-like.
const TOOLBAR_H        = 42
const TAB_STRIP_H      = 36
const BOOKMARKS_BAR_H  = 32

// Total chrome height above the embedded BrowserView in Browse mode.
// AppTopBar + BrowseTabsRow + BookmarksBar all live at the layout
// level and are unconditionally laid out when in Browse, so chrome
// is always 124px when the BrowserView is shown.
function activeChromeHeight() {
  return TAB_STRIP_H + TOOLBAR_H + BOOKMARKS_BAR_H
}

// Cached layout state. React (the renderer) pushes settled values via
// `browser:set-layout`; main animates browserView's bounds to match.
// These are the ONLY animation drivers in the system — sidebar/panel
// animations themselves run as pure CSS in the React tree.
let sidebarWidth = 220
let panelWidth   = 0
// Start parked. The native BrowserView is composited above the renderer,
// so any incidental applyBrowserViewLayout() before the renderer
// explicitly calls browser:show would put it on screen — regardless of
// what route the user is currently viewing. The renderer's gated show
// effect (routeActive && hasUrl) is the only thing that should reveal it.
let browserViewHidden = true

// Inset for the embedded BrowserView. Creates a thin RealVerdict-colored
// frame between the embedded site (Zillow / Redfin / etc.) and the app
// chrome around it. Without this, the Zillow page slams flush against
// the sidebar/panel and the whole experience reads as "browser extension
// fighting the host site for screen space" instead of "Zillow rendering
// inside RealVerdict."
//
// Top stays at chromeH so the BrowserView meets the toolbar cleanly
// (toolbar IS the chrome above). Left/right/bottom each pick up 6px of
// dark frame, just visible enough to separate the surfaces.
// BrowserView insets — were 6px on every side (creating a visible
// "frame" around the embedded page that the user called sloppy). Set
// to 0 so the web content runs edge-to-edge against the chrome and
// panel, with no exposed scrim band wrapping it.
const BV_INSET_SIDES  = 0
const BV_INSET_BOTTOM = 0

// Compute browserView bounds from cached state + the live window size.
// Called on every animation tick, on settled layout updates, and on
// window resize.
function applyBrowserViewLayout() {
  if (!appWindow || appWindow.isDestroyed()) return
  if (!browserView || browserViewHidden) return
  const c = appWindow.getContentBounds()
  const chromeH = activeChromeHeight()
  const x      = Math.round(sidebarWidth + BV_INSET_SIDES)
  const y      = chromeH
  const width  = Math.max(200, Math.round(c.width  - sidebarWidth - panelWidth - BV_INSET_SIDES * 2))
  const height = Math.max(0,   Math.round(c.height - chromeH - BV_INSET_BOTTOM))
  browserView.setBounds({ x, y, width, height })
}

// ── browserView bounds animation ──────────────────────────────────────────
// Single animation driver in the whole system. Runs an Apple-spring
// cubic-bezier tween that matches the React CSS sidebar transition
// exactly (same 220ms, same curve), so the listing's left edge tracks
// the sidebar's right edge in lockstep.

const { performance: perfNow } = require("node:perf_hooks")

function makeCubicBezier(p1x, p1y, p2x, p2y) {
  const bx = (t) => 3 * (1 - t) * (1 - t) * t * p1x + 3 * (1 - t) * t * t * p2x + t * t * t
  const by = (t) => 3 * (1 - t) * (1 - t) * t * p1y + 3 * (1 - t) * t * t * p2y + t * t * t
  const dbx = (t) =>
    3 * (1 - t) * (1 - t) * p1x +
    6 * (1 - t) * t * (p2x - p1x) +
    3 * t * t * (1 - p2x)
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const xt = bx(t) - x
      if (Math.abs(xt) < 1e-6) break
      const d = dbx(t)
      if (Math.abs(d) < 1e-6) break
      t -= xt / d
    }
    return by(t)
  }
}
const APPLE_SPRING = makeCubicBezier(0.32, 0.72, 0, 1)

let bvAnim = null

function cancelBvAnim() {
  if (bvAnim && bvAnim.timer != null) clearTimeout(bvAnim.timer)
  bvAnim = null
}

function animateBrowserViewTo(targetSb, targetPanel, duration = 220) {
  if (!browserView || browserViewHidden) {
    sidebarWidth = targetSb
    panelWidth   = targetPanel
    return
  }
  cancelBvAnim()
  const fromSb    = sidebarWidth
  const fromPanel = panelWidth
  if (Math.abs(targetSb - fromSb) < 1 && Math.abs(targetPanel - fromPanel) < 1) {
    sidebarWidth = targetSb
    panelWidth   = targetPanel
    applyBrowserViewLayout()
    return
  }
  bvAnim = {
    fromSb, targetSb,
    fromPanel, targetPanel,
    startTime: perfNow.now(),
    duration,
    timer: null,
  }
  bvAnimStep()
}

function bvAnimStep() {
  if (!bvAnim) return
  const t = Math.min(1, (perfNow.now() - bvAnim.startTime) / bvAnim.duration)
  const eased = APPLE_SPRING(t)
  sidebarWidth = bvAnim.fromSb    + (bvAnim.targetSb    - bvAnim.fromSb)    * eased
  panelWidth   = bvAnim.fromPanel + (bvAnim.targetPanel - bvAnim.fromPanel) * eased
  applyBrowserViewLayout()
  if (t < 1) {
    bvAnim.timer = setTimeout(bvAnimStep, 16)
  } else {
    sidebarWidth = bvAnim.targetSb
    panelWidth   = bvAnim.targetPanel
    applyBrowserViewLayout()
    bvAnim = null
  }
}

// ── Tabs (multi-WebContentsView) ──────────────────────────────────────────
//
// The single-browser model became a multi-tab model. Each tab is a
// WebContentsView with its own URL, history, and live page state. Only the
// ACTIVE tab is laid out by applyBrowserViewLayout; inactive tabs are
// parked at 1×1. The `browserView` variable above is preserved as an
// alias for the active tab's view, so all the existing IPC handlers and
// extraction code keep working unchanged.
//
// Per-tab analysis cache: each tab tracks its last extraction result.
// Switching tabs replays the cached panel state so the user sees a
// coherent panel-per-tab UX.

/** @typedef {{
 *   id:        string,
 *   view:      WebContentsView,
 *   navState:  { url: string, title: string, isListing: boolean,
 *                canGoBack: boolean, canGoForward: boolean, loading: boolean },
 *   analysis:  null | "analyzing" | { error: true, message: string } | object,
 *   /** URL of the last fully-completed analysis. Used to dedupe
 *    *  did-stop-loading bursts on SPA pages (Zillow fires this multiple
 *    *  times per listing). If we've already analyzed this exact URL, skip. *\/
 *   lastAnalyzedUrl: string | null,
 * }} Tab */

/** @type {Map<string, Tab>} */
const tabs = new Map()
/** @type {string | null} */
let activeTabId = null

function makeTabId() {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** Friendly default tab title — domain when we have a URL, "New tab" otherwise. */
function prettyTabTitle(url) {
  if (!url) return "New tab"
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch { return url }
}

/** Empty nav state — used for new tabs and as the default when no tab exists. */
function emptyNavState() {
  return { url: "", title: "", isListing: false, canGoBack: false, canGoForward: false, loading: false }
}

function createTab(initialUrl, opts = {}) {
  if (!appWindow || appWindow.isDestroyed()) return null
  const id = makeTabId()
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
      // Anti-fingerprint preload — runs before any page script and
      // patches navigator.webdriver / plugins / languages so the
      // embedded WebContentsView doesn't read as an automated browser.
      preload: path.join(__dirname, "embed-preload.js"),
    },
  })
  view.webContents.setUserAgent(CHROME_DESKTOP_UA)
  // Transparent compositor backdrop. WITHOUT this, an empty tab (no URL)
  // paints solid black/white over the React start screen, and during a
  // navigation between pages there's a black flash before the new page
  // paints its first frame. Real listing pages set their own opaque
  // background so this doesn't bleed through once content loads.
  try { view.webContents.setBackgroundColor("#00000000") } catch {}
  appWindow.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 1, height: 1 }) // park initially

  /** @type {Tab} */
  const tab = { id, view, navState: emptyNavState(), analysis: null, lastAnalyzedUrl: null }
  tabs.set(id, tab)
  attachTabListeners(tab)

  if (opts.activate ?? true) activateTab(id)
  if (initialUrl) view.webContents.loadURL(initialUrl)

  broadcastTabsState()
  return id
}

/** Attach navigation + keyboard event listeners to a tab. Each listener
 *  updates the tab's navState and only broadcasts to the renderer when
 *  this tab is currently active. */
function attachTabListeners(tab) {
  const { id, view } = tab

  const sendNav = (ready = false) => {
    const url = view.webContents.getURL()
    tab.navState = {
      url,
      title:        view.webContents.getTitle(),
      isListing:    shouldAutoExtract(url),
      canGoBack:    view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
      loading:      ready ? false : tab.navState.loading,
    }
    if (id === activeTabId) {
      broadcast("browser:nav-update", { ...tab.navState, ...(ready ? { loading: false } : {}) })
    }
    broadcastTabsState()
  }

  view.webContents.on("did-navigate",         () => sendNav(false))
  view.webContents.on("did-navigate-in-page", () => sendNav(false))
  view.webContents.on("page-title-updated",   () => sendNav(false))
  view.webContents.on("did-start-loading", () => {
    tab.navState.loading = true
    // Zero out the stale isListing flag — we're loading SOMETHING new
    // but we don't know what until did-navigate fires. Without this,
    // navigating away from a Zillow listing keeps the tab's green
    // loading dot pulsing for 200-500ms while the new (non-listing)
    // page is loading, which makes regular page loads look like they're
    // doing analysis.
    tab.navState.isListing = false
    if (id === activeTabId) broadcast("browser:nav-update", { loading: true, isListing: false })
    broadcastTabsState()
  })
  view.webContents.on("did-stop-loading", () => {
    sendNav(true)
    if (id === activeTabId) autoAnalyze()
  })
  // window.open / target=_blank links open in a new tab.
  view.webContents.setWindowOpenHandler(({ url }) => {
    createTab(url, { activate: true })
    return { action: "deny" }
  })

  view.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return
    const mod = process.platform === "darwin" ? input.meta : input.control

    // Cmd/Ctrl+L — focus OUR URL bar.
    if (mod && !input.shift && !input.alt && input.key === "l") {
      event.preventDefault()
      broadcast("browser:focus-urlbar")
      return
    }
    // Cmd/Ctrl+Opt+I — DevTools for the browser panel.
    if (mod && input.alt && input.key === "I") {
      event.preventDefault()
      view.webContents.openDevTools({ mode: "detach" })
    }
  })

  // Right-click context menu. Builds a Chrome-equivalent native menu from
  // the params Chromium hands us — link / image / selection / nav. Without
  // this, right-click on any embedded page silently does nothing, which
  // breaks every "Open in New Tab" / "Save Image" / "Copy Link" muscle
  // memory the user has from real browsers.
  view.webContents.on("context-menu", (_event, params) => {
    const items = []

    // Edit operations — only show what's actionable on the current target.
    if (params.editFlags?.canCut)       items.push({ label: "Cut",        role: "cut" })
    if (params.editFlags?.canCopy)      items.push({ label: "Copy",       role: "copy" })
    if (params.editFlags?.canPaste)     items.push({ label: "Paste",      role: "paste" })
    if (params.editFlags?.canSelectAll) items.push({ label: "Select All", role: "selectAll" })
    if (items.length > 0) items.push({ type: "separator" })

    if (params.linkURL) {
      items.push(
        { label: "Open Link in New Tab", click: () => createTab(params.linkURL, { activate: true }) },
        { label: "Copy Link Address",    click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" }
      )
    }

    if (params.mediaType === "image" && params.srcURL) {
      items.push(
        { label: "Save Image As…",  click: () => view.webContents.downloadURL(params.srcURL) },
        { label: "Copy Image Address",   click: () => clipboard.writeText(params.srcURL) },
        { type: "separator" }
      )
    }

    if (params.selectionText && params.selectionText.trim().length > 0) {
      const q = params.selectionText.trim().slice(0, 200)
      const display = q.length > 30 ? `${q.slice(0, 30)}…` : q
      items.push(
        { label: `Search Google for "${display}"`,
          click: () => createTab(`https://www.google.com/search?q=${encodeURIComponent(q)}`, { activate: true }) },
        { type: "separator" }
      )
    }

    if (view.webContents.canGoBack())    items.push({ label: "Back",    click: () => view.webContents.goBack() })
    if (view.webContents.canGoForward()) items.push({ label: "Forward", click: () => view.webContents.goForward() })
    items.push({ label: "Reload", click: () => view.webContents.reload() })

    if (DEV) {
      items.push(
        { type: "separator" },
        { label: "Inspect Element", click: () => view.webContents.inspectElement(params.x, params.y) }
      )
    }

    if (items.length === 0) return
    Menu.buildFromTemplate(items).popup({ window: appWindow ?? undefined })
  })
}

function activateTab(id) {
  const t = tabs.get(id)
  if (!t) return
  // Park every other tab off-screen.
  for (const [tid, tab] of tabs) {
    if (tid !== id) tab.view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
  }
  activeTabId = id
  browserView = t.view
  applyBrowserViewLayout()
  // Replay this tab's nav state to the renderer (URL bar, back/forward).
  broadcast("browser:nav-update", t.navState)
  // Replay the tab's last analysis state so the panel reflects this tab.
  if (t.analysis === null) {
    broadcast("panel:hide")
  } else if (t.analysis === "analyzing") {
    broadcast("panel:analyzing")
  } else if (t.analysis && typeof t.analysis === "object" && t.analysis.error) {
    broadcast("panel:error", t.analysis.message ?? "Analysis failed.")
  } else if (t.analysis && typeof t.analysis === "object") {
    broadcast("panel:ready", t.analysis)
  }
  broadcastTabsState()
}

function closeTab(id) {
  const t = tabs.get(id)
  if (!t) return
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.contentView.removeChildView(t.view)
  }
  try { t.view.webContents.close() } catch { /* already closed */ }
  tabs.delete(id)

  if (activeTabId === id) {
    const nextId = tabs.keys().next().value
    if (nextId) {
      activateTab(nextId)
    } else {
      // Closing the last tab: don't leave the window tab-less. Open a
      // new empty tab so the strip always has at least one tab. Same
      // behavior as Chrome/Safari — closing the last tab opens a fresh
      // empty one, no layout shift, no awkward chromeless state.
      activeTabId = null
      browserView = null
      broadcast("browser:nav-update", emptyNavState())
      broadcast("panel:hide")
      createTab(undefined, { activate: true })
      return  // createTab broadcasts on its own
    }
  }
  broadcastTabsState()
}

/** Activate the next/prev tab in insertion order, wrapping at the ends. */
function stepActiveTab(direction) {
  const ids = Array.from(tabs.keys())
  if (ids.length === 0 || !activeTabId) return
  const i = ids.indexOf(activeTabId)
  if (i === -1) return
  const nextI = ((i + direction) % ids.length + ids.length) % ids.length
  activateTab(ids[nextI])
}

function destroyAllTabs() {
  // Iterate over a snapshot since closeTab mutates the map.
  for (const id of Array.from(tabs.keys())) closeTab(id)
  browserViewHidden = false
  panelWidth = 0
  cancelBvAnim()
}

/** Hide / show all tab views — used by route-change gating
 *  (panel routes may want browserView parked). */
function hideBrowserView() {
  browserViewHidden = true
  for (const t of tabs.values()) {
    t.view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
  }
}

function showBrowserView() {
  browserViewHidden = false
  applyBrowserViewLayout()
}

function broadcastTabsState() {
  const list = Array.from(tabs.entries()).map(([id, t]) => ({
    id,
    url:       t.navState.url,
    title:     t.navState.title || prettyTabTitle(t.navState.url),
    isListing: t.navState.isListing,
    loading:   t.navState.loading,
  }))
  broadcast("browser:tabs:state", { tabs: list, activeId: activeTabId })
  // Re-flow the active browserView — the chrome above it (toolbar +
  // optional tab strip) may have changed height when this tab was added,
  // closed, or first navigated to a URL.
  applyBrowserViewLayout()
}

// Backward-compat aliases for the single-browser names. Existing IPC
// handlers (browser:create, browser:destroy) call these.
function createBrowserView() {
  // Ensure at least one tab exists. The renderer calls this on mount.
  if (tabs.size > 0) return
  createTab(undefined, { activate: true })
}
function destroyBrowserView() { destroyAllTabs() }

// ---------------------------------------------------------------------------
// IPC — browser panel
// ---------------------------------------------------------------------------

// Read sidebarWidth + panelWidth from a layout payload. Returns the new
// values, leaving fields not provided unchanged.
function readLayoutInto(layout) {
  let sb = sidebarWidth
  let pw = panelWidth
  if (layout && typeof layout.sidebarWidth === "number") sb = Math.max(0, layout.sidebarWidth)
  if (layout && typeof layout.panelWidth   === "number") pw = Math.max(0, layout.panelWidth)
  return { sb, pw }
}

ipcMain.handle("browser:create", (_e, layout) => {
  // Ensure-exists semantics ONLY. Do NOT show the view here.
  //
  // History: this used to set browserViewHidden=false + apply layout
  // because /browse was a remounting route — every entry to /browse
  // called create and "expected" the view visible. Now that routes
  // are always-mounted, BrowsePage calls create ONCE at app boot
  // (even when the user is on /pipeline). If we showed on create,
  // the native BrowserView would composite over Pipeline / Settings
  // immediately. The renderer is responsible for calling browser:show
  // explicitly, gated on routeActive && hasUrl.
  const { sb, pw } = readLayoutInto(layout)
  sidebarWidth = sb
  panelWidth   = pw
  if (browserView) return { reused: true }
  createBrowserView()
  return { reused: false }
})
// Pull OS keyboard focus out of the embedded WebContentsView and into
// the main window's webContents (where the URL bar input lives).
// Electron WebContentsView focus is a separate stack from DOM focus —
// even after a click on the renderer, the embedded view can keep
// keyboard focus, so typed characters disappear into the embedded page
// instead of the URL bar. This handler is called by the renderer
// startEdit() path to make the focus transfer deterministic.
ipcMain.handle("urlbar:focus-renderer", () => {
  if (!appWindow || appWindow.isDestroyed()) return
  appWindow.webContents.focus()
})
ipcMain.handle("browser:destroy",      () => destroyBrowserView())
ipcMain.handle("browser:hide",         () => hideBrowserView())
ipcMain.handle("browser:show", (_e, layout) => {
  if (!browserView) return { exists: false }
  const { sb, pw } = readLayoutInto(layout)
  sidebarWidth = sb
  panelWidth   = pw
  showBrowserView()
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
// Settled layout from React: animate browserView's bounds with Apple
// spring 220ms. The React sidebar/panel CSS transitions use the same
// curve, so the listing's left edge tracks the sidebar in lockstep.
ipcMain.handle("browser:set-layout", (_e, layout) => {
  const { sb, pw } = readLayoutInto(layout)
  if (layout && layout.animate === false) {
    sidebarWidth = sb
    panelWidth   = pw
    cancelBvAnim()
    applyBrowserViewLayout()
  } else {
    animateBrowserViewTo(sb, pw)
  }
})

// ── Watch / re-check IPC ──────────────────────────────────────────────────
//
// Re-fetches each watched deal's source URL in a hidden background view,
// runs Haiku extraction, and returns the new list price + a flag for
// whether anything material changed since the last snapshot. The renderer
// is responsible for writing changes to Supabase + emitting deal_events
// so this stays a pure "give me the latest" call.
//
// Sequential by design — running these in parallel would burn through
// the Anthropic rate budget and slam listing sites. Each check takes
// 5-15s, so a 10-deal portfolio is ~1-2 minutes of background work.

/** @type {WebContentsView | null} */
let recheckView = null

function getRecheckView() {
  if (recheckView && !recheckView.webContents.isDestroyed()) return recheckView
  recheckView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  recheckView.webContents.setUserAgent(CHROME_DESKTOP_UA)
  appWindow.contentView.addChildView(recheckView)
  // Park entirely off-screen — never user-visible.
  recheckView.setBounds({ x: 0, y: 0, width: 1, height: 1 })
  return recheckView
}

async function recheckOneDeal(url, prevListPrice) {
  const view = getRecheckView()
  view.webContents.loadURL(url)

  // Wait for load + DOM hydration (same polling pattern as autoAnalyze).
  await new Promise((resolve) => {
    if (!view.webContents.isLoading()) { resolve(); return }
    const h = () => resolve()
    view.webContents.once("did-stop-loading", h)
    setTimeout(() => { try { view.webContents.off("did-stop-loading", h) } catch {} resolve() }, 12_000)
  })

  let dom = null
  const POLL_DEADLINE_MS = 12_000
  const POLL_TARGET_LEN  = 1200
  const start = Date.now()
  while (Date.now() - start < POLL_DEADLINE_MS) {
    try {
      dom = await view.webContents.executeJavaScript(`
        (() => {
          const clone = document.body.cloneNode(true)
          clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]').forEach(el => el.remove())
          return { url: window.location.href, title: document.title, text: (clone.innerText||"").slice(0,25000) }
        })()
      `)
    } catch { dom = null }
    if ((dom?.text?.length ?? 0) >= POLL_TARGET_LEN) break
    await new Promise((r) => setTimeout(r, 700))
  }

  if (!dom || (dom.text?.length ?? 0) < 200) {
    return { ok: false, url, reason: "couldn't read page" }
  }

  const cfg = readConfig()
  if (!cfg.anthropicApiKey) {
    return { ok: false, url, reason: "no API key" }
  }

  const extracted = await callAnthropicHaiku(cfg.anthropicApiKey, dom)
  if (!extracted) {
    return { ok: false, url, reason: "extraction failed" }
  }

  const hostname = (() => { try { return new URL(dom.url).hostname.replace("www.", "") } catch { return "listing" } })()
  const result = postProcess(extracted, hostname, "anthropic")
  if (!result?.ok) {
    return { ok: false, url, reason: result?.message ?? "extraction failed" }
  }

  const newPrice  = result.facts.listPrice ?? null
  const priceChanged =
    typeof newPrice === "number" &&
    typeof prevListPrice === "number" &&
    Math.abs(newPrice - prevListPrice) >= 1

  return {
    ok:           true,
    url,
    newListPrice: newPrice,
    prevListPrice,
    priceChanged,
    delta:        newPrice != null && prevListPrice != null ? newPrice - prevListPrice : null,
    facts:        result.facts,
  }
}

ipcMain.handle("watch:check-all", async (_e, deals) => {
  if (!Array.isArray(deals) || deals.length === 0) return { ok: true, results: [] }
  const results = []
  for (const d of deals) {
    if (!d?.source_url) continue
    try {
      const r = await recheckOneDeal(d.source_url, d.list_price ?? null)
      results.push({ id: d.id, ...r })
    } catch (err) {
      results.push({ id: d.id, ok: false, url: d.source_url, reason: err?.message ?? "fetch failed" })
    }
    // Yield between checks — gives the user's main browser breathing room.
    await new Promise((r) => setTimeout(r, 250))
  }
  return { ok: true, results }
})

// ── Tab management IPC ────────────────────────────────────────────────────
ipcMain.handle("browser:tabs:list", () => {
  return {
    tabs: Array.from(tabs.entries()).map(([id, t]) => ({
      id,
      url:       t.navState.url,
      title:     t.navState.title || prettyTabTitle(t.navState.url),
      isListing: t.navState.isListing,
      loading:   t.navState.loading,
    })),
    activeId: activeTabId,
  }
})

ipcMain.handle("browser:tabs:create", (_e, opts) => {
  const url = (opts && typeof opts.url === "string") ? opts.url : undefined
  const id  = createTab(url, { activate: true })
  return { id }
})

ipcMain.handle("browser:tabs:close", (_e, id) => {
  if (typeof id !== "string") return
  closeTab(id)
})

ipcMain.handle("browser:tabs:activate", (_e, id) => {
  if (typeof id !== "string") return
  activateTab(id)
})

// Reorder tabs — drag-to-reorder support. The renderer sends the new
// id sequence (the full ordered list of tab ids); we rebuild the tabs
// Map preserving values but in the new key order, then broadcast.
ipcMain.handle("browser:tabs:reorder", (_e, orderedIds) => {
  if (!Array.isArray(orderedIds)) return
  // Validate: every id must exist and the count must match (don't
  // accept partial reorders or unknown ids).
  if (orderedIds.length !== tabs.size) return
  for (const id of orderedIds) if (!tabs.has(id)) return
  const next = new Map()
  for (const id of orderedIds) next.set(id, tabs.get(id))
  tabs.clear()
  for (const [id, t] of next) tabs.set(id, t)
  broadcastTabsState()
})

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

// Skip-list — URLs the renderer has told us already have a saved
// snapshot. tryAnalyze() short-circuits on these to avoid paying
// Anthropic + extraction costs for analyses we already have. The
// renderer is the source of truth (it knows savedByUrl); main just
// honors the list. Registered/unregistered via IPC.
const _skipAnalysisUrls = new Set()
ipcMain.handle("analysis:set-skip-urls", (_evt, urls) => {
  if (!Array.isArray(urls)) return false
  _skipAnalysisUrls.clear()
  for (const u of urls) if (typeof u === "string") _skipAnalysisUrls.add(u)
  return true
})

// ---------------------------------------------------------------------------
// Auto-analysis — fires on every did-stop-loading.
//
// Flow:
//   1. If URL doesn't look like a listing → send panel:hide
//   2. Send panel:analyzing (panel slides in with loading state)
//   3. Extract DOM → Haiku extraction → POST /api/analyze
//   4. Send panel:ready with full PanelResult, or panel:error on failure
// ---------------------------------------------------------------------------

async function autoAnalyze(opts = {}) {
  // `force: true` is set by the user-initiated reanalyze flow — it bypasses
  // both the in-flight guard and the URL dedupe, and broadcasts an error
  // back to the renderer when shouldAutoExtract is false (rather than
  // silently hiding). This keeps the manual reanalyze button from leaving
  // the panel stuck in "analyzing" with no resolution.
  const force = !!opts.force

  if (!browserView || !appWindow) {
    if (force) broadcast("panel:error", "Open a listing first.")
    return
  }
  if (autoAnalyzing && !force) return

  const url = browserView.webContents.getURL()
  if (!shouldAutoExtract(url)) {
    // Clear analysis cache for the active tab and hide the panel.
    const cur = activeTabId ? tabs.get(activeTabId) : null
    if (cur) {
      cur.analysis        = null
      cur.lastAnalyzedUrl = null
    }
    if (force) {
      broadcast("panel:error", "This page doesn't look like a listing. Open a property page to analyze it.")
    } else {
      broadcast("panel:hide")
    }
    return
  }

  // Capture the originating tab — if the user switches tabs while we're
  // waiting on the network/extraction, we still write the result onto
  // the tab that started the analysis, but only broadcast to the
  // renderer if THAT tab is still active.
  const startedTabId = activeTabId
  const startedTab   = startedTabId ? tabs.get(startedTabId) : null

  // Skip-list: the renderer can register URLs that already have a
  // saved snapshot in the user's pipeline. We honor that registration
  // and short-circuit the entire analyze pipeline (no Anthropic call,
  // no FRED/HUD lookups, no extraction). The renderer hydrates the
  // panel from the saved snapshot so the user still sees content;
  // we just avoid paying for a fresh scan they didn't ask for.
  // `force` (from the panel's Re-analyze button) bypasses this so
  // the user can always trigger a fresh pass on demand.
  if (!force && _skipAnalysisUrls.has(url)) {
    return
  }

  // Dedupe: SPA listing pages (Zillow, Redfin) fire did-stop-loading
  // multiple times per page (initial load + lazy-loaded sections + XHR
  // settlement). If we've already HANDLED this URL on this tab — whether
  // the result was a real analysis, an error, or "this is a search page,
  // hide" — treat the rerun as a no-op. We stamp lastAnalyzedUrl from
  // every settle path below. `force` skips this so the user's reanalyze
  // button always re-runs and always resolves the panel state.
  if (!force && startedTab && startedTab.lastAnalyzedUrl === url) {
    return
  }
  if (force && startedTab) {
    startedTab.lastAnalyzedUrl = null
  }

  const isStillActive = () => activeTabId === startedTabId
  const setTabAnalysis = (a) => { if (startedTab) startedTab.analysis = a }

  autoAnalyzing = true
  setTabAnalysis("analyzing")
  if (isStillActive()) broadcast("panel:analyzing")
  lastExtractDebug = { stage: "started", at: new Date().toISOString() }

  try {
    // Humanlike settle window — bot-detection systems flag the pattern
    // "page loaded → DOM read immediately." A 1.2-1.8s jittered pause
    // + a synthetic mouse-move into the viewport simulates a human
    // pausing to look at the page before we extract. This won't beat
    // Turnstile, but it dramatically reduces the false-positive rate
    // on Zillow's first-page-load bot heuristics.
    const SETTLE_MIN_MS = 1200
    const SETTLE_MAX_MS = 1800
    const settle = SETTLE_MIN_MS + Math.floor(Math.random() * (SETTLE_MAX_MS - SETTLE_MIN_MS))
    await new Promise((r) => setTimeout(r, settle))
    try {
      const b = browserView.getBounds()
      // Send a single mouseMove into roughly the center-third of the
      // viewport — small jitter so the coords don't repeat across runs.
      const x = Math.floor(b.width  * 0.4 + Math.random() * (b.width  * 0.2))
      const y = Math.floor(b.height * 0.4 + Math.random() * (b.height * 0.2))
      browserView.webContents.sendInputEvent({ type: "mouseMove", x, y })
    } catch { /* sendInputEvent can throw if view isn't focusable yet */ }

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
      const msg = "Couldn't read enough page content. Try refreshing the listing."
      setTabAnalysis({ error: true, message: msg })
      if (startedTab) startedTab.lastAnalyzedUrl = url
      if (isStillActive()) broadcast("panel:error", msg)
      return
    }

    if (looksLikeCaptcha(dom.title, dom.text)) {
      const msg = "Verify you're not a robot, then the panel will populate."
      setTabAnalysis({ error: true, message: msg })
      if (startedTab) startedTab.lastAnalyzedUrl = url
      if (isStillActive()) broadcast("panel:error", msg)
      return
    }

    const sig = scanSignals(dom.text, dom.url)
    if (sig.looksLikeSearchResults || !sig.looksLikeListing) {
      setTabAnalysis(null)
      if (startedTab) startedTab.lastAnalyzedUrl = url
      if (isStillActive()) broadcast("panel:hide")
      return
    }

    const config = readConfig()
    const hostname = (() => { try { return new URL(dom.url).hostname.replace("www.", "") } catch { return "listing" } })()

    let extracted = null
    if (config.anthropicApiKey) {
      extracted = await callAnthropicHaiku(config.anthropicApiKey, dom)
    }

    if (!extracted) {
      const msg = "Add an Anthropic key in Settings to enable auto-analysis."
      setTabAnalysis({ error: true, message: msg })
      if (startedTab) startedTab.lastAnalyzedUrl = url
      if (isStillActive()) broadcast("panel:error", msg)
      return
    }

    const extractResult = postProcess(extracted, hostname, "anthropic")
    if (!extractResult?.ok) {
      const msg = extractResult?.message ?? "Couldn't read this listing."
      setTabAnalysis({ error: true, message: msg })
      if (startedTab) startedTab.lastAnalyzedUrl = url
      if (isStillActive()) broadcast("panel:error", msg)
      return
    }

    // POST to /api/analyze — runs FRED + HUD FMR enrichment + calculations.
    // Include the user's underwriting prefs (down payment, vacancy %, etc.)
    // so the metrics reflect their actual model, not the built-in defaults.
    const userPrefs = readConfig().investmentPrefs ?? {}
    const analyzeRes = await fetch(`${BASE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction: extractResult, prefs: userPrefs }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!analyzeRes.ok) {
      const body = await analyzeRes.json().catch(() => ({}))
      const msg = body?.message ?? "Analysis failed. Please try again."
      setTabAnalysis({ error: true, message: msg })
      if (startedTab) startedTab.lastAnalyzedUrl = url
      if (isStillActive()) broadcast("panel:error", msg)
      return
    }

    const panelResult = await analyzeRes.json()
    setTabAnalysis(panelResult)
    if (startedTab) startedTab.lastAnalyzedUrl = url
    if (isStillActive()) broadcast("panel:ready", panelResult)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[autoAnalyze] error:", msg)
    setTabAnalysis({ error: true, message: "Something went wrong. Try refreshing the page." })
    if (isStillActive()) broadcast("panel:error", "Something went wrong. Try refreshing the page.")
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
// User-initiated reanalyze. Drives the panel through the FULL autoAnalyze
// flow (extract → enrich → broadcast panel:ready / panel:error). The
// renderer's existing onPanelReady / onPanelError listeners catch the
// result, so the reanalyze button never leaves the panel stuck on the
// analyzing spinner.
ipcMain.handle("browser:reanalyze", async () => {
  // Defensive: clear the in-flight guard in case a previous run died
  // silently and left autoAnalyzing stuck at true.
  autoAnalyzing = false
  void autoAnalyze({ force: true })
  return { ok: true }
})

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

// ── Investment defaults ──────────────────────────────────────────────────
// User's personal underwriting defaults — fed into lib/calculations.ts
// when analyzing a listing. Sensible defaults shipped if the user has
// never saved any. Shape stays permissive so we can add fields later.
const DEFAULT_INVESTMENT_PREFS = {
  downPaymentPct:   0.25,
  vacancyPct:       0.05,
  managementPct:    0.08,
  maintenancePct:   0.05,
  capexPct:         0.05,
  rateAdjustmentBps: 0, // basis points added to FRED rate (e.g. for investor loan premium)
  // Personal "buy bar" thresholds — when set, the panel renders a
  // quiet "above bar / below bar" pill on each metric card. NOT a
  // verdict; just memory of the user's own criteria so they don't
  // have to re-evaluate from scratch on every listing. null =
  // threshold not set (no pill rendered for that metric).
  minCapRate:        null, // e.g., 0.06 for "I only buy at ≥6% cap"
  minCashFlow:       null, // e.g., 200 for "≥$200/mo cash flow"
  minDscr:           null, // e.g., 1.20 for "≥1.20 debt coverage"
  // Mapbox style for the persistent shell map. "auto" follows the
  // current app theme; explicit keys override.
  mapStyle:          "auto",
}

ipcMain.handle("config:get-investment-prefs", () => {
  const cfg = readConfig()
  return { ...DEFAULT_INVESTMENT_PREFS, ...(cfg.investmentPrefs ?? {}) }
})
ipcMain.handle("config:set-investment-prefs", (_e, patch) => {
  if (!patch || typeof patch !== "object") return { ok: false }
  const cfg = readConfig()
  cfg.investmentPrefs = { ...DEFAULT_INVESTMENT_PREFS, ...(cfg.investmentPrefs ?? {}), ...patch }
  writeConfig(cfg)
  return { ok: true, prefs: cfg.investmentPrefs }
})

// Returns the most recent extraction round-trip trace. The renderer's
// debug drawer (⌘⇧D in /research) reads this so the user can see exactly
// why a listing failed instead of staring at a generic error message.
ipcMain.handle("extract:debug:last", () => {
  return lastExtractDebug ?? { stage: "idle", note: "No extraction has run yet." }
})

// ---------------------------------------------------------------------------
// IPC — Live mortgage rate (FRED MORTGAGE30US)
// ---------------------------------------------------------------------------
//
// Surfaces the current 30Y fixed rate to the sidebar's market context
// band. FRED publishes MORTGAGE30US weekly (Thursday) so a long cache
// is fine. Failure returns null — the indicator hides itself rather
// than show stale data.

let ratesCache = null
const RATES_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

async function fetchMortgageRate() {
  if (ratesCache && Date.now() - ratesCache.fetchedAt < RATES_TTL_MS) {
    return { rate: ratesCache.rate, asOf: ratesCache.asOf }
  }
  const apiKey = process.env.FRED_API_KEY
  if (!apiKey) return null

  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=MORTGAGE30US&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const data = await res.json()
    const obs = data?.observations?.[0]
    if (!obs?.value || obs.value === ".") return null
    const rate = parseFloat(obs.value)
    if (!Number.isFinite(rate)) return null
    ratesCache = { rate, asOf: obs.date, fetchedAt: Date.now() }
    return { rate, asOf: obs.date }
  } catch {
    return null
  }
}

ipcMain.handle("rates:get-mortgage", async () => {
  const r = await fetchMortgageRate()
  return r ? { ok: true, ...r } : { ok: false }
})

// ---------------------------------------------------------------------------
// IPC — AI tagging
// ---------------------------------------------------------------------------
//
// Generates 2-3 short factual tags for a saved deal. Called fire-and-forget
// from the renderer right after a successful save. The renderer then writes
// the returned tags onto the saved_deals row via Supabase.
//
// Failure is silent — if the model can't produce good tags, the deal just
// stays untagged. We never let tagging block the save flow.

const TAG_SYSTEM_PROMPT = `You are RealVerdict's deal tagger. Given a property snapshot, output 2-3 short factual tags that capture this deal's most notable characteristics — the kind of tags that help an investor filter their pipeline.

OUTPUT
A single JSON array of 2-3 strings. No prose, no markdown, no commentary.

TAG RULES
- 1-3 words each, lowercase, hyphen-separated.
- FACTUAL only — no judgment, no marketing, no scoring. NEVER use words like "great", "good", "bad", "deal", "investor-special", "must-see".
- Pull tags from objective signals in the snapshot: property type, condition, geography, key metric extremes, strategy class.
- Prefer specific over generic. "negative-cash-flow" beats "low-cash-flow"; "needs-roof" beats "fixer-upper" if the snapshot mentions it.

EXAMPLES OF GOOD TAGS
single-family · multi-family · 4-unit · condo · townhouse · land
move-in-ready · needs-work · as-is · new-construction · tear-down
high-cash-flow · negative-cash-flow · breakeven · tight-debt · low-dscr · debt-covers
high-cap-rate · low-cap-rate · appreciation-play · value-add
flood-zone · pre-1978 · leasehold · busy-road · tenant-occupied
austin-tx · phoenix-az · sf-bay · brooklyn

EXAMPLES OF BAD TAGS (NEVER OUTPUT)
great-deal · investor-special · must-see · profitable · risky · hot-market

Return ONLY the JSON array.`

ipcMain.handle("ai:tag-deal", async (_e, payload) => {
  const cfg = readConfig()
  const apiKey = cfg.anthropicApiKey
  if (!apiKey) return { ok: false, tags: [], reason: "no-key" }
  if (!payload || typeof payload !== "object") return { ok: false, tags: [], reason: "bad-input" }

  // Compress to a small structured user message — Haiku doesn't need the
  // full PanelResult shape, just the salient facts + key metrics.
  const compact = {
    address:        payload.address ?? null,
    city:           payload.city ?? null,
    state:          payload.state ?? null,
    propertyType:   payload.propertyType ?? null,
    listPrice:      payload.listPrice ?? null,
    beds:           payload.beds ?? null,
    baths:          payload.baths ?? null,
    sqft:           payload.sqft ?? null,
    yearBuilt:      payload.yearBuilt ?? null,
    monthlyCashFlow: payload.monthlyCashFlow ?? null,
    capRate:        payload.capRate ?? null,
    dscr:           payload.dscr ?? null,
    riskFlags:      Array.isArray(payload.riskFlags) ? payload.riskFlags : [],
    siteName:       payload.siteName ?? null,
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      ANTHROPIC_MODEL,
        max_tokens: 120,
        system:     TAG_SYSTEM_PROMPT,
        messages:   [{ role: "user", content: JSON.stringify(compact) }],
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { ok: false, tags: [], reason: `http-${res.status}` }
    const data = await res.json()
    const text = data?.content?.[0]?.text?.trim() ?? ""
    // Strip code fences if Haiku wrapped the array in markdown.
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim()
    let parsed
    try { parsed = JSON.parse(cleaned) } catch { return { ok: false, tags: [], reason: "parse-failed" } }
    if (!Array.isArray(parsed)) return { ok: false, tags: [], reason: "not-array" }

    // Sanitize: lowercase, hyphenate, length cap, count cap.
    const tags = parsed
      .filter((t) => typeof t === "string")
      .map((t) => t.toLowerCase().trim().replace(/\s+/g, "-"))
      .filter((t) => t.length > 0 && t.length <= 24 && t.split("-").length <= 3)
      .slice(0, 3)
    return { ok: true, tags }
  } catch (err) {
    return { ok: false, tags: [], reason: err?.name ?? "fetch-failed" }
  }
})

// ---------------------------------------------------------------------------
// IPC — AI listing chat
// ---------------------------------------------------------------------------
//
// Conversational Q&A about the currently-open listing. The panel's
// authoritative numbers (Cash Flow / Cap Rate / DSCR) come from FRED +
// HUD + Haiku extraction; this chat is for everything around them —
// hypothetical underwriting ("what if I put 30% down?"), comp ranges,
// "why is the cap rate low?", etc.
//
// The system prompt locks the model into the same no-verdict stance the
// rest of the product uses: surface facts and arithmetic, never advise
// or score.

const CHAT_SYSTEM_PROMPT = `You are RealVerdict's listing-analysis assistant. The user is looking at a specific real-estate listing and asks you questions about it.

YOU CAN
- Answer factual questions using the provided extraction data, metrics, and the user's pipeline context.
- Do simple hypothetical underwriting math when asked ("what if I put 30% down", "what would cash flow look like at $400k").
- Reference comparable saved deals from the user's pipeline when relevant.
- Estimate market context (rent comps, typical taxes, neighborhood feel) using your general knowledge — but ALWAYS flag estimates as estimates.

USE THE adjust_scenario TOOL
- When the user proposes a hypothetical scenario change (e.g., "what if I put 22% down", "if rates dropped to 5.5", "at $440k", "with 8% vacancy"), CALL THE adjust_scenario TOOL FIRST with the relevant fields, then narrate what changed.
- The tool applies the change live in the user's UI — they see metrics update in real time.
- After calling the tool, your text response should reference the NEW numbers and what shifted.

YOU MUST NEVER
- Give advice ("you should buy this", "skip this one", "great deal", "weak deal").
- Rate, score, or rank the property.
- Invent facts not in the data and present them as facts.
- Use exclamation points or hype language.

SHAPE
- Reply in 1-3 short sentences. Plain prose. No markdown headers, no bullet lists unless explicitly asked. Bold (**text**) for emphasis only, sparingly.
- Use SPECIFIC numbers from the provided data — say "6.2% cap rate", not "decent cap rate".
- When the panel data already answers the question, reference it directly.
- When you're estimating ("typical rents in this zip are around X"), say so plainly.
- If you don't have the data to answer, say so plainly. Don't make things up.

CONTEXT FORMAT
You'll receive: { listing: { address, listPrice, beds, baths, sqft, propertyType, monthlyCashFlow, capRate, dscr, monthlyRent, ... }, prefs: { downPaymentPct, vacancyPct, ... }, pipeline: { saves count, common cities, ... }, history: [previous messages] }`

// Tool definitions exposed to the AI for live scenario manipulation.
const CHAT_TOOLS = [
  {
    name: "adjust_scenario",
    description: "Adjust one or more scenario fields on the active listing. The change applies live in the user's UI and metrics recompute immediately. Use whenever the user proposes a hypothetical underwriting scenario.",
    input_schema: {
      type: "object",
      properties: {
        downPaymentPct:    { type: "number", description: "Down payment as percent, 0-100. Example: 30 for 30% down." },
        interestRate:      { type: "number", description: "Interest rate as percent, e.g. 5.95 for 5.95%." },
        vacancyPct:        { type: "number", description: "Vacancy rate as percent, e.g. 7 for 7%." },
        monthlyRent:       { type: "number", description: "Monthly rent in whole dollars." },
        purchasePrice:     { type: "number", description: "Your hypothetical offer price in whole dollars." },
        loanTermYears:     { type: "number", description: "Loan amortization term in years (typical 15 or 30)." },
        annualPropertyTax: { type: "number", description: "Annual property tax in whole dollars." },
        annualInsurance:   { type: "number", description: "Annual insurance in whole dollars." },
        monthlyHOA:        { type: "number", description: "Monthly HOA fee in whole dollars." },
        managementPct:     { type: "number", description: "Property management fee as percent of gross rent." },
        maintenancePct:    { type: "number", description: "Maintenance reserve as percent of gross rent." },
        capexPct:          { type: "number", description: "CapEx reserve as percent of gross rent." },
      },
      required: [],
    },
  },
  {
    name: "reset_scenario",
    description: "Clear all scenario overrides and return the listing's metrics to the default analysis. Use when the user says 'reset', 'clear my scenario', 'go back to default', 'undo my changes', etc.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
]

ipcMain.handle("ai:chat-deal", async (_e, payload) => {
  const cfg = readConfig()
  const apiKey = cfg.anthropicApiKey
  if (!apiKey) return { ok: false, response: null, reason: "no-key" }

  const { query, context, history } = payload ?? {}
  if (typeof query !== "string" || !query.trim()) {
    return { ok: false, response: null, reason: "bad-input" }
  }

  // Build the multi-turn message array. The system prompt is constant;
  // the user message bundles the context (so we don't have to send it
  // on every turn separately) plus the latest question.
  const messages = []
  // Replay prior conversation as user/assistant pairs. Cap at 10 turns
  // to stay within token budget — chat about a single listing rarely
  // needs more.
  if (Array.isArray(history)) {
    for (const m of history.slice(-10)) {
      if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
        messages.push({ role: m.role, content: m.content })
      }
    }
  }
  // The new turn — bundle context with the question on the FIRST turn,
  // or just the question on subsequent turns (context already in history).
  const isFirstTurn = messages.length === 0
  const userContent = isFirstTurn
    ? `Context:\n${JSON.stringify(context ?? {}, null, 2)}\n\nQuestion: ${query}`
    : query
  messages.push({ role: "user", content: userContent })

  // Helper: one round-trip to Anthropic. Returns the parsed response.
  const callAnthropic = async (msgs) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      ANTHROPIC_MODEL,
        max_tokens: 600,
        system:     CHAT_SYSTEM_PROMPT,
        tools:      CHAT_TOOLS,
        messages:   msgs,
      }),
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) throw new Error(`http-${res.status}`)
    return res.json()
  }

  try {
    let data = await callAnthropic(messages)

    // Tool-use loop. The AI may return a tool_use block; we execute it
    // (by sending an event to the renderer that drives applyScenarioFromBus)
    // and then send back a tool_result so the AI can finalize its text.
    // Cap iterations to avoid infinite loops in case the model keeps calling.
    let iterations = 0
    while (data?.stop_reason === "tool_use" && iterations < 3) {
      iterations++
      const assistantContent = data.content ?? []
      // Build the tool_result blocks for every tool_use in the response.
      const toolResults = []
      for (const block of assistantContent) {
        if (block.type !== "tool_use") continue
        if (block.name === "adjust_scenario") {
          // Sanitize the input — drop unknown keys, keep numeric values.
          const valid = {}
          const allowed = [
            "downPaymentPct", "interestRate", "vacancyPct", "monthlyRent",
            "purchasePrice", "loanTermYears", "annualPropertyTax",
            "annualInsurance", "monthlyHOA", "managementPct",
            "maintenancePct", "capexPct",
          ]
          for (const k of allowed) {
            const v = block.input?.[k]
            if (typeof v === "number" && Number.isFinite(v)) valid[k] = v
          }
          if (Object.keys(valid).length > 0) {
            for (const win of BrowserWindow.getAllWindows()) {
              try { win.webContents.send("ai:apply-scenario", valid) } catch { /* window gone */ }
            }
          }
          toolResults.push({
            type:        "tool_result",
            tool_use_id: block.id,
            content:     JSON.stringify({ ok: true, applied: valid }),
          })
        } else if (block.name === "reset_scenario") {
          // Special "reset all" sentinel: send the magic key __reset__
          // which the renderer interprets as 'clear all overrides.'
          for (const win of BrowserWindow.getAllWindows()) {
            try { win.webContents.send("ai:reset-scenario") } catch { /* window gone */ }
          }
          toolResults.push({
            type:        "tool_result",
            tool_use_id: block.id,
            content:     JSON.stringify({ ok: true, reset: true }),
          })
        } else {
          toolResults.push({
            type:        "tool_result",
            tool_use_id: block.id,
            content:     JSON.stringify({ ok: false, reason: "unknown-tool" }),
            is_error:    true,
          })
        }
      }
      // Push the assistant's tool_use turn AND the tool_result turn,
      // then continue the conversation.
      messages.push({ role: "assistant", content: assistantContent })
      messages.push({ role: "user",      content: toolResults })
      data = await callAnthropic(messages)
    }

    // Extract the final text from the response (may have text + completed
    // tool_use blocks; we only want the text).
    const textBlocks = (data?.content ?? []).filter((b) => b.type === "text")
    const text = textBlocks.map((b) => b.text).join("\n").trim()
    if (!text) return { ok: false, response: null, reason: "empty-response" }
    return { ok: true, response: text }
  } catch (err) {
    return { ok: false, response: null, reason: err?.message ?? err?.name ?? "fetch-failed" }
  }
})

// ---------------------------------------------------------------------------
// IPC — AI palette query
// ---------------------------------------------------------------------------
//
// Powers the ⌘K "Ask…" surface. Takes a free-form query plus a small
// context bundle (the user's saved deals + recent listings) and returns
// EITHER a short factual answer OR a structured navigation hint.

const ASK_SYSTEM_PROMPT = `You are RealVerdict's command-palette assistant. The user types a question or a navigation request; you respond with a small JSON object describing how to handle it.

OUTPUT (always)
A single JSON object — no prose, no markdown. Shapes:

  { "kind": "answer",   "text": "<= 60 words, factual, first-person plural ('we'/'your')" }
  { "kind": "navigate", "url": "/pipeline?stage=watching" or "/browse?url=https://..." }
  { "kind": "filter",   "stage": "watching" | "interested" | "offered" | "won" | "passed" | null,
                        "city":  "<city name>" | null,
                        "minCapRate":     <number 0..1> | null,
                        "minCashFlow":    <dollars> | null,
                        "label":          "<short user-facing summary like 'Austin · cap >5%'>" }
  { "kind": "open",     "url": "https://..." (must be one URL from the user's saved deals) }
  { "kind": "unknown" }

RULES
- Match the user's intent. "show watching" → navigate to /pipeline?stage=watching. "compare [a] and [b]" → answer (we don't yet have a navigate-to-compare URL).
- For factual questions about THE USER'S deals (counts, names, totals), output an "answer" with the actual number from the context.
- Numeric thresholds: "cap rate over 5%" → minCapRate: 0.05. "cash flow positive" → minCashFlow: 0.
- City names: pull from the deals' "city" field (case-sensitive copy). If the city isn't in the user's data, return "unknown" rather than inventing.
- Never invent facts. Never give advice. Never score or rank deals.

The context object will look like:
  { "savedDeals": [ { id, address, city, state, listPrice, monthlyCashFlow, capRate, dscr, stage, sourceUrl, tags } ], "recentListings": [...], "currentRoute": "/browse" }`

ipcMain.handle("ai:answer-query", async (_e, payload) => {
  const cfg = readConfig()
  const apiKey = cfg.anthropicApiKey
  if (!apiKey) return { ok: false, response: null, reason: "no-key" }
  const { query, context } = payload ?? {}
  if (typeof query !== "string" || !query.trim()) {
    return { ok: false, response: null, reason: "bad-input" }
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      ANTHROPIC_MODEL,
        max_tokens: 300,
        system:     ASK_SYSTEM_PROMPT,
        messages:   [{
          role: "user",
          content: `Query: ${query}\n\nContext:\n${JSON.stringify(context ?? {})}`,
        }],
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return { ok: false, response: null, reason: `http-${res.status}` }
    const data = await res.json()
    const text = data?.content?.[0]?.text?.trim() ?? ""
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim()
    let parsed
    try { parsed = JSON.parse(cleaned) } catch { return { ok: false, response: null, reason: "parse-failed" } }
    if (!parsed || typeof parsed !== "object") return { ok: false, response: null, reason: "bad-shape" }
    return { ok: true, response: parsed }
  } catch (err) {
    return { ok: false, response: null, reason: err?.name ?? "fetch-failed" }
  }
})

// ---------------------------------------------------------------------------
// IPC — AI factual diff for the comparison view
// ---------------------------------------------------------------------------
//
// Given 2-4 saved deals, returns ONE short factual paragraph (1-2 sentences)
// describing the differences. NEVER scores, ranks, or recommends. Just
// surfaces deltas worth noticing.

const COMPARE_SYSTEM_PROMPT = `You are RealVerdict's deal-comparison voice. Given a JSON array of 2-4 properties with their key metrics, output ONE short factual paragraph (1-2 sentences, max 40 words) summarizing the most notable differences.

OUTPUT
Plain prose. No markdown, no quotes, no commentary. Just the sentence(s).

VOICE & RULES
- Factual, not advisory. Never score, rank, or recommend ("the better deal", "you should...").
- Lead with the most striking delta — a price gap, cash-flow gap, neighborhood difference, property-type difference.
- Cite specific numbers when meaningful (e.g. "$312/mo cash-flow gap", "0.8 percentage-point cap-rate spread").
- If two deals are very similar, say so plainly.
- Never use words like "best", "worst", "winner", "great", "weak", "good", "bad".

EXAMPLES OF GOOD OUTPUT
"Same Austin neighborhood, but the duplex cash-flows $312/mo more on a 0.8 percentage-point higher cap rate. The condo is the lower-DSCR option."
"Both single-family at similar prices. The Phoenix property has cleaner debt coverage; the Tucson one carries a stronger cap rate."
"Similar metrics across the board — within $40/mo of each other on cash flow, identical cap rate to the tenth."

Return ONLY the paragraph.`

ipcMain.handle("ai:compare-deals", async (_e, deals) => {
  const cfg = readConfig()
  const apiKey = cfg.anthropicApiKey
  if (!apiKey) return { ok: false, summary: null, reason: "no-key" }
  if (!Array.isArray(deals) || deals.length < 2 || deals.length > 4) {
    return { ok: false, summary: null, reason: "bad-input" }
  }

  // Compress to just the essentials Haiku needs to write a one-liner.
  const compact = deals.map((d) => ({
    address:    d.address,
    city:       d.city,
    state:      d.state,
    propertyType: d.propertyType,
    listPrice:  d.listPrice,
    beds:       d.beds,
    baths:      d.baths,
    sqft:       d.sqft,
    monthlyCashFlow: d.monthlyCashFlow,
    capRate:    d.capRate,
    cashOnCash: d.cashOnCash,
    dscr:       d.dscr,
    grm:        d.grm,
    tags:       Array.isArray(d.tags) ? d.tags.slice(0, 3) : [],
  }))

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      ANTHROPIC_MODEL,
        max_tokens: 200,
        system:     COMPARE_SYSTEM_PROMPT,
        messages:   [{ role: "user", content: JSON.stringify(compact) }],
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return { ok: false, summary: null, reason: `http-${res.status}` }
    const data = await res.json()
    const text = data?.content?.[0]?.text?.trim() ?? ""
    const cleaned = text.replace(/^["'`“]+/, "").replace(/["'`”]+$/, "").trim()
    if (!cleaned || cleaned.length > 600) {
      return { ok: false, summary: null, reason: "out-of-bounds" }
    }
    return { ok: true, summary: cleaned }
  } catch (err) {
    return { ok: false, summary: null, reason: err?.name ?? "fetch-failed" }
  }
})

// ---------------------------------------------------------------------------
// IPC — AI personalized greeting
// ---------------------------------------------------------------------------
//
// Generates ONE line (8-22 words) for the Browse start screen subhead.
// Called at most once per day per user — the renderer caches the result in
// localStorage keyed by the date. Failure falls back to the rules-based
// subhead so the start screen never blocks.

const GREETING_SYSTEM_PROMPT = `You are RealVerdict's start-screen voice — the subhead under "Good morning / afternoon / evening" on a real-estate investor's home page.

Output ONE line (8-22 words) personalized to the user's current activity. No quotes, no markdown, no commentary, no JSON. Just the line.

VOICE
- Casual, knowing, occasionally wry. Investor talking to investor.
- Never preachy, never inspirational, never over-eager.
- Reference specific facts from the context when they sharpen the line.
- If the context is empty (new user, no activity), keep it light — don't fake familiarity.

NEVER
- Make up facts not in the context.
- Give advice, judgment, or scoring ("you should...", "this is a great deal").
- Use exclamation points or emojis.
- Repeat the greeting word ("Good morning, ..." — that's already on the line above).
- Restate the SAME underlying activity twice in different forms. If a deal is in Watching AND was saved this week AND counts as "active", that's ONE deal — describe it once. Numbers in the context overlap; never additively sum them in your sentence.

CONTEXT FIELD MEANINGS
- pipeline.activeCount: total deals not in Won or Passed.
- pipeline.watchingCount: deals in the Watching stage. SUBSET of activeCount.
- pipeline.staleWatching: Watching deals not touched in 7+ days. SUBSET of watchingCount.
- pipeline.savedThisWeek: any save action in the last 7 days. May overlap heavily with watchingCount and activeCount.
Pick the SINGLE most useful signal for one line. Don't enumerate.

GOOD EXAMPLES
"Three deals deep in Watching — anything worth a second look?"
"Late lap on the pipeline, huh."
"You've been staring at Austin all week."
"Quiet weekend. Anything you want to lock in?"
"Two in Offered. Closing thoughts?"
"Coffee, then comps."`

ipcMain.handle("ai:greeting", async (_e, context) => {
  const cfg = readConfig()
  const apiKey = cfg.anthropicApiKey
  if (!apiKey) return { ok: false, line: null, reason: "no-key" }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      ANTHROPIC_MODEL,
        max_tokens: 80,
        system:     GREETING_SYSTEM_PROMPT,
        messages:   [{ role: "user", content: JSON.stringify(context ?? {}) }],
      }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return { ok: false, line: null, reason: `http-${res.status}` }
    const data = await res.json()
    const text = data?.content?.[0]?.text?.trim() ?? ""
    // Strip surrounding quotes if Haiku ignored the rule.
    const cleaned = text.replace(/^["'`“]+/, "").replace(/["'`”]+$/, "").trim()
    if (!cleaned || cleaned.length > 200) {
      return { ok: false, line: null, reason: "out-of-bounds" }
    }
    return { ok: true, line: cleaned }
  } catch (err) {
    return { ok: false, line: null, reason: err?.name ?? "fetch-failed" }
  }
})

// ---------------------------------------------------------------------------
// Downloads
//
// Hooks the default session's `will-download` event so any link the user
// triggers in the embedded browser saves cleanly to ~/Downloads (Chrome /
// Safari default behavior). Without this, downloads silently no-op — the
// user clicks a file link and nothing happens.
//
// We broadcast `download:state` events to the renderer so the React UI can
// surface a small toast when a download starts and when it finishes.
// ---------------------------------------------------------------------------

function attachDownloadHandler() {
  session.defaultSession.on("will-download", (_event, item) => {
    const filename = item.getFilename()
    const savePath = path.join(app.getPath("downloads"), filename)
    item.setSavePath(savePath)

    broadcast("download:state", {
      state:      "started",
      filename,
      savePath,
      totalBytes: item.getTotalBytes(),
    })

    item.on("updated", (_e, state) => {
      if (state === "interrupted") {
        broadcast("download:state", { state: "interrupted", filename, savePath })
      }
    })
    item.once("done", (_e, finalState) => {
      // finalState is "completed" | "cancelled" | "interrupted"
      broadcast("download:state", { state: finalState, filename, savePath })
    })
  })
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // Resolve persisted theme BEFORE window creation so the BrowserWindow
  // opens with the correct vibrancy on the very first frame (no flash
  // of dark when the user picked Light).
  const cfg = readConfig()
  const initialPicked = THEME_OPTIONS.includes(cfg.theme) ? cfg.theme : DEFAULT_THEME
  const initialResolved = resolveTheme(initialPicked)
  nativeTheme.themeSource = initialResolved === "light" ? "light" : "dark"
  if (initialPicked === "system") ensureSystemThemeListener()

  Menu.setApplicationMenu(buildAppMenu())
  attachDownloadHandler()
  createAppWindow()
  // Re-apply once the window exists — sets vibrancy + backgroundColor on
  // the freshly-created window. (createAppWindow uses hardcoded sidebar
  // vibrancy in its options; this corrects to the resolved theme.)
  applyTheme(initialPicked, { broadcastOnly: true })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow()
    } else if (appWindow && !appWindow.isDestroyed() && isMainMode) {
      // macOS: user clicked the dock icon while the window was in the
      // background.  Just refocus — DO NOT force-navigate.  Forcing a
      // navigation here was causing 404s because the user could be on any
      // valid app route (/browse, /pipeline, /settings) and we'd reset them
      // back to a hard-coded path that didn't always exist.
      appWindow.focus()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
