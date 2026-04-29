import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { supabaseEnv } from "@/lib/supabase/config"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { BarChart3 } from "lucide-react"
import { analyseDeal, sanitiseInputs, findOfferCeiling, formatCurrency, formatPercent } from "@/lib/calculations"
import type { DealInputs, VerdictTier } from "@/lib/calculations"
import type { DealRow } from "@/lib/lead-adapter"
import InsightsDashboard from "./_components/InsightsDashboard"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InsightsData = {
  totalDeals: number
  dealsThisMonth: number
  verdictDistribution: Record<VerdictTier, number>
  avgWalkAwayGapPct: number | null
  avgCashFlow: number | null
  avgCapRate: number | null
  avgDscr: number | null
  bestDeals: TopDeal[]
  zipInsights: ZipInsight[]
  monthlyActivity: MonthActivity[]
}

export type TopDeal = {
  address: string | null
  verdict: VerdictTier
  cashFlow: number
  walkAwayGap: number | null
  askingPrice: number
}

export type ZipInsight = {
  zip: string
  count: number
  bestVerdict: VerdictTier
  avgWalkAwayGap: number | null
}

export type MonthActivity = {
  month: string  // "Jan 25"
  count: number
}

// ---------------------------------------------------------------------------
// Data computation
// ---------------------------------------------------------------------------

function extractZip(address: string | null): string | null {
  if (!address) return null
  const m = address.match(/\b(\d{5})\b/)
  return m ? m[1] : null
}

const TIER_RANK: Record<VerdictTier, number> = {
  excellent: 5, good: 4, fair: 3, poor: 2, avoid: 1,
}

function computeInsights(deals: DealRow[]): InsightsData {
  const now       = new Date()
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  let totalCashFlow    = 0
  let totalCapRate     = 0
  let totalDscr        = 0
  let totalWalkGap     = 0
  let walkGapCount     = 0
  let validCount       = 0

  const verdictDist: Record<VerdictTier, number> = {
    excellent: 0, good: 0, fair: 0, poor: 0, avoid: 0,
  }

  type ZipAgg = { count: number; bestTier: VerdictTier; gapSum: number; gapCount: number }
  const zipMap = new Map<string, ZipAgg>()
  const monthMap = new Map<string, number>()

  const topDealCandidates: TopDeal[] = []

  for (const deal of deals) {
    if (!deal.inputs) continue
    let analysis
    let walkAway = null
    try {
      const inputs = sanitiseInputs({ ...deal.inputs } as DealInputs)
      analysis = analyseDeal(inputs)
      walkAway = findOfferCeiling(inputs)
    } catch { continue }

    const tier = analysis.verdict.tier as VerdictTier
    verdictDist[tier] = (verdictDist[tier] ?? 0) + 1
    validCount++

    totalCashFlow += analysis.monthlyCashFlow
    totalCapRate  += analysis.capRate
    if (isFinite(analysis.dscr)) totalDscr += analysis.dscr

    const walkAwayPrice = walkAway?.recommendedCeiling?.price ?? null
    const gap = walkAwayPrice != null
      ? (walkAwayPrice - deal.inputs.purchasePrice)
      : null
    const gapPct = gap != null && deal.inputs.purchasePrice > 0
      ? gap / deal.inputs.purchasePrice
      : null

    if (gapPct != null) {
      totalWalkGap += gapPct
      walkGapCount++
    }

    // Zip clustering
    const zip = extractZip(deal.address)
    if (zip) {
      const existing = zipMap.get(zip)
      if (existing) {
        existing.count++
        if (TIER_RANK[tier] > TIER_RANK[existing.bestTier]) existing.bestTier = tier
        if (gap != null && deal.inputs.purchasePrice > 0) {
          existing.gapSum += gap / deal.inputs.purchasePrice
          existing.gapCount++
        }
      } else {
        zipMap.set(zip, {
          count: 1,
          bestTier: tier,
          gapSum: gapPct ?? 0,
          gapCount: gapPct != null ? 1 : 0,
        })
      }
    }

    // Monthly activity
    const createdAt = new Date(deal.created_at)
    const key = createdAt.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    monthMap.set(key, (monthMap.get(key) ?? 0) + 1)

    // Top deal candidates — best gap from asking
    if (gap != null) {
      topDealCandidates.push({
        address: deal.address ?? null,
        verdict: tier,
        cashFlow: analysis.monthlyCashFlow,
        walkAwayGap: gap,
        askingPrice: deal.inputs.purchasePrice,
      })
    }
  }

  // Top 3 deals by walk-away gap
  topDealCandidates.sort((a, b) => (b.walkAwayGap ?? 0) - (a.walkAwayGap ?? 0))
  const bestDeals = topDealCandidates.slice(0, 3)

  // Zip insights — top 5 by count
  const zipInsights: ZipInsight[] = Array.from(zipMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([zip, agg]) => ({
      zip,
      count: agg.count,
      bestVerdict: agg.bestTier,
      avgWalkAwayGap: agg.gapCount > 0 ? agg.gapSum / agg.gapCount : null,
    }))

  // Monthly activity — last 6 months
  const monthlyActivity: MonthActivity[] = []
  for (let i = 5; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    monthlyActivity.push({ month: key, count: monthMap.get(key) ?? 0 })
  }

  const dealsThisMonth = deals.filter(
    (d) => new Date(d.created_at) >= thisMonth
  ).length

  return {
    totalDeals: validCount,
    dealsThisMonth,
    verdictDistribution: verdictDist,
    avgWalkAwayGapPct: walkGapCount > 0 ? totalWalkGap / walkGapCount : null,
    avgCashFlow:  validCount > 0 ? totalCashFlow / validCount : null,
    avgCapRate:   validCount > 0 ? totalCapRate  / validCount : null,
    avgDscr:      validCount > 0 ? totalDscr     / validCount : null,
    bestDeals,
    zipInsights,
    monthlyActivity,
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function InsightsPage() {
  const configured = supabaseEnv().configured
  let insights: InsightsData | null = null

  if (configured) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/login")

    const { data: rows } = await supabase
      .from("deals")
      .select("*")
      .order("created_at", { ascending: false })

    if (rows && rows.length > 0) {
      insights = computeInsights(rows as DealRow[])
    }
  }

  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          <span>Insights</span>
        </div>
      </header>

      <InsightsDashboard insights={insights} />
    </SidebarInset>
  )
}
