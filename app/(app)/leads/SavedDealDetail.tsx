"use client"

import { Bed, Bath, Ruler, Calendar, Home, ExternalLink, ShieldCheck, AlertTriangle } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  analyseDeal, sanitiseInputs, findOfferCeiling,
  formatCurrency, formatPercent,
} from "@/lib/calculations"
import { TIER_ACCENT, TIER_LABEL } from "@/lib/tier-constants"
import type { SavedDeal } from "./SavedDealCard"
import { inputsToSearchParams } from "@/lib/calculations"

// ---------------------------------------------------------------------------
// Walk-away math block (same pattern as research panel)
// ---------------------------------------------------------------------------
function WalkAwayBlock({
  walkAway, listPrice,
}: { walkAway: number | null; listPrice: number | null }) {
  if (!walkAway) return null
  const diff = listPrice != null ? walkAway - listPrice : null

  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <ShieldCheck className="h-3 w-3" /> Walk-Away Ceiling
      </p>
      <p className="text-2xl font-bold font-mono">{formatCurrency(walkAway, 0)}</p>
      {diff != null && (
        <p className={cn("text-xs font-mono", diff >= 0 ? "text-emerald-400" : "text-red-400")}>
          {diff >= 0
            ? `${formatCurrency(diff, 0)} under ceiling — deal works at ask`
            : `${formatCurrency(-diff, 0)} over ceiling`}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main detail panel
// ---------------------------------------------------------------------------
export function SavedDealDetail({ deal }: { deal: SavedDeal }) {
  const analysis = (() => {
    try { return analyseDeal(sanitiseInputs(deal.inputs)) }
    catch { return deal.results }
  })()

  const ceiling = (() => {
    try { return findOfferCeiling(sanitiseInputs(deal.inputs)) }
    catch { return null }
  })()

  const tier = deal.verdict ?? "fair"
  const accent = TIER_ACCENT[tier as keyof typeof TIER_ACCENT] ?? "#888"
  const label = TIER_LABEL[tier as keyof typeof TIER_LABEL] ?? tier
  const pf = deal.property_facts
  const listPrice = deal.inputs.purchasePrice ?? null
  const walkAway = ceiling?.primaryTarget?.price ?? null

  const resultsHref = (() => {
    try {
      const sp = inputsToSearchParams(sanitiseInputs(deal.inputs))
      if (deal.address) sp.set("address", deal.address)
      if (pf?.beds) sp.set("beds", String(pf.beds))
      if (pf?.baths) sp.set("baths", String(pf.baths))
      if (pf?.sqft) sp.set("sqft", String(pf.sqft))
      if (pf?.yearBuilt) sp.set("yearBuilt", String(pf.yearBuilt))
      if (pf?.propertyType) sp.set("propertyType", pf.propertyType)
      return `/results?${sp.toString()}`
    } catch { return "/results" }
  })()

  const metrics = [
    { label: "Monthly cash flow", value: `${analysis.monthlyCashFlow >= 0 ? "+" : ""}${formatCurrency(analysis.monthlyCashFlow, 0)}/mo`, good: analysis.monthlyCashFlow >= 0, neutral: false },
    { label: "Cap rate",          value: formatPercent(analysis.capRate, 2),                                                               good: analysis.capRate >= 0.05,           neutral: false },
    { label: "Cash-on-cash",      value: formatPercent(analysis.cashOnCashReturn, 2),                                                      good: analysis.cashOnCashReturn >= 0.07,  neutral: false },
    { label: "DSCR",              value: isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞",                                        good: analysis.dscr >= 1.2,               neutral: false },
    { label: "GRM",               value: analysis.grossRentMultiplier.toFixed(1) + "×",                                                   good: false,                              neutral: true  },
    { label: "Total cash in",     value: formatCurrency(analysis.totalCashInvested, 0),                                                   good: false,                              neutral: true  },
  ]

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">
              {deal.address ?? "Unknown address"}
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Bed      className="h-3 w-3" />{pf?.beds    ?? "—"} bd</span>
              <span className="flex items-center gap-1"><Bath     className="h-3 w-3" />{pf?.baths   ?? "—"} ba</span>
              <span className="flex items-center gap-1"><Ruler    className="h-3 w-3" />{pf?.sqft    ? pf.sqft.toLocaleString() + " sqft" : "— sqft"}</span>
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{pf?.yearBuilt ? `Built ${pf.yearBuilt}` : "Year —"}</span>
              <span className="flex items-center gap-1"><Home     className="h-3 w-3" />{pf?.propertyType ?? "—"}</span>
            </div>
          </div>
          <a
            href={resultsHref}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors border border-border rounded-md px-2.5 py-1.5"
          >
            <ExternalLink className="h-3 w-3" />
            Full analysis
          </a>
        </div>

        {/* Verdict */}
        <div
          className="rounded-lg px-4 py-3 space-y-1"
          style={{ backgroundColor: `${accent}10`, borderColor: `${accent}25`, borderWidth: 1 }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent }}>
            Verdict
          </p>
          <p className="text-2xl font-bold" style={{ color: accent }}>{label}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{analysis.verdict.summary}</p>
        </div>

        {/* Walk-away ceiling */}
        <WalkAwayBlock walkAway={walkAway} listPrice={listPrice} />

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-2">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-lg border border-border bg-muted/10 px-3 py-2.5 space-y-0.5">
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
              <p className={cn(
                "text-base font-mono font-semibold",
                m.neutral ? "text-foreground" : m.good ? "text-emerald-400" : "text-red-400"
              )}>
                {m.value}
              </p>
            </div>
          ))}
        </div>

        {/* Score breakdown */}
        <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Score breakdown</p>
          <div className="space-y-2">
            {analysis.verdict.breakdown.map((b) => {
              const pct = b.maxPoints > 0 ? b.points / b.maxPoints : 0
              return (
                <div key={b.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{b.category}</span>
                    <span className={cn(
                      "font-mono font-medium",
                      (b.status === "win" || b.status === "ok") ? "text-emerald-400" : b.status === "warn" ? "text-amber-400" : "text-red-400"
                    )}>
                      {b.points}/{b.maxPoints}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        (b.status === "win" || b.status === "ok") ? "bg-emerald-500" : b.status === "warn" ? "bg-amber-500" : "bg-red-500"
                      )}
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </ScrollArea>
  )
}
