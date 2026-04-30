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
    backgroundColor: "#08080f",
    // hiddenInset from the start so traffic lights are always in place
    // and the window can expand into main-app mode without recreating it.
    titleBarStyle: "hiddenInset",
    // x=14: slight inset from window edge. y=10: vertically centered in
    // the 28px drag zone, matching the sidebar logo's clear breathing room.
    trafficLightPosition: { x: 14, y: 10 },
    // macOS: pass the first click straight to the web content instead of
    // just focusing the window.  Without this the user has to click twice
    // before any button or input responds, making the login form feel broken.
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

  // Install the pageComps interceptor so structured-extraction comps flow
  // through to the /results URL after the user clicks "Full report".
  installPageCompsInterceptor()

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
        if (pathname !== "/research") {
          lastExpandNavMs = now
          appWindow.loadURL(`${BASE_URL}/research`)
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
  appWindow.setBounds(readMainBounds())
  appWindow.loadURL(`${BASE_URL}/research`)

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
      isListing: LISTING_RE.test(url),
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
  browserView.webContents.on("did-stop-loading",     () => sendNav(true))
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
  return {
    exists: true,
    url,
    title: browserView.webContents.getTitle(),
    isListing: LISTING_RE.test(url),
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
    isListing: LISTING_RE.test(url),
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

const HAIKU_EXTRACTION_PROMPT = `You are a real estate data extractor. Your only job is to read this listing page text and return a single valid JSON object.

STRICT RULES — read carefully:
1. Return null for ANY field not explicitly stated on the page. Never estimate, infer, or invent values.
2. All money values must be plain numbers — no $ signs, no commas.
3. This data feeds a financial engine. Wrong numbers produce wrong verdicts. Accuracy over completeness.

RENT — CRITICAL RULE:
- "monthlyRent" must ONLY be set to a figure explicitly labeled as "Rent Zestimate", "Estimated rent", "Rental estimate", "Market rent", or a clearly labeled monthly rental value.
- NEVER use "Est. payment", "Estimated payment", "Monthly payment", "P&I", or any figure that represents a mortgage payment, loan payment, or financing estimate as rent. These are completely different numbers.
- On for-sale listing pages, the large monthly figure shown is almost always the mortgage payment — NOT rent. Do not confuse them.
- If no explicit rental estimate is shown on the page, return null for monthlyRent.

Return exactly this JSON shape (no markdown, no explanation — only the JSON object):
{
  "address": "full street address with city, state, zip — or null",
  "price": list price as number or null,
  "beds": bedroom count as number or null,
  "baths": bathroom count as number or null,
  "sqft": square footage as number or null,
  "yearBuilt": year built as number or null,
  "propertyType": "Single Family" / "Condo" / "Townhouse" / "Multi-Family" / etc or null,
  "monthlyRent": Rent Zestimate or explicit rental estimate ONLY — never mortgage payment — or null,
  "monthlyHOA": monthly HOA fee IF explicitly shown or null,
  "annualPropertyTax": annual property tax IF explicitly shown or null,
  "annualInsurance": annual homeowners insurance IF explicitly shown or null,
  "arvEstimate": after-repair value IF explicitly stated (not estimated by you) or null,
  "rehabCost": rehab/renovation cost IF explicitly stated (not estimated by you) or null,
  "siteName": platform name e.g. "Zillow" / "Redfin" / "Realtor.com" or null,
  "confidence": "high" if address and price are clearly present, "medium" if one is unclear, "low" if both are missing,
  "negativeSignals": [
    Objects with { "signal": "short description", "severity": "high"|"medium"|"low" } for any of:
    HIGH — probate/estate sale, foundation/structural issues, title problems, tax liens, mechanic liens
    MEDIUM — as-is/cash-only, fire/water/flood damage, mold, asbestos, lead paint, needs major work
    LOW — short sale, REO/bank-owned, pre-foreclosure, auction, easement, HOA violation
    Empty array [] if none found.
  ],
  "pageComps": [
    Objects with { "address": string, "soldPrice": number, "beds": number|null, "baths": number|null, "sqft": number|null, "soldDate": string|null }
    for nearby recently-sold properties IF listed on the page. Up to 10. Empty array [] if none.
  ]
}`

/**
 * Call Anthropic's claude-haiku-4-5 directly from the Electron main process.
 * Bypasses the Next.js server entirely — the page text is already on this
 * machine and goes straight to Anthropic.
 *
 * @param {string} apiKey  Anthropic API key from local config
 * @param {{ url: string, title: string, text: string }} dom  Page content
 * @returns {Promise<object|null>}  Parsed extraction JSON or null
 */
async function callAnthropicHaiku(apiKey, dom) {
  const userMessage =
    `Page title: ${dom.title}\nPage URL: ${dom.url}\n\nPage text:\n${dom.text.slice(0, 25000)}`

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: HAIKU_EXTRACTION_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`)
  }

  const response = await res.json()
  const text = response.content?.[0]?.text ?? ""

  // Strip optional markdown fences before parsing
  const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  const match = jsonText.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

// Module-level store for page comps from the most recent analyze call.
// Used by the will-navigate intercept to add pagecomps to the /results URL.
let pendingPageComps = null

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

ipcMain.handle("browser:analyze", async () => {
  if (!browserView) return { error: "No browser session active." }
  pendingPageComps = null

  // Wait for the page to finish loading before extracting.
  //
  // Why: browser:analyze is triggered by did-navigate (the URL commit), but
  // did-navigate fires BEFORE the page is fully rendered.  For full-page loads
  // (Zillow, Redfin) the listing HTML arrives shortly after, so waiting for
  // did-stop-loading is sufficient.  For SPA pushState navigations (Zillow
  // "Similar homes" links), isLoading() stays false but the JS framework
  // re-renders the new listing asynchronously — the extra 600 ms yield covers
  // that case without adding perceptible latency on fast connections.
  if (browserView.webContents.isLoading()) {
    await new Promise((resolve) => {
      const h = () => resolve()
      browserView.webContents.once("did-stop-loading", h)
      // Safety timeout: never block longer than 12 s
      setTimeout(() => { try { browserView.webContents.off("did-stop-loading", h) } catch {} resolve() }, 12_000)
    })
  } else {
    // SPA case: URL already changed via pushState but framework hasn't
    // rendered the new listing content yet.  Brief yield for async renders.
    await new Promise(r => setTimeout(r, 600))
  }

  // Extract full page text from the already-loaded webview DOM
  let dom
  try {
    dom = await browserView.webContents.executeJavaScript(`
      (() => {
        const clone = document.body.cloneNode(true)
        clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]').forEach(el => el.remove())
        return { url: window.location.href, title: document.title, text: (clone.innerText||"").slice(0,25000) }
      })()
    `)
  } catch { return { error: "Could not read the page. Try reloading it." } }

  if (!dom || !dom.text || dom.text.length < 50)
    return { error: "Not enough page content. Make sure you're on a property listing." }

  const config = readConfig()
  const hostname = (() => { try { return new URL(dom.url).hostname.replace("www.", "") } catch { return "listing" } })()

  // Prefer Anthropic: call Haiku directly (no server round trip)
  if (config.anthropicApiKey) {
    try {
      const extracted = await callAnthropicHaiku(config.anthropicApiKey, dom)
      if (!extracted) return { error: "Claude could not extract property data from this page." }

      const inputs = {}
      const facts  = {}

      if (extracted.price)             inputs.purchasePrice     = Math.round(extracted.price)
      if (extracted.monthlyRent)       inputs.monthlyRent       = Math.round(extracted.monthlyRent)
      if (extracted.monthlyHOA)        inputs.monthlyHOA        = Math.round(extracted.monthlyHOA)
      if (extracted.annualPropertyTax) inputs.annualPropertyTax = Math.round(extracted.annualPropertyTax)
      if (extracted.annualInsurance)   inputs.annualInsurance   = Math.round(extracted.annualInsurance)
      if (extracted.beds)              facts.bedrooms           = extracted.beds
      if (extracted.baths)             facts.bathrooms          = extracted.baths
      if (extracted.sqft)              facts.squareFeet         = extracted.sqft
      if (extracted.yearBuilt)         facts.yearBuilt          = extracted.yearBuilt
      if (extracted.propertyType)      facts.propertyType       = extracted.propertyType

      const siteName   = extracted.siteName ?? hostname
      const confidence = extracted.confidence ?? "medium"
      const notes      = [`Extracted from ${siteName} via Claude Haiku · confidence: ${confidence}`]
      const warnings   = []

      for (const sig of (extracted.negativeSignals ?? [])) {
        if (sig.severity === "high") warnings.push(`⚠ ${sig.signal}`)
      }

      if (Array.isArray(extracted.pageComps) && extracted.pageComps.length > 0) {
        pendingPageComps = extracted.pageComps
      }

      // Build per-field provenance so the distribution engine knows which
      // inputs are solid (from the listing page) vs defaulted.
      const provenance = {}
      if (extracted.price) {
        provenance.purchasePrice = { source: "zillow-listing", confidence: "high", note: `List price from ${siteName}` }
      }
      if (extracted.monthlyRent) {
        provenance.monthlyRent = { source: "zillow-listing", confidence: "medium", note: `Rent Zestimate from ${siteName} — verify with local rental comps before offering` }
      }
      if (extracted.monthlyHOA) {
        provenance.monthlyHOA = { source: "zillow-listing", confidence: "high", note: `HOA fee stated on listing` }
      }
      if (extracted.annualPropertyTax) {
        provenance.annualPropertyTax = { source: "zillow-listing", confidence: "high", note: `Property tax from listing` }
      }
      if (extracted.annualInsurance) {
        provenance.annualInsurance = { source: "zillow-listing", confidence: "medium", note: `Insurance shown on listing — get a real quote before offering` }
      }

      return {
        address:          extracted.address ?? undefined,
        inputs, facts, notes, warnings,
        provenance,
        siteName,
        confidence,
        negativeSignals:  extracted.negativeSignals ?? [],
        arvEstimate:      extracted.arvEstimate  ?? undefined,
        rehabCostEstimate: extracted.rehabCost   ?? undefined,
        modelUsed:        "anthropic",
        pageComps:        Array.isArray(extracted.pageComps) && extracted.pageComps.length > 0
                            ? extracted.pageComps : undefined,
      }
    } catch (err) {
      console.error("[browser:analyze] Haiku error:", err)
      return { error: err instanceof Error ? err.message : "Extraction failed." }
    }
  }

  // Fallback: no Anthropic key — forward to /api/extract (uses OpenAI)
  if (!config.openaiApiKey) {
    return { error: "No AI API key configured. Add an Anthropic or OpenAI key in Settings." }
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
    const body = await res.json()
    if (!res.ok) return { error: body?.error ?? `Server error ${res.status}` }
    if (Array.isArray(body.pageComps) && body.pageComps.length > 0) {
      pendingPageComps = body.pageComps
    }
    return body
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error." }
  }
})

// ---------------------------------------------------------------------------
// Intercept navigation to /results in the main window and append pagecomps
// when a structured extraction just produced them.  This threads page-extracted
// sale comps to the results page without modifying research/page.tsx.
// ---------------------------------------------------------------------------

function installPageCompsInterceptor() {
  if (!appWindow) return
  appWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!pendingPageComps || pendingPageComps.length === 0) return
    try {
      const u = new URL(navigationUrl)
      // Only intercept /results navigations on our own host
      const isOurHost = DEV
        ? (u.hostname === "127.0.0.1" || u.hostname === "localhost")
        : (u.hostname === "real-verdict-roi.vercel.app")
      if (!isOurHost || !u.pathname.startsWith("/results")) return

      const comps = pendingPageComps
      pendingPageComps = null

      // base64-encode the comps array so it survives URL encoding cleanly
      const encoded = Buffer.from(JSON.stringify(comps)).toString("base64")
      u.searchParams.set("pagecomps", encoded)

      event.preventDefault()
      appWindow.webContents.loadURL(u.toString())
    } catch {
      // navigation proceeds unmodified
    }
  })
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
