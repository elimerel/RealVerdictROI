/**
 * Distribution engine — probabilistic analysis over uncertain inputs.
 *
 * The core `analyseDeal` kernel in calculations.ts is pure and deterministic:
 * given the same DealInputs it always returns the same DealAnalysis. This
 * module wraps it to run across a matrix of realistic input combinations
 * sampled from each field's uncertainty range, producing a distribution of
 * outcomes rather than a single point estimate.
 *
 * Design invariants:
 *  - analyseDeal is never modified — it is the inner kernel.
 *  - Scenarios are generated deterministically from a fixed seed, so the same
 *    AnnotatedInputs always produces the same distribution (reproducible).
 *  - The scenario count is bounded to keep the computation synchronous and
 *    fast in the browser (target: < 50ms for N=100 on a 2020 laptop).
 *  - The five named stress scenarios from lib/stress-scenarios.ts survive as
 *    named labeled points within the distribution view.
 */

import {
  analyseDeal,
  sanitiseInputs,
  type DealInputs,
  type DealAnalysis,
  type VerdictTier,
  type RubricItem,
  type AnalyseDealOptions,
  formatCurrency,
  formatPercent,
} from "./calculations";
import type { AnnotatedInputs } from "./annotated-inputs";
import type { ConfidenceLevel } from "./types";
import { STRESS_SCENARIOS } from "./stress-scenarios";
import { TIER_LABEL } from "./tier-constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricDistribution = {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

export type DistributionResult = {
  /** Base-case analysis run on the un-perturbed P50 inputs. */
  base: DealAnalysis;
  /** Full set of scenario runs (ordered, not sorted). */
  scenarios: DealAnalysis[];
  /** Ranges actually used for sampling each input field. */
  inputRanges: Partial<Record<keyof DealInputs, { lo: number; hi: number }>>;
  /** Distributions for key metrics across all scenarios. */
  monthlyCashFlow: MetricDistribution;
  capRate: MetricDistribution;
  dscr: MetricDistribution;
  irr: MetricDistribution;
  totalROI: MetricDistribution;
  /** How many scenarios landed in each tier. */
  tierCounts: Record<VerdictTier, number>;
  /** Fraction of scenarios (0–1) that share the most common tier. */
  dominantTierFraction: number;
  /** The tier that appears most often. */
  dominantTier: VerdictTier;
  /**
   * Human-readable condition string for scenarios where the verdict differs
   * from the dominant tier. E.g. "rent at top of range and rate below 6.5%".
   * Null when all scenarios agree on the same tier.
   */
  outlierCondition: string | null;
  /**
   * Named stress-scenario results. These are the five canonical shocks from
   * lib/stress-scenarios.ts, included so the StressTestPanel can show them
   * as labeled points without re-running them separately.
   */
  namedScenarios: Array<{
    key: string;
    label: string;
    description: string;
    analysis: DealAnalysis | null;
  }>;
};

// ---------------------------------------------------------------------------
// Uncertainty model
// ---------------------------------------------------------------------------

/**
 * Per-field uncertainty configuration. `spread` is the half-width of the
 * sampling range as a fraction of the field's value (0.10 = ±10%).
 * For fields where absolute (not relative) variation makes more sense,
 * use `absoluteSpread` instead.
 *
 * Fields absent from this table are treated as certain (point values) —
 * contract terms like loanTermYears, downPaymentPercent, etc.
 */
type FieldUncertainty = {
  /** Fraction of value, e.g. 0.10 = ±10%. Applied first. */
  relativeSpread?: number;
  /** Absolute additive spread, e.g. 0.5 for ±0.5 percentage points. */
  absoluteSpread?: number;
  /** Minimum value the sampled field may take (floor). */
  floor?: number;
  /** Maximum value the sampled field may take (ceiling). */
  ceiling?: number;
};

/**
 * Inherent uncertainty for each input field, independent of provenance.
 * These are the spreads applied even to "high confidence" inputs because
 * the field is inherently a range in the real world.
 */
const INHERENT_UNCERTAINTY: Partial<Record<keyof DealInputs, FieldUncertainty>> = {
  monthlyRent:          { relativeSpread: 0.08, floor: 100 },   // ±8% even if on listing
  rehabCosts:           { relativeSpread: 0.25, floor: 0 },     // ±25% — rehab always varies
  vacancyRatePercent:   { absoluteSpread: 2.0, floor: 0, ceiling: 40 }, // ±2 pts
  loanInterestRate:     { absoluteSpread: 0.375, floor: 2.0, ceiling: 15 }, // ±0.375pts
};

/**
 * Additional spread added on top of inherent uncertainty when the input
 * has less-than-high confidence. This reflects the epistemic uncertainty
 * of the data source itself (e.g. state average vs actual quote).
 */
const CONFIDENCE_EXTRA_SPREAD: Record<Exclude<ConfidenceLevel, "high">, number> = {
  medium: 0.08,   // adds ±8% relative
  low:    0.20,   // adds ±20% relative
};

// Fields where we apply confidence-based extra spread (beyond inherent).
const CONFIDENCE_SENSITIVE: (keyof DealInputs)[] = [
  "monthlyRent",
  "rehabCosts",
  "annualPropertyTax",
  "annualInsurance",
  "vacancyRatePercent",
  "loanInterestRate",
  "annualAppreciationPercent",
];

// ---------------------------------------------------------------------------
// Seeded pseudo-random (Mulberry32) — deterministic, no external deps
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Latin Hypercube Sampling
// ---------------------------------------------------------------------------

/**
 * Return an [n × k] matrix of uniform samples in [0, 1] using Latin
 * Hypercube Sampling. Each column is a permuted sequence of evenly-spaced
 * quantiles so every stratum of each marginal distribution is represented.
 */
function latinHypercubeSample(n: number, k: number, seed = 42): number[][] {
  if (k === 0) return Array.from({ length: n }, () => []);
  const rng = mulberry32(seed);

  // Build one column per uncertain dimension.
  const cols: number[][] = [];
  for (let j = 0; j < k; j++) {
    // Evenly-spaced quantiles centred in each stratum.
    const col = Array.from({ length: n }, (_, i) => (i + 0.5) / n);
    // Fisher-Yates shuffle using seeded RNG (different seed per column).
    for (let i = col.length - 1; i > 0; i--) {
      const swap = Math.floor(rng() * (i + 1));
      [col[i], col[swap]] = [col[swap], col[i]];
    }
    cols.push(col);
  }

  return Array.from({ length: n }, (_, i) => cols.map((col) => col[i]));
}

// ---------------------------------------------------------------------------
// Scenario generation
// ---------------------------------------------------------------------------

type UncertainDim = {
  field: keyof DealInputs;
  lo: number;
  hi: number;
};

/**
 * Compute the [lo, hi] sampling range for a given field based on its base
 * value and the provenance confidence of that field.
 */
function computeRange(
  field: keyof DealInputs,
  value: number,
  confidence: ConfidenceLevel,
): { lo: number; hi: number } | null {
  const inherent = INHERENT_UNCERTAINTY[field];
  const isSensitive = CONFIDENCE_SENSITIVE.includes(field);

  // Total relative spread = inherent relative + confidence extra (if applicable).
  let relSpread = inherent?.relativeSpread ?? 0;
  let absSpread = inherent?.absoluteSpread ?? 0;

  if (isSensitive && confidence !== "high") {
    relSpread += CONFIDENCE_EXTRA_SPREAD[confidence];
  }

  if (relSpread === 0 && absSpread === 0) return null; // this field is certain

  const relDelta = value * relSpread;
  const lo = Math.max(
    inherent?.floor ?? 0,
    value - relDelta - absSpread,
  );
  const hi = inherent?.ceiling != null
    ? Math.min(inherent.ceiling, value + relDelta + absSpread)
    : value + relDelta + absSpread;

  if (hi <= lo) return null; // degenerate range — treat as certain
  return { lo, hi };
}

/**
 * Generate N scenario `DealInputs` from `AnnotatedInputs` using Latin
 * Hypercube Sampling over the uncertain dimensions. The base inputs are
 * always included as scenario 0.
 */
export function generateScenarios(
  annotated: AnnotatedInputs,
  n = 100,
  seed = 42,
): { scenarios: DealInputs[]; inputRanges: Partial<Record<keyof DealInputs, { lo: number; hi: number }>> } {
  // 1. Identify uncertain dimensions and their ranges.
  const dims: UncertainDim[] = [];
  const inputRanges: Partial<Record<keyof DealInputs, { lo: number; hi: number }>> = {};

  for (const key of Object.keys(annotated) as (keyof DealInputs)[]) {
    const af = annotated[key];
    const range = computeRange(key, af.value as number, af.provenance.confidence);
    if (range) {
      dims.push({ field: key, ...range });
      inputRanges[key] = range;
    }
  }

  // 2. Build the base-case inputs (plain values).
  const base: DealInputs = {} as DealInputs;
  for (const key of Object.keys(annotated) as (keyof DealInputs)[]) {
    (base as Record<string, unknown>)[key] = annotated[key].value;
  }

  // 3. Sample the uncertain dimensions.
  const k = dims.length;
  if (k === 0) return { scenarios: [base], inputRanges };

  const unitSamples = latinHypercubeSample(n, k, seed);

  const scenarios: DealInputs[] = unitSamples.map((row) => {
    const s = { ...base };
    for (let j = 0; j < k; j++) {
      const { field, lo, hi } = dims[j];
      (s as Record<string, unknown>)[field] = lo + row[j] * (hi - lo);
    }
    return s;
  });

  return { scenarios, inputRanges };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function distribution(values: number[]): MetricDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
  };
}

// All VerdictTier values in descending order.
const ALL_TIERS: VerdictTier[] = ["excellent", "good", "fair", "poor", "avoid"];

function dominantTierOf(
  counts: Record<VerdictTier, number>,
  total: number,
): { tier: VerdictTier; fraction: number } {
  let best: VerdictTier = "avoid";
  let bestCount = 0;
  for (const t of ALL_TIERS) {
    if (counts[t] > bestCount) {
      bestCount = counts[t];
      best = t;
    }
  }
  return { tier: best, fraction: total > 0 ? bestCount / total : 0 };
}

/**
 * Describe the conditions under which the verdict is better than the
 * dominant tier. Used to build "the 1 outlier scenario requires X" copy.
 */
function describeOutlierCondition(
  analyses: DealAnalysis[],
  dominantTier: VerdictTier,
  inputRanges: Partial<Record<keyof DealInputs, { lo: number; hi: number }>>,
): string | null {
  const outliers = analyses.filter(
    (a) => tierRank(a.verdict.tier) > tierRank(dominantTier),
  );
  if (outliers.length === 0) return null;

  // Find which inputs in the outlier scenarios are consistently at the
  // favorable extreme (high rent, low rate, low vacancy, etc.)
  const conditions: string[] = [];
  const rangedFields = Object.keys(inputRanges) as (keyof DealInputs)[];

  for (const field of rangedFields) {
    const range = inputRanges[field]!;
    const rangeWidth = range.hi - range.lo;
    if (rangeWidth < 0.001) continue;

    // Compute the average value of this field across outlier scenarios.
    const outlierMean =
      outliers.reduce((s, a) => s + (a.inputs[field] as number), 0) /
      outliers.length;
    const normalized = (outlierMean - range.lo) / rangeWidth; // 0=lo end, 1=hi end

    // Flag if consistently at favorable extreme (top 25% or bottom 25%).
    if (field === "monthlyRent" && normalized > 0.75) {
      conditions.push(`rent near top of range (${formatFieldValue(field, outlierMean)})`);
    } else if (
      (field === "loanInterestRate" || field === "rehabCosts") &&
      normalized < 0.25
    ) {
      conditions.push(
        `${fieldLabel(field)} near low end (${formatFieldValue(field, outlierMean)})`,
      );
    } else if (field === "vacancyRatePercent" && normalized < 0.25) {
      conditions.push(
        `low vacancy (${formatFieldValue(field, outlierMean)})`,
      );
    } else if (field === "annualPropertyTax" && normalized < 0.25) {
      conditions.push(`lower property tax`);
    } else if (field === "annualInsurance" && normalized < 0.25) {
      conditions.push(`lower insurance`);
    }
  }

  if (conditions.length === 0) return null;
  return conditions.slice(0, 3).join(" and ");
}

function tierRank(t: VerdictTier): number {
  return { excellent: 4, good: 3, fair: 2, poor: 1, avoid: 0 }[t];
}

function fieldLabel(field: keyof DealInputs): string {
  const labels: Partial<Record<keyof DealInputs, string>> = {
    monthlyRent: "rent",
    loanInterestRate: "interest rate",
    rehabCosts: "rehab cost",
    vacancyRatePercent: "vacancy",
    annualPropertyTax: "property tax",
    annualInsurance: "insurance",
  };
  return labels[field] ?? String(field);
}

function formatFieldValue(field: keyof DealInputs, value: number): string {
  if (field === "monthlyRent") return `$${Math.round(value).toLocaleString()}/mo`;
  if (field === "loanInterestRate") return `${value.toFixed(2)}%`;
  if (field === "vacancyRatePercent") return `${value.toFixed(1)}%`;
  if (field === "rehabCosts") return `$${Math.round(value).toLocaleString()}`;
  return value.toFixed(1);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full probabilistic analysis over an AnnotatedInputs.
 *
 * Returns a DistributionResult containing:
 *  - the base-case DealAnalysis (P50 of the distribution)
 *  - all N scenario runs
 *  - P10/P25/P50/P75/P90 for key metrics
 *  - tier counts and dominant-tier fraction
 *  - the five named stress scenarios as labeled points
 *
 * The calculation is synchronous and completes in < 50ms for N ≤ 200.
 */
export function analyseDistribution(
  annotated: AnnotatedInputs,
  options: AnalyseDealOptions = {},
  n = 100,
  seed = 42,
): DistributionResult {
  // 1. Generate input scenarios.
  const { scenarios: rawScenarios, inputRanges } = generateScenarios(
    annotated,
    n,
    seed,
  );

  // 2. Build base inputs from annotated values.
  const basePlain: DealInputs = {} as DealInputs;
  for (const key of Object.keys(annotated) as (keyof DealInputs)[]) {
    (basePlain as Record<string, unknown>)[key] = annotated[key].value;
  }

  // 3. Run the base analysis.
  const base = analyseDeal(sanitiseInputs(basePlain), options);

  // 4. Run all scenarios through the engine.
  const analyses: DealAnalysis[] = [];
  for (const raw of rawScenarios) {
    try {
      analyses.push(analyseDeal(sanitiseInputs(raw), options));
    } catch {
      // Skip scenarios that produce degenerate inputs (e.g. rate → 0).
    }
  }

  // 5. Aggregate metrics.
  const cashFlows = analyses.map((a) => a.monthlyCashFlow);
  const capRates = analyses.map((a) => a.capRate);
  const dscrs = analyses.map((a) => (isFinite(a.dscr) ? a.dscr : 0));
  const irrs = analyses.map((a) => (isFinite(a.irr) ? a.irr : 0));
  const rois = analyses.map((a) => (isFinite(a.totalROI) ? a.totalROI : 0));

  // 6. Tier counts.
  const tierCounts: Record<VerdictTier, number> = {
    excellent: 0, good: 0, fair: 0, poor: 0, avoid: 0,
  };
  for (const a of analyses) {
    tierCounts[a.verdict.tier]++;
  }
  const total = analyses.length;
  const { tier: dominantTier, fraction: dominantTierFraction } = dominantTierOf(
    tierCounts,
    total,
  );

  // 7. Outlier condition description.
  const outlierCondition = describeOutlierCondition(
    analyses,
    dominantTier,
    inputRanges,
  );

  // 8. Named stress scenarios.
  const namedScenarios = STRESS_SCENARIOS.map((s) => {
    let analysis: DealAnalysis | null = null;
    try {
      analysis = analyseDeal(sanitiseInputs(s.apply(basePlain)), options);
    } catch {
      // leave null
    }
    return { key: s.key, label: s.label, description: s.description, analysis };
  });

  return {
    base,
    scenarios: analyses,
    inputRanges,
    monthlyCashFlow: distribution(cashFlows),
    capRate: distribution(capRates),
    dscr: distribution(dscrs),
    irr: distribution(irrs),
    totalROI: distribution(rois),
    tierCounts,
    dominantTier,
    dominantTierFraction,
    outlierCondition,
    namedScenarios,
  };
}

// ---------------------------------------------------------------------------
// Probabilistic Verdict
// ---------------------------------------------------------------------------

export type ProbabilisticVerdict = {
  /** The tier that appeared in the most scenarios. */
  dominantTier: VerdictTier;
  /** Fraction of scenarios (0.0–1.0) that landed in the dominant tier. */
  dominantTierFraction: number;
  /**
   * Human-readable headline reflecting confidence.
   * Examples:
   *   "Walk Away in 9 of 10 scenarios."
   *   "Strong Buy in all 10 of 10 scenarios."
   *   "Borderline — split 5/5 between Borderline and Pass."
   */
  headline: string;
  /**
   * The condition under which a minority of scenarios produces a better
   * verdict than the dominant tier. Null when all scenarios agree.
   * Example: "rent near top of range ($2,850/mo) and interest rate below 6.5%"
   */
  conditionForOutlier: string | null;
  /** Total number of scenarios run. */
  scenarioCount: number;
  /** Numeric score from the P50 base run (backward-compatible). */
  score: number;
  /** Rubric breakdown from the P50 base run (backward-compatible). */
  breakdown: RubricItem[];
  /** Metric distributions for display. */
  distributions: {
    monthlyCashFlow: MetricDistribution;
    capRate: MetricDistribution;
    dscr: MetricDistribution;
    irr: MetricDistribution;
  };
  /** Worst confidence level across all inputs ("how solid is this verdict?"). */
  inputConfidenceSummary: ConfidenceLevel;
  /** Plain-English description of P10/P50/P90 cash flow range. */
  cashFlowRangeNote: string;
};

/**
 * Build a ProbabilisticVerdict from a DistributionResult.
 *
 * This replaces the single deterministic verdict label with a confidence-
 * aware headline that tells the investor how often each tier appears across
 * the scenario matrix.
 */
export function renderProbabilisticVerdict(
  dist: DistributionResult,
  inputConfidenceSummary: ConfidenceLevel = "low",
): ProbabilisticVerdict {
  const { dominantTier, dominantTierFraction, tierCounts, scenarios } = dist;
  const n = scenarios.length;
  const dominantCount = Math.round(dominantTierFraction * n);
  const tierDisplayName = TIER_LABEL[dominantTier];

  // Build the headline.
  let headline: string;
  if (dominantTierFraction >= 0.99) {
    headline = `${tierDisplayName} in all ${n} scenarios.`;
  } else if (dominantTierFraction >= 0.9) {
    headline = `${tierDisplayName} in ${dominantCount} of ${n} scenarios.`;
  } else if (dominantTierFraction >= 0.7) {
    headline = `${tierDisplayName} in ${dominantCount} of ${n} scenarios — results are sensitive to input assumptions.`;
  } else {
    // Tier is genuinely split — find the two top tiers.
    const sorted = (Object.entries(tierCounts) as [VerdictTier, number][])
      .filter(([, c]) => c > 0)
      .sort(([, a], [, b]) => b - a);
    const [topTier, topCount] = sorted[0];
    const [secondTier, secondCount] = sorted[1] ?? ["avoid", 0];
    headline = `Split — ${TIER_LABEL[topTier]} in ${topCount} scenarios, ${TIER_LABEL[secondTier]} in ${secondCount} of ${n}. High input uncertainty.`;
  }

  // Cash flow range note.
  const cfP10 = dist.monthlyCashFlow.p10;
  const cfP50 = dist.monthlyCashFlow.p50;
  const cfP90 = dist.monthlyCashFlow.p90;
  const fmtCF = (v: number) =>
    `${v >= 0 ? "+" : ""}${formatCurrency(v, 0)}/mo`;
  const cashFlowRangeNote = `Cash flow ranges from ${fmtCF(cfP10)} (pessimistic) to ${fmtCF(cfP50)} (base) to ${fmtCF(cfP90)} (optimistic) across ${n} scenarios.`;

  // Outlier condition: only mention if a non-trivial minority differs.
  const outlierCount = n - dominantCount;
  const conditionForOutlier =
    dist.outlierCondition && outlierCount > 0 && outlierCount < n
      ? `The ${outlierCount === 1 ? "1 scenario" : `${outlierCount} scenarios`} where the verdict differs ${outlierCount === 1 ? "requires" : "require"}: ${dist.outlierCondition}.`
      : null;

  return {
    dominantTier,
    dominantTierFraction,
    headline,
    conditionForOutlier,
    scenarioCount: n,
    score: dist.base.verdict.score,
    breakdown: dist.base.verdict.breakdown,
    distributions: {
      monthlyCashFlow: dist.monthlyCashFlow,
      capRate: dist.capRate,
      dscr: dist.dscr,
      irr: dist.irr,
    },
    inputConfidenceSummary,
    cashFlowRangeNote,
  };
}

// ---------------------------------------------------------------------------
// Confidence note for findOfferCeiling
// ---------------------------------------------------------------------------

/**
 * Build a short note explaining how confident the walk-away price estimate is.
 * Consumed by AnalysisPanel to annotate the hero walk-away number when the
 * underlying rent estimate is not high-confidence.
 */
export function offerCeilingConfidenceNote(
  rentConfidence: ConfidenceLevel,
  rentSource: string,
): string {
  if (rentConfidence === "high") {
    return `Based on verified rent data (${rentSource}).`;
  }
  if (rentConfidence === "medium") {
    return `Based on estimated rent (${rentSource}) — verify before submitting an offer.`;
  }
  return `Based on a defaulted rent estimate — treat as directional only until rent is confirmed.`;
}
