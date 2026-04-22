import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Methodology — How RealVerdict scores a deal",
  description:
    "The exact formulas, thresholds, and data sources behind every RealVerdict verdict. Cash flow, cap rate, DSCR, IRR, walk-away price, stress tests.",
};

export default function MethodologyPage() {
  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950">
      <header className="border-b border-zinc-200/70 bg-white/70 backdrop-blur-sm dark:border-zinc-800/70 dark:bg-black/40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            RealVerdict
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href="/about"
              className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              About
            </Link>
            <Link
              href="/pricing"
              className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Pricing
            </Link>
            <Link
              href="/#analyze"
              className="font-medium text-zinc-900 dark:text-zinc-50"
            >
              Analyze a deal →
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <article className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
            How the verdict is calculated.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-zinc-700 dark:text-zinc-300">
            RealVerdict scores every deal on the same six dimensions, against
            the same thresholds, using the same data sources. No black box.
            Here&apos;s exactly what happens between &quot;paste an
            address&quot; and &quot;STRONG BUY.&quot;
          </p>

          <Section title="1 · Where the inputs come from">
            <p>
              Every input on the verdict page has a source badge. We do not
              guess. If a number is unavailable from a primary source, we use a
              transparent fallback and label it as such.
            </p>
            <SourceTable
              rows={[
                ["Purchase price, beds/baths/sqft, year built, last sale", "RentCast public records → Zillow listing fallback"],
                ["AVM (estimated value)", "RentCast AVM"],
                ["Estimated market rent", "RentCast AVM rent estimate, cross-checked against active rent comps"],
                ["Property tax", "RentCast assessor records → state-level effective rate fallback"],
                ["Insurance", "State-level annual averages by property type"],
                ["30-yr mortgage rate", "FRED weekly Freddie Mac PMMS"],
                ["Long-run appreciation", "FHFA House Price Index for the metro (CBSA)"],
                ["Flood zone", "FEMA NFHL"],
                ["Sale & rent comparables", "RentCast within a 1-mile radius, beds/baths-matched"],
              ]}
            />
          </Section>

          <Section title="2 · The math">
            <p>
              Standard rental analysis, with one important detail: every line
              item is real, not assumed. We don&apos;t silently set vacancy to
              0% to make a deal look better.
            </p>
            <Formula
              label="Net Operating Income (NOI)"
              code="NOI = (Gross Rent + Other Income) × (1 − Vacancy %) − Property Tax − Insurance − HOA − Utilities − Maintenance − Property Mgmt − CapEx Reserve"
            />
            <Formula
              label="Cap rate"
              code="Cap Rate = NOI / (Purchase Price + Rehab)"
            />
            <Formula
              label="Cash flow"
              code="Monthly Cash Flow = (NOI / 12) − Monthly Mortgage Payment"
            />
            <Formula
              label="Debt service coverage (DSCR)"
              code="DSCR = NOI / Annual Debt Service"
            />
            <Formula
              label="Cash-on-cash return"
              code="CoC = Year-1 Cash Flow / Total Cash Invested (Down Payment + Closing + Rehab)"
            />
            <Formula
              label="Break-even occupancy"
              code="Break-even % = (Operating Expenses + Debt Service) / Gross Rent"
            />
            <Formula
              label="IRR"
              code="Internal rate of return on the year-by-year cash flow series, including projected sale proceeds at the end of the hold period."
            />
          </Section>

          <Section title="3 · The verdict tiers">
            <p>
              The rubric awards points across six categories — cash-on-cash
              (12pts max), cap rate (15), DSCR (15), IRR (22), GRM (12), and
              break-even occupancy (12). Total possible is 100. We add a small
              long-term &quot;appreciation rescue&quot; modifier that softens
              the penalty when a deal is cash-flow-negative year 1 but the
              IRR + equity growth still make the math work over the hold.
            </p>
            <TierTable />
          </Section>

          <Section title="4 · The walk-away price">
            <p>
              This is the number no other rental analyzer gives you. For each
              tier, we run a binary search over the purchase price holding
              every other input constant (rent, rate, taxes, expenses) and
              find the highest price at which the verdict still earns that
              tier or better.
            </p>
            <p className="mt-3">
              The result is a card showing: &quot;Highest price for STRONG
              BUY: $X. For GOOD: $Y. For BORDERLINE: $Z.&quot; You walk into
              negotiations knowing exactly where the deal stops working.
            </p>
            <p className="mt-3 text-zinc-600 dark:text-zinc-400">
              We omit a tier if it&apos;s unreachable at any price ≥ $1,000 —
              for example, an all-cash deal at a great rent will never have a
              walk-away ceiling at the AVOID tier, because no purchase price
              that small is realistic.
            </p>
          </Section>

          <Section title="5 · Stress tests">
            <p>
              Five scenarios that all happened in the last 24 months. Each one
              re-runs the full verdict against the same property with one
              variable shocked.
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>Mortgage rate up 1 percentage point</li>
              <li>Rent down 10%</li>
              <li>Vacancy doubles (e.g. 5% → 10%)</li>
              <li>Insurance up 30%</li>
              <li>Property tax reassessed up 25%</li>
            </ul>
            <p className="mt-3">
              The stress test panel highlights which scenarios push the verdict
              from BUY to PASS, and which the deal absorbs comfortably.
            </p>
          </Section>

          <Section title="6 · Comparables">
            <p>
              Pro users get a comps tab on every verdict. We pull recent sales
              and active rentals within a 1-mile radius from RentCast,
              filtered by beds/baths and (when known) property type. The
              statistics shown — median, low/high, sample size — are computed
              per-deal, not pre-baked. If we don&apos;t have enough comps to
              be statistically meaningful (fewer than 3), we tell you instead
              of guessing.
            </p>
            <p className="mt-3 text-zinc-600 dark:text-zinc-400">
              We use the median rent comp to cross-check the rent assumption
              you (or RentCast&apos;s AVM) provided. If your projected rent is
              materially above the comp median, we surface a &quot;rent looks
              optimistic&quot; warning before the verdict.
            </p>
          </Section>

          <Section title="What we don't do (yet)">
            <ul className="space-y-2 list-disc pl-5">
              <li>
                Short-term rental modeling. Verdicts assume long-term lease
                income only.
              </li>
              <li>
                BRRRR / refi-out math. The walk-away price assumes a single
                purchase at the listed terms.
              </li>
              <li>
                Tax depreciation and personal income tax effects. Returns are
                pre-tax.
              </li>
              <li>
                Local rent control or eviction-moratorium adjustments. We use
                national stress assumptions.
              </li>
            </ul>
            <p className="mt-3">
              Each of these is on the roadmap. If your deal hinges on one,
              treat the verdict as a directional read, not an oracle, and
              verify with a CPA and local counsel.
            </p>
          </Section>

          <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-10 dark:border-zinc-800">
            <Link
              href="/#analyze"
              className="inline-flex h-11 items-center rounded-md bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Run a verdict
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center rounded-md border border-zinc-300 px-5 text-sm font-semibold text-zinc-900 transition hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500"
            >
              See pricing
            </Link>
          </div>
        </article>
      </main>

      <footer className="border-t border-zinc-200/70 dark:border-zinc-800/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 text-xs text-zinc-500 dark:text-zinc-500">
          RealVerdict is an analytical tool for educational purposes. Always
          verify assumptions with a qualified agent, lender, and tax advisor
          before making an offer.
        </div>
      </footer>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
    </section>
  );
}

function Formula({ label, code }: { label: string; code: string }) {
  return (
    <div className="my-4 rounded-md border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-zinc-800 dark:text-zinc-200">
        {code}
      </pre>
    </div>
  );
}

function SourceTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="px-4 py-2.5">Field</th>
            <th className="px-4 py-2.5">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map(([field, source]) => (
            <tr key={field}>
              <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                {field}
              </td>
              <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                {source}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TierTable() {
  const tiers: Array<{ tier: string; range: string; meaning: string; tone: string }> = [
    { tier: "STRONG BUY", range: "75 – 100", meaning: "Income comfortably covers debt, returns clear the bar, healthy margin for error.", tone: "text-emerald-600 dark:text-emerald-400" },
    { tier: "GOOD", range: "55 – 74", meaning: "Numbers pencil out. A few metrics below ideal, nothing disqualifying.", tone: "text-emerald-600 dark:text-emerald-400" },
    { tier: "BORDERLINE", range: "35 – 54", meaning: "Marginal. Returns are modest and the deal needs things to go right.", tone: "text-amber-600 dark:text-amber-400" },
    { tier: "PASS", range: "15 – 34", meaning: "Cash flow, leverage, or both work against you.", tone: "text-orange-600 dark:text-orange-400" },
    { tier: "AVOID", range: "0 – 14", meaning: "Projected to lose money or leave you dangerously exposed.", tone: "text-red-600 dark:text-red-400" },
  ];
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="px-4 py-2.5">Tier</th>
            <th className="px-4 py-2.5">Score</th>
            <th className="px-4 py-2.5">What it means</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {tiers.map((t) => (
            <tr key={t.tier}>
              <td className={`px-4 py-2.5 font-mono text-xs font-bold ${t.tone}`}>
                {t.tier}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                {t.range}
              </td>
              <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                {t.meaning}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
