"use client"

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from "react"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, Plus, Search,
  AlertTriangle, Building2, Home, Clock3, ChevronLeft, ChevronRight,
} from "lucide-react"
import { useSearchParams } from "next/navigation"
import { SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
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
  /** Model-written one-sentence take on the deal at face value. */
  take?: string | null
  /** Risk phrases lifted verbatim from the listing. */
  riskFlags?: string[]
  /** Rich detail surface (DOM, price history, remarks, scores, lot). */
  listingDetails?: {
    daysOnMarket?: number | null
    originalListPrice?: number | null
    priceHistoryNote?: string | null
    listingDate?: string | null
    listingRemarks?: string | null
    mlsNumber?: string | null
    schoolRating?: number | null
    walkScore?: number | null
    lotSqft?: number | null
  }
}

// Mirrors lib/extractor/types.ts. The Electron main process and
// /api/extract both return values matching this discriminated union.
type ExtractErrorCode =
  | "no_key"
  | "page_too_short"
  | "no_signals"
  | "search_results_page"
  | "captcha"
  | "low_confidence"
  | "schema_too_complex"
  | "network"
  | "unknown"

type ListingFacts = {
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  listPrice: number | null
  originalListPrice: number | null
  daysOnMarket: number | null
  priceHistoryNote: string | null
  beds: number | null
  baths: number | null
  fullBaths: number | null
  halfBaths: number | null
  sqft: number | null
  lotSqft: number | null
  yearBuilt: number | null
  garageSpaces: number | null
  stories: number | null
  propertyType: string | null
  monthlyRent: number | null
  monthlyHOA: number | null
  annualPropertyTax: number | null
  annualInsuranceEst: number | null
  conditionNotes: string | null
  riskFlags: string[]
  mlsNumber: string | null
  listingDate: string | null
  listingRemarks: string | null
  schoolRating: number | null
  walkScore: number | null
  siteName: string | null
}

type FieldMeta = { source: "listing" | "inferred" | "user" | "verified"; confidence: "high" | "medium" | "low"; note?: string }

type ExtractResult =
  | {
      ok: true
      kind: string
      confidence: "high" | "medium" | "low"
      facts: ListingFacts
      meta: Partial<Record<keyof ListingFacts, FieldMeta>>
      take: string | null
      modelUsed: "anthropic" | "openai"
    }
  | {
      ok: false
      errorCode: ExtractErrorCode
      message: string
      partial?: Partial<ListingFacts>
    }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Stage 3 → Stage 4 bridge. Map rich ListingFacts from the extractor to
// the DealInputs shape the underwriting engine consumes, building per-input
// provenance so the panel can show the user where each number came from.
function buildAnalysisFromExtract(
  data: Extract<ExtractResult, { ok: true }>,
  currentUrl: string,
): AnalysisResult {
  const f = data.facts
  const partial: Partial<DealInputs> = {}
  const provenance: Partial<Record<keyof DealInputs, FieldProvenance>> = {}

  const carry = (
    key: keyof DealInputs,
    value: number | null,
    metaKey: keyof typeof data.meta,
    fallback: { source: FieldProvenance["source"]; confidence: FieldProvenance["confidence"]; note?: string },
  ) => {
    if (value && value > 0) {
      partial[key] = Math.round(value) as DealInputs[typeof key]
      const m = data.meta?.[metaKey]
      provenance[key] = m
        ? { source: m.source as FieldProvenance["source"], confidence: m.confidence, note: m.note }
        : fallback
    }
  }

  carry("purchasePrice",     f.listPrice,          "listPrice",          { source: "listing", confidence: "high" })
  carry("monthlyRent",       f.monthlyRent,        "monthlyRent",        { source: "listing", confidence: "medium", note: "Rental estimate from listing — verify against local comps before offering." })
  carry("monthlyHOA",        f.monthlyHOA,         "monthlyHOA",         { source: "listing", confidence: "high" })
  carry("annualPropertyTax", f.annualPropertyTax,  "annualPropertyTax",  { source: "listing", confidence: "high" })
  carry("annualInsurance",   f.annualInsuranceEst, "annualInsuranceEst", { source: "listing", confidence: "medium", note: "Listing-side insurance estimate — your actual quote may differ." })

  // Mark every assumption that came from defaults so the panel can flag
  // them as user-editable knobs.
  const inferred: FieldProvenance = { source: "inferred", confidence: "low" }
  for (const k of [
    "downPaymentPercent","loanInterestRate","loanTermYears","closingCostsPercent",
    "vacancyRatePercent","maintenancePercent","propertyManagementPercent",
    "capexReservePercent","annualAppreciationPercent","annualRentGrowthPercent",
    "annualExpenseGrowthPercent","holdPeriodYears","sellingCostsPercent",
  ] as const) {
    if (!provenance[k]) provenance[k] = inferred
  }
  if (!provenance.monthlyRent) {
    provenance.monthlyRent = { source: "inferred", confidence: "low", note: "No rental estimate on the listing — enter your own." }
  }
  if (!provenance.annualInsurance) {
    provenance.annualInsurance = { source: "inferred", confidence: "low", note: "Estimated — pull a real quote." }
  }

  const merged: DealInputs = { ...DEFAULT_INPUTS, ...partial }
  const sanitized = sanitiseInputs(merged)
  const analysis = analyseDeal(sanitized)
  const walkAway = (() => {
    try { return findOfferCeiling(sanitized) } catch { return null }
  })()

  const fullAddress = [f.address, f.city, f.state, f.zip].filter(Boolean).join(", ")

  return {
    address: fullAddress || f.address || undefined,
    inputs: sanitized,
    analysis,
    walkAway,
    propertyFacts: {
      beds: f.beds ?? null,
      baths: f.baths ?? null,
      sqft: f.sqft ?? null,
      yearBuilt: f.yearBuilt ?? null,
      propertyType: f.propertyType ?? null,
    },
    inputProvenance: provenance,
    source: detectSource(currentUrl),
    take: data.take ?? null,
    riskFlags: f.riskFlags ?? [],
    listingDetails: {
      daysOnMarket:      f.daysOnMarket,
      originalListPrice: f.originalListPrice,
      priceHistoryNote:  f.priceHistoryNote,
      listingDate:       f.listingDate,
      listingRemarks:    f.listingRemarks,
      mlsNumber:         f.mlsNumber,
      schoolRating:      f.schoolRating,
      walkScore:         f.walkScore,
      lotSqft:           f.lotSqft,
    },
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
const COLLAPSED_PANEL_W = 36

function calcBounds(sidebarOpen: boolean, panelW: number) {
  const x = sidebarOpen ? SIDEBAR_OPEN_W : SIDEBAR_ICON_W
  const y = TITLEBAR_H + HEADER_H
  const width = Math.max(0, window.innerWidth - x - panelW)
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
    | "no_signals"
    | "search_results_page"
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

  // The visible panel width drives the BrowserView bounds. When the panel
  // collapses to a strip, the browser expands to fill that space.
  const panelWidth = panelCollapsed ? COLLAPSED_PANEL_W : RIGHT_PANEL_W

  // Sync Electron BrowserView bounds to the container
  const sendBounds = useCallback(() => {
    if (!window.electronAPI) return
    window.electronAPI.updateBounds(calcBounds(sidebarOpen, panelWidth))
  }, [sidebarOpen, panelWidth])

  useEffect(() => {
    sendBounds()
    window.addEventListener("resize", sendBounds)
    return () => window.removeEventListener("resize", sendBounds)
  }, [sendBounds])

  useEffect(() => {
    // Match the panel width transition (180ms) so the browser view
    // resizes in lockstep with the visible panel collapse / expand.
    const t = setTimeout(sendBounds, 200)
    return () => clearTimeout(t)
  }, [sidebarOpen, panelCollapsed, sendBounds])

  // Auto-expand the panel when the user lands on a listing. We use the
  // "adjusting state on prop change" pattern (React docs §You Might Not
  // Need an Effect): when isListingPage transitions false → true, set
  // panelCollapsed to false synchronously during render — never in an
  // effect. We don't auto-collapse on leaving a listing; the user can
  // manually collapse if they want the screen real estate back.
  const [prevIsListingPage, setPrevIsListingPage] = useState(false)
  if (prevIsListingPage !== isListingPage) {
    setPrevIsListingPage(isListingPage)
    if (isListingPage && !prevIsListingPage) {
      setPanelCollapsed(false)
    }
  }

  // Debug drawer — surfaces the most recent extraction round-trip so the
  // user (and I) can see exactly *why* a listing failed instead of guessing.
  // Toggled with ⌘⇧D. Polls the main process when open so it auto-refreshes
  // as new analyses run.
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown> | null>(null)

  // ⌘L / Ctrl-L — focus the URL bar, like every real browser.
  // ⌘⇧D — toggle the extraction debug drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault()
        const el = urlInputRef.current
        if (el) { el.focus(); el.select() }
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault()
        setDebugOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!debugOpen || !window.electronAPI?.extractDebug) return
    let alive = true
    const tick = () => {
      window.electronAPI!.extractDebug!().then((info) => {
        if (alive) setDebugInfo(info)
      }).catch(() => {})
    }
    tick()
    const id = window.setInterval(tick, 800)
    return () => { alive = false; window.clearInterval(id) }
  }, [debugOpen])

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
        const r = result as ExtractResult
        if (!r.ok) {
          setAnalysis(null)
          // Map the error code to the calm in-panel idle hint.
          const code = r.errorCode
          if (code === "captcha")              setIdleHint("captcha")
          else if (code === "search_results_page") setIdleHint("search_results_page")
          else if (code === "no_signals")       setIdleHint("no_signals")
          else if (code === "low_confidence" || code === "schema_too_complex") setIdleHint("low_confidence")
          else if (code === "page_too_short")   setIdleHint("page_too_short")
          else if (code === "network")          setIdleHint("network")
          else if (code === "no_key")           setIdleHint("no_key")
          else                                  setIdleHint("low_confidence")
          return
        }
        const next = buildAnalysisFromExtract(r, currentUrl)
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
      await window.electronAPI?.createBrowser(calcBounds(sidebarOpen, panelWidth))
      setBrowserActive(true)
    }
    await window.electronAPI?.navigate(url)
    setUrlEditing(false)
  }, [browserActive, sidebarOpen, panelWidth])

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

        {/* Right: side panel — slides between expanded (440px) and a thin
            collapsed strip (36px). The transition runs at 180ms ease-out
            and the BrowserView bounds resize in lockstep (see sendBounds
            useEffect above). */}
        <div
          className="shrink-0 flex flex-col border-l border-border rv-surface-1 overflow-hidden"
          style={{
            width: panelWidth,
            transition: "width 180ms cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          {panelCollapsed ? (
            <CollapsedPanelStrip
              isListingPage={isListingPage}
              isLoading={analysisLoading}
              hasAnalysis={analysis != null}
              onExpand={() => setPanelCollapsed(false)}
            />
          ) : (
            <>
              {/* Expanded header — collapse toggle + status pip */}
              <div className="shrink-0 flex items-center h-9 px-2 border-b border-white/[0.04]">
                <button
                  type="button"
                  onClick={() => setPanelCollapsed(true)}
                  className="h-7 w-7 rounded-md flex items-center justify-center rv-t3 hover:rv-t1 hover:bg-white/[0.04] transition-colors"
                  aria-label="Collapse panel"
                  title="Collapse panel"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <div className="flex-1" />
                <PanelStatusPip
                  isListingPage={isListingPage}
                  isLoading={analysisLoading}
                  hasAnalysis={analysis != null}
                />
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
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
                      sourceUrl={currentUrl}
                      inputProvenance={analysis.inputProvenance}
                      take={analysis.take}
                      riskFlags={analysis.riskFlags}
                      listingDetails={analysis.listingDetails}
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
            </>
          )}
        </div>
      </div>
      {debugOpen && (
        <DebugDrawer info={debugInfo} onClose={() => setDebugOpen(false)} />
      )}
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
  | "no_signals"
  | "search_results_page"
  | "network"
  | "no_key"

// ---------------------------------------------------------------------------
// CollapsedPanelStrip — the 36px-wide pin that lives on the right edge when
// the dossier is hidden. Shows a pulsing dot when actively analyzing, a
// solid dot when there's a stored analysis to expand back to, and a static
// hairline glyph otherwise. Click anywhere to expand.
// ---------------------------------------------------------------------------

function CollapsedPanelStrip({
  isListingPage,
  isLoading,
  hasAnalysis,
  onExpand,
}: {
  isListingPage: boolean
  isLoading: boolean
  hasAnalysis: boolean
  onExpand: () => void
}) {
  // Color carries semantic weight: amber while we're actively reading,
  // emerald when the analysis is fresh and you're on the listing it
  // describes, dim otherwise. No marketing blue.
  const dotClass = isLoading
    ? "bg-[var(--rv-live)] animate-pulse"
    : hasAnalysis && isListingPage
    ? "bg-emerald-500/70"
    : hasAnalysis
    ? "bg-white/35"
    : "bg-white/15"

  const tooltip = isLoading
    ? "Analyzing listing"
    : hasAnalysis
    ? "Expand to view dossier"
    : isListingPage
    ? "Listing detected — expand"
    : "No listing on this page"

  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex-1 flex flex-col items-center justify-between py-3 group"
      title={tooltip}
      aria-label={tooltip}
    >
      <ChevronLeft className="h-3.5 w-3.5 rv-t3 group-hover:rv-t1 transition-colors" />
      <div className="flex flex-col items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full transition-colors", dotClass)} />
        <span
          className="font-mono uppercase rv-t3 group-hover:rv-t1 transition-colors"
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontSize: "9px",
            letterSpacing: "0.18em",
          }}
        >
          Real&nbsp;Verdict
        </span>
      </div>
      <span className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// PanelStatusPip — tiny status indicator in the expanded panel header.
// Communicates "live"/"loading"/"idle" without text getting in the way.
// ---------------------------------------------------------------------------

function PanelStatusPip({
  isListingPage,
  isLoading,
  hasAnalysis,
}: {
  isListingPage: boolean
  isLoading: boolean
  hasAnalysis: boolean
}) {
  const dotClass = isLoading
    ? "bg-[var(--rv-live)] animate-pulse"
    : hasAnalysis && isListingPage
    ? "bg-emerald-500/70"
    : hasAnalysis
    ? "bg-white/30"
    : "bg-white/15"

  const label = isLoading
    ? "Analyzing"
    : hasAnalysis && isListingPage
    ? "Live"
    : hasAnalysis
    ? "Saved view"
    : "Standby"

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] uppercase tracking-[0.08em] rv-t3">
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// DebugDrawer — pulls the last extraction round-trip from the main process
// every 800ms while open. Toggled with ⌘⇧D. This is the surface I use to
// see exactly why a listing failed (signal score, model name, raw response,
// stop reason, parse errors) instead of staring at "couldn't read this
// listing." Hidden by default — never shown to end users.
// ---------------------------------------------------------------------------

function DebugDrawer({
  info,
  onClose,
}: {
  info: Record<string, unknown> | null
  onClose: () => void
}) {
  return (
    <div
      className="absolute right-3 top-3 bottom-3 w-[420px] rv-surface-2 border border-white/10 rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
      style={{ fontSize: "11px" }}
    >
      <div className="flex items-center justify-between px-3 h-9 border-b border-white/[0.06] shrink-0">
        <span className="font-mono uppercase tracking-[0.08em] rv-t2 text-[10px]">
          Extract debug · ⌘⇧D
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] rv-t3 hover:rv-t1 transition-colors"
        >
          Close
        </button>
      </div>
      <pre
        className="flex-1 overflow-auto m-0 p-3 font-mono leading-[1.45] rv-t1 whitespace-pre-wrap break-words"
        style={{ fontSize: "10.5px" }}
      >
        {info ? JSON.stringify(info, null, 2) : "Waiting for extraction…"}
      </pre>
    </div>
  )
}

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
      copy: "Navigate to a property listing on any real-estate site to begin.",
    },
    "supported-non-listing": {
      icon: <Search className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Navigate to a listing to see underwriting.",
    },
    "no_signals": {
      icon: <Search className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "This page doesn’t look like a single listing. Open a property page to analyze it.",
    },
    "search_results_page": {
      icon: <Search className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Looks like a search results page. Click into a listing to analyze it.",
    },
    "captcha": {
      icon: <AlertTriangle className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Verify you’re not a robot to continue. The panel will populate once the listing loads.",
    },
    "low_confidence": {
      icon: <Building2 className="h-8 w-8 text-muted-foreground/20" strokeWidth={1.4} />,
      copy: "Couldn’t confidently read this listing — try refreshing or paste the URL.",
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
// WEB MODE — landing page directing users to the desktop app.
//
// The product wedge is "the moment you land on a listing, the panel just
// knows" — that requires an embedded browser, which only the Electron build
// has. Rather than ship a degraded text-input fallback, we route web users
// to the download page. This keeps the product narrative honest and matches
// how Linear / Mercury / Robinhood frame their desktop experiences.
// ---------------------------------------------------------------------------

function WebBrowsePage() {
  return (
    <SidebarInset className="overflow-hidden">
      <header className="drag-region h-14 flex items-center gap-2 border-b border-border px-4 shrink-0 select-none">
        <SidebarTrigger className="-ml-1 no-drag-region" />
        <span className="text-[13px] font-medium rv-t1">Browse</span>
        <span className="ml-3 text-[10px] uppercase tracking-[0.08em] rv-t3">Desktop only</span>
      </header>

      <div className="flex-1 flex items-center justify-center px-8 rv-surface-bg">
        <div className="max-w-[36rem] text-center space-y-6">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full rv-surface-2 border border-white/[0.06]">
            <Globe className="h-5 w-5 rv-t2" strokeWidth={1.5} />
          </div>
          <div className="space-y-3">
            <h1 className="text-[22px] font-semibold rv-t1" style={{ letterSpacing: "-0.02em" }}>
              Browse mode lives in the desktop app.
            </h1>
            <p className="text-[14px] rv-t2 leading-relaxed max-w-[44ch] mx-auto">
              The browse experience reads listings live from any site &mdash;
              Zillow, Redfin, Realtor.com, anywhere &mdash; and underwrites
              them in real time without leaving the page. That requires an
              embedded browser, which only the desktop app ships with.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <a
              href="/download"
              className="inline-flex items-center gap-2 px-4 h-9 rounded-md bg-foreground text-background text-[13px] font-medium hover:opacity-90 transition-opacity"
            >
              Download desktop app
            </a>
            <a
              href="/deals"
              className="inline-flex items-center gap-2 px-4 h-9 rounded-md text-[13px] rv-t2 hover:rv-t1 transition-colors"
            >
              View saved deals
            </a>
          </div>
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
