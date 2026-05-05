// Type declarations for the Electron IPC bridge (electron-app/preload.js).
// window.electronAPI is only defined inside the Electron shell.

export interface ElectronBounds {
  x: number
  y: number
  width: number
  height: number
}

// Layout descriptor sent from renderer → main. Either field is optional;
// main keeps the cached value for any field not provided. `animate: false`
// applies bounds instantly (used during live sidebar drags); otherwise
// main runs an Apple-spring tween to the new target.
export interface BrowserLayout {
  sidebarWidth?: number
  panelWidth?:   number
  animate?:      boolean
}

/** Per-tab summary used by the TabStrip. The full nav state for the active
 *  tab still arrives via `onNavUpdate`; this payload is the lightweight
 *  per-tab info needed to render the strip. */
export interface TabInfo {
  id:        string
  url:       string
  title:     string
  isListing: boolean
  loading:   boolean
}

export interface NavUpdate {
  url?: string
  title?: string
  isListing?: boolean
  loading?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
}

export interface BrowserState {
  exists: boolean
  url?: string
  title?: string
  isListing?: boolean
}

export interface DomPayload {
  url: string
  title: string
  text: string
}

/** Context bundle Haiku sees when generating a personalized greeting line.
 *  Shape is intentionally loose — drop in whatever signals are available.
 *  Empty fields are fine; the prompt tells the model not to fake. */
export interface GreetingInput {
  hour?:           number
  dayOfWeek?:      number
  isWeekend?:      boolean
  recentListings?: Array<{ address?: string | null; siteName?: string | null; visitedAt?: string }>
  pipeline?: {
    activeCount?:    number
    watchingCount?:  number
    staleWatching?:  number
    savedThisWeek?:  number
  }
}

/** Context bundle passed with a ⌘K free-form query. */
export interface AskContext {
  savedDeals?: Array<{
    id:           string
    address?:     string | null
    city?:        string | null
    state?:       string | null
    listPrice?:   number | null
    monthlyCashFlow?: number | null
    capRate?:     number | null
    dscr?:        number | null
    stage?:       string
    sourceUrl?:   string
    tags?:        string[]
  }>
  recentListings?: Array<{ url: string; address?: string | null; siteName?: string | null }>
  currentRoute?: string
}

export type AskResponse =
  | { kind: "answer";   text: string }
  | { kind: "navigate"; url: string }
  | { kind: "filter";   stage?: string | null; city?: string | null; minCapRate?: number | null; minCashFlow?: number | null; label: string }
  | { kind: "open";     url: string }
  | { kind: "unknown" }

/** A single chat message in a listing conversation. */
export interface ChatMessage {
  id:        string
  role:      "user" | "assistant"
  content:   string
  /** Local timestamp (ms). Not displayed by default; useful for staleness checks. */
  at:        number
}

/** Context bundle the panel chat sends along with each user query.
 *  Loose shape — Haiku skips fields that aren't there. */
export interface ChatContext {
  listing?: {
    address?:        string | null
    city?:           string | null
    state?:          string | null
    zip?:            string | null
    propertyType?:   string | null
    listPrice?:      number | null
    beds?:           number | null
    baths?:          number | null
    sqft?:           number | null
    yearBuilt?:      number | null
    monthlyCashFlow?: number | null
    capRate?:        number | null
    cashOnCash?:     number | null
    dscr?:           number | null
    grm?:            number | null
    monthlyRent?:    number | null
    monthlyMortgage?: number | null
    annualPropertyTax?: number | null
    monthlyHOA?:     number | null
    annualInsurance?: number | null
    riskFlags?:      string[]
    siteName?:       string | null
  }
  prefs?: {
    downPaymentPct?:    number
    vacancyPct?:        number
    managementPct?:     number
    maintenancePct?:    number
    capexPct?:          number
    rateAdjustmentBps?: number
  }
  pipeline?: {
    activeCount?:    number
    /** Cities the user has saved deals in — informs comp-style answers. */
    commonCities?:   string[]
  }
}

/** Watch re-check inputs — what main needs to re-fetch a deal. */
export interface WatchCheckInput {
  id:         string
  source_url: string
  list_price?: number | null
}

/** Result of a single deal re-check. */
export interface WatchCheckResult {
  id:           string
  ok:           boolean
  url:          string
  reason?:      string
  newListPrice?: number | null
  prevListPrice?: number | null
  priceChanged?: boolean
  delta?:       number | null
  facts?:       Record<string, unknown>
}

/** Compact comparison input — what Haiku gets when summarizing deltas. */
export interface CompareInput {
  address?:        string | null
  city?:           string | null
  state?:          string | null
  propertyType?:   string | null
  listPrice?:      number | null
  beds?:           number | null
  baths?:          number | null
  sqft?:           number | null
  monthlyCashFlow?: number | null
  capRate?:        number | null
  cashOnCash?:     number | null
  dscr?:           number | null
  grm?:            number | null
  tags?:           string[]
}

/** Compact deal payload used to ask Haiku for filter tags. All fields
 *  optional — Haiku skips what isn't there and tags from what is. */
export interface TagDealInput {
  address?:         string | null
  city?:            string | null
  state?:           string | null
  propertyType?:    string | null
  listPrice?:       number | null
  beds?:            number | null
  baths?:           number | null
  sqft?:            number | null
  yearBuilt?:       number | null
  monthlyCashFlow?: number | null
  capRate?:         number | null
  dscr?:            number | null
  riskFlags?:       string[]
  siteName?:        string | null
}

// The full analysis result sent from main → renderer when a listing is ready.
// Mirrors the shape returned by /api/analyze + postProcess in main.js.
export interface PanelResult {
  ok: true
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  listPrice: number | null
  beds: number | null
  baths: number | null
  sqft: number | null
  yearBuilt: number | null
  propertyType: string | null
  siteName: string | null
  take: string | null
  riskFlags: string[]
  // Resolved inputs used for the calculation (after FRED + HUD enrichment)
  inputs: AnalysisInputs
  // Output of lib/calculations.ts
  metrics: DealMetrics
  // Data provenance — where each input came from
  provenance: DataProvenance
}

export interface PanelError {
  ok: false
  errorCode: string
  message: string
}

export type PanelPayload = PanelResult | PanelError

/** Download lifecycle event from the embedded browser. The renderer
 *  surfaces a small toast for "started" and "completed" states; the
 *  intermediate "interrupted" / "cancelled" states get a quieter
 *  treatment. `savePath` always points inside the user's Downloads folder. */
export interface DownloadState {
  state:       "started" | "completed" | "cancelled" | "interrupted"
  filename:    string
  savePath:    string
  totalBytes?: number
}

/** User-pickable theme. "system" auto-resolves to paper or paper-dark
 *  based on the macOS appearance preference; the others are explicit.
 *  Legacy values (dark, charcoal-warm, light) still accepted for
 *  backwards compat — they coerce to the closest paper variant. */
export type ThemePicked   = "system" | "paper" | "paper-dark" | "dark" | "charcoal-warm" | "light"
/** Concrete theme actually applied (after resolving "system"). */
export type ThemeResolved = "paper" | "paper-dark"

export interface AnalysisInputs {
  purchasePrice: number
  monthlyRent: number
  downPaymentPct: number
  interestRate: number
  loanTermYears: number
  annualPropertyTax: number
  monthlyHOA: number
  annualInsurance: number
  vacancyPct: number
  managementPct: number
  maintenancePct: number
  capexPct: number
}

export interface DealMetrics {
  monthlyMortgage: number
  noi: number
  monthlyCashFlow: number
  capRate: number
  cashOnCash: number
  dscr: number
  grm: number
  breakEvenOccupancy: number
  totalCashInvested: number
  verdictTier: string
  verdictScore: number
}

export type SourceKind =
  | "listing"       // extracted directly from the listing page
  | "hud_fmr"       // HUD Fair Market Rent API
  | "fred"          // Federal Reserve FRED API
  | "ai_estimate"   // AI estimated — lower confidence
  | "default"       // built-in default assumption
  | "user"          // user-modified

export interface SourceField {
  source: SourceKind
  label: string
  confidence: "high" | "medium" | "low"
}

export interface DataProvenance {
  listPrice:    SourceField
  rent:         SourceField & { value: number }
  interestRate: SourceField & { value: number; fetchedAt?: string }
  propertyTax:  SourceField & { value: number }
  hoa:          (SourceField & { value: number }) | null
  insurance:    SourceField & { value: number }
}

export interface ElectronAPI {
  // Browser panel lifecycle
  createBrowser:   (layout: BrowserLayout) => Promise<{ reused: boolean }>
  destroyBrowser:  () => Promise<void>
  hideBrowser:     () => Promise<void>
  showBrowser:     (layout: BrowserLayout) => Promise<BrowserState>
  getState:        () => Promise<BrowserState>

  // Tabs
  listTabs:        () => Promise<{ tabs: TabInfo[]; activeId: string | null }>
  newTab:          (url?: string) => Promise<{ id: string }>
  closeTab:        (id: string) => Promise<void>
  activateTab:     (id: string) => Promise<void>
  /** Drag-to-reorder support. Send the full ordered list of tab ids
   *  in the new sequence. Main rebuilds the tab Map preserving values. */
  reorderTabs:     (orderedIds: string[]) => Promise<void>
  onTabsState:     (cb: (payload: { tabs: TabInfo[]; activeId: string | null }) => void) => () => void

  // Navigation
  navigate:        (url: string) => Promise<void>
  back:            () => Promise<void>
  forward:         () => Promise<void>
  reload:          () => Promise<void>
  setLayout:       (layout: BrowserLayout) => Promise<void>

  // Extraction (manual trigger, fallback)
  extractDom:      () => Promise<DomPayload | null>
  analyze:         () => Promise<Record<string, unknown>>
  /** User-initiated reanalyze. Drives the panel through the full broadcast
   *  flow — listen for panel:ready / panel:error to receive the result. */
  reanalyze:       () => Promise<{ ok: boolean }>
  extractDebug:    () => Promise<Record<string, unknown>>
  /** Register URLs that already have a saved snapshot. main short-
   *  circuits auto-analyze on these so we don't pay backend costs for
   *  analyses we already have. Pass the FULL list each time. */
  setSkipAnalysisUrls?: (urls: string[]) => Promise<boolean>

  // AI tagging — Haiku call in main, returns 0-3 short factual tags.
  tagDeal:         (payload: TagDealInput) => Promise<{ ok: boolean; tags: string[]; reason?: string }>

  // AI greeting — Haiku call returns one personalized line (8-22 words)
  // for the Browse start-screen subhead. Renderer caches once per day.
  generateGreeting: (context: GreetingInput) => Promise<{ ok: boolean; line: string | null; reason?: string }>

  // AI compare — given 2-4 deals, returns a short factual diff paragraph.
  compareDeals:    (deals: CompareInput[]) => Promise<{ ok: boolean; summary: string | null; reason?: string }>

  // ⌘K Ask — free-form NL query → answer | navigate | filter | open
  askQuery:        (query: string, context: AskContext) => Promise<{ ok: boolean; response: AskResponse | null; reason?: string }>

  // Listing chat — conversational Q&A about the active listing.
  chatDeal:        (query: string, context: ChatContext, history: ChatMessage[]) =>
    Promise<{ ok: boolean; response: string | null; reason?: string }>

  // Watch — sequential background re-check of every watched deal.
  checkWatchedDeals: (deals: WatchCheckInput[]) =>
    Promise<{ ok: boolean; results: WatchCheckResult[] }>

  // Live FRED mortgage rate. Returns ok:false when no key / network down.
  getMortgageRate: () => Promise<{ ok: true; rate: number; asOf: string } | { ok: false }>

  // Panel state events — main → renderer
  onNavUpdate:     (cb: (payload: NavUpdate) => void) => () => void
  onFocusUrlbar:   (cb: () => void) => () => void
  focusRenderer:   () => Promise<void>
  onPanelAnalyzing:(cb: () => void) => () => void
  onPanelReady:    (cb: (result: PanelPayload) => void) => () => void
  onPanelHide:     (cb: () => void) => () => void
  onPanelError:    (cb: (message: string) => void) => () => void

  /** AI tool-use bridge — fires when Claude calls the adjust_scenario
   *  tool during a chat turn. The active ResultPane subscribes via
   *  applyScenarioFromBus to merge the changes live. */
  onApplyScenario: (cb: (changes: Record<string, number>) => void) => () => void
  /** Reset-scenario bridge — fires when Claude calls reset_scenario.
   *  Clears all overrides on the active panel. */
  onResetScenario: (cb: () => void) => () => void

  // Download lifecycle from the embedded BrowserView's session.
  onDownloadState: (cb: (payload: DownloadState) => void) => () => void

  // Theme system. `picked` is the user's choice (one of THEMES); `resolved`
  // is the concrete variant (system → dark|light depending on macOS).
  getTheme:       () => Promise<{ picked: ThemePicked; resolved: ThemeResolved }>
  setTheme:       (theme: ThemePicked) => Promise<{ ok: boolean; resolved: ThemeResolved }>
  onThemeChanged: (cb: (payload: { picked: ThemePicked; resolved: ThemeResolved }) => void) => () => void

  // Auth
  signedIn:        () => Promise<void>
  signedOut:       () => Promise<void>
  openOAuth:       (url: string) => Promise<{ ok?: boolean; cancelled?: boolean }>

  // Config / API keys
  getConfig:       () => Promise<Record<string, unknown>>
  setOpenAIKey:    (key: string) => Promise<{ ok: boolean }>
  hasOpenAIKey:    () => Promise<boolean>
  setAnthropicKey: (key: string) => Promise<{ ok: boolean }>
  hasAnthropicKey: () => Promise<boolean>

  // Investment defaults
  getInvestmentPrefs: () => Promise<InvestmentPrefs>
  setInvestmentPrefs: (patch: Partial<InvestmentPrefs>) => Promise<{ ok: boolean; prefs?: InvestmentPrefs }>
}

/** Investment underwriting defaults stored in the local Electron config.
 *  Fed into lib/calculations.ts on every analysis. */
export interface InvestmentPrefs {
  downPaymentPct:    number
  vacancyPct:        number
  managementPct:     number
  maintenancePct:    number
  capexPct:          number
  /** Basis points added on top of FRED-quoted 30Y rate for investor loans. */
  rateAdjustmentBps: number
  /** Personal "buy bar" thresholds. null = no bar set (no pill rendered). */
  minCapRate?:       number | null
  minCashFlow?:      number | null
  minDscr?:          number | null
  /** Mapbox style for the persistent map shell. "auto" follows the
   *  current app theme (charcoal-warm/dark → dark-v11, light → light-v11).
   *  Specific values override the theme-derived choice. */
  mapStyle?:         MapStyleKey
}

/** Mapbox style keys exposed to the user. "auto" defers to the theme. */
export type MapStyleKey =
  | "auto"
  | "dark-v11"
  | "light-v11"
  | "streets-v12"
  | "outdoors-v12"
  | "navigation-night-v1"
  | "satellite-streets-v12"

/** Menu-accelerator shortcuts broadcast from main.js via IPC. preload.js
 *  registers a fan-out listener and exposes this subscriber on window so
 *  any component can react. Returns an unsubscribe function. */
export type ShortcutKind =
  | "navigate"
  | "toggle-sidebar"
  | "open-palette"
  | "save-listing"
  | "reanalyze"
export type ShortcutListener = (kind: ShortcutKind, arg?: string) => void

declare global {
  interface Window {
    electronAPI?: ElectronAPI
    __rvOnShortcut?: (cb: ShortcutListener) => () => void
  }
}
