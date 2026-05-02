import Link from "next/link"
import type { Metadata } from "next"
import { MarketingHeader } from "../_components/MarketingHeader"
import { MarketingFooter } from "../_components/MarketingFooter"

export const metadata: Metadata = {
  title: "Methodology — How RealVerdict scores a deal",
  description:
    "The exact formulas, thresholds, and data sources behind every RealVerdict verdict. Cash flow, cap rate, DSCR, IRR, max offer price, stress tests.",
}

export default function MethodologyPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--rv-surface-bg)" }}>
      <MarketingHeader />

      <main className="flex-1">
        <article className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24">
          <div className="mb-12">
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--rv-accent)" }}>
              Methodology
            </p>
            <h1
              className="text-[36px] sm:text-[52px] font-bold leading-[1.06]"
              style={{ color: "var(--rv-t1)", letterSpacing: "-0.03em" }}
            >
              How the verdict is calculated.
            </h1>
            <p className="mt-5 text-[17px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>
              RealVerdict scores every deal on the same six dimensions, against the same
              thresholds, using the same data sources. No black box. Here&apos;s exactly
              what happens between &quot;paste an address&quot; and &quot;STRONG DEAL.&quot;
            </p>
          </div>

          <Section title="1 · Where the inputs come from">
            <p>
              Every input on the verdict page has a source badge. We do not guess. If a
              number is unavailable from a primary source, we use a transparent fallback
              and label it as such.
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
              Standard rental analysis, with one important detail: every line item is
              real, not assumed. We don&apos;t silently set vacancy to 0% to make a deal
              look better.
            </p>
            <Formula
              label="Net Operating Income (NOI)"
              code="NOI = (Gross Rent + Other Income) × (1 − Vacancy %) − Property Tax − Insurance − HOA − Utilities − Maintenance − Property Mgmt − CapEx Reserve"
            />
            <Formula label="Cap rate" code="Cap Rate = NOI / (Purchase Price + Rehab)" />
            <Formula label="Cash flow" code="Monthly Cash Flow = (NOI / 12) − Monthly Mortgage Payment" />
            <Formula label="Debt service coverage (DSCR)" code="DSCR = NOI / Annual Debt Service" />
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
              The rubric awards points across six categories — cash-on-cash (12pts max),
              cap rate (15), DSCR (15), IRR (22), GRM (12), and break-even occupancy
              (12). Total possible is 100. A small long-run &quot;appreciation
              rescue&quot; modifier softens the penalty when a deal is cash-flow-negative
              year 1 but the IRR + equity growth still make the math work over the hold.
            </p>
            <TierTable />
          </Section>

          <Section title="4 · The max offer price">
            <p>
              For each tier, we run a binary search over the purchase price — holding
              every other input constant (rent, rate, taxes, expenses) — and find the
              highest price at which the verdict still earns that tier or better.
            </p>
            <p className="mt-3">
              The result tells you the highest price at which the deal is still a Strong
              Deal, Good, or Borderline. You walk into negotiations knowing exactly where
              the deal stops working.
            </p>
            <p className="mt-3" style={{ color: "var(--rv-t3)" }}>
              We omit a tier if it&apos;s unreachable at any realistic price — for
              example, an all-cash deal at a great rent will never have a ceiling at the
              AVOID tier.
            </p>
          </Section>

          <Section title="5 · Stress tests">
            <p>
              Five scenarios that all happened in the last 24 months. Each one re-runs
              the full verdict against the same property with one variable shocked.
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5" style={{ color: "var(--rv-t2)" }}>
              <li>Mortgage rate up 1 percentage point</li>
              <li>Rent down 10%</li>
              <li>Vacancy doubles (e.g. 5% → 10%)</li>
              <li>Insurance up 30%</li>
              <li>Property tax reassessed up 25%</li>
            </ul>
            <p className="mt-3">
              The stress test panel highlights which scenarios push the verdict from BUY
              to PASS, and which the deal absorbs comfortably.
            </p>
          </Section>

          <Section title="6 · Comparables">
            <p>
              Pro users get a comps tab on every verdict. We pull recent sales and active
              rentals within a 1-mile radius from RentCast, filtered by beds/baths and
              (when known) property type. The statistics shown — median, low/high, sample
              size — are computed per-deal, not pre-baked. If we don&apos;t have enough
              comps to be statistically meaningful (fewer than 3), we tell you instead of
              guessing.
            </p>
            <p className="mt-3" style={{ color: "var(--rv-t3)" }}>
              We use the median rent comp to cross-check the rent assumption you (or
              RentCast&apos;s AVM) provided. If your projected rent is materially above
              the comp median, we surface a &quot;rent looks optimistic&quot; warning
              before the verdict.
            </p>
          </Section>

          <Section title="What we don't do (yet)">
            <ul className="space-y-2 list-disc pl-5" style={{ color: "var(--rv-t2)" }}>
              <li>Short-term rental modeling. Verdicts assume long-term lease income only.</li>
              <li>BRRRR / refi-out math. The max offer assumes a single purchase at the listed terms.</li>
              <li>Tax depreciation and personal income tax effects. Returns are pre-tax.</li>
              <li>Local rent control or eviction-moratorium adjustments. We use national stress assumptions.</li>
            </ul>
            <p className="mt-3">
              Each of these is on the roadmap. If your deal hinges on one, treat the
              verdict as a directional read and verify with a CPA and local counsel.
            </p>
          </Section>

          <div
            className="mt-14 flex flex-wrap items-center gap-3 border-t pt-10"
            style={{ borderColor: "var(--rv-fill-border)" }}
          >
            <Link
              href="/research"
              className="inline-flex h-11 items-center rounded-full px-6 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "var(--rv-accent)" }}
            >
              Run a verdict
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center rounded-full border px-6 text-[13px] font-semibold transition-colors hover:bg-[var(--rv-fill-1)]"
              style={{ borderColor: "var(--rv-fill-border-strong)", color: "var(--rv-t1)" }}
            >
              See pricing
            </Link>
          </div>
        </article>
      </main>

      <MarketingFooter />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2
        className="text-[20px] font-semibold"
        style={{ color: "var(--rv-t1)", letterSpacing: "-0.015em" }}
      >
        {title}
      </h2>
      <div
        className="mt-3 space-y-3 text-[15px] leading-relaxed"
        style={{ color: "var(--rv-t2)" }}
      >
        {children}
      </div>
    </section>
  )
}

function Formula({ label, code }: { label: string; code: string }) {
  return (
    <div
      className="my-4 rounded-xl p-4"
      style={{
        background: "var(--rv-surface-2)",
        border: "1px solid var(--rv-fill-border)",
      }}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-widest mb-2"
        style={{ color: "var(--rv-t3)" }}
      >
        {label}
      </div>
      <pre
        className="whitespace-pre-wrap break-words font-mono text-[12px]"
        style={{ color: "var(--rv-t2)" }}
      >
        {code}
      </pre>
    </div>
  )
}

function SourceTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div
      className="mt-4 overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--rv-fill-border)" }}
    >
      <table className="w-full text-[13px]">
        <thead
          className="text-left"
          style={{ background: "var(--rv-surface-2)" }}
        >
          <tr>
            <th
              className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--rv-t3)" }}
            >
              Field
            </th>
            <th
              className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--rv-t3)" }}
            >
              Source
            </th>
          </tr>
        </thead>
        <tbody
          style={{
            background: "var(--rv-surface-bg)",
            borderTop: "1px solid var(--rv-fill-border)",
          }}
        >
          {rows.map(([field, source]) => (
            <tr
              key={field}
              className="border-b last:border-0"
              style={{ borderColor: "var(--rv-fill-border)" }}
            >
              <td className="px-4 py-2.5" style={{ color: "var(--rv-t2)" }}>{field}</td>
              <td className="px-4 py-2.5" style={{ color: "var(--rv-t3)" }}>{source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TierTable() {
  const tiers = [
    { tier: "STRONG DEAL", range: "75–100", meaning: "Income comfortably covers debt, returns clear the bar, healthy margin for error.", color: "var(--rv-good)" },
    { tier: "GOOD", range: "55–74", meaning: "Numbers pencil out. A few metrics below ideal, nothing disqualifying.", color: "var(--rv-good)" },
    { tier: "BORDERLINE", range: "35–54", meaning: "Marginal. Returns are modest and the deal needs things to go right.", color: "var(--rv-warn)" },
    { tier: "PASS", range: "15–34", meaning: "Cash flow, leverage, or both work against you.", color: "var(--rv-bad)" },
    { tier: "AVOID", range: "0–14", meaning: "Projected to lose money or leave you dangerously exposed.", color: "var(--rv-bad)" },
  ]
  return (
    <div
      className="mt-4 overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--rv-fill-border)" }}
    >
      <table className="w-full text-[13px]">
        <thead style={{ background: "var(--rv-surface-2)" }}>
          <tr>
            {["Tier", "Score", "What it means"].map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: "var(--rv-t3)" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={{ background: "var(--rv-surface-bg)", borderTop: "1px solid var(--rv-fill-border)" }}>
          {tiers.map((t) => (
            <tr
              key={t.tier}
              className="border-b last:border-0"
              style={{ borderColor: "var(--rv-fill-border)" }}
            >
              <td className="px-4 py-2.5 font-mono text-[11px] font-bold" style={{ color: t.color }}>
                {t.tier}
              </td>
              <td className="px-4 py-2.5 font-mono text-[12px]" style={{ color: "var(--rv-t3)" }}>
                {t.range}
              </td>
              <td className="px-4 py-2.5" style={{ color: "var(--rv-t2)" }}>
                {t.meaning}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
