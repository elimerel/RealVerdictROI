"use client"

import {
  useState, useCallback, useEffect, useLayoutEffect, useRef,
} from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, X,
  AlertTriangle, Zap, Search, MapPin,
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
  formatCurrency,
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
import type { AddressSuggestion } from "@/app/api/address-autocomplete/route"
import { normalizeCacheKey, sessionGet, sessionSet } from "@/lib/client-session-cache"
import DossierPanel from "../_components/DossierPanel"
import ListingCard from "./_components/ListingCard"
import type { ListingCardData } from "./_components/ListingCard"
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
// Shared constants & types (used by both Electron and web modes)
// ---------------------------------------------------------------------------

const LISTING_URL_RE        = /^https?:\/\/(www\.)?(zillow|redfin|realtor|homes|trulia|movoto)\.com\//i
const AUTOFILL_CACHE_NS     = "research:autofill:v1"
const AUTOFILL_CACHE_TTL_MS = 30 * 60 * 1000

type ResolverPayload = {
  address?: string
  inputs: Partial<DealInputs>
  notes: string[]
  warnings: string[]
  facts: Record<string, unknown>
  provenance: Partial<Record<keyof DealInputs, FieldProvenance>>
}

type HuntResult = {
  listingData: ListingCardData
  inputs: DealInputs
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  distribution: DistributionResult | null
  probabilisticVerdict: ProbabilisticVerdict | null
  walkAwayConfidenceNote: string | null
  inputProvenance: Partial<Record<keyof DealInputs, FieldProvenance>>
}

// ---------------------------------------------------------------------------
// ELECTRON MODE — WebContentsView via IPC
//
// View modes:
//   "native" (default) — RealVerdict ListingCard + DossierPanel. Uses the
//     API resolver (property-resolve) for URL/address input. The WebContents
//     View is not created. This is the superior experience.
//   "browser" — WebContentsView showing the live Zillow/Redfin page with
//     auto-analyze on listing page load. Opt-in for users who want it.
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

  // "native" is the default — the RealVerdict experience
  const [viewMode, setViewMode] = useState<"native" | "browser">("native")

  // ----- Native mode state (API-based resolver) -----
  const [nativeQuery, setNativeQuery]   = useState("")
  const [nativeLoading, setNativeLoading] = useState(false)
  const [nativeResult, setNativeResult] = useState<HuntResult | null>(null)

  // ----- Browser mode state (WebContentsView) -----
  const [browserActive, setBrowserActive]     = useState(false)
  const [currentUrl, setCurrentUrl]           = useState("")
  const [isListingPage, setIsListingPage]     = useState(false)
  const [browserLoading, setBrowserLoading]   = useState(false)
  const [urlInput, setUrlInput]               = useState("https://zillow.com")
  const [browserAnalysisResult, setBrowserAnalysisResult] = useState<AnalysisResult | null>(null)
  const [browserAnalysisLoading, setBrowserAnalysisLoading] = useState(false)
  const lastAutoAnalyzedUrl = useRef("")
  const analysisEpochRef    = useRef(0)

  // ----- Shared -----
  const [error, setError]           = useState<string | null>(null)
  const [isSaving, setIsSaving]     = useState(false)
  const [savedDealId, setSavedDealId] = useState<string | undefined>(undefined)
  const [signedIn, setSignedIn]     = useState(false)
  const [isPro, setIsPro]           = useState(false)
  const supabaseConfigured = supabaseEnv().configured

  useElectronBounds(browserActive && viewMode === "browser", sidebarOpen)

  // Auth
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

  // Browser mode: listen for navigation updates
  useEffect(() => {
    if (viewMode !== "browser") return
    const api = window.electronAPI
    if (!api) return
    const unsub = api.onNavUpdate(({ url, title, isListing, loading }) => {
      if (url !== undefined && isListing && url !== lastAutoAnalyzedUrl.current) {
        setBrowserAnalysisResult(null)
      }
      if (url !== undefined) { setCurrentUrl(url); setUrlInput(url) }
      if (title !== undefined) { void title }
      if (isListing !== undefined) {
        setIsListingPage(isListing)
        if (!isListing) { lastAutoAnalyzedUrl.current = ""; setBrowserAnalysisResult(null) }
      }
      if (loading !== undefined) setBrowserLoading(loading)
    })
    return unsub
  }, [viewMode])

  // Browser mode: auto-analyze on listing page load
  useEffect(() => {
    if (viewMode !== "browser") return
    if (!isListingPage || !browserActive || !currentUrl) return
    if (browserLoading) return
    if (currentUrl === lastAutoAnalyzedUrl.current) return
    lastAutoAnalyzedUrl.current = currentUrl

    setBrowserAnalysisResult(null)
    setSavedDealId(undefined)
    setBrowserAnalysisLoading(true)
    setError(null)

    const epoch = ++analysisEpochRef.current
    window.electronAPI!.analyze()
      .then((result) => {
        if (epoch !== analysisEpochRef.current) return
        const r = result as ExtractPayload
        if (r.error) { setError(r.error); return }
        const built = buildAnalysisResult({ ...r, inputs: r.inputs as Partial<DealInputs> })
        setBrowserAnalysisResult(built)
      })
      .catch((err: unknown) => {
        if (epoch !== analysisEpochRef.current) return
        setError(err instanceof Error ? err.message : "Analysis failed.")
      })
      .finally(() => {
        if (epoch === analysisEpochRef.current) setBrowserAnalysisLoading(false)
      })
  }, [viewMode, isListingPage, currentUrl, browserActive, browserLoading])

  // Clean up WebContentsView on unmount
  useEffect(() => {
    return () => { window.electronAPI?.hideBrowser() }
  }, [])

  // Switch to browser mode — create and show WebContentsView
  const activateBrowserMode = useCallback(async () => {
    const api = window.electronAPI
    if (!api) return
    setError(null)
    if (!browserActive) {
      const nav = urlInput || "https://zillow.com"
      await api.createBrowser(calcBounds(sidebarOpen))
      await api.navigate(nav)
      setBrowserActive(true)
      setCurrentUrl(nav)
    } else {
      api.showBrowser(calcBounds(sidebarOpen))
    }
    setViewMode("browser")
  }, [browserActive, urlInput, sidebarOpen])

  // Switch back to native mode — hide WebContentsView
  const activateNativeMode = useCallback(() => {
    window.electronAPI?.hideBrowser()
    setViewMode("native")
  }, [])

  // Native mode: resolve address or URL via API
  const nativeResolveAndAnalyze = useCallback(async (text: string): Promise<HuntResult> => {
    const cacheId = normalizeCacheKey(text)
    const cached  = sessionGet<ResolverPayload>(AUTOFILL_CACHE_NS, cacheId)
    let payload: ResolverPayload

    if (cached) {
      payload = cached
    } else {
      const isUrl = LISTING_URL_RE.test(text)
      const res   = isUrl
        ? await fetch("/api/property-resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: text }),
          })
        : await fetch(`/api/property-resolve?address=${encodeURIComponent(text)}`)

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
        throw new Error(body?.message ?? body?.error ?? "Couldn't resolve that property.")
      }
      payload = (await res.json()) as ResolverPayload
      sessionSet(AUTOFILL_CACHE_NS, cacheId, payload, AUTOFILL_CACHE_TTL_MS)
    }

    const merged   = { ...DEFAULT_INPUTS, ...payload.inputs } as DealInputs
    const inputs   = sanitiseInputs(merged)
    const analysis = analyseDeal(inputs)
    const walkAway = (() => { try { return findOfferCeiling(inputs) } catch { return null } })()
    const inputProvenance = payload.provenance ?? {}

    let distribution: DistributionResult | null = null
    let probabilisticVerdict: ProbabilisticVerdict | null = null
    let walkAwayConfidenceNote: string | null = null
    try {
      const annotated = annotateFromProvenance(inputs, inputProvenance)
      distribution = analyseDistribution(annotated)
      probabilisticVerdict = renderProbabilisticVerdict(distribution, worstConfidence(annotated))
      const rentProv = inputProvenance.monthlyRent
      if (rentProv) walkAwayConfidenceNote = offerCeilingConfidenceNote(rentProv.confidence, rentProv.source)
    } catch { /* additive — non-fatal */ }

    const facts = payload.facts ?? {}
    const listingData: ListingCardData = {
      address:      payload.address,
      purchasePrice: inputs.purchasePrice,
      beds:         typeof facts.bedrooms    === "number" ? facts.bedrooms    : null,
      baths:        typeof facts.bathrooms   === "number" ? facts.bathrooms   : null,
      sqft:         typeof facts.squareFeet  === "number" ? facts.squareFeet  : null,
      yearBuilt:    typeof facts.yearBuilt   === "number" ? facts.yearBuilt   : null,
      propertyType: typeof facts.propertyType === "string" ? facts.propertyType : null,
      photos:       Array.isArray(facts.photos) ? facts.photos as string[] : undefined,
      verdict:      analysis.verdict.tier,
    }

    return { listingData, inputs, analysis, walkAway, distribution, probabilisticVerdict, walkAwayConfidenceNote, inputProvenance }
  }, [])

  const nativeSubmit = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t) return
    setError(null)
    setNativeLoading(true)
    setNativeResult(null)
    setSavedDealId(undefined)
    try {
      const r = await nativeResolveAndAnalyze(t)
      setNativeResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setNativeLoading(false)
    }
  }, [nativeResolveAndAnalyze])

  // Browser mode: navigate WebContentsView
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

  const handleBrowserNavigate = async (e: React.FormEvent) => {
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
    setIsSaving(true)
    try {
      const result = viewMode === "native" ? nativeResult : browserAnalysisResult
      if (!result || isSaving || savedDealId) return
      const inputs  = viewMode === "native" ? (result as HuntResult).inputs : (result as AnalysisResult).inputs
      const address = viewMode === "native" ? (result as HuntResult).listingData.address : (result as AnalysisResult).address
      const facts   = viewMode === "native" ? {
        beds: (result as HuntResult).listingData.beds,
        baths: (result as HuntResult).listingData.baths,
        sqft: (result as HuntResult).listingData.sqft,
        yearBuilt: (result as HuntResult).listingData.yearBuilt,
        propertyType: (result as HuntResult).listingData.propertyType,
      } : (result as AnalysisResult).propertyFacts
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, address, propertyFacts: facts }),
      })
      const payload = await res.json()
      if (res.ok && payload?.id) setSavedDealId(payload.id as string)
    } finally {
      setIsSaving(false)
    }
  }, [signedIn, isPro, viewMode, nativeResult, browserAnalysisResult, isSaving, savedDealId])

  const hasNativeResult  = nativeResult != null
  const hasBrowserResult = browserAnalysisResult != null
  const browserShowActive  = isListingPage && hasBrowserResult
  const browserShowLoading = isListingPage && browserAnalysisLoading

  return (
    <SidebarInset className="overflow-hidden">
      {/* Top bar */}
      <header className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
        <SidebarTrigger className="-ml-1" />

        {/* View mode toggle */}
        <div className="flex items-center bg-muted/40 rounded-md p-0.5 border border-border shrink-0">
          <button
            onClick={activateNativeMode}
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-7 rounded text-xs font-medium transition-all",
              viewMode === "native"
                ? "bg-background text-foreground shadow-sm border border-white/10"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap className="h-3 w-3" />
            Native
          </button>
          <button
            onClick={activateBrowserMode}
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-7 rounded text-xs font-medium transition-all",
              viewMode === "browser"
                ? "bg-background text-foreground shadow-sm border border-white/10"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Globe className="h-3 w-3" />
            Browser
          </button>
        </div>

        {/* Native mode: search input */}
        {viewMode === "native" && (
          <form
            onSubmit={(e) => { e.preventDefault(); nativeSubmit(nativeQuery) }}
            className="flex-1 flex items-center gap-2"
          >
            <div className={cn(
              "flex-1 flex items-center gap-2 h-8 px-3 rounded-md border bg-muted/30 text-sm",
              error ? "border-amber-500/40" : "border-border focus-within:border-white/20"
            )}>
              {LISTING_URL_RE.test(nativeQuery)
                ? <Globe  className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                : <MapPin className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              }
              <Input
                value={nativeQuery}
                onChange={(e) => { setNativeQuery(e.target.value); setError(null) }}
                placeholder="Paste a Zillow URL or type an address…"
                className="border-0 bg-transparent p-0 h-auto text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {nativeQuery && (
                <button type="button" onClick={() => { setNativeQuery(""); setNativeResult(null); setError(null) }}
                  className="text-muted-foreground/40 hover:text-muted-foreground shrink-0">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Button type="submit" size="sm" disabled={nativeLoading || !nativeQuery.trim()}>
              {nativeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </Button>
          </form>
        )}

        {/* Browser mode: navigation bar */}
        {viewMode === "browser" && (
          <>
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
            <form onSubmit={handleBrowserNavigate} className="flex-1 flex items-center gap-2">
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
          </>
        )}

        {/* Verdict pill (both modes) */}
        {viewMode === "native" && hasNativeResult && nativeResult?.analysis && (
          <VerdictPill tier={nativeResult.analysis.verdict.tier} />
        )}
        {viewMode === "browser" && browserActive && isListingPage && (
          <ListingPill
            loading={browserAnalysisLoading}
            tier={browserAnalysisResult?.analysis.verdict.tier ?? null}
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

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left side */}
        <div className="flex-1 overflow-hidden flex flex-col min-w-0">
          {viewMode === "native" ? (
            nativeLoading ? (
              <HuntingLoader />
            ) : hasNativeResult ? (
              <div className="flex-1 overflow-y-auto">
                <ListingCard data={nativeResult!.listingData} />
              </div>
            ) : (
              <IdleHunting onSubmit={nativeSubmit} />
            )
          ) : (
            /* Browser mode: this div is the placeholder that Electron's
               WebContentsView will layer on top of. */
            <div className="flex-1 bg-zinc-950 relative flex flex-col">
              {!browserActive && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <Globe className="h-10 w-10 opacity-20" />
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium">Live browser</p>
                    <p className="text-xs opacity-60">Navigate to any listing for auto-analysis</p>
                  </div>
                </div>
              )}
              {browserActive && currentUrl && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 text-[10px] text-muted-foreground font-mono pointer-events-none">
                  {hostnameOf(currentUrl)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: dossier panel */}
        <div
          className="shrink-0 flex flex-col border-l border-zinc-800 bg-zinc-950 overflow-hidden"
          style={{ width: RIGHT_PANEL_W }}
        >
          {viewMode === "native" ? (
            hasNativeResult ? (
              <DossierPanel
                analysis={nativeResult!.analysis}
                walkAway={nativeResult!.walkAway}
                inputs={nativeResult!.inputs}
                address={nativeResult!.listingData.address}
                propertyFacts={{
                  beds: nativeResult!.listingData.beds,
                  baths: nativeResult!.listingData.baths,
                  sqft: nativeResult!.listingData.sqft,
                  yearBuilt: nativeResult!.listingData.yearBuilt,
                  propertyType: nativeResult!.listingData.propertyType,
                }}
                distribution={nativeResult!.distribution}
                probabilisticVerdict={nativeResult!.probabilisticVerdict}
                walkAwayConfidenceNote={nativeResult!.walkAwayConfidenceNote}
                inputProvenance={nativeResult!.inputProvenance}
                signedIn={signedIn}
                isPro={isPro}
                supabaseConfigured={supabaseConfigured}
                panelWidth={RIGHT_PANEL_W}
                onSave={supabaseConfigured ? handleSave : undefined}
                isSaving={isSaving}
                savedDealId={savedDealId}
              />
            ) : (
              <IdlePanel onLaunch={nativeSubmit} />
            )
          ) : browserShowLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-xs">Running analysis…</p>
            </div>
          ) : browserShowActive ? (
            <DossierPanel
              analysis={browserAnalysisResult!.analysis}
              walkAway={browserAnalysisResult!.walkAway}
              inputs={browserAnalysisResult!.inputs}
              address={browserAnalysisResult!.address}
              propertyFacts={browserAnalysisResult!.propertyFacts}
              distribution={browserAnalysisResult!.distribution}
              probabilisticVerdict={browserAnalysisResult!.probabilisticVerdict}
              walkAwayConfidenceNote={browserAnalysisResult!.walkAwayConfidenceNote}
              inputProvenance={browserAnalysisResult!.inputProvenance}
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
              if (!browserActive) { await launchBrowser(url) }
              else { setBrowserLoading(true); setError(null); await window.electronAPI?.navigate(url) }
            }} />
          )}
        </div>
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// WEB MODE — full hunting interface
// ---------------------------------------------------------------------------

function WebResearchPage() {
  const [query, setQuery]         = useState("")
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [result, setResult]       = useState<HuntResult | null>(null)
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSug, setActiveSug] = useState(-1)
  const [savedDealId, setSavedDealId] = useState<string | undefined>()
  const [isSaving, setIsSaving]   = useState(false)
  const [signedIn, setSignedIn]   = useState(false)
  const [isPro, setIsPro]         = useState(false)

  const formRef    = useRef<HTMLFormElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabaseConfigured = supabaseEnv().configured

  const isListingUrl = LISTING_URL_RE.test(query)

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
      if (sub && (sub.status === "active" || sub.status === "trialing")) {
        setIsPro(true)
      }
    })
  }, [supabaseConfigured])

  // Address autocomplete
  useEffect(() => {
    if (isListingUrl || query.length < 4) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/address-autocomplete?q=${encodeURIComponent(query)}`)
        if (res.ok) {
          const data = (await res.json()) as AddressSuggestion[]
          setSuggestions(data)
          setShowSuggestions(data.length > 0)
          setActiveSug(-1)
        }
      } catch { /* non-critical */ }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, isListingUrl])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (formRef.current && !formRef.current.contains(e.target as Node))
        setShowSuggestions(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const resolveAndAnalyze = useCallback(async (text: string): Promise<HuntResult> => {
    const cacheId = normalizeCacheKey(text)
    const cached  = sessionGet<ResolverPayload>(AUTOFILL_CACHE_NS, cacheId)
    let payload: ResolverPayload

    if (cached) {
      payload = cached
    } else {
      const isUrl = LISTING_URL_RE.test(text)
      const res = isUrl
        ? await fetch("/api/property-resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: text }),
          })
        : await fetch(`/api/property-resolve?address=${encodeURIComponent(text)}`)

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
        throw new Error(body?.message ?? body?.error ?? "Couldn't resolve that property.")
      }
      payload = (await res.json()) as ResolverPayload
      sessionSet(AUTOFILL_CACHE_NS, cacheId, payload, AUTOFILL_CACHE_TTL_MS)
    }

    const merged   = { ...DEFAULT_INPUTS, ...payload.inputs } as DealInputs
    const inputs   = sanitiseInputs(merged)
    const analysis = analyseDeal(inputs)
    const walkAway = (() => { try { return findOfferCeiling(inputs) } catch { return null } })()
    const inputProvenance = payload.provenance ?? {}

    let distribution: DistributionResult | null = null
    let probabilisticVerdict: ProbabilisticVerdict | null = null
    let walkAwayConfidenceNote: string | null = null
    try {
      const annotated = annotateFromProvenance(inputs, inputProvenance)
      distribution = analyseDistribution(annotated)
      probabilisticVerdict = renderProbabilisticVerdict(distribution, worstConfidence(annotated))
      const rentProv = inputProvenance.monthlyRent
      if (rentProv) walkAwayConfidenceNote = offerCeilingConfidenceNote(rentProv.confidence, rentProv.source)
    } catch { /* additive — non-fatal */ }

    const facts = payload.facts ?? {}
    const listingData: ListingCardData = {
      address:      payload.address,
      purchasePrice: inputs.purchasePrice,
      beds:         typeof facts.bedrooms    === "number" ? facts.bedrooms    : null,
      baths:        typeof facts.bathrooms   === "number" ? facts.bathrooms   : null,
      sqft:         typeof facts.squareFeet  === "number" ? facts.squareFeet  : null,
      yearBuilt:    typeof facts.yearBuilt   === "number" ? facts.yearBuilt   : null,
      propertyType: typeof facts.propertyType === "string" ? facts.propertyType : null,
      photos:       Array.isArray(facts.photos) ? facts.photos as string[] : undefined,
      verdict:      analysis.verdict.tier,
    }

    return { listingData, inputs, analysis, walkAway, distribution, probabilisticVerdict, walkAwayConfidenceNote, inputProvenance }
  }, [])

  const submit = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t) return
    const valid = LISTING_URL_RE.test(t) || (/\d/.test(t) && t.length >= 6)
    if (!valid) { setError("Enter a street address or Zillow/Redfin URL."); return }

    setError(null)
    setLoading(true)
    setResult(null)
    setSavedDealId(undefined)
    setShowSuggestions(false)
    try {
      const r = await resolveAndAnalyze(t)
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setLoading(false)
    }
  }, [resolveAndAnalyze])

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); submit(query.trim()) }

  const handleSuggestionSelect = (s: AddressSuggestion) => {
    setQuery(s.label)
    setShowSuggestions(false)
    submit(s.label)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || !suggestions.length) return
    if (e.key === "ArrowDown")  { e.preventDefault(); setActiveSug((i) => Math.min(i + 1, suggestions.length - 1)) }
    if (e.key === "ArrowUp")    { e.preventDefault(); setActiveSug((i) => Math.max(i - 1, -1)) }
    if (e.key === "Enter" && activeSug >= 0) { e.preventDefault(); const s = suggestions[activeSug]; if (s) handleSuggestionSelect(s) }
    if (e.key === "Escape")     { setShowSuggestions(false) }
  }

  const handleSave = useCallback(async () => {
    if (!result || isSaving || savedDealId) return
    if (!signedIn) { window.location.href = "/login?redirect=/research"; return }
    if (!isPro)    { window.location.href = "/pricing?redirect=/research"; return }
    setIsSaving(true)
    try {
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs:        result.inputs,
          address:       result.listingData.address,
          propertyFacts: {
            beds: result.listingData.beds, baths: result.listingData.baths,
            sqft: result.listingData.sqft, yearBuilt: result.listingData.yearBuilt,
            propertyType: result.listingData.propertyType,
          },
        }),
      })
      const payload = await res.json()
      if (res.ok && payload?.id) setSavedDealId(payload.id as string)
    } finally {
      setIsSaving(false)
    }
  }, [result, isSaving, savedDealId, signedIn, isPro])

  const hasResult = result != null

  return (
    <SidebarInset className="overflow-hidden">
      <header className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
        <SidebarTrigger className="-ml-1" />

        {/* Search bar — expands to fill header when in idle state */}
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="flex-1 flex items-center gap-2 relative"
        >
          <div
            className={cn(
              "flex-1 flex items-center gap-2 h-9 px-3 rounded-lg border bg-card transition-colors",
              error ? "border-amber-500/40" : "border-border focus-within:border-white/20"
            )}
          >
            {isListingUrl
              ? <Globe   className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              : <MapPin  className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            }
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setError(null) }}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
              onKeyDown={handleKeyDown}
              placeholder="Paste a Zillow URL or type an address…"
              className="border-0 bg-transparent p-0 h-auto text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); setResult(null); setError(null) }}
                className="text-muted-foreground/40 hover:text-muted-foreground shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <Button type="submit" size="sm" disabled={loading || !query.trim()}>
            {loading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Search className="h-3.5 w-3.5" />
            }
          </Button>

          {/* Autocomplete */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-12 z-50 mt-1.5 rounded-lg border border-border bg-card shadow-2xl overflow-hidden">
              {suggestions.map((s, i) => (
                <button
                  key={s.placeId}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleSuggestionSelect(s) }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex flex-col gap-0.5 hover:bg-muted transition-colors",
                    i === activeSug && "bg-muted",
                    i < suggestions.length - 1 && "border-b border-border"
                  )}
                >
                  <span className="text-xs font-medium">{s.primary}</span>
                  <span className="text-[10px] text-muted-foreground">{s.secondary}</span>
                </button>
              ))}
            </div>
          )}
        </form>

        {/* Verdict pill when loaded */}
        {hasResult && result.analysis && (
          <VerdictPill tier={result.analysis.verdict.tier} />
        )}

        {error && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/25 text-xs text-amber-400 shrink-0 max-w-[220px]">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 ml-1">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: listing card or idle state */}
        <div
          className={cn(
            "flex flex-col transition-all duration-300 border-r border-border overflow-hidden",
            hasResult ? "flex-1" : "flex-1"
          )}
        >
          {loading ? (
            <HuntingLoader />
          ) : hasResult ? (
            <div className="flex-1 overflow-y-auto">
              <ListingCard data={result.listingData} />
            </div>
          ) : (
            <IdleHunting onSubmit={submit} />
          )}
        </div>

        {/* Right: dossier — only when result is loaded */}
        {hasResult && result && (
          <div
            className="shrink-0 flex flex-col border-l border-border bg-background overflow-hidden"
            style={{ width: 460 }}
          >
            <DossierPanel
              analysis={result.analysis}
              walkAway={result.walkAway}
              inputs={result.inputs}
              address={result.listingData.address}
              propertyFacts={{
                beds: result.listingData.beds,
                baths: result.listingData.baths,
                sqft: result.listingData.sqft,
                yearBuilt: result.listingData.yearBuilt,
                propertyType: result.listingData.propertyType,
              }}
              distribution={result.distribution}
              probabilisticVerdict={result.probabilisticVerdict}
              walkAwayConfidenceNote={result.walkAwayConfidenceNote}
              inputProvenance={result.inputProvenance}
              signedIn={signedIn}
              isPro={isPro}
              supabaseConfigured={supabaseConfigured}
              panelWidth={460}
              onSave={supabaseConfigured ? handleSave : undefined}
              isSaving={isSaving}
              savedDealId={savedDealId}
            />
          </div>
        )}
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// Idle hunting state — shown before any search
// ---------------------------------------------------------------------------

function IdleHunting({ onSubmit }: { onSubmit: (text: string) => void }) {
  const quickStarts = [
    { label: "Zillow", hint: "zillow.com", url: "https://zillow.com" },
    { label: "Redfin", hint: "redfin.com", url: "https://redfin.com" },
    { label: "Realtor", hint: "realtor.com", url: "https://realtor.com" },
  ]

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8 text-center select-none">
      {/* Illustration */}
      <div className="relative">
        <div className="h-24 w-24 rounded-2xl bg-white/3 border border-white/8 flex items-center justify-center">
          <svg width="48" height="36" viewBox="0 0 48 36" fill="none">
            <rect x="4" y="16" width="40" height="18" rx="2" fill="currentColor" className="text-white/8" />
            <path d="M2 18L24 4L46 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/20" />
            <rect x="10" y="22" width="10" height="12" rx="1" fill="currentColor" className="text-white/12" />
            <rect x="28" y="22" width="10" height="8" rx="1" fill="currentColor" className="text-white/12" />
            {/* Signal lines */}
            <line x1="36" y1="6" x2="36" y2="2" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="39" y1="7" x2="42" y2="4" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="40" y1="10" x2="44" y2="10" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        {/* Floating verdict hint */}
        <div className="absolute -top-2 -right-2 px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
          Live
        </div>
      </div>

      <div className="space-y-1.5 max-w-xs">
        <p className="text-sm font-semibold text-foreground">Hunt for your next deal</p>
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          Paste a Zillow or Redfin URL, or type any address. Get a full investor verdict — no Zillow chrome, just the numbers that matter.
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-[200px]">
        {quickStarts.map((s) => (
          <button
            key={s.label}
            onClick={() => onSubmit(s.url)}
            className="px-4 py-2.5 rounded-lg border border-white/8 text-xs text-muted-foreground hover:border-white/16 hover:text-foreground hover:bg-white/4 transition-all text-left flex items-center justify-between gap-2"
          >
            <span>{s.label}</span>
            <span className="text-[10px] text-muted-foreground/40 font-mono">{s.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading state during analysis
// ---------------------------------------------------------------------------

function HuntingLoader() {
  const steps = [
    "Fetching listing data…",
    "Pulling market comps…",
    "Running analysis engine…",
    "Computing walk-away price…",
  ]
  const [step, setStep] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 1200)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="relative h-12 w-12">
        <div className="absolute inset-0 rounded-full border-2 border-white/8" />
        <div className="absolute inset-0 rounded-full border-2 border-t-[oklch(0.62_0.22_265)] border-r-transparent border-b-transparent border-l-transparent animate-spin" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{steps[step]}</p>
        <div className="flex gap-1 justify-center">
          {steps.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 w-1 rounded-full transition-all",
                i <= step ? "bg-[oklch(0.62_0.22_265)]" : "bg-white/10"
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Verdict pill in the header
// ---------------------------------------------------------------------------

function VerdictPill({ tier }: { tier: VerdictTier }) {
  const accent = TIER_ACCENT[tier]
  const labels: Record<VerdictTier, string> = {
    excellent: "Strong Buy", good: "Good Deal", fair: "Borderline", poor: "Pass", avoid: "Avoid"
  }
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold shrink-0"
      style={{ color: accent, backgroundColor: `${accent}14`, border: `1px solid ${accent}44` }}
    >
      <Zap className="h-3 w-3" />
      {labels[tier]}
    </div>
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
