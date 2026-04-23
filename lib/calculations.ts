/**
 * RealVerdictROI — deal calculation engine.
 *
 * Everything in this module is pure: given the same `DealInputs` it
 * returns the same `DealAnalysis`. No I/O, no React, no Next.js.
 * This is the single source of truth for every number shown in the UI.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DealInputs = {
  // Purchase
  purchasePrice: number;
  downPaymentPercent: number; // 0–100
  closingCostsPercent: number; // 0–100, % of purchase price
  rehabCosts: number; // one-time, rolled into total cash invested

  // Financing
  loanInterestRate: number; // annual %, e.g. 7.25
  loanTermYears: number;

  // Income
  monthlyRent: number;
  otherMonthlyIncome: number; // laundry, parking, storage, etc.
  vacancyRatePercent: number; // 0–100

  // Fixed operating expenses
  annualPropertyTax: number;
  annualInsurance: number;
  monthlyHOA: number;
  monthlyUtilities: number; // owner-paid only

  // Variable operating expenses (% of gross rent)
  maintenancePercent: number;
  propertyManagementPercent: number;
  capexReservePercent: number;

  // Growth + exit
  annualAppreciationPercent: number;
  annualRentGrowthPercent: number;
  annualExpenseGrowthPercent: number;
  sellingCostsPercent: number; // % of sale price at exit
  holdPeriodYears: number;
};

export type YearProjection = {
  year: number;
  grossRent: number;
  effectiveGrossIncome: number;
  operatingExpenses: number;
  noi: number;
  debtService: number;
  cashFlow: number;
  principalPaid: number;
  interestPaid: number;
  loanBalanceEnd: number;
  propertyValueEnd: number;
  equityEnd: number;
  cumulativeCashFlow: number;
};

export type VerdictTier = "excellent" | "good" | "fair" | "poor" | "avoid";

export type RubricStatus = "win" | "ok" | "warn" | "fail";

export type RubricItem = {
  category: string;
  metric: string;          // short-hand for the metric tested (e.g. "Cap rate 6.2%")
  points: number;          // signed contribution to the score
  maxPoints: number;       // upper bound for this category if perfectly satisfied
  status: RubricStatus;
  note: string;            // one-line explanation
};

export type Verdict = {
  tier: VerdictTier;
  score: number; // 0–100
  breakdown: RubricItem[]; // ordered list of signals with their per-category points
  headline: string;
  summary: string;
  strengths: string[];
  risks: string[];
};

export type DealAnalysis = {
  inputs: DealInputs;

  // Upfront
  loanAmount: number;
  downPayment: number;
  closingCosts: number;
  totalCashInvested: number;

  // Monthly snapshot (year 1 averages, no growth applied)
  monthlyMortgagePayment: number;
  monthlyGrossRent: number;
  monthlyEffectiveIncome: number;
  monthlyOperatingExpenses: number;
  monthlyCashFlow: number;
  monthlyNOI: number;

  // Year-1 annualised ratios
  annualGrossIncome: number;
  annualEffectiveIncome: number;
  annualOperatingExpenses: number;
  annualNOI: number;
  annualDebtService: number;
  annualCashFlow: number;

  capRate: number; // NOI / (price + rehab)
  cashOnCashReturn: number; // year-1 cash flow / cash invested
  dscr: number; // NOI / debt service
  grossRentMultiplier: number; // price / annual gross rent
  onePercentRule: number; // monthly rent / purchase price
  operatingExpenseRatio: number; // opex / EGI
  breakEvenOccupancy: number; // (opex + debt service) / gross rent

  // Hold-period projection
  projection: YearProjection[];

  // Exit
  saleYear: number;
  salePrice: number;
  sellingCosts: number;
  loanBalanceAtExit: number;
  netSaleProceeds: number; // after paying off loan + selling costs

  // Totals over hold period
  totalCashFlow: number;
  totalPrincipalPaydown: number;
  totalAppreciation: number;
  totalProfit: number; // cash flow + net sale proceeds − cash invested
  totalROI: number; // totalProfit / cash invested
  averageAnnualReturn: number; // totalROI / holdYears
  irr: number; // annualised, as decimal

  verdict: Verdict;
};

// ---------------------------------------------------------------------------
// Defaults (used by the form)
// ---------------------------------------------------------------------------

export const DEFAULT_INPUTS: DealInputs = {
  purchasePrice: 350_000,
  downPaymentPercent: 20,
  closingCostsPercent: 3,
  rehabCosts: 5_000,

  loanInterestRate: 7.0,
  loanTermYears: 30,

  monthlyRent: 2_600,
  otherMonthlyIncome: 0,
  vacancyRatePercent: 5,

  annualPropertyTax: 4_200,
  annualInsurance: 1_500,
  monthlyHOA: 0,
  monthlyUtilities: 0,

  maintenancePercent: 5,
  propertyManagementPercent: 8,
  capexReservePercent: 5,

  annualAppreciationPercent: 3,
  annualRentGrowthPercent: 3,
  annualExpenseGrowthPercent: 2.5,
  sellingCostsPercent: 6,
  holdPeriodYears: 10,
};

// ---------------------------------------------------------------------------
// Core math helpers
// ---------------------------------------------------------------------------

/**
 * Standard fixed-rate mortgage payment (principal + interest).
 * Falls back to a straight-line payment if the rate is zero.
 */
export function mortgagePayment(
  principal: number,
  annualRatePercent: number,
  termYears: number,
): number {
  if (principal <= 0 || termYears <= 0) return 0;
  const n = Math.round(termYears * 12);
  const r = annualRatePercent / 100 / 12;
  if (r === 0) return principal / n;
  const factor = Math.pow(1 + r, n);
  return (principal * r * factor) / (factor - 1);
}

/**
 * Remaining loan balance after `monthsElapsed` payments.
 * Uses the closed-form amortisation formula.
 */
export function remainingLoanBalance(
  principal: number,
  annualRatePercent: number,
  termYears: number,
  monthsElapsed: number,
): number {
  if (principal <= 0) return 0;
  const n = Math.round(termYears * 12);
  const m = Math.max(0, Math.min(monthsElapsed, n));
  const r = annualRatePercent / 100 / 12;
  if (r === 0) return Math.max(0, principal * (1 - m / n));
  const payment = mortgagePayment(principal, annualRatePercent, termYears);
  const factorM = Math.pow(1 + r, m);
  const balance = principal * factorM - payment * ((factorM - 1) / r);
  return Math.max(0, balance);
}

/**
 * Principal + interest paid during a window of months.
 */
export function amortisationWindow(
  principal: number,
  annualRatePercent: number,
  termYears: number,
  monthsStart: number,
  monthsEnd: number,
): { principalPaid: number; interestPaid: number } {
  const startBalance = remainingLoanBalance(
    principal,
    annualRatePercent,
    termYears,
    monthsStart,
  );
  const endBalance = remainingLoanBalance(
    principal,
    annualRatePercent,
    termYears,
    monthsEnd,
  );
  const payment = mortgagePayment(principal, annualRatePercent, termYears);
  const totalPaid = payment * (monthsEnd - monthsStart);
  const principalPaid = startBalance - endBalance;
  const interestPaid = Math.max(0, totalPaid - principalPaid);
  return { principalPaid, interestPaid };
}

/**
 * Internal rate of return for an irregular cashflow series
 * (cashflows[0] is the outflow at t=0). Annualised.
 *
 * Uses bisection over [−0.99, 10] so we always converge even when NPV
 * is not monotonic around the boundary (e.g. catastrophic losses).
 * Returns NaN if no sign change exists in the bracket.
 */
export function irr(cashflows: number[]): number {
  if (cashflows.length < 2) return NaN;

  const npv = (rate: number): number => {
    let total = 0;
    for (let t = 0; t < cashflows.length; t++) {
      total += cashflows[t] / Math.pow(1 + rate, t);
    }
    return total;
  };

  let lo = -0.9999;
  let hi = 10;
  let npvLo = npv(lo);
  let npvHi = npv(hi);
  if (!isFinite(npvLo) || !isFinite(npvHi)) return NaN;
  if (npvLo * npvHi > 0) return NaN; // no sign change — IRR not defined in range

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npv(mid);
    if (!isFinite(npvMid)) return NaN;
    if (Math.abs(npvMid) < 1e-6) return mid;
    if (npvLo * npvMid < 0) {
      hi = mid;
      npvHi = npvMid;
    } else {
      lo = mid;
      npvLo = npvMid;
    }
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Full deal analysis
// ---------------------------------------------------------------------------

export function analyseDeal(raw: DealInputs): DealAnalysis {
  const inputs = sanitiseInputs(raw);

  const downPayment = inputs.purchasePrice * (inputs.downPaymentPercent / 100);
  const closingCosts =
    inputs.purchasePrice * (inputs.closingCostsPercent / 100);
  const loanAmount = inputs.purchasePrice - downPayment;
  const totalCashInvested = downPayment + closingCosts + inputs.rehabCosts;

  const monthlyPI = mortgagePayment(
    loanAmount,
    inputs.loanInterestRate,
    inputs.loanTermYears,
  );
  const annualDebtService = monthlyPI * 12;

  // Year-1 income/expenses (no growth)
  const monthlyGrossRent = inputs.monthlyRent;
  const annualGrossRent = monthlyGrossRent * 12;
  const annualOtherIncome = inputs.otherMonthlyIncome * 12;
  const grossScheduledIncome = annualGrossRent + annualOtherIncome;

  const vacancyLoss = annualGrossRent * (inputs.vacancyRatePercent / 100);
  const annualEffectiveIncome = grossScheduledIncome - vacancyLoss;

  const variableOpex =
    annualGrossRent *
    ((inputs.maintenancePercent +
      inputs.propertyManagementPercent +
      inputs.capexReservePercent) /
      100);
  const fixedOpex =
    inputs.annualPropertyTax +
    inputs.annualInsurance +
    inputs.monthlyHOA * 12 +
    inputs.monthlyUtilities * 12;
  const annualOperatingExpenses = variableOpex + fixedOpex;

  const annualNOI = annualEffectiveIncome - annualOperatingExpenses;
  const annualCashFlow = annualNOI - annualDebtService;

  // Ratios
  const basis = inputs.purchasePrice + inputs.rehabCosts;
  const capRate = basis > 0 ? annualNOI / basis : 0;
  const cashOnCashReturn =
    totalCashInvested > 0 ? annualCashFlow / totalCashInvested : 0;
  const dscr = annualDebtService > 0 ? annualNOI / annualDebtService : Infinity;
  const grossRentMultiplier =
    annualGrossRent > 0 ? inputs.purchasePrice / annualGrossRent : 0;
  const onePercentRule =
    inputs.purchasePrice > 0 ? monthlyGrossRent / inputs.purchasePrice : 0;
  const operatingExpenseRatio =
    annualEffectiveIncome > 0
      ? annualOperatingExpenses / annualEffectiveIncome
      : 0;
  const breakEvenOccupancy =
    annualGrossRent > 0
      ? (annualOperatingExpenses + annualDebtService) / annualGrossRent
      : 0;

  // Year-by-year projection
  const projection: YearProjection[] = [];
  let cumulativeCashFlow = 0;
  for (let year = 1; year <= inputs.holdPeriodYears; year++) {
    const rentGrowthFactor = Math.pow(
      1 + inputs.annualRentGrowthPercent / 100,
      year - 1,
    );
    const expenseGrowthFactor = Math.pow(
      1 + inputs.annualExpenseGrowthPercent / 100,
      year - 1,
    );
    const appreciationFactor = Math.pow(
      1 + inputs.annualAppreciationPercent / 100,
      year,
    );

    const yearGrossRent = annualGrossRent * rentGrowthFactor;
    const yearOtherIncome = annualOtherIncome * rentGrowthFactor;
    const yearVacancyLoss =
      yearGrossRent * (inputs.vacancyRatePercent / 100);
    const yearEGI = yearGrossRent + yearOtherIncome - yearVacancyLoss;

    const yearVariableOpex =
      yearGrossRent *
      ((inputs.maintenancePercent +
        inputs.propertyManagementPercent +
        inputs.capexReservePercent) /
        100);
    const yearFixedOpex = fixedOpex * expenseGrowthFactor;
    const yearOpex = yearVariableOpex + yearFixedOpex;

    const yearNOI = yearEGI - yearOpex;
    const yearDebtService = annualDebtService;
    const yearCashFlow = yearNOI - yearDebtService;
    cumulativeCashFlow += yearCashFlow;

    const { principalPaid, interestPaid } = amortisationWindow(
      loanAmount,
      inputs.loanInterestRate,
      inputs.loanTermYears,
      (year - 1) * 12,
      year * 12,
    );
    const loanBalanceEnd = remainingLoanBalance(
      loanAmount,
      inputs.loanInterestRate,
      inputs.loanTermYears,
      year * 12,
    );
    const propertyValueEnd = inputs.purchasePrice * appreciationFactor;
    const equityEnd = propertyValueEnd - loanBalanceEnd;

    projection.push({
      year,
      grossRent: yearGrossRent,
      effectiveGrossIncome: yearEGI,
      operatingExpenses: yearOpex,
      noi: yearNOI,
      debtService: yearDebtService,
      cashFlow: yearCashFlow,
      principalPaid,
      interestPaid,
      loanBalanceEnd,
      propertyValueEnd,
      equityEnd,
      cumulativeCashFlow,
    });
  }

  // Exit
  const saleYear = inputs.holdPeriodYears;
  const finalYear = projection[projection.length - 1];
  const salePrice = finalYear ? finalYear.propertyValueEnd : inputs.purchasePrice;
  const sellingCosts = salePrice * (inputs.sellingCostsPercent / 100);
  const loanBalanceAtExit = finalYear ? finalYear.loanBalanceEnd : loanAmount;
  const netSaleProceeds = salePrice - sellingCosts - loanBalanceAtExit;

  const totalCashFlow = projection.reduce((s, y) => s + y.cashFlow, 0);
  const totalPrincipalPaydown = projection.reduce(
    (s, y) => s + y.principalPaid,
    0,
  );
  const totalAppreciation = salePrice - inputs.purchasePrice;
  const totalProfit = totalCashFlow + netSaleProceeds - totalCashInvested;
  const totalROI =
    totalCashInvested > 0 ? totalProfit / totalCashInvested : 0;
  const averageAnnualReturn =
    inputs.holdPeriodYears > 0 ? totalROI / inputs.holdPeriodYears : 0;

  // IRR: t=0 is full cash outflow, t=1..N-1 are annual cash flows,
  // t=N is the final year's cash flow + net sale proceeds.
  const flows: number[] = [-totalCashInvested];
  projection.forEach((y, idx) => {
    if (idx === projection.length - 1) {
      flows.push(y.cashFlow + netSaleProceeds);
    } else {
      flows.push(y.cashFlow);
    }
  });
  const computedIrr = irr(flows);

  const verdict = renderVerdict({
    cashOnCashReturn,
    capRate,
    dscr,
    annualCashFlow,
    totalROI,
    irr: computedIrr,
    grossRentMultiplier,
    breakEvenOccupancy,
    operatingExpenseRatio,
  });

  return {
    inputs,

    loanAmount,
    downPayment,
    closingCosts,
    totalCashInvested,

    monthlyMortgagePayment: monthlyPI,
    monthlyGrossRent,
    monthlyEffectiveIncome: annualEffectiveIncome / 12,
    monthlyOperatingExpenses: annualOperatingExpenses / 12,
    monthlyCashFlow: annualCashFlow / 12,
    monthlyNOI: annualNOI / 12,

    annualGrossIncome: grossScheduledIncome,
    annualEffectiveIncome,
    annualOperatingExpenses,
    annualNOI,
    annualDebtService,
    annualCashFlow,

    capRate,
    cashOnCashReturn,
    dscr,
    grossRentMultiplier,
    onePercentRule,
    operatingExpenseRatio,
    breakEvenOccupancy,

    projection,

    saleYear,
    salePrice,
    sellingCosts,
    loanBalanceAtExit,
    netSaleProceeds,

    totalCashFlow,
    totalPrincipalPaydown,
    totalAppreciation,
    totalProfit,
    totalROI,
    averageAnnualReturn,
    irr: computedIrr,

    verdict,
  };
}

// ---------------------------------------------------------------------------
// Verdict scoring — translates ratios into a plain-English recommendation.
// ---------------------------------------------------------------------------

type VerdictMetrics = {
  cashOnCashReturn: number;
  capRate: number;
  dscr: number;
  annualCashFlow: number;
  totalROI: number;
  irr: number;
  grossRentMultiplier: number;
  breakEvenOccupancy: number;
  operatingExpenseRatio: number;
};

function renderVerdict(m: VerdictMetrics): Verdict {
  // A deal that's negative-year-1 can still be a good appreciation play —
  // classic example is a low-cap-rate NJ / Long Island / CA market where the
  // investor is underwriting for equity growth and rent catch-up rather than
  // immediate cash flow. Hard-punishing those deals produces absurd outcomes
  // like "AVOID" on a property with 10%+ IRR and a 2.5× equity multiple.
  //
  // When long-term math is clearly positive (IRR ≥ 8% AND total-ROI ≥ 50%
  // over the hold period), we soften the year-1 CoC / DSCR fails — the
  // shortfall is still flagged as "warn" but no longer torpedoes the score.
  const appreciationRescue =
    isFinite(m.irr) && m.irr >= 0.08 && m.totalROI >= 0.5;

  const breakdown: RubricItem[] = [
    scoreCashOnCash(m.cashOnCashReturn, appreciationRescue),
    scoreCapRate(m.capRate),
    scoreDSCR(m.dscr, appreciationRescue),
    scoreIRR(m.irr),
    scoreBreakEven(m.breakEvenOccupancy),
    scoreGRM(m.grossRentMultiplier),
    scoreTotalROI(m.totalROI),
  ];

  const score = Math.max(
    0,
    Math.min(100, breakdown.reduce((s, r) => s + r.points, 0)),
  );

  const strengths = breakdown
    .filter((r) => r.status === "win")
    .map((r) => r.note);
  const risks = breakdown
    .filter((r) => r.status === "warn" || r.status === "fail")
    .map((r) => r.note);

  let tier: VerdictTier;
  let headline: string;
  let summary: string;

  if (score >= 75) {
    tier = "excellent";
    headline = "Green light — this is a strong deal.";
    summary =
      "Income comfortably covers debt, cash-on-cash and IRR both clear the bar, and the margin for error is healthy. Worth pursuing.";
  } else if (score >= 55) {
    tier = "good";
    headline = "Workable deal with solid fundamentals.";
    summary =
      "The numbers pencil out. A few metrics are below ideal, but nothing disqualifying. Negotiate on price or rehab to push it into excellent territory.";
  } else if (score >= 35) {
    tier = "fair";
    headline = "Marginal — only worth it with a strong angle.";
    summary =
      "Returns are modest and the deal depends on things going right (appreciation, rent growth, low vacancy). Not a disaster, but not a no-brainer either.";
  } else if (score >= 15) {
    tier = "poor";
    headline = "Weak on the numbers.";
    summary =
      "Cash flow, leverage, or both are working against you. Re-run with a lower price or better terms before committing capital.";
  } else {
    tier = "avoid";
    headline = "Walk away.";
    summary =
      "The deal is projected to lose money or leave you dangerously exposed. There are better uses for this capital.";
  }

  return { tier, score, breakdown, headline, summary, strengths, risks };
}

// ---------------------------------------------------------------------------
// Per-category scoring helpers. Each returns a RubricItem with a signed point
// contribution, the maximum it could contribute under ideal conditions, and a
// status that the UI uses to color the row.
// ---------------------------------------------------------------------------

function scoreCashOnCash(coc: number, appreciationRescue: boolean): RubricItem {
  // Year-1 cash-on-cash is important but not determinative — plenty of real
  // deals start cash-flow-negative and reach strong returns via rent growth
  // and principal paydown. We cap the upside at 12pts (down from 18) so the
  // scorecard doesn't double-count with IRR, and we cap the negative
  // penalty at -3 when long-term math rescues the deal.
  const category = "Cash-on-cash";
  const metric = `${(coc * 100).toFixed(1)}% year-1 CoC`;
  const maxPoints = 12;
  if (coc >= 0.12)
    return {
      category, metric, maxPoints, points: 12, status: "win",
      note: `Strong ${(coc * 100).toFixed(1)}% cash-on-cash return.`,
    };
  if (coc >= 0.08)
    return {
      category, metric, maxPoints, points: 9, status: "win",
      note: `Healthy ${(coc * 100).toFixed(1)}% cash-on-cash return.`,
    };
  if (coc >= 0.05)
    return {
      category, metric, maxPoints, points: 5, status: "warn",
      note: `Cash-on-cash only ${(coc * 100).toFixed(1)}% — below the 8% comfort zone.`,
    };
  if (coc >= 0)
    return {
      category, metric, maxPoints, points: 2, status: "warn",
      note: `Thin cash-on-cash (${(coc * 100).toFixed(1)}%) leaves little margin for error.`,
    };
  // Negative CoC — soften if IRR/totalROI rescue the deal long-term.
  if (appreciationRescue)
    return {
      category, metric, maxPoints, points: -3, status: "warn",
      note: `Year-1 cash-on-cash is negative (${(coc * 100).toFixed(1)}%) — you'll feed this deal upfront, but long-term IRR and equity growth make the math work.`,
    };
  return {
    category, metric, maxPoints, points: -8, status: "fail",
    note: `Negative cash-on-cash (${(coc * 100).toFixed(1)}%) — you pay to own this.`,
  };
}

function scoreCapRate(cap: number): RubricItem {
  const category = "Cap rate";
  const metric = `${(cap * 100).toFixed(1)}% NOI / price`;
  const maxPoints = 15;
  if (cap >= 0.08)
    return {
      category, metric, maxPoints, points: 15, status: "win",
      note: `High cap rate of ${(cap * 100).toFixed(1)}%.`,
    };
  if (cap >= 0.06)
    return {
      category, metric, maxPoints, points: 11, status: "win",
      note: `Solid cap rate of ${(cap * 100).toFixed(1)}%.`,
    };
  if (cap >= 0.045)
    return {
      category, metric, maxPoints, points: 6, status: "ok",
      note: `Cap rate of ${(cap * 100).toFixed(1)}% is in the average range.`,
    };
  return {
    category, metric, maxPoints, points: 0, status: "warn",
    note: `Low cap rate (${(cap * 100).toFixed(1)}%) — betting on appreciation, not income.`,
  };
}

function scoreDSCR(dscr: number, appreciationRescue: boolean): RubricItem {
  const category = "DSCR";
  const maxPoints = 15;
  if (!isFinite(dscr))
    return {
      category, metric: "All cash (no debt)", maxPoints, points: 12, status: "win",
      note: "No debt — every dollar of NOI is yours.",
    };
  const metric = `${dscr.toFixed(2)} (NOI / debt service)`;
  if (dscr >= 1.5)
    return {
      category, metric, maxPoints, points: 15, status: "win",
      note: `Very safe ${dscr.toFixed(2)} DSCR.`,
    };
  if (dscr >= 1.25)
    return {
      category, metric, maxPoints, points: 11, status: "win",
      note: `Comfortable ${dscr.toFixed(2)} DSCR.`,
    };
  if (dscr >= 1.0)
    return {
      category, metric, maxPoints, points: 4, status: "warn",
      note: `Tight ${dscr.toFixed(2)} DSCR — one bad month and you're underwater.`,
    };
  // Sub-1 DSCR: lender-alarm territory, still a warn/fail. Soften the hit if
  // the long-term math rescues the deal — the real risk is refinancing, not
  // insolvency, when equity is building quickly.
  if (appreciationRescue)
    return {
      category, metric, maxPoints, points: -3, status: "warn",
      note: `DSCR ${dscr.toFixed(2)} means year-1 NOI doesn't cover debt service — you'll carry the shortfall. Flagged but not disqualifying given the IRR and equity growth.`,
    };
  return {
    category, metric, maxPoints, points: -8, status: "fail",
    note: `DSCR below 1.0 (${dscr.toFixed(2)}) — NOI does not cover the mortgage.`,
  };
}

function scoreIRR(irr: number): RubricItem {
  // IRR is the single best summary statistic for a hold-period return, so we
  // lean on it more heavily (max 22, up from 18) and give it an 8% tier
  // between the 10% and 6% breakpoints. 8% ≈ long-run S&P 500 real return
  // which is a reasonable "rescue threshold" for a cash-tight deal.
  const category = "IRR (hold period)";
  const maxPoints = 22;
  if (!isFinite(irr))
    return {
      category, metric: "Could not converge", maxPoints, points: 0, status: "ok",
      note: "IRR couldn't be computed for this cash-flow shape.",
    };
  const metric = `${(irr * 100).toFixed(1)}% annualised`;
  if (irr >= 0.15)
    return {
      category, metric, maxPoints, points: 22, status: "win",
      note: `Excellent projected IRR of ${(irr * 100).toFixed(1)}%.`,
    };
  if (irr >= 0.1)
    return {
      category, metric, maxPoints, points: 16, status: "win",
      note: `Strong projected IRR of ${(irr * 100).toFixed(1)}%.`,
    };
  if (irr >= 0.08)
    return {
      category, metric, maxPoints, points: 11, status: "win",
      note: `Solid projected IRR of ${(irr * 100).toFixed(1)}% — beats the stock market on average.`,
    };
  if (irr >= 0.06)
    return {
      category, metric, maxPoints, points: 6, status: "ok",
      note: `Modest IRR of ${(irr * 100).toFixed(1)}% — roughly in line with the stock market.`,
    };
  if (irr >= 0)
    return {
      category, metric, maxPoints, points: 1, status: "warn",
      note: `Low IRR (${(irr * 100).toFixed(1)}%) — you can likely do better with an index fund.`,
    };
  return {
    category, metric, maxPoints, points: -8, status: "fail",
    note: `Negative IRR (${(irr * 100).toFixed(1)}%) — projected to lose money.`,
  };
}

function scoreBreakEven(be: number): RubricItem {
  const category = "Vacancy tolerance";
  const metric = `${(be * 100).toFixed(0)}% break-even occupancy`;
  const maxPoints = 10;
  if (be > 0 && be < 0.8)
    return {
      category, metric, maxPoints, points: 10, status: "win",
      note: `Low break-even occupancy of ${(be * 100).toFixed(0)}% — lots of buffer.`,
    };
  if (be < 0.85)
    return {
      category, metric, maxPoints, points: 7, status: "ok",
      note: `Break-even occupancy of ${(be * 100).toFixed(0)}% is workable.`,
    };
  if (be < 0.95)
    return {
      category, metric, maxPoints, points: 4, status: "warn",
      note: `Break-even occupancy of ${(be * 100).toFixed(0)}% leaves limited room.`,
    };
  return {
    category, metric, maxPoints, points: 0, status: "fail",
    note: `Break-even occupancy is ${(be * 100).toFixed(0)}% — almost no vacancy tolerance.`,
  };
}

function scoreGRM(grm: number): RubricItem {
  // Gross Rent Multiplier = price / annual gross rent. Lower = better.
  // 2025-2026 reference points by metro: Cleveland/Memphis ~7-9, Tampa/Atlanta
  // ~10-13, Austin/Charlotte ~13-16, Boston/Seattle ~15-18, SF/NYC/LA ~18-25+.
  // Target: under 12 is generally cash-flow friendly anywhere; over 18 means
  // you are paying for appreciation, not income.
  const category = "Price-to-rent (GRM)";
  const metric = `${grm.toFixed(1)}× annual rent`;
  const maxPoints = 7;
  if (grm <= 0)
    return {
      category, metric: "—", maxPoints, points: 0, status: "ok",
      note: "Couldn't compute GRM (need both rent and price).",
    };
  if (grm <= 9)
    return {
      category, metric, maxPoints, points: 7, status: "win",
      note: `Strong price-to-rent (${grm.toFixed(1)}× annual). Cash flow comes easy at this multiple.`,
    };
  if (grm <= 12)
    return {
      category, metric, maxPoints, points: 5, status: "win",
      note: `Healthy price-to-rent (${grm.toFixed(1)}× annual) for most US markets.`,
    };
  if (grm <= 15)
    return {
      category, metric, maxPoints, points: 3, status: "ok",
      note: `Average price-to-rent (${grm.toFixed(1)}× annual) — typical of mid-tier metros.`,
    };
  if (grm <= 18)
    return {
      category, metric, maxPoints, points: 1, status: "warn",
      note: `Expensive price-to-rent (${grm.toFixed(1)}× annual). Income margin is thin.`,
    };
  return {
    category, metric, maxPoints, points: 0, status: "fail",
    note: `Very high price-to-rent (${grm.toFixed(1)}× annual) — you're paying for appreciation, not cash flow.`,
  };
}

function scoreTotalROI(roi: number): RubricItem {
  const category = "Total ROI";
  const metric = `${(roi * 100).toFixed(0)}% over hold period`;
  const maxPoints = 10;
  if (roi >= 1.5)
    return {
      category, metric, maxPoints, points: 10, status: "win",
      note: `Projected total ROI of ${(roi * 100).toFixed(0)}% over the hold period.`,
    };
  if (roi >= 0.5)
    return {
      category, metric, maxPoints, points: 5, status: "ok",
      note: `Projected total ROI of ${(roi * 100).toFixed(0)}% — adequate over the hold period.`,
    };
  if (roi >= 0)
    return {
      category, metric, maxPoints, points: 1, status: "warn",
      note: `Projected total ROI of ${(roi * 100).toFixed(0)}% is weak.`,
    };
  return {
    category, metric, maxPoints, points: -5, status: "fail",
    note: `Projected total ROI is negative (${(roi * 100).toFixed(0)}%).`,
  };
}

// ---------------------------------------------------------------------------
// Input sanitisation — the form sends strings through the URL, so anything
// reaching the engine should be clamped into a physically meaningful range.
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  if (!isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function sanitiseInputs(raw: DealInputs): DealInputs {
  return {
    purchasePrice: clamp(raw.purchasePrice, 0, 1_000_000_000),
    downPaymentPercent: clamp(raw.downPaymentPercent, 0, 100),
    closingCostsPercent: clamp(raw.closingCostsPercent, 0, 100),
    rehabCosts: clamp(raw.rehabCosts, 0, 1_000_000_000),

    loanInterestRate: clamp(raw.loanInterestRate, 0, 50),
    loanTermYears: clamp(raw.loanTermYears, 0, 50),

    monthlyRent: clamp(raw.monthlyRent, 0, 10_000_000),
    otherMonthlyIncome: clamp(raw.otherMonthlyIncome, 0, 10_000_000),
    vacancyRatePercent: clamp(raw.vacancyRatePercent, 0, 100),

    annualPropertyTax: clamp(raw.annualPropertyTax, 0, 100_000_000),
    annualInsurance: clamp(raw.annualInsurance, 0, 100_000_000),
    monthlyHOA: clamp(raw.monthlyHOA, 0, 1_000_000),
    monthlyUtilities: clamp(raw.monthlyUtilities, 0, 1_000_000),

    maintenancePercent: clamp(raw.maintenancePercent, 0, 100),
    propertyManagementPercent: clamp(raw.propertyManagementPercent, 0, 100),
    capexReservePercent: clamp(raw.capexReservePercent, 0, 100),

    annualAppreciationPercent: clamp(raw.annualAppreciationPercent, -50, 50),
    annualRentGrowthPercent: clamp(raw.annualRentGrowthPercent, -50, 50),
    annualExpenseGrowthPercent: clamp(raw.annualExpenseGrowthPercent, -50, 50),
    sellingCostsPercent: clamp(raw.sellingCostsPercent, 0, 100),
    holdPeriodYears: Math.max(1, Math.round(clamp(raw.holdPeriodYears, 1, 50))),
  };
}

// ---------------------------------------------------------------------------
// Offer-ceiling solver
//
// Given a set of inputs, finds the highest purchase price at which the deal
// would still earn each verdict tier. Uses binary search — the verdict score
// is monotonically non-increasing as price rises (price up → cap, CoC, DSCR,
// IRR all fall), which gives us a clean inversion target.
//
// Result shape (each value is the max purchase price for that tier or better):
//   { excellent?: number, good?: number, fair?: number, poor?: number }
//
// A tier is omitted if it isn't achievable at any price ≥ $1,000.
// ---------------------------------------------------------------------------

export type OfferCeiling = {
  /** Max price at which the deal scores "excellent". */
  excellent?: number;
  /** Max price at which the deal scores at least "good". */
  good?: number;
  /** Max price at which the deal scores at least "fair". */
  fair?: number;
  /** Max price at which the deal scores at least "poor" (i.e. anything but "avoid"). */
  poor?: number;
  /** The currently-supplied price, echoed back for convenience. */
  currentPrice: number;
  /** The verdict tier at the current price. */
  currentTier: VerdictTier;
  /**
   * The market-value anchor that capped the ceilings, if any. Set when the
   * caller passes `marketValueCap` AND that cap actively clipped at least
   * one tier ceiling. The UI shows this to explain why the headline isn't
   * an absurdly high rubric-only number (e.g. "bounded by fair value $472k").
   */
  marketValueCap?: {
    cap: number;
    source: "comps" | "list";
    /** True if at least one tier ceiling was clipped to the cap. */
    binding: boolean;
  };
  /**
   * The single price we recommend as the practical ceiling — defined as the
   * max price for the best tier that is achievable. Investors negotiate
   * against this number.
   */
  recommendedCeiling?: { price: number; tier: VerdictTier };
  /**
   * The practical negotiation target: the best tier that's reachable within
   * a realistic discount from asking (≤10% under list). This is what we
   * show as the headline — an investor doesn't usually bid $150k under a
   * $500k listing to chase a "STRONG BUY" label; they negotiate a few
   * points off and take "GOOD DEAL".
   */
  primaryTarget?: { price: number; tier: VerdictTier; discountPercent: number };
  /**
   * If the user is willing to negotiate harder, what's the next tier up and
   * how much more off asking would they need? Shown as a secondary prompt.
   */
  stretchTarget?: { price: number; tier: VerdictTier; discountPercent: number };
  /**
   * A rate-buydown equivalent: buying down the interest rate 1pt costs
   * roughly `buydownCostPer1pt` up front and saves `buydownPriceEquivPer1pt`
   * in purchase-price terms. Helps investors see that negotiating rate vs
   * price are interchangeable levers.
   */
  rateBuydown?: { costPer1pt: number; priceEquivPer1pt: number };
};

const TIER_ORDER: VerdictTier[] = ["avoid", "poor", "fair", "good", "excellent"];

function tierAtLeast(tier: VerdictTier, target: VerdictTier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(target);
}

export type FindOfferCeilingOptions = {
  /**
   * Market-value anchor used to clamp every tier ceiling. The income rubric
   * alone can return absurd numbers on rent-heavy listings (e.g. "even at
   * $3.4M this still cash-flows to POOR tier"), so we bound the search by
   * what the property is actually worth. Pass `comps.marketValue.value`
   * when available, `listPrice` otherwise. The cap is applied multiplicatively
   * via `marketValueCapPremium` (default 1.05 — a 5% "I want this specific
   * property" premium over the anchor).
   */
  marketValueCap?: number;
  /** Source of the cap, used purely for the UI explanation. Defaults to "list". */
  marketValueCapSource?: "comps" | "list";
  /**
   * Multiplier applied to `marketValueCap` before clamping. Default 1.05 —
   * you can pay up to 5% over the anchor for a property you particularly want.
   * Above that you're just overpaying, no matter how well the income math works.
   */
  marketValueCapPremium?: number;
};

export function findOfferCeiling(
  inputs: DealInputs,
  options: FindOfferCeilingOptions = {},
): OfferCeiling {
  const safe = sanitiseInputs(inputs);
  const baseAnalysis = analyseDeal(safe);

  // Compute the effective market-value ceiling. We cap the binary-search
  // upper bound AND post-clamp any returned tier price. This prevents the
  // pure income rubric from returning walk-away prices 5-10× market value
  // on listings where rent is generous relative to ask — which reads as
  // nonsense to an investor and destroys product credibility in a demo.
  const rawCap = options.marketValueCap;
  const premium =
    options.marketValueCapPremium === undefined ? 1.05 : options.marketValueCapPremium;
  const effectiveCap =
    typeof rawCap === "number" && isFinite(rawCap) && rawCap > 0
      ? rawCap * premium
      : undefined;
  const capSource: "comps" | "list" =
    options.marketValueCapSource ?? "list";

  // We search across [1k, upper] where upper is the lesser of (rubric
  // headroom) and (market-value cap). Binary-search 25 iterations gets
  // ~1$ precision over a $5M range.
  const lower = 1_000;
  const rubricUpper = Math.max(safe.purchasePrice * 5, 5_000_000);
  const upper =
    effectiveCap !== undefined ? Math.min(rubricUpper, effectiveCap) : rubricUpper;

  const ceilings: OfferCeiling = {
    currentPrice: safe.purchasePrice,
    currentTier: baseAnalysis.verdict.tier,
  };

  // Solve each tier independently. Each is the largest price at which
  // analyseDeal({ price }).verdict.tier >= target, clamped by the cap.
  let anyBinding = false;
  for (const target of ["excellent", "good", "fair", "poor"] as const) {
    const max = solveMaxPriceForTier(safe, target, lower, upper);
    if (max !== null) {
      // If the solver pinned the ceiling at the search upper bound AND the
      // cap actually tightened the range, the cap is binding for this tier.
      if (effectiveCap !== undefined && max >= upper - 500) {
        anyBinding = true;
      }
      ceilings[target] = max;
    }
  }

  if (effectiveCap !== undefined) {
    ceilings.marketValueCap = {
      cap: Math.round(effectiveCap),
      source: capSource,
      binding: anyBinding,
    };
  }

  // Recommendation = the highest tier that's achievable at any price.
  for (const target of ["excellent", "good", "fair", "poor"] as const) {
    const price = ceilings[target];
    if (price !== undefined) {
      ceilings.recommendedCeiling = { price, tier: target };
      break;
    }
  }

  // Practical target = best tier reachable inside a realistic negotiation
  // band (≤15% under list, or free upside if asking is already below). We
  // want the headline to be an offer a buyer would actually make, not a
  // lowball that would insult the seller.
  //
  // We deliberately EXCLUDE "poor" (PASS) from target eligibility. PASS is a
  // don't-buy verdict — telling the user "Max offer: $X for PASS" is
  // nonsensical advice that looks like a green light. If the best-achievable
  // tier inside the negotiation band is poor/avoid, primaryTarget stays
  // undefined and the card renders a "skip this deal" headline instead
  // of a phantom walk-away price. (Bug caught 2026-04-23 on a NJ commuter
  // listing where the engine said "walk-away $566k for PASS. Good setup."
  // on a deal losing $1,450/mo.)
  const NEGOTIATION_BAND = 0.15;
  const minRealistic = safe.purchasePrice * (1 - NEGOTIATION_BAND);
  for (const target of ["excellent", "good", "fair"] as const) {
    const price = ceilings[target];
    if (price === undefined) continue;
    if (price >= minRealistic) {
      const discount = Math.max(0, (safe.purchasePrice - price) / safe.purchasePrice);
      ceilings.primaryTarget = { price, tier: target, discountPercent: discount * 100 };
      break;
    }
  }
  // If nothing clears the negotiation band, primaryTarget stays undefined.
  // The card renders a "skip — doesn't work at realistic offers" headline
  // rather than recommending a lowball or a PASS-tier ceiling. The
  // absolute `recommendedCeiling` is still available for analytical use
  // (stress test, rubric page, etc).

  // Stretch target: next tier up from primary (only if it exists AND it's
  // more than a rounding error away). Lets the UI offer "...or push for
  // STRONG BUY with another $18k off".
  if (ceilings.primaryTarget) {
    const primaryIdx = TIER_ORDER.indexOf(ceilings.primaryTarget.tier);
    for (let i = primaryIdx + 1; i < TIER_ORDER.length; i++) {
      const tier = TIER_ORDER[i];
      if (tier === "avoid") continue;
      const price = ceilings[tier];
      if (price !== undefined && ceilings.primaryTarget.price - price > 500) {
        const discount = Math.max(0, (safe.purchasePrice - price) / safe.purchasePrice);
        ceilings.stretchTarget = { price, tier, discountPercent: discount * 100 };
        break;
      }
    }
  }

  // Rate buydown equivalent. Rule of thumb: 1pt of rate buydown costs ~1% of
  // the loan amount, and saves roughly (loan × rate_delta × years_of_hold)
  // over the hold — but what investors actually care about is "how much
  // price negotiation does this equal?". We estimate it as the price cut
  // that would produce the same annual-debt-service reduction at the
  // original rate. This gives them an apples-to-apples lever.
  const loanAmount = safe.purchasePrice * (1 - safe.downPaymentPercent / 100);
  if (loanAmount > 0 && safe.loanInterestRate > 0.5) {
    const originalPI = mortgagePayment(loanAmount, safe.loanInterestRate, safe.loanTermYears);
    const reducedRate = Math.max(0.1, safe.loanInterestRate - 1);
    const reducedPI = mortgagePayment(loanAmount, reducedRate, safe.loanTermYears);
    const piSavingsPerMonth = originalPI - reducedPI;
    // Price cut that produces the same P&I saving at the original rate +
    // same down-payment percentage + same term. Closed-form: piSavings is
    // proportional to loan amount, which is proportional to purchase price
    // at fixed LTV → priceEquivalent = piSavings * 12 * (price / originalPI).
    const priceEquivPer1pt =
      originalPI > 0
        ? (piSavingsPerMonth / originalPI) * safe.purchasePrice
        : 0;
    ceilings.rateBuydown = {
      costPer1pt: Math.round((loanAmount * 0.01) / 100) * 100, // 1% of loan, rounded to $100
      priceEquivPer1pt: Math.round(priceEquivPer1pt / 500) * 500,
    };
  }

  return ceilings;
}

function solveMaxPriceForTier(
  baseInputs: DealInputs,
  targetTier: VerdictTier,
  lower: number,
  upper: number,
): number | null {
  // First sanity-check the bounds. If even the lower bound doesn't reach the
  // tier, there's no solution. If even the upper bound is at-or-above, the
  // ceiling is past our search range.
  const tierAt = (price: number): VerdictTier =>
    analyseDeal({ ...baseInputs, purchasePrice: price }).verdict.tier;

  if (!tierAtLeast(tierAt(lower), targetTier)) return null;
  if (tierAtLeast(tierAt(upper), targetTier)) return Math.round(upper);

  // Binary search for the boundary.
  let lo = lower;
  let hi = upper;
  // 25 iterations is more than enough — log2(5M) ≈ 23.
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2;
    if (tierAtLeast(tierAt(mid), targetTier)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // Round to the nearest $500 — investors don't negotiate down to the dollar.
  return Math.round(lo / 500) * 500;
}

// ---------------------------------------------------------------------------
// URL serialisation — keeps the analysis shareable and deep-linkable.
// ---------------------------------------------------------------------------

const INPUT_KEYS: Array<keyof DealInputs> = [
  "purchasePrice",
  "downPaymentPercent",
  "closingCostsPercent",
  "rehabCosts",
  "loanInterestRate",
  "loanTermYears",
  "monthlyRent",
  "otherMonthlyIncome",
  "vacancyRatePercent",
  "annualPropertyTax",
  "annualInsurance",
  "monthlyHOA",
  "monthlyUtilities",
  "maintenancePercent",
  "propertyManagementPercent",
  "capexReservePercent",
  "annualAppreciationPercent",
  "annualRentGrowthPercent",
  "annualExpenseGrowthPercent",
  "sellingCostsPercent",
  "holdPeriodYears",
];

export function inputsToSearchParams(inputs: DealInputs): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of INPUT_KEYS) {
    params.set(key, String(inputs[key]));
  }
  return params;
}

export function inputsFromSearchParams(
  search: Record<string, string | string[] | undefined>,
): DealInputs {
  const read = (key: keyof DealInputs): number => {
    const raw = search[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value === undefined ? NaN : Number(value);
    return isFinite(parsed) ? parsed : (DEFAULT_INPUTS[key] as number);
  };

  const inputs: DealInputs = {
    purchasePrice: read("purchasePrice"),
    downPaymentPercent: read("downPaymentPercent"),
    closingCostsPercent: read("closingCostsPercent"),
    rehabCosts: read("rehabCosts"),
    loanInterestRate: read("loanInterestRate"),
    loanTermYears: read("loanTermYears"),
    monthlyRent: read("monthlyRent"),
    otherMonthlyIncome: read("otherMonthlyIncome"),
    vacancyRatePercent: read("vacancyRatePercent"),
    annualPropertyTax: read("annualPropertyTax"),
    annualInsurance: read("annualInsurance"),
    monthlyHOA: read("monthlyHOA"),
    monthlyUtilities: read("monthlyUtilities"),
    maintenancePercent: read("maintenancePercent"),
    propertyManagementPercent: read("propertyManagementPercent"),
    capexReservePercent: read("capexReservePercent"),
    annualAppreciationPercent: read("annualAppreciationPercent"),
    annualRentGrowthPercent: read("annualRentGrowthPercent"),
    annualExpenseGrowthPercent: read("annualExpenseGrowthPercent"),
    sellingCostsPercent: read("sellingCostsPercent"),
    holdPeriodYears: read("holdPeriodYears"),
  };

  return sanitiseInputs(inputs);
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by both form + results page)
// ---------------------------------------------------------------------------

export const formatCurrency = (n: number, fractionDigits = 0): string =>
  isFinite(n)
    ? n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      })
    : "—";

export const formatPercent = (n: number, fractionDigits = 1): string =>
  isFinite(n) ? `${(n * 100).toFixed(fractionDigits)}%` : "—";

export const formatNumber = (n: number, fractionDigits = 2): string =>
  isFinite(n) ? n.toFixed(fractionDigits) : "—";
