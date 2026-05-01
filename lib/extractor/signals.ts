// ---------------------------------------------------------------------------
// Stage 2 — Page signal pre-check
// ---------------------------------------------------------------------------
//
// Before we spend a token on the LLM, we look at the rendered DOM text
// and count listing fingerprints. The goal: rule out pages that aren't
// listings (search results, neighborhood pages, news articles, social
// posts that happen to mention real estate) so the AI is only ever asked
// to read pages that actually look like a single listing.
//
// This is fast, free, deterministic, and prevents two failure modes:
//   1. "AI returned garbage on a search-results page" — we don't ask.
//   2. "Spent tokens on a page with $0 of useful data" — we don't pay.
//
// Tunable: SIGNAL_THRESHOLD. Tighter = fewer false starts but more
// missed listings. Looser = more spend but better recall on weird sites.
// ---------------------------------------------------------------------------

export type SignalReport = {
  score: number
  hits: string[]
  /** True if score >= SIGNAL_THRESHOLD — the page LOOKS like a listing. */
  looksLikeListing: boolean
  /** True if the page has multiple listing-like blocks (likely a search
   *  results page, where AI would pick the wrong one). */
  looksLikeSearchResults: boolean
}

/** Each entry contributes to the page score. Tuned to be specific enough
 *  that a generic news article or social post won't trip the threshold,
 *  but loose enough that any of the 5+ major real-estate sites will. */
const SIGNAL_PATTERNS: Array<{ id: string; re: RegExp; weight: number }> = [
  // Strong signals — these phrases are basically only on listings.
  { id: "list-price",   re: /\b(list(ed)?\s+price|listing\s+price|asking\s+price|listed\s+for)\b/i, weight: 3 },
  { id: "for-sale",     re: /\bfor\s+sale\b/i,                                                       weight: 2 },
  { id: "zestimate",    re: /\b(zestimate|redfin\s+estimate|realtor\.com\s+estimate)\b/i,            weight: 3 },
  { id: "rent-est",     re: /\b(rent\s+zestimate|rental\s+estimate|estimated\s+rent|market\s+rent)\b/i, weight: 2 },
  { id: "mls",          re: /\bmls\s*#?\s*[A-Z0-9-]+/i,                                              weight: 3 },
  { id: "days-on-mkt",  re: /\bdays?\s+on\s+(zillow|market|redfin)/i,                                weight: 2 },
  { id: "year-built",   re: /\byear\s+built\b/i,                                                      weight: 2 },
  { id: "lot-size",     re: /\blot\s+(size|sq\s*ft|acres?)\b/i,                                       weight: 1 },
  { id: "hoa",          re: /\bhoa\b|\bhomeowners?\s+association\b/i,                                weight: 1 },
  { id: "property-tax", re: /\b(property\s+tax(es)?|annual\s+tax(es)?|tax\s+history)\b/i,            weight: 1 },

  // Medium signals — common on listings but also elsewhere.
  { id: "beds",         re: /\b\d+\s*(bed|br|beds|bedrooms?)\b/i,                                    weight: 2 },
  { id: "baths",        re: /\b\d+(\.\d+)?\s*(bath|ba|baths|bathrooms?)\b/i,                         weight: 2 },
  { id: "sqft",         re: /\b\d{3,5}\s*(sq\s*\.?\s*ft|sqft|square\s*feet)\b/i,                     weight: 2 },

  // Currency presence — a real listing has a price.
  { id: "price-shape",  re: /\$[\s]*\d{2,3}(?:,\d{3}){1,3}/,                                          weight: 2 },

  // Street/address shape — real listings have one prominent address.
  { id: "street-name",  re: /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Ter|Terrace|Cir|Circle|Pkwy|Parkway)\b/, weight: 2 },
]

/** Patterns that strongly suggest a page lists MANY properties, not one.
 *  When we see these, we skip the AI call — the model would pick the wrong
 *  property to underwrite. */
const SEARCH_RESULTS_PATTERNS: RegExp[] = [
  /\b\d{2,5}\s+(homes?|properties|listings?|results?)\s+(for\s+sale|matched|found|available)/i,
  /\bsort\s+by:?\s*(price|beds|sqft|newest|relevance)/i,
  /\bshowing\s+\d+\s*(-|–|to)\s*\d+\s+of\s+\d+/i,
  /\bsave\s+search\b/i,
  /\bprice\s+range\b.*\bbeds\b.*\bbaths\b/i,
]

const SIGNAL_THRESHOLD = 6

/** URL paths that ARE a single-listing page on the major sites.
 *  When the URL matches one of these we trust the URL over the page-text
 *  heuristics — Zillow / Redfin / Realtor sprinkle 8+ related-property
 *  prices on every real listing page (carousels, similar homes, price
 *  history) which would otherwise trip the search-results guard.
 */
const STRONG_LISTING_URL_PATTERNS: RegExp[] = [
  /\/homedetails\//i,
  /\/home\/[a-z0-9-]+/i,
  /\/realestateandhomes-detail\//i,
  /\/property\/[a-z0-9-]+/i,
  /\/property-detail\//i,
  /\/listing\/[a-z0-9-]+/i,
]

export function isStrongListingUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return STRONG_LISTING_URL_PATTERNS.some((re) => re.test(u.pathname))
  } catch { return false }
}

export function scanSignals(text: string, url?: string): SignalReport {
  const t = text || ""
  const hits: string[] = []
  let score = 0

  for (const sig of SIGNAL_PATTERNS) {
    if (sig.re.test(t)) {
      hits.push(sig.id)
      score += sig.weight
    }
  }

  const strongUrl = url ? isStrongListingUrl(url) : false
  const priceMatches = (t.match(/\$\s*\d{2,3}(?:,\d{3}){1,3}/g) || []).length

  // Only treat as search-results when an EXPLICIT search-results phrase
  // appears in the text. Pure price-count is too noisy on real listings
  // (carousels of similar homes routinely produce 8-12 price blocks).
  let looksLikeSearchResults = false
  for (const re of SEARCH_RESULTS_PATTERNS) {
    if (re.test(t)) { looksLikeSearchResults = true; break }
  }
  // For unknown hosts, fall back to a much higher price-count ceiling so
  // it's a real "many listings on one page" signal, not chrome noise.
  if (!strongUrl && priceMatches > 14) looksLikeSearchResults = true

  // A strong listing URL effectively contributes ~3 points of evidence —
  // lower the listing-signal bar accordingly.
  const effectiveThreshold = strongUrl ? 3 : SIGNAL_THRESHOLD

  return {
    score,
    hits,
    looksLikeListing: score >= effectiveThreshold,
    looksLikeSearchResults,
  }
}
