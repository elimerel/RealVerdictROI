import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/ratelimit";
import { withErrorReporting, logEvent, captureError } from "@/lib/observability";
import {
  addressFromSlug,
  extractZpidAndSlug,
  stateFromSlugAddress,
  US_STATE_CODES,
} from "@/lib/zillow-url";

// ---------------------------------------------------------------------------
// Zillow URL recognition + scrape orchestration.
//
// Slug + zpid extraction live in `lib/zillow-url.ts` so they're unit-testable
// without spinning up the route. This file focuses on the I/O layer:
// hitting ScraperAPI, parsing Zillow's __NEXT_DATA__ blob, and shipping a
// canonical ZillowParseResult downstream.
//
// Zillow URL shapes we recognise:
//   /homedetails/<slug>/<zpid>_zpid/
//   /homedetails/<zpid>_zpid/            (rare, slug-less)
//   /homes/for_sale/<slug>/<zpid>_zpid/
//   /homes/<slug>/<zpid>_zpid/
//   /b/<zpid>/                           (building-first permalinks)
//   ?zpid=...                            (search redirects)
// ---------------------------------------------------------------------------

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

// ---------------------------------------------------------------------------
// Public response type. Every numeric field is optional — the resolver layer
// is responsible for deciding which fields to apply and which to badge.
// ---------------------------------------------------------------------------

export type ZillowParseResult = {
  source: "scraperapi" | "url-fallback";
  zpid: string;
  url: string;
  /** Address string. Always populated — falls back to URL slug parse. */
  address: string;
  /**
   * 2-letter US state code, when we could resolve one from either Zillow's
   * structured address blob OR the URL slug. Passed through explicitly
   * (rather than re-parsed downstream) so the resolver doesn't have to
   * recover state from a composed string that may have lost it.
   *
   * Fixes §16.U #2: structured-blob composition can drop the state token
   * (when Zillow ships `state: ""`), and `detectStateFromAddress` then
   * returns undefined even though the URL slug contained "IN" all along.
   */
  state?: string;
  facts: {
    beds?: number;
    baths?: number;
    sqft?: number;
    yearBuilt?: number;
    lotSize?: number;
    propertyType?: string;
  };
  /** Money fields scraped directly from the listing. */
  listing: {
    listPrice?: number;
    zestimate?: number;
    rentZestimate?: number;
    monthlyHoa?: number;
    annualPropertyTax?: number;
    annualInsurance?: number;
    daysOnZillow?: number;
    pricePerSqft?: number;
    listingStatus?: string;
  };
  /** Notes from the scraper (e.g. which extraction path worked). */
  notes: string[];
};

// ---------------------------------------------------------------------------

export const POST = withErrorReporting("api.zillow-parse", async (req: Request) => {
  const limited = await enforceRateLimit(req, "zillow-parse");
  if (limited) return limited;

  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const url = body?.url?.trim();
  if (!url || typeof url !== "string") {
    return NextResponse.json(
      { error: "Provide a Zillow listing URL." },
      { status: 400 },
    );
  }

  const parsed = extractZpidAndSlug(url);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a Zillow listing URL. Expected something like zillow.com/homedetails/... or zillow.com/b/<zpid>/",
      },
      { status: 400 },
    );
  }

  const { zpid, slug } = parsed;
  const slugAddress = slug ? addressFromSlug(slug) : `Zillow listing ${zpid}`;
  const slugState = stateFromSlugAddress(slugAddress);

  // No scraper key → return a slug-only fallback so the resolver can still
  // chain into RentCast.
  if (!SCRAPER_API_KEY) {
    logEvent("zillow.parse.fallback", { reason: "no_scraper_key", zpid });
    return NextResponse.json({
      source: "url-fallback",
      zpid,
      url,
      address: slugAddress,
      state: slugState,
      facts: {},
      listing: {},
      notes: [
        "ScraperAPI is not configured on this server, so we couldn't read the listing directly. We'll fall back to public records using the address from the URL.",
      ],
    } satisfies ZillowParseResult);
  }

  // Scrape the listing.
  let html: string;
  try {
    const scraperUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
    const response = await fetch(scraperUrl, {
      next: { revalidate: 60 * 60 },
    });
    if (!response.ok) {
      logEvent("zillow.parse.fallback", {
        reason: "scraperapi_http_error",
        status: response.status,
        zpid,
      });
      return NextResponse.json(
        { error: `ScraperAPI returned HTTP ${response.status}.` },
        { status: 502 },
      );
    }
    html = await response.text();
  } catch (err) {
    captureError(err, {
      area: "api.zillow-parse",
      extra: { stage: "scraperapi_fetch", zpid, url },
    });
    return NextResponse.json(
      {
        error: `Could not reach ScraperAPI: ${err instanceof Error ? err.message : "unknown error"}.`,
      },
      { status: 502 },
    );
  }

  // Anti-bot / captcha detection. Zillow frequently serves a "press and hold"
  // PerimeterX interstitial that looks like a valid 200 response but contains
  // no property data. Detect it so the resolver can fall back to RentCast.
  if (isAntiBotPage(html)) {
    logEvent("zillow.parse.fallback", {
      reason: "anti_bot_page",
      zpid,
      htmlBytes: html.length,
    });
    return NextResponse.json({
      source: "url-fallback",
      zpid,
      url,
      address: slugAddress,
      state: slugState,
      facts: {},
      listing: {},
      notes: [
        "Zillow served an anti-bot page for this listing. Falling back to public records using the address from the URL.",
      ],
    } satisfies ZillowParseResult);
  }

  const result = extractListing(html, { url, zpid, slugAddress });
  return NextResponse.json(result);
});

// ---------------------------------------------------------------------------
// Extraction — JSON first (Zillow ships a __NEXT_DATA__ blob with everything),
// then a couple of regex fallbacks for the rare older page that hasn't been
// migrated. We do NOT use CSS selectors because Zillow renders everything
// client-side now.
// ---------------------------------------------------------------------------

function extractListing(
  html: string,
  ctx: { url: string; zpid: string; slugAddress: string },
): ZillowParseResult {
  // Recover the state from the URL slug as the SOURCE OF TRUTH for state
  // detection in the URL flow. The structured Zillow blob can ship an empty
  // `address.state` field, and re-parsing the composed address downstream
  // is fragile (formatting variations strip the state token). Explicit
  // pass-through prevents §16.U #2 entirely.
  const slugState = stateFromSlugAddress(ctx.slugAddress);

  const result: ZillowParseResult = {
    source: "scraperapi",
    zpid: ctx.zpid,
    url: ctx.url,
    address: ctx.slugAddress,
    state: slugState,
    facts: {},
    listing: {},
    notes: [],
  };

  // Try every known JSON-blob location, in order of reliability. Each returns
  // `{ property, path }` so we can note which path worked (useful for debug).
  const attempts = [
    findPropertyInNextData,
    findPropertyInGdpClientCache,
    findPropertyInApolloState,
  ];

  let property: PropertyBlob | null = null;
  let foundVia: string | null = null;
  for (const attempt of attempts) {
    const found = attempt(html, ctx.zpid);
    if (found) {
      property = found;
      foundVia = attempt.name;
      break;
    }
  }

  // Last-ditch: regex-pluck a zpid-matching record straight from the HTML.
  if (!property) {
    property = regexRescuePropertyForZpid(html, ctx.zpid);
    if (property) foundVia = "regexRescuePropertyForZpid";
  }

  if (!property) {
    logEvent("zillow.parse.strategy", {
      zpid: ctx.zpid,
      strategy: "none",
      success: false,
      htmlBytes: html.length,
    });
    result.notes.push(
      "Couldn't locate Zillow's data blob in the page — falling back to URL-based facts only.",
    );
    return result;
  }

  logEvent("zillow.parse.strategy", {
    zpid: ctx.zpid,
    strategy: foundVia,
    success: true,
  });

  // Address. Zillow stores either a structured object or a string.
  // Two cardinal rules here, both born from §16.U #2:
  //   1. Compose addresses in canonical US format: "Street, City, ST ZIP".
  //      The old composition omitted the comma between street and city,
  //      which works most of the time but trips trailing-state regex on
  //      addresses where the city is a single word ("Hoagland, IN 46745").
  //   2. NEVER overwrite a state-bearing slug address with a stateless
  //      structured one. If Zillow's blob ships an empty `address.state`,
  //      we keep the slug address (which already had the state) instead
  //      of silently downgrading.
  const addr = property.address ?? property.streetAddress;
  let blobState: string | undefined;
  if (typeof addr === "string" && addr.length > 0) {
    result.address = addr;
    blobState = stateFromSlugAddress(addr);
  } else if (addr && typeof addr === "object") {
    const a = addr as Record<string, unknown>;
    const street = String(a.streetAddress ?? "").trim();
    const city = String(a.city ?? "").trim();
    const stateRaw = String(a.state ?? "").trim();
    const zip = String(a.zipcode ?? a.postalCode ?? "").trim();
    const stateUpper = stateRaw.length === 2 ? stateRaw.toUpperCase() : stateRaw;
    const cityState = [city, stateUpper].filter(Boolean).join(", ");
    const tail = [cityState, zip].filter(Boolean).join(" ");
    const composed = [street, tail].filter(Boolean).join(", ");
    blobState =
      stateUpper.length === 2 && US_STATE_CODES.has(stateUpper)
        ? stateUpper
        : undefined;
    // Only adopt the composed address if it doesn't lose the state token
    // we already had from the slug. (Slug parsing is deterministic; the
    // structured blob is sometimes incomplete.)
    if (composed.length > 0) {
      const composedHasState = blobState !== undefined || stateFromSlugAddress(composed) !== undefined;
      if (composedHasState || !slugState) {
        result.address = composed;
      }
    }
  }
  // Choose state: blob wins (more authoritative when present), slug as backup.
  const resolvedState = blobState ?? slugState;
  if (resolvedState) result.state = resolvedState;

  // Facts.
  result.facts.beds = numberOrUndef(property.bedrooms);
  result.facts.baths = numberOrUndef(property.bathrooms);
  result.facts.sqft = numberOrUndef(property.livingArea ?? property.livingAreaValue);
  result.facts.yearBuilt = numberOrUndef(property.yearBuilt);
  result.facts.lotSize = numberOrUndef(property.lotSize);
  result.facts.propertyType =
    typeof property.homeType === "string"
      ? humanisePropertyType(property.homeType)
      : undefined;

  // Money / listing fields. Zillow uses several different keys depending on
  // the listing's status (for-sale vs off-market vs pending).
  result.listing.listPrice = numberOrUndef(
    property.price ?? property.unformattedPrice,
  );
  result.listing.zestimate = numberOrUndef(property.zestimate);
  result.listing.rentZestimate = numberOrUndef(property.rentZestimate);
  result.listing.monthlyHoa = numberOrUndef(
    property.monthlyHoaFee ?? property.hoaFee,
  );
  result.listing.daysOnZillow = numberOrUndef(property.daysOnZillow);
  result.listing.pricePerSqft = numberOrUndef(property.pricePerSquareFoot);
  result.listing.listingStatus =
    typeof property.homeStatus === "string"
      ? humaniseStatus(property.homeStatus)
      : undefined;

  // Annual property tax — listing pages either include a `propertyTaxRate` or
  // a `taxHistory` array of yearly records. Prefer the most recent record.
  const taxHistory = property.taxHistory;
  if (Array.isArray(taxHistory) && taxHistory.length > 0) {
    const latest = taxHistory
      .map((t) => ({
        amount: numberOrUndef((t as Record<string, unknown>).taxPaid),
        year: numberOrUndef((t as Record<string, unknown>).time),
      }))
      .filter((t) => t.amount && t.amount > 0)
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    if (latest[0]?.amount) result.listing.annualPropertyTax = latest[0].amount;
  }
  if (
    !result.listing.annualPropertyTax &&
    typeof property.propertyTaxRate === "number" &&
    result.listing.listPrice
  ) {
    result.listing.annualPropertyTax = Math.round(
      (result.listing.listPrice * property.propertyTaxRate) / 100,
    );
  }

  // Insurance estimate — Zillow shows one in the monthly affordability widget.
  if (typeof property.annualHomeownersInsurance === "number") {
    result.listing.annualInsurance = Math.round(
      property.annualHomeownersInsurance,
    );
  } else if (
    property.monthlyCosts &&
    typeof (property.monthlyCosts as Record<string, unknown>).homeInsurance ===
      "number"
  ) {
    const monthly = (property.monthlyCosts as Record<string, number>)
      .homeInsurance;
    result.listing.annualInsurance = Math.round(monthly * 12);
  }

  if (result.listing.listPrice && result.listing.listPrice > 0) {
    result.notes.push(
      `Pulled live data from the Zillow listing for ${result.address}.`,
    );
  } else if (result.listing.zestimate) {
    // Off-market / sold listing — still useful, just not a live list price.
    result.notes.push(
      `Zillow shows this as ${result.listing.listingStatus ?? "off-market"}; we're using the Zestimate as the starting price.`,
    );
  }

  // Debug note (only if all that's set so far is sparse — helps diagnose why).
  if (foundVia && !result.listing.listPrice && !result.listing.zestimate) {
    result.notes.push(
      `Found listing data via ${foundVia} but no price fields; check the listing status (pending/sold/off-market).`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// JSON-blob locators. Each tries to find Zillow's property record under a
// different code path. Order matters — __NEXT_DATA__ is most reliable.
// ---------------------------------------------------------------------------

type PropertyBlob = Record<string, unknown> & {
  zpid?: number | string;
  address?: unknown;
  streetAddress?: unknown;
  bedrooms?: number;
  bathrooms?: number;
  livingArea?: number;
  livingAreaValue?: number;
  yearBuilt?: number;
  lotSize?: number;
  homeType?: string;
  homeStatus?: string;
  price?: number;
  unformattedPrice?: number;
  zestimate?: number;
  rentZestimate?: number;
  monthlyHoaFee?: number;
  hoaFee?: number;
  daysOnZillow?: number;
  pricePerSquareFoot?: number;
  propertyTaxRate?: number;
  taxHistory?: unknown;
  annualHomeownersInsurance?: number;
  monthlyCosts?: unknown;
};

function findPropertyInNextData(
  html: string,
  targetZpid: string,
): PropertyBlob | null {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as Record<string, unknown>;
    const pageProps =
      ((data.props as Record<string, unknown> | undefined)?.pageProps as
        | Record<string, unknown>
        | undefined) ?? {};

    // Zillow has bounced this around a few times; check the common shapes,
    // starting with the most direct ones.
    const candidates: unknown[] = [
      pageProps.componentProps &&
        (pageProps.componentProps as Record<string, unknown>).gdpClientCache,
      pageProps.componentProps,
      pageProps.gdpClientCache,
      pageProps.initialReduxState,
      pageProps.property,
      pageProps.propertyDetails,
      pageProps, // last-ditch: walk the whole thing
    ];
    for (const c of candidates) {
      // Some of these candidates arrive as JSON-encoded strings (e.g.
      // gdpClientCache). Parse once before walking.
      const resolved = maybeParseJsonString(c);
      const found = walkForProperty(resolved, targetZpid);
      if (found) return found;
    }
  } catch {
    return null;
  }
  return null;
}

function findPropertyInGdpClientCache(
  html: string,
  targetZpid: string,
): PropertyBlob | null {
  // Older listings still use this inline blob. Zillow sometimes HTML-encodes
  // it (&quot;, &#x27;, etc.), so we decode before parsing.
  const m = html.match(
    /<script[^>]+id="hdpApolloPreloadedData"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) return null;
  try {
    const decoded = decodeHtmlEntities(m[1]);
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    const cache = maybeParseJsonString(
      parsed.gdpClientCache ?? parsed.apolloCache ?? parsed,
    );
    return walkForProperty(cache, targetZpid);
  } catch {
    return null;
  }
}

function findPropertyInApolloState(
  html: string,
  targetZpid: string,
): PropertyBlob | null {
  // Pulls the embedded Apollo cache (used on older / experimental pages).
  // The old regex with `};\s*<\/script>` was too strict — find `= ` then
  // bracket-match to the closing brace.
  const marker = html.indexOf("__APOLLO_STATE__");
  if (marker === -1) return null;
  const eq = html.indexOf("=", marker);
  if (eq === -1) return null;
  const start = html.indexOf("{", eq);
  if (start === -1) return null;
  const end = findMatchingBrace(html, start);
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(html.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    return walkForProperty(parsed, targetZpid);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Last-resort extractor: scan the raw HTML for any `"zpid":<target>` and walk
// outward to the enclosing JSON object. This catches listings where Zillow
// embeds the record inside a component prop we don't know about yet.
// ---------------------------------------------------------------------------

function regexRescuePropertyForZpid(
  html: string,
  targetZpid: string,
): PropertyBlob | null {
  const marker = new RegExp(`"zpid"\\s*:\\s*"?${targetZpid}"?`).exec(html);
  if (!marker) return null;
  // Find the start of the enclosing object by walking left and counting braces.
  const openIdx = findEnclosingBrace(html, marker.index);
  if (openIdx === -1) return null;
  const closeIdx = findMatchingBrace(html, openIdx);
  if (closeIdx === -1) return null;
  try {
    // The slice may be HTML-encoded; try both variants.
    const raw = html.slice(openIdx, closeIdx + 1);
    const parsed = JSON.parse(raw) as PropertyBlob;
    return parsed;
  } catch {
    try {
      const decoded = decodeHtmlEntities(html.slice(openIdx, closeIdx + 1));
      return JSON.parse(decoded) as PropertyBlob;
    } catch {
      return null;
    }
  }
}

/**
 * Recursively walks any JSON value looking for an object that has the
 * "shape" of a Zillow property record. We loosened the accept rule: either
 *   (a) its zpid matches the one in the URL, OR
 *   (b) it has enough property-shaped fields to be a listing on its own
 *       (price / zestimate + beds / zpid).
 * Bounded depth so we don't blow the stack on huge payloads.
 */
function walkForProperty(
  value: unknown,
  targetZpid: string,
  depth = 0,
): PropertyBlob | null {
  if (depth > 10 || value === null || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;

  // Preferred match — the zpid in this object matches the listing we asked
  // for. Prefer it even over deeper property-shaped objects.
  if (
    (typeof obj.zpid === "number" && String(obj.zpid) === targetZpid) ||
    (typeof obj.zpid === "string" && obj.zpid === targetZpid)
  ) {
    if (looksLikeProperty(obj)) return obj as PropertyBlob;
  }

  if (looksLikeProperty(obj) && isRoughlyPropertySized(obj)) {
    return obj as PropertyBlob;
  }

  // Recurse into children. Arrays and objects both.
  const children = Array.isArray(value) ? value : Object.values(obj);
  for (const child of children) {
    const found = walkForProperty(child, targetZpid, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Minimum signals that a JSON object represents a property listing. */
function looksLikeProperty(obj: Record<string, unknown>): boolean {
  const hasPriceSignal =
    typeof obj.price === "number" ||
    typeof obj.unformattedPrice === "number" ||
    typeof obj.zestimate === "number" ||
    typeof obj.rentZestimate === "number";
  const hasIdentitySignal =
    typeof obj.zpid === "number" ||
    typeof obj.zpid === "string" ||
    typeof obj.bedrooms === "number" ||
    typeof obj.livingArea === "number" ||
    obj.streetAddress !== undefined ||
    obj.address !== undefined;
  return hasPriceSignal && hasIdentitySignal;
}

/**
 * Prevents `walkForProperty` from locking onto tiny stub objects that happen
 * to have e.g. `{ price, zpid }` but nothing else useful.
 */
function isRoughlyPropertySized(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).length >= 5;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Peeks past strings that contain JSON (a pattern Zillow uses for
 * `gdpClientCache` and similar). Returns the parsed value if it looks like
 * JSON, otherwise the original value.
 */
function maybeParseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** Finds the matching `}` for the `{` at `start`. Returns -1 if unbalanced. */
function findMatchingBrace(html: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Walks LEFT from `index` to find the `{` that opens the enclosing JSON
 * object. Uses depth counting so we don't match the object containing this
 * one. Returns -1 if none found.
 */
function findEnclosingBrace(html: string, index: number): number {
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    const ch = html[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/**
 * Decodes the entities Zillow actually emits inside script tags. We don't need
 * a full HTML parser — just the handful of encodings that break JSON.parse.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * True if the response body is a PerimeterX / captcha interstitial rather
 * than a real listing page.
 */
function isAntiBotPage(html: string): boolean {
  if (html.length < 2000) return true; // no real listing is this small
  return (
    /Press & Hold to confirm/i.test(html) ||
    /PX-Captcha/i.test(html) ||
    /perimeterx\.com/i.test(html) ||
    /Please verify you are a human/i.test(html) ||
    /robot check/i.test(html)
  );
}

function numberOrUndef(value: unknown): number | undefined {
  if (typeof value === "number" && isFinite(value) && value > 0)
    return Math.round(value);
  if (typeof value === "string") {
    const cleaned = Number(value.replace(/[$,\s]/g, ""));
    if (isFinite(cleaned) && cleaned > 0) return Math.round(cleaned);
  }
  return undefined;
}

function humanisePropertyType(homeType: string): string {
  const map: Record<string, string> = {
    SINGLE_FAMILY: "Single Family",
    CONDO: "Condo",
    TOWNHOUSE: "Townhouse",
    MULTI_FAMILY: "Multi Family",
    APARTMENT: "Apartment",
    LOT: "Lot",
    MANUFACTURED: "Manufactured",
  };
  return map[homeType] ?? homeType;
}

function humaniseStatus(homeStatus: string): string {
  const map: Record<string, string> = {
    FOR_SALE: "For sale",
    PENDING: "Pending",
    SOLD: "Sold",
    OFF_MARKET: "Off market",
    COMING_SOON: "Coming soon",
  };
  return map[homeStatus] ?? homeStatus;
}
