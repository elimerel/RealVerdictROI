import type { Comp, CompsResult } from "@/lib/comps";

// ---------------------------------------------------------------------------
// Comparables analysis — "show your work" derivation of fair value and market
// rent from nearby listings.
//
// This is how a real investor prices a deal:
//   1. Pull nearby sale comps + rent comps that match on bed/bath/sqft.
//   2. Normalize each comp by $/sqft (so a 2400sqft subject can be compared
//      against 1800sqft and 2900sqft comps on an apples-to-apples basis).
//   3. Take the median $/sqft of the best-scoring comps, multiply by subject
//      sqft → derived fair value / derived market rent.
//   4. Show the subject, every comp used, and the math.
//
// When the subject has no sqft we fall back to median absolute price/rent of
// bed-matched comps — less precise, but still a real number.
// ---------------------------------------------------------------------------

export type SubjectSnapshot = {
  address: string;
  price?: number;
  sqft?: number;
  beds?: number;
  baths?: number;
  yearBuilt?: number;
  propertyType?: string;
  /** Monthly HOA — when > ~$200 this strongly implies condo-style ownership
   * regardless of what the propertyType field says (e.g. "Townhouse" listings
   * in a gated condo community). */
  monthlyHOA?: number;
  /** The property's most recent sale price from public records — used as a
   * sanity anchor against comp-derived value. */
  lastSalePrice?: number;
  /** ISO date string of the last sale. */
  lastSaleDate?: string;
  /** Current list price (active listing on Zillow). Used as a market-truth
   * anchor alongside last-sale. */
  currentListPrice?: number;
  /** Expected annual appreciation rate as a decimal (0.03 = 3%/yr). Used to
   * roll the last-sale price forward to an implied-today value. */
  expectedAppreciation?: number;
};

export type ScoredComp = Comp & {
  pricePerSqft?: number;
  score: number;
  matchReasons: string[];
  missReasons: string[];
};

export type Derivation = {
  /** Final number we trust — fair value (sale) or market rent (rent). */
  value: number;
  /** How we got there. */
  method:
    | "median-per-sqft"         // primary: median $/sqft × subject sqft
    | "median-absolute"          // fallback: median absolute price of bed-matched comps
    | "trimmed-mean-per-sqft";   // fallback when distribution is wide
  /** Subject sqft used in the math (if applicable). */
  subjectSqft?: number;
  /** Median $/sqft across chosen comps. */
  medianPerSqft?: number;
  /** Median absolute price across chosen comps. */
  medianAbsolute?: number;
  /** p25 / p75 ranges so the UI can show a band, not a single point. */
  p25?: number;
  p75?: number;
  /** Best N comps used in the calculation (sorted by score desc). */
  compsUsed: ScoredComp[];
  /** How many comps were available before scoring/filtering. */
  totalAvailable: number;
  /** Radius (mi) that produced these comps. */
  radiusMilesUsed: number;
  confidence: "high" | "medium" | "low";
  /** Human-readable bullet points explaining the derivation. */
  workLog: string[];
};

export type ComparablesAnalysis = {
  subject: SubjectSnapshot;
  marketValue: Derivation | null;
  marketRent: Derivation | null;
};

// ---------------------------------------------------------------------------
// Scoring — rank each raw comp by how close it is to the subject.
// ---------------------------------------------------------------------------

const MAX_SCORE = 100;

type PropertyCategory = "single-family" | "condo-apt" | "multi-family" | "townhouse" | "unknown";

/**
 * Normalize RentCast / Zillow propertyType strings into a coarse category we
 * can compare across. Single-family vs condo/apartment is the one that
 * matters most for rent estimation — condos and apartments have structurally
 * higher $/sqft than detached homes.
 */
function categorize(propertyType: string | undefined): PropertyCategory {
  if (!propertyType) return "unknown";
  const t = propertyType.toLowerCase();
  if (/condo|apartment|co-?op|coop/.test(t)) return "condo-apt";
  if (/townhou?se|rowhou?se|attached/.test(t)) return "townhouse";
  if (/multi[- ]?family|duplex|triplex|fourplex|quadplex|2-4 unit/.test(t)) return "multi-family";
  if (/single[- ]?family|single family|sfr|detached|residential/.test(t)) return "single-family";
  return "unknown";
}

/**
 * Infer the subject's category with HOA-aware override.
 *
 * HOA > ~$200/mo is a strong signal of condo-style ownership (shared
 * building/complex, amenities, master insurance) even when a listing is
 * labelled "Townhouse" — which in many Florida/CA markets is a condo with
 * stairs. A detached SFR in a normal neighborhood pays $0 HOA. So whenever
 * the subject has a material HOA, we treat it as condo-apt regardless of the
 * raw propertyType string.
 *
 * Without HOA data, fall back to the explicit propertyType string, then to
 * heuristic (3+ beds & 1400+ sqft ≈ SFR), then to "unknown".
 */
function inferSubjectCategory(subject: SubjectSnapshot): PropertyCategory {
  // HOA override: condo-style ownership trumps whatever label we got.
  if (subject.monthlyHOA && subject.monthlyHOA >= 200) return "condo-apt";

  const explicit = categorize(subject.propertyType);
  if (explicit !== "unknown") return explicit;
  if ((subject.beds ?? 0) >= 3 && (subject.sqft ?? 0) >= 1400) return "single-family";
  return "unknown";
}

function scoreComp(
  comp: Comp,
  subject: SubjectSnapshot,
  kind: "sale" | "rent",
  subjectCategory: PropertyCategory,
): ScoredComp {
  let score = MAX_SCORE;
  const reasons: string[] = [];
  const misses: string[] = [];

  // --- property type: a wrong category is disqualifying for BOTH sale and
  //     rent. Detached SFRs trade at a materially different $/sqft than
  //     condos/apartments (for sale AND for rent) — mixing them breaks
  //     both estimates. This was too lenient historically: an SFR-dominated
  //     pool was inflating fair-value for condo-style townhouses (Boca case).
  const compCategory = categorize(comp.propertyType);
  if (subjectCategory !== "unknown" && compCategory !== "unknown") {
    const sameCat = compCategory === subjectCategory;
    const sfrLikeSubject = subjectCategory === "single-family" || subjectCategory === "townhouse";
    const sfrLikeComp = compCategory === "single-family" || compCategory === "townhouse";
    if (sameCat) {
      reasons.push(`${comp.propertyType ?? compCategory}`);
    } else if (sfrLikeSubject && sfrLikeComp) {
      // SFR ↔ townhouse: close cousins but not identical assets. A detached
      // house doesn't trade at townhouse prices, nor the reverse. Moderate
      // penalty — enough that a pool of detached SFRs won't outscore a pool
      // of actual townhouse comps.
      score -= 18;
      misses.push(`${comp.propertyType ?? compCategory} vs ${subject.propertyType ?? subjectCategory}`);
    } else {
      // Hard mismatch (SFR/townhouse vs condo/apt, or anything vs multi-family).
      // This is disqualifying for both sale and rent — they're not the same
      // asset class and shouldn't price each other.
      score -= 50;
      misses.push(
        `${comp.propertyType ?? compCategory} vs ${subject.propertyType ?? subjectCategory}`,
      );
    }
  }

  // --- beds: exact match ideal, ±1 tolerated, worse than that penalized hard.
  //     Note: `subject.beds > 0` guards against the RentCast beds=0 glitch.
  //     Bed mismatch is the single biggest rent distortion — a 1bd apartment
  //     cannot be used to rent-comp a 4bd house. Penalize aggressively.
  if (subject.beds && subject.beds > 0 && comp.bedrooms && comp.bedrooms > 0) {
    const diff = Math.abs(comp.bedrooms - subject.beds);
    if (diff === 0) reasons.push(`${comp.bedrooms}bd match`);
    else if (diff === 1) {
      score -= 14;
      misses.push(`${comp.bedrooms}bd vs subject ${subject.beds}bd`);
    } else if (diff === 2) {
      score -= 35;
      misses.push(`${comp.bedrooms}bd vs subject ${subject.beds}bd (off by 2)`);
    } else {
      // 3+ beds off is disqualifying — a 1bd/2bd can't price a 4bd/5bd.
      score -= 60;
      misses.push(`${comp.bedrooms}bd vs subject ${subject.beds}bd (off by ${diff})`);
    }
  } else if (subject.beds && subject.beds > 0 && (!comp.bedrooms || comp.bedrooms <= 0)) {
    // Subject knows its beds but comp doesn't — mild penalty so these sort
    // below real bed-matched comps.
    score -= 6;
  }

  // --- baths: half-bath grain, stricter
  if (subject.baths && comp.bathrooms) {
    const diff = Math.abs(comp.bathrooms - subject.baths);
    if (diff === 0) reasons.push(`${comp.bathrooms}ba match`);
    else if (diff <= 0.5) score -= 5;
    else if (diff <= 1) score -= 12;
    else score -= 20;
  }

  // --- sqft: % difference
  if (subject.sqft && comp.squareFootage) {
    const pct = Math.abs(comp.squareFootage - subject.sqft) / subject.sqft;
    if (pct <= 0.1) {
      score += 5; // reward very close size matches
      reasons.push(`${comp.squareFootage.toLocaleString()} sqft (within 10%)`);
    } else if (pct <= 0.2) reasons.push(`${comp.squareFootage.toLocaleString()} sqft (within 20%)`);
    else if (pct <= 0.35) score -= 8;
    else {
      score -= 18;
      misses.push(
        `${comp.squareFootage.toLocaleString()} sqft (${Math.round(pct * 100)}% off subject)`,
      );
    }
  }

  // --- distance: closer is better
  if (typeof comp.distance === "number") {
    if (comp.distance <= 0.5) {
      score += 3;
      reasons.push(`${comp.distance.toFixed(1)}mi away`);
    } else if (comp.distance <= 1) reasons.push(`${comp.distance.toFixed(1)}mi away`);
    else if (comp.distance <= 2) score -= 4;
    else if (comp.distance <= 5) score -= 10;
    else score -= 18;
  }

  // --- recency: stale comps are weaker signal (tighter for sale, looser for rent)
  const ageDays = daysSince(comp.date);
  if (ageDays !== undefined) {
    const threshold = kind === "sale" ? 120 : 240;
    if (ageDays <= 30) reasons.push("listed <30d ago");
    else if (ageDays <= threshold) {
      /* ok */
    } else if (ageDays <= threshold * 2) score -= 8;
    else {
      score -= 15;
      misses.push(`listed ${Math.round(ageDays)}d ago`);
    }
  }

  // --- days on market: high DOM on an ACTIVE listing = overpriced / stale /
  //     something wrong. This is real price-discovery signal that a comp is
  //     not actually trading at its list price. Sold comps don't carry this
  //     penalty — their DOM tells you nothing about the true market clearing
  //     price (they cleared, by definition).
  const status = (comp.status ?? "").toLowerCase();
  const isActive = status.includes("active") || status === "";
  if (isActive && typeof comp.daysOnMarket === "number" && comp.daysOnMarket > 0) {
    if (comp.daysOnMarket > 180) {
      score -= 15;
      misses.push(`${comp.daysOnMarket}d on market (stale listing)`);
    } else if (comp.daysOnMarket > 90) {
      score -= 8;
      misses.push(`${comp.daysOnMarket}d on market`);
    }
  }

  // --- year built: bucketed (new construction vs old stock commands different $/sqft)
  if (subject.yearBuilt && comp.yearBuilt) {
    const diff = Math.abs(comp.yearBuilt - subject.yearBuilt);
    if (diff <= 10) { /* great */ }
    else if (diff <= 25) score -= 3;
    else score -= 8;
  }

  const pricePerSqft =
    comp.price && comp.squareFootage && comp.squareFootage > 0
      ? comp.price / comp.squareFootage
      : undefined;

  return {
    ...comp,
    pricePerSqft,
    score: Math.max(0, Math.min(MAX_SCORE + 10, score)),
    matchReasons: reasons,
    missReasons: misses,
  };
}

function daysSince(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Derivation — compute a single number (rent or value) from scored comps.
// ---------------------------------------------------------------------------

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)));
  return s[idx];
}

function derive(
  rawComps: Comp[],
  subject: SubjectSnapshot,
  kind: "sale" | "rent",
  radiusMilesUsed: number,
): Derivation | null {
  if (rawComps.length === 0) return null;

  const subjectCategory = inferSubjectCategory(subject);

  // Score every comp.
  const scored = rawComps
    .map((c) => scoreComp(c, subject, kind, subjectCategory))
    .sort((a, b) => b.score - a.score);

  // Keep the best-scoring comps. Cap at 8 so the UI shows a digestible table.
  const MIN_USABLE_SCORE = 45; // below this, the comp is too dissimilar
  let pool = scored.filter((c) => c.score >= MIN_USABLE_SCORE).slice(0, 8);

  // For SALES only: prefer actually-sold comps over active listings when
  // ≥3 sold comps score highly. Sold prices are what the market actually
  // cleared at; active list prices are what sellers hope to get. Mixing
  // the two biases the fair-value estimate upward in any normal market.
  // We keep active comps as fallback when there aren't enough solds.
  let soldPreferred = false;
  if (kind === "sale") {
    const soldPool = pool.filter((c) => {
      const s = (c.status ?? "").toLowerCase();
      return s === "sold" || s.includes("closed") || s.includes("off-market");
    });
    if (soldPool.length >= 3) {
      pool = soldPool.slice(0, 8);
      soldPreferred = true;
    }
  }

  // If too few passed the score cutoff, try relaxing it just enough to get 3,
  // but ONLY among comps that aren't category-mismatched for rent. A condo
  // should never price-anchor a single-family rent estimate, even if it's the
  // only listing nearby — in that case we're better off returning nothing
  // (the UI falls back to the AVM at low confidence + asks the user to edit).
  if (pool.length < 3 && scored.length >= 3) {
    const notDisqualified =
      kind === "rent" && subjectCategory !== "unknown"
        ? scored.filter((c) => {
            const compCat = categorize(c.propertyType);
            if (compCat === "unknown") return true;
            const sfrLike = (x: PropertyCategory) => x === "single-family" || x === "townhouse";
            return sfrLike(subjectCategory) === sfrLike(compCat);
          })
        : scored;
    if (notDisqualified.length >= 3) {
      pool = notDisqualified.slice(0, Math.min(6, notDisqualified.length));
    } else {
      pool = scored.slice(0, Math.min(6, scored.length));
    }
  }
  if (pool.length === 0) return null;

  const workLog: string[] = [];
  const rangeLabel = radiusMilesUsed === 1 ? "within 1 mile" : `within ${radiusMilesUsed} miles`;
  const rollupTotal = pool.reduce((sum, c) => sum + (c.rolledUpCount ?? 1), 0);
  const rollupHint =
    rollupTotal > pool.length
      ? ` (${rollupTotal} raw listings collapsed to ${pool.length} buildings so no tower dominates)`
      : "";
  const soldNote = soldPreferred
    ? ` and filtered to sold-only (sold prices reflect actual market clearing, active list prices are asks)`
    : "";
  workLog.push(
    `Pulled ${rawComps.length} ${kind} comp${rawComps.length === 1 ? "" : "s"} ${rangeLabel}; scored and kept the top ${pool.length} on type/bed/bath/sqft/recency/distance${rollupHint}${soldNote}.`,
  );

  // --- Path A: we have subject sqft + ≥3 comps with sqft → $/sqft-normalized
  const compsWithSqft = pool.filter(
    (c) => c.pricePerSqft !== undefined && c.squareFootage && c.squareFootage > 0,
  );
  if (subject.sqft && subject.sqft > 0 && compsWithSqft.length >= 3) {
    const pps = compsWithSqft.map((c) => c.pricePerSqft!);
    const sqfts = compsWithSqft.map((c) => c.squareFootage!);
    const prices = compsWithSqft.map((c) => c.price!).filter((x) => x > 0);
    const mpps = median(pps);
    const p25pps = percentile(pps, 0.25);
    const p75pps = percentile(pps, 0.75);
    const compMedianSqft = median(sqfts);
    const compMedianAbs = median(prices);
    const ratio = subject.sqft / compMedianSqft;

    // For rent: when subject is much larger or much smaller than the comp
    // median, linear $/sqft scaling over-extrapolates (rent does not scale
    // proportionally with size — a 2,200sqft house doesn't rent for 2× a
    // 1,100sqft apartment). Use a submultiplicative (power-law) scaling
    // around the comp median price:
    //   rent = compMedianAbs × (subject.sqft / compMedianSqft)^0.7
    // This anchors on a real observed price, then gently scales by size.
    const linearValue = mpps * subject.sqft;
    let value = linearValue;
    let method: "median-per-sqft" | "median-absolute" | "trimmed-mean-per-sqft" =
      "median-per-sqft";
    let mathNote = "";

    const RENT_SCALING_EXPONENT = 0.7;
    const outsideLinearRange = ratio > 1.3 || ratio < 0.77;
    if (kind === "rent" && outsideLinearRange) {
      const scaled = compMedianAbs * Math.pow(ratio, RENT_SCALING_EXPONENT);
      value = scaled;
      method = "trimmed-mean-per-sqft"; // reuse this enum slot for "power-law"
      mathNote =
        `Subject is ${subject.sqft.toLocaleString()} sqft, comp median is ${Math.round(compMedianSqft).toLocaleString()} sqft (${ratio.toFixed(2)}× size). ` +
        `Rent doesn't scale linearly with size, so we anchor on the comp median rent (${fmtMoney(compMedianAbs)}/mo) and apply a sub-linear size adjustment: ` +
        `${fmtMoney(compMedianAbs)} × (${ratio.toFixed(2)})^0.7 = ${fmtMoney(Math.round(scaled / 10) * 10)}/mo.`;
    }

    const rounded =
      kind === "rent"
        ? Math.round(value / 10) * 10
        : Math.round(value / 1000) * 1000;

    workLog.push(
      kind === "sale"
        ? `Median sale price per sqft across ${compsWithSqft.length} comps: $${mpps.toFixed(0)}/sqft (p25 $${p25pps.toFixed(0)} – p75 $${p75pps.toFixed(0)}).`
        : `Median rent per sqft across ${compsWithSqft.length} comps: $${mpps.toFixed(2)}/sqft/mo (p25 $${p25pps.toFixed(2)} – p75 $${p75pps.toFixed(2)}) on comps whose median size is ${Math.round(compMedianSqft).toLocaleString()} sqft.`,
    );
    if (mathNote) {
      workLog.push(mathNote);
    } else {
      workLog.push(
        kind === "sale"
          ? `Subject is ${subject.sqft.toLocaleString()} sqft → $${mpps.toFixed(0)}/sqft × ${subject.sqft.toLocaleString()} = ${fmtMoney(rounded)}.`
          : `Subject is ${subject.sqft.toLocaleString()} sqft (within linear range) → $${mpps.toFixed(2)}/sqft × ${subject.sqft.toLocaleString()} = ${fmtMoney(rounded)}/mo.`,
      );
    }

    // Confidence: drop a level when we had to use submultiplicative scaling
    // OR when the comp median size is very different from the subject — the
    // further we extrapolate, the less defensible the number.
    let confidence = confidenceFor(compsWithSqft.length, rangeSpread(pps));
    if (method === "trimmed-mean-per-sqft") {
      confidence = confidence === "high" ? "medium" : "low";
    }

    // Report the comp band off the actual method we used so the p25/p75 band
    // matches the headline value.
    const p25Band =
      method === "trimmed-mean-per-sqft"
        ? percentile(prices, 0.25) * Math.pow(ratio, RENT_SCALING_EXPONENT)
        : p25pps * subject.sqft;
    const p75Band =
      method === "trimmed-mean-per-sqft"
        ? percentile(prices, 0.75) * Math.pow(ratio, RENT_SCALING_EXPONENT)
        : p75pps * subject.sqft;

    return {
      value: rounded,
      method,
      subjectSqft: subject.sqft,
      medianPerSqft: mpps,
      medianAbsolute: method === "trimmed-mean-per-sqft" ? compMedianAbs : undefined,
      p25: p25Band,
      p75: p75Band,
      compsUsed: pool,
      totalAvailable: rawComps.length,
      radiusMilesUsed,
      confidence,
      workLog,
    };
  }

  // --- Path B: no subject sqft (or too few sqft-bearing comps) → median absolute.
  //     Critical: when the subject has beds, we MUST restrict the median to
  //     bed-matched comps. A 1bd can't be used to price a 4bd. If we don't
  //     have enough bed-matched comps, we'd rather return null and fall back
  //     to the AVM than produce a nonsense rent number by averaging across
  //     mismatched sizes.
  let bedMatchedPool = pool;
  if (subject.beds && subject.beds > 0) {
    const bedMatched = pool.filter((c) => {
      if (!c.bedrooms || c.bedrooms <= 0) return false;
      return Math.abs(c.bedrooms - subject.beds!) <= 1;
    });
    if (bedMatched.length >= 3) {
      bedMatchedPool = bedMatched;
    }
  }

  const prices = bedMatchedPool.map((c) => c.price!).filter((x) => x && x > 0);
  if (prices.length < 3) {
    workLog.push(
      `Only ${prices.length} bed/bath-matched ${kind} comp${prices.length === 1 ? "" : "s"} after scoring — not enough for a reliable median, falling back to AVM.`,
    );
    return null;
  }
  const medAbs = median(prices);
  const p25 = percentile(prices, 0.25);
  const p75 = percentile(prices, 0.75);

  const bedMatchNote =
    subject.beds && bedMatchedPool !== pool
      ? `filtered to ${bedMatchedPool.length} comp${bedMatchedPool.length === 1 ? "" : "s"} within ±1 bed of subject's ${subject.beds}bd; `
      : "";
  workLog.push(
    `${subject.sqft ? "Too few comps with sqft on file" : "Subject has no sqft on file"} — ${bedMatchNote}using median absolute ${kind === "sale" ? "price" : "rent"} across ${prices.length} comps: ${fmtMoney(medAbs)}${kind === "rent" ? "/mo" : ""} (p25 ${fmtMoney(p25)} – p75 ${fmtMoney(p75)}).`,
  );
  return {
    value: medAbs,
    method: "median-absolute",
    medianAbsolute: medAbs,
    p25,
    p75,
    compsUsed: bedMatchedPool,
    totalAvailable: rawComps.length,
    radiusMilesUsed,
    confidence: confidenceFor(prices.length, rangeSpread(prices)),
    workLog,
  };
}

function rangeSpread(xs: number[]): number {
  if (xs.length < 2) return Infinity;
  const med = median(xs);
  if (med === 0) return Infinity;
  const p25 = percentile(xs, 0.25);
  const p75 = percentile(xs, 0.75);
  return (p75 - p25) / med; // interquartile range as fraction of median
}

function confidenceFor(n: number, spread: number): "high" | "medium" | "low" {
  if (n >= 6 && spread <= 0.25) return "high";
  if (n >= 4 && spread <= 0.4) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Market anchors — cross-check comp-derived sale value against:
//   1. The property's last-sale price rolled forward by expected appreciation
//   2. The current active list price (if any)
//
// Comps are directional; last-sale and list price are actionable market truth
// about THIS specific unit. When comps say $620k but the seller is actively
// listing at $400k and sold for $400k three years ago, the comps are wrong
// (usually: wrong property type in the pool). We blend toward the anchors,
// downgrade confidence, and explain the divergence in the workLog.
// ---------------------------------------------------------------------------

type MarketAnchor = { label: string; value: number; weight: number };

function collectMarketAnchors(subject: SubjectSnapshot): MarketAnchor[] {
  const out: MarketAnchor[] = [];

  // Last sale, rolled forward. Weight decays with age (recent sale = stronger
  // signal). We cap at 6 years because beyond that, the price is stale.
  if (subject.lastSalePrice && subject.lastSalePrice > 0 && subject.lastSaleDate) {
    const t = Date.parse(subject.lastSaleDate);
    if (Number.isFinite(t)) {
      const yearsAgo = (Date.now() - t) / (1000 * 60 * 60 * 24 * 365.25);
      if (yearsAgo > 0 && yearsAgo <= 6) {
        const appreciation = subject.expectedAppreciation ?? 0.03;
        const impliedToday = subject.lastSalePrice * Math.pow(1 + appreciation, yearsAgo);
        // Weight: 1.0 for a fresh sale (<1yr), fading linearly to 0.25 at 6yr.
        const weight = Math.max(0.25, 1 - (yearsAgo - 1) * 0.15);
        out.push({
          label: `last sold ${fmtMoney(subject.lastSalePrice)} (${yearsAgo.toFixed(1)}y ago) → ~${fmtMoney(Math.round(impliedToday / 1000) * 1000)} today at ${(appreciation * 100).toFixed(1)}%/yr`,
          value: impliedToday,
          weight,
        });
      }
    }
  }

  // Active list price is strong recent market signal.
  if (subject.currentListPrice && subject.currentListPrice > 0) {
    out.push({
      label: `current list price ${fmtMoney(subject.currentListPrice)}`,
      value: subject.currentListPrice,
      weight: 1.0,
    });
  }

  return out;
}

/**
 * Apply market anchors to a preliminary sale-value derivation. Mutates the
 * derivation (updates value, confidence, p25/p75 band, workLog).
 *
 * Policy:
 *   - No anchors available → no change.
 *   - Anchors agree with comps within 12% → add a confirmation note. Confidence unchanged.
 *   - Agree within 12–25% → add a "some divergence" note. Confidence trimmed one level.
 *   - Disagree by >25% → blend 35% comp + 65% anchors. Confidence forced to "low". Add a
 *     prominent explanation to the workLog and rebase the p25/p75 band around the new value.
 */
function applyMarketAnchorsToSale(
  derivation: Derivation,
  subject: SubjectSnapshot,
): void {
  const anchors = collectMarketAnchors(subject);
  if (anchors.length === 0) return;

  const totalWeight = anchors.reduce((s, a) => s + a.weight, 0);
  if (totalWeight <= 0) return;
  const anchorWeightedAvg =
    anchors.reduce((s, a) => s + a.value * a.weight, 0) / totalWeight;

  const derived = derivation.value;
  if (derived <= 0) return;
  const divergence = Math.abs(derived - anchorWeightedAvg) / anchorWeightedAvg;

  const anchorSummary = anchors.map((a) => a.label).join("; ");

  if (divergence < 0.12) {
    derivation.workLog.push(
      `Cross-check ✓ — comp-derived value agrees with market anchors (${anchorSummary}). Confidence holds.`,
    );
    return;
  }

  if (divergence < 0.25) {
    derivation.workLog.push(
      `Cross-check — some divergence from market anchors (${anchorSummary}). Noted as "some divergence but within normal range"; confidence trimmed one level.`,
    );
    if (derivation.confidence === "high") derivation.confidence = "medium";
    else if (derivation.confidence === "medium") derivation.confidence = "low";
    return;
  }

  // Material divergence. Anchors win — the market has already voted on THIS
  // unit. Blend 35% comp + 65% anchors, rebase the band, and call it out.
  const COMP_WEIGHT = 0.35;
  const ANCHOR_WEIGHT = 0.65;
  const blended = COMP_WEIGHT * derived + ANCHOR_WEIGHT * anchorWeightedAvg;
  const rounded = Math.round(blended / 1000) * 1000;

  // Rebase the p25/p75 band proportionally so the UI "comp band" stays
  // consistent with the new headline. If the old band was ±15% of derived,
  // keep ±15% of the new value.
  if (derivation.p25 && derivation.p75 && derived > 0) {
    const lowScale = derivation.p25 / derived;
    const highScale = derivation.p75 / derived;
    derivation.p25 = rounded * lowScale;
    derivation.p75 = rounded * highScale;
  }

  derivation.value = rounded;
  derivation.confidence = "low";
  derivation.workLog.push(
    `Sanity check: comp-derived ${fmtMoney(Math.round(derived / 1000) * 1000)} disagrees with market anchors by ${(divergence * 100).toFixed(0)}% — ${anchorSummary}.`,
  );
  derivation.workLog.push(
    `The market anchors are stronger signal than nearby comps for this specific unit (they reflect what this exact property has actually transacted at). Blending 35% comp + 65% anchors → ${fmtMoney(rounded)}. If you believe the comps below are apples-to-apples for this unit, the headline could go higher; otherwise treat the anchors as ground truth and verify the comp list for type/size mismatches.`,
  );
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function analyzeComparables(
  subject: SubjectSnapshot,
  comps: CompsResult | null,
): ComparablesAnalysis {
  // Defensively treat beds/baths <= 0 as unknown. RentCast sometimes returns
  // 0 for old public-records rows and callers can legitimately pass 0 from a
  // URL query string. Either way, 0 must not silently disable comp filters.
  const cleanSubject: SubjectSnapshot = {
    ...subject,
    beds: subject.beds && subject.beds > 0 ? subject.beds : undefined,
    baths: subject.baths && subject.baths > 0 ? subject.baths : undefined,
    sqft: subject.sqft && subject.sqft > 0 ? subject.sqft : undefined,
  };

  if (!comps) return { subject: cleanSubject, marketValue: null, marketRent: null };

  const marketValue = derive(
    comps.saleComps.items,
    cleanSubject,
    "sale",
    comps.radiusMilesUsed,
  );
  const marketRent = derive(
    comps.rentComps.items,
    cleanSubject,
    "rent",
    comps.radiusMilesUsed,
  );

  // Cross-check the comp-derived sale value against last-sale and current list
  // price — these reflect what the market has actually paid/is paying for THIS
  // specific unit, and override a mistyped comp pool (e.g. SFR comps on a
  // condo-style townhouse).
  if (marketValue) {
    applyMarketAnchorsToSale(marketValue, cleanSubject);
  }

  return { subject: cleanSubject, marketValue, marketRent };
}
