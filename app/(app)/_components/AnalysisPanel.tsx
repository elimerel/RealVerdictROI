"use client"

import { cn } from "@/lib/utils"
import {
  type DealAnalysis,
  type DealInputs,
  type OfferCeiling,
  formatCurrency,
  formatPercent,
} from "@/lib/calculations"
import type { CompsResult } from "@/lib/comps"
import type { ComparablesAnalysis } from "@/lib/comparables"
import type { ChatAnalysisContext } from "@/app/api/chat/route"
import type { AiNarrative } from "@/lib/lead-adapter"
import { TIER_ACCENT, TIER_LABEL } from "@/app/(app)/_components/results/tier-style"
import { Save, CheckCircle2 } from "lucide-react"
import BreakdownSection from "./results/BreakdownSection"
import StressTestPanel from "./StressTestPanel"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PropertyFacts = {
  beds?: number | null
  baths?: number | null
  sqft?: number | null
  yearBuilt?: number | null
  propertyType?: string | null
}

export type AnalysisPanelProps = {
  // Core analysis data
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  address?: string
  inputs: DealInputs

  // AI-generated narrative (null = not yet generated, renders nothing)
  ai_narrative?: AiNarrative | null

  // Optional rich data (available when livecomps ran)
  comps?: CompsResult | null
  comparables?: ComparablesAnalysis | null
  analysisContext?: ChatAnalysisContext

  // Auth/pro state needed for gating
  signedIn: boolean
  isPro: boolean
  supabaseConfigured: boolean

  // Panel width in px — drives compact vs full display mode
  panelWidth: number

  // Actions
  onSave?: () => void
  onClose?: () => void

  // Metadata
  savedDealId?: string    // set if this deal is already saved
  isLoading?: boolean     // show skeleton while analysis is running

  // Optional property facts for display in the header
  propertyFacts?: PropertyFacts
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="p-5 space-y-4 animate-pulse">
      <div className="h-4 bg-zinc-800 rounded w-3/4" />
      <div className="h-3 bg-zinc-800 rounded w-1/2" />
      <div className="h-16 bg-zinc-800 rounded" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-zinc-800 rounded" />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Metric tile
// ---------------------------------------------------------------------------

function MetricTile({
  label,
  value,
  colored,
  good,
}: {
  label: string
  value: string
  colored?: boolean
  good?: boolean
}) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2.5 space-y-0.5">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
      <p
        className={cn(
          "text-base font-mono font-semibold",
          colored && good && "text-emerald-400",
          colored && !good && "text-red-400",
          !colored && "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section divider
// ---------------------------------------------------------------------------

function Divider() {
  return <div className="border-t border-zinc-800" />
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AnalysisPanel({
  analysis,
  walkAway,
  address,
  inputs,
  ai_narrative,
  supabaseConfigured,
  panelWidth,
  onSave,
  savedDealId,
  isLoading,
  propertyFacts: pf,
}: AnalysisPanelProps) {
  if (isLoading) return <LoadingSkeleton />

  const compact = panelWidth < 360
  const tier = analysis.verdict.tier
  const accent = TIER_ACCENT[tier] ?? "#888"
  const tierLabel = TIER_LABEL[tier] ?? tier

  const walkAwayCeiling = walkAway?.recommendedCeiling
  const walkAwayPrice = walkAwayCeiling?.price ?? null
  const listPrice = inputs.purchasePrice
  const walkAwayDiff =
    walkAwayPrice != null ? walkAwayPrice - listPrice : null

  const cashFlow = analysis.monthlyCashFlow
  const capRate = analysis.capRate
  const dscr = analysis.dscr
  const coc = analysis.cashOnCashReturn
  const dscrStr = isFinite(dscr) ? dscr.toFixed(2) : "∞"

  const hasNarrative =
    ai_narrative != null && ai_narrative.summary.trim().length > 0

  return (
    <div className="h-full flex flex-col bg-zinc-950">

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-5 py-4 space-y-5">

          {/* Header: address + property facts */}
          {(address || pf) && (
            <div className="space-y-1">
              {address && (
                <h2 className="text-sm font-semibold text-zinc-100 leading-snug">
                  {address}
                </h2>
              )}
              {pf && (pf.beds != null || pf.baths != null || pf.sqft != null) && (
                <p className="text-[10px] text-zinc-500 font-mono">
                  {[
                    pf.beds != null && `${pf.beds} bd`,
                    pf.baths != null && `${pf.baths} ba`,
                    pf.sqft != null && `${pf.sqft.toLocaleString()} sqft`,
                    pf.yearBuilt != null && `Built ${pf.yearBuilt}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════
              SECTION 1 — AI NARRATIVE
          ═══════════════════════════════════ */}
          {hasNarrative && (
            <>
              <div className="space-y-2.5">
                {/* Summary — the headline interpretation */}
                <p className="text-[15px] text-zinc-100 leading-snug">
                  {ai_narrative!.summary}
                </p>

                {/* Opportunity + Risk — only in full mode */}
                {!compact && (
                  <div className="space-y-2">
                    {ai_narrative!.opportunity && (
                      <div className="flex gap-2">
                        <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          {ai_narrative!.opportunity}
                        </p>
                      </div>
                    )}
                    {ai_narrative!.risk && (
                      <div className="flex gap-2">
                        <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          {ai_narrative!.risk}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <Divider />
            </>
          )}

          {/* ═══════════════════════════════════
              SECTION 2 — DECISION
          ═══════════════════════════════════ */}
          <div
            className="rounded-md px-4 py-3"
            style={{
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: accent + "30",
              backgroundColor: accent + "06",
            }}
          >
            <div className="flex items-start justify-between gap-4">
              {/* Left: verdict */}
              <div className="space-y-1 min-w-0">
                <p
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: accent }}
                >
                  {tierLabel}
                </p>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {analysis.verdict.summary}
                </p>
              </div>

              {/* Right: walk-away price */}
              {walkAwayPrice != null && (
                <div className="shrink-0 text-right space-y-0.5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    Walk-away
                  </p>
                  <p className="text-xl font-mono font-bold text-zinc-100">
                    {formatCurrency(walkAwayPrice, 0)}
                  </p>
                  {walkAwayDiff != null && (
                    <p
                      className={cn(
                        "text-[10px] font-mono",
                        walkAwayDiff >= 0 ? "text-emerald-400" : "text-amber-400"
                      )}
                    >
                      {walkAwayDiff >= 0
                        ? "Deal works at asking"
                        : `Need ${Math.abs(Math.round((walkAwayDiff / listPrice) * 100))}% off asking`}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ═══════════════════════════════════
              SECTION 3 — KEY METRICS
          ═══════════════════════════════════ */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <MetricTile
                label="Cash flow"
                value={`${cashFlow >= 0 ? "+" : ""}${formatCurrency(cashFlow, 0)}/mo`}
                colored
                good={cashFlow >= 0}
              />
              <MetricTile
                label="Cap rate"
                value={formatPercent(capRate, 2)}
                colored
                good={capRate >= 0.05}
              />
              <MetricTile
                label="DSCR"
                value={dscrStr}
                colored
                good={isFinite(dscr) ? dscr >= 1.2 : true}
              />
              <MetricTile
                label="Cash-on-cash"
                value={formatPercent(coc, 2)}
                colored
                good={coc >= 0.07}
              />
            </div>

            {/* Secondary metrics row — hidden in compact mode */}
            {!compact && (
              <p className="text-[10px] text-zinc-500 font-mono px-1">
                {[
                  `GRM ${analysis.grossRentMultiplier.toFixed(1)}x`,
                  `Break-even ${formatPercent(analysis.breakEvenOccupancy, 0)}`,
                  `IRR ${formatPercent(analysis.irr, 1)}`,
                  `LTV ${formatPercent(1 - inputs.downPaymentPercent / 100, 0)}`,
                ].join(" · ")}
              </p>
            )}
          </div>

          {/* ═══════════════════════════════════
              SECTION 4 — STRESS TEST (full mode only)
          ═══════════════════════════════════ */}
          {!compact && (
            <>
              <Divider />
              <StressTestPanel baseInputs={inputs} baseAnalysis={analysis} />
            </>
          )}

          {/* ═══════════════════════════════════
              SECTION 5 — MONTHLY BREAKDOWN (full mode only)
          ═══════════════════════════════════ */}
          {!compact && (
            <>
              <Divider />
              <BreakdownSection analysis={analysis} />
            </>
          )}

          {/* Bottom padding so content clears the sticky bar */}
          <div className="h-4" />
        </div>
      </div>

      {/* ═══════════════════════════════════
          SECTION 6 — STICKY BOTTOM BAR
      ═══════════════════════════════════ */}
      {onSave && supabaseConfigured && (
        <div className="shrink-0 border-t border-zinc-800 px-5 py-3 bg-zinc-950">
          <button
            type="button"
            onClick={onSave}
            disabled={!!savedDealId}
            className={cn(
              "w-full flex items-center justify-center gap-2 text-sm font-medium rounded-md px-4 py-2 border transition-colors",
              savedDealId
                ? "border-emerald-700 text-emerald-400 bg-emerald-950/20 cursor-default"
                : "border-zinc-600 text-zinc-200 bg-zinc-800 hover:bg-zinc-700 hover:border-zinc-500"
            )}
          >
            {savedDealId ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Saved
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save deal
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
