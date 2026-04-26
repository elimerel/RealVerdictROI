"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, ArrowRight, Building2, MapPin, TrendingUp, Bookmark, ChevronDown } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { normalizeCacheKey, sessionGet, sessionSet } from "@/lib/client-session-cache"
import type { DealInputs } from "@/lib/calculations"
import type { AddressSuggestion } from "@/app/api/address-autocomplete/route"
import { Suspense } from "react"

const AUTOFILL_CACHE_NS = "autofill:v4"
const AUTOFILL_CACHE_TTL_MS = 30 * 60 * 1000

const SITE_URL =
  typeof window !== "undefined"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_SITE_URL ?? "https://realverdictroi.com")

type ResolverPayload = {
  address?: string
  inputs: Partial<DealInputs>
  notes: string[]
  warnings: string[]
  facts: Record<string, unknown>
  provenance: Record<string, unknown>
}

const BOOKMARKLET_LABEL = "Analyze on RealVerdict"
// When clicked on any listing page, opens RealVerdict with the current URL pre-filled.
function makeBookmarklet(siteUrl: string) {
  const js = `(function(){var u=encodeURIComponent(window.location.href);window.open('${siteUrl}/?url='+u,'_blank');})();`
  return `javascript:${js}`
}

function SearchPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [searchValue, setSearchValue] = useState("")
  const [isFocused, setIsFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const isZillowUrl = /zillow\.com|redfin\.com|realtor\.com/i.test(searchValue)

  const detectMode = (text: string): "zillow" | "address" | null => {
    if (!text.trim()) return null
    if (/zillow\.com\/homedetails|redfin\.com\/[A-Z]{2}\/|realtor\.com\/realestateandhomes-detail/i.test(text)) return "zillow"
    if (/\d/.test(text) && text.trim().length >= 6) return "address"
    return null
  }

  // Auto-submit when ?url= param is present (from bookmarklet)
  useEffect(() => {
    const urlParam = searchParams.get("url")
    if (!urlParam) return
    const decoded = decodeURIComponent(urlParam)
    if (detectMode(decoded)) {
      setSearchValue(decoded)
      submitSearch(decoded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch address suggestions with debounce
  useEffect(() => {
    if (isZillowUrl || searchValue.length < 4) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/address-autocomplete?q=${encodeURIComponent(searchValue)}`)
        if (res.ok) {
          const data = (await res.json()) as AddressSuggestion[]
          setSuggestions(data)
          setShowSuggestions(data.length > 0)
          setActiveSuggestion(-1)
        }
      } catch {
        // ignore — suggestions are non-critical
      }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchValue, isZillowUrl])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const submitSearch = useCallback(async (text: string) => {
    const mode = detectMode(text)
    if (!mode) {
      setError("Enter a street address or a listing URL (Zillow, Redfin, Realtor.com).")
      return
    }
    setError(null)
    setIsLoading(true)
    setShowSuggestions(false)

    const cacheId = normalizeCacheKey(text)
    const cached = sessionGet<ResolverPayload>(AUTOFILL_CACHE_NS, cacheId)
    if (cached) {
      router.push(`/results?${buildParams(cached).toString()}`)
      return
    }

    try {
      const res = mode === "zillow"
        ? await fetch("/api/property-resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: text }),
          })
        : await fetch(`/api/property-resolve?address=${encodeURIComponent(text)}`)

      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { message?: string; error?: string }
        const msg =
          (typeof payload?.message === "string" && payload.message) ||
          (typeof payload?.error === "string" && payload.error.length < 120 ? payload.error : null) ||
          "Couldn't resolve that property. Try again or fill inputs manually."
        throw new Error(msg)
      }

      const resolved = (await res.json()) as ResolverPayload
      sessionSet(AUTOFILL_CACHE_NS, cacheId, resolved, AUTOFILL_CACHE_TTL_MS)
      router.push(`/results?${buildParams(resolved).toString()}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.")
      setIsLoading(false)
    }
  }, [router])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    await submitSearch(searchValue.trim())
  }

  const handleSuggestionSelect = (s: AddressSuggestion) => {
    setSearchValue(s.label)
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
      handleSuggestionSelect(suggestions[activeSuggestion])
    } else if (e.key === "Escape") {
      setShowSuggestions(false)
    }
  }

  const bookmarkletHref = makeBookmarklet(SITE_URL)

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4 pb-24">
      <div className="w-full max-w-2xl space-y-8">
        {/* Hero */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            Analyze any rental property
          </h1>
          <p className="text-muted-foreground text-balance">
            Paste a listing URL or enter an address to get instant investment analysis
          </p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="relative" ref={wrapperRef}>
          <div
            className={cn(
              "relative rounded-lg border bg-card/50 backdrop-blur-sm transition-all duration-200",
              isFocused ? "border-foreground/20 ring-1 ring-foreground/10" : "border-border",
              showSuggestions && "rounded-b-none border-b-0",
            )}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              {isZillowUrl
                ? <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                : <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
              }
              <Input
                type="text"
                placeholder="zillow.com/homedetails/… or 123 Main St, City, ST"
                value={searchValue}
                onChange={(e) => { setSearchValue(e.target.value); setError(null) }}
                onFocus={() => { setIsFocused(true); if (suggestions.length > 0) setShowSuggestions(true) }}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                className="border-0 bg-transparent p-0 text-base placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!searchValue.trim() || isLoading}
                className="shrink-0 gap-1.5"
              >
                {isLoading ? "Fetching…" : "Analyze"}
                {!isLoading && <ArrowRight className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-50 w-full border border-t-0 border-border rounded-b-lg bg-card shadow-lg overflow-hidden">
              {suggestions.map((s, i) => (
                <button
                  key={s.placeId}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleSuggestionSelect(s) }}
                  className={cn(
                    "w-full text-left px-4 py-2.5 flex flex-col gap-0.5 hover:bg-muted/60 transition-colors",
                    i === activeSuggestion && "bg-muted/60",
                    i < suggestions.length - 1 && "border-b border-border/50",
                  )}
                >
                  <span className="text-sm font-medium">{s.primary}</span>
                  <span className="text-xs text-muted-foreground">{s.secondary}</span>
                </button>
              ))}
            </div>
          )}

          {(searchValue || error) && !showSuggestions && (
            <div className="absolute -bottom-6 left-4 text-xs">
              {error
                ? <span className="text-amber-500">{error}</span>
                : isZillowUrl
                  ? <span className="flex items-center gap-1 text-muted-foreground"><Building2 className="h-3 w-3" />Listing URL detected</span>
                  : <span className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-3 w-3" />Address search</span>
              }
            </div>
          )}
        </form>

        {/* Tips + bookmarklet */}
        <div className="pt-6 space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            How it works
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { icon: Building2,  label: "Paste any listing URL" },
              { icon: MapPin,     label: "Or enter a full address" },
              { icon: TrendingUp, label: "Get cap rate, CoC, DSCR & verdict" },
            ].map((tip) => (
              <div
                key={tip.label}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground bg-muted/50"
              >
                <tip.icon className="h-3.5 w-3.5" />
                <span>{tip.label}</span>
              </div>
            ))}
          </div>

          {/* Bookmarklet */}
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Bookmark className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Analyze while you browse</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Drag the button below to your bookmarks bar. Then click it on any Zillow, Redfin, or Realtor.com listing to instantly analyze it here.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a
                href={bookmarkletHref}
                onClick={(e) => e.preventDefault()}
                draggable
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium",
                  "bg-foreground text-background cursor-grab active:cursor-grabbing",
                  "select-none border border-foreground/20 shadow-sm",
                )}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                {BOOKMARKLET_LABEL}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </a>
              <span className="text-xs text-muted-foreground">← drag this to your bookmarks bar</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          <span>Property Discovery</span>
        </div>
      </header>
      <Suspense fallback={<div className="flex-1" />}>
        <SearchPageInner />
      </Suspense>
    </SidebarInset>
  )
}

function buildParams(resolved: ResolverPayload): URLSearchParams {
  const i = resolved.inputs
  const p = new URLSearchParams()
  if (i.purchasePrice)              p.set("purchasePrice",              String(i.purchasePrice))
  if (i.monthlyRent)                p.set("monthlyRent",                String(i.monthlyRent))
  if (i.annualPropertyTax)          p.set("annualPropertyTax",          String(i.annualPropertyTax))
  if (i.annualInsurance)            p.set("annualInsurance",            String(i.annualInsurance))
  if (i.monthlyHOA)                 p.set("monthlyHOA",                 String(i.monthlyHOA))
  if (i.loanInterestRate)           p.set("loanInterestRate",           String(i.loanInterestRate))
  if (i.annualAppreciationPercent)  p.set("annualAppreciationPercent",  String(i.annualAppreciationPercent))
  if (resolved.address)             p.set("address",                    resolved.address)
  return p
}
