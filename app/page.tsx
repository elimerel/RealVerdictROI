import Link from "next/link";
import HomeAnalyzeForm from "./_components/HomeAnalyzeForm";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  DEFAULT_INPUTS,
  inputsFromSearchParams,
  inputsToSearchParams,
  type DealInputs,
} from "@/lib/calculations";
import { getCurrentMortgageRate, fredRateNote } from "@/lib/rates";

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

  // Fetch the current Freddie Mac 30-yr fixed rate from FRED so the very first
  // paint of the form reflects this week's market, not a hard-coded default.
  // Returns null if FRED_API_KEY is missing or FRED is unreachable — in that
  // case the form simply falls back to DEFAULT_INPUTS.loanInterestRate with no
  // badge. NOT awaited in parallel with auth above for the trivial reason
  // that FRED is already 24h-cached; amortized cost is essentially zero.
  const fred = await getCurrentMortgageRate();

  // If the URL already carries inputs (deep link from /results), respect them
  // verbatim. Otherwise seed the form with live FRED data.
  let initialInputs: Partial<DealInputs> | undefined = parsedInputs;
  const initialProvenance: Partial<
    Record<keyof DealInputs, { source: "fred"; confidence: "high"; note: string }>
  > = {};
  if (fred && !parsedInputs) {
    initialInputs = {
      loanInterestRate: Number(fred.rate.toFixed(3)),
    };
    initialProvenance.loanInterestRate = {
      source: "fred",
      confidence: "high",
      note: fredRateNote(fred),
    };
  }

  const sampleParams = inputsToSearchParams(SAMPLE_INPUTS);
  sampleParams.set("address", SAMPLE_ADDRESS);
  const sampleHref = `/results?${sampleParams.toString()}`;

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950">
      <header className="border-b border-zinc-200/70 bg-white/70 backdrop-blur-sm dark:border-zinc-800/70 dark:bg-black/40">
        <nav className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            RealVerdict
          </Link>
          <div className="flex items-center gap-5 sm:gap-6 text-sm">
            <Link
              href="/methodology"
              className="hidden sm:inline font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Methodology
            </Link>
            <Link
              href="/compare"
              className="hidden sm:inline font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Compare
            </Link>
            <Link
              href="/pricing"
              className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Pricing
            </Link>
            {authEnabled &&
              (user ? (
                <Link
                  href="/dashboard"
                  className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Sign in
                </Link>
              ))}
          </div>
        </nav>
      </header>

      <main id="analyze" className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 pt-10 pb-12 sm:pt-16">
          <div className="mb-10 text-center">
            <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-6xl dark:text-zinc-50 mb-4">
              Know the max price{" "}
              <span className="bg-gradient-to-r from-emerald-500 via-sky-500 to-indigo-500 bg-clip-text text-transparent">
                this deal still works at.
              </span>
            </h1>
            <p className="text-lg leading-relaxed text-zinc-600 sm:text-xl dark:text-zinc-300 max-w-2xl mx-auto">
              Paste any address or Zillow URL. In 30 seconds: real cash flow,
              cap rate, DSCR, IRR — and the{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                exact walk-away price
              </span>{" "}
              before this stops being a good deal. So you walk into negotiations
              with a number, not a feeling.
            </p>
          </div>

          <HomeAnalyzeForm
            initialInputs={initialInputs}
            initialAddress={initialAddress}
            initialProvenance={initialProvenance}
          />

          <div className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Don&apos;t have an address handy?{" "}
            <Link
              href={sampleHref}
              className="font-medium text-zinc-900 underline underline-offset-2 transition hover:text-emerald-600 dark:text-zinc-100 dark:hover:text-emerald-400"
            >
              See a sample verdict →
            </Link>
          </div>
        </div>

        {/* TRUST STRIP — sources we pull from, in one line. */}
        <div className="border-y border-zinc-200/70 bg-white/40 dark:border-zinc-800/70 dark:bg-black/20">
          <div className="mx-auto w-full max-w-6xl px-6 py-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500 dark:text-zinc-500">
            <span className="font-medium uppercase tracking-wider">
              Data sources
            </span>
            <span>RentCast AVM &amp; comps</span>
            <span aria-hidden>·</span>
            <span>Zillow listings</span>
            <span aria-hidden>·</span>
            <span>FRED (30-yr mortgage)</span>
            <span aria-hidden>·</span>
            <span>FHFA HPI (metro appreciation)</span>
            <span aria-hidden>·</span>
            <span>FEMA NFHL (flood zones)</span>
            <span aria-hidden>·</span>
            <span>State-level tax &amp; insurance avg.</span>
            <span aria-hidden>·</span>
            <span>OpenAI advisor</span>
          </div>
        </div>

        {/* VALUE PROPS */}
        <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <ValueCard
              title="Walk-away price"
              body="Every analysis tells you the highest price this deal can carry while still hitting STRONG BUY, GOOD, or BORDERLINE. Take the number into your offer."
              accent="emerald"
            />
            <ValueCard
              title="Reality-checked rents"
              body="Your projected rent is compared against live nearby rentals. We flag optimistic assumptions before you bet on them."
              accent="sky"
            />
            <ValueCard
              title="Stress-tested verdict"
              body="Rate up 1pt, rents drop 10%, vacancy doubles — see how the deal holds up across 5 scenarios that actually happen."
              accent="indigo"
            />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="border-y border-zinc-200/70 bg-white/40 dark:border-zinc-800/70 dark:bg-black/20">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
            <h2 className="mb-10 text-center text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              From listing to verdict in three steps
            </h2>
            <ol className="grid grid-cols-1 gap-8 md:grid-cols-3">
              <Step
                n={1}
                title="Paste an address or Zillow URL"
                body="We auto-fill purchase price, beds/baths, sqft, taxes, insurance and AVM rent — with a source badge on every field so you know what came from where."
              />
              <Step
                n={2}
                title="Get the verdict"
                body="STRONG BUY through AVOID. Backed by an itemized rubric across cash flow, cap rate, DSCR, IRR, GRM and break-even occupancy."
              />
              <Step
                n={3}
                title="Negotiate or move on"
                body="The walk-away ceiling tells you what to offer. The what-if sliders show what changes if you push the price down or up."
              />
            </ol>
          </div>
        </section>

        {/* CTA — drives serious investors to Pro, casual users to a sample. */}
        <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Stop talking yourself into bad deals.
            </h2>
            <p className="mt-3 text-base text-zinc-600 dark:text-zinc-300">
              Free for casual analysis. Pro is for investors actively underwriting
              multiple deals a week — unlimited verdicts, live comparables, saved
              portfolio, and cross-device sync.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="#analyze"
                className="inline-flex h-11 items-center rounded-md bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Analyze a deal
              </Link>
              <Link
                href="/pricing"
                className="inline-flex h-11 items-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-900 transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-100 dark:hover:border-zinc-500"
              >
                See pricing
              </Link>
              <Link
                href="/methodology"
                className="inline-flex h-11 items-center px-2 text-sm font-medium text-zinc-600 underline underline-offset-2 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                How the verdict is calculated →
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200/70 dark:border-zinc-800/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-xs text-zinc-500 dark:text-zinc-500">
          <div>
            RealVerdict is an analytical tool for educational purposes. Always
            verify assumptions with a qualified agent, lender, and tax advisor
            before making an offer.
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/methodology" className="hover:text-zinc-900 dark:hover:text-zinc-200">Methodology</Link>
            <Link href="/about" className="hover:text-zinc-900 dark:hover:text-zinc-200">About</Link>
            <Link href="/pricing" className="hover:text-zinc-900 dark:hover:text-zinc-200">Pricing</Link>
            <Link href="/compare" className="hover:text-zinc-900 dark:hover:text-zinc-200">Compare</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

const ACCENT_BORDER = {
  emerald: "border-emerald-500/40",
  sky: "border-sky-500/40",
  indigo: "border-indigo-500/40",
} as const;
const ACCENT_TEXT = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  sky: "text-sky-600 dark:text-sky-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
} as const;

function ValueCard({
  title,
  body,
  accent,
}: {
  title: string;
  body: string;
  accent: keyof typeof ACCENT_BORDER;
}) {
  return (
    <div
      className={`rounded-xl border-l-4 ${ACCENT_BORDER[accent]} bg-white/60 p-6 dark:bg-black/30`}
    >
      <h3
        className={`text-lg font-semibold tracking-tight ${ACCENT_TEXT[accent]}`}
      >
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
        {body}
      </p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-sm font-bold text-white dark:bg-zinc-50 dark:text-zinc-900">
          {n}
        </span>
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
        {body}
      </p>
    </li>
  );
}
