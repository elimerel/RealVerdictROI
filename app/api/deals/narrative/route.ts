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

const SYSTEM_PROMPT = `You are an AI analyst embedded inside RealVerdict, a desktop CRM for active rental property investors. Your job is to interpret deal analysis data and write a plain-English narrative that helps the investor make a decision — not explain what the numbers are, but what they mean.

Every statement you make must reference specific numbers from the data provided. Never use generic real estate advice. Never say "this could be a good investment" without grounding it in the actual metrics. Never hallucinate numbers that aren't in the data provided.

The investor looks at 20-30 listings a week. They need to know fast: should I pursue this deal, what is the real story behind the numbers, and what should I offer?

You will receive both year-1 metrics AND full hold-period projections. Use both. A deal that is negative year-1 but exits at 2× equity in 10 years has a completely different story than a deal that is negative year-1 and also exits at a loss. Distinguish them.

For each field, you MUST write substantive content — these fields are required and must not be empty:
- summary: One sentence. The verdict in plain English. Reference the actual verdict tier, walk-away price, and one key reason. Example: "This deal clears at asking — walk-away is $312k against a $299k list price, driven by solid rent coverage at $2,100/mo."
- opportunity: 1-2 sentences. What is working in this deal's favor over the full hold period. If year-1 cash flow is negative but the deal appreciates and exits profitably, say so with the specific exit numbers (sale price, net proceeds, total profit, year cash flow first turns positive). Reference cap rate, DSCR, IRR, total ROI, equity at exit, or walk-away headroom — whichever is the strongest signal. Be specific with dollar amounts and percentages.
- risk: 1-2 sentences. The single biggest threat to this deal's viability. If year-1 cash flow is negative, state exactly how much the investor is out-of-pocket per month and for how many years. If DSCR is below 1.0, say that with the number. If IRR is below 6%, say that. If the hold period is long with thin margins, say that. Reference the actual numbers. Never invent risks not in the data.`;

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
  // ── CHECKPOINT 0 — route entry (confirm the route is being reached at all) ──
  console.log(">>> [narrative] ROUTE ENTRY", new Date().toISOString());

  if (!supabaseEnv().configured) {
    console.log("[narrative] CHECKPOINT 1 FAIL — Supabase not configured — aborting");
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
    console.log("[narrative] CHECKPOINT 2 FAIL — Auth failed:", authErr?.message);
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  console.log("[narrative] CHECKPOINT 2 OK — authenticated, userId:", user.id);

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    console.log("[narrative] CHECKPOINT 3 FAIL — invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.dealId || !body?.analysis || !body?.inputs) {
    console.log("[narrative] CHECKPOINT 3 FAIL — missing fields, got keys:", Object.keys(body ?? {}));
    return NextResponse.json(
      { error: "Missing required fields: dealId, analysis, inputs." },
      { status: 400 }
    );
  }
  console.log("[narrative] CHECKPOINT 3 OK — body parsed, dealId:", body.dealId);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log("[narrative] CHECKPOINT 4 — ANTHROPIC_API_KEY present:", !!apiKey, apiKey ? `(starts: ${apiKey.slice(0, 14)}...)` : "(MISSING)");
  if (!apiKey) {
    console.log("[narrative] CHECKPOINT 4 FAIL — No ANTHROPIC_API_KEY — storing fallback narrative");
    const narrative: AiNarrative = { ...FALLBACK_NARRATIVE, generatedAt: new Date().toISOString() };
    await supabase
      .from("deals")
      .update({ ai_narrative: narrative })
      .eq("id", body.dealId)
      .eq("user_id", user.id);
    // Return the reason so the browser console can show it without Vercel log access.
    return NextResponse.json({ narrative, _debug: "fallback:no-api-key" });
  }

  // Generate narrative
  let narrative: AiNarrative;
  try {
    console.log("[narrative] CHECKPOINT 5 — calling claude-haiku-4-5, dealId:", body.dealId);
    const userMsg = buildUserMessage(body);
    console.log("[narrative] Prompt preview (first 300 chars):", userMsg.slice(0, 300));
    const anthropic = createAnthropic({ apiKey });
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5"),
      schema: NarrativeSchema,
      system: SYSTEM_PROMPT,
      prompt: userMsg,
      maxOutputTokens: 1000,
      temperature: 0,
    });
    console.log("[narrative] Claude response object:", JSON.stringify(object));

    narrative = {
      summary: object.summary,
      opportunity: object.opportunity,
      risk: object.risk,
      generatedAt: new Date().toISOString(),
    };
    console.log("[narrative] Narrative built — summary:", narrative.summary.slice(0, 80));
  } catch (err) {
    const e = err as Error & { cause?: unknown; status?: number; responseBody?: string };
    const claudeErrorMsg = `${e?.name ?? "Error"}: ${e?.message ?? "unknown"} (status=${e?.status ?? "?"})`;
    console.error("[narrative] Claude call FAILED:", {
      message: e?.message,
      name: e?.name,
      status: e?.status,
      cause: e?.cause,
      responseBody: e?.responseBody,
      stack: e?.stack?.split("\n").slice(0, 5).join(" | "),
    });
    console.log("[narrative] Storing fallback narrative for dealId:", body.dealId);
    narrative = { ...FALLBACK_NARRATIVE, generatedAt: new Date().toISOString() };

    // Persist fallback then return early with top-level _debug so the browser
    // console can surface the exact error without Vercel log access.
    await supabase
      .from("deals")
      .update({ ai_narrative: narrative })
      .eq("id", body.dealId)
      .eq("user_id", user.id);
    return NextResponse.json({ narrative, _debug: `fallback:claude-error — ${claudeErrorMsg}` });
  }

  // Persist to DB — only update rows owned by this user.
  // If this fails (e.g. migration 006 not applied), we still return the
  // narrative to the client so the panel can display it this session.
  console.log("[narrative] Persisting to DB for dealId:", body.dealId);
  const { error: updateErr, count } = await supabase
    .from("deals")
    .update({ ai_narrative: narrative }, { count: "exact" })
    .eq("id", body.dealId)
    .eq("user_id", user.id);

  if (updateErr) {
    console.error("[narrative] DB update FAILED:", {
      message: updateErr.message,
      code: updateErr.code,
      details: updateErr.details,
      hint: updateErr.hint,
    });
    // Still return the narrative so the client can show it without a DB round-trip.
    return NextResponse.json({ narrative, dbError: updateErr.message });
  }

  if (count === 0) {
    console.warn("[narrative] DB update matched 0 rows — dealId:", body.dealId, "userId:", user.id, "(deal may not exist or belong to this user)");
  }

  console.log("[narrative] Done — narrative stored for dealId:", body.dealId, "rows updated:", count);
  return NextResponse.json({ narrative });
}
