"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Search, ArrowRight, Building2, MapPin, TrendingUp } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const recentSearches = [
  { type: "url", value: "zillow.com/homedetails/4521-magnolia..." },
  { type: "address", value: "892 Oakwood Lane, Tampa, FL" },
  { type: "address", value: "1847 Elm Street, Indianapolis, IN" },
]

const quickStats = [
  { label: "Properties Analyzed", value: "2,847" },
  { label: "Avg. IRR Found", value: "14.2%" },
  { label: "Deals This Week", value: "23" },
]

export default function SearchPage() {
  const router = useRouter()
  const [searchValue, setSearchValue] = useState("")
  const [isFocused, setIsFocused] = useState(false)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchValue.trim()) {
      // Navigate to leads with the first mock lead for demo
      router.push("/leads?id=lead-001")
    }
  }

  const isZillowUrl = searchValue.includes("zillow.com")

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
          {/* Hero Section */}
          <div className="text-center space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Analyze any rental property
            </h1>
            <p className="text-muted-foreground text-balance">
              Paste a Zillow URL or enter an address to get instant investment analysis
            </p>
          </div>

          {/* Search Input */}
          <form onSubmit={handleSearch} className="relative">
            <div
              className={cn(
                "relative rounded-lg border bg-card/50 backdrop-blur-sm transition-all duration-200",
                isFocused
                  ? "border-foreground/20 ring-1 ring-foreground/10"
                  : "border-border"
              )}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                {isZillowUrl ? (
                  <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                ) : (
                  <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
                )}
                <Input
                  type="text"
                  placeholder="zillow.com/homedetails/... or 123 Main St, City, ST"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  className="border-0 bg-transparent p-0 text-base placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!searchValue.trim()}
                  className="shrink-0 gap-1.5"
                >
                  Analyze
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Input Type Indicator */}
            {searchValue && (
              <div className="absolute -bottom-6 left-4 text-xs text-muted-foreground">
                {isZillowUrl ? (
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    Zillow listing detected
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Address search
                  </span>
                )}
              </div>
            )}
          </form>

          {/* Recent Searches */}
          <div className="pt-6 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Recent Searches
            </p>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((search, i) => (
                <button
                  key={i}
                  onClick={() => setSearchValue(search.value)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground bg-muted/50 hover:bg-muted hover:text-foreground transition-colors"
                >
                  {search.type === "url" ? (
                    <Building2 className="h-3.5 w-3.5" />
                  ) : (
                    <MapPin className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate max-w-[200px]">{search.value}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-8 text-sm">
            {quickStats.map((stat, i) => (
              <div key={i} className="flex items-center gap-2 text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>{stat.label}:</span>
                <span className="font-mono text-foreground">{stat.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SidebarInset>
  )
}
