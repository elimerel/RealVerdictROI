"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import { Trash2, AlertTriangle } from "lucide-react"
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
      <span className="text-[10px] text-muted-foreground/70 leading-none">{label}</span>
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
  /** Present on saved deals; absent on the unsaved pending card. */
  onDelete?: () => void
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
  onDelete,
}: SavedDealCardProps) {
  const accent = TIER_ACCENT[verdict] ?? "#888"
  const label = TIER_LABEL[verdict] ?? verdict

  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const cashFlow = analysis.monthlyCashFlow
  const capRate = analysis.capRate
  const dscr = analysis.dscr
  const dscrStr = !isFinite(dscr) ? "∞" : `${dscr.toFixed(2)}x`
  const walkAwayPrice = walkAway?.recommendedCeiling?.price

  const isBadData = cashFlow === 0 && capRate === 0

  const facts = propertyFacts
  const hasFacts =
    facts &&
    (facts.beds != null || facts.baths != null || facts.sqft != null)

  const borderColor = isBadData ? "oklch(0.35 0.009 264)" : accent

  return (
    // Outer div — handles card selection click, hosts the delete affordance.
    // Using div instead of button so we can nest action buttons inside.
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!confirmingDelete) onSelect()
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !confirmingDelete) onSelect()
      }}
      className={cn(
        "group relative w-full text-left rounded-md p-3",
        "transition-colors duration-150 cursor-pointer",
        isBadData
          ? "bg-muted/40 hover:bg-muted/60"
          : "bg-card hover:bg-muted/30"
      )}
      style={{
        borderStyle: "solid",
        borderTopWidth: "1px",
        borderRightWidth: "1px",
        borderBottomWidth: "1px",
        borderLeftWidth: "3px",
        borderTopColor: isSelected ? borderColor : "oklch(1 0 0 / 9%)",
        borderRightColor: isSelected ? borderColor : "oklch(1 0 0 / 9%)",
        borderBottomColor: isSelected ? borderColor : "oklch(1 0 0 / 9%)",
        borderLeftColor: borderColor,
        boxShadow: isSelected
          ? `0 0 0 1px ${borderColor}30, 0 2px 8px rgba(0,0,0,.4)`
          : "0 1px 3px rgba(0,0,0,.3)",
      }}
    >
      {/* ── Delete affordance — visible on hover, always present for saved deals ── */}
      {onDelete && !confirmingDelete && (
        <button
          type="button"
          aria-label="Delete deal"
          onClick={(e) => {
            e.stopPropagation()
            setConfirmingDelete(true)
          }}
          className={cn(
            "absolute top-1.5 right-1.5 flex items-center justify-center",
            "h-5 w-5 rounded",
            "text-muted-foreground/40 hover:text-red-400 hover:bg-red-950/40",
            "transition-all duration-150"
          )}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}

      {/* ── Inline delete confirmation ── */}
      {confirmingDelete && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-card/95 px-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium">Remove from pipeline?</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmingDelete(false)
                onDelete?.()
              }}
              className="rounded px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmingDelete(false)
              }}
              className="rounded px-3 py-1 text-xs font-medium border border-border text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Card content ── */}
      <p className="text-sm font-semibold truncate mb-1 pr-6">
        {address ?? "Unknown address"}
      </p>

      {/* Property facts strip */}
      {!isBadData && hasFacts && (
        <p className="text-[10px] text-muted-foreground mb-1.5 font-mono">
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
        <p className="text-xs text-muted-foreground italic mt-1 mb-2">
          Analysis incomplete — click to review inputs
        </p>
      ) : (
        <>
          {walkAwayPrice != null && (
            <p className="text-lg font-mono font-bold tabular-nums leading-none mb-2">
              {formatCurrency(walkAwayPrice, 0)}
            </p>
          )}

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
        <span className="text-[10px] text-muted-foreground/60 shrink-0">
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  )
}
