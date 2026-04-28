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
 * Resizes to 1400×900 then navigates to /deals.
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
  appWindow.loadURL(`${BASE_URL}/deals`)

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

// ---------------------------------------------------------------------------
// Structured page extractors — run in the page's JS context via
// executeJavaScript, then return the same shape as /api/extract so the
// renderer (research/page.tsx) works identically regardless of path.
//
// Each extractor runs entirely client-side in the listing page's JS context,
// accessing window.__NEXT_DATA__, window.__reactInitialState__, or JSON-LD
// script tags. No ScraperAPI, no AI tokens used.
//
// Returns null when structured extraction fails → falls back to AI path.
// ---------------------------------------------------------------------------

// Zillow — reads window.__NEXT_DATA__ (all the data Zillow ships to React)
const ZILLOW_EXTRACTOR_JS = `(function() {
  try {
    var nd = window.__NEXT_DATA__;
    if (!nd) return null;
    var pageProps = nd.props && nd.props.pageProps;
    if (!pageProps) return null;

    // gdpClientCache may be a JSON-encoded string
    var cache = (pageProps.componentProps && pageProps.componentProps.gdpClientCache)
      || pageProps.gdpClientCache || null;
    if (typeof cache === 'string') { try { cache = JSON.parse(cache); } catch(e) { cache = null; } }

    // Walk any object tree for the first object that looks like a property listing
    function walk(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 9) return null;
      var hasPriceSignal = (typeof obj.price === 'number' || typeof obj.zestimate === 'number'
        || typeof obj.unformattedPrice === 'number' || typeof obj.rentZestimate === 'number');
      var hasIdentity = (typeof obj.bedrooms === 'number' || typeof obj.zpid !== 'undefined'
        || typeof obj.streetAddress !== 'undefined' || typeof obj.livingArea === 'number');
      if (hasPriceSignal && hasIdentity && Object.keys(obj).length >= 5) return obj;
      var vals = Array.isArray(obj) ? obj : Object.values(obj);
      for (var i = 0; i < vals.length; i++) {
        var f = walk(vals[i], depth + 1);
        if (f) return f;
      }
      return null;
    }

    var prop = walk(cache, 0) || walk(pageProps, 0);
    if (!prop) return null;

    // Address
    var address = null;
    if (typeof prop.streetAddress === 'string' && prop.streetAddress) {
      address = prop.streetAddress + ', ' + (prop.city||'') + ', ' + (prop.state||'') + ' ' + (prop.zipcode||'');
    } else if (prop.address && typeof prop.address === 'object') {
      var a = prop.address;
      address = ((a.streetAddress||'') + ', ' + (a.city||'') + ', ' + (a.state||'') + ' ' + (a.zipcode||a.postalCode||'')).trim();
    } else if (typeof prop.address === 'string') {
      address = prop.address;
    }

    // Annual property tax from taxHistory or rate
    var annualTax = null;
    if (Array.isArray(prop.taxHistory) && prop.taxHistory.length) {
      var sorted = prop.taxHistory
        .filter(function(t) { return t && t.taxPaid > 0; })
        .sort(function(a, b) { return (b.time||0) - (a.time||0); });
      if (sorted[0]) annualTax = sorted[0].taxPaid;
    }
    var price = prop.price || prop.unformattedPrice || null;
    if (!annualTax && prop.propertyTaxRate && price) {
      annualTax = Math.round((prop.propertyTaxRate / 100) * price);
    }

    // Annual insurance
    var annualIns = prop.annualHomeownersInsurance || null;
    if (!annualIns && prop.monthlyCosts && prop.monthlyCosts.homeInsurance) {
      annualIns = Math.round(prop.monthlyCosts.homeInsurance * 12);
    }

    // Nearby sold homes (page comps)
    var pageComps = [];
    var nearby = prop.nearbyHomes || prop.comps || prop.recentlySoldHomes || [];
    if (Array.isArray(nearby)) {
      nearby.slice(0, 10).forEach(function(h) {
        if (!h || typeof h !== 'object') return;
        var sp = h.price || h.unformattedPrice || h.lastSoldPrice || null;
        if (!sp || sp <= 0) return;
        var ca = h.streetAddress || (h.address && (typeof h.address === 'string' ? h.address : h.address.streetAddress)) || '';
        pageComps.push({ address: ca, soldPrice: sp,
          beds: h.bedrooms||null, baths: h.bathrooms||null,
          sqft: h.livingArea||h.livingAreaValue||null, soldDate: h.dateSold||h.soldDate||null });
      });
    }

    return {
      address: address ? address.replace(/\\s+/g, ' ').trim() : null,
      price: price, rentEstimate: prop.rentZestimate || null,
      beds: prop.bedrooms||null, baths: prop.bathrooms||null,
      sqft: prop.livingArea||prop.livingAreaValue||null,
      yearBuilt: prop.yearBuilt||null, hoa: prop.monthlyHoaFee||prop.hoaFee||null,
      annualTax: annualTax, annualInsurance: annualIns,
      propertyType: prop.homeType||null, pageComps: pageComps,
    };
  } catch(e) { return null; }
})()`

// Redfin — reads window.__reactInitialState__ or JSON-LD listing data
const REDFIN_EXTRACTOR_JS = `(function() {
  try {
    // Try __reactInitialState__ first
    var s = window.__reactInitialState__;
    var listing = null;
    if (s && s.propertyDetails) {
      listing = s.propertyDetails;
    } else if (s && s.listingInfo) {
      listing = s.listingInfo;
    }
    // Fallback: JSON-LD
    if (!listing) {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        try {
          var d = JSON.parse(scripts[i].textContent);
          if (d && (d['@type'] === 'RealEstateListing' || d['@type'] === 'Product' || d.price)) {
            listing = d; break;
          }
        } catch(e) {}
      }
    }
    if (!listing) return null;

    // Extract from Redfin's propertyDetails structure
    var pd = listing.basicInfo || listing;
    var address = null;
    if (pd.streetLine && pd.city && pd.state) {
      address = pd.streetLine + ', ' + pd.city + ', ' + pd.state + ' ' + (pd.zip||'');
    } else if (typeof listing.name === 'string') {
      address = listing.name;
    } else if (typeof listing.address === 'object' && listing.address) {
      var a = listing.address;
      address = (a.streetAddress||'') + ', ' + (a.addressLocality||'') + ', ' + (a.addressRegion||'') + ' ' + (a.postalCode||'');
    }

    var price = pd.listingPrice || pd.price || (listing.offers && listing.offers.price) || null;
    if (typeof price === 'string') price = parseFloat(price.replace(/[$,]/g,'')) || null;

    var rentEst = pd.rentEstimate || pd.rentZestimate || null;
    var beds = pd.beds || pd.bedrooms || null;
    var baths = pd.baths || pd.bathrooms || null;
    var sqft = pd.sqFt || pd.squareFeet || pd.livingArea || null;
    if (sqft && sqft.value) sqft = sqft.value;
    var yearBuilt = pd.yearBuilt || null;
    var hoa = pd.hoa && pd.hoa.fee ? pd.hoa.fee : null;
    var annualTax = pd.propertyTaxInfo && pd.propertyTaxInfo.taxesDue ? pd.propertyTaxInfo.taxesDue : null;

    // Nearby sold comps from Redfin
    var pageComps = [];
    var similar = (s && (s.recentlySoldHomes || s.nearbyHomes)) || [];
    if (Array.isArray(similar)) {
      similar.slice(0, 10).forEach(function(h) {
        var hp = h.basicInfo || h;
        var sp = hp.soldPrice || hp.listingPrice || hp.price || null;
        if (!sp || sp <= 0) return;
        var ca = hp.streetLine || '';
        if (hp.city) ca += ', ' + hp.city;
        pageComps.push({ address: ca, soldPrice: sp,
          beds: hp.beds||null, baths: hp.baths||null, sqft: hp.sqFt||null, soldDate: hp.soldDate||null });
      });
    }

    return {
      address: address ? address.replace(/\\s+/g,' ').trim() : null,
      price: price, rentEstimate: rentEst, beds: beds, baths: baths,
      sqft: sqft ? Math.round(Number(sqft)) : null, yearBuilt: yearBuilt,
      hoa: hoa, annualTax: annualTax, annualInsurance: null,
      propertyType: pd.propertyType||null, pageComps: pageComps,
    };
  } catch(e) { return null; }
})()`

// Realtor.com — reads JSON-LD <script> tags + window.__renderedProps__
const REALTOR_EXTRACTOR_JS = `(function() {
  try {
    // JSON-LD first (most reliable on Realtor.com)
    var data = null;
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var d = JSON.parse(scripts[i].textContent);
        if (d && (d['@type'] === 'RealEstateListing' || d['@type'] === 'SingleFamilyResidence'
            || d['@type'] === 'Apartment' || d['@type'] === 'Residence')) {
          data = d; break;
        }
      } catch(e) {}
    }
    // Fallback: window.__NEXT_DATA__ (Realtor.com also uses Next.js)
    if (!data) {
      var nd = window.__NEXT_DATA__;
      if (nd && nd.props && nd.props.pageProps) {
        var pp = nd.props.pageProps;
        data = pp.listing || pp.property || pp.propertyDetails || null;
      }
    }
    if (!data) return null;

    var address = null;
    if (data.address && typeof data.address === 'object') {
      var a = data.address;
      address = (a.streetAddress||'') + ', ' + (a.addressLocality||a.city||'')
        + ', ' + (a.addressRegion||a.state||'') + ' ' + (a.postalCode||a.zipCode||'');
    } else if (typeof data.address === 'string') {
      address = data.address;
    } else if (data.streetLine || data.street_address) {
      address = (data.streetLine||data.street_address||'') + ', '
        + (data.city||'') + ', ' + (data.state||'') + ' ' + (data.zip_code||data.postal_code||'');
    }

    var price = null;
    if (data.offers) {
      price = typeof data.offers.price === 'string'
        ? parseFloat(data.offers.price.replace(/[$,]/g,'')) : data.offers.price || null;
    }
    if (!price) price = data.listPrice || data.price || data.list_price || null;

    var beds = data.numberOfRooms || data.bedrooms || data.beds || null;
    var baths = data.bathrooms || data.baths || null;
    var sqft = data.floorSize ? (data.floorSize.value || data.floorSize) : (data.sqFt || data.square_feet || null);
    var yearBuilt = data.yearBuilt || data.year_built || null;
    var hoa = (data.hoa_fee && data.hoa_fee.fee) || data.monthlyHoa || null;
    var annualTax = data.tax_history && data.tax_history[0] ? data.tax_history[0].tax : null;

    // Nearby sold from Realtor.com (usually in __NEXT_DATA__ nearbyHomes)
    var pageComps = [];
    var nearby = (window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps
      && (window.__NEXT_DATA__.props.pageProps.nearbyHomes || window.__NEXT_DATA__.props.pageProps.soldHomes)) || [];
    if (Array.isArray(nearby)) {
      nearby.slice(0, 10).forEach(function(h) {
        var sp = h.soldPrice || h.list_price || h.price || null;
        if (!sp || sp <= 0) return;
        var ca = h.location && h.location.address ? h.location.address.line : (h.streetLine || h.address || '');
        pageComps.push({ address: ca, soldPrice: sp,
          beds: h.beds||null, baths: h.baths||null,
          sqft: h.building_size && h.building_size.size ? h.building_size.size : null, soldDate: h.last_sold_date||null });
      });
    }

    return {
      address: address ? address.replace(/\\s+/g,' ').trim() : null,
      price: price, rentEstimate: null, beds: beds, baths: baths,
      sqft: sqft ? Math.round(Number(sqft)) : null, yearBuilt: yearBuilt,
      hoa: hoa, annualTax: annualTax, annualInsurance: null,
      propertyType: data['@type'] || data.propertyType || null, pageComps: pageComps,
    };
  } catch(e) { return null; }
})()`

// Build the /api/extract-compatible response from a structured extraction result.
// Returns the full response object (same shape as what /api/extract returns) or null.
async function buildStructuredResponse(structured, dom, config) {
  if (!structured || !structured.price) return null

  const inputs = {}
  const facts = {}
  const notes = []
  const warnings = []

  if (structured.price)         inputs.purchasePrice     = Math.round(structured.price)
  if (structured.rentEstimate)  inputs.monthlyRent       = Math.round(structured.rentEstimate)
  if (structured.hoa)           inputs.monthlyHOA        = Math.round(structured.hoa)
  if (structured.annualTax)     inputs.annualPropertyTax = Math.round(structured.annualTax)
  if (structured.annualInsurance) inputs.annualInsurance = Math.round(structured.annualInsurance)
  if (structured.beds)          facts.bedrooms    = structured.beds
  if (structured.baths)         facts.bathrooms   = structured.baths
  if (structured.sqft)          facts.squareFeet  = structured.sqft
  if (structured.yearBuilt)     facts.yearBuilt   = structured.yearBuilt
  if (structured.propertyType)  facts.propertyType = structured.propertyType

  const hostname = (() => { try { return new URL(dom.url).hostname.replace("www.","") } catch { return "listing" } })()
  notes.push(`Extracted from ${hostname} page JSON (no AI token used)`)

  // Fill gaps via property-resolve when we have an address
  if (structured.address) {
    try {
      const res = await fetch(`${BASE_URL}/api/property-resolve?address=${encodeURIComponent(structured.address)}`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) {
        const resolved = await res.json()
        for (const [k, v] of Object.entries(resolved.inputs ?? {})) {
          if (inputs[k] == null && v != null) inputs[k] = v
        }
        Object.assign(facts, resolved.facts ?? {})
        notes.push(...(resolved.notes ?? []))
        warnings.push(...(resolved.warnings ?? []))
      }
    } catch {
      warnings.push("Supplemental estimates unavailable — using listing data only.")
    }
  }

  return {
    address: structured.address ?? undefined,
    inputs, facts, notes, warnings,
    provenance: {},
    siteName: hostname,
    confidence: "high",
    negativeSignals: [],
    arvEstimate: undefined,
    rehabCostEstimate: undefined,
    modelUsed: "structured",
    pageComps: Array.isArray(structured.pageComps) && structured.pageComps.length > 0
      ? structured.pageComps : undefined,
  }
}

// Module-level store for page comps from the most recent analyze call.
// Used by the will-navigate intercept to add pagecomps to the /results URL.
let pendingPageComps = null

ipcMain.handle("browser:analyze", async () => {
  if (!browserView) return { error: "No browser session active." }
  pendingPageComps = null  // clear previous

  let dom
  try {
    dom = await browserView.webContents.executeJavaScript(`
      (() => {
        const url = window.location.href
        const title = document.title
        const clone = document.body.cloneNode(true)
        clone.querySelectorAll('nav,header,footer,script,style,[aria-hidden="true"]').forEach(el => el.remove())
        return { url, title, text: (clone.innerText||"").slice(0,30000) }
      })()
    `)
  } catch { return { error: "Could not read the page. Try reloading it." } }

  if (!dom) return { error: "Could not read the page. Try reloading it." }

  // Attempt structured extraction for known listing sites first
  const url = dom.url || ""
  let structured = null
  try {
    if (/zillow\.com/i.test(url)) {
      structured = await browserView.webContents.executeJavaScript(ZILLOW_EXTRACTOR_JS)
    } else if (/redfin\.com/i.test(url)) {
      structured = await browserView.webContents.executeJavaScript(REDFIN_EXTRACTOR_JS)
    } else if (/realtor\.com/i.test(url)) {
      structured = await browserView.webContents.executeJavaScript(REALTOR_EXTRACTOR_JS)
    }
  } catch {
    structured = null
  }

  if (structured && structured.price) {
    // Structured extraction succeeded — no AI call needed
    const config = readConfig()
    const result = await buildStructuredResponse(structured, dom, config)
    if (result) {
      // Stash page comps so the will-navigate interceptor can add them to the URL
      if (result.pageComps && result.pageComps.length > 0) {
        pendingPageComps = result.pageComps
      }
      return result
    }
    // If buildStructuredResponse failed (e.g. no price after resolve), fall through to AI
  }

  // AI fallback — for unknown sites or when structured extraction failed
  if (!dom.text || dom.text.length < 50)
    return { error: "Not enough page content. Make sure you're on a property listing." }

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
    if (BrowserWindow.getAllWindows().length === 0) createAppWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
