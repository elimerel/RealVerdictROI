"use client"

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, X, Plus, Search, MapPin,
  AlertTriangle,
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
} from "@/lib/calculations"
import { createClient } from "@/lib/supabase/client"
import { supabaseEnv } from "@/lib/supabase/config"
import type { FieldProvenance } from "@/lib/types"
import { normalizeCacheKey, sessionGet, sessionSet } from "@/lib/client-session-cache"
import DossierPanel, { DossierPanelSkeleton } from "../_components/DossierPanel"
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

type ListingSource = "zillow" | "redfin" | "realtor" | "homes" | "trulia" | "movoto" | null

type AnalysisResult = {
  address?: string
  inputs: DealInputs
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  propertyFacts?: PropertyFacts
  inputProvenance: Partial<Record<keyof DealInputs, FieldProvenance>>
  source: ListingSource
}

type ResolverPayload = {
  address?: string
  inputs: Partial<DealInputs>
  notes: string[]
  warnings: string[]
  facts: Record<string, unknown>
  provenance: Partial<Record<keyof DealInputs, FieldProvenance>>
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

const LISTING_URL_RE =
  /^https?:\/\/(www\.)?(zillow|redfin|realtor|homes|trulia|movoto)\.com\//i
const AUTOFILL_CACHE_NS = "research:autofill:v2"
const AUTOFILL_CACHE_TTL_MS = 30 * 60 * 1000

function detectSource(url: string): ListingSource {
  const m = url.match(/^https?:\/\/(?:www\.)?(zillow|redfin|realtor|homes|trulia|movoto)\.com\//i)
  return (m?.[1]?.toLowerCase() as ListingSource) ?? null
}

function normalizeUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ""
  if (/^https?:\/\//i.test(t)) return t
  return "https://" + t
}

function hostnameOf(url: string) {
  try { return new URL(url).hostname.replace("www.", "") } catch { return url }
}

function buildAnalysisFromExtract(data: ExtractPayload, currentUrl: string): AnalysisResult {
  const merged: DealInputs = { ...DEFAULT_INPUTS, ...(data.inputs as Partial<DealInputs>) }
  const sanitized = sanitiseInputs(merged)
  const analysis = analyseDeal(sanitized)
  const walkAway = (() => {
    try { return findOfferCeiling(sanitized) } catch { return null }
  })()
  return {
    address: data.address,
    inputs: sanitized,
    analysis,
    walkAway,
    propertyFacts: data.facts ? {
      beds: data.facts.bedrooms ?? null,
      baths: data.facts.bathrooms ?? null,
      sqft: data.facts.squareFeet ?? null,
      yearBuilt: data.facts.yearBuilt ?? null,
      propertyType: data.facts.propertyType ?? null,
    } : undefined,
    inputProvenance: (data.provenance ?? {}) as Partial<Record<keyof DealInputs, FieldProvenance>>,
    source: detectSource(currentUrl),
  }
}

function buildAnalysisFromResolver(payload: ResolverPayload, currentUrl: string): AnalysisResult {
  const merged = { ...DEFAULT_INPUTS, ...payload.inputs } as DealInputs
  const inputs = sanitiseInputs(merged)
  const analysis = analyseDeal(inputs)
  const walkAway = (() => {
    try { return findOfferCeiling(inputs) } catch { return null }
  })()
  const facts = payload.facts ?? {}
  return {
    address: payload.address,
    inputs,
    analysis,
    walkAway,
    propertyFacts: {
      beds: typeof facts.bedrooms === "number" ? facts.bedrooms : null,
      baths: typeof facts.bathrooms === "number" ? facts.bathrooms : null,
      sqft: typeof facts.squareFeet === "number" ? facts.squareFeet : null,
      yearBuilt: typeof facts.yearBuilt === "number" ? facts.yearBuilt : null,
      propertyType: typeof facts.propertyType === "string" ? facts.propertyType : null,
    },
    inputProvenance: payload.provenance ?? {},
    source: detectSource(currentUrl),
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
const HEADER_H   = 56
const SIDEBAR_OPEN_W = 256
const SIDEBAR_ICON_W = 48
const RIGHT_PANEL_W  = 420

function calcBounds(sidebarOpen: boolean) {
  const x = sidebarOpen ? SIDEBAR_OPEN_W : SIDEBAR_ICON_W
  const y = TITLEBAR_H + HEADER_H
  const width = Math.max(0, window.innerWidth - x - RIGHT_PANEL_W)
  const height = Math.max(0, window.innerHeight - y)
  return { x, y, width, height }
}

// ---------------------------------------------------------------------------
// ELECTRON MODE — embedded browser is the only mode
// ---------------------------------------------------------------------------

function ElectronBrowsePage() {
  const { open: sidebarOpen } = useSidebar()

  // Browser state
  const [browserActive, setBrowserActive] = useState(false)
  const [currentUrl, setCurrentUrl]       = useState("")
  const [urlEditing, setUrlEditing]       = useState(false)
  const [urlInput, setUrlInput]           = useState("https://www.zillow.com")
  const [browserLoading, setBrowserLoading] = useState(false)
  const [isListingPage, setIsListingPage] = useState(false)

  // Analysis state
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastAutoAnalyzedUrl = useRef("")
  const analysisEpochRef    = useRef(0)

  // "+" paste-a-URL popover
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteValue, setPasteValue] = useState("")

  // Save state
  const [isSaving, setIsSaving] = useState(false)
  const [savedDealId, setSavedDealId] = useState<string | undefined>(undefined)
  const [signedIn, setSignedIn] = useState(false)
  const [isPro, setIsPro] = useState(false)
  const supabaseConfigured = supabaseEnv().configured

  // Sync Electron BrowserView bounds to the container
  const sendBounds = useCallback(() => {
    if (!window.electronAPI) return
    window.electronAPI.updateBounds(calcBounds(sidebarOpen))
  }, [sidebarOpen])

  useEffect(() => {
    sendBounds()
    window.addEventListener("resize", sendBounds)
    return () => window.removeEventListener("resize", sendBounds)
  }, [sendBounds])

  useEffect(() => {
    const t = setTimeout(sendBounds, 250)
    return () => clearTimeout(t)
  }, [sidebarOpen, sendBounds])

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

  // Listen for navigation updates from the main process
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    const unsub = api.onNavUpdate(({ url, isListing, loading }) => {
      if (url !== undefined && isListing && url !== lastAutoAnalyzedUrl.current) {
        setAnalysis(null)
      }
      if (url !== undefined) {
        setCurrentUrl(url)
        if (!urlEditing) setUrlInput(url)
      }
      if (isListing !== undefined) {
        setIsListingPage(isListing)
        if (!isListing) {
          lastAutoAnalyzedUrl.current = ""
          setAnalysis(null)
          setSavedDealId(undefined)
        }
      }
      if (loading !== undefined) setBrowserLoading(loading)
    })
    return unsub
  }, [urlEditing])

  // Auto-analyze on listing page load — no manual button needed
  useEffect(() => {
    if (!isListingPage || !browserActive || !currentUrl) return
    if (browserLoading) return
    if (currentUrl === lastAutoAnalyzedUrl.current) return
    lastAutoAnalyzedUrl.current = currentUrl

    setAnalysis(null)
    setSavedDealId(undefined)
    setAnalysisLoading(true)
    setError(null)

    const epoch = ++analysisEpochRef.current
    window.electronAPI!.analyze()
      .then((result) => {
        if (epoch !== analysisEpochRef.current) return
        const r = result as ExtractPayload
        if (r.error) {
          setError(r.error)
          return
        }
        setAnalysis(buildAnalysisFromExtract({ ...r, inputs: r.inputs as Partial<DealInputs> }, currentUrl))
      })
      .catch((err: unknown) => {
        if (epoch !== analysisEpochRef.current) return
        setError(err instanceof Error ? err.message : "Couldn't read this listing.")
      })
      .finally(() => {
        if (epoch === analysisEpochRef.current) setAnalysisLoading(false)
      })
  }, [isListingPage, currentUrl, browserActive, browserLoading])

  // Cleanup on unmount
  useEffect(() => {
    return () => { window.electronAPI?.hideBrowser() }
  }, [])

  // Lazy-create the BrowserView the first time we mount
  useEffect(() => {
    const api = window.electronAPI
    if (!api || browserActive) return
    void (async () => {
      await api.createBrowser(calcBounds(sidebarOpen))
      await api.navigate(urlInput)
      setBrowserActive(true)
      setCurrentUrl(urlInput)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const navigateTo = useCallback(async (raw: string) => {
    const url = normalizeUrl(raw)
    if (!url) return
    setBrowserLoading(true)
    setError(null)
    if (!browserActive) {
      await window.electronAPI?.createBrowser(calcBounds(sidebarOpen))
      setBrowserActive(true)
    }
    await window.electronAPI?.navigate(url)
    setUrlEditing(false)
  }, [browserActive, sidebarOpen])

  const submitUrlBar = (e: React.FormEvent) => {
    e.preventDefault()
    void navigateTo(urlInput)
  }

  const submitPaste = (e: React.FormEvent) => {
    e.preventDefault()
    const v = pasteValue.trim()
    if (!v) return
    void navigateTo(v)
    setPasteValue("")
    setPasteOpen(false)
  }

  const handleSave = useCallback(async () => {
    if (!signedIn) {
      window.open("/login?redirect=" + encodeURIComponent("/research"), "_blank")
      return
    }
    if (!isPro) {
      window.open("/pricing", "_blank")
      return
    }
    if (!analysis || isSaving || savedDealId) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: analysis.inputs,
          address: analysis.address,
          propertyFacts: analysis.propertyFacts,
        }),
      })
      const payload = await res.json()
      if (res.ok && payload?.id) setSavedDealId(payload.id as string)
    } finally {
      setIsSaving(false)
    }
  }, [signedIn, isPro, analysis, isSaving, savedDealId])

  const showPanel = analysisLoading || analysis != null

  return (
    <SidebarInset className="overflow-hidden">
      {/* Top bar — minimal browser chrome */}
      <header className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
        <SidebarTrigger className="-ml-1" />

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => window.electronAPI?.back()}
            disabled={!browserActive || browserLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-30 text-muted-foreground transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.electronAPI?.forward()}
            disabled={!browserActive || browserLoading}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-30 text-muted-foreground transition-colors"
            aria-label="Forward"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.electronAPI?.reload()}
            disabled={!browserActive}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 disabled:opacity-30 text-muted-foreground transition-colors"
            aria-label="Refresh"
          >
            <RotateCw className={cn("h-3.5 w-3.5", browserLoading && "animate-spin")} />
          </button>
        </div>

        <form onSubmit={submitUrlBar} className="flex-1 flex items-center min-w-0">
          <div className="flex-1 flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-muted/30 text-sm focus-within:border-white/15 transition-colors">
            <Globe className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={() => setUrlEditing(true)}
              onBlur={() => setUrlEditing(false)}
              placeholder="https://www.zillow.com"
              className="border-0 bg-transparent p-0 h-auto text-[13px] font-mono focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
        </form>

        {/* Paste-a-URL fallback */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPasteOpen((v) => !v)}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-muted/60 text-muted-foreground transition-colors"
            aria-label="Paste listing URL"
            title="Paste listing URL"
          >
            <Plus className="h-4 w-4" />
          </button>
          {pasteOpen && (
            <div className="absolute top-full right-0 mt-2 w-[360px] rounded-lg border border-border bg-card shadow-2xl z-30 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/50 mb-2">
                Paste a listing URL
              </p>
              <form onSubmit={submitPaste} className="flex gap-2">
                <Input
                  autoFocus
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                  placeholder="zillow.com/homedetails/&hellip;"
                  className="flex-1 h-8 text-[13px] font-mono"
                />
                <Button type="submit" size="sm" disabled={!pasteValue.trim()}>
                  Go
                </Button>
              </form>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/10 border border-red-500/25 text-xs text-red-400 shrink-0 max-w-[240px]">
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
        {/* Left: BrowserView placeholder. Electron WebContentsView is layered on top. */}
        <div className="flex-1 bg-zinc-950 relative flex flex-col min-w-0">
          {!browserActive && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin opacity-40" />
              <p className="text-xs opacity-50">Loading browser&hellip;</p>
            </div>
          )}
          {browserActive && currentUrl && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 text-[10px] text-muted-foreground/60 font-mono pointer-events-none">
              {hostnameOf(currentUrl)}
            </div>
          )}
        </div>

        {/* Right: side panel */}
        <div
          className="shrink-0 flex flex-col border-l border-border bg-background overflow-hidden"
          style={{ width: RIGHT_PANEL_W }}
        >
          {showPanel ? (
            analysisLoading && !analysis ? (
              <DossierPanelSkeleton />
            ) : analysis ? (
              <DossierPanel
                analysis={analysis.analysis}
                walkAway={analysis.walkAway}
                inputs={analysis.inputs}
                address={analysis.address}
                propertyFacts={analysis.propertyFacts}
                source={analysis.source}
                inputProvenance={analysis.inputProvenance}
                signedIn={signedIn}
                isPro={isPro}
                supabaseConfigured={supabaseConfigured}
                panelWidth={RIGHT_PANEL_W}
                onSave={supabaseConfigured ? handleSave : undefined}
                isSaving={isSaving}
                savedDealId={savedDealId}
              />
            ) : null
          ) : (
            <IdleSidePanel />
          )}
        </div>
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// IdleSidePanel — calm empty state when no listing is detected
// ---------------------------------------------------------------------------

function IdleSidePanel() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center select-none gap-3">
      <Globe className="h-8 w-8 text-muted-foreground/15" strokeWidth={1.5} />
      <p className="text-[13px] text-muted-foreground/55 leading-relaxed max-w-[28ch]">
        Navigate to a listing to see underwriting.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WEB MODE — degraded fallback for users on the web app
// ---------------------------------------------------------------------------

function WebBrowsePage() {
  const [query, setQuery]       = useState("")
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [result, setResult]     = useState<AnalysisResult | null>(null)
  const [savedDealId, setSavedDealId] = useState<string | undefined>()
  const [isSaving, setIsSaving] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [isPro, setIsPro]       = useState(false)
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
      setIsPro(rowIsPro(sub as { status: string; current_period_end: string | null } | null))
    })
  }, [supabaseConfigured])

  const submit = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t) return
    setError(null)
    setLoading(true)
    setResult(null)
    setSavedDealId(undefined)
    try {
      const cacheId = normalizeCacheKey(t)
      const cached  = sessionGet<ResolverPayload>(AUTOFILL_CACHE_NS, cacheId)
      let payload: ResolverPayload
      if (cached) {
        payload = cached
      } else {
        const isUrl = LISTING_URL_RE.test(t)
        const res = isUrl
          ? await fetch("/api/property-resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: t }),
            })
          : await fetch("/api/property-resolve?address=" + encodeURIComponent(t))
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { message?: string; error?: string }
          throw new Error(body?.message ?? body?.error ?? "Couldn't read this listing.")
        }
        payload = (await res.json()) as ResolverPayload
        sessionSet(AUTOFILL_CACHE_NS, cacheId, payload, AUTOFILL_CACHE_TTL_MS)
      }

      // Strict gate: refuse to underwrite without a real price
      const priceSource = payload.provenance?.purchasePrice?.source
      const hasPrice =
        payload.inputs.purchasePrice != null &&
        (payload.inputs.purchasePrice as number) > 0 &&
        priceSource != null && priceSource !== "default"
      if (!hasPrice) {
        throw new Error("Couldn't read this listing. Try refreshing or paste the URL manually.")
      }

      setResult(buildAnalysisFromResolver(payload, isListingUrl ? t : ""))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setLoading(false)
    }
  }, [isListingUrl])

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
          inputs: result.inputs,
          address: result.address,
          propertyFacts: result.propertyFacts,
        }),
      })
      const payload = await res.json()
      if (res.ok && payload?.id) setSavedDealId(payload.id as string)
    } finally {
      setIsSaving(false)
    }
  }, [result, isSaving, savedDealId, signedIn, isPro])

  return (
    <SidebarInset className="overflow-hidden">
      <header className="h-14 flex items-center gap-2 border-b border-border px-4 shrink-0">
        <SidebarTrigger className="-ml-1" />
        <form
          onSubmit={(e) => { e.preventDefault(); submit(query) }}
          className="flex-1 flex items-center gap-2"
        >
          <div className={cn(
            "flex-1 flex items-center gap-2 h-8 px-3 rounded-md border bg-muted/30 text-sm transition-colors",
            error ? "border-amber-500/40" : "border-border focus-within:border-white/15",
          )}>
            {isListingUrl
              ? <Globe className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              : <MapPin className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setError(null) }}
              placeholder="Paste a Zillow URL or type an address&hellip;"
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
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          </Button>
        </form>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center px-6 text-center bg-zinc-950 min-w-0">
          {error ? (
            <div className="space-y-2 max-w-sm">
              <AlertTriangle className="h-6 w-6 text-amber-500/70 mx-auto" />
              <p className="text-[13px] text-muted-foreground leading-relaxed">{error}</p>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground/50 leading-relaxed max-w-[36ch]">
              Underwrite any listing on any site, instantly. Open the desktop app to browse Zillow, Redfin, and Realtor with live underwriting in the side panel.
            </p>
          )}
        </div>

        <div
          className="shrink-0 flex flex-col border-l border-border bg-background overflow-hidden"
          style={{ width: RIGHT_PANEL_W }}
        >
          {loading ? (
            <DossierPanelSkeleton />
          ) : result ? (
            <DossierPanel
              analysis={result.analysis}
              walkAway={result.walkAway}
              inputs={result.inputs}
              address={result.address}
              propertyFacts={result.propertyFacts}
              source={result.source}
              inputProvenance={result.inputProvenance}
              signedIn={signedIn}
              isPro={isPro}
              supabaseConfigured={supabaseConfigured}
              panelWidth={RIGHT_PANEL_W}
              onSave={supabaseConfigured ? handleSave : undefined}
              isSaving={isSaving}
              savedDealId={savedDealId}
            />
          ) : (
            <IdleSidePanel />
          )}
        </div>
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function ResearchPage() {
  const [isElectron, setIsElectron] = useState<boolean | null>(null)

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsElectron(!!window.electronAPI)
  }, [])

  if (isElectron === null) return null
  return isElectron ? <ElectronBrowsePage /> : <WebBrowsePage />
}
