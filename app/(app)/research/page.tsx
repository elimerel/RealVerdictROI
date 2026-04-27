"use client"

import {
  useState, useRef, useCallback, useEffect,
} from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, X,
  ExternalLink, AlertTriangle, CheckCircle2, TrendingUp,
  ChevronDown, ChevronUp, ChevronLeft, BarChart3, DollarSign,
  Home, Percent, ShieldCheck,
} from "lucide-react"
import { SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  analyseDeal,
  findOfferCeiling,
  formatCurrency,
  formatPercent,
  sanitiseInputs,
} from "@/lib/calculations"
import { TIER_LABEL, TIER_ACCENT } from "@/lib/tier-constants"
import type { DealInputs, DealAnalysis } from "@/lib/calculations"
import type { BrowseResponse } from "@/app/api/browse/route"
import "@/lib/electron" // global Window type augmentation

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnalysisResult = {
  address?: string
  inputs: Partial<DealInputs>
  analysis: DealAnalysis
  walkAway: number | null
  siteName: string | null
  confidence: string
}

// Session used only in the web/Browserbase path
type BrowserbaseSession = {
  sessionId: string
  screenshot: string
  url: string
  title: string
  isListingPage: boolean
  pageText: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ""
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

function hostnameOf(url: string) {
  try { return new URL(url).hostname.replace("www.", "") } catch { return url }
}

// ---------------------------------------------------------------------------
// Analysis sidebar panel — used only in the Web/Browserbase mode
// ---------------------------------------------------------------------------

function AnalysisPanel({
  result,
  onClose,
  onViewFull,
}: {
  result: AnalysisResult
  onClose: () => void
  onViewFull: () => void
}) {
  const { analysis, walkAway } = result
  const tier = analysis.verdict.tier
  const accentColor = TIER_ACCENT[tier]
  const tierLabel = TIER_LABEL[tier]

  const metrics = [
    { label: "Monthly cash flow",  value: formatCurrency(analysis.monthlyCashFlow, 0),      accent: analysis.monthlyCashFlow >= 0 },
    { label: "Cap rate",           value: formatPercent(analysis.capRate, 1) },
    { label: "Cash-on-cash",       value: formatPercent(analysis.cashOnCashReturn, 1),        accent: analysis.cashOnCashReturn >= 0.07 },
    { label: "DSCR",               value: isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞" },
    { label: "GRM",                value: analysis.grossRentMultiplier.toFixed(1) + "x" },
    { label: "Total cash in",      value: formatCurrency(analysis.totalCashInvested, 0) },
  ]

  return (
    <div className="flex flex-col h-full border-l border-border bg-card/30">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">
            {result.address ?? "Property Analysis"}
          </span>
        </div>
        <button
          onClick={onClose}
          className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted/60 text-muted-foreground shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          <div
            className="rounded-lg px-4 py-3 space-y-1"
            style={{ backgroundColor: `${accentColor}15`, borderColor: `${accentColor}30`, borderWidth: 1 }}
          >
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: accentColor }}>Verdict</p>
            <p className="text-lg font-semibold" style={{ color: accentColor }}>{tierLabel}</p>
            <p className="text-xs text-muted-foreground">{analysis.verdict.summary}</p>
          </div>

          {walkAway != null && (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Walk-away price</p>
              <p className="text-xl font-semibold font-mono">{formatCurrency(walkAway, 0)}</p>
              <p className="text-xs text-muted-foreground">Max offer where the deal still clears</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-md border border-border bg-muted/10 px-3 py-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">{m.label}</p>
                <p className={cn("text-sm font-mono font-medium", m.accent && "text-emerald-400")}>{m.value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Score breakdown</p>
            {analysis.verdict.breakdown.map((b) => (
              <div key={b.category} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{b.category}</span>
                <span className={cn("font-mono", (b.status === "win" || b.status === "ok") ? "text-emerald-400" : b.status === "warn" ? "text-amber-400" : "text-red-400")}>
                  {b.points}/{b.maxPoints}
                </span>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground">
            Data read from {result.siteName ?? "listing page"} · confidence: {result.confidence}
          </p>

          <Button size="sm" className="w-full gap-1.5" onClick={onViewFull}>
            <ExternalLink className="h-3.5 w-3.5" />
            Open full analysis
          </Button>
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Electron-only: full-screen results view (replaces the browser panel)
// No WebContentsView overlap possible — the native view is hidden before this renders.
// ---------------------------------------------------------------------------

function ElectronResultsView({
  result,
  onBack,
  onViewFull,
}: {
  result: AnalysisResult
  onBack: () => void
  onViewFull: () => void
}) {
  const { analysis, walkAway } = result
  const tier = analysis.verdict.tier
  const accentColor = TIER_ACCENT[tier]
  const tierLabel = TIER_LABEL[tier]

  const metrics = [
    { icon: DollarSign, label: "Monthly cash flow",  value: formatCurrency(analysis.monthlyCashFlow, 0),   good: analysis.monthlyCashFlow >= 0,   neutral: false },
    { icon: Percent,    label: "Cap rate",            value: formatPercent(analysis.capRate, 1),             good: analysis.capRate >= 0.05,         neutral: false },
    { icon: TrendingUp, label: "Cash-on-cash return", value: formatPercent(analysis.cashOnCashReturn, 1),   good: analysis.cashOnCashReturn >= 0.07, neutral: false },
    { icon: BarChart3,  label: "DSCR",                value: isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞", good: analysis.dscr >= 1.2, neutral: false },
    { icon: Home,       label: "GRM",                 value: analysis.grossRentMultiplier.toFixed(1) + "×", good: false, neutral: true },
    { icon: DollarSign, label: "Total cash invested", value: formatCurrency(analysis.totalCashInvested, 0), good: false, neutral: true },
  ]

  return (
    <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 3.5rem)" }}>
      <ScrollArea className="flex-1">
        <div className="max-w-3xl mx-auto p-8 space-y-8">

          {/* Address + source */}
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">
              {result.address ?? "Property Analysis"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Read from {result.siteName ?? "listing page"} · confidence: {result.confidence}
            </p>
          </div>

          {/* Verdict card */}
          <div
            className="rounded-xl p-6 space-y-2"
            style={{ backgroundColor: `${accentColor}12`, borderColor: `${accentColor}25`, borderWidth: 1 }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: accentColor }}>
              Verdict
            </p>
            <p className="text-3xl font-bold" style={{ color: accentColor }}>{tierLabel}</p>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-lg">
              {analysis.verdict.summary}
            </p>
          </div>

          {/* Walk-away + metrics row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {walkAway != null && (
              <div className="rounded-xl border border-border bg-card/40 p-5 space-y-1 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Walk-away price</p>
                </div>
                <p className="text-4xl font-bold font-mono">{formatCurrency(walkAway, 0)}</p>
                <p className="text-xs text-muted-foreground">Maximum offer price where this deal still clears your hurdle rate</p>
              </div>
            )}

            {metrics.map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-card/40 p-4 space-y-2">
                <div className="flex items-center gap-1.5">
                  <m.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-[11px] text-muted-foreground">{m.label}</p>
                </div>
                <p className={cn(
                  "text-2xl font-bold font-mono",
                  m.neutral ? "text-foreground" : m.good ? "text-emerald-400" : "text-red-400"
                )}>
                  {m.value}
                </p>
              </div>
            ))}
          </div>

          {/* Score breakdown */}
          <div className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
            <p className="text-sm font-medium">Score breakdown</p>
            <div className="space-y-3">
              {analysis.verdict.breakdown.map((b) => {
                const pct = b.maxPoints > 0 ? b.points / b.maxPoints : 0
                return (
                  <div key={b.category} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{b.category}</span>
                      <span className={cn(
                        "font-mono font-medium",
                        (b.status === "win" || b.status === "ok") ? "text-emerald-400" : b.status === "warn" ? "text-amber-400" : "text-red-400"
                      )}>
                        {b.points}/{b.maxPoints}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          (b.status === "win" || b.status === "ok") ? "bg-emerald-500" : b.status === "warn" ? "bg-amber-500" : "bg-red-500"
                        )}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pb-4">
            <Button variant="outline" className="gap-2" onClick={onBack}>
              <ChevronLeft className="h-4 w-4" />
              Back to listing
            </Button>
            <Button className="gap-2 flex-1" onClick={onViewFull}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open full analysis &amp; save deal
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared: build AnalysisResult from extract/browse API response
// ---------------------------------------------------------------------------

function buildAnalysisResult(
  data: Omit<BrowseResponse, "screenshot" | "facts" | "notes" | "warnings" | "provenance"> & {
    screenshot?: string
    inputs: Partial<DealInputs>
  }
): AnalysisResult {
  const sanitized = sanitiseInputs(data.inputs as DealInputs)
  const analysis = analyseDeal(sanitized)
  const ceiling = findOfferCeiling(sanitized)
  return {
    address: data.address,
    inputs: data.inputs,
    analysis,
    walkAway: ceiling.primaryTarget?.price ?? null,
    siteName: data.siteName,
    confidence: data.confidence,
  }
}

function buildViewFullUrl(result: AnalysisResult): string {
  const p = new URLSearchParams()
  const i = result.inputs
  if (i.purchasePrice)             p.set("purchasePrice",             String(i.purchasePrice))
  if (i.monthlyRent)               p.set("monthlyRent",               String(i.monthlyRent))
  if (i.annualPropertyTax)         p.set("annualPropertyTax",         String(i.annualPropertyTax))
  if (i.annualInsurance)           p.set("annualInsurance",           String(i.annualInsurance))
  if (i.monthlyHOA)                p.set("monthlyHOA",                String(i.monthlyHOA))
  if (i.loanInterestRate)          p.set("loanInterestRate",          String(i.loanInterestRate))
  if (i.annualAppreciationPercent) p.set("annualAppreciationPercent", String(i.annualAppreciationPercent))
  if (result.address)              p.set("address",                   result.address)
  return `/results?${p.toString()}`
}

// ---------------------------------------------------------------------------
// ELECTRON MODE — WebContentsView via IPC
// ---------------------------------------------------------------------------

// Known layout constants (CSS pixels)
const HEADER_H = 56        // h-14
const ANALYSIS_W = 320     // w-80

// Sidebar widths match the shadcn/ui sidebar CSS variables
const SIDEBAR_OPEN_W = 256
const SIDEBAR_ICON_W = 48  // icon-only collapsed state

/**
 * Calculates the browser panel bounds from first principles so we never
 * depend on getBoundingClientRect(), which returns height: 0 in Electron
 * due to how the flex chain resolves against the window chrome.
 */
function calcBounds(sidebarOpen: boolean, analysisOpen: boolean) {
  const x = sidebarOpen ? SIDEBAR_OPEN_W : SIDEBAR_ICON_W
  const y = HEADER_H
  const width = Math.max(0, window.innerWidth - x - (analysisOpen ? ANALYSIS_W : 0))
  const height = Math.max(0, window.innerHeight - y)
  return { x, y, width, height }
}

function useElectronBounds(
  active: boolean,
  sidebarOpen: boolean,
  analysisOpen: boolean
) {
  const sendBounds = useCallback(() => {
    if (!window.electronAPI) return
    window.electronAPI.updateBounds(calcBounds(sidebarOpen, analysisOpen))
  }, [sidebarOpen, analysisOpen])

  // Re-send on window resize
  useEffect(() => {
    if (!active) return
    sendBounds()
    window.addEventListener("resize", sendBounds)
    return () => window.removeEventListener("resize", sendBounds)
  }, [active, sendBounds])

  // Re-send after sidebar transition completes (~250 ms CSS animation)
  useEffect(() => {
    if (!active) return
    const t = setTimeout(sendBounds, 300)
    return () => clearTimeout(t)
  }, [sidebarOpen, active, sendBounds])

  // Re-send immediately when analysis panel opens/closes
  useEffect(() => {
    if (active) sendBounds()
  }, [analysisOpen, active, sendBounds])

}

function ElectronResearchPage() {
  const { open: sidebarOpen } = useSidebar()

  // Browser panel state
  const [browserActive, setBrowserActive] = useState(false)
  const [currentUrl, setCurrentUrl] = useState("")
  const [currentTitle, setCurrentTitle] = useState("")
  const [isListingPage, setIsListingPage] = useState(false)
  const [browserLoading, setBrowserLoading] = useState(false)

  // URL bar (can differ from currentUrl while user is typing)
  const [urlInput, setUrlInput] = useState("https://zillow.com")

  // Analysis
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // When true: WebContentsView is hidden and we show the results view full-width.
  // This completely eliminates any overlap between the native browser layer and React UI.
  const [showingResults, setShowingResults] = useState(false)

  // Keep WebContentsView bounds in sync with layout.
  // Disable (pass active=false) when showing results so bounds don't fight our hide call.
  useElectronBounds(browserActive && !showingResults, sidebarOpen, false)

  // On mount: check if a browser view already exists from a previous visit
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    api.showBrowser(calcBounds(sidebarOpen, false)).then((state) => {
      if (state?.exists && state.url) {
        setBrowserActive(true)
        setCurrentUrl(state.url)
        setUrlInput(state.url)
        setCurrentTitle(state.title ?? "")
        setIsListingPage(state.isListing ?? false)
      }
    })
  // sidebarOpen intentionally excluded — only want to run on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On unmount: hide (not destroy) so the session survives navigation
  useEffect(() => {
    return () => { window.electronAPI?.hideBrowser() }
  }, [])

  // Subscribe to nav-update events from main process
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    const unsub = api.onNavUpdate(({ url, title, isListing, loading }) => {
      if (url !== undefined) { setCurrentUrl(url); setUrlInput(url) }
      if (title !== undefined) setCurrentTitle(title)
      if (isListing !== undefined) setIsListingPage(isListing)
      if (loading !== undefined) setBrowserLoading(loading)
    })
    return unsub
  }, [])

  const launchBrowser = useCallback(async (url: string) => {
    const api = window.electronAPI!
    setBrowserLoading(true)
    setError(null)
    setAnalysisResult(null)
    setShowingResults(false)
    await api.createBrowser(calcBounds(sidebarOpen, false))
    await api.navigate(url)
    setBrowserActive(true)
    setCurrentUrl(url)
    setUrlInput(url)
  }, [sidebarOpen])

  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault()
    const url = normalizeUrl(urlInput)
    if (!url) return
    if (!browserActive) {
      await launchBrowser(url)
    } else {
      // If we were showing results, go back to browser first
      if (showingResults) {
        setShowingResults(false)
        setAnalysisResult(null)
        await window.electronAPI?.showBrowser(calcBounds(sidebarOpen, false))
      }
      setBrowserLoading(true)
      setError(null)
      await window.electronAPI?.navigate(url)
    }
  }

  const handleAnalyze = async () => {
    if (!browserActive) return
    setAnalysisLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI!.analyze() as { error?: string } & Omit<BrowseResponse, "screenshot" | "facts" | "notes" | "warnings" | "provenance">
      if (result.error) throw new Error(result.error)
      const built = buildAnalysisResult({ ...result, inputs: result.inputs as Partial<DealInputs> })
      // Hide the native browser layer BEFORE setting results, so there's never a moment
      // where both are visible and overlapping.
      await window.electronAPI?.hideBrowser()
      setAnalysisResult(built)
      setShowingResults(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.")
    } finally {
      setAnalysisLoading(false)
    }
  }

  // Restore the browser session after viewing results
  const handleBackToBrowser = useCallback(async () => {
    setShowingResults(false)
    setAnalysisResult(null)
    const bounds = calcBounds(sidebarOpen, false)
    await window.electronAPI?.showBrowser(bounds)
  }, [sidebarOpen])

  const handleViewFull = () => {
    if (!analysisResult) return
    window.location.href = buildViewFullUrl(analysisResult)
  }

  // When in results-view mode, render the full-width panel (no browser overlap possible)
  if (showingResults && analysisResult) {
    return (
      <SidebarInset>
        <header className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
          <SidebarTrigger className="-ml-1" />
          <button
            onClick={handleBackToBrowser}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to listing
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="truncate max-w-xs">{analysisResult.address ?? hostnameOf(currentUrl)}</span>
          </div>
        </header>
        <ElectronResultsView
          result={analysisResult}
          onBack={handleBackToBrowser}
          onViewFull={handleViewFull}
        />
      </SidebarInset>
    )
  }

  return (
    <SidebarInset>
      {/* Top bar */}
      <header className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
        <SidebarTrigger className="-ml-1" />

        <div className="flex items-center gap-1">
          <button
            onClick={() => window.electronAPI?.back()}
            disabled={!browserActive || browserLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.electronAPI?.forward()}
            disabled={!browserActive || browserLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.electronAPI?.reload()}
            disabled={!browserActive}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
          >
            <RotateCw className={cn("h-3.5 w-3.5", browserLoading && "animate-spin")} />
          </button>
        </div>

        <form onSubmit={handleNavigate} className="flex-1 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-muted/30 text-sm">
            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://zillow.com"
              className="border-0 bg-transparent p-0 h-auto text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Button type="submit" size="sm" disabled={browserLoading}>
            {browserLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Go"}
          </Button>
        </form>

        {browserActive && (
          <Button
            size="sm"
            variant={isListingPage ? "default" : "outline"}
            disabled={analysisLoading}
            onClick={handleAnalyze}
            className={cn(
              "gap-1.5 shrink-0",
              isListingPage && "bg-emerald-600 hover:bg-emerald-500 text-white border-0"
            )}
          >
            {analysisLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <TrendingUp className="h-3.5 w-3.5" />
            }
            {analysisLoading ? "Analyzing…" : "Analyze this property"}
          </Button>
        )}

        {/* Error in header — never covered by the native WebContentsView */}
        {error && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/30 text-xs text-red-400 shrink-0 max-w-xs">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 ml-1"><X className="h-3 w-3" /></button>
          </div>
        )}

        {/* Analyzing… spinner also in header so it's above the native layer */}
        {analysisLoading && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground shrink-0">
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
            <span>Reading listing…</span>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 3.5rem)" }}>
        {/* Browser pane — transparent placeholder; WebContentsView is layered on top by Electron */}
        <div className="flex-1 overflow-hidden relative bg-zinc-950 flex flex-col">
          {!browserActive && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Globe className="h-10 w-10 opacity-20" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Research browser</p>
                <p className="text-xs opacity-60">Type a URL above and click Go to start browsing</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {["zillow.com", "redfin.com", "realtor.com"].map((site) => (
                  <button
                    key={site}
                    onClick={() => { setUrlInput(`https://${site}`); void launchBrowser(`https://${site}`) }}
                    className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted/50 transition-colors"
                  >
                    {site}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Listing badge floats over the WebContentsView */}
          {isListingPage && browserActive && (
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-xs font-medium shadow-lg pointer-events-none">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Listing detected — click &quot;Analyze this property&quot;
            </div>
          )}

          {/* URL chip at bottom */}
          {browserActive && currentUrl && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 text-[10px] text-muted-foreground font-mono pointer-events-none">
              {hostnameOf(currentUrl)}
              {currentTitle ? ` — ${currentTitle.slice(0, 40)}` : ""}
            </div>
          )}
        </div>
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// WEB/BROWSERBASE MODE — original screenshot-based flow (unchanged)
// ---------------------------------------------------------------------------

function WebResearchPage() {
  const [urlInput, setUrlInput] = useState("https://zillow.com")
  const [session, setSession] = useState<BrowserbaseSession | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    return () => {
      if (session?.sessionId) {
        fetch("/api/browse/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.sessionId }),
          keepalive: true,
        }).catch(() => {})
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sessionId])

  const startSession = useCallback(async (url: string) => {
    setSessionLoading(true)
    setError(null)
    setAnalysisResult(null)
    try {
      const res = await fetch("/api/browse/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(e.error ?? "Failed to start browser session.")
      }
      const data = await res.json() as BrowserbaseSession
      setSession(data)
      setUrlInput(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start browser.")
    } finally {
      setSessionLoading(false)
    }
  }, [])

  const act = useCallback(async (action: unknown) => {
    if (!session || actionLoading) return
    setActionLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/browse/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId, action }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(e.error ?? "Action failed.")
      }
      const data = await res.json() as Omit<BrowserbaseSession, "sessionId">
      setSession((prev) => prev ? { ...prev, ...data } : null)
      setUrlInput(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setActionLoading(false)
    }
  }, [session, actionLoading])

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    const url = normalizeUrl(urlInput)
    if (!url) return
    if (!session) startSession(url)
    else act({ type: "navigate", url })
  }

  const handleScreenshotClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!session || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1280)
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 800)
    act({ type: "click", x, y })
  }

  const handleAnalyze = async () => {
    if (!session) return
    setAnalysisLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: session.url }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(e.error ?? "Analysis failed.")
      }
      const data = await res.json() as BrowseResponse
      setAnalysisResult(buildAnalysisResult({ ...data, inputs: data.inputs as Partial<DealInputs> }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.")
    } finally {
      setAnalysisLoading(false)
    }
  }

  const handleViewFull = () => {
    if (!analysisResult) return
    window.open(buildViewFullUrl(analysisResult), "_blank")
  }

  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
        <SidebarTrigger className="-ml-1" />

        <div className="flex items-center gap-1">
          <button
            onClick={() => act({ type: "back" })}
            disabled={!session || actionLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => act({ type: "forward" })}
            disabled={!session || actionLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => act({ type: "reload" })}
            disabled={!session || actionLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
          >
            <RotateCw className={cn("h-3.5 w-3.5", actionLoading && "animate-spin")} />
          </button>
        </div>

        <form onSubmit={handleNavigate} className="flex-1 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-muted/30 text-sm">
            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://zillow.com"
              className="border-0 bg-transparent p-0 h-auto text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Button type="submit" size="sm" disabled={sessionLoading || actionLoading}>
            {sessionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Go"}
          </Button>
        </form>

        {session && (
          <Button
            size="sm"
            variant={session.isListingPage ? "default" : "outline"}
            disabled={analysisLoading}
            onClick={handleAnalyze}
            className={cn(
              "gap-1.5 shrink-0",
              session.isListingPage && "bg-emerald-600 hover:bg-emerald-500 text-white border-0"
            )}
          >
            {analysisLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <TrendingUp className="h-3.5 w-3.5" />
            }
            {analysisLoading ? "Analyzing…" : "Analyze this property"}
          </Button>
        )}
      </header>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 3.5rem)" }}>
        <div className="flex-1 overflow-hidden relative bg-zinc-950 flex flex-col">
          {!session && !sessionLoading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Globe className="h-10 w-10 opacity-20" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Research browser</p>
                <p className="text-xs opacity-60">Type a URL above and click Go to start browsing</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {["zillow.com", "redfin.com", "realtor.com"].map((site) => (
                  <button
                    key={site}
                    onClick={() => { setUrlInput(`https://${site}`); startSession(`https://${site}`) }}
                    className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted/50 transition-colors"
                  >
                    {site}
                  </button>
                ))}
              </div>
            </div>
          )}

          {sessionLoading && (
            <div className="flex-1 flex items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Launching browser…</span>
            </div>
          )}

          {session && (
            <>
              <div className="flex-1 overflow-hidden relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={`data:image/jpeg;base64,${session.screenshot}`}
                  alt="Browser viewport"
                  onClick={handleScreenshotClick}
                  className={cn(
                    "w-full h-full object-cover object-top",
                    actionLoading ? "opacity-60 cursor-wait" : "cursor-crosshair"
                  )}
                  draggable={false}
                />
                {actionLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-background/80 backdrop-blur-sm rounded-full p-3">
                      <Loader2 className="h-5 w-5 animate-spin text-foreground" />
                    </div>
                  </div>
                )}
                {session.isListingPage && !analysisResult && (
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-xs font-medium shadow-lg">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Listing detected — click &quot;Analyze this property&quot;
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center gap-2 p-2 border-t border-border/50 bg-background/50 shrink-0">
                <button
                  onClick={() => act({ type: "scroll", direction: "up" })}
                  disabled={actionLoading}
                  className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
                  {hostnameOf(session.url)}
                </span>
                <button
                  onClick={() => act({ type: "scroll", direction: "down" })}
                  disabled={actionLoading}
                  className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>

        {(analysisResult || analysisLoading) && (
          <div className="w-80 shrink-0 flex flex-col overflow-hidden">
            {analysisLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground border-l border-border">
                <Loader2 className="h-6 w-6 animate-spin" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">Analyzing…</p>
                  <p className="text-xs opacity-60">Reading property data</p>
                </div>
              </div>
            ) : analysisResult ? (
              <AnalysisPanel
                result={analysisResult}
                onClose={() => setAnalysisResult(null)}
                onViewFull={handleViewFull}
              />
            ) : null}
          </div>
        )}
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// Root export — picks the right implementation at runtime
// ---------------------------------------------------------------------------

export default function ResearchPage() {
  const [isElectron, setIsElectron] = useState<boolean | null>(null)

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && !!window.electronAPI)
  }, [])

  // Avoid hydration mismatch by deferring until after mount
  if (isElectron === null) return null

  return isElectron ? <ElectronResearchPage /> : <WebResearchPage />
}
