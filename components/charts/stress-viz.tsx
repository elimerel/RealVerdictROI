"use client"

import { useMemo } from "react"
import { formatCurrency } from "@/lib/calculations"
import type { DealAnalysis } from "@/lib/calculations"
import type { DistributionResult } from "@/lib/distribution-engine"
import { STRESS_SCENARIOS } from "@/lib/stress-scenarios"
import { analyseDeal, sanitiseInputs } from "@/lib/calculations"

// ---------------------------------------------------------------------------
// Custom SVG stress-test visualization
//
// Horizontal bar chart showing cash flow under each shock scenario.
// Design choices:
//   • Single zero reference line, prominently visible
//   • Bars colored along a spectrum: bright green → amber → red
//   • Base scenario row distinguished with a subtle highlight and bolder text
//   • Value labels rendered directly on bars (or just past the end)
//   • No axes, no grid lines — only the zero line and the bars
// ---------------------------------------------------------------------------

type ScenarioResult = {
  label: string
  cashFlow: number
  isBase: boolean
}

function buildScenarios(
  baseInputs: DealAnalysis["inputs"],
  baseAnalysis: DealAnalysis,
  distribution?: DistributionResult,
): ScenarioResult[] {
  const results: ScenarioResult[] = [
    { label: "Base case", cashFlow: baseAnalysis.monthlyCashFlow, isBase: true },
  ]

  if (distribution) {
    for (const ns of distribution.namedScenarios) {
      if (!ns.analysis) continue
      results.push({
        label: shortenLabel(ns.label),
        cashFlow: ns.analysis.monthlyCashFlow,
        isBase: false,
      })
    }
  } else {
    for (const s of STRESS_SCENARIOS) {
      try {
        const a = analyseDeal(sanitiseInputs(s.apply(baseInputs)))
        results.push({ label: shortenLabel(s.label), cashFlow: a.monthlyCashFlow, isBase: false })
      } catch { /* skip */ }
    }
  }

  // Sort non-base rows by cash flow descending so best outcomes read top to bottom
  const [base, ...rest] = results
  rest.sort((a, b) => b.cashFlow - a.cashFlow)
  return [base, ...rest]
}

function shortenLabel(label: string): string {
  return label
    .replace(/vacancy rate/gi, "Vacancy")
    .replace(/interest rate/gi, "Rate")
    .replace(/rent/gi, "Rent")
    .replace(/expenses/gi, "Expenses")
    .replace(/\+\d+\s*%|\+\d+\s*pp/gi, "↑")
    .replace(/−\d+\s*%|−\d+\s*pp|-\d+\s*%/gi, "↓")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 22)
}

function cashFlowColor(cf: number): string {
  if (cf >= 400)  return "#22c55e"
  if (cf >= 200)  return "#4ade80"
  if (cf >= 50)   return "#86efac"
  if (cf >= 0)    return "#bbf7d0"
  if (cf >= -100) return "#fde68a"
  if (cf >= -300) return "#fca5a5"
  return "#ef4444"
}

export default function StressViz({
  baseInputs,
  baseAnalysis,
  distribution,
}: {
  baseInputs: DealAnalysis["inputs"]
  baseAnalysis: DealAnalysis
  distribution?: DistributionResult | null
}) {
  const scenarios = useMemo(
    () => buildScenarios(baseInputs, baseAnalysis, distribution ?? undefined),
    [baseInputs, baseAnalysis, distribution],
  )

  // Layout
  const ROW_H    = 28
  const GAP      = 4
  const LABEL_W  = 100
  const VALUE_W  = 64
  const BAR_AREA = 220
  const W        = LABEL_W + BAR_AREA + VALUE_W + 8
  const H        = scenarios.length * (ROW_H + GAP) + 16

  const maxAbs = Math.max(...scenarios.map(s => Math.abs(s.cashFlow)), 1)
  const scaleX = (v: number) => (Math.abs(v) / maxAbs) * (BAR_AREA * 0.85)
  const zeroX  = LABEL_W + BAR_AREA * 0.5 // zero is at center

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: W, display: "block" }}
        aria-hidden="true"
      >
        {/* Zero reference line */}
        <line
          x1={zeroX}
          y1={0}
          x2={zeroX}
          y2={H}
          stroke="oklch(1 0 0 / 14%)"
          strokeWidth={1}
        />

        {/* Zero label */}
        <text
          x={zeroX}
          y={H - 2}
          textAnchor="middle"
          fontSize={8}
          fontFamily="var(--font-mono), monospace"
          fill="oklch(0.45 0.009 252)"
        >
          $0
        </text>

        {scenarios.map((s, i) => {
          const rowY     = i * (ROW_H + GAP) + 4
          const barH     = ROW_H - 6
          const barY     = rowY + 3
          const barLen   = scaleX(s.cashFlow)
          const positive = s.cashFlow >= 0
          const barX     = positive ? zeroX : zeroX - barLen
          const color    = cashFlowColor(s.cashFlow)
          const absStr   = formatCurrency(Math.abs(s.cashFlow), 0)
          const sign     = positive ? "+" : "−"

          return (
            <g key={s.label}>
              {/* Row highlight for base case */}
              {s.isBase && (
                <rect
                  x={LABEL_W - 4}
                  y={rowY}
                  width={BAR_AREA + VALUE_W + 12}
                  height={ROW_H - 2}
                  rx={4}
                  fill="oklch(1 0 0 / 4%)"
                />
              )}

              {/* Label */}
              <text
                x={LABEL_W - 8}
                y={rowY + ROW_H / 2 + 4}
                textAnchor="end"
                fontSize={10}
                fontFamily="var(--font-sans), sans-serif"
                fill={s.isBase ? "oklch(0.78 0.007 252)" : "oklch(0.55 0.007 252)"}
                fontWeight={s.isBase ? "600" : "400"}
              >
                {s.label}
              </text>

              {/* Bar */}
              <rect
                x={barX}
                y={barY}
                width={Math.max(2, barLen)}
                height={barH}
                rx={3}
                fill={color}
                opacity={s.isBase ? 0.95 : 0.72}
              />

              {/* Value label — right of bar for positive, left for negative */}
              <text
                x={positive ? zeroX + barLen + 5 : zeroX - barLen - 5}
                y={rowY + ROW_H / 2 + 4}
                textAnchor={positive ? "start" : "end"}
                fontSize={10}
                fontFamily="var(--font-mono), monospace"
                fill={color}
                fontWeight={s.isBase ? "700" : "500"}
                opacity={s.isBase ? 1 : 0.85}
              >
                {sign}{absStr}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
