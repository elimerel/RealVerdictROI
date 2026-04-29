"use client"

import { useState } from "react" // used in CollapsibleSection
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
import { TIER_ACCENT } from "@/lib/tier-constants"
import { Save, CheckCircle2, Loader2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react"
import type { DistributionResult, ProbabilisticVerdict } from "@/lib/distribution-engine"
import type { FieldProvenance } from "@/lib/types"
import WaterfallChart from "@/components/charts/waterfall-chart"
import ProjectionAreaChart from "@/components/charts/projection-area-chart"
import StressViz from "@/components/charts/stress-viz"
import SourceTag from "@/components/ui/source-tag"

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

export type DossierPanelProps = {
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  address?: string
  inputs: DealInputs
  ai_narrative?: AiNarrative | null
  distribution?: DistributionResult | null
  probabilisticVerdict?: ProbabilisticVerdict | null
  walkAwayConfidenceNote?: string | null
  inputProvenance?: Partial<Record<keyof DealInputs, FieldProvenance>> | null
  comps?: CompsResult | null
  comparables?: ComparablesAnalysis | null
  analysisContext?: ChatAnalysisContext
  signedIn: boolean
  isPro: boolean
  supabaseConfigured: boolean
  panelWidth: number
  onSave?: () => void
  onClose?: () => void
  savedDealId?: string
  isSaving?: boolean
  isLoading?: boolean
  badInputs?: boolean
  propertyFacts?: PropertyFacts
}

// ---------------------------------------------------------------------------
// Tier labels
// ---------------------------------------------------------------------------

const TIER_LABEL: Record<string, string> = {
  excellent: "STRONG BUY",
  good:      "GOOD DEAL",
  fair:      "BORDERLINE",
  poor:      "PASS",
  avoid:     "AVOID",
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="p-6 space-y-5 animate-pulse">
      <div className="h-3 bg-white/5 rounded w-2/3" />
      <div className="h-14 bg-white/5 rounded w-4/5" />
      <div className="h-2 bg-white/5 rounded w-full" />
      <div className="space-y-2 mt-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 bg-white/5 rounded" />
        ))}
      </div>
    </div>
  )
}

// Citation replaced — use SourceTag from @/components/ui/source-tag instead.

// ---------------------------------------------------------------------------
// Distribution bar — hero element
// ---------------------------------------------------------------------------

const DIST_COLORS: Record<string, string> = {
  excellent: "#22c55e",
  good:      "#4ade80",
  fair:      "#eab308",
  poor:      "#f97316",
  avoid:     "#ef4444",
}

const DIST_LABELS: Record<string, string> = {
  excellent: "Strong Buy",
  good:      "Good Deal",
  fair:      "Borderline",
  poor:      "Pass",
  avoid:     "Avoid",
}

function HeroDistributionBar({
  tierCounts,
  total,
}: {
  tierCounts: DistributionResult["tierCounts"]
  total: number
}) {
  const tiers = ["excellent", "good", "fair", "poor", "avoid"] as const

  return (
    <div className="space-y-2 rv-verdict-in rv-delay-1">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full gap-0.5">
        {tiers.map((t) => {
          const pct = total > 0 ? (tierCounts[t] / total) * 100 : 0
          if (pct < 0.5) return null
          return (
            <div
              key={t}
              className="rv-bar-grow"
              style={{
                width: `${pct}%`,
                backgroundColor: DIST_COLORS[t],
                borderRadius: "inherit",
              }}
              title={`${DIST_LABELS[t]}: ${Math.round(pct)}% of scenarios`}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {tiers.map((t) => {
          const count = tierCounts[t]
          if (!count) return null
          const pct = Math.round((count / total) * 100)
          return (
            <span
              key={t}
              className="text-[10px] font-mono tabular-nums"
              style={{ color: DIST_COLORS[t] }}
            >
              {DIST_LABELS[t]} {pct}%
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Argument-flow metric row
// ---------------------------------------------------------------------------

function ArgRow({
  label,
  value,
  sub,
  tone,
  provenance,
  className,
}: {
  label: string
  value: string
  sub?: string
  tone?: "good" | "bad" | "warn" | "neutral"
  provenance?: FieldProvenance | null
  className?: string
}) {
  const valueColor =
    tone === "good"    ? "text-emerald-400" :
    tone === "bad"     ? "text-red-400"     :
    tone === "warn"    ? "text-amber-400"   :
    "text-foreground"

  return (
    <div className={cn("flex items-center justify-between gap-4 py-2.5 border-b border-white/6 last:border-0 group", className)}>
      <div className="min-w-0 flex items-baseline gap-1.5 flex-1">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        {sub && (
          <span className="text-[11px] text-muted-foreground/40">{sub}</span>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        <SourceTag provenance={provenance} />
        <span className={cn("text-[15px] font-mono font-semibold tabular-nums tracking-tight", valueColor)}>
          {value}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/40 mb-3">
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Collapsible supporting data section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-white/6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-3 text-left group"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors">
          {title}
        </span>
        {open
          ? <ChevronUp className="h-3 w-3 text-muted-foreground/40" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground/40" />
        }
      </button>
      {open && <div className="pb-5">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main DossierPanel
// ---------------------------------------------------------------------------

export default function DossierPanel({
  analysis,
  walkAway,
  address,
  inputs,
  ai_narrative,
  distribution,
  probabilisticVerdict,
  walkAwayConfidenceNote,
  inputProvenance,
  supabaseConfigured,
  onSave,
  savedDealId,
  isSaving,
  isLoading,
  badInputs,
  propertyFacts: pf,
}: DossierPanelProps) {
  if (isLoading) return <LoadingSkeleton />

  if (badInputs) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {address && <h2 className="text-sm font-semibold">{address}</h2>}
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/6 p-4 space-y-2">
            <p className="text-sm font-medium text-amber-400">Listing data incomplete</p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Monthly rent couldn&apos;t be determined from this listing. Enter rent and other inputs
              manually to run a valid analysis.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const tier          = analysis.verdict.tier
  const accent        = TIER_ACCENT[tier] ?? "#888"
  const tierLabel     = TIER_LABEL[tier] ?? tier

  const walkAwayPrice  = walkAway?.recommendedCeiling?.price ?? null
  const listPrice      = inputs.purchasePrice
  const walkAwayDiff   = walkAwayPrice != null ? walkAwayPrice - listPrice : null

  const cashFlow  = analysis.monthlyCashFlow
  const capRate   = analysis.capRate
  const dscr      = analysis.dscr
  const coc       = analysis.cashOnCashReturn
  const dscrStr   = isFinite(dscr) ? dscr.toFixed(2) : "∞"

  // Gross income → NOI → Cash flow chain
  const grossRent         = inputs.monthlyRent + inputs.otherMonthlyIncome
  const effectiveIncome   = analysis.monthlyEffectiveIncome
  const opex              = analysis.monthlyOperatingExpenses
  const noi               = analysis.monthlyNOI
  const mortgagePayment   = analysis.monthlyMortgagePayment

  // Determine tone for DSCR
  const dscrTone = !isFinite(dscr) ? "good" : dscr >= 1.25 ? "good" : dscr >= 1.0 ? "warn" : "bad"
  const cashTone = cashFlow >= 150 ? "good" : cashFlow >= 0 ? "warn" : "bad"
  const walkTone = walkAwayDiff == null ? "neutral" : walkAwayDiff >= 0 ? "good" : walkAwayDiff > -20000 ? "warn" : "bad"

  const distTotal = distribution
    ? Object.values(distribution.tierCounts).reduce((s: number, c: number) => s + c, 0)
    : 0

  // Build the short narrative
  const hasNarrative = ai_narrative != null && ai_narrative.summary.trim().length > 0

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-6 pt-5 pb-4 space-y-0">

          {/* ── Address + facts ── */}
          {(address || (pf && (pf.beds != null || pf.sqft != null))) && (
            <div className="mb-5 space-y-0.5">
              {address && (
                <h2 className="text-sm font-semibold text-foreground leading-snug tracking-tight">
                  {address}
                </h2>
              )}
              {pf && (pf.beds != null || pf.baths != null || pf.sqft != null) && (
                <p className="text-[11px] text-muted-foreground/60 font-mono">
                  {[
                    pf.beds   != null && `${pf.beds} bd`,
                    pf.baths  != null && `${pf.baths} ba`,
                    pf.sqft   != null && `${pf.sqft.toLocaleString()} sqft`,
                    pf.yearBuilt != null && `${pf.yearBuilt}`,
                  ].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════
              HERO — WALK-AWAY PRICE
          ══════════════════════════════════════ */}
          {walkAwayPrice != null && (
            <div className="mb-5 rv-number-in">
              <p
                className="font-mono font-bold tabular-nums leading-[1] tracking-tight text-foreground"
                style={{ fontSize: "var(--rv-size-display)" }}
              >
                {formatCurrency(walkAwayPrice, 0)}
              </p>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/50">
                  Walk-away price
                </span>
                <span className="text-[12px] font-mono tabular-nums text-muted-foreground/60">
                  Asking {formatCurrency(listPrice, 0)}
                </span>
                {walkAwayDiff != null && (
                  <span
                    className={cn(
                      "text-[12px] font-mono tabular-nums font-semibold",
                      walkAwayDiff >= 0 ? "text-emerald-400" : "text-amber-400"
                    )}
                  >
                    {walkAwayDiff >= 0
                      ? `+${formatCurrency(walkAwayDiff, 0)} headroom`
                      : `${formatCurrency(Math.abs(walkAwayDiff), 0)} below asking`}
                  </span>
                )}
              </div>
              {walkAwayConfidenceNote && (
                <p className="mt-1 text-[11px] text-amber-400/60 leading-snug max-w-[44ch]">
                  {walkAwayConfidenceNote}
                </p>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════
              VERDICT BADGE
          ══════════════════════════════════════ */}
          <div className="mb-4 rv-verdict-in">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-[0.1em]"
              style={{
                color: accent,
                backgroundColor: `${accent}18`,
                border: `1px solid ${accent}35`,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: accent }}
              />
              {tierLabel}
              {probabilisticVerdict && probabilisticVerdict.dominantTierFraction < 0.99 && (
                <span className="ml-1 font-normal text-muted-foreground/60 normal-case tracking-normal">
                  ({Math.round(probabilisticVerdict.dominantTierFraction * probabilisticVerdict.scenarioCount)}/{probabilisticVerdict.scenarioCount} scenarios)
                </span>
              )}
            </div>
          </div>

          {/* ══════════════════════════════════════
              SCENARIO DISTRIBUTION BAR
          ══════════════════════════════════════ */}
          {distribution && distTotal > 0 && (
            <div className="mb-5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/40 mb-2">
                {distTotal} scenario distribution
              </p>
              <HeroDistributionBar tierCounts={distribution.tierCounts} total={distTotal} />
            </div>
          )}

          {/* ══════════════════════════════════════
              NARRATIVE — research-note style
          ══════════════════════════════════════ */}
          <div className="mb-5 space-y-2 rv-verdict-in rv-delay-2">
            {hasNarrative ? (
              <>
                {probabilisticVerdict?.headline && probabilisticVerdict.headline !== ai_narrative!.summary && (
                  <p className="text-[13px] text-foreground/85 leading-relaxed font-medium">
                    {probabilisticVerdict.headline}
                  </p>
                )}
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  {ai_narrative!.summary}
                </p>
                {ai_narrative!.opportunity && (
                  <div className="flex gap-2.5 mt-1">
                    <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <p className="text-[13px] text-muted-foreground leading-relaxed">
                      {ai_narrative!.opportunity}
                    </p>
                  </div>
                )}
                {ai_narrative!.risk && (
                  <div className="flex gap-2.5">
                    <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <p className="text-[13px] text-muted-foreground leading-relaxed">
                      {ai_narrative!.risk}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                {probabilisticVerdict?.headline && (
                  <p className="text-[13px] text-foreground/85 leading-relaxed font-medium">
                    {probabilisticVerdict.headline}
                  </p>
                )}
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  {getInlineSummary(inputs, analysis, walkAwayDiff)}
                </p>
                {probabilisticVerdict?.conditionForOutlier && (
                  <p className="text-[12px] text-muted-foreground/60 leading-relaxed">
                    {probabilisticVerdict.conditionForOutlier}
                  </p>
                )}
              </>
            )}
          </div>

          {/* ══════════════════════════════════════
              ARGUMENT — structured metric chain
          ══════════════════════════════════════ */}
          <div className="mb-1 rv-verdict-in rv-delay-3">
            <SectionLabel>The argument</SectionLabel>

            {/* Income chain */}
            <ArgRow
              label="Gross rent"
              value={`${formatCurrency(grossRent, 0)}/mo`}
              provenance={inputProvenance?.monthlyRent}
            />
            <ArgRow
              label="After vacancy & operating expenses"
              sub={`opex ${formatCurrency(opex, 0)}/mo`}
              value={`${formatCurrency(effectiveIncome - opex, 0)}/mo NOI`}
              tone={noi > 0 ? "neutral" : "bad"}
              provenance={inputProvenance?.vacancyRatePercent}
            />
            <ArgRow
              label="Mortgage (P&I)"
              value={`−${formatCurrency(mortgagePayment, 0)}/mo`}
              sub={`${inputs.loanInterestRate}% · ${inputs.loanTermYears} yr`}
              provenance={inputProvenance?.loanInterestRate}
            />
            <ArgRow
              label="Net cash flow"
              value={`${cashFlow >= 0 ? "+" : ""}${formatCurrency(cashFlow, 0)}/mo`}
              tone={cashTone}
            />

            {/* Divider */}
            <div className="my-3 border-t border-white/6" />

            {/* Ratio chain */}
            <ArgRow
              label="DSCR"
              value={dscrStr}
              sub={
                !isFinite(dscr) ? "no debt"
                : dscr >= 1.25 ? `${((dscr - 1) * 100).toFixed(0)}% buffer`
                : dscr >= 1.0  ? "barely covers debt"
                : "below debt service"
              }
              tone={dscrTone}
            />
            <ArgRow
              label="Cap rate"
              value={formatPercent(capRate, 2)}
              sub={capRate >= 0.05 ? "above 5% threshold" : "below 5%"}
              tone={capRate >= 0.06 ? "good" : capRate >= 0.04 ? "warn" : "bad"}
            />
            <ArgRow
              label="Cash-on-cash"
              value={formatPercent(coc, 2)}
              tone={coc >= 0.08 ? "good" : coc >= 0.05 ? "warn" : "bad"}
            />
            <ArgRow
              label="IRR"
              value={isFinite(analysis.irr) ? formatPercent(analysis.irr, 1) : "∞"}
              sub="incl. appreciation & exit"
              tone={analysis.irr >= 0.12 ? "good" : analysis.irr >= 0.07 ? "warn" : "bad"}
              provenance={inputProvenance?.annualAppreciationPercent}
            />
            <ArgRow
              label="Property tax / yr"
              value={formatCurrency(inputs.annualPropertyTax, 0)}
              provenance={inputProvenance?.annualPropertyTax}
            />

            {/* Walk-away conclusion */}
            {walkAwayPrice != null && (
              <>
                <div className="my-3 border-t border-white/6" />
                <ArgRow
                  label="Walk-away price"
                  value={formatCurrency(walkAwayPrice, 0)}
                  sub={walkAwayDiff != null
                    ? walkAwayDiff >= 0
                      ? `${formatCurrency(walkAwayDiff, 0)} below asking`
                      : `${formatCurrency(Math.abs(walkAwayDiff), 0)} above asking`
                    : undefined}
                  tone={walkTone}
                />
              </>
            )}

            {/* Secondary metrics */}
            <div className="mt-3 pt-3 border-t border-white/6">
              <p className="text-[10px] font-mono tabular-nums text-muted-foreground/40">
                {[
                  `GRM ${analysis.grossRentMultiplier.toFixed(1)}×`,
                  `Break-even ${formatPercent(analysis.breakEvenOccupancy, 0)}`,
                  `LTV ${formatPercent(1 - inputs.downPaymentPercent / 100, 0)}`,
                  `Total cash in ${formatCurrency(analysis.totalCashInvested, 0)}`,
                ].join("  ·  ")}
              </p>
            </div>
          </div>

          {/* ══════════════════════════════════════
              SUPPORTING DATA (collapsible)
          ══════════════════════════════════════ */}

          <CollapsibleSection title="Stress test">
            <p className="text-[12px] text-muted-foreground/60 mb-3 leading-relaxed">
              Each bar holds all other inputs fixed and changes one variable. Cash flow under stress.
            </p>
            <StressViz
              baseInputs={inputs}
              baseAnalysis={analysis}
              distribution={distribution ?? undefined}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Monthly breakdown">
            <p className="text-[12px] text-muted-foreground/60 mb-3 leading-relaxed">
              Rent in, every expense out, mortgage last.
            </p>
            <WaterfallChart analysis={analysis} />
          </CollapsibleSection>

          <CollapsibleSection title={`${analysis.inputs.holdPeriodYears}-year projection`}>
            <p className="text-[12px] text-muted-foreground/60 mb-3 leading-relaxed">
              Equity (solid) and cumulative cash flow (dashed)
              {distribution ? " with confidence band." : "."}
            </p>
            <ProjectionAreaChart
              projection={analysis.projection}
              distribution={distribution}
            />
          </CollapsibleSection>

          {/* Bottom padding */}
          <div className="h-4" />
        </div>
      </div>

      {/* ── Sticky save bar ── */}
      {onSave && supabaseConfigured && (
        <div className="shrink-0 border-t border-white/6 px-6 py-3 bg-background">
          <button
            type="button"
            onClick={onSave}
            disabled={!!savedDealId || isSaving}
            className={cn(
              "w-full flex items-center justify-center gap-2 text-sm font-medium rounded-lg px-4 py-2.5 border transition-all duration-150",
              savedDealId
                ? "border-emerald-700/50 text-emerald-400 bg-emerald-950/20 cursor-default"
                : isSaving
                  ? "border-white/8 text-muted-foreground bg-muted cursor-default"
                  : "border-white/10 text-foreground bg-white/4 hover:bg-white/8 hover:border-white/18",
            )}
          >
            {savedDealId ? (
              <><CheckCircle2 className="h-4 w-4" /> Saved to Pipeline</>
            ) : isSaving ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
            ) : (
              <><Save className="h-4 w-4" /> Save to Pipeline</>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline summary generator (when no AI narrative)
// ---------------------------------------------------------------------------

function getInlineSummary(
  inputs: DealInputs,
  analysis: DealAnalysis,
  walkAwayDiff: number | null,
): string {
  const askStr = formatCurrency(inputs.purchasePrice, 0)
  const cf     = analysis.monthlyCashFlow
  const dscr   = analysis.dscr
  const dscrStr = isFinite(dscr) ? dscr.toFixed(2) : "∞"
  const capStr  = formatPercent(analysis.capRate, 1)

  if (isFinite(dscr) && dscr < 1.0) {
    if (walkAwayDiff != null && walkAwayDiff < 0)
      return `At ${askStr}, DSCR of ${dscrStr} means this property cannot service its debt — it needs to be ${formatCurrency(Math.abs(walkAwayDiff), 0)} cheaper.`
    return `At ${askStr}, DSCR of ${dscrStr} — this property cannot service its own debt, bleeding ${formatCurrency(Math.abs(cf), 0)}/mo.`
  }
  if (walkAwayDiff != null && walkAwayDiff < -4999) {
    const waPrice = analysis.inputs.purchasePrice + walkAwayDiff
    const waStr = waPrice > 0 ? formatCurrency(waPrice, 0) : null
    return `Overpriced by ${formatCurrency(Math.abs(walkAwayDiff), 0)}. At ${askStr}, cash flow is ${formatCurrency(cf, 0)}/mo${waStr ? ` — numbers require ${waStr}` : ""}.`
  }
  if (cf < -150)
    return `At ${askStr}, this property runs at a ${formatCurrency(Math.abs(cf), 0)}/mo loss — ${capStr} cap rate doesn't cover carrying costs.`
  if (isFinite(dscr) && dscr < 1.25)
    return `Marginal. DSCR of ${dscrStr} and ${formatCurrency(cf, 0)}/mo leaves almost no room for vacancy or rate movement.`
  if (walkAwayDiff != null && walkAwayDiff > 9999)
    return `Strong deal at ${askStr} — ${formatCurrency(cf, 0)}/mo cash flow, ${capStr} cap rate, ${formatCurrency(walkAwayDiff, 0)} of headroom before the numbers break.`
  if (cf > 0)
    return `Numbers work at ${askStr} — ${formatCurrency(cf, 0)}/mo cash flow, ${capStr} cap rate, DSCR ${dscrStr}.`
  return `At ${askStr} — ${formatCurrency(cf, 0)}/mo cash flow, ${capStr} cap rate, DSCR ${dscrStr}.`
}

