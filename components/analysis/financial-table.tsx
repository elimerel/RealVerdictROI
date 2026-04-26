"use client"

import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ProvenanceBadge } from "./provenance-badge"
import type { FieldProvenance } from "@/lib/types"

interface TableRow {
  label: string
  value: string | number
  provenance?: FieldProvenance
  highlight?: "positive" | "negative" | "neutral"
  isHeader?: boolean
}

interface FinancialTableProps {
  title: string
  rows: TableRow[]
  className?: string
}

function formatValue(value: string | number): string {
  if (typeof value === "string") return value
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value)
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function FinancialTable({
  title,
  rows,
  className,
}: FinancialTableProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-card/50", className)}>
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <Table>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={index}
              className={cn(
                "border-border",
                row.isHeader && "bg-muted/30"
              )}
            >
              <TableCell
                className={cn(
                  "py-2 text-sm",
                  row.isHeader ? "font-medium" : "text-muted-foreground"
                )}
              >
                {row.label}
              </TableCell>
              <TableCell className="py-2 text-right">
                <div className="flex items-center justify-end gap-2">
                  <span
                    className={cn(
                      "font-mono text-sm tabular-nums",
                      row.highlight === "positive" && "text-emerald-400",
                      row.highlight === "negative" && "text-red-400"
                    )}
                  >
                    {formatValue(row.value)}
                  </span>
                  {row.provenance && (
                    <ProvenanceBadge
                      source={row.provenance.source}
                      confidence={row.provenance.confidence}
                      tooltip={row.provenance.tooltip}
                    />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

interface KeyRatiosTableProps {
  ratios: {
    capRate: number
    cashOnCashReturn: number
    dscr: number
    irr: number
    grossRentMultiplier: number
    onePercentRule: number
  }
  className?: string
}

export function KeyRatiosTable({ ratios, className }: KeyRatiosTableProps) {
  const formatPercent = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
  const formatRatio = (v: number) => v.toFixed(2)

  const getStatusColor = (
    metric: string,
    value: number
  ): "positive" | "negative" | "neutral" => {
    switch (metric) {
      case "capRate":
        return value >= 6 ? "positive" : value >= 4 ? "neutral" : "negative"
      case "cashOnCashReturn":
        return value >= 8 ? "positive" : value >= 0 ? "neutral" : "negative"
      case "dscr":
        return value >= 1.25 ? "positive" : value >= 1 ? "neutral" : "negative"
      case "irr":
        return value >= 12 ? "positive" : value >= 8 ? "neutral" : "negative"
      case "grossRentMultiplier":
        return value <= 12 ? "positive" : value <= 15 ? "neutral" : "negative"
      case "onePercentRule":
        return value >= 1 ? "positive" : value >= 0.7 ? "neutral" : "negative"
      default:
        return "neutral"
    }
  }

  return (
    <div className={cn("rounded-lg border border-border bg-card/50", className)}>
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium">Key Ratios</h3>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border">
        {[
          { key: "capRate", label: "Cap Rate", value: formatPercent(ratios.capRate) },
          { key: "cashOnCashReturn", label: "Cash-on-Cash", value: formatPercent(ratios.cashOnCashReturn) },
          { key: "dscr", label: "DSCR", value: `${formatRatio(ratios.dscr)}x` },
          { key: "irr", label: "IRR", value: formatPercent(ratios.irr) },
          { key: "grossRentMultiplier", label: "GRM", value: `${formatRatio(ratios.grossRentMultiplier)}x` },
          { key: "onePercentRule", label: "1% Rule", value: formatPercent(ratios.onePercentRule * 100) },
        ].map((item) => (
          <div key={item.key} className="px-4 py-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
            <p
              className={cn(
                "font-mono text-lg tabular-nums",
                getStatusColor(item.key, ratios[item.key as keyof typeof ratios]) === "positive" && "text-emerald-400",
                getStatusColor(item.key, ratios[item.key as keyof typeof ratios]) === "negative" && "text-red-400"
              )}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
