// Type declarations for the Electron IPC bridge (electron-app/preload.js).
// window.electronAPI is only defined inside the Electron shell.

export interface ElectronBounds {
  x: number
  y: number
  width: number
  height: number
}

// Layout descriptor sent from renderer → main. Main computes the actual
// browserView bounds against the current nextViewBounds, so window
// drag-resize and sidebar collapse are real-time without IPC roundtrips
// on every tick.
export interface BrowserLayout {
  panelWidth: number
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

  // Navigation
  navigate:        (url: string) => Promise<void>
  back:            () => Promise<void>
  forward:         () => Promise<void>
  reload:          () => Promise<void>
  setLayout:       (layout: BrowserLayout) => Promise<void>

  // Extraction (manual trigger, fallback)
  extractDom:      () => Promise<DomPayload | null>
  analyze:         () => Promise<Record<string, unknown>>
  extractDebug:    () => Promise<Record<string, unknown>>

  // Panel state events — main → renderer
  onNavUpdate:     (cb: (payload: NavUpdate) => void) => () => void
  onFocusUrlbar:   (cb: () => void) => () => void
  onPanelAnalyzing:(cb: () => void) => () => void
  onPanelReady:    (cb: (result: PanelPayload) => void) => () => void
  onPanelHide:     (cb: () => void) => () => void
  onPanelError:    (cb: (message: string) => void) => () => void

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
}

// ── Shell API ────────────────────────────────────────────────────────────────
// Available to BOTH the shell HTML AND the Next.js app loaded in nextView.
// Used to coordinate sidebar state and route between the shell and React.
export interface ShellAPI {
  navigate:         (route: string) => Promise<void>
  setContentBounds: (bounds: ElectronBounds) => Promise<void>
  setSidebarWidth:  (w: number) => Promise<void>
  toggleSidebar:    () => Promise<void>
  setSidebar:       (open: boolean) => Promise<void>
  getSidebarState:  () => Promise<boolean>
  onActiveRoute:    (cb: (route: string) => void) => () => void
  onSidebarState:   (cb: (open: boolean) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
    shellAPI?:    ShellAPI
  }
}
