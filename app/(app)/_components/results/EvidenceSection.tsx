import type { ReactNode } from "react";
import {
  type DealAnalysis,
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/calculations";
import type { CompsResult } from "@/lib/comps";
import {
  type Tone,
  toneToStyle,
  toneCoC,
  toneCap,
  toneDSCR,
  toneBreakEven,
  toneGRM,
} from "./tier-style";

// ---------------------------------------------------------------------------
// Evidence section — the investor-facing scoreboard on the Numbers tab.
//
// Four metric groups (Subject vs Market / Returns / Risk / Long Term) with
// consistent tone logic. Subject-vs-market is hidden when comps are null
// (fast-estimate path per §20.8) so the empty state is implicit rather
// than a separate render path.
// ---------------------------------------------------------------------------

export default function EvidenceSection({
  analysis,
  comps,
}: {
  analysis: DealAnalysis;
  comps: CompsResult | null;
}) {
  const ltv =
    analysis.inputs.purchasePrice > 0
      ? analysis.loanAmount / analysis.inputs.purchasePrice
      : 0;

  // Market-context anchors. Each block compares a deal-side number against
  // the equivalent comp median and produces a short "vs market" sub-line.
  const subjectPrice = analysis.inputs.purchasePrice;
  const subjectRent = analysis.inputs.monthlyRent;
  const saleMedian = comps?.saleComps.stats.median;
  const rentMedian = comps?.rentComps.stats.median;

  const cashFlowSub = formatCurrency(analysis.annualCashFlow, 0) + " / year";
  const capRateSub = (() => {
    if (!saleMedian || !rentMedian) return undefined;
    // Market cap-rate proxy: comp median NOI / comp median price. We can't
    // measure NOI from RentCast, so approximate using subject's expense ratio
    // applied to median rent — gives a same-market apples-to-apples baseline.
    const subjectExpenseRatio = analysis.operatingExpenseRatio || 0.4;
    const marketAnnualNOI = rentMedian * 12 * (1 - subjectExpenseRatio);
    const marketCap = saleMedian > 0 ? marketAnnualNOI / saleMedian : 0;
    if (!marketCap) return undefined;
    return `Market cap ~${formatPercent(marketCap, 1)}`;
  })();
  const priceSub = saleMedian
    ? `Median sale ${formatCurrency(saleMedian, 0)}`
    : undefined;
  const rentSub = rentMedian
    ? `Median rent ${formatCurrency(rentMedian, 0)}/mo`
    : undefined;

  // Equity multiple = (total cash returned) / cash invested.
  // totalProfit already nets out the cash invested, so adding it back gives
  // total returned-on-cash, which divided by cash invested is the multiple.
  const equityMultiple =
    analysis.totalCashInvested > 0
      ? (analysis.totalProfit + analysis.totalCashInvested) /
        analysis.totalCashInvested
      : 0;

  // Total profit ($) = everything the deal produced over the hold:
  // operating cash + principal paydown + appreciation (before subtracting
  // cash invested). This is DISTINCT from "Total ROI" which is a
  // percentage (profit / cash invested) shown on the Stress tab and in
  // What-if. The labels used to both say "Total return" which made them
  // look like the same metric — fixed to "Total profit" for the $ field
  // to remove ambiguity.
  const totalProfit =
    analysis.totalCashFlow +
    analysis.totalPrincipalPaydown +
    analysis.totalAppreciation;

  return (
    <section>
      {(priceSub || rentSub) && (
        <>
          <MetricGroup label="Subject vs market">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3 sm:gap-y-6">
              <MetricValue
                label="Purchase price"
                value={formatCurrency(subjectPrice, 0)}
                tone="neutral"
                sub={priceSub}
              />
              <MetricValue
                label="Monthly rent"
                value={formatCurrency(subjectRent, 0)}
                tone="neutral"
                sub={rentSub}
              />
              <MetricValue
                label="Price / annual rent (GRM)"
                value={`${analysis.grossRentMultiplier.toFixed(1)}×`}
                tone={toneGRM(analysis.grossRentMultiplier)}
                sub={
                  saleMedian && rentMedian
                    ? `Market ~${(saleMedian / (rentMedian * 12)).toFixed(1)}×`
                    : undefined
                }
              />
            </div>
          </MetricGroup>
          <GroupDivider />
        </>
      )}

      <MetricGroup label="Returns">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3 sm:gap-y-6">
          <MetricValue
            label="Cash flow / mo"
            value={formatCurrency(analysis.monthlyCashFlow, 0)}
            tone={analysis.monthlyCashFlow >= 0 ? "good" : "bad"}
            sub={cashFlowSub}
          />
          <MetricValue
            label="Cash-on-cash"
            value={formatPercent(analysis.cashOnCashReturn, 1)}
            tone={toneCoC(analysis.cashOnCashReturn)}
          />
          <MetricValue
            label="Cap rate"
            value={formatPercent(analysis.capRate, 2)}
            tone={toneCap(analysis.capRate)}
            sub={capRateSub}
          />
        </div>
      </MetricGroup>

      <GroupDivider />

      <MetricGroup label="Risk">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3 sm:gap-y-6">
          <MetricValue
            label="DSCR"
            value={
              isFinite(analysis.dscr)
                ? formatNumber(analysis.dscr, 2)
                : "∞"
            }
            tone={toneDSCR(analysis.dscr)}
          />
          <MetricValue
            label="Break-even occupancy"
            value={formatPercent(analysis.breakEvenOccupancy, 0)}
            tone={toneBreakEven(analysis.breakEvenOccupancy)}
          />
          <MetricValue
            label="LTV"
            value={formatPercent(ltv, 0)}
            tone="neutral"
          />
        </div>
      </MetricGroup>

      <GroupDivider />

      <MetricGroup label="Long term">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3 sm:gap-y-6">
          <MetricValue
            label={`${analysis.inputs.holdPeriodYears}-yr IRR`}
            value={formatPercent(analysis.irr, 1)}
            tone={
              analysis.irr >= 0.1
                ? "good"
                : analysis.irr < 0
                  ? "bad"
                  : "neutral"
            }
          />
          <MetricValue
            label="Equity multiple"
            value={`${formatNumber(equityMultiple, 2)}x`}
            tone={
              equityMultiple >= 2
                ? "good"
                : equityMultiple < 1
                  ? "bad"
                  : "neutral"
            }
          />
          <MetricValue
            label="Total profit"
            value={formatCurrency(totalProfit, 0)}
            sub="cash flow + equity + appreciation"
            tone={
              totalProfit > 0
                ? "good"
                : totalProfit < 0
                  ? "bad"
                  : "neutral"
            }
          />
        </div>
      </MetricGroup>
    </section>
  );
}

function MetricGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-6 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function MetricValue({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div
        className="mt-1.5 font-mono text-3xl font-semibold tabular-nums"
        style={toneToStyle(tone)}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-zinc-600">{sub}</div>}
    </div>
  );
}

export function GroupDivider() {
  return <div className="my-8 h-px bg-zinc-900" />;
}
