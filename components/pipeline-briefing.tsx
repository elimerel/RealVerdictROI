"use client"

// PipelineBriefing — the "buddy says hi" line at the top of Pipeline.
// One observation, derived from the user's actual data, rotated to
// the most interesting truth on this load. Mercury parallel: their
// dashboard greeting that picks the most useful sentence to lead
// with based on what's happening in your account today.
//
// Deliberately ONE line, never two. The user came to Pipeline to do
// work; this is a quick hello, not a daily digest.

import { useMemo } from "react"
import type { SavedDeal } from "@/lib/pipeline"
import { Sparkles } from "lucide-react"

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5)  return "Late night."
  if (h < 12) return "Morning."
  if (h < 17) return "Afternoon."
  if (h < 21) return "Evening."
  return "Late."
}

/** Pick the single most interesting sentence about the user's pipeline
 *  state to lead with. Returns null when the pipeline is empty (the
 *  empty state handles greeting in that case). */
function pickObservation(deals: SavedDeal[]): string | null {
  if (deals.length === 0) return null

  const now = Date.now()
  const WEEK = 7 * 86400_000
  const TWO_WEEKS = 14 * 86400_000

  const watching = deals.filter((d) => d.stage === "watching")
  const interested = deals.filter((d) => d.stage === "interested")
  const offered = deals.filter((d) => d.stage === "offered")

  // Stale watching — strongest signal when the user has things sitting.
  const staleWatching = watching.filter((d) => {
    const updated = new Date(d.updated_at).getTime()
    return now - updated > TWO_WEEKS
  })
  if (staleWatching.length >= 2) {
    return `${staleWatching.length} of your watching deals haven't moved in two weeks. Worth a pass — something's gone stale.`
  }

  // Saved this week — celebrate momentum.
  const savedThisWeek = deals.filter((d) => {
    const created = new Date(d.created_at).getTime()
    return now - created < WEEK
  })
  if (savedThisWeek.length >= 3) {
    return `${savedThisWeek.length} new saves this week. Active stretch — see anything pulling ahead?`
  }

  // Active offers — these need the most attention.
  if (offered.length >= 1) {
    return `${offered.length} offer${offered.length === 1 ? "" : "s"} out. Check status before someone else closes them.`
  }

  // Concentration check — biggest single-city exposure.
  const cityCount: Record<string, number> = {}
  for (const d of deals) {
    const c = d.city?.trim()
    if (!c) continue
    cityCount[c] = (cityCount[c] ?? 0) + 1
  }
  const topCity = Object.entries(cityCount).sort((a, b) => b[1] - a[1])[0]
  if (topCity && topCity[1] >= 4 && topCity[1] / deals.length > 0.5) {
    return `You're heavy in ${topCity[0]} — ${topCity[1]} of ${deals.length} saved deals. Concentrated portfolios know their market better.`
  }

  // Cap rate spread — when there's signal, surface the range.
  const caps = deals
    .map((d) => d.snapshot?.metrics?.capRate)
    .filter((n): n is number => Number.isFinite(n))
  if (caps.length >= 4) {
    const min = Math.min(...caps)
    const max = Math.max(...caps)
    const spread = max - min
    if (spread > 0.04) {
      return `Cap rates across your pipeline span ${(min * 100).toFixed(1)}% to ${(max * 100).toFixed(1)}%. Wide range — different markets, different math.`
    }
  }

  // First few saves — friendly low-key state.
  if (deals.length <= 3) {
    return `${deals.length} saved so far. Keep building the pipeline — patterns emerge once you've got 8-10 to compare.`
  }

  // Default: cash flow snapshot.
  const cfs = deals
    .map((d) => d.snapshot?.metrics?.monthlyCashFlow)
    .filter((n): n is number => Number.isFinite(n))
  if (cfs.length >= 2) {
    const positive = cfs.filter((n) => n > 0).length
    if (positive === 0) {
      return `None of your saved deals cash flow positive yet. Your bar's holding — the right one will show up.`
    }
    if (positive === cfs.length) {
      return `Every saved deal cash flows positive. Solid pipeline.`
    }
    return `${positive} of ${cfs.length} cash flow positive. ${watching.length} watching, ${interested.length} interested.`
  }

  return null
}

export function PipelineBriefing({ deals }: { deals: SavedDeal[] }) {
  const observation = useMemo(() => pickObservation(deals), [deals])
  if (!observation) return null

  return (
    <div className="max-w-[1280px] mx-auto px-4 mt-4 mb-2">
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-foreground/[0.07] bg-card">
        <div className="size-8 shrink-0 rounded-full bg-primary/10 inline-flex items-center justify-center mt-0.5">
          <Sparkles size={14} strokeWidth={2} className="text-primary" />
        </div>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {greeting()}
          </span>
          <p
            className="leading-snug text-foreground"
            style={{
              fontSize:      14,
              fontFamily:    "var(--rv-font-display)",
              fontWeight:    400,
              letterSpacing: "-0.01em",
            }}
          >
            {observation}
          </p>
        </div>
      </div>
    </div>
  )
}
