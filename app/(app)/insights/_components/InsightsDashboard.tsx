"use client"

import { cn } from "@/lib/utils"
import { formatCurrency, formatPercent } from "@/lib/calculations"
import type { VerdictTier } from "@/lib/calculations"
import type { InsightsData, TopDeal, ZipInsight } from "../page"
import { TIER_LABEL, TIER_ACCENT } from "@/lib/tier-constants"
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie,
} from "recharts"

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  accentColor,
}: {
  label: string
  value: string
  sub?: string
  accentColor?: string
}) {
  return (
    <div className="rounded-xl border border-white/7 bg-card p-5 space-y-1.5">
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/50 font-semibold">
        {label}
      </p>
      <p
        className="text-2xl font-mono font-bold tabular-nums leading-none"
        style={accentColor ? { color: accentColor } : undefined}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[12px] text-muted-foreground/60">{sub}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Verdict distribution chart
// ---------------------------------------------------------------------------

function VerdictPieChart({ distribution }: { distribution: Record<VerdictTier, number> }) {
  const tiers = Object.entries(distribution)
    .filter(([, count]) => count > 0)
    .map(([tier, count]) => ({
      tier: tier as VerdictTier,
      count,
      label: TIER_LABEL[tier as VerdictTier],
      color: TIER_ACCENT[tier as VerdictTier],
    }))

  const total = tiers.reduce((s, t) => s + t.count, 0)
  if (total === 0) return null

  return (
    <div className="flex items-center gap-6">
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie
            data={tiers}
            dataKey="count"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={32}
            outerRadius={52}
            strokeWidth={0}
          >
            {tiers.map((t) => (
              <Cell key={t.tier} fill={t.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5">
        {tiers.map((t) => (
          <div key={t.tier} className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
            <span className="text-[12px] text-muted-foreground">{t.label}</span>
            <span className="text-[12px] font-mono tabular-nums text-muted-foreground/50 ml-auto pl-3">
              {t.count} ({Math.round((t.count / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Monthly activity bar chart
// ---------------------------------------------------------------------------

function ActivityChart({ data }: { data: InsightsData["monthlyActivity"] }) {
  return (
    <ResponsiveContainer width="100%" height={80}>
      <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }} barSize={14}>
        <XAxis
          dataKey="month"
          tick={{ fill: "oklch(0.52 0.009 252)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide />
        <Tooltip
          cursor={{ fill: "oklch(1 0 0 / 4%)" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <div className="rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs shadow-xl">
                <span className="text-zinc-400">{label}: </span>
                <span className="font-mono text-zinc-200">{payload[0]?.value} deal{(payload[0]?.value as number) !== 1 ? "s" : ""}</span>
              </div>
            ) : null
          }
        />
        <Bar dataKey="count" fill="oklch(0.62 0.22 265)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Top deal row
// ---------------------------------------------------------------------------

function TopDealRow({ deal, rank }: { deal: TopDeal; rank: number }) {
  const accent = TIER_ACCENT[deal.verdict]
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
      <span className="text-[11px] font-mono text-muted-foreground/30 w-4 shrink-0">{rank}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground truncate">
          {deal.address ?? "Unknown address"}
        </p>
        <p className="text-[11px] text-muted-foreground/50 font-mono">
          Asking {formatCurrency(deal.askingPrice, 0)}
          {deal.walkAwayGap != null && (
            <span className={deal.walkAwayGap >= 0 ? " text-emerald-400" : " text-amber-400"}>
              {" · "}
              {deal.walkAwayGap >= 0 ? "+" : ""}{formatCurrency(deal.walkAwayGap, 0)} gap
            </span>
          )}
        </p>
      </div>
      <span
        className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded shrink-0"
        style={{ color: accent, backgroundColor: `${accent}18` }}
      >
        {TIER_LABEL[deal.verdict]}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Zip insight row
// ---------------------------------------------------------------------------

function ZipRow({ zip }: { zip: ZipInsight }) {
  const accent = TIER_ACCENT[zip.bestVerdict]
  return (
    <div className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
      <div
        className="h-7 w-7 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold shrink-0"
        style={{ backgroundColor: `${accent}15`, color: accent }}
      >
        {zip.zip.slice(-2)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-mono font-semibold text-foreground">{zip.zip}</p>
        <p className="text-[11px] text-muted-foreground/50">
          {zip.count} deal{zip.count !== 1 ? "s" : ""}
          {" · best: "}
          <span style={{ color: accent }}>{TIER_LABEL[zip.bestVerdict]}</span>
        </p>
      </div>
      {zip.avgWalkAwayGap != null && (
        <span className={cn(
          "text-[12px] font-mono tabular-nums shrink-0",
          zip.avgWalkAwayGap >= 0 ? "text-emerald-400" : "text-amber-400"
        )}>
          {zip.avgWalkAwayGap >= 0 ? "+" : ""}{formatPercent(zip.avgWalkAwayGap, 1)} avg gap
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function InsightsEmpty() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="h-20 w-20 rounded-2xl bg-white/3 border border-white/8 flex items-center justify-center">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          {/* Intelligence pattern — radiating lines from center */}
          <circle cx="20" cy="20" r="4" fill="currentColor" className="text-white/20" />
          <circle cx="20" cy="20" r="10" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" className="text-white/10" />
          <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" className="text-white/6" />
          {/* Dots at compass points */}
          <circle cx="20" cy="4"  r="2" fill="currentColor" className="text-white/20" />
          <circle cx="36" cy="20" r="2" fill="currentColor" className="text-white/15" />
          <circle cx="20" cy="36" r="2" fill="currentColor" className="text-white/15" />
          <circle cx="4"  cy="20" r="2" fill="currentColor" className="text-white/15" />
        </svg>
      </div>
      <div className="space-y-1.5 max-w-xs">
        <p className="text-sm font-semibold text-foreground">No data yet</p>
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          Analyze a few properties and save them to your Pipeline. Insights will appear here once you have data to learn from.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export default function InsightsDashboard({ insights }: { insights: InsightsData | null }) {
  if (!insights || insights.totalDeals === 0) {
    return <InsightsEmpty />
  }

  const {
    totalDeals,
    dealsThisMonth,
    verdictDistribution,
    avgWalkAwayGapPct,
    avgCashFlow,
    avgCapRate,
    bestDeals,
    zipInsights,
    monthlyActivity,
  } = insights

  const bestTier = (Object.entries(verdictDistribution) as [VerdictTier, number][])
    .sort((a, b) => b[1] - a[1])[0]?.[0]

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-8">

        {/* ── Intelligence summary ── */}
        <div className="rounded-xl border border-white/7 bg-card p-5 space-y-2">
          <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40 font-semibold">
            What your pipeline tells you
          </p>
          <p className="text-[15px] text-foreground leading-relaxed">
            You&apos;ve analyzed{" "}
            <span className="font-semibold text-foreground">{totalDeals} {totalDeals === 1 ? "property" : "properties"}</span>
            {dealsThisMonth > 0 && (
              <>, including{" "}
              <span className="font-semibold text-foreground">{dealsThisMonth} this month</span></>
            )}
            .{" "}
            {avgWalkAwayGapPct != null && (
              <>
                Your average walk-away gap is{" "}
                <span className={cn(
                  "font-semibold",
                  avgWalkAwayGapPct >= 0 ? "text-emerald-400" : "text-amber-400"
                )}>
                  {avgWalkAwayGapPct >= 0 ? "+" : ""}{formatPercent(avgWalkAwayGapPct, 1)} vs asking
                </span>
                .{" "}
              </>
            )}
            {bestTier && verdictDistribution[bestTier] > 0 && (
              <>
                Most deals are{" "}
                <span style={{ color: TIER_ACCENT[bestTier] }} className="font-semibold">
                  {TIER_LABEL[bestTier]}
                </span>
                {verdictDistribution.excellent > 0 && bestTier !== "excellent" && (
                  <>, with{" "}
                  <span className="font-semibold text-emerald-400">
                    {verdictDistribution.excellent} Strong Buy
                  </span>
                  {verdictDistribution.excellent === 1 ? " opportunity" : " opportunities"} in the mix</>
                )}
                .
              </>
            )}
          </p>
        </div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Deals analyzed"
            value={totalDeals.toString()}
            sub={dealsThisMonth > 0 ? `${dealsThisMonth} this month` : undefined}
          />
          {avgWalkAwayGapPct != null && (
            <StatCard
              label="Avg walk-away gap"
              value={`${avgWalkAwayGapPct >= 0 ? "+" : ""}${formatPercent(avgWalkAwayGapPct, 1)}`}
              sub="vs asking price"
              accentColor={avgWalkAwayGapPct >= 0 ? "#22c55e" : "#eab308"}
            />
          )}
          {avgCashFlow != null && (
            <StatCard
              label="Avg cash flow"
              value={`${avgCashFlow >= 0 ? "+" : ""}${formatCurrency(avgCashFlow, 0)}/mo`}
              accentColor={avgCashFlow >= 0 ? "#22c55e" : "#ef4444"}
            />
          )}
          {avgCapRate != null && (
            <StatCard
              label="Avg cap rate"
              value={formatPercent(avgCapRate, 1)}
              sub="portfolio average"
            />
          )}
        </div>

        {/* ── Verdict distribution + Activity ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="rounded-xl border border-white/7 bg-card p-5">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40 font-semibold mb-4">
              Verdict distribution
            </p>
            <VerdictPieChart distribution={verdictDistribution} />
          </div>

          <div className="rounded-xl border border-white/7 bg-card p-5">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40 font-semibold mb-4">
              Activity — last 6 months
            </p>
            <ActivityChart data={monthlyActivity} />
          </div>
        </div>

        {/* ── Top deals ── */}
        {bestDeals.length > 0 && (
          <div className="rounded-xl border border-white/7 bg-card p-5">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40 font-semibold mb-1">
              Best deals in your pipeline
            </p>
            <p className="text-[12px] text-muted-foreground/50 mb-4">
              Sorted by walk-away headroom vs. asking price
            </p>
            {bestDeals.map((deal, i) => (
              <TopDealRow key={i} deal={deal} rank={i + 1} />
            ))}
          </div>
        )}

        {/* ── Zip code clusters ── */}
        {zipInsights.length > 0 && (
          <div className="rounded-xl border border-white/7 bg-card p-5">
            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40 font-semibold mb-1">
              Markets you&apos;re tracking
            </p>
            <p className="text-[12px] text-muted-foreground/50 mb-4">
              Zip codes with the most analyzed properties
            </p>
            {zipInsights.map((zip) => (
              <ZipRow key={zip.zip} zip={zip} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
