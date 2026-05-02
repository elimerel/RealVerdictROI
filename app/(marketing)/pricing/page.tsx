import Link from "next/link"
import type { Metadata } from "next"
import { supabaseEnv } from "@/lib/supabase/config"
import { getCurrentUser } from "@/lib/supabase/server"
import GetProButton from "./GetProButton"
import { MarketingHeader } from "../_components/MarketingHeader"
import { MarketingFooter } from "../_components/MarketingFooter"

export const metadata: Metadata = {
  title: "Pricing — RealVerdict",
  description:
    "Free tier with 3 full analyses per week. Pro for unlimited underwriting, live comps, and saved deals. $29/month, cancel anytime.",
}

export default async function PricingPage() {
  const authEnabled = supabaseEnv().configured
  const user = authEnabled ? await getCurrentUser() : null

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--rv-surface-bg)" }}>
      <MarketingHeader />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">

          {/* Header */}
          <div className="mx-auto mb-16 flex max-w-2xl flex-col items-center gap-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--rv-accent)" }}>
              Pricing
            </p>
            <h1
              className="text-[36px] sm:text-[52px] font-bold leading-[1.06] text-balance"
              style={{ color: "var(--rv-t1)", letterSpacing: "-0.03em" }}
            >
              Free for your first 3 analyses a week.
            </h1>
            <p className="text-[16px] leading-relaxed" style={{ color: "var(--rv-t2)", maxWidth: "44ch" }}>
              $29/mo when you&apos;re ready for unlimited underwriting. No contract,
              cancel anytime, 7-day refund if it didn&apos;t pay for itself.
            </p>
          </div>

          <PackAnatomy />

          <div className="grid gap-6 md:grid-cols-2 max-w-3xl mx-auto">
            <FreeTierCard />
            <ProTierCard signedIn={!!user} />
          </div>

          <FAQ />
        </div>
      </main>

      <MarketingFooter />
    </div>
  )
}

function PackAnatomy() {
  const pillars: Array<{ title: string; body: string }> = [
    {
      title: "Max offer price",
      body: "The highest offer a deal can carry while still clearing the full rubric — capped by comp-derived fair value. Never inflated by an overgenerous rent assumption.",
    },
    {
      title: "Three weakest assumptions",
      body: "The 2–3 numbers the seller inflated, ranked by dollar impact. Each one backed by the specific comps that break it.",
    },
    {
      title: "Comp evidence",
      body: "Every comp the engine used, with a one-line 'why it fits.' Every comp it excluded, with a one-line 'why it didn't.' Nothing the listing agent can hand-wave away.",
    },
    {
      title: "Stress scenarios",
      body: "Rate up 1pt, vacancy doubles, rents drop 10%, insurance climbs, 5-year hold — verdict changes flagged inline so you know which risk breaks the deal.",
    },
    {
      title: "Counteroffer script",
      body: "The exact words your agent sends the listing agent. Grounded in max offer price + the weakest seller assumption + a concrete stress outcome.",
    },
    {
      title: "Agent-ready PDF + share link",
      body: "Branded PDF at one URL. Send it to your agent, your spouse, your lender — everyone opens the same page and sees the same numbers.",
    },
  ]

  return (
    <section className="mb-16">
      <div className="mx-auto max-w-3xl text-center mb-8">
        <h2
          className="text-[24px] sm:text-[30px] font-bold"
          style={{ color: "var(--rv-t1)", letterSpacing: "-0.02em" }}
        >
          What a full analysis contains
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>
          Six sections, one deliverable. Free for your first 3 per week.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pillars.map((p) => (
          <div
            key={p.title}
            className="rounded-xl p-5"
            style={{
              background: "var(--rv-surface-2)",
              border: "1px solid var(--rv-fill-border)",
            }}
          >
            <h3 className="text-[13px] font-semibold" style={{ color: "var(--rv-t1)" }}>
              {p.title}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>
              {p.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function FreeTierCard() {
  return (
    <div
      className="flex flex-col rounded-2xl p-8"
      style={{
        background: "var(--rv-surface-bg)",
        border: "1px solid var(--rv-fill-border)",
      }}
    >
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--rv-t3)" }}>
          Free
        </h2>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-[40px] font-bold tracking-tight" style={{ color: "var(--rv-t1)", letterSpacing: "-0.03em" }}>
            $0
          </span>
          <span className="text-[14px]" style={{ color: "var(--rv-t3)" }}>/ forever</span>
        </div>
        <p className="mt-2 text-[13px]" style={{ color: "var(--rv-t2)" }}>
          Enough to test the engine on your next offer.
        </p>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3">
        <Feature highlighted>
          <span className="font-semibold" style={{ color: "var(--rv-t1)" }}>3 full analyses per week</span>
          {" "}— max offer price, weakest assumptions, comp evidence, stress scenarios, counteroffer script, PDF + share link
        </Feature>
        <Feature>Unlimited fast estimates (Zestimate + FRED rates + state-average tax &amp; insurance)</Feature>
        <Feature>All metrics — cash flow, cap rate, DSCR, IRR, 5-year projections</Feature>
        <Feature>Stress test (5 scenarios) and what-if sliders</Feature>
        <Feature>Auto-fill from any address or Zillow URL</Feature>
        <Feature>AI advisor — ask follow-up questions about the deal</Feature>
      </ul>

      <Link
        href="/research"
        className="mt-8 inline-flex h-11 items-center justify-center rounded-full text-[13px] font-semibold transition-colors hover:bg-[var(--rv-fill-1)]"
        style={{ border: "1px solid var(--rv-fill-border-strong)", color: "var(--rv-t1)" }}
      >
        Try it free
      </Link>
    </div>
  )
}

function ProTierCard({ signedIn }: { signedIn: boolean }) {
  return (
    <div
      className="relative flex flex-col rounded-2xl p-8"
      style={{
        background: "var(--rv-surface-bg)",
        border: "2px solid var(--rv-accent)",
        boxShadow: "0 4px 24px var(--rv-accent-subtle)",
      }}
    >
      <span
        className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
        style={{ background: "var(--rv-accent)" }}
      >
        Recommended
      </span>
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--rv-accent)" }}>
          Pro
        </h2>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-[40px] font-bold tracking-tight" style={{ color: "var(--rv-t1)", letterSpacing: "-0.03em" }}>
            $29
          </span>
          <span className="text-[14px]" style={{ color: "var(--rv-t3)" }}>/ month</span>
        </div>
        <p className="mt-2 text-[13px]" style={{ color: "var(--rv-t2)" }}>
          For investors making multiple offers a month.
        </p>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3">
        <Feature highlighted>
          <span className="font-semibold" style={{ color: "var(--rv-t1)" }}>Unlimited analyses</span>
          {" "}— no weekly cap, full PDF + share link on every deal
        </Feature>
        <Feature highlighted>Unlimited live comp analyses (Pro skips the 3/week quota)</Feature>
        <Feature highlighted>
          Comp Reasoning Explainer — every comp the engine used (and excluded) with a one-line why, plus the p25/median/p75 band
        </Feature>
        <Feature highlighted>Save deals to your portfolio dashboard</Feature>
        <Feature highlighted>Cross-device deal comparison sync</Feature>
        <Feature highlighted>Cancel anytime · 7-day refund, no questions</Feature>
      </ul>

      <div className="mt-8">
        <GetProButton signedIn={signedIn} />
        <p className="mt-3 text-center text-[11px]" style={{ color: "var(--rv-t3)" }}>
          Cancel anytime · 7-day refund ·{" "}
          <Link
            href="/terms"
            className="underline underline-offset-2"
            style={{ color: "var(--rv-t2)" }}
          >
            Terms apply
          </Link>
        </p>
      </div>
    </div>
  )
}

function Feature({
  children,
  highlighted = false,
}: {
  children: React.ReactNode
  highlighted?: boolean
}) {
  return (
    <li className="flex items-start gap-3 text-[13px]" style={{ color: "var(--rv-t2)" }}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 flex-shrink-0"
        style={{ color: highlighted ? "var(--rv-accent)" : "var(--rv-t3)" }}
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>{children}</span>
    </li>
  )
}

function FAQ() {
  const items: Array<{ q: string; a: string }> = [
    {
      q: "Is it really free? What's the catch?",
      a: "No catch. You get 3 full analyses per week on the free tier — same PDF, same share link, same content as Pro. If you're underwriting more than 3 deals a week, $29/mo is trivial compared to what a single bad offer costs you.",
    },
    {
      q: "What's the difference between a fast estimate and a live comp analysis?",
      a: "The fast estimate gives you the verdict, max offer price, stress tests, and what-if sliders using best-available defaults — no live MLS comps, unlimited on free tier. A live comp analysis queries actual sale and rent comparables for that exact address; this is what unlocks the full deliverable and the Comp Reasoning Explainer. Free tier: 3 live analyses/week. Pro: unlimited.",
    },
    {
      q: "What's actually different in Pro?",
      a: "Three things: (1) unlimited live comp analyses — no weekly cap, (2) Comp Reasoning Explainer — every comp the engine used (and excluded) with a one-line why, plus the p25/median/p75 band, and (3) saved portfolio dashboard + cross-device comparison sync.",
    },
    {
      q: "Who is this for?",
      a: "Investors making their next offer. Whether it's your first or your fiftieth — if you're about to send an agent a number on a specific listing, the analysis is the artifact that replaces 'trust me, it's a good deal' with data-backed evidence.",
    },
    {
      q: "Where does the data come from?",
      a: "RentCast for AVM and listings, Zillow for active listings, FRED for live mortgage rates, FHFA for metro appreciation, FEMA NFHL for flood zones, plus state-level tax and insurance averages. Every input has a source badge — see the methodology page for full detail.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. One click in the Stripe billing portal, no contract, no questions. 7-day refund if it didn't work for you.",
    },
  ]

  return (
    <section className="mx-auto mt-24 max-w-2xl">
      <h2
        className="text-center text-[24px] font-bold mb-8"
        style={{ color: "var(--rv-t1)", letterSpacing: "-0.02em" }}
      >
        Questions
      </h2>
      <dl className="divide-y" style={{ borderColor: "var(--rv-fill-border)" }}>
        {items.map((item) => (
          <div key={item.q} className="py-5" style={{ borderColor: "var(--rv-fill-border)" }}>
            <dt className="text-[14px] font-semibold" style={{ color: "var(--rv-t1)" }}>
              {item.q}
            </dt>
            <dd className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>
              {item.a}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
