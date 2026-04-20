import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import {
  analyseDeal,
  DealInputs,
  sanitiseInputs,
} from "@/lib/calculations";

type SaveBody = {
  inputs: DealInputs;
  address?: string;
};

export async function POST(req: Request) {
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

  // Recompute from sanitised inputs so what we store always matches what
  // the engine would produce — no trusting client-side results.
  const inputs = sanitiseInputs(body.inputs);
  const analysis = analyseDeal(inputs);

  const { data, error } = await supabase
    .from("deals")
    .insert({
      user_id: userRes.user.id,
      address: body.address?.trim() || null,
      inputs,
      results: analysis,
      verdict: analysis.verdict.tier,
    })
    .select("id, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: `Could not save deal: ${error.message}. Did you run supabase/migrations/001_deals.sql?`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, createdAt: data.created_at });
}
