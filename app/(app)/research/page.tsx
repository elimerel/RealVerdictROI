"use client"

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Loader2, X, Plus, Search, MapPin,
  AlertTriangle, Building2, Home, Clock3, ChevronLeft, ChevronRight, PanelRightOpen,
} from "lucide-react"
import { useSearchParams } from "next/navigation"
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

type ExtractErrorCode =
  | "no_key"
  | "page_too_short"
  | "captcha"
  | "low_confidence"
  | "schema_too_complex"
  | "network"
  | "unknown"

type ExtractPayload = {
  address?: string
  inputs: Partial<DealInputs>
  siteName?: string | null
  confidence?: string
  error?: string
  errorCode?: ExtractErrorCode
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

function toBrowseTarget(raw: string): string {
  const value = raw.trim()
  if (!value) return ""
  const hasScheme = /^https?:\/\//i.test(value)
  const looksLikeDomain = /^(www\.)?[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(value)
  if (hasScheme || looksLikeDomain) {
    return normalizeUrl(value)
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`
}

const SUPPORTED_SITES = [
  { id: "zillow", label: "Zillow", url: "https://www.zillow.com" },
  { id: "redfin", label: "Redfin", url: "https://www.redfin.com" },
  { id: "realtor", label: "Realtor.com", url: "https://www.realtor.com" },
  { id: "homes", label: "Homes.com", url: "https://www.homes.com" },
  { id: "trulia", label: "Trulia", url: "https://www.trulia.com" },
] as const

type RecentListing = {
  url: string
  address?: string
  source?: ListingSource
  viewedAt: number
}

function initialCollapsed(): boolean {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem("rv:right-panel:collapsed") === "1"
}

function initialRecentListings(): RecentListing[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem("rv:recent-listings") ?? "[]") as RecentListing[]
    return Array.isArray(parsed) ? parsed.slice(0, 5) : []
  } catch {
    return []
  }
}

function hostnameOf(url: string) {
  try { return new URL(url).hostname.replace("www.", "") } catch { return url }
}

function isSupportedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace("www.", "")
    return /(^|\.)zillow\.com$|(^|\.)redfin\.com$|(^|\.)realtor\.com$|(^|\.)homes\.com$|(^|\.)trulia\.com$/.test(host)
  } catch {
    return false
  }
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
const RIGHT_PANEL_W  = 440

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
  const [urlInput, setUrlInput]           = useState("")
  const [browserLoading, setBrowserLoading] = useState(false)
  const [isListingPage, setIsListingPage] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(initialCollapsed)
  const [recentListings, setRecentListings] = useState<RecentListing[]>(initialRecentListings)
  const searchParams = useSearchParams()
  const urlInputRef = useRef<HTMLInputElement>(null)

  // Analysis state. Note: there is no top-level `error` state here.
  // Every analyzer failure is encoded in `idleHint` and rendered as a
  // calm in-panel empty state by IdleSidePanel below.
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [idleHint, setIdleHint] = useState<
    | "default"
    | "supported-non-listing"
    | "captcha"
    | "low_confidence"
    | "page_too_short"
    | "network"
    | "no_key"
  >("default")
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

  useEffect(() => {
    window.localStorage.setItem("rv:right-panel:collapsed", panelCollapsed ? "1" : "0")
  }, [panelCollapsed])

  // Listen for navigation updates from the main process
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    const unsub = api.onNavUpdate(({ url, isListing, loading, canGoBack: canBack, canGoForward: canFwd }) => {
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
          setIdleHint(url && isSupportedDomain(url) ? "supported-non-listing" : "default")
        }
      }
      if (typeof canBack === "boolean") setCanGoBack(canBack)
      if (typeof canFwd === "boolean") setCanGoForward(canFwd)
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

    const epoch = ++analysisEpochRef.current
    window.electronAPI!.analyze()
      .then((result) => {
        if (epoch !== analysisEpochRef.current) return
        const r = result as ExtractPayload
        // The extractor now returns structured error codes the panel maps
        // to calm in-panel copy. We never surface the raw error string.
        if (r.errorCode) {
          const code = r.errorCode
          setAnalysis(null)
          if (code === "captcha") setIdleHint("captcha")
          else if (code === "low_confidence" || code === "schema_too_complex") setIdleHint("low_confidence")
          else if (code === "page_too_short") setIdleHint("page_too_short")
          else if (code === "network") setIdleHint("network")
          else if (code === "no_key") setIdleHint("no_key")
          else setIdleHint("low_confidence")
          return
        }
        if (r.error) {
          // Legacy raw error path — collapse to low_confidence empty state.
          setAnalysis(null)
          setIdleHint("low_confidence")
          return
        }
        const next = buildAnalysisFromExtract({ ...r, inputs: r.inputs as Partial<DealInputs> }, currentUrl)
        setAnalysis(next)
        setIdleHint("default")
        if (currentUrl) {
          const source = detectSource(currentUrl)
          window.localStorage.setItem("rv:last-listing-url", currentUrl)
          if (source) window.localStorage.setItem("rv:last-listing-site", source)
          // Use functional state update so the effect doesn't depend on the
          // recent-listings array (otherwise we'd re-analyze every viewedAt
          // change).
          setRecentListings((prev) => {
            const row: RecentListing = {
              url: currentUrl,
              address: next.address,
              source,
              viewedAt: Date.now(),
            }
            const merged = [row, ...prev.filter((item) => item.url !== row.url)].slice(0, 5)
            window.localStorage.setItem("rv:recent-listings", JSON.stringify(merged))
            return merged
          })
        }
      })
      .catch(() => {
        if (epoch !== analysisEpochRef.current) return
        setAnalysis(null)
        setIdleHint("network")
      })
      .finally(() => {
        if (epoch === analysisEpochRef.current) setAnalysisLoading(false)
      })
  }, [isListingPage, currentUrl, browserActive, browserLoading])

  // Cleanup on unmount
  useEffect(() => {
    return () => { window.electronAPI?.hideBrowser() }
  }, [])

  // Keyboard shortcuts integration: ⌘N focuses the URL bar so the user can
  // immediately type a new listing URL without reaching for the mouse.
  useEffect(() => {
    const onFocusUrl = () => {
      const el = urlInputRef.current
      if (el) { el.focus(); el.select() }
    }
    window.addEventListener("rv:focus-url", onFocusUrl)
    window.addEventListener("rv:focus-search", onFocusUrl)
    return () => {
      window.removeEventListener("rv:focus-url", onFocusUrl)
      window.removeEventListener("rv:focus-search", onFocusUrl)
    }
  }, [])

  const navigateTo = useCallback(async (raw: string) => {
    const url = toBrowseTarget(raw)
    if (!url) return
    setBrowserLoading(true)
    setIdleHint("default")
    if (!browserActive) {
      await window.electronAPI?.createBrowser(calcBounds(sidebarOpen))
      setBrowserActive(true)
    }
    await window.electronAPI?.navigate(url)
    setUrlEditing(false)
  }, [browserActive, sidebarOpen])

  // Handle deep-link into Browse with a target URL (from Pipeline)
  useEffect(() => {
    const target = searchParams.get("url") ?? window.localStorage.getItem("rv:browse:return-url")
    if (!target) return
    const id = window.setTimeout(() => {
      void navigateTo(target)
    }, 0)
    window.localStorage.removeItem("rv:browse:return-url")
    return () => window.clearTimeout(id)
  }, [navigateTo, searchParams])

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
          sourceUrl: currentUrl || null,
          sourceSite: analysis.source || null,
        }),
      })
      const payload = await res.json()
      if (res.ok && payload?.id) setSavedDealId(payload.id as string)
    } finally {
      setIsSaving(false)
    }
  }, [signedIn, isPro, analysis, isSaving, savedDealId, currentUrl])

  const showPanel = analysisLoading || analysis != null

  return (
    <SidebarInset className="overflow-hidden">
      {/* Top bar — minimal browser chrome.
          drag-region extends the macOS title bar across the full window
          width; no-drag-region inside each interactive control restores
          their normal click/focus behavior. */}
      <header className="drag-region h-14 flex items-center gap-2 border-b border-border px-4 shrink-0 select-none">
        <SidebarTrigger className="-ml-1 no-drag-region" />

        <div className="no-drag-region flex items-center gap-1 shrink-0">
          <button
            onClick={() => window.electronAPI?.back()}
            disabled={!browserActive || browserLoading || !canGoBack}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-white/[0.06] disabled:opacity-30 text-muted-foreground/70 transition-colors duration-100"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.electronAPI?.forward()}
            disabled={!browserActive || browserLoading || !canGoForward}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-white/[0.06] disabled:opacity-30 text-muted-foreground/70 transition-colors duration-100"
            aria-label="Forward"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.electronAPI?.reload()}
            disabled={!browserActive}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-white/[0.06] disabled:opacity-30 text-muted-foreground/70 transition-colors duration-100"
            aria-label="Refresh"
          >
            <RotateCw className={cn("h-3.5 w-3.5", browserLoading && "animate-spin")} />
          </button>
        </div>

        <form onSubmit={submitUrlBar} className="no-drag-region flex-1 flex items-center min-w-0">
          <div className="rv-input flex-1 flex items-center gap-2 h-8 px-3 text-sm">
            <Globe className="h-3.5 w-3.5 text-muted-foreground/55 shrink-0" />
            <input
              ref={urlInputRef}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={() => setUrlEditing(true)}
              onBlur={() => setUrlEditing(false)}
              placeholder="Search or enter listing URL"
              className="flex-1 min-w-0 bg-transparent text-[13px] font-mono rv-num text-foreground/85 placeholder:text-muted-foreground/50"
            />
          </div>
        </form>

        {/* Paste-a-URL fallback */}
        <div className="no-drag-region relative shrink-0">
          <button
            type="button"
            onClick={() => setPasteOpen((v) => !v)}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-white/[0.06] text-muted-foreground/70 transition-colors duration-100"
            aria-label="Paste listing URL"
            title="Paste listing URL"
          >
            <Plus className="h-4 w-4" />
          </button>
          {pasteOpen && (
            <div className="absolute top-full right-0 mt-2 w-[360px] rounded-lg bg-card/95 backdrop-blur-sm shadow-2xl z-30 p-4">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/55 mb-3">
                Paste a listing URL
              </p>
              <form onSubmit={submitPaste} className="flex gap-2">
                <div className="rv-input flex-1 flex items-center px-3 py-1.5">
                  <input
                    autoFocus
                    value={pasteValue}
                    onChange={(e) => setPasteValue(e.target.value)}
                    placeholder="listing URL or search query"
                    className="flex-1 bg-transparent text-[13px] font-mono"
                  />
                </div>
                <Button type="submit" size="sm" disabled={!pasteValue.trim()}>
                  Go
                </Button>
              </form>
            </div>
          )}
        </div>

        {/* Header intentionally has no inline error toast — every analysis
            failure category is rendered as a calm empty state inside the
            side panel itself (IdleSidePanel). The previous toast leaked
            raw API error strings (e.g. "schema contains too many
            properties") to the user. */}
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: BrowserView placeholder. Electron WebContentsView is layered on top. */}
        <div className="flex-1 rv-surface-1 relative flex flex-col min-w-0">
          {!browserActive && (
            <div className="flex-1 flex flex-col items-center justify-center px-8">
              <div className="w-full max-w-3xl space-y-7">
                <div className="space-y-2 text-center">
                  <h2 className="text-2xl font-semibold tracking-tight">Browse listings</h2>
                  <p className="text-sm rv-t2">Paste a listing URL or search the web to find one.</p>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void navigateTo(urlInput)
                  }}
                  className="rv-surface-2 rounded-xl p-4 border border-white/6"
                >
                  <div className="rv-input flex items-center gap-2 px-3 py-3">
                    <Search className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                    <input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="Paste listing URL or type an address/search"
                      className="flex-1 bg-transparent text-[14px]"
                    />
                  </div>
                  <p className="text-[11px] rv-t3 mt-2">
                    Non-URL input opens a Google search in the browser pane.
                  </p>
                </form>
                <div className="grid grid-cols-5 gap-3">
                  {SUPPORTED_SITES.map((site) => (
                    <button
                      key={site.id}
                      type="button"
                      onClick={() => void navigateTo(site.url)}
                      className="rv-surface-2 border border-white/6 rounded-lg p-3 text-left hover:border-white/15 transition-colors"
                    >
                      <Building2 className="h-4 w-4 rv-t3 mb-2" />
                      <p className="text-sm">{site.label}</p>
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] rv-t2 inline-flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5" />
                    Recently viewed
                  </p>
                  <div className="grid grid-cols-5 gap-3">
                    {recentListings.length === 0 ? (
                      <div className="col-span-5 rv-surface-2 border border-white/6 rounded-lg p-4 text-sm rv-t3">
                        Analyze a listing to populate recent history.
                      </div>
                    ) : recentListings.map((item) => (
                      <button
                        key={item.url}
                        type="button"
                        onClick={() => void navigateTo(item.url)}
                        className="rv-surface-2 border border-white/6 rounded-lg p-3 text-left hover:border-white/15 transition-colors"
                      >
                        <Home className="h-4 w-4 rv-t3 mb-2" />
                        <p className="text-xs truncate">{item.address ?? hostnameOf(item.url)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
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
          className="shrink-0 flex flex-col border-l border-border rv-surface-1 overflow-hidden"
          style={{ width: panelCollapsed ? 32 : RIGHT_PANEL_W }}
        >
          <button
            type="button"
            onClick={() => setPanelCollapsed((v) => !v)}
            className="h-8 w-8 m-1 rounded border border-border/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label={panelCollapsed ? "Expand panel" : "Collapse panel"}
          >
            {panelCollapsed ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {panelCollapsed ? (
            <div className="flex-1 flex items-center justify-center">
              <PanelRightOpen className="h-4 w-4 rv-t3" />
            </div>
          ) : showPanel ? (
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
                sourceUrl={currentUrl}
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
            <IdleSidePanel hint={idleHint} onReload={() => window.electronAPI?.reload()} />
          )}
        </div>
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// IdleSidePanel — calm empty state for every non-analysis condition
// ---------------------------------------------------------------------------

type IdleHint =
  | "default"
  | "supported-non-listing"
  | "captcha"
  | "low_confidence"
  | "page_too_short"
  | "network"
  | "no_key"

function IdleSidePanel({
  hint = "default",
  onReload,
}: {
  hint?: IdleHint
  onReload?: () => void
}) {
  const config: Record<IdleHint, { icon: React.ReactNode; copy: string; cta?: string }> = {
    "default": {
      icon: <Home className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Navigate to a property listing on Zillow, Redfin, Realtor, Homes, or Trulia to begin.",
    },
    "supported-non-listing": {
      icon: <Search className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Navigate to a listing to see underwriting.",
    },
    "captcha": {
      icon: <AlertTriangle className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Verify you’re not a robot to continue. The panel will populate once the listing loads.",
    },
    "low_confidence": {
      icon: <Building2 className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Couldn’t fully read this listing — try refreshing or paste the URL.",
      cta: "Refresh",
    },
    "page_too_short": {
      icon: <Globe className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Page didn’t load enough content. Try refreshing.",
      cta: "Refresh",
    },
    "network": {
      icon: <AlertTriangle className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Network issue talking to the AI. Retry in a moment.",
      cta: "Retry",
    },
    "no_key": {
      icon: <AlertTriangle className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Add an Anthropic or OpenAI key in Settings to enable listing analysis.",
    },
  }
  const entry = config[hint]
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center select-none gap-3">
      {entry.icon}
      <p className="text-[13px] text-muted-foreground/65 leading-relaxed max-w-[30ch]">
        {entry.copy}
      </p>
      {entry.cta && onReload && (
        <button
          type="button"
          onClick={onReload}
          className="mt-1 text-[11px] uppercase tracking-[0.08em] rv-t2 hover:rv-t1 transition-colors"
        >
          {entry.cta}
        </button>
      )}
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
          sourceUrl: isListingUrl ? normalizeUrl(query) : null,
          sourceSite: isListingUrl ? detectSource(normalizeUrl(query)) : null,
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
      <header className="drag-region h-14 flex items-center gap-2 border-b border-border px-4 shrink-0 select-none">
        <SidebarTrigger className="-ml-1 no-drag-region" />
        <form
          onSubmit={(e) => { e.preventDefault(); submit(query) }}
          className="no-drag-region flex-1 flex items-center gap-2"
        >
          <div className={cn(
            "rv-input flex-1 flex items-center gap-2 h-8 px-3 text-sm",
            error && "rv-tone-warn",
          )}>
            {isListingUrl
              ? <Globe className="h-3.5 w-3.5 text-muted-foreground/55 shrink-0" />
              : <MapPin className="h-3.5 w-3.5 text-muted-foreground/55 shrink-0" />}
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setError(null) }}
              placeholder="Paste a listing URL or type an address&hellip;"
              className="border-0 bg-transparent p-0 h-auto text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); setResult(null); setError(null) }}
                className="text-muted-foreground/40 hover:text-muted-foreground shrink-0 transition-colors duration-100"
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
              Underwrite listings instantly from URL or address. Open the desktop app for full multi-site browse mode with live side-panel underwriting.
            </p>
          )}
        </div>

        <div
          className="shrink-0 flex flex-col border-l border-border bg-background"
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
