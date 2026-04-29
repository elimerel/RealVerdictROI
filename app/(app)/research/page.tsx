"use client"

import {
  useState, useCallback, useEffect, useLayoutEffect, useRef,
} from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, X,
  AlertTriangle, Zap,
} from "lucide-react"
import { SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  analyseDeal,
  findOfferCeiling,
  sanitiseInputs,
  DEFAULT_INPUTS,
  type DealInputs,
  type DealAnalysis,
  type OfferCeiling,
  type VerdictTier,
} from "@/lib/calculations"
import { TIER_ACCENT } from "@/lib/tier-constants"
import { createClient } from "@/lib/supabase/client"
import { supabaseEnv } from "@/lib/supabase/config"
import { annotateFromProvenance, worstConfidence } from "@/lib/annotated-inputs"
import {
  analyseDistribution,
  renderProbabilisticVerdict,
  offerCeilingConfidenceNote,
  type DistributionResult,
  type ProbabilisticVerdict,
} from "@/lib/distribution-engine"
import type { FieldProvenance } from "@/lib/types"
import AnalysisPanel from "../_components/AnalysisPanel"
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
  inputs: DealInputs
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  propertyFacts?: PropertyFacts
  distribution: DistributionResult | null
  probabilisticVerdict: ProbabilisticVerdict | null
  walkAwayConfidenceNote: string | null
  inputProvenance: Partial<Record<keyof DealInputs, FieldProvenance>>
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
  provenance?: Partial<Record<keyof DealInputs, FieldProvenance>>
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
  // Merge extracted inputs with investor defaults.  Extracted values always win.
  const merged: DealInputs = { ...DEFAULT_INPUTS, ...(data.inputs as Partial<DealInputs>) }
  const sanitized = sanitiseInputs(merged)
  const analysis = analyseDeal(sanitized)
  const ceiling = findOfferCeiling(sanitized)

  const inputProvenance = (data.provenance ?? {}) as Partial<Record<keyof DealInputs, FieldProvenance>>

  // Run the probabilistic engine.  Wrapped in try/catch so a bug here never
  // prevents the deterministic verdict from rendering.
  let distribution: DistributionResult | null = null
  let probabilisticVerdict: ProbabilisticVerdict | null = null
  let walkAwayConfidenceNote: string | null = null
  try {
    const annotated = annotateFromProvenance(sanitized, inputProvenance)
    distribution = analyseDistribution(annotated)
    probabilisticVerdict = renderProbabilisticVerdict(distribution, worstConfidence(annotated))
    const rentProv = inputProvenance.monthlyRent
    if (rentProv) {
      walkAwayConfidenceNote = offerCeilingConfidenceNote(rentProv.confidence, rentProv.source)
    }
  } catch {
    // Distribution is additive — deterministic verdict still renders.
  }

  return {
    address: data.address,
    inputs: sanitized,
    analysis,
    walkAway: ceiling,
    propertyFacts: data.facts ? {
      beds: data.facts.bedrooms ?? null,
      baths: data.facts.bathrooms ?? null,
      sqft: data.facts.squareFeet ?? null,
      yearBuilt: data.facts.yearBuilt ?? null,
      propertyType: data.facts.propertyType ?? null,
    } : undefined,
    distribution,
    probabilisticVerdict,
    walkAwayConfidenceNote,
    inputProvenance,
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
const RIGHT_PANEL_W = 400

function calcBounds(sidebarOpen: boolean) {
  const x = sidebarOpen ? SIDEBAR_OPEN_W : SIDEBAR_ICON_W
  const y = TITLEBAR_H + HEADER_H
  const width = Math.max(0, window.innerWidth - x - RIGHT_PANEL_W)
  const height = Math.max(0, window.innerHeight - y)
  return { x, y, width, height }
}

// ---------------------------------------------------------------------------
// Tier pill — shown in the toolbar next to the URL bar
// ---------------------------------------------------------------------------

const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "Strong Buy",
  good: "Good Deal",
  fair: "Borderline",
  poor: "Risky",
  avoid: "Walk Away",
}

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

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-700 text-xs text-zinc-400 shrink-0">
      <Zap className="h-3 w-3" />
      Listing
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
// ELECTRON MODE — WebContentsView via IPC
// ---------------------------------------------------------------------------

function useElectronBounds(active: boolean, sidebarOpen: boolean) {
  const sendBounds = useCallback(() => {
    if (!window.electronAPI) return
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

  // Save state for the AnalysisPanel save button
  const [isSaving, setIsSaving] = useState(false)
  const [savedDealId, setSavedDealId] = useState<string | undefined>(undefined)

  // Tracks last auto-analyzed URL to avoid double-firing
  const lastAutoAnalyzedUrl = useRef("")
  const analysisEpochRef = useRef(0)

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
      if (url !== undefined && isListing && url !== lastAutoAnalyzedUrl.current) {
        setAnalysisResult(null)
      }

      if (url !== undefined) { setCurrentUrl(url); setUrlInput(url) }
      if (title !== undefined) { void title }
      if (isListing !== undefined) {
        setIsListingPage(isListing)
        if (!isListing) {
          lastAutoAnalyzedUrl.current = ""
          setAnalysisResult(null)
        }
      }
      if (loading !== undefined) setBrowserLoading(loading)
    })
    return unsub
  }, [])

  // Auto-analyze when a listing page is fully loaded.
  useEffect(() => {
    if (!isListingPage || !browserActive || !currentUrl) return
    if (browserLoading) return
    if (currentUrl === lastAutoAnalyzedUrl.current) return
    lastAutoAnalyzedUrl.current = currentUrl

    setAnalysisResult(null)
    setSavedDealId(undefined)
    setAnalysisLoading(true)
    setError(null)

    const epoch = ++analysisEpochRef.current
    window.electronAPI!.analyze()
      .then((result) => {
        if (epoch !== analysisEpochRef.current) return
        const r = result as ExtractPayload
        if (r.error) { setError(r.error); return }
        const built = buildAnalysisResult({ ...r, inputs: r.inputs as Partial<DealInputs> })
        setAnalysisResult(built)
      })
      .catch((err: unknown) => {
        if (epoch !== analysisEpochRef.current) return
        setError(err instanceof Error ? err.message : "Analysis failed.")
      })
      .finally(() => {
        if (epoch === analysisEpochRef.current) setAnalysisLoading(false)
      })
  }, [isListingPage, currentUrl, browserActive, browserLoading])

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

  const handleSave = useCallback(async () => {
    if (!signedIn) {
      window.open(`/login?redirect=${encodeURIComponent("/research")}`, "_blank")
      return
    }
    if (!isPro) {
      window.open("/pricing", "_blank")
      return
    }
    if (!analysisResult || isSaving || savedDealId) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: analysisResult.inputs,
          address: analysisResult.address,
          propertyFacts: analysisResult.propertyFacts,
        }),
      })
      const payload = await res.json()
      if (res.ok && payload?.id) {
        setSavedDealId(payload.id as string)
      }
    } finally {
      setIsSaving(false)
    }
  }, [signedIn, isPro, analysisResult, isSaving, savedDealId])

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
            <AnalysisPanel
              analysis={analysisResult!.analysis}
              walkAway={analysisResult!.walkAway}
              inputs={analysisResult!.inputs}
              address={analysisResult!.address}
              propertyFacts={analysisResult!.propertyFacts}
              distribution={analysisResult!.distribution}
              probabilisticVerdict={analysisResult!.probabilisticVerdict}
              walkAwayConfidenceNote={analysisResult!.walkAwayConfidenceNote}
              inputProvenance={analysisResult!.inputProvenance}
              signedIn={signedIn}
              isPro={isPro}
              supabaseConfigured={supabaseConfigured}
              panelWidth={RIGHT_PANEL_W}
              onSave={supabaseConfigured ? handleSave : undefined}
              isSaving={isSaving}
              savedDealId={savedDealId}
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsElectron(!!window.electronAPI)
  }, [])

  if (isElectron === null) return null
  return isElectron ? <ElectronResearchPage /> : <WebResearchPage />
}
