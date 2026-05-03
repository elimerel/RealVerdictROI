// ── Scenario overrides + live recompute
// ──────────────────────────────────────────────────────────────────────────
//
// The user can model "what if I offered $440k instead of list?" / "what if
// I put 30% down?" against any analyzed listing without re-running the
// AI extraction. This module is the bridge: it merges the user's overrides
// onto the original AnalysisInputs, runs the calculation engine in the
// renderer (it's pure JS), and projects the result back to the panel's
// DealMetrics shape so the existing metric cards render unchanged.
//
// Phase 1 of the scenario feature (see plan): in-memory only, used by the
// Panel. Phase 4 will add Supabase persistence, reusing the same overrides
// type as the on-disk schema.

import {
  analyseDeal,
  DEFAULT_INPUTS,
  type DealAnalysis,
  type DealInputs,
} from "@/lib/calculations"
import type { AnalysisInputs, DealMetrics } from "@/lib/electron"

/** The user-editable subset of analysis inputs. Mirrors AnalysisInputs but
 *  keyed in the units the editor exposes — percent fields are 0-100 (UI)
 *  while AnalysisInputs uses 0-1 (storage). The applyOverrides function
 *  handles the conversion. */
export interface ScenarioOverrides {
  /** "Your offer" — the price you'd actually pay, vs. the list price. */
  purchasePrice?:    number
  /** 0-100 (e.g. 25 means 25%). */
  downPaymentPct?:   number
  /** Annual %, e.g. 6.30. */
  interestRate?:     number
  monthlyRent?:      number
  /** 0-100 (e.g. 5 means 5%). */
  vacancyPct?:       number

  // Advanced
  loanTermYears?:    number
  annualPropertyTax?: number
  annualInsurance?:  number
  monthlyHOA?:       number
  /** 0-100 */
  managementPct?:    number
  /** 0-100 */
  maintenancePct?:   number
  /** 0-100 */
  capexPct?:         number
}

/** True when the user has set at least one override. Used by the panel to
 *  decide whether to show the "Your scenario" chip and re-render metrics
 *  through recomputeMetrics(). Empty overrides → render the original snapshot. */
export function hasActiveScenario(o: ScenarioOverrides | null | undefined): boolean {
  if (!o) return false
  for (const v of Object.values(o)) {
    if (v != null && Number.isFinite(v)) return true
  }
  return false
}

/** Turn the panel's AnalysisInputs (the original analysis) into the
 *  calculation engine's DealInputs shape, applying any user overrides on
 *  top. Field renames + unit conversions live here so the rest of the
 *  panel doesn't have to think about them. */
export function applyOverrides(
  base:      AnalysisInputs,
  overrides: ScenarioOverrides,
): DealInputs {
  // Helper: read overrides[key] when set + finite, else fall back to base.
  const o = (key: keyof ScenarioOverrides, fallback: number): number => {
    const v = overrides[key]
    return v != null && Number.isFinite(v) ? (v as number) : fallback
  }

  return {
    // Purchase
    purchasePrice:               o("purchasePrice", base.purchasePrice),
    // AnalysisInputs uses 0-1; ScenarioOverrides + DealInputs use 0-100.
    downPaymentPercent:          o("downPaymentPct",   base.downPaymentPct * 100),
    closingCostsPercent:         DEFAULT_INPUTS.closingCostsPercent,
    rehabCosts:                  DEFAULT_INPUTS.rehabCosts,

    // Financing
    loanInterestRate:            o("interestRate",     base.interestRate),
    loanTermYears:               o("loanTermYears",    base.loanTermYears),

    // Income
    monthlyRent:                 o("monthlyRent",      base.monthlyRent),
    otherMonthlyIncome:          DEFAULT_INPUTS.otherMonthlyIncome,
    vacancyRatePercent:          o("vacancyPct",       base.vacancyPct * 100),

    // Fixed operating expenses
    annualPropertyTax:           o("annualPropertyTax", base.annualPropertyTax),
    annualInsurance:             o("annualInsurance",  base.annualInsurance),
    monthlyHOA:                  o("monthlyHOA",       base.monthlyHOA),
    monthlyUtilities:            DEFAULT_INPUTS.monthlyUtilities,

    // Variable operating expenses
    maintenancePercent:          o("maintenancePct",   base.maintenancePct   * 100),
    propertyManagementPercent:   o("managementPct",    base.managementPct    * 100),
    capexReservePercent:         o("capexPct",         base.capexPct         * 100),

    // Growth + exit (not user-editable in the MVP scenario form; defaults).
    annualAppreciationPercent:   DEFAULT_INPUTS.annualAppreciationPercent,
    annualRentGrowthPercent:     DEFAULT_INPUTS.annualRentGrowthPercent,
    annualExpenseGrowthPercent:  DEFAULT_INPUTS.annualExpenseGrowthPercent,
    sellingCostsPercent:         DEFAULT_INPUTS.sellingCostsPercent,
    holdPeriodYears:             DEFAULT_INPUTS.holdPeriodYears,
  }
}

/** Project a DealAnalysis back to the panel's DealMetrics shape. The
 *  panel was built against this contract long before scenarios existed;
 *  keeping it stable means no MetricCard / panel JSX needs to change. */
export function toDealMetrics(a: DealAnalysis): DealMetrics {
  return {
    monthlyMortgage:    a.monthlyMortgagePayment,
    noi:                a.annualNOI,
    monthlyCashFlow:    a.monthlyCashFlow,
    capRate:            a.capRate,
    cashOnCash:         a.cashOnCashReturn,
    dscr:               a.dscr,
    grm:                a.grossRentMultiplier,
    breakEvenOccupancy: a.breakEvenOccupancy,
    totalCashInvested:  a.totalCashInvested,
    verdictTier:        a.verdict.tier,
    verdictScore:       a.verdict.score,
  }
}

/** One-shot: take the original analysis inputs + the user's overrides,
 *  return the recomputed metrics. Sub-millisecond; safe to call on every
 *  keystroke as the user edits the scenario editor. */
export function recomputeMetrics(
  base:      AnalysisInputs,
  overrides: ScenarioOverrides,
): DealMetrics {
  const dealInputs = applyOverrides(base, overrides)
  const analysis   = analyseDeal(dealInputs)
  return toDealMetrics(analysis)
}
