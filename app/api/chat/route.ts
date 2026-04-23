import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import {
  analyseDeal,
  DealInputs,
  sanitiseInputs,
  type DealAnalysis,
} from "@/lib/calculations";
import { enforceRateLimit } from "@/lib/ratelimit";
import { withErrorReporting, logEvent } from "@/lib/observability";
import type { MarketSignals } from "@/lib/market-context";

// Allow the response up to a full minute — the longest answers can stream 15s+.
export const maxDuration = 60;

type Mode = "verdict" | "chat";

// The analysis context is optional extra info the client has already
// computed (walk-away, fair value, market rent, top-3 weak assumptions).
// We trust it because the server re-runs analyseDeal(inputs) anyway —
// these fields only appear in the system prompt as display text, so a
// tampered value can at worst produce a confusing AI answer, not
// compromise anything else. Piping this in closes the gap the audit
// flagged where chat used to reason about the deal without knowing the
// walk-away price or fair value the rest of the page was showing.
export type ChatAnalysisContext = {
  walkAwayPrice?: number;
  walkAwayTier?: "excellent" | "good" | "fair" | "poor";
  marketValueCapSource?: "comps" | "list";
  fairValue?: number;
  fairValueConfidence?: "high" | "medium" | "low";
  marketRent?: number;
  marketRentConfidence?: "high" | "medium" | "low";
  weakAssumptions?: Array<{ field: string; current: string; realistic: string; gap: string }>;
} & MarketSignals;

type ChatRequestBody = {
  messages: UIMessage[];
  inputs: DealInputs;
  mode?: Mode;
  analysisContext?: ChatAnalysisContext;
};

export const POST = withErrorReporting("api.chat", async (req: Request) => {
  const limited = await enforceRateLimit(req, "chat");
  if (limited) return limited;

  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      "OPENAI_API_KEY is not set. Add it to .env.local and restart the dev server.",
      { status: 500 },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (!body?.messages || !body?.inputs) {
    return new Response("Missing messages or inputs in request body", {
      status: 400,
    });
  }

  // Re-run the engine server-side so context can never be tampered with.
  const inputs = sanitiseInputs(body.inputs);
  const analysis = analyseDeal(inputs);

  const mode: Mode = body.mode === "verdict" ? "verdict" : "chat";
  const model = mode === "verdict" ? "gpt-4o-mini" : "gpt-4o";

  logEvent("chat.request", {
    mode,
    model,
    verdict: analysis.verdict.tier,
    msgCount: body.messages.length,
  });

  const result = streamText({
    model: openai(model),
    system: buildSystemPrompt(analysis, mode, body.analysisContext),
    messages: await convertToModelMessages(body.messages),
    temperature: mode === "verdict" ? 0.2 : 0.3,
  });

  return result.toUIMessageStreamResponse();
});

// ---------------------------------------------------------------------------
// System prompt — identical opener + banned-phrase guardrails for both modes,
// then a mode-specific format contract appended at the end.
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  a: DealAnalysis,
  mode: Mode,
  ctx?: ChatAnalysisContext,
): string {
  const f = (n: number) =>
    isFinite(n)
      ? n.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        })
      : "—";
  const p = (n: number, d = 1) =>
    isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—";

  const { inputs, verdict } = a;
  const stress = computeStressScenarios(a);

  const preamble = `You are a blunt, numbers-first advisor to buy-and-hold residential rental investors (not flippers, not retail buyer-broker coaching). You speak in specific figures from this deal only — never generalities. You are direct and occasionally contrarian. You never pad your answers.

Banned phrases — never use these under any circumstances:
"it is worth noting"
"it is important to consider"
"while there are risks"
"overall this deal"
"keep in mind"
"please note"
"I would recommend"
"as an AI"
"great question"
"certainly"
"absolutely"
"of course"

Investors are skimming. Every word must earn its place. If asked something the deal data cannot answer, say so in one sentence. Maximum 4 sentences or a short bullet list for any response. Always use the actual numbers from this deal.`;

  const formatContract =
    mode === "verdict"
      ? `

=== OUTPUT FORMAT (OPENING VERDICT) ===
You are writing ONE tight verdict block, maximum 5 short lines. Do NOT print a verdict label like "AVOID" — the page already shows it. Do NOT use markdown headers or asterisks. Use the literal character → (U+2192) for bullets.

Emit output in this exact structure, nothing else:

[One sentence stating the core problem or strength using specific numbers from this deal. No filler, no preamble.]

What would change this:
→ [Specific input change] → [exact monthly cashflow impact in dollars, signed with + or −]
→ [Specific input change] → [exact monthly cashflow impact in dollars, signed with + or −]
→ [Optional third bullet only if it moves the needle differently from the first two]

Watch out for: [One specific risk SCENARIO with a real dollar number. NOT a restatement of a metric. Example: "One vacant month costs $2,000 on top of existing losses" — NOT "cash-on-cash is negative."]

Rules:
- Each "→" bullet must quantify BOTH the change and the cashflow impact in dollars.
- Never say "consider", "might want to", "could potentially". Use "Drop", "Raise", "Negotiate", "Walk".
- No closing remark, no sign-off, no encouragement.`
      : `

=== OUTPUT FORMAT (FOLLOW-UP) ===
- Max 4 sentences OR a short bullet list of 2–4 items using → (U+2192). Never both together.
- Every answer must cite at least one specific number from this deal (dollar amount, percent, or ratio).
- No generic real estate advice. No caveats. No hedging.
- If the deal data cannot answer the question, reply in ONE sentence saying so and redirect to what it can answer.
- No markdown headers. Use bold only on a single key figure if it sharpens the point.
- Use plain numbers ("$2,600/mo", "4.2%"), never LaTeX or code blocks.`;

  const context = `

=== THE DEAL ===

VERDICT TIER (your reference only — do NOT recite verbatim, the page already shows it):
${verdict.tier.toUpperCase()} (score ${Math.round(verdict.score)}/100)
Engine-flagged strengths: ${verdict.strengths.length ? verdict.strengths.join("; ") : "none"}
Engine-flagged risks: ${verdict.risks.length ? verdict.risks.join("; ") : "none"}

=== PURCHASE & FINANCING ===
Purchase price: ${f(inputs.purchasePrice)}
Down payment: ${p(inputs.downPaymentPercent / 100, 0)} = ${f(a.downPayment)}
Closing costs: ${p(inputs.closingCostsPercent / 100, 1)} = ${f(a.closingCosts)}
Rehab: ${f(inputs.rehabCosts)}
Total cash invested: ${f(a.totalCashInvested)}
Loan amount: ${f(a.loanAmount)}
LTV: ${p(a.loanAmount / Math.max(1, inputs.purchasePrice), 0)}
Rate: ${inputs.loanInterestRate}% for ${inputs.loanTermYears} years
Monthly P&I: ${f(a.monthlyMortgagePayment)}

=== INCOME (year 1) ===
Monthly rent: ${f(inputs.monthlyRent)}
Other monthly income: ${f(inputs.otherMonthlyIncome)}
Vacancy rate: ${inputs.vacancyRatePercent}%
Annual gross scheduled income: ${f(a.annualGrossIncome)}
Annual effective gross income: ${f(a.annualEffectiveIncome)}

=== EXPENSES (year 1) ===
Property tax (annual): ${f(inputs.annualPropertyTax)}
Insurance (annual): ${f(inputs.annualInsurance)}
HOA (monthly): ${f(inputs.monthlyHOA)}
Utilities owner pays (monthly): ${f(inputs.monthlyUtilities)}
Maintenance reserve: ${inputs.maintenancePercent}% of rent
Property management: ${inputs.propertyManagementPercent}% of rent
CapEx reserve: ${inputs.capexReservePercent}% of rent
Total annual operating expenses: ${f(a.annualOperatingExpenses)}

=== KEY METRICS ===
Monthly cash flow: ${f(a.monthlyCashFlow)}
Annual cash flow: ${f(a.annualCashFlow)}
Annual NOI: ${f(a.annualNOI)}
Annual debt service: ${f(a.annualDebtService)}
Cap rate: ${p(a.capRate, 2)}
Cash-on-cash return: ${p(a.cashOnCashReturn, 2)}
DSCR: ${isFinite(a.dscr) ? a.dscr.toFixed(2) : "∞ (no debt)"}
Gross rent multiplier: ${a.grossRentMultiplier.toFixed(1)}× annual rent
Operating expense ratio: ${p(a.operatingExpenseRatio, 0)}
Break-even occupancy: ${p(a.breakEvenOccupancy, 0)}

=== STRESS SCENARIOS (computed for you) ===
One extra month of vacancy costs: ${f(stress.oneMonthVacancyCost)} (${stress.vacancyCushion})
Rent falls 10%: new monthly cash flow = ${f(stress.rentDownCashFlow)} (${stress.rentDownDelta >= 0 ? "+" : ""}${f(stress.rentDownDelta)} vs today)
Interest rate +1pt to ${(inputs.loanInterestRate + 1).toFixed(2)}%: new monthly cash flow = ${f(stress.rateUpCashFlow)} (${stress.rateUpDelta >= 0 ? "+" : ""}${f(stress.rateUpDelta)} vs today)

=== HOLD PERIOD (${inputs.holdPeriodYears} YEARS) ===
Appreciation assumption: ${inputs.annualAppreciationPercent}%/yr
Rent growth: ${inputs.annualRentGrowthPercent}%/yr
Expense growth: ${inputs.annualExpenseGrowthPercent}%/yr
Selling costs at exit: ${inputs.sellingCostsPercent}%
Projected sale price: ${f(a.salePrice)}
Loan balance at exit: ${f(a.loanBalanceAtExit)}
Net sale proceeds: ${f(a.netSaleProceeds)}
Total cash flow over hold: ${f(a.totalCashFlow)}
Total principal paydown: ${f(a.totalPrincipalPaydown)}
Total appreciation: ${f(a.totalAppreciation)}
Total profit: ${f(a.totalProfit)}
Total ROI: ${p(a.totalROI, 0)}
Average annual return: ${p(a.averageAnnualReturn, 1)}
Projected IRR: ${p(a.irr, 1)}

=== 10-YEAR PROJECTION (year | NOI | debt service | cash flow | loan balance | property value | equity) ===
${a.projection
  .slice(0, 10)
  .map(
    (y) =>
      `Y${y.year}: NOI ${f(y.noi)} | DS ${f(y.debtService)} | CF ${f(y.cashFlow)} | Bal ${f(y.loanBalanceEnd)} | Val ${f(y.propertyValueEnd)} | Eq ${f(y.equityEnd)}`,
  )
  .join("\n")}

=== BENCHMARKS FOR JUDGMENT ===
A "good" long-term rental deal typically has:
Cash-on-cash 8%+ · Cap rate 6%+ (market-dependent) · DSCR 1.25+ · Break-even occupancy below 85% · Positive monthly cash flow from day one · IRR 10%+ over hold.`;

  // Pack / walk-away context — only included when /results already
  // computed these, so chat reasoning is in lockstep with what the page
  // is showing and the Pack would produce. Without this block the model
  // historically had to re-infer a "fair offer price" from scratch,
  // which often produced a number that disagreed with the walk-away
  // displayed 200px above the chat input. That was the #1 reason chat
  // felt "disconnected" from the rest of the tool.
  const marketContextBlock = formatMarketContextForPrompt(ctx);

  const packContext = ctx
    ? `

=== WALK-AWAY & COMP CONTEXT (authoritative — do not re-derive) ===
${ctx.walkAwayPrice !== undefined ? `Walk-away price (the page already shows this): ${f(ctx.walkAwayPrice)}${ctx.walkAwayTier ? ` — at ${ctx.walkAwayTier.toUpperCase()} verdict tier` : ""}. If the user asks "what should I offer," the answer anchors here, not on a number you invent.` : "Walk-away price: not computed (no live comps)."}
${ctx.fairValue !== undefined ? `Comp-derived fair value: ${f(ctx.fairValue)}${ctx.fairValueConfidence ? ` (${ctx.fairValueConfidence} confidence)` : ""}. Ask is ${f(inputs.purchasePrice)}. ${inputs.purchasePrice > ctx.fairValue ? "Seller is above the comp midline." : inputs.purchasePrice < ctx.fairValue ? "Seller is below the comp midline." : "Seller is at the comp midline."}` : ""}
${ctx.marketRent !== undefined ? `Comp-derived market rent: ${f(ctx.marketRent)}${ctx.marketRentConfidence ? ` (${ctx.marketRentConfidence} confidence)` : ""}. Assumed rent in this model: ${f(inputs.monthlyRent)}. ${inputs.monthlyRent > ctx.marketRent ? "Pro-forma is above the market rent midline." : inputs.monthlyRent < ctx.marketRent ? "Pro-forma is below the market rent midline." : "Pro-forma matches market."}` : ""}
${ctx.marketValueCapSource ? `Walk-away ceiling is bound by ${ctx.marketValueCapSource === "comps" ? "comp-derived fair value" : "list price"} — not by pure income math.` : ""}
${
  ctx.weakAssumptions && ctx.weakAssumptions.length > 0
    ? `
Top 3 weakest assumptions in the seller's pro forma (already surfaced on the Pack):
${ctx.weakAssumptions
  .slice(0, 3)
  .map(
    (w, i) =>
      `${i + 1}. ${w.field}: current "${w.current}" → realistic "${w.realistic}" (gap: ${w.gap})`,
  )
  .join("\n")}
When user asks about risk, cite one of these. Don't invent new ones.`
    : ""
}`
    : "";

  return preamble + formatContract + context + marketContextBlock + packContext;
}

function formatMarketContextForPrompt(ctx?: ChatAnalysisContext): string {
  if (!ctx) return "";
  const hasZip =
    ctx.marketZip ||
    ctx.acsVintageYear !== undefined ||
    ctx.zipMedianGrossRentMonthly !== undefined;
  const hasDealShape =
    ctx.dealStructureArchetype !== undefined ||
    ctx.listPriceToAnnualGrossRentMultiple !== undefined;
  if (!hasZip && !hasDealShape) return "";

  const f = (n: number) =>
    isFinite(n)
      ? n.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        })
      : "—";
  const pct = (x: number) =>
    isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—";

  const lines: string[] = [`

=== MARKET BACKDROP (ZIP-LEVEL ACS + YOUR LIST/RENT GEOMETRY) ===`];

  if (ctx.marketZip) {
    lines.push(
      `ZIP (ZCTA) parsed from the address string: ${ctx.marketZip}${ctx.acsVintageYear ? ` — ACS 5-year vintage ${ctx.acsVintageYear}` : ""}.`,
    );
  } else if (ctx.acsVintageYear) {
    lines.push(`ACS vintage: ${ctx.acsVintageYear}.`);
  } else if (hasDealShape) {
    lines.push(
      "No 5-digit ZIP was parsed from the address — ZIP-level ACS lines are absent; geometry tags below are from list ÷ gross rent only.",
    );
  }

  if (ctx.zipMedianGrossRentMonthly && ctx.zipMedianGrossRentMonthly > 0) {
    lines.push(
      `ZIP median gross rent (renter households, ACS): ${f(ctx.zipMedianGrossRentMonthly)}/mo.`,
    );
  }
  if (ctx.zipMedianOwnerOccupiedValue && ctx.zipMedianOwnerOccupiedValue > 0) {
    lines.push(
      `ZIP median owner-occupied home value (ACS): ${f(ctx.zipMedianOwnerOccupiedValue)}.`,
    );
  }
  if (ctx.zipMedianHouseholdIncome && ctx.zipMedianHouseholdIncome > 0) {
    lines.push(
      `ZIP median household income (ACS): ${f(ctx.zipMedianHouseholdIncome)}/yr.`,
    );
  }
  if (ctx.zipHousingVacancyRate !== undefined && ctx.zipHousingVacancyRate > 0) {
    lines.push(`ZIP housing vacancy rate (ACS): ${pct(ctx.zipHousingVacancyRate)}.`);
  }
  if (ctx.userMonthlyRentToZipMedianRatio !== undefined) {
    lines.push(
      `User pro-forma monthly rent ÷ ZIP median gross rent: ${ctx.userMonthlyRentToZipMedianRatio.toFixed(2)}× (above 1.0 = hotter pro-forma than typical renter contract in the ZIP).`,
    );
  }
  if (ctx.listPriceToAnnualGrossRentMultiple !== undefined) {
    lines.push(
      `List (or modeled purchase) ÷ annual gross rent on user inputs: ${ctx.listPriceToAnnualGrossRentMultiple.toFixed(1)}×.`,
    );
  }
  if (ctx.annualGrossYieldPercent !== undefined) {
    lines.push(
      `Implied gross yield on list from user rent: ${ctx.annualGrossYieldPercent.toFixed(2)}%/yr (before expenses).`,
    );
  }
  if (ctx.dealStructureArchetype) {
    const hint =
      ctx.dealStructureArchetype === "equity_heavy"
        ? "Price is very high relative to the rent stream — cap-rate / cash-flow math fights you; appreciation or non-rent exit logic dominates the thesis."
        : ctx.dealStructureArchetype === "income_slanted"
          ? "Price is moderate relative to the rent stream — income metrics carry more weight than in coastal trophy markets."
          : "List and rent are in a middling band — neither obvious pure cash-flow nor obvious pure equity story from geometry alone.";
    lines.push(
      `Deal-shape tag (from list ÷ annual gross rent only): ${ctx.dealStructureArchetype.replace(/_/g, " ").toUpperCase()}. ${hint}`,
    );
  }

  lines.push(
    `Use this block to explain *market type* and whether the rent story matches the ZIP's typical renter economics — not to replace walk-away or comps.`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stress scenarios — computed here just for the AI's system prompt, so the
// model can cite concrete "one vacant month costs $X" style risks without
// hallucinating numbers.
// ---------------------------------------------------------------------------

function computeStressScenarios(a: DealAnalysis) {
  const { inputs } = a;

  // Cost of one extra vacant month = one month of rent lost.
  const oneMonthVacancyCost = inputs.monthlyRent;

  // vacancyCushion: a short sentence the AI can quote directly. Three regimes:
  //   (a) positive cash flow   → "wipes out N months of cash flow"
  //   (b) break-even           → "any vacancy puts you in the red"
  //   (c) already negative     → "cash flow is already negative, so any
  //                              vacancy deepens the monthly loss"
  const vacancyCushion =
    a.monthlyCashFlow > 0
      ? `wipes out ${Math.max(
          1,
          Math.round(inputs.monthlyRent / a.monthlyCashFlow),
        )} months of current cash flow`
      : a.monthlyCashFlow === 0
        ? "the deal is already break-even, so any vacancy puts you in the red"
        : "cash flow is already negative, so any vacancy deepens the monthly loss";

  // Rent −10% and rate +1pt: run the FULL engine with mutated inputs, not
  // a simplified delta approximation. The Stress test tab already does this
  // (app/_components/StressTestPanel.tsx), and chat's prior simplified
  // formulas produced numbers that didn't exactly match the Stress tab for
  // the same deal. That's the "different parts of the tool disagreeing
  // with each other" issue the audit flagged. Re-running analyseDeal here
  // is cheap (pure, ~0.5ms) and keeps the tool speaking with one voice.
  const rentDownAnalysis = analyseDeal({
    ...inputs,
    monthlyRent: Math.max(0, inputs.monthlyRent * 0.9),
  });
  const rentDownCashFlow = rentDownAnalysis.monthlyCashFlow;
  const rentDownDelta = rentDownCashFlow - a.monthlyCashFlow;

  const rateUpAnalysis = analyseDeal({
    ...inputs,
    loanInterestRate: inputs.loanInterestRate + 1,
  });
  const rateUpCashFlow = rateUpAnalysis.monthlyCashFlow;
  const rateUpDelta = rateUpCashFlow - a.monthlyCashFlow;

  return {
    oneMonthVacancyCost,
    vacancyCushion,
    rentDownCashFlow,
    rentDownDelta,
    rateUpCashFlow,
    rateUpDelta,
  };
}

