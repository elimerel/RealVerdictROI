// ---------------------------------------------------------------------------
// Helpers for the Zillow URL flow. Extracted from the API route so they can
// be unit-tested in isolation. None of these talk to the network — they're
// pure string transforms over Zillow's URL conventions.
//
// The state-detection helper here is the SOURCE OF TRUTH for the URL flow.
// The resolver previously re-parsed state out of a composed address string
// (which sometimes lost the state token), causing §16.U #2.
// ---------------------------------------------------------------------------

const ZPID_FROM_PATH_RE = /\/(\d+)_zpid\b/i;
const ZPID_FROM_B_RE = /\/b\/(\d+)(?:\/|$)/i;
const SLUG_BEFORE_ZPID_RE = /\/([A-Za-z0-9-]+?)-\d+_zpid\b/i;

export const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
]);

export function extractZpidAndSlug(
  rawUrl: string,
): { zpid: string; slug: string } | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/zillow\.com$/i.test(u.hostname) && !u.hostname.endsWith(".zillow.com"))
    return null;

  const path = u.pathname;
  const zpidMatch = path.match(ZPID_FROM_PATH_RE) ?? path.match(ZPID_FROM_B_RE);
  if (zpidMatch) {
    const zpid = zpidMatch[1];
    const slugFromSuffix = path.match(SLUG_BEFORE_ZPID_RE)?.[1];
    let slug = slugFromSuffix ?? "";
    if (!slug) {
      const segments = path.split("/").filter(Boolean);
      const zpidIdx = segments.findIndex(
        (s) => s.endsWith("_zpid") || s === zpid,
      );
      if (zpidIdx > 0) slug = segments[zpidIdx - 1] ?? "";
    }
    return { zpid, slug };
  }

  const zpidQuery = u.searchParams.get("zpid");
  if (zpidQuery && /^\d+$/.test(zpidQuery)) {
    return { zpid: zpidQuery, slug: "" };
  }
  return null;
}

/**
 * Convert a Zillow URL slug into a canonical US address string.
 *
 *   "14215-Hawk-Stream-Cv-Hoagland-IN-46745"
 *     → "14215 Hawk Stream Cv, Hoagland, IN 46745"
 *
 * The trailing ZIP / 2-letter state are popped off heuristically; if either
 * is missing the rest of the slug is still returned in best-effort form so
 * the caller has *something* to feed into RentCast / geocoding.
 */
export function addressFromSlug(slug: string): string {
  const parts = slug.split("-").filter(Boolean);
  if (parts.length < 4) return slug.replace(/-/g, " ");
  const zip = /^\d{5}(?:-\d{4})?$/.test(parts[parts.length - 1])
    ? parts.pop()
    : undefined;
  const state =
    parts.length > 1 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1])
      ? parts.pop()?.toUpperCase()
      : undefined;
  const city = parts.length > 1 ? parts.pop() : undefined;
  const street = parts.join(" ");
  return [street, city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

/**
 * Recover a 2-letter US state code from any address string. Validates the
 * candidate against the canonical US state code set so we never return e.g.
 * "AB" or "ZZ" out of a malformed address. This is the SAME regex semantics
 * `lib/estimators.detectStateFromAddress` uses, kept here so the URL flow
 * doesn't have to import the heavier estimator module.
 *
 * Fixes §16.U #2: previously the resolver depended on
 * `detectStateFromAddress` re-parsing a composed address that sometimes had
 * lost the state token. Now zillow-parse extracts state at the source from
 * either the URL slug or Zillow's structured blob, validates it, and ships
 * it to the resolver as an explicit field.
 */
export function stateFromSlugAddress(address: string): string | undefined {
  if (!address) return undefined;
  const upper = address.toUpperCase();
  // Strip ONLY a trailing ZIP — anchored to end-of-string. A naive
  // `\b\d{5}\b` would eat the street number on addresses like
  // "14215 Hawk Stream Cv, Hoagland, IN 46745" (the original §16.U #2
  // failure mode), leaving the real ZIP dangling at the end and
  // preventing the trailing-state regex below from matching.
  const noZip = upper.replace(/[\s,]*\b\d{5}(?:-\d{4})?\s*$/, "").trim();
  const m = noZip.match(/[,\s]([A-Z]{2})\.?[\s,]*$/);
  if (m && US_STATE_CODES.has(m[1])) return m[1];
  return undefined;
}
