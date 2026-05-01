// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_API = "https://realverdict.app"
const LISTING_RE = /zillow\.com\/homedetails|redfin\.com\/[A-Z]{2}\/|realtor\.com\/realestateandhomes-detail|homes\.com\/property|trulia\.com\/p\//i

let currentTabId = null
let currentUrl = ""
let currentTitle = ""
let lastResult = null

// ---------------------------------------------------------------------------
// State machine — only one panel visible at a time
// ---------------------------------------------------------------------------

const STATES = ["idle", "detected", "loading", "results", "error"]

function showState(name) {
  STATES.forEach((s) => {
    const el = document.getElementById(`state-${s}`)
    if (el) el.classList.toggle("hidden", s !== name)
  })
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id)

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getApiUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["apiUrl"], (res) => {
      resolve(res.apiUrl || DEFAULT_API)
    })
  })
}

$("btn-settings").addEventListener("click", async () => {
  const panel = $("settings-panel")
  const isHidden = panel.classList.contains("hidden")
  if (isHidden) {
    $("input-api-url").value = await getApiUrl()
  }
  panel.classList.toggle("hidden", !isHidden)
})

$("btn-save-settings").addEventListener("click", () => {
  const url = $("input-api-url").value.trim().replace(/\/$/, "")
  chrome.storage.sync.set({ apiUrl: url }, () => {
    $("settings-panel").classList.add("hidden")
  })
})

// ---------------------------------------------------------------------------
// Page extraction — reads DOM from the active tab
// ---------------------------------------------------------------------------

async function extractPageData(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      url: window.location.href,
      title: document.title,
      // Remove nav/header/footer noise before grabbing text
      text: (() => {
        const clone = document.body.cloneNode(true)
        clone.querySelectorAll("nav,header,footer,script,style,[aria-hidden='true']")
          .forEach((el) => el.remove())
        return (clone.innerText || "").slice(0, 30000)
      })(),
    }),
  })
  return result.result
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

async function analyze(tabId) {
  showState("loading")
  $("loading-step").textContent = "Reading page…"

  let pageData
  try {
    pageData = await extractPageData(tabId)
  } catch (err) {
    showError("Couldn't read this page. Try refreshing it and clicking Analyze again.")
    return
  }

  $("loading-step").textContent = "Extracting property data…"

  const apiBase = await getApiUrl()

  let data
  try {
    const res = await fetch(`${apiBase}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: pageData.url, title: pageData.title, text: pageData.text }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Server error ${res.status}`)
    }
    data = await res.json()
  } catch (err) {
    showError(err.message || "Couldn't reach the RealVerdict server.")
    return
  }

  $("loading-step").textContent = "Running analysis…"

  // Server returns inputs — run analysis client-side via the server's calc endpoint
  // (we re-use the results page URL to show full analysis)
  lastResult = data
  renderResults(data, pageData.url)
}

// ---------------------------------------------------------------------------
// Render results
// ---------------------------------------------------------------------------

const TIER_COLORS = {
  excellent: "#4ade80",
  good:      "#a3e635",
  fair:      "#fbbf24",
  poor:      "#f97316",
  avoid:     "#f87171",
}

const TIER_LABELS = {
  excellent: "STRONG BUY",
  good:      "GOOD DEAL",
  fair:      "BORDERLINE",
  poor:      "PASS",
  avoid:     "AVOID",
}

function fmtCurrency(n) {
  if (n == null || !isFinite(n)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function fmtPct(n, digits = 1) {
  if (n == null || !isFinite(n)) return "—"
  return (n * 100).toFixed(digits) + "%"
}

function renderResults(data, sourceUrl) {
  // The server returns raw inputs — we need to navigate to /results for the full
  // computed breakdown, OR we show what we can from the inputs directly.
  // For the side panel we show the key inputs + a "full analysis" link.
  const i = data.inputs || {}

  // Populate address
  if (data.address) $("detected-address").textContent = data.address

  // We don't have computed analysis in the side panel (that needs the calc engine).
  // Show what the server returned and link out to full analysis.
  // Verdict — may not be in extract response; show a "see full" prompt instead.
  const verdictCard = $("verdict-card")
  verdictCard.style.backgroundColor = "rgba(250,250,250,.05)"
  verdictCard.style.borderColor = "#27272a"
  $("verdict-label").textContent = data.address ? data.address : "Property found"
  $("verdict-label").style.color = "#fafafa"
  $("verdict-label").style.fontSize = "13px"
  $("verdict-label").style.fontWeight = "600"
  $("verdict-label").style.textTransform = "none"
  $("verdict-label").style.letterSpacing = "0"
  $("verdict-summary").textContent = `${data.siteName ?? "Listing"} · confidence: ${data.confidence ?? "—"}`

  // Walk-away: not computed in extract, needs full calc
  $("walkaway-price").textContent = "Open full analysis →"
  $("walkaway-price").style.fontSize = "16px"
  $("walkaway-price").style.opacity = "0.6"
  $("walkaway-sub").textContent = "Walk-away price computed on the full analysis page"

  // Key inputs we did get
  $("m-cashflow").textContent = i.monthlyRent ? `${fmtCurrency(i.monthlyRent)}/mo rent` : "—"
  $("m-cap").textContent = i.purchasePrice ? fmtCurrency(i.purchasePrice) : "—"
  $("m-coc").textContent = i.annualPropertyTax ? `${fmtCurrency(i.annualPropertyTax)}/yr tax` : "—"
  $("m-dscr").textContent = i.monthlyHOA ? `${fmtCurrency(i.monthlyHOA)}/mo HOA` : (i.loanInterestRate ? `${(i.loanInterestRate * 100).toFixed(2)}% rate` : "—")

  // Relabel metrics to match what we actually have
  document.querySelectorAll(".metric-label")[0].textContent = "Est. monthly rent"
  document.querySelectorAll(".metric-label")[1].textContent = "Asking price"
  document.querySelectorAll(".metric-label")[2].textContent = "Property tax"
  document.querySelectorAll(".metric-label")[3].textContent = "HOA / Rate"

  // Score breakdown — not available without calc engine; hide it
  document.querySelector(".breakdown").style.display = "none"

  // Source note
  const notes = data.notes || []
  $("source-note").textContent = notes[0] || ""

  // Wire up full analysis button
  $("btn-view-full").onclick = () => {
    const p = buildResultsParams(data)
    chrome.tabs.create({ url: `${DEFAULT_API}/results?${p}` })
  }

  $("btn-re-analyze").onclick = () => {
    if (currentTabId) analyze(currentTabId)
  }

  showState("results")
}

function buildResultsParams(data) {
  const i = data.inputs || {}
  const p = new URLSearchParams()
  if (i.purchasePrice)            p.set("purchasePrice",            String(i.purchasePrice))
  if (i.monthlyRent)              p.set("monthlyRent",              String(i.monthlyRent))
  if (i.annualPropertyTax)        p.set("annualPropertyTax",        String(i.annualPropertyTax))
  if (i.annualInsurance)          p.set("annualInsurance",          String(i.annualInsurance))
  if (i.monthlyHOA)               p.set("monthlyHOA",               String(i.monthlyHOA))
  if (i.loanInterestRate)         p.set("loanInterestRate",         String(i.loanInterestRate))
  if (i.annualAppreciationPercent) p.set("annualAppreciationPercent", String(i.annualAppreciationPercent))
  if (data.address)               p.set("address",                  data.address)
  return p.toString()
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

function showError(msg) {
  $("error-msg").textContent = msg
  showState("error")
  $("btn-retry").onclick = () => { if (currentTabId) analyze(currentTabId) }
}

// ---------------------------------------------------------------------------
// Tab detection
// ---------------------------------------------------------------------------

function updateContextBar(url, title) {
  const bar = $("context-bar")
  const siteEl = $("context-site")
  const urlEl = $("context-url")
  if (!url) { bar.classList.add("hidden"); return }
  try {
    siteEl.textContent = new URL(url).hostname.replace("www.", "")
  } catch {
    siteEl.textContent = ""
  }
  urlEl.textContent = url
  bar.classList.remove("hidden")
}

function handleTabUpdate(url, title, tabId) {
  currentUrl = url || ""
  currentTitle = title || ""
  if (tabId) currentTabId = tabId

  updateContextBar(currentUrl, currentTitle)

  // Only auto-switch to "detected" if we're currently in idle state
  const idleVisible = !$("state-idle").classList.contains("hidden")
  if (LISTING_RE.test(currentUrl) && idleVisible) {
    $("detected-address").textContent = currentTitle || currentUrl
    showState("detected")
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  // Load current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) {
    currentTabId = tab.id
    handleTabUpdate(tab.url, tab.title, tab.id)
  }

  // Listen for navigation events from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TAB_NAVIGATED") {
      handleTabUpdate(msg.url, msg.title, msg.tabId)
    }
  })

  // Button wiring
  $("btn-analyze-idle").addEventListener("click", () => {
    if (currentTabId) analyze(currentTabId)
  })

  $("btn-analyze-detected").addEventListener("click", () => {
    if (currentTabId) analyze(currentTabId)
  })
}

init()
