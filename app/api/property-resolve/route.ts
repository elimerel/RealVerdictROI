import type { NextRequest } from "next/server";
import type { DealInputs } from "@/lib/calculations";
import {
  detectStateFromAddress,
  estimateAnnualInsurance,
  estimateAnnualPropertyTax,
  type Estimate,
  type StateCode,
} from "@/lib/estimators";
import { fetchComps, type CompsResult } from "@/lib/comps";
import {
  analyzeComparables,
  type ComparablesAnalysis,
} from "@/lib/comparables";
import { KVCache } from "@/lib/kv-cache";
import { getCurrentMortgageRate, fredRateNote } from "@/lib/rates";
import {
  getMetroAppreciation,
  metroAppreciationNote,
  zipFromAddress,
  type MetroAppreciation,
} from "@/lib/appreciation";
import {
  geocodeAddress,
  getFloodZone,
  floodInsuranceBump,
  floodInsuranceNote,
  type FloodZone,
} from "@/lib/flood";
import { enforceRateLimit } from "@/lib/ratelimit";
import { withErrorReporting, logEvent } from "@/lib/observability";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProvenanceSource =
  | "rentcast"           // pulled from RentCast property/AVM data
  | "rent-comps"         // median of nearby long-term rent comps
  | "zillow-listing"     // scraped from a Zillow listing
  | "state-average"      // computed from per-state rate tables
  | "national-average"   // last-resort national fallback
  | "fred"               // FRED macro series (e.g. Freddie Mac PMMS 30yr fixed)
  | "fhfa-hpi"           // FHFA Purchase-Only HPI metro-level trailing CAGR
  | "fema-nfhl"          // FEMA National Flood Hazard Layer (flood zone → insurance bump)
  | "default"            // canonical default from DEFAULT_INPUTS
  | "user";              // user has overridden — NOT set by server, only client

export type FieldProvenance = {
  source: ProvenanceSource;
  confidence: "high" | "medium" | "low";
  /** Short human-readable explanation, surfaced as a tooltip. */
  note: string;
};

export type ResolveResult = {
  /** Canonical address echoed back. */
  address?: string;
  /** Detected US state code, if any. */
  state?: StateCode;
  /** Property facts (informational, not used by the calc engine). */
  facts: {
    bedrooms?: number;
    bathrooms?: number;
    squareFootage?: number;
    yearBuilt?: number;
    propertyType?: string;
    lotSize?: number;
    lastSalePrice?: number;
    lastSaleDate?: string;
    /** Approximate lat/lng of the subject — from RentCast or Zillow when
     *  available, else Census geocoded. Used for flood zone lookup. */
    latitude?: number;
    longitude?: number;
    /** FEMA NFHL flood zone classification when we could determine one. */
    floodZone?: {
      zone: string;
      risk: "high" | "moderate" | "low";
      label: string;
      isCoastalHigh: boolean;
    };
  };
  /** Inputs to merge into DealInputs. Only fields we resolved are present. */
  inputs: Partial<DealInputs>;
  /** Per-field provenance for every key that was filled. */
  provenance: Partial<Record<keyof DealInputs, FieldProvenance>>;
  /** Top-level notes for the UI to surface as a status line. */
  notes: string[];
  /** Soft warnings the user should see (e.g. "Insurance is rough"). */
  warnings: string[];
  /**
   * Full comparables analysis (subject + sale comps + rent comps + derivations
   * + workLog). Populated whenever we had an address and RentCast returned
   * data. The UI uses this to show "how we got these numbers".
   */
  comparables?: ComparablesAnalysis;
};

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

const cache = new KVCache<ResolveResult>(
  "resolver",
  24 * 60 * 60 * 1000,
);

// Bump this when resolver behavior changes so stale in-memory cache entries
// (including in-dev Fast Refresh) are invalidated.
//   v2 = smart multi-source rent resolution (comp median beats AVM)
//   v3 = comp-derived rent & value via $/sqft normalization + workLog returned
//   v4 = rent comp fallback for multi-family (drop bed filter when thin)
//   v5 = dedupe-by-building + SFR/condo weighting + sqft-ratio submultiplicative
//        rent scaling + treat RentCast beds=0 as unknown
//   v6 = HOA-aware category override (condo-style townhouse no longer priced
//        off SFR comps) + market-anchor cross-check (last sale + current list
//        price override a mistyped comp pool) + harder SFR↔condo penalty
//   v7 = FRED-driven loanInterestRate default (live Freddie Mac 30yr fixed)
//   v8 = FHFA-HPI-driven annualAppreciationPercent default + feeds the
//        market-anchor last-sale roll-forward inside analyzeComparables
//   v9 = FEMA NFHL flood zone detection + SFHA/VE insurance bump
//   v10 = FEMA timeout bumped to 12s + empty-feature cache shortened to 1h
//   v11 = RentCast Stage 1 cost reduction — /avm/value and /avm/rent calls
//        removed, radius ladder shortened [3,10], rent fallback trimmed to
//        strict + no-baths. Cache keys are forcibly invalidated so any
//        stale v10 entry that still carries the dropped rentcast provenance
//        doesn't leak through.
const CACHE_VERSION = "v11";

export const GET = withErrorReporting(
  "api.property-resolve.GET",
  async (req: NextRequest) => {
    const limited = await enforceRateLimit(req, "property-resolve");
    if (limited) return limited;

    const address = req.nextUrl.searchParams.get("address")?.trim();
    if (!address || address.length < 5) {
      return Response.json(
        {
          error:
            "Provide a full street address, e.g. '2315 Ave H, Austin, TX 78722'.",
        },
        { status: 400 },
      );
    }

    const cacheKey = `${CACHE_VERSION}:addr:${normalizeForCache(address)}`;
    const hit = await cache.get(cacheKey);
    if (hit) {
      logEvent("property-resolve.cache.hit", { mode: "address" });
      return Response.json(hit);
    }

    const result = await resolveByAddress(address);
    await cache.set(cacheKey, result);
    logEvent("property-resolve.resolved", {
      mode: "address",
      state: result.state,
      hasFacts: Object.keys(result.facts).length > 0,
      warnings: result.warnings?.length ?? 0,
    });
    return Response.json(result);
  },
);

export const POST = withErrorReporting(
  "api.property-resolve.POST",
  async (req: NextRequest) => {
    const limited = await enforceRateLimit(req, "property-resolve");
    if (limited) return limited;

    let body: { url?: string; address?: string };
    try {
      body = (await req.json()) as { url?: string; address?: string };
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const url = body?.url?.trim();
    if (url && /zillow\.com\/homedetails/i.test(url)) {
      const cacheKey = `${CACHE_VERSION}:zillow:${url}`;
      const hit = await cache.get(cacheKey);
      if (hit) {
        logEvent("property-resolve.cache.hit", { mode: "zillow" });
        return Response.json(hit);
      }
      const result = await resolveByZillowUrl(url, req);
      await cache.set(cacheKey, result);
      logEvent("property-resolve.resolved", {
        mode: "zillow",
        state: result.state,
        warnings: result.warnings?.length ?? 0,
      });
      return Response.json(result);
    }

    const address = body?.address?.trim();
    if (address) {
      const cacheKey = `${CACHE_VERSION}:addr:${normalizeForCache(address)}`;
      const hit = await cache.get(cacheKey);
      if (hit) {
        logEvent("property-resolve.cache.hit", { mode: "address" });
        return Response.json(hit);
      }
      const result = await resolveByAddress(address);
      await cache.set(cacheKey, result);
      logEvent("property-resolve.resolved", {
        mode: "address",
        state: result.state,
        warnings: result.warnings?.length ?? 0,
      });
      return Response.json(result);
    }

    return Response.json(
      { error: "Provide either a Zillow URL or a street address." },
      { status: 400 },
    );
  },
);

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

async function resolveByAddress(address: string): Promise<ResolveResult> {
  const result: ResolveResult = emptyResult();
  result.address = address;
  result.state = detectStateFromAddress(address);

  const rentcast = await fetchRentcast(address);
  if (rentcast) {
    if (rentcast.address) result.address = rentcast.address;
    // RentCast sometimes returns bedrooms: 0 for older public-records rows
    // (especially pre-1940 homes). That's "unknown", not a studio — merging
    // it as 0 would silently disable the bed filter in comp search and let
    // 2bd condos match against a 4bd house.
    const sanitized = { ...rentcast.facts };
    if (sanitized.bedrooms !== undefined && sanitized.bedrooms <= 0)
      delete sanitized.bedrooms;
    if (sanitized.bathrooms !== undefined && sanitized.bathrooms <= 0)
      delete sanitized.bathrooms;
    Object.assign(result.facts, sanitized);

    if (rentcast.annualPropertyTax) {
      result.inputs.annualPropertyTax = rentcast.annualPropertyTax;
      result.provenance.annualPropertyTax = {
        source: "rentcast",
        confidence: "high",
        note: "Most recent year of public-record tax bill from RentCast.",
      };
    }

    result.notes.push(...rentcast.notes);

    const metro = applyMetroAppreciation(result);
    await resolveFromComparables(result, {}, metro);
  } else {
    result.notes.push("RentCast lookup unavailable — using estimates.");
    const metro = applyMetroAppreciation(result);
    await resolveFromComparables(result, {}, metro);
  }

  await enrichWithEstimates(result);
  return result;
}

async function resolveByZillowUrl(
  url: string,
  req: NextRequest,
): Promise<ResolveResult> {
  const result: ResolveResult = emptyResult();

  const origin = new URL(req.url).origin;

  // Step 1: scrape the Zillow listing. This either returns rich data, OR a
  // url-fallback shape with just the address parsed from the URL slug.
  const res = await fetch(`${origin}/api/zillow-parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  type ZillowParseResult = {
    source: "scraperapi" | "url-fallback";
    address?: string;
    facts?: {
      beds?: number;
      baths?: number;
      sqft?: number;
      yearBuilt?: number;
      lotSize?: number;
      propertyType?: string;
    };
    listing?: {
      listPrice?: number;
      zestimate?: number;
      rentZestimate?: number;
      monthlyHoa?: number;
      annualPropertyTax?: number;
      annualInsurance?: number;
      pricePerSqft?: number;
      listingStatus?: string;
      daysOnZillow?: number;
    };
    notes?: string[];
  };

  let zillow: ZillowParseResult | null = null;
  if (res.ok) {
    zillow = (await res.json()) as ZillowParseResult;
  } else {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    result.warnings.push(
      payload?.error ?? `Zillow parse failed (HTTP ${res.status}).`,
    );
  }

  if (zillow?.address) result.address = zillow.address;
  result.state = detectStateFromAddress(result.address ?? "");

  if (zillow?.facts) {
    result.facts = {
      bedrooms: zillow.facts.beds,
      bathrooms: zillow.facts.baths,
      squareFootage: zillow.facts.sqft,
      yearBuilt: zillow.facts.yearBuilt,
      propertyType: zillow.facts.propertyType,
    };
  }

  // Apply Zillow listing fields with provenance. For off-market / sold
  // listings, fall back to the Zestimate so the user still gets a starting
  // point (RentCast AVM may later overwrite this if more confident).
  if (zillow?.listing?.listPrice) {
    result.inputs.purchasePrice = zillow.listing.listPrice;
    result.provenance.purchasePrice = {
      source: "zillow-listing",
      confidence: "high",
      note: zillow.listing.listingStatus
        ? `${zillow.listing.listingStatus} on Zillow.`
        : "List price from the Zillow listing.",
    };
  } else if (zillow?.listing?.zestimate) {
    result.inputs.purchasePrice = zillow.listing.zestimate;
    result.provenance.purchasePrice = {
      source: "zillow-listing",
      confidence: "medium",
      note: `No active list price (${zillow.listing.listingStatus ?? "off-market"}). Using Zillow's Zestimate as the starting price — adjust to your actual offer.`,
    };
  }
  // Rent is resolved AFTER RentCast + comps are fetched below (see
  // resolveMonthlyRent). Track the Zillow rentZestimate as a candidate here.
  const zillowRentZestimate = zillow?.listing?.rentZestimate;
  if (zillow?.listing?.annualPropertyTax) {
    result.inputs.annualPropertyTax = zillow.listing.annualPropertyTax;
    result.provenance.annualPropertyTax = {
      source: "zillow-listing",
      confidence: "high",
      note: "Most recent year of public-record tax from the Zillow listing.",
    };
  }
  if (zillow?.listing?.annualInsurance) {
    result.inputs.annualInsurance = zillow.listing.annualInsurance;
    result.provenance.annualInsurance = {
      source: "zillow-listing",
      confidence: "low",
      note: "Insurance estimate shown on the listing's monthly-cost widget — verify with a real quote.",
    };
  }
  if (zillow?.listing?.monthlyHoa) {
    result.inputs.monthlyHOA = zillow.listing.monthlyHoa;
    result.provenance.monthlyHOA = {
      source: "zillow-listing",
      confidence: "high",
      note: "HOA fee from the Zillow listing.",
    };
  }

  if (zillow?.notes) result.notes.push(...zillow.notes);

  // Step 2: ALSO call RentCast in parallel so we get public-records data
  // (rent AVM, value AVM, more accurate tax bill). Anything Zillow already
  // gave us wins; RentCast fills the gaps.
  if (result.address) {
    const rentcast = await fetchRentcast(result.address);
    if (rentcast) {
      // Merge facts (don't overwrite — Zillow's listing data is more recent
      // for an active listing). Treat RentCast's bedrooms/bathrooms <= 0 as
      // "unknown" (common glitch on old homes) so they don't silently
      // disable the comp bed filter.
      const rcBeds =
        rentcast.facts.bedrooms && rentcast.facts.bedrooms > 0
          ? rentcast.facts.bedrooms
          : undefined;
      const rcBaths =
        rentcast.facts.bathrooms && rentcast.facts.bathrooms > 0
          ? rentcast.facts.bathrooms
          : undefined;
      result.facts = {
        bedrooms: result.facts.bedrooms ?? rcBeds,
        bathrooms: result.facts.bathrooms ?? rcBaths,
        squareFootage:
          result.facts.squareFootage ?? rentcast.facts.squareFootage,
        yearBuilt: result.facts.yearBuilt ?? rentcast.facts.yearBuilt,
        propertyType: result.facts.propertyType ?? rentcast.facts.propertyType,
        lastSalePrice: rentcast.facts.lastSalePrice,
        lastSaleDate: rentcast.facts.lastSaleDate,
        // Carry RentCast's geocoded coordinates through the Zillow flow so
        // FEMA flood zone lookup works without a Census geocode fallback.
        // (A3 regression — Zillow-URL analyses were silently skipping flood
        // enrichment whenever the scraper didn't ship lat/lng of its own.)
        latitude: result.facts.latitude ?? rentcast.facts.latitude,
        longitude: result.facts.longitude ?? rentcast.facts.longitude,
      };

      if (
        rentcast.annualPropertyTax &&
        (!result.inputs.annualPropertyTax ||
          (result.provenance.annualPropertyTax?.confidence !== "high"))
      ) {
        result.inputs.annualPropertyTax = rentcast.annualPropertyTax;
        result.provenance.annualPropertyTax = {
          source: "rentcast",
          confidence: "high",
          note: "Most recent year of public-record tax from RentCast.",
        };
      }
      if (rentcast.notes.length > 0)
        result.notes.push(...rentcast.notes.map((n) => `RentCast: ${n}`));

      const metro = applyMetroAppreciation(result);
      await resolveFromComparables(
        result,
        { zillowRentZestimate },
        metro,
      );
    } else {
      const metro = applyMetroAppreciation(result);
      await resolveFromComparables(
        result,
        { zillowRentZestimate },
        metro,
      );
    }
  } else {
    const metro = applyMetroAppreciation(result);
    await resolveFromComparables(result, { zillowRentZestimate }, metro);
  }

  await enrichWithEstimates(result);
  return result;
}

// ---------------------------------------------------------------------------
// Estimators — fill in fields no upstream gave us, badged with provenance.
// ---------------------------------------------------------------------------

async function enrichWithEstimates(result: ResolveResult): Promise<void> {
  const value = result.inputs.purchasePrice;

  if (value && !result.inputs.annualInsurance) {
    const est = estimateAnnualInsurance(value, result.state);
    result.inputs.annualInsurance = est.value;
    result.provenance.annualInsurance = estimateToProvenance(est);
    if (est.confidence === "low") result.warnings.push(est.note);
  }

  if (value && !result.inputs.annualPropertyTax) {
    const est = estimateAnnualPropertyTax(value, result.state);
    result.inputs.annualPropertyTax = est.value;
    result.provenance.annualPropertyTax = estimateToProvenance(est);
    if (est.confidence === "low") result.warnings.push(est.note);
  }

  // Two network enrichments that don't depend on each other: live FRED
  // mortgage rate and FEMA NFHL flood zone. Run them in parallel so autofill
  // latency is max(FRED, FEMA) rather than the sum.
  const [fred, floodZone] = await Promise.all([
    getCurrentMortgageRate(),
    applyFloodAssessment(result),
  ]);

  // Live 30-year fixed mortgage rate from FRED. Overwrites the form default
  // unless the user already touched it (they wouldn't have on resolver GET —
  // the frontend clears provenance only on local edits). The point is: when a
  // user autofills a deal, the rate they see reflects the market this week,
  // not whatever we hard-coded into DEFAULT_INPUTS.
  if (fred) {
    result.inputs.loanInterestRate = Number(fred.rate.toFixed(3));
    result.provenance.loanInterestRate = {
      source: "fred",
      confidence: "high",
      note: fredRateNote(fred),
    };
  }

  // Flood insurance bump. State-avg HO3 doesn't include NFIP / private flood,
  // so for any property in an SFHA or V-zone we add a realistic flood premium
  // delta on top of whatever insurance number we already had. We do this
  // regardless of whether the prior source was the state estimator or a
  // Zillow listing widget — both ignore flood, and the widget especially is
  // unreliable.
  if (floodZone && floodZone.risk !== "low") {
    const bump = floodInsuranceBump(floodZone);
    if (bump > 0) {
      const base = result.inputs.annualInsurance ?? 0;
      const bumped = base + bump;
      result.inputs.annualInsurance = bumped;
      const priorNote = result.provenance.annualInsurance?.note ?? "";
      result.provenance.annualInsurance = {
        source: "fema-nfhl",
        confidence: "medium",
        note: `${floodInsuranceNote(floodZone, bump)}${priorNote ? ` · Base: ${priorNote}` : ""}`,
      };
      result.warnings.push(
        `Subject sits in FEMA Zone ${floodZone.zone} — flood insurance is ${floodZone.risk === "high" ? "mandatory with a federally-backed mortgage" : "strongly recommended"}. Real quote depends on elevation and BFE.`,
      );
    }
  }

  // Rent is already comp-derived in resolveFromComparables; we no longer need
  // the separate GRM sanity pass (the comp derivation is the source of truth).
}

/**
 * Determine the FEMA flood zone for the subject and stamp it onto
 * `result.facts.floodZone`. Returns the zone for the caller to use when
 * applying insurance bumps. Returns null when we can't geolocate the
 * address or FEMA didn't return a polygon for the point.
 *
 * Prefers RentCast's lat/lng when present; falls back to the Census
 * Geocoder (free, no key). Both lookups cache aggressively — this whole
 * function is usually a no-op for repeat resolver hits.
 */
async function applyFloodAssessment(
  result: ResolveResult,
): Promise<FloodZone | null> {
  let lat = result.facts.latitude;
  let lng = result.facts.longitude;
  if (lat == null || lng == null) {
    if (!result.address) return null;
    const geo = await geocodeAddress(result.address);
    if (!geo) return null;
    lat = geo.lat;
    lng = geo.lng;
    result.facts.latitude = lat;
    result.facts.longitude = lng;
  }
  const zone = await getFloodZone(lat, lng);
  if (!zone) return null;
  result.facts.floodZone = {
    zone: zone.zone,
    risk: zone.risk,
    label: zone.label,
    isCoastalHigh: zone.isCoastalHigh,
  };
  return zone;
}

/**
 * Derive market rent AND fair value from nearby comparables, normalized by
 * $/sqft when the subject has sqft, otherwise by bed-matched medians.
 *
 * This is the core pricing engine. It replaces AVM-last-wins with a real
 * comp-driven derivation that returns the subject, the top comps used, the
 * median $/sqft, and a human-readable workLog the UI can display as
 * "how we got these numbers". We NEVER silently hand back a garbage AVM.
 */
/**
 * Populate annualAppreciationPercent + provenance from FHFA metro HPI, if
 * the subject's zip falls inside an FHFA top-100 metro. Returns the matched
 * metro (so callers can forward it to analyzeComparables as expectedAppreciation)
 * or null when we're falling back to DEFAULT_INPUTS for this deal.
 *
 * This mutates `result.inputs` and `result.provenance`.
 */
function applyMetroAppreciation(
  result: ResolveResult,
): MetroAppreciation | null {
  const zip = zipFromAddress(result.address);
  const metro = getMetroAppreciation(zip);
  if (!metro) return null;
  result.inputs.annualAppreciationPercent = Number(metro.rate.toFixed(2));
  result.provenance.annualAppreciationPercent = {
    source: "fhfa-hpi",
    confidence: "high",
    note: metroAppreciationNote(metro),
  };
  return metro;
}

async function resolveFromComparables(
  result: ResolveResult,
  candidates: {
    zillowRentZestimate?: number;
  },
  metro: MetroAppreciation | null = null,
): Promise<void> {
  // Coerce zero/undefined to proper undefined everywhere downstream, so a
  // RentCast "0 beds" public-records glitch doesn't silently turn off the bed
  // filter. `analyzeComparables` already does the same sanitation defensively.
  const subjectBeds =
    result.facts.bedrooms && result.facts.bedrooms > 0
      ? result.facts.bedrooms
      : undefined;
  const subjectBaths =
    result.facts.bathrooms && result.facts.bathrooms > 0
      ? result.facts.bathrooms
      : undefined;

  // 1. Pull comps (always — we need them to defend every number on the page).
  let comps: CompsResult | null = null;
  if (result.address) {
    try {
      comps = await fetchComps({
        address: result.address,
        beds: subjectBeds,
        baths: subjectBaths,
        sqft: result.facts.squareFootage,
        // Deliberately NOT passing propertyType as a RentCast filter — their
        // enum is inconsistent ("Single Family" vs "Single Family Home") and
        // returns empty sets too often. Instead, we score propertyType
        // mismatches down in comparables.ts so condo/apartment comps never
        // drive a single-family rent estimate.
      });
    } catch {
      // comps are a nice-to-have — proceed without
    }
  }

  // 2. Run the comparables analysis (scoring, $/sqft normalization, workLog).
  //    We pass HOA, last-sale, and the currently-listed price so the
  //    derivation engine can HOA-override the category (condo-style townhouse
  //    doesn't get priced off detached SFRs) and cross-check its output
  //    against the market's own pricing of THIS specific unit.
  const listPriceProv = result.provenance.purchasePrice;
  const currentListPrice =
    listPriceProv?.source === "zillow-listing" && listPriceProv?.confidence === "high"
      ? result.inputs.purchasePrice
      : undefined;
  const analysis = analyzeComparables(
    {
      address: result.address ?? "",
      price: result.inputs.purchasePrice,
      sqft: result.facts.squareFootage,
      beds: subjectBeds,
      baths: subjectBaths,
      yearBuilt: result.facts.yearBuilt,
      propertyType: result.facts.propertyType,
      monthlyHOA: result.inputs.monthlyHOA,
      lastSalePrice: result.facts.lastSalePrice,
      lastSaleDate: result.facts.lastSaleDate,
      currentListPrice,
      // If we have a metro-level CAGR, roll the last-sale anchor forward at
      // that rate instead of the blanket 3% fallback. This is the link from
      // FHFA HPI → comparables market-anchor cross-check (see §16.E).
      expectedAppreciation: metro ? metro.rate / 100 : undefined,
    },
    comps,
  );
  result.comparables = analysis;

  // 3. RENT — prefer the comp derivation, fall back to AVMs only if comps are
  //    empty. We do NOT second-guess the derived number against GRM bounds
  //    because the derivation is already anchored in local reality.
  if (analysis.marketRent) {
    result.inputs.monthlyRent = Math.round(analysis.marketRent.value / 10) * 10;
    result.provenance.monthlyRent = {
      source: "rent-comps",
      confidence: analysis.marketRent.confidence,
      note:
        analysis.marketRent.method === "median-per-sqft" && analysis.marketRent.medianPerSqft
          ? `Derived from ${analysis.marketRent.compsUsed.length} nearby long-term rent comps at $${analysis.marketRent.medianPerSqft.toFixed(2)}/sqft × ${analysis.marketRent.subjectSqft?.toLocaleString()} sqft. See "How we got this" for the comps used.`
          : `Median of ${analysis.marketRent.compsUsed.length} bed/bath-matched rent comps nearby. See "How we got this" for the comps used.`,
    };
  } else if (candidates.zillowRentZestimate) {
    result.inputs.monthlyRent = candidates.zillowRentZestimate;
    result.provenance.monthlyRent = {
      source: "zillow-listing",
      confidence: "low",
      note: "No rent comps available; using Zillow's rent Zestimate. Adjust manually if you know the local market.",
    };
  }
  // If nothing is available we simply leave monthlyRent unset — the form's
  // default will kick in and the provenance badge will say "Default", making
  // it obvious the user needs to fill it in.

  // 4. FAIR VALUE — if the user has an active listing price (high confidence)
  //    we leave it alone; the comp-derived value shows up alongside as a sanity
  //    check in the "How we got this" panel. If all we have is a Zestimate or
  //    AVM and the comps say something materially different, use the comp
  //    derivation as the price (it's the defensible number).
  const priceProvenance = result.provenance.purchasePrice;
  const hasListedPrice =
    priceProvenance?.confidence === "high" && priceProvenance.source === "zillow-listing";
  if (!hasListedPrice && analysis.marketValue) {
    const current = result.inputs.purchasePrice;
    const derived = analysis.marketValue.value;
    if (!current) {
      result.inputs.purchasePrice = derived;
      result.provenance.purchasePrice = {
        source: "rent-comps",
        confidence: analysis.marketValue.confidence,
        note:
          analysis.marketValue.method === "median-per-sqft" && analysis.marketValue.medianPerSqft
            ? `Derived from ${analysis.marketValue.compsUsed.length} nearby sale comps at $${analysis.marketValue.medianPerSqft.toFixed(0)}/sqft × ${analysis.marketValue.subjectSqft?.toLocaleString()} sqft.`
            : `Median of ${analysis.marketValue.compsUsed.length} bed/bath-matched sale comps nearby.`,
      };
    }
    // If we DO have a Zestimate/AVM price and the comp derivation disagrees by
    // more than 20%, note it — but don't silently replace the number, since
    // the user's offer conversation usually anchors on the listed / Zestimate.
  }
}

function estimateToProvenance(est: Estimate): FieldProvenance {
  return {
    source: est.source.startsWith("state") ? "state-average" : "national-average",
    confidence: est.confidence,
    note: est.note,
  };
}

// ---------------------------------------------------------------------------
// RentCast helper — single /properties call for subject facts + geocoding.
// Rent and value derivation happens in resolveFromComparables off the comp
// pool, so we deliberately do NOT call /avm/rent/long-term or /avm/value
// here anymore (those AVMs were being thrown away in practice and cost 2
// RentCast requests per analysis for no behavioral benefit).
// ---------------------------------------------------------------------------

type RentcastBundle = {
  address?: string;
  facts: ResolveResult["facts"];
  annualPropertyTax?: number;
  notes: string[];
};

async function fetchRentcast(address: string): Promise<RentcastBundle | null> {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) return null;

  type RentcastFn = <T>(
    path: string,
    params: Record<string, string>,
  ) => Promise<{ ok: true; data: T } | { ok: false; error: string }>;

  const rentcast: RentcastFn = async <T>(
    path: string,
    params: Record<string, string>,
  ) => {
    const url = new URL(`https://api.rentcast.io/v1${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (process.env.RENTCAST_TRACE === "1") {
      console.log(`[rentcast-trace] resolver ${path}`);
    }
    try {
      const res = await fetch(url.toString(), {
        headers: { "X-Api-Key": apiKey, Accept: "application/json" },
        next: { revalidate: 86_400 },
      });
      if (!res.ok) {
        if (res.status === 404)
          return { ok: false as const, error: "no data for this address" };
        if (res.status === 401)
          return { ok: false as const, error: "invalid RentCast API key" };
        return { ok: false as const, error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as T;
      return { ok: true as const, data };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "network error",
      };
    }
  };

  type PropertyRecord = {
    formattedAddress?: string;
    propertyType?: string;
    bedrooms?: number;
    bathrooms?: number;
    squareFootage?: number;
    yearBuilt?: number;
    lastSalePrice?: number;
    lastSaleDate?: string;
    latitude?: number;
    longitude?: number;
    propertyTaxes?: Record<string, { total?: number; year?: number }>;
  };
  // Only /properties is called here. Previous versions also called
  // /avm/rent/long-term and /avm/value, but both were thrown away in practice:
  // resolveFromComparables derives rent and value from the actual comp pool,
  // and the AVM results were only used as a last-ditch fallback that the
  // Zillow rentZestimate already covers. Dropping the two calls saves 2
  // RentCast requests per analysis (40% of the Stage 1 reduction).
  const propRes = await rentcast<PropertyRecord[] | PropertyRecord>(
    "/properties",
    { address },
  );

  const property = propRes.ok
    ? Array.isArray(propRes.data)
      ? propRes.data[0]
      : propRes.data
    : undefined;

  const notes: string[] = [];
  if (!propRes.ok) notes.push(`Property record: ${propRes.error}`);

  const latestTax = latestPropertyTax(property?.propertyTaxes);

  return {
    address: property?.formattedAddress,
    facts: {
      bedrooms: property?.bedrooms,
      bathrooms: property?.bathrooms,
      squareFootage: property?.squareFootage,
      yearBuilt: property?.yearBuilt,
      propertyType: property?.propertyType,
      lastSalePrice: property?.lastSalePrice,
      lastSaleDate: property?.lastSaleDate,
      latitude: property?.latitude,
      longitude: property?.longitude,
    },
    annualPropertyTax: latestTax,
    notes,
  };
}

function latestPropertyTax(
  taxes: Record<string, { total?: number; year?: number }> | undefined,
): number | undefined {
  if (!taxes) return undefined;
  const entries = Object.values(taxes).filter(
    (t) => t?.total && t.total > 0,
  );
  if (entries.length === 0) return undefined;
  entries.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return Math.round(entries[0].total!);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyResult(): ResolveResult {
  return {
    facts: {},
    inputs: {},
    provenance: {},
    notes: [],
    warnings: [],
  };
}

function normalizeForCache(address: string): string {
  return address
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "")
    .trim();
}
