// Metro-level house-price appreciation, derived from the FHFA Purchase-Only
// House Price Index for the 100 largest MSAs. See scripts/build-fhfa-hpi.mjs
// for how the bundled JSON files are generated.
//
// Design contract:
//   - Pure lookup, no network. Both input tables are imported as bundled
//     JSON, ~110 KB total — trivial cost and zero runtime dependency.
//   - Returns null when the subject zip isn't in an FHFA top-100 metro. The
//     resolver then falls back to DEFAULT_INPUTS.annualAppreciationPercent
//     and the provenance badge reads "Default" instead of "FHFA HPI".
//   - We use trailing-10-year CAGR as the forward-projection rate, not the
//     trailing-5yr. The 5yr window through 2025 is distorted by the 2020–22
//     COVID spike; the 10yr window averages across that cycle and is a more
//     defensible single number for a 10-year hold. We still surface 5yr in
//     the tooltip so the user can sanity-check.
//   - CAGR is a decimal percent (e.g. 6.36 means 6.36%/yr) — same convention
//     as DealInputs.annualAppreciationPercent.

import hpiData from "@/data/fhfa-hpi-metro.json";
import zipData from "@/data/zip-to-cbsa.json";

type HpiEntry = {
  name: string;
  rate5yr: number | null;
  rate10yr: number | null;
  asOf: string;
};
type HpiFile = { metros: Record<string, HpiEntry> };
type ZipFile = { zips: Record<string, string> };

const HPI = (hpiData as unknown as HpiFile).metros;
const ZIPS = (zipData as unknown as ZipFile).zips;

export type MetroAppreciation = {
  /** Annual percent, e.g. 6.36 means 6.36%/yr. Never null — if we return
   *  a result, we have a rate. */
  rate: number;
  /** Which window produced `rate`: 10-year is the primary; we only drop to
   *  5-year when the metro has no 10yr series (rare — usually newer MSADs). */
  window: "10yr" | "5yr";
  /** CBSA or MSAD name, e.g. "Austin-Round Rock-San Marcos, TX". */
  metro: string;
  /** FHFA quarter the index is current through, e.g. "2025Q4". */
  asOf: string;
  /** Trailing 5yr CAGR (may equal `rate` if 10yr wasn't available), surfaced
   *  only in the tooltip so the user can see both windows. */
  rate5yr: number | null;
  rate10yr: number | null;
  /** CBSA / MSAD numeric code, for debugging. */
  cbsa: string;
};

/**
 * Look up metro appreciation for a subject zip code.
 *
 * Returns null if:
 *   - The zip is not 5 digits
 *   - The zip isn't in an FHFA top-100 metro (rural areas, some secondary
 *     metros, Puerto Rico, etc.)
 *   - The metro has no usable rate series (shouldn't happen — sanity guard)
 */
export function getMetroAppreciation(
  zip: string | undefined | null,
): MetroAppreciation | null {
  if (!zip) return null;
  const z = zip.trim();
  if (!/^\d{5}$/.test(z)) return null;
  const cbsa = ZIPS[z];
  if (!cbsa) return null;
  const entry = HPI[cbsa];
  if (!entry) return null;
  if (entry.rate10yr != null) {
    return {
      rate: entry.rate10yr,
      window: "10yr",
      metro: entry.name,
      asOf: entry.asOf,
      rate5yr: entry.rate5yr,
      rate10yr: entry.rate10yr,
      cbsa,
    };
  }
  if (entry.rate5yr != null) {
    return {
      rate: entry.rate5yr,
      window: "5yr",
      metro: entry.name,
      asOf: entry.asOf,
      rate5yr: entry.rate5yr,
      rate10yr: entry.rate10yr,
      cbsa,
    };
  }
  return null;
}

/**
 * Extract a 5-digit US ZIP code from a free-form address string, if any.
 * Matches `NNNNN` or `NNNNN-NNNN` anywhere in the string. We prefer the
 * LAST match since addresses usually end with the zip.
 */
export function zipFromAddress(
  address: string | undefined | null,
): string | undefined {
  if (!address) return undefined;
  const matches = address.match(/\b(\d{5})(?:-\d{4})?\b/g);
  if (!matches || matches.length === 0) return undefined;
  // Last match — the trailing token in "2315 Ave H, Austin, TX 78722".
  const last = matches[matches.length - 1];
  return last.slice(0, 5);
}

/** Human-friendly badge-tooltip wording, centralised so UI and resolver
 *  stay worded identically. */
export function metroAppreciationNote(m: MetroAppreciation): string {
  const parts: string[] = [];
  parts.push(`${m.metro} trailing ${m.window} CAGR: ${m.rate.toFixed(2)}%.`);
  if (m.window === "10yr" && m.rate5yr != null) {
    parts.push(`Trailing 5yr: ${m.rate5yr.toFixed(2)}%.`);
  }
  parts.push(`FHFA Purchase-Only HPI, ${m.asOf}.`);
  return parts.join(" ");
}
