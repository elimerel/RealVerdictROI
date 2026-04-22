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

const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "STRONG BUY",
  good: "GOOD DEAL",
  fair: "BORDERLINE",
  poor: "PASS",
  avoid: "AVOID",
};

const TIER_COLOR: Record<VerdictTier, string> = {
  excellent: "text-emerald-400",
  good: "text-emerald-400",
  fair: "text-amber-400",
  poor: "text-red-400",
  avoid: "text-red-400",
};

type Scenario = {
  key: string;
  label: string;
  description: string;
  apply: (base: DealInputs) => DealInputs;
};

const SCENARIOS: Scenario[] = [
  {
    key: "rent-drop",
    label: "Rent drops 10%",
    description: "Soft rental market or you misjudged comps",
    apply: (b) => ({ ...b, monthlyRent: Math.round(b.monthlyRent * 0.9) }),
  },
  {
    key: "rate-up",
    label: "Refi rate +1pt",
    description: "If you bought variable or have to refi at a higher rate",
    apply: (b) => ({
      ...b,
      loanInterestRate: b.loanInterestRate + 1,
    }),
  },
  {
    key: "vacancy-bad-year",
    label: "Bad year: 1.5 mo vacancy",
    description: "Eviction, turnover, or a long re-rent",
    apply: (b) => ({
      ...b,
      vacancyRatePercent: Math.max(b.vacancyRatePercent, 12.5),
    }),
  },
  {
    key: "expenses-spike",
    label: "Expenses jump 25%",
    description: "Roof, HVAC, insurance hike, or a big-ticket repair year",
    apply: (b) => ({
      ...b,
      maintenancePercent: b.maintenancePercent * 1.25,
      annualInsurance: Math.round(b.annualInsurance * 1.25),
      annualPropertyTax: Math.round(b.annualPropertyTax * 1.05),
    }),
  },
  {
    key: "exit-down",
    label: "Sells 10% below today",
    description: "If the area cools and you exit at a discount",
    apply: (b) => ({
      ...b,
      annualAppreciationPercent:
        b.annualAppreciationPercent -
        100 *
          (1 - Math.pow(0.9, 1 / Math.max(1, b.holdPeriodYears))),
    }),
  },
];

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
        <div className="hidden sm:grid sm:grid-cols-[1.7fr_1fr_1fr_1fr_0.9fr] divide-x divide-zinc-800 bg-zinc-900/40">
          <Th>Scenario</Th>
          <Th align="right">Cash flow</Th>
          <Th align="right">DSCR</Th>
          <Th align="right">Cap rate</Th>
          <Th align="right">Verdict</Th>
        </div>

        {results.map(({ scenario, analysis }) => (
          <div
            key={scenario.key}
            className="grid grid-cols-1 sm:grid-cols-[1.7fr_1fr_1fr_1fr_0.9fr] divide-y divide-zinc-800 border-t border-zinc-800 sm:divide-y-0 sm:divide-x"
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
                <Cell
                  align="right"
                  className={`text-xs font-bold uppercase tracking-wider ${TIER_COLOR[analysis.verdict.tier]}`}
                >
                  {TIER_LABEL[analysis.verdict.tier]}
                </Cell>
              </>
            ) : (
              <Cell className="text-xs text-zinc-500">
                Could not run this scenario.
              </Cell>
            )}
          </div>
        ))}
      </div>
    </section>
  );
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
