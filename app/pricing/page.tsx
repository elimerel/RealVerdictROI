import Link from "next/link";
import type { Metadata } from "next";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";
import GetProButton from "./GetProButton";

export const metadata: Metadata = {
  title: "Pricing — RealVerdict",
  description:
    "Simple, honest pricing. Start free and upgrade when it's worth it.",
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
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
          <div className="mx-auto mb-14 flex max-w-2xl flex-col items-center gap-3 text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
              Simple, honest pricing
            </h1>
            <p className="text-base leading-relaxed text-zinc-600 sm:text-lg dark:text-zinc-300">
              Start free. Upgrade when it&apos;s worth it.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <FreeTierCard />
            <ProTierCard signedIn={!!user} />
          </div>

          <FAQ />
        </div>
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
          Everything you need to size up a deal.
        </p>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-300">
        <Feature>Up to 5 full analyses per week (rolling)</Feature>
        <Feature>All metrics — cash flow, cap rate, DSCR, IRR, 5-year projections</Feature>
        <Feature>Walk-away price ceiling on every deal</Feature>
        <Feature>Stress test (5 scenarios) and what-if sliders</Feature>
        <Feature>Auto-fill from any address or Zillow URL</Feature>
        <Feature>AI advisor — ask follow-up questions about the deal</Feature>
        <Feature>Shareable verdict links</Feature>
      </ul>

      <Link
        href="/"
        className="mt-8 inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-6 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
      >
        Start free
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
            $19
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            / month
          </span>
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          For investors actively evaluating deals.
        </p>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-300">
        <Feature highlighted>Everything in Free, with no weekly limit</Feature>
        <Feature highlighted>Live sale &amp; rent comparables tab on every verdict</Feature>
        <Feature highlighted>Save deals to your portfolio dashboard</Feature>
        <Feature highlighted>Cross-device deal comparison sync</Feature>
        <Feature highlighted>Cancel anytime · 7-day refund, no questions</Feature>
      </ul>

      <div className="mt-8">
        <GetProButton signedIn={signedIn} />
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
      q: "Can I really use it free forever?",
      a: "Yes. The free tier doesn't expire — up to 5 full analyses per rolling week.",
    },
    {
      q: "What counts as one analysis?",
      a: "Each time you submit a new property and view its verdict page. Re-opening a verdict you already ran doesn't count.",
    },
    {
      q: "What's actually different in Pro?",
      a: "Three things: (1) no weekly cap, (2) the live comparables tab on every verdict, (3) saving deals to your portfolio with cross-device sync. The verdict math, walk-away ceiling, stress tests, and AI advisor are free.",
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
