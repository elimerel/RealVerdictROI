"use client"

import { useState } from "react"
import { Sparkles, RefreshCw, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Lead } from "@/lib/types"

interface AIStrategistProps {
  lead: Lead
  className?: string
}

function generateInsights(lead: Lead): string {
  const { outputs, verdict, propertyFacts } = lead
  const { ratios, annual, exit } = outputs

  const sections: string[] = []

  // Deal Summary
  sections.push(`**Deal Summary**`)
  sections.push(
    `This ${propertyFacts.beds}BR/${propertyFacts.baths}BA ${propertyFacts.propertyType.toLowerCase()} in ${propertyFacts.city}, ${propertyFacts.state} scores ${verdict.score}/100 (${verdict.tier}).`
  )

  // Cash Flow Analysis
  if (annual.annualCashFlow >= 0) {
    sections.push(
      `The property generates $${Math.abs(annual.annualCashFlow).toLocaleString()}/year positive cash flow with a ${ratios.cashOnCashReturn.toFixed(1)}% cash-on-cash return.`
    )
  } else {
    sections.push(
      `**Warning:** Negative cash flow of $${Math.abs(annual.annualCashFlow).toLocaleString()}/year. This is an appreciation-dependent play.`
    )
  }

  // DSCR Analysis
  if (ratios.dscr >= 1.25) {
    sections.push(
      `DSCR of ${ratios.dscr.toFixed(2)}x provides comfortable debt service coverage.`
    )
  } else if (ratios.dscr >= 1.0) {
    sections.push(
      `DSCR of ${ratios.dscr.toFixed(2)}x is borderline - limited buffer for unexpected expenses.`
    )
  } else {
    sections.push(
      `**Risk Factor:** DSCR of ${ratios.dscr.toFixed(2)}x indicates income does not cover debt service.`
    )
  }

  // IRR Projection
  sections.push("")
  sections.push(`**Long-Term Outlook**`)
  sections.push(
    `Projected ${exit.totalROI.toFixed(0)}% total ROI over the hold period, with IRR of ${ratios.irr.toFixed(1)}%.`
  )

  // Negotiation Strategy
  sections.push("")
  sections.push(`**Negotiation Strategy**`)
  if (verdict.score >= 70) {
    sections.push(
      `Market pricing appears fair. Consider negotiating 3-5% below asking for additional margin.`
    )
  } else if (verdict.score >= 50) {
    sections.push(
      `Request 8-12% reduction from asking price to improve cash flow metrics. Alternatively, explore seller financing or rate buydown credits.`
    )
  } else {
    sections.push(
      `This property requires significant price reduction (15%+) to become viable. Consider walking unless seller is highly motivated.`
    )
  }

  return sections.join("\n\n")
}

export function AIStrategist({ lead, className }: AIStrategistProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [insights, setInsights] = useState(() => generateInsights(lead))

  const handleRegenerate = () => {
    setIsRegenerating(true)
    // Simulate API call
    setTimeout(() => {
      setInsights(generateInsights(lead))
      setIsRegenerating(false)
    }, 1200)
  }

  return (
    <div className={cn("rounded-lg border border-border bg-card/50", className)}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 border-b border-border flex items-center justify-between hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-medium">AI Strategist</h3>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Insights Content */}
          <div className="prose prose-sm prose-invert max-w-none">
            {insights.split("\n\n").map((paragraph, i) => {
              if (paragraph.startsWith("**") && paragraph.endsWith("**")) {
                return (
                  <h4
                    key={i}
                    className="text-sm font-medium text-foreground mt-4 first:mt-0"
                  >
                    {paragraph.replace(/\*\*/g, "")}
                  </h4>
                )
              }
              if (paragraph.startsWith("**Warning:**")) {
                return (
                  <p key={i} className="text-sm text-amber-400">
                    {paragraph.replace(/\*\*/g, "")}
                  </p>
                )
              }
              if (paragraph.startsWith("**Risk Factor:**")) {
                return (
                  <p key={i} className="text-sm text-red-400">
                    {paragraph.replace(/\*\*/g, "")}
                  </p>
                )
              }
              return (
                <p key={i} className="text-sm text-muted-foreground leading-relaxed">
                  {paragraph.replace(/\*\*/g, "")}
                </p>
              )
            })}
          </div>

          {/* Regenerate Button */}
          <div className="pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRegenerate}
              disabled={isRegenerating}
              className="gap-2 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRegenerating && "animate-spin")}
              />
              {isRegenerating ? "Analyzing..." : "Regenerate insights"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
