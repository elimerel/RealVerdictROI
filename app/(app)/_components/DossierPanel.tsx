"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  analyseDeal,
  findOfferCeiling,
  sanitiseInputs,
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
import type { DistributionResult, ProbabilisticVerdict } from "@/lib/distribution-engine"
import type { FieldProvenance } from "@/lib/types"
import {
  Save,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  LineChart,
  DollarSign,
  Percent,
  ExternalLink,
} from "lucide-react"
import WaterfallChart from "@/components/charts/waterfall-chart"
import { tonedSeverity, type Severity } from "@/lib/severity"

// ---------------------------------------------------------------------------
// Types — kept compatible with existing call sites; verdict-shaped props
// are accepted but ignored. The panel never displays a verdict.
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
  /** AI factual summary — single sentence. Older callers pass full narrative; we read summary only. */
  ai_narrative?: AiNarrative | null
  /** Optional rent sanity-check note from AI ("listing mentions full reno…"). */
  rentNote?: string | null
  /** Source of the underlying listing — drives the small badge near the address. */
  source?: "zillow" | "redfin" | "realtor" | "homes" | "trulia" | "movoto" | null
  sourceUrl?: string | null
  // Legacy props — accepted for compat, unused.
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
  onOpenSource?: (url: string) => void
}

// ---------------------------------------------------------------------------
// Loading skeleton — exported so callers can render it without supplying inputs
// ---------------------------------------------------------------------------

export function DossierPanelSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-3 bg-white/5 rounded w-2/3" />
        <div className="h-2 bg-white/5 rounded w-1/3" />
      </div>
      <div className="grid grid-cols-3 gap-3 pt-2">
        <div className="space-y-1.5">
          <div className="h-2 bg-white/5 rounded w-12" />
          <div className="h-7 bg-white/5 rounded" />
          <div className="h-2 bg-white/5 rounded w-16" />
        </div>
        <div className="space-y-1.5">
          <div className="h-2 bg-white/5 rounded w-12" />
          <div className="h-7 bg-white/5 rounded" />
          <div className="h-2 bg-white/5 rounded w-16" />
        </div>
        <div className="space-y-1.5">
          <div className="h-2 bg-white/5 rounded w-12" />
          <div className="h-7 bg-white/5 rounded" />
          <div className="h-2 bg-white/5 rounded w-16" />
        </div>
      </div>
      <div className="h-3 bg-white/5 rounded w-4/5" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// HeroNumber — one of the three columns at the top of the panel
// ---------------------------------------------------------------------------

function toneClass(sev: Severity): string {
  switch (sev) {
    case "good": return "rv-tone-good"
    case "bad":  return "rv-tone-bad"
    case "warn": return "rv-tone-warn"
    default:     return "text-foreground"
  }
}

function HeroNumber({
  label,
  icon,
  value,
  caption,
  tone,
  pulseKey,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  value: string
  caption?: string
  /** Color only when this metric is the worst offender on the deal —
      otherwise tone="neutral" and the number stays in foreground white. */
  tone: Severity
  pulseKey: string | number
}) {
  const Icon = icon
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] rv-t2 flex items-center gap-1.5">
        <Icon className="h-3 w-3 rv-t3" />
        {label}
      </p>
      <p
        key={pulseKey}
        className={cn(
          "font-mono font-medium rv-num leading-none rv-number-pulse",
          toneClass(tone),
        )}
        style={{
          fontSize: "28px",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </p>
      {caption && (
        <p className="text-[11px] rv-t3 leading-snug inline-flex items-center gap-1.5">
          <span className={cn("rv-dot", toneClass(tone))} />
          {caption}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AssumptionInput — small inline editable input
// ---------------------------------------------------------------------------

function AssumptionInput({
  label,
  value,
  suffix,
  prefix,
  step = 1,
  min = 0,
  max,
  onChange,
}: {
  label: string
  value: number
  suffix?: string
  prefix?: string
  step?: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState<string>(formatNum(value))
  // "Adjusting state on prop change" — keep the user-editable draft in sync
  // when the parent loads a new listing without using setState-in-effect
  // (which the linter rightly flags as cascading-render bait).
  const [lastValue, setLastValue] = useState<number>(value)
  if (lastValue !== value) {
    setLastValue(value)
    setDraft(formatNum(value))
  }

  const commit = () => {
    const parsed = parseFloat(draft.replace(/[^0-9.\-]/g, ""))
    if (!Number.isFinite(parsed)) {
      setDraft(formatNum(value))
      return
    }
    let next = parsed
    if (min != null) next = Math.max(min, next)
    if (max != null) next = Math.min(max, next)
    onChange(next)
    setDraft(formatNum(next))
  }

  return (
    <label className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[12px] text-muted-foreground/70 truncate">{label}</span>
      <div className="rv-input flex items-center gap-1 px-2.5 py-1 min-w-0">
        {prefix && (
          <span className="text-[11px] text-muted-foreground/45 font-mono">{prefix}</span>
        )}
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
            if (e.key === "ArrowUp") {
              e.preventDefault()
              const next = (Number.isFinite(parseFloat(draft)) ? parseFloat(draft) : value) + step
              onChange(max != null ? Math.min(max, next) : next)
            }
            if (e.key === "ArrowDown") {
              e.preventDefault()
              const next = (Number.isFinite(parseFloat(draft)) ? parseFloat(draft) : value) - step
              onChange(min != null ? Math.max(min, next) : next)
            }
          }}
          className="w-16 bg-transparent border-0 outline-none text-[12px] font-mono rv-num text-foreground text-right p-0"
        />
        {suffix && (
          <span className="text-[11px] text-muted-foreground/45 font-mono">{suffix}</span>
        )}
      </div>
    </label>
  )
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0"
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString()
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2).replace(/\.?0+$/, "")
}

// k-notation keeps the hero cash-flow number short enough to fit at 28px
// in a 3-column layout without truncation.
function formatCashFlowHero(cf: number): string {
  const abs = Math.abs(cf)
  const sign = cf >= 0 ? "+" : "\u2212"
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}k`
  if (abs >= 1_000)  return `${sign}$${(abs / 1_000).toFixed(1)}k`
  return `${sign}$${Math.round(abs)}`
}

// ---------------------------------------------------------------------------
// Collapsible section
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
    <div className="rv-hairline">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-4 text-left group"
      >
        <span className="rv-section-label group-hover:text-foreground/80 transition-colors">
          {title}
        </span>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 rv-t3" />
          : <ChevronDown className="h-3.5 w-3.5 rv-t3" />}
      </button>
      {/* min-w-0 + overflow-hidden is the fix for the "words overlap when
          you expand a section" bug — child charts/SVGs now stay inside
          their parent column even when the panel is narrow. */}
      {open && (
        <div className="pb-5 min-w-0 overflow-hidden">
          {children}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Caption helpers — kept local because they describe the *user-visible*
// reason a metric falls in a given band, which is independent of the
// numeric severity ranking in lib/severity.
// ---------------------------------------------------------------------------

function dscrCaption(dscr: number): string {
  if (!Number.isFinite(dscr)) return "no debt"
  if (dscr >= 1.25) return "comfortable"
  if (dscr >= 1.0)  return "barely covers debt"
  return "below 1.0"
}

function cashFlowCaption(cf: number): string {
  if (cf >= 150) return "positive"
  if (cf >= 0)   return "near break-even"
  return "negative"
}

function capRateCaption(cap: number): string {
  if (cap >= 0.06) return "above 6%"
  if (cap >= 0.05) return "at threshold"
  return "below 5%"
}

// ---------------------------------------------------------------------------
// Factual one-line summary — fallback when no AI summary is available
// ---------------------------------------------------------------------------

function buildFactualSummary(
  inputs: DealInputs,
  analysis: DealAnalysis,
  walkAway: OfferCeiling | null,
  pf?: PropertyFacts,
  address?: string,
): string {
  const beds = pf?.beds
  const baths = pf?.baths
  const city = address?.split(",").slice(-3, -1)[0]?.trim()

  const head = [
    beds != null && baths != null ? `${beds}bd/${baths}ba` : null,
    pf?.propertyType ?? null,
    city ? `in ${city}` : null,
  ].filter(Boolean).join(" ")

  const ask = formatCurrency(inputs.purchasePrice, 0)
  const rent = formatCurrency(inputs.monthlyRent, 0)
  const wa = walkAway?.recommendedCeiling?.price
  const breakEven = wa != null ? formatCurrency(wa, 0) : null

  const lead = head ? `${head}. ` : ""
  const breakLine = breakEven ? ` Breaks even at ${breakEven}.` : ""
  void analysis
  return `${lead}Asking ${ask}, est. rent ${rent}/mo.${breakLine}`
}

// ---------------------------------------------------------------------------
// Source badge
// ---------------------------------------------------------------------------

function SourceBadge({
  source,
  sourceUrl,
  onOpen,
}: {
  source?: string | null
  sourceUrl?: string | null
  onOpen?: (url: string) => void
}) {
  if (!source) return null
  const canOpen = !!sourceUrl && !!onOpen
  const content = (
    <>
      {source}
      {canOpen ? <ExternalLink className="h-2.5 w-2.5" /> : null}
    </>
  )
  if (canOpen && sourceUrl) {
    return (
      <button
        type="button"
        onClick={() => onOpen(sourceUrl)}
        className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/40 px-1.5 py-0.5 rounded bg-white/4 border border-white/6 inline-flex items-center gap-1 hover:text-foreground/80 transition-colors"
      >
        {content}
      </button>
    )
  }
  return (
    <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/40 px-1.5 py-0.5 rounded bg-white/4 border border-white/6 inline-flex items-center gap-1">
      {content}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main DossierPanel
// ---------------------------------------------------------------------------

export default function DossierPanel({
  analysis: incomingAnalysis,
  walkAway: incomingWalkAway,
  address,
  inputs: incomingInputs,
  ai_narrative,
  rentNote,
  source,
  sourceUrl,
  supabaseConfigured,
  onSave,
  savedDealId,
  isSaving,
  isLoading,
  badInputs,
  propertyFacts: pf,
  onOpenSource,
}: DossierPanelProps) {
  // Loading state has its own component — caller should render that instead.
  // We still support the `isLoading` prop for backward compat.
  const skeletonInputs = (incomingInputs ?? {}) as DealInputs

  // Local working copy of inputs — assumption edits update this. When the
  // parent passes a different `inputs` (new listing) we reset via the
  // "adjusting state on prop change" pattern instead of setState-in-effect.
  const [workingInputs, setWorkingInputs] = useState<DealInputs>(skeletonInputs)
  const [lastIncomingInputs, setLastIncomingInputs] = useState<DealInputs | undefined>(incomingInputs)
  if (incomingInputs && lastIncomingInputs !== incomingInputs) {
    setLastIncomingInputs(incomingInputs)
    setWorkingInputs(incomingInputs)
  }

  // Recompute analysis whenever working inputs change. This is local math
  // and runs in <50ms — no loading state needed.
  const { analysis, walkAway, isDirty } = useMemo(() => {
    if (!incomingInputs || !incomingAnalysis) {
      return { analysis: incomingAnalysis, walkAway: incomingWalkAway, isDirty: false }
    }
    const dirty =
      workingInputs.downPaymentPercent !== incomingInputs.downPaymentPercent ||
      workingInputs.loanInterestRate    !== incomingInputs.loanInterestRate ||
      workingInputs.monthlyRent         !== incomingInputs.monthlyRent ||
      workingInputs.vacancyRatePercent  !== incomingInputs.vacancyRatePercent
    if (!dirty) {
      return { analysis: incomingAnalysis, walkAway: incomingWalkAway, isDirty: false }
    }
    try {
      const sanitized = sanitiseInputs(workingInputs)
      const a = analyseDeal(sanitized)
      const w = (() => {
        try { return findOfferCeiling(sanitized) } catch { return null }
      })()
      return { analysis: a, walkAway: w, isDirty: true }
    } catch {
      return { analysis: incomingAnalysis, walkAway: incomingWalkAway, isDirty: false }
    }
  }, [workingInputs, incomingInputs, incomingAnalysis, incomingWalkAway])

  if (isLoading || !analysis || !incomingInputs) return <DossierPanelSkeleton />

  if (badInputs) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="flex-1 overflow-y-auto p-7 space-y-4">
          {address && (
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{address}</h2>
          )}
          <div
            className="rounded-md p-4"
            style={{ background: "var(--rv-warn-sub)" }}
          >
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Couldn&rsquo;t read enough numbers from this listing to underwrite it.
              Try refreshing or paste the URL manually.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Hero numbers
  const dscr = analysis.dscr
  const cf = analysis.monthlyCashFlow
  const cap = analysis.capRate

  const dscrStr = Number.isFinite(dscr) ? dscr.toFixed(2) : "\u221E"
  const cfStr   = formatCashFlowHero(cf)
  const capStr  = formatPercent(cap, 2)

  // Pulse keys force the number element to re-mount on change → CSS animation re-fires
  const pulseKey = `${workingInputs.downPaymentPercent}-${workingInputs.loanInterestRate}-${workingInputs.monthlyRent}-${workingInputs.vacancyRatePercent}-${analysis.monthlyCashFlow}`

  // Break-even price (formerly "walk-away price") demoted to a small line
  const breakEvenPrice = walkAway?.recommendedCeiling?.price ?? null
  const breakEvenDelta = breakEvenPrice != null ? breakEvenPrice - workingInputs.purchasePrice : null

  // Factual summary — prefer AI's, fall back to formula
  const aiSummary = ai_narrative?.summary?.trim()
  const summary = aiSummary && aiSummary.length > 0
    ? aiSummary
    : buildFactualSummary(workingInputs, analysis, walkAway, pf, address)

  // Worst-offender wins color; everything else stays neutral white.
  // Captions still describe the band so the user sees "barely covers debt"
  // even when DSCR isn't the metric we're painting (tonedSeverity returns
  // "neutral" for non-worst metrics).

  return (
    <div className="h-full flex flex-col rv-surface-1">
      <div className="flex-1 overflow-y-auto min-h-0" style={{ overscrollBehavior: "contain" }}>
        <div className="px-7 min-w-0">

          {/* ── Module 1: Property identity ── */}
          <div className="pt-6 pb-5 rv-hairline space-y-1.5">
            <div className="flex items-center gap-2 min-w-0">
              {address && (
                <h2 className="text-[14px] font-semibold text-foreground truncate"
                    style={{ letterSpacing: "-0.014em" }}>
                  {address}
                </h2>
              )}
              <SourceBadge source={source} sourceUrl={sourceUrl} onOpen={onOpenSource} />
            </div>
            <p className="text-[12px] rv-t3 font-mono rv-num">
              {[
                pf?.beds      != null && `${pf.beds} bd`,
                pf?.baths     != null && `${pf.baths} ba`,
                pf?.sqft      != null && `${pf.sqft.toLocaleString()} sqft`,
                pf?.yearBuilt != null && `${pf.yearBuilt}`,
                workingInputs.purchasePrice > 0 && `Asking ${formatCurrency(workingInputs.purchasePrice, 0)}`,
              ].filter(Boolean).join("  \u00b7  ")}
            </p>
          </div>

          {/* ── Module 2: Hero metrics — only the worst-offending metric carries color ── */}
          <div className="grid grid-cols-3 gap-5 py-7 rv-hairline">
            <HeroNumber
              label="DSCR"
              icon={LineChart}
              value={dscrStr}
              caption={dscrCaption(dscr)}
              tone={tonedSeverity("dscr", dscr, cf, cap)}
              pulseKey={`dscr-${pulseKey}`}
            />
            <HeroNumber
              label="Cash / mo"
              icon={DollarSign}
              value={cfStr}
              caption={cashFlowCaption(cf)}
              tone={tonedSeverity("cashFlow", dscr, cf, cap)}
              pulseKey={`cf-${pulseKey}`}
            />
            <HeroNumber
              label="Cap rate"
              icon={Percent}
              value={capStr}
              caption={capRateCaption(cap)}
              tone={tonedSeverity("capRate", dscr, cf, cap)}
              pulseKey={`cap-${pulseKey}`}
            />
          </div>

          {/* ── Module 3: Summary + break-even ── */}
          <div className="py-6 rv-hairline">
            <p className="text-[14px] rv-t1 leading-[1.55] max-w-[60ch]">
              {summary}
            </p>
            {breakEvenPrice != null && (
              <p className="text-[12px] rv-t3 font-mono rv-num mt-3">
                Break-even price&nbsp;
                <span className="rv-t2 font-semibold">
                  {formatCurrency(breakEvenPrice, 0)}
                </span>
                {breakEvenDelta != null && (
                  <span className="rv-t4">
                    &nbsp;&middot;&nbsp;
                    {breakEvenDelta >= 0
                      ? `${formatCurrency(breakEvenDelta, 0)} above asking`
                      : `${formatCurrency(Math.abs(breakEvenDelta), 0)} below asking`}
                  </span>
                )}
                {isDirty && (
                  <span className="ml-2 text-[10px] uppercase tracking-[0.08em] rv-tone-warn opacity-80">
                    edited
                  </span>
                )}
              </p>
            )}
          </div>

          {/* ── Module 4: Assumptions — slight surface lift to frame the module ── */}
          <div className="py-6 rv-hairline">
            <p className="rv-section-label mb-4">
              Assumptions
            </p>
            <div className="rounded-lg rv-surface-2 px-4 py-1">
              <div className="grid grid-cols-2 gap-x-4">
                <AssumptionInput
                  label="Down payment"
                  value={workingInputs.downPaymentPercent}
                  suffix="%"
                  step={1}
                  min={0}
                  max={100}
                  onChange={(v) => setWorkingInputs((s) => ({ ...s, downPaymentPercent: v }))}
                />
                <AssumptionInput
                  label="Interest rate"
                  value={workingInputs.loanInterestRate}
                  suffix="%"
                  step={0.125}
                  min={0}
                  max={20}
                  onChange={(v) => setWorkingInputs((s) => ({ ...s, loanInterestRate: v }))}
                />
                <AssumptionInput
                  label="Rent"
                  value={workingInputs.monthlyRent}
                  prefix="$"
                  suffix="/mo"
                  step={50}
                  min={0}
                  onChange={(v) => setWorkingInputs((s) => ({ ...s, monthlyRent: v }))}
                />
                <AssumptionInput
                  label="Vacancy"
                  value={workingInputs.vacancyRatePercent}
                  suffix="%"
                  step={1}
                  min={0}
                  max={50}
                  onChange={(v) => setWorkingInputs((s) => ({ ...s, vacancyRatePercent: v }))}
                />
              </div>
            </div>
            {rentNote && (
              <p className="text-[11px] rv-tone-warn opacity-80 leading-snug mt-3 max-w-[50ch]">
                {rentNote}
              </p>
            )}
          </div>

          {/* ── Module 5: Collapsible detail sections ── */}
          <div className="pb-4">
            <CollapsibleSection title="Monthly breakdown">
              <p className="text-[11px] rv-t3 mb-3 leading-relaxed">
                Rent in, every expense out, mortgage last.
              </p>
              <WaterfallChart analysis={analysis} />
            </CollapsibleSection>

            <CollapsibleSection title="Stress test">
              <StressTestRow analysis={analysis} inputs={workingInputs} />
            </CollapsibleSection>

            <CollapsibleSection title={`${analysis.inputs.holdPeriodYears}-year projection`}>
              <ProjectionRow analysis={analysis} />
            </CollapsibleSection>
          </div>
        </div>
      </div>

      {/* ── Save bar — Mercury-style white pill ── */}
      {onSave && supabaseConfigured && (
        <div className="shrink-0 border-t border-white/6 px-7 py-4 bg-background">
          {savedDealId ? (
            <div className="rv-pill-saved">
              <CheckCircle2 className="h-4 w-4" />
              <span>Saved &mdash; view in Pipeline</span>
            </div>
          ) : isSaving ? (
            <div className="rv-pill-saved">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Saving</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onSave}
              className="rv-pill"
            >
              <Save className="h-4 w-4" />
              <span>Save to Pipeline</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single-line stress test ("At 8% rate, cash flow becomes -$1,400/mo.")
// ---------------------------------------------------------------------------

function StressTestRow({
  inputs,
  analysis,
}: {
  inputs: DealInputs
  analysis: DealAnalysis
}) {
  void analysis
  const stressed = useMemo(() => {
    try {
      const next = sanitiseInputs({ ...inputs, loanInterestRate: inputs.loanInterestRate + 1 })
      return analyseDeal(next)
    } catch {
      return null
    }
  }, [inputs])

  if (!stressed) {
    return <p className="text-[12px] text-muted-foreground/50">Stress test unavailable.</p>
  }

  const cf = stressed.monthlyCashFlow
  // Stress test only colors when cash flow goes red — that's the actual
  // signal ("rate shock breaks this deal"). Positive stays neutral white.
  return (
    <p className="text-[12px] text-muted-foreground leading-relaxed">
      At&nbsp;
      <span className="font-mono rv-num text-foreground">
        {(inputs.loanInterestRate + 1).toFixed(2)}%
      </span>
      &nbsp;rate, cash flow becomes&nbsp;
      <span className={cn(
        "font-mono rv-num font-semibold",
        cf >= 0 ? "text-foreground" : "rv-tone-bad",
      )}>
        {cf >= 0 ? "+" : "\u2212"}{formatCurrency(Math.abs(cf), 0)}/mo
      </span>.
    </p>
  )
}

// ---------------------------------------------------------------------------
// Lightweight projection summary
// ---------------------------------------------------------------------------

function ProjectionRow({ analysis }: { analysis: DealAnalysis }) {
  const yrs = analysis.inputs.holdPeriodYears
  const totalProfit = analysis.totalProfit
  const totalROI = analysis.totalROI
  const irr = analysis.irr
  return (
    <div className="space-y-1">
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Over {yrs} years: total profit&nbsp;
        <span className={cn(
          "font-mono rv-num font-semibold",
          totalProfit >= 0 ? "text-foreground" : "rv-tone-bad",
        )}>
          {formatCurrency(totalProfit, 0)}
        </span>
        , ROI&nbsp;
        <span className="font-mono rv-num text-foreground/80">
          {formatPercent(totalROI, 0)}
        </span>
        , IRR&nbsp;
        <span className="font-mono rv-num text-foreground/80">
          {Number.isFinite(irr) ? formatPercent(irr, 1) : "\u221E"}
        </span>
        .
      </p>
    </div>
  )
}
