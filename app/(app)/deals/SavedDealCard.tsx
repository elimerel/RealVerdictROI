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
import { tonedSeverity, type Severity } from "@/lib/severity"

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
        // Phase 1 polish: drop the always-visible border. Cards are now
        // defined by surface tint differences and spacing — Mercury-style.
        // The selected state lifts the surface tint slightly instead of
        // brightening a border. Hover does the same at lower amplitude.
        "group relative w-full text-left rounded-lg p-4 cursor-pointer",
        "transition-colors duration-100 ease-[var(--rv-ease-out)]",
        isSelected
          ? "bg-white/[0.06]"
          : "bg-white/[0.02] hover:bg-white/[0.04]",
        isBadData && "bg-white/[0.02] opacity-80",
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
      <p className="text-[13px] font-semibold truncate mb-1 pr-6 text-foreground"
         style={{ letterSpacing: "-0.01em" }}>
        {address ?? "Unknown address"}
      </p>

      {/* Facts row */}
      {hasFacts && (
        <p className="text-[10px] text-muted-foreground/55 mb-4 font-mono rv-num">
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
          <p className="text-[11px] text-muted-foreground/55 font-mono rv-num mb-3">
            Asking&nbsp;
            <span className="text-foreground/75">
              {formatCurrency(analysis.inputs.purchasePrice, 0)}
            </span>
            {breakEven != null && (
              <>
                &nbsp;&middot;&nbsp;break-even&nbsp;
                <span className="text-foreground/75">{formatCurrency(breakEven, 0)}</span>
              </>
            )}
          </p>

          {/* Three metric tiles — only the worst offender per card carries
              color. The other two stay neutral so the eye lands on one
              piece of red per row instead of three. */}
          <div className="grid grid-cols-3 gap-2.5">
            <Metric
              label="DSCR"
              value={dscrStr}
              tone={tonedSeverity("dscr", dscr, cashFlow, capRate)}
            />
            <Metric
              label="Cash flow"
              value={(cashFlow >= 0 ? "+" : "\u2212") + formatCurrency(Math.abs(cashFlow), 0)}
              tone={tonedSeverity("cashFlow", dscr, cashFlow, capRate)}
            />
            <Metric
              label="Cap"
              value={formatPercent(capRate, 1)}
              tone={tonedSeverity("capRate", dscr, cashFlow, capRate)}
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-end mt-4">
        <span className="text-[10px] text-muted-foreground/40 shrink-0 font-mono">
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone: Severity }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span
        className={cn(
          "text-[12px] font-mono rv-num font-semibold leading-none truncate",
          tone === "good"    && "rv-tone-good",
          tone === "bad"     && "rv-tone-bad",
          tone === "warn"    && "rv-tone-warn",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[9px] text-muted-foreground/50 uppercase tracking-[0.08em] leading-none">
        {label}
      </span>
    </div>
  )
}
