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

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-zinc-950">
      {/* ── Nav ── */}
      <header className="border-b border-zinc-200/70 bg-white/90 backdrop-blur-sm dark:border-zinc-800/70 dark:bg-zinc-950/90">
        <nav className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            RealVerdict
          </Link>
          <div className="flex items-center gap-5 sm:gap-6 text-sm">
            <Link
              href="/methodology"
              className="hidden sm:inline font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Methodology
            </Link>
            <Link
              href="/compare"
              className="hidden sm:inline font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Compare
            </Link>
            <Link
              href="/pricing"
              className="font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Pricing
            </Link>
            {authEnabled &&
              (user ? (
                <Link
                  href="/dashboard"
                  className="font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Sign in
                </Link>
              ))}
          </div>
        </nav>
      </header>

      <main id="analyze" className="flex-1">
        {/* ── Hero ── */}
        <div className="mx-auto w-full max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-20">
          <div className="mb-8 text-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-400">
              Buy-and-hold rental investors
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl md:text-6xl">
              Know your walk-away{" "}
              <span className="text-blue-600 dark:text-blue-400">
                before the spreadsheet lies to you.
              </span>
            </h1>
            <p className="mt-4 text-lg text-zinc-500 dark:text-zinc-400">
              Paste any address. Get a walk-away price, full verdict, and a negotiation-ready Pack — in under a minute.
            </p>
          </div>

          <HomeAnalyzeForm
            initialInputs={initialInputs}
            initialAddress={initialAddress}
            initialProvenance={initialProvenance}
          />

          {/* Sample + trust — one row under the form */}
          <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <Link
              href={sampleHref}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 text-blue-500" aria-hidden="true">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 4.25a.75.75 0 00-1.5 0v3.5l-1.72 1.72a.75.75 0 001.06 1.06l2-2A.75.75 0 008.75 9V5.25z"/>
              </svg>
              See a sample verdict
            </Link>
            <p className="text-xs text-zinc-400 dark:text-zinc-600">
              3 free analyses / week · No credit card
            </p>
          </div>
        </div>

        {/* ── Trust strip ── */}
        <div className="border-y border-zinc-100 bg-zinc-50 dark:border-zinc-800/60 dark:bg-zinc-900/40">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2 px-6 py-3 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
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
          <div className="mx-auto mb-12 max-w-xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
              Everything you need to negotiate from a position of fact
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-px bg-zinc-200 dark:bg-zinc-800 overflow-hidden rounded-2xl sm:grid-cols-3">
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
              body="Offer language grounded in your walk-away price, the weakest seller assumption, and a stress scenario. Ready to paste into an LOI or hand to your agent."
            />
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="border-y border-zinc-100 bg-zinc-50 dark:border-zinc-800/60 dark:bg-zinc-900/40">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
            <h2 className="mb-12 text-center text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
              From listing to Pack in three steps
            </h2>
            <ol className="grid grid-cols-1 gap-10 md:grid-cols-3">
              <Step
                n={1}
                title="Paste an address or Zillow URL"
                body="We auto-fill purchase price, beds/baths, sqft, taxes, insurance, and AVM rent — with a source badge on every field so you know what came from where."
              />
              <Step
                n={2}
                title="Run a live comp analysis"
                body="We pull the nearest sold and rented comparables, filter outliers, and compute comp-derived fair value. You see every comp used and excluded with a one-line why."
              />
              <Step
                n={3}
                title="Generate the Pack when you're going to bat"
                body="PDF + share link: walk-away, three weakest seller assumptions with evidence, stress tests, and counteroffer language. Hand it to your agent or send it yourself."
              />
            </ol>
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Stop underwriting with optimism as the default input.
            </h2>
            <p className="mt-3 text-base text-zinc-500 dark:text-zinc-400">
              Free for your first 3 live analyses a week — including the full Negotiation Pack.
              $29/mo for unlimited. No contract, 7-day refund.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="#analyze"
                className="inline-flex h-11 items-center rounded-md bg-blue-600 px-6 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Underwrite your next rental →
              </Link>
              <Link
                href="/pricing"
                className="inline-flex h-11 items-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-300 dark:hover:border-zinc-500"
              >
                See pricing
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200/70 dark:border-zinc-800/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-xs text-zinc-400 dark:text-zinc-600">
          <div>
            RealVerdict is an analytical tool. Verify assumptions with a qualified agent, lender, and tax advisor before making an offer.
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/methodology" className="hover:text-zinc-700 dark:hover:text-zinc-300">Methodology</Link>
            <Link href="/about" className="hover:text-zinc-700 dark:hover:text-zinc-300">About</Link>
            <Link href="/pricing" className="hover:text-zinc-700 dark:hover:text-zinc-300">Pricing</Link>
            <Link href="/compare" className="hover:text-zinc-700 dark:hover:text-zinc-300">Compare</Link>
          </div>
        </div>
      </footer>
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
    <div className="flex flex-col gap-3 bg-white px-7 py-8 dark:bg-zinc-950">
      <span className="font-mono text-xs font-bold text-blue-500">{number}</span>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
      <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex flex-col gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 font-mono text-sm font-bold text-white dark:bg-zinc-50 dark:text-zinc-900">
        {n}
      </div>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
      <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{body}</p>
    </li>
  );
}
