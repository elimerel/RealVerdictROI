"use client"

import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { DealRow } from "@/lib/lead-adapter"
import { TIER_ACCENT, TIER_LABEL } from "@/lib/tier-constants"
import {
  formatCurrency,
  formatPercent,
  type DealAnalysis,
  type OfferCeiling,
  type VerdictTier,
} from "@/lib/calculations"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Re-exported for page.tsx which imports this type directly
export type SavedDeal = DealRow

// ---------------------------------------------------------------------------
// Metric tile
// ---------------------------------------------------------------------------

function MetricTile({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: "green" | "red" | "neutral"
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider leading-none">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-mono tabular-nums font-semibold leading-none",
          color === "green" && "text-emerald-400",
          color === "red" && "text-red-400",
          (!color || color === "neutral") && "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SavedDealCard
// ---------------------------------------------------------------------------

export type SavedDealCardProps = {
  address: string | null
  verdict: VerdictTier
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  propertyFacts?: SavedDeal["property_facts"]
  createdAt: string
  isSelected: boolean
  onSelect: () => void
}

export function SavedDealCard({
  address,
  verdict,
  analysis,
  walkAway,
  propertyFacts,
  createdAt,
  isSelected,
  onSelect,
}: SavedDealCardProps) {
  const accent = TIER_ACCENT[verdict] ?? "#888"
  const label = TIER_LABEL[verdict] ?? verdict

  const cashFlow = analysis.monthlyCashFlow
  const capRate = analysis.capRate
  const dscr = analysis.dscr
  const dscrStr = !isFinite(dscr) ? "∞" : `${dscr.toFixed(2)}x`
  const walkAwayPrice = walkAway?.recommendedCeiling?.price

  const facts = propertyFacts
  const hasFacts =
    facts &&
    (facts.beds != null || facts.baths != null || facts.sqft != null)

  return (
    <button
      onClick={onSelect}
      className={cn(
        "relative w-full text-left rounded-lg bg-zinc-900 p-4",
        "transition-colors duration-150 cursor-pointer",
        "hover:bg-zinc-800/80"
      )}
      style={{
        borderStyle: "solid",
        borderTopWidth: "1px",
        borderRightWidth: "1px",
        borderBottomWidth: "1px",
        borderLeftWidth: "3px",
        borderTopColor: isSelected ? accent : "rgb(39,39,42)",
        borderRightColor: isSelected ? accent : "rgb(39,39,42)",
        borderBottomColor: isSelected ? accent : "rgb(39,39,42)",
        borderLeftColor: accent,
        boxShadow: isSelected
          ? `0 0 0 1px ${accent}30, 0 2px 8px rgba(0,0,0,.4)`
          : "0 1px 3px rgba(0,0,0,.3)",
      }}
    >
      {/* Address */}
      <p className="text-sm font-medium truncate mb-1 pr-2">
        {address ?? "Unknown address"}
      </p>

      {/* Property facts strip */}
      {hasFacts && (
        <p className="text-[11px] text-muted-foreground mb-2 font-mono">
          {[
            facts!.beds != null && `${facts!.beds} bd`,
            facts!.baths != null && `${facts!.baths} ba`,
            facts!.sqft != null && `${facts!.sqft.toLocaleString()} sqft`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {/* Verdict badge + walk-away price */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
          style={{ color: accent, backgroundColor: `${accent}18` }}
        >
          {label}
        </span>
        {walkAwayPrice != null && (
          <div className="text-right min-w-0">
            <span className="text-[10px] text-muted-foreground mr-1">
              Walk-away
            </span>
            <span className="text-sm font-mono font-semibold tabular-nums">
              {formatCurrency(walkAwayPrice, 0)}
            </span>
          </div>
        )}
      </div>

      {/* Metric tiles */}
      <div className="flex gap-4 mb-3">
        <MetricTile
          label="Cash flow"
          value={`${cashFlow >= 0 ? "+" : ""}${formatCurrency(cashFlow, 0)}/mo`}
          color={cashFlow >= 0 ? "green" : "red"}
        />
        <MetricTile
          label="Cap rate"
          value={formatPercent(capRate, 1)}
        />
        <MetricTile
          label="DSCR"
          value={dscrStr}
        />
      </div>

      {/* Time ago */}
      <p className="text-[10px] text-muted-foreground text-right">
        {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
      </p>
    </button>
  )
}
