import Link from "next/link";
import type { Metadata } from "next";
import { MarketingFooter } from "../_components/MarketingFooter";

export const metadata: Metadata = {
  title: "About — RealVerdict",
  description:
    "Why RealVerdict exists: most rental analyzers are calculators that confirm what you already want to believe. We built the opposite.",
};

export default function AboutPage() {
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
              href="/methodology"
              className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Methodology
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
        <article className="mx-auto w-full max-w-2xl px-6 py-16 sm:py-24">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
            Most rental analyzers tell you what you want to hear.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-zinc-700 dark:text-zinc-300">
            They&apos;re really just spreadsheets with marketing on them. Plug
            in optimistic rent, optimistic appreciation, optimistic vacancy, and
            they will dutifully agree with you. The math works. The deal
            doesn&apos;t.
          </p>

          <h2 className="mt-12 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            We built RealVerdict because we kept watching that happen.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
            People paying 20× annual rent on a property and calling it cash
            flowing because they assumed 0% vacancy. People treating 8%
            appreciation as a constant. People discovering the real property
            tax six months after closing. The market doesn&apos;t punish you
            for being optimistic in the spreadsheet — it just punishes you
            later, with interest.
          </p>

          <h2 className="mt-12 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            What&apos;s different here.
          </h2>
          <ul className="mt-3 space-y-3 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
            <li>
              <strong className="text-zinc-900 dark:text-zinc-50">Live data instead of guesses.</strong>{" "}
              Mortgage rates from FRED. Property taxes and AVM from RentCast.
              Rent comps within a 1-mile radius. Metro appreciation from FHFA
              HPI. Flood zone from FEMA. Every input on the page has a source
              badge — you can see where the number came from and challenge it.
            </li>
            <li>
              <strong className="text-zinc-900 dark:text-zinc-50">A walk-away price on every deal.</strong>{" "}
              Not just &quot;is this a good deal at the listed price?&quot; but
              &quot;what is the maximum price this deal still works at?&quot; —
              so you walk into negotiations with a number, not a feeling.
            </li>
            <li>
              <strong className="text-zinc-900 dark:text-zinc-50">Stress tests built in.</strong>{" "}
              Rates up 1pt, rents down 10%, vacancy doubles, taxes reassess
              up. We don&apos;t have to imagine these — they all happened in
              the last 24 months. The verdict tells you which ones break the
              deal.
            </li>
            <li>
              <strong className="text-zinc-900 dark:text-zinc-50">No vague verdicts.</strong>{" "}
              STRONG BUY, GOOD, BORDERLINE, PASS, AVOID. Backed by an itemized
              rubric across cash flow, cap rate, DSCR, IRR, GRM, and
              break-even occupancy. If you disagree with the verdict, the
              rubric tells you exactly which metric to argue about.
            </li>
          </ul>

          <h2 className="mt-12 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            What we&apos;re not.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
            We&apos;re not a brokerage. We&apos;re not selling you a course.
            We&apos;re not going to put you in a Discord and call it a
            mastermind. We don&apos;t have a referral arrangement with any
            lender. We make money one way: investors who underwrite multiple
            deals a week pay $19/month for unlimited verdicts, comps, and a
            saved portfolio. Everything else is free.
          </p>

          <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-10 dark:border-zinc-800">
            <Link
              href="/#analyze"
              className="inline-flex h-11 items-center rounded-md bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Run your first verdict
            </Link>
            <Link
              href="/methodology"
              className="inline-flex h-11 items-center rounded-md border border-zinc-300 px-5 text-sm font-semibold text-zinc-900 transition hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500"
            >
              Read the methodology
            </Link>
          </div>
        </article>
      </main>

      <MarketingFooter />
    </div>
  );
}
