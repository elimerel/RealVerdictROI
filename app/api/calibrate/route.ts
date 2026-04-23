import { NextResponse, type NextRequest } from "next/server";
import { analyseDeal, DEFAULT_INPUTS, type DealInputs } from "@/lib/calculations";
import { fetchComps } from "@/lib/comps";
import { analyzeComparables, toAnalyseRentEvidence } from "@/lib/comparables";
import { buildPack } from "@/lib/negotiation-pack";
import { withErrorReporting, captureError } from "@/lib/observability";
import type { ResolveResult } from "@/app/api/property-resolve/route";

// ---------------------------------------------------------------------------
// /api/calibrate — back-office calibration endpoint.
//
// Purpose: run one listing (by Zillow URL or address) through the entire
// pipeline — resolve → fetch comps → analyse → build Pack — and return a
// flat, structured summary of the numbers that matter for engine
// calibration. The CLI harness at `scripts/calibrate.mjs` loops over a
// listings.json file, hits this endpoint for each row, and writes a
// Markdown report that's safe to diff across runs to spot regressions.
//
// Why a dedicated endpoint (vs scripting it client-side):
//   - Single source of truth. The numbers in the calibration report come
//     from the same code that renders /results and /pack. If this
//     endpoint says "verdict = GOOD DEAL", that's what the user sees.
//   - Easy to reuse from a future admin UI or batch back-testing harness.
//   - Zero client dependency on lib/* internals — the CLI just calls
//     fetch() against this route, so it stays a 60-line file.
//
// Auth: gated by CALIBRATION_SECRET. If env is set, request must include
// it as a Bearer token OR ?secret= query param. If env is absent AND
// we're not in production, we allow the call through so local dev
// "just works." In production without the secret set, the endpoint
// hard-fails — we never expose this surface publicly since (a) it hits
// RentCast on every call and (b) an attacker could rip structured
// analyses of arbitrary addresses.
// ---------------------------------------------------------------------------

type SanityCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

type CalibrateResponse = {
  address: string | null;
  state: string | null;
  listPrice: number;
  walkAwayPrice: number | null;
  walkAwayTier: string | null;
  walkAwayDiscountPercent: number | null;
  verdict: string;
  fairValue: number | null;
  fairValueConfidence: string | null;
  marketRent: number | null;
  monthlyRent: number;
  monthlyCashFlow: number;
  capRate: number;
  dscr: number;
  irr: number;
  cashOnCashReturn: number;
  weakAssumptions: Array<{ field: string; current: string; realistic: string; gap: string }>;
  redFlags: string[];
  saleCompsCount: number;
  rentCompsCount: number;
  sanityChecks: SanityCheck[];
  sanityPassed: number;
  sanityFailed: number;
};

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CALIBRATION_SECRET;
  if (!expected) {
    // No secret configured. Only allow in non-production environments, so
    // a forgotten env var in prod doesn't silently leave this open.
    return process.env.NODE_ENV !== "production";
  }
  const provided =
    req.nextUrl.searchParams.get("secret") ??
    req.headers.get("authorization")?.replace(/^bearer\s+/i, "") ??
    null;
  return provided === expected;
}

export const GET = withErrorReporting(
  "api.calibrate",
  async (req: NextRequest) => {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { error: "Unauthorized. Set CALIBRATION_SECRET and pass it as ?secret= or Bearer." },
        { status: 401 },
      );
    }

    const params = req.nextUrl.searchParams;
    const url = params.get("url");
    const address = params.get("address");
    if (!url && !address) {
      return NextResponse.json(
        { error: "Provide either ?url= (Zillow listing) or ?address=." },
        { status: 400 },
      );
    }

    // Resolve step: same-origin HTTP to /api/property-resolve. Reusing the
    // endpoint (vs importing its internals) keeps one canonical resolve
    // path — if prod /results gets new resolver behavior, calibration
    // picks it up automatically.
    const origin = new URL(req.url).origin;
    const resolvePath = url
      ? { method: "POST", body: JSON.stringify({ url }) }
      : null;

    let resolved: ResolveResult;
    try {
      const resolveRes = resolvePath
        ? await fetch(`${origin}/api/property-resolve`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: resolvePath.body,
          })
        : await fetch(
            `${origin}/api/property-resolve?address=${encodeURIComponent(
              address!,
            )}`,
          );

      if (!resolveRes.ok) {
        const body = await resolveRes.text();
        return NextResponse.json(
          {
            error: "resolve-failed",
            status: resolveRes.status,
            body: body.slice(0, 500),
          },
          { status: 502 },
        );
      }
      resolved = (await resolveRes.json()) as ResolveResult;
    } catch (err) {
      captureError(err, { area: "api.calibrate.resolve", extra: { url, address } });
      return NextResponse.json(
        { error: "resolve-network-error" },
        { status: 502 },
      );
    }

    // Comps step: best-effort. If RENTCAST_API_KEY is missing or the comp
    // pool is too thin, fetchComps returns null and we still emit a row
    // so the CLI report shows "fair value: —, rent comps: 0" rather than
    // blowing up. That's the right behavior for calibration — a null-comp
    // row is itself a signal worth surfacing.
    const subjectFacts = {
      address: resolved.address ?? "",
      beds: resolved.facts.bedrooms,
      baths: resolved.facts.bathrooms,
      sqft: resolved.facts.squareFootage,
      propertyType: resolved.facts.propertyType,
    };

    const compsResult = await fetchComps({
      address: subjectFacts.address,
      beds: subjectFacts.beds,
      baths: subjectFacts.baths,
      sqft: subjectFacts.sqft,
      propertyType: subjectFacts.propertyType,
    }).catch((err) => {
      captureError(err, { area: "api.calibrate.comps" });
      return null;
    });

    // Resolver returns Partial<DealInputs> because its output is a
    // "suggested starting point" for the client form. For calibration we
    // need a fully-populated DealInputs — merge over DEFAULT_INPUTS the
    // same way the client does on initial page load.
    const fullInputs: DealInputs = {
      ...DEFAULT_INPUTS,
      ...resolved.inputs,
    };
    const comparables = analyzeComparables(subjectFacts, compsResult);
    const analysis = analyseDeal(
      fullInputs,
      toAnalyseRentEvidence(comparables),
    );
    const pack = buildPack({
      address: resolved.address ?? "",
      inputs: fullInputs,
      analysis,
      comparables,
      warnings: resolved.warnings ?? [],
      provenance: resolved.provenance ?? {},
    });

    const sanityChecks = runSanityChecks({
      listPrice: fullInputs.purchasePrice,
      monthlyRent: fullInputs.monthlyRent,
      walkAwayPrice: pack.headline.walkAwayPrice,
      fairValue: comparables.marketValue?.value ?? null,
      marketRent: comparables.marketRent?.value ?? null,
      capRate: analysis.capRate,
      dscr: analysis.dscr,
      monthlyCashFlow: analysis.monthlyCashFlow,
      annualNOI: analysis.annualNOI,
      annualCashFlow: analysis.annualCashFlow,
      annualDebtService: analysis.annualDebtService,
      saleCompsCount: compsResult?.saleComps.items.length ?? 0,
      rentCompsCount: compsResult?.rentComps.items.length ?? 0,
      verdict: analysis.verdict.tier,
    });

    const response: CalibrateResponse = {
      address: resolved.address ?? null,
      state: resolved.state ?? null,
      listPrice: fullInputs.purchasePrice,
      walkAwayPrice: pack.headline.walkAwayPrice,
      walkAwayTier: pack.headline.walkAwayTier,
      walkAwayDiscountPercent: pack.headline.walkAwayDiscountPercent,
      verdict: analysis.verdict.tier,
      fairValue: comparables.marketValue?.value ?? null,
      fairValueConfidence: comparables.marketValue?.confidence ?? null,
      marketRent: comparables.marketRent?.value ?? null,
      monthlyRent: fullInputs.monthlyRent,
      monthlyCashFlow: analysis.monthlyCashFlow,
      capRate: analysis.capRate,
      dscr: analysis.dscr,
      irr: pack.snapshot.irr,
      cashOnCashReturn: analysis.cashOnCashReturn,
      weakAssumptions: pack.weakAssumptions.slice(0, 3).map((w) => ({
        field: w.field,
        current: w.current,
        realistic: w.realistic,
        gap: w.gap,
      })),
      redFlags: resolved.warnings ?? [],
      saleCompsCount: compsResult?.saleComps.items.length ?? 0,
      rentCompsCount: compsResult?.rentComps.items.length ?? 0,
      sanityChecks,
      sanityPassed: sanityChecks.filter((c) => c.pass).length,
      sanityFailed: sanityChecks.filter((c) => !c.pass).length,
    };

    return NextResponse.json(response);
  },
);

// ---------------------------------------------------------------------------
// Sanity checks — objective, automatable checks against industry anchors
// and the engine's own math. These do NOT require human expert judgment
// (the earlier "compare vs user's gut" model assumed the operator was an
// experienced investor with local-market knowledge, which they aren't).
// A failed check means EITHER the engine produced a nonsensical number
// OR the listing genuinely has extreme economics — either way it's a row
// that deserves a second look.
// ---------------------------------------------------------------------------

function runSanityChecks(a: {
  listPrice: number;
  monthlyRent: number;
  walkAwayPrice: number | null;
  fairValue: number | null;
  marketRent: number | null;
  capRate: number;
  dscr: number;
  monthlyCashFlow: number;
  annualNOI: number;
  annualCashFlow: number;
  annualDebtService: number;
  saleCompsCount: number;
  rentCompsCount: number;
  verdict: string;
}): SanityCheck[] {
  const out: SanityCheck[] = [];

  // 1. Walk-away must be in a sane band relative to list. The original
  //    bug that kicked off the market-value cap fix was a $3.4M walk-away
  //    on a $540k listing. Any walk-away outside [30%, 110%] of list is
  //    almost always a math error, not a real offer.
  if (a.walkAwayPrice !== null && a.listPrice > 0) {
    const ratio = a.walkAwayPrice / a.listPrice;
    out.push({
      id: "walkaway-band",
      label: "Walk-away within 30%-110% of list",
      pass: ratio >= 0.3 && ratio <= 1.1,
      detail: `Walk-away ${fmtMoney(a.walkAwayPrice)} / list ${fmtMoney(a.listPrice)} = ${(ratio * 100).toFixed(1)}%`,
    });
  }

  // 2. Cap rate must be plausible. Outside 1%-20% means either the rent
  //    pull failed, the tax line is wrong, or the list price is
  //    structurally broken. Surfaces homestead-trap and rent-bot
  //    failures.
  out.push({
    id: "caprate-band",
    label: "Cap rate within 1%-20%",
    pass: isFinite(a.capRate) && a.capRate >= 0.01 && a.capRate <= 0.2,
    detail: `Cap rate = ${(a.capRate * 100).toFixed(2)}%`,
  });

  // 3. DSCR must be finite and plausible. Infinite DSCR is fine (no
  //    debt), but negative or absurdly high is a math error.
  out.push({
    id: "dscr-band",
    label: "DSCR finite or >= 0",
    pass: !isFinite(a.dscr) || a.dscr >= 0,
    detail: `DSCR = ${isFinite(a.dscr) ? a.dscr.toFixed(2) : "∞"}`,
  });

  // 4. Cash flow identity: annualCashFlow should ≈ annualNOI -
  //    annualDebtService within ±$5 rounding. If this fails the engine
  //    is doing different math in different places — exactly the
  //    "disconnected" feeling the user reported.
  const cfIdentity = a.annualNOI - a.annualDebtService;
  out.push({
    id: "cashflow-identity",
    label: "annualCashFlow ≈ annualNOI − annualDebtService (±$5)",
    pass: Math.abs(cfIdentity - a.annualCashFlow) <= 5,
    detail: `Got ${fmtMoney(a.annualCashFlow)}, expected ${fmtMoney(cfIdentity)} (Δ = ${fmtMoney(Math.abs(cfIdentity - a.annualCashFlow))})`,
  });

  // 5. Monthly-annual consistency: monthlyCashFlow * 12 should ≈
  //    annualCashFlow within ±$12 (one dollar per month rounding).
  out.push({
    id: "monthly-annual-cf",
    label: "monthlyCashFlow × 12 ≈ annualCashFlow (±$12)",
    pass: Math.abs(a.monthlyCashFlow * 12 - a.annualCashFlow) <= 12,
    detail: `Got ${fmtMoney(a.monthlyCashFlow * 12)}, annual ${fmtMoney(a.annualCashFlow)}`,
  });

  // 6. If we have comp-derived fair value, assumed list should be
  //    within ±50% of it. Outside this band means comps are from a
  //    different market (fail) OR the listing is truly an outlier (a
  //    real signal to investigate).
  if (a.fairValue !== null && a.listPrice > 0) {
    const ratio = a.listPrice / a.fairValue;
    out.push({
      id: "fairvalue-sanity",
      label: "List price within 50%-200% of comp fair value",
      pass: ratio >= 0.5 && ratio <= 2.0,
      detail: `List ${fmtMoney(a.listPrice)} / fair value ${fmtMoney(a.fairValue)} = ${(ratio * 100).toFixed(1)}%`,
    });
  }

  // 7. Assumed rent vs comp-derived market rent. If the engine is
  //    feeding a rent that's ±40% off the market median, cashflow
  //    downstream is structurally wrong.
  if (a.marketRent !== null && a.monthlyRent > 0) {
    const ratio = a.monthlyRent / a.marketRent;
    out.push({
      id: "rent-sanity",
      label: "Assumed rent within 60%-140% of comp market rent",
      pass: ratio >= 0.6 && ratio <= 1.4,
      detail: `Assumed ${fmtMoney(a.monthlyRent)}/mo vs comp median ${fmtMoney(a.marketRent)}/mo`,
    });
  }

  // 8. Comp pool integrity. Under 3 sale or 3 rent comps → thin market
  //    and confidence is degraded. Doesn't fail the verdict but flags
  //    the row for operator attention.
  out.push({
    id: "comp-pool-sale",
    label: "≥ 3 sale comps available",
    pass: a.saleCompsCount >= 3,
    detail: `${a.saleCompsCount} sale comps`,
  });
  out.push({
    id: "comp-pool-rent",
    label: "≥ 3 rent comps available",
    pass: a.rentCompsCount >= 3,
    detail: `${a.rentCompsCount} rent comps`,
  });

  // 9. Verdict tier is a known value. Catches any upstream enum drift.
  const knownTiers = ["excellent", "good", "fair", "poor", "avoid"];
  out.push({
    id: "verdict-tier",
    label: "Verdict tier is a known value",
    pass: knownTiers.includes(a.verdict),
    detail: `tier = ${a.verdict}`,
  });

  return out;
}

function fmtMoney(n: number): string {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
