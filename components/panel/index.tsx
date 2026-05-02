"use client"

import { useState, useEffect, useRef } from "react"
import type { PanelPayload, PanelResult, SourceField } from "@/lib/electron"

// ── Source icons ──────────────────────────────────────────────────────────────

const SOURCE_META: Record<string, { label: string; icon: string }> = {
  listing:     { label: "From listing page",        icon: "🏠" },
  hud_fmr:     { label: "HUD Fair Market Rent",     icon: "🏛" },
  fred:        { label: "Federal Reserve (FRED)",   icon: "🏦" },
  ai_estimate: { label: "AI estimate",              icon: "✦" },
  default:     { label: "Industry default",         icon: "◎" },
  user:        { label: "Edited by you",            icon: "✎" },
}

function SourceDot({ field }: { field: SourceField }) {
  const [hover, setHover] = useState(false)
  const meta = SOURCE_META[field.source] ?? { label: field.source, icon: "?" }

  const dotColor =
    field.confidence === "high"   ? "var(--rv-good)" :
    field.confidence === "medium" ? "var(--rv-warn)" :
                                    "var(--rv-bad)"

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        className="w-[7px] h-[7px] rounded-full cursor-default shrink-0"
        style={{ background: dotColor, opacity: hover ? 1 : 0.7 }}
      />
      {hover && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50
                     flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] whitespace-nowrap pointer-events-none"
          style={{
            background: "var(--rv-overlay)",
            border: "1px solid var(--rv-border-mid)",
            color: "var(--rv-t2)",
          }}
        >
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
        </span>
      )}
    </span>
  )
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, tone,
}: {
  label: string
  value: string
  sub?: string
  tone: "good" | "warn" | "bad" | "neutral"
}) {
  const valueColor =
    tone === "good"    ? "var(--rv-good)" :
    tone === "warn"    ? "var(--rv-warn)" :
    tone === "bad"     ? "var(--rv-bad)"  :
                         "var(--rv-t1)"

  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl p-3"
      style={{
        background: "var(--rv-raised)",
        border: "1px solid var(--rv-border)",
      }}
    >
      <span
        className="text-[10px] uppercase tracking-widest font-medium"
        style={{ color: "var(--rv-t3)" }}
      >
        {label}
      </span>
      <span
        className="text-[20px] font-semibold tabular-nums leading-none"
        style={{ color: valueColor, fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[11px] leading-none" style={{ color: "var(--rv-t4)" }}>
          {sub}
        </span>
      )}
    </div>
  )
}

// ── Risk flag ─────────────────────────────────────────────────────────────────

function RiskFlag({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-[12px] leading-snug" style={{ color: "var(--rv-t2)" }}>
      <span className="mt-px shrink-0 text-[11px]" style={{ color: "var(--rv-warn)" }}>▲</span>
      <span>{text}</span>
    </div>
  )
}

// ── Provenance row ────────────────────────────────────────────────────────────

function ProvenanceRow({ label, value, field }: { label: string; value: string; field: SourceField }) {
  return (
    <div
      className="flex items-center justify-between gap-3 py-2 last:border-0"
      style={{ borderBottom: "1px solid var(--rv-border)" }}
    >
      <span className="text-[12px] shrink-0" style={{ color: "var(--rv-t3)" }}>{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12px] tabular-nums truncate" style={{ color: "var(--rv-t2)" }}>{value}</span>
        <SourceDot field={field} />
      </div>
    </div>
  )
}

// ── Tone helpers ──────────────────────────────────────────────────────────────

const cashFlowTone = (v: number) => v >= 300 ? "good" : v >= 0 ? "warn" : "bad"
const capRateTone  = (v: number) => v >= 0.07 ? "good" : v >= 0.05 ? "warn" : "bad"
const dscrTone     = (v: number) => v >= 1.25 ? "good" : v >= 1.0  ? "warn" : "bad"

// ── Analyzing ─────────────────────────────────────────────────────────────────

function AnalyzingPane() {
  return (
    <div className="flex flex-col items-center justify-center gap-5 flex-1 px-6">
      <div
        className="w-9 h-9 rounded-full ring-pulse"
        style={{
          border: "1.5px solid var(--rv-accent-border)",
          background: "var(--rv-accent-dim)",
        }}
      />
      <div className="text-center">
        <p className="text-[13px] font-medium" style={{ color: "var(--rv-t1)" }}>
          Analyzing listing
        </p>
        <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--rv-t3)" }}>
          Pulling rates, rent data,<br />and crunching the math
        </p>
      </div>
    </div>
  )
}

// ── Error ─────────────────────────────────────────────────────────────────────

function ErrorPane({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 flex-1 px-6 text-center">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-[16px]"
        style={{ background: "var(--rv-bad-bg)", color: "var(--rv-bad)" }}
      >
        !
      </div>
      <p className="text-[12px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>{message}</p>
    </div>
  )
}

// ── Result ────────────────────────────────────────────────────────────────────

function ResultPane({ result }: { result: PanelResult }) {
  const { metrics, inputs, provenance } = result

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

      {/* Property identity */}
      <div className="px-4 pt-4 pb-4" style={{ borderBottom: "1px solid var(--rv-border)" }}>
        {result.listPrice && (
          <p
            className="text-[22px] font-semibold leading-tight tabular-nums"
            style={{ color: "var(--rv-t1)" }}
          >
            {fmtCurrency(result.listPrice)}
          </p>
        )}
        {address && (
          <p className="text-[12px] mt-1 leading-snug" style={{ color: "var(--rv-t3)" }}>
            {address}
          </p>
        )}
        <div className="flex items-center gap-3 mt-2 text-[11px]" style={{ color: "var(--rv-t4)" }}>
          {result.beds      && <span>{result.beds} bd</span>}
          {result.baths     && <span>{result.baths} ba</span>}
          {result.sqft      && <span>{result.sqft.toLocaleString()} sqft</span>}
          {result.yearBuilt && <span>Built {result.yearBuilt}</span>}
        </div>
      </div>

      {/* AI take */}
      {result.take && (
        <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--rv-border)" }}>
          <p
            className="text-[10px] uppercase tracking-widest font-medium mb-2"
            style={{ color: "var(--rv-t4)" }}
          >
            AI Take
          </p>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--rv-t1)" }}>
            {result.take}
          </p>
        </div>
      )}

      {/* Three key metrics */}
      <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--rv-border)" }}>
        <div className="grid grid-cols-3 gap-2">
          <MetricCard
            label="Cash Flow"
            value={fmtMonthly(metrics.monthlyCashFlow)}
            sub="per month"
            tone={cashFlowTone(metrics.monthlyCashFlow) as any}
          />
          <MetricCard
            label="Cap Rate"
            value={fmtPct(metrics.capRate)}
            sub={`${fmtPct(metrics.cashOnCash)} CoC`}
            tone={capRateTone(metrics.capRate) as any}
          />
          <MetricCard
            label="DSCR"
            value={fmtNum(metrics.dscr)}
            sub={metrics.dscr >= 1.0 ? "covers debt" : "debt risk"}
            tone={dscrTone(metrics.dscr) as any}
          />
        </div>
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

      {/* Risk flags */}
      {result.riskFlags.length > 0 && (
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--rv-border)" }}>
          <p
            className="text-[10px] uppercase tracking-widest font-medium mb-2"
            style={{ color: "var(--rv-t4)" }}
          >
            Watch Out
          </p>
          <div className="flex flex-col gap-2">
            {result.riskFlags.map((flag, i) => <RiskFlag key={i} text={flag} />)}
          </div>
        </div>
      )}

      {/* Data provenance */}
      <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--rv-border)" }}>
        <p
          className="text-[10px] uppercase tracking-widest font-medium mb-1"
          style={{ color: "var(--rv-t4)" }}
        >
          Where numbers come from
        </p>
        <ProvenanceRow label="List price"    value={fmtCurrency(result.listPrice)}                      field={provenance.listPrice}    />
        <ProvenanceRow label="Rent"          value={`${fmtCurrency(provenance.rent.value)}/mo`}         field={provenance.rent}         />
        <ProvenanceRow label="Interest rate" value={fmtPct(provenance.interestRate.value / 100)}        field={provenance.interestRate} />
        <ProvenanceRow label="Property tax"  value={`${fmtCurrency(provenance.propertyTax.value)}/yr`} field={provenance.propertyTax}  />
        {provenance.hoa && (
          <ProvenanceRow label="HOA" value={`${fmtCurrency(provenance.hoa.value)}/mo`} field={provenance.hoa} />
        )}
        <ProvenanceRow label="Insurance"     value={`${fmtCurrency(provenance.insurance.value)}/yr`}   field={provenance.insurance}    />
      </div>

      {/* Footer */}
      {result.siteName && (
        <div className="px-4 py-3">
          <p className="text-[10px]" style={{ color: "var(--rv-t4)" }}>
            Data from {result.siteName}
            {provenance.interestRate.fetchedAt &&
              ` · Rate ${new Date(provenance.interestRate.fetchedAt).toLocaleDateString()}`}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

type PanelState =
  | { phase: "hidden" }
  | { phase: "analyzing" }
  | { phase: "ready"; result: PanelResult }
  | { phase: "error"; message: string }

export default function Panel() {
  const [state,   setState]   = useState<PanelState>({ phase: "hidden" })
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
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
    }, 200)
  }

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    const offAnalyzing = api.onPanelAnalyzing(() => { setState({ phase: "analyzing" }); show() })
    const offReady = api.onPanelReady((payload: PanelPayload) => {
      if (payload.ok) setState({ phase: "ready", result: payload as PanelResult })
      else setState({ phase: "error", message: (payload as any).message })
      show()
    })
    const offHide  = api.onPanelHide(() => hide())
    const offError = api.onPanelError((message: string) => { setState({ phase: "error", message }); show() })

    return () => { offAnalyzing(); offReady(); offHide(); offError() }
  }, [])

  if (!visible) return null

  return (
    <div
      className={`flex flex-col h-full overflow-hidden ${exiting ? "panel-exit" : "panel-enter"}`}
      style={{
        background: "var(--rv-glass)",
        borderLeft: "1px solid var(--rv-border)",
        minWidth: 0,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{
          height: 40,
          borderBottom: "1px solid var(--rv-border)",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold tracking-tight" style={{ color: "var(--rv-t1)" }}>
            RealVerdict
          </span>
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
        </div>
        <button
          onClick={hide}
          className="w-6 h-6 flex items-center justify-center rounded-md transition-colors"
          style={{ color: "var(--rv-t3)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--rv-t1)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--rv-t3)")}
          aria-label="Close"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 min-h-0">
        {state.phase === "analyzing" && <AnalyzingPane />}
        {state.phase === "ready"     && <ResultPane result={state.result} />}
        {state.phase === "error"     && <ErrorPane message={state.message} />}
      </div>
    </div>
  )
}
