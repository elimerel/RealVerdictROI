"use client"

import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { DealRow } from "@/lib/lead-adapter"
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
  color?: "green" | "red"
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {/* Issue 4/6: zinc-500 label, text-xs value */}
      <span className="text-[10px] text-zinc-500 leading-none">{label}</span>
      <span
        className={cn(
          "text-xs font-mono tabular-nums font-semibold leading-none",
          color === "green" && "text-emerald-400",
          color === "red" && "text-red-400",
          !color && "text-foreground"
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

  // If both cashFlow and capRate are exactly zero the engine had no input data.
  // Walk-away is also meaningless in this case regardless of what it returned.
  const isBadData = cashFlow === 0 && capRate === 0

  const facts = propertyFacts
  const hasFacts =
    facts &&
    (facts.beds != null || facts.baths != null || facts.sqft != null)

  // Issue 3: zinc-500 border for bad data (was zinc-600, too dark on dark bg)
  const borderColor = isBadData ? "rgb(113,113,122)" : accent // zinc-500

  return (
    <button
      onClick={onSelect}
      // Issue 2: rounded-md (was rounded-lg) — desktop data record, not mobile card
      // Issue 3: lighter bg for bad data so it reads as visually distinct/degraded
      className={cn(
        "relative w-full text-left rounded-md p-3",
        "transition-colors duration-150 cursor-pointer",
        isBadData
          ? "bg-zinc-800/50 hover:bg-zinc-800"
          : "bg-zinc-900 hover:bg-zinc-800/80"
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
      {/* Issue 4/5: address is the title — font-semibold, reads first */}
      <p className="text-sm font-semibold truncate mb-1 pr-2">
        {address ?? "Unknown address"}
      </p>

      {/* Property facts strip */}
      {!isBadData && hasFacts && (
        <p className="text-[10px] text-zinc-500 mb-1.5 font-mono">
          {[
            facts!.beds != null && `${facts!.beds} bd`,
            facts!.baths != null && `${facts!.baths} ba`,
            facts!.sqft != null && `${facts!.sqft.toLocaleString()} sqft`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {isBadData ? (
        /* Degraded state — honest, not alarming */
        <p className="text-xs text-zinc-500 italic mt-1 mb-2">
          Analysis incomplete — click to review inputs
        </p>
      ) : (
        <>
          {/* Issue 5: walk-away as hero — text-lg, clearly below address */}
          {walkAwayPrice != null && (
            <p className="text-lg font-mono font-bold tabular-nums leading-none mb-2">
              {formatCurrency(walkAwayPrice, 0)}
            </p>
          )}

          {/* Issue 7: metrics spread justify-between across full card width */}
          <div className="flex justify-between mb-2">
            <MetricTile
              label="cash flow"
              value={`${cashFlow >= 0 ? "+" : ""}${formatCurrency(cashFlow, 0)}/mo`}
              color={cashFlow >= 0 ? "green" : "red"}
            />
            <MetricTile label="cap rate" value={formatPercent(capRate, 1)} />
            <MetricTile label="dscr" value={dscrStr} />
          </div>
        </>
      )}

      {/* Verdict badge + time ago on the same line */}
      <div className="flex items-center justify-between gap-2">
        {!isBadData ? (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ color: accent, backgroundColor: `${accent}18` }}
          >
            {label}
          </span>
        ) : (
          <span />
        )}
        <span className="text-[10px] text-zinc-500 shrink-0">
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
        </span>
      </div>
    </button>
  )
}
