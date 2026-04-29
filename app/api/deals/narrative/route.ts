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
  summary: z.string().min(20),
  opportunity: z.string().min(20),
  risk: z.string().min(20),
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a sharp analyst giving an investor the 30-second briefing before a meeting. Write short declarative sentences. One idea per sentence. No semicolons. No em dashes. No compound clauses joined with "while" or "meaning." No filler phrases like "it is worth noting" or "overall." No generic real estate advice. No hedging. Reference only numbers from the data provided — never hallucinate.

Return exactly three fields:

summary: One sentence. Name the verdict and the single biggest reason for it. Reference the walk-away price or the key metric that drives the verdict. Be direct.

opportunity: Two sentences maximum. Name the specific upside with real numbers. Reference cap rate, DSCR, IRR, cash-on-cash, total ROI, equity at exit, or walk-away headroom — whichever is the strongest signal. If year-1 cash flow is negative but the deal exits profitably, state the specific exit numbers and the year cash flow turns positive.

risk: Two sentences maximum. Name the single biggest threat with real numbers. If year-1 cash flow is negative, state exactly how much the investor is out-of-pocket per month. If DSCR is below 1.0, state that number. If IRR is below 6%, state that. Do not invent risks not in the data.`;

function buildUserMessage(body: PostBody): string {
  const { analysis, inputs, walkAway, address } = body;
  const v = analysis.verdict;
  const ceiling = walkAway?.recommendedCeiling;
  const primary = walkAway?.primaryTarget;

  // Find first year where annual cash flow turns non-negative
  const firstPositiveYear =
    analysis.projection.find((y) => y.cashFlow >= 0)?.year ?? null;

  // Year-1 cash flow is negative: compute total out-of-pocket carry
  const negativeCFYears = analysis.projection.filter((y) => y.cashFlow < 0);
  const totalNegativeCF = negativeCFYears.reduce(
    (sum, y) => sum + y.cashFlow,
    0,
  );

  const lines: string[] = [];
  if (address) lines.push(`Address: ${address}`);

  lines.push(`\n--- DEAL INPUTS ---`);
  lines.push(`Purchase price: ${formatCurrency(inputs.purchasePrice, 0)}`);
  lines.push(`Monthly rent: ${formatCurrency(inputs.monthlyRent, 0)}`);
  lines.push(`Down payment: ${inputs.downPaymentPercent}%`);
  lines.push(`Interest rate: ${inputs.loanInterestRate}%`);
  lines.push(`Hold period: ${inputs.holdPeriodYears} years`);
  lines.push(`Annual appreciation assumption: ${inputs.annualAppreciationPercent}%`);
  lines.push(`Annual rent growth assumption: ${inputs.annualRentGrowthPercent}%`);

  lines.push(`\n--- YEAR-1 METRICS ---`);
  lines.push(
    `Monthly cash flow: ${analysis.monthlyCashFlow >= 0 ? "+" : ""}${formatCurrency(analysis.monthlyCashFlow, 0)}`,
  );
  lines.push(`Cap rate: ${formatPercent(analysis.capRate, 2)}`);
  lines.push(`Cash-on-cash: ${formatPercent(analysis.cashOnCashReturn, 2)}`);
  lines.push(
    `DSCR: ${isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞ (no debt)"}`,
  );
  lines.push(`GRM: ${analysis.grossRentMultiplier.toFixed(1)}x`);
  lines.push(
    `Break-even occupancy: ${formatPercent(analysis.breakEvenOccupancy, 0)}`,
  );
  lines.push(`Total cash invested: ${formatCurrency(analysis.totalCashInvested, 0)}`);

  lines.push(`\n--- HOLD-PERIOD PROJECTIONS (${inputs.holdPeriodYears}-year hold) ---`);
  lines.push(`IRR (annualised): ${formatPercent(analysis.irr, 1)}`);
  lines.push(`Total cash flow over hold: ${formatCurrency(analysis.totalCashFlow, 0)}`);
  lines.push(`Total principal paydown: ${formatCurrency(analysis.totalPrincipalPaydown, 0)}`);
  lines.push(`Projected sale price at exit: ${formatCurrency(analysis.salePrice, 0)}`);
  lines.push(`Net sale proceeds (after loan payoff + selling costs): ${formatCurrency(analysis.netSaleProceeds, 0)}`);
  lines.push(`Total profit (cash flow + net proceeds − cash invested): ${formatCurrency(analysis.totalProfit, 0)}`);
  lines.push(`Total ROI: ${formatPercent(analysis.totalROI, 1)}`);
  lines.push(`Average annual return: ${formatPercent(analysis.averageAnnualReturn, 1)}`);
  if (firstPositiveYear != null) {
    lines.push(`First year cash flow turns positive: Year ${firstPositiveYear}`);
  } else if (analysis.monthlyCashFlow < 0) {
    lines.push(
      `Cash flow never turns positive in the hold period (negative throughout)`,
    );
  }
  if (negativeCFYears.length > 0) {
    lines.push(
      `Cumulative out-of-pocket carry during negative CF years: ${formatCurrency(totalNegativeCF, 0)} (investor must fund this from reserves)`,
    );
  }

  lines.push(`\n--- VERDICT ---`);
  lines.push(`Verdict tier: ${v.tier}`);
  lines.push(`Verdict score: ${v.score}/100`);
  lines.push(`Verdict headline: ${v.headline}`);
  if (ceiling) {
    lines.push(
      `Walk-away ceiling: ${formatCurrency(ceiling.price, 0)} (${ceiling.tier} tier)`,
    );
  }
  if (primary) {
    lines.push(
      `Primary target price: ${formatCurrency(primary.price, 0)} (${primary.discountPercent.toFixed(1)}% off asking)`,
    );
  }

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
      opportunity: object.opportunity,
      risk: object.risk,
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
