"use client"

import {
  useState, useCallback, useEffect, useLayoutEffect, useRef,
} from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, X,
  ExternalLink, AlertTriangle, CheckCircle2, TrendingUp,
  ChevronLeft, ChevronDown, BarChart3, DollarSign, Home,
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
// WalkAwayBlock — unified decision gauge + price + math in one block
// ---------------------------------------------------------------------------

function WalkAwayBlock({
  listPrice,
  walkAway,
  flipWalkAway,
  arvEstimate,
  rehabCostEstimate,
}: {
  listPrice: number | null
  walkAway: number | null
  flipWalkAway: number | null
  arvEstimate: number | null
  rehabCostEstimate: number | null
}) {
  const ceiling = flipWalkAway ?? walkAway
  if (!ceiling) return null

  type GaugeStatus = "green" | "yellow" | "red"
  let status: GaugeStatus = "green"
  let headline = "Walk-Away Ceiling"
  let verdict = ""

  if (listPrice) {
    const diff = ceiling - listPrice
    const pct = (diff / listPrice) * 100
    if (diff >= 0) {
      status = "green"
      verdict = `GO · ${formatCurrency(diff, 0)} under ceiling (${Math.abs(pct).toFixed(1)}%)`
    } else if (pct > -5) {
      status = "yellow"
      headline = "Negotiate"
      verdict = `${Math.abs(pct).toFixed(1)}% over ceiling · room to negotiate`
    } else {
      status = "red"
      headline = "Walk Away"
      verdict = `Asking is ${formatCurrency(-diff, 0)} over your ceiling`
    }
  }

  const palette: Record<GaugeStatus, { bg: string; border: string; text: string; sub: string }> = {
    green:  { bg: "rgba(34,197,94,0.10)",  border: "rgba(34,197,94,0.4)",  text: "#4ade80", sub: "#86efac" },
    yellow: { bg: "rgba(234,179,8,0.10)",  border: "rgba(234,179,8,0.4)",  text: "#facc15", sub: "#fde68a" },
    red:    { bg: "rgba(239,68,68,0.10)",  border: "rgba(239,68,68,0.4)",  text: "#f87171", sub: "#fca5a5" },
  }
  const c = listPrice ? palette[status] : { bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.25)", text: "#a5b4fc", sub: "#c7d2fe" }

  return (
    <div
      className="rounded-xl px-4 py-3 space-y-2.5"
      style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: c.text }}>
          <ShieldCheck className="inline h-3 w-3 mr-1 -mt-0.5" />
          {headline}
        </p>
        {listPrice && verdict && (
          <span className="text-[10px] font-mono" style={{ color: c.sub }}>{verdict}</span>
        )}
      </div>

      {/* Price — the number they need */}
      <p className="text-2xl font-bold font-mono" style={{ color: c.text }}>
        {formatCurrency(ceiling, 0)}
      </p>

      {/* Math breakdown */}
      {flipWalkAway != null && arvEstimate != null ? (
        <div className="space-y-1 text-[11px] font-mono">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">ARV (after repair)</span>
            <span className="text-foreground">{formatCurrency(arvEstimate, 0)}</span>
          </div>
          {rehabCostEstimate != null && (
            <div className="flex items-center justify-between text-red-400">
              <span>− Estimated rehab</span>
              <span>({formatCurrency(rehabCostEstimate, 0)})</span>
            </div>
          )}
          <div className="flex items-center justify-between text-amber-400">
            <span>− 15% profit margin</span>
            <span>({formatCurrency(arvEstimate * 0.15, 0)})</span>
          </div>
          <div className="border-t border-border/40 pt-1 flex items-center justify-between font-semibold text-foreground">
            <span>= Flip walk-away</span>
            <span>{formatCurrency(flipWalkAway, 0)}</span>
          </div>
        </div>
      ) : walkAway != null && listPrice ? (
        <div className="space-y-1 text-[11px] font-mono">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Asking price</span>
            <span>{formatCurrency(listPrice, 0)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Rental yield ceiling</span>
            <span>{formatCurrency(walkAway, 0)}</span>
          </div>
          <div className={cn(
            "border-t border-border/40 pt-1 flex items-center justify-between font-semibold",
            walkAway >= listPrice ? "text-emerald-400" : "text-red-400"
          )}>
            <span>{walkAway >= listPrice ? "Room to spare" : "Over by"}</span>
            <span>{walkAway >= listPrice ? formatCurrency(walkAway - listPrice, 0) : formatCurrency(listPrice - walkAway, 0)}</span>
          </div>
        </div>
      ) : null}

      {/* Visual bar when list price present */}
      {listPrice && (
        <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: ceiling >= listPrice ? `${Math.min(100, (listPrice / ceiling) * 100)}%` : "100%",
              backgroundColor: c.text,
            }}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RiskSignals — surfaces negative signals the AI found in the listing text
// ---------------------------------------------------------------------------

function RiskSignals({ signals }: { signals: NegativeSignal[] }) {
  const [expanded, setExpanded] = useState(false)
  if (!signals?.length) return null

  const highCount = signals.filter(s => s.severity === "high").length
  const borderColor = highCount > 0 ? "rgba(239,68,68,0.4)" : "rgba(234,179,8,0.3)"
  const bgColor     = highCount > 0 ? "rgba(239,68,68,0.08)" : "rgba(234,179,8,0.08)"
  const labelColor  = highCount > 0 ? "#f87171" : "#facc15"

  return (
    <div
      className="rounded-lg px-4 py-3 space-y-2"
      style={{ backgroundColor: bgColor, borderColor, borderWidth: 1 }}
    >
      <button
        onClick={() => setExpanded(o => !o)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: labelColor }}>
          <AlertTriangle className="h-3 w-3" />
          {signals.length} Risk Signal{signals.length !== 1 ? "s" : ""} — tap to {expanded ? "hide" : "view"}
        </p>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-150", expanded && "rotate-180")}
          style={{ color: labelColor }}
        />
      </button>
      {expanded && (
        <div className="space-y-2 pt-1">
          {signals.map((s, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide",
                  s.severity === "high"   ? "bg-red-500/20 text-red-300"    :
                  s.severity === "medium" ? "bg-amber-500/20 text-amber-300" :
                                            "bg-zinc-500/20 text-zinc-400"
                )}>
                  {s.severity}
                </span>
                <span className="text-xs text-foreground/90 font-medium">{s.signal}</span>
              </div>
              <p className="text-[10px] text-muted-foreground italic pl-10 truncate">
                &quot;{s.excerpt}&quot;
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Electron full-screen results view (replaces browser panel)
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
  const { analysis, walkAway, flipWalkAway } = result
  const tier = analysis.verdict.tier
  const accentColor = TIER_ACCENT[tier]
  const tierLabel = TIER_LABEL[tier]
  const listPrice = result.inputs.purchasePrice ?? null

  const metrics = [
    { icon: DollarSign, label: "Monthly cash flow",  value: formatCurrency(analysis.monthlyCashFlow, 0),   good: analysis.monthlyCashFlow >= 0,   neutral: false },
    { icon: Percent,    label: "Cap rate",            value: formatPercent(analysis.capRate, 1),             good: analysis.capRate >= 0.05,         neutral: false },
    { icon: TrendingUp, label: "Cash-on-cash return", value: formatPercent(analysis.cashOnCashReturn, 1),   good: analysis.cashOnCashReturn >= 0.07, neutral: false },
    { icon: BarChart3,  label: "DSCR",                value: isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞", good: analysis.dscr >= 1.2, neutral: false },
    { icon: Home,       label: "GRM",                 value: analysis.grossRentMultiplier.toFixed(1) + "×", good: false, neutral: true },
    { icon: DollarSign, label: "Total cash invested", value: formatCurrency(analysis.totalCashInvested, 0), good: false, neutral: true },
  ]

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="p-5 space-y-4">

          {/* Address + source — compact header */}
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold leading-snug">
              {result.address ?? "Property Analysis"}
            </h2>
            <p className="text-[10px] text-muted-foreground">
              {result.siteName ?? "listing page"} · {result.modelUsed === "anthropic" ? "Claude" : "GPT-4o-mini"} · {result.confidence} confidence
            </p>
          </div>

          {/* 1 — Decision + walk-away price + math in one block */}
          <WalkAwayBlock
            listPrice={listPrice}
            walkAway={walkAway}
            flipWalkAway={flipWalkAway}
            arvEstimate={result.arvEstimate}
            rehabCostEstimate={result.rehabCostEstimate}
          />

          {/* 2 — Risk signals immediately after the number */}
          {result.negativeSignals.length > 0 && (
            <RiskSignals signals={result.negativeSignals} />
          )}

          {/* 4 — Key metrics grid */}
          <div className="grid grid-cols-2 gap-2">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-lg border border-border bg-card/40 p-3 space-y-1">
                <div className="flex items-center gap-1">
                  <m.icon className="h-3 w-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground">{m.label}</p>
                </div>
                <p className={cn(
                  "text-lg font-bold font-mono",
                  m.neutral ? "text-foreground" : m.good ? "text-emerald-400" : "text-red-400"
                )}>
                  {m.value}
                </p>
              </div>
            ))}
          </div>

          {/* 5 — Verdict summary (supporting context) */}
          <div
            className="rounded-lg px-4 py-3 space-y-1"
            style={{ backgroundColor: `${accentColor}10`, borderColor: `${accentColor}25`, borderWidth: 1 }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: accentColor }}>
              {tierLabel}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {analysis.verdict.summary}
            </p>
          </div>

          {/* 6 — Score breakdown */}
          <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Score breakdown</p>
            <div className="space-y-2">
              {analysis.verdict.breakdown.map((b) => {
                const pct = b.maxPoints > 0 ? b.points / b.maxPoints : 0
                return (
                  <div key={b.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{b.category}</span>
                      <span className={cn(
                        "font-mono font-medium",
                        (b.status === "win" || b.status === "ok") ? "text-emerald-400" : b.status === "warn" ? "text-amber-400" : "text-red-400"
                      )}>
                        {b.points}{"/"}{b.maxPoints}
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
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

          {/* 7 — Actions */}
          <div className="flex gap-2 pb-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onBack}>
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </Button>
            <Button size="sm" className="gap-1.5 flex-1" onClick={onViewFull}>
              <ExternalLink className="h-3.5 w-3.5" />
              Save &amp; view full analysis
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
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
  const f = result.propertyFacts
  if (f?.beds)         p.set("beds",         String(f.beds))
  if (f?.baths)        p.set("baths",        String(f.baths))
  if (f?.sqft)         p.set("sqft",         String(f.sqft))
  if (f?.yearBuilt)    p.set("yearBuilt",    String(f.yearBuilt))
  if (f?.propertyType) p.set("propertyType", f.propertyType)
  return `/results?${p.toString()}`
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

  const handleViewFull = async () => {
    if (!analysisResult) return
    await window.electronAPI?.hideBrowser()
    window.location.href = buildViewFullUrl(analysisResult) + "&fromelec=1"
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
            {analysisLoading ? "Analyzing…" : isListingPage ? "Listing detected — Analyze" : "Analyze"}
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
                  <button onClick={handleViewFull}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0 flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> Full report
                  </button>
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
                <ElectronResultsView result={analysisResult} onBack={() => setAnalysisOpen(false)} onViewFull={handleViewFull} />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground p-6 text-center">
                  <TrendingUp className="h-8 w-8 opacity-20" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No analysis yet</p>
                    <p className="text-xs opacity-60">Browse to a listing and click Analyze</p>
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
// WEB MODE — desktop-only gate
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
          <div className="mx-auto h-16 w-16 rounded-2xl bg-muted/40 border border-border flex items-center justify-center">
            <Globe className="h-8 w-8 text-muted-foreground opacity-60" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">
              Browser research is desktop-only
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The Research tab lets you browse Zillow, Redfin, and Realtor.com directly inside the app and analyze any listing in one click. This feature requires the desktop app.
            </p>
          </div>

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
