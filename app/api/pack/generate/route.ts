import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import {
  analyseDeal,
  type DealInputs,
  sanitiseInputs,
} from "@/lib/calculations";
import { fetchComps } from "@/lib/comps";
import { analyzeComparables } from "@/lib/comparables";
import { enforceRateLimit } from "@/lib/ratelimit";
import {
  withErrorReporting,
  captureError,
  logEvent,
} from "@/lib/observability";
import { buildPack } from "@/lib/negotiation-pack";

// ---------------------------------------------------------------------------
// POST /api/pack/generate (HANDOFF §20.3)
//
// Auth-gated (must be signed in — Pack is the primary Pro funnel and we
// want a user record to attribute the share to). Re-pulls comps server-side
// so the Pack is built off the same engine output as /results, not client-
// supplied data we can't trust. The fetchComps cache handles the redundant
// hit when the user just ran a live-comp analysis seconds ago — the second
// pull is a memory read, not a RentCast charge.
//
// Request body:
//   { address: string, inputs: DealInputs, subjectFacts?: { beds, baths, sqft, ... } }
// Response:
//   200 { packId, shareToken, shareUrl }
//   400 invalid body
//   401 not signed in
//   503 supabase not configured
//
// Pro is NOT required to GENERATE a pack — every signed-in user gets to
// produce it (so the agent-forward viral loop works). The Pro gate is
// elsewhere: free users have 3 live-comp analyses per month (§20.7), which
// is the underlying constraint, and the homepage CTA explicitly mentions
// the quota.
// ---------------------------------------------------------------------------

type PackGenerateBody = {
  address: string;
  inputs: DealInputs;
  /** Subject facts for comp filtering (beds/baths/sqft/etc.). When the
   *  caller is the /results page, these mirror the same query params it
   *  already used to render. */
  subjectFacts?: {
    beds?: number;
    baths?: number;
    sqft?: number;
    yearBuilt?: number;
    propertyType?: string;
    lastSalePrice?: number;
    lastSaleDate?: string;
  };
  /** Resolver-supplied warnings (homestead-trap text, low-confidence
   *  insurance) — we forward these so the Pack's "three weakest
   *  assumptions" picker can see them. */
  warnings?: string[];
};

function generateShareToken(): string {
  // 18 bytes → 24 base64url chars → 144 bits of entropy. Safe to use as a
  // public URL slug; not enumerable.
  return randomBytes(18).toString("base64url");
}

export const POST = withErrorReporting(
  "api.pack-generate",
  async (req: Request) => {
    if (!supabaseEnv().configured) {
      return NextResponse.json(
        { error: "Supabase is not configured on this deployment." },
        { status: 503 },
      );
    }

    let body: PackGenerateBody;
    try {
      body = (await req.json()) as PackGenerateBody;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }
    if (!body?.inputs) {
      return NextResponse.json(
        { error: "Missing deal inputs." },
        { status: 400 },
      );
    }
    const address = body.address?.trim();
    if (!address || address.length < 5) {
      return NextResponse.json(
        { error: "Pack generation requires an address." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      return NextResponse.json(
        { error: "Not signed in." },
        { status: 401 },
      );
    }

    const limited = await enforceRateLimit(
      req,
      "pack-generate",
      userRes.user.id,
    );
    if (limited) return limited;

    const inputs = sanitiseInputs(body.inputs);
    const analysis = analyseDeal(inputs);

    // Pull comps server-side so the Pack is grounded in the same engine
    // output as /results. fetchComps reads through the shared cache so a
    // user who just ran live-comp analysis on /results pays nothing extra.
    const subject = body.subjectFacts ?? {};
    const beds = subject.beds && subject.beds > 0 ? subject.beds : undefined;
    const baths =
      subject.baths && subject.baths > 0 ? subject.baths : undefined;
    const sqft = subject.sqft;
    let comps;
    try {
      comps = await fetchComps({ address, beds, baths, sqft });
    } catch (err) {
      captureError(err, {
        area: "api.pack-generate",
        extra: { stage: "fetchComps", userId: userRes.user.id, address },
      });
      return NextResponse.json(
        {
          error:
            "Couldn't pull comparables for this address. Run live comp analysis on the results page first, then try Pack generation again.",
        },
        { status: 502 },
      );
    }
    if (!comps) {
      return NextResponse.json(
        {
          error:
            "Comp data unavailable for this address right now. Try again in a moment.",
        },
        { status: 502 },
      );
    }

    const comparables = analyzeComparables(
      {
        address,
        price: inputs.purchasePrice,
        sqft,
        beds,
        baths,
        yearBuilt: subject.yearBuilt,
        propertyType: subject.propertyType,
        monthlyHOA: inputs.monthlyHOA,
        lastSalePrice: subject.lastSalePrice,
        lastSaleDate: subject.lastSaleDate,
        currentListPrice: inputs.purchasePrice,
        expectedAppreciation: inputs.annualAppreciationPercent
          ? inputs.annualAppreciationPercent / 100
          : undefined,
      },
      comps,
    );

    const payload = buildPack({
      address,
      inputs,
      analysis,
      comparables,
      warnings: body.warnings ?? [],
    });

    const shareToken = generateShareToken();

    const { data, error } = await supabase
      .from("negotiation_packs")
      .insert({
        user_id: userRes.user.id,
        share_token: shareToken,
        payload,
        address,
        verdict: analysis.verdict.tier,
        walk_away_price: payload.headline.walkAwayPrice ?? null,
        list_price: payload.headline.listPrice,
        is_public: true,
      })
      .select("id, created_at, share_token")
      .single();

    if (error) {
      captureError(error, {
        area: "api.pack-generate",
        extra: {
          stage: "supabase_insert",
          userId: userRes.user.id,
          code: error.code,
        },
      });
      return NextResponse.json(
        {
          error: `Could not save Pack: ${error.message}. Did you run supabase/migrations/004_negotiation_packs.sql?`,
        },
        { status: 500 },
      );
    }

    logEvent("pack.generate", {
      userId: userRes.user.id,
      verdict: analysis.verdict.tier,
      hasWalkAway: payload.headline.walkAwayPrice != null,
      weakAssumptionCount: payload.weakAssumptions.length,
    });

    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("host") ?? "";
    const origin = host ? `${proto}://${host}` : "";
    const shareUrl = `${origin}/pack/${data.share_token}`;

    return NextResponse.json({
      packId: data.id,
      shareToken: data.share_token,
      shareUrl,
      createdAt: data.created_at,
    });
  },
);
