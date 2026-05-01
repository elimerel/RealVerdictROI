import Link from "next/link";
import type { Metadata } from "next";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";
import GetProButton from "./GetProButton";
import { MarketingFooter } from "../_components/MarketingFooter";

export const metadata: Metadata = {
  title: "Pricing — RealVerdict",
  description:
    "Pricing for buy-and-hold rental investors: free tier with Negotiation Pack, Pro for unlimited live comp runs and saved deals.",
};

export default async function PricingPage() {
  const authEnabled = supabaseEnv().configured;
  const user = authEnabled ? await getCurrentUser() : null;

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
              href="/#analyze"
              className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
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
                  href="/deals"
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
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
          <div className="mx-auto mb-14 flex max-w-2xl flex-col items-center gap-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-400">
              Buy-and-hold investors
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
              The Pack is free for your first 3 live analyses a week.
            </h1>
            <p className="text-base leading-relaxed text-zinc-600 sm:text-lg dark:text-zinc-300">
              $29/mo when you&apos;re ready for unlimited underwriting runs. No
              contract, cancel anytime, 7-day refund if the Pack didn&apos;t pay
              for itself.
            </p>
          </div>

          <PackAnatomy />

          <div className="grid gap-6 md:grid-cols-2">
            <FreeTierCard />
            <ProTierCard signedIn={!!user} />
          </div>

          <FAQ />
        </div>
      </main>

      <MarketingFooter />
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
      body: "The 2-3 numbers the seller inflated, ranked by dollar impact. Each one backed by the specific comps that break it.",
    },
    {
      title: "Comp evidence",
      body: "Every comp the engine used, with a one-line \"why it fits.\" Every comp it excluded, with a one-line \"why it didn't.\" Nothing the listing agent can hand-wave away.",
    },
    {
      title: "Stress scenarios",
      body: "Rate up 1pt, vacancy doubles, rents drop 10%, insurance climbs, 5-year hold — verdict changes flagged inline so you know which risk breaks the deal.",
    },
    {
      title: "Counteroffer script",
      body: "The exact words your agent sends the listing agent. Grounded in walk-away price + the weakest seller assumption + a concrete stress outcome.",
    },
    {
      title: "Agent-ready PDF + share link",
      body: "Branded PDF at one URL. Send it to your agent, your spouse, your lender — everyone opens the same page and sees the same number.",
    },
  ];
  return (
    <section className="mb-14">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          What a Pack actually contains
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-base">
          Six sections, one deliverable. Free for your first 3 live analyses a
          week.
        </p>
      </div>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pillars.map((p) => (
          <div
            key={p.title}
            className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {p.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {p.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FreeTierCard() {
  return (
    <div className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Free
        </h2>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            $0
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            / forever
          </span>
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Enough to test the engine on your next offer.
        </p>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-300">
        <Feature highlighted>
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">
            3 full Negotiation Packs per week
          </span>{" "}
          — walk-away price, weakest assumptions, comp evidence, stress
          scenarios, counteroffer script, agent-ready PDF + share link
        </Feature>
        <Feature>
          Unlimited fast estimates (Zestimate + FRED rates + state-average
          tax &amp; insurance)
        </Feature>
        <Feature>
          Walk-away price capped by comp-derived fair value on every analysis
        </Feature>
        <Feature>All metrics — cash flow, cap rate, DSCR, IRR, 5-year projections</Feature>
        <Feature>Stress test (5 scenarios) and what-if sliders</Feature>
        <Feature>Auto-fill from any address or Zillow URL</Feature>
        <Feature>AI advisor — ask follow-up questions about the deal</Feature>
      </ul>

      <Link
        href="/"
        className="mt-8 inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-6 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
      >
        Try a Pack free
      </Link>
    </div>
  );
}

function ProTierCard({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="relative flex flex-col rounded-2xl border-2 border-zinc-900 bg-white p-8 shadow-xl shadow-zinc-900/10 dark:border-zinc-100 dark:bg-zinc-950 dark:shadow-black/40">
      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white dark:bg-zinc-100 dark:text-zinc-900">
        Recommended
      </span>
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-50">
          Pro
        </h2>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            $29
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            / month
          </span>
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          For investors making multiple offers a month.
        </p>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-300">
        <Feature highlighted>
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">
            Unlimited Negotiation Packs
          </span>{" "}
          — no weekly cap, full PDF + share link on every deal
        </Feature>
        <Feature highlighted>
          Unlimited live comp analyses (Pro skips the 3/week quota)
        </Feature>
        <Feature highlighted>
          Comp Reasoning Explainer — every comp the engine used (and excluded)
          with a one-line why, plus the p25/median/p75 band
        </Feature>
        <Feature highlighted>Save deals to your portfolio dashboard</Feature>
        <Feature highlighted>Cross-device deal comparison sync</Feature>
        <Feature highlighted>Cancel anytime · 7-day refund, no questions</Feature>
      </ul>

      <div className="mt-8">
        <GetProButton signedIn={signedIn} />
        <p className="mt-3 text-center text-[11px] text-zinc-500 dark:text-zinc-500">
          Cancel anytime · 7-day refund ·{" "}
          <Link
            href="/terms"
            className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-200"
          >
            Terms apply
          </Link>
        </p>
      </div>
    </div>
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
      <CheckIcon highlighted={highlighted} />
      <span>{children}</span>
    </li>
  );
}

function CheckIcon({ highlighted }: { highlighted: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`mt-0.5 flex-shrink-0 ${
        highlighted
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-zinc-400 dark:text-zinc-500"
      }`}
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function FAQ() {
  const items: Array<{ q: string; a: string }> = [
    {
      q: "The Pack is really free? What's the catch?",
      a: "No catch. You get 3 full Negotiation Packs per week on the free tier — same PDF, same share link, same content as Pro. The economics work because we cache aggressively and the expensive part (live comps) reuses the same cached pull across the analysis and the Pack. If you generate more than 3 Packs a week, you're underwriting enough deals that $29/mo is trivial compared to what a single bad offer costs you.",
    },
    {
      q: "What's a \"Pack\" and why do I care?",
      a: "The Negotiation Pack is the deliverable. It's a branded PDF (plus a share link you can send your agent) that contains: (1) walk-away price capped by comp-derived fair value, (2) the three weakest assumptions in the seller's pro forma ranked by dollar impact, (3) comp evidence — every comp used and every comp excluded with a reason, (4) five stress scenarios with verdict flips flagged inline, and (5) a counteroffer script your agent can send as-is. It's the thing you walk into negotiations with.",
    },
    {
      q: "What's the difference between a fast estimate and a live comp pull?",
      a: "The fast estimate gives you the verdict, walk-away price, stress tests, and what-if sliders using best-available defaults — no live MLS comps, unlimited on free tier. A live comp pull queries actual sale and rent comparables for that exact address; this is what unlocks the Negotiation Pack and the Comp Reasoning Explainer. Free tier: 3 live pulls/week. Pro: unlimited.",
    },
    {
      q: "What's actually different in Pro?",
      a: "Three things: (1) unlimited live comp analyses and Packs — no weekly cap, (2) Comp Reasoning Explainer — every comp the engine used (and excluded) with a one-line why, plus the p25/median/p75 band, and (3) saved portfolio dashboard + cross-device comparison sync. The verdict math, walk-away ceiling, stress tests, AI advisor, and the Pack itself are all free up to the weekly quota.",
    },
    {
      q: "Who is this for?",
      a: "Investors making their next offer. Whether it's your first or your fiftieth — if you're about to send an agent a number on a specific listing, the Pack is the artifact that replaces \"trust me, it's a good deal\" with six pages of comp-backed evidence. It's most valuable for buyers who've underwritten 1-10 deals and want to stop using their gut on the next one.",
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
    <section className="mx-auto mt-20 max-w-2xl">
      <h2 className="text-center text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Questions
      </h2>
      <dl className="mt-8 divide-y divide-zinc-200 dark:divide-zinc-800">
        {items.map((item) => (
          <div key={item.q} className="py-5">
            <dt className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {item.q}
            </dt>
            <dd className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {item.a}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
