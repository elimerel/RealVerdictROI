import { NextResponse, type NextRequest } from "next/server";
import { analyseDeal, DEFAULT_INPUTS, type DealInputs } from "@/lib/calculations";
import { fetchComps } from "@/lib/comps";
import { analyzeComparables } from "@/lib/comparables";
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
  monthlyCashFlow: number;
  capRate: number;
  dscr: number;
  irr: number;
  cashOnCashReturn: number;
  weakAssumptions: Array<{ field: string; current: string; realistic: string; gap: string }>;
  redFlags: string[];
  saleCompsCount: number;
  rentCompsCount: number;
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
    const analysis = analyseDeal(fullInputs);
    const pack = buildPack({
      address: resolved.address ?? "",
      inputs: fullInputs,
      analysis,
      comparables,
      warnings: resolved.warnings ?? [],
      provenance: resolved.provenance ?? {},
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
    };

    return NextResponse.json(response);
  },
);
