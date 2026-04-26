"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { cn } from "@/lib/utils"
import type { YearProjection } from "@/lib/types"

interface ProjectionChartProps {
  projections: YearProjection[]
  className?: string
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`
  }
  return `$${value.toFixed(0)}`
}

export function ProjectionChart({
  projections,
  className,
}: ProjectionChartProps) {
  const data = projections.map((p) => ({
    year: `Y${p.year}`,
    equity: p.equityEnd,
    cashFlow: p.cumulativeCashFlow,
    propertyValue: p.propertyValueEnd,
  }))

  return (
    <div className={cn("rounded-lg border border-border bg-card/50", className)}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium">Equity & Cash Flow Projection</h3>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Equity</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-sky-500" />
            <span className="text-muted-foreground">Cumulative Cash Flow</span>
          </div>
        </div>
      </div>
      <div className="p-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="oklch(0.65 0.17 145)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor="oklch(0.65 0.17 145)"
                  stopOpacity={0}
                />
              </linearGradient>
              <linearGradient id="cashFlowGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="oklch(0.6 0.12 250)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor="oklch(0.6 0.12 250)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="oklch(0.22 0 0)"
              vertical={false}
            />
            <XAxis
              dataKey="year"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "oklch(0.55 0 0)", fontSize: 11 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "oklch(0.55 0 0)", fontSize: 11 }}
              tickFormatter={formatCurrency}
              width={60}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "oklch(0.12 0 0)",
                border: "1px solid oklch(0.22 0 0)",
                borderRadius: "6px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "oklch(0.95 0 0)" }}
              formatter={(value: number, name: string) => [
                formatCurrency(value),
                name === "equity"
                  ? "Total Equity"
                  : name === "cashFlow"
                  ? "Cumulative Cash Flow"
                  : "Property Value",
              ]}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="oklch(0.65 0.17 145)"
              strokeWidth={2}
              fill="url(#equityGradient)"
            />
            <Area
              type="monotone"
              dataKey="cashFlow"
              stroke="oklch(0.6 0.12 250)"
              strokeWidth={2}
              fill="url(#cashFlowGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
