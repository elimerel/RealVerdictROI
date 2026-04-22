// FEMA National Flood Hazard Layer (NFHL) lookup + Census Geocoder fallback.
//
// Why this exists: the state-average homeowners-insurance estimator is blind
// to flood risk. A Boca Raton house in Zone AE needs $1500–2500/yr of NFIP on
// top of the regular HO3. A Miami Beach VE property needs $3500+. Without
// that, our cash-flow math is rosy by thousands per year for coastal and
// riverine deals, and the offer ceiling is too high.
//
// Design:
//   - Pure server-side. Both upstreams are public, no API keys, no signups.
//   - FEMA NFHL MapServer layer 28 is Flood Hazard Zones. Point-in-polygon
//     query returns the FLD_ZONE attribute for the containing flood area.
//   - Census Geocoder is the fallback when we don't have lat/lng from
//     RentCast or Zillow. Free, no key, fast (~500ms for valid TIGER
//     addresses).
//   - Aggressive caching: flood maps update rarely (months to years), so we
//     hold positive results 30 days. Negative cache 10 minutes to survive
//     transient timeouts without hammering FEMA.
//   - Timeouts short (5s) — we prefer "no flood data, warn user" over
//     slowing down every autofill by 15s when FEMA's ArcGIS is flaky.
//
// FLD_ZONE taxonomy (relevant subset):
//   A, AE, AH, AO, AR, A99 — Special Flood Hazard Area (SFHA), 1% annual
//                            chance ("100-year"). Mandatory flood insurance
//                            with federally-backed mortgages.
//   V, VE                   — Coastal high-velocity (wave action). Same 1%
//                            annual chance but with storm-surge dynamics.
//                            Highest premiums.
//   X (shaded)              — 0.2% annual chance OR protected by levee.
//                            Insurance not mandatory; moderate risk.
//   X (unshaded)            — Minimal flood risk.
//   D                       — Undetermined.
//
// We collapse these into three product-facing buckets:
//   "high"  → SFHA (A*/V*)  — 1% annual, mandatory with a mortgage
//   "moderate" → shaded X    — 0.2% annual, optional but recommended
//   "low"   → X, D, unknown  — no bump

import { KVCache } from "./kv-cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FloodZone = {
  /** Raw FEMA code, e.g. "AE", "X", "VE". Keep for debugging / tooltip. */
  zone: string;
  /** Subtype string from FEMA, e.g. "AREA OF MINIMAL FLOOD HAZARD" or
   *  "FLOODWAY". Sometimes empty. */
  subtype: string;
  /** Our risk bucket used for insurance adjustment. */
  risk: "high" | "moderate" | "low";
  /** Human-friendly label for UI badges. */
  label: string;
  /** Whether this is a V (coastal high-velocity) zone — gets the highest
   *  premium bump because of wave-action dynamics. */
  isCoastalHigh: boolean;
};

export type LatLng = { lat: number; lng: number };

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

// Real zone hits cache 30 days — flood maps change on a multi-month cadence.
// Empty-feature hits (FEMA 200 but no polygon) cache only 1 hour so transient
// FEMA server hiccups don't poison the cache for weeks.
const FLOOD_CACHE = new KVCache<FloodZone>("flood", 30 * 24 * 60 * 60 * 1000);
const FLOOD_EMPTY_CACHE = new KVCache<true>("flood-empty", 60 * 60 * 1000); // 1h
const FLOOD_NEG_CACHE = new KVCache<true>("flood-neg", 5 * 60 * 1000); // 5 min for errors
// Geocode cache has to distinguish "no match, cache for 7 days" from "never
// seen this address" — the KVCache `get` collapses null → undefined to
// prevent JSON-null ambiguity, so we box the value. `{ v: null }` means
// "known negative", missing entry means "never cached".
const GEOCODE_CACHE = new KVCache<{ v: LatLng | null }>(
  "geocode",
  7 * 24 * 60 * 60 * 1000,
); // 7 days
const GEOCODE_NEG_CACHE = new KVCache<true>("geocode-neg", 10 * 60 * 1000);

// FEMA's public ArcGIS endpoint is slow — 4-12s typical, worst case 15s+
// during cold starts. We set a generous timeout so we actually get results
// most of the time, and rely on aggressive caching so this latency only hits
// the first resolver call for any given lat/lng.
const FEMA_TIMEOUT_MS = 12_000;
const GEOCODE_TIMEOUT_MS = 4_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the FEMA flood zone for a lat/lng point.
 *
 * Returns null when:
 *   - FEMA responds but no flood-area polygon contains the point (FEMA's
 *     coverage is the US + territories; offshore / Canada returns nothing).
 *   - The upstream service times out or errors (we cache this negative for
 *     10 minutes so we don't spam FEMA during an outage).
 *   - Coordinates are invalid.
 *
 * A "Zone X minimal" result is NOT null — it returns `{ zone: "X", risk: "low" }`.
 * Callers should treat null as "unknown" and fall back to their non-flood
 * insurance estimate.
 */
export async function getFloodZone(
  lat: number,
  lng: number,
): Promise<FloodZone | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = await FLOOD_CACHE.get(key);
  if (cached) return cached;
  if (await FLOOD_EMPTY_CACHE.get(key)) return null;
  if (await FLOOD_NEG_CACHE.get(key)) return null;

  const url = new URL(
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
  );
  url.searchParams.set(
    "geometry",
    JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
  );
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "FLD_ZONE,ZONE_SUBTY,STATIC_BFE");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEMA_TIMEOUT_MS);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      next: { revalidate: 30 * 86_400 },
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      await FLOOD_NEG_CACHE.set(key, true);
      return null;
    }
    const payload = (await res.json()) as NfhlResponse;
    const feature = payload.features?.[0];
    if (!feature?.attributes?.FLD_ZONE) {
      // FEMA 200 but no polygon — usually unmapped / offshore / pre-NFHL
      // jurisdiction. Cache for only an hour so transient FEMA hiccups
      // don't silently poison the cache for weeks.
      await FLOOD_EMPTY_CACHE.set(key, true);
      return null;
    }
    const zone = classifyFloodZone(
      feature.attributes.FLD_ZONE,
      feature.attributes.ZONE_SUBTY ?? "",
    );
    await FLOOD_CACHE.set(key, zone);
    return zone;
  } catch {
    await FLOOD_NEG_CACHE.set(key, true);
    return null;
  }
}

/**
 * Geocode a US address via the Census Geocoder (free, no key). Used as a
 * fallback when neither RentCast nor Zillow gave us coordinates.
 *
 * Census covers any address in their TIGER reference dataset — basically
 * every deliverable US street address. It's fast (<1s typical) and works
 * with both full and partial addresses, but expects spelled-out street
 * suffixes ("STREET" not "ST") and full state codes.
 *
 * Returns null on miss, parse error, or timeout.
 */
export async function geocodeAddress(
  address: string,
): Promise<LatLng | null> {
  if (!address) return null;
  const key = address.trim().toLowerCase();
  const cached = await GEOCODE_CACHE.get(key);
  if (cached) return cached.v;
  if (await GEOCODE_NEG_CACHE.get(key)) return null;

  const url = new URL(
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
  );
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      next: { revalidate: 7 * 86_400 },
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      await GEOCODE_NEG_CACHE.set(key, true);
      return null;
    }
    const payload = (await res.json()) as CensusGeocoderResponse;
    const match = payload.result?.addressMatches?.[0];
    if (!match) {
      await GEOCODE_CACHE.set(key, { v: null });
      return null;
    }
    const lat = Number(match.coordinates?.y);
    const lng = Number(match.coordinates?.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      await GEOCODE_CACHE.set(key, { v: null });
      return null;
    }
    const out: LatLng = { lat, lng };
    await GEOCODE_CACHE.set(key, { v: out });
    return out;
  } catch {
    await GEOCODE_NEG_CACHE.set(key, true);
    return null;
  }
}

/**
 * How much to add to the state-average homeowners insurance estimate when
 * a property sits in an SFHA or V-zone. These are rough NFIP + private
 * flood premium averages for owner-occupied SFRs; real quotes vary 2-5x
 * based on elevation, BFE, and carrier.
 *
 * The point isn't a perfect quote — it's that the insurance line item in
 * the deal's cash flow reflects the obvious-to-any-insurer fact that flood
 * is a separate premium these homes must carry.
 */
export function floodInsuranceBump(zone: FloodZone): number {
  if (zone.risk === "high") {
    // Coastal high-velocity (V/VE) runs multiple-x higher than inland SFHA
    // because of wave action + surge dynamics. Both are mandatory with a
    // federally-backed mortgage.
    return zone.isCoastalHigh ? 3500 : 1800;
  }
  if (zone.risk === "moderate") {
    // Shaded X / 0.2% annual chance — optional but many lenders require it.
    // Conservative bump so the number reflects the cost of the optional
    // policy most buyers would carry.
    return 600;
  }
  return 0;
}

/** Human-friendly note the resolver puts on the insurance provenance so the
 *  UI tooltip explains why the number is higher than the state average. */
export function floodInsuranceNote(zone: FloodZone, bump: number): string {
  return `+${bump.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}/yr bumped in for FEMA ${zone.zone} (${zone.label}). NFIP + private-flood average; real quote depends on elevation and BFE.`;
}

// ---------------------------------------------------------------------------
// Zone classification
// ---------------------------------------------------------------------------

export function classifyFloodZone(rawZone: string, subtype: string): FloodZone {
  const z = rawZone.toUpperCase().trim();
  const sub = subtype.toUpperCase().trim();

  // V / VE — coastal high-velocity (wave action). Highest premium.
  if (/^V/.test(z)) {
    return {
      zone: z,
      subtype: sub,
      risk: "high",
      label: "Coastal high-velocity flood zone (1% annual chance, wave action)",
      isCoastalHigh: true,
    };
  }

  // A / AE / AH / AO / AR / A99 — SFHA, 1% annual chance.
  if (/^A/.test(z)) {
    return {
      zone: z,
      subtype: sub,
      risk: "high",
      label: "Special Flood Hazard Area (1% annual chance flood)",
      isCoastalHigh: false,
    };
  }

  // X shaded / 0.2% annual chance / levee-protected. FEMA encodes this in
  // the subtype string because FLD_ZONE is just "X" for both shaded and
  // unshaded X.
  if (
    z === "X" &&
    /(0\.2|ANNUAL CHANCE|REDUCED BY LEVEE|500-?YEAR)/i.test(sub)
  ) {
    return {
      zone: z,
      subtype: sub,
      risk: "moderate",
      label: "Moderate flood risk (0.2% annual chance / shaded X)",
      isCoastalHigh: false,
    };
  }

  // Everything else (X minimal, D undetermined, unknown codes) — low.
  return {
    zone: z,
    subtype: sub,
    risk: "low",
    label:
      z === "D"
        ? "Flood risk undetermined (FEMA Zone D)"
        : "Minimal flood risk (FEMA Zone X)",
    isCoastalHigh: false,
  };
}

// ---------------------------------------------------------------------------
// Response types (trimmed to what we actually read)
// ---------------------------------------------------------------------------

type NfhlResponse = {
  features?: Array<{
    attributes?: {
      FLD_ZONE?: string;
      ZONE_SUBTY?: string | null;
      STATIC_BFE?: number | null;
    };
  }>;
};

type CensusGeocoderResponse = {
  result?: {
    addressMatches?: Array<{
      coordinates?: { x?: number; y?: number };
    }>;
  };
};
