import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import InitialVerdict from "../_components/InitialVerdict";
import FollowUpChat from "../_components/FollowUpChat";
import SaveDealButton from "../_components/SaveDealButton";
import ShareButton from "../_components/ShareButton";
import {
  analyseDeal,
  DealAnalysis,
  formatCurrency,
  formatNumber,
  formatPercent,
  inputsFromSearchParams,
  inputsToSearchParams,
  VerdictTier,
  YearProjection,
} from "@/lib/calculations";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Design tokens — the accent color that drives every coloured element on the
// page is chosen by verdict tier. The AVOID/PASS/WEAK reds share #ef4444;
// BORDERLINE is #eab308; STRONG BUY/GOOD DEAL share #22c55e.
// ---------------------------------------------------------------------------

const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "STRONG BUY",
  good: "GOOD DEAL",
  fair: "BORDERLINE",
  poor: "WEAK DEAL",
  avoid: "AVOID",
};

const TIER_ACCENT: Record<VerdictTier, string> = {
  excellent: "#22c55e",
  good: "#22c55e",
  fair: "#eab308",
  poor: "#ef4444",
  avoid: "#ef4444",
};

const WARN_COLOR = "#eab308";
const BAD_COLOR = "#ef4444";

// ---------------------------------------------------------------------------

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const search = await searchParams;
  const inputs = inputsFromSearchParams(search);
  const analysis = analyseDeal(inputs);
  const addressRaw = search.address;
  const address =
    typeof addressRaw === "string" && addressRaw.trim()
      ? addressRaw.trim()
      : undefined;

  const editParams = inputsToSearchParams(inputs);
  if (address) editParams.set("address", address);
  const editHref = `/?${editParams.toString()}#analyze`;

  const resultsParams = inputsToSearchParams(inputs);
  if (address) resultsParams.set("address", address);
  const currentUrl = `/results?${resultsParams.toString()}`;

  const supaConfig = supabaseEnv();
  const user = supaConfig.configured ? await getCurrentUser() : null;

  const tier = analysis.verdict.tier;
  const accent = TIER_ACCENT[tier];
  const accentSoft = accent + "14"; // ~8% alpha (hex suffix)

  // CSS variables flow down to every child via inheritance. Client components
  // (InitialVerdict, FollowUpChat) read `var(--accent)` directly.
  const rootStyle: CSSProperties & Record<string, string> = {
    "--accent": accent,
    "--accent-soft": accentSoft,
  };

  return (
    <div
      style={rootStyle}
      className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100"
    >
      <Header
        editHref={editHref}
        currentUrl={currentUrl}
        supabaseConfigured={supaConfig.configured}
        signedIn={!!user}
      />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
          <VerdictSection
            tier={tier}
            analysis={analysis}
            address={address}
          />

          <SectionDivider />

          <EvidenceSection analysis={analysis} />

          <SectionDivider />

          <BreakdownSection analysis={analysis} />

          <SectionDivider />

          <ActionsSection
            editHref={editHref}
            currentUrl={currentUrl}
            inputs={inputs}
            address={address}
            signedIn={!!user}
            supabaseConfigured={supaConfig.configured}
          />

          <SectionDivider />

          <FollowUpChat inputs={inputs} />
        </div>
      </main>

      <footer className="border-t border-zinc-900 py-6">
        <div className="mx-auto max-w-5xl px-6 text-xs text-zinc-600">
          Figures are projections based on the inputs you provided. Verify
          assumptions independently before committing capital.
        </div>
      </footer>
    </div>
  );
}

// ===========================================================================
// HEADER
// ===========================================================================

function Header({
  editHref,
  currentUrl,
  supabaseConfigured,
  signedIn,
}: {
  editHref: string;
  currentUrl: string;
  supabaseConfigured: boolean;
  signedIn: boolean;
}) {
  return (
    <header className="border-b border-zinc-900">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded bg-zinc-100 text-xs font-bold text-zinc-900">
            RV
          </span>
          <span className="text-sm font-semibold tracking-tight text-zinc-100">
            RealVerdict<span className="text-zinc-500">ROI</span>
          </span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link
            href={editHref}
            className="font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            Edit inputs
          </Link>
          {supabaseConfigured &&
            (signedIn ? (
              <Link
                href="/dashboard"
                className="font-medium text-zinc-400 transition hover:text-zinc-100"
              >
                My deals
              </Link>
            ) : (
              <Link
                href={`/login?redirect=${encodeURIComponent(currentUrl)}`}
                className="font-medium text-zinc-400 transition hover:text-zinc-100"
              >
                Sign in
              </Link>
            ))}
        </nav>
      </div>
    </header>
  );
}

// ===========================================================================
// SECTION 1 — VERDICT
// ===========================================================================

function VerdictSection({
  tier,
  analysis,
  address,
}: {
  tier: VerdictTier;
  analysis: DealAnalysis;
  address: string | undefined;
}) {
  const { inputs } = analysis;

  const contextParts: string[] = [];
  if (address) contextParts.push(address);
  contextParts.push(formatCurrency(inputs.purchasePrice, 0));
  contextParts.push(`${formatCurrency(analysis.monthlyCashFlow, 0)}/mo`);
  contextParts.push(`Cap ${formatPercent(analysis.capRate, 1)}`);
  contextParts.push(
    `DSCR ${isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞"}`,
  );

  return (
    <section>
      <h1
        className="text-5xl font-bold uppercase leading-none tracking-tight sm:text-7xl"
        style={{ color: "var(--accent)" }}
      >
        {TIER_LABEL[tier]}
      </h1>
      <p className="mt-4 text-sm text-zinc-500">
        {contextParts.join("  ·  ")}
      </p>
      <div className="mt-8">
        <InitialVerdict
          inputs={inputs}
          fallback={analysis.verdict.summary}
        />
      </div>
    </section>
  );
}

// ===========================================================================
// SECTION 2 — EVIDENCE
// ===========================================================================

function EvidenceSection({ analysis }: { analysis: DealAnalysis }) {
  const ltv =
    analysis.inputs.purchasePrice > 0
      ? analysis.loanAmount / analysis.inputs.purchasePrice
      : 0;

  // Equity multiple = (total cash returned) / cash invested.
  // totalProfit already nets out the cash invested, so adding it back gives
  // total returned-on-cash, which divided by cash invested is the multiple.
  const equityMultiple =
    analysis.totalCashInvested > 0
      ? (analysis.totalProfit + analysis.totalCashInvested) /
        analysis.totalCashInvested
      : 0;

  // Total return = everything the deal produced: operating cash + principal
  // paydown + appreciation (before subtracting the cash invested).
  const totalReturn =
    analysis.totalCashFlow +
    analysis.totalPrincipalPaydown +
    analysis.totalAppreciation;

  return (
    <section>
      {/* Returns: hero cashflow, with CoC + cap rate as supporting stats */}
      <MetricGroup label="Returns">
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3 sm:items-end">
          <div className="sm:col-span-3">
            <MetricValueBig
              label="Cash flow / mo"
              value={formatCurrency(analysis.monthlyCashFlow, 0)}
              tone={analysis.monthlyCashFlow >= 0 ? "good" : "bad"}
              sub={`${formatCurrency(analysis.annualCashFlow, 0)} / year`}
            />
          </div>
          <MetricValue
            label="Cash-on-cash"
            value={formatPercent(analysis.cashOnCashReturn, 1)}
            tone={toneCoC(analysis.cashOnCashReturn)}
          />
          <MetricValue
            label="Cap rate"
            value={formatPercent(analysis.capRate, 2)}
            tone={toneCap(analysis.capRate)}
          />
          <MetricValue
            label="1% rule"
            value={formatPercent(analysis.onePercentRule, 2)}
            tone={
              analysis.onePercentRule >= 0.01
                ? "good"
                : analysis.onePercentRule >= 0.008
                  ? "warn"
                  : "bad"
            }
          />
        </div>
      </MetricGroup>

      <GroupDivider />

      {/* Risk: three equal columns */}
      <MetricGroup label="Risk">
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
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

      {/* Long term: three equal columns */}
      <MetricGroup label={`Long term · ${analysis.inputs.holdPeriodYears}-yr hold`}>
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
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
            label="Total return"
            value={formatCurrency(totalReturn, 0)}
            sub="cash flow + equity + appreciation"
            tone={
              totalReturn > 0
                ? "good"
                : totalReturn < 0
                  ? "bad"
                  : "neutral"
            }
          />
        </div>
      </MetricGroup>
    </section>
  );
}

type Tone = "good" | "warn" | "bad" | "neutral";

function toneToStyle(tone: Tone): CSSProperties {
  switch (tone) {
    case "good":
      return { color: "var(--accent)" };
    case "warn":
      return { color: WARN_COLOR };
    case "bad":
      return { color: BAD_COLOR };
    default:
      return {};
  }
}

function toneCoC(v: number): Tone {
  if (v >= 0.08) return "good";
  if (v >= 0.04) return "warn";
  if (v < 0) return "bad";
  return "neutral";
}
function toneCap(v: number): Tone {
  if (v >= 0.06) return "good";
  if (v >= 0.04) return "warn";
  if (v < 0.03) return "bad";
  return "neutral";
}
function toneDSCR(v: number): Tone {
  if (!isFinite(v)) return "good";
  if (v >= 1.25) return "good";
  if (v >= 1.0) return "warn";
  return "bad";
}
function toneBreakEven(v: number): Tone {
  if (v <= 0.75) return "good";
  if (v <= 0.9) return "warn";
  return "bad";
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

function MetricValueBig({
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
        className="mt-1 font-mono text-5xl font-semibold tabular-nums sm:text-6xl"
        style={toneToStyle(tone)}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

// ===========================================================================
// SECTION 3 — BREAKDOWN
// ===========================================================================

function BreakdownSection({ analysis }: { analysis: DealAnalysis }) {
  return (
    <section className="flex flex-col gap-10">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        Breakdown
      </div>
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
    <Panel title="Monthly cash flow" subtitle={formatCurrency(grossInflow, 0) + " in · " + formatCurrency(grossInflow - analysis.monthlyCashFlow, 0) + " out"}>
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

function ProjectionTable({ projection }: { projection: YearProjection[] }) {
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

type Row = { label: string; value: number; positive?: boolean };

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

// ===========================================================================
// SECTION 4 — ACTIONS
// ===========================================================================

function ActionsSection({
  editHref,
  currentUrl,
  inputs,
  address,
  signedIn,
  supabaseConfigured,
}: {
  editHref: string;
  currentUrl: string;
  inputs: DealAnalysis["inputs"];
  address: string | undefined;
  signedIn: boolean;
  supabaseConfigured: boolean;
}) {
  const columns = supabaseConfigured
    ? "sm:grid-cols-3"
    : "sm:grid-cols-2";
  return (
    <section className={`grid grid-cols-1 gap-3 ${columns}`}>
      <Link
        href={editHref}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-700 hover:bg-zinc-900"
      >
        <EditIcon />
        <span>Adjust the deal</span>
      </Link>
      <SaveDealButton
        inputs={inputs}
        address={address}
        currentUrl={currentUrl}
        signedIn={signedIn}
        supabaseConfigured={supabaseConfigured}
      />
      <ShareButton path={currentUrl} />
    </section>
  );
}

function EditIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-zinc-400"
      aria-hidden="true"
    >
      <path d="M13.6 2.6a2 2 0 012.8 0l1 1a2 2 0 010 2.8l-9.5 9.5L3.5 17l1.1-4.4 9-10zM12 5.4L5.8 11.6l-.6 2.3 2.3-.6L13.7 7 12 5.4z" />
    </svg>
  );
}

// ===========================================================================
// Small shared primitives
// ===========================================================================

function SectionDivider() {
  return (
    <div
      className="my-12 h-px"
      style={{ backgroundColor: "var(--accent-soft)" }}
    />
  );
}

function GroupDivider() {
  return <div className="my-8 h-px bg-zinc-900" />;
}
