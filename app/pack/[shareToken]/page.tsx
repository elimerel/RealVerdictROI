import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import {
  formatCurrency,
  formatPercent,
  type VerdictTier,
} from "@/lib/calculations";
import type { PackPayload } from "@/lib/negotiation-pack";

// ---------------------------------------------------------------------------
// Public Negotiation Pack viewer (HANDOFF §11).
//
// Renders a frozen Pack snapshot at /pack/<shareToken>. Loads via Supabase
// RLS — the anon client succeeds when `is_public = true AND revoked_at IS NULL`
// (see migration 004). No login required, by design: the canonical use is
// "investor pastes this URL into a text to their agent."
//
// Anything past first-fold needs to read like a forwardable document. So:
// no app chrome, no nav links to /pricing, no sign-in CTAs above the
// counteroffer paragraphs. There IS a small "powered by RealVerdict" link
// at the bottom — that's the viral loop, not a hero banner.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

type PackRow = {
  id: string;
  share_token: string;
  payload: PackPayload;
  address: string | null;
  verdict: string | null;
  is_public: boolean;
  revoked_at: string | null;
  created_at: string;
};

export default async function PackPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;

  if (!supabaseEnv().configured) {
    return (
      <PackErrorShell
        title="Pack viewer unavailable"
        body="This deployment hasn't been configured for Pack hosting yet."
      />
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("negotiation_packs")
    .select(
      "id, share_token, payload, address, verdict, is_public, revoked_at, created_at",
    )
    .eq("share_token", shareToken)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const row = data as PackRow;
  if (row.revoked_at) {
    return (
      <PackErrorShell
        title="Pack revoked"
        body="The investor who generated this Pack has revoked the share link. Reach out to them for an updated version."
      />
    );
  }

  return <PackBody row={row} />;
}

function PackBody({ row }: { row: PackRow }) {
  const p = row.payload;
  const tier = (row.verdict as VerdictTier) ?? p.headline.tier;
  const generatedDate = new Date(p.generatedAt).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-white text-zinc-900 print:bg-white">
      <article className="mx-auto w-full max-w-3xl px-6 py-10 sm:py-14">
        <header className="border-b border-zinc-200 pb-6">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-zinc-500">
            <span>Negotiation Pack</span>
            <span>{generatedDate}</span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold leading-tight text-zinc-900 sm:text-3xl">
            {row.address ?? p.address}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <VerdictPill tier={tier} />
            <span className="text-sm text-zinc-600">
              List price: {formatCurrency(p.headline.listPrice, 0)}
            </span>
            {p.headline.walkAwayPrice != null && (
              <span className="text-sm text-zinc-600">
                · Walk-away: {formatCurrency(p.headline.walkAwayPrice, 0)}
              </span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 print:hidden">
            <Link
              href={`/pack/${row.share_token}/pdf`}
              prefetch={false}
              className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-800 transition hover:border-zinc-400 hover:bg-zinc-50"
            >
              Download PDF
            </Link>
          </div>
        </header>

        <Section title="Headline">
          <p className="text-base leading-relaxed text-zinc-800">
            {p.headline.framing}
          </p>
          {p.headline.deltaDollars != null &&
            p.headline.deltaPercent != null && (
              <div className="mt-4 grid grid-cols-3 gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <Metric
                  label="List price"
                  value={formatCurrency(p.headline.listPrice, 0)}
                />
                <Metric
                  label="Walk-away"
                  value={
                    p.headline.walkAwayPrice != null
                      ? formatCurrency(p.headline.walkAwayPrice, 0)
                      : "—"
                  }
                />
                <Metric
                  label="Gap"
                  value={`${formatCurrency(
                    p.headline.deltaDollars,
                    0,
                  )} (${p.headline.deltaPercent.toFixed(1)}%)`}
                />
              </div>
            )}
        </Section>

        <Section title="The three weakest assumptions in the seller's pro forma">
          {p.weakAssumptions.length === 0 ? (
            <p className="text-sm text-zinc-600">
              The listing inputs check out against our comp pool — no material
              gaps to flag. The ask is simply higher than the cash flow / DSCR
              math supports.
            </p>
          ) : (
            <ul className="space-y-5">
              {p.weakAssumptions.map((a, i) => (
                <li key={i} className="border-l-2 border-zinc-300 pl-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-zinc-900">
                      {i + 1}. {a.field}
                    </h3>
                    <SeverityTag severity={a.severity} />
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Listing implies
                      </div>
                      <div className="text-zinc-800">{a.current}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Realistic
                      </div>
                      <div className="text-zinc-800">{a.realistic}</div>
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-700">
                    {a.reason}
                  </p>
                  <div className="mt-1 text-xs font-medium text-zinc-600">
                    Gap: {a.gap}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Comp evidence">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <CompColumn
              title="Sale comps"
              comps={p.compEvidence.sale}
              kind="sale"
            />
            <CompColumn
              title="Rent comps"
              comps={p.compEvidence.rent}
              kind="rent"
            />
          </div>
        </Section>

        <Section title="Stress scenarios">
          <p className="mb-4 text-sm text-zinc-600">
            Each row applies a single shock to the seller&apos;s pro forma and
            shows what happens. Verdict flips are highlighted.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="py-2 pr-3 font-semibold">Scenario</th>
                  <th className="py-2 pr-3 text-right font-semibold">
                    Cash flow
                  </th>
                  <th className="py-2 pr-3 text-right font-semibold">DSCR</th>
                  <th className="py-2 pr-3 text-right font-semibold">
                    Verdict
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.stressScenarios.map((s, i) => (
                  <tr key={i} className="border-b border-zinc-100 align-top">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-zinc-900">
                        {s.label}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-600">
                        {s.description}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-right font-mono">
                      {formatCurrency(s.monthlyCashFlowAfter, 0)}/mo
                    </td>
                    <td className="py-3 pr-3 text-right font-mono">
                      {isFinite(s.dscrAfter) ? s.dscrAfter.toFixed(2) : "∞"}
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <VerdictPill tier={s.verdictAfter} compact />
                      {s.flippedFromBase && (
                        <div className="mt-1 text-[10px] uppercase tracking-wider text-amber-700">
                          flipped
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Counteroffer script">
          <p className="mb-4 text-sm text-zinc-600">
            Forward this directly to your agent. Plain English, no jargon.
          </p>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 sm:p-6">
            {p.counteroffer.paragraphs.map((para, i) => (
              <p
                key={i}
                className="whitespace-pre-line text-sm leading-relaxed text-zinc-800 [&:not(:first-child)]:mt-4"
              >
                {para}
              </p>
            ))}
          </div>
        </Section>

        <Section title="Snapshot at generation">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric
              label="Purchase price"
              value={formatCurrency(p.snapshot.purchasePrice, 0)}
            />
            <Metric
              label="Monthly rent"
              value={formatCurrency(p.snapshot.monthlyRent, 0)}
            />
            <Metric
              label="Monthly cash flow"
              value={formatCurrency(p.snapshot.monthlyCashFlow, 0)}
            />
            <Metric label="Cap rate" value={formatPercent(p.snapshot.capRate)} />
            <Metric
              label="DSCR"
              value={
                isFinite(p.snapshot.dscr) ? p.snapshot.dscr.toFixed(2) : "∞"
              }
            />
            <Metric
              label="IRR"
              value={
                isFinite(p.snapshot.irr) ? formatPercent(p.snapshot.irr) : "—"
              }
            />
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            Comp confidence:{" "}
            <span className="font-semibold uppercase tracking-wider">
              {p.snapshot.compsConfidence}
            </span>
          </div>
        </Section>

        <footer className="mt-12 border-t border-zinc-200 pt-6 text-center text-xs text-zinc-500">
          <p>
            This Pack was generated on {generatedDate} from the comp pool and
            rate environment available that day. Re-run the analysis for a
            fresh snapshot.
          </p>
          <p className="mt-2">
            Powered by{" "}
            <Link
              href="/"
              className="font-medium text-zinc-700 underline underline-offset-2"
            >
              RealVerdict
            </Link>{" "}
            — investor-grade rental underwriting in 30 seconds.
          </p>
        </footer>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-zinc-700">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-zinc-900">
        {value}
      </div>
    </div>
  );
}

function VerdictPill({
  tier,
  compact = false,
}: {
  tier: VerdictTier;
  compact?: boolean;
}) {
  const styles: Record<VerdictTier, string> = {
    excellent: "bg-emerald-100 text-emerald-800",
    good: "bg-sky-100 text-sky-800",
    fair: "bg-amber-100 text-amber-800",
    poor: "bg-orange-100 text-orange-800",
    avoid: "bg-red-100 text-red-800",
  };
  const labels: Record<VerdictTier, string> = {
    excellent: "Strong buy",
    good: "Good deal",
    fair: "Borderline",
    poor: "Pass",
    avoid: "Avoid",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${styles[tier]} ${
        compact ? "px-2 py-0.5 text-[10px]" : ""
      }`}
    >
      {labels[tier]}
    </span>
  );
}

function SeverityTag({ severity }: { severity: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-red-50 text-red-700 border-red-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    low: "bg-zinc-50 text-zinc-600 border-zinc-200",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[severity]}`}
    >
      {severity} impact
    </span>
  );
}

function CompColumn({
  title,
  comps,
  kind,
}: {
  title: string;
  comps: PackPayload["compEvidence"]["sale"];
  kind: "sale" | "rent";
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">
        {title}
      </h3>
      {comps.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No {kind} comps survived the scoring filters.
        </p>
      ) : (
        <ul className="space-y-3">
          {comps.map((c, i) => (
            <li
              key={i}
              className="rounded-md border border-zinc-200 bg-white p-3"
            >
              <div className="text-sm font-semibold text-zinc-900">
                {c.address}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-zinc-700">
                {c.beds != null && <span>{c.beds}bd</span>}
                {c.baths != null && <span>{c.baths}ba</span>}
                {c.sqft != null && <span>{c.sqft.toLocaleString()} sqft</span>}
                {c.price != null && (
                  <span className="font-semibold text-zinc-900">
                    {kind === "sale"
                      ? formatCurrency(c.price, 0)
                      : `${formatCurrency(c.price, 0)}/mo`}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-600">
                {c.why}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PackErrorShell({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-zinc-900">{title}</h1>
        <p className="mt-3 text-sm text-zinc-600">{body}</p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center text-sm font-medium text-zinc-700 underline underline-offset-2"
        >
          Go to RealVerdict
        </Link>
      </div>
    </div>
  );
}
