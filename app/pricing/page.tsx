import Link from "next/link";
import type { Metadata } from "next";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";
import GetProButton from "./GetProButton";

export const metadata: Metadata = {
  title: "Pricing — RealVerdict",
  description:
    "Pricing for buy-and-hold rental investors: free tier with Negotiation Pack, Pro for unlimited live comp runs and saved deals.",
};

export default async function PricingPage() {
  const authEnabled = supabaseEnv().configured;
  const user = authEnabled ? await getCurrentUser() : null;

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200/70 bg-white/90 backdrop-blur-sm dark:border-zinc-800/70 dark:bg-zinc-950/90">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            RealVerdict
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href="/#analyze"
              className="font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Analyze a deal
            </Link>
            <Link
              href="/pricing"
              className="font-medium text-zinc-900 dark:text-zinc-50"
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
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">

          {/* ── Hero ── */}
          <div className="mx-auto mb-12 flex max-w-2xl flex-col items-center gap-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-400">
              Buy-and-hold investors
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
              $29/mo. One bad offer costs $20K+.
            </h1>
            <p className="text-base leading-relaxed text-zinc-500 dark:text-zinc-400 sm:text-lg">
              Start free — 3 full Negotiation Packs a week, no credit card.
              Go Pro when you&apos;re making enough offers that the cap matters.
            </p>
          </div>

          {/* ── Pricing cards — FIRST ── */}
          <div className="mb-16 grid gap-6 md:grid-cols-2">
            <FreeTierCard />
            <ProTierCard signedIn={!!user} />
          </div>

          {/* ── Pack anatomy — SECOND (proof after the price) ── */}
          <PackAnatomy />

          {/* ── FAQ ── */}
          <FAQ />
        </div>
      </main>

      <footer className="border-t border-zinc-200/70 dark:border-zinc-800/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 text-xs text-zinc-400 dark:text-zinc-600">
          RealVerdict is an analytical tool. Verify assumptions with a qualified agent, lender, and tax advisor before making an offer.
        </div>
      </footer>
    </div>
  );
}

function FreeTierCard() {
  return (
    <div className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Free
        </h2>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            $0
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">/ forever</span>
        </div>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Enough to test the engine on your next 3 offers this week.
        </p>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-300">
        <Feature highlighted>
          <strong className="text-zinc-900 dark:text-zinc-50">3 full Negotiation Packs per week</strong>
          {" "}— walk-away, weakest assumptions, stress scenarios, counteroffer script, agent-ready PDF
        </Feature>
        <Feature>Unlimited fast estimates (Zestimate + FRED rates)</Feature>
        <Feature>Walk-away price capped by comp-derived fair value</Feature>
        <Feature>Cash flow, cap rate, DSCR, IRR, 5-year projections</Feature>
        <Feature>Stress test (5 scenarios) and what-if sliders</Feature>
        <Feature>Auto-fill from any address or Zillow URL</Feature>
        <Feature>AI advisor — ask follow-up questions about the deal</Feature>
      </ul>

      <Link
        href="/"
        className="mt-8 inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-6 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
      >
        Try a Pack free
      </Link>
    </div>
  );
}

function ProTierCard({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="relative flex flex-col rounded-2xl border-2 border-blue-600 bg-white p-8 shadow-lg shadow-blue-600/10 dark:border-blue-500 dark:bg-zinc-900 dark:shadow-blue-500/10">
      <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
        Recommended
      </span>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-50">
          Pro
        </h2>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            $29
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">/ month</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          One bad offer costs $20K+. This costs $29.
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          For investors making multiple offers a month.
        </p>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-300">
        <Feature highlighted>
          <strong className="text-zinc-900 dark:text-zinc-50">Unlimited Negotiation Packs</strong>
          {" "}— no weekly cap, full PDF + share link on every deal
        </Feature>
        <Feature highlighted>Unlimited live comp analyses — no quota</Feature>
        <Feature highlighted>
          Comp Reasoning Explainer — every comp used and excluded with a one-line why, plus p25/median/p75 band
        </Feature>
        <Feature highlighted>Save deals to your portfolio dashboard</Feature>
        <Feature highlighted>Cross-device deal comparison sync</Feature>
      </ul>

      <div className="mt-8 space-y-2">
        <GetProButton signedIn={signedIn} />
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
          Cancel anytime · 7-day refund, no questions · No contract
        </p>
      </div>
    </div>
  );
}

function PackAnatomy() {
  const pillars: Array<{ title: string; body: string }> = [
    {
      title: "Walk-away price",
      body: "The highest offer the deal can carry while still clearing the rubric, capped by comp-derived fair value. Never inflated by an overgenerous rent assumption.",
    },
    {
      title: "Three weakest assumptions",
      body: "The 2–3 numbers the seller inflated, ranked by dollar impact. Each backed by the specific comps that break it.",
    },
    {
      title: "Comp evidence",
      body: "Every comp the engine used, with a one-line \"why it fits.\" Every comp excluded, with a one-line \"why it didn't.\" Nothing the listing agent can hand-wave away.",
    },
    {
      title: "Stress scenarios",
      body: "Rate up 1pt, vacancy doubles, rents drop 10%, expenses spike, exit at a discount — verdict flips flagged inline so you know which risk breaks the deal.",
    },
    {
      title: "Counteroffer script",
      body: "The exact words your agent sends the listing agent. Grounded in walk-away price, the weakest seller assumption, and a concrete stress outcome.",
    },
    {
      title: "Agent-ready PDF + share link",
      body: "One URL. Send it to your agent, your lender, your partner — everyone sees the same numbers from the same source.",
    },
  ];
  return (
    <section className="mb-16">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
          What a Pack contains
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Six sections. One deliverable. Free on the first 3 analyses each week.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pillars.map((p) => (
          <div
            key={p.title}
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Feature({
  children,
  highlighted = false,
}: {
  children: React.ReactNode;
  highlighted?: boolean;
}) {
  return (
    <li className="flex items-start gap-3">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`mt-0.5 shrink-0 ${
          highlighted ? "text-blue-600 dark:text-blue-400" : "text-zinc-300 dark:text-zinc-600"
        }`}
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

function FAQ() {
  const items: Array<{ q: string; a: string }> = [
    {
      q: "The Pack is really free? What's the catch?",
      a: "No catch. You get 3 full Negotiation Packs per week on the free tier — same PDF, same share link, same content as Pro. The economics work because we cache aggressively and the expensive part (live comps) reuses the same cached pull. If you generate more than 3 Packs a week, you're underwriting enough deals that $29/mo is trivial compared to what a single bad offer costs you.",
    },
    {
      q: "What's a \"Pack\" and why do I care?",
      a: "The Negotiation Pack is the deliverable. It's a branded PDF (plus a share link you can send your agent) that contains: (1) walk-away price capped by comp-derived fair value, (2) the three weakest assumptions in the seller's pro forma ranked by dollar impact, (3) comp evidence with every comp used and excluded, (4) five stress scenarios with verdict flips flagged inline, and (5) a counteroffer script your agent can send as-is. It's the thing you walk into negotiations with.",
    },
    {
      q: "What's the difference between a fast estimate and a live comp pull?",
      a: "The fast estimate gives you the verdict, walk-away price, stress tests, and what-if sliders using best-available defaults — no live MLS comps, unlimited on free tier. A live comp pull queries actual sale and rent comparables for that exact address; this is what unlocks the Negotiation Pack and the Comp Reasoning Explainer. Free tier: 3 live pulls/week. Pro: unlimited.",
    },
    {
      q: "What's actually different in Pro?",
      a: "Three things: (1) unlimited live comp analyses and Packs — no weekly cap, (2) Comp Reasoning Explainer — every comp the engine used and excluded with a one-line why, plus the p25/median/p75 band, and (3) saved portfolio dashboard + cross-device comparison sync. The verdict math, walk-away ceiling, stress tests, AI advisor, and the Pack itself are all free up to the weekly quota.",
    },
    {
      q: "Who is this for?",
      a: "Investors making their next offer. Whether it's your first or your fiftieth — if you're about to send an agent a number on a specific listing, the Pack is the artifact that replaces \"trust me, it's a good deal\" with six pages of comp-backed evidence. It's most valuable for buyers who've underwritten 1–10 deals and want to stop using their gut on the next one.",
    },
    {
      q: "Where does the data come from?",
      a: "RentCast for AVM and listings, Zillow for active listings, FRED for live mortgage rates, FHFA for metro appreciation, FEMA NFHL for flood zones, plus state-level tax and insurance averages. Every input has a source badge — see /methodology for full detail.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. One click in the Stripe billing portal, no contract, no questions. 7-day refund if it didn't work for you.",
    },
  ];
  return (
    <section className="mx-auto max-w-2xl">
      <h2 className="mb-6 text-center text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Questions
      </h2>
      <dl className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {items.map((item) => (
          <details key={item.q} className="group py-1">
            <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 text-sm font-semibold text-zinc-900 marker:content-none hover:text-blue-600 dark:text-zinc-50 dark:hover:text-blue-400">
              {item.q}
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </summary>
            <dd className="pb-4 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              {item.a}
            </dd>
          </details>
        ))}
      </dl>
    </section>
  );
}
