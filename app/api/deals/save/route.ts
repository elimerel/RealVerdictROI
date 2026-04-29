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

type SaveBody = {
  inputs: DealInputs;
  address?: string;
  propertyFacts?: PropertyFacts;
};

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

  const { data, error } = await supabase
    .from("deals")
    .insert({
      user_id: userRes.user.id,
      address: body.address?.trim() || null,
      inputs,
      results: analysis,
      verdict: analysis.verdict.tier,
      property_facts: propertyFacts,
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
