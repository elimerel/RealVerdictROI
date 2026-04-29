"use client"

import { useMemo } from "react"
import { formatCurrency } from "@/lib/calculations"
import type { YearProjection } from "@/lib/calculations"
import type { DistributionResult } from "@/lib/distribution-engine"

// ---------------------------------------------------------------------------
// Custom SVG projection chart
//
// Shows equity (solid area) and cumulative cash flow (dashed line) over
// the hold period, with optional confidence band shading around equity.
//
// Design principles:
//   • Dual-curve: equity (indigo area) + cash flow (emerald dashed line)
//   • Confidence band as very subtle filled polygon behind equity
//   • Minimal axes: only year ticks at bottom, currency at left
//   • Final year annotated with values
//   • No grid lines — a single zero reference line if cash flow goes negative
// ---------------------------------------------------------------------------

type ChartPoint = {
  year: number
  equity: number
  cashFlow: number
  equityLow: number
  equityHigh: number
}

function buildPoints(
  projection: YearProjection[],
  distribution?: DistributionResult | null,
): ChartPoint[] {
  return projection.map(row => {
    let low  = row.equityEnd
    let high = row.equityEnd

    if (distribution) {
      const irrBase  = Math.abs(distribution.irr.p50) || 0.001
      const irrLow   = distribution.irr.p10
      const irrHigh  = distribution.irr.p90
      const halfBand = row.equityEnd * Math.min(
        Math.abs(irrHigh - irrLow) / irrBase * 0.45,
        0.35,
      )
      low  = Math.max(0, row.equityEnd - halfBand)
      high = row.equityEnd + halfBand
    }

    return {
      year:     row.year,
      equity:   row.equityEnd,
      cashFlow: row.cumulativeCashFlow,
      equityLow:  low,
      equityHigh: high,
    }
  })
}

// Map a value to SVG Y coordinate
function makeScaleY(min: number, max: number, innerH: number, marginTop: number) {
  const range = max - min || 1
  return (v: number) => marginTop + innerH * (1 - (v - min) / range)
}

// Short currency formatter for axis labels
function fmtAxis(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

// Build an SVG path string from [x, y] pairs
function linePath(pts: [number, number][]): string {
  if (!pts.length) return ""
  const [first, ...rest] = pts
  return [
    `M ${first[0].toFixed(1)},${first[1].toFixed(1)}`,
    ...rest.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`),
  ].join(" ")
}

// Build a closed polygon path for an area fill
function areaPath(pts: [number, number][], baseY: number): string {
  if (!pts.length) return ""
  const [first, ...rest] = pts
  return [
    `M ${first[0].toFixed(1)},${baseY.toFixed(1)}`,
    `L ${first[0].toFixed(1)},${first[1].toFixed(1)}`,
    ...rest.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`),
    `L ${pts[pts.length - 1][0].toFixed(1)},${baseY.toFixed(1)}`,
    "Z",
  ].join(" ")
}

// Build confidence band polygon: top edge forward + bottom edge reverse
function bandPath(pts: ChartPoint[], toX: (y: number) => number, toY: (v: number) => number): string {
  if (!pts.length) return ""
  const topEdge: [number, number][] = pts.map(p => [toX(p.year), toY(p.equityHigh)])
  const botEdge: [number, number][] = [...pts].reverse().map(p => [toX(p.year), toY(p.equityLow)])
  const all = [...topEdge, ...botEdge]
  return all.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z"
}

export default function ProjectionAreaChart({
  projection,
  distribution,
}: {
  projection: YearProjection[]
  distribution?: DistributionResult | null
}) {
  const points = useMemo(
    () => buildPoints(projection, distribution),
    [projection, distribution],
  )

  if (!points.length) return null

  const hasBand   = distribution != null
  const W         = 440
  const H         = 220
  const MT        = 14
  const MB        = 28
  const ML        = 52
  const MR        = 16
  const innerW    = W - ML - MR
  const innerH    = H - MT - MB

  // Domains
  const allYValues = points.flatMap(p => [p.equity, p.equityLow, p.equityHigh, p.cashFlow])
  const domainMin  = Math.min(...allYValues, 0)
  const domainMax  = Math.max(...allYValues, 0)

  const toY  = makeScaleY(domainMin, domainMax, innerH, MT)
  const toX  = (year: number) => {
    const first = points[0].year
    const last  = points[points.length - 1].year
    return ML + ((year - first) / Math.max(last - first, 1)) * innerW
  }

  const zeroY = toY(0)
  const showZeroLine = domainMin < 0

  // Path data
  const equityPts:   [number, number][] = points.map(p => [toX(p.year), toY(p.equity)])
  const cashFlowPts: [number, number][] = points.map(p => [toX(p.year), toY(p.cashFlow)])

  // Y axis ticks (3 values)
  const tickValues = [domainMin, (domainMin + domainMax) / 2, domainMax].map(
    v => Math.round(v / 1000) * 1000,
  )

  const lastPt = points[points.length - 1]
  const lastX  = toX(lastPt.year)
  const uniqueId = `prj-${Math.random().toString(36).slice(2, 7)}`

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: W, display: "block" }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${uniqueId}-equity`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="oklch(0.62 0.22 265)" stopOpacity={0.30} />
            <stop offset="100%" stopColor="oklch(0.62 0.22 265)" stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id={`${uniqueId}-cf`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#22c55e" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Y axis tick labels */}
        {tickValues.map((v, i) => (
          <text
            key={i}
            x={ML - 6}
            y={toY(v) + 4}
            textAnchor="end"
            fontSize={9}
            fontFamily="var(--font-mono), monospace"
            fill="oklch(0.45 0.009 252)"
          >
            {fmtAxis(v)}
          </text>
        ))}

        {/* Zero line (only if chart goes negative) */}
        {showZeroLine && (
          <line
            x1={ML}
            y1={zeroY}
            x2={W - MR}
            y2={zeroY}
            stroke="oklch(1 0 0 / 10%)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* Confidence band */}
        {hasBand && (
          <path
            d={bandPath(points, toX, toY)}
            fill="oklch(0.62 0.22 265)"
            opacity={0.08}
          />
        )}

        {/* Cash flow area */}
        <path
          d={areaPath(cashFlowPts, zeroY)}
          fill={`url(#${uniqueId}-cf)`}
        />

        {/* Cash flow line */}
        <path
          d={linePath(cashFlowPts)}
          fill="none"
          stroke="#22c55e"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          strokeLinecap="round"
        />

        {/* Equity area */}
        <path
          d={areaPath(equityPts, toY(domainMin))}
          fill={`url(#${uniqueId}-equity)`}
        />

        {/* Equity line */}
        <path
          d={linePath(equityPts)}
          fill="none"
          stroke="oklch(0.62 0.22 265)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Year labels at bottom */}
        {points
          .filter((_, i) => i === 0 || i === points.length - 1 || points.length <= 6 || i % Math.ceil(points.length / 5) === 0)
          .map(p => (
            <text
              key={p.year}
              x={toX(p.year)}
              y={H - 4}
              textAnchor="middle"
              fontSize={9}
              fontFamily="var(--font-sans), sans-serif"
              fill="oklch(0.50 0.009 252)"
            >
              Y{p.year}
            </text>
          ))}

        {/* Terminal equity dot + annotation */}
        <circle
          cx={lastX}
          cy={toY(lastPt.equity)}
          r={3.5}
          fill="oklch(0.62 0.22 265)"
        />
        <text
          x={lastX - 5}
          y={toY(lastPt.equity) - 7}
          textAnchor="end"
          fontSize={9}
          fontFamily="var(--font-mono), monospace"
          fill="oklch(0.78 0.15 265)"
          fontWeight="600"
        >
          {fmtAxis(lastPt.equity)}
        </text>
        <text
          x={lastX - 5}
          y={toY(lastPt.equity) - 17}
          textAnchor="end"
          fontSize={8}
          fontFamily="var(--font-sans), sans-serif"
          fill="oklch(0.50 0.009 252)"
        >
          equity
        </text>

        {/* Terminal cash flow dot */}
        <circle
          cx={lastX}
          cy={toY(lastPt.cashFlow)}
          r={3}
          fill="#22c55e"
        />

        {/* Legend */}
        <g transform={`translate(${ML + 6}, ${MT + 4})`}>
          <line x1="0" y1="5" x2="16" y2="5" stroke="oklch(0.62 0.22 265)" strokeWidth={2} />
          <text x="20" y="8.5" fontSize={9} fontFamily="var(--font-sans), sans-serif" fill="oklch(0.55 0.007 252)">
            Equity
          </text>
          <line x1="52" y1="5" x2="68" y2="5" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x="72" y="8.5" fontSize={9} fontFamily="var(--font-sans), sans-serif" fill="oklch(0.55 0.007 252)">
            Cumulative CF
          </text>
          {hasBand && (
            <>
              <rect x="140" y="1" width="12" height="8" rx="2" fill="oklch(0.62 0.22 265)" opacity={0.15} />
              <text x="156" y="8.5" fontSize={9} fontFamily="var(--font-sans), sans-serif" fill="oklch(0.55 0.007 252)">
                Confidence band
              </text>
            </>
          )}
        </g>
      </svg>
    </div>
  )
}
