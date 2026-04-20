import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import {
  analyseDeal,
  DealInputs,
  sanitiseInputs,
  type DealAnalysis,
} from "@/lib/calculations";

// Allow the response up to a full minute — the longest answers can stream 15s+.
export const maxDuration = 60;

type Mode = "verdict" | "chat";

type ChatRequestBody = {
  messages: UIMessage[];
  inputs: DealInputs;
  mode?: Mode;
};

export async function POST(req: Request) {
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

  // Explicit mode picks the model:
  //   "verdict" → gpt-4o-mini (short, structured, cheap, fast)
  //   "chat"    → gpt-4o     (richer reasoning on hypotheticals)
  // If the client omits mode we assume follow-up chat.
  const mode: Mode = body.mode === "verdict" ? "verdict" : "chat";
  const model = mode === "verdict" ? "gpt-4o-mini" : "gpt-4o";

  const result = streamText({
    model: openai(model),
    system: buildSystemPrompt(analysis, mode),
    messages: await convertToModelMessages(body.messages),
    temperature: mode === "verdict" ? 0.2 : 0.3,
  });

  return result.toUIMessageStreamResponse();
}

// ---------------------------------------------------------------------------
// System prompt — identical opener + banned-phrase guardrails for both modes,
// then a mode-specific format contract appended at the end.
// ---------------------------------------------------------------------------

function buildSystemPrompt(a: DealAnalysis, mode: Mode): string {
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

  const preamble = `You are a blunt, numbers-first real estate investment advisor. You speak in specific figures from this deal only — never generalities. You are direct and occasionally contrarian. You never pad your answers.

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
Gross rent multiplier: ${a.grossRentMultiplier.toFixed(1)}
1% rule: ${p(a.onePercentRule, 2)}
Operating expense ratio: ${p(a.operatingExpenseRatio, 0)}
Break-even occupancy: ${p(a.breakEvenOccupancy, 0)}

=== STRESS SCENARIOS (computed for you) ===
One extra month of vacancy costs: ${f(stress.oneMonthVacancyCost)} (wipes out ${stress.vacancyMonthsToNegate} months of current cash flow)
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

  return preamble + formatContract + context;
}

// ---------------------------------------------------------------------------
// Stress scenarios — computed here just for the AI's system prompt, so the
// model can cite concrete "one vacant month costs $X" style risks without
// hallucinating numbers.
// ---------------------------------------------------------------------------

function computeStressScenarios(a: DealAnalysis) {
  const { inputs } = a;

  // Cost of one extra vacant month = one month of rent lost, everything else held.
  const oneMonthVacancyCost = inputs.monthlyRent;
  const vacancyMonthsToNegate =
    a.monthlyCashFlow > 0
      ? Math.max(1, Math.round(inputs.monthlyRent / a.monthlyCashFlow))
      : 0;

  // Rent falls 10%: re-derive monthly cashflow without re-running the full
  // engine. NOI loses 10% of gross rent × (1 − vacancy) × (1 − var opex %).
  const varOpexRate =
    (inputs.maintenancePercent +
      inputs.propertyManagementPercent +
      inputs.capexReservePercent) /
    100;
  const rentDrop = inputs.monthlyRent * 0.1;
  const egiDrop = rentDrop * (1 - inputs.vacancyRatePercent / 100);
  const opexDrop = rentDrop * varOpexRate; // var opex is % of gross rent
  const monthlyNoiDrop = egiDrop - opexDrop;
  const rentDownCashFlow = a.monthlyCashFlow - monthlyNoiDrop;
  const rentDownDelta = rentDownCashFlow - a.monthlyCashFlow;

  // Rate +1pt: approximate the new P&I using standard amortisation.
  const newRate = inputs.loanInterestRate + 1;
  const newMonthly =
    a.loanAmount > 0
      ? mortgagePayment(a.loanAmount, newRate, inputs.loanTermYears)
      : 0;
  const monthlyDebtDelta = newMonthly - a.monthlyMortgagePayment;
  const rateUpCashFlow = a.monthlyCashFlow - monthlyDebtDelta;
  const rateUpDelta = rateUpCashFlow - a.monthlyCashFlow;

  return {
    oneMonthVacancyCost,
    vacancyMonthsToNegate,
    rentDownCashFlow,
    rentDownDelta,
    rateUpCashFlow,
    rateUpDelta,
  };
}

function mortgagePayment(
  principal: number,
  annualRatePct: number,
  years: number,
): number {
  if (principal <= 0 || years <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}
