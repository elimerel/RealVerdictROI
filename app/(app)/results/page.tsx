import type { SearchParams } from "next/dist/server/request/search-params"
import {
  analyseDeal,
  findOfferCeiling,
  inputsFromSearchParams,
  formatCurrency,
  formatPercent,
} from "@/lib/calculations"
import { TIER_LABEL, TIER_ACCENT } from "@/lib/tier-constants"
import { cn } from "@/lib/utils"

export default async function ResultsSharePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const normalized: Record<string, string | string[] | undefined> = {}
  for (const [k, v] of Object.entries(params)) {
    normalized[k] = v as string | string[] | undefined
  }

  const inputs = inputsFromSearchParams(normalized)
  const analysis = analyseDeal(inputs)
  const walkAway = (() => {
    try { return findOfferCeiling(inputs) } catch { return null }
  })()

  const tier = analysis.verdict.tier
  const accent = TIER_ACCENT[tier]
  const label = TIER_LABEL[tier]
  const address = typeof params.address === "string" ? params.address : undefined
  const walkAwayPrice = walkAway?.primaryTarget?.price ?? null

  const metrics = [
    {
      label: "Cash flow",
      value: (analysis.monthlyCashFlow >= 0 ? "+" : "") + formatCurrency(analysis.monthlyCashFlow, 0) + "/mo",
      good: analysis.monthlyCashFlow >= 0,
    },
    {
      label: "Cap rate",
      value: formatPercent(analysis.capRate, 2),
      good: analysis.capRate >= 0.05,
    },
    {
      label: "DSCR",
      value: isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞",
      good: analysis.dscr >= 1.2,
    },
    {
      label: "Cash-on-cash",
      value: formatPercent(analysis.cashOnCashReturn, 2),
      good: analysis.cashOnCashReturn >= 0.07,
    },
  ]

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="max-w-2xl mx-auto px-6 py-10 pb-16">

        {/* Address */}
        <div className="space-y-1 mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
            Deal Analysis
          </p>
          {address && (
            <h1 className="text-xl font-bold leading-snug text-zinc-900">{address}</h1>
          )}
        </div>

        {/* Verdict badge */}
        <div
          className="rounded-xl px-5 py-4 space-y-1 mb-5"
          style={{
            backgroundColor: accent + "18",
            border: `1px solid ${accent}40`,
          }}
        >
          <p
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: accent }}
          >
            Verdict
          </p>
          <p className="text-2xl font-extrabold" style={{ color: accent }}>
            {label}
          </p>
          <p className="text-sm text-zinc-600 leading-relaxed">
            {analysis.verdict.summary}
          </p>
        </div>

        {/* Walk-away ceiling */}
        {walkAwayPrice != null && (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 space-y-1 mb-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
              Walk-Away Ceiling
            </p>
            <p className="text-3xl font-bold tabular-nums text-zinc-900">
              {formatCurrency(walkAwayPrice, 0)}
            </p>
            {inputs.purchasePrice > 0 && (
              <p
                className={cn(
                  "text-xs tabular-nums",
                  walkAwayPrice >= inputs.purchasePrice
                    ? "text-emerald-600"
                    : "text-red-600"
                )}
              >
                {walkAwayPrice >= inputs.purchasePrice
                  ? formatCurrency(walkAwayPrice - inputs.purchasePrice, 0) +
                    " under ceiling — deal works at ask"
                  : formatCurrency(inputs.purchasePrice - walkAwayPrice, 0) +
                    " over ceiling"}
              </p>
            )}
          </div>
        )}

        {/* Four key metric tiles */}
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 space-y-0.5"
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                {m.label}
              </p>
              <p
                className={cn(
                  "text-xl font-bold tabular-nums",
                  m.good ? "text-emerald-600" : "text-red-600"
                )}
              >
                {m.value}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-zinc-100 text-center">
          <p className="text-xs text-zinc-400">
            Analyzed with{" "}
            <a
              href="https://realverdict.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-zinc-600 transition-colors"
            >
              RealVerdict
            </a>
          </p>
        </div>

      </div>
    </div>
  )
}
