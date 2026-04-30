"use client"

import { useEffect, useMemo, useState } from "react"
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
import { Save, CheckCircle2, Loader2, ChevronDown, ChevronUp } from "lucide-react"
import WaterfallChart from "@/components/charts/waterfall-chart"

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

type HeroTone = "neutral" | "good" | "bad" | "warn"

function toneClass(tone: HeroTone): string {
  switch (tone) {
    case "good": return "text-emerald-400"
    case "bad":  return "text-red-400"
    case "warn": return "text-amber-400"
    default:     return "text-foreground"
  }
}

function HeroNumber({
  label,
  value,
  caption,
  tone,
  pulseKey,
}: {
  label: string
  value: string
  caption?: string
  tone: HeroTone
  pulseKey: string | number
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">
        {label}
      </p>
      <p
        key={pulseKey}
        className={cn(
          "font-mono font-semibold tabular-nums leading-[1.05] truncate rv-number-pulse",
          toneClass(tone),
        )}
        style={{ fontSize: "clamp(20px, 2.4vw, 28px)" }}
      >
        {value}
      </p>
      {caption && (
        <p className="text-[10px] text-muted-foreground/55 leading-snug truncate">
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

  useEffect(() => {
    setDraft(formatNum(value))
  }, [value])

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
    <label className="flex items-center justify-between gap-3 py-2">
      <span className="text-[12px] text-muted-foreground/70 truncate">{label}</span>
      <div className="flex items-center gap-1 rounded-md border border-white/8 bg-white/3 px-2 py-1 focus-within:border-white/20 transition-colors min-w-0">
        {prefix && (
          <span className="text-[11px] text-muted-foreground/40 font-mono">{prefix}</span>
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
          className="w-16 bg-transparent border-0 outline-none text-[12px] font-mono tabular-nums text-foreground text-right p-0"
        />
        {suffix && (
          <span className="text-[11px] text-muted-foreground/40 font-mono">{suffix}</span>
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
    <div className="border-t border-white/6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-3 text-left group"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors">
          {title}
        </span>
        {open
          ? <ChevronUp className="h-3 w-3 text-muted-foreground/40" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground/40" />}
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tone helpers
// ---------------------------------------------------------------------------

function dscrTone(dscr: number): HeroTone {
  if (!Number.isFinite(dscr)) return "good"
  if (dscr >= 1.25) return "neutral"
  if (dscr >= 1.0)  return "warn"
  return "bad"
}

function dscrCaption(dscr: number): string {
  if (!Number.isFinite(dscr)) return "no debt"
  if (dscr >= 1.25) return "comfortable"
  if (dscr >= 1.0)  return "barely covers debt"
  return "below 1.0"
}

function cashFlowTone(cf: number): HeroTone {
  if (cf >= 150) return "neutral"
  if (cf >= 0)   return "warn"
  return "bad"
}

function cashFlowCaption(cf: number): string {
  if (cf >= 150) return "positive"
  if (cf >= 0)   return "near break-even"
  return "negative"
}

function capRateTone(cap: number): HeroTone {
  if (cap >= 0.06) return "neutral"
  if (cap >= 0.05) return "warn"
  return "bad"
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

function SourceBadge({ source }: { source?: string | null }) {
  if (!source) return null
  return (
    <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/40 px-1.5 py-0.5 rounded bg-white/4 border border-white/6">
      {source}
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
  supabaseConfigured,
  onSave,
  savedDealId,
  isSaving,
  isLoading,
  badInputs,
  propertyFacts: pf,
}: DossierPanelProps) {
  // Loading state has its own component — caller should render that instead.
  // We still support the `isLoading` prop for backward compat.
  const skeletonInputs = (incomingInputs ?? {}) as DealInputs

  // Local working copy of inputs — assumptions edits update this. When the
  // parent passes a new `inputs` (different listing), we reset.
  const [workingInputs, setWorkingInputs] = useState<DealInputs>(skeletonInputs)

  useEffect(() => {
    if (incomingInputs) setWorkingInputs(incomingInputs)
  }, [incomingInputs])

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
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {address && (
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{address}</h2>
          )}
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
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
  const cfStr = (cf >= 0 ? "+" : "\u2212") +
    formatCurrency(Math.abs(cf), 0).replace("-", "") + "/mo"
  const capStr = formatPercent(cap, 2)

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

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-6 pt-5 pb-4">

          {/* ── Property identity ── */}
          <div className="mb-5 space-y-1">
            <div className="flex items-center gap-2 min-w-0">
              {address && (
                <h2 className="text-[13px] font-semibold tracking-tight text-foreground truncate">
                  {address}
                </h2>
              )}
              <SourceBadge source={source} />
            </div>
            <p className="text-[11px] text-muted-foreground/55 font-mono">
              {[
                pf?.beds   != null && `${pf.beds} bd`,
                pf?.baths  != null && `${pf.baths} ba`,
                pf?.sqft   != null && `${pf.sqft.toLocaleString()} sqft`,
                pf?.yearBuilt != null && `${pf.yearBuilt}`,
                workingInputs.purchasePrice > 0 && `Asking ${formatCurrency(workingInputs.purchasePrice, 0)}`,
              ].filter(Boolean).join("  \u00b7  ")}
            </p>
          </div>

          {/* ── HERO: three numbers ── */}
          <div className="grid grid-cols-3 gap-4 pb-5 border-b border-white/6">
            <HeroNumber
              label="DSCR"
              value={dscrStr}
              caption={dscrCaption(dscr)}
              tone={dscrTone(dscr)}
              pulseKey={`dscr-${pulseKey}`}
            />
            <HeroNumber
              label="Cash flow"
              value={cfStr}
              caption={cashFlowCaption(cf)}
              tone={cashFlowTone(cf)}
              pulseKey={`cf-${pulseKey}`}
            />
            <HeroNumber
              label="Cap rate"
              value={capStr}
              caption={capRateCaption(cap)}
              tone={capRateTone(cap)}
              pulseKey={`cap-${pulseKey}`}
            />
          </div>

          {/* ── Factual summary ── */}
          <p className="text-[13px] text-muted-foreground/80 leading-relaxed py-4 max-w-[60ch]">
            {summary}
          </p>

          {/* ── Break-even (demoted) ── */}
          {breakEvenPrice != null && (
            <p className="text-[11px] text-muted-foreground/50 font-mono pb-4">
              Break-even price&nbsp;
              <span className="text-foreground/70 font-semibold">
                {formatCurrency(breakEvenPrice, 0)}
              </span>
              {breakEvenDelta != null && (
                <span className="text-muted-foreground/40">
                  &nbsp;&middot;&nbsp;
                  {breakEvenDelta >= 0
                    ? `${formatCurrency(breakEvenDelta, 0)} above asking`
                    : `${formatCurrency(Math.abs(breakEvenDelta), 0)} below asking`}
                </span>
              )}
              {isDirty && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400/70">
                  edited
                </span>
              )}
            </p>
          )}

          {/* ── Assumptions (always visible, editable) ── */}
          <div className="border-t border-white/6 pt-3 pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 mb-1">
              Assumptions
            </p>
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
            {rentNote && (
              <p className="text-[11px] italic text-amber-400/70 leading-snug mt-1 max-w-[50ch]">
                {rentNote}
              </p>
            )}
          </div>

          {/* ── Collapsed details ── */}
          <div className="mt-4">
            <CollapsibleSection title="Monthly breakdown">
              <p className="text-[11px] text-muted-foreground/55 mb-3 leading-relaxed">
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

          <div className="h-3" />
        </div>
      </div>

      {/* ── Save bar ── */}
      {onSave && supabaseConfigured && (
        <div className="shrink-0 border-t border-white/6 px-6 py-3 bg-background">
          <button
            type="button"
            onClick={onSave}
            disabled={!!savedDealId || isSaving}
            className={cn(
              "w-full flex items-center justify-center gap-2 text-[13px] font-medium rounded-md px-4 py-2.5 transition-all duration-150",
              savedDealId
                ? "bg-emerald-500/8 text-emerald-400 border border-emerald-500/25 cursor-default"
                : isSaving
                  ? "bg-white/4 text-muted-foreground border border-white/8 cursor-default"
                  : "bg-[oklch(0.62_0.22_265)] text-white hover:brightness-110 border border-transparent",
            )}
          >
            {savedDealId ? (
              <><CheckCircle2 className="h-4 w-4" /> Saved &mdash; view in Pipeline</>
            ) : isSaving ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saving</>
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
  return (
    <p className="text-[12px] text-muted-foreground leading-relaxed">
      At&nbsp;
      <span className="font-mono tabular-nums text-foreground">
        {(inputs.loanInterestRate + 1).toFixed(2)}%
      </span>
      &nbsp;rate, cash flow becomes&nbsp;
      <span className={cn(
        "font-mono tabular-nums font-semibold",
        cf >= 0 ? "text-emerald-400" : "text-red-400",
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
          "font-mono tabular-nums font-semibold",
          totalProfit >= 0 ? "text-foreground" : "text-red-400",
        )}>
          {formatCurrency(totalProfit, 0)}
        </span>
        , ROI&nbsp;
        <span className="font-mono tabular-nums text-foreground/80">
          {formatPercent(totalROI, 0)}
        </span>
        , IRR&nbsp;
        <span className="font-mono tabular-nums text-foreground/80">
          {Number.isFinite(irr) ? formatPercent(irr, 1) : "\u221E"}
        </span>
        .
      </p>
    </div>
  )
}
