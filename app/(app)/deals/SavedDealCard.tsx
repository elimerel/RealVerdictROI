"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import { Trash2, AlertTriangle } from "lucide-react"
import type { DealRow } from "@/lib/lead-adapter"
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
// Props
// ---------------------------------------------------------------------------

export type SavedDealCardProps = {
  address: string | null
  /** Verdict is accepted for backward compat but not displayed. */
  verdict?: VerdictTier
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  propertyFacts?: SavedDeal["property_facts"]
  createdAt: string
  isSelected: boolean
  onSelect: () => void
  /** Present on saved deals; absent on the unsaved pending card. */
  onDelete?: () => void
}

// ---------------------------------------------------------------------------
// SavedDealCard — calm, metrics-first layout. No verdict.
// ---------------------------------------------------------------------------

export function SavedDealCard({
  address,
  analysis,
  walkAway,
  propertyFacts,
  createdAt,
  isSelected,
  onSelect,
  onDelete,
}: SavedDealCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const cashFlow = analysis.monthlyCashFlow
  const capRate  = analysis.capRate
  const dscr     = analysis.dscr
  const dscrStr  = !Number.isFinite(dscr) ? "\u221E" : dscr.toFixed(2)
  const breakEven = walkAway?.recommendedCeiling?.price ?? null

  const isBadData = cashFlow === 0 && capRate === 0
  const facts = propertyFacts
  const hasFacts =
    facts && (facts.beds != null || facts.baths != null || facts.sqft != null)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { if (!confirmingDelete) onSelect() }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !confirmingDelete) onSelect()
      }}
      className={cn(
        "group relative w-full text-left rounded-md p-3 transition-colors duration-150 cursor-pointer",
        "border border-white/8",
        isSelected ? "bg-white/4 border-white/15" : "bg-card hover:bg-muted/30",
        isBadData && "bg-muted/30",
      )}
    >
      {/* Delete affordance */}
      {onDelete && !confirmingDelete && (
        <button
          type="button"
          aria-label="Delete deal"
          onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true) }}
          className={cn(
            "absolute top-1.5 right-1.5 flex items-center justify-center h-5 w-5 rounded",
            "opacity-0 group-hover:opacity-100",
            "text-muted-foreground/60 hover:text-red-400 hover:bg-red-950/30",
            "transition-all duration-150",
          )}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}

      {/* Inline delete confirmation */}
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
              onClick={(e) => { e.stopPropagation(); setConfirmingDelete(false); onDelete?.() }}
              className="rounded px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmingDelete(false) }}
              className="rounded px-3 py-1 text-xs font-medium border border-border text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Address */}
      <p className="text-[13px] font-semibold truncate mb-0.5 pr-6 text-foreground">
        {address ?? "Unknown address"}
      </p>

      {/* Facts row */}
      {hasFacts && (
        <p className="text-[10px] text-muted-foreground/55 mb-3 font-mono">
          {[
            facts!.beds != null && `${facts!.beds} bd`,
            facts!.baths != null && `${facts!.baths} ba`,
            facts!.sqft != null && `${facts!.sqft.toLocaleString()} sqft`,
          ].filter(Boolean).join("  \u00b7  ")}
        </p>
      )}

      {isBadData ? (
        <p className="text-xs text-muted-foreground italic mt-1 mb-2">
          Couldn&rsquo;t read this listing. Click to review inputs.
        </p>
      ) : (
        <>
          {/* Asking + break-even */}
          <p className="text-[11px] text-muted-foreground/55 font-mono tabular-nums mb-2">
            Asking&nbsp;
            <span className="text-foreground/70">
              {formatCurrency(analysis.inputs.purchasePrice, 0)}
            </span>
            {breakEven != null && (
              <>
                &nbsp;&middot;&nbsp;break-even&nbsp;
                <span className="text-foreground/70">{formatCurrency(breakEven, 0)}</span>
              </>
            )}
          </p>

          {/* Three metric tiles — threshold-based color */}
          <div className="grid grid-cols-3 gap-2">
            <Metric
              label="DSCR"
              value={dscrStr}
              tone={dscrTone(dscr)}
            />
            <Metric
              label="Cash flow"
              value={(cashFlow >= 0 ? "+" : "\u2212") + formatCurrency(Math.abs(cashFlow), 0)}
              tone={cashFlow >= 0 ? "neutral" : "bad"}
            />
            <Metric
              label="Cap"
              value={formatPercent(capRate, 1)}
              tone={capTone(capRate)}
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-end mt-3">
        <span className="text-[10px] text-muted-foreground/40 shrink-0 font-mono">
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  )
}

type MetricTone = "neutral" | "good" | "warn" | "bad"

function dscrTone(dscr: number): MetricTone {
  if (!Number.isFinite(dscr)) return "good"
  if (dscr >= 1.25) return "neutral"
  if (dscr >= 1.0)  return "warn"
  return "bad"
}

function capTone(cap: number): MetricTone {
  if (cap >= 0.06) return "neutral"
  if (cap >= 0.05) return "warn"
  return "bad"
}

function Metric({ label, value, tone }: { label: string; value: string; tone: MetricTone }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span
        className={cn(
          "text-[12px] font-mono tabular-nums font-semibold leading-none truncate",
          tone === "good" && "text-emerald-400",
          tone === "bad"  && "text-red-400",
          tone === "warn" && "text-amber-400",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[9px] text-muted-foreground/45 uppercase tracking-wider leading-none mt-1">
        {label}
      </span>
    </div>
  )
}
