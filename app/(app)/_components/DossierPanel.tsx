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
  TrendingDown,
  Target,
  Calendar,
  TagIcon,
  ScrollText,
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

/** Rich fields the LLM lifted from the listing — surfaced in the
 *  Listing Details collapsible. None are required; render only what's
 *  present. This is where the depth of the AI-read shines: a regex
 *  scraper can't pull listing remarks or a price-history note. */
export type ListingDetails = {
  daysOnMarket?: number | null
  originalListPrice?: number | null
  priceHistoryNote?: string | null
  listingDate?: string | null
  listingRemarks?: string | null
  mlsNumber?: string | null
  schoolRating?: number | null
  walkScore?: number | null
  lotSqft?: number | null
}

export type DossierPanelProps = {
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  address?: string
  inputs: DealInputs
  /** Single-sentence model take — leads the dossier when present. */
  take?: string | null
  /** Risk flags lifted verbatim from the listing (flood zone, septic, etc.). */
  riskFlags?: string[]
  /** Rich detail surface — listing remarks, DOM, price history, scores. */
  listingDetails?: ListingDetails | null
  /** Source of the listing — drives the badge near the address. */
  source?: "zillow" | "redfin" | "realtor" | "homes" | "trulia" | "movoto" | null
  sourceUrl?: string | null
  /** Per-input confidence + provenance, so the panel can show source dots. */
  inputProvenance?: Partial<Record<keyof DealInputs, FieldProvenance>> | null
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
  // Skeleton uses --rv-fill-1 so the placeholders read in both
  // dark mode (translucent white) and light mode (translucent ink).
  const bar = "bg-[var(--rv-fill-1)] rounded"
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className={`h-3 ${bar} w-2/3`} />
        <div className={`h-2 ${bar} w-1/3`} />
      </div>
      <div className="grid grid-cols-3 gap-3 pt-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className={`h-2 ${bar} w-12`} />
            <div className={`h-7 ${bar}`} />
            <div className={`h-2 ${bar} w-16`} />
          </div>
        ))}
      </div>
      <div className={`h-3 ${bar} w-4/5`} />
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
  size = "lg",
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  value: string
  caption?: string
  tone: Severity
  pulseKey: string | number
  /** "lg" — primary row of 3 metrics; "md" — secondary row of 2 metrics. */
  size?: "lg" | "md"
}) {
  const Icon = icon
  const sizeStyle = size === "lg"
    ? { fontSize: "26px", letterSpacing: "-0.01em" }
    : { fontSize: "20px", letterSpacing: "-0.005em" }
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
        style={sizeStyle}
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
  provenance,
  onChange,
}: {
  label: string
  value: number
  suffix?: string
  prefix?: string
  step?: number
  min?: number
  max?: number
  provenance?: FieldProvenance | null
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
      <span className="text-[12px] text-muted-foreground/70 truncate flex items-center gap-1.5">
        {label}
        {provenance && <SourceDot provenance={provenance} />}
      </span>
      {/* Tight input: prefix/suffix sit next to the digits with no gap so
          "26 %" doesn't read as two disconnected tokens floating in a box.
          Right-aligning to the suffix keeps the unit column visually
          locked across rows. */}
      <div className="rv-input inline-flex items-baseline px-2.5 py-1 min-w-0 leading-none">
        {prefix && (
          <span className="text-[11px] rv-t3 font-mono mr-0.5">{prefix}</span>
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
          className="w-12 bg-transparent border-0 outline-none text-[12px] font-mono rv-num text-foreground text-right p-0"
        />
        {suffix && (
          <span className="text-[11px] rv-t3 font-mono ml-0.5">{suffix}</span>
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
  const baseChrome =
    "text-[9px] font-medium uppercase tracking-[0.12em] rv-t3 px-1.5 py-0.5 rounded " +
    "bg-[var(--rv-fill-1)] border border-[var(--rv-fill-border)] inline-flex items-center gap-1"
  if (canOpen && sourceUrl) {
    return (
      <button
        type="button"
        onClick={() => onOpen(sourceUrl)}
        className={`${baseChrome} hover:rv-t1 transition-colors`}
      >
        {content}
      </button>
    )
  }
  return <span className={baseChrome}>{content}</span>
}

// ---------------------------------------------------------------------------
// SourceDot — tiny circle next to a value indicating where it came from.
// Hover/focus reveals a popover with the source label and a 1-line note.
//
// This is the visible payoff for the per-field provenance the extractor
// produces. A user looking at a $7,450 tax line can see at a glance whether
// that came from the Zillow listing (high confidence, green dot), an
// inferred default (low confidence, amber dot), or their own override.
// ---------------------------------------------------------------------------

const SOURCE_COPY: Record<FieldProvenance["source"], string> = {
  listing:           "Read from listing",
  inferred:          "Default",
  verified:          "Verified by data",
  user:              "You set this",
  "zillow-listing":  "Zillow",
  rentcast:          "RentCast",
  "rent-comps":      "Comps",
  fred:              "FRED",
  "fhfa-hpi":        "FHFA",
  "fema-nfhl":       "FEMA",
  "state-average":   "State avg",
  "state-investor-rate": "State avg",
  "national-average": "National avg",
  default:           "Default",
}

const CONF_DOT_COLOR: Record<FieldProvenance["confidence"], string> = {
  high:   "bg-emerald-500/70",
  medium: "bg-amber-400/80",
  low:    "bg-[var(--rv-t4)]",
}

function SourceDot({ provenance }: { provenance?: FieldProvenance | null }) {
  const [open, setOpen] = useState(false)
  if (!provenance) return null
  const sourceText = SOURCE_COPY[provenance.source] ?? provenance.source
  const note = provenance.note ?? provenance.tooltip ?? null
  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full transition-opacity", CONF_DOT_COLOR[provenance.confidence])}
        aria-hidden="true"
      />
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 rv-surface-2 border border-[var(--rv-fill-border-strong)] rounded-md px-2 py-1.5 text-[10px] rv-t1 z-50 pointer-events-none shadow-lg"
          style={{ minWidth: "9rem", maxWidth: "20rem", whiteSpace: "normal" }}
        >
          <span className="block font-mono font-semibold uppercase tracking-[0.06em] text-[9px] rv-t2">
            {sourceText} · {provenance.confidence}
          </span>
          {note && <span className="block rv-t2 mt-0.5 leading-snug">{note}</span>}
        </span>
      )}
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
  take,
  riskFlags,
  listingDetails,
  source,
  sourceUrl,
  inputProvenance,
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

  // The model's one-sentence take leads. If we don't have one (legacy /
  // partial extraction) we fall back to the formulaic summary.
  const modelTake = take?.trim()
  const summary = modelTake && modelTake.length > 0
    ? modelTake
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

          {/* ── Module 2: Take + risk flags — the AI lead. ───────────── */}
          <div className="py-6 rv-hairline">
            <p className="text-[14px] rv-t1 leading-[1.55] max-w-[60ch]">
              {summary}
            </p>
            {riskFlags && riskFlags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {riskFlags.slice(0, 6).map((flag) => (
                  <span
                    key={flag}
                    className="inline-flex items-center gap-1 px-2 h-5 rounded-full text-[10px] font-medium uppercase tracking-[0.06em] rv-tone-warn"
                    style={{ background: "var(--rv-warn-sub)" }}
                  >
                    {flag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Module 3: 5 hero metrics. Row 1 = DSCR / Cash / Cap rate.
                Row 2 = Break-even price / Cash-on-cash. Only the worst-
                offending metric carries color tone. ───────────────────── */}
          <div className="py-7 rv-hairline space-y-7">
            <div className="grid grid-cols-3 gap-5">
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
            <div className="grid grid-cols-2 gap-5">
              <HeroNumber
                label="Break-even"
                icon={Target}
                value={breakEvenPrice != null ? formatCurrency(breakEvenPrice, 0) : "—"}
                caption={
                  breakEvenDelta != null
                    ? breakEvenDelta >= 0
                      ? `${formatCurrency(breakEvenDelta, 0)} above asking`
                      : `${formatCurrency(Math.abs(breakEvenDelta), 0)} below asking`
                    : undefined
                }
                tone="neutral"
                pulseKey={`be-${pulseKey}`}
                size="md"
              />
              <HeroNumber
                label="Cash-on-cash"
                icon={TrendingDown}
                value={formatPercent(analysis.cashOnCashReturn, 2)}
                caption={
                  analysis.cashOnCashReturn >= 0.08
                    ? "above 8%"
                    : analysis.cashOnCashReturn >= 0.05
                    ? "5-8%"
                    : "below 5%"
                }
                tone="neutral"
                pulseKey={`coc-${pulseKey}`}
                size="md"
              />
            </div>
            {isDirty && (
              <p className="text-[10px] uppercase tracking-[0.08em] rv-tone-warn opacity-80">
                edited · live recomputed
              </p>
            )}
          </div>

          {/* ── Module 4: Assumptions — every input carries a source dot. ── */}
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
                  provenance={inputProvenance?.downPaymentPercent}
                  onChange={(v) => setWorkingInputs((s) => ({ ...s, downPaymentPercent: v }))}
                />
                <AssumptionInput
                  label="Interest rate"
                  value={workingInputs.loanInterestRate}
                  suffix="%"
                  step={0.125}
                  min={0}
                  max={20}
                  provenance={inputProvenance?.loanInterestRate}
                  onChange={(v) => setWorkingInputs((s) => ({ ...s, loanInterestRate: v }))}
                />
                <AssumptionInput
                  label="Rent"
                  value={workingInputs.monthlyRent}
                  prefix="$"
                  suffix="/mo"
                  step={50}
                  min={0}
                  provenance={inputProvenance?.monthlyRent}
                  onChange={(v) => setWorkingInputs((s) => ({ ...s, monthlyRent: v }))}
                />
                <AssumptionInput
                  label="Vacancy"
                  value={workingInputs.vacancyRatePercent}
                  suffix="%"
                  step={1}
                  min={0}
                  max={50}
                  provenance={inputProvenance?.vacancyRatePercent}
                  onChange={(v) => setWorkingInputs((s) => ({ ...s, vacancyRatePercent: v }))}
                />
              </div>
            </div>
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

            {hasListingDetails(listingDetails) && (
              <CollapsibleSection title="Listing details">
                <ListingDetailsRow
                  details={listingDetails!}
                  asking={workingInputs.purchasePrice}
                />
              </CollapsibleSection>
            )}
          </div>
        </div>
      </div>

      {/* ── Save bar — Mercury-style white pill ── */}
      {onSave && supabaseConfigured && (
        <div className="shrink-0 border-t border-[var(--rv-fill-border)] px-7 py-4 bg-background">
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

// ---------------------------------------------------------------------------
// ListingDetailsRow — surfaces the depth of the LLM-read.
//
// This is the section that visibly justifies "AI integration that's not a
// ChatGPT wrapper" — every field on screen here is something the LLM lifted
// from the rendered listing text in one pass: days on market, price-history
// note, listing remarks, MLS#, school rating, walk score, lot size.
// A traditional scraper, even with site-specific selectors, can't reliably
// pull these because they're conditional/positional/free-text.
// ---------------------------------------------------------------------------

function hasListingDetails(d?: ListingDetails | null): boolean {
  if (!d) return false
  return (
    d.daysOnMarket != null ||
    d.originalListPrice != null ||
    d.priceHistoryNote != null ||
    d.listingDate != null ||
    d.listingRemarks != null ||
    d.mlsNumber != null ||
    d.schoolRating != null ||
    d.walkScore != null ||
    d.lotSqft != null
  )
}

function ListingDetailsRow({
  details,
  asking,
}: {
  details: ListingDetails
  asking: number
}) {
  const reduction =
    details.originalListPrice && details.originalListPrice > asking
      ? details.originalListPrice - asking
      : null

  return (
    <div className="space-y-3">
      {/* ── Price-motion signal — when we have it, lead with it. ─────── */}
      {(reduction != null || details.daysOnMarket != null || details.priceHistoryNote) && (
        <div className="rounded-md rv-surface-2 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap text-[12px]">
            {reduction != null && (
              <span className="inline-flex items-center gap-1 rv-tone-warn font-mono rv-num">
                <TrendingDown className="h-3 w-3" />
                {formatCurrency(reduction, 0)} reduction
              </span>
            )}
            {details.daysOnMarket != null && (
              <span className="inline-flex items-center gap-1 rv-t2 font-mono rv-num">
                <Calendar className="h-3 w-3 rv-t3" />
                {details.daysOnMarket}d on market
              </span>
            )}
          </div>
          {details.priceHistoryNote && (
            <p className="text-[11px] rv-t3 leading-snug">
              {details.priceHistoryNote}
            </p>
          )}
        </div>
      )}

      {/* ── Compact metadata grid ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
        {details.mlsNumber && (
          <DetailRow icon={TagIcon} label="MLS" value={details.mlsNumber} mono />
        )}
        {details.listingDate && (
          <DetailRow icon={Calendar} label="Listed" value={details.listingDate} />
        )}
        {details.lotSqft != null && (
          <DetailRow
            icon={Target}
            label="Lot"
            value={`${details.lotSqft.toLocaleString()} sqft`}
            mono
          />
        )}
        {details.schoolRating != null && (
          <DetailRow
            icon={Target}
            label="Schools"
            value={`${details.schoolRating}/10`}
            mono
          />
        )}
        {details.walkScore != null && (
          <DetailRow
            icon={Target}
            label="Walk"
            value={`${details.walkScore}/100`}
            mono
          />
        )}
      </div>

      {/* ── Listing remarks — quoted from the page. ────────────────── */}
      {details.listingRemarks && (
        <div className="rounded-md border border-[var(--rv-fill-border)] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.08em] rv-t3 mb-1 inline-flex items-center gap-1.5">
            <ScrollText className="h-3 w-3" />
            From the listing
          </p>
          <p className="text-[12px] rv-t1 leading-relaxed italic">
            “{details.listingRemarks}”
          </p>
        </div>
      )}
    </div>
  )
}

function DetailRow({
  icon: Icon, label, value, mono,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="text-[11px] rv-t3 inline-flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <span className={cn("rv-t1 truncate", mono && "font-mono rv-num")}>
        {value}
      </span>
    </div>
  )
}
