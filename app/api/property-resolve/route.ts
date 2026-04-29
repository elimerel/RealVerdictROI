import type { NextRequest } from "next/server";
import type { DealInputs } from "@/lib/calculations";
import {
  detectHomesteadTrap,
  detectStateFromAddress,
  estimateAnnualInsurance,
  estimateAnnualPropertyTax,
  isValidStateCode,
  type Estimate,
  type StateCode,
} from "@/lib/estimators";
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
import { withErrorReporting, logEvent, captureError } from "@/lib/observability";
import { extractZpidAndSlug, addressFromSlug, stateFromSlugAddress } from "@/lib/zillow-url";
import type { ProvenanceSource, FieldProvenance } from "@/lib/types";

// Re-export so existing consumers of this route's types keep working.
export type { ProvenanceSource, FieldProvenance };

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
   * Resolver mode. Always "fast" — the resolver intentionally does NOT call
   * RentCast comps anymore (§20.8). Live comp pulls happen only after the
   * user clicks "Run live comp analysis" on /results, which routes through
   * /api/comps and re-runs analyzeComparables on the results page.
   */
  mode: "fast";
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
//   v12 = homestead-trap fix (§16.U #3 / §20.9 #1). Tax fallback defaults to
//        the investor (non-homestead) state rate; assessor line-items that
//        reflect the current owner's homestead exemption are detected and
//        replaced with the investor estimate, with both numbers surfaced in
//        the provenance note. Forces a cache miss so every cached v11 entry
//        carrying a homesteaded line-item gets re-derived.
//   v13 = Zillow URL-flow state detection (§16.U #2 / §20.9 #3). State now
//        propagated explicitly from /api/zillow-parse instead of re-parsed
//        from a composed address string. Address composition fixed to
//        canonical "Street, City, ST ZIP" so trailing-state regex never
//        misses the token. Internal API error text (§16.U #4 / §20.9 #5)
//        no longer leaks into user-facing notes — RentCast 401/auth errors
//        produce a generic "couldn't reach the property records database"
//        copy, with the raw error captured in observability.
//   v14 = dedupeByBuilding upgrade (§16.U.1 #4 / §20.9 #7) + $/sqft outlier
//        z-score trim (§16.U.1 #5 / §20.9 #8). Building keys now collapse
//        spurious bare numerics ("150 2 Claffey Dr" → "150 claffey dr"),
//        normalize street suffixes / directionals, and split on hyphens.
//        Comp pool drops >2σ $/sqft outliers before the median is taken,
//        with a workLog note naming each dropped comp.
//   v15 = §20.8 architecture change — defer comp pulls until intent. The
//        resolver no longer calls fetchComps / analyzeComparables. Rent
//        falls back to Zillow's rent Zestimate (when present) and price
//        falls back to Zillow's sale Zestimate. Comp-derived rent + value
//        only populate after the user clicks "Run live comp analysis" on
//        /results. Cache must invalidate so any v14 entry that still
//        carries comparables data is dropped.
const CACHE_VERSION = "v15";

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

    // skipRentcast=true → auto-analysis path (browser detection, AI fallback).
    // RentCast must never fire automatically — only on explicit user action.
    const skipRentcast = req.nextUrl.searchParams.get("skipRentcast") === "true";

    const cacheKey = `${CACHE_VERSION}:addr:${normalizeForCache(address)}`;
    const hit = await cache.get(cacheKey);
    if (hit) {
      logEvent("property-resolve.cache.hit", { mode: "address" });
      return Response.json(hit);
    }

    const result = await resolveByAddress(address, skipRentcast);
    // Only cache results that include RentCast data; skipRentcast calls are
    // cheap (no external lookup) and should not pollute the shared cache with
    // an incomplete record that would serve users who need the full data.
    if (!skipRentcast) await cache.set(cacheKey, result);
    logEvent("property-resolve.resolved", {
      mode: "address",
      state: result.state,
      hasFacts: Object.keys(result.facts).length > 0,
      warnings: result.warnings?.length ?? 0,
      skipRentcast,
    });
    return Response.json(result);
  },
);

export const POST = withErrorReporting(
  "api.property-resolve.POST",
  async (req: NextRequest) => {
    const limited = await enforceRateLimit(req, "property-resolve");
    if (limited) return limited;

    let body: { url?: string; address?: string; skipRentcast?: boolean };
    try {
      body = (await req.json()) as { url?: string; address?: string; skipRentcast?: boolean };
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    // skipRentcast=true → auto-analysis path. Never call RentCast automatically.
    const skipRentcast = body?.skipRentcast === true;

    const url = body?.url?.trim();
    if (url && /zillow\.com\/homedetails/i.test(url)) {
      const cacheKey = `${CACHE_VERSION}:zillow:${url}`;
      const hit = await cache.get(cacheKey);
      if (hit) {
        logEvent("property-resolve.cache.hit", { mode: "zillow" });
        return Response.json(hit);
      }
      const result = await resolveByZillowUrl(url, req, skipRentcast);
      if (!skipRentcast) await cache.set(cacheKey, result);
      logEvent("property-resolve.resolved", {
        mode: "zillow",
        state: result.state,
        warnings: result.warnings?.length ?? 0,
        skipRentcast,
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
      const result = await resolveByAddress(address, skipRentcast);
      if (!skipRentcast) await cache.set(cacheKey, result);
      logEvent("property-resolve.resolved", {
        mode: "address",
        state: result.state,
        warnings: result.warnings?.length ?? 0,
        skipRentcast,
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

async function resolveByAddress(address: string, skipRentcast = false): Promise<ResolveResult> {
  const result: ResolveResult = emptyResult();
  result.address = address;
  result.state = detectStateFromAddress(address);

  // Address-only flow: ONE RentCast call (/properties) for public-record
  // facts (beds/baths/sqft/year/type/lat/lng/tax). No comp pull — that's
  // deferred to the explicit "Run live comp analysis" button on /results
  // (§20.8). Browse-and-bounce traffic now costs at most one RentCast
  // request instead of four to six.
  //
  // skipRentcast=true is set by all automatic analysis paths (browser
  // listing detection, AI fallback). RentCast is NEVER called automatically.
  const rentcast = skipRentcast ? null : await fetchRentcast(address);
  if (rentcast) {
    if (rentcast.address) result.address = rentcast.address;
    // RentCast sometimes returns bedrooms: 0 for older public-records rows
    // (especially pre-1940 homes). That's "unknown", not a studio — merging
    // it as 0 would silently disable the bed filter when live comps run.
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
  } else {
    result.notes.push("RentCast lookup unavailable — using estimates.");
  }

  applyMetroAppreciation(result);
  await enrichWithEstimates(result);
  return result;
}

async function resolveByZillowUrl(
  url: string,
  req: NextRequest,
  skipRentcast = false,
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
    state?: string;
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
    // Capture the raw payload to observability but never leak it to the UI.
    // Same contract as RentCast errors (§16.U #4 / §20.9 #5).
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    logEvent("zillow.parse.error", {
      status: res.status,
      rawError: payload?.error ?? null,
      url,
    });
    result.warnings.push(
      "Couldn't read the Zillow listing directly — falling back to public records and listing-URL details.",
    );
  }

  if (zillow?.address) result.address = zillow.address;
  // If zillow-parse failed or returned no address (e.g. ScraperAPI down,
  // anti-bot page, 502), the full address is still in the URL slug itself.
  // Parse it here so we never show "Unknown address" for a valid Zillow URL.
  if (!result.address) {
    const parsed = extractZpidAndSlug(url);
    if (parsed?.slug) {
      result.address = addressFromSlug(parsed.slug);
    }
  }
  // State resolution priority for the Zillow URL flow:
  //   1. Trust the explicit `state` field from /api/zillow-parse — it was
  //      sourced from either Zillow's structured address blob or the URL
  //      slug, and validated against the US state code set. This is the
  //      authoritative path that fixes §16.U #2 (state was being lost when
  //      detectStateFromAddress had to re-parse a composed address that
  //      had dropped the state token).
  //   2. Fall back to detectStateFromAddress on the resolved address as a
  //      defensive backstop for any caller that ships an old payload.
  const explicitState = (() => {
    const raw = zillow?.state?.toUpperCase();
    return raw && isValidStateCode(raw) ? raw : undefined;
  })();
  result.state =
    explicitState ?? detectStateFromAddress(result.address ?? "");

  // ---------------------------------------------------------------------------
  // Correspondence check
  //
  // Zillow resolves listings by zpid, not by the address slug in the URL.
  // A modified or recycled zpid silently returns a real property in a
  // completely different location while the slug says something else.
  //
  // If the URL slug contains a parseable state code AND the scraped listing
  // is in a different state, the URL is invalid — return empty data so the
  // frontend gate blocks the verdict rather than producing a verdict for the
  // wrong property.
  //
  // Only applied when zillow-parse succeeded via ScraperAPI (source="scraperapi").
  // The url-fallback path (scraping failed entirely) already produces no price,
  // so the frontend gate catches it without this check.
  // ---------------------------------------------------------------------------
  if (zillow?.source === "scraperapi" && result.state) {
    const zpidParsed = extractZpidAndSlug(url);
    if (zpidParsed?.slug) {
      const slugAddr  = addressFromSlug(zpidParsed.slug);
      const slugState = stateFromSlugAddress(slugAddr);
      if (slugState && slugState !== result.state) {
        const bad = emptyResult();
        bad.warnings.push(
          `This Zillow URL appears to be invalid — the listing is in ${result.state} but the URL address says ${slugState}. Copy the URL directly from Zillow and try again.`,
        );
        return bad;
      }
    }
  }

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
  // Rent fallback: Zillow's rent Zestimate is the fast-path source for
  // monthly rent. The "Run live comp analysis" flow on /results will
  // overlay a comp-derived number on top of this when the user opts in
  // (§20.8). Without that opt-in we ship the Zestimate so Numbers / Stress
  // / What-if / Rubric tabs all have a usable rent figure.
  const zillowRentZestimate = zillow?.listing?.rentZestimate;
  if (zillowRentZestimate) {
    result.inputs.monthlyRent = zillowRentZestimate;
    result.provenance.monthlyRent = {
      source: "zillow-listing",
      confidence: "low",
      note: "Zillow's rent Zestimate. Click 'Run live comp analysis' on the results page for a comp-derived number.",
    };
  }
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

  // Step 2: ALSO call RentCast /properties to fill public-records gaps
  // (last-sale price/date, accurate tax bill, geocoded lat/lng for flood).
  // One RentCast request per fresh address, NOT a comp pull (§20.8).
  // Anything Zillow already gave us wins; RentCast only fills the gaps.
  //
  // skipRentcast=true is set by all automatic analysis paths — RentCast
  // is NEVER called automatically, only on explicit user-initiated flows.
  if (result.address && !skipRentcast) {
    const rentcast = await fetchRentcast(result.address);
    if (rentcast) {
      // Merge facts (don't overwrite — Zillow's listing data is more recent
      // for an active listing). Treat RentCast's bedrooms/bathrooms <= 0 as
      // "unknown" (common glitch on old homes) so they don't silently
      // disable the bed filter when live comps eventually run.
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
      if (rentcast.notes.length > 0) result.notes.push(...rentcast.notes);
    }
  }

  applyMetroAppreciation(result);
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
    // No source returned a tax bill — estimate using the investor (non-
    // homestead) state rate. This product is built for rental investors
    // (§16.F), so the owner-occupant rate would silently undercount the
    // post-purchase bill in IN/FL/TX/CA/GA/MI by 50–150%.
    const est = estimateAnnualPropertyTax(value, result.state);
    result.inputs.annualPropertyTax = est.value;
    result.provenance.annualPropertyTax = estimateToProvenance(est);
    if (est.confidence === "low") result.warnings.push(est.note);
  } else if (
    value &&
    result.inputs.annualPropertyTax &&
    result.state &&
    result.provenance.annualPropertyTax?.source !== "user"
  ) {
    // A source (RentCast or Zillow) returned a public-record tax bill. In
    // homestead-trap states (IN/FL/TX/CA/GA/MI) that line-item reflects the
    // CURRENT owner's homestead exemption, not the investor's post-purchase
    // tax. Detect the trap by comparing the implied effective rate to the
    // state's non-homestead rate; if the line-item is a clear homestead
    // outlier, swap in the investor estimate and surface both numbers.
    const trap = detectHomesteadTrap(
      result.inputs.annualPropertyTax,
      value,
      result.state,
    );
    if (trap) {
      const previousTax = result.inputs.annualPropertyTax;
      const previousNote = result.provenance.annualPropertyTax?.note ?? "";
      result.inputs.annualPropertyTax = trap.investorEstimate;
      result.provenance.annualPropertyTax = {
        source: "state-investor-rate",
        confidence: "medium",
        note: `Replaced the assessor's $${previousTax.toLocaleString()}/yr line-item — that reflects the current owner's ${trap.state} homestead cap (${trap.observedRate.toFixed(2)}% of value). As an investor you lose homestead and pay the non-homestead rate (~${trap.investorRate.toFixed(2)}% of value = ~$${trap.investorEstimate.toLocaleString()}/yr).${previousNote ? ` Original source: ${previousNote}` : ""}`,
      };
      result.warnings.push(
        `Property tax adjusted: the public-record bill of $${previousTax.toLocaleString()}/yr reflects the current owner's ${trap.state} homestead exemption. As an investor you'll pay roughly $${trap.investorEstimate.toLocaleString()}/yr at the non-homestead rate — a $${(trap.investorEstimate - previousTax).toLocaleString()}/yr expense the seller's pro forma is hiding.`,
      );
      logEvent("property-resolve.homestead-trap", {
        state: trap.state,
        observedRate: Number(trap.observedRate.toFixed(3)),
        investorRate: trap.investorRate,
        previousTax,
        investorEstimate: trap.investorEstimate,
      });
    }
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
 * Populate annualAppreciationPercent + provenance from FHFA metro HPI, if
 * the subject's zip falls inside an FHFA top-100 metro. Mutates
 * `result.inputs` and `result.provenance`. Returns the matched metro for
 * the caller's records (no longer used downstream now that comp pulls
 * happen on /results, not here).
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

// resolveFromComparables() lived here through v14 — it pulled fetchComps
// and ran analyzeComparables to derive rent + value from the live comp
// pool during autofill. Removed in v15 (§20.8): comp pulls now happen
// only on /results behind an explicit "Run live comp analysis" click.
// The fast-path rent fallback moved into resolveByZillowUrl (Zillow rent
// Zestimate). The /results page re-runs analyzeComparables with the
// pulled comp pool when the user opts in, and the engine derivations
// flow into the Negotiation Pack and Comp Reasoning Explainer from there.

function estimateToProvenance(est: Estimate): FieldProvenance {
  const source: ProvenanceSource = est.source.startsWith("state-investor-rate")
    ? "state-investor-rate"
    : est.source.startsWith("state")
      ? "state-average"
      : "national-average";
  return {
    source,
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

// RentCast error classification — drives both observability (full detail) and
// user-facing copy (sanitized only). Raw API error text MUST NEVER flow into
// `notes` (§16.U #4 / §20.9 #5).
type RentcastErrorKind =
  | "auth"        // 401 / 403 — key revoked, rotated, or invalid
  | "no-data"     // 404 — address not in their database (benign)
  | "rate-limit"  // 429 — quota exhausted
  | "network"     // fetch threw (DNS, timeout, TLS)
  | "http";       // any other 5xx / unexpected non-2xx

type RentcastResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: RentcastErrorKind; status?: number; rawError: string };

/** User-safe one-liner for each error kind — never includes raw API text. */
function userSafeRentcastNote(kind: RentcastErrorKind): string | null {
  switch (kind) {
    case "no-data":
      return "No public-records data on file for this address — proceeding with listing data only.";
    case "auth":
    case "rate-limit":
    case "network":
    case "http":
      // All operational issues are surfaced identically to the user — they
      // can't act on the distinction. The raw kind/status is captured for
      // ops via captureError below.
      return "Couldn't reach the property-records database — proceeding with listing data only.";
    default:
      return null;
  }
}

async function fetchRentcast(address: string): Promise<RentcastBundle | null> {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) return null;

  const rentcast = async <T>(
    path: string,
    params: Record<string, string>,
  ): Promise<RentcastResult<T>> => {
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
        const status = res.status;
        let kind: RentcastErrorKind;
        if (status === 404) kind = "no-data";
        else if (status === 401 || status === 403) kind = "auth";
        else if (status === 429) kind = "rate-limit";
        else kind = "http";
        return {
          ok: false as const,
          kind,
          status,
          rawError: `RentCast ${path} HTTP ${status}`,
        };
      }
      const data = (await res.json()) as T;
      return { ok: true as const, data };
    } catch (err) {
      return {
        ok: false as const,
        kind: "network",
        rawError: err instanceof Error ? err.message : "network error",
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
  if (!propRes.ok) {
    // Operational errors (auth/rate-limit/network/http) are escalated to
    // observability with full raw detail. The user sees only a sanitized
    // one-liner — never the API error string. This is the contract that
    // prevents "invalid RentCast API key" from ever appearing in the UI
    // again (§16.U #4, §20.9 #5).
    if (propRes.kind !== "no-data") {
      logEvent("rentcast.error", {
        kind: propRes.kind,
        status: propRes.status,
        path: "/properties",
        address,
      });
      captureError(new Error(propRes.rawError), {
        area: "api.property-resolve.rentcast",
        extra: { kind: propRes.kind, status: propRes.status, address },
      });
    }
    const safe = userSafeRentcastNote(propRes.kind);
    if (safe) notes.push(safe);
  }

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
    mode: "fast",
  };
}

function normalizeForCache(address: string): string {
  return address
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "")
    .trim();
}
