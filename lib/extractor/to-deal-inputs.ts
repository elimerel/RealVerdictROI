// ---------------------------------------------------------------------------
// Stage 3 → Stage 4 bridge
// ---------------------------------------------------------------------------
//
// The extractor returns ListingFacts (what the AI saw on the page).
// The underwriting engine consumes DealInputs (what the math needs).
// This bridge cleanly converts one to the other, filling sane defaults
// for assumptions the listing can't tell us (downpayment %, interest
// rate, vacancy, expense ratios, growth assumptions, hold period).
//
// Numbers that come from the listing are provenance:"listing", numbers
// from this default set are provenance:"inferred" — the panel can show
// the user which is which.
// ---------------------------------------------------------------------------

import type { DealInputs } from "@/lib/calculations"
import { DEFAULT_INPUTS } from "@/lib/calculations"
import type { ListingFacts, FactsMeta, FieldMeta } from "./types"

/** Per-DealInputs-field provenance, mirrors FactsMeta but keyed by the
 *  underwriting input names so the panel can show source attribution
 *  for every number on screen. */
export type InputsProvenance = Partial<Record<keyof DealInputs, FieldMeta>>

export type BridgeResult = {
  inputs: DealInputs
  provenance: InputsProvenance
}

export function factsToDealInputs(facts: ListingFacts, meta: FactsMeta): BridgeResult {
  const inputs: DealInputs = { ...DEFAULT_INPUTS }
  const prov: InputsProvenance = {}

  // Direct mappings — the listing told us, we use it as-is.
  if (facts.listPrice && facts.listPrice > 0) {
    inputs.purchasePrice = Math.round(facts.listPrice)
    prov.purchasePrice = meta.listPrice ?? { source: "listing", confidence: "high" }
  }

  if (facts.monthlyRent && facts.monthlyRent > 0) {
    inputs.monthlyRent = Math.round(facts.monthlyRent)
    prov.monthlyRent = meta.monthlyRent ?? {
      source: "listing", confidence: "medium",
      note: "Rental estimate from listing — verify against local comps before offering.",
    }
  }

  if (facts.monthlyHOA && facts.monthlyHOA > 0) {
    inputs.monthlyHOA = Math.round(facts.monthlyHOA)
    prov.monthlyHOA = meta.monthlyHOA ?? { source: "listing", confidence: "high" }
  }

  if (facts.annualPropertyTax && facts.annualPropertyTax > 0) {
    inputs.annualPropertyTax = Math.round(facts.annualPropertyTax)
    prov.annualPropertyTax = meta.annualPropertyTax ?? { source: "listing", confidence: "high" }
  }

  if (facts.annualInsuranceEst && facts.annualInsuranceEst > 0) {
    inputs.annualInsurance = Math.round(facts.annualInsuranceEst)
    prov.annualInsurance = meta.annualInsuranceEst ?? {
      source: "listing", confidence: "medium",
      note: "Listing-side insurance estimate — your actual quote may differ.",
    }
  }

  // Mark the defaulted assumptions so the user knows they're editable.
  prov.downPaymentPercent       = { source: "inferred", confidence: "low",  note: "Default 25% — adjust to your actual." }
  prov.loanInterestRate         = { source: "inferred", confidence: "low",  note: "Default 7.25% — pull your real rate from a lender." }
  prov.loanTermYears            = { source: "inferred", confidence: "low",  note: "Default 30-year amortization." }
  prov.closingCostsPercent      = { source: "inferred", confidence: "low" }
  prov.vacancyRatePercent       = { source: "inferred", confidence: "low" }
  prov.maintenancePercent       = { source: "inferred", confidence: "low" }
  prov.propertyManagementPercent= { source: "inferred", confidence: "low" }
  prov.capexReservePercent      = { source: "inferred", confidence: "low" }
  prov.annualAppreciationPercent= { source: "inferred", confidence: "low" }
  prov.annualRentGrowthPercent  = { source: "inferred", confidence: "low" }
  prov.annualExpenseGrowthPercent = { source: "inferred", confidence: "low" }
  prov.holdPeriodYears          = { source: "inferred", confidence: "low" }
  prov.sellingCostsPercent      = { source: "inferred", confidence: "low" }

  // Insurance only carries a default when we didn't get one from the listing.
  if (!facts.annualInsuranceEst) {
    prov.annualInsurance = { source: "inferred", confidence: "low", note: "Estimated — pull a real quote." }
  }

  // If we didn't get rent from the listing, flag it so the panel asks the
  // user to enter their own.
  if (!facts.monthlyRent) {
    prov.monthlyRent = { source: "inferred", confidence: "low", note: "No rental estimate on the listing — enter your own." }
  }

  return { inputs, provenance: prov }
}
