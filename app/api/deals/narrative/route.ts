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
  formatPercent,
} from "@/lib/calculations";
import type { AiNarrative } from "@/lib/lead-adapter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PostBody = {
  dealId: string;
  analysis: DealAnalysis;
  inputs: DealInputs;
  walkAway: OfferCeiling | null;
  address?: string;
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const NarrativeSchema = z.object({
  summary: z.string(),
  opportunity: z.string(),
  risk: z.string(),
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an AI analyst embedded inside RealVerdict, a desktop CRM for active rental property investors. Your job is to interpret deal analysis data and write a plain-English narrative that helps the investor make a decision — not explain what the numbers are, but what they mean.

You have access to the complete engine output for this deal. Every statement you make must reference specific numbers from the data. Never use generic real estate advice. Never say "this could be a good investment" without grounding it in the actual metrics. Never hallucinate numbers that aren't in the data provided.

The investor using this app is actively shopping for rental properties. They look at 20-30 listings a week. They need to know fast: should I pursue this deal, and what should I offer?

Respond with a JSON object only. No preamble, no markdown, no explanation outside the JSON:
{
  "summary": "One sentence. The verdict in plain English. Reference the actual verdict tier, walk-away price, and one key reason. Example: 'This deal clears at asking — walk-away is $312k against a $299k list price, driven by solid rent coverage at $2,100/mo.'",
  "opportunity": "1-2 sentences. What is working in this deal's favor. Reference actual numbers: cap rate, cash flow, DSCR, appreciation rate, walk-away headroom. Be specific.",
  "risk": "1-2 sentences. The single biggest thing that could break this deal. Reference the actual weak point — if DSCR is below 1.0 say that and the number. If cash flow is negative say by how much. If the cap rate is low for the market say that. Never invent risks not supported by the data."
}`;

function buildUserMessage(body: PostBody): string {
  const { analysis, inputs, walkAway, address } = body;
  const v = analysis.verdict;
  const ceiling = walkAway?.recommendedCeiling;
  const primary = walkAway?.primaryTarget;

  const lines: string[] = [];
  if (address) lines.push(`Address: ${address}`);
  lines.push(`Purchase price: ${formatCurrency(inputs.purchasePrice, 0)}`);
  lines.push(`Monthly rent: ${formatCurrency(inputs.monthlyRent, 0)}`);
  lines.push(`Down payment: ${inputs.downPaymentPercent}%`);
  lines.push(`Interest rate: ${inputs.loanInterestRate}%`);
  lines.push(
    `Monthly cash flow: ${analysis.monthlyCashFlow >= 0 ? "+" : ""}${formatCurrency(analysis.monthlyCashFlow, 0)}`
  );
  lines.push(`Cap rate: ${formatPercent(analysis.capRate, 2)}`);
  lines.push(`Cash-on-cash: ${formatPercent(analysis.cashOnCashReturn, 2)}`);
  lines.push(
    `DSCR: ${isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞ (no debt)"}`
  );
  lines.push(`GRM: ${analysis.grossRentMultiplier.toFixed(1)}x`);
  lines.push(`IRR: ${formatPercent(analysis.irr, 1)}`);
  lines.push(
    `Break-even occupancy: ${formatPercent(analysis.breakEvenOccupancy, 0)}`
  );
  lines.push(`Total cash invested: ${formatCurrency(analysis.totalCashInvested, 0)}`);
  lines.push(`Verdict tier: ${v.tier}`);
  lines.push(`Verdict score: ${v.score}/100`);
  if (ceiling) {
    lines.push(
      `Walk-away ceiling: ${formatCurrency(ceiling.price, 0)} (${ceiling.tier} tier)`
    );
  }
  if (primary) {
    lines.push(
      `Primary target price: ${formatCurrency(primary.price, 0)} (${primary.discountPercent.toFixed(1)}% off asking)`
    );
  }
  lines.push(`Annual appreciation assumption: ${inputs.annualAppreciationPercent}%`);

  return lines.join("\n");
}

const FALLBACK_NARRATIVE: AiNarrative = {
  summary: "Analysis complete — review the numbers below for details.",
  opportunity: "",
  risk: "",
  generatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!supabaseEnv().configured) {
    console.log("[narrative] Supabase not configured — aborting");
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    );
  }

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    console.log("[narrative] Auth failed:", authErr?.message);
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

  console.log("[narrative] route called for dealId:", body.dealId, "user:", user.id);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("[narrative] No ANTHROPIC_API_KEY — storing fallback narrative");
    const narrative: AiNarrative = { ...FALLBACK_NARRATIVE, generatedAt: new Date().toISOString() };
    await supabase
      .from("deals")
      .update({ ai_narrative: narrative })
      .eq("id", body.dealId)
      .eq("user_id", user.id);
    return NextResponse.json({ narrative });
  }

  // Generate narrative
  let narrative: AiNarrative;
  try {
    console.log("[narrative] Calling Claude claude-haiku-4-5 for dealId:", body.dealId);
    const anthropic = createAnthropic({ apiKey });
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5"),
      schema: NarrativeSchema,
      system: SYSTEM_PROMPT,
      prompt: buildUserMessage(body),
      maxOutputTokens: 400,
      temperature: 0,
    });
    console.log("[narrative] Claude response:", JSON.stringify(object));

    narrative = {
      summary: object.summary,
      opportunity: object.opportunity,
      risk: object.risk,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[narrative] Claude call failed:", err);
    narrative = { ...FALLBACK_NARRATIVE, generatedAt: new Date().toISOString() };
  }

  // Persist to DB — only update rows owned by this user
  console.log("[narrative] Persisting to DB for dealId:", body.dealId);
  const { error: updateErr } = await supabase
    .from("deals")
    .update({ ai_narrative: narrative })
    .eq("id", body.dealId)
    .eq("user_id", user.id);

  if (updateErr) {
    console.error("[narrative] DB update failed:", updateErr.message);
    return NextResponse.json(
      { error: "Failed to save narrative." },
      { status: 500 }
    );
  }

  console.log("[narrative] Done — narrative stored for dealId:", body.dealId);
  return NextResponse.json({ narrative });
}
