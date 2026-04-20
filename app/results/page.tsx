import Link from "next/link";
import DealChat from "../_components/DealChat";
import SaveDealButton from "../_components/SaveDealButton";
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

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950">
      <header className="border-b border-zinc-200/70 bg-white/70 backdrop-blur-sm dark:border-zinc-800/70 dark:bg-black/40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white dark:bg-white dark:text-zinc-900">
              RV
            </span>
            <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              RealVerdict<span className="text-zinc-400">ROI</span>
            </span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href={editHref}
              className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              ← Edit inputs
            </Link>
            {supaConfig.configured &&
              (user ? (
                <Link
                  href="/dashboard"
                  className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  My deals
                </Link>
              ) : (
                <Link
                  href={`/login?redirect=${encodeURIComponent(currentUrl)}`}
                  className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Sign in
                </Link>
              ))}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-6 py-12">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {address ? (
              <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4 text-zinc-400"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18s-6-5.33-6-10a6 6 0 1112 0c0 4.67-6 10-6 10zm0-7a3 3 0 100-6 3 3 0 000 6z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{address}</span>
              </div>
            ) : (
              <span />
            )}
            <SaveDealButton
              inputs={inputs}
              address={address}
              currentUrl={currentUrl}
              signedIn={!!user}
              supabaseConfigured={supaConfig.configured}
            />
          </div>
          <VerdictHero analysis={analysis} />
          <KeyMetrics analysis={analysis} />
          <IncomeExpenseBreakdown analysis={analysis} />
          <CashInvestedBreakdown analysis={analysis} />
          <ProjectionTable projection={analysis.projection} />
          <ExitSummary analysis={analysis} />
          <DealChat inputs={analysis.inputs} />
          <Assumptions analysis={analysis} />

          <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              This page is deep-linkable — share the URL to share the exact deal.
            </p>
            <Link
              href={editHref}
              className="inline-flex h-11 w-fit items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Tweak the deal →
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-200/70 dark:border-zinc-800/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 text-xs text-zinc-500 dark:text-zinc-500">
          Figures are projections based on the inputs you provided. Verify
          assumptions independently before committing capital.
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function VerdictHero({ analysis }: { analysis: DealAnalysis }) {
  const { verdict } = analysis;
  const palette = TIER_PALETTE[verdict.tier];

  return (
    <section
      className={`mb-10 overflow-hidden rounded-3xl border ${palette.border} ${palette.bg}`}
    >
      <div className="flex flex-col gap-8 p-8 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-4 lg:max-w-2xl">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest ${palette.pill}`}
            >
              Verdict · {verdict.tier}
            </span>
            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
              Score {Math.round(verdict.score)} / 100
            </span>
          </div>
          <h1
            className={`text-3xl font-semibold tracking-tight sm:text-4xl ${palette.headline}`}
          >
            {verdict.headline}
          </h1>
          <p className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
            {verdict.summary}
          </p>
        </div>
        <div
          className={`flex flex-col items-center justify-center rounded-2xl ${palette.scoreBg} px-8 py-6 text-center`}
        >
          <span className="text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Deal score
          </span>
          <span
            className={`mt-1 font-mono text-6xl font-bold leading-none ${palette.headline}`}
          >
            {Math.round(verdict.score)}
          </span>
          <span className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            out of 100
          </span>
        </div>
      </div>

      {(verdict.strengths.length > 0 || verdict.risks.length > 0) && (
        <div className="grid grid-cols-1 gap-px bg-zinc-200 dark:bg-zinc-800 sm:grid-cols-2">
          <div className="bg-white p-6 dark:bg-zinc-950">
            <h3 className="mb-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              Strengths
            </h3>
            {verdict.strengths.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No meaningful strengths surfaced.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {verdict.strengths.map((s) => (
                  <li
                    key={s}
                    className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <CheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-white p-6 dark:bg-zinc-950">
            <h3 className="mb-3 text-sm font-semibold text-amber-600 dark:text-amber-400">
              Risks
            </h3>
            {verdict.risks.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No material risks flagged — nice.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {verdict.risks.map((r) => (
                  <li
                    key={r}
                    className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <AlertIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function KeyMetrics({ analysis }: { analysis: DealAnalysis }) {
  const tiles: Array<{
    label: string;
    value: string;
    sub?: string;
    tone?: "positive" | "negative" | "neutral";
  }> = [
    {
      label: "Monthly cash flow",
      value: formatCurrency(analysis.monthlyCashFlow),
      sub: `${formatCurrency(analysis.annualCashFlow)} / year`,
      tone: analysis.monthlyCashFlow >= 0 ? "positive" : "negative",
    },
    {
      label: "Cash-on-cash return",
      value: formatPercent(analysis.cashOnCashReturn),
      sub: `On ${formatCurrency(analysis.totalCashInvested)} invested`,
      tone: analysis.cashOnCashReturn >= 0.08
        ? "positive"
        : analysis.cashOnCashReturn >= 0
          ? "neutral"
          : "negative",
    },
    {
      label: "Cap rate",
      value: formatPercent(analysis.capRate),
      sub: `NOI ${formatCurrency(analysis.annualNOI)}`,
    },
    {
      label: "DSCR",
      value: isFinite(analysis.dscr) ? formatNumber(analysis.dscr, 2) : "∞",
      sub:
        analysis.annualDebtService > 0
          ? `${formatCurrency(analysis.annualNOI)} ÷ ${formatCurrency(analysis.annualDebtService)}`
          : "No debt",
      tone: !isFinite(analysis.dscr)
        ? "positive"
        : analysis.dscr >= 1.25
          ? "positive"
          : analysis.dscr >= 1
            ? "neutral"
            : "negative",
    },
    {
      label: `${analysis.inputs.holdPeriodYears}-yr IRR`,
      value: formatPercent(analysis.irr),
      sub: "Annualised, after sale",
      tone:
        analysis.irr >= 0.1
          ? "positive"
          : analysis.irr >= 0
            ? "neutral"
            : "negative",
    },
    {
      label: `Total ROI (${analysis.inputs.holdPeriodYears} yrs)`,
      value: formatPercent(analysis.totalROI),
      sub: `${formatCurrency(analysis.totalProfit)} profit`,
      tone:
        analysis.totalROI >= 0.5
          ? "positive"
          : analysis.totalROI >= 0
            ? "neutral"
            : "negative",
    },
    {
      label: "Gross rent multiplier",
      value: formatNumber(analysis.grossRentMultiplier, 1),
      sub: "Price ÷ annual rent",
    },
    {
      label: "Break-even occupancy",
      value: formatPercent(analysis.breakEvenOccupancy, 0),
      sub: "Occupancy needed to cover everything",
      tone:
        analysis.breakEvenOccupancy <= 0.85
          ? "positive"
          : analysis.breakEvenOccupancy <= 0.95
            ? "neutral"
            : "negative",
    },
  ];

  return (
    <section className="mb-12">
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Key metrics
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <MetricTile key={tile.label} {...tile} />
        ))}
      </div>
    </section>
  );
}

function MetricTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const tones = {
    positive: "text-emerald-600 dark:text-emerald-400",
    negative: "text-red-600 dark:text-red-400",
    neutral: "text-zinc-900 dark:text-zinc-50",
  } as const;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className={`mt-2 font-mono text-2xl font-semibold ${tones[tone]}`}>
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          {sub}
        </div>
      )}
    </div>
  );
}

function IncomeExpenseBreakdown({ analysis }: { analysis: DealAnalysis }) {
  const { inputs } = analysis;
  const fixedOpexAnnual =
    inputs.annualPropertyTax +
    inputs.annualInsurance +
    inputs.monthlyHOA * 12 +
    inputs.monthlyUtilities * 12;
  const vacancyLoss =
    inputs.monthlyRent * 12 * (inputs.vacancyRatePercent / 100);

  return (
    <section className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Year 1 income
        </h3>
        <LineItem
          label="Gross scheduled rent"
          value={formatCurrency(inputs.monthlyRent * 12)}
        />
        {inputs.otherMonthlyIncome > 0 && (
          <LineItem
            label="Other income"
            value={formatCurrency(inputs.otherMonthlyIncome * 12)}
          />
        )}
        <LineItem
          label={`Vacancy loss (${inputs.vacancyRatePercent}%)`}
          value={`− ${formatCurrency(vacancyLoss)}`}
          tone="muted"
        />
        <Divider />
        <LineItem
          label="Effective gross income"
          value={formatCurrency(analysis.annualEffectiveIncome)}
          strong
        />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Year 1 expenses
        </h3>
        {inputs.annualPropertyTax > 0 && (
          <LineItem
            label="Property tax"
            value={formatCurrency(inputs.annualPropertyTax)}
          />
        )}
        {inputs.annualInsurance > 0 && (
          <LineItem
            label="Insurance"
            value={formatCurrency(inputs.annualInsurance)}
          />
        )}
        {inputs.monthlyHOA > 0 && (
          <LineItem
            label="HOA"
            value={formatCurrency(inputs.monthlyHOA * 12)}
          />
        )}
        {inputs.monthlyUtilities > 0 && (
          <LineItem
            label="Utilities"
            value={formatCurrency(inputs.monthlyUtilities * 12)}
          />
        )}
        {fixedOpexAnnual === 0 && (
          <LineItem label="Fixed operating expenses" value="$0" tone="muted" />
        )}
        <LineItem
          label={`Maintenance (${inputs.maintenancePercent}%)`}
          value={formatCurrency(
            analysis.annualGrossIncome * (inputs.maintenancePercent / 100),
          )}
        />
        {inputs.propertyManagementPercent > 0 && (
          <LineItem
            label={`Property mgmt (${inputs.propertyManagementPercent}%)`}
            value={formatCurrency(
              analysis.annualGrossIncome *
                (inputs.propertyManagementPercent / 100),
            )}
          />
        )}
        {inputs.capexReservePercent > 0 && (
          <LineItem
            label={`CapEx reserve (${inputs.capexReservePercent}%)`}
            value={formatCurrency(
              analysis.annualGrossIncome * (inputs.capexReservePercent / 100),
            )}
          />
        )}
        <Divider />
        <LineItem
          label="Total operating expenses"
          value={formatCurrency(analysis.annualOperatingExpenses)}
          strong
        />
        <LineItem
          label="NOI"
          value={formatCurrency(analysis.annualNOI)}
          strong
          tone={analysis.annualNOI >= 0 ? "positive" : "negative"}
        />
        {analysis.annualDebtService > 0 && (
          <>
            <LineItem
              label="Debt service"
              value={`− ${formatCurrency(analysis.annualDebtService)}`}
              tone="muted"
            />
            <Divider />
            <LineItem
              label="Annual cash flow"
              value={formatCurrency(analysis.annualCashFlow)}
              strong
              tone={analysis.annualCashFlow >= 0 ? "positive" : "negative"}
            />
          </>
        )}
      </div>
    </section>
  );
}

function CashInvestedBreakdown({ analysis }: { analysis: DealAnalysis }) {
  return (
    <section className="mb-12">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Cash required to close
        </h3>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
          <KV
            label="Down payment"
            value={formatCurrency(analysis.downPayment)}
            sub={`${analysis.inputs.downPaymentPercent}% of price`}
          />
          <KV
            label="Closing costs"
            value={formatCurrency(analysis.closingCosts)}
            sub={`${analysis.inputs.closingCostsPercent}% of price`}
          />
          <KV
            label="Rehab"
            value={formatCurrency(analysis.inputs.rehabCosts)}
            sub="One-time"
          />
          <KV
            label="Total cash in"
            value={formatCurrency(analysis.totalCashInvested)}
            sub={`Loan: ${formatCurrency(analysis.loanAmount)}`}
            emphasise
          />
        </div>
        {analysis.loanAmount > 0 && (
          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
            Mortgage payment (P&amp;I) is{" "}
            <span className="font-mono text-zinc-900 dark:text-zinc-50">
              {formatCurrency(analysis.monthlyMortgagePayment)}
            </span>{" "}
            per month on a {analysis.inputs.loanTermYears}-year loan at{" "}
            {analysis.inputs.loanInterestRate}%.
          </p>
        )}
      </div>
    </section>
  );
}

function ProjectionTable({ projection }: { projection: YearProjection[] }) {
  if (projection.length === 0) return null;
  return (
    <section className="mb-12">
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Year-by-year projection
      </h2>
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <Th>Year</Th>
                <Th align="right">Gross rent</Th>
                <Th align="right">NOI</Th>
                <Th align="right">Debt service</Th>
                <Th align="right">Cash flow</Th>
                <Th align="right">Cumulative</Th>
                <Th align="right">Principal paid</Th>
                <Th align="right">Loan balance</Th>
                <Th align="right">Property value</Th>
                <Th align="right">Equity</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 font-mono text-zinc-700 dark:divide-zinc-800 dark:text-zinc-300">
              {projection.map((row) => (
                <tr
                  key={row.year}
                  className="transition hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                >
                  <Td>
                    <span className="font-sans font-medium text-zinc-900 dark:text-zinc-50">
                      Year {row.year}
                    </span>
                  </Td>
                  <Td align="right">{formatCurrency(row.grossRent)}</Td>
                  <Td align="right">{formatCurrency(row.noi)}</Td>
                  <Td align="right">
                    {row.debtService > 0
                      ? formatCurrency(row.debtService)
                      : "—"}
                  </Td>
                  <Td
                    align="right"
                    className={
                      row.cashFlow >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {formatCurrency(row.cashFlow)}
                  </Td>
                  <Td align="right">
                    {formatCurrency(row.cumulativeCashFlow)}
                  </Td>
                  <Td align="right">{formatCurrency(row.principalPaid)}</Td>
                  <Td align="right">{formatCurrency(row.loanBalanceEnd)}</Td>
                  <Td align="right">{formatCurrency(row.propertyValueEnd)}</Td>
                  <Td align="right">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                      {formatCurrency(row.equityEnd)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ExitSummary({ analysis }: { analysis: DealAnalysis }) {
  return (
    <section className="mb-12">
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Exit in year {analysis.saleYear}
      </h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Sale proceeds
          </h3>
          <LineItem
            label="Projected sale price"
            value={formatCurrency(analysis.salePrice)}
          />
          <LineItem
            label={`Selling costs (${analysis.inputs.sellingCostsPercent}%)`}
            value={`− ${formatCurrency(analysis.sellingCosts)}`}
            tone="muted"
          />
          <LineItem
            label="Loan payoff"
            value={`− ${formatCurrency(analysis.loanBalanceAtExit)}`}
            tone="muted"
          />
          <Divider />
          <LineItem
            label="Net proceeds at sale"
            value={formatCurrency(analysis.netSaleProceeds)}
            strong
            tone={analysis.netSaleProceeds >= 0 ? "positive" : "negative"}
          />
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Total return
          </h3>
          <LineItem
            label={`Total cash flow (${analysis.inputs.holdPeriodYears} yrs)`}
            value={formatCurrency(analysis.totalCashFlow)}
          />
          <LineItem
            label="Principal pay-down"
            value={formatCurrency(analysis.totalPrincipalPaydown)}
          />
          <LineItem
            label="Appreciation"
            value={formatCurrency(analysis.totalAppreciation)}
          />
          <LineItem
            label="Less: cash invested"
            value={`− ${formatCurrency(analysis.totalCashInvested)}`}
            tone="muted"
          />
          <Divider />
          <LineItem
            label="Total profit"
            value={formatCurrency(analysis.totalProfit)}
            strong
            tone={analysis.totalProfit >= 0 ? "positive" : "negative"}
          />
          <LineItem
            label="Average annual return"
            value={formatPercent(analysis.averageAnnualReturn)}
            tone={analysis.averageAnnualReturn >= 0 ? "positive" : "negative"}
          />
        </div>
      </div>
    </section>
  );
}

function Assumptions({ analysis }: { analysis: DealAnalysis }) {
  const { inputs } = analysis;
  return (
    <section className="mb-12">
      <details className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          <span>Assumptions used in this analysis</span>
          <span className="text-xs font-normal text-zinc-500 transition group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
          <AssumptionRow label="Purchase price" value={formatCurrency(inputs.purchasePrice)} />
          <AssumptionRow label="Down payment" value={`${inputs.downPaymentPercent}%`} />
          <AssumptionRow label="Closing costs" value={`${inputs.closingCostsPercent}%`} />
          <AssumptionRow label="Rehab" value={formatCurrency(inputs.rehabCosts)} />
          <AssumptionRow label="Interest rate" value={`${inputs.loanInterestRate}%`} />
          <AssumptionRow label="Loan term" value={`${inputs.loanTermYears} yrs`} />
          <AssumptionRow label="Monthly rent" value={formatCurrency(inputs.monthlyRent)} />
          <AssumptionRow label="Other income / mo" value={formatCurrency(inputs.otherMonthlyIncome)} />
          <AssumptionRow label="Vacancy" value={`${inputs.vacancyRatePercent}%`} />
          <AssumptionRow label="Property tax / yr" value={formatCurrency(inputs.annualPropertyTax)} />
          <AssumptionRow label="Insurance / yr" value={formatCurrency(inputs.annualInsurance)} />
          <AssumptionRow label="HOA / mo" value={formatCurrency(inputs.monthlyHOA)} />
          <AssumptionRow label="Utilities / mo" value={formatCurrency(inputs.monthlyUtilities)} />
          <AssumptionRow label="Maintenance" value={`${inputs.maintenancePercent}%`} />
          <AssumptionRow label="Property mgmt" value={`${inputs.propertyManagementPercent}%`} />
          <AssumptionRow label="CapEx reserve" value={`${inputs.capexReservePercent}%`} />
          <AssumptionRow label="Appreciation" value={`${inputs.annualAppreciationPercent}% / yr`} />
          <AssumptionRow label="Rent growth" value={`${inputs.annualRentGrowthPercent}% / yr`} />
          <AssumptionRow label="Expense growth" value={`${inputs.annualExpenseGrowthPercent}% / yr`} />
          <AssumptionRow label="Selling costs" value={`${inputs.sellingCostsPercent}%`} />
          <AssumptionRow label="Hold period" value={`${inputs.holdPeriodYears} yrs`} />
        </div>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Presentation primitives
// ---------------------------------------------------------------------------

const TIER_PALETTE: Record<
  VerdictTier,
  {
    border: string;
    bg: string;
    pill: string;
    headline: string;
    scoreBg: string;
  }
> = {
  excellent: {
    border: "border-emerald-200 dark:border-emerald-900/50",
    bg: "bg-gradient-to-br from-emerald-50 via-white to-emerald-50/50 dark:from-emerald-950/30 dark:via-zinc-950 dark:to-emerald-950/10",
    pill: "bg-emerald-600 text-white",
    headline: "text-emerald-900 dark:text-emerald-100",
    scoreBg: "bg-emerald-100/70 dark:bg-emerald-900/30",
  },
  good: {
    border: "border-sky-200 dark:border-sky-900/50",
    bg: "bg-gradient-to-br from-sky-50 via-white to-sky-50/50 dark:from-sky-950/30 dark:via-zinc-950 dark:to-sky-950/10",
    pill: "bg-sky-600 text-white",
    headline: "text-sky-900 dark:text-sky-100",
    scoreBg: "bg-sky-100/70 dark:bg-sky-900/30",
  },
  fair: {
    border: "border-amber-200 dark:border-amber-900/50",
    bg: "bg-gradient-to-br from-amber-50 via-white to-amber-50/50 dark:from-amber-950/30 dark:via-zinc-950 dark:to-amber-950/10",
    pill: "bg-amber-600 text-white",
    headline: "text-amber-900 dark:text-amber-100",
    scoreBg: "bg-amber-100/70 dark:bg-amber-900/30",
  },
  poor: {
    border: "border-orange-200 dark:border-orange-900/50",
    bg: "bg-gradient-to-br from-orange-50 via-white to-orange-50/50 dark:from-orange-950/30 dark:via-zinc-950 dark:to-orange-950/10",
    pill: "bg-orange-600 text-white",
    headline: "text-orange-900 dark:text-orange-100",
    scoreBg: "bg-orange-100/70 dark:bg-orange-900/30",
  },
  avoid: {
    border: "border-red-200 dark:border-red-900/50",
    bg: "bg-gradient-to-br from-red-50 via-white to-red-50/50 dark:from-red-950/30 dark:via-zinc-950 dark:to-red-950/10",
    pill: "bg-red-600 text-white",
    headline: "text-red-900 dark:text-red-100",
    scoreBg: "bg-red-100/70 dark:bg-red-900/30",
  },
};

function LineItem({
  label,
  value,
  strong,
  tone = "default",
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "default" | "positive" | "negative" | "muted";
}) {
  const toneClass = {
    default: "text-zinc-900 dark:text-zinc-50",
    positive: "text-emerald-600 dark:text-emerald-400",
    negative: "text-red-600 dark:text-red-400",
    muted: "text-zinc-500 dark:text-zinc-400",
  }[tone];

  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span
        className={`${strong ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-600 dark:text-zinc-400"}`}
      >
        {label}
      </span>
      <span
        className={`font-mono tabular-nums ${strong ? "text-base font-semibold" : ""} ${toneClass}`}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-2 border-t border-zinc-100 dark:border-zinc-800" />;
}

function KV({
  label,
  value,
  sub,
  emphasise,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasise?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div
        className={`mt-1 font-mono font-semibold ${emphasise ? "text-2xl text-zinc-900 dark:text-zinc-50" : "text-lg text-zinc-800 dark:text-zinc-200"}`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
          {sub}
        </div>
      )}
    </div>
  );
}

function AssumptionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-100 py-1 dark:border-zinc-800/80">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-mono text-zinc-900 dark:text-zinc-50">{value}</span>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-3 font-semibold ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      {children}
    </td>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4L8.5 12l6.8-6.8a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function AlertIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.518 11.591c.75 1.334-.213 2.985-1.742 2.985H3.48c-1.53 0-2.492-1.651-1.743-2.985L8.257 3.1zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-8a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}
