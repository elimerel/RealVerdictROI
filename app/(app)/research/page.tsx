"use client"

import {
  useState, useCallback, useEffect,
} from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, X,
  ExternalLink, AlertTriangle, CheckCircle2, TrendingUp,
  ChevronLeft, BarChart3, DollarSign, Home,
  Percent, ShieldCheck,
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

type ExtractPayload = {
  address?: string
  inputs: Partial<DealInputs>
  siteName?: string | null
  confidence?: string
  error?: string
}

function buildAnalysisResult(data: ExtractPayload): AnalysisResult {
  const sanitized = sanitiseInputs(data.inputs as DealInputs)
  const analysis = analyseDeal(sanitized)
  const ceiling = findOfferCeiling(sanitized)
  return {
    address: data.address,
    inputs: data.inputs,
    analysis,
    walkAway: ceiling.primaryTarget?.price ?? null,
    siteName: data.siteName ?? null,
    confidence: data.confidence ?? "medium",
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
      const result = await window.electronAPI!.analyze() as ExtractPayload
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
// WEB MODE — desktop-only gate
// The Browserbase screenshot approach is removed. Web users see a clear
// upgrade prompt; the native browser experience requires the desktop app.
// ---------------------------------------------------------------------------

function WebResearchPage() {
  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe className="h-4 w-4" />
          <span>Research</span>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md w-full space-y-6 text-center">
          {/* Icon */}
          <div className="mx-auto h-16 w-16 rounded-2xl bg-muted/40 border border-border flex items-center justify-center">
            <Globe className="h-8 w-8 text-muted-foreground opacity-60" />
          </div>

          {/* Heading */}
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">
              Browser research is desktop-only
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The Research tab lets you browse Zillow, Redfin, and Realtor.com directly inside the app and analyze any listing in one click. This feature requires the desktop app.
            </p>
          </div>

          {/* Feature list */}
          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2.5 text-left">
            {[
              "Browse any listing site natively",
              "One-click analysis from the page",
              "Session persists as you browse",
              "No copy-pasting URLs",
            ].map((f) => (
              <div key={f} className="flex items-center gap-2.5 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="text-muted-foreground">{f}</span>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="flex flex-col gap-2.5">
            <a
              href="/download"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90"
            >
              Download the desktop app — Free
            </a>
            <a
              href="/search"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted/40"
            >
              Analyze by URL or address instead
            </a>
          </div>

          <p className="text-xs text-muted-foreground">
            macOS 12+ · Apple Silicon &amp; Intel · Free download
          </p>
        </div>
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

  if (isElectron === null) return null
  return isElectron ? <ElectronResearchPage /> : <WebResearchPage />
}
