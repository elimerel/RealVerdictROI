import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import ResultsViewTracker from "../_components/ResultsViewTracker";
import InitialVerdict from "../_components/InitialVerdict";
import FollowUpChat from "../_components/FollowUpChat";
import WhatIfPanel from "../_components/WhatIfPanel";
import StressTestPanel from "../_components/StressTestPanel";
import VerdictRubric from "../_components/VerdictRubric";
import SaveDealButton from "../_components/SaveDealButton";
import ShareButton from "../_components/ShareButton";
import AddToComparisonButton from "../_components/AddToComparisonButton";
import OfferCeilingCard from "../_components/OfferCeilingCard";
import CompsSection from "../_components/CompsSection";
import ResultsTabs from "../_components/ResultsTabs";
import {
  analyseDeal,
  DealAnalysis,
  formatCurrency,
  formatNumber,
  formatPercent,
  inputsFromSearchParams,
  inputsToSearchParams,
  VerdictTier,
  YearProjection,
} from "@/lib/calculations";
import { fetchComps, type CompsResult } from "@/lib/comps";
import { analyzeComparables } from "@/lib/comparables";
import HowWeGotThese from "../_components/HowWeGotThese";
import ResultsWarningsBanner from "../_components/ResultsWarningsBanner";
import AnalysisQuotaExceeded from "../_components/AnalysisQuotaExceeded";
import ProCompsTeaser from "../_components/ProCompsTeaser";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";
import { checkRateLimit, identifierFor } from "@/lib/ratelimit";
import { isPro } from "@/lib/pro";

// ---------------------------------------------------------------------------
// DESIGN SYSTEM -- accent color drives entire page based on verdict tier
// ---------------------------------------------------------------------------

const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "STRONG BUY",
  good: "GOOD DEAL", 
  fair: "BORDERLINE",
  poor: "PASS",
  avoid: "AVOID",
};

const WARN_COLOR = "#eab308";
const BAD_COLOR = "#ef4444";

const TIER_ACCENT: Record<VerdictTier, string> = {
  excellent: "#22c55e",    // green
  good: "#22c55e",         // green
  fair: "#eab308",         // yellow
  poor: "#ef4444",         // red
  avoid: "#ef4444",        // red
};

// ---------------------------------------------------------------------------
// METADATA — builds per-deal title/description and points Open Graph + Twitter
// cards at /api/og?<same params> so shared links render a branded verdict image
// instead of a blank card.
// ---------------------------------------------------------------------------

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const search = await searchParams;
  const inputs = inputsFromSearchParams(search);
  const analysis = analyseDeal(inputs);
  const tier = analysis.verdict.tier;

  const address =
    typeof search.address === "string" && search.address.trim()
      ? search.address.trim()
      : undefined;

  const tierLabel = TIER_LABEL[tier];
  const price = formatCurrency(inputs.purchasePrice, 0);
  const title = address
    ? `${tierLabel} · ${address} · ${price}`
    : `${tierLabel} · ${price}`;

  const description = address
    ? `${tierLabel} verdict for ${address}. ${formatCurrency(analysis.monthlyCashFlow, 0)}/mo cash flow, ${formatPercent(analysis.capRate, 1)} cap, ${isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) + " DSCR" : "no debt"}. See the walk-away price before you make an offer.`
    : `${tierLabel}: ${formatCurrency(analysis.monthlyCashFlow, 0)}/mo cash flow, ${formatPercent(analysis.capRate, 1)} cap rate. With the walk-away price built in.`;

  // Reuse the same query string we received so /api/og produces an image that
  // matches the page the user is actually linking to.
  const ogQuery = inputsToSearchParams(inputs);
  if (address) ogQuery.set("address", address);
  const ogUrl = `/api/og?${ogQuery.toString()}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

// ---------------------------------------------------------------------------

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const search = await searchParams;
  const inputs = inputsFromSearchParams(search);
  const addressRaw = search.address;
  const address =
    typeof addressRaw === "string" && addressRaw.trim()
      ? addressRaw.trim()
      : undefined;

  const editParams = inputsToSearchParams(inputs);
  if (address) editParams.set("address", address);
  const editHref = `/?${editParams.toString()}#analyze`;

  const resultsParams = inputsToSearchParams(inputs);
  if (address) resultsParams.set("address", address);
  const currentUrl = `/results?${resultsParams.toString()}`;

  const supaConfig = supabaseEnv();
  const user = supaConfig.configured ? await getCurrentUser() : null;
  const pro = user ? await isPro(user) : false;

  if (!pro) {
    const hList = await headers();
    const rateReq = new Request("https://internal/", { headers: hList });
    const bucket = user ? "analysis-free-user" : "analysis-free-anon";
    const id = identifierFor(rateReq, user?.id ?? undefined);
    const { allowed, retryAfter } = await checkRateLimit(bucket, id);
    if (!allowed) {
      return (
        <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
          <Header
            editHref={editHref}
            currentUrl={currentUrl}
            supabaseConfigured={supaConfig.configured}
            signedIn={!!user}
          />
          <main className="flex-1">
            <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
              <AnalysisQuotaExceeded
                retryAfter={retryAfter}
                returnTo={currentUrl}
              />
            </div>
          </main>
        </div>
      );
    }
  }

  const analysis = analyseDeal(inputs);

  // Pull comps in parallel with auth — they're hot paths for the new tabs.
  // Beds/baths/sqft passed when present so the comp filter is meaningful.
  // Any 0-or-smaller value is treated as "unknown" to avoid silently
  // disabling filters (RentCast public records sometimes report 0 beds).
  const rawBeds = numberOrUndef(search.beds);
  const rawBaths = numberOrUndef(search.baths);
  const compsBeds = rawBeds && rawBeds > 0 ? rawBeds : undefined;
  const compsBaths = rawBaths && rawBaths > 0 ? rawBaths : undefined;
  const compsSqft = numberOrUndef(search.sqft);
  const propertyType =
    typeof search.propertyType === "string" && search.propertyType.trim()
      ? search.propertyType.trim()
      : undefined;
  const comps: CompsResult | null = address
    ? await fetchComps({
        address,
        beds: compsBeds,
        baths: compsBaths,
        sqft: compsSqft,
      })
    : null;

  // Derive fair value and market rent from comps with full "show your work"
  // workLog so we can display exactly how every number was built. Pass HOA,
  // last-sale, and the listed price so the derivation can HOA-override the
  // category (avoids an SFR comp pool pricing a condo-style townhouse) and
  // cross-check against what the market has actually paid for THIS unit.
  const lastSalePrice = numberOrUndef(search.lastSalePrice);
  const lastSaleDate =
    typeof search.lastSaleDate === "string" && search.lastSaleDate.trim()
      ? search.lastSaleDate.trim()
      : undefined;
  const currentListPrice =
    search.listed === "1" ? inputs.purchasePrice : undefined;
  const comparables = address
    ? analyzeComparables(
        {
          address,
          price: inputs.purchasePrice,
          sqft: compsSqft,
          beds: compsBeds,
          baths: compsBaths,
          yearBuilt: numberOrUndef(search.yearBuilt),
          propertyType,
          monthlyHOA: inputs.monthlyHOA,
          lastSalePrice,
          lastSaleDate,
          currentListPrice,
          expectedAppreciation: inputs.annualAppreciationPercent
            ? inputs.annualAppreciationPercent / 100
            : undefined,
        },
        comps,
      )
    : null;

  const tier = analysis.verdict.tier;
  const accent = TIER_ACCENT[tier];
  const accentSoft = accent + "14"; // ~8% alpha (hex suffix)

  // CSS variables flow down to every child via inheritance. Client components
  // (InitialVerdict, FollowUpChat) read `var(--accent)` directly.
  const rootStyle: CSSProperties & Record<string, string> = {
    "--accent": accent,
    "--accent-soft": accentSoft,
  };

  return (
    <div
      style={rootStyle}
      className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100"
    >
      <ResultsViewTracker
        tier={tier}
        priceBucket={priceBucketForAnalytics(inputs.purchasePrice)}
        source={address ? "address" : "manual"}
      />
      <Header
        editHref={editHref}
        currentUrl={currentUrl}
        supabaseConfigured={supaConfig.configured}
        signedIn={!!user}
      />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-14">
          {/* Resolver warnings — "Zillow scraper offline", "FRED stale", etc.
              Handed off from the homepage via sessionStorage so users don't
              lose the context when they navigate here. */}
          <ResultsWarningsBanner address={address} />

          {/* How we got these numbers — subject + comps + $/sqft-normalized
              derivations. Shown at the top so the user trusts everything
              below it. If a number here looks wrong, they know which comp
              to challenge and can re-run with the right rent. */}
          <HowWeGotThese
            comparables={comparables}
            subjectPrice={inputs.purchasePrice}
            subjectRent={inputs.monthlyRent}
          />

          {/* HERO — tier, ceiling, summary, actions. Always visible. */}
          <HeroSection
            tier={tier}
            analysis={analysis}
            address={address}
            inputs={inputs}
            editHref={editHref}
            currentUrl={currentUrl}
            signedIn={!!user}
            isPro={pro}
            supabaseConfigured={supaConfig.configured}
          />

          {/* DEEP ANALYSIS — tabbed. */}
          <div className="mt-10 sm:mt-14">
            <ResultsTabs
              tabs={[
                {
                  id: "numbers",
                  label: "Numbers",
                  content: (
                    <div className="flex flex-col gap-12">
                      <EvidenceSection analysis={analysis} comps={comps} />
                      <BreakdownSection analysis={analysis} />
                    </div>
                  ),
                },
                {
                  id: "comps",
                  label: "Comps",
                  badge:
                    pro && comps
                      ? String(
                          comps.saleComps.stats.count +
                            comps.rentComps.stats.count,
                        )
                      : undefined,
                  content: pro ? (
                    <CompsSection
                      analysis={analysis}
                      comps={comps}
                      address={address}
                    />
                  ) : (
                    <ProCompsTeaser returnTo={currentUrl} />
                  ),
                },
                {
                  id: "stress",
                  label: "Stress test",
                  content: (
                    <StressTestPanel
                      baseInputs={inputs}
                      baseAnalysis={analysis}
                    />
                  ),
                },
                {
                  id: "whatif",
                  label: "What-if",
                  content: (
                    <WhatIfPanel
                      baseInputs={inputs}
                      baseAnalysis={analysis}
                      address={address}
                    />
                  ),
                },
                {
                  id: "rubric",
                  label: "Rubric",
                  content: <VerdictRubric verdict={analysis.verdict} />,
                },
                {
                  id: "chat",
                  label: "Ask AI",
                  content: <FollowUpChat inputs={inputs} />,
                },
              ]}
            />
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-900 py-6">
        <div className="mx-auto max-w-6xl px-6 text-xs text-zinc-600">
          Figures are projections based on the inputs you provided. Verify
          assumptions independently before committing capital.
        </div>
      </footer>
    </div>
  );
}

function numberOrUndef(v: string | string[] | undefined): number | undefined {
  if (typeof v !== "string" || v === "") return undefined;
  const n = Number(v);
  return isFinite(n) ? n : undefined;
}

// Low-cardinality price bucket for analytics — keeps Plausible props usable.
function priceBucketForAnalytics(price: number): string {
  if (!price || price <= 0) return "none";
  if (price < 100_000) return "<100k";
  if (price < 200_000) return "100-200k";
  if (price < 350_000) return "200-350k";
  if (price < 500_000) return "350-500k";
  if (price < 750_000) return "500-750k";
  if (price < 1_000_000) return "750k-1M";
  if (price < 2_000_000) return "1-2M";
  return "2M+";
}

// ===========================================================================
// HEADER
// ===========================================================================

function Header({
  editHref,
  currentUrl,
  supabaseConfigured,
  signedIn,
}: {
  editHref: string;
  currentUrl: string;
  supabaseConfigured: boolean;
  signedIn: boolean;
}) {
  return (
    <header className="border-b border-zinc-900">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-zinc-100"
        >
          RealVerdict
        </Link>
        <nav className="flex items-center gap-3 sm:gap-5 text-sm">
          <Link
            href={editHref}
            className="font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            Edit
          </Link>
          <Link
            href="/compare"
            className="font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            Compare
          </Link>
          <Link
            href="/pricing"
            className="hidden sm:inline font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            Pricing
          </Link>
          {supabaseConfigured &&
            (signedIn ? (
              <Link
                href="/dashboard"
                className="font-medium text-zinc-400 transition hover:text-zinc-100"
              >
                Deals
              </Link>
            ) : (
              <Link
                href={`/login?redirect=${encodeURIComponent(currentUrl)}`}
                className="font-medium text-zinc-400 transition hover:text-zinc-100"
              >
                Sign in
              </Link>
            ))}
        </nav>
      </div>
    </header>
  );
}

// ===========================================================================
// HERO — verdict tier + walk-away price + AI summary + actions
//
// This is the only section that's always visible above the fold. Everything
// else lives behind tabs so the page reads like an answer, not a dump.
// ===========================================================================

function HeroSection({
  tier,
  analysis,
  address,
  inputs,
  editHref,
  currentUrl,
  signedIn,
  isPro,
  supabaseConfigured,
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
}) {
  const contextParts: string[] = [];
  contextParts.push(formatCurrency(inputs.purchasePrice, 0));
  contextParts.push(`${formatCurrency(analysis.monthlyCashFlow, 0)}/mo`);
  contextParts.push(`Cap ${formatPercent(analysis.capRate, 1)}`);
  contextParts.push(
    `DSCR ${isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞"}`,
  );

  return (
    <section className="grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
      <div className="lg:col-span-3 flex flex-col">
        {address && (
          <p className="mb-3 text-base font-semibold tracking-tight text-zinc-200 sm:text-lg break-words">
            {address}
          </p>
        )}
        <h1
          className="text-4xl font-bold uppercase leading-none tracking-tight sm:text-5xl md:text-6xl"
          style={{ color: "var(--accent)" }}
        >
          {TIER_LABEL[tier]}
        </h1>
        <p className="mt-3 text-xs sm:text-sm text-zinc-500 break-words">
          {contextParts.join(" · ")}
        </p>

        <div
          className="mt-6 border-l-4 pl-4 py-2"
          style={{
            borderColor: "var(--accent)",
            backgroundColor: "var(--accent-soft)",
          }}
        >
          <div className="text-sm">
            <InitialVerdict inputs={inputs} fallback={analysis.verdict.summary} />
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
        />
      </div>

      <div className="lg:col-span-2">
        <OfferCeilingCard inputs={inputs} />
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
}: {
  editHref: string;
  currentUrl: string;
  inputs: DealAnalysis["inputs"];
  address: string | undefined;
  signedIn: boolean;
  isPro: boolean;
  supabaseConfigured: boolean;
  analysis: DealAnalysis;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
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

// ===========================================================================
// SECTION 2 — EVIDENCE
// ===========================================================================

function EvidenceSection({
  analysis,
  comps,
}: {
  analysis: DealAnalysis;
  comps: CompsResult | null;
}) {
  const ltv =
    analysis.inputs.purchasePrice > 0
      ? analysis.loanAmount / analysis.inputs.purchasePrice
      : 0;

  // Market-context anchors. Each block compares a deal-side number against
  // the equivalent comp median and produces a short "vs market" sub-line.
  const subjectPrice = analysis.inputs.purchasePrice;
  const subjectRent = analysis.inputs.monthlyRent;
  const saleMedian = comps?.saleComps.stats.median;
  const rentMedian = comps?.rentComps.stats.median;

  const cashFlowSub = formatCurrency(analysis.annualCashFlow, 0) + " / year";
  const capRateSub = (() => {
    if (!saleMedian || !rentMedian) return undefined;
    // Market cap-rate proxy: comp median NOI / comp median price. We can't
    // measure NOI from RentCast, so approximate using subject's expense ratio
    // applied to median rent — gives a same-market apples-to-apples baseline.
    const subjectExpenseRatio = analysis.operatingExpenseRatio || 0.4;
    const marketAnnualNOI = rentMedian * 12 * (1 - subjectExpenseRatio);
    const marketCap = saleMedian > 0 ? marketAnnualNOI / saleMedian : 0;
    if (!marketCap) return undefined;
    return `Market cap ~${formatPercent(marketCap, 1)}`;
  })();
  const priceSub = saleMedian
    ? `Median sale ${formatCurrency(saleMedian, 0)}`
    : undefined;
  const rentSub = rentMedian
    ? `Median rent ${formatCurrency(rentMedian, 0)}/mo`
    : undefined;

  // Equity multiple = (total cash returned) / cash invested.
  // totalProfit already nets out the cash invested, so adding it back gives
  // total returned-on-cash, which divided by cash invested is the multiple.
  const equityMultiple =
    analysis.totalCashInvested > 0
      ? (analysis.totalProfit + analysis.totalCashInvested) /
        analysis.totalCashInvested
      : 0;

  // Total return = everything the deal produced: operating cash + principal
  // paydown + appreciation (before subtracting the cash invested).
  const totalReturn =
    analysis.totalCashFlow +
    analysis.totalPrincipalPaydown +
    analysis.totalAppreciation;

  return (
    <section>
      {/* Subject vs market — only visible when we have comps data. */}
      {(priceSub || rentSub) && (
        <>
          <MetricGroup label="Subject vs market">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3 sm:gap-y-6">
              <MetricValue
                label="Purchase price"
                value={formatCurrency(subjectPrice, 0)}
                tone="neutral"
                sub={priceSub}
              />
              <MetricValue
                label="Monthly rent"
                value={formatCurrency(subjectRent, 0)}
                tone="neutral"
                sub={rentSub}
              />
              <MetricValue
                label="Price / annual rent (GRM)"
                value={`${analysis.grossRentMultiplier.toFixed(1)}×`}
                tone={toneGRM(analysis.grossRentMultiplier)}
                sub={
                  saleMedian && rentMedian
                    ? `Market ~${(saleMedian / (rentMedian * 12)).toFixed(1)}×`
                    : undefined
                }
              />
            </div>
          </MetricGroup>
          <GroupDivider />
        </>
      )}

      {/* Returns */}
      <MetricGroup label="Returns">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3 sm:gap-y-6">
          <MetricValue
            label="Cash flow / mo"
            value={formatCurrency(analysis.monthlyCashFlow, 0)}
            tone={analysis.monthlyCashFlow >= 0 ? "good" : "bad"}
            sub={cashFlowSub}
          />
          <MetricValue
            label="Cash-on-cash"
            value={formatPercent(analysis.cashOnCashReturn, 1)}
            tone={toneCoC(analysis.cashOnCashReturn)}
          />
          <MetricValue
            label="Cap rate"
            value={formatPercent(analysis.capRate, 2)}
            tone={toneCap(analysis.capRate)}
            sub={capRateSub}
          />
        </div>
      </MetricGroup>

      <GroupDivider />

      {/* Risk: three equal columns */}
      <MetricGroup label="Risk">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3 sm:gap-y-6">
          <MetricValue
            label="DSCR"
            value={
              isFinite(analysis.dscr)
                ? formatNumber(analysis.dscr, 2)
                : "∞"
            }
            tone={toneDSCR(analysis.dscr)}
          />
          <MetricValue
            label="Break-even occupancy"
            value={formatPercent(analysis.breakEvenOccupancy, 0)}
            tone={toneBreakEven(analysis.breakEvenOccupancy)}
          />
          <MetricValue
            label="LTV"
            value={formatPercent(ltv, 0)}
            tone="neutral"
          />
        </div>
      </MetricGroup>

      <GroupDivider />

      {/* Long term */}
      <MetricGroup label="Long term">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3 sm:gap-y-6">
          <MetricValue
            label={`${analysis.inputs.holdPeriodYears}-yr IRR`}
            value={formatPercent(analysis.irr, 1)}
            tone={
              analysis.irr >= 0.1
                ? "good"
                : analysis.irr < 0
                  ? "bad"
                  : "neutral"
            }
          />
          <MetricValue
            label="Equity multiple"
            value={`${formatNumber(equityMultiple, 2)}x`}
            tone={
              equityMultiple >= 2
                ? "good"
                : equityMultiple < 1
                  ? "bad"
                  : "neutral"
            }
          />
          <MetricValue
            label="Total return"
            value={formatCurrency(totalReturn, 0)}
            sub="cash flow + equity + appreciation"
            tone={
              totalReturn > 0
                ? "good"
                : totalReturn < 0
                  ? "bad"
                  : "neutral"
            }
          />
        </div>
      </MetricGroup>
    </section>
  );
}

type Tone = "good" | "warn" | "bad" | "neutral";

function toneToStyle(tone: Tone): CSSProperties {
  switch (tone) {
    case "good":
      return { color: "var(--accent)" };
    case "warn":
      return { color: WARN_COLOR };
    case "bad":
      return { color: BAD_COLOR };
    default:
      return {};
  }
}

function toneCoC(v: number): Tone {
  if (v >= 0.08) return "good";
  if (v >= 0.04) return "warn";
  if (v < 0) return "bad";
  return "neutral";
}
function toneCap(v: number): Tone {
  if (v >= 0.06) return "good";
  if (v >= 0.04) return "warn";
  if (v < 0.03) return "bad";
  return "neutral";
}
function toneDSCR(v: number): Tone {
  if (!isFinite(v)) return "good";
  if (v >= 1.25) return "good";
  if (v >= 1.0) return "warn";
  return "bad";
}
function toneBreakEven(v: number): Tone {
  if (v <= 0.75) return "good";
  if (v <= 0.9) return "warn";
  return "bad";
}
function toneGRM(v: number): Tone {
  if (v <= 0) return "neutral";
  if (v <= 12) return "good";
  if (v <= 18) return "warn";
  return "bad";
}

function MetricGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-6 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function MetricValue({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div
        className="mt-1.5 font-mono text-3xl font-semibold tabular-nums"
        style={toneToStyle(tone)}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-zinc-600">{sub}</div>}
    </div>
  );
}

// ===========================================================================
// SECTION 3 — BREAKDOWN
// ===========================================================================

function BreakdownSection({ analysis }: { analysis: DealAnalysis }) {
  return (
    <section className="flex flex-col gap-10">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        Breakdown
      </div>
      <MonthlyWaterfall analysis={analysis} />
      <CashToClose analysis={analysis} />
      <ProjectionTable projection={analysis.projection} />
      <SaleProceeds analysis={analysis} />
    </section>
  );
}

function MonthlyWaterfall({ analysis }: { analysis: DealAnalysis }) {
  const { inputs } = analysis;

  const grossRent = inputs.monthlyRent;
  const otherIncome = inputs.otherMonthlyIncome;
  const grossInflow = grossRent + otherIncome;

  // Approximate monthly opex by averaging year 1.
  const monthlyPropertyTax = inputs.annualPropertyTax / 12;
  const monthlyInsurance = inputs.annualInsurance / 12;
  const monthlyMaintenance =
    (analysis.annualGrossIncome * (inputs.maintenancePercent / 100)) / 12;
  const monthlyPM =
    (analysis.annualGrossIncome * (inputs.propertyManagementPercent / 100)) /
    12;
  const monthlyCapEx =
    (analysis.annualGrossIncome * (inputs.capexReservePercent / 100)) / 12;
  const monthlyVacancy = grossRent * (inputs.vacancyRatePercent / 100);

  const rows: Row[] = [
    { label: "Monthly rent", value: grossRent, positive: true },
    otherIncome > 0
      ? { label: "Other income", value: otherIncome, positive: true }
      : null,
    { label: "— Vacancy", value: -monthlyVacancy },
    inputs.annualPropertyTax > 0
      ? { label: "— Property tax", value: -monthlyPropertyTax }
      : null,
    inputs.annualInsurance > 0
      ? { label: "— Insurance", value: -monthlyInsurance }
      : null,
    inputs.monthlyHOA > 0
      ? { label: "— HOA", value: -inputs.monthlyHOA }
      : null,
    inputs.monthlyUtilities > 0
      ? { label: "— Utilities", value: -inputs.monthlyUtilities }
      : null,
    {
      label: `— Maintenance (${inputs.maintenancePercent}%)`,
      value: -monthlyMaintenance,
    },
    inputs.propertyManagementPercent > 0
      ? {
          label: `— Property mgmt (${inputs.propertyManagementPercent}%)`,
          value: -monthlyPM,
        }
      : null,
    inputs.capexReservePercent > 0
      ? {
          label: `— CapEx reserve (${inputs.capexReservePercent}%)`,
          value: -monthlyCapEx,
        }
      : null,
    analysis.monthlyMortgagePayment > 0
      ? {
          label: "— Mortgage (P&I)",
          value: -analysis.monthlyMortgagePayment,
        }
      : null,
  ].filter((r): r is Row => r !== null);

  return (
    <Panel title="Monthly cash flow" subtitle={formatCurrency(grossInflow, 0) + " in · " + formatCurrency(grossInflow - analysis.monthlyCashFlow, 0) + " out"}>
      <Table>
        {rows.map((r, i) => (
          <TableRow key={r.label} alt={i % 2 === 1}>
            <td className="py-2.5 text-left text-sm text-zinc-300">
              {r.label}
            </td>
            <td
              className={`py-2.5 text-right font-mono text-sm tabular-nums ${r.value < 0 ? "text-zinc-400" : "text-zinc-100"}`}
            >
              {signedCurrency(r.value)}
            </td>
          </TableRow>
        ))}
        <TableRow bold>
          <td className="pt-3 text-left text-sm font-semibold text-zinc-100">
            Net cash flow
          </td>
          <td
            className="pt-3 text-right font-mono text-base font-semibold tabular-nums"
            style={toneToStyle(
              analysis.monthlyCashFlow >= 0 ? "good" : "bad",
            )}
          >
            {signedCurrency(analysis.monthlyCashFlow)}
          </td>
        </TableRow>
      </Table>
    </Panel>
  );
}

function CashToClose({ analysis }: { analysis: DealAnalysis }) {
  const { inputs } = analysis;
  const rows: Row[] = [
    {
      label: `Down payment (${inputs.downPaymentPercent}%)`,
      value: analysis.downPayment,
    },
    {
      label: `Closing costs (${inputs.closingCostsPercent}%)`,
      value: analysis.closingCosts,
    },
    inputs.rehabCosts > 0
      ? { label: "Rehab", value: inputs.rehabCosts }
      : null,
  ].filter((r): r is Row => r !== null);

  return (
    <Panel
      title="Cash to close"
      subtitle={`Loan: ${formatCurrency(analysis.loanAmount, 0)} at ${inputs.loanInterestRate}% for ${inputs.loanTermYears} years`}
    >
      <Table>
        {rows.map((r, i) => (
          <TableRow key={r.label} alt={i % 2 === 1}>
            <td className="py-2.5 text-left text-sm text-zinc-300">
              {r.label}
            </td>
            <td className="py-2.5 text-right font-mono text-sm tabular-nums text-zinc-100">
              {formatCurrency(r.value, 0)}
            </td>
          </TableRow>
        ))}
        <TableRow bold>
          <td className="pt-3 text-left text-sm font-semibold text-zinc-100">
            Total cash needed
          </td>
          <td
            className="pt-3 text-right font-mono text-base font-semibold tabular-nums"
            style={{ color: "var(--accent)" }}
          >
            {formatCurrency(analysis.totalCashInvested, 0)}
          </td>
        </TableRow>
      </Table>
    </Panel>
  );
}

function ProjectionTable({ projection }: { projection: YearProjection[] }) {
  if (projection.length === 0) return null;
  return (
    <Panel title={`Year-by-year · ${projection.length}-yr projection`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2.5 text-left font-medium">Year</th>
              <th className="px-3 py-2.5 text-right font-medium">
                Gross rent
              </th>
              <th className="px-3 py-2.5 text-right font-medium">NOI</th>
              <th className="px-3 py-2.5 text-right font-medium">
                Debt service
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                Cash flow
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                Cumulative
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                Loan balance
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                Property value
              </th>
              <th className="px-3 py-2.5 text-right font-medium">Equity</th>
            </tr>
          </thead>
          <tbody>
            {projection.map((row, i) => (
              <tr
                key={row.year}
                className={i % 2 === 1 ? "bg-zinc-900/40" : ""}
              >
                <td className="px-3 py-2.5 text-left font-medium text-zinc-100">
                  Y{row.year}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-300 tabular-nums">
                  {formatCurrency(row.grossRent, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-300 tabular-nums">
                  {formatCurrency(row.noi, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-500 tabular-nums">
                  {row.debtService > 0
                    ? formatCurrency(row.debtService, 0)
                    : "—"}
                </td>
                <td
                  className="px-3 py-2.5 text-right font-mono tabular-nums"
                  style={toneToStyle(row.cashFlow >= 0 ? "good" : "bad")}
                >
                  {formatCurrency(row.cashFlow, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-300 tabular-nums">
                  {formatCurrency(row.cumulativeCashFlow, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-500 tabular-nums">
                  {formatCurrency(row.loanBalanceEnd, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-300 tabular-nums">
                  {formatCurrency(row.propertyValueEnd, 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold text-zinc-100 tabular-nums">
                  {formatCurrency(row.equityEnd, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SaleProceeds({ analysis }: { analysis: DealAnalysis }) {
  const { inputs } = analysis;
  return (
    <Panel
      title={`Sale proceeds · exit year ${analysis.saleYear}`}
      subtitle={`Assumes ${inputs.annualAppreciationPercent}%/yr appreciation, ${inputs.sellingCostsPercent}% selling costs`}
    >
      <Table>
        <TableRow>
          <td className="py-2.5 text-left text-sm text-zinc-300">
            Projected sale price
          </td>
          <td className="py-2.5 text-right font-mono text-sm tabular-nums text-zinc-100">
            {formatCurrency(analysis.salePrice, 0)}
          </td>
        </TableRow>
        <TableRow alt>
          <td className="py-2.5 text-left text-sm text-zinc-300">
            — Selling costs ({inputs.sellingCostsPercent}%)
          </td>
          <td className="py-2.5 text-right font-mono text-sm tabular-nums text-zinc-400">
            {signedCurrency(-analysis.sellingCosts)}
          </td>
        </TableRow>
        <TableRow>
          <td className="py-2.5 text-left text-sm text-zinc-300">
            — Loan payoff
          </td>
          <td className="py-2.5 text-right font-mono text-sm tabular-nums text-zinc-400">
            {signedCurrency(-analysis.loanBalanceAtExit)}
          </td>
        </TableRow>
        <TableRow bold>
          <td className="pt-3 text-left text-sm font-semibold text-zinc-100">
            Net sale proceeds
          </td>
          <td
            className="pt-3 text-right font-mono text-base font-semibold tabular-nums"
            style={{ color: "var(--accent)" }}
          >
            {formatCurrency(analysis.netSaleProceeds, 0)}
          </td>
        </TableRow>
      </Table>
    </Panel>
  );
}

type Row = { label: string; value: number; positive?: boolean };

function signedCurrency(n: number): string {
  const formatted = formatCurrency(Math.abs(n), 0);
  if (n < 0) return `−${formatted}`;
  return formatted;
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        {subtitle && (
          <span className="text-xs text-zinc-500">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Table({ children }: { children: ReactNode }) {
  return (
    <table className="w-full border-collapse">
      <tbody>{children}</tbody>
    </table>
  );
}

function TableRow({
  children,
  alt = false,
  bold = false,
}: {
  children: ReactNode;
  alt?: boolean;
  bold?: boolean;
}) {
  const cls = [
    alt ? "bg-zinc-900/40" : "",
    bold ? "border-t border-zinc-800" : "",
  ]
    .join(" ")
    .trim();
  return <tr className={cls}>{children}</tr>;
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

// ===========================================================================
// Small shared primitives
// ===========================================================================

function GroupDivider() {
  return <div className="my-8 h-px bg-zinc-900" />;
}
