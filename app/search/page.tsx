"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, ArrowRight, MapPin, TrendingUp, Bookmark, Globe, CheckCircle2, Loader2 } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { normalizeCacheKey, sessionGet, sessionSet } from "@/lib/client-session-cache"
import type { DealInputs } from "@/lib/calculations"
import type { AddressSuggestion } from "@/app/api/address-autocomplete/route"
import type { BrowseResponse } from "@/app/api/browse/route"

const AUTOFILL_CACHE_NS = "autofill:v4"
const AUTOFILL_CACHE_TTL_MS = 30 * 60 * 1000

type ResolverPayload = {
  address?: string
  inputs: Partial<DealInputs>
  notes: string[]
  warnings: string[]
  facts: Record<string, unknown>
  provenance: Record<string, unknown>
}

type BrowseStep = {
  label: string
  done: boolean
}

const LISTING_URL_RE = /^https?:\/\/(www\.)?(zillow|redfin|realtor|homes|trulia|movoto)\.com\//i

// Navigate current tab — avoids Chrome popup blocker entirely
function makeBookmarklet(siteUrl: string) {
  const js = `(function(){location.href='${siteUrl}/search?url='+encodeURIComponent(location.href);})();`
  return `javascript:${js}`
}

// ---------------------------------------------------------------------------
// BrowseLoader — shown while the headless browser is working
// ---------------------------------------------------------------------------

function BrowseLoader({
  hostname,
  screenshot,
  steps,
}: {
  hostname: string
  screenshot: string | null
  steps: BrowseStep[]
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-muted-foreground animate-pulse" />
          <p className="text-sm font-medium">Browsing {hostname}…</p>
        </div>

        {/* Step list */}
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 text-sm">
              {s.done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : i === steps.findIndex((x) => !x.done) ? (
                <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-border shrink-0" />
              )}
              <span className={s.done ? "text-foreground" : "text-muted-foreground"}>
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Screenshot preview — appears after browser visit completes */}
        {screenshot && (
          <div className="rounded-lg border border-border overflow-hidden shadow-lg">
            <p className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/50 border-b border-border">
              Live screenshot from {hostname}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${screenshot}`}
              alt="Property page screenshot"
              className="w-full max-h-72 object-cover object-top"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main search page
// ---------------------------------------------------------------------------

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

  // Browse mode state
  const [browseHostname, setBrowseHostname] = useState<string | null>(null)
  const [browseScreenshot, setBrowseScreenshot] = useState<string | null>(null)
  const [browseSteps, setBrowseSteps] = useState<BrowseStep[]>([])

  const [siteUrl, setSiteUrl] = useState("")
  useEffect(() => { setSiteUrl(window.location.origin) }, [])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isListingUrl = LISTING_URL_RE.test(searchValue)

  const detectMode = (text: string): "browse" | "address" | null => {
    if (!text.trim()) return null
    if (LISTING_URL_RE.test(text)) return "browse"
    if (/\d/.test(text) && text.trim().length >= 6) return "address"
    return null
  }

  // Auto-submit when ?url= param is present (bookmarklet)
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

  // Address autocomplete
  useEffect(() => {
    if (isListingUrl || searchValue.length < 4) {
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
      } catch { /* non-critical */ }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchValue, isListingUrl])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const advanceStep = (idx: number) => {
    setBrowseSteps((prev) =>
      prev.map((s, i) => (i < idx ? { ...s, done: true } : s))
    )
  }

  const submitSearch = useCallback(async (text: string) => {
    const mode = detectMode(text)
    if (!mode) {
      setError("Enter a street address or a listing URL.")
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

    // ------------------------------------------------------------------
    // Browse mode: use headless browser + AI extraction
    // ------------------------------------------------------------------
    if (mode === "browse") {
      let hostname = ""
      try { hostname = new URL(text).hostname.replace("www.", "") } catch { hostname = text }

      const steps: BrowseStep[] = [
        { label: "Launching browser", done: false },
        { label: `Visiting ${hostname}`, done: false },
        { label: "Reading property data", done: false },
        { label: "Filling in estimates", done: false },
        { label: "Running analysis", done: false },
      ]
      setBrowseHostname(hostname)
      setBrowseScreenshot(null)
      setBrowseSteps(steps)

      // Advance step 0 immediately, step 1 after 800ms (feels responsive)
      advanceStep(1)
      stepTimerRef.current = setTimeout(() => advanceStep(2), 1200)

      try {
        const res = await fetch("/api/browse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: text }),
        })

        // Show screenshot as soon as we get a response
        if (res.ok) {
          const data = (await res.json()) as BrowseResponse
          setBrowseScreenshot(data.screenshot)
          advanceStep(4)
          stepTimerRef.current = setTimeout(() => advanceStep(5), 600)

          const payload: ResolverPayload = {
            address: data.address,
            inputs: data.inputs,
            facts: data.facts,
            notes: data.notes,
            warnings: data.warnings,
            provenance: data.provenance,
          }
          sessionSet(AUTOFILL_CACHE_NS, cacheId, payload, AUTOFILL_CACHE_TTL_MS)

          // Short pause so user sees the screenshot, then navigate
          setTimeout(() => {
            router.push(`/results?${buildParams(payload).toString()}`)
          }, 1800)
          return
        }

        // Browse failed — fall through to standard property-resolve
        const errBody = await res.json().catch(() => ({})) as { error?: string }
        if (errBody?.error?.includes("not configured")) {
          // Browserbase not set up — silently fall through
        } else {
          throw new Error(errBody?.error ?? "Browser visit failed.")
        }
      } catch (err) {
        // Non-configuration errors surface to the user
        if (err instanceof Error && !err.message.includes("not configured")) {
          setBrowseHostname(null)
          setBrowseSteps([])
          setError(err.message)
          setIsLoading(false)
          return
        }
      }
    }

    // ------------------------------------------------------------------
    // Standard mode (address input, or browse fallback)
    // ------------------------------------------------------------------
    try {
      const res = await fetch("/api/property-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          LISTING_URL_RE.test(text) ? { url: text } : { address: text }
        ),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { message?: string; error?: string }
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
          (typeof payload?.error === "string" && payload.error.length < 120 ? payload.error : null) ||
          "Couldn't resolve that property. Try again or fill inputs manually."
        )
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

  const bookmarkletHref = siteUrl ? makeBookmarklet(siteUrl) : "#"
  const isBrowseMode = browseHostname !== null && isLoading

  return (
    <>
      {/* Browse loader overlay */}
      {isBrowseMode && (
        <BrowseLoader
          hostname={browseHostname!}
          screenshot={browseScreenshot}
          steps={browseSteps}
        />
      )}

      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4 pb-24">
        <div className="w-full max-w-2xl space-y-8">
          {/* Hero */}
          <div className="text-center space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Analyze any rental property
            </h1>
            <p className="text-muted-foreground text-balance">
              Paste a listing URL or enter an address — we&apos;ll read the page and run the numbers
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
                {isListingUrl
                  ? <Globe className="h-5 w-5 text-muted-foreground shrink-0" />
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
                  : isListingUrl
                    ? <span className="flex items-center gap-1 text-emerald-400 font-medium"><Globe className="h-3 w-3" />Browser mode — will read this page directly</span>
                    : <span className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-3 w-3" />Address search</span>
                }
              </div>
            )}
          </form>

          {/* Browser mode explainer + bookmarklet */}
          <div className="pt-6 space-y-4">

            {/* Browser mode card */}
            <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Globe className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                <p className="text-sm font-medium">Browser mode</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Paste any listing URL (Zillow, Redfin, Realtor.com, etc.) and the app launches a real browser, visits the page, takes a screenshot, and reads every number off it — price, HOA, tax, rent estimate. No scraper. No guessing.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>Active — paste any listing URL above to use it</span>
              </div>
            </div>

            {/* Bookmarklet */}
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Bookmark className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">One-click while browsing</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Drag the button below to your bookmarks bar. When you&apos;re on any listing page, click it — you&apos;ll land here with the analysis already running.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <a
                  href={bookmarkletHref}
                  onClick={(e) => e.preventDefault()}
                  draggable
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium",
                    "bg-foreground text-background cursor-grab active:cursor-grabbing",
                    "select-none border border-foreground/20 shadow-sm",
                    !siteUrl && "opacity-50 pointer-events-none",
                  )}
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  Analyze on RealVerdict
                </a>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">← drag this to your bookmarks bar</span>
                  <span className="text-[10px] text-muted-foreground/60">then click it while on Zillow, Redfin, etc.</span>
                </div>
              </div>
            </div>

            {/* How it works chips */}
            <div className="flex flex-wrap gap-2">
              {[
                { icon: Globe,      label: "Reads listing pages directly" },
                { icon: MapPin,     label: "Or search by address" },
                { icon: TrendingUp, label: "Cap rate, CoC, DSCR & verdict" },
              ].map((tip) => (
                <div
                  key={tip.label}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground bg-muted/50"
                >
                  <tip.icon className="h-3 w-3" />
                  <span>{tip.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
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
  if (i.purchasePrice)             p.set("purchasePrice",             String(i.purchasePrice))
  if (i.monthlyRent)               p.set("monthlyRent",               String(i.monthlyRent))
  if (i.annualPropertyTax)         p.set("annualPropertyTax",         String(i.annualPropertyTax))
  if (i.annualInsurance)           p.set("annualInsurance",           String(i.annualInsurance))
  if (i.monthlyHOA)                p.set("monthlyHOA",                String(i.monthlyHOA))
  if (i.loanInterestRate)          p.set("loanInterestRate",          String(i.loanInterestRate))
  if (i.annualAppreciationPercent) p.set("annualAppreciationPercent", String(i.annualAppreciationPercent))
  if (resolved.address)            p.set("address",                   resolved.address)
  return p
}
