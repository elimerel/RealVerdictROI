"use client"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { TIER_ACCENT, TIER_LABEL } from "@/lib/tier-constants"
import { Bed, Bath, Ruler, Calendar, Home, ShieldCheck, Save, CheckCircle2, X } from "lucide-react"
import ResultsTabs from "./ResultsTabs"
import EvidenceSection from "./results/EvidenceSection"
import BreakdownSection from "./results/BreakdownSection"
import StressTestPanel from "./StressTestPanel"
import CompsSection from "./CompsSection"
import VerdictRubric from "./VerdictRubric"
import FollowUpChat from "./FollowUpChat"
import ProCompsTeaser from "./ProCompsTeaser"

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

  // Optional rich data (available when livecomps ran)
  comps?: CompsResult | null
  comparables?: ComparablesAnalysis | null
  analysisContext?: ChatAnalysisContext

  // Auth/pro state needed for gating
  signedIn: boolean
  isPro: boolean
  supabaseConfigured: boolean

  // Panel width in px — drives compact/expanded/focus display mode
  panelWidth: number

  // Actions
  onSave?: () => void
  onClose?: () => void

  // Metadata
  savedDealId?: string   // set if this deal is already saved
  isLoading?: boolean    // show skeleton while analysis is running

  // Optional property facts for display in the header
  propertyFacts?: PropertyFacts
}

type DisplayMode = "compact" | "expanded" | "focus"

function getDisplayMode(w: number): DisplayMode {
  if (w < 360) return "compact"
  if (w <= 520) return "expanded"
  return "focus"
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="p-5 space-y-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 bg-zinc-800 rounded w-3/4" />
        <div className="h-3 bg-zinc-800 rounded w-1/2" />
      </div>
      <div className="h-16 bg-zinc-800 rounded" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-zinc-800 rounded" />
        ))}
      </div>
      <div className="h-9 bg-zinc-800 rounded" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Score breakdown mini — compact mode only
// ---------------------------------------------------------------------------

function ScoreBreakdown({ analysis }: { analysis: DealAnalysis }) {
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Score breakdown
      </p>
      <div className="space-y-2">
        {analysis.verdict.breakdown.map((b) => {
          const pct = b.maxPoints > 0 ? b.points / b.maxPoints : 0
          const barWidth = Math.max(0, Math.round(pct * 100)) + "%"
          const scoreText = b.points + "/" + b.maxPoints
          return (
            <div key={b.category} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{b.category}</span>
                <span className={cn(
                  "font-mono font-medium",
                  b.status === "win" || b.status === "ok"
                    ? "text-emerald-400"
                    : b.status === "warn"
                      ? "text-amber-400"
                      : "text-red-400"
                )}>
                  {scoreText}
                </span>
              </div>
              <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    b.status === "win" || b.status === "ok"
                      ? "bg-emerald-500"
                      : b.status === "warn"
                        ? "bg-amber-500"
                        : "bg-red-500"
                  )}
                  style={{ width: barWidth }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AnalysisPanel({
  analysis,
  walkAway,
  address,
  inputs,
  comps,
  comparables,
  analysisContext,
  isPro,
  supabaseConfigured,
  panelWidth,
  onSave,
  onClose,
  savedDealId,
  isLoading,
  propertyFacts: pf,
}: AnalysisPanelProps) {
  if (isLoading) {
    return <LoadingSkeleton />
  }

  const mode = getDisplayMode(panelWidth)
  const tier = analysis.verdict.tier
  const accent = TIER_ACCENT[tier]
  const label = TIER_LABEL[tier]

  const walkAwayPrice = walkAway?.primaryTarget?.price ?? null
  const listPrice = inputs.purchasePrice ?? null
  const walkAwayDiff =
    walkAwayPrice != null && listPrice != null
      ? walkAwayPrice - listPrice
      : null

  const keyMetrics = [
    {
      label: "Cash flow",
      value:
        (analysis.monthlyCashFlow >= 0 ? "+" : "") +
        formatCurrency(analysis.monthlyCashFlow, 0) +
        "/mo",
      good: analysis.monthlyCashFlow >= 0,
    },
    {
      label: "Cap rate",
      value: formatPercent(analysis.capRate, 2),
      good: analysis.capRate >= 0.05,
    },
    {
      label: "DSCR",
      value: isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞",
      good: analysis.dscr >= 1.2,
    },
    {
      label: "Cash-on-cash",
      value: formatPercent(analysis.cashOnCashReturn, 2),
      good: analysis.cashOnCashReturn >= 0.07,
    },
  ]

  const tabs = [
    {
      id: "numbers",
      label: "Numbers",
      content: (
        <div className="space-y-10">
          <EvidenceSection analysis={analysis} comps={comps ?? null} />
          <BreakdownSection analysis={analysis} />
        </div>
      ),
    },
    {
      id: "stress",
      label: "Stress",
      content: <StressTestPanel baseInputs={inputs} baseAnalysis={analysis} />,
    },
    {
      id: "comps",
      label: "Comps",
      badge: !isPro ? "Pro" : undefined,
      content: !isPro ? (
        <ProCompsTeaser returnTo="/deals" />
      ) : (
        <CompsSection
          analysis={analysis}
          comps={comps ?? null}
          comparables={comparables ?? null}
          address={address}
        />
      ),
    },
    {
      id: "rubric",
      label: "Rubric",
      content: <VerdictRubric verdict={analysis.verdict} />,
    },
    {
      id: "ai",
      label: "Ask AI",
      content: <FollowUpChat inputs={inputs} analysisContext={analysisContext} />,
    },
  ]

  const padding = mode === "compact" ? "p-3" : "p-5"

  return (
    <ScrollArea className="h-full">
      <div className={cn("space-y-4", padding)}>

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {address && (
              <h2 className="text-sm font-semibold leading-snug truncate">
                {address}
              </h2>
            )}
            {pf && (pf.beds != null || pf.baths != null || pf.sqft != null || pf.yearBuilt != null) && (
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Bed className="h-3 w-3" />{pf.beds != null ? `${pf.beds} bd` : "—"}
                </span>
                <span className="flex items-center gap-1">
                  <Bath className="h-3 w-3" />{pf.baths != null ? `${pf.baths} ba` : "—"}
                </span>
                <span className="flex items-center gap-1">
                  <Ruler className="h-3 w-3" />{pf.sqft != null ? `${pf.sqft.toLocaleString()} sqft` : "—"}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />{pf.yearBuilt != null ? `Built ${pf.yearBuilt}` : "—"}
                </span>
                {pf.propertyType != null && (
                  <span className="flex items-center gap-1">
                    <Home className="h-3 w-3" />{pf.propertyType}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 flex items-center gap-1.5">
            {/* Save / Saved button — only when Supabase is configured and onSave is provided */}
            {onSave && supabaseConfigured && (
              <button
                type="button"
                onClick={onSave}
                disabled={!!savedDealId}
                className={cn(
                  "flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1.5 border transition-colors",
                  savedDealId
                    ? "border-emerald-700 text-emerald-400 bg-emerald-950/20 cursor-default"
                    : "border-border text-muted-foreground hover:text-foreground bg-transparent hover:border-zinc-600"
                )}
              >
                {savedDealId ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Saved
                  </>
                ) : (
                  <>
                    <Save className="h-3 w-3" />
                    Save
                  </>
                )}
              </button>
            )}

            {/* Close button — when parent provides onClose */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-zinc-600 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Verdict badge ── */}
        <div
          className="rounded-lg px-4 py-3 space-y-1"
          style={{
            backgroundColor: accent + "1a",
            borderColor: accent + "40",
            borderWidth: 1,
          }}
        >
          <p
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: accent }}
          >
            Verdict
          </p>
          <p className="text-xl font-bold" style={{ color: accent }}>
            {label}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {analysis.verdict.summary}
          </p>
        </div>

        {/* ── Walk-away ceiling ── */}
        {walkAwayPrice != null && (
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3" /> Walk-Away Ceiling
            </p>
            <p className="text-2xl font-bold font-mono">
              {formatCurrency(walkAwayPrice, 0)}
            </p>
            {walkAwayDiff != null && (
              <p
                className={cn(
                  "text-xs font-mono",
                  walkAwayDiff >= 0 ? "text-emerald-400" : "text-red-400"
                )}
              >
                {walkAwayDiff >= 0
                  ? formatCurrency(walkAwayDiff, 0) +
                    " under ceiling — deal works at ask"
                  : formatCurrency(-walkAwayDiff, 0) + " over ceiling"}
              </p>
            )}
          </div>
        )}

        {/* ── 4 key metric tiles (all modes) ── */}
        <div className="grid grid-cols-2 gap-2">
          {keyMetrics.map((m) => (
            <div
              key={m.label}
              className="rounded-lg border border-border bg-muted/10 px-3 py-2.5 space-y-0.5"
            >
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
              <p
                className={cn(
                  "text-base font-mono font-semibold",
                  m.good ? "text-emerald-400" : "text-red-400"
                )}
              >
                {m.value}
              </p>
            </div>
          ))}
        </div>

        {/* ── Compact mode: mini score breakdown + expand hint ── */}
        {mode === "compact" && (
          <>
            <ScoreBreakdown analysis={analysis} />
            <p className="text-center text-[10px] text-muted-foreground py-1">
              Drag the panel handle to expand for full analysis
            </p>
          </>
        )}

        {/* ── Expanded / Focus mode: full tab strip ── */}
        {mode !== "compact" && (
          <ResultsTabs tabs={tabs} />
        )}

      </div>
    </ScrollArea>
  )
}
