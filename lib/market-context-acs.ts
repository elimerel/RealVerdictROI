import "server-only";

import type { AcsZipProfile } from "@/lib/market-context";

const ACS_CACHE = new Map<
  string,
  { expires: number; value: AcsZipProfile | null }
>();
const ACS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACS_YEARS_TRY = [2023, 2022, 2021] as const;

function parseCensusInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

function parseVacancyRate(
  total: number | undefined,
  vacant: number | undefined,
): number | undefined {
  if (total === undefined || vacant === undefined || total <= 0) return undefined;
  return vacant / total;
}

/** Census ACS 5-year at ZCTA; cached per process. Optional CENSUS_API_KEY. */
export async function fetchAcsZipProfile(
  zip: string,
): Promise<AcsZipProfile | null> {
  if (!/^\d{5}$/.test(zip)) return null;

  const now = Date.now();
  const hit = ACS_CACHE.get(zip);
  if (hit && hit.expires > now) return hit.value;

  const key = process.env.CENSUS_API_KEY;
  const keyParam = key ? `&key=${encodeURIComponent(key)}` : "";

  let profile: AcsZipProfile | null = null;

  for (const year of ACS_YEARS_TRY) {
    const url =
      `https://api.census.gov/data/${year}/acs/acs5` +
      `?get=NAME,B25064_001E,B25077_001E,B19013_001E,B25002_001E,B25002_003E` +
      `&for=zip%20code%20tabulation%20area:${zip}${keyParam}`;

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
        next: { revalidate: 86400 },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      if (!Array.isArray(json) || json.length < 2) continue;
      const row = json[1] as string[];
      if (!Array.isArray(row) || row.length < 6) continue;

      const medianRent = parseCensusInt(row[1]);
      const medianValue = parseCensusInt(row[2]);
      const medianIncome = parseCensusInt(row[3]);
      const totalUnits = parseCensusInt(row[4]);
      const vacantUnits = parseCensusInt(row[5]);
      const vacancy = parseVacancyRate(totalUnits, vacantUnits);

      if (
        medianRent === undefined &&
        medianValue === undefined &&
        medianIncome === undefined &&
        vacancy === undefined
      ) {
        continue;
      }

      profile = {
        zip,
        vintageYear: year,
        medianGrossRentMonthly: medianRent ?? 0,
        medianOwnerOccupiedValue: medianValue ?? 0,
        medianHouseholdIncome: medianIncome ?? 0,
        housingVacancyRate: vacancy ?? 0,
      };
      break;
    } catch {
      continue;
    }
  }

  ACS_CACHE.set(zip, { expires: now + ACS_TTL_MS, value: profile });
  return profile;
}
