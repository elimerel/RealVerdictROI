// Live macro rates. Today this is a single call to FRED for the Freddie Mac
// 30-year fixed mortgage rate (series MORTGAGE30US, weekly). Future rate
// series (10yr Treasury for cap-rate spread analysis, PMI tables, etc.) would
// live here too.
//
// Design contract:
//   - Always caller-safe: returns null on any failure (missing key, HTTP 5xx,
//     parse error, timeout). The property-resolver falls back to
//     DEFAULT_INPUTS.loanInterestRate when we hand back null, so a dead FRED
//     never crashes the form.
//   - 24h process-local cache. Rates only change once a week, so even 24h is
//     more conservative than it needs to be.
//   - `asOf` is the FRED observation date (the Thursday PMMS release), NOT
//     when we fetched it. This is what we surface to the user.
//
// FRED API reference:
//   https://fred.stlouisfed.org/docs/api/fred/series_observations.html
//   Free key at https://fred.stlouisfed.org/docs/api/api_key.html

import { KVCache } from "./kv-cache";

export type MortgageRate = {
  /** e.g. 7.12 (percent, not decimal). */
  rate: number;
  /** ISO date of the FRED observation (weekly Thursday release), e.g. 2026-04-17. */
  asOf: string;
};

// FRED publishes MORTGAGE30US weekly. 24h cache is more than enough and keeps
// us out of their rate limits during local dev.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new KVCache<MortgageRate>("rates", CACHE_TTL_MS);
const NEG_CACHE_TTL_MS = 10 * 60 * 1000;
const negativeCache = new KVCache<true>("rates-neg", NEG_CACHE_TTL_MS);

const CACHE_KEY = "MORTGAGE30US";
const FETCH_TIMEOUT_MS = 4_000;

type FredObservation = {
  date: string;
  value: string;
};

type FredResponse = {
  observations?: FredObservation[];
};

/**
 * Fetch the most recent Freddie Mac PMMS 30-year fixed rate from FRED.
 *
 * Returns null if:
 *   - `FRED_API_KEY` is missing (dev without the key set)
 *   - network / HTTP error
 *   - FRED returned no usable observations
 *   - response parsing failed
 *
 * The caller is responsible for falling back to a default. Never throws.
 */
export async function getCurrentMortgageRate(): Promise<MortgageRate | null> {
  const cached = await cache.get(CACHE_KEY);
  if (cached) return cached;
  if (await negativeCache.get(CACHE_KEY)) return null;

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    await negativeCache.set(CACHE_KEY, true);
    return null;
  }

  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", "MORTGAGE30US");
  url.searchParams.set("limit", "1");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("file_type", "json");
  url.searchParams.set("api_key", apiKey);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      // FRED data changes once a week — let Next cache for 24h too.
      next: { revalidate: 86_400 },
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      await negativeCache.set(CACHE_KEY, true);
      return null;
    }

    const payload = (await res.json()) as FredResponse;
    const obs = payload.observations?.[0];
    if (!obs) {
      await negativeCache.set(CACHE_KEY, true);
      return null;
    }

    // FRED uses the sentinel "." for missing observations. Skip those.
    const rate = Number(obs.value);
    if (!Number.isFinite(rate) || rate <= 0) {
      await negativeCache.set(CACHE_KEY, true);
      return null;
    }

    const result: MortgageRate = { rate, asOf: obs.date };
    await cache.set(CACHE_KEY, result);
    return result;
  } catch {
    await negativeCache.set(CACHE_KEY, true);
    return null;
  }
}

/**
 * Human-friendly provenance note for the FRED mortgage rate. Centralised so
 * the homepage's first-paint badge and the resolver's autofill badge stay
 * worded identically.
 */
export function fredRateNote(r: MortgageRate): string {
  return `Freddie Mac 30-yr fixed (PMMS), week of ${r.asOf}. Updated weekly from FRED.`;
}
