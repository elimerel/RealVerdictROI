"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { RefreshCw, Bookmark, BookmarkCheck, Eye, ExternalLink, MessagesSquare, BarChart3, X, Sparkles, SlidersHorizontal, ChevronDown } from "lucide-react"
import type { ChatContext, ChatMessage, PanelResult, SourceField, SourceKind } from "@/lib/electron"
import type { PipelineAverages } from "@/lib/pipeline"
import { SourceMark, sourceMeta, freshnessLabel } from "@/components/source/SourceMark"
import { BorderBeam } from "@/components/ui/border-beam"
import { Currency } from "@/lib/format"
import NumberFlow from "@number-flow/react"
import { BuddyMark } from "@/components/BuddyMark"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  hasActiveScenario,
  recomputeMetrics,
  subscribeToScenarioBus,
  subscribeToScenarioReset,
  type ScenarioOverrides,
} from "@/lib/scenario"
import PanelChat from "./Chat"
import { ScenarioDisclosure } from "./ScenarioDisclosure"
import PropertyMap from "@/components/PropertyMap"
import PropertyView, { hasGoogleMapsKey } from "@/components/PropertyView"
import StageMenu from "@/components/StageMenu"
import type { DealStage } from "@/lib/pipeline"
import { useMapShell } from "@/lib/mapShell"
import { useEscape } from "@/lib/escapeStack"
import { cn } from "@/lib/utils"

// ── Metric card ───────────────────────────────────────────────────────────────
//
// Tone semantics (intentionally narrow):
//   "neg" — the number is literally below zero (cash flow, NOI). Color = data
//           hygiene, not judgment. Universal financial-UI convention.
//   "neutral" — everything else. Cap rate, DSCR, GRM are *just numbers*; the
//           user decides what threshold matters to them.
//
// The cards stay deliberately clean — no per-card source glyphs. Trust signals
// live in three other places: the HeaderSourceStack at the top, the "Where
// numbers come from" provenance section at the bottom, and the Sources drawer.
// Stacking source marks on every metric card was visual noise at narrow panel
// widths.

function MetricCard({
  label, value, sub, delta, tone = "neutral", flashKey, bar,
}: {
  label: string
  /** Accepts plain string or rich JSX (e.g. <Currency>) — Mercury-style
   *  superscript decimal rendering needs JSX, not a flat string. */
  value: React.ReactNode
  sub?:  string
  /** When the user has an active scenario, the small "vs default" line
   *  between value and sub. Color follows tone (positive = green, negative
   *  = red, neutral = dim). Hidden when omitted. */
  delta?: { text: string; tone: "pos" | "neg" | "neutral" } | null
  tone?: "neg" | "neutral"
  /** When this value changes, the card briefly flashes accent tint so
   *  the user can see "this just recomputed." Pass any stable stringified
   *  representation of the displayed number. */
  flashKey?: string | number
  /** Personal "buy bar" pill — when set, renders a quiet "above bar"
   *  or "below bar" indicator below the value. Tone "pos" = above
   *  bar (good per user criteria); "neg" = below. Memory of the
   *  user's own threshold; never a verdict from us. */
  bar?: { passed: boolean } | null
}) {
  // tone === "neg" — data-semantic red, kept as inline --rv-neg.
  // Otherwise the foreground color comes from the Tailwind class
  // text-foreground on the value div below.
  const deltaColor =
    delta?.tone === "pos" ? "var(--rv-pos)" :
    delta?.tone === "neg" ? "var(--rv-neg)" :
                            undefined

  // Flash trigger — when flashKey changes (skip first paint), increment a
  // tick used to re-mount an absolutely-positioned overlay that runs the
  // accent-tint animation. The card itself stays mounted, so card state
  // and the prev-key ref survive across changes.
  const prevKey = useRef(flashKey)
  const [flashTick, setFlashTick] = useState(0)
  useEffect(() => {
    if (flashKey === undefined) return
    if (prevKey.current === flashKey) return
    prevKey.current = flashKey
    setFlashTick((t) => t + 1)
  }, [flashKey])

  return (
    <Card className="gap-0 p-3.5 min-w-0 overflow-hidden relative hover:shadow-md transition-shadow">
      {flashTick > 0 && (
        <span
          key={flashTick}
          aria-hidden
          className="rv-metric-flash absolute inset-0 rounded-[var(--radius)] pointer-events-none"
        />
      )}
      {/* New type system applied — sentence-case label at body-meta
          weight, metric value as Source Serif at display-22px. The
          old all-caps tracking-wider label gets replaced with a
          calmer "Cap rate" treatment; the old 32px sans value
          becomes a 22px serif. Reads as Mercury/Bloomberg "primary
          number is a typographic event," not "big sans number on a
          rectangle." */}
      <div className="text-[11px] font-medium truncate text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "tabular-nums leading-none truncate mt-2.5",
          tone !== "neg" && "text-foreground"
        )}
        style={{
          color:              tone === "neg" ? "var(--rv-neg)" : undefined,
          fontVariantNumeric: "tabular-nums",
          fontFamily:         "var(--rv-font-display)",
          fontSize:           22,
          fontWeight:         500,
          letterSpacing:      "-0.018em",
        }}
      >
        {value}
      </div>
      {delta && (
        <div
          className={cn(
            "text-[11px] leading-none tabular-nums truncate mt-1.5 inline-flex items-center gap-0.5",
            delta.tone === "neutral" && "text-muted-foreground/60"
          )}
          style={{ color: deltaColor }}
          title="vs default analysis"
        >
          {delta.tone === "pos" && "↑"}
          {delta.tone === "neg" && "↓"}
          {delta.text}
        </div>
      )}
      {sub && (
        <div className="text-[11px] leading-none truncate mt-2 text-muted-foreground">
          {sub}
        </div>
      )}
      {bar && (
        <Badge
          variant="outline"
          className="mt-2.5 self-start text-[9.5px] uppercase tracking-widest font-semibold gap-1"
          style={{
            color:      bar.passed ? "var(--rv-pos)" : "var(--rv-neg)",
            background: bar.passed ? "var(--rv-pos-bg)" : "var(--rv-neg-bg)",
            borderColor: bar.passed ? "var(--rv-pos)" : "var(--rv-neg)",
          }}
          title={bar.passed ? "Above your buy bar" : "Below your buy bar"}
        >
          <span
            className="rounded-full"
            style={{ width: 5, height: 5, background: bar.passed ? "var(--rv-pos)" : "var(--rv-neg)" }}
          />
          {bar.passed ? "above bar" : "below bar"}
        </Badge>
      )}
    </Card>
  )
}

// ── Buy-bar framing strip ────────────────────────────────────────────────
// Top-of-panel "vs your buy bar" line. Shows the deal's deltas against
// the user's personal thresholds (set in Investment Defaults). Same
// tone as PortfolioFramingStrip but the framing is YOUR criteria, not
// the peer set. Hides if no thresholds are set, or if the deal lacks
// the metrics needed to compute a delta.
//
// Magnitude thresholds match the workspace's buy-bar strip. The pill
// in MetricCard ("above bar"/"below bar") and this row work together:
// the strip gives the magnitude up front, the pill confirms inline.

function BuyBarFramingStrip({
  metrics, buyBar,
}: {
  metrics: PanelResult["metrics"]
  buyBar?: {
    minCapRate?:  number | null
    minCashFlow?: number | null
    minDscr?:     number | null
  }
}) {
  if (!buyBar) return null
  const { minCapRate, minCashFlow, minDscr } = buyBar
  if (minCapRate == null && minCashFlow == null && minDscr == null) return null

  type Fact = { key: string; label: string; delta: string; tone: "pos" | "neg" }
  const facts: Fact[] = []

  if (minCashFlow != null && Number.isFinite(metrics.monthlyCashFlow)) {
    const delta = metrics.monthlyCashFlow - minCashFlow
    if (Math.abs(delta) >= 1) {
      const sign = delta >= 0 ? "+" : "−"
      facts.push({
        key: "cf", label: "Cash flow",
        delta: `${sign}$${Math.round(Math.abs(delta)).toLocaleString()}/mo`,
        tone:  delta >= 0 ? "pos" : "neg",
      })
    }
  }
  if (minCapRate != null && Number.isFinite(metrics.capRate)) {
    const ppt = (metrics.capRate - minCapRate) * 100
    if (Math.abs(ppt) >= 0.05) {
      facts.push({
        key: "cap", label: "Cap rate",
        delta: ppt >= 0 ? `+${ppt.toFixed(2)} pts` : `${ppt.toFixed(2)} pts`,
        tone:  ppt >= 0 ? "pos" : "neg",
      })
    }
  }
  if (minDscr != null && Number.isFinite(metrics.dscr)) {
    const delta = metrics.dscr - minDscr
    if (Math.abs(delta) >= 0.02) {
      facts.push({
        key: "dscr", label: "DSCR",
        delta: delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2),
        tone:  delta >= 0 ? "pos" : "neg",
      })
    }
  }
  if (facts.length === 0) return null

  return (
    <div
      className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-foreground/[0.07]"
      style={{ background: "var(--rv-elev-1, transparent)" }}
    >
      <span className="text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground">
        Vs your buy bar
      </span>
      <span aria-hidden className="rounded-full bg-foreground/[0.18]" style={{ width: 4, height: 4 }} />
      <div className="flex items-center gap-3 min-w-0 flex-wrap">
        {facts.map((f) => (
          <span key={f.key} className="inline-flex items-baseline gap-1 text-[11.5px] tabular-nums">
            <span className="text-muted-foreground">{f.label}</span>
            <span
              className="font-medium"
              style={{ color: f.tone === "pos" ? "var(--rv-pos)" : "var(--rv-neg)" }}
            >
              {f.delta}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Portfolio framing strip ──────────────────────────────────────────────
// Top-of-panel "vs your pipeline" line. Same data source as
// BenchmarkLine but a more prominent, panel-header-style render — sits
// ABOVE the metric cards so the user's first read is "this deal vs your
// typical save," not the absolute numbers in isolation. Only renders
// when the user has 2+ saves and there's at least one meaningful delta.
//
// Magnitude thresholds match the workspace's portfolio context strip
// (cap ≥ 0.10pp, cash flow ≥ $25/mo, dscr ≥ 0.05) so a tiny noise
// difference doesn't trigger a stripe of "−$3" deltas.

function PortfolioFramingStrip({
  metrics, averages,
}: {
  metrics:   PanelResult["metrics"]
  averages?: PipelineAverages
}) {
  if (!averages || averages.count < 2) return null

  type Fact = { key: string; label: string; delta: string; tone: "pos" | "neg" }
  const facts: Fact[] = []

  const cashDelta = averages.avgCashFlow != null ? metrics.monthlyCashFlow - averages.avgCashFlow : null
  if (cashDelta != null && Math.abs(cashDelta) >= 25) {
    const sign = cashDelta >= 0 ? "+" : "−"
    facts.push({
      key: "cf", label: "Cash flow",
      delta: `${sign}$${Math.round(Math.abs(cashDelta)).toLocaleString()}/mo`,
      tone:  cashDelta >= 0 ? "pos" : "neg",
    })
  }
  const capDelta = averages.avgCapRate != null ? metrics.capRate - averages.avgCapRate : null
  if (capDelta != null && Math.abs(capDelta) * 100 >= 0.10) {
    const ppt = capDelta * 100
    facts.push({
      key: "cap", label: "Cap rate",
      delta: ppt >= 0 ? `+${ppt.toFixed(2)} pts` : `${ppt.toFixed(2)} pts`,
      tone:  ppt >= 0 ? "pos" : "neg",
    })
  }
  const dscrDelta = averages.avgDscr != null ? metrics.dscr - averages.avgDscr : null
  if (dscrDelta != null && Math.abs(dscrDelta) >= 0.05) {
    facts.push({
      key: "dscr", label: "DSCR",
      delta: dscrDelta >= 0 ? `+${dscrDelta.toFixed(2)}` : dscrDelta.toFixed(2),
      tone:  dscrDelta >= 0 ? "pos" : "neg",
    })
  }
  if (facts.length === 0) return null

  return (
    <div
      className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-foreground/[0.07]"
      style={{ background: "var(--rv-elev-1, transparent)" }}
    >
      <span className="text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground">
        Vs your pipeline
      </span>
      <span className="text-[11px] text-muted-foreground/60 tabular-nums">
        {averages.count} {averages.count === 1 ? "save" : "saves"}
      </span>
      <span aria-hidden className="rounded-full bg-foreground/[0.18]" style={{ width: 4, height: 4 }} />
      <div className="flex items-center gap-3 min-w-0 flex-wrap">
        {facts.map((f) => (
          <span key={f.key} className="inline-flex items-baseline gap-1 text-[11.5px] tabular-nums">
            <span className="text-muted-foreground">{f.label}</span>
            <span
              className="font-medium"
              style={{ color: f.tone === "pos" ? "var(--rv-pos)" : "var(--rv-t3)" }}
            >
              {f.delta}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Benchmark line — vs the user's saved pipeline ─────────────────────────
//
// Single-line "vs your saves" delta chip below the metric cards. Renders
// only when there are 2+ deals in the user's pipeline (single-sample
// averages are noise) AND we have at least one valid average to compare
// against. Each delta is rendered as just the difference, e.g. "+$140",
// "-0.8pp", "+0.05" — the user is reading deltas relative to their
// portfolio mean, not to absolute thresholds.

function BenchmarkLine({
  metrics, averages,
}: {
  metrics:   PanelResult["metrics"]
  averages?: PipelineAverages
}) {
  if (!averages || averages.count < 2) return null

  const cashDelta = averages.avgCashFlow != null
    ? metrics.monthlyCashFlow - averages.avgCashFlow
    : null
  const capDelta = averages.avgCapRate != null
    ? metrics.capRate - averages.avgCapRate
    : null
  const dscrDelta = averages.avgDscr != null
    ? metrics.dscr - averages.avgDscr
    : null

  // Bail entirely if every delta is null — there's nothing to compare.
  if (cashDelta == null && capDelta == null && dscrDelta == null) return null

  const fmtSign = (n: number) => (n >= 0 ? "+" : "")
  const fmtCash = (n: number) => `${fmtSign(n)}$${Math.round(Math.abs(n)).toLocaleString()}/mo`
  const fmtPpts = (n: number) => `${fmtSign(n)}${(n * 100).toFixed(1)}pp`
  const fmtDsc  = (n: number) => `${fmtSign(n)}${n.toFixed(2)}`

  // Each delta gets a quiet directional color — green when above the
  // mean (your average is the reference), red when below. None of these
  // are scoring the deal — they're just "this is above/below your
  // typical save," and the user decides what that means.
  // Returns inline color for data-semantic deltas only. Zero-delta
  // (no signal) renders via text-muted-foreground/60 className instead.
  const tone = (delta: number, higherIsBetter = true): string | undefined =>
    delta === 0 ? undefined :
    (higherIsBetter ? delta > 0 : delta < 0) ? "var(--rv-pos)" : "var(--rv-neg)"

  return (
    <div className="flex items-center justify-between gap-3 mt-3">
      <span className="text-[11px] shrink-0 text-muted-foreground/60">
        vs your {averages.count} saves
      </span>
      <div className="flex items-center gap-3 text-[11px] tabular-nums">
        {cashDelta != null && (
          <span className="inline-flex items-baseline gap-1">
            <span className="text-muted-foreground/60">Cash</span>
            <span
              className={cn(cashDelta === 0 && "text-muted-foreground/60")}
              style={{ color: tone(cashDelta) }}
            >
              {fmtCash(cashDelta)}
            </span>
          </span>
        )}
        {capDelta != null && (
          <span className="inline-flex items-baseline gap-1">
            <span className="text-muted-foreground/60">Cap</span>
            <span
              className={cn(capDelta === 0 && "text-muted-foreground/60")}
              style={{ color: tone(capDelta) }}
            >
              {fmtPpts(capDelta)}
            </span>
          </span>
        )}
        {dscrDelta != null && (
          <span className="inline-flex items-baseline gap-1">
            <span className="text-muted-foreground/60">DSCR</span>
            <span
              className={cn(dscrDelta === 0 && "text-muted-foreground/60")}
              style={{ color: tone(dscrDelta) }}
            >
              {fmtDsc(dscrDelta)}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

// ── Risk flag ─────────────────────────────────────────────────────────────────
//
// Neutral framing — "Worth knowing" not "WATCH OUT". Amber bullet, not red.
// The job is to surface a fact the user might miss; the job is NOT to tell
// them whether the deal is good or bad.

function RiskFlag({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
      <span
        className="mt-[6px] shrink-0 rounded-full"
        style={{ width: 5, height: 5, background: "var(--rv-warn)" }}
      />
      <span>{text}</span>
    </div>
  )
}

// ── Property surface (Mapbox inline + Google modal) ─────────────────────────
//
// Combines PropertyMap (fast Mapbox satellite static, no third-party
// branding) as the inline panel hero with PropertyView (Google Maps
// Embed in a modal) for the "click to expand" path. Google's required
// "Maps" badge only appears in the modal — so the everyday panel UI
// stays clean, and switching between deals doesn't cold-load a 2-
// second iframe each time (the Mapbox <img> swaps in <100ms).

function PropertyMapWithExpand({ result }: { result: PanelResult }) {
  const [expanded, setExpanded] = useState(false)
  const canExpand = hasGoogleMapsKey()
  return (
    <>
      <PropertyMap
        address={result.address}
        city={result.city}
        state={result.state}
        zip={result.zip}
        size="inline"
        radius={10}
        className="w-full"
        view="satellite"
        onExpand={canExpand ? () => setExpanded(true) : undefined}
      />
      {expanded && (
        <PropertyView
          address={result.address}
          city={result.city}
          state={result.state}
          zip={result.zip}
          initialMode="street"
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  )
}

// ── Provenance row ────────────────────────────────────────────────────────────

function ProvenanceRow({
  label, value, field, siteName, fetchedAt, onEdit,
}: {
  label:      string
  value:      string
  field:      SourceField
  siteName?:  string | null
  fetchedAt?: string
  /** When set + the source is "soft" (AI estimate or industry default),
   *  the row becomes clickable and surfaces a tiny "got better numbers?"
   *  affordance on hover. Click opens the scenario editor below so the
   *  user can replace the soft value with a real one — sharpening the
   *  analysis deal-by-deal. Hard sources (listing, FRED, HUD) don't
   *  show the affordance because the data is already authoritative. */
  onEdit?:    () => void
}) {
  const meta = sourceMeta(field.source, siteName)
  const tooltipParts = [`${label}: ${meta.label.toLowerCase().replace(/^pulled /, "pulled ")}`]
  const ageStr = fetchedAt ? freshnessLabel(fetchedAt) : null
  if (ageStr) tooltipParts.push(ageStr)
  const tooltip = tooltipParts.join(" · ")

  // Soft sources — values that could be better if the user has actual
  // numbers from the listing or their own underwriting. Surface the
  // edit affordance only for these so the row stays clean for hard
  // facts (Zillow listing, FRED rate, HUD rent comps).
  const isSoft = field.source === "ai_estimate" || field.source === "default"
  const canEdit = isSoft && !!onEdit

  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-3 py-2.5 border-b border-foreground/[0.07] last:border-0",
        canEdit && "cursor-pointer"
      )}
      onClick={canEdit ? onEdit : undefined}
      title={canEdit ? `${tooltip} · click to enter your own value` : tooltip}
    >
      <span className="text-[12.5px] shrink-0 text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2.5 min-w-0">
        {canEdit && (
          <span className="text-[10px] uppercase tracking-widest font-semibold opacity-0 group-hover:opacity-100 transition-opacity text-primary">
            ✎ replace
          </span>
        )}
        <span className="text-[13px] tabular-nums truncate font-medium text-foreground">{value}</span>
        <SourceMark source={field.source} siteName={siteName} title={tooltip} />
      </div>
    </div>
  )
}


// ── Sources drawer ────────────────────────────────────────────────────────────
//
// The trust contract. Every number on the panel surface is also listed here,
// grouped by where it physically came from. The user can scan the whole
// drawer in 3 seconds and confirm: yes, the rate is from the Federal Reserve
// API, the rent is from HUD's published Fair Market Rent table, the price
// came straight off the listing page. This is what an LLM wrapper structurally
// cannot do — Claude can quote a source, but it can't wire every number on a
// surface back to a clickable origin.

interface SourceFact {
  /** What the number measures, e.g. "List price". */
  label: string
  /** Display value — pre-formatted, e.g. "$439,900". */
  value: string
  /** When this number was fetched, if known (e.g. FRED rate timestamp). */
  fetchedAt?: string
}

function SourcesDrawer({
  result, onClose,
}: {
  result:   PanelResult
  onClose:  () => void
}) {
  // Esc closes the drawer — registered while it's mounted (drawer is
  // unmounted entirely when closed, so isOpen=true is implicit). Pushes
  // onto the global Esc stack as the topmost handler.
  useEscape(true, onClose)
  const { provenance } = result
  const fmtCurrency = (n: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    }).format(n)
  const fmtPct = (n: number | null) =>
    n == null ? "—" : `${(n * 100).toFixed(2)}%`

  // Bucket every fact by its source. We dedupe by source kind, so a listing
  // page contributing multiple facts (price, beds, baths) shows up as one
  // grouped section instead of repeating the header.
  type Group = { key: string; source: SourceKind; facts: SourceFact[] }
  const groupMap = new Map<string, Group>()
  const add = (source: SourceKind, fact: SourceFact) => {
    const key = source
    const existing = groupMap.get(key)
    if (existing) existing.facts.push(fact)
    else groupMap.set(key, { key, source, facts: [fact] })
  }

  // Listing-page facts (anything we extracted directly off the page).
  if (result.listPrice != null) add(provenance.listPrice.source, { label: "List price", value: fmtCurrency(result.listPrice) })
  if (result.beds      != null) add("listing", { label: "Beds",       value: String(result.beds) })
  if (result.baths     != null) add("listing", { label: "Baths",      value: String(result.baths) })
  if (result.sqft      != null) add("listing", { label: "Sq ft",      value: result.sqft.toLocaleString() })
  if (result.yearBuilt != null) add("listing", { label: "Year built", value: String(result.yearBuilt) })
  if (result.address)           add("listing", { label: "Address",    value: [result.address, result.city, result.state, result.zip].filter(Boolean).join(", ") })

  // Computed-input facts (each carries its own provenance — could be listing,
  // FRED, HUD, AI estimate, default, or user-edited).
  add(provenance.rent.source,         { label: "Rent",          value: `${fmtCurrency(provenance.rent.value)}/mo` })
  add(provenance.interestRate.source, { label: "Interest rate", value: fmtPct(provenance.interestRate.value / 100), fetchedAt: provenance.interestRate.fetchedAt })
  add(provenance.propertyTax.source,  { label: "Property tax",  value: `${fmtCurrency(provenance.propertyTax.value)}/yr` })
  if (provenance.hoa) add(provenance.hoa.source, { label: "HOA", value: `${fmtCurrency(provenance.hoa.value)}/mo` })
  add(provenance.insurance.source,    { label: "Insurance",     value: `${fmtCurrency(provenance.insurance.value)}/yr` })

  // Order: real data first (listing → HUD → FRED), then estimates, then
  // defaults. This puts the most trustworthy stuff at the top.
  const sourceOrder: Record<SourceKind, number> = {
    listing: 0, hud_fmr: 1, fred: 2, user: 3, ai_estimate: 4, default: 5,
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => sourceOrder[a.source] - sourceOrder[b.source])

  return (
    <>
      <div
        className="absolute inset-0 z-30 drawer-backdrop-in"
        style={{ background: "var(--rv-scrim-strong)" }}
        onClick={onClose}
      />
      <div
        className="absolute right-0 top-0 bottom-0 z-40 flex flex-col drawer-enter"
        style={{
          width:          "min(420px, 95%)",
          background:     "var(--rv-drawer-bg)",
          // 16px reads visually identical to 36px on a typical panel
          // background but composites ~5× faster at retina. Wide-radius
          // gaussian blur was costing real frame time on every paint.
          backdropFilter:       "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          borderLeft:     "0.5px solid var(--rv-border-mid)",
          boxShadow:      "inset 1px 0 0 rgba(255,255,255,0.06), -16px 0 40px rgba(0, 0, 0, 0.45)",
        }}
      >
        {/* Slim header — just close button. The drawer doesn't need a
            chrome label; the hero inside makes the purpose obvious. */}
        <div
          className="flex items-center justify-end px-3 shrink-0"
          style={{ height: 40 }}
        >
          <Button onClick={onClose} aria-label="Close" variant="ghost" size="icon-xs">
            <X size={13} strokeWidth={2} />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto panel-scroll">
          {/* Hero — display serif, brand statement in the user's words.
              This drawer IS RealVerdict's promise made visible: every
              number on the panel ties back to a source you can name. */}
          <div className="px-6 pt-2 pb-6">
            <h2
              className="leading-tight text-foreground"
              style={{
                fontSize:      28,
                fontFamily:    "var(--rv-font-display)",
                fontWeight:    500,
                letterSpacing: "-0.020em",
              }}
            >
              Sources
            </h2>
            <p
              className="mt-2 leading-snug text-muted-foreground"
              style={{
                fontSize:   13.5,
                fontFamily: "var(--rv-font-display)",
                fontWeight: 400,
                letterSpacing: "-0.005em",
              }}
            >
              Every number on the panel ties back to one of these origins.
              Hover any figure to see its source without opening this view.
            </p>
            <div
              className="mt-4 inline-flex items-center gap-1.5 rounded-full text-[10.5px] tracking-widest uppercase font-medium text-primary border border-primary/20 bg-primary/10"
              style={{ padding: "3px 8px" }}
            >
              ✦ Verifiable
            </div>
          </div>

          {/* Source groups — each group is a numbered "citation block."
              Header has the brand chip + serif label; numbered facts
              below render with refined typography and clean separators. */}
          <div className="flex flex-col gap-3 px-4 pb-6">
            {groups.map((group, groupIdx) => {
              const meta = sourceMeta(group.source, result.siteName)
              return (
                <div
                  key={group.key}
                  className="rounded-[12px] overflow-hidden bg-muted/40 border border-border"
                >
                  <div className="flex items-center gap-3 px-4 pt-3.5 pb-3 border-b border-foreground/[0.07]">
                    <SourceMark source={group.source} siteName={result.siteName} size="md" />
                    <div className="flex-1 min-w-0">
                      <p
                        className="leading-tight truncate text-foreground"
                        style={{
                          fontSize:   14,
                          fontFamily: "var(--rv-font-display)",
                          fontWeight: 500,
                          letterSpacing: "-0.012em",
                        }}
                      >
                        {meta.label}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-widest font-medium tabular-nums text-muted-foreground/60">
                      {String(groupIdx + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex flex-col px-4 py-1">
                    {group.facts.map((f, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex items-baseline justify-between gap-3 py-2.5",
                          i < group.facts.length - 1 && "border-b border-foreground/[0.07]"
                        )}
                      >
                        <span className="text-[12.5px] text-muted-foreground">{f.label}</span>
                        <div className="flex items-baseline gap-2 text-right">
                          <span
                            className="tabular-nums leading-none text-foreground"
                            style={{
                              fontSize:   13,
                              fontFamily: "var(--rv-font-display)",
                              fontWeight: 500,
                            }}
                          >
                            {f.value}
                          </span>
                          {f.fetchedAt && (
                            <span className="text-[10.5px] tabular-nums shrink-0 text-muted-foreground/60">
                              {freshnessLabel(f.fetchedAt)?.replace("fetched ", "") ?? ""}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

/** Header pill that shows the unique source-stack for this listing and opens
 *  the Sources drawer when clicked. The visual itself ("Z + FRED + HUD")
 *  signals "this listing pulls from 3 sources" before the user even clicks. */
function HeaderSourceStack({
  result, onClick, active,
}: {
  result:  PanelResult
  onClick: () => void
  active:  boolean
}) {
  const { provenance } = result
  const seen = new Set<string>()
  const sources: { key: string; source: SourceKind }[] = []
  const push = (s: SourceKind) => {
    const key = s === "listing" ? `listing:${result.siteName ?? ""}` : s
    if (seen.has(key)) return
    seen.add(key)
    sources.push({ key, source: s })
  }
  push(provenance.listPrice.source)
  push(provenance.rent.source)
  push(provenance.interestRate.source)
  push(provenance.propertyTax.source)
  push(provenance.insurance.source)
  if (provenance.hoa) push(provenance.hoa.source)

  return (
    <Button
      onClick={onClick}
      title="See where every number comes from"
      variant={active ? "secondary" : "ghost"}
      size="xs"
      className="px-1.5 gap-1"
    >
      {sources.slice(0, 3).map(({ key, source }) => (
        <SourceMark key={key} source={source} siteName={result.siteName} />
      ))}
      {sources.length > 3 && (
        <span className="text-[9px] tabular-nums text-muted-foreground/60">
          +{sources.length - 3}
        </span>
      )}
    </Button>
  )
}

// ── Action button (header) ────────────────────────────────────────────────────

function HeaderIconBtn({
  onClick, title, disabled, children, active,
}: {
  onClick?: () => void
  title:  string
  disabled?: boolean
  active?: boolean
  children: React.ReactNode
}) {
  // Migrated to canonical Button. Active state stays custom (accent-tinted)
  // because shadcn's `default` would make it filled-green, which is too
  // loud for an "active toggle" affordance in dense chrome.
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      variant="ghost"
      size="icon-xs"
      className={cn(
        active
          ? "text-primary bg-primary/15 hover:bg-primary/20 hover:text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Button>
  )
}

// ── Analyzing ─────────────────────────────────────────────────────────────────
//
// Skeleton-first rendering: instead of a centered spinner that says "wait,"
// we render the SHAPE of the result panel immediately — map placeholder,
// price placeholder, metric card placeholders — with subtle shimmer. When
// the analysis arrives, the skeleton fades into the real content with no
// layout jump. The user's eye lands on where the answer is GOING to be,
// not on a spinner. This is the speed promise made visible.

function ShimmerBlock({
  width, height, radius = 6,
}: {
  width:    number | string
  height:   number
  radius?:  number
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        position:     "relative",
        overflow:     "hidden",
      }}
      className="rv-shimmer bg-muted"
    />
  )
}

function AnalyzingPane() {
  // Mirror the ResultPane layout exactly so the transition feels like
  // content RESOLVING, not a screen swap.
  return (
    <div className="flex flex-col flex-1 min-h-0 panel-enter">
      {/* Hero skeleton — map → price → cash flow → address */}
      <div className="px-4 pt-4 pb-5 border-b border-foreground/[0.07]">
        <ShimmerBlock width="100%" height={140} radius={10} />
        <div style={{ marginTop: 14 }}>
          <ShimmerBlock width={180} height={32} radius={6} />
        </div>
        <div style={{ marginTop: 10 }}>
          <ShimmerBlock width={140} height={20} radius={5} />
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
          <ShimmerBlock width={60} height={11} radius={3} />
          <ShimmerBlock width={50} height={11} radius={3} />
          <ShimmerBlock width={70} height={11} radius={3} />
        </div>
      </div>

      {/* Metrics skeleton — three cards */}
      <div className="px-4 py-4 border-b border-foreground/[0.07]">
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-muted border border-border rounded-[12px]"
              style={{
                padding:   "10px 12px 11px",
                boxShadow: "var(--rv-shadow-inset), var(--rv-shadow-outer-sm)",
              }}
            >
              <ShimmerBlock width={50} height={9} radius={3} />
              <div style={{ marginTop: 8 }}>
                <ShimmerBlock width={60} height={18} radius={4} />
              </div>
              <div style={{ marginTop: 6 }}>
                <ShimmerBlock width={45} height={9} radius={3} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status line with the buddy presence — the BuddyMark in its
          breathing "thinking" state acts as the visual signal that the
          AI is at work. Replaces the previous three-dot pulse pattern.
          The mark is the same one in the sidebar header so the brand
          identity carries through, and the slow breath reads as
          "concentrating," not "loading." */}
      <div className="px-4 py-3 flex items-center gap-2.5 border-b border-foreground/[0.07]">
        <BuddyMark size={16} state="thinking" />
        <span className="text-[11.5px] text-muted-foreground">
          Reading listing, pulling rates and comps…
        </span>
      </div>

      {/* Bottom skeleton — provenance rows */}
      <div className="px-4 py-3 flex flex-col gap-2.5">
        {[120, 90, 110, 100, 80].map((w, i) => (
          <div key={i} className="flex items-center justify-between">
            <ShimmerBlock width={w} height={11} radius={3} />
            <div className="flex items-center gap-2">
              <ShimmerBlock width={60} height={11} radius={3} />
              <ShimmerBlock width={18} height={18} radius={9} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Error ─────────────────────────────────────────────────────────────────────

function ErrorPane({
  message, onRetry, onManualEntry,
}: {
  message:        string
  onRetry?:       () => void
  onManualEntry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 flex-1 px-6 text-center">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-[16px]"
        style={{ background: "var(--rv-alarm-bg)", color: "var(--rv-alarm)" }}
      >
        !
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{message}</p>
      <div className="flex items-center gap-2 mt-1">
        {onRetry && (
          <Button onClick={onRetry} variant="secondary" size="sm">
            <RefreshCw size={11} strokeWidth={2} />
            Try again
          </Button>
        )}
        {onManualEntry && (
          <Button onClick={onManualEntry} variant="default" size="sm">
            Enter manually
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Manual entry form ─────────────────────────────────────────────────────

export interface ManualFacts {
  address:            string
  city:               string
  state:              string
  zip:                string
  listPrice:          number | null
  beds:               number | null
  baths:              number | null
  sqft:               number | null
  yearBuilt:          number | null
  monthlyRent:        number | null
  monthlyHOA:         number | null
  annualPropertyTax:  number | null
  annualInsuranceEst: number | null
  propertyType:       string
}

function ManualEntryPane({
  initial, onSubmit, onCancel,
}: {
  initial?: Partial<ManualFacts>
  onSubmit: (facts: ManualFacts) => void
  onCancel: () => void
}) {
  const [facts, setFacts] = useState<ManualFacts>(() => ({
    address:            initial?.address ?? "",
    city:               initial?.city ?? "",
    state:              initial?.state ?? "",
    zip:                initial?.zip ?? "",
    listPrice:          initial?.listPrice ?? null,
    beds:               initial?.beds ?? null,
    baths:              initial?.baths ?? null,
    sqft:               initial?.sqft ?? null,
    yearBuilt:          initial?.yearBuilt ?? null,
    monthlyRent:        initial?.monthlyRent ?? null,
    monthlyHOA:         initial?.monthlyHOA ?? null,
    annualPropertyTax:  initial?.annualPropertyTax ?? null,
    annualInsuranceEst: initial?.annualInsuranceEst ?? null,
    propertyType:       initial?.propertyType ?? "",
  }))

  const canSubmit = (facts.listPrice ?? 0) > 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between gap-2 px-4 py-3 shrink-0 border-b border-foreground/[0.07]">
        <p className="text-[12px] font-medium text-foreground">
          Tell us about this listing
        </p>
        <Button onClick={onCancel} variant="ghost" size="xs">Cancel</Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto panel-scroll">
        <div className="px-4 py-4 flex flex-col gap-4">
          <ManualField label="List price" required>
            <ManualNumber value={facts.listPrice} onChange={(v) => setFacts({ ...facts, listPrice: v })} prefix="$" placeholder="450000" />
          </ManualField>
          <div className="grid grid-cols-2 gap-3">
            <ManualField label="Beds">
              <ManualNumber value={facts.beds} onChange={(v) => setFacts({ ...facts, beds: v })} placeholder="3" allowDecimal={false} />
            </ManualField>
            <ManualField label="Baths">
              <ManualNumber value={facts.baths} onChange={(v) => setFacts({ ...facts, baths: v })} placeholder="2" allowDecimal />
            </ManualField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ManualField label="Sq ft">
              <ManualNumber value={facts.sqft} onChange={(v) => setFacts({ ...facts, sqft: v })} placeholder="1450" allowDecimal={false} />
            </ManualField>
            <ManualField label="Year built">
              <ManualNumber value={facts.yearBuilt} onChange={(v) => setFacts({ ...facts, yearBuilt: v })} placeholder="1985" allowDecimal={false} />
            </ManualField>
          </div>
          <ManualField label="Address" hint="Helps with rent comps in the analysis">
            <ManualText value={facts.address} onChange={(v) => setFacts({ ...facts, address: v })} placeholder="123 Maple St" />
          </ManualField>
          <div className="grid grid-cols-3 gap-3">
            <ManualField label="City">
              <ManualText value={facts.city} onChange={(v) => setFacts({ ...facts, city: v })} placeholder="Austin" />
            </ManualField>
            <ManualField label="State">
              <ManualText value={facts.state} onChange={(v) => setFacts({ ...facts, state: v.toUpperCase().slice(0, 2) })} placeholder="TX" />
            </ManualField>
            <ManualField label="Zip">
              <ManualText value={facts.zip} onChange={(v) => setFacts({ ...facts, zip: v.replace(/[^0-9-]/g, "").slice(0, 10) })} placeholder="78704" />
            </ManualField>
          </div>
          <p className="text-[10px] uppercase tracking-widest font-medium mt-1 text-muted-foreground/60">
            Optional — fills in the gaps
          </p>
          <div className="grid grid-cols-2 gap-3">
            <ManualField label="Monthly rent" hint="If skipped, HUD FMR is used">
              <ManualNumber value={facts.monthlyRent} onChange={(v) => setFacts({ ...facts, monthlyRent: v })} prefix="$" placeholder="2400" />
            </ManualField>
            <ManualField label="Monthly HOA">
              <ManualNumber value={facts.monthlyHOA} onChange={(v) => setFacts({ ...facts, monthlyHOA: v })} prefix="$" placeholder="0" />
            </ManualField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ManualField label="Annual property tax">
              <ManualNumber value={facts.annualPropertyTax} onChange={(v) => setFacts({ ...facts, annualPropertyTax: v })} prefix="$" placeholder="6000" />
            </ManualField>
            <ManualField label="Annual insurance">
              <ManualNumber value={facts.annualInsuranceEst} onChange={(v) => setFacts({ ...facts, annualInsuranceEst: v })} prefix="$" placeholder="1500" />
            </ManualField>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 shrink-0 flex items-center justify-end gap-2 border-t border-foreground/[0.07]">
        <Button onClick={() => onSubmit(facts)} disabled={!canSubmit} variant="default" size="sm">
          Analyze
        </Button>
      </div>
    </div>
  )
}

function ManualField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
        {label}{required && <span className="text-primary ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10.5px] leading-tight text-muted-foreground/60">{hint}</p>}
    </div>
  )
}

function ManualNumber({
  value, onChange, prefix, placeholder, allowDecimal = true,
}: {
  value:    number | null
  onChange: (v: number | null) => void
  prefix?:  string
  placeholder?: string
  allowDecimal?: boolean
}) {
  const [text, setText] = useState<string>(value == null ? "" : String(value))
  const lastSent = useRef<number | null>(value)
  // Only re-sync from prop when the parent flipped to a different value.
  if (value !== lastSent.current) {
    lastSent.current = value
    if ((value == null && text !== "") || (value != null && Number(text) !== value)) {
      setText(value == null ? "" : String(value))
    }
  }
  return (
    <div
      className="flex items-center gap-1.5 rounded-[7px] bg-muted border border-border"
      style={{ padding: "5px 9px" }}
    >
      {prefix && <span className="text-[12px] text-muted-foreground/60">{prefix}</span>}
      <input
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const cleaned = allowDecimal
            ? e.target.value.replace(/[^0-9.]/g, "")
            : e.target.value.replace(/[^0-9]/g, "")
          setText(cleaned)
          if (cleaned === "" || cleaned === ".") { onChange(null); return }
          const n = Number(cleaned)
          onChange(Number.isFinite(n) ? n : null)
        }}
        className="flex-1 bg-transparent border-none outline-none text-[12.5px] tabular-nums leading-none text-foreground"
      />
    </div>
  )
}

function ManualText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-[7px] text-[12.5px] leading-none bg-muted border border-border text-foreground outline-none"
      style={{ padding: "9px 9px" }}
    />
  )
}

// ── Empty (manual open with no analysis yet) ──────────────────────────────────

function EmptyPane({ onAnalyze, hasListing }: { onAnalyze: () => void; hasListing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 flex-1 px-6 text-center">
      <div className="w-9 h-9 rounded-full flex items-center justify-center bg-muted text-muted-foreground">
        <RefreshCw size={14} strokeWidth={1.7} />
      </div>
      <div>
        <p className="text-[13px] font-medium text-foreground">
          {hasListing ? "Ready when you are" : "Open a listing to analyze"}
        </p>
        <p className="text-[12px] mt-1 leading-relaxed text-muted-foreground">
          {hasListing
            ? "Run analysis on this page."
            : "Navigate to a listing on Zillow, Redfin,\nor any real-estate site."}
        </p>
      </div>
      {hasListing && (
        <Button onClick={onAnalyze} variant="default" size="sm" className="mt-1">
          Analyze
        </Button>
      )}
    </div>
  )
}

// ── Result ────────────────────────────────────────────────────────────────────

// Scenario editor lives in components/panel/ScenarioDisclosure so the
// Pipeline detail page can reuse it. See that file for the editor itself.


/** Build the "vs default" delta line for a MetricCard when the user has
 *  an active scenario. Returns text + tone (positive = green, negative =
 *  red, neutral = no significant change). For DSCR/cap rate, "positive"
 *  always means the scenario is better than default (higher); for cash
 *  flow that's the same. So the tone is straightforward sign-based. */
function formatDelta(
  scenarioValue: number,
  defaultValue:  number,
  kind:          "currency" | "pct" | "ratio",
): { text: string; tone: "pos" | "neg" | "neutral" } | null {
  if (!Number.isFinite(scenarioValue) || !Number.isFinite(defaultValue)) return null
  const delta = scenarioValue - defaultValue
  // Round to a noise threshold per kind — sub-$1 / sub-0.01% / sub-0.005
  // changes shouldn't render as an "edited" indicator. Keeps the line
  // honest: it appears only when the scenario actually moves the metric.
  const epsilon = kind === "currency" ? 1 : kind === "pct" ? 0.0001 : 0.005
  if (Math.abs(delta) < epsilon) return null
  const sign = delta > 0 ? "+" : "−"
  const abs  = Math.abs(delta)
  let text: string
  if (kind === "currency") {
    text = `${sign}$${Math.round(abs).toLocaleString("en-US")}/mo vs default`
  } else if (kind === "pct") {
    text = `${sign}${(abs * 100).toFixed(2)}pp vs default`
  } else {
    text = `${sign}${abs.toFixed(2)} vs default`
  }
  const tone: "pos" | "neg" | "neutral" = delta > 0 ? "pos" : "neg"
  return { text, tone }
}


function ResultPane({
  result, pipelineAverages, initialScenario, onScenarioChange, onOpenSources,
  isSaved, savedStage, currentStage, onMoveStage, onSave, onOpenSource,
  buyBar,
}: {
  result:            PanelResult
  pipelineAverages?: PipelineAverages
  initialScenario?:  ScenarioOverrides | null
  onScenarioChange?: (scenario: ScenarioOverrides | null) => void
  /** Open the Sources drawer — wired by the parent Panel which owns
   *  the drawer's open state. */
  onOpenSources?:    () => void
  /** Personal-criteria thresholds. Each field nullable; null = no bar
   *  for that metric. Drives the "above bar / below bar" pills on
   *  MetricCard. */
  buyBar?:           {
    minCapRate?:  number | null
    minCashFlow?: number | null
    minDscr?:     number | null
  }
  /** Pipeline-status flag wired from Panel — toggles the action row's
   *  primary CTA between "Save deal" and "Saved · {stage}". */
  isSaved?:          boolean
  savedStage?:       string
  /** Current pipeline stage for already-saved listings. When set
   *  along with onMoveStage, the action row replaces its disabled
   *  Saved button with a real StageMenu dropdown. */
  currentStage?:     DealStage
  onMoveStage?:      (s: DealStage) => void
  /** Save the current listing — primary action of the panel. */
  onSave?:           () => void
  /** Open the listing's source URL in the user's default browser. */
  onOpenSource?:     () => void
}) {
  // Ref to the Adjust assumptions disclosure so the inline "Adjust" pill
  // (next to the cash-flow hero) can scroll the editor into view AND
  // open it. The verb sits next to the number it changes.
  const adjustRef = useRef<HTMLDivElement>(null)

  // Shared "toggle editor + scroll" used by both the Adjust pill and
  // the per-row "got better numbers?" affordance on soft-source
  // provenance rows. Centralized so they stay in sync.
  // - Editor closed: open it + scroll to the editor
  // - Editor open:   close it (clicking Adjust again should dismiss)
  const openEditorAndScroll = () => {
    setEditorOpen((wasOpen) => {
      const nextOpen = !wasOpen
      if (nextOpen) {
        requestAnimationFrame(() => {
          adjustRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        })
      }
      return nextOpen
    })
  }
  // Scenario overrides. When the listing is a saved pipeline deal, this
  // hydrates from the row's `scenario` column and persists back via
  // onScenarioChange. Unsaved listings keep overrides in memory only.
  const [overrides, setOverrides] = useState<ScenarioOverrides>(initialScenario ?? {})
  // Open the editor automatically when there's already a saved scenario,
  // so reopening a saved deal lands the user on their alternate view, not
  // hidden under a closed disclosure.
  const [editorOpen, setEditorOpen] = useState<boolean>(hasActiveScenario(initialScenario))

  // "Show details" disclosure — collapses Secondary metrics + Numbers
  // we used + the benchmark line into a single toggle below the metric
  // cards. The "first 4 seconds" view (hero + AI noticed + 2 metric
  // cards + actions) stays clean; depth is on demand. Closed by
  // default — the user opens it when they want to verify, which is a
  // distinct task from the scan-loop "is this a deal?" first read.
  const [detailsOpen, setDetailsOpen] = useState(false)

  // Persist — only when overrides actually change. Skip onScenarioChange
  // identity from the dep array so an unstable parent callback doesn't
  // re-fire this effect on every parent render. (That was causing a
  // tight render loop: parent re-renders → callback identity changes →
  // effect runs → calls callback → parent state updates → parent
  // re-renders, forever.) The callback is read from the latest render
  // via a ref so we still call the most recent version. Skip the very
  // first effect run (post-hydrate) so we don't immediately re-persist
  // what we just loaded.
  const firstPersistTick = useRef(true)
  const onScenarioChangeRef = useRef(onScenarioChange)
  useEffect(() => { onScenarioChangeRef.current = onScenarioChange }, [onScenarioChange])
  useEffect(() => {
    if (firstPersistTick.current) { firstPersistTick.current = false; return }
    onScenarioChangeRef.current?.(hasActiveScenario(overrides) ? overrides : null)
  }, [overrides])

  // Subscribe to the scenario bus so chat-driven scenario changes merge
  // into our overrides and recompute metrics live.
  useEffect(() => {
    return subscribeToScenarioBus((partial) => {
      setOverrides((prev) => ({ ...prev, ...partial }))
    })
  }, [])

  // Subscribe to reset bus — when AI calls reset_scenario, clear overrides.
  useEffect(() => {
    return subscribeToScenarioReset(() => setOverrides({}))
  }, [])

  const scenarioActive = hasActiveScenario(overrides)
  // Recompute metrics live whenever overrides change. Sub-millisecond per
  // call; no debouncing needed. When no override is set, fall straight
  // through to the original analysis snapshot.
  const metrics = useMemo(
    () => scenarioActive ? recomputeMetrics(result.inputs, overrides) : result.metrics,
    [scenarioActive, result.inputs, result.metrics, overrides]
  )

  // For Phase 5 delta lines: always compute the default metrics so each
  // card can show "vs default: +$650/mo" when a scenario is active.
  const defaultMetrics = result.metrics

  const { inputs, provenance } = result

  const fmtCurrency = (n: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    }).format(n)
  const fmtPct = (n: number | null) =>
    n == null ? "—" : `${(n * 100).toFixed(2)}%`
  const fmtNum = (n: number | null, dec = 2) =>
    n == null ? "—" : n.toFixed(dec)
  const fmtMonthly = (n: number) =>
    `${n >= 0 ? "+" : ""}${fmtCurrency(n)}`

  const address = [result.address, result.city, result.state].filter(Boolean).join(", ")

  // Neighborhood density — count saved deals in the same city as the
  // current listing. Read from the persistent MapShell deal list so
  // the value updates live when the user saves something in this
  // city. Tells the user at a glance whether this listing is a
  // one-off or part of a market they already track.
  const { deals: shellDeals } = useMapShell()
  const sameCityCount = useMemo(() => {
    const city = result.city?.trim().toLowerCase()
    if (!city) return 0
    return shellDeals.filter((d) => d.city?.trim().toLowerCase() === city).length
  }, [shellDeals, result.city])

  // Portfolio reasoning — the buddy looking at THIS listing relative to
  // YOUR pipeline. Generic AI commentary describes the listing
  // ("3-bed condo, brand-new construction"); this reasons against the
  // user's own data ("3rd Anchorage deal — the other two cash-flow
  // negative at 25% down"). The differentiator. Returns 1 string or
  // null when there's not enough comparable history.
  const portfolioObservation = useMemo<string | null>(() => {
    if (shellDeals.length < 2) return null
    const cf = result.metrics?.monthlyCashFlow
    const cap = result.metrics?.capRate
    const city = result.city?.trim().toLowerCase()

    // Same-city pattern detection — most concrete signal when the user
    // is concentrated in a market.
    if (city) {
      const cityPeers = shellDeals.filter((d) => d.city?.trim().toLowerCase() === city)
      if (cityPeers.length >= 2) {
        const peerCfs = cityPeers
          .map((d) => d.snapshot?.metrics?.monthlyCashFlow)
          .filter((n): n is number => Number.isFinite(n))
        if (peerCfs.length >= 2) {
          const negCount = peerCfs.filter((n) => n < 0).length
          if (negCount === peerCfs.length && cf != null && cf < 0) {
            return `${cityPeers.length} other ${result.city} ${cityPeers.length === 2 ? "deal" : "deals"} in your pipeline — all cash-flow negative. Worth asking whether this market clears your bar.`
          }
          const avgCf = peerCfs.reduce((a, b) => a + b, 0) / peerCfs.length
          if (cf != null) {
            const delta = cf - avgCf
            const sign = delta >= 0 ? "+" : "−"
            return `${cityPeers.length === 1 ? "Your other" : `Your ${cityPeers.length} other`} ${result.city} ${cityPeers.length === 1 ? "deal averages" : "deals average"} ${avgCf >= 0 ? "+" : "−"}$${Math.abs(Math.round(avgCf))}/mo. This one's ${sign}$${Math.abs(Math.round(delta))} relative.`
          }
        }
      }
    }

    // Portfolio-wide ranks — cash flow + cap rate against the rest.
    const allCfs = shellDeals
      .map((d) => d.snapshot?.metrics?.monthlyCashFlow)
      .filter((n): n is number => Number.isFinite(n))
    const allCaps = shellDeals
      .map((d) => d.snapshot?.metrics?.capRate)
      .filter((n): n is number => Number.isFinite(n))

    if (cf != null && allCfs.length >= 3) {
      const sorted = [...allCfs].sort((a, b) => a - b)
      const rank = sorted.filter((n) => n < cf).length
      const pct = rank / sorted.length
      if (pct <= 0.25)  return `Cash flow puts this in the bottom quarter of your pipeline.`
      if (pct >= 0.75)  return `Cash flow puts this in the top quarter of your pipeline.`
    }

    if (cap != null && allCaps.length >= 3) {
      const avg = allCaps.reduce((a, b) => a + b, 0) / allCaps.length
      const delta = cap - avg
      if (Math.abs(delta) >= 0.005) {
        const sign = delta > 0 ? "above" : "below"
        return `Cap rate is ${(Math.abs(delta) * 100).toFixed(1)}pt ${sign} your portfolio average of ${(avg * 100).toFixed(1)}%.`
      }
    }

    return null
  }, [shellDeals, result.city, result.metrics])

  return (
    <div
      className="flex flex-col overflow-y-auto panel-scroll flex-1 min-h-0"
      style={{
        // Bottom padding so content scrolls PAST the floating chat
        // input bar (52px + 12px margin = ~70px). Without this the
        // last section of the panel was hidden under the chat.
        paddingBottom: 80,
      }}
    >

      {/* Hero — the moment the user opens the panel. Map → price + cash
          flow paired as co-heroes, so in 4 seconds the user knows what
          this listing IS ($474k for +$340/mo). Address + stats sit below
          as supporting context. The visual ratio is intentional: this
          section takes a third of the panel height so the "what's the
          deal" answer lands hard before the user scrolls. */}
      <div className="px-4 pt-2 pb-5 border-b border-foreground/[0.07]">
        {(result.address || result.city) && (
          <div className="mb-4 -mx-1">
            {/* Inline = Mapbox satellite static (no third-party badge,
                <100ms swap between deals because it's a plain <img>).
                Click → opens the Google Embed modal where the
                [Aerial | Street] toggle and Google's required "Maps"
                badge live. The badge stays out of the everyday panel
                UI; it only appears when the user explicitly opts in
                to the full Google view. */}
            <PropertyMapWithExpand result={result} />
          </div>
        )}

        {/* Price — the financial anchor. Display serif, big, weighted.
            Source mark sits next to it so the user sees at a glance
            "$474k — pulled from Zillow". */}
        {result.listPrice != null && (
          <div className="flex items-baseline gap-2.5">
            <p
              className="leading-[0.95] tabular-nums text-foreground"
              style={{
                fontSize:      42,
                letterSpacing: "-0.032em",
                fontFamily:    "var(--rv-font-display)",
                fontWeight:    500,
              }}
            >
              <Currency value={result.listPrice} whole />
            </p>
            <SourceMark
              source={provenance.listPrice.source}
              siteName={result.siteName}
              size="md"
              title={`List price · from ${sourceMeta(provenance.listPrice.source, result.siteName).label.replace(/^pulled /, "")}`}
            />
          </div>
        )}

        {/* Cash flow as the co-hero — the actual answer to "is this a
            deal?" rendered with confidence right next to the price.
            Color follows sign (calm rose for negative, calm green for
            positive); never green-as-judgment, just data hygiene. */}
        {Number.isFinite(metrics.monthlyCashFlow) && (
          <div className="flex items-baseline gap-2 mt-2">
            {/* NumberFlow ticks the cash flow value when scenarios
                recompute (Adjust → metric changes). The number actually
                animates from the old value to the new one instead of
                hard-swapping — Mercury-style "this app is alive" detail.
                Format honors the locale + currency sign convention. */}
            <span
              className="tabular-nums leading-none"
              style={{
                color:         metrics.monthlyCashFlow < 0 ? "var(--rv-neg)" : "var(--rv-pos)",
                fontSize:      22,
                letterSpacing: "-0.020em",
                fontFamily:    "var(--rv-font-display)",
                fontWeight:    500,
              }}
            >
              <NumberFlow
                value={metrics.monthlyCashFlow}
                format={{ style: "currency", currency: "USD", maximumFractionDigits: 0, signDisplay: "exceptZero" }}
              />
            </span>
            <span className="text-[12px] tracking-tight text-muted-foreground">
              cash flow / mo
            </span>
            {buyBar?.minCashFlow != null && (
              <span
                className="inline-flex items-center gap-1 ml-1 text-[10px] uppercase tracking-widest font-semibold rounded-full"
                style={{
                  color:      metrics.monthlyCashFlow >= buyBar.minCashFlow ? "var(--rv-pos)" : "var(--rv-neg)",
                  background: metrics.monthlyCashFlow >= buyBar.minCashFlow ? "var(--rv-pos-bg)" : "var(--rv-neg-bg)",
                  border:     `0.5px solid ${(metrics.monthlyCashFlow >= buyBar.minCashFlow ? "var(--rv-pos)" : "var(--rv-neg)")}33`,
                  padding:    "2px 6px",
                }}
                title={metrics.monthlyCashFlow >= buyBar.minCashFlow ? "Above your cash-flow bar" : "Below your cash-flow bar"}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: 4, height: 4,
                    background: metrics.monthlyCashFlow >= buyBar.minCashFlow ? "var(--rv-pos)" : "var(--rv-neg)",
                  }}
                />
                {metrics.monthlyCashFlow >= buyBar.minCashFlow ? "above bar" : "below bar"}
              </span>
            )}
            {/* Inline Adjust pill — the verb sits next to the number it
                changes. Clicking opens the editor + scrolls it into view.
                When a scenario is active, the "Your scenario" banner
                above the metric cards is the load-bearing indicator;
                this pill stays clean ("Adjust") because doubling up the
                state callout reads as noise. */}
            <Button
              onClick={openEditorAndScroll}
              variant="secondary"
              size="sm"
              className="ml-auto rounded-full text-muted-foreground bg-muted border border-border hover:bg-muted-foreground/10"
              title="Adjust price, rate, rent, etc."
            >
              <SlidersHorizontal size={12} strokeWidth={2.2} />
              Adjust
              <ChevronDown size={11} strokeWidth={2.2} />
            </Button>
          </div>
        )}

        {address && (
          <p className="text-[13px] mt-3 leading-snug text-foreground">
            {address}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-[11.5px] text-muted-foreground">
          {result.beds      && <span>{result.beds} bd</span>}
          {result.baths     && <span>{result.baths} ba</span>}
          {result.sqft      && <span>{result.sqft.toLocaleString()} sqft</span>}
          {result.yearBuilt && <span>Built {result.yearBuilt}</span>}
          {result.siteName  && <span className="ml-auto text-muted-foreground/80">{result.siteName}</span>}
        </div>

      </div>

      {/* Action row — the conversion moment. Save deal is the entire
          point of running the analysis; it gets a primary button right
          under the hero so it's unmissable. Open listing returns the
          investor to the source page. Re-analyze / settings still live
          in the slim header. */}
      {(onSave || onOpenSource || (isSaved && onMoveStage && currentStage)) && (
        <div className="px-4 py-3 flex items-center gap-2 shrink-0 border-b border-foreground/[0.07]">
          {/* Saved + can move stage → StageMenu (a real dropdown that
              actually changes the deal's stage). Replaces the previous
              disabled "Watching" button which was a UI lie — it looked
              like a button but did nothing.

              Saved + no stage handler → fall back to a quiet status
              chip so the user still sees they're saved.

              Not saved → primary "Save deal" CTA. */}
          {isSaved && onMoveStage && currentStage ? (
            // Saved + can move stage: just the StageMenu (functional —
            // changes the stage). The "Saved" status indicator that
            // used to sit beside it was redundant with the topbar
            // chrome that already shows save state.
            <div className="flex-1 flex items-center">
              <StageMenu stage={currentStage} onChange={onMoveStage} />
            </div>
          ) : isSaved ? (
            // Saved but no stage handler — drop the inline chip
            // entirely. Topbar already shows save state. Render
            // nothing here so Open / scenario buttons get the row.
            <div className="flex-1" />
          ) : onSave ? (
            <Button
              variant="primary"
              size="md"
              onClick={onSave}
              icon={<Bookmark size={14} strokeWidth={2.2} />}
              className="flex-1"
            >
              Save deal
            </Button>
          ) : null}
          {onOpenSource && (
            <Button
              variant="secondary"
              size="md"
              onClick={onOpenSource}
              icon={<ExternalLink size={13} strokeWidth={2.2} />}
              title="Open listing in your browser"
            >
              Open
            </Button>
          )}
        </div>
      )}

      {/* AI Noticed — combined Notes (the AI take) + Worth Knowing flags
          + portfolio benchmark line. Was three separate sections that all
          said "the AI is observing things"; now one unified surface in
          the buddy's voice (display serif). */}
      {(result.take || result.riskFlags.length > 0 || portfolioObservation || (sameCityCount > 0 && result.city)) && (
        <div className="px-4 py-5 border-b border-foreground/[0.07]">
          <p className="text-[11px] font-medium mb-3 flex items-center gap-1.5 text-primary">
            <Sparkles size={11} strokeWidth={2} />
            AI noticed
          </p>
          {result.take && (
            <p
              className="leading-snug text-foreground"
              style={{
                fontSize:      14.5,
                fontFamily:    "var(--rv-font-display)",
                fontWeight:    400,
                letterSpacing: "-0.012em",
              }}
            >
              {result.take}
            </p>
          )}
          {result.riskFlags.length > 0 && (
            <div className={`flex flex-col gap-2 ${result.take ? "mt-3" : ""}`}>
              {result.riskFlags.map((flag, i) => <RiskFlag key={i} text={flag} />)}
            </div>
          )}
          {/* Portfolio reasoning — buddy comparing this listing against
              the user's own pipeline. The differentiator: most apps
              describe the listing in isolation; we put it in context
              of what you've already saved. Cream-bordered card so
              it reads as a separate "your pipeline says" thought. */}
          {portfolioObservation && (
            <div className={`relative overflow-hidden rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 ${result.take || result.riskFlags.length > 0 ? "mt-3" : ""}`}>
              {/* Magic UI BorderBeam — sage shimmer that traces the
                  card edge once when the reasoning lands. Signals
                  "fresh thought from the buddy" — same gesture
                  Linear uses to highlight new threads. Single pass
                  (delay then static) so it doesn't perpetually pulse. */}
              <BorderBeam size={50} duration={6} colorFrom="var(--primary)" colorTo="transparent" />
              <p
                className="leading-snug text-foreground relative"
                style={{
                  fontSize:      13,
                  fontFamily:    "var(--rv-font-display)",
                  fontWeight:    400,
                  letterSpacing: "-0.008em",
                }}
              >
                {portfolioObservation}
              </p>
            </div>
          )}
          {/* Neighborhood density — fallback "you already track this
              market" line when there isn't enough data for the deeper
              portfolio reasoning above. */}
          {!portfolioObservation && sameCityCount > 0 && result.city && (
            <p className={`text-[12px] text-muted-foreground ${result.take || result.riskFlags.length > 0 ? "mt-3" : ""}`}>
              You already have {sameCityCount} saved deal{sameCityCount === 1 ? "" : "s"} in {result.city}.
            </p>
          )}
        </div>
      )}

      {/* "Vs your buy bar" + "Vs your pipeline" framing strips —
          contextual deltas BEFORE the absolute metric cards. Order
          matches the workspace: own criteria (your buy bar) first,
          peer set (your pipeline) second. Each strip silently hides
          when there's nothing meaningful to surface (no thresholds
          set / not enough peers / no deltas above noise). */}
      <BuyBarFramingStrip metrics={metrics} buyBar={buyBar} />
      <PortfolioFramingStrip metrics={metrics} averages={pipelineAverages} />

      {/* Three key metrics. Cards stay clean — trust signals live in the
          header source-stack + the provenance section below + the Sources
          drawer. When the user has tweaked any scenario input, a quiet
          "Your scenario" chip appears above the cards so the user knows
          they're looking at modeled-not-default numbers. */}
      <div className="px-4 py-4 border-b border-foreground/[0.07]">
        {/* "Your scenario" banner — the unmissable cue that the metric
            cards below show modeled-not-default numbers. Sits between
            the hero and the cards so the user's eye lands here on the
            way down. Forest-green accent matches the rest of the
            scenario surfaces (the Adjusting pill, the editor
            disclosure). Click anywhere except Reset → opens the
            editor; Reset → clears overrides and returns to default. */}
        {scenarioActive && (
          <button
            type="button"
            onClick={openEditorAndScroll}
            title="Click to edit your scenario"
            className="w-full mb-3 flex items-center gap-2.5 rounded-[8px] text-left text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors"
            style={{ padding: "8px 10px 8px 12px" }}
          >
            <span className="rounded-full bg-primary shrink-0" style={{ width: 6, height: 6 }} />
            <span className="text-[11.5px] font-medium tracking-tight">
              Your scenario
            </span>
            <span className="text-[11px] tabular-nums text-primary/75">
              · {Object.keys(overrides).filter((k) => (overrides as Record<string, unknown>)[k] !== undefined).length} change{Object.keys(overrides).filter((k) => (overrides as Record<string, unknown>)[k] !== undefined).length === 1 ? "" : "s"}
            </span>
            <span className="flex-1" />
            <Button
              onClick={(e) => { e.stopPropagation(); setOverrides({}) }}
              variant="ghost"
              size="xs"
              title="Clear all overrides and return to the default analysis"
              className="h-6 px-2 text-[10.5px]"
            >
              Reset
            </Button>
          </button>
        )}
        {/* Cash Flow lives in the hero — no need to repeat it as a card.
            The two cards that remain are the underwriting numbers a real
            investor reads next: cap rate (yield on cost) and DSCR (debt
            coverage). Bigger cards now that there are only two. */}
        <div className="rv-stagger grid grid-cols-2 gap-2.5">
          <MetricCard
            label="Cap Rate"
            value={fmtPct(metrics.capRate)}
            sub={`${fmtPct(metrics.cashOnCash)} cash-on-cash`}
            delta={scenarioActive ? formatDelta(metrics.capRate, defaultMetrics.capRate, "pct") : null}
            flashKey={Math.round(metrics.capRate * 10000)}
            bar={buyBar?.minCapRate != null ? { passed: metrics.capRate >= buyBar.minCapRate } : null}
          />
          <MetricCard
            label="DSCR"
            value={fmtNum(metrics.dscr)}
            sub={metrics.dscr >= 1.0 ? "covers debt service" : "below debt service"}
            delta={scenarioActive ? formatDelta(metrics.dscr, defaultMetrics.dscr, "ratio") : null}
            flashKey={Math.round(metrics.dscr * 100)}
            bar={buyBar?.minDscr != null ? { passed: metrics.dscr >= buyBar.minDscr } : null}
          />
        </div>
      </div>

      {/* "Show details" disclosure — collapses Benchmark line +
          Secondary metrics + Numbers we used into ONE toggle. The
          first-4-seconds view ends here; everything below this trigger
          is verification depth, available on demand.

          The trigger row itself is small + neutral; the open state
          rotates a chevron and reveals the three sub-blocks. */}
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-foreground/[0.07] hover:bg-muted/50 transition-colors text-left"
        aria-expanded={detailsOpen}
      >
        <span className="text-[12px] font-medium text-muted-foreground">
          {detailsOpen ? "Hide details" : "Show details"}
        </span>
        <ChevronDown
          size={13}
          strokeWidth={2}
          className="text-muted-foreground/60"
          style={{
            transform: detailsOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        />
      </button>

      {detailsOpen && (
        <>
          {/* Portfolio benchmark line — was inline under the metric
              cards; now lives inside the details disclosure as the
              first verification surface. */}
          <div className="px-4 py-3 border-b border-foreground/[0.07]">
            <BenchmarkLine
              metrics={metrics}
              averages={pipelineAverages}
            />
          </div>

          {/* Secondary metrics — GRM / break-even / rent / cash invested.
              Useful on demand, not in the first read. */}
          <div className="px-4 py-3 grid grid-cols-2 gap-y-3 border-b border-foreground/[0.07]">
            {[
              { label: "GRM",             value: `${fmtNum(metrics.grm, 1)}×` },
              { label: "Break-even occ.", value: fmtPct(metrics.breakEvenOccupancy) },
              { label: "Monthly rent",    value: `${fmtCurrency(inputs.monthlyRent)}/mo` },
              { label: "Cash invested",   value: fmtCurrency(metrics.totalCashInvested) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[11px] mb-1 text-muted-foreground">
                  {label}
                </p>
                <p className="text-[13px] tabular-nums font-medium text-foreground">{value}</p>
              </div>
            ))}
          </div>

          {/* Numbers we used — provenance rows. The brand promise made
              tangible: every input that drove the metrics above, with
              its source attribution. Lives inside the details
              disclosure now so it's still inline (not hidden in a
              drawer) but doesn't compete with the first read. */}
          <div className="px-4 py-4 border-b border-foreground/[0.07]">
            <p className="text-[10px] uppercase tracking-widest font-medium mb-2.5 text-muted-foreground/60">
              Numbers we used
            </p>
            <div className="flex flex-col">
              <ProvenanceRow
                label="Rent"
                value={`${fmtCurrency(provenance.rent.value)}/mo`}
                field={provenance.rent}
                siteName={result.siteName}
                onEdit={openEditorAndScroll}
              />
              <ProvenanceRow
                label="Interest rate"
                value={fmtPct(provenance.interestRate.value / 100)}
                field={provenance.interestRate}
                siteName={result.siteName}
                fetchedAt={provenance.interestRate.fetchedAt}
                onEdit={openEditorAndScroll}
              />
              <ProvenanceRow
                label="Property tax"
                value={`${fmtCurrency(provenance.propertyTax.value)}/yr`}
                field={provenance.propertyTax}
                siteName={result.siteName}
                onEdit={openEditorAndScroll}
              />
              <ProvenanceRow
                label="Insurance"
                value={`${fmtCurrency(provenance.insurance.value)}/yr`}
                field={provenance.insurance}
                siteName={result.siteName}
                onEdit={openEditorAndScroll}
              />
              {provenance.hoa && (
                <ProvenanceRow
                  label="HOA"
                  value={`${fmtCurrency(provenance.hoa.value)}/mo`}
                  field={provenance.hoa}
                  siteName={result.siteName}
                  onEdit={openEditorAndScroll}
                />
              )}
            </div>
          </div>
        </>
      )}

      {/* Adjust assumptions — scenario editor disclosure. Closed by
          default; opens to reveal 5 inline overrides + Advanced. Edits
          drive the metric cards above via live recompute (sub-ms).
          The ref lets the inline "Adjust" pill above scroll us into view. */}
      <div ref={adjustRef} />
      <ScenarioDisclosure
        baseInputs={result.inputs}
        baseListPrice={result.listPrice}
        provenance={result.provenance}
        siteName={result.siteName}
        overrides={overrides}
        setOverrides={setOverrides}
        open={editorOpen}
        setOpen={setEditorOpen}
      />

      {/* Risk flags + Provenance section both removed:
          - Risk flags are now in the unified "AI Noticed" section above
          - Provenance was duplicating the Sources drawer; the drawer is
            the source of truth, accessed via the footer link below */}

      {/* Sources footer link — opens the drawer with the full provenance
          breakdown. Quiet, lives at the bottom of the panel; the drawer
          is where the brand promise gets shown in detail. */}
      {onOpenSources && (
        <div className="px-4 pt-3 pb-1">
          <Button
            onClick={onOpenSources}
            variant="link"
            size="xs"
            className="px-0 h-auto text-[12px] text-muted-foreground"
          >
            <Sparkles size={11} strokeWidth={2} className="text-primary" />
            Where every number comes from →
          </Button>
        </div>
      )}
    </div>
  )
}


// ── Panel ─────────────────────────────────────────────────────────────────────

export type PanelContentState =
  | { phase: "empty";       hasListing: boolean }
  | { phase: "analyzing" }
  | { phase: "ready";       result: PanelResult }
  | { phase: "error";       message: string }
  | { phase: "manual-entry"; initial?: Partial<ManualFacts> }

interface PanelProps {
  state:        PanelContentState
  /** Whether the current listing is already saved to the user's pipeline. */
  isSaved?:     boolean
  /** Stage label to show on the Saved chip (e.g. "Watching"). */
  savedStage?:  string
  /** Current pipeline stage as a typed enum — when set with onMoveStage,
   *  the action row renders a real StageMenu dropdown for moving the
   *  deal between stages (replaces the previous disabled label). */
  currentStage?: DealStage
  onMoveStage?:  (s: DealStage) => void
  /** Personal-criteria thresholds (the user's "buy bar"). When set,
   *  metric cards render quiet "above bar / below bar" pills.
   *  Read from InvestmentPrefs in the host route. */
  buyBar?: {
    minCapRate?:  number | null
    minCashFlow?: number | null
    minDscr?:     number | null
  }
  /** Hosts that already render their own pipeline-actions strip
   *  (Pipeline detail rail) set this true so the Panel doesn't
   *  duplicate Save / StageMenu / Open in its own action row. The
   *  in-panel action row only appears in surfaces (Browse) where
   *  there's no outer strip. Avoids the "two action areas, same
   *  buttons, different places" pattern that was wasting the
   *  empty space above the panel content in Pipeline. */
  actionRowCollapsed?: boolean
  /** History stats — drives the "You've seen this" pill. Optional; if not
   *  passed or count <= 1, no pill renders. */
  viewStats?:   { count: number; firstSeenAt: string | null }
  /** User's personal averages from their pipeline. Drives the "vs your
   *  saves" line under the metric cards — only renders when 2+ deals
   *  contribute (single-deal averages are noise). */
  pipelineAverages?: PipelineAverages
  /** Hydrated scenario for the editor (when this listing is a saved
   *  pipeline deal with stored overrides). NULL/undefined = empty editor. */
  initialScenario?:  ScenarioOverrides | null
  /** Persist scenario edits. Host wires this only for saved listings; for
   *  unsaved ones overrides stay in panel memory and disappear on close. */
  onScenarioChange?: (scenario: ScenarioOverrides | null) => void
  onClose?:     () => void
  onSave?:      () => void
  onReanalyze?: () => void
  /** Open the listing's source URL in the user's default browser. */
  onOpenSource?: () => void
  /** Switch into the manual-entry flow from the error pane. */
  onStartManualEntry?: () => void
  /** Submit a manual-entry form. The host page is responsible for sending
   *  it to /api/analyze and routing the result back through panel:ready. */
  onSubmitManualEntry?: (facts: ManualFacts) => void
  /** Cancel the manual-entry form (back to the previous state). */
  onCancelManualEntry?: () => void

  // ── Chat surface (active when state.phase === "ready") ─────────────────
  /** Conversation log for the current listing. Empty array = first turn. */
  chatMessages?:   ChatMessage[]
  /** Loading flag — true while waiting on Haiku for the latest message. */
  chatLoading?:    boolean
  /** Context bundle the chat sends along with each turn. */
  chatContext?:    ChatContext
  /** Push a user message + run the IPC call. Host page owns history state. */
  onChatSend?:     (message: ChatMessage) => Promise<void>
  /** Reset the conversation log. */
  onChatClear?:    () => void
}

export default function Panel({
  state,
  isSaved,
  savedStage,
  currentStage,
  onMoveStage,
  buyBar,
  actionRowCollapsed,
  viewStats,
  pipelineAverages,
  initialScenario,
  onScenarioChange,
  onClose,
  onSave,
  onReanalyze,
  onOpenSource,
  onStartManualEntry,
  onSubmitManualEntry,
  onCancelManualEntry,
  chatMessages = [],
  chatLoading  = false,
  chatContext,
  onChatSend,
  onChatClear,
}: PanelProps) {
  // Build the "you've seen this before" hint. We only surface it for
  // unsaved listings (the saved chip already implies prior interest), and
  // we suppress it for first-time visits — there's nothing useful to say.
  const seenHint = (() => {
    if (!viewStats || viewStats.count <= 1) return null
    if (isSaved) return null
    const c = viewStats.count
    return c >= 5 ? `Viewed ${c}+ times` : `Viewed ${c}×`
  })()
  const isReady   = state.phase === "ready"
  const isError   = state.phase === "error"
  const canSave   = isReady && !!onSave
  const canReanalyze = (isReady || isError) && !!onReanalyze

  // Chat is always visible at the bottom now (no more mode toggle).
  // canChat just gates whether the chat zone renders at all.
  const canChat = isReady && !!onChatSend && !!chatContext

  // Sources drawer — slides over the panel body listing every fact + origin.
  // Always closed on mount; opens via the header source-stack button.
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const result = state.phase === "ready" ? state.result : null

  // Esc layers — drawer first (topmost when open), then close the panel.
  // No more chat-mode escape since chat is always inline.
  useEscape(!sourcesOpen && !!onClose, () => onClose?.())

  return (
    <div
      className="flex flex-col h-full overflow-hidden panel-enter bg-background"
      style={{
        // Opaque — sits over the persistent map layer, so the panel
        // needs to fully cover the map underneath, not blend with it.
        // Soft drop-shadow on the map-facing edge gives the panel
        // physical presence without a stitched border.
        boxShadow:   "-1px 0 0 rgba(255,255,255,0.06)",
        minWidth:    0,
      }}
    >
      {/* Slim panel header removed — Re-analyze, Save, Stage, Close
          all live in the AppTopBar's aux + global cluster slots now.
          The panel goes straight into the satellite hero, reclaiming
          ~30px of vertical real estate. The analyzing pulse + seen-
          hint were the only other things in this header; the
          analyzing pulse will be relocated into the hero itself when
          a fresh analysis is in flight. */}

      {/* Body — analysis surface gets the FULL panel height. Chat
          floats over the bottom edge: collapsed it's just a 52px input
          bar; when focused or with messages it expands upward as a
          glass overlay. Analysis stays fully visible underneath. */}
      <div className="flex flex-col flex-1 min-h-0 relative">
        <div className="flex-1 min-h-0 flex flex-col">
          {state.phase === "empty"       && <EmptyPane     hasListing={state.hasListing} onAnalyze={onReanalyze ?? (() => {})} />}
          {state.phase === "analyzing"   && <AnalyzingPane />}
          {state.phase === "ready"       && (
            <ResultPane
              result={state.result}
              pipelineAverages={pipelineAverages}
              initialScenario={initialScenario}
              onScenarioChange={onScenarioChange}
              onOpenSources={() => setSourcesOpen(true)}
              isSaved={isSaved}
              savedStage={savedStage}
              currentStage={currentStage}
              onMoveStage={onMoveStage}
              buyBar={buyBar}
              onSave={actionRowCollapsed ? undefined : onSave}
              onOpenSource={actionRowCollapsed ? undefined : onOpenSource}
            />
          )}
          {state.phase === "error"       && <ErrorPane     message={state.message} onRetry={onReanalyze} onManualEntry={onStartManualEntry} />}
          {state.phase === "manual-entry" && (
            <ManualEntryPane
              initial={state.initial}
              onSubmit={(f) => onSubmitManualEntry?.(f)}
              onCancel={() => onCancelManualEntry?.()}
            />
          )}
        </div>
        {/* Floating chat over the bottom edge. Self-managed expand
            state — collapsed = just the input bar, expanded = grows
            upward to show suggestions or conversation history. */}
        {canChat && (
          <PanelChat
            messages={chatMessages}
            context={chatContext!}
            loading={chatLoading}
            onSend={onChatSend!}
            onClear={onChatClear}
            disabled={!isReady}
          />
        )}

        {/* Sources drawer — overlays the body when the user clicks the
            source-stack pill in the header. */}
        {sourcesOpen && result && (
          <SourcesDrawer result={result} onClose={() => setSourcesOpen(false)} />
        )}
      </div>
    </div>
  )
}
