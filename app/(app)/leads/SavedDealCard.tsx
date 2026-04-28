"use client"

import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { DealRow } from "@/lib/lead-adapter"
import { TIER_ACCENT, TIER_LABEL } from "@/lib/tier-constants"
import { formatCurrency, formatPercent, analyseDeal, sanitiseInputs } from "@/lib/calculations"

export type SavedDeal = DealRow & {
  property_facts?: {
    beds?: number | null
    baths?: number | null
    sqft?: number | null
    yearBuilt?: number | null
    propertyType?: string | null
  } | null
}

export function SavedDealCard({
  deal,
  isSelected,
  onSelect,
}: {
  deal: SavedDeal
  isSelected: boolean
  onSelect: () => void
}) {
  const analysis = (() => {
    try { return analyseDeal(sanitiseInputs(deal.inputs)) }
    catch { return deal.results }
  })()

  const tier = deal.verdict ?? "fair"
  const accent = TIER_ACCENT[tier as keyof typeof TIER_ACCENT] ?? "#888"
  const label = TIER_LABEL[tier as keyof typeof TIER_LABEL] ?? tier

  const cashFlow = analysis.monthlyCashFlow
  const capRate = analysis.capRate

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3.5 border-b border-border transition-colors",
        "hover:bg-muted/40",
        isSelected && "bg-muted/60 border-l-2"
      )}
      style={isSelected ? { borderLeftColor: accent } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium truncate">
            {deal.address ?? "Unknown address"}
          </p>
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ color: accent, backgroundColor: `${accent}15` }}
            >
              {label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(deal.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0 space-y-0.5">
          <p className={cn(
            "text-sm font-mono font-semibold",
            cashFlow >= 0 ? "text-emerald-400" : "text-red-400"
          )}>
            {cashFlow >= 0 ? "+" : ""}{formatCurrency(cashFlow, 0)}/mo
          </p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {formatPercent(capRate, 1)} cap
          </p>
        </div>
      </div>
    </button>
  )
}
