"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { RefreshCw, Bookmark, BookmarkCheck, Eye, ExternalLink, MessagesSquare, BarChart3, X } from "lucide-react"
import type { ChatContext, ChatMessage, PanelResult, SourceField, SourceKind } from "@/lib/electron"
import type { PipelineAverages } from "@/lib/pipeline"
import { SourceMark, sourceMeta, freshnessLabel } from "@/components/source/SourceMark"
import { Currency } from "@/lib/format"
import {
  hasActiveScenario,
  recomputeMetrics,
  type ScenarioOverrides,
} from "@/lib/scenario"
import PanelChat from "./Chat"
import { ScenarioDisclosure } from "./ScenarioDisclosure"
import PropertyMap from "@/components/PropertyMap"
import { useEscape } from "@/lib/escapeStack"

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
  label, value, sub, delta, tone = "neutral",
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
}) {
  const valueColor = tone === "neg" ? "var(--rv-neg)" : "var(--rv-t1)"
  const deltaColor =
    delta?.tone === "pos" ? "var(--rv-pos)" :
    delta?.tone === "neg" ? "var(--rv-neg)" :
                            "var(--rv-t4)"

  return (
    <div
      className="flex flex-col gap-1 rounded-xl min-w-0 overflow-hidden"
      style={{
        padding:    "10px 12px 11px",
        background: "var(--rv-elev-2)",
        border:     "0.5px solid var(--rv-border-mid)",
        boxShadow:  "var(--rv-shadow-inset), var(--rv-shadow-outer-sm)",
      }}
    >
      <span
        className="text-[9.5px] uppercase tracking-widest font-medium truncate"
        style={{ color: "var(--rv-t4)" }}
      >
        {label}
      </span>
      <span
        className="font-bold tabular-nums leading-none truncate"
        style={{
          color:              valueColor,
          fontVariantNumeric: "tabular-nums",
          fontSize:           21,
          letterSpacing:      "-0.02em",
          marginTop:          2,
        }}
      >
        {value}
      </span>
      {delta && (
        <span
          className="text-[10px] leading-none tabular-nums truncate"
          style={{ color: deltaColor, marginTop: 1 }}
          title="vs default analysis"
        >
          {delta.text}
        </span>
      )}
      {sub && (
        <span className="text-[10.5px] leading-none truncate" style={{ color: "var(--rv-t3)", marginTop: 1 }}>
          {sub}
        </span>
      )}
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
  const tone = (delta: number, higherIsBetter = true) =>
    delta === 0 ? "var(--rv-t3)" :
    (higherIsBetter ? delta > 0 : delta < 0) ? "var(--rv-pos)" : "var(--rv-neg)"

  return (
    <div className="flex items-center justify-between gap-3 mt-3">
      <span
        className="text-[10px] uppercase tracking-widest font-medium shrink-0"
        style={{ color: "var(--rv-t4)" }}
      >
        vs your {averages.count} saves
      </span>
      <div className="flex items-center gap-3 text-[11px] tabular-nums">
        {cashDelta != null && (
          <span style={{ color: tone(cashDelta) }}>
            {fmtCash(cashDelta)}
          </span>
        )}
        {capDelta != null && (
          <span style={{ color: tone(capDelta) }}>
            {fmtPpts(capDelta)}
          </span>
        )}
        {dscrDelta != null && (
          <span style={{ color: tone(dscrDelta) }}>
            {fmtDsc(dscrDelta)}
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
    <div className="flex items-start gap-2.5 text-[12.5px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>
      <span
        className="mt-[6px] shrink-0 rounded-full"
        style={{ width: 5, height: 5, background: "var(--rv-warn)" }}
      />
      <span>{text}</span>
    </div>
  )
}

// ── Provenance row ────────────────────────────────────────────────────────────

function ProvenanceRow({
  label, value, field, siteName, fetchedAt,
}: {
  label:      string
  value:      string
  field:      SourceField
  siteName?:  string | null
  fetchedAt?: string
}) {
  // Tooltip is a real human sentence — names the field, names the source,
  // adds freshness when known. Lets the user verify any number with a hover.
  const meta = sourceMeta(field.source, siteName)
  const tooltipParts = [`${label}: ${meta.label.toLowerCase().replace(/^pulled /, "pulled ")}`]
  const ageStr = fetchedAt ? freshnessLabel(fetchedAt) : null
  if (ageStr) tooltipParts.push(ageStr)
  const tooltip = tooltipParts.join(" · ")
  return (
    <div
      className="flex items-center justify-between gap-3 py-2 last:border-0"
      style={{ borderBottom: "1px solid var(--rv-border)" }}
    >
      <span className="text-[12px] shrink-0" style={{ color: "var(--rv-t3)" }}>{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12px] tabular-nums truncate" style={{ color: "var(--rv-t2)" }}>{value}</span>
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
        style={{ background: "var(--rv-scrim)" }}
        onClick={onClose}
      />
      <div
        className="absolute right-0 top-0 bottom-0 z-40 flex flex-col drawer-enter"
        style={{
          width:          "min(360px, 90%)",
          background:     "var(--rv-drawer-bg)",
          backdropFilter: "blur(36px) saturate(180%)",
          WebkitBackdropFilter: "blur(36px) saturate(180%)",
          borderLeft:     "0.5px solid var(--rv-border-mid)",
          boxShadow:      "inset 1px 0 0 rgba(255,255,255,0.06), -16px 0 40px rgba(0, 0, 0, 0.45)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 shrink-0"
          style={{ height: 40, borderBottom: "1px solid var(--rv-border)" }}
        >
          <span className="text-[12px] font-semibold tracking-tight" style={{ color: "var(--rv-t1)" }}>
            Where every number comes from
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center rounded-[7px] transition-colors"
            style={{ color: "var(--rv-t3)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)"; e.currentTarget.style.background = "var(--rv-elev-3)" }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t3)"; e.currentTarget.style.background = "transparent" }}
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto panel-scroll">
          <p className="text-[11.5px] leading-relaxed px-4 pt-4 pb-3" style={{ color: "var(--rv-t3)" }}>
            Every figure on the panel ties back to one of these sources. Hover a
            number anywhere on the panel to see its origin without opening this
            drawer.
          </p>
          <div className="flex flex-col gap-1 px-2 pb-4">
            {groups.map((group) => {
              const meta = sourceMeta(group.source, result.siteName)
              return (
                <div key={group.key} className="rounded-lg px-3 py-3" style={{ background: "var(--rv-elev-1)" }}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <SourceMark source={group.source} siteName={result.siteName} size="md" />
                    <span className="text-[11.5px] font-semibold tracking-tight" style={{ color: "var(--rv-t1)" }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    {group.facts.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-baseline justify-between gap-3 py-1.5 last:border-0"
                        style={{ borderBottom: "1px solid var(--rv-border)" }}
                      >
                        <span className="text-[12px]" style={{ color: "var(--rv-t3)" }}>{f.label}</span>
                        <div className="flex items-baseline gap-2 text-right">
                          <span className="text-[12.5px] tabular-nums" style={{ color: "var(--rv-t2)" }}>{f.value}</span>
                          {f.fetchedAt && (
                            <span className="text-[10.5px] tabular-nums shrink-0" style={{ color: "var(--rv-t4)" }}>
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
    <button
      onClick={onClick}
      title="See where every number comes from"
      className="inline-flex items-center gap-1 px-1.5 py-[3px] rounded-[6px] transition-colors shrink-0"
      style={{
        background: active ? "var(--rv-elev-3)" : "transparent",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--rv-elev-2)" }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent" }}
    >
      {sources.slice(0, 3).map(({ key, source }) => (
        <SourceMark key={key} source={source} siteName={result.siteName} />
      ))}
      {sources.length > 3 && (
        <span className="text-[9px] tabular-nums" style={{ color: "var(--rv-t4)" }}>
          +{sources.length - 3}
        </span>
      )}
    </button>
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
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="w-7 h-7 flex items-center justify-center rounded-[7px] transition-colors duration-100
                 disabled:opacity-30 disabled:pointer-events-none"
      style={{
        color: active ? "var(--rv-accent)" : "var(--rv-t3)",
        background: active ? "rgba(48,164,108,0.12)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.color = active ? "var(--rv-accent)" : "var(--rv-t1)"
        e.currentTarget.style.background = active ? "rgba(48,164,108,0.18)" : "var(--rv-elev-3)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = active ? "var(--rv-accent)" : "var(--rv-t3)"
        e.currentTarget.style.background = active ? "rgba(48,164,108,0.12)" : "transparent"
      }}
    >
      {children}
    </button>
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
        background:   "var(--rv-elev-2)",
        position:     "relative",
        overflow:     "hidden",
      }}
      className="rv-shimmer"
    />
  )
}

function AnalyzingPane() {
  // Mirror the ResultPane layout exactly so the transition feels like
  // content RESOLVING, not a screen swap.
  return (
    <div className="flex flex-col flex-1 min-h-0 panel-enter">
      {/* Hero skeleton — map → price → cash flow → address */}
      <div className="px-4 pt-4 pb-5" style={{ borderBottom: "1px solid var(--rv-border)" }}>
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
      <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--rv-border)" }}>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                padding:    "10px 12px 11px",
                background: "var(--rv-elev-2)",
                border:     "0.5px solid var(--rv-border-mid)",
                borderRadius: 12,
                boxShadow:  "var(--rv-shadow-inset), var(--rv-shadow-outer-sm)",
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

      {/* Status line — one quiet line that names what's happening, so the
          user knows the AI is thinking, not the app frozen. Replaces the
          old "Pulling rates, rent data..." centered text. */}
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--rv-border)" }}>
        <span className="flex gap-[3px] items-center shrink-0">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-[4px] h-[4px] rounded-full dot-pulse"
              style={{ background: "var(--rv-accent)", animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </span>
        <span className="text-[11px]" style={{ color: "var(--rv-t3)" }}>
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
      <p className="text-[12px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>{message}</p>
      <div className="flex items-center gap-2 mt-1">
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[12px] font-medium transition-colors"
            style={{
              color: "var(--rv-t1)",
              background: "var(--rv-elev-3)",
              border: "1px solid var(--rv-border)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-4)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--rv-elev-3)" }}
          >
            <RefreshCw size={11} strokeWidth={2} />
            Try again
          </button>
        )}
        {onManualEntry && (
          <button
            onClick={onManualEntry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[12px] font-medium transition-colors"
            style={{
              color: "var(--rv-accent)",
              background: "rgba(48,164,108,0.10)",
              border: "1px solid rgba(48,164,108,0.22)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(48,164,108,0.18)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(48,164,108,0.10)" }}
          >
            Enter manually
          </button>
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
      <div
        className="flex items-center justify-between gap-2 px-4 py-3 shrink-0"
        style={{ borderBottom: "0.5px solid var(--rv-border)" }}
      >
        <p className="text-[12px] font-medium" style={{ color: "var(--rv-t1)" }}>
          Tell us about this listing
        </p>
        <button onClick={onCancel} className="text-[11.5px]" style={{ color: "var(--rv-t3)" }}>
          Cancel
        </button>
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
          <p className="text-[10px] uppercase tracking-widest font-medium mt-1" style={{ color: "var(--rv-t4)" }}>
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
      <div
        className="px-4 py-3 shrink-0 flex items-center justify-end gap-2"
        style={{ borderTop: "0.5px solid var(--rv-border)" }}
      >
        <button
          onClick={() => onSubmit(facts)}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-[12px] font-medium tracking-tight transition-colors disabled:opacity-40 disabled:pointer-events-none"
          style={{
            color:      "var(--rv-accent)",
            background: "rgba(48,164,108,0.10)",
            border:     "0.5px solid rgba(48,164,108,0.22)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(48,164,108,0.18)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(48,164,108,0.10)" }}
        >
          Analyze
        </button>
      </div>
    </div>
  )
}

function ManualField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-widest font-medium" style={{ color: "var(--rv-t3)" }}>
        {label}{required && <span style={{ color: "var(--rv-accent)", marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {hint && <p className="text-[10.5px] leading-tight" style={{ color: "var(--rv-t4)" }}>{hint}</p>}
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
      className="flex items-center gap-1.5 rounded-[7px]"
      style={{ background: "var(--rv-elev-2)", border: "0.5px solid var(--rv-border)", padding: "5px 9px" }}
    >
      {prefix && <span className="text-[12px]" style={{ color: "var(--rv-t4)" }}>{prefix}</span>}
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
        className="flex-1 bg-transparent border-none outline-none text-[12.5px] tabular-nums leading-none"
        style={{ color: "var(--rv-t1)" }}
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
      className="rounded-[7px] text-[12.5px] leading-none"
      style={{
        background: "var(--rv-elev-2)",
        border:     "0.5px solid var(--rv-border)",
        padding:    "9px 9px",
        color:      "var(--rv-t1)",
        outline:    "none",
      }}
    />
  )
}

// ── Empty (manual open with no analysis yet) ──────────────────────────────────

function EmptyPane({ onAnalyze, hasListing }: { onAnalyze: () => void; hasListing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 flex-1 px-6 text-center">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: "var(--rv-elev-2)", color: "var(--rv-t3)" }}
      >
        <RefreshCw size={14} strokeWidth={1.7} />
      </div>
      <div>
        <p className="text-[13px] font-medium" style={{ color: "var(--rv-t1)" }}>
          {hasListing ? "Ready when you are" : "Open a listing to analyze"}
        </p>
        <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--rv-t3)" }}>
          {hasListing
            ? "Run analysis on this page."
            : "Navigate to a listing on Zillow, Redfin,\nor any real-estate site."}
        </p>
      </div>
      {hasListing && (
        <button
          onClick={onAnalyze}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[12px] font-medium transition-colors"
          style={{
            color: "var(--rv-accent)",
            background: "rgba(48,164,108,0.10)",
            border: "1px solid rgba(48,164,108,0.22)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(48,164,108,0.18)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(48,164,108,0.10)" }}
        >
          Analyze
        </button>
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
  result, pipelineAverages, initialScenario, onScenarioChange,
}: {
  result:            PanelResult
  pipelineAverages?: PipelineAverages
  /** Scenario to hydrate the editor with on mount. From the saved deal
   *  row when the listing is in the user's pipeline; otherwise undefined.
   *  Re-mounted ResultPane reads this once per panel:ready cycle. */
  initialScenario?:  ScenarioOverrides | null
  /** Persist callback fired (debounced ~350ms) whenever the user changes
   *  an override, including clearing back to default. Only called when
   *  the listing is saved — host page passes undefined for unsaved
   *  listings, in which case overrides stay in-memory only. */
  onScenarioChange?: (scenario: ScenarioOverrides | null) => void
}) {
  // Scenario overrides. When the listing is a saved pipeline deal, this
  // hydrates from the row's `scenario` column and persists back via
  // onScenarioChange. Unsaved listings keep overrides in memory only.
  const [overrides, setOverrides] = useState<ScenarioOverrides>(initialScenario ?? {})
  // Open the editor automatically when there's already a saved scenario,
  // so reopening a saved deal lands the user on their alternate view, not
  // hidden under a closed disclosure.
  const [editorOpen, setEditorOpen] = useState<boolean>(hasActiveScenario(initialScenario))

  // Debounced persist — fire once user stops typing for ~350ms. Avoids
  // writing on every keystroke. Skip the very first effect run (post-
  // hydrate) so we don't immediately re-persist what we just loaded.
  const firstPersistTick = useRef(true)
  useEffect(() => {
    if (!onScenarioChange) return
    if (firstPersistTick.current) { firstPersistTick.current = false; return }
    const id = setTimeout(() => {
      onScenarioChange(hasActiveScenario(overrides) ? overrides : null)
    }, 350)
    return () => clearTimeout(id)
  }, [overrides, onScenarioChange])

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

  return (
    <div className="flex flex-col overflow-y-auto panel-scroll flex-1 min-h-0">

      {/* Hero — the moment the user opens the panel. Map → price + cash
          flow paired as co-heroes, so in 4 seconds the user knows what
          this listing IS ($474k for +$340/mo). Address + stats sit below
          as supporting context. The visual ratio is intentional: this
          section takes a third of the panel height so the "what's the
          deal" answer lands hard before the user scrolls. */}
      <div className="px-4 pt-4 pb-5" style={{ borderBottom: "1px solid var(--rv-border)" }}>
        {(result.address || result.city) && (
          <div className="mb-4 -mx-1">
            <PropertyMap
              address={result.address}
              city={result.city}
              state={result.state}
              zip={result.zip}
              size="inline"
              radius={10}
              className="w-full"
            />
          </div>
        )}

        {/* Price — the financial anchor. Display serif, big, weighted. */}
        {result.listPrice != null && (
          <p
            className="leading-[1.0] tabular-nums"
            style={{
              color:         "var(--rv-t1)",
              fontSize:      36,
              letterSpacing: "-0.030em",
              fontFamily:    "var(--rv-font-display)",
              fontWeight:    500,
            }}
          >
            <Currency value={result.listPrice} whole />
          </p>
        )}

        {/* Cash flow as the co-hero — the actual answer to "is this a
            deal?" rendered with confidence right next to the price.
            Color follows sign (calm rose for negative, calm green for
            positive); never green-as-judgment, just data hygiene. */}
        {Number.isFinite(metrics.monthlyCashFlow) && (
          <div className="flex items-baseline gap-2 mt-2">
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
              <Currency value={metrics.monthlyCashFlow} signed />
            </span>
            <span
              className="text-[11.5px] tracking-tight"
              style={{ color: "var(--rv-t3)" }}
            >
              cash flow / mo
            </span>
            {scenarioActive && (
              <span
                className="ml-auto inline-flex items-center gap-1 rounded-full text-[10px] font-medium tracking-tight shrink-0"
                style={{
                  color:      "var(--rv-accent)",
                  background: "var(--rv-accent-dim)",
                  border:     "0.5px solid var(--rv-accent-border)",
                  padding:    "2px 7px",
                }}
                title="You've adjusted assumptions on this listing"
              >
                Your scenario
              </span>
            )}
          </div>
        )}

        {address && (
          <p className="text-[12.5px] mt-3 leading-snug" style={{ color: "var(--rv-t2)" }}>
            {address}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-[11px]" style={{ color: "var(--rv-t4)" }}>
          {result.beds      && <span>{result.beds} bd</span>}
          {result.baths     && <span>{result.baths} ba</span>}
          {result.sqft      && <span>{result.sqft.toLocaleString()} sqft</span>}
          {result.yearBuilt && <span>Built {result.yearBuilt}</span>}
          {result.siteName  && <span className="ml-auto" style={{ color: "var(--rv-t3)" }}>{result.siteName}</span>}
        </div>
      </div>

      {/* Notes */}
      {result.take && (
        <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--rv-border)" }}>
          <p
            className="text-[10px] uppercase tracking-widest font-medium mb-2"
            style={{ color: "var(--rv-t4)" }}
          >
            Notes
          </p>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--rv-t1)" }}>
            {result.take}
          </p>
        </div>
      )}

      {/* Three key metrics. Cards stay clean — trust signals live in the
          header source-stack + the provenance section below + the Sources
          drawer. When the user has tweaked any scenario input, a quiet
          "Your scenario" chip appears above the cards so the user knows
          they're looking at modeled-not-default numbers. */}
      <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--rv-border)" }}>
        {scenarioActive && (
          <div className="flex items-center justify-end mb-2">
            <button
              onClick={() => setOverrides({})}
              className="text-[11px] tracking-tight transition-colors"
              style={{ color: "var(--rv-t3)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)" }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t3)" }}
              title="Clear all overrides and return to the default analysis"
            >
              Reset scenario
            </button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <MetricCard
            label="Cash Flow"
            value={<Currency value={metrics.monthlyCashFlow} signed />}
            sub="per month"
            tone={metrics.monthlyCashFlow < 0 ? "neg" : "neutral"}
            delta={scenarioActive ? formatDelta(metrics.monthlyCashFlow, defaultMetrics.monthlyCashFlow, "currency") : null}
          />
          <MetricCard
            label="Cap Rate"
            value={fmtPct(metrics.capRate)}
            sub={`${fmtPct(metrics.cashOnCash)} CoC`}
            delta={scenarioActive ? formatDelta(metrics.capRate, defaultMetrics.capRate, "pct") : null}
          />
          <MetricCard
            label="DSCR"
            value={fmtNum(metrics.dscr)}
            sub={metrics.dscr >= 1.0 ? "covers debt service" : "below debt service"}
            delta={scenarioActive ? formatDelta(metrics.dscr, defaultMetrics.dscr, "ratio") : null}
          />
        </div>
        <BenchmarkLine
          metrics={metrics}
          averages={pipelineAverages}
        />
      </div>

      {/* Secondary metrics */}
      <div
        className="px-4 py-3 grid grid-cols-2 gap-y-3"
        style={{ borderBottom: "1px solid var(--rv-border)" }}
      >
        {[
          { label: "GRM",             value: `${fmtNum(metrics.grm, 1)}×` },
          { label: "Break-even occ.", value: fmtPct(metrics.breakEvenOccupancy) },
          { label: "Monthly rent",    value: `${fmtCurrency(inputs.monthlyRent)}/mo` },
          { label: "Cash invested",   value: fmtCurrency(metrics.totalCashInvested) },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--rv-t4)" }}>
              {label}
            </p>
            <p className="text-[13px] tabular-nums" style={{ color: "var(--rv-t2)" }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Adjust assumptions — scenario editor disclosure. Closed by
          default; opens to reveal 5 inline overrides + Advanced. Edits
          drive the metric cards above via live recompute (sub-ms). */}
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

      {/* Risk flags — neutral framing. We surface facts the user might miss
          ("foreclosure", "crawl space"), we don't tell them whether the deal
          is good or bad. */}
      {result.riskFlags.length > 0 && (
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--rv-border)" }}>
          <p
            className="text-[10px] uppercase tracking-widest font-medium mb-2"
            style={{ color: "var(--rv-t4)" }}
          >
            Worth knowing
          </p>
          <div className="flex flex-col gap-2">
            {result.riskFlags.map((flag, i) => <RiskFlag key={i} text={flag} />)}
          </div>
        </div>
      )}

      {/* Data provenance — every number here can be pointed at. */}
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--rv-border)" }}>
        <p
          className="text-[10px] uppercase tracking-widest font-medium mb-1"
          style={{ color: "var(--rv-t4)" }}
        >
          Where numbers come from
        </p>
        <ProvenanceRow label="List price"    value={fmtCurrency(result.listPrice)}                     field={provenance.listPrice}    siteName={result.siteName} />
        <ProvenanceRow label="Rent"          value={`${fmtCurrency(provenance.rent.value)}/mo`}        field={provenance.rent}         siteName={result.siteName} />
        <ProvenanceRow label="Interest rate" value={fmtPct(provenance.interestRate.value / 100)}       field={provenance.interestRate} siteName={result.siteName} fetchedAt={provenance.interestRate.fetchedAt} />
        <ProvenanceRow label="Property tax"  value={`${fmtCurrency(provenance.propertyTax.value)}/yr`} field={provenance.propertyTax}  siteName={result.siteName} />
        {provenance.hoa && (
          <ProvenanceRow label="HOA" value={`${fmtCurrency(provenance.hoa.value)}/mo`} field={provenance.hoa} siteName={result.siteName} />
        )}
        <ProvenanceRow label="Insurance"     value={`${fmtCurrency(provenance.insurance.value)}/yr`}   field={provenance.insurance}    siteName={result.siteName} />
      </div>
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

  // View toggle — "metrics" (default analysis surface) vs "chat" (Q&A).
  // Available only when there's a real result to chat about. Resets to
  // metrics whenever the panel mounts a fresh listing.
  const [viewMode, setViewMode] = useState<"metrics" | "chat">("metrics")
  const canChat = isReady && !!onChatSend && !!chatContext

  // Sources drawer — slides over the panel body listing every fact + origin.
  // Always closed on mount; opens via the header source-stack button.
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const result = state.phase === "ready" ? state.result : null

  // Esc behavior — layered. The drawer registers its own handler when
  // open (topmost), then chat-mode does, then the panel itself. Each
  // layer pops one step back: drawer → chat → metrics → close panel.
  // Chat-mode Esc returns to metrics view first; another Esc closes panel.
  useEscape(viewMode === "chat" && !sourcesOpen, () => setViewMode("metrics"))
  useEscape(viewMode !== "chat" && !sourcesOpen && !!onClose, () => onClose?.())

  return (
    <div
      className="flex flex-col h-full overflow-hidden panel-enter"
      style={{
        // Solid surface, matching the Pipeline detail rail. Was glass —
        // glass surfaces float OVER content (Chrome extension language).
        // App features have solid surfaces that ARE the content. The
        // analysis panel is a primary feature; it deserves to feel like
        // one, not like a popup over the browser.
        background:  "var(--rv-bg)",
        borderLeft:  "0.5px solid var(--rv-border)",
        minWidth:    0,
      }}
    >
      {/* Header — slim. Saved chip + seen hint on the left, primary
          actions (Save / Re-analyze / Open) + close on the right.
          The bigger 'action row in hero zone' restructure is paused
          pending the AI-agent decision. */}
      <div
        className="flex items-center justify-between px-3 shrink-0 gap-2"
        style={{
          height: 40,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {state.phase === "analyzing" && (
            <span className="flex gap-[3px] items-center ml-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-[4px] h-[4px] rounded-full dot-pulse"
                  style={{ background: "var(--rv-accent)", animationDelay: `${i * 0.18}s` }}
                />
              ))}
            </span>
          )}
          {isSaved && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10.5px] font-medium tracking-tight whitespace-nowrap shrink-0"
              style={{
                color: "var(--rv-accent)",
                background: "rgba(48,164,108,0.12)",
                border: "1px solid rgba(48,164,108,0.22)",
              }}
            >
              <BookmarkCheck size={10} strokeWidth={2.2} />
              {savedStage ?? "Saved"}
            </span>
          )}
          {seenHint && (
            <span
              className="inline-flex items-center gap-1 text-[10.5px] tracking-tight whitespace-nowrap shrink-0"
              style={{ color: "var(--rv-t4)" }}
              title="You've been here before"
            >
              <Eye size={10} strokeWidth={2} />
              {seenHint}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {canChat && (
            <HeaderIconBtn
              onClick={() => setViewMode((m) => m === "chat" ? "metrics" : "chat")}
              title={viewMode === "chat" ? "Show metrics" : "Ask about this listing"}
              active={viewMode === "chat"}
            >
              {viewMode === "chat"
                ? <BarChart3      size={13} strokeWidth={2} />
                : <MessagesSquare size={13} strokeWidth={2} />}
            </HeaderIconBtn>
          )}
          {canSave && (
            <HeaderIconBtn
              onClick={onSave}
              title={isSaved ? "Already saved" : "Save (⌘S)"}
              disabled={isSaved}
              active={isSaved}
            >
              {isSaved ? <BookmarkCheck size={13} strokeWidth={2} /> : <Bookmark size={13} strokeWidth={2} />}
            </HeaderIconBtn>
          )}
          {canReanalyze && (
            <HeaderIconBtn onClick={onReanalyze} title="Re-analyze">
              <RefreshCw size={12} strokeWidth={2} />
            </HeaderIconBtn>
          )}
          {isReady && onOpenSource && (
            <HeaderIconBtn onClick={onOpenSource} title="Open in browser">
              <ExternalLink size={12} strokeWidth={2} />
            </HeaderIconBtn>
          )}
          {onClose && (
            <HeaderIconBtn onClick={onClose} title="Close panel (Esc)">
              <X size={13} strokeWidth={2} />
            </HeaderIconBtn>
          )}
        </div>
      </div>

      {/* Body — chat takes over when toggled, otherwise standard state machine.
          Wrapped in a relative container so the Sources drawer can absolute-
          position itself flush against the right edge of the body. */}
      <div className="flex flex-col flex-1 min-h-0 relative">
        {viewMode === "chat" && canChat ? (
          <PanelChat
            messages={chatMessages}
            context={chatContext!}
            loading={chatLoading}
            onSend={onChatSend!}
            onClear={onChatClear}
            disabled={!isReady}
          />
        ) : (
          <>
            {state.phase === "empty"       && <EmptyPane     hasListing={state.hasListing} onAnalyze={onReanalyze ?? (() => {})} />}
            {state.phase === "analyzing"   && <AnalyzingPane />}
            {state.phase === "ready"       && <ResultPane    result={state.result} pipelineAverages={pipelineAverages} initialScenario={initialScenario} onScenarioChange={onScenarioChange} />}
            {state.phase === "error"       && <ErrorPane     message={state.message} onRetry={onReanalyze} onManualEntry={onStartManualEntry} />}
            {state.phase === "manual-entry" && (
              <ManualEntryPane
                initial={state.initial}
                onSubmit={(f) => onSubmitManualEntry?.(f)}
                onCancel={() => onCancelManualEntry?.()}
              />
            )}
          </>
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
