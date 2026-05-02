"use client"

import { useState, useEffect, useRef } from "react"
import type { PanelPayload, PanelResult, SourceField } from "@/lib/electron"

// ── Source chip ───────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  listing:     "Listing",
  hud_fmr:     "HUD FMR",
  fred:        "FRED",
  ai_estimate: "AI est.",
  default:     "Default",
  user:        "Edited",
}

function SourceChip({ field }: { field: SourceField }) {
  const label = SOURCE_LABELS[field.source] ?? field.source
  const conf  = field.confidence

  const cls =
    conf === "high"   ? "bg-[var(--src-hi-bg)] text-[var(--src-hi-fg)]" :
    conf === "medium" ? "bg-[var(--src-md-bg)] text-[var(--src-md-fg)]" :
                        "bg-[var(--src-lo-bg)] text-[var(--src-lo-fg)]"

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${cls}`}
      title={field.label}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: "currentColor", opacity: 0.8 }}
      />
      {label}
    </span>
  )
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone: "good" | "warn" | "bad" | "neutral"
}) {
  const valueColor =
    tone === "good"    ? "text-[var(--good)]" :
    tone === "warn"    ? "text-[var(--warn)]" :
    tone === "bad"     ? "text-[var(--bad)]"  :
                         "text-[var(--p-t1)]"

  return (
    <div className="flex flex-col gap-1 bg-[var(--p-surface)] rounded-xl p-3 border border-[var(--p-border)]">
      <span className="text-[11px] text-[var(--p-t3)] uppercase tracking-wide font-medium">{label}</span>
      <span className={`text-xl font-semibold font-mono-nums tabular-nums ${valueColor}`}>{value}</span>
      {sub && <span className="text-[11px] text-[var(--p-t3)] leading-tight">{sub}</span>}
    </div>
  )
}

// ── Risk flag ─────────────────────────────────────────────────────────────────

function RiskFlag({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-[12px] text-[var(--p-t2)] leading-snug">
      <span className="mt-0.5 text-[var(--warn)] shrink-0">⚠</span>
      <span>{text}</span>
    </div>
  )
}

// ── Provenance row ────────────────────────────────────────────────────────────

function ProvenanceRow({
  label,
  value,
  field,
}: {
  label: string
  value: string
  field: SourceField
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-[var(--p-border-sub)] last:border-0">
      <span className="text-[12px] text-[var(--p-t3)] shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12px] text-[var(--p-t2)] font-mono-nums truncate">{value}</span>
        <SourceChip field={field} />
      </div>
    </div>
  )
}

// ── Tone helper ───────────────────────────────────────────────────────────────

function cashFlowTone(v: number): "good" | "warn" | "bad" | "neutral" {
  if (v >= 300) return "good"
  if (v >= 0)   return "warn"
  return "bad"
}

function capRateTone(v: number): "good" | "warn" | "bad" | "neutral" {
  if (v >= 0.07) return "good"
  if (v >= 0.05) return "warn"
  return "bad"
}

function dscrTone(v: number): "good" | "warn" | "bad" | "neutral" {
  if (v >= 1.25) return "good"
  if (v >= 1.0)  return "warn"
  return "bad"
}

// ── Analyzing state ───────────────────────────────────────────────────────────

function AnalyzingPane() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 flex-1 px-6">
      <div
        className="w-10 h-10 rounded-full ring-pulse"
        style={{
          border: "2px solid var(--accent-border)",
          background: "var(--accent-dim)",
        }}
      />
      <div className="text-center">
        <p className="text-[14px] font-medium text-[var(--p-t1)]">Analyzing listing…</p>
        <p className="text-[12px] text-[var(--p-t3)] mt-1">Pulling rates, rent data, and crunching the math</p>
      </div>
    </div>
  )
}

// ── Error state ───────────────────────────────────────────────────────────────

function ErrorPane({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 flex-1 px-6 text-center">
      <span className="text-3xl">⚠</span>
      <p className="text-[13px] text-[var(--p-t2)]">{message}</p>
    </div>
  )
}

// ── Result pane ───────────────────────────────────────────────────────────────

function ResultPane({ result }: { result: PanelResult }) {
  const { metrics, inputs, provenance } = result

  const fmtCurrency = (n: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
  const fmtPct = (n: number | null) =>
    n == null ? "—" : `${(n * 100).toFixed(2)}%`
  const fmtNum  = (n: number | null, dec = 2) =>
    n == null ? "—" : n.toFixed(dec)
  const fmtMonthly = (n: number) =>
    `${n >= 0 ? "+" : ""}${fmtCurrency(n)}/mo`

  const address = [result.address, result.city, result.state].filter(Boolean).join(", ")

  return (
    <div className="flex flex-col gap-0 overflow-y-auto panel-scroll flex-1 min-h-0">

      {/* ── Property identity ─────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--p-border)]">
        {result.listPrice && (
          <p className="text-2xl font-semibold text-[var(--p-t1)] font-mono-nums leading-tight">
            {fmtCurrency(result.listPrice)}
          </p>
        )}
        {address && (
          <p className="text-[12px] text-[var(--p-t3)] mt-0.5 leading-snug">{address}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-[11px] text-[var(--p-t3)]">
          {result.beds   && <span>{result.beds}bd</span>}
          {result.baths  && <span>{result.baths}ba</span>}
          {result.sqft   && <span>{result.sqft.toLocaleString()} sqft</span>}
          {result.yearBuilt && <span>Built {result.yearBuilt}</span>}
        </div>
      </div>

      {/* ── AI take ───────────────────────────────────────────────── */}
      {result.take && (
        <div className="px-4 py-4 border-b border-[var(--p-border)]">
          <p className="text-[11px] text-[var(--p-t3)] uppercase tracking-wide font-medium mb-2">AI Take</p>
          <p className="text-[13px] text-[var(--p-t1)] leading-relaxed">{result.take}</p>
        </div>
      )}

      {/* ── Three key metrics ─────────────────────────────────────── */}
      <div className="px-4 py-4 border-b border-[var(--p-border)]">
        <div className="grid grid-cols-3 gap-2">
          <MetricCard
            label="Cash Flow"
            value={fmtMonthly(metrics.monthlyCashFlow)}
            sub="after all expenses"
            tone={cashFlowTone(metrics.monthlyCashFlow)}
          />
          <MetricCard
            label="Cap Rate"
            value={fmtPct(metrics.capRate)}
            sub={`${fmtPct(metrics.cashOnCash)} CoC`}
            tone={capRateTone(metrics.capRate)}
          />
          <MetricCard
            label="DSCR"
            value={fmtNum(metrics.dscr)}
            sub={metrics.dscr >= 1.0 ? "covers debt" : "debt risk"}
            tone={dscrTone(metrics.dscr)}
          />
        </div>
      </div>

      {/* ── More metrics row ──────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-[var(--p-border)] grid grid-cols-2 gap-y-2">
        <div>
          <p className="text-[10px] text-[var(--p-t3)] uppercase tracking-wide">GRM</p>
          <p className="text-[13px] text-[var(--p-t2)] font-mono-nums">{fmtNum(metrics.grm, 1)}×</p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--p-t3)] uppercase tracking-wide">Break-even occ.</p>
          <p className="text-[13px] text-[var(--p-t2)] font-mono-nums">{fmtPct(metrics.breakEvenOccupancy)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--p-t3)] uppercase tracking-wide">Monthly rent</p>
          <p className="text-[13px] text-[var(--p-t2)] font-mono-nums">{fmtCurrency(inputs.monthlyRent)}/mo</p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--p-t3)] uppercase tracking-wide">Cash invested</p>
          <p className="text-[13px] text-[var(--p-t2)] font-mono-nums">{fmtCurrency(metrics.totalCashInvested)}</p>
        </div>
      </div>

      {/* ── Risk flags ────────────────────────────────────────────── */}
      {result.riskFlags.length > 0 && (
        <div className="px-4 py-3 border-b border-[var(--p-border)]">
          <p className="text-[11px] text-[var(--p-t3)] uppercase tracking-wide font-medium mb-2">Watch Out</p>
          <div className="flex flex-col gap-2">
            {result.riskFlags.map((flag, i) => (
              <RiskFlag key={i} text={flag} />
            ))}
          </div>
        </div>
      )}

      {/* ── Data provenance ───────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-[var(--p-border)]">
        <p className="text-[11px] text-[var(--p-t3)] uppercase tracking-wide font-medium mb-1">Where the numbers came from</p>
        <ProvenanceRow label="List price"    value={fmtCurrency(result.listPrice)}           field={provenance.listPrice}    />
        <ProvenanceRow label="Rent"          value={`${fmtCurrency(provenance.rent.value)}/mo`} field={provenance.rent}      />
        <ProvenanceRow label="Interest rate" value={fmtPct(provenance.interestRate.value / 100)} field={provenance.interestRate} />
        <ProvenanceRow label="Property tax"  value={`${fmtCurrency(provenance.propertyTax.value)}/yr`} field={provenance.propertyTax} />
        {provenance.hoa && (
          <ProvenanceRow label="HOA" value={`${fmtCurrency(provenance.hoa.value)}/mo`} field={provenance.hoa} />
        )}
        <ProvenanceRow label="Insurance"     value={`${fmtCurrency(provenance.insurance.value)}/yr`} field={provenance.insurance} />
      </div>

      {/* ── Site name ─────────────────────────────────────────────── */}
      {result.siteName && (
        <div className="px-4 py-3">
          <p className="text-[10px] text-[var(--p-t4)]">
            Data sourced from {result.siteName}
            {provenance.interestRate.fetchedAt &&
              ` · Rate as of ${new Date(provenance.interestRate.fetchedAt).toLocaleDateString()}`}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

type PanelState =
  | { phase: "hidden" }
  | { phase: "analyzing" }
  | { phase: "ready";  result: PanelResult }
  | { phase: "error";  message: string }

export default function Panel() {
  const [state, setState] = useState<PanelState>({ phase: "hidden" })
  const [visible, setVisible]   = useState(false)
  const [exiting, setExiting]   = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setExiting(false)
    setVisible(true)
  }

  const hide = () => {
    setExiting(true)
    hideTimer.current = setTimeout(() => {
      setVisible(false)
      setExiting(false)
      setState({ phase: "hidden" })
    }, 220)
  }

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    const offAnalyzing = api.onPanelAnalyzing(() => {
      setState({ phase: "analyzing" })
      show()
    })

    const offReady = api.onPanelReady((payload: PanelPayload) => {
      if (payload.ok) {
        setState({ phase: "ready", result: payload as PanelResult })
      } else {
        setState({ phase: "error", message: payload.message })
      }
      show()
    })

    const offHide = api.onPanelHide(() => {
      hide()
    })

    const offError = api.onPanelError((message: string) => {
      setState({ phase: "error", message })
      show()
    })

    return () => {
      offAnalyzing()
      offReady()
      offHide()
      offError()
    }
  }, [])

  if (!visible) return null

  return (
    <div
      className={`flex flex-col h-full bg-[var(--p-bg)] border-l border-[var(--p-border)] overflow-hidden ${
        exiting ? "panel-exit" : "panel-enter"
      }`}
      style={{ minWidth: 0 }}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-[var(--p-border)] shrink-0"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--p-t1)] tracking-tight">RealVerdict</span>
          {state.phase === "analyzing" && (
            <span className="flex gap-0.5 items-center">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1 h-1 rounded-full bg-[var(--accent)] dot-pulse"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </span>
          )}
        </div>
        <button
          onClick={hide}
          className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--p-t3)] hover:text-[var(--p-t1)] hover:bg-[var(--p-raised)] transition-colors"
          aria-label="Close panel"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0">
        {state.phase === "analyzing" && <AnalyzingPane />}
        {state.phase === "ready"     && <ResultPane result={state.result} />}
        {state.phase === "error"     && <ErrorPane message={state.message} />}
      </div>
    </div>
  )
}
