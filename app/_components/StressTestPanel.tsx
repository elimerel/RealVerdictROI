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
          Each scenario keeps every other input the same and changes one thing.
          The verdict you see is what the same engine produces under stress.
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <div className="hidden sm:grid sm:grid-cols-[1.6fr_0.95fr_0.7fr_0.85fr_0.85fr_0.95fr_1fr] divide-x divide-zinc-800 bg-zinc-900/40">
          <Th>Scenario</Th>
          <Th align="right">Cash flow</Th>
          <Th align="right">DSCR</Th>
          <Th align="right">Cap rate</Th>
          <Th align="right">IRR</Th>
          <Th align="right">Total ROI</Th>
          <Th align="right">Verdict</Th>
        </div>

        {results.map(({ scenario, analysis }) => {
          const flip =
            analysis && analysis.verdict.tier !== baseAnalysis.verdict.tier
              ? diagnoseVerdictFlip(baseAnalysis, analysis)
              : null;
          return (
            <div
              key={scenario.key}
              className="grid grid-cols-1 sm:grid-cols-[1.6fr_0.95fr_0.7fr_0.85fr_0.85fr_0.95fr_1fr] divide-y divide-zinc-800 border-t border-zinc-800 sm:divide-y-0 sm:divide-x"
            >
              <Cell>
                <div className="text-sm font-medium text-zinc-100">
                  {scenario.label}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {scenario.description}
                </div>
              </Cell>
              {analysis ? (
                <>
                  <Cell
                    align="right"
                    mono
                    className={
                      analysis.monthlyCashFlow >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }
                  >
                    {formatCurrency(analysis.monthlyCashFlow, 0)}/mo
                    <DeltaSub
                      base={baseAnalysis.monthlyCashFlow}
                      next={analysis.monthlyCashFlow}
                      fmt={(n) => `${formatCurrency(n, 0)}/mo`}
                      higherIsBetter
                    />
                  </Cell>
                  <Cell align="right" mono className="text-zinc-100">
                    {isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞"}
                    <DeltaSub
                      base={baseAnalysis.dscr}
                      next={analysis.dscr}
                      fmt={(n) => n.toFixed(2)}
                      higherIsBetter
                      skipIfBaseInfinite
                    />
                  </Cell>
                  <Cell align="right" mono className="text-zinc-100">
                    {formatPercent(analysis.capRate, 2)}
                    <DeltaSub
                      base={baseAnalysis.capRate}
                      next={analysis.capRate}
                      fmt={(n) => `${(n * 100).toFixed(2)}pt`}
                      higherIsBetter
                    />
                  </Cell>
                  <Cell align="right" mono className="text-zinc-100">
                    {fmtIRR(analysis.irr)}
                    <DeltaSub
                      base={baseAnalysis.irr}
                      next={analysis.irr}
                      fmt={(n) => `${(n * 100).toFixed(1)}pt`}
                      higherIsBetter
                      skipIfBaseInfinite
                    />
                  </Cell>
                  <Cell align="right" mono className="text-zinc-100">
                    {fmtROI(analysis.totalROI)}
                    <DeltaSub
                      base={baseAnalysis.totalROI}
                      next={analysis.totalROI}
                      fmt={(n) => `${(n * 100).toFixed(0)}pt`}
                      higherIsBetter
                    />
                  </Cell>
                  <Cell
                    align="right"
                    className={`text-xs font-bold uppercase tracking-wider ${TIER_COLOR[analysis.verdict.tier]}`}
                  >
                    {TIER_LABEL[analysis.verdict.tier]}
                    {flip && (
                      <div
                        className="mt-1 text-[10px] font-normal normal-case tracking-normal text-zinc-400"
                        title={flip.detail}
                      >
                        {flip.direction === "down" ? "↓" : "↑"} on {flip.metric}
                      </div>
                    )}
                  </Cell>
                </>
              ) : (
                <Cell className="text-xs text-zinc-500">
                  Could not run this scenario.
                </Cell>
              )}
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

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div
      className={`px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </div>
  );
}

function Cell({
  children,
  align = "left",
  mono = false,
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`px-4 py-3 text-sm ${align === "right" ? "text-right" : ""} ${
        mono ? "font-mono tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

function DeltaSub({
  base,
  next,
  fmt,
  higherIsBetter,
  skipIfBaseInfinite = false,
}: {
  base: number;
  next: number;
  fmt: (n: number) => string;
  higherIsBetter: boolean;
  skipIfBaseInfinite?: boolean;
}) {
  if (!isFinite(base) || !isFinite(next)) return null;
  if (skipIfBaseInfinite && !isFinite(base)) return null;
  const delta = next - base;
  if (Math.abs(delta) < 0.005) return null;
  const isUp = delta > 0;
  const good = higherIsBetter ? isUp : !isUp;
  return (
    <div
      className={`mt-0.5 text-[10px] font-normal ${good ? "text-emerald-500/70" : "text-red-500/70"}`}
    >
      {isUp ? "+" : "−"}
      {fmt(Math.abs(delta))}
    </div>
  );
}
