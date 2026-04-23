// ---------------------------------------------------------------------------
// Negotiation Pack — pure data layer (§20.3)
//
// Takes a fully-derived deal (inputs + DealAnalysis + ComparablesAnalysis +
// resolver warnings/provenance) and returns a PackPayload: the structured
// "forward this to your agent" artifact. Both the public web view at
// /pack/[shareToken] and the PDF export render off the same payload — so
// every Pack number is reproducible from the same source of truth as the
// /results page.
//
// What the Pack contains (per HANDOFF §11; original spec in HANDOFF_ARCHIVE §20.3):
//   1. Headline — walk-away price, list price, delta, one-sentence framing.
//   2. Three weakest assumptions in the seller's pro forma — sourced from
//      the resolver warnings (homestead-trap, low-confidence insurance) +
//      live comp deltas (rent, value).
//   3. Comp evidence — top 3 sale + 3 rent comps with one-line "why this
//      one" sourced from each comp's matchReasons.
//   4. Stress scenarios — the four shocks that meaningfully break the
//      seller's pro forma, each with the resulting CF/DSCR/verdict and
//      whether it flips the verdict tier from the base.
//   5. Counteroffer script — 2–3 paragraphs of plain English the investor
//      can literally forward to their agent, with the walk-away number
//      anchored inline.
//
// This module is PURE: no I/O, no DOM, no Supabase. The route layer is
// responsible for persistence and auth. That separation lets the unit
// tests stay fast and lets the PDF export reuse the same payload without
// re-deriving anything.
// ---------------------------------------------------------------------------

import {
  toAnalyseRentEvidence,
  type ComparablesAnalysis,
  type ScoredComp,
} from "@/lib/comparables";
import {
  analyseDeal,
  findOfferCeiling,
  formatCurrency,
  formatPercent,
  sanitiseInputs,
  type DealAnalysis,
  type DealInputs,
  type VerdictTier,
} from "@/lib/calculations";
import type { FieldProvenance } from "@/app/api/property-resolve/route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WeakAssumption = {
  /** Short label, e.g. "Property tax", "Monthly rent". */
  field: string;
  /** What the seller's pro forma / listing implies. */
  current: string;
  /** What the realistic investor number is, with reasoning. */
  realistic: string;
  /** The dollar / percent gap between the two, formatted for display. */
  gap: string;
  /** One-sentence explanation an agent can read aloud. */
  reason: string;
  /** Internal sort key — drives which three make the cut. */
  severity: "high" | "medium" | "low";
};

export type CompEvidence = {
  address: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  /** For sale: sale price. For rent: monthly rent. */
  price?: number;
  pricePerSqft?: number;
  distanceMiles?: number;
  daysOnMarket?: number;
  /** "Same ZIP, 3bd/2ba, sold 47 days ago at $185/sqft." */
  why: string;
};

export type StressOutcome = {
  /** "Rent drops 10%", "Refi rate +1pt", etc. */
  label: string;
  /** Plain-English description of what the shock represents. */
  description: string;
  monthlyCashFlowAfter: number;
  monthlyCashFlowDelta: number;
  dscrAfter: number;
  capRateAfter: number;
  verdictAfter: VerdictTier;
  /** True iff the verdict tier changed from the base case. */
  flippedFromBase: boolean;
  /** "Cash flow drops to −$200/mo, DSCR falls to 0.95 (PASS → AVOID)." */
  oneLine: string;
};

export type CounterofferScript = {
  walkAwayPrice: number | null;
  listPrice: number;
  /** Pre-rendered paragraphs in plain English. The web view and PDF both
   *  render these as-is — no client-side templating. */
  paragraphs: string[];
};

export type PackPayload = {
  /** ISO timestamp of when this Pack was generated. */
  generatedAt: string;
  address: string;
  headline: {
    walkAwayPrice: number | null;
    walkAwayTier: VerdictTier | null;
    /** Discount required to hit walk-away, as a percent of list. */
    walkAwayDiscountPercent: number | null;
    listPrice: number;
    deltaDollars: number | null;
    deltaPercent: number | null;
    framing: string;
    tier: VerdictTier;
  };
  weakAssumptions: WeakAssumption[];
  compEvidence: {
    sale: CompEvidence[];
    rent: CompEvidence[];
  };
  stressScenarios: StressOutcome[];
  counteroffer: CounterofferScript;
  /** Snapshot of the headline metrics as they appeared at generation. */
  snapshot: {
    purchasePrice: number;
    monthlyRent: number;
    monthlyCashFlow: number;
    capRate: number;
    dscr: number;
    irr: number;
    /** Combined confidence inherited from the comparables derivation. */
    compsConfidence: "high" | "medium" | "low";
  };
};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "STRONG BUY",
  good: "GOOD DEAL",
  fair: "BORDERLINE",
  poor: "PASS",
  avoid: "AVOID",
};

export type BuildPackArgs = {
  address: string;
  inputs: DealInputs;
  analysis: DealAnalysis;
  comparables: ComparablesAnalysis;
  /** Resolver warnings — drives detection of homestead-trap, low-confidence
   *  insurance, etc. when scoring the "three weakest assumptions". */
  warnings?: string[];
  /** Per-field provenance from the resolver — used to identify which
   *  inputs are best-guess defaults vs grounded in real data. */
  provenance?: Partial<Record<keyof DealInputs, FieldProvenance>>;
};

export function buildPack(args: BuildPackArgs): PackPayload {
  const { address, inputs, analysis, comparables } = args;
  const warnings = args.warnings ?? [];
  const provenance = args.provenance ?? {};

  // Market-value anchor: cap the walk-away ceiling by comp-derived fair value
  // (or list price as a weaker fallback). Prevents the Pack from ever
  // suggesting a walk-away price 5-10× market value on rent-heavy listings —
  // which is the bug that destroys Pack credibility in a negotiation.
  const marketValueAnchor =
    comparables.marketValue?.value ??
    (inputs.purchasePrice > 0 ? inputs.purchasePrice : undefined);
  const ceiling = findOfferCeiling(inputs, {
    marketValueCap: marketValueAnchor,
    marketValueCapSource: comparables.marketValue?.value ? "comps" : "list",
    analyseDealOptions: toAnalyseRentEvidence(comparables),
  });
  const headline = buildHeadline(inputs, analysis, ceiling);
  const weakAssumptions = pickWeakAssumptions({
    inputs,
    analysis,
    comparables,
    warnings,
    provenance,
  });
  const compEvidence = {
    sale: pickCompEvidence(comparables.marketValue?.compsUsed ?? [], "sale"),
    rent: pickCompEvidence(comparables.marketRent?.compsUsed ?? [], "rent"),
  };
  const stressScenarios = runStressScenarios(inputs, analysis);
  const counteroffer = buildCounteroffer({
    address,
    listPrice: inputs.purchasePrice,
    walkAwayPrice: ceiling.primaryTarget?.price ?? null,
    walkAwayTier: ceiling.primaryTarget?.tier ?? null,
    weakAssumptions,
    analysis,
  });

  const compsConfidence = combineCompsConfidence(
    comparables.marketValue?.confidence,
    comparables.marketRent?.confidence,
  );

  return {
    generatedAt: new Date().toISOString(),
    address,
    headline,
    weakAssumptions,
    compEvidence,
    stressScenarios,
    counteroffer,
    snapshot: {
      purchasePrice: inputs.purchasePrice,
      monthlyRent: inputs.monthlyRent,
      monthlyCashFlow: analysis.monthlyCashFlow,
      capRate: analysis.capRate,
      dscr: analysis.dscr,
      irr: analysis.irr,
      compsConfidence,
    },
  };
}

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

function buildHeadline(
  inputs: DealInputs,
  analysis: DealAnalysis,
  ceiling: ReturnType<typeof findOfferCeiling>,
): PackPayload["headline"] {
  const listPrice = inputs.purchasePrice;
  const tier = analysis.verdict.tier;
  const primary = ceiling.primaryTarget;

  if (!primary) {
    // No realistic offer clears the rubric within the negotiation band.
    // Pack should make this explicit — that's the most useful thing it
    // can tell the investor.
    return {
      walkAwayPrice: null,
      walkAwayTier: null,
      walkAwayDiscountPercent: null,
      listPrice,
      deltaDollars: null,
      deltaPercent: null,
      framing: `No price within a 15% negotiation band of the ${formatCurrency(
        listPrice,
        0,
      )} ask clears our rubric. This deal verdicts ${TIER_LABEL[tier]} at the seller's number; walking away is the rational move unless the rent or expense assumptions change materially.`,
      tier,
    };
  }

  const walkAway = primary.price;
  const delta = listPrice - walkAway;
  const deltaPct = listPrice > 0 ? delta / listPrice : 0;
  const tierLabel = TIER_LABEL[primary.tier];

  return {
    walkAwayPrice: walkAway,
    walkAwayTier: primary.tier,
    walkAwayDiscountPercent: primary.discountPercent,
    listPrice,
    deltaDollars: delta,
    deltaPercent: deltaPct * 100,
    framing: `This deal clears our rubric (${tierLabel}) at or below ${formatCurrency(
      walkAway,
      0,
    )}; the seller is asking ${formatCurrency(listPrice, 0)} — a ${formatCurrency(
      delta,
      0,
    )} (${primary.discountPercent.toFixed(1)}%) gap.`,
    tier,
  };
}

// ---------------------------------------------------------------------------
// Three weakest assumptions
//
// We score every potential gap and surface the top 3. Order matters: if
// the homestead-trap warning fired, that almost always belongs at the top
// because it's a recurring expense that compounds across the hold period.
// ---------------------------------------------------------------------------

export function pickWeakAssumptions(args: {
  inputs: DealInputs;
  analysis: DealAnalysis;
  comparables: ComparablesAnalysis;
  warnings: string[];
  provenance: Partial<Record<keyof DealInputs, FieldProvenance>>;
}): WeakAssumption[] {
  const { inputs, comparables, warnings, provenance } = args;
  const out: WeakAssumption[] = [];

  // 1. Homestead-trap tax (highest-impact assumption fault by §20.9 #1).
  //    Detect by looking at the resolver warning text — that's where the
  //    full "$X line-item vs $Y investor estimate" string lives.
  const taxWarning = warnings.find((w) =>
    /homestead exemption/i.test(w),
  );
  if (taxWarning) {
    const taxProv = provenance.annualPropertyTax;
    const realistic = inputs.annualPropertyTax;
    // Pull the $ amount out of the warning so the Pack can show both
    // numbers without losing the original copy.
    const matches = Array.from(
      taxWarning.matchAll(/\$([\d,]+)/g),
    ).map((m) => Number(m[1].replace(/,/g, "")));
    const previousTax = matches[0];
    if (previousTax && Math.abs(realistic - previousTax) > 250) {
      out.push({
        field: "Property tax (homestead trap)",
        current: `${formatCurrency(previousTax, 0)}/yr (assessor line-item)`,
        realistic: `${formatCurrency(realistic, 0)}/yr at the investor (non-homestead) state rate`,
        gap: `${formatCurrency(realistic - previousTax, 0)}/yr higher`,
        reason:
          taxProv?.note ??
          "The public-record tax bill reflects the current owner's homestead exemption. As an investor you lose homestead and pay the non-homestead rate.",
        severity: "high",
      });
    }
  }

  // 2. Rent vs comp-derived market rent. If the seller's pro forma rent
  //    diverges materially from the comp median, surface it.
  if (comparables.marketRent && inputs.monthlyRent > 0) {
    const market = comparables.marketRent.value;
    const subject = inputs.monthlyRent;
    const diff = subject - market;
    const diffPct = market > 0 ? Math.abs(diff) / market : 0;
    if (diffPct >= 0.1 && Math.abs(diff) >= 75) {
      const direction = diff > 0 ? "above" : "below";
      out.push({
        field: "Monthly rent",
        current: `${formatCurrency(subject, 0)}/mo (seller's number)`,
        realistic: `${formatCurrency(market, 0)}/mo (median of ${
          comparables.marketRent.compsUsed.length
        } nearby rent comps${
          comparables.marketRent.medianPerSqft
            ? ` at $${comparables.marketRent.medianPerSqft.toFixed(2)}/sqft`
            : ""
        })`,
        gap: `${formatPercent(diffPct, 1)} ${direction} the comp median`,
        reason:
          diff > 0
            ? `The seller's implied rent is ${formatPercent(
                diffPct,
                1,
              )} above what nearby comparable units actually rent for. Verify with 3 named comps before banking on it.`
            : `The seller's listed rent is below market — there may be repositioning upside, but a comp-grounded underwrite uses the lower rent until you've signed a lease.`,
        severity: diffPct >= 0.2 ? "high" : "medium",
      });
    }
  }

  // 3. Insurance estimate (state-average is rough — real flood / wind /
  //    age modifiers can swing it 30–50%).
  const insProv = provenance.annualInsurance;
  if (insProv) {
    const isStateAvg =
      insProv.source === "state-average" || insProv.source === "national-average";
    const isFlood = insProv.source === "fema-nfhl";
    if (isFlood) {
      out.push({
        field: "Insurance (flood zone)",
        current: `${formatCurrency(inputs.annualInsurance, 0)}/yr (estimate)`,
        realistic: "Get a real NFIP / private flood quote before you offer",
        gap: "Could be ±30% of estimate",
        reason: insProv.note,
        severity: "high",
      });
    } else if (isStateAvg || insProv.confidence === "low") {
      out.push({
        field: "Insurance",
        current: `${formatCurrency(inputs.annualInsurance, 0)}/yr (state-average estimate)`,
        realistic: "Get a real quote — rates vary 30–50% by age, roof, claims history",
        gap: "Estimate only",
        reason:
          "The insurance number is computed from the state's average HO3 policy, not a real quote for this property. A 1990s home with a tile roof in IN might be $1,400/yr; a 1920s frame house in coastal LA could be $4,500.",
        severity: "medium",
      });
    }
  }

  // 4. Sale-value confidence (if comp pool is small/wide, flag it).
  if (comparables.marketValue) {
    const conf = comparables.marketValue.confidence;
    const compCount = comparables.marketValue.compsUsed.length;
    if (conf === "low" || compCount < 3) {
      out.push({
        field: "Comp confidence",
        current: `${compCount} sale comp${compCount === 1 ? "" : "s"} drove the fair-value derivation`,
        realistic: `Treat the ${formatCurrency(
          comparables.marketValue.value,
          0,
        )} fair value as a wide band, not a point estimate`,
        gap: `Confidence is ${conf}`,
        reason:
          "Thin comp pools mean a single outlier sale (rehabbed flip, family transfer, distressed) can shift the median 10–20%. Pull the actual comps from the Comp Reasoning page before negotiating.",
        severity: "medium",
      });
    }
  }

  // 5. Vacancy assumption (if user kept the default).
  if (inputs.vacancyRatePercent <= 5) {
    out.push({
      field: "Vacancy",
      current: `${inputs.vacancyRatePercent}%/yr (≈ ${(
        (inputs.vacancyRatePercent / 100) *
        12
      ).toFixed(1)} months/yr)`,
      realistic: "8–10% in most secondary markets; verify with local PM",
      gap: "Likely understated",
      reason:
        "Sub-5% vacancy assumes near-zero turnover. Realistic vacancy in most rental markets is 8–10% (one month between tenants every 18–24 months, plus a few weeks of make-ready).",
      severity: "low",
    });
  }

  // Sort by severity (high → medium → low) but preserve insertion order
  // within each tier so the homestead-trap stays at the top of "high".
  const SEV_RANK: Record<WeakAssumption["severity"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);

  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Comp evidence — top 3 of each side, with a one-line "why this one"
// ---------------------------------------------------------------------------

function pickCompEvidence(
  pool: ScoredComp[],
  kind: "sale" | "rent",
  limit = 3,
): CompEvidence[] {
  return pool.slice(0, limit).map((c) => ({
    address: c.address,
    beds: c.bedrooms,
    baths: c.bathrooms,
    sqft: c.squareFootage,
    price: c.price,
    pricePerSqft: c.pricePerSqft,
    distanceMiles: c.distance,
    daysOnMarket: c.daysOnMarket,
    why: buildCompWhy(c, kind),
  }));
}

function buildCompWhy(comp: ScoredComp, kind: "sale" | "rent"): string {
  const bits: string[] = [];
  if (comp.matchReasons.length > 0) {
    // Pick the two strongest reasons — first two are usually beds/baths
    // and distance/recency, the most "an agent would buy this" signals.
    bits.push(...comp.matchReasons.slice(0, 2));
  }
  if (comp.pricePerSqft) {
    if (kind === "sale") {
      bits.push(`$${comp.pricePerSqft.toFixed(0)}/sqft`);
    } else {
      bits.push(`$${comp.pricePerSqft.toFixed(2)}/sqft/mo`);
    }
  }
  if (comp.distance != null && comp.distance >= 0) {
    bits.push(`${comp.distance.toFixed(1)}mi away`);
  }
  if (comp.missReasons.length > 0) {
    // Surface the dominant caveat so the Pack reader doesn't think we're
    // hiding it. Limit to one — pack should be confident, not hedgy.
    bits.push(`(caveat: ${comp.missReasons[0]})`);
  }
  return bits.join("; ");
}

// ---------------------------------------------------------------------------
// Stress scenarios — the four shocks per §20.3
// ---------------------------------------------------------------------------

type ScenarioDef = {
  label: string;
  description: string;
  apply: (b: DealInputs) => DealInputs;
};

const PACK_SCENARIOS: ScenarioDef[] = [
  {
    label: "Rent drops 10%",
    description:
      "A market softening or a one-time concession to fill a vacancy. Tests how much rent cushion the deal has.",
    apply: (b) => ({ ...b, monthlyRent: Math.round(b.monthlyRent * 0.9) }),
  },
  {
    label: "Expenses jump 25%",
    description:
      "Tax reassessment, insurance renewal hike, or a CapEx event in year 1. Tests the operating cushion.",
    apply: (b) => ({
      ...b,
      maintenancePercent: b.maintenancePercent * 1.25,
      annualInsurance: Math.round(b.annualInsurance * 1.25),
      annualPropertyTax: Math.round(b.annualPropertyTax * 1.05),
    }),
  },
  {
    label: "Refi rate +1pt",
    description:
      "Hold-period rate environment moves against you when refinancing. Tests interest-rate sensitivity.",
    apply: (b) => ({ ...b, loanInterestRate: b.loanInterestRate + 1 }),
  },
  {
    label: "Sells 10% below today",
    description:
      "Exit price comes in 10% under today's value. Tests how much of the return depends on appreciation vs cash flow.",
    apply: (b) => ({
      ...b,
      annualAppreciationPercent:
        b.annualAppreciationPercent -
        100 *
          (1 - Math.pow(0.9, 1 / Math.max(1, b.holdPeriodYears))),
    }),
  },
];

function runStressScenarios(
  inputs: DealInputs,
  base: DealAnalysis,
): StressOutcome[] {
  return PACK_SCENARIOS.map((s) => {
    let stressed: DealAnalysis;
    try {
      stressed = analyseDeal(sanitiseInputs(s.apply(inputs)));
    } catch {
      // If the stressed scenario produces invalid inputs (e.g. negative
      // rate after a buydown), just return the base case so the row
      // doesn't disappear from the Pack — the Pack reader sees "no
      // change" rather than a missing row.
      stressed = base;
    }
    const flippedFromBase = stressed.verdict.tier !== base.verdict.tier;
    const cfDelta = stressed.monthlyCashFlow - base.monthlyCashFlow;
    return {
      label: s.label,
      description: s.description,
      monthlyCashFlowAfter: stressed.monthlyCashFlow,
      monthlyCashFlowDelta: cfDelta,
      dscrAfter: stressed.dscr,
      capRateAfter: stressed.capRate,
      verdictAfter: stressed.verdict.tier,
      flippedFromBase,
      oneLine: buildStressOneLine(s.label, base, stressed, flippedFromBase),
    };
  });
}

function buildStressOneLine(
  label: string,
  base: DealAnalysis,
  stressed: DealAnalysis,
  flipped: boolean,
): string {
  const cf = formatCurrency(stressed.monthlyCashFlow, 0);
  const dscr = isFinite(stressed.dscr) ? stressed.dscr.toFixed(2) : "∞";
  const baseDscr = isFinite(base.dscr) ? base.dscr.toFixed(2) : "∞";
  const flipNote = flipped
    ? ` Verdict ${TIER_LABEL[base.verdict.tier]} → ${TIER_LABEL[stressed.verdict.tier]}.`
    : "";
  return `${label}: cash flow ${cf}/mo, DSCR ${dscr} (was ${baseDscr}).${flipNote}`;
}

// ---------------------------------------------------------------------------
// Counteroffer script — 2–3 forwardable paragraphs
// ---------------------------------------------------------------------------

function buildCounteroffer(args: {
  address: string;
  listPrice: number;
  walkAwayPrice: number | null;
  walkAwayTier: VerdictTier | null;
  weakAssumptions: WeakAssumption[];
  analysis: DealAnalysis;
}): CounterofferScript {
  const { address, listPrice, walkAwayPrice, walkAwayTier, weakAssumptions } =
    args;

  const paragraphs: string[] = [];

  // Paragraph 1: opening line + walk-away anchor.
  if (walkAwayPrice && walkAwayTier) {
    const tierLabel = TIER_LABEL[walkAwayTier].toLowerCase();
    paragraphs.push(
      `I've underwritten ${address}. I can make it work as a ${tierLabel} at or below ${formatCurrency(
        walkAwayPrice,
        0,
      )} — that's the price at which the deal clears my rubric for cash flow, DSCR, and exit IRR. The seller is at ${formatCurrency(
        listPrice,
        0,
      )}.`,
    );
  } else {
    paragraphs.push(
      `I've underwritten ${address} and don't see a price within a realistic negotiation band of the ${formatCurrency(
        listPrice,
        0,
      )} ask that clears my rubric. I'm passing unless the seller would entertain a number meaningfully below their list, or one of the underlying assumptions (tax, rent, expense baseline) changes materially.`,
    );
  }

  // Paragraph 2: the three things the seller's pro forma is hiding.
  if (weakAssumptions.length > 0) {
    const lines = weakAssumptions
      .map((a) => `• ${a.field}: ${a.current} → ${a.realistic}. ${a.reason}`)
      .join("\n");
    paragraphs.push(
      `Three things I'm pricing in that the listing isn't:\n${lines}`,
    );
  }

  // Paragraph 3: closing — frames the offer as math, not a lowball.
  if (walkAwayPrice) {
    paragraphs.push(
      `My offer at ${formatCurrency(
        walkAwayPrice,
        0,
      )} isn't a haircut — it's the number that produces a deal I'd put my own capital into. If the seller has reason to believe the rent / tax / insurance assumptions above are wrong on this specific property, I'm open to seeing the documentation. Otherwise the math is the math.`,
    );
  } else {
    paragraphs.push(
      `Happy to revisit if the seller's expectations move, or if you have data on this property I haven't seen — particularly around tax basis post-sale or in-place rent.`,
    );
  }

  return {
    walkAwayPrice,
    listPrice,
    paragraphs,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function combineCompsConfidence(
  saleConf: "high" | "medium" | "low" | undefined,
  rentConf: "high" | "medium" | "low" | undefined,
): "high" | "medium" | "low" {
  // Pack is only as confident as its weaker derivation.
  const ranked = [saleConf, rentConf]
    .filter((c): c is "high" | "medium" | "low" => !!c)
    .sort((a, b) => {
      const RANK = { low: 0, medium: 1, high: 2 } as const;
      return RANK[a] - RANK[b];
    });
  return ranked[0] ?? "low";
}
