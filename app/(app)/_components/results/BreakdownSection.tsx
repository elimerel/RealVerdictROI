import type { ReactNode } from "react";
import {
  type DealAnalysis,
  formatCurrency,
  type YearProjection,
} from "@/lib/calculations";
import { toneToStyle } from "./tier-style";

// ---------------------------------------------------------------------------
// Breakdown section — the "show your work" tab. Four tables:
//   MonthlyWaterfall — rent → vacancy → opex → debt = net cash flow
//   CashToClose      — down + closing + rehab = total cash in
//   ProjectionTable  — year-by-year pro forma across the hold period
//   SaleProceeds     — exit math at holdPeriodYears
//
// All the small layout primitives (Panel / Table / TableRow / signedCurrency)
// live at the bottom. They're tightly coupled to these four tables and not
// used elsewhere; inlining them keeps the file self-contained and spares the
// rest of the app from the "shared-table-primitives" abstraction tax.
// ---------------------------------------------------------------------------

type Row = { label: string; value: number; positive?: boolean };

export default function BreakdownSection({
  analysis,
}: {
  analysis: DealAnalysis;
}) {
  return (
    <section className="flex flex-col gap-10">
      <MonthlyWaterfall analysis={analysis} />
      <CashToClose analysis={analysis} />
      <ProjectionTable projection={analysis.projection} />
      <SaleProceeds analysis={analysis} />
    </section>
  );
}

function MonthlyWaterfall({ analysis }: { analysis: DealAnalysis }) {
  const { inputs } = analysis;

  const grossRent = inputs.monthlyRent;
  const otherIncome = inputs.otherMonthlyIncome;
  const grossInflow = grossRent + otherIncome;

  // Approximate monthly opex by averaging year 1.
  const monthlyPropertyTax = inputs.annualPropertyTax / 12;
  const monthlyInsurance = inputs.annualInsurance / 12;
  const monthlyMaintenance =
    (analysis.annualGrossIncome * (inputs.maintenancePercent / 100)) / 12;
  const monthlyPM =
    (analysis.annualGrossIncome * (inputs.propertyManagementPercent / 100)) /
    12;
  const monthlyCapEx =
    (analysis.annualGrossIncome * (inputs.capexReservePercent / 100)) / 12;
  const monthlyVacancy = grossRent * (inputs.vacancyRatePercent / 100);

  const rows: Row[] = [
    { label: "Monthly rent", value: grossRent, positive: true },
    otherIncome > 0
      ? { label: "Other income", value: otherIncome, positive: true }
      : null,
    { label: "— Vacancy", value: -monthlyVacancy },
    inputs.annualPropertyTax > 0
      ? { label: "— Property tax", value: -monthlyPropertyTax }
      : null,
    inputs.annualInsurance > 0
      ? { label: "— Insurance", value: -monthlyInsurance }
      : null,
    inputs.monthlyHOA > 0
      ? { label: "— HOA", value: -inputs.monthlyHOA }
      : null,
    inputs.monthlyUtilities > 0
      ? { label: "— Utilities", value: -inputs.monthlyUtilities }
      : null,
    {
      label: `— Maintenance (${inputs.maintenancePercent}%)`,
      value: -monthlyMaintenance,
    },
    inputs.propertyManagementPercent > 0
      ? {
          label: `— Property mgmt (${inputs.propertyManagementPercent}%)`,
          value: -monthlyPM,
        }
      : null,
    inputs.capexReservePercent > 0
      ? {
          label: `— CapEx reserve (${inputs.capexReservePercent}%)`,
          value: -monthlyCapEx,
        }
      : null,
    analysis.monthlyMortgagePayment > 0
      ? {
          label: "— Mortgage (P&I)",
          value: -analysis.monthlyMortgagePayment,
        }
      : null,
  ].filter((r): r is Row => r !== null);

  return (
    <Panel
      title="Monthly cash flow"
      subtitle={
        formatCurrency(grossInflow, 0) +
        " in · " +
        formatCurrency(grossInflow - analysis.monthlyCashFlow, 0) +
        " out"
      }
    >
      <Table>
        {rows.map((r, i) => (
          <TableRow key={r.label} alt={i % 2 === 1}>
            <td className="py-2.5 text-left text-sm text-zinc-300">
              {r.label}
            </td>
            <td
              className={`py-2.5 text-right font-mono text-sm tabular-nums ${r.value < 0 ? "text-zinc-400" : "text-zinc-100"}`}
            >
              {signedCurrency(r.value)}
            </td>
          </TableRow>
        ))}
        <TableRow bold>
          <td className="pt-3 text-left text-sm font-semibold text-zinc-100">
            Net cash flow
          </td>
          <td
            className="pt-3 text-right font-mono text-base font-semibold tabular-nums"
            style={toneToStyle(
              analysis.monthlyCashFlow >= 0 ? "good" : "bad",
            )}
          >
            {signedCurrency(analysis.monthlyCashFlow)}
          </td>
        </TableRow>
      </Table>
    </Panel>
  );
}

function CashToClose({ analysis }: { analysis: DealAnalysis }) {
  const { inputs } = analysis;
  const rows: Row[] = [
    {
      label: `Down payment (${inputs.downPaymentPercent}%)`,
      value: analysis.downPayment,
    },
    {
      label: `Closing costs (${inputs.closingCostsPercent}%)`,
      value: analysis.closingCosts,
    },
    inputs.rehabCosts > 0
      ? { label: "Rehab", value: inputs.rehabCosts }
      : null,
  ].filter((r): r is Row => r !== null);

  return (
    <Panel
      title="Cash to close"
      subtitle={`Loan: ${formatCurrency(analysis.loanAmount, 0)} at ${inputs.loanInterestRate}% for ${inputs.loanTermYears} years`}
    >
      <Table>
        {rows.map((r, i) => (
          <TableRow key={r.label} alt={i % 2 === 1}>
            <td className="py-2.5 text-left text-sm text-zinc-300">
              {r.label}
            </td>
            <td className="py-2.5 text-right font-mono text-sm tabular-nums text-zinc-100">
              {formatCurrency(r.value, 0)}
            </td>
          </TableRow>
        ))}
        <TableRow bold>
          <td className="pt-3 text-left text-sm font-semibold text-zinc-100">
            Total cash needed
          </td>
          <td
            className="pt-3 text-right font-mono text-base font-semibold tabular-nums"
            style={{ color: "var(--accent)" }}
          >
            {formatCurrency(analysis.totalCashInvested, 0)}
          </td>
        </TableRow>
      </Table>
    </Panel>
  );
}

function ProjectionTable({
  projection,
}: {
  projection: YearProjection[];
}) {
  if (projection.length === 0) return null;
  return (
    <Panel title={`Year-by-year · ${projection.length}-yr projection`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2.5 text-left font-medium">Year</th>
              <th className="px-3 py-2.5 text-right font-medium">
                Gross rent
              </th>
              <th className="px-3 py-2.5 text-right font-medium">NOI</th>
              <th className="px-3 py-2.5 text-right font-medium">
                Debt service
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                Cash flow
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                Cumulative
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                Loan balance
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                Property value
              </th>
              <th className="px-3 py-2.5 text-right font-medium">Equity</th>
            </tr>
          </thead>
          <tbody>
            {projection.map((row, i) => (
              <tr
                key={row.year}
                className={i % 2 === 1 ? "bg-zinc-900/40" : ""}
              >
                <td className="px-3 py-2.5 text-left font-medium text-zinc-100">
                  Y{row.year}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-300 tabular-nums">
                  {formatCurrency(row.grossRent, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-300 tabular-nums">
                  {formatCurrency(row.noi, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-500 tabular-nums">
                  {row.debtService > 0
                    ? formatCurrency(row.debtService, 0)
                    : "—"}
                </td>
                <td
                  className="px-3 py-2.5 text-right font-mono tabular-nums"
                  style={toneToStyle(row.cashFlow >= 0 ? "good" : "bad")}
                >
                  {formatCurrency(row.cashFlow, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-300 tabular-nums">
                  {formatCurrency(row.cumulativeCashFlow, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-500 tabular-nums">
                  {formatCurrency(row.loanBalanceEnd, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-300 tabular-nums">
                  {formatCurrency(row.propertyValueEnd, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold text-zinc-100 tabular-nums">
                  {formatCurrency(row.equityEnd, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SaleProceeds({ analysis }: { analysis: DealAnalysis }) {
  const { inputs } = analysis;
  return (
    <Panel
      title={`Sale proceeds · exit year ${analysis.saleYear}`}
      subtitle={`Assumes ${inputs.annualAppreciationPercent}%/yr appreciation, ${inputs.sellingCostsPercent}% selling costs`}
    >
      <Table>
        <TableRow>
          <td className="py-2.5 text-left text-sm text-zinc-300">
            Projected sale price
          </td>
          <td className="py-2.5 text-right font-mono text-sm tabular-nums text-zinc-100">
            {formatCurrency(analysis.salePrice, 0)}
          </td>
        </TableRow>
        <TableRow alt>
          <td className="py-2.5 text-left text-sm text-zinc-300">
            — Selling costs ({inputs.sellingCostsPercent}%)
          </td>
          <td className="py-2.5 text-right font-mono text-sm tabular-nums text-zinc-400">
            {signedCurrency(-analysis.sellingCosts)}
          </td>
        </TableRow>
        <TableRow>
          <td className="py-2.5 text-left text-sm text-zinc-300">
            — Loan payoff
          </td>
          <td className="py-2.5 text-right font-mono text-sm tabular-nums text-zinc-400">
            {signedCurrency(-analysis.loanBalanceAtExit)}
          </td>
        </TableRow>
        <TableRow bold>
          <td className="pt-3 text-left text-sm font-semibold text-zinc-100">
            Net sale proceeds
          </td>
          <td
            className="pt-3 text-right font-mono text-base font-semibold tabular-nums"
            style={{ color: "var(--accent)" }}
          >
            {formatCurrency(analysis.netSaleProceeds, 0)}
          </td>
        </TableRow>
      </Table>
    </Panel>
  );
}

function signedCurrency(n: number): string {
  const formatted = formatCurrency(Math.abs(n), 0);
  if (n < 0) return `−${formatted}`;
  return formatted;
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        {subtitle && (
          <span className="text-xs text-zinc-500">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Table({ children }: { children: ReactNode }) {
  return (
    <table className="w-full border-collapse">
      <tbody>{children}</tbody>
    </table>
  );
}

function TableRow({
  children,
  alt = false,
  bold = false,
}: {
  children: ReactNode;
  alt?: boolean;
  bold?: boolean;
}) {
  const cls = [
    alt ? "bg-zinc-900/40" : "",
    bold ? "border-t border-zinc-800" : "",
  ]
    .join(" ")
    .trim();
  return <tr className={cls}>{children}</tr>;
}
