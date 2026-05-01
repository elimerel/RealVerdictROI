import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import {
  analyseDeal,
  DealInputs,
  sanitiseInputs,
} from "@/lib/calculations";
import { enforceRateLimit } from "@/lib/ratelimit";
import { withErrorReporting, captureError, logEvent } from "@/lib/observability";
import { isPro } from "@/lib/pro";

type PropertyFacts = {
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  propertyType?: string | null;
};

type ListingDetails = {
  daysOnMarket?: number | null;
  originalListPrice?: number | null;
  /** A short, factual price-history note in OUR words (not lifted
   *  from the source page). Example: "Reduced 4/12: $545k → $530k". */
  priceHistoryNote?: string | null;
  listingDate?: string | null;
  mlsNumber?: string | null;
  schoolRating?: number | null;
  walkScore?: number | null;
  lotSqft?: number | null;
};
// listingRemarks (verbatim marketing description) is intentionally NOT
// in the schema. We don't accept it from clients, don't store it, don't
// surface it. Verbatim listing copy is copyrighted by the listing
// agent / broker and persisting it crosses into derivative-work
// territory. The legal posture is: facts + structured tags only.

type SaveBody = {
  inputs: DealInputs;
  address?: string;
  propertyFacts?: PropertyFacts;
  sourceUrl?: string;
  sourceSite?: string;
  /** AI-written one-sentence take from the extractor. */
  take?: string | null;
  /** Short factual risk tags ≤3 words each (model-generated, not
   *  lifted from listing copy). Server clamps to this contract. */
  riskFlags?: string[] | null;
  /** Rich listing-detail surface (price history, MLS, scores, lot,
   *  days-on-market). Marketing descriptions are explicitly excluded
   *  — see ListingDetails type comment. */
  listingDetails?: ListingDetails | null;
};

/** Risk flags stored on the deal must be SHORT FACTUAL TAGS (≤3 words,
 *  ≤32 chars each). This is the same bound enforced in the extractor
 *  coercer — duplicating it here is defense-in-depth so a hand-crafted
 *  request to the API can't smuggle in a 2000-character marketing
 *  paraphrase under the riskFlags key. The legal contract is: server
 *  refuses to store anything that isn't a short factual tag. */
function sanitizeRiskFlags(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const cleaned = input
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length === 0 || s.length > 32) return false;
      return s.split(/\s+/).length <= 3;
    })
    .slice(0, 8);
  return cleaned.length > 0 ? cleaned : null;
}

function sanitizeListingDetails(input: ListingDetails | null | undefined): ListingDetails | null {
  if (!input || typeof input !== "object") return null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown, max = 240): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    return t.slice(0, max);
  };
  const out: ListingDetails = {
    daysOnMarket:      num(input.daysOnMarket),
    originalListPrice: num(input.originalListPrice),
    // priceHistoryNote is short by design — we cap it tight (240 chars)
    // so even a noncompliant client can't slip in a verbatim paragraph.
    priceHistoryNote:  str(input.priceHistoryNote, 240),
    listingDate:       str(input.listingDate, 40),
    mlsNumber:         str(input.mlsNumber, 60),
    schoolRating:      num(input.schoolRating),
    walkScore:         num(input.walkScore),
    lotSqft:           num(input.lotSqft),
  };
  // Drop the wrapper if every field is null — keeps the row compact.
  return Object.values(out).some((v) => v != null) ? out : null;
}

export const POST = withErrorReporting("api.deals-save", async (req: Request) => {
  if (!supabaseEnv().configured) {
    return NextResponse.json(
      { error: "Supabase is not configured on this deployment." },
      { status: 503 },
    );
  }

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.inputs) {
    return NextResponse.json(
      { error: "Missing deal inputs." },
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

  // Per-user save budget (falls back to IP if somehow userId is absent).
  const limited = await enforceRateLimit(req, "deals-save", userRes.user.id);
  if (limited) return limited;

  if (!(await isPro(userRes.user))) {
    return NextResponse.json(
      { error: "Pro subscription required.", code: "pro_required" },
      { status: 402 },
    );
  }

  // Recompute from sanitised inputs so what we store always matches what
  // the engine would produce — no trusting client-side results.
  const inputs = sanitiseInputs(body.inputs);
  const analysis = analyseDeal(inputs);

  // Dedup: prevent saving the same deal twice within a 5-minute window.
  // The address is the most reliable key — same user + same address + recent
  // created_at means the user analyzed the same listing multiple times and
  // clicked Save more than once. Return the existing deal ID without inserting.
  const dedupSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  if (body.address?.trim()) {
    const { data: existing } = await supabase
      .from("deals")
      .select("id, created_at")
      .eq("user_id", userRes.user.id)
      .eq("address", body.address.trim())
      .gte("created_at", dedupSince)
      .limit(1)
      .maybeSingle();
    if (existing) {
      logEvent("deals.save.dedup", { userId: userRes.user.id });
      return NextResponse.json({ id: existing.id, createdAt: existing.created_at });
    }
  }

  const propertyFacts = body.propertyFacts ?? null;
  const aiTake = typeof body.take === "string"
    ? body.take.trim().slice(0, 600) || null
    : null;
  const riskFlags = sanitizeRiskFlags(body.riskFlags);
  const listingDetails = sanitizeListingDetails(body.listingDetails);

  const { data, error } = await supabase
    .from("deals")
    .insert({
      user_id: userRes.user.id,
      address: body.address?.trim() || null,
      source_url: body.sourceUrl?.trim() || null,
      source_site: body.sourceSite?.trim().toLowerCase() || null,
      inputs,
      results: analysis,
      verdict: analysis.verdict.tier,
      property_facts: propertyFacts,
      // Persisted in 008_deal_ai_context.sql. If the migration hasn't been
      // run, Supabase will reject the column — we deliberately fail loud
      // there so misconfigured deployments don't silently lose AI context.
      ai_take: aiTake,
      risk_flags: riskFlags,
      listing_details: listingDetails,
    })
    .select("id, created_at")
    .single();

  if (error) {
    captureError(error, {
      area: "api.deals-save",
      extra: { stage: "supabase_insert", userId: userRes.user.id, code: error.code },
    });
    return NextResponse.json(
      {
        error: `Could not save deal: ${error.message}. Did you run supabase/migrations/001_deals.sql?`,
      },
      { status: 500 },
    );
  }

  logEvent("deals.save", {
    userId: userRes.user.id,
    verdict: analysis.verdict.tier,
  });

  return NextResponse.json({ id: data.id, createdAt: data.created_at });
});
