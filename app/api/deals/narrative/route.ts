import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import {
  type DealAnalysis,
  type DealInputs,
  type OfferCeiling,
  formatCurrency,
} from "@/lib/calculations";
import type { AiNarrative } from "@/lib/lead-adapter";
import type { DistributionResult } from "@/lib/distribution-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PostBody = {
  dealId: string;
  analysis: DealAnalysis;
  inputs: DealInputs;
  walkAway: OfferCeiling | null;
  address?: string;
  /** Optional probabilistic distribution — when present, the narrative will
   *  reference scenario confidence instead of a single deterministic verdict. */
  distribution?: DistributionResult | null;
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const NarrativeSchema = z.object({
  summary: z.string().min(10),
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
//
// One-line factual summary. No verdicts, no opinions, no recommendations.
// Single sentence describing the property and key numbers.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You write one-sentence factual descriptions of real estate listings. No opinions, no recommendations, no verdicts. Never use words like "good," "bad," "risky," "buy," "avoid," "should," or "consider." Just facts.

Output exactly one short sentence (under 20 words) following this template:

"<beds>bd/<baths>ba <propertyType> in <city>, <state>. Asking $<price>, est. rent $<rent>/mo. Breaks even at $<breakEvenPrice>."

Substitute real values from the data. Drop any clause for which you don't have data. Use only numbers from the data provided — never hallucinate. Format dollars without decimals.`;

function buildUserMessage(body: PostBody): string {
  const { analysis, inputs, walkAway, address } = body;
  const ceiling = walkAway?.recommendedCeiling;

  const lines: string[] = [];
  if (address) lines.push(`Address: ${address}`);
  lines.push(`Asking price: ${formatCurrency(inputs.purchasePrice, 0)}`);
  lines.push(`Estimated monthly rent: ${formatCurrency(inputs.monthlyRent, 0)}`);
  if (ceiling) {
    lines.push(`Break-even price: ${formatCurrency(ceiling.price, 0)}`);
  }
  // Pulling beds/baths/sqft from inputs is not possible here; that lives in
  // propertyFacts. The client passes address (which contains city/state); the
  // model is told to use only fields that were provided.
  return lines.join("\n");
}

const FALLBACK_NARRATIVE: AiNarrative = {
  summary: "",
  opportunity: "",
  risk: "",
  generatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!supabaseEnv().configured) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.dealId || !body?.analysis || !body?.inputs) {
    return NextResponse.json(
      { error: "Missing required fields: dealId, analysis, inputs." },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[narrative] ANTHROPIC_API_KEY not set — storing fallback for dealId:", body.dealId);
    const narrative: AiNarrative = { ...FALLBACK_NARRATIVE, generatedAt: new Date().toISOString() };
    await supabase
      .from("deals")
      .update({ ai_narrative: narrative })
      .eq("id", body.dealId)
      .eq("user_id", user.id);
    return NextResponse.json({ narrative });
  }

  // Generate narrative via Claude
  let narrative: AiNarrative;
  try {
    const anthropic = createAnthropic({ apiKey });
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5"),
      schema: NarrativeSchema,
      system: SYSTEM_PROMPT,
      prompt: buildUserMessage(body),
      maxOutputTokens: 1000,
      temperature: 0,
    });
    narrative = {
      summary: object.summary,
      opportunity: "",
      risk: "",
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    const e = err as Error & { status?: number };
    console.error("[narrative] Claude call failed for dealId:", body.dealId, "—", e?.message, "(status:", e?.status ?? "?", ")");
    narrative = { ...FALLBACK_NARRATIVE, generatedAt: new Date().toISOString() };
  }

  // Persist to DB — return the narrative to the client regardless of DB result
  // so the panel can display it even if the write fails.
  const { error: updateErr } = await supabase
    .from("deals")
    .update({ ai_narrative: narrative })
    .eq("id", body.dealId)
    .eq("user_id", user.id);

  if (updateErr) {
    console.error("[narrative] DB update failed for dealId:", body.dealId, "—", updateErr.message);
  }

  return NextResponse.json({ narrative });
}
