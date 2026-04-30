"use client"

import { useMemo } from "react"
import { formatCurrency } from "@/lib/calculations"
import type { DealAnalysis } from "@/lib/calculations"

// ---------------------------------------------------------------------------
// Custom SVG waterfall chart
//
// Built from scratch instead of using recharts' invisible-base-bar trick,
// which always looks mechanical. This gives us:
//   • Connector lines between bars showing flow
//   • Inline value labels on each bar
//   • Full color control without workarounds
//   • Clean negative/positive territory
// ---------------------------------------------------------------------------

type WaterfallItem = {
  label: string
  amount: number   // signed — negative for expenses
  runningTotal: number  // after this item
  isTotal: boolean
  isIncome: boolean
}

function buildItems(analysis: DealAnalysis): WaterfallItem[] {
  const { inputs } = analysis
  const grossRent  = inputs.monthlyRent + inputs.otherMonthlyIncome

  const steps: Array<{ label: string; amount: number; isIncome?: boolean }> = [
    { label: "Rent",       amount: grossRent,                                              isIncome: true },
    { label: "Vacancy",    amount: -grossRent * (inputs.vacancyRatePercent / 100) },
    { label: "Tax",        amount: -(inputs.annualPropertyTax / 12) },
    { label: "Insurance",  amount: -(inputs.annualInsurance / 12) },
    ...(inputs.monthlyHOA > 0
      ? [{ label: "HOA",   amount: -inputs.monthlyHOA }]
      : []),
    { label: "Maint.",     amount: -(grossRent * (inputs.maintenancePercent / 100)) },
    ...(inputs.propertyManagementPercent > 0
      ? [{ label: "Mgmt", amount: -(grossRent * (inputs.propertyManagementPercent / 100)) }]
      : []),
    ...(inputs.capexReservePercent > 0
      ? [{ label: "CapEx", amount: -(grossRent * (inputs.capexReservePercent / 100)) }]
      : []),
    ...(analysis.monthlyMortgagePayment > 0
      ? [{ label: "Mortgage", amount: -analysis.monthlyMortgagePayment }]
      : []),
  ].filter(s => Math.abs(s.amount) > 0.5)

  const items: WaterfallItem[] = []
  let running = 0

  for (const s of steps) {
    running += s.amount
    items.push({
      label: s.label,
      amount: s.amount,
      runningTotal: running,
      isTotal: false,
      isIncome: !!s.isIncome,
    })
  }

  // Final "Net" total bar starts from 0
  items.push({
    label: "Net",
    amount: running,
    runningTotal: running,
    isTotal: true,
    isIncome: false,
  })

  return items
}

function barColor(item: WaterfallItem): { fill: string; text: string } {
  if (item.isTotal) {
    return item.amount >= 0
      ? { fill: "#22c55e", text: "#22c55e" }
      : { fill: "#ef4444", text: "#ef4444" }
  }
  if (item.isIncome) {
    return { fill: "oklch(0.62 0.22 265)", text: "oklch(0.78 0.15 265)" }
  }
  return { fill: "oklch(0.30 0.014 252)", text: "oklch(0.55 0.009 252)" }
}

export default function WaterfallChart({ analysis }: { analysis: DealAnalysis }) {
  const items = useMemo(() => buildItems(analysis), [analysis])

  // Layout constants
  const W          = 440
  // Reserve more bottom margin when many bars force rotated labels so the
  // rotated text doesn't collide with the bars or the next module below.
  const barCount   = items.length
  const rotateLabels = barCount > 6
  const H          = rotateLabels ? 240 : 220
  const MARGIN     = { top: 12, right: 8, bottom: rotateLabels ? 48 : 28, left: 12 }
  const innerW     = W - MARGIN.left - MARGIN.right
  const innerH     = H - MARGIN.top - MARGIN.bottom
  const gap        = 6
  const barW       = Math.max(20, Math.floor((innerW - gap * (barCount - 1)) / barCount))

  // Y scale — find domain
  const allValues = items.flatMap(item =>
    item.isTotal
      ? [0, item.amount]
      : [item.runningTotal - item.amount, item.runningTotal]
  )
  const domainMax  = Math.max(...allValues, 0)
  const domainMin  = Math.min(...allValues, 0)
  const domainRange = domainMax - domainMin || 1

  const toY = (v: number) =>
    MARGIN.top + innerH * (1 - (v - domainMin) / domainRange)

  const zeroY = toY(0)

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: W, display: "block" }}
        aria-hidden="true"
      >
        {/* Zero line */}
        <line
          x1={MARGIN.left}
          y1={zeroY}
          x2={W - MARGIN.right}
          y2={zeroY}
          stroke="oklch(1 0 0 / 12%)"
          strokeWidth={1}
        />

        {items.map((item, i) => {
          const x    = MARGIN.left + i * (barW + gap)
          const { fill, text } = barColor(item)

          let barTop: number
          let barBot: number
          let barH: number

          if (item.isTotal) {
            const lo = Math.min(0, item.amount)
            const hi = Math.max(0, item.amount)
            barTop   = toY(hi)
            barBot   = toY(lo)
            barH     = Math.max(2, barBot - barTop)
          } else {
            const prev = item.runningTotal - item.amount
            const lo   = Math.min(prev, item.runningTotal)
            const hi   = Math.max(prev, item.runningTotal)
            barTop     = toY(hi)
            barBot     = toY(lo)
            barH       = Math.max(2, barBot - barTop)
          }

          const barCenterX  = x + barW / 2
          const labelAbove  = item.amount >= 0

          // Connector line from previous bar
          const prevItem = items[i - 1]
          const connectorY = prevItem && !prevItem.isTotal
            ? toY(prevItem.runningTotal)
            : null

          const absAmount = Math.abs(item.amount)
          const showInlineLabel = barH > 16

          return (
            <g key={item.label}>
              {/* Connector dashed line from prev bar's running total */}
              {connectorY != null && i > 0 && !item.isTotal && (
                <line
                  x1={x - gap}
                  y1={connectorY}
                  x2={x}
                  y2={connectorY}
                  stroke="oklch(1 0 0 / 12%)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              )}

              {/* Bar */}
              <rect
                x={x}
                y={barTop}
                width={barW}
                height={barH}
                rx={3}
                fill={fill}
                opacity={item.isTotal ? 1 : 0.78}
              />

              {/* Inline value label — only when bar is tall enough */}
              {showInlineLabel && (
                <text
                  x={barCenterX}
                  y={barTop + barH / 2 + 4}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="var(--font-mono), monospace"
                  fill={item.isTotal ? "#fff" : "oklch(1 0 0 / 50%)"}
                  fontWeight={item.isTotal ? "700" : "400"}
                >
                  {item.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(item.amount), 0)}
                </text>
              )}

              {/* Value label above/below for short bars */}
              {!showInlineLabel && (
                <text
                  x={barCenterX}
                  y={labelAbove ? barTop - 3 : barBot + 10}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="var(--font-mono), monospace"
                  fill={text}
                  fontWeight="500"
                >
                  {item.amount >= 0 ? "+" : "−"}{formatCurrency(absAmount, 0)}
                </text>
              )}

              {/* X axis label — rotate when bar count makes horizontal
                  labels overlap (this used to render "Mortgage" on top of
                  "Maint." in the dossier panel). */}
              {rotateLabels ? (
                <text
                  x={barCenterX}
                  y={H - 14}
                  textAnchor="end"
                  fontSize={9}
                  fontFamily="var(--font-sans), sans-serif"
                  fill="oklch(0.52 0.009 252)"
                  transform={`rotate(-35 ${barCenterX} ${H - 14})`}
                >
                  {item.label}
                </text>
              ) : (
                <text
                  x={barCenterX}
                  y={H - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="var(--font-sans), sans-serif"
                  fill="oklch(0.52 0.009 252)"
                >
                  {item.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
