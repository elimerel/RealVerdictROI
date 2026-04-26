import Link from "next/link";
import HomeAnalyzeForm from "./_components/HomeAnalyzeForm";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  DEFAULT_INPUTS,
  inputsFromSearchParams,
  inputsToSearchParams,
  analyseDeal,
  findOfferCeiling,
  formatCurrency,
  formatPercent,
  type DealInputs,
} from "@/lib/calculations";
import { getCurrentMortgageRate, fredRateNote } from "@/lib/rates";
import { TIER_LABEL, TIER_ACCENT, TIER_TAILWIND_TEXT_LIGHT } from "@/lib/tier-constants";

const SAMPLE_INPUTS: DealInputs = {
  ...DEFAULT_INPUTS,
  purchasePrice: 525_000,
  monthlyRent: 3_400,
  downPaymentPercent: 25,
  loanInterestRate: 7.0,
  annualPropertyTax: 9_450,
  annualInsurance: 2_100,
  rehabCosts: 0,
};
const SAMPLE_ADDRESS = "2315 Ave H, Austin, TX 78722";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const search = await searchParams;
  const authEnabled = supabaseEnv().configured;
  const user = authEnabled ? await getCurrentUser() : null;

  const hasParams = Object.keys(search).some((k) => k !== "address");
  const parsedInputs = hasParams ? inputsFromSearchParams(search) : undefined;
  const addressRaw = search.address;
  const initialAddress =
    typeof addressRaw === "string" ? addressRaw : undefined;

  const fred = await getCurrentMortgageRate();

  let initialInputs: Partial<DealInputs> | undefined = parsedInputs;
  const initialProvenance: Partial<
    Record<keyof DealInputs, { source: "fred"; confidence: "high"; note: string }>
  > = {};
  if (fred && !parsedInputs) {
    initialInputs = { loanInterestRate: Number(fred.rate.toFixed(3)) };
    initialProvenance.loanInterestRate = {
      source: "fred",
      confidence: "high",
      note: fredRateNote(fred),
    };
  }

  const sampleParams = inputsToSearchParams(SAMPLE_INPUTS);
  sampleParams.set("address", SAMPLE_ADDRESS);
  const sampleHref = `/results?${sampleParams.toString()}`;

  const sampleAnalysis = analyseDeal(SAMPLE_INPUTS);
  const sampleCeiling = findOfferCeiling(SAMPLE_INPUTS, {
    marketValueCap: SAMPLE_INPUTS.purchasePrice,
    marketValueCapSource: "list",
  });
  const sampleTier = sampleAnalysis.verdict.tier;
  const sampleAccent = TIER_ACCENT[sampleTier];

  return (
    <div className="flex flex-1 flex-col bg-zinc-950">
      {/* ── Nav ── */}
      <header className="border-b border-zinc-800/70 bg-zinc-950/90 backdrop-blur-sm">
        <nav className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight text-zinc-50"
          >
            RealVerdict
          </Link>
          <div className="flex items-center gap-5 sm:gap-6 text-sm">
            <Link
              href="/methodology"
              className="hidden sm:inline font-medium text-zinc-500 transition hover:text-zinc-200"
            >
              Methodology
            </Link>
            <Link
              href="/compare"
              className="hidden sm:inline font-medium text-zinc-500 transition hover:text-zinc-200"
            >
              Compare
            </Link>
            <Link
              href="/pricing"
              className="font-medium text-zinc-500 transition hover:text-zinc-200"
            >
              Pricing
            </Link>
            {authEnabled &&
              (user ? (
                <Link
                  href="/dashboard"
                  className="font-medium text-zinc-500 transition hover:text-zinc-200"
                >
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="font-medium text-zinc-500 transition hover:text-zinc-200"
                >
                  Sign in
                </Link>
              ))}
          </div>
        </nav>
      </header>

      <main id="analyze" className="flex-1">
        {/* ── Hero ── */}
        <div className="mx-auto w-full max-w-3xl px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
          <div className="mb-8 text-center">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-blue-400">
              Buy-and-hold rental investors
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight text-zinc-50 sm:text-5xl md:text-6xl leading-[1.05]">
              The listing is optimistic.{" "}
              <span className="text-blue-400">
                Your offer shouldn&apos;t be.
              </span>
            </h1>
            <p className="mt-5 text-base text-zinc-400 sm:text-lg">
              Paste any address. Get a walk-away price backed by live comps, a full verdict, and a negotiation-ready Pack — in under a minute.
            </p>
          </div>

          {/* Sample verdict preview — shows what users get before they type anything */}
          <Link href={sampleHref} className="group mb-8 block">
            <div
              className="overflow-hidden rounded-xl border transition-colors group-hover:border-zinc-600"
              style={{ borderColor: sampleAccent + "40" }}
            >
              {/* Header bar */}
              <div
                className="flex items-center justify-between px-5 py-3 text-[11px] font-semibold uppercase tracking-widest"
                style={{ backgroundColor: sampleAccent + "14", color: sampleAccent }}
              >
                <span>{SAMPLE_ADDRESS}</span>
                <span className="flex items-center gap-1.5">
                  Sample verdict
                  <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 opacity-70">
                    <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 011.06 0l3.25 3.25a.75.75 0 010 1.06l-3.25 3.25a.75.75 0 01-1.06-1.06L9.19 8 6.22 5.03a.75.75 0 010-1.06z" clipRule="evenodd" />
                  </svg>
                </span>
              </div>

              {/* Content */}
              <div className="bg-zinc-900/60 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div
                      className="text-2xl font-extrabold uppercase tracking-tight leading-none sm:text-3xl"
                      style={{ color: sampleAccent }}
                    >
                      {TIER_LABEL[sampleTier]}
                    </div>
                    {sampleCeiling.primaryTarget && (
                      <div className="mt-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Walk-away </span>
                        <span className="font-mono text-lg font-bold tabular-nums text-zinc-200">
                          {formatCurrency(sampleCeiling.primaryTarget.price, 0)}
                        </span>
                        <span className="ml-1.5 text-xs text-zinc-600">
                          for {TIER_LABEL[sampleCeiling.primaryTarget.tier]}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 text-right">
                    <SampleMetric
                      label="Cash flow"
                      value={`${sampleAnalysis.monthlyCashFlow >= 0 ? "+" : ""}${formatCurrency(sampleAnalysis.monthlyCashFlow, 0)}/mo`}
                      positive={sampleAnalysis.monthlyCashFlow >= 0}
                    />
                    <SampleMetric
                      label="Cap rate"
                      value={formatPercent(sampleAnalysis.capRate, 2)}
                    />
                    <SampleMetric
                      label="DSCR"
                      value={isFinite(sampleAnalysis.dscr) ? sampleAnalysis.dscr.toFixed(2) : "∞"}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Link>

          {/* ── Form ── */}
          <p className="mb-4 text-sm font-semibold text-zinc-400">
            Analyze your own deal →
          </p>

          <HomeAnalyzeForm
            initialInputs={initialInputs}
            initialAddress={initialAddress}
            initialProvenance={initialProvenance}
          />

          <p className="mt-4 text-center text-xs text-zinc-600">
            3 free analyses / week · No credit card
          </p>
        </div>

        {/* ── Data sources ── */}
        <div className="border-y border-zinc-800/60 bg-zinc-900/40">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2 px-6 py-3 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            <span>FRED 30-yr rate</span>
            <span aria-hidden>·</span>
            <span>RentCast comps</span>
            <span aria-hidden>·</span>
            <span>Zillow listings</span>
            <span aria-hidden>·</span>
            <span>FHFA appreciation</span>
            <span aria-hidden>·</span>
            <span>FEMA flood zones</span>
            <span aria-hidden>·</span>
            <span>State tax &amp; insurance avg.</span>
          </div>
        </div>

        {/* ── What you get ── */}
        <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
              Negotiate from a position of fact
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              Three things that change how you walk into every offer.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-px bg-zinc-800 overflow-hidden rounded-2xl sm:grid-cols-3">
            <FeatureTile
              number="01"
              title="Walk-away price"
              body="The highest offer the deal can carry before you slip below your target tier — capped by comp-derived fair value. This is the number you walk into the negotiation with."
            />
            <FeatureTile
              number="02"
              title="Three weakest assumptions"
              body="Every listing has 2–3 numbers the seller inflated. We rank them by dollar impact and give you the comp evidence to break each one in the room."
            />
            <FeatureTile
              number="03"
              title="Counteroffer script"
              body="Offer language grounded in your walk-away price, the weakest seller assumption, and a concrete stress outcome. Ready to paste into an LOI or hand to your agent."
            />
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section className="border-t border-zinc-800/60 bg-zinc-900/30">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-zinc-50">
                One bad offer costs $20K+. This costs $0.
              </h2>
              <p className="mt-3 text-base text-zinc-500">
                Free for your first 3 live analyses a week — including the full Negotiation Pack.
                $29/mo for unlimited. No contract, 7-day refund.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="#analyze"
                  className="inline-flex h-11 items-center rounded-md bg-blue-600 px-6 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  Underwrite your next rental →
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex h-11 items-center rounded-md border border-zinc-700 px-5 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                >
                  See pricing
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-800/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-xs text-zinc-600">
          <div>
            RealVerdict is an analytical tool. Verify assumptions with a qualified agent, lender, and tax advisor before making an offer.
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/methodology" className="hover:text-zinc-400">Methodology</Link>
            <Link href="/about" className="hover:text-zinc-400">About</Link>
            <Link href="/pricing" className="hover:text-zinc-400">Pricing</Link>
            <Link href="/compare" className="hover:text-zinc-400">Compare</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SampleMetric({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="flex flex-col items-end gap-0">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      <span
        className={`font-mono text-sm font-semibold tabular-nums ${
          positive === true
            ? "text-emerald-400"
            : positive === false
              ? "text-red-400"
              : "text-zinc-300"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function FeatureTile({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col gap-3 bg-zinc-950 px-7 py-8">
      <span className="font-mono text-xs font-bold text-blue-400">{number}</span>
      <h3 className="text-base font-semibold text-zinc-50">{title}</h3>
      <p className="text-sm leading-relaxed text-zinc-500">{body}</p>
    </div>
  );
}
