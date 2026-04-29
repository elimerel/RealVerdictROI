"use client"

import {
  useState, useCallback, useEffect, useLayoutEffect, useRef,
} from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, X,
  AlertTriangle, Save, CheckCircle2, Zap,
} from "lucide-react"
import { SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  analyseDeal,
  findOfferCeiling,
  sanitiseInputs,
  formatCurrency,
  formatPercent,
  DEFAULT_INPUTS,
  type DealInputs,
  type DealAnalysis,
  type VerdictTier,
} from "@/lib/calculations"
import { TIER_ACCENT } from "@/lib/tier-constants"
import { createClient } from "@/lib/supabase/client"
import { supabaseEnv } from "@/lib/supabase/config"
import StressTestPanel from "../_components/StressTestPanel"
import BreakdownSection from "../_components/results/BreakdownSection"
import "@/lib/electron"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  propertyFacts?: PropertyFacts
}

type ExtractPayload = {
  address?: string
  inputs: Partial<DealInputs>
  siteName?: string | null
  confidence?: string
  error?: string
  facts?: {
    bedrooms?: number
    bathrooms?: number
    squareFeet?: number
    yearBuilt?: number
    propertyType?: string
  }
}

// ---------------------------------------------------------------------------
// Deterministic summary sentence
// This function is Research-specific. It never calls an AI — output is
// derived purely from the engine numbers. Max 20 words, specific numbers,
// no generic language.
// ---------------------------------------------------------------------------

export function generateVerdictSummary(
  tier: VerdictTier,
  analysis: DealAnalysis,
  walkAway: number | null,
  askingPrice: number,
): string {
  const cf = Math.round(analysis.monthlyCashFlow)
  const coc = formatPercent(analysis.cashOnCashReturn, 1)
  const cap = formatPercent(analysis.capRate, 1)
  const dscr = analysis.dscr.toFixed(2)
  const grm = analysis.grossRentMultiplier.toFixed(1)

  if (tier === "avoid") {
    if (walkAway != null && walkAway < askingPrice) {
      return `At ${formatCurrency(askingPrice)} this bleeds ${formatCurrency(cf)}/mo — the numbers require ${formatCurrency(walkAway)} to work.`
    }
    return `At ${formatCurrency(askingPrice)} this loses ${formatCurrency(Math.abs(cf))}/mo with a DSCR of ${dscr} — walk away.`
  }

  if (tier === "poor") {
    if (cf < 0) {
      return `At ${formatCurrency(askingPrice)} this bleeds ${formatCurrency(Math.abs(cf))}/mo — the numbers require ${formatCurrency(walkAway ?? askingPrice)} to break even.`
    }
    // Positive CF but Risky — verdict driven by DSCR and cap rate, not cash flow alone.
    if (!isFinite(analysis.dscr)) {
      return `Cap rate ${cap} is below threshold — verify loan terms, then offer ${formatCurrency(walkAway ?? askingPrice)} to reach Borderline.`
    }
    return `DSCR ${dscr}x at ${formatCurrency(askingPrice)} — serviceable but too thin. Offer ${formatCurrency(walkAway ?? askingPrice)} to reach Borderline.`
  }

  if (tier === "fair") {
    const risk = analysis.breakEvenOccupancy >= 0.9
      ? `${formatPercent(analysis.breakEvenOccupancy, 0)} break-even occupancy at ${formatCurrency(askingPrice)} — one vacancy wipes the margin.`
      : `${coc} cash-on-cash at ${formatCurrency(askingPrice)} — workable if rent holds, thin if it doesn't.`
    return risk
  }

  if (tier === "good") {
    return `${coc} cash-on-cash with ${formatCurrency(cf)}/mo at ${formatCurrency(askingPrice)} — solid fundamentals, cap rate ${cap}.`
  }

  // excellent
  return `${coc} CoC with DSCR ${dscr}x at ${formatCurrency(askingPrice)} — ${formatCurrency(cf)}/mo and a ${cap} cap rate.`
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

function buildAnalysisResult(data: ExtractPayload): AnalysisResult {
  // Merge with DEFAULT_INPUTS so that fields not extracted from the listing
  // (down payment %, loan rate, loan term, etc.) use sensible investor
  // defaults rather than clamping to zero.  Extracted values always win.
  const merged: DealInputs = { ...DEFAULT_INPUTS, ...(data.inputs as Partial<DealInputs>) }
  const sanitized = sanitiseInputs(merged)
  const analysis = analyseDeal(sanitized)
  const ceiling = findOfferCeiling(sanitized)

  // Walk-away price: prefer the primary negotiation target (best tier within
  // 15% of asking), then fall back to the fair-tier ceiling (the price at
  // which the deal becomes at least "Borderline"), then the best achievable
  // tier at any price.  Always show a walk-away number — it is the product.
  const walkAway =
    ceiling.primaryTarget?.price
    ?? ceiling.fair
    ?? ceiling.recommendedCeiling?.price
    ?? null

  return {
    address: data.address,
    inputs: merged,
    analysis,
    walkAway,
    propertyFacts: data.facts ? {
      beds: data.facts.bedrooms ?? null,
      baths: data.facts.bathrooms ?? null,
      sqft: data.facts.squareFeet ?? null,
      yearBuilt: data.facts.yearBuilt ?? null,
      propertyType: data.facts.propertyType ?? null,
    } : undefined,
  }
}

function rowIsPro(row: { status: string; current_period_end: string | null } | null): boolean {
  if (!row) return false
  const ok = row.status === "active" || row.status === "trialing"
  if (!ok) return false
  if (!row.current_period_end) return true
  const end = Date.parse(row.current_period_end)
  return Number.isFinite(end) && end > Date.now()
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const TITLEBAR_H = 28
const HEADER_H = 56
const SIDEBAR_OPEN_W = 256
const SIDEBAR_ICON_W = 48
// Right panel is always present — fixed width
const RIGHT_PANEL_W = 400

function calcBounds(sidebarOpen: boolean) {
  const x = sidebarOpen ? SIDEBAR_OPEN_W : SIDEBAR_ICON_W
  const y = TITLEBAR_H + HEADER_H
  const width = Math.max(0, window.innerWidth - x - RIGHT_PANEL_W)
  const height = Math.max(0, window.innerHeight - y)
  return { x, y, width, height }
}

// ---------------------------------------------------------------------------
// Tier badge
// ---------------------------------------------------------------------------

const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "Strong Buy",
  good: "Good Deal",
  fair: "Borderline",
  poor: "Risky",
  avoid: "Walk Away",
}

function TierBadge({ tier }: { tier: VerdictTier }) {
  const accent = TIER_ACCENT[tier]
  return (
    <span
      className="inline-flex items-center px-3 py-1 rounded-md text-xs font-bold uppercase tracking-widest"
      style={{ backgroundColor: `${accent}18`, color: accent, border: `1px solid ${accent}55` }}
    >
      {TIER_LABEL[tier]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Toolbar pill — shows analysis state and verdict tier color
// ---------------------------------------------------------------------------

function ListingPill({
  loading,
  tier,
}: {
  loading: boolean
  tier: VerdictTier | null
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-700 text-xs text-zinc-400 shrink-0">
        <Loader2 className="h-3 w-3 animate-spin" />
        Analyzing…
      </div>
    )
  }

  if (tier != null) {
    const accent = TIER_ACCENT[tier]
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold shrink-0"
        style={{ backgroundColor: `${accent}14`, color: accent, border: `1px solid ${accent}44` }}
      >
        <Zap className="h-3 w-3" />
        {TIER_LABEL[tier]}
      </div>
    )
  }

  // Listing detected, analysis not yet ready
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-700 text-xs text-zinc-400 shrink-0">
      <Zap className="h-3 w-3" />
      Listing
    </div>
  )
}

// ---------------------------------------------------------------------------
// Metric tile
// ---------------------------------------------------------------------------

function MetricTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium">{label}</span>
      <span className="text-sm font-semibold tabular-nums" style={accent ? { color: accent } : { color: "#e4e4e7" }}>
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Idle right panel state
// ---------------------------------------------------------------------------

function IdlePanel({ onLaunch }: { onLaunch: (url: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center select-none">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-zinc-300">Navigate to any listing</p>
        <p className="text-xs text-zinc-600">to get your verdict</p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-[200px]">
        {["zillow.com", "redfin.com", "realtor.com"].map((site) => (
          <button
            key={site}
            onClick={() => onLaunch(`https://${site}`)}
            className="px-4 py-2 rounded-md border border-zinc-800 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-300 hover:bg-zinc-900/60 transition-colors"
          >
            {site}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Active right panel state
// ---------------------------------------------------------------------------

type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string }

function ActivePanel({
  result,
  signedIn,
  isPro,
  supabaseConfigured,
}: {
  result: AnalysisResult
  signedIn: boolean
  isPro: boolean
  supabaseConfigured: boolean
}) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" })
  const { analysis, walkAway, address, inputs, propertyFacts } = result
  const tier = analysis.verdict.tier
  const accent = TIER_ACCENT[tier]
  const askingPrice = (inputs as DealInputs).purchasePrice ?? 0
  const gap = walkAway != null ? askingPrice - walkAway : null
  const ltvPct = 100 - ((inputs as DealInputs).downPaymentPercent ?? 20)

  const summary = generateVerdictSummary(tier, analysis, walkAway, askingPrice)

  const handleSave = async () => {
    if (!signedIn) {
      window.open(`/login?redirect=${encodeURIComponent("/research")}`, "_blank")
      return
    }
    if (!isPro) {
      window.open("/pricing", "_blank")
      return
    }
    setSaveStatus({ state: "saving" })
    try {
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, address, propertyFacts }),
      })
      const payload = await res.json()
      if (!res.ok) {
        setSaveStatus({ state: "error", message: payload?.error ?? `Save failed (HTTP ${res.status})` })
        return
      }
      setSaveStatus({ state: "saved" })
    } catch (err) {
      setSaveStatus({ state: "error", message: err instanceof Error ? err.message : "Save failed." })
    }
  }

  return (
    <div className="flex flex-col min-h-0 overflow-y-auto">
      {/* Hero: verdict + walk-away price */}
      <div className="px-5 pt-5 pb-4 border-b border-zinc-800/60 shrink-0">

        {/* Verdict badge — leads the panel */}
        <div className="mb-3">
          <TierBadge tier={tier} />
        </div>

        {/* Walk-away price — always the headline number, always white.
            The badge above carries the verdict signal; this number is the answer. */}
        <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-0.5">
          Walk-Away Price
        </p>
        <p className="text-[2.8rem] font-black leading-none tabular-nums text-zinc-50">
          {formatCurrency(walkAway ?? askingPrice)}
        </p>

        {/* Asking price + gap below the walk-away */}
        {askingPrice > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-xs text-zinc-500">Asking {formatCurrency(askingPrice)}</span>
            {gap != null && gap > 0 && (
              <span className="text-xs font-semibold" style={{ color: accent }}>
                −{formatCurrency(gap)}
              </span>
            )}
            {gap != null && gap <= 0 && (
              <span className="text-xs font-semibold text-emerald-400">
                At or below walk-away
              </span>
            )}
          </div>
        )}

        {/* Summary sentence — explains the specific numbers driving the verdict */}
        <p className="mt-3 text-[11px] text-zinc-400 leading-snug">{summary}</p>
      </div>

      {/* Primary metrics grid */}
      <div className="px-4 pt-3 pb-1 shrink-0">
        <div className="grid grid-cols-2 gap-1.5">
          <MetricTile
            label="Cash Flow / mo"
            value={formatCurrency(analysis.monthlyCashFlow)}
            accent={analysis.monthlyCashFlow >= 0 ? undefined : "#ef4444"}
          />
          <MetricTile
            label="Cap Rate"
            value={formatPercent(analysis.capRate)}
            accent={analysis.capRate >= 0.06 ? "#22c55e" : analysis.capRate >= 0.04 ? "#eab308" : "#ef4444"}
          />
          <MetricTile
            label="DSCR"
            value={isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞"}
            accent={!isFinite(analysis.dscr) || analysis.dscr >= 1.25 ? "#22c55e" : analysis.dscr >= 1 ? "#eab308" : "#ef4444"}
          />
          <MetricTile
            label="Cash-on-Cash"
            value={formatPercent(analysis.cashOnCashReturn)}
            accent={analysis.cashOnCashReturn >= 0.08 ? "#22c55e" : analysis.cashOnCashReturn >= 0.04 ? "#eab308" : analysis.cashOnCashReturn < 0 ? "#ef4444" : undefined}
          />
        </div>
      </div>

      {/* Secondary metrics row */}
      <div className="px-4 pb-3 shrink-0">
        <div className="grid grid-cols-4 gap-1.5">
          <MetricTile
            label="GRM"
            value={`${analysis.grossRentMultiplier.toFixed(1)}×`}
            accent={analysis.grossRentMultiplier <= 12 ? "#22c55e" : analysis.grossRentMultiplier <= 18 ? "#eab308" : "#ef4444"}
          />
          <MetricTile
            label="Break-Even"
            value={formatPercent(analysis.breakEvenOccupancy, 0)}
            accent={analysis.breakEvenOccupancy <= 0.75 ? "#22c55e" : analysis.breakEvenOccupancy <= 0.9 ? "#eab308" : "#ef4444"}
          />
          <MetricTile
            label="IRR"
            value={isFinite(analysis.irr) && analysis.irr > 0 ? formatPercent(analysis.irr) : "—"}
            accent={isFinite(analysis.irr) && analysis.irr >= 0.12 ? "#22c55e" : isFinite(analysis.irr) && analysis.irr >= 0.08 ? "#eab308" : undefined}
          />
          <MetricTile
            label="LTV"
            value={`${ltvPct}%`}
          />
        </div>
      </div>

      {/* Save button */}
      {supabaseConfigured && (
        <div className="px-4 pb-3 shrink-0">
          {saveStatus.state === "saved" ? (
            <div className="flex items-center gap-2 h-10 px-4 rounded-lg border border-emerald-700/50 bg-emerald-950/40 text-xs font-semibold text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Saved to Pipeline
            </div>
          ) : (
            <button
              onClick={handleSave}
              disabled={saveStatus.state === "saving"}
              className="flex items-center justify-center gap-2 h-10 w-full rounded-lg bg-zinc-100 text-xs font-bold text-zinc-900 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saveStatus.state === "saving"
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
                : <><Save className="h-3.5 w-3.5" />{!signedIn ? "Sign in to save" : !isPro ? "Save (Pro)" : "Save deal"}</>
              }
            </button>
          )}
          {saveStatus.state === "error" && (
            <p className="mt-1.5 text-[11px] text-red-400">{saveStatus.message}</p>
          )}
        </div>
      )}

      {/* Scrollable detail area: stress test + monthly breakdown */}
      <div className="border-t border-zinc-800/60 shrink-0">
        <div className="px-4 py-3 space-y-6">
          <StressTestPanel
            baseInputs={sanitiseInputs(inputs as DealInputs)}
            baseAnalysis={analysis}
          />
          <BreakdownSection analysis={analysis} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ELECTRON MODE — WebContentsView via IPC
// ---------------------------------------------------------------------------

function useElectronBounds(active: boolean, sidebarOpen: boolean) {
  const sendBounds = useCallback(() => {
    if (!window.electronAPI) return
    // Right panel is always present — always subtract its width from browser bounds
    window.electronAPI.updateBounds(calcBounds(sidebarOpen))
  }, [sidebarOpen])

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
}

function ElectronResearchPage() {
  const { open: sidebarOpen } = useSidebar()

  // Browser state
  const [browserActive, setBrowserActive] = useState(false)
  const [currentUrl, setCurrentUrl] = useState("")
  const [isListingPage, setIsListingPage] = useState(false)
  const [browserLoading, setBrowserLoading] = useState(false)
  const [urlInput, setUrlInput] = useState("https://zillow.com")

  // Analysis state
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Auth state
  const [signedIn, setSignedIn] = useState(false)
  const [isPro, setIsPro] = useState(false)
  const supabaseConfigured = supabaseEnv().configured

  // Tracks last auto-analyzed URL to avoid double-firing
  const lastAutoAnalyzedUrl = useRef("")

  useElectronBounds(browserActive, sidebarOpen)

  // Fetch auth state once on mount
  useEffect(() => {
    if (!supabaseConfigured) return
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setSignedIn(true)
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", user.id)
        .maybeSingle()
      setIsPro(rowIsPro(sub as { status: string; current_period_end: string | null } | null))
    })
  }, [supabaseConfigured])

  // Show the WebContentsView on mount
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    api.showBrowser(calcBounds(sidebarOpen)).then((state) => {
      if (state?.exists && state.url) {
        setBrowserActive(true)
        setCurrentUrl(state.url)
        setUrlInput(state.url)
        setIsListingPage(state.isListing ?? false)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hide browser on unmount
  useEffect(() => {
    return () => { window.electronAPI?.hideBrowser() }
  }, [])

  // Listen for navigation updates from Electron
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    const unsub = api.onNavUpdate(({ url, title, isListing, loading }) => {
      if (url !== undefined) { setCurrentUrl(url); setUrlInput(url) }
      if (title !== undefined) { /* title tracked but not displayed in new layout */ void title }
      if (isListing !== undefined) {
        setIsListingPage(isListing)
        if (!isListing) {
          // Leaving a listing page — clear both the dedup guard and any
          // previous result so the next listing always starts completely fresh.
          lastAutoAnalyzedUrl.current = ""
          setAnalysisResult(null)
        }
      }
      if (loading !== undefined) setBrowserLoading(loading)
    })
    return unsub
  }, [])

  // Auto-analyze on listing detection.
  // Clears the previous result immediately so a stale verdict never lingers
  // while the new extraction is running.
  useEffect(() => {
    if (!isListingPage || !browserActive || !currentUrl) return
    if (currentUrl === lastAutoAnalyzedUrl.current) return
    lastAutoAnalyzedUrl.current = currentUrl

    // Clear the previous listing's result right away — never show stale data.
    setAnalysisResult(null)
    setAnalysisLoading(true)
    setError(null)
    window.electronAPI!.analyze()
      .then((result) => {
        const r = result as ExtractPayload
        if (r.error) { setError(r.error); return }
        const built = buildAnalysisResult({ ...r, inputs: r.inputs as Partial<DealInputs> })
        setAnalysisResult(built)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Analysis failed.")
      })
      .finally(() => setAnalysisLoading(false))
  }, [isListingPage, currentUrl, browserActive])

  // lastAutoAnalyzedUrl is reset inside the onNavUpdate handler whenever
  // isListing transitions to false, so the next listing always triggers a
  // fresh analysis. We intentionally do NOT call setAnalysisResult(null)
  // here — doing so synchronously inside an effect causes cascading renders.
  // The panel display gate (showActive) already suppresses stale results
  // whenever isListingPage is false, producing the correct idle state.

  const launchBrowser = useCallback(async (url: string) => {
    const api = window.electronAPI!
    setBrowserLoading(true)
    setError(null)
    await api.createBrowser(calcBounds(sidebarOpen))
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
      setBrowserLoading(true)
      setError(null)
      await window.electronAPI?.navigate(url)
    }
  }

  // Determine what to show in the right panel
  const showActive = isListingPage && analysisResult != null
  const showLoading = isListingPage && analysisLoading

  return (
    <SidebarInset className="overflow-hidden">
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

        {/* Listing / verdict pill — reflects outcome once analysis is ready */}
        {browserActive && isListingPage && (
          <ListingPill
            loading={analysisLoading}
            tier={analysisResult?.analysis.verdict.tier ?? null}
          />
        )}

        {error && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/30 text-xs text-red-400 shrink-0 max-w-[200px]">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 ml-1"><X className="h-3 w-3" /></button>
          </div>
        )}
      </header>

      {/* Body: permanent split */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: browser pane — WebContentsView layered on top by Electron */}
        <div className="flex-1 overflow-hidden relative bg-zinc-950 flex flex-col min-w-0">
          {!browserActive && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <Globe className="h-10 w-10 opacity-20" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Research browser</p>
                <p className="text-xs opacity-60">Type a URL above and press Go</p>
              </div>
            </div>
          )}

          {browserActive && currentUrl && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 text-[10px] text-muted-foreground font-mono pointer-events-none">
              {hostnameOf(currentUrl)}
            </div>
          )}
        </div>

        {/* Right: verdict panel — always visible, always present */}
        <div
          className="shrink-0 flex flex-col border-l border-zinc-800 bg-zinc-950 overflow-hidden"
          style={{ width: RIGHT_PANEL_W }}
        >
          {showLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-xs">Running analysis…</p>
            </div>
          ) : showActive ? (
            <ActivePanel
              result={analysisResult!}
              signedIn={signedIn}
              isPro={isPro}
              supabaseConfigured={supabaseConfigured}
            />
          ) : (
            <IdlePanel onLaunch={async (url) => {
              setUrlInput(url)
              if (!browserActive) {
                await launchBrowser(url)
              } else {
                setBrowserLoading(true)
                setError(null)
                await window.electronAPI?.navigate(url)
              }
            }} />
          )}
        </div>
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
  const [isElectron, setIsElectron] = useState<boolean | null>(null)

  useLayoutEffect(() => {
    // Reading window.electronAPI (set by Electron's contextBridge before any
    // page script runs) is not a React state change triggered by React — it is
    // a one-time client-environment detection that must run synchronously
    // before the first paint to avoid a flash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsElectron(!!window.electronAPI)
  }, [])

  if (isElectron === null) return null
  return isElectron ? <ElectronResearchPage /> : <WebResearchPage />
}
