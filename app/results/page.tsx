import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { headers } from "next/headers";
import ResultsViewTracker from "../_components/ResultsViewTracker";
import FollowUpChat from "../_components/FollowUpChat";
import WhatIfPanel from "../_components/WhatIfPanel";
import StressTestPanel from "../_components/StressTestPanel";
import VerdictRubric from "../_components/VerdictRubric";
import CompsSection from "../_components/CompsSection";
import ResultsTabs from "../_components/ResultsTabs";
import HowWeGotThese from "../_components/HowWeGotThese";
import ResultsWarningsBanner from "../_components/ResultsWarningsBanner";
import AnalysisQuotaExceeded from "../_components/AnalysisQuotaExceeded";
import ProCompsTeaser from "../_components/ProCompsTeaser";
import ResultsHeader from "../_components/results/ResultsHeader";
import HeroSection, {
  RunLiveCompsCTA,
} from "../_components/results/HeroSection";
import EvidenceSection from "../_components/results/EvidenceSection";
import BreakdownSection from "../_components/results/BreakdownSection";
import { TIER_ACCENT, TIER_LABEL } from "../_components/results/tier-style";
import {
  analyseDeal,
  findOfferCeiling,
  formatCurrency,
  formatPercent,
  inputsFromSearchParams,
  inputsToSearchParams,
} from "@/lib/calculations";
import { fetchComps, type CompsResult } from "@/lib/comps";
import { analyzeComparables } from "@/lib/comparables";
import { pickWeakAssumptions } from "@/lib/negotiation-pack";
import type { ChatAnalysisContext } from "@/app/api/chat/route";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";
import { checkRateLimit, identifierFor } from "@/lib/ratelimit";
import { isPro } from "@/lib/pro";

// ---------------------------------------------------------------------------
// /results — verdict + walk-away price + deep analysis tabs.
//
// This file is the orchestrator: parse search params → auth + quota gates →
// fetch comps (when live-comp opt-in) → analyze → render. Every visual
// concern lives in a child component under _components/results/.
//
// File map:
//   _components/results/ResultsHeader.tsx   — top nav
//   _components/results/HeroSection.tsx     — verdict tier + walk-away + actions
//   _components/results/EvidenceSection.tsx — metrics tab (Numbers, top half)
//   _components/results/BreakdownSection.tsx — tables tab (Numbers, bottom half)
//   _components/results/tier-style.ts       — shared tier palette + tone helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// METADATA — builds per-deal title/description and points Open Graph +
// Twitter cards at /api/og?<same params> so shared links render a branded
// verdict image instead of a blank card.
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

  // Live-comp opt-in (§20.8). Without this flag the page is a fast estimate:
  // no RentCast comp pull, no quota burn. The "Run live comp analysis" CTA
  // toggles this on. Pro users can opt in unlimited; free users have
  // 3 / 7-day rolling window (analysis-free-user limiter).
  const liveComps = search.livecomps === "1";

  // Quota only fires on the live-comp path. Browse-and-bounce visits to
  // /results don't burn analyses anymore — that was eating the free tier
  // for tire-kickers and not telling us anything about real intent.
  if (liveComps && !pro) {
    const hList = await headers();
    const rateReq = new Request("https://internal/", { headers: hList });
    const bucket = user ? "analysis-free-user" : "analysis-free-anon";
    const id = identifierFor(rateReq, user?.id ?? undefined);
    const { allowed, retryAfter } = await checkRateLimit(bucket, id);
    if (!allowed) {
      return (
        <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
          <ResultsHeader
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

  // Comp inputs (used only when liveComps === true). Beds/baths/sqft passed
  // when present so the comp filter is meaningful. Any 0-or-smaller value is
  // treated as "unknown" to avoid silently disabling filters (RentCast public
  // records sometimes report 0 beds).
  const rawBeds = numberOrUndef(search.beds);
  const rawBaths = numberOrUndef(search.baths);
  const compsBeds = rawBeds && rawBeds > 0 ? rawBeds : undefined;
  const compsBaths = rawBaths && rawBaths > 0 ? rawBaths : undefined;
  const compsSqft = numberOrUndef(search.sqft);
  const propertyType =
    typeof search.propertyType === "string" && search.propertyType.trim()
      ? search.propertyType.trim()
      : undefined;
  const lastSalePrice = numberOrUndef(search.lastSalePrice);
  const lastSaleDate =
    typeof search.lastSaleDate === "string" && search.lastSaleDate.trim()
      ? search.lastSaleDate.trim()
      : undefined;

  // Live comp pull — only when the user has explicitly clicked through. On
  // the fast estimate path comps and comparables stay null, and every UI
  // surface that consumes them already has empty-state handling.
  const comps: CompsResult | null =
    liveComps && address
      ? await fetchComps({
          address,
          beds: compsBeds,
          baths: compsBaths,
          sqft: compsSqft,
        })
      : null;

  const currentListPrice =
    search.listed === "1" ? inputs.purchasePrice : undefined;
  const comparables =
    liveComps && address
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

  // URL the "Run live comp analysis" button navigates to — same query
  // string with livecomps=1 added. Built once so the CTA can render in
  // multiple locations (top of page, inside Comps tab teaser).
  const liveCompsHref = (() => {
    const sp = inputsToSearchParams(inputs);
    if (address) sp.set("address", address);
    if (typeof search.beds === "string") sp.set("beds", search.beds);
    if (typeof search.baths === "string") sp.set("baths", search.baths);
    if (typeof search.sqft === "string") sp.set("sqft", search.sqft);
    if (typeof search.yearBuilt === "string")
      sp.set("yearBuilt", search.yearBuilt);
    if (typeof search.propertyType === "string")
      sp.set("propertyType", search.propertyType);
    if (typeof search.lastSalePrice === "string")
      sp.set("lastSalePrice", search.lastSalePrice);
    if (typeof search.lastSaleDate === "string")
      sp.set("lastSaleDate", search.lastSaleDate);
    if (search.listed === "1") sp.set("listed", "1");
    sp.set("livecomps", "1");
    return `/results?${sp.toString()}`;
  })();

  const tier = analysis.verdict.tier;
  const accent = TIER_ACCENT[tier];
  const accentSoft = accent + "14"; // ~8% alpha (hex suffix)

  // ---------------------------------------------------------------------
  // AI chat context. Compute walk-away + weak assumptions once here and
  // pass them into both InitialVerdict and FollowUpChat so the AI layer
  // speaks with the same numbers as the Hero card, the Pack, and the
  // Comps tab. Without this the AI used to invent its own "fair offer"
  // that contradicted OfferCeilingCard sitting 200px above it.
  // ---------------------------------------------------------------------
  const marketValueAnchor =
    comparables?.marketValue?.value ??
    (inputs.purchasePrice > 0 ? inputs.purchasePrice : undefined);
  const ceilingForChat = findOfferCeiling(inputs, {
    marketValueCap: marketValueAnchor,
    marketValueCapSource: comparables?.marketValue?.value ? "comps" : "list",
  });
  const weakAssumptionsForChat = comparables
    ? pickWeakAssumptions({
        inputs,
        analysis,
        comparables,
        warnings: [],
        provenance: {},
      }).slice(0, 3)
    : [];
  const analysisContext: ChatAnalysisContext = {
    walkAwayPrice: ceilingForChat.primaryTarget?.price,
    walkAwayTier:
      ceilingForChat.primaryTarget?.tier === "avoid"
        ? undefined
        : ceilingForChat.primaryTarget?.tier,
    marketValueCapSource: comparables?.marketValue?.value ? "comps" : "list",
    fairValue: comparables?.marketValue?.value ?? undefined,
    fairValueConfidence: comparables?.marketValue?.confidence ?? undefined,
    marketRent: comparables?.marketRent?.value ?? undefined,
    marketRentConfidence: comparables?.marketRent?.confidence ?? undefined,
    weakAssumptions: weakAssumptionsForChat.map((w) => ({
      field: w.field,
      current: w.current,
      realistic: w.realistic,
      gap: w.gap,
    })),
  };

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
      <ResultsHeader
        editHref={editHref}
        currentUrl={currentUrl}
        supabaseConfigured={supaConfig.configured}
        signedIn={!!user}
      />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-14">
          <ResultsWarningsBanner address={address} />

          <HowWeGotThese
            comparables={comparables}
            subjectPrice={inputs.purchasePrice}
            subjectRent={inputs.monthlyRent}
          />

          {!liveComps && address && (
            <RunLiveCompsCTA href={liveCompsHref} isPro={pro} />
          )}

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
            packEligible={liveComps && !!comparables && !!address}
            marketValueCap={
              // Walk-away discipline: bound the ceiling by comp-derived fair
              // value when we have it, list price otherwise. Without this the
              // income rubric can return walk-away prices 5-10× market value
              // on rent-heavy listings (the $3.4M-on-a-$540k-listing bug).
              comparables?.marketValue?.value ??
              (inputs.purchasePrice > 0 ? inputs.purchasePrice : undefined)
            }
            marketValueCapSource={
              comparables?.marketValue?.value ? "comps" : "list"
            }
            subjectFacts={{
              beds: compsBeds,
              baths: compsBaths,
              sqft: compsSqft,
              yearBuilt: numberOrUndef(search.yearBuilt),
              propertyType,
              lastSalePrice,
              lastSaleDate,
            }}
            isListed={search.listed === "1"}
            analysisContext={analysisContext}
          />

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
                      comparables={comparables}
                      address={address}
                      liveCompsHref={!liveComps ? liveCompsHref : undefined}
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
                  content: (
                    <FollowUpChat
                      inputs={inputs}
                      analysisContext={analysisContext}
                    />
                  ),
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
