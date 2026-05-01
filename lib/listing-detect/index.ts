// ---------------------------------------------------------------------------
// listing-detect — URL HINTING (not classification)
// ---------------------------------------------------------------------------
//
// The model is the brain. This module is a tiny URL hinter for two things:
//
//   1. "Should we auto-run the extractor on this page, or wait for the user
//      to ask?" — purely a cost/UX gate. If the URL looks even vaguely like
//      real estate, we run; otherwise we wait.
//   2. "What's the source tag for this saved deal?" — so a saved listing
//      shows the right initial badge in the Pipeline.
//
// What this module DOES NOT do:
//   - Decide if a page is a listing. The AI does that, after reading the
//     rendered DOM.
//   - Reject unknown sites. Anything that smells like real estate gets a
//     best-effort AI pass — that's the wedge.
// ---------------------------------------------------------------------------

export type SourceTag =
  | "zillow"
  | "redfin"
  | "realtor"
  | "homes"
  | "trulia"
  | "movoto"
  | "loopnet"
  | "compass"
  | "coldwellbanker"
  | "kw"
  | "remax"
  | "century21"
  | "other"
  | null

const SUPPORTED_HOSTS: Record<Exclude<SourceTag, null | "other">, RegExp> = {
  zillow:        /(?:^|\.)zillow\.com$/i,
  redfin:        /(?:^|\.)redfin\.com$/i,
  realtor:       /(?:^|\.)realtor\.com$/i,
  homes:         /(?:^|\.)homes\.com$/i,
  trulia:        /(?:^|\.)trulia\.com$/i,
  movoto:        /(?:^|\.)movoto\.com$/i,
  loopnet:       /(?:^|\.)loopnet\.com$/i,
  compass:       /(?:^|\.)compass\.com$/i,
  coldwellbanker:/(?:^|\.)coldwellbankerhomes?\.com$/i,
  kw:            /(?:^|\.)kw\.com$/i,
  remax:         /(?:^|\.)remax\.com$/i,
  century21:     /(?:^|\.)century21\.com$/i,
}

/** Real-estate-ish path tokens — we run extraction when a URL contains
 *  any of these AND the host isn't obviously not-real-estate. */
const LISTING_PATH_HINTS = [
  /\/homedetails\//i,
  /\/home\/[a-z0-9-]+/i,
  /\/property\/[a-z0-9-]+/i,
  /\/listing\/[a-z0-9-]+/i,
  /\/for-sale\//i,
  /\/for-rent\//i,
  /\/realestateandhomes-detail\//i,
  /\/idx\//i,
  /\/mls\//i,
  /\/properties\/[a-z0-9-]+/i,
]

/** Hosts we know are not real estate — we never auto-run extraction here. */
const NEVER_HOSTS = [
  /(?:^|\.)google\.[a-z.]+$/i,
  /(?:^|\.)bing\.com$/i,
  /(?:^|\.)duckduckgo\.com$/i,
  /(?:^|\.)twitter\.com$/i,
  /(?:^|\.)x\.com$/i,
  /(?:^|\.)facebook\.com$/i,
  /(?:^|\.)instagram\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)youtube\.com$/i,
  /(?:^|\.)reddit\.com$/i,
  /(?:^|\.)nytimes\.com$/i,
  /(?:^|\.)wikipedia\.org$/i,
  /(?:^|\.)github\.com$/i,
  /(?:^|\.)stackoverflow\.com$/i,
  /(?:^|\.)apple\.com$/i,
  /(?:^|\.)microsoft\.com$/i,
]

function urlParts(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url)
    return { host: u.hostname, path: u.pathname + u.search }
  } catch {
    return null
  }
}

/** Best-effort source tag. Returns "other" for a custom MLS / broker site
 *  that LOOKS like real estate but isn't on our supported list, and null
 *  for anything we definitely don't tag. */
export function sourceFor(url: string): SourceTag {
  const parts = urlParts(url)
  if (!parts) return null
  if (NEVER_HOSTS.some((re) => re.test(parts.host))) return null
  for (const [name, re] of Object.entries(SUPPORTED_HOSTS)) {
    if (re.test(parts.host)) return name as SourceTag
  }
  if (LISTING_PATH_HINTS.some((re) => re.test(parts.path))) return "other"
  return null
}

/** Hint for "should we auto-run extraction on this URL?". A `true` here is
 *  a yes-please-spend-the-tokens decision. False means: stay quiet, panel
 *  collapses to its strip state, user can hit ⌘K to force it. */
export function shouldAutoExtract(url: string): boolean {
  const parts = urlParts(url)
  if (!parts) return false
  if (NEVER_HOSTS.some((re) => re.test(parts.host))) return false

  // Known supported host — always go.
  for (const re of Object.values(SUPPORTED_HOSTS)) {
    if (re.test(parts.host)) return true
  }

  // Unknown host but the path looks like a listing — best-effort go. This
  // is the multi-site promise: custom broker pages, IDX vendors, MLS
  // direct, regional boutiques. The AI decides what to do with it.
  if (LISTING_PATH_HINTS.some((re) => re.test(parts.path))) return true

  return false
}

/** Human-readable source label for badges. */
export function sourceLabel(tag: SourceTag): string {
  switch (tag) {
    case "zillow":         return "Zillow"
    case "redfin":         return "Redfin"
    case "realtor":        return "Realtor.com"
    case "homes":          return "Homes.com"
    case "trulia":         return "Trulia"
    case "movoto":         return "Movoto"
    case "loopnet":        return "LoopNet"
    case "compass":        return "Compass"
    case "coldwellbanker": return "Coldwell Banker"
    case "kw":             return "KW"
    case "remax":          return "RE/MAX"
    case "century21":      return "Century 21"
    case "other":          return "Listing"
    case null:             return ""
  }
}
