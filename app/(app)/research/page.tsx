"use client"

import {
  useState, useCallback, useEffect, useLayoutEffect, useRef,
} from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, X,
  AlertTriangle, TrendingUp, BarChart3, CheckCircle2,
} from "lucide-react"
import { SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  analyseDeal,
  findOfferCeiling,
  sanitiseInputs,
} from "@/lib/calculations"
import type { DealInputs, DealAnalysis } from "@/lib/calculations"
import "@/lib/electron" // global Window type augmentation
import AnalysisPanel from "../_components/AnalysisPanel"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NegativeSignal = {
  signal: string
  excerpt: string
  severity: "high" | "medium" | "low"
}

type PropertyFacts = {
  beds?: number | null
  baths?: number | null
  sqft?: number | null
  yearBuilt?: number | null
  propertyType?: string | null
}

type AnalysisResult = {
  address?: string
  inputs: Partial<DealInputs>
  analysis: DealAnalysis
  walkAway: number | null
  flipWalkAway: number | null
  arvEstimate: number | null
  rehabCostEstimate: number | null
  negativeSignals: NegativeSignal[]
  siteName: string | null
  confidence: string
  modelUsed?: string
  propertyFacts?: PropertyFacts
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
// Build AnalysisResult from extract/browse API response
// ---------------------------------------------------------------------------

type ExtractPayload = {
  address?: string
  inputs: Partial<DealInputs>
  siteName?: string | null
  confidence?: string
  error?: string
  negativeSignals?: NegativeSignal[]
  arvEstimate?: number
  rehabCostEstimate?: number
  modelUsed?: string
  facts?: {
    bedrooms?: number
    bathrooms?: number
    squareFeet?: number
    yearBuilt?: number
    propertyType?: string
  }
}

function buildAnalysisResult(data: ExtractPayload): AnalysisResult {
  const sanitized = sanitiseInputs(data.inputs as DealInputs)
  const analysis = analyseDeal(sanitized)
  const ceiling = findOfferCeiling(sanitized)

  // Flip walk-away = ARV - Rehab - 15% of ARV
  let flipWalkAway: number | null = null
  if (data.arvEstimate) {
    const arv = data.arvEstimate
    const rehab = data.rehabCostEstimate ?? 0
    const margin = arv * 0.15
    flipWalkAway = Math.round((arv - rehab - margin) / 500) * 500
    if (flipWalkAway <= 0) flipWalkAway = null
  }

  return {
    address: data.address,
    inputs: data.inputs,
    analysis,
    walkAway: ceiling.primaryTarget?.price ?? null,
    flipWalkAway,
    arvEstimate: data.arvEstimate ?? null,
    rehabCostEstimate: data.rehabCostEstimate ?? null,
    negativeSignals: data.negativeSignals ?? [],
    siteName: data.siteName ?? null,
    confidence: data.confidence ?? "medium",
    modelUsed: data.modelUsed,
    propertyFacts: data.facts ? {
      beds: data.facts.bedrooms ?? null,
      baths: data.facts.bathrooms ?? null,
      sqft: data.facts.squareFeet ?? null,
      yearBuilt: data.facts.yearBuilt ?? null,
      propertyType: data.facts.propertyType ?? null,
    } : undefined,
  }
}

// ---------------------------------------------------------------------------
// ELECTRON MODE — WebContentsView via IPC
// ---------------------------------------------------------------------------

const TITLEBAR_H = 28
const HEADER_H = 56

const SIDEBAR_OPEN_W = 256
const SIDEBAR_ICON_W = 48

const MIN_PANEL_W = 280
const MAX_PANEL_W = 600
const DEFAULT_PANEL_W = 380

function calcBounds(sidebarOpen: boolean, panelW: number) {
  const x = sidebarOpen ? SIDEBAR_OPEN_W : SIDEBAR_ICON_W
  const y = TITLEBAR_H + HEADER_H
  const width = Math.max(0, window.innerWidth - x - panelW)
  const height = Math.max(0, window.innerHeight - y)
  return { x, y, width, height }
}

function useElectronBounds(
  active: boolean,
  sidebarOpen: boolean,
  analysisOpen: boolean,
  panelWidth: number,
) {
  const sendBounds = useCallback(() => {
    if (!window.electronAPI) return
    window.electronAPI.updateBounds(calcBounds(sidebarOpen, analysisOpen ? panelWidth : 0))
  }, [sidebarOpen, analysisOpen, panelWidth])

  useEffect(() => {
    if (!active) return
    sendBounds()
    window.addEventListener("resize", sendBounds)
    return () => window.removeEventListener("resize", sendBounds)
  }, [active, sendBounds])

  useEffect(() => {
    if (!active) return
    const t = setTimeout(sendBounds, 300)
    return () => clearTimeout(t)
  }, [sidebarOpen, active, sendBounds])

  useEffect(() => {
    if (active) sendBounds()
  }, [analysisOpen, active, sendBounds])
}

function ElectronResearchPage() {
  const { open: sidebarOpen } = useSidebar()

  const [browserActive, setBrowserActive] = useState(false)
  const [currentUrl, setCurrentUrl] = useState("")
  const [currentTitle, setCurrentTitle] = useState("")
  const [isListingPage, setIsListingPage] = useState(false)
  const [browserLoading, setBrowserLoading] = useState(false)
  const [urlInput, setUrlInput] = useState("https://zillow.com")

  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_W)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartW = useRef(0)
  // Tracks the last URL that was auto-analyzed so we don't fire twice per navigation
  const lastAutoAnalyzedUrl = useRef("")

  const handlePanelDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartW.current = panelWidth

    function onMove(ev: MouseEvent) {
      if (!isDragging.current) return
      const delta = dragStartX.current - ev.clientX
      const next = Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, dragStartW.current + delta))
      setPanelWidth(next)
      if (window.electronAPI) {
        window.electronAPI.updateBounds(calcBounds(sidebarOpen, next))
      }
    }
    function onUp() {
      isDragging.current = false
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelWidth, sidebarOpen])

  useElectronBounds(browserActive, sidebarOpen, analysisOpen, panelWidth)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    api.showBrowser(calcBounds(sidebarOpen, 0)).then((state) => {
      if (state?.exists && state.url) {
        setBrowserActive(true)
        setCurrentUrl(state.url)
        setUrlInput(state.url)
        setCurrentTitle(state.title ?? "")
        setIsListingPage(state.isListing ?? false)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => { window.electronAPI?.hideBrowser() }
  }, [])

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

  // Auto-analyze when the browser lands on a recognized listing page.
  // Fires once per distinct URL — quiet on non-listing pages.
  useEffect(() => {
    if (!isListingPage || !browserActive || !currentUrl) return
    if (currentUrl === lastAutoAnalyzedUrl.current) return
    lastAutoAnalyzedUrl.current = currentUrl

    setAnalysisLoading(true)
    setError(null)
    window.electronAPI!.analyze()
      .then((result) => {
        const r = result as ExtractPayload
        if (r.error) { setError(r.error); return }
        const built = buildAnalysisResult({ ...r, inputs: r.inputs as Partial<DealInputs> })
        setAnalysisResult(built)
        setAnalysisOpen(true)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Analysis failed.")
      })
      .finally(() => setAnalysisLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListingPage, currentUrl, browserActive])

  const launchBrowser = useCallback(async (url: string) => {
    const api = window.electronAPI!
    setBrowserLoading(true)
    setError(null)
    await api.createBrowser(calcBounds(sidebarOpen, analysisOpen ? panelWidth : 0))
    await api.navigate(url)
    setBrowserActive(true)
    setCurrentUrl(url)
    setUrlInput(url)
  }, [sidebarOpen, analysisOpen, panelWidth])

  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault()
    const url = normalizeUrl(urlInput)
    if (!url) return
    if (!browserActive) {
      await launchBrowser(url)
    } else {
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
      setAnalysisResult(built)
      setAnalysisOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.")
    } finally {
      setAnalysisLoading(false)
    }
  }

  return (
    <SidebarInset className="overflow-hidden">
      {/* Top bar */}
      <header className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
        <SidebarTrigger className="-ml-1" />

        <div className="flex items-center gap-1">
          <button onClick={() => window.electronAPI?.back()} disabled={!browserActive || browserLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button onClick={() => window.electronAPI?.forward()} disabled={!browserActive || browserLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground">
            <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={() => window.electronAPI?.reload()} disabled={!browserActive}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-40 text-muted-foreground">
            <RotateCw className={cn("h-3.5 w-3.5", browserLoading && "animate-spin")} />
          </button>
        </div>

        <form onSubmit={handleNavigate} className="flex-1 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-muted/30 text-sm">
            <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://zillow.com"
              className="border-0 bg-transparent p-0 h-auto text-sm focus-visible:ring-0 focus-visible:ring-offset-0" />
          </div>
          <Button type="submit" size="sm" disabled={browserLoading}>
            {browserLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Go"}
          </Button>
        </form>

        {browserActive && (
          <Button size="sm" variant={isListingPage ? "default" : "outline"}
            disabled={analysisLoading} onClick={handleAnalyze}
            className={cn("gap-1.5 shrink-0", isListingPage && "bg-emerald-600 hover:bg-emerald-500 text-white border-0")}>
            {analysisLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
            {analysisLoading
              ? "Analyzing…"
              : isListingPage
                ? <><CheckCircle2 className="h-3.5 w-3.5" />Listing detected</>
                : "Analyze"}
          </Button>
        )}

        <button onClick={() => setAnalysisOpen(o => !o)}
          className={cn("h-7 w-7 rounded flex items-center justify-center transition-colors shrink-0",
            analysisOpen ? "bg-emerald-500/20 text-emerald-400" : "hover:bg-muted/60 text-muted-foreground")}>
          <BarChart3 className="h-4 w-4" />
        </button>

        {error && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/30 text-xs text-red-400 shrink-0 max-w-[200px]">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 ml-1"><X className="h-3 w-3" /></button>
          </div>
        )}
      </header>

      {/* Body: browser pane (left) + analysis panel (right) */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Browser pane — WebContentsView layered on top by Electron */}
        <div className="flex-1 overflow-hidden relative bg-zinc-950 flex flex-col min-w-0">
          {!browserActive && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Globe className="h-10 w-10 opacity-20" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Research browser</p>
                <p className="text-xs opacity-60">Type a URL above and click Go to start browsing</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {["zillow.com", "redfin.com", "realtor.com"].map((site) => (
                  <button key={site}
                    onClick={() => { setUrlInput(`https://${site}`); void launchBrowser(`https://${site}`) }}
                    className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted/50 transition-colors">
                    {site}
                  </button>
                ))}
              </div>
            </div>
          )}

          {browserActive && currentUrl && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 text-[10px] text-muted-foreground font-mono pointer-events-none">
              {hostnameOf(currentUrl)}{currentTitle ? ` — ${currentTitle.slice(0, 40)}` : ""}
            </div>
          )}
        </div>

        {/* Right analysis panel — always shown when open */}
        {analysisOpen && (
          <div
            className="flex flex-col border-l border-border bg-background overflow-hidden shrink-0 relative"
            style={{ width: panelWidth }}
          >
            {/* Drag-to-resize handle on the left edge */}
            <div
              onMouseDown={handlePanelDragStart}
              className="absolute left-0 top-0 bottom-0 w-1 z-20 cursor-col-resize hover:bg-primary/30 transition-colors"
              title="Drag to resize"
            />
            <div className="h-10 flex items-center gap-2 px-3 border-b border-border shrink-0">
              {analysisResult ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="text-xs font-medium truncate flex-1">
                    {analysisResult.address ?? "Analysis"}
                  </span>
                  {analysisResult.negativeSignals.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium shrink-0">
                      {analysisResult.negativeSignals.length} risk{analysisResult.negativeSignals.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium text-muted-foreground truncate flex-1">Analysis</span>
                </>
              )}
              <button onClick={() => setAnalysisOpen(false)}
                className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted/60 text-muted-foreground shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="relative flex-1 min-h-0">
              {analysisResult ? (
                <AnalysisPanel
                  analysis={analysisResult.analysis}
                  walkAway={findOfferCeiling(sanitiseInputs(analysisResult.inputs as DealInputs))}
                  address={analysisResult.address}
                  inputs={sanitiseInputs(analysisResult.inputs as DealInputs)}
                  signedIn={false}
                  isPro={false}
                  supabaseConfigured={false}
                  panelWidth={panelWidth}
                  propertyFacts={analysisResult.propertyFacts}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground p-6 text-center">
                  <TrendingUp className="h-8 w-8 opacity-20" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No analysis yet</p>
                    <p className="text-xs opacity-60">Browse to a listing — analysis starts automatically</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// WEB MODE — desktop-only notice
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
        <p className="text-sm text-muted-foreground text-center">
          Research is available in the desktop app.{" "}
          <a
            href="https://realverdict.com/download"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground transition-colors"
          >
            Download it at realverdict.com/download
          </a>
        </p>
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------

export default function ResearchPage() {
  // Start null so SSR and initial hydration always render the same thing.
  // useLayoutEffect fires synchronously before the browser paints, so the
  // correct branch is shown on the very first visible frame — no flash.
  const [isElectron, setIsElectron] = useState<boolean | null>(null)

  useLayoutEffect(() => {
    // window.electronAPI is exposed by contextBridge in preload.js before any
    // page scripts run.  It lives in the JS context — React hydration cannot
    // touch it, making this the most reliable Electron detection available.
    setIsElectron(!!window.electronAPI)
  }, [])

  if (isElectron === null) return null
  return isElectron ? <ElectronResearchPage /> : <WebResearchPage />
}
