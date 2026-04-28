import {
  analyseDeal,
  sanitiseInputs,
  type DealAnalysis,
  type DealInputs,
} from "@/lib/calculations";
import type {
  Lead,
  DealGrade,
  VerdictTier as V0VerdictTier,
} from "@/lib/types";

export type AiNarrative = {
  summary: string;      // 1 sentence — the verdict in plain English
  opportunity: string;  // 1-2 sentences — what works in this deal's favor
  risk: string;         // 1-2 sentences — what could break it
  generatedAt: string;  // ISO timestamp
};

export type DealRow = {
  id: string;
  created_at: string;
  address: string | null;
  inputs: DealInputs;
  results: DealAnalysis;
  verdict: string;
  property_facts?: {
    beds?: number | null;
    baths?: number | null;
    sqft?: number | null;
    yearBuilt?: number | null;
    propertyType?: string | null;
  } | null;
  ai_narrative?: AiNarrative | null;
};

// ---------------------------------------------------------------------------
// Our VerdictTier → v0 grade + tier
// ---------------------------------------------------------------------------

function tierToGrade(tier: string): DealGrade {
  switch (tier) {
    case "excellent": return "A";
    case "good":      return "B";
    case "fair":      return "C";
    case "poor":      return "D";
    default:          return "F"; // avoid
  }
}

function tierToV0Tier(tier: string): V0VerdictTier {
  switch (tier) {
    case "excellent": return "STRONG BUY";
    case "good":      return "GOOD DEAL";
    case "fair":      return "BORDERLINE";
    case "poor":      return "PASS";
    default:          return "AVOID";
  }
}

// ---------------------------------------------------------------------------
// Address parser — "4521 Magnolia Dr, Austin, TX 78745" → parts
// ---------------------------------------------------------------------------

function parseAddress(full: string | null) {
  if (!full) return { address: "Unknown", city: "", state: "", zip: "" };
  const parts = full.split(",").map((s) => s.trim());
  const address = parts[0] ?? full;
  const city    = parts[1] ?? "";
  const stateZip = parts[2] ?? "";
  const [state = "", zip = ""] = stateZip.trim().split(/\s+/);
  return { address, city, state, zip };
}

// ---------------------------------------------------------------------------
// Main adapter
// ---------------------------------------------------------------------------

export function dealRowToLead(row: DealRow): Lead {
  const inputs = row.inputs;

  // Re-derive analysis so the numbers are always fresh, fall back to stored
  // results if the inputs somehow fail sanitisation.
  let analysis: DealAnalysis;
  try {
    analysis = analyseDeal(sanitiseInputs(inputs));
  } catch {
    analysis = row.results;
  }

  const loc = parseAddress(row.address);
  const tier = row.verdict ?? "fair";

  // Cash-flow trend: 12 months of projected monthly cash flow from year-by-year
  // projections. Uses the first 12 projection entries (1 per year) as a proxy
  // for the trend shape the sparkline needs.
  const cashFlowTrend = (analysis.projection ?? [])
    .slice(0, 12)
    .map((y) => Math.round(y.cashFlow / 12));

  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    cashFlowTrend: cashFlowTrend.length > 0 ? cashFlowTrend : [analysis.monthlyCashFlow],

    propertyFacts: {
      address: loc.address,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      beds: row.property_facts?.beds ?? 0,
      baths: row.property_facts?.baths ?? 0,
      sqft: row.property_facts?.sqft ?? 0,
      yearBuilt: row.property_facts?.yearBuilt ?? 0,
      propertyType: row.property_facts?.propertyType ?? "Rental Property",
    },

    inputs: {
      purchase: {
        purchasePrice:      inputs.purchasePrice,
        downPaymentPercent: inputs.downPaymentPercent,
        closingCostsPercent: inputs.closingCostsPercent,
        rehabCosts:         inputs.rehabCosts,
      },
      financing: {
        loanInterestRate: inputs.loanInterestRate,
        loanTermYears:    inputs.loanTermYears,
      },
      income: {
        monthlyRent:         inputs.monthlyRent,
        otherMonthlyIncome:  inputs.otherMonthlyIncome,
        vacancyRatePercent:  inputs.vacancyRatePercent,
      },
      operatingExpenses: {
        annualPropertyTax:          inputs.annualPropertyTax,
        annualInsurance:            inputs.annualInsurance,
        monthlyHOA:                 inputs.monthlyHOA,
        monthlyUtilities:           inputs.monthlyUtilities,
        maintenancePercent:         inputs.maintenancePercent,
        propertyManagementPercent:  inputs.propertyManagementPercent,
        capexReservePercent:        inputs.capexReservePercent,
      },
      growthAndExit: {
        annualAppreciationPercent:  inputs.annualAppreciationPercent,
        annualRentGrowthPercent:    inputs.annualRentGrowthPercent,
        annualExpenseGrowthPercent: inputs.annualExpenseGrowthPercent,
        sellingCostsPercent:        inputs.sellingCostsPercent,
        holdPeriodYears:            inputs.holdPeriodYears,
      },
    },

    outputs: {
      upfront: {
        loanAmount:        analysis.loanAmount,
        downPayment:       analysis.downPayment,
        closingCosts:      analysis.closingCosts,
        totalCashInvested: analysis.totalCashInvested,
      },
      monthly: {
        monthlyMortgagePayment:    analysis.monthlyMortgagePayment,
        monthlyGrossRent:          analysis.monthlyGrossRent,
        monthlyEffectiveIncome:    analysis.monthlyEffectiveIncome,
        monthlyOperatingExpenses:  analysis.monthlyOperatingExpenses,
        monthlyCashFlow:           analysis.monthlyCashFlow,
        monthlyNOI:                analysis.monthlyNOI,
      },
      annual: {
        annualGrossIncome:        analysis.annualGrossIncome,
        annualEffectiveIncome:    analysis.annualEffectiveIncome,
        annualOperatingExpenses:  analysis.annualOperatingExpenses,
        annualNOI:                analysis.annualNOI,
        annualDebtService:        analysis.annualDebtService,
        annualCashFlow:           analysis.annualCashFlow,
      },
      // v0 expects percentages (4.13 not 0.0413) for cap/CoC/IRR/ROI/onePercent
      ratios: {
        capRate:               analysis.capRate * 100,
        cashOnCashReturn:      analysis.cashOnCashReturn * 100,
        dscr:                  isFinite(analysis.dscr) ? analysis.dscr : 999,
        irr:                   isFinite(analysis.irr) ? analysis.irr * 100 : 0,
        grossRentMultiplier:   analysis.grossRentMultiplier,
        onePercentRule:        analysis.onePercentRule * 100,
        operatingExpenseRatio: analysis.operatingExpenseRatio, // decimal
        breakEvenOccupancy:    analysis.breakEvenOccupancy,    // decimal
      },
      exit: {
        salePrice:            analysis.salePrice,
        sellingCosts:         analysis.sellingCosts,
        loanBalanceAtExit:    analysis.loanBalanceAtExit,
        netSaleProceeds:      analysis.netSaleProceeds,
        totalCashFlow:        analysis.totalCashFlow,
        totalPrincipalPaydown: analysis.totalPrincipalPaydown,
        totalAppreciation:    analysis.totalAppreciation,
        totalProfit:          analysis.totalProfit,
        totalROI:             analysis.totalROI * 100,
        averageAnnualReturn:  analysis.averageAnnualReturn * 100,
      },
      projections: analysis.projection,
    },

    verdict: {
      tier:    tierToV0Tier(tier),
      score:   analysis.verdict.score,
      summary: analysis.verdict.summary,
      rubric:  analysis.verdict.breakdown.map((b) => ({
        name:      b.category,
        score:     b.points,
        maxPoints: b.maxPoints,
        status:    b.status,
      })),
    },

    grade: tierToGrade(tier),
    provenance: {},
  };
}
