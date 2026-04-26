"use client"

import { formatDistanceToNow } from "date-fns"
import { MapPin } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Lead } from "@/lib/types"
import { DealGradeBadge } from "@/components/analysis/deal-grade-badge"
import { MiniSparkline } from "@/components/charts/mini-sparkline"

interface LeadCardProps {
  lead: Lead
  isSelected: boolean
  onSelect: () => void
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

export function LeadCard({ lead, isSelected, onSelect }: LeadCardProps) {
  const avgCashFlow = lead.cashFlowTrend.reduce((a, b) => a + b, 0) / lead.cashFlowTrend.length
  const sparklineColor = avgCashFlow >= 0 ? "green" : "red"

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left p-4 border-b border-border transition-colors",
        "hover:bg-muted/50",
        isSelected && "bg-muted/80 border-l-2 border-l-foreground"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Grade Badge */}
        <DealGradeBadge grade={lead.grade} size="md" />

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Address */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {lead.propertyFacts.address}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {lead.propertyFacts.city}, {lead.propertyFacts.state}
              </p>
            </div>
            
            {/* Sparkline */}
            <div className="w-16 h-8 shrink-0">
              <MiniSparkline
                data={lead.cashFlowTrend}
                color={sparklineColor}
                className="w-full h-full"
              />
            </div>
          </div>

          {/* Metrics */}
          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Cap: </span>
              <span className="font-mono text-foreground">
                {formatPercent(lead.outputs.ratios.capRate)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">CoC: </span>
              <span
                className={cn(
                  "font-mono",
                  lead.outputs.ratios.cashOnCashReturn >= 0
                    ? "text-emerald-400"
                    : "text-red-400"
                )}
              >
                {formatPercent(lead.outputs.ratios.cashOnCashReturn)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Price: </span>
              <span className="font-mono text-foreground">
                {formatCurrency(lead.inputs.purchase.purchasePrice)}
              </span>
            </div>
          </div>

          {/* Timestamp */}
          <p className="text-[10px] text-muted-foreground">
            Added {formatDistanceToNow(lead.createdAt, { addSuffix: true })}
          </p>
        </div>
      </div>
    </button>
  )
}
