import "server-only";

// ---------------------------------------------------------------------------
// Free market context layer — runs for all users, no RentCast required.
//
// Sources:
//   HUD Fair Market Rents   — ZIP-level rent floors from HUD
//                             requires HUD_USER_TOKEN (optional, skips if absent)
//   ZORI rent index         — Zillow Observed Rent Index, public CSV
//                             no key required; cached 7 days
//   Walk Score              — walkability/transit/bike scores
//                             requires WALK_SCORE_API_KEY (optional, skips if absent)
//
// All three degrade silently to null when keys are missing or requests fail.
// Never throw; callers get FreeMarketContext with nulls.
// ---------------------------------------------------------------------------

export type HudFmr = {
  metro?: string;
  county?: string;
  year: number;
  /** 0 = efficiency/studio */
  br0: number;
  br1: number;
  br2: number;
  br3: number;
  br4: number;
  /** true = small-area FMR (ZIP-level); false = county/metro-level */
  smallArea: boolean;
};

export type ZoriRentTrend = {
  zip: string;
  /** Zillow Observed Rent Index value (observed market rent, $/mo) */
  medianRent: number;
  /** YYYY-MM of the latest data point */
  asOf: string;
};

export type WalkScoreResult = {
  walkScore: number;
  walkDescription: string;
  transitScore?: number;
  transitDescription?: string;
  bikeScore?: number;
  bikeDescription?: string;
};

export type HudAmi = {
  /** Area Median Income / Median Family Income for the county/metro */
  medianFamilyIncome: number;
  /** 80% AMI for 1-person household (low-income limit) */
  incomeLimitBr1_80pct: number;
  /** 80% AMI for 4-person household (standard reference household) */
  incomeLimitBr4_80pct: number;
  /** HUD area name (metro or county label) */
  areaName: string;
  year: number;
};

export type FreeMarketContext = {
  hudFmr?: HudFmr | null;
  hudAmi?: HudAmi | null;
  rentTrend?: ZoriRentTrend | null;
  walkScore?: WalkScoreResult | null;
};

// ---------------------------------------------------------------------------
// HUD Fair Market Rents
// API: https://www.huduser.gov/hudapi/public/fmr/statedata/{stateCode}
// Requires Bearer token in Authorization header (HUD_USER_TOKEN env var).
// ---------------------------------------------------------------------------

const HUD_CACHE = new Map<string, { expires: number; value: HudFmr | null }>();
const HUD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — FMR is annual

function stateFromAddress(address: string): string | undefined {
  // Match " TX 12345" or " TX" at the tail of an address
  const m = address.match(/,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?(?:\s*,.*)?$/);
  if (m) return m[1];
  // Fallback: any 2-letter uppercase word before a ZIP
  const m2 = address.match(/\b([A-Z]{2})\s+\d{5}\b/);
  return m2?.[1];
}

// HUD API shapes (subset we use)
type HudStateData = {
  data?: {
    metroareas?: HudAreaEntry[];
    counties?: HudAreaEntry[];
  };
};

type HudAreaEntry = {
  metro_name?: string;
  county_name?: string;
  smallarea_status?: boolean;
  basicdata?: Array<{
    zip_code?: string;
    fmr0?: number;
    fmr1?: number;
    fmr2?: number;
    fmr3?: number;
    fmr4?: number;
  }>;
  // County-level (non-small-area) FMR field names
  Efficiency?: number;
  oneBdrm?: number;
  twoBdrm?: number;
  threeBdrm?: number;
  fourBdrm?: number;
};

export async function fetchHudFmr(
  zip: string,
  address: string,
): Promise<HudFmr | null> {
  const token = process.env.HUD_USER_TOKEN;
  if (!token) return null;
  if (!/^\d{5}$/.test(zip)) return null;

  const now = Date.now();
  const hit = HUD_CACHE.get(zip);
  if (hit && hit.expires > now) return hit.value;

  const state = stateFromAddress(address);
  if (!state) {
    HUD_CACHE.set(zip, { expires: now + HUD_TTL_MS, value: null });
    return null;
  }

  // Approximate current FY — HUD typically publishes for the upcoming year
  const year = new Date().getFullYear();

  try {
    const res = await fetch(
      `https://www.huduser.gov/hudapi/public/fmr/statedata/${state}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
        next: { revalidate: 86400 * 30 },
      },
    );
    if (!res.ok) {
      HUD_CACHE.set(zip, { expires: now + HUD_TTL_MS, value: null });
      return null;
    }

    const json = (await res.json()) as HudStateData;
    const allAreas: HudAreaEntry[] = [
      ...(json.data?.metroareas ?? []),
      ...(json.data?.counties ?? []),
    ];

    // Priority 1: small-area FMR with exact ZIP match
    for (const area of allAreas) {
      if (!area.smallarea_status || !Array.isArray(area.basicdata)) continue;
      const entry = area.basicdata.find(
        (b) => b.zip_code === zip || b.zip_code === `0${zip}`,
      );
      if (!entry) continue;
      const fmr: HudFmr = {
        metro: area.metro_name ?? area.county_name,
        year,
        br0: entry.fmr0 ?? 0,
        br1: entry.fmr1 ?? 0,
        br2: entry.fmr2 ?? 0,
        br3: entry.fmr3 ?? 0,
        br4: entry.fmr4 ?? 0,
        smallArea: true,
      };
      HUD_CACHE.set(zip, { expires: now + HUD_TTL_MS, value: fmr });
      return fmr;
    }

    // Priority 2: county-level FMR (no ZIP granularity — use first county)
    const county = json.data?.counties?.[0];
    if (county && county.Efficiency !== undefined) {
      const fmr: HudFmr = {
        county: county.county_name,
        year,
        br0: county.Efficiency ?? 0,
        br1: county.oneBdrm ?? 0,
        br2: county.twoBdrm ?? 0,
        br3: county.threeBdrm ?? 0,
        br4: county.fourBdrm ?? 0,
        smallArea: false,
      };
      HUD_CACHE.set(zip, { expires: now + HUD_TTL_MS, value: fmr });
      return fmr;
    }

    HUD_CACHE.set(zip, { expires: now + HUD_TTL_MS, value: null });
    return null;
  } catch {
    HUD_CACHE.set(zip, { expires: now + HUD_TTL_MS, value: null });
    return null;
  }
}

// ---------------------------------------------------------------------------
// HUD Area Median Income (Income Limits)
// Two-step: Census geocoder (free, no key) → county FIPS → HUD IL API
// Requires HUD_USER_TOKEN (same token as fetchHudFmr).
// ---------------------------------------------------------------------------

const AMI_CACHE = new Map<string, { expires: number; value: HudAmi | null }>();
const AMI_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Census geocoder response shape (subset)
type CensusGeoResult = {
  result?: {
    addressMatches?: Array<{
      geographies?: {
        Counties?: Array<{
          STATE?: string;
          COUNTY?: string;
          NAME?: string;
        }>;
      };
    }>;
  };
};

// HUD Income Limits API response shape (subset)
type HudIlResponse = {
  data?: {
    median?: number;
    area_name?: string;
    year?: number;
    lowIncome?: Record<string, number>; // l1–l8 = 80% AMI by household size
  };
};

/** Resolve county FIPS (state 2-digit + county 3-digit) from address via Census geocoder. */
async function getCountyFipsFromAddress(
  address: string,
): Promise<{ stateFips: string; countyFips: string; countyName?: string } | null> {
  try {
    const url =
      "https://geocoding.geo.census.gov/geocoder/geographies/address" +
      `?benchmark=Public_AR_Current&vintage=Current_Persons&layers=Counties` +
      `&format=json&address=${encodeURIComponent(address)}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 86400 * 30 },
    });
    if (!res.ok) return null;

    const json = (await res.json()) as CensusGeoResult;
    const match = json.result?.addressMatches?.[0];
    const county = match?.geographies?.Counties?.[0];
    if (!county?.STATE || !county?.COUNTY) return null;

    return {
      stateFips: county.STATE.padStart(2, "0"),
      countyFips: county.COUNTY.padStart(3, "0"),
      countyName: county.NAME,
    };
  } catch {
    return null;
  }
}

export async function fetchHudAmi(
  zip: string,
  address: string,
): Promise<HudAmi | null> {
  const token = process.env.HUD_USER_TOKEN;
  if (!token) return null;
  if (!address.trim()) return null;

  const cacheKey = zip || address.toLowerCase().trim();
  const now = Date.now();
  const hit = AMI_CACHE.get(cacheKey);
  if (hit && hit.expires > now) return hit.value;

  const miss = (v: null = null) => {
    AMI_CACHE.set(cacheKey, { expires: now + AMI_TTL_MS, value: v });
    return v;
  };

  // Step 1: county FIPS via Census geocoder
  const fips = await getCountyFipsFromAddress(address);
  if (!fips) return miss();

  // Step 2: HUD Income Limits by county FIPS
  try {
    const url =
      `https://www.huduser.gov/hudapi/public/il/data/county` +
      `?StateId=${fips.stateFips}&county=${fips.countyFips}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 86400 * 30 },
    });
    if (!res.ok) return miss();

    const json = (await res.json()) as HudIlResponse;
    const d = json.data;
    if (!d || typeof d.median !== "number" || d.median <= 0) return miss();

    const ami: HudAmi = {
      medianFamilyIncome: d.median,
      incomeLimitBr1_80pct: d.lowIncome?.l1 ?? 0,
      incomeLimitBr4_80pct: d.lowIncome?.l4 ?? 0,
      areaName: d.area_name ?? fips.countyName ?? "",
      year: d.year ?? new Date().getFullYear(),
    };

    AMI_CACHE.set(cacheKey, { expires: now + AMI_TTL_MS, value: ami });
    return ami;
  } catch {
    return miss();
  }
}

// ---------------------------------------------------------------------------
// ZORI — Zillow Observed Rent Index, ZIP-level, public CSV (no key required).
// https://files.zillowstatic.com/research/public_csvs/ZORI/Zip_ZORI_uc_sfrcondo_sm_month.csv
// ---------------------------------------------------------------------------

const ZORI_URL =
  "https://files.zillowstatic.com/research/public_csvs/ZORI/Zip_ZORI_uc_sfrcondo_sm_month.csv";

let zoriCache: {
  expires: number;
  rows: Map<string, { rent: number; asOf: string }>;
} | null = null;

const ZORI_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — Zillow updates weekly

async function loadZoriRows(): Promise<Map<
  string,
  { rent: number; asOf: string }
> | null> {
  const now = Date.now();
  if (zoriCache && zoriCache.expires > now) return zoriCache.rows;

  try {
    const res = await fetch(ZORI_URL, {
      signal: AbortSignal.timeout(20_000),
      next: { revalidate: 86400 * 7 },
    });
    if (!res.ok) return null;

    const text = await res.text();
    const lines = text.split("\n");
    if (lines.length < 2) return null;

    const headers = lines[0].split(",").map((h) => h.trim());

    // Column indices for ZIP code and date columns
    const zipCol = headers.findIndex((h) => h === "RegionName");
    if (zipCol === -1) return null;

    // Date columns look like "2024-11"
    const dateCols: Array<{ idx: number; label: string }> = [];
    for (let i = 0; i < headers.length; i++) {
      if (/^\d{4}-\d{2}$/.test(headers[i])) {
        dateCols.push({ idx: i, label: headers[i] });
      }
    }
    if (dateCols.length === 0) return null;

    const rows = new Map<string, { rent: number; asOf: string }>();

    for (let r = 1; r < lines.length; r++) {
      const parts = lines[r].split(",");
      if (parts.length < headers.length) continue;
      const rawZip = parts[zipCol]?.trim();
      if (!rawZip || !/^\d{5}$/.test(rawZip)) continue;

      // Scan right-to-left for the most recent non-empty value
      for (let d = dateCols.length - 1; d >= 0; d--) {
        const val = parts[dateCols[d].idx]?.trim();
        if (val && val !== "" && !isNaN(Number(val))) {
          const rent = Math.round(Number(val));
          if (rent > 0) {
            rows.set(rawZip, { rent, asOf: dateCols[d].label });
          }
          break;
        }
      }
    }

    zoriCache = { expires: now + ZORI_TTL_MS, rows };
    return rows;
  } catch {
    return null;
  }
}

export async function fetchZoriRentTrend(
  zip: string,
): Promise<ZoriRentTrend | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const data = await loadZoriRows();
  if (!data) return null;
  const entry = data.get(zip);
  if (!entry) return null;
  return { zip, medianRent: entry.rent, asOf: entry.asOf };
}

// ---------------------------------------------------------------------------
// Walk Score
// https://api.walkscore.com/score?format=json&address=...&wsapikey=...&transit=1&bike=1
// Requires WALK_SCORE_API_KEY env var; free tier 5,000 calls/day.
// ---------------------------------------------------------------------------

const WALK_CACHE = new Map<
  string,
  { expires: number; value: WalkScoreResult | null }
>();
const WALK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function fetchWalkScore(
  address: string,
): Promise<WalkScoreResult | null> {
  const apiKey = process.env.WALK_SCORE_API_KEY;
  if (!apiKey) return null;
  if (!address.trim()) return null;

  const cacheKey = address.toLowerCase().trim();
  const now = Date.now();
  const hit = WALK_CACHE.get(cacheKey);
  if (hit && hit.expires > now) return hit.value;

  try {
    const params = new URLSearchParams({
      format: "json",
      address: address.trim(),
      wsapikey: apiKey,
      transit: "1",
      bike: "1",
    });

    const res = await fetch(
      `https://api.walkscore.com/score?${params.toString()}`,
      {
        signal: AbortSignal.timeout(8_000),
        next: { revalidate: 86400 * 30 },
      },
    );
    if (!res.ok) {
      WALK_CACHE.set(cacheKey, { expires: now + WALK_TTL_MS, value: null });
      return null;
    }

    const json = (await res.json()) as {
      walkscore?: number;
      description?: string;
      transit?: { score?: number; description?: string };
      bike?: { score?: number; description?: string };
      status?: number;
    };

    // status 1 = OK; 2 = no score (rural); other = error
    if (typeof json.walkscore !== "number" || (json.status !== undefined && json.status !== 1)) {
      WALK_CACHE.set(cacheKey, { expires: now + WALK_TTL_MS, value: null });
      return null;
    }

    const result: WalkScoreResult = {
      walkScore: json.walkscore,
      walkDescription: json.description ?? "",
      transitScore: json.transit?.score,
      transitDescription: json.transit?.description,
      bikeScore: json.bike?.score,
      bikeDescription: json.bike?.description,
    };
    WALK_CACHE.set(cacheKey, { expires: now + WALK_TTL_MS, value: result });
    return result;
  } catch {
    WALK_CACHE.set(cacheKey, { expires: now + WALK_TTL_MS, value: null });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — all three sources in parallel, never throws.
// ---------------------------------------------------------------------------

export async function fetchFreeMarketContext(
  zip: string | undefined,
  address: string | undefined,
): Promise<FreeMarketContext> {
  if (!zip && !address) return {};

  const [hudFmr, hudAmi, rentTrend, walkScore] = await Promise.all([
    zip && address ? fetchHudFmr(zip, address) : Promise.resolve(null),
    address ? fetchHudAmi(zip ?? "", address) : Promise.resolve(null),
    zip ? fetchZoriRentTrend(zip) : Promise.resolve(null),
    address ? fetchWalkScore(address) : Promise.resolve(null),
  ]);

  return { hudFmr, hudAmi, rentTrend, walkScore };
}
