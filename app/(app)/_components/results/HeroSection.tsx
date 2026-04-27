import Link from "next/link";
import InitialVerdict from "../InitialVerdict";
import SaveDealButton from "../SaveDealButton";
import PackGenerateButton from "../PackGenerateButton";
import ShareButton from "../ShareButton";
import AddToComparisonButton from "../AddToComparisonButton";
import type { ChatAnalysisContext } from "@/app/api/chat/route";
import OfferCeilingCard from "../OfferCeilingCard";
import {
  type AnalyseDealOptions,
  type DealAnalysis,
  formatCurrency,
  formatPercent,
  type VerdictTier,
} from "@/lib/calculations";
import { TIER_LABEL, toneCoC, toneCap, toneDSCR, toneToStyle } from "./tier-style";
import { formatMarketSignalsHeroLine } from "@/lib/market-context";

// ---------------------------------------------------------------------------
// Hero section for /results — verdict tier + walk-away price + AI summary
// + actions. This is the only section that's always visible above the
// fold. Everything else lives behind tabs so the page reads like an
// answer, not a dump.
//
// Props are drilled from page.tsx; we deliberately don't put data
// fetching or auth state in here so this file stays trivially easy to
// review and refactor.
// ---------------------------------------------------------------------------

type SubjectFacts = {
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  propertyType?: string;
  lastSalePrice?: number;
  lastSaleDate?: string;
};

export default function HeroSection({
  tier,
  analysis,
  address,
  inputs,
  editHref,
  currentUrl,
  signedIn,
  isPro,
  supabaseConfigured,
  packEligible,
  marketValueCap,
  marketValueCapSource,
  subjectFacts,
  isListed,
  analysisContext,
  analyseDealOptions,
}: {
  tier: VerdictTier;
  analysis: DealAnalysis;
  address: string | undefined;
  inputs: DealAnalysis["inputs"];
  editHref: string;
  currentUrl: string;
  signedIn: boolean;
  isPro: boolean;
  supabaseConfigured: boolean;
  packEligible: boolean;
  marketValueCap?: number;
  marketValueCapSource?: "comps" | "list";
  subjectFacts: SubjectFacts;
  isListed: boolean;
  analysisContext?: ChatAnalysisContext;
  analyseDealOptions?: AnalyseDealOptions;
}) {
  const contextParts: string[] = [];
  contextParts.push(formatCurrency(inputs.purchasePrice, 0));
  contextParts.push(`${formatCurrency(analysis.monthlyCashFlow, 0)}/mo`);
  // Cap rate rounded to 2 decimals everywhere — Evidence section and Pack
  // already use 2, hero previously used 1, which caused cross-tab drift.
  contextParts.push(`Cap ${formatPercent(analysis.capRate, 2)}`);
  contextParts.push(
    `DSCR ${isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞"}`,
  );

  const marketHeroLine = analysisContext
    ? formatMarketSignalsHeroLine(analysisContext)
    : null;

  const metrics = [
    {
      label: "Cash flow",
      value: `${analysis.monthlyCashFlow >= 0 ? "+" : ""}${formatCurrency(analysis.monthlyCashFlow, 0)}/mo`,
      style: toneToStyle(analysis.monthlyCashFlow >= 0 ? "good" : "bad"),
    },
    {
      label: "Cap rate",
      value: formatPercent(analysis.capRate, 2),
      style: toneToStyle(toneCap(analysis.capRate)),
    },
    {
      label: "DSCR",
      value: isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞",
      style: toneToStyle(toneDSCR(analysis.dscr)),
    },
    {
      label: "IRR",
      value: formatPercent(analysis.irr, 1),
      style: toneToStyle(analysis.irr >= 0.09 ? "good" : analysis.irr >= 0.05 ? "warn" : "bad"),
    },
    {
      label: "Cash-on-cash",
      value: formatPercent(analysis.cashOnCashReturn, 1),
      style: toneToStyle(toneCoC(analysis.cashOnCashReturn)),
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
      {/* LEFT: Walk-away price — the hero number */}
      <div className="lg:col-span-3">
        <OfferCeilingCard
          inputs={inputs}
          marketValueCap={marketValueCap}
          marketValueCapSource={marketValueCapSource}
          analyseDealOptions={analyseDealOptions}
        />
      </div>

      {/* RIGHT: verdict tier + metric grid + AI prose + actions */}
      <div className="lg:col-span-2 flex flex-col gap-5">
        <div>
          <h1
            className="text-3xl font-bold uppercase leading-none tracking-tight sm:text-4xl"
            style={{ color: "var(--accent)" }}
          >
            {TIER_LABEL[tier]}
          </h1>
          {address && (
            <p className="mt-2 text-sm font-medium text-zinc-400 break-words">
              {address}
            </p>
          )}
          {marketHeroLine && (
            <p className="mt-1.5 text-[11px] leading-snug text-zinc-600">
              {marketHeroLine}
            </p>
          )}
        </div>

        {/* 5-metric grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {m.label}
              </div>
              <div
                className="mt-0.5 font-mono text-base font-bold tabular-nums"
                style={m.style}
              >
                {m.value}
              </div>
            </div>
          ))}
        </div>

        {/* AI prose */}
        <div
          className="rounded-lg border-l-4 pl-4 py-2"
          style={{
            borderColor: "var(--accent)",
            backgroundColor: "var(--accent-soft)",
          }}
        >
          <div className="text-sm text-zinc-300">
            <InitialVerdict
              inputs={inputs}
              fallback={analysis.verdict.summary}
              analysisContext={analysisContext}
            />
          </div>
        </div>

        <HeroActions
          editHref={editHref}
          currentUrl={currentUrl}
          inputs={inputs}
          address={address}
          signedIn={signedIn}
          isPro={isPro}
          supabaseConfigured={supabaseConfigured}
          analysis={analysis}
          packEligible={packEligible}
          subjectFacts={subjectFacts}
          isListed={isListed}
        />
      </div>
    </section>
  );
}

function HeroActions({
  editHref,
  currentUrl,
  inputs,
  address,
  signedIn,
  isPro,
  supabaseConfigured,
  analysis,
  packEligible,
  subjectFacts,
  isListed,
}: {
  editHref: string;
  currentUrl: string;
  inputs: DealAnalysis["inputs"];
  address: string | undefined;
  signedIn: boolean;
  isPro: boolean;
  supabaseConfigured: boolean;
  analysis: DealAnalysis;
  packEligible: boolean;
  subjectFacts: SubjectFacts;
  isListed: boolean;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      {packEligible && address && (
        <PackGenerateButton
          inputs={inputs}
          address={address}
          subjectFacts={subjectFacts}
          currentUrl={currentUrl}
          signedIn={signedIn}
          supabaseConfigured={supabaseConfigured}
          isListed={isListed}
        />
      )}
      <Link
        href={editHref}
        className="inline-flex h-11 min-h-[44px] items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-3.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
      >
        <EditIcon />
        Adjust
      </Link>
      <SaveDealButton
        inputs={inputs}
        address={address}
        currentUrl={currentUrl}
        signedIn={signedIn}
        isPro={isPro}
        supabaseConfigured={supabaseConfigured}
      />
      <ShareButton path={currentUrl} />
      <AddToComparisonButton
        inputs={inputs}
        address={address}
        analysis={analysis}
        signedIn={signedIn}
        remoteSyncEnabled={signedIn && isPro}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run-live-comps CTA — visible on the fast-estimate path only.
//
// Sits above the Hero on /results when the user landed via autofill (no
// RentCast comp pull yet). Clicking navigates to ?livecomps=1 which
// triggers the actual comp fetch, runs analyzeComparables, and populates
// the "How we got these numbers" derivation, the Comps tab, and the
// inputs for the Negotiation Pack. This is the §20.8 architecture pivot:
// browse-and-bounce traffic costs us nothing, real intent gets the full
// engine.
// ---------------------------------------------------------------------------

export function RunLiveCompsCTA({
  href,
  isPro,
}: {
  href: string;
  isPro: boolean;
}) {
  return (
    <div
      className="mb-8 rounded-lg border p-5 sm:p-6"
      style={{
        borderColor: "var(--accent)",
        backgroundColor: "var(--accent-soft)",
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">
            Fast estimate
          </div>
          <h2 className="mt-1 text-base font-semibold text-zinc-100 sm:text-lg">
            This verdict is running on the fast estimate.
          </h2>
          <p className="mt-1.5 text-sm text-zinc-300">
            Numbers above use Zillow&apos;s Zestimate, the live FRED 30-yr
            rate, and state-average insurance + tax (homestead-corrected).
            Run the live comp analysis to pull the actual sale and rent
            comps for this address — and unlock the Negotiation Pack.
            {!isPro && " Counts as one of your 3 free analyses this month."}
          </p>
        </div>
        <Link
          href={href}
          className="inline-flex h-11 items-center justify-center whitespace-nowrap rounded-md bg-zinc-100 px-5 text-sm font-semibold text-zinc-900 transition hover:bg-white"
        >
          Run live comp analysis
        </Link>
      </div>
    </div>
  );
}

function EditIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-zinc-400"
      aria-hidden="true"
    >
      <path d="M13.6 2.6a2 2 0 012.8 0l1 1a2 2 0 010 2.8l-9.5 9.5L3.5 17l1.1-4.4 9-10zM12 5.4L5.8 11.6l-.6 2.3 2.3-.6L13.7 7 12 5.4z" />
    </svg>
  );
}
