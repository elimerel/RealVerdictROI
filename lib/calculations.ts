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

export type Verdict = {
  tier: VerdictTier;
  score: number; // 0–100
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
    onePercentRule,
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
  onePercentRule: number;
  breakEvenOccupancy: number;
  operatingExpenseRatio: number;
};

function renderVerdict(m: VerdictMetrics): Verdict {
  // Each signal contributes up to ~15 points. Total is clamped to 0–100.
  const signals: Array<{ points: number; strength?: string; risk?: string }> = [];

  // Cash-on-cash (target ≥ 8%)
  if (m.cashOnCashReturn >= 0.12)
    signals.push({
      points: 18,
      strength: `Strong ${(m.cashOnCashReturn * 100).toFixed(1)}% cash-on-cash return`,
    });
  else if (m.cashOnCashReturn >= 0.08)
    signals.push({
      points: 14,
      strength: `Healthy ${(m.cashOnCashReturn * 100).toFixed(1)}% cash-on-cash return`,
    });
  else if (m.cashOnCashReturn >= 0.05)
    signals.push({
      points: 8,
      risk: `Cash-on-cash only ${(m.cashOnCashReturn * 100).toFixed(1)}% — below the 8% comfort zone`,
    });
  else if (m.cashOnCashReturn >= 0)
    signals.push({
      points: 3,
      risk: `Thin cash-on-cash (${(m.cashOnCashReturn * 100).toFixed(1)}%) leaves little margin for error`,
    });
  else
    signals.push({
      points: -10,
      risk: `Negative cash-on-cash (${(m.cashOnCashReturn * 100).toFixed(1)}%) — you pay to own this`,
    });

  // Cap rate (target 6%+ for most US markets)
  if (m.capRate >= 0.08)
    signals.push({
      points: 15,
      strength: `High cap rate of ${(m.capRate * 100).toFixed(1)}%`,
    });
  else if (m.capRate >= 0.06)
    signals.push({
      points: 11,
      strength: `Solid cap rate of ${(m.capRate * 100).toFixed(1)}%`,
    });
  else if (m.capRate >= 0.045)
    signals.push({ points: 6 });
  else
    signals.push({
      points: 0,
      risk: `Low cap rate (${(m.capRate * 100).toFixed(1)}%) — betting on appreciation, not income`,
    });

  // DSCR (lender target ≥ 1.25)
  if (!isFinite(m.dscr))
    signals.push({ points: 12, strength: "No debt — every dollar of NOI is yours" });
  else if (m.dscr >= 1.5)
    signals.push({
      points: 15,
      strength: `Very safe ${m.dscr.toFixed(2)} DSCR`,
    });
  else if (m.dscr >= 1.25)
    signals.push({
      points: 11,
      strength: `Comfortable ${m.dscr.toFixed(2)} DSCR`,
    });
  else if (m.dscr >= 1.0)
    signals.push({
      points: 4,
      risk: `Tight ${m.dscr.toFixed(2)} DSCR — one bad month and you're underwater`,
    });
  else
    signals.push({
      points: -8,
      risk: `DSCR below 1.0 (${m.dscr.toFixed(2)}) — NOI does not cover the mortgage`,
    });

  // IRR over hold period
  if (isFinite(m.irr)) {
    if (m.irr >= 0.15)
      signals.push({
        points: 18,
        strength: `Excellent projected IRR of ${(m.irr * 100).toFixed(1)}%`,
      });
    else if (m.irr >= 0.1)
      signals.push({
        points: 12,
        strength: `Strong projected IRR of ${(m.irr * 100).toFixed(1)}%`,
      });
    else if (m.irr >= 0.06)
      signals.push({ points: 6 });
    else if (m.irr >= 0)
      signals.push({
        points: 1,
        risk: `Low IRR (${(m.irr * 100).toFixed(1)}%) — you can likely do better with an index fund`,
      });
    else
      signals.push({
        points: -8,
        risk: `Negative IRR (${(m.irr * 100).toFixed(1)}%) — projected to lose money`,
      });
  }

  // Break-even occupancy (target < 85%)
  if (m.breakEvenOccupancy > 0 && m.breakEvenOccupancy < 0.8)
    signals.push({
      points: 10,
      strength: `Low break-even occupancy of ${(m.breakEvenOccupancy * 100).toFixed(0)}%`,
    });
  else if (m.breakEvenOccupancy >= 0.95)
    signals.push({
      points: 0,
      risk: `Break-even occupancy is ${(m.breakEvenOccupancy * 100).toFixed(0)}% — almost no vacancy tolerance`,
    });
  else if (m.breakEvenOccupancy >= 0.85)
    signals.push({ points: 4 });

  // 1% rule (monthly rent ≥ 1% of price)
  if (m.onePercentRule >= 0.01)
    signals.push({
      points: 7,
      strength: "Passes the 1% rule",
    });
  else if (m.onePercentRule >= 0.007)
    signals.push({ points: 3 });
  else
    signals.push({
      points: 0,
      risk: `Rent is only ${(m.onePercentRule * 100).toFixed(2)}% of price — well below the 1% rule`,
    });

  // Total hold-period ROI
  if (m.totalROI >= 1.5)
    signals.push({
      points: 10,
      strength: `Projected total ROI of ${(m.totalROI * 100).toFixed(0)}% over the hold period`,
    });
  else if (m.totalROI >= 0.5)
    signals.push({ points: 5 });
  else if (m.totalROI < 0)
    signals.push({
      points: -5,
      risk: `Projected total ROI is negative (${(m.totalROI * 100).toFixed(0)}%)`,
    });

  const score = Math.max(
    0,
    Math.min(100, signals.reduce((s, sig) => s + sig.points, 0)),
  );

  const strengths = signals
    .filter((s) => s.strength)
    .map((s) => s.strength as string);
  const risks = signals.filter((s) => s.risk).map((s) => s.risk as string);

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

  return { tier, score, headline, summary, strengths, risks };
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
