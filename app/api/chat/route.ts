import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import {
  analyseDeal,
  DealInputs,
  sanitiseInputs,
  type DealAnalysis,
} from "@/lib/calculations";

// Allow the response up to a full minute — the longest answers easily run 15s
export const maxDuration = 60;

type ChatRequestBody = {
  messages: UIMessage[];
  inputs: DealInputs;
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

  // Re-run the engine server-side so the context can never be tampered with
  // from the client. The client sends raw inputs, we sanitise + compute here.
  const inputs = sanitiseInputs(body.inputs);
  const analysis = analyseDeal(inputs);

  const system = buildSystemPrompt(analysis);

  const result = streamText({
    model: openai("gpt-4o"),
    system,
    messages: await convertToModelMessages(body.messages),
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse();
}

// ---------------------------------------------------------------------------
// System prompt — this is what makes the chat feel like it knows the deal.
// Every response must be grounded in these numbers, not generic advice.
// ---------------------------------------------------------------------------

function buildSystemPrompt(a: DealAnalysis): string {
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

  return `You are RealVerdict, a sharp, no-bullshit real estate investment advisor.
You are discussing ONE specific deal with the user. Every answer must be grounded in the
exact numbers below — cite them. Do not give generic advice. Do not hedge with "it depends"
unless you explain exactly what it depends on using these numbers.

When the user asks hypotheticals ("what rent would make this work?", "what price should I offer?"),
do the math inline and explain your reasoning. You are a financial calculator with opinions.

Keep answers tight — 2-4 short paragraphs unless the user asks for more detail. Use plain
numbers (e.g. "$2,600/mo"), not LaTeX.

=== THE DEAL ===

VERDICT: ${verdict.tier.toUpperCase()} (score ${Math.round(verdict.score)}/100)
${verdict.headline}
${verdict.summary}

Strengths: ${verdict.strengths.length ? verdict.strengths.join("; ") : "none flagged"}
Risks: ${verdict.risks.length ? verdict.risks.join("; ") : "none flagged"}

=== PURCHASE & FINANCING ===
Purchase price: ${f(inputs.purchasePrice)}
Down payment: ${p(inputs.downPaymentPercent / 100, 0)} = ${f(a.downPayment)}
Closing costs: ${p(inputs.closingCostsPercent / 100, 1)} = ${f(a.closingCosts)}
Rehab: ${f(inputs.rehabCosts)}
Total cash invested: ${f(a.totalCashInvested)}
Loan amount: ${f(a.loanAmount)}
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
Annual NOI: ${f(a.annualNOI)}
Annual debt service: ${f(a.annualDebtService)}
Annual cash flow: ${f(a.annualCashFlow)}
Monthly cash flow: ${f(a.monthlyCashFlow)}
Cap rate: ${p(a.capRate, 2)}
Cash-on-cash return: ${p(a.cashOnCashReturn, 2)}
DSCR: ${isFinite(a.dscr) ? a.dscr.toFixed(2) : "∞ (no debt)"}
Gross rent multiplier: ${a.grossRentMultiplier.toFixed(1)}
1% rule: ${p(a.onePercentRule, 2)} (monthly rent / price)
Operating expense ratio: ${p(a.operatingExpenseRatio, 0)}
Break-even occupancy: ${p(a.breakEvenOccupancy, 0)}

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

=== BENCHMARKS TO COMPARE AGAINST ===
A "good" long-term rental deal typically has:
- Cash-on-cash: 8%+
- Cap rate: 6%+ (market-dependent)
- DSCR: 1.25+
- Break-even occupancy: below 85%
- Positive monthly cash flow from day one
- IRR: 10%+ over the hold period`;
}
