"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Search, ArrowRight, Building2, MapPin, TrendingUp } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { normalizeCacheKey, sessionGet, sessionSet } from "@/lib/client-session-cache"
import type { DealInputs } from "@/lib/calculations"

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

export default function SearchPage() {
  const router = useRouter()
  const [searchValue, setSearchValue] = useState("")
  const [isFocused, setIsFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isZillowUrl = searchValue.includes("zillow.com")

  const detectMode = (text: string): "zillow" | "address" | null => {
    if (!text.trim()) return null
    if (/zillow\.com\/homedetails/i.test(text)) return "zillow"
    if (/\d/.test(text) && text.trim().length >= 6) return "address"
    return null
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = searchValue.trim()
    const mode = detectMode(text)
    if (!mode) {
      setError("Enter a street address or a Zillow listing URL.")
      return
    }
    setError(null)
    setIsLoading(true)

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
  }

  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          <span>Property Discovery</span>
        </div>
      </header>

      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4 pb-24">
        <div className="w-full max-w-2xl space-y-8">
          {/* Hero */}
          <div className="text-center space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Analyze any rental property
            </h1>
            <p className="text-muted-foreground text-balance">
              Paste a Zillow URL or enter an address to get instant investment analysis
            </p>
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} className="relative">
            <div
              className={cn(
                "relative rounded-lg border bg-card/50 backdrop-blur-sm transition-all duration-200",
                isFocused ? "border-foreground/20 ring-1 ring-foreground/10" : "border-border",
              )}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                {isZillowUrl
                  ? <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                  : <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
                }
                <Input
                  type="text"
                  placeholder="zillow.com/homedetails/... or 123 Main St, City, ST"
                  value={searchValue}
                  onChange={(e) => { setSearchValue(e.target.value); setError(null) }}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
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

            {(searchValue || error) && (
              <div className="absolute -bottom-6 left-4 text-xs">
                {error
                  ? <span className="text-amber-500">{error}</span>
                  : isZillowUrl
                    ? <span className="flex items-center gap-1 text-muted-foreground"><Building2 className="h-3 w-3" />Zillow listing detected</span>
                    : <span className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-3 w-3" />Address search</span>
                }
              </div>
            )}
          </form>

          {/* Tips */}
          <div className="pt-6 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              How it works
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: Building2,  label: "Paste any Zillow URL" },
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
          </div>
        </div>
      </div>
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
