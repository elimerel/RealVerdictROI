import Link from "next/link";
import InitialVerdict from "../InitialVerdict";
import SaveDealButton from "../SaveDealButton";
import PackGenerateButton from "../PackGenerateButton";
import ShareButton from "../ShareButton";
import type { ChatAnalysisContext } from "@/app/api/chat/route";
import type { AnalyseDealOptions, DealAnalysis } from "@/lib/calculations";
import { formatCurrency, formatPercent } from "@/lib/calculations";
import { TIER_LABEL } from "@/lib/tier-constants";
import { toneCoC, toneCap, toneDSCR, toneToStyle } from "./tier-style";
import { formatMarketSignalsHeroLine } from "@/lib/market-context";

// ---------------------------------------------------------------------------
// Sticky left sidebar for /results. Always visible as the user explores tabs.
// Contains: verdict tier + walk-away summary, 5 metrics, AI prose, actions.
// The heavy OfferCeilingCard (rubric ladder) lives in main content.
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

export default function ResultsSidebar({
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
  subjectFacts,
  isListed,
  analysisContext,
  analyseDealOptions,
  walkAwayPrice,
  walkAwayTier,
}: {
  tier: import("@/lib/calculations").VerdictTier;
  analysis: DealAnalysis;
  address: string | undefined;
  inputs: DealAnalysis["inputs"];
  editHref: string;
  currentUrl: string;
  signedIn: boolean;
  isPro: boolean;
  supabaseConfigured: boolean;
  packEligible: boolean;
  subjectFacts: SubjectFacts;
  isListed: boolean;
  analysisContext?: ChatAnalysisContext;
  analyseDealOptions?: AnalyseDealOptions;
  walkAwayPrice?: number;
  walkAwayTier?: import("@/lib/calculations").VerdictTier;
}) {
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

  const marketHeroLine = analysisContext
    ? formatMarketSignalsHeroLine(analysisContext)
    : null;

  return (
    <aside className="flex flex-col gap-5 lg:gap-6">
      {/* Verdict */}
      <div>
        <h1
          className="text-4xl font-extrabold uppercase leading-none tracking-tighter sm:text-5xl"
          style={{ color: "var(--accent)" }}
        >
          {TIER_LABEL[tier]}
        </h1>
        {address && (
          <p className="mt-2.5 text-sm font-medium text-zinc-400 leading-snug">
            {address}
          </p>
        )}
        {marketHeroLine && (
          <p className="mt-1 text-[11px] text-zinc-600">{marketHeroLine}</p>
        )}
      </div>

      {/* Walk-away price — compact version */}
      {walkAwayPrice && (
        <div
          className="rounded-lg border-l-2 pl-3 py-2.5"
          style={{ borderColor: "var(--accent)" }}
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Walk-away price
          </div>
          <div
            className="mt-0.5 font-mono text-2xl font-bold tabular-nums leading-none"
            style={{ color: "var(--accent)" }}
          >
            {formatCurrency(walkAwayPrice, 0)}
          </div>
          {walkAwayTier && (
            <div className="mt-0.5 text-xs text-zinc-600">
              for {TIER_LABEL[walkAwayTier]}
            </div>
          )}
        </div>
      )}

      {/* Metrics */}
      <div className="flex flex-col gap-1.5">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="flex items-baseline justify-between gap-2 py-1.5 border-b border-zinc-800/60 last:border-0"
          >
            <span className="text-xs text-zinc-600">{m.label}</span>
            <span
              className="font-mono text-sm font-semibold tabular-nums"
              style={m.style}
            >
              {m.value}
            </span>
          </div>
        ))}
      </div>

      {/* AI prose */}
      <div className="text-sm leading-relaxed text-zinc-400">
        <InitialVerdict
          inputs={inputs}
          fallback={analysis.verdict.summary}
          analysisContext={analysisContext}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
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
        <div className="flex flex-wrap gap-2">
          <Link
            href={editHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900"
          >
            <EditIcon />
            Adjust inputs
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
        </div>
      </div>
    </aside>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true">
      <path d="M13.6 2.6a2 2 0 012.8 0l1 1a2 2 0 010 2.8l-9.5 9.5L3.5 17l1.1-4.4 9-10zM12 5.4L5.8 11.6l-.6 2.3 2.3-.6L13.7 7 12 5.4z" />
    </svg>
  );
}
