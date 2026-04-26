"use client"

import { cn } from "@/lib/utils"
import type { VerdictResult, VerdictTier } from "@/lib/types"

interface VerdictDisplayProps {
  verdict: VerdictResult
  className?: string
}

const tierConfig: Record<
  VerdictTier,
  { bg: string; text: string; border: string; glow: string }
> = {
  "STRONG BUY": {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    glow: "shadow-emerald-500/20",
  },
  "GOOD DEAL": {
    bg: "bg-sky-500/10",
    text: "text-sky-400",
    border: "border-sky-500/30",
    glow: "shadow-sky-500/20",
  },
  BORDERLINE: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
    glow: "shadow-amber-500/20",
  },
  PASS: {
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-500/30",
    glow: "shadow-orange-500/20",
  },
  AVOID: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/30",
    glow: "shadow-red-500/20",
  },
}

const statusColors = {
  win: "bg-emerald-500",
  ok: "bg-sky-500",
  warn: "bg-amber-500",
  fail: "bg-red-500",
}

export function VerdictDisplay({ verdict, className }: VerdictDisplayProps) {
  const config = tierConfig[verdict.tier]

  return (
    <div className={cn("rounded-lg border border-border bg-card/50", className)}>
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium">Deal Verdict</h3>
      </div>
      <div className="p-4 space-y-4">
        {/* Main Verdict */}
        <div className="flex items-center gap-4">
          {/* Score Circle */}
          <div
            className={cn(
              "relative h-20 w-20 rounded-full border-2 flex items-center justify-center shadow-lg",
              config.border,
              config.bg,
              config.glow
            )}
          >
            <span className={cn("font-mono text-2xl font-bold", config.text)}>
              {verdict.score}
            </span>
            <span className="absolute -bottom-1 text-[10px] text-muted-foreground">
              / 100
            </span>
          </div>

          {/* Tier Label */}
          <div>
            <p
              className={cn(
                "text-xl font-semibold tracking-tight",
                config.text
              )}
            >
              {verdict.tier}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              {verdict.summary}
            </p>
          </div>
        </div>

        {/* Rubric Breakdown */}
        <div className="space-y-2 pt-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Score Breakdown
          </p>
          <div className="space-y-1.5">
            {verdict.rubric.map((item) => (
              <div key={item.name} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-28 truncate">
                  {item.name}
                </span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      statusColors[item.status]
                    )}
                    style={{
                      width: `${(item.score / item.maxPoints) * 100}%`,
                    }}
                  />
                </div>
                <span className="text-xs font-mono tabular-nums text-muted-foreground w-10 text-right">
                  {item.score}/{item.maxPoints}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
