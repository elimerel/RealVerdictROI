"use client"

import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { DealRow } from "@/lib/lead-adapter"
// Fix 1: use TIER_LABEL from tier-style.ts for user-facing badge labels
import { TIER_ACCENT, TIER_LABEL } from "@/app/(app)/_components/results/tier-style"
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

  // Fix 6: detect bad data — all zeros with no walk-away means unusable inputs
  const isBadData = cashFlow === 0 && capRate === 0 && walkAwayPrice == null

  const facts = propertyFacts
  const hasFacts =
    facts &&
    (facts.beds != null || facts.baths != null || facts.sqft != null)

  const borderColor = isBadData ? "rgb(82,82,91)" : accent // zinc-600 for bad data

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
        borderTopColor: isSelected ? borderColor : "rgb(39,39,42)",
        borderRightColor: isSelected ? borderColor : "rgb(39,39,42)",
        borderBottomColor: isSelected ? borderColor : "rgb(39,39,42)",
        borderLeftColor: borderColor,
        boxShadow: isSelected
          ? `0 0 0 1px ${borderColor}30, 0 2px 8px rgba(0,0,0,.4)`
          : "0 1px 3px rgba(0,0,0,.3)",
      }}
    >
      {/* 1. Address */}
      <p className="text-sm font-medium truncate mb-2 pr-2">
        {address ?? "Unknown address"}
      </p>

      {/* Bad data state */}
      {isBadData ? (
        <p className="text-xs text-muted-foreground/70 italic">
          Analysis incomplete — click to review inputs
        </p>
      ) : (
        <>
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

          {/* 2. Walk-away price — hero number */}
          {walkAwayPrice != null && (
            <div className="mb-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider leading-none mb-1">
                Walk-away
              </p>
              <p className="text-2xl font-mono font-bold tabular-nums leading-none">
                {formatCurrency(walkAwayPrice, 0)}
              </p>
            </div>
          )}

          {/* 3. Verdict badge */}
          <div className="mb-3">
            <span
              className="text-xs font-semibold px-1.5 py-0.5 rounded"
              style={{ color: accent, backgroundColor: `${accent}18` }}
            >
              {label}
            </span>
          </div>

          {/* 4. Three metric tiles */}
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
        </>
      )}

      {/* 5. Time ago */}
      <p className="text-[10px] text-muted-foreground text-right mt-auto">
        {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
      </p>
    </button>
  )
}
