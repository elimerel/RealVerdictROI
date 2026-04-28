"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Globe,
  MapPin,
  ArrowRight,
  Loader2,
  LayoutList,
} from "lucide-react"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
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
} from "@/lib/calculations"
import type { AddressSuggestion } from "@/app/api/address-autocomplete/route"
import { SavedDealCard, type SavedDeal } from "./SavedDealCard"
import AnalysisPanel, { type PropertyFacts } from "../_components/AnalysisPanel"

// ---------------------------------------------------------------------------
// Module-level constants and pure helpers
// ---------------------------------------------------------------------------

const LISTING_URL_RE =
  /^https?:\/\/(www\.)?(zillow|redfin|realtor|homes|trulia|movoto)\.com\//i
const AUTOFILL_CACHE_NS = "autofill:v4"
const AUTOFILL_CACHE_TTL_MS = 30 * 60 * 1000

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
// Types
// ---------------------------------------------------------------------------

type ResolverPayload = {
  address?: string
  inputs: Partial<DealInputs>
  notes: string[]
  warnings: string[]
  facts: Record<string, unknown>
  provenance: Record<string, unknown>
}

type PanelContent =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "deal"; deal: SavedDeal }
  | {
      kind: "result"
      analysis: DealAnalysis
      walkAway: OfferCeiling | null
      inputs: DealInputs
      address?: string
      propertyFacts?: PropertyFacts
      savedDealId?: string
    }

// ---------------------------------------------------------------------------
// Loading state shown in the right panel while analysis runs
// ---------------------------------------------------------------------------

function RightPanelLoading() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <p className="text-sm">Fetching property data…</p>
      </div>
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

  // ── Search state ──
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  // ── Right panel state ──
  const [panelContent, setPanelContent] = useState<PanelContent>(
    deals.length > 0 ? { kind: "deal", deal: deals[0] } : { kind: "empty" }
  )
  const [panelWidth, setPanelWidth] = useState(460)

  // ── Refs ──
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isListingUrl = LISTING_URL_RE.test(query)

  // Track right panel width for AnalysisPanel display mode
  useEffect(() => {
    const el = rightPanelRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setPanelWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  // Close autocomplete dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // ── Helpers ──

  const loadFromPayload = useCallback(
    (payload: ResolverPayload) => {
      try {
        const merged: DealInputs = { ...DEFAULT_INPUTS, ...payload.inputs }
        const sanitized = sanitiseInputs(merged)
        console.log("[DealsClient] inputs before analyseDeal:", {
          purchasePrice: sanitized.purchasePrice,
          monthlyRent: sanitized.monthlyRent,
        })
        const analysis = analyseDeal(sanitized)
        const walkAway = (() => {
          try {
            return findOfferCeiling(sanitized)
          } catch {
            return null
          }
        })()
        setPanelContent({
          kind: "result",
          analysis,
          walkAway,
          inputs: sanitized,
          address: payload.address,
          propertyFacts: extractPropertyFacts(payload.facts ?? {}),
        })
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : "Analysis failed."
        )
        setPanelContent({ kind: "empty" })
      }
    },
    []
  )

  // ── Submit logic ──

  const submitSearch = useCallback(
    async (text: string) => {
      if (!isValidInput(text)) {
        setSearchError("Enter a street address or a listing URL.")
        return
      }
      setSearchError(null)
      setIsSearching(true)
      setShowSuggestions(false)

      const cacheId = normalizeCacheKey(text)
      const cached = sessionGet<ResolverPayload>(AUTOFILL_CACHE_NS, cacheId)
      if (cached) {
        loadFromPayload(cached)
        setIsSearching(false)
        return
      }

      setPanelContent({ kind: "loading" })

      // Listing URLs → POST { url }; addresses → GET ?address=
      try {
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
          const payload = (await res.json().catch(() => ({}))) as {
            message?: string
            error?: string
          }
          throw new Error(
            (typeof payload?.message === "string" && payload.message) ||
              (typeof payload?.error === "string" &&
              payload.error.length < 120
                ? payload.error
                : null) ||
              "Couldn't resolve that property. Try again or fill inputs manually."
          )
        }

        const resolved = (await res.json()) as ResolverPayload
        sessionSet(AUTOFILL_CACHE_NS, cacheId, resolved, AUTOFILL_CACHE_TTL_MS)
        loadFromPayload(resolved)
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : "Something went wrong. Try again."
        )
        setPanelContent({ kind: "empty" })
      } finally {
        setIsSearching(false)
      }
    },
    [loadFromPayload]
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

  // Save a freshly-analyzed deal
  const handleSave = useCallback(async () => {
    if (panelContent.kind !== "result") return
    if (!signedIn) {
      router.push("/login?mode=signup&redirect=/deals")
      return
    }
    if (!isPro) {
      router.push("/pricing?redirect=/deals")
      return
    }
    const { inputs, address, propertyFacts } = panelContent
    try {
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, address, propertyFacts }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { id: string }
      setPanelContent((prev) =>
        prev.kind === "result" ? { ...prev, savedDealId: data.id } : prev
      )
      router.refresh()
    } catch {
      // Save failed silently — user can try again
    }
  }, [panelContent, signedIn, isPro, router])

  // ── Derived panel data for AnalysisPanel ──

  const derivedPanelData = useMemo(() => {
    if (panelContent.kind === "deal") {
      const { deal } = panelContent
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
        return {
          analysis,
          walkAway,
          inputs,
          address: deal.address ?? undefined,
          propertyFacts: deal.property_facts ?? undefined,
          savedDealId: deal.id,
          onSave: undefined as undefined,
        }
      } catch {
        return null
      }
    }
    if (panelContent.kind === "result") {
      return {
        analysis: panelContent.analysis,
        walkAway: panelContent.walkAway,
        inputs: panelContent.inputs,
        address: panelContent.address,
        propertyFacts: panelContent.propertyFacts,
        savedDealId: panelContent.savedDealId,
        onSave: handleSave,
      }
    }
    return null
  }, [panelContent, handleSave])

  // ── Render ──

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="h-[calc(100vh-3.5rem)]"
    >
      {/* ── Left panel: search + deal list ── */}
      <ResizablePanel defaultSize={32} minSize={22} maxSize={48}>
        <div className="flex flex-col h-full">

          {/* Search input */}
          <div className="shrink-0 p-3 border-b border-border">
            <form
              ref={formRef}
              onSubmit={handleSubmit}
              className="relative"
            >
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 transition-colors",
                  searchError
                    ? "border-amber-500/50"
                    : "border-border focus-within:border-foreground/20"
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
                <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-card shadow-lg overflow-hidden">
                  {suggestions.map((s, i) => (
                    <button
                      key={s.placeId}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSuggestionSelect(s)
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-muted/60 transition-colors",
                        i === activeSuggestion && "bg-muted/60",
                        i < suggestions.length - 1 &&
                          "border-b border-border/50"
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

          {/* Deal list */}
          {deals.length > 0 ? (
            <ScrollArea className="flex-1">
              <div>
                {deals.map((deal) => (
                  <SavedDealCard
                    key={deal.id}
                    deal={deal}
                    isSelected={
                      panelContent.kind === "deal" &&
                      panelContent.deal.id === deal.id
                    }
                    onSelect={() =>
                      setPanelContent({ kind: "deal", deal })
                    }
                  />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 gap-2 text-center">
              <LayoutList className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No saved deals yet</p>
              <p className="text-xs text-muted-foreground/60">
                Analyze a property above to get started
              </p>
            </div>
          )}
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* ── Right panel: AnalysisPanel / loading / empty ── */}
      <ResizablePanel defaultSize={68} minSize={52}>
        <div ref={rightPanelRef} className="h-full w-full overflow-hidden">
          {panelContent.kind === "loading" ? (
            <RightPanelLoading />
          ) : derivedPanelData ? (
            <AnalysisPanel
              analysis={derivedPanelData.analysis}
              walkAway={derivedPanelData.walkAway}
              address={derivedPanelData.address}
              inputs={derivedPanelData.inputs}
              signedIn={signedIn}
              isPro={isPro}
              supabaseConfigured={supabaseConfigured}
              panelWidth={panelWidth}
              savedDealId={derivedPanelData.savedDealId}
              propertyFacts={derivedPanelData.propertyFacts}
              onSave={derivedPanelData.onSave}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <LayoutList className="h-10 w-10 opacity-20" />
              <p className="text-sm">
                Paste a listing URL or enter an address to analyze
              </p>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
