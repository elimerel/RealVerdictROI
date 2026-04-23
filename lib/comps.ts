import { KVCache } from "@/lib/kv-cache";

// ---------------------------------------------------------------------------
// Shared RentCast comps helper. Used by /api/comps (returns JSON for the
// frontend) and by /results (server-side render of the comps tab).
// ---------------------------------------------------------------------------

const RENTCAST_BASE = "https://api.rentcast.io/v1";

export type Comp = {
  address: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  price?: number;
  daysOnMarket?: number;
  date?: string;
  distance?: number;
  status?: string;
  lat?: number;
  lng?: number;
  id?: string;
  /** Raw RentCast propertyType (e.g. "Single Family", "Condo", "Apartment"). */
  propertyType?: string;
  /**
   * If this comp was collapsed from multiple near-identical listings (e.g.
   * several units in the same building), how many listings were rolled up.
   * 1 means the comp is a single listing.
   */
  rolledUpCount?: number;
};

export type CompStats = {
  count: number;
  median?: number;
  p25?: number;
  p75?: number;
  min?: number;
  max?: number;
  medianPricePerSqft?: number;
  medianRentPerSqft?: number;
};

export type CompsResult = {
  address: string;
  saleComps: { items: Comp[]; stats: CompStats };
  rentComps: { items: Comp[]; stats: CompStats };
  /** The radius (miles) that actually produced the comps we returned. */
  radiusMilesUsed: number;
  notes: string[];
};

export type CompsOptions = {
  address: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  radiusMiles?: number;
  propertyType?: string;
};

// Minimum comps we need on each side (sale / rent) before we stop widening.
const MIN_COMPS_PER_SIDE = 3;
// Ladder of fallback radii. We start at the caller-requested radius (default
// 3mi) and widen outward until we have enough comps or we hit the last rung.
// Prior versions laddered 1 → 3 → 5 → 10, but RentCast's results come back
// sorted by distance with limit=20, so a 3mi starting radius returns the
// SAME 20 closest listings as a 1mi radius would when a neighborhood is
// dense — we just skip the extra API call when 1mi wasn't enough on its own.
// This single change cuts 1–2 RentCast calls off every analysis in a thin
// market while keeping the comp pool in an urban market identical.
const RADIUS_LADDER = [3, 10];

// ---------------------------------------------------------------------------

export async function fetchComps(opts: CompsOptions): Promise<CompsResult | null> {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) return null;
  const address = opts.address?.trim();
  if (!address || address.length < 5) return null;

  const startingRadius = opts.radiusMiles ?? 3;

  // Build the ladder starting at the caller's radius (never go smaller than
  // what they asked for — only widen).
  const ladder = RADIUS_LADDER.filter((r) => r >= startingRadius);
  if (ladder.length === 0 || ladder[0] !== startingRadius)
    ladder.unshift(startingRadius);

  let bestSale: SidePool | null = null;
  let bestRent: SidePool | null = null;
  const aggregatedNotes: string[] = [];

  for (let i = 0; i < ladder.length; i++) {
    const radius = ladder[i];
    // Only widen the side that's still short. If we already have enough sale
    // comps from an earlier rung, reuse them instead of spending another
    // RentCast request widening sale too. This keeps worst-case cost at
    // 2 sale + 2 rent (+ 1 rent baths-drop fallback) = 5 RentCast calls per
    // analysis, down from 8 before Stage 1.
    const needSale: boolean =
      !bestSale || bestSale.items.length < MIN_COMPS_PER_SIDE;
    const needRent: boolean =
      !bestRent || bestRent.items.length < MIN_COMPS_PER_SIDE;
    if (!needSale && !needRent) break;

    const isLastRung = i === ladder.length - 1;
    const tasks: Array<Promise<SidePool | null>> = [
      needSale
        ? fetchSaleCachedOrLive(apiKey, { ...opts, address, radiusMiles: radius })
        : Promise.resolve(bestSale),
      needRent
        ? fetchRentCachedOrLive(
            apiKey,
            { ...opts, address, radiusMiles: radius },
            !isLastRung,
          )
        : Promise.resolve(bestRent),
    ];
    const [saleRes, rentRes] = await Promise.all(tasks);

    if (needSale && saleRes) bestSale = saleRes;
    if (needRent && rentRes) bestRent = rentRes;

    const saleCount = bestSale?.items.length ?? 0;
    const rentCount = bestRent?.items.length ?? 0;
    if (saleCount >= MIN_COMPS_PER_SIDE && rentCount >= MIN_COMPS_PER_SIDE) break;

    if (i === ladder.length - 1) {
      aggregatedNotes.push(
        `Only ${saleCount} sale comp(s) and ${rentCount} rent comp(s) within ${radius}mi — treat the market stats below as directional, not definitive.`,
      );
    }
  }

  const saleItems = bestSale?.items ?? [];
  const rentItems = bestRent?.items ?? [];
  const saleRadius = bestSale?.radius ?? startingRadius;
  const rentRadius = bestRent?.radius ?? startingRadius;
  const widestRadius = Math.max(saleRadius, rentRadius);
  if (widestRadius > startingRadius) {
    aggregatedNotes.push(
      `Widened comps search to ${widestRadius}mi because there weren't enough comparable listings within ${startingRadius}mi.`,
    );
  }

  // Dedupe by building using the larger set's radius for reporting.
  const subjectBeds = opts.beds && opts.beds > 0 ? opts.beds : undefined;
  const saleDeduped = dedupeByBuilding(saleItems, subjectBeds);
  const rentDeduped = dedupeByBuilding(rentItems, subjectBeds);

  const fetchNotes = [...(bestSale?.notes ?? []), ...(bestRent?.notes ?? [])];
  const saleCollapsed = saleItems.length - saleDeduped.length;
  const rentCollapsed = rentItems.length - rentDeduped.length;
  if (saleCollapsed > 0)
    fetchNotes.push(
      `Collapsed ${saleCollapsed} sale listing(s) from the same building(s) into shared comps so no tower dominates the median.`,
    );
  if (rentCollapsed > 0)
    fetchNotes.push(
      `Collapsed ${rentCollapsed} rent listing(s) from the same building(s) into shared comps so no tower dominates the median.`,
    );

  return {
    address,
    saleComps: { items: saleDeduped, stats: summarize(saleDeduped) },
    rentComps: { items: rentDeduped, stats: summarize(rentDeduped) },
    radiusMilesUsed: widestRadius,
    notes: [...aggregatedNotes, ...fetchNotes],
  };
}

// Per-side cached fetch — the old whole-result cache (`comps:...:radius`)
// still exists below, kept for the /api/comps public route which doesn't
// share our per-side widening logic. Here we cache sale and rent pools
// independently so widening one side doesn't force a refetch of the other.
type SidePool = { items: Comp[]; notes: string[]; radius: number };
const saleSideCache = new KVCache<SidePool>(
  "comps-sale",
  24 * 60 * 60 * 1000,
);
const rentSideCache = new KVCache<SidePool>(
  "comps-rent",
  24 * 60 * 60 * 1000,
);

async function fetchSaleCachedOrLive(
  apiKey: string,
  opts: FetchOpts,
): Promise<SidePool> {
  const key = `sale:${normalize(opts.address)}:${opts.beds ?? ""}:${opts.baths ?? ""}:${opts.radiusMiles}`;
  const hit = await saleSideCache.get(key);
  if (hit) return hit;
  const res = await fetchSaleComps(apiKey, opts);
  const pool: SidePool = {
    items: res.items,
    notes: res.notes,
    radius: opts.radiusMiles,
  };
  await saleSideCache.set(key, pool);
  return pool;
}

async function fetchRentCachedOrLive(
  apiKey: string,
  opts: FetchOpts,
  allowDropBaths: boolean,
): Promise<SidePool> {
  // Cache key includes allowDropBaths so a first-rung (strict+drop-baths)
  // result is NEVER reused as a last-rung (strict-only) answer — otherwise
  // a slow RentCast miss could paper over a legit sparse-comp warning.
  const key = `rent:${normalize(opts.address)}:${opts.beds ?? ""}:${opts.baths ?? ""}:${opts.radiusMiles}:${allowDropBaths ? "d" : "s"}`;
  const hit = await rentSideCache.get(key);
  if (hit) return hit;
  const res = await fetchRentComps(apiKey, opts, allowDropBaths);
  const pool: SidePool = {
    items: res.items,
    notes: res.notes,
    radius: opts.radiusMiles,
  };
  await rentSideCache.set(key, pool);
  return pool;
}

// ---------------------------------------------------------------------------

type FetchOpts = Required<Pick<CompsOptions, "address" | "radiusMiles">> &
  Omit<CompsOptions, "address" | "radiusMiles">;

type RentcastListing = Record<string, unknown> & {
  id?: string;
  formattedAddress?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  price?: number;
  listPrice?: number;
  lastSalePrice?: number;
  rent?: number;
  daysOnMarket?: number;
  listedDate?: string;
  listingDate?: string;
  removedDate?: string;
  status?: string;
  latitude?: number;
  longitude?: number;
  distance?: number;
  propertyType?: string;
};

async function fetchSaleComps(apiKey: string, opts: FetchOpts) {
  const url = new URL(`${RENTCAST_BASE}/listings/sale`);
  url.searchParams.set("address", opts.address);
  url.searchParams.set("radius", String(opts.radiusMiles));
  url.searchParams.set("status", "Active,Sold");
  url.searchParams.set("limit", "20");
  if (opts.beds) url.searchParams.set("bedrooms", String(opts.beds));
  if (opts.baths) url.searchParams.set("bathrooms", String(opts.baths));
  if (opts.propertyType) url.searchParams.set("propertyType", opts.propertyType);
  return fetchListings(apiKey, url, "sale", opts.sqft);
}

async function fetchRentComps(
  apiKey: string,
  opts: FetchOpts,
  allowDropBaths: boolean,
) {
  const buildUrl = (useFilters: { beds: boolean; baths: boolean }) => {
    const url = new URL(`${RENTCAST_BASE}/listings/rental/long-term`);
    url.searchParams.set("address", opts.address);
    url.searchParams.set("radius", String(opts.radiusMiles));
    url.searchParams.set("status", "Active");
    url.searchParams.set("limit", "20");
    if (useFilters.beds && opts.beds)
      url.searchParams.set("bedrooms", String(opts.beds));
    if (useFilters.baths && opts.baths)
      url.searchParams.set("bathrooms", String(opts.baths));
    if (opts.propertyType)
      url.searchParams.set("propertyType", opts.propertyType);
    return url;
  };

  // First pass: strict filter on beds + baths (best match for SFR).
  const strict = await fetchListings(
    apiKey,
    buildUrl({ beds: true, baths: true }),
    "rent",
    opts.sqft,
  );
  if (strict.items.length >= MIN_COMPS_PER_SIDE) return strict;

  // Fallback: drop baths filter (common reason: subject 2.5ba vs comps 2ba).
  // This is the only fallback tier — the old "drop beds entirely" tier was
  // removed because in practice it rarely produced useful comps (a 6bd
  // whole-building rented as "any layout nearby" mixes studios into the
  // median and makes rent worse than just flagging the sparse-comp warning).
  // `allowDropBaths` is false at the widest ladder rung (10mi) to cap the
  // worst-case RentCast cost at 5 calls per analysis — an atypical property
  // (10bd multifamily, say) that still finds zero strict rent comps at 10mi
  // will return empty + a sparse-comp warning rather than spending another
  // API call on a filter that isn't the bottleneck.
  if (opts.baths && allowDropBaths) {
    const noBaths = await fetchListings(
      apiKey,
      buildUrl({ beds: true, baths: false }),
      "rent",
      opts.sqft,
    );
    if (noBaths.items.length >= MIN_COMPS_PER_SIDE) return noBaths;
    return strict.items.length >= noBaths.items.length ? strict : noBaths;
  }

  return strict;
}

async function fetchListings(
  apiKey: string,
  url: URL,
  kind: "sale" | "rent",
  subjectSqft: number | undefined,
): Promise<{ items: Comp[]; notes: string[] }> {
  if (process.env.RENTCAST_TRACE === "1") {
    console.log(`[rentcast-trace] ${kind} ${url.pathname}${url.search}`);
  }
  try {
    const res = await fetch(url.toString(), {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      next: { revalidate: 86_400 },
    });
    if (!res.ok) {
      if (res.status === 404)
        return { items: [], notes: [`No ${kind} comps found nearby.`] };
      if (res.status === 401)
        return { items: [], notes: ["Invalid RentCast API key."] };
      return { items: [], notes: [`RentCast HTTP ${res.status} on ${kind}.`] };
    }
    const data = (await res.json()) as RentcastListing[];
    if (!Array.isArray(data) || data.length === 0)
      return { items: [], notes: [`No ${kind} comps available within search radius.`] };

    const items = data
      .map((d) => normalizeListing(d, kind))
      .filter((c): c is Comp => c !== null);

    items.sort((a, b) => {
      const dA = a.distance ?? 99;
      const dB = b.distance ?? 99;
      if (Math.abs(dA - dB) > 0.05) return dA - dB;
      if (subjectSqft && a.squareFootage && b.squareFootage) {
        return (
          Math.abs(a.squareFootage - subjectSqft) -
          Math.abs(b.squareFootage - subjectSqft)
        );
      }
      return 0;
    });

    return { items: items.slice(0, 12), notes: [] };
  } catch (err) {
    return {
      items: [],
      notes: [
        `Could not fetch ${kind} comps: ${err instanceof Error ? err.message : "network error"}.`,
      ],
    };
  }
}

function normalizeListing(l: RentcastListing, kind: "sale" | "rent"): Comp | null {
  const price =
    kind === "sale"
      ? num(l.price ?? l.listPrice ?? l.lastSalePrice)
      : num(l.price ?? l.rent);
  if (!price || price <= 0) return null;
  const address = typeof l.formattedAddress === "string" ? l.formattedAddress : "";
  if (!address) return null;
  return {
    id: typeof l.id === "string" ? l.id : undefined,
    address,
    bedrooms: num(l.bedrooms),
    bathrooms: num(l.bathrooms),
    squareFootage: num(l.squareFootage),
    yearBuilt: num(l.yearBuilt),
    price,
    daysOnMarket: num(l.daysOnMarket),
    date: str(l.listedDate ?? l.listingDate ?? l.removedDate),
    distance: typeof l.distance === "number" ? Number(l.distance.toFixed(2)) : undefined,
    status: str(l.status),
    lat: typeof l.latitude === "number" ? l.latitude : undefined,
    lng: typeof l.longitude === "number" ? l.longitude : undefined,
    propertyType: str(l.propertyType),
    rolledUpCount: 1,
  };
}

// ---------------------------------------------------------------------------
// Dedupe comps by building — keeps the median within a building rather than
// letting a single building dominate (e.g. five units in one condo tower in
// the rent comps would otherwise skew the whole median). We group by the
// building-level address (street number + street name, ignoring unit suffix)
// and collapse each group down to one representative comp.
// ---------------------------------------------------------------------------

/**
 * Normalize an address into a canonical building-level key so near-duplicate
 * addresses collapse to the same group.
 *
 * Handles (in addition to the original unit/apt/# stripping):
 *   - Hyphenated lot/building numbers ("150-2 Claffey Dr" → "150 claffey dr")
 *   - Spurious bare numerics wedged between street number and street name
 *     ("150 2 Claffey Dr" → "150 claffey dr"). This is the §16.U.1 #4 /
 *     §20.9 #7 fix: Polson's rent pool had `150 Claffey Dr Unit Gdn` and
 *     `150 2 Claffey Dr Unit Gdn` that the old key treated as distinct,
 *     skewing thin-market medians.
 *   - Street-suffix variations ("Drive"/"Dr", "Avenue"/"Ave", etc.)
 *   - Directional prefix variations ("North"/"N", "Southeast"/"SE", etc.)
 *
 * We DO keep the canonical street suffix and directional in the key — they
 * carry real geographic information ("100 Main St" ≠ "100 Main Ave",
 * "100 N Main St" ≠ "100 S Main St"). Aggressive collapse on those would
 * cause false-positive merges.
 */
const STREET_SUFFIX_CANON: Record<string, string> = {
  st: "st", street: "st",
  ave: "ave", avenue: "ave", av: "ave",
  blvd: "blvd", boulevard: "blvd", boul: "blvd",
  rd: "rd", road: "rd",
  dr: "dr", drive: "dr",
  ln: "ln", lane: "ln",
  ct: "ct", court: "ct",
  pl: "pl", place: "pl",
  pkwy: "pkwy", parkway: "pkwy", pky: "pkwy",
  ter: "ter", terrace: "ter", terr: "ter",
  cir: "cir", circle: "cir", crl: "cir",
  trl: "trl", trail: "trl",
  cv: "cv", cove: "cv",
  sq: "sq", square: "sq",
  hwy: "hwy", highway: "hwy",
  way: "way",
  loop: "loop",
  row: "row",
  pt: "pt", point: "pt",
  xing: "xing", crossing: "xing",
  run: "run",
  vw: "vw", view: "vw",
};

const DIR_CANON: Record<string, string> = {
  n: "n", north: "n",
  s: "s", south: "s",
  e: "e", east: "e",
  w: "w", west: "w",
  ne: "ne", northeast: "ne",
  nw: "nw", northwest: "nw",
  se: "se", southeast: "se",
  sw: "sw", southwest: "sw",
};

function normalizeStreetToken(t: string): string {
  const lower = t.toLowerCase().replace(/[.,]/g, "");
  return STREET_SUFFIX_CANON[lower] ?? DIR_CANON[lower] ?? lower;
}

function isStreetSuffix(t: string): boolean {
  return STREET_SUFFIX_CANON[t.toLowerCase().replace(/[.,]/g, "")] !== undefined;
}
function isDirectional(t: string): boolean {
  return DIR_CANON[t.toLowerCase().replace(/[.,]/g, "")] !== undefined;
}

export function buildingKey(address: string): string {
  if (!address) return "";
  const first = (address.split(",")[0] ?? address).toLowerCase();
  // Strip unit / apt / suite / # suffixes (greedy — drop everything after).
  const noUnit = first
    .replace(/\s+(unit|apt|apartment|#|suite|ste|no\.?)\b.*$/i, "")
    .replace(/\s*#.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Tokenize on whitespace, hyphens, and slashes so "150-2 Claffey Dr" and
  // "150/2 Claffey Dr" tokenize the same as "150 2 Claffey Dr".
  const rawTokens = noUnit.split(/[\s\-/]+/).filter(Boolean);
  if (rawTokens.length === 0) return "";

  // Find the FIRST numeric token = street number. Allow trailing letter
  // suffix ("123A").
  const numIdx = rawTokens.findIndex((t) => /^\d+[a-z]?$/i.test(t));
  if (numIdx === -1) {
    // No street number — best-effort normalize the whole thing.
    return rawTokens.map(normalizeStreetToken).join(" ");
  }
  const streetNumber = rawTokens[numIdx].toLowerCase();

  // Walk the tail and drop bare numerics that are clearly NOT part of a
  // numbered street (e.g. "5 Ave" stays — `5` is followed by a suffix).
  // Bare numerics followed by a street name (non-suffix, non-directional
  // token) are spurious lot/building numbers and get stripped — that's the
  // §16.U.1 #4 case ("150 2 Claffey Dr" → drop the bare `2`).
  const tail = rawTokens.slice(numIdx + 1);
  const cleaned: string[] = [];
  for (let i = 0; i < tail.length; i++) {
    const t = tail[i];
    if (/^\d+$/.test(t)) {
      const next = tail[i + 1];
      if (next && !isStreetSuffix(next) && !isDirectional(next)) {
        // Drop the bare numeric — it's not part of a numbered street name.
        continue;
      }
    }
    cleaned.push(normalizeStreetToken(t));
  }

  return [streetNumber, ...cleaned].join(" ").trim();
}

function medianNum(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Collapse every group of comps at the same building down to one representative.
 * The representative uses the median price, median sqft, and the closest
 * in-group bed count to the subject (when we know the subject's beds).
 */
export function dedupeByBuilding(items: Comp[], subjectBeds: number | undefined): Comp[] {
  const groups = new Map<string, Comp[]>();
  for (const c of items) {
    const key = buildingKey(c.address);
    if (!key) {
      groups.set(`__single__${c.id ?? Math.random()}`, [c]);
      continue;
    }
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }

  const out: Comp[] = [];
  for (const [, bucket] of groups) {
    if (bucket.length === 1) {
      out.push(bucket[0]);
      continue;
    }
    const prices = bucket.map((c) => c.price).filter((n): n is number => !!n && n > 0);
    const sqfts = bucket.map((c) => c.squareFootage).filter((n): n is number => !!n && n > 0);
    // Prefer the representative whose bed count is closest to the subject,
    // then the one with the minimum distance. This keeps the comp card shown
    // to the user a real listing, not a synthetic median.
    const representative = [...bucket].sort((a, b) => {
      const bedScore = (c: Comp) => {
        if (!subjectBeds || !c.bedrooms) return 99;
        return Math.abs(c.bedrooms - subjectBeds);
      };
      const da = bedScore(a);
      const db = bedScore(b);
      if (da !== db) return da - db;
      return (a.distance ?? 99) - (b.distance ?? 99);
    })[0];

    out.push({
      ...representative,
      // Overwrite with the group's median price/sqft so the derivation uses
      // the building's central tendency, not one outlier unit.
      price: prices.length > 0 ? Math.round(medianNum(prices)) : representative.price,
      squareFootage:
        sqfts.length > 0 ? Math.round(medianNum(sqfts)) : representative.squareFootage,
      rolledUpCount: bucket.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

function summarize(items: Comp[]): CompStats {
  const values = items
    .map((c) => c.price)
    .filter((v): v is number => typeof v === "number" && v > 0);
  if (values.length === 0) return { count: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const psf = items
    .map((c) => (c.squareFootage && c.price ? c.price / c.squareFootage : undefined))
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    medianPricePerSqft: psf.length > 0 ? percentile(psf, 0.5) : undefined,
    medianRentPerSqft: psf.length > 0 ? percentile(psf, 0.5) : undefined,
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return Math.round(sortedAsc[lo]);
  const frac = idx - lo;
  return Math.round(sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac);
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function normalize(address: string): string {
  return address.toLowerCase().replace(/\s+/g, " ").replace(/[.,]/g, "").trim();
}
