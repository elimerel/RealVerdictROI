// Real Estate Investment Dashboard Types

export type DealGrade = "A" | "B" | "C" | "D" | "F"

export type VerdictTier =
  | "STRONG BUY"
  | "GOOD DEAL"
  | "BORDERLINE"
  | "PASS"
  | "AVOID"

export type ProvenanceSource =
  | "zillow-listing"       // scraped from a Zillow listing page
  | "rentcast"             // pulled from RentCast property / AVM data
  | "rent-comps"           // median of nearby long-term rent comps
  | "fred"                 // FRED macro series (e.g. Freddie Mac PMMS 30yr fixed)
  | "fhfa-hpi"             // FHFA Purchase-Only HPI metro-level trailing CAGR
  | "fema-nfhl"            // FEMA National Flood Hazard Layer
  | "state-average"        // computed from per-state rate tables
  | "state-investor-rate"  // per-state non-homestead tax rate
  | "national-average"     // last-resort national fallback
  | "default"              // canonical default from DEFAULT_INPUTS
  | "user"                 // user has overridden this value

export type ConfidenceLevel = "high" | "medium" | "low"

export interface FieldProvenance {
  source: ProvenanceSource
  confidence: ConfidenceLevel
  /**
   * Human-readable explanation shown as a tooltip or note in the UI.
   * The `tooltip` alias is kept for backward-compatibility; prefer `note`.
   */
  note?: string
  /** @deprecated use note */
  tooltip?: string
}

export interface FloodZone {
  zone: string
  risk: string
  label: string
  isCoastalHigh: boolean
}

export interface PropertyFacts {
  beds: number
  baths: number
  sqft: number
  yearBuilt: number
  propertyType: string
  lastSalePrice?: number
  lastSaleDate?: string
  floodZone?: FloodZone
  address: string
  city: string
  state: string
  zip: string
  imageUrl?: string
}

export interface UserInputs {
  purchase: {
    purchasePrice: number
    downPaymentPercent: number
    closingCostsPercent: number
    rehabCosts: number
  }
  financing: {
    loanInterestRate: number
    loanTermYears: number
  }
  income: {
    monthlyRent: number
    otherMonthlyIncome: number
    vacancyRatePercent: number
  }
  operatingExpenses: {
    annualPropertyTax: number
    annualInsurance: number
    monthlyHOA: number
    monthlyUtilities: number
    maintenancePercent: number
    propertyManagementPercent: number
    capexReservePercent: number
  }
  growthAndExit: {
    annualAppreciationPercent: number
    annualRentGrowthPercent: number
    annualExpenseGrowthPercent: number
    sellingCostsPercent: number
    holdPeriodYears: number
  }
}

export interface UpfrontCosts {
  loanAmount: number
  downPayment: number
  closingCosts: number
  totalCashInvested: number
}

export interface MonthlySnapshot {
  monthlyMortgagePayment: number
  monthlyGrossRent: number
  monthlyEffectiveIncome: number
  monthlyOperatingExpenses: number
  monthlyCashFlow: number
  monthlyNOI: number
}

export interface AnnualSummary {
  annualGrossIncome: number
  annualEffectiveIncome: number
  annualOperatingExpenses: number
  annualNOI: number
  annualDebtService: number
  annualCashFlow: number
}

export interface KeyRatios {
  capRate: number
  cashOnCashReturn: number
  dscr: number
  irr: number
  grossRentMultiplier: number
  onePercentRule: number
  operatingExpenseRatio: number
  breakEvenOccupancy: number
}

export interface ExitAnalysis {
  salePrice: number
  sellingCosts: number
  loanBalanceAtExit: number
  netSaleProceeds: number
  totalCashFlow: number
  totalPrincipalPaydown: number
  totalAppreciation: number
  totalProfit: number
  totalROI: number
  averageAnnualReturn: number
}

export interface YearProjection {
  year: number
  grossRent: number
  effectiveGrossIncome: number
  operatingExpenses: number
  noi: number
  debtService: number
  cashFlow: number
  principalPaid: number
  interestPaid: number
  loanBalanceEnd: number
  propertyValueEnd: number
  equityEnd: number
  cumulativeCashFlow: number
}

export interface CalculatedOutputs {
  upfront: UpfrontCosts
  monthly: MonthlySnapshot
  annual: AnnualSummary
  ratios: KeyRatios
  exit: ExitAnalysis
  projections: YearProjection[]
}

export interface RubricScore {
  name: string
  score: number
  maxPoints: number
  status: "win" | "ok" | "warn" | "fail"
}

export interface VerdictResult {
  tier: VerdictTier
  score: number
  rubric: RubricScore[]
  summary: string
}

export interface Lead {
  id: string
  propertyFacts: PropertyFacts
  inputs: UserInputs
  outputs: CalculatedOutputs
  verdict: VerdictResult
  grade: DealGrade
  provenance: Record<string, FieldProvenance>
  createdAt: Date
  cashFlowTrend: number[]
}
