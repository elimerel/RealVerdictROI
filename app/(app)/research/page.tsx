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

type NegativeSignal = {
  signal: string
  excerpt: string
  severity: "high" | "medium" | "low"
}

type AnalysisResult = {
  address?: string
  inputs: Partial<DealInputs>
  analysis: DealAnalysis
  // Rental walk-away: max price where the deal still clears the hurdle rate
  walkAway: number | null
  // Flip walk-away: ARV - rehab - 15% margin (wholesaler formula)
  flipWalkAway: number | null
  arvEstimate: number | null
  rehabCostEstimate: number | null
  negativeSignals: NegativeSignal[]
  siteName: string | null
  confidence: string
  modelUsed?: string
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
// VerdictGauge — the centerpiece: Green/Yellow/Red based on price vs ceiling
// ---------------------------------------------------------------------------

function VerdictGauge({
  listPrice,
  walkAway,
  flipWalkAway,
}: {
  listPrice: number | null
  walkAway: number | null
  flipWalkAway: number | null
}) {
  // Prefer flip walk-away when available (wholesaler/flipper is the target user)
  const ceiling = flipWalkAway ?? walkAway
  if (!ceiling || !listPrice) return null

  const diff = ceiling - listPrice
  const pct = (diff / listPrice) * 100

  type GaugeStatus = "green" | "yellow" | "red"
  let status: GaugeStatus
  let headline: string
  let subtext: string

  if (diff >= 0) {
    status = "green"
    headline = "GO — Price is Under Walk-Away"
    subtext = `${formatCurrency(listPrice, 0)} asking · ${formatCurrency(diff, 0)} under ceiling`
  } else if (pct > -5) {
    status = "yellow"
    headline = "NEGOTIATE — Within 5% of Walk-Away"
    subtext = `${Math.abs(pct).toFixed(1)}% over ceiling · negotiate or walk`
  } else {
    status = "red"
    headline = "WALK AWAY"
    subtext = `Asking is ${formatCurrency(-diff, 0)} over your ceiling`
  }

  const palette: Record<GaugeStatus, { bg: string; border: string; text: string; sub: string }> = {
    green:  { bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.5)",  text: "#4ade80", sub: "#86efac" },
    yellow: { bg: "rgba(234,179,8,0.12)",  border: "rgba(234,179,8,0.5)",  text: "#facc15", sub: "#fde68a" },
    red:    { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.5)",  text: "#f87171", sub: "#fca5a5" },
  }
  const c = palette[status]

  return (
    <div
      className="rounded-xl px-5 py-4 space-y-2"
      style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: c.text }}>
          {status === "green" ? "✓" : status === "yellow" ? "⚡" : "✗"} {headline}
        </p>
        <span
          className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: c.border, color: c.text }}
        >
          {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
        </span>
      </div>
      <p className="text-xs" style={{ color: c.sub }}>{subtext}</p>

      {/* Visual bar */}
      <div className="relative h-2 rounded-full bg-muted/30 overflow-hidden mt-1">
        {diff >= 0 ? (
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, (listPrice / ceiling) * 100)}%`, backgroundColor: c.text }}
          />
        ) : (
          <div
            className="h-full rounded-full w-full transition-all"
            style={{ backgroundColor: c.text }}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TranslucentMath — shows the walk-away calculation so investors trust the number
// ---------------------------------------------------------------------------

function TranslucentMath({
  walkAway,
  flipWalkAway,
  arvEstimate,
  rehabCostEstimate,
  listPrice,
}: {
  walkAway: number | null
  flipWalkAway: number | null
  arvEstimate: number | null
  rehabCostEstimate: number | null
  listPrice: number | null
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <ShieldCheck className="h-3 w-3" /> Walk-Away Math
      </p>

      {flipWalkAway != null && arvEstimate != null ? (
        // Full flip formula with ARV
        <div className="space-y-0.5">
          <p className="text-lg font-bold font-mono">{formatCurrency(flipWalkAway, 0)}</p>
          <div className="space-y-1 text-[11px] font-mono mt-1">
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
            <div className="border-t border-border/50 pt-1 mt-0.5 flex items-center justify-between font-semibold text-foreground">
              <span>= Flip walk-away</span>
              <span>{formatCurrency(flipWalkAway, 0)}</span>
            </div>
          </div>
        </div>
      ) : walkAway != null ? (
        // Rental formula fallback
        <div className="space-y-0.5">
          <p className="text-lg font-bold font-mono">{formatCurrency(walkAway, 0)}</p>
          <div className="space-y-1 text-[11px] font-mono mt-1">
            {listPrice && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Asking price</span>
                <span className="text-foreground">{formatCurrency(listPrice, 0)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-muted-foreground/70">
              <span>Ceiling (rental rubric)</span>
              <span className="text-foreground">{formatCurrency(walkAway, 0)}</span>
            </div>
            {listPrice && (
              <div className={cn(
                "border-t border-border/50 pt-1 mt-0.5 flex items-center justify-between font-semibold",
                walkAway >= listPrice ? "text-emerald-400" : "text-red-400"
              )}>
                <span>{walkAway >= listPrice ? "Deal works at ask" : "Over ceiling by"}</span>
                <span>
                  {walkAway >= listPrice
                    ? formatCurrency(walkAway - listPrice, 0) + " room"
                    : formatCurrency(listPrice - walkAway, 0)}
                </span>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground pt-1">
            No ARV data found — showing rental yield ceiling
          </p>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RiskSignals — surfaces negative signals the AI found in the listing text
// ---------------------------------------------------------------------------

function RiskSignals({ signals }: { signals: NegativeSignal[] }) {
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
      <p className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: labelColor }}>
        <AlertTriangle className="h-3 w-3" />
        {signals.length} Risk Signal{signals.length !== 1 ? "s" : ""} Detected
      </p>
      <div className="space-y-2">
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
    </div>
  )
}

// ---------------------------------------------------------------------------
// Analysis sidebar panel — compact version for Electron right panel
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
  const { analysis, walkAway, flipWalkAway } = result
  const tier = analysis.verdict.tier
  const accentColor = TIER_ACCENT[tier]
  const tierLabel = TIER_LABEL[tier]
  const listPrice = result.inputs.purchasePrice ?? null
  const ceiling = flipWalkAway ?? walkAway

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
        <div className="p-4 space-y-4">
          {/* Verdict Gauge */}
          <VerdictGauge listPrice={listPrice} walkAway={walkAway} flipWalkAway={flipWalkAway} />

          {/* Verdict summary */}
          <div
            className="rounded-lg px-4 py-3 space-y-1"
            style={{ backgroundColor: `${accentColor}15`, borderColor: `${accentColor}30`, borderWidth: 1 }}
          >
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: accentColor }}>Verdict</p>
            <p className="text-lg font-semibold" style={{ color: accentColor }}>{tierLabel}</p>
            <p className="text-xs text-muted-foreground">{analysis.verdict.summary}</p>
          </div>

          {/* Walk-away math */}
          {ceiling != null && (
            <TranslucentMath
              walkAway={walkAway}
              flipWalkAway={flipWalkAway}
              arvEstimate={result.arvEstimate}
              rehabCostEstimate={result.rehabCostEstimate}
              listPrice={listPrice}
            />
          )}

          {/* Risk signals */}
          <RiskSignals signals={result.negativeSignals} />

          {/* Metric grid */}
          <div className="grid grid-cols-2 gap-2">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-md border border-border bg-muted/10 px-3 py-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">{m.label}</p>
                <p className={cn("text-sm font-mono font-medium", m.accent && "text-emerald-400")}>{m.value}</p>
              </div>
            ))}
          </div>

          {/* Score breakdown */}
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
            {result.siteName ?? "listing page"} · {result.modelUsed === "anthropic" ? "Claude" : "GPT-4o-mini"} · {result.confidence} confidence
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
    <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 3.5rem)" }}>
      <ScrollArea className="flex-1">
        <div className="max-w-3xl mx-auto p-8 space-y-6">

          {/* Address + source */}
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">
              {result.address ?? "Property Analysis"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {result.siteName ?? "listing page"} · {result.modelUsed === "anthropic" ? "Claude" : "GPT-4o-mini"} · {result.confidence} confidence
            </p>
          </div>

          {/* Verdict Gauge — top of panel, first thing investor sees */}
          <VerdictGauge listPrice={listPrice} walkAway={walkAway} flipWalkAway={flipWalkAway} />

          {/* Risk signals — surface immediately after gauge */}
          {result.negativeSignals.length > 0 && (
            <RiskSignals signals={result.negativeSignals} />
          )}

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

          {/* Walk-away math — transparent, investor-first */}
          {(walkAway != null || flipWalkAway != null) && (
            <div className="rounded-xl border border-border bg-card/40 p-5">
              <TranslucentMath
                walkAway={walkAway}
                flipWalkAway={flipWalkAway}
                arvEstimate={result.arvEstimate}
                rehabCostEstimate={result.rehabCostEstimate}
                listPrice={listPrice}
              />
            </div>
          )}

          {/* Metric grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

const TITLEBAR_H = 28
const HEADER_H = 56
const ANALYSIS_W = 400  // wider to accommodate the new panels

const SIDEBAR_OPEN_W = 256
const SIDEBAR_ICON_W = 48

function calcBounds(sidebarOpen: boolean, analysisOpen: boolean) {
  const x = sidebarOpen ? SIDEBAR_OPEN_W : SIDEBAR_ICON_W
  const y = TITLEBAR_H + HEADER_H
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

  useElectronBounds(browserActive, sidebarOpen, analysisOpen)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    api.showBrowser(calcBounds(sidebarOpen, analysisOpen)).then((state) => {
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
    await api.createBrowser(calcBounds(sidebarOpen, analysisOpen))
    await api.navigate(url)
    setBrowserActive(true)
    setCurrentUrl(url)
    setUrlInput(url)
  }, [sidebarOpen, analysisOpen])

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

  const handleViewFull = () => {
    if (!analysisResult) return
    window.location.href = buildViewFullUrl(analysisResult)
  }

  return (
    <SidebarInset>
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
            {analysisLoading ? "Analyzing…" : "Analyze"}
          </Button>
        )}

        {analysisResult && (
          <button onClick={() => setAnalysisOpen(o => !o)}
            className={cn("h-7 w-7 rounded flex items-center justify-center transition-colors shrink-0",
              analysisOpen ? "bg-emerald-500/20 text-emerald-400" : "hover:bg-muted/60 text-muted-foreground")}>
            <BarChart3 className="h-4 w-4" />
          </button>
        )}

        {error && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/30 text-xs text-red-400 shrink-0 max-w-[200px]">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 ml-1"><X className="h-3 w-3" /></button>
          </div>
        )}
      </header>

      {/* Body: browser pane (left) + analysis panel (right) */}
      <div className="flex flex-1 overflow-hidden" style={{ height: `calc(100vh - ${TITLEBAR_H + HEADER_H}px)` }}>

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

          {isListingPage && browserActive && (
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-xs font-medium shadow-lg pointer-events-none">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Listing detected — click Analyze
            </div>
          )}

          {browserActive && currentUrl && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 text-[10px] text-muted-foreground font-mono pointer-events-none">
              {hostnameOf(currentUrl)}{currentTitle ? ` — ${currentTitle.slice(0, 40)}` : ""}
            </div>
          )}
        </div>

        {/* Right analysis panel */}
        {analysisOpen && analysisResult && (
          <div
            className="flex flex-col border-l border-border bg-background overflow-hidden shrink-0"
            style={{ width: ANALYSIS_W }}
          >
            <div className="h-10 flex items-center gap-2 px-3 border-b border-border shrink-0">
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
              <button onClick={() => setAnalysisOpen(false)}
                className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted/60 text-muted-foreground shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ElectronResultsView result={analysisResult} onBack={() => setAnalysisOpen(false)} onViewFull={handleViewFull} />
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
  const [isElectron, setIsElectron] = useState<boolean | null>(null)

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && !!window.electronAPI)
  }, [])

  if (isElectron === null) return null
  return isElectron ? <ElectronResearchPage /> : <WebResearchPage />
}
