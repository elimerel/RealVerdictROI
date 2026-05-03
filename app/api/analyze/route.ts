import { NextRequest, NextResponse } from "next/server"
import { analyseDeal, DEFAULT_INPUTS } from "@/lib/calculations"
import { getCurrentMortgageRate } from "@/lib/rates"
import type { DealInputs } from "@/lib/calculations"
import type { PanelResult, SourceField } from "@/lib/electron"

// ── HUD FMR fetch ──────────────────────────────────────────────────────────────

type HudFmrData = {
  fmr_0: number; fmr_1: number; fmr_2: number; fmr_3: number; fmr_4: number
}

async function fetchHudFmr(zip: string): Promise<number | null> {
  const key = process.env.HUD_API_KEY
  if (!key || !zip) return null

  try {
    const res = await fetch(
      `https://www.huduser.gov/hudapi/public/fmr/byzip/${zip.trim()}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5_000),
      }
    )
    if (!res.ok) return null
    const body = await res.json()

    // HUD returns county-level data; pick 2-bed FMR as the baseline.
    const data: HudFmrData | undefined = body?.data?.basicdata
    if (!data?.fmr_2) return null
    return Math.round(data.fmr_2)
  } catch {
    return null
  }
}

// ── Source-field helper ────────────────────────────────────────────────────────

function sf(
  source: SourceField["source"],
  label: string,
  confidence: SourceField["confidence"],
  extra?: { value?: number; fetchedAt?: string }
): SourceField & { value?: number; fetchedAt?: string } {
  return { source, label, confidence, ...(extra ?? {}) }
}

// ── POST /api/analyze ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 })
  }

  const extraction = (body as { extraction?: unknown }).extraction
  if (!extraction || typeof extraction !== "object") {
    return NextResponse.json({ ok: false, message: "Missing extraction payload" }, { status: 400 })
  }

  const ext = extraction as {
    ok: boolean
    facts?: {
      listPrice?: number | null
      monthlyRent?: number | null
      monthlyHOA?: number | null
      annualPropertyTax?: number | null
      annualInsuranceEst?: number | null
      address?: string | null
      city?: string | null
      state?: string | null
      zip?: string | null
      beds?: number | null
      baths?: number | null
      sqft?: number | null
      yearBuilt?: number | null
      propertyType?: string | null
      siteName?: string | null
      riskFlags?: string[]
    }
    meta?: Record<string, { source?: string; confidence?: string; note?: string } | null>
    take?: string | null
    kind?: string
  }

  if (!ext.ok) {
    return NextResponse.json({ ok: false, message: "Extraction failed" }, { status: 422 })
  }

  const facts = ext.facts ?? {}
  const meta  = ext.meta  ?? {}

  // ── 1. Fetch FRED rate (async, non-blocking) ─────────────────────────────────
  const [fredRate] = await Promise.allSettled([
    getCurrentMortgageRate(),
    // HUD FMR fetch (only when zip is present and rent is missing/low)
  ])

  const fredResult = fredRate.status === "fulfilled" ? fredRate.value : null

  // ── 2. Fetch HUD FMR if rent is missing or low-confidence ────────────────────
  let hudFmr: number | null = null
  const rentMeta = meta.monthlyRent
  const rentMissing = !facts.monthlyRent
  const rentLowConf = rentMeta?.confidence === "low"

  if ((rentMissing || rentLowConf) && facts.zip) {
    hudFmr = await fetchHudFmr(facts.zip)
  }

  // ── 3. Build DealInputs ───────────────────────────────────────────────────────
  const inputs: DealInputs = { ...DEFAULT_INPUTS }

  // User's underwriting defaults (sent from main process from local config).
  // Each field is opt-in — if not provided, fall back to DEFAULT_INPUTS.
  const prefs = (body as { prefs?: {
    downPaymentPct?: number; vacancyPct?: number; managementPct?: number;
    maintenancePct?: number; capexPct?: number; rateAdjustmentBps?: number;
  } }).prefs ?? {}
  if (typeof prefs.downPaymentPct === "number")  inputs.downPaymentPercent       = prefs.downPaymentPct
  if (typeof prefs.vacancyPct      === "number") inputs.vacancyRatePercent       = prefs.vacancyPct
  if (typeof prefs.managementPct   === "number") inputs.propertyManagementPercent = prefs.managementPct
  if (typeof prefs.maintenancePct  === "number") inputs.maintenancePercent       = prefs.maintenancePct
  if (typeof prefs.capexPct        === "number") inputs.capexReservePercent      = prefs.capexPct

  if (facts.listPrice && facts.listPrice > 0)       inputs.purchasePrice    = Math.round(facts.listPrice)
  if (facts.monthlyHOA != null && facts.monthlyHOA >= 0) inputs.monthlyHOA  = Math.round(facts.monthlyHOA)
  if (facts.annualPropertyTax && facts.annualPropertyTax > 0) inputs.annualPropertyTax = Math.round(facts.annualPropertyTax)
  if (facts.annualInsuranceEst && facts.annualInsuranceEst > 0) inputs.annualInsurance = Math.round(facts.annualInsuranceEst)

  // Rent: listing first, HUD FMR as fallback/floor
  if (facts.monthlyRent && facts.monthlyRent > 0) {
    inputs.monthlyRent = Math.round(facts.monthlyRent)
    // If HUD FMR is substantially higher, use it as a floor
    if (hudFmr && hudFmr > facts.monthlyRent * 1.15) {
      inputs.monthlyRent = hudFmr
    }
  } else if (hudFmr) {
    inputs.monthlyRent = hudFmr
  }

  // Mortgage rate: FRED first, then DEFAULT. Apply user's rate adjustment
  // (basis points) as an additive bump for investor-loan premiums.
  if (fredResult?.rate) {
    inputs.loanInterestRate = fredResult.rate
  }
  if (typeof prefs.rateAdjustmentBps === "number" && prefs.rateAdjustmentBps !== 0) {
    inputs.loanInterestRate = inputs.loanInterestRate + prefs.rateAdjustmentBps / 100
  }

  // ── 4. Build provenance ───────────────────────────────────────────────────────
  const rentSource: SourceField["source"] =
    hudFmr && inputs.monthlyRent === hudFmr ? "hud_fmr" :
    facts.monthlyRent ? "listing" : "default"

  const rentConf: SourceField["confidence"] =
    rentSource === "hud_fmr" ? "high" :
    rentSource === "listing" ? (rentMeta?.confidence as SourceField["confidence"] ?? "medium") :
    "low"

  const rateConf: SourceField["confidence"] = fredResult ? "high" : "low"
  const rateSource: SourceField["source"]   = fredResult ? "fred" : "default"
  const rateValue = fredResult?.rate ?? DEFAULT_INPUTS.loanInterestRate

  const taxConf: SourceField["confidence"] =
    facts.annualPropertyTax ? (meta.annualPropertyTax?.confidence as SourceField["confidence"] ?? "high") : "low"
  const taxSource: SourceField["source"]   = facts.annualPropertyTax ? "listing" : "default"

  const insConf: SourceField["confidence"] =
    facts.annualInsuranceEst ? (meta.annualInsuranceEst?.confidence as SourceField["confidence"] ?? "medium") : "low"
  const insSource: SourceField["source"]   = facts.annualInsuranceEst ? "listing" : "default"

  const provenance = {
    listPrice:    sf("listing", "Extracted from listing page", "high"),
    rent:         { ...sf(rentSource, rentSource === "hud_fmr" ? "HUD Fair Market Rent (2-BR)" : rentSource === "listing" ? "Extracted from listing" : "Built-in default", rentConf), value: inputs.monthlyRent },
    interestRate: { ...sf(rateSource, fredResult ? `FRED PMMS 30-yr fixed (${fredResult.asOf})` : "Built-in default rate", rateConf), value: rateValue, fetchedAt: fredResult?.asOf },
    propertyTax:  { ...sf(taxSource, facts.annualPropertyTax ? "Extracted from listing" : "Built-in default", taxConf), value: inputs.annualPropertyTax },
    hoa:          facts.monthlyHOA != null && facts.monthlyHOA > 0
                    ? { ...sf("listing", "Extracted from listing", "high"), value: inputs.monthlyHOA }
                    : null,
    insurance:    { ...sf(insSource, facts.annualInsuranceEst ? "Extracted from listing" : "Built-in default", insConf), value: inputs.annualInsurance },
  }

  // ── 5. Run calculations ────────────────────────────────────────────────────────
  const analysis = analyseDeal(inputs)

  // ── 6. Build PanelResult ───────────────────────────────────────────────────────
  const result: PanelResult = {
    ok: true,
    address:       facts.address  ?? null,
    city:          facts.city     ?? null,
    state:         facts.state    ?? null,
    zip:           facts.zip      ?? null,
    listPrice:     facts.listPrice ?? null,
    beds:          facts.beds     ?? null,
    baths:         facts.baths    ?? null,
    sqft:          facts.sqft     ?? null,
    yearBuilt:     facts.yearBuilt ?? null,
    propertyType:  facts.propertyType ?? null,
    siteName:      facts.siteName ?? null,
    take:          ext.take ?? null,
    riskFlags:     facts.riskFlags ?? [],
    inputs: {
      purchasePrice:     inputs.purchasePrice,
      monthlyRent:       inputs.monthlyRent,
      downPaymentPct:    inputs.downPaymentPercent,
      interestRate:      inputs.loanInterestRate,
      loanTermYears:     inputs.loanTermYears,
      annualPropertyTax: inputs.annualPropertyTax,
      monthlyHOA:        inputs.monthlyHOA,
      annualInsurance:   inputs.annualInsurance,
      vacancyPct:        inputs.vacancyRatePercent,
      managementPct:     inputs.propertyManagementPercent,
      maintenancePct:    inputs.maintenancePercent,
      capexPct:          inputs.capexReservePercent,
    },
    metrics: {
      monthlyMortgage:     Math.round(analysis.monthlyMortgagePayment),
      noi:                 Math.round(analysis.annualNOI),
      monthlyCashFlow:     Math.round(analysis.monthlyCashFlow),
      capRate:             analysis.capRate,
      cashOnCash:          analysis.cashOnCashReturn,
      dscr:                analysis.dscr,
      grm:                 analysis.grossRentMultiplier,
      breakEvenOccupancy:  analysis.breakEvenOccupancy,
      totalCashInvested:   Math.round(analysis.totalCashInvested),
      verdictTier:         analysis.verdict.tier,
      verdictScore:        analysis.verdict.score,
    },
    provenance,
  }

  return NextResponse.json(result)
}
