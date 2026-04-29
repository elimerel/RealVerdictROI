"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Globe,
  MapPin,
  ArrowRight,
  Loader2,
  LayoutList,
  X,
  LayoutGrid,
  Table2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
  AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { normalizeCacheKey, sessionGet, sessionSet } from "@/lib/client-session-cache"
import {
  analyseDeal,
  sanitiseInputs,
  findOfferCeiling,
  DEFAULT_INPUTS,
  type DealAnalysis,
  type DealInputs,
  type OfferCeiling,
  type VerdictTier,
  formatCurrency,
  formatPercent,
} from "@/lib/calculations"
import type { AddressSuggestion } from "@/app/api/address-autocomplete/route"
import type { AiNarrative } from "@/lib/lead-adapter"
import DossierPanel, { type PropertyFacts } from "../_components/DossierPanel"
import { SavedDealCard, type SavedDeal } from "./SavedDealCard"
import {
  annotateFromProvenance,
  worstConfidence,
} from "@/lib/annotated-inputs"
import {
  analyseDistribution,
  renderProbabilisticVerdict,
  offerCeilingConfidenceNote,
  type DistributionResult,
  type ProbabilisticVerdict,
} from "@/lib/distribution-engine"
import type { FieldProvenance } from "@/lib/types"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LISTING_URL_RE =
  /^https?:\/\/(www\.)?(zillow|redfin|realtor|homes|trulia|movoto)\.com\//i
const AUTOFILL_CACHE_NS = "autofill:v4"
const AUTOFILL_CACHE_TTL_MS = 30 * 60 * 1000

const FILTER_PILLS = [
  { label: "All", tier: null },
  { label: "Strong Buy", tier: "excellent" as VerdictTier },
  { label: "Good Deal", tier: "good" as VerdictTier },
  { label: "Fair", tier: "fair" as VerdictTier },
  { label: "Risky", tier: "poor" as VerdictTier },
  { label: "Walk Away", tier: "avoid" as VerdictTier },
] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResolverPayload = {
  address?: string
  inputs: Partial<DealInputs>
  notes: string[]
  warnings: string[]
  facts: Record<string, unknown>
  provenance: Partial<Record<keyof DealInputs, FieldProvenance>>
}

type ResolvedResult = {
  address?: string
  inputs: DealInputs
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  propertyFacts: PropertyFacts
  verdict: VerdictTier
  // Probabilistic enrichment — computed from resolver provenance.
  distribution: DistributionResult | null
  probabilisticVerdict: ProbabilisticVerdict | null
  walkAwayConfidenceNote: string | null
  inputProvenance: Partial<Record<keyof DealInputs, FieldProvenance>>
}

type PendingCard =
  | { kind: "loading"; id: string }
  | { kind: "error"; id: string; message: string; inputText: string }
  | {
      kind: "done"
      id: string
      address?: string
      verdict: VerdictTier
      analysis: DealAnalysis
      walkAway: OfferCeiling | null
      propertyFacts?: PropertyFacts | null
      createdAt: string
      /** Set after the deal is successfully saved — prevents double-save. */
      savedId?: string
      /** True when monthlyRent is zero/near-zero — inputs came back broken from the listing. */
      badInputs?: boolean
      /** True once auto-save has been initiated — hides the manual Save button. */
      autoSaveInitiated?: boolean
      // Probabilistic enrichment fields.
      distribution?: DistributionResult | null
      probabilisticVerdict?: ProbabilisticVerdict | null
      walkAwayConfidenceNote?: string | null
      inputProvenance?: Partial<Record<keyof DealInputs, FieldProvenance>>
    }

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isValidInput(text: string): boolean {
  if (!text.trim()) return false
  if (LISTING_URL_RE.test(text)) return true
  if (/\d/.test(text) && text.trim().length >= 6) return true
  return false
}

function extractPropertyFacts(facts: Record<string, unknown>): PropertyFacts {
  return {
    beds: typeof facts.bedrooms === "number" ? facts.bedrooms : null,
    baths: typeof facts.bathrooms === "number" ? facts.bathrooms : null,
    sqft: typeof facts.squareFeet === "number" ? facts.squareFeet : null,
    yearBuilt: typeof facts.yearBuilt === "number" ? facts.yearBuilt : null,
    propertyType:
      typeof facts.propertyType === "string" ? facts.propertyType : null,
  }
}

// ---------------------------------------------------------------------------
// Loading card skeleton
// ---------------------------------------------------------------------------

function LoadingCard() {
  return (
    <div className="rounded-md border border-border bg-card/50 px-3 py-2.5 animate-pulse flex items-center gap-2.5">
      <div className="h-1.5 w-1.5 rounded-full bg-muted shrink-0" />
      <div className="h-2 bg-muted rounded w-2/3" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error card
// ---------------------------------------------------------------------------

function ErrorCard({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3 border-l-[3px] border-l-red-500">
      <p className="text-sm font-medium text-foreground mb-1">Could not load property</p>
      <p className="text-xs text-red-400 mb-3 leading-relaxed">{message}</p>
      <button
        onClick={onRetry}
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DealsClient({
  deals,
  signedIn,
  isPro,
  supabaseConfigured,
}: {
  deals: SavedDeal[]
  signedIn: boolean
  isPro: boolean
  supabaseConfigured: boolean
}) {
  const router = useRouter()

  // ── View mode ──
  const [viewMode, setViewMode] = useState<"table" | "grid">("table")

  // ── Sort state for comparison table ──
  type SortKey = "address" | "asking" | "walkaway" | "gap" | "cashflow" | "dscr" | "caprate" | "verdict" | "date"
  const [sortKey, setSortKey] = useState<SortKey>("gap")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  // ── Search state ──
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  // ── Deals state ──
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<VerdictTier | null>(null)
  const [pendingCard, setPendingCard] = useState<PendingCard | null>(null)

  // ── Right panel width ──
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState(460)

  // ── Optimistic deletion — deal ids removed in this session before router.refresh()
  const [deletedDealIds, setDeletedDealIds] = useState<Set<string>>(new Set)

  // ── Local narrative cache — holds narratives returned from the API this session.
  //    Takes priority over DB data so the narrative appears immediately when the
  //    route responds, without waiting for router.refresh() to re-fetch the page.
  const [localNarratives, setLocalNarratives] = useState<Map<string, AiNarrative>>(new Map)
  // Tracks deals for which a narrative request is already in-flight this session.
  const narrativeInFlightRef = useRef<Set<string>>(new Set)

  // ── Refs ──
  const formRef = useRef<HTMLFormElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isListingUrl = LISTING_URL_RE.test(query)

  // Panel is open only when a deal with actual data is selected
  const panelOpen = useMemo(() => {
    if (!selectedId) return false
    if (deals.some((d) => d.id === selectedId)) return true
    if (
      pendingCard?.id === selectedId &&
      pendingCard?.kind === "done"
    )
      return true
    return false
  }, [selectedId, deals, pendingCard])

  // ── Track right panel width ──
  useEffect(() => {
    const el = rightPanelRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setPanelWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [panelOpen]) // re-attach when panel opens

  // ── Pre-compute analysis for all saved deals ──
  const dealData = useMemo(() => {
    const map = new Map<
      string,
      { analysis: DealAnalysis; walkAway: OfferCeiling | null }
    >()
    for (const deal of deals) {
      try {
        const inputs = sanitiseInputs(deal.inputs)
        const analysis = analyseDeal(inputs)
        const walkAway = (() => {
          try {
            return findOfferCeiling(inputs)
          } catch {
            return null
          }
        })()
        map.set(deal.id, { analysis, walkAway })
      } catch {
        // skip malformed deal rows
      }
    }
    return map
  }, [deals])

  // ── Derive data for AnalysisPanel from the selected deal ──
  const panelData = useMemo(() => {
    if (!selectedId) return null

    // Pending done card
    if (
      pendingCard &&
      pendingCard.id === selectedId &&
      pendingCard.kind === "done"
    ) {
      // Show the narrative immediately once the auto-save + narrative response
      // has come back, keyed by the saved deal id stamped onto the pending card.
      const narrative = pendingCard.savedId
        ? (localNarratives.get(pendingCard.savedId) ?? null)
        : null
      return {
        analysis: pendingCard.analysis,
        walkAway: pendingCard.walkAway,
        inputs: pendingCard.analysis.inputs,
        address: pendingCard.address,
        propertyFacts: pendingCard.propertyFacts ?? undefined,
        savedDealId: pendingCard.savedId,
        ai_narrative: narrative,
        badInputs: pendingCard.badInputs ?? false,
        autoSaveInitiated: pendingCard.autoSaveInitiated ?? false,
        isPending: true,
        distribution: pendingCard.distribution ?? null,
        probabilisticVerdict: pendingCard.probabilisticVerdict ?? null,
        walkAwayConfidenceNote: pendingCard.walkAwayConfidenceNote ?? null,
        inputProvenance: pendingCard.inputProvenance ?? null,
      }
    }

    // Saved deal
    const deal = deals.find((d) => d.id === selectedId)
    if (deal) {
      const computed = dealData.get(deal.id)
      if (!computed) return null
      // Prefer in-session cache (populated immediately when the route responds)
      // over the DB value that only arrives after router.refresh().
      const narrative = localNarratives.get(deal.id) ?? deal.ai_narrative ?? null
      return {
        analysis: computed.analysis,
        walkAway: computed.walkAway,
        inputs: computed.analysis.inputs,
        address: deal.address ?? undefined,
        propertyFacts: deal.property_facts ?? undefined,
        savedDealId: deal.id,
        ai_narrative: narrative,
        badInputs: false,
        autoSaveInitiated: false,
        isPending: false,
        // Saved deals don't have per-field provenance stored in the DB yet.
        // Distribution and confidence indicators are only shown for fresh analyses.
        distribution: null,
        probabilisticVerdict: null,
        walkAwayConfidenceNote: null,
        inputProvenance: null,
      }
    }

    return null
  }, [selectedId, pendingCard, deals, dealData, localNarratives])

  // ── Fire save + narrative for a resolved result (auto-save path) ──
  const autoSaveAnalysis = useCallback(
    async (pendingId: string, result: ResolvedResult) => {
      try {
        const res = await fetch("/api/deals/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputs: result.analysis.inputs,
            address: result.address,
            propertyFacts: result.propertyFacts,
          }),
        })
        if (!res.ok) {
          // Reset flag so the manual save button reappears as a fallback.
          setPendingCard((prev) =>
            prev?.kind === "done" && prev.id === pendingId
              ? { ...prev, autoSaveInitiated: false }
              : prev
          )
          return
        }
        const saved = (await res.json()) as { id?: string }
        if (!saved.id) return

        const savedId = saved.id
        setPendingCard((prev) =>
          prev?.kind === "done" && prev.id === pendingId
            ? { ...prev, savedId }
            : prev
        )

        // Generate narrative immediately now that we have a dealId.
        narrativeInFlightRef.current.add(savedId)
        fetch("/api/deals/narrative", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealId: savedId,
            analysis: result.analysis,
            inputs: result.analysis.inputs,
            walkAway: result.walkAway,
            address: result.address,
          }),
        })
          .then(async (narrativeRes) => {
            narrativeInFlightRef.current.delete(savedId)
            if (narrativeRes.ok) {
              const data = (await narrativeRes.json()) as { narrative?: AiNarrative }
              if (data.narrative) {
                setLocalNarratives((prev) => new Map(prev).set(savedId, data.narrative!))
              }
            }
          })
          .catch(() => {
            narrativeInFlightRef.current.delete(savedId)
          })

        router.refresh()
      } catch {
        // Auto-save failed silently — reset flag so manual save button reappears.
        setPendingCard((prev) =>
          prev?.kind === "done" && prev.id === pendingId
            ? { ...prev, autoSaveInitiated: false }
            : prev
        )
      }
    },
    [router]
  )

  // ── Manual save — only reachable when auto-save didn't run (not signed in / not pro) ──
  const [isSaving, setIsSaving] = useState(false)
  const handleSave = useCallback(async () => {
    if (
      isSaving ||
      !pendingCard ||
      pendingCard.kind !== "done" ||
      pendingCard.id !== selectedId ||
      pendingCard.savedId
    )
      return
    if (!signedIn) {
      router.push("/login?mode=signup&redirect=/deals")
      return
    }
    if (!isPro) {
      router.push("/pricing?redirect=/deals")
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: pendingCard.analysis.inputs,
          address: pendingCard.address,
          propertyFacts: pendingCard.propertyFacts,
        }),
      })
      if (!res.ok) return
      const saved = (await res.json()) as { id?: string }
      if (saved.id) {
        setPendingCard((prev) =>
          prev?.kind === "done" ? { ...prev, savedId: saved.id } : prev
        )
        const narrativeDealId = saved.id
        narrativeInFlightRef.current.add(narrativeDealId)
        fetch("/api/deals/narrative", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealId: narrativeDealId,
            analysis: pendingCard.analysis,
            inputs: pendingCard.analysis.inputs,
            walkAway: pendingCard.walkAway,
            address: pendingCard.address,
          }),
        })
          .then(async (res) => {
            narrativeInFlightRef.current.delete(narrativeDealId)
            if (res.ok) {
              const data = (await res.json()) as { narrative?: AiNarrative }
              if (data.narrative) {
                setLocalNarratives((prev) => new Map(prev).set(narrativeDealId, data.narrative!))
              }
            }
          })
          .catch(() => {
            narrativeInFlightRef.current.delete(narrativeDealId)
          })
      }
      router.refresh()
    } catch {
      // save failed silently — user can retry
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, pendingCard, selectedId, signedIn, isPro, router])

  // ── Delete a saved deal ──
  const handleDelete = useCallback(
    async (id: string) => {
      // Optimistically hide the card and close the panel immediately.
      setDeletedDealIds((prev) => new Set(prev).add(id))
      if (selectedId === id) setSelectedId(null)
      try {
        await fetch(`/api/deals/${id}`, { method: "DELETE" })
      } catch {
        // non-critical — the router.refresh() below will reconcile state
      }
      router.refresh()
    },
    [selectedId, router]
  )

  // ── Select a saved deal, triggering background narrative if needed ──
  const handleSelectSavedDeal = useCallback(
    (deal: SavedDeal, computed: { analysis: DealAnalysis; walkAway: OfferCeiling | null }) => {
      setSelectedId(deal.id)

      // Skip if we already have a good narrative in the local session cache.
      const cached = localNarratives.get(deal.id)
      if (cached?.opportunity?.trim() && cached?.risk?.trim()) {
        return
      }

      // Skip if a request for this deal is already in-flight.
      if (narrativeInFlightRef.current.has(deal.id)) {
        return
      }

      // Generate (or re-generate) the narrative when:
      //  - it has never been generated (ai_narrative is null), OR
      //  - it exists but opportunity/risk are empty (stale/fallback narratives)
      const needsNarrative =
        !deal.ai_narrative ||
        !deal.ai_narrative.opportunity?.trim() ||
        !deal.ai_narrative.risk?.trim()

      if (needsNarrative) {
        narrativeInFlightRef.current.add(deal.id)
        fetch("/api/deals/narrative", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealId: deal.id,
            analysis: computed.analysis,
            inputs: computed.analysis.inputs,
            walkAway: computed.walkAway,
            address: deal.address,
          }),
        })
          .then(async (res) => {
            narrativeInFlightRef.current.delete(deal.id)
            if (res.ok) {
              const data = (await res.json()) as { narrative?: AiNarrative }
              if (data.narrative) {
                setLocalNarratives((prev) => new Map(prev).set(deal.id, data.narrative!))
              }
              router.refresh()
            }
          })
          .catch(() => {
            narrativeInFlightRef.current.delete(deal.id)
          })
      }
    },
    [router, localNarratives]
  )

  // ── Filtered saved deals — exclude optimistically deleted and apply verdict filter ──
  const filteredDeals = useMemo(() => {
    const live = deals.filter((d) => !deletedDealIds.has(d.id))
    if (activeFilter === null) return live
    return live.filter((d) => d.verdict === activeFilter)
  }, [deals, activeFilter, deletedDealIds])

  // ── Sorted table rows ──
  const tierRank: Record<string, number> = { excellent: 5, good: 4, fair: 3, poor: 2, avoid: 1 }

  const sortedTableRows = useMemo(() => {
    const rows = filteredDeals.map((d) => {
      const computed = dealData.get(d.id)
      if (!computed) return null
      const walkAwayPrice = computed.walkAway?.recommendedCeiling?.price ?? null
      const gap = walkAwayPrice != null ? walkAwayPrice - d.inputs.purchasePrice : null
      return { deal: d, computed, walkAwayPrice, gap }
    }).filter((r): r is NonNullable<typeof r> => r !== null)

    rows.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case "address":
          cmp = (a.deal.address ?? "").localeCompare(b.deal.address ?? "")
          break
        case "asking":
          cmp = (a.deal.inputs.purchasePrice ?? 0) - (b.deal.inputs.purchasePrice ?? 0)
          break
        case "walkaway":
          cmp = (a.walkAwayPrice ?? -Infinity) - (b.walkAwayPrice ?? -Infinity)
          break
        case "gap":
          cmp = (a.gap ?? -Infinity) - (b.gap ?? -Infinity)
          break
        case "cashflow":
          cmp = a.computed.analysis.monthlyCashFlow - b.computed.analysis.monthlyCashFlow
          break
        case "dscr":
          cmp = (isFinite(a.computed.analysis.dscr) ? a.computed.analysis.dscr : 999)
              - (isFinite(b.computed.analysis.dscr) ? b.computed.analysis.dscr : 999)
          break
        case "caprate":
          cmp = a.computed.analysis.capRate - b.computed.analysis.capRate
          break
        case "verdict":
          cmp = (tierRank[a.deal.verdict] ?? 0) - (tierRank[b.deal.verdict] ?? 0)
          break
        case "date":
          cmp = new Date(a.deal.created_at).getTime() - new Date(b.deal.created_at).getTime()
          break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
    return rows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredDeals, dealData, sortKey, sortDir])

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("asc") }
  }, [sortKey])

  // ── Address autocomplete ──
  useEffect(() => {
    if (isListingUrl || query.length < 4) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/address-autocomplete?q=${encodeURIComponent(query)}`
        )
        if (res.ok) {
          const data = (await res.json()) as AddressSuggestion[]
          setSuggestions(data)
          setShowSuggestions(data.length > 0)
          setActiveSuggestion(-1)
        }
      } catch {
        /* non-critical */
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, isListingUrl])

  // Close autocomplete on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // ── Submit helpers ──

  // Returns resolved + computed data; does not touch state.
  const resolveAndAnalyze = useCallback(
    async (text: string): Promise<ResolvedResult> => {
      const cacheId = normalizeCacheKey(text)
      const cached = sessionGet<ResolverPayload>(AUTOFILL_CACHE_NS, cacheId)

      let payload: ResolverPayload
      if (cached) {
        payload = cached
      } else {
        let res: Response
        if (LISTING_URL_RE.test(text)) {
          res = await fetch("/api/property-resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: text }),
          })
        } else {
          res = await fetch(
            `/api/property-resolve?address=${encodeURIComponent(text)}`
          )
        }

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string
            error?: string
          }
          throw new Error(
            (typeof body?.message === "string" && body.message) ||
              (typeof body?.error === "string" && body.error.length < 120
                ? body.error
                : null) ||
              "Couldn't resolve that property. Try again or fill inputs manually."
          )
        }

        payload = (await res.json()) as ResolverPayload
        sessionSet(AUTOFILL_CACHE_NS, cacheId, payload, AUTOFILL_CACHE_TTL_MS)
      }

      const merged: DealInputs = { ...DEFAULT_INPUTS, ...payload.inputs }
      const inputs = sanitiseInputs(merged)
      const analysis = analyseDeal(inputs)
      const walkAway = (() => {
        try {
          return findOfferCeiling(inputs)
        } catch {
          return null
        }
      })()

      // Build annotated inputs from the provenance the resolver already returns,
      // then run the distribution engine over them.
      const inputProvenance = payload.provenance ?? {}
      let distribution: DistributionResult | null = null
      let probabilisticVerdict: ProbabilisticVerdict | null = null
      let walkAwayConfidenceNote: string | null = null
      try {
        const annotated = annotateFromProvenance(inputs, inputProvenance)
        distribution = analyseDistribution(annotated)
        probabilisticVerdict = renderProbabilisticVerdict(
          distribution,
          worstConfidence(annotated),
        )
        const rentProv = inputProvenance.monthlyRent
        if (rentProv) {
          walkAwayConfidenceNote = offerCeilingConfidenceNote(
            rentProv.confidence,
            rentProv.source,
          )
        }
      } catch {
        // Distribution is additive — if it throws, the deterministic
        // analysis still renders normally with no probabilistic data.
      }

      return {
        address: payload.address,
        inputs,
        analysis,
        walkAway,
        propertyFacts: extractPropertyFacts(payload.facts ?? {}),
        verdict: analysis.verdict.tier,
        distribution,
        probabilisticVerdict,
        walkAwayConfidenceNote,
        inputProvenance,
      }
    },
    []
  )

  const submitSearch = useCallback(
    async (text: string) => {
      if (!isValidInput(text)) {
        setSearchError("Enter a street address or a listing URL.")
        return
      }
      setSearchError(null)
      setIsSearching(true)
      setShowSuggestions(false)

      const pendingId = `pending-${Date.now()}`
      setPendingCard({ kind: "loading", id: pendingId })
      setSelectedId(pendingId)

      try {
        const result = await resolveAndAnalyze(text)

        // Sanity check: a valid purchase price with zero/near-zero rent means the
        // listing scrape didn't get usable data. These analyses produce nonsense
        // metrics and should never be auto-saved.
        const badInputs =
          result.inputs.purchasePrice > 10_000 && result.inputs.monthlyRent < 100

        // Auto-save immediately if inputs look valid and the user can save.
        const shouldAutoSave =
          !badInputs && signedIn && isPro && supabaseConfigured

        setPendingCard({
          kind: "done",
          id: pendingId,
          address: result.address,
          verdict: result.verdict,
          analysis: result.analysis,
          walkAway: result.walkAway,
          propertyFacts: result.propertyFacts,
          createdAt: new Date().toISOString(),
          badInputs,
          autoSaveInitiated: shouldAutoSave,
          distribution: result.distribution,
          probabilisticVerdict: result.probabilisticVerdict,
          walkAwayConfidenceNote: result.walkAwayConfidenceNote,
          inputProvenance: result.inputProvenance,
        })
        setSelectedId(pendingId)

        if (shouldAutoSave) {
          autoSaveAnalysis(pendingId, result)
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong. Try again."
        setPendingCard({ kind: "error", id: pendingId, message, inputText: text })
        setSearchError(null)
      } finally {
        setIsSearching(false)
      }
    },
    [resolveAndAnalyze, signedIn, isPro, supabaseConfigured, autoSaveAnalysis]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submitSearch(query.trim())
  }

  const handleSuggestionSelect = (s: AddressSuggestion) => {
    setQuery(s.label)
    setShowSuggestions(false)
    submitSearch(s.label)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveSuggestion((i) => Math.max(i - 1, -1))
    } else if (e.key === "Enter" && activeSuggestion >= 0) {
      e.preventDefault()
      const s = suggestions[activeSuggestion]
      if (s) handleSuggestionSelect(s)
    } else if (e.key === "Escape") {
      setShowSuggestions(false)
    }
  }

  // ── Pending card grid visibility ──
  const showPendingInGrid =
    pendingCard !== null &&
    (pendingCard.kind === "loading" ||
      pendingCard.kind === "error" ||
      (pendingCard.kind === "done" &&
        (activeFilter === null || pendingCard.verdict === activeFilter)))

  const hasDeals = deals.length > 0 || pendingCard !== null

  // ── Render ──

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-background">

      {/* ═══════════════════════════════════════════════
          LEFT ZONE — search + filter + grid
      ═══════════════════════════════════════════════ */}
      <div
        className={cn(
          "flex flex-col transition-all duration-200 overflow-hidden",
          "border-r border-border",
          panelOpen ? "w-[340px] shrink-0" : "flex-1"
        )}
      >
        {/* Search bar */}
        <div className="shrink-0 p-3 border-b border-border">
          <form ref={formRef} onSubmit={handleSubmit} className="relative">
            <div
              className={cn(
                "flex items-center gap-2 rounded-md border bg-card px-3 py-2 transition-colors",
                searchError
                  ? "border-amber-500/50"
                  : "border-border focus-within:border-border/60"
              )}
            >
              {isListingUrl ? (
                <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSearchError(null)
                }}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Zillow URL or address…"
                disabled={isSearching}
                className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!query.trim() || isSearching}
                className="shrink-0 flex items-center justify-center rounded h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                aria-label="Analyze"
              >
                {isSearching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {/* Error hint */}
            {searchError && (
              <p className="mt-1 px-1 text-[11px] text-amber-500">
                {searchError}
              </p>
            )}

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-card shadow-xl overflow-hidden">
                {suggestions.map((s, i) => (
                  <button
                    key={s.placeId}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSuggestionSelect(s)
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-muted transition-colors",
                      i === activeSuggestion && "bg-muted",
                      i < suggestions.length - 1 && "border-b border-border"
                    )}
                  >
                    <span className="text-xs font-medium">{s.primary}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {s.secondary}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>

        {/* Filter pills + view toggle — hidden when no deals */}
        {hasDeals && (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b border-border overflow-x-auto whitespace-nowrap scrollbar-hide">
            {FILTER_PILLS.map(({ label, tier }) => {
              const isActive = activeFilter === tier
              return (
                <button
                  key={label}
                  onClick={() => setActiveFilter(tier)}
                  className={cn(
                    "shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors duration-150",
                    isActive
                      ? "bg-foreground text-background border-foreground"
                      : "bg-transparent text-muted-foreground border-border hover:border-border/60 hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              )
            })}

            {/* Spacer */}
            <div className="flex-1" />

            {/* View toggle */}
            <div className="flex items-center gap-0.5 shrink-0 rounded-md border border-border p-0.5">
              <button
                onClick={() => setViewMode("table")}
                className={cn(
                  "h-5 w-5 flex items-center justify-center rounded text-muted-foreground transition-colors",
                  viewMode === "table" ? "bg-muted text-foreground" : "hover:text-foreground"
                )}
                title="Comparison table"
              >
                <Table2 className="h-3 w-3" />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "h-5 w-5 flex items-center justify-center rounded text-muted-foreground transition-colors",
                  viewMode === "grid" ? "bg-muted text-foreground" : "hover:text-foreground"
                )}
                title="Card grid"
              >
                <LayoutGrid className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Content area: empty state, comparison table, or card grid */}
        {!hasDeals ? (
          <EmptyPipeline />
        ) : viewMode === "table" ? (
          <div className="flex-1 overflow-auto">
            <ComparisonTable
              rows={sortedTableRows}
              pendingCard={pendingCard}
              showPendingInGrid={showPendingInGrid}
              selectedId={selectedId}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              onSelectDeal={(id) => {
                const deal = filteredDeals.find((d) => d.id === id)
                const computed = dealData.get(id)
                if (deal && computed) handleSelectSavedDeal(deal, computed)
                else setSelectedId(id)
              }}
              onSelectPending={(id) => setSelectedId(id)}
              onDelete={handleDelete}
              onRetry={(text) => submitSearch(text)}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div
              className={cn(
                "grid gap-2 p-3",
                panelOpen ? "grid-cols-1" : "grid-cols-2"
              )}
            >
              {/* Pending card */}
              {showPendingInGrid && pendingCard && (
                <div
                  key={pendingCard.id}
                  onClick={() =>
                    pendingCard.kind !== "loading" &&
                    setSelectedId(pendingCard.id)
                  }
                  className={cn(
                    pendingCard.kind === "loading" && "cursor-default",
                    pendingCard.kind !== "loading" && "cursor-pointer"
                  )}
                >
                  {pendingCard.kind === "loading" && <LoadingCard />}
                  {pendingCard.kind === "error" && (
                    <ErrorCard
                      message={pendingCard.message}
                      onRetry={() => submitSearch(pendingCard.inputText)}
                    />
                  )}
                  {pendingCard.kind === "done" && (
                    <SavedDealCard
                      address={pendingCard.address ?? null}
                      verdict={pendingCard.verdict}
                      analysis={pendingCard.analysis}
                      walkAway={pendingCard.walkAway}
                      propertyFacts={pendingCard.propertyFacts}
                      createdAt={pendingCard.createdAt}
                      isSelected={selectedId === pendingCard.id}
                      onSelect={() => setSelectedId(pendingCard.id)}
                    />
                  )}
                </div>
              )}

              {/* Saved deal cards */}
              {filteredDeals.map((deal) => {
                const computed = dealData.get(deal.id)
                if (!computed) return null
                return (
                  <SavedDealCard
                    key={deal.id}
                    address={deal.address}
                    verdict={deal.verdict as VerdictTier}
                    analysis={computed.analysis}
                    walkAway={computed.walkAway}
                    propertyFacts={deal.property_facts}
                    createdAt={deal.created_at}
                    isSelected={selectedId === deal.id}
                    onSelect={() => handleSelectSavedDeal(deal, computed)}
                    onDelete={() => handleDelete(deal.id)}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════
          RIGHT ZONE — AnalysisPanel
      ═══════════════════════════════════════════════ */}
      <div
        className={cn(
          "transition-all duration-200 overflow-hidden relative",
          panelOpen ? "flex-1" : "w-0"
        )}
      >
        {panelOpen && panelData && (
          <div ref={rightPanelRef} className="h-full w-full overflow-hidden">
            {/* Close button */}
            <button
              onClick={() => setSelectedId(null)}
              className="absolute top-3 right-3 z-20 flex items-center justify-center h-7 w-7 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
              aria-label="Close panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <DossierPanel
              analysis={panelData.analysis}
              walkAway={panelData.walkAway}
              inputs={panelData.inputs}
              address={panelData.address}
              propertyFacts={panelData.propertyFacts}
              ai_narrative={panelData.ai_narrative}
              badInputs={panelData.badInputs}
              savedDealId={panelData.savedDealId}
              isSaving={panelData.isPending ? isSaving : false}
              signedIn={signedIn}
              isPro={isPro}
              supabaseConfigured={supabaseConfigured}
              panelWidth={panelWidth}
              distribution={panelData.distribution}
              probabilisticVerdict={panelData.probabilisticVerdict}
              walkAwayConfidenceNote={panelData.walkAwayConfidenceNote}
              inputProvenance={panelData.inputProvenance}
              onSave={
                panelData.isPending &&
                !panelData.autoSaveInitiated &&
                !panelData.savedDealId
                  ? handleSave
                  : undefined
              }
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyPipeline — no deals yet
// ---------------------------------------------------------------------------

function EmptyPipeline() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="h-20 w-20 rounded-2xl bg-white/3 border border-white/8 flex items-center justify-center">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          {/* Three stacked property bars — comparison surface illustration */}
          <rect x="4"  y="28" width="10" height="8" rx="1" fill="currentColor" className="text-white/10" />
          <rect x="15" y="20" width="10" height="16" rx="1" fill="currentColor" className="text-white/15" />
          <rect x="26" y="14" width="10" height="22" rx="1" fill="currentColor" className="text-white/20" />
          {/* Green signal on best bar */}
          <circle cx="31" cy="10" r="3" fill="#22c55e" opacity="0.7" />
        </svg>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">No deals in your Pipeline</p>
        <p className="text-[13px] text-muted-foreground leading-relaxed max-w-xs">
          Analyze a property on the Research page, or paste a Zillow URL or address in the search bar above.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ComparisonTable — side-by-side metrics for all saved deals
// ---------------------------------------------------------------------------

type TableRow = {
  deal: SavedDeal
  computed: { analysis: DealAnalysis; walkAway: OfferCeiling | null }
  walkAwayPrice: number | null
  gap: number | null
}

const TIER_ACCENT_MAP: Record<string, string> = {
  excellent: "#22c55e",
  good:      "#4ade80",
  fair:      "#eab308",
  poor:      "#f97316",
  avoid:     "#ef4444",
}

const TIER_LABEL_MAP: Record<string, string> = {
  excellent: "STRONG BUY",
  good:      "GOOD DEAL",
  fair:      "BORDERLINE",
  poor:      "PASS",
  avoid:     "AVOID",
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-30" />
  return dir === "asc"
    ? <ArrowUp   className="h-3 w-3 text-[oklch(0.62_0.22_265)]" />
    : <ArrowDown className="h-3 w-3 text-[oklch(0.62_0.22_265)]" />
}

type SortKey = "address" | "asking" | "walkaway" | "gap" | "cashflow" | "dscr" | "caprate" | "verdict" | "date"

function Th({
  label,
  sortKey: sk,
  activeSortKey,
  sortDir,
  onToggle,
  align = "right",
}: {
  label: string
  sortKey: SortKey
  activeSortKey: SortKey
  sortDir: "asc" | "desc"
  onToggle: (k: SortKey) => void
  align?: "left" | "right"
}) {
  const active = activeSortKey === sk
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50 whitespace-nowrap",
        align === "right" ? "text-right" : "text-left",
        "cursor-pointer hover:text-muted-foreground transition-colors select-none"
      )}
      onClick={() => onToggle(sk)}
    >
      <span className="inline-flex items-center gap-1">
        {align === "left" ? (
          <><SortIcon active={active} dir={sortDir} />{label}</>
        ) : (
          <>{label}<SortIcon active={active} dir={sortDir} /></>
        )}
      </span>
    </th>
  )
}

function ComparisonTable({
  rows,
  pendingCard,
  showPendingInGrid,
  selectedId,
  sortKey,
  sortDir,
  onToggleSort,
  onSelectDeal,
  onSelectPending,
  onDelete,
  onRetry,
}: {
  rows: TableRow[]
  pendingCard: PendingCard | null
  showPendingInGrid: boolean
  selectedId: string | null
  sortKey: SortKey
  sortDir: "asc" | "desc"
  onToggleSort: (k: SortKey) => void
  onSelectDeal: (id: string) => void
  onSelectPending: (id: string) => void
  onDelete: (id: string) => void
  onRetry: (text: string) => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  return (
    <div className="min-w-0">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/6 bg-muted/20 sticky top-0 z-10">
            <Th label="Property"  sortKey="address"  activeSortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} align="left" />
            <Th label="Asking"    sortKey="asking"   activeSortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
            <Th label="Walk-Away" sortKey="walkaway" activeSortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
            <Th label="Gap"       sortKey="gap"      activeSortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
            <Th label="CF/mo"     sortKey="cashflow" activeSortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
            <Th label="DSCR"      sortKey="dscr"     activeSortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
            <Th label="Cap"       sortKey="caprate"  activeSortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
            <Th label="Verdict"   sortKey="verdict"  activeSortKey={sortKey} sortDir={sortDir} onToggle={onToggleSort} />
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {/* Pending card row */}
          {showPendingInGrid && pendingCard && (
            <PendingRow
              card={pendingCard}
              isSelected={selectedId === pendingCard.id}
              onSelect={() => pendingCard.kind !== "loading" && onSelectPending(pendingCard.id)}
              onRetry={onRetry}
            />
          )}

          {/* Saved deal rows */}
          {rows.map(({ deal, computed, walkAwayPrice, gap }) => {
            const accent   = TIER_ACCENT_MAP[deal.verdict] ?? "#888"
            const cf       = computed.analysis.monthlyCashFlow
            const dscr     = computed.analysis.dscr
            const capRate  = computed.analysis.capRate
            const isSelected = selectedId === deal.id
            const isDeleting = confirmingDelete === deal.id

            return (
              <tr
                key={deal.id}
                onClick={() => { if (!isDeleting) onSelectDeal(deal.id) }}
                className={cn(
                  "border-b border-white/4 cursor-pointer transition-colors group",
                  isSelected
                    ? "bg-white/6"
                    : "hover:bg-white/3"
                )}
                style={isSelected ? { borderLeft: `3px solid ${accent}` } : { borderLeft: "3px solid transparent" }}
              >
                {/* Address */}
                <td className="px-3 py-3 max-w-[180px]">
                  <p className="text-[13px] font-medium text-foreground truncate">
                    {deal.address ?? "Unknown address"}
                  </p>
                  {deal.property_facts && (
                    <p className="text-[10px] text-muted-foreground/50 font-mono mt-0.5">
                      {[
                        deal.property_facts.beds   != null && `${deal.property_facts.beds}bd`,
                        deal.property_facts.baths  != null && `${deal.property_facts.baths}ba`,
                        deal.property_facts.sqft   != null && `${(deal.property_facts.sqft / 1000).toFixed(1)}k sqft`,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </td>

                {/* Asking */}
                <td className="px-3 py-3 text-right">
                  <span className="text-[13px] font-mono tabular-nums text-muted-foreground">
                    {formatCurrency(deal.inputs.purchasePrice, 0)}
                  </span>
                </td>

                {/* Walk-away */}
                <td className="px-3 py-3 text-right">
                  <span className="text-[13px] font-mono tabular-nums font-semibold text-foreground">
                    {walkAwayPrice != null ? formatCurrency(walkAwayPrice, 0) : "—"}
                  </span>
                </td>

                {/* Gap */}
                <td className="px-3 py-3 text-right">
                  {gap != null ? (
                    <span
                      className={cn(
                        "text-[13px] font-mono tabular-nums font-semibold",
                        gap >= 0 ? "text-emerald-400" : "text-amber-400"
                      )}
                    >
                      {gap >= 0 ? "+" : ""}{formatCurrency(gap, 0)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/30 text-[13px]">—</span>
                  )}
                </td>

                {/* Cash flow */}
                <td className="px-3 py-3 text-right">
                  <span
                    className={cn(
                      "text-[13px] font-mono tabular-nums",
                      cf >= 0 ? "text-emerald-400" : "text-red-400"
                    )}
                  >
                    {cf >= 0 ? "+" : ""}{formatCurrency(cf, 0)}
                  </span>
                </td>

                {/* DSCR */}
                <td className="px-3 py-3 text-right">
                  <span
                    className={cn(
                      "text-[13px] font-mono tabular-nums",
                      !isFinite(dscr) || dscr >= 1.25 ? "text-foreground/80" :
                      dscr >= 1.0 ? "text-amber-400" : "text-red-400"
                    )}
                  >
                    {isFinite(dscr) ? dscr.toFixed(2) : "∞"}
                  </span>
                </td>

                {/* Cap rate */}
                <td className="px-3 py-3 text-right">
                  <span className="text-[13px] font-mono tabular-nums text-foreground/80">
                    {formatPercent(capRate, 1)}
                  </span>
                </td>

                {/* Verdict */}
                <td className="px-3 py-3 text-right">
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded"
                    style={{ color: accent, backgroundColor: `${accent}18` }}
                  >
                    {TIER_LABEL_MAP[deal.verdict] ?? deal.verdict}
                  </span>
                </td>

                {/* Delete */}
                <td className="px-2 py-3">
                  {isDeleting ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmingDelete(null); onDelete(deal.id) }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/80 text-white hover:bg-red-500 transition-colors"
                      >
                        Rm
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmingDelete(null) }}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmingDelete(deal.id) }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {rows.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground/40">
          No deals match the current filter.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pending row in the comparison table
// ---------------------------------------------------------------------------

function PendingRow({
  card,
  isSelected,
  onSelect,
  onRetry,
}: {
  card: PendingCard
  isSelected: boolean
  onSelect: () => void
  onRetry: (text: string) => void
}) {
  if (card.kind === "loading") {
    return (
      <tr className="border-b border-white/4">
        <td colSpan={9} className="px-3 py-3">
          <div className="flex items-center gap-2 text-muted-foreground/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-xs">Analyzing…</span>
          </div>
        </td>
      </tr>
    )
  }

  if (card.kind === "error") {
    return (
      <tr className="border-b border-white/4">
        <td colSpan={9} className="px-3 py-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
            <span className="text-xs text-red-400 flex-1 truncate">{card.message}</span>
            <button
              onClick={() => onRetry(card.inputText)}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </td>
      </tr>
    )
  }

  if (card.kind === "done") {
    const accent   = TIER_ACCENT_MAP[card.verdict] ?? "#888"
    const cf       = card.analysis.monthlyCashFlow
    const dscr     = card.analysis.dscr
    const capRate  = card.analysis.capRate
    const walkAwayPrice = card.walkAway?.recommendedCeiling?.price ?? null
    const gap = walkAwayPrice != null ? walkAwayPrice - card.analysis.inputs.purchasePrice : null

    return (
      <tr
        onClick={onSelect}
        className={cn(
          "border-b border-white/4 cursor-pointer transition-colors group",
          isSelected ? "bg-white/6" : "hover:bg-white/3"
        )}
        style={isSelected ? { borderLeft: `3px solid ${accent}` } : { borderLeft: "3px solid transparent" }}
      >
        <td className="px-3 py-3 max-w-[180px]">
          <p className="text-[13px] font-medium text-foreground truncate">
            {card.address ?? "New analysis"}
          </p>
          <p className="text-[10px] text-muted-foreground/50 font-mono mt-0.5">
            {card.propertyFacts && [
              card.propertyFacts.beds  != null && `${card.propertyFacts.beds}bd`,
              card.propertyFacts.baths != null && `${card.propertyFacts.baths}ba`,
            ].filter(Boolean).join(" · ")}
          </p>
        </td>
        <td className="px-3 py-3 text-right">
          <span className="text-[13px] font-mono tabular-nums text-muted-foreground">
            {formatCurrency(card.analysis.inputs.purchasePrice, 0)}
          </span>
        </td>
        <td className="px-3 py-3 text-right">
          <span className="text-[13px] font-mono tabular-nums font-semibold text-foreground">
            {walkAwayPrice != null ? formatCurrency(walkAwayPrice, 0) : "—"}
          </span>
        </td>
        <td className="px-3 py-3 text-right">
          {gap != null ? (
            <span className={cn("text-[13px] font-mono tabular-nums font-semibold", gap >= 0 ? "text-emerald-400" : "text-amber-400")}>
              {gap >= 0 ? "+" : ""}{formatCurrency(gap, 0)}
            </span>
          ) : <span className="text-muted-foreground/30 text-[13px]">—</span>}
        </td>
        <td className="px-3 py-3 text-right">
          <span className={cn("text-[13px] font-mono tabular-nums", cf >= 0 ? "text-emerald-400" : "text-red-400")}>
            {cf >= 0 ? "+" : ""}{formatCurrency(cf, 0)}
          </span>
        </td>
        <td className="px-3 py-3 text-right">
          <span className={cn("text-[13px] font-mono tabular-nums", !isFinite(dscr) || dscr >= 1.25 ? "text-foreground/80" : dscr >= 1.0 ? "text-amber-400" : "text-red-400")}>
            {isFinite(dscr) ? dscr.toFixed(2) : "∞"}
          </span>
        </td>
        <td className="px-3 py-3 text-right">
          <span className="text-[13px] font-mono tabular-nums text-foreground/80">
            {formatPercent(capRate, 1)}
          </span>
        </td>
        <td className="px-3 py-3 text-right">
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded" style={{ color: accent, backgroundColor: `${accent}18` }}>
            {TIER_LABEL_MAP[card.verdict] ?? card.verdict}
          </span>
        </td>
        <td className="px-2 py-3" />
      </tr>
    )
  }

  return null
}
