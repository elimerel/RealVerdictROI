"use client";

import { useMemo } from "react";
import {
  analyseDeal,
  formatCurrency,
  formatPercent,
  sanitiseInputs,
  type DealAnalysis,
  type DealInputs,
  type VerdictTier,
} from "@/lib/calculations";
import { TIER_LABEL, TIER_TAILWIND_TEXT as TIER_COLOR } from "@/lib/tier-constants";
import { STRESS_SCENARIOS as SCENARIOS } from "@/lib/stress-scenarios";

export default function StressTestPanel({
  baseInputs,
  baseAnalysis,
}: {
  baseInputs: DealInputs;
  baseAnalysis: DealAnalysis;
}) {
  const results = useMemo(
    () =>
      SCENARIOS.map((s) => ({
        scenario: s,
        analysis: safeAnalyse(s.apply(baseInputs)),
      })),
    [baseInputs],
  );

  const survivors = results.filter(
    (r) => r.analysis && r.analysis.monthlyCashFlow >= 0,
  ).length;

  const headline =
    survivors === results.length
      ? "Holds up across every shock we ran."
      : survivors >= results.length - 1
        ? `Holds up in ${survivors} of ${results.length} shocks. One soft spot to know about.`
        : survivors >= 2
          ? `Cash-flow positive in ${survivors} of ${results.length} shocks. Watch the failures.`
          : `Cash-flow positive in only ${survivors} of ${results.length} shocks. Thin margin.`;

  // For the bar chart: find the range of cash flows across base + all scenarios
  const allCF = [
    baseAnalysis.monthlyCashFlow,
    ...results.map((r) => r.analysis?.monthlyCashFlow ?? 0),
  ];
  const cfMax = Math.max(...allCF);
  const cfMin = Math.min(...allCF, 0);
  const cfRange = cfMax - cfMin || 1;

  return (
    <section className="space-y-6">
      <header>
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
          Stress test
        </div>
        <h2 className="mt-1 text-2xl font-semibold text-zinc-100 sm:text-3xl">
          {headline}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Each scenario changes one variable and leaves everything else constant.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {results.map(({ scenario, analysis }) => {
          if (!analysis) return null;
          const flip = analysis.verdict.tier !== baseAnalysis.verdict.tier
            ? diagnoseVerdictFlip(baseAnalysis, analysis)
            : null;
          const cf = analysis.monthlyCashFlow;
          const cfPositive = cf >= 0;
          const verdictChanged = analysis.verdict.tier !== baseAnalysis.verdict.tier;

          // Bar width: positive bars grow right from zero, negative bars grow left
          const zeroFrac = (-cfMin) / cfRange;
          const barFrac = Math.abs(cf - 0) / cfRange;

          return (
            <div
              key={scenario.key}
              className={`rounded-xl border px-5 py-4 transition-colors ${
                verdictChanged
                  ? "border-red-900/60 bg-red-950/20"
                  : "border-zinc-800/60 bg-zinc-900/30"
              }`}
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">
                    {scenario.label}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {scenario.description}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${TIER_COLOR[analysis.verdict.tier]}`}
                  >
                    {TIER_LABEL[analysis.verdict.tier]}
                  </span>
                  {flip && (
                    <span className="text-[10px] text-red-400" title={flip.detail}>
                      {flip.direction === "down" ? "↓" : "↑"} flipped on {flip.metric}
                    </span>
                  )}
                </div>
              </div>

              {/* Cash flow bar */}
              <div className="relative h-6 rounded-md bg-zinc-800/60 overflow-hidden">
                {/* Zero marker */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-zinc-600"
                  style={{ left: `${zeroFrac * 100}%` }}
                />
                {/* Bar */}
                <div
                  className={`absolute top-1 bottom-1 rounded-sm ${cfPositive ? "bg-emerald-500/70" : "bg-red-500/70"}`}
                  style={
                    cfPositive
                      ? { left: `${zeroFrac * 100}%`, width: `${barFrac * 100}%` }
                      : { right: `${(1 - zeroFrac) * 100}%`, width: `${barFrac * 100}%` }
                  }
                />
              </div>

              {/* Metrics row */}
              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums">
                <span>
                  <span className="text-zinc-600">Cash flow </span>
                  <span className={`font-mono font-semibold ${cfPositive ? "text-emerald-400" : "text-red-400"}`}>
                    {formatCurrency(cf, 0)}/mo
                  </span>
                  <DeltaSub
                    base={baseAnalysis.monthlyCashFlow}
                    next={cf}
                    fmt={(n) => `${formatCurrency(n, 0)}/mo`}
                    higherIsBetter
                    inline
                  />
                </span>
                <span>
                  <span className="text-zinc-600">DSCR </span>
                  <span className="font-mono font-semibold text-zinc-300">
                    {isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞"}
                  </span>
                </span>
                <span>
                  <span className="text-zinc-600">Cap </span>
                  <span className="font-mono font-semibold text-zinc-300">
                    {formatPercent(analysis.capRate, 2)}
                  </span>
                </span>
                <span>
                  <span className="text-zinc-600">IRR </span>
                  <span className="font-mono font-semibold text-zinc-300">
                    {fmtIRR(analysis.irr)}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function fmtIRR(irr: number): string {
  if (!isFinite(irr)) return "—";
  return `${(irr * 100).toFixed(1)}%`;
}
function fmtROI(roi: number): string {
  if (!isFinite(roi)) return "—";
  return `${(roi * 100).toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// Verdict-flip transparency (§16.U.1 / §20.9 #9). When a stress scenario
// changes the tier, surface WHICH metric drove the change so the user
// doesn't have to mentally diff the entire scorecard. Approach: walk the
// rubric breakdown and find the category whose point-delta (base → stressed)
// is the largest in magnitude. The cell shows "↓ on DSCR" or "↑ on IRR".
// Hovering gives the full base/stressed numbers.
// ---------------------------------------------------------------------------

function diagnoseVerdictFlip(
  base: DealAnalysis,
  next: DealAnalysis,
): { metric: string; direction: "up" | "down"; detail: string } | null {
  const baseBreakdown = base.verdict.breakdown;
  const nextBreakdown = next.verdict.breakdown;
  let worst: {
    category: string;
    delta: number;
    baseMetric: string;
    nextMetric: string;
  } | null = null;
  for (let i = 0; i < nextBreakdown.length; i++) {
    const nb = nextBreakdown[i];
    const bb = baseBreakdown.find((b) => b.category === nb.category);
    if (!bb) continue;
    const delta = nb.points - bb.points;
    if (Math.abs(delta) < 0.5) continue;
    if (!worst || Math.abs(delta) > Math.abs(worst.delta)) {
      worst = {
        category: nb.category,
        delta,
        baseMetric: bb.metric,
        nextMetric: nb.metric,
      };
    }
  }
  if (!worst) return null;
  const tierDirection: "up" | "down" =
    tierRank(next.verdict.tier) < tierRank(base.verdict.tier) ? "down" : "up";
  return {
    metric: shortMetricName(worst.category),
    direction: tierDirection,
    detail: `${worst.category}: ${worst.baseMetric} → ${worst.nextMetric}. Verdict flipped from ${TIER_LABEL[base.verdict.tier]} to ${TIER_LABEL[next.verdict.tier]} on this category's score change.`,
  };
}

function tierRank(t: VerdictTier): number {
  return { excellent: 4, good: 3, fair: 2, poor: 1, avoid: 0 }[t];
}

/** Compress the rubric category label to fit the verdict cell. */
function shortMetricName(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("cap")) return "cap rate";
  if (c.includes("cash-on-cash") || c.includes("coc")) return "CoC";
  if (c.includes("irr")) return "IRR";
  if (c.includes("dscr")) return "DSCR";
  if (c.includes("total roi") || c.includes("totalroi")) return "Total ROI";
  if (c.includes("rent multiplier") || c.includes("grm")) return "GRM";
  if (c.includes("1%") || c.includes("one percent")) return "1% rule";
  if (c.includes("vacancy")) return "vacancy";
  if (c.includes("expense")) return "expenses";
  if (c.includes("break-even")) return "break-even";
  return category.length > 18 ? category.slice(0, 18) + "…" : category;
}

function safeAnalyse(inputs: DealInputs): DealAnalysis | null {
  try {
    return analyseDeal(sanitiseInputs(inputs));
  } catch {
    return null;
  }
}

function DeltaSub({
  base,
  next,
  fmt,
  higherIsBetter,
  inline = false,
}: {
  base: number;
  next: number;
  fmt: (n: number) => string;
  higherIsBetter: boolean;
  inline?: boolean;
}) {
  if (!isFinite(base) || !isFinite(next)) return null;
  const delta = next - base;
  if (Math.abs(delta) < 0.005) return null;
  const isUp = delta > 0;
  const good = higherIsBetter ? isUp : !isUp;
  const cls = good ? "text-emerald-500/70" : "text-red-500/70";
  if (inline) {
    return (
      <span className={`ml-1 text-[10px] ${cls}`}>
        ({isUp ? "+" : "−"}{fmt(Math.abs(delta))})
      </span>
    );
  }
  return (
    <div className={`mt-0.5 text-[10px] font-normal ${cls}`}>
      {isUp ? "+" : "−"}{fmt(Math.abs(delta))}
    </div>
  );
}
