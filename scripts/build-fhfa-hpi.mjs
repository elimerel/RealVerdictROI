#!/usr/bin/env node
/**
 * build-fhfa-hpi.mjs
 *
 * Preprocessing script for Phase A2 of the data-source roadmap:
 *   - Downloads FHFA's quarterly Purchase-Only HPI for the 100 largest MSAs.
 *   - Downloads the Census 2020 ZCTA→County relationship file.
 *   - Downloads NBER's CBSA→County FIPS crosswalk.
 *   - Composes them into two tiny JSON tables bundled into /data:
 *       - data/fhfa-hpi-metro.json : cbsa → { name, rate5yr, rate10yr, asOf }
 *       - data/zip-to-cbsa.json    : zip5  → cbsa
 *
 * Run quarterly (or after a fresh FHFA release):
 *     node scripts/build-fhfa-hpi.mjs
 *
 * Pure Node, no deps. No API keys. The runtime code in lib/appreciation.ts
 * imports the JSONs directly, so the deployed app does no network I/O for
 * this data.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const URLS = {
  fhfaHpi:
    "https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_po_metro.txt",
  zctaCounty:
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
  cbsaCounty:
    "https://data.nber.org/cbsa-csa-fips-county-crosswalk/2023/cbsa2fipsxw_2023.csv",
};

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const outputDir = resolve(__dirname, "..", "data");

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// FHFA HPI parsing
// ---------------------------------------------------------------------------

/**
 * FHFA TSV columns: cbsa, metro_name, yr, qtr, index_nsa, index_sa.
 * We use the seasonally-adjusted index (more representative for CAGR).
 * metro_name comes quoted ("Albany-Schenectady-Troy, NY") — we unquote.
 *
 * Output:
 *   metros[cbsa] = { name, series: [{ yr, qtr, idx }], latest, prev5, prev10 }
 */
function parseFhfaHpi(raw) {
  const lines = raw.trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header || !header.startsWith("cbsa")) {
    throw new Error(`Unexpected FHFA header: ${header}`);
  }
  const metros = new Map();
  for (const line of lines) {
    // Fields are tab-separated; metro_name contains a comma but no tab.
    const cols = line.split("\t");
    if (cols.length < 6) continue;
    const [cbsa, nameRaw, yrStr, qtrStr, , idxSaStr] = cols;
    const idx = Number(idxSaStr);
    if (!Number.isFinite(idx) || idx <= 0) continue;
    const yr = Number(yrStr);
    const qtr = Number(qtrStr);
    if (!Number.isFinite(yr) || !Number.isFinite(qtr)) continue;
    const name = nameRaw.replace(/^"|"$/g, "").trim();
    let m = metros.get(cbsa);
    if (!m) {
      m = { cbsa, name, series: [] };
      metros.set(cbsa, m);
    }
    m.series.push({ yr, qtr, idx });
  }
  // Sort each metro's series ascending. For each metro, compute trailing
  // 5yr and 10yr CAGR from the latest observation back.
  const out = {};
  for (const m of metros.values()) {
    m.series.sort((a, b) => a.yr - b.yr || a.qtr - b.qtr);
    const latest = m.series[m.series.length - 1];
    if (!latest) continue;
    const targetYr5 = latest.yr - 5;
    const targetYr10 = latest.yr - 10;
    const prev5 = findQuarterAtOrAfter(m.series, targetYr5, latest.qtr);
    const prev10 = findQuarterAtOrAfter(m.series, targetYr10, latest.qtr);
    const rate5yr = prev5
      ? (Math.pow(latest.idx / prev5.idx, 1 / 5) - 1) * 100
      : null;
    const rate10yr = prev10
      ? (Math.pow(latest.idx / prev10.idx, 1 / 10) - 1) * 100
      : null;
    out[m.cbsa] = {
      name: m.name,
      // Round to 0.01% — more precision than that is false confidence.
      rate5yr: rate5yr != null ? Math.round(rate5yr * 100) / 100 : null,
      rate10yr: rate10yr != null ? Math.round(rate10yr * 100) / 100 : null,
      asOf: `${latest.yr}Q${latest.qtr}`,
      latestIndex: latest.idx,
    };
  }
  return out;
}

function findQuarterAtOrAfter(series, yr, qtr) {
  // Exact match preferred; otherwise the first observation in that year.
  for (const obs of series) {
    if (obs.yr === yr && obs.qtr === qtr) return obs;
  }
  for (const obs of series) {
    if (obs.yr === yr) return obs;
  }
  return null;
}

// ---------------------------------------------------------------------------
// NBER CBSA → County FIPS parsing
// ---------------------------------------------------------------------------

/**
 * Only metropolitan-statistical-area rows count (we want MSAs, not micros —
 * FHFA's 100-largest set is MSAs, and in general investors aren't analyzing
 * rental deals in micropolitan markets we don't have HPI for).
 *
 * IMPORTANT: FHFA's 100-largest-metros HPI series keys on the Metropolitan
 * Statistical Area DIVISION (MSAD) code where one exists, not the parent
 * MSA code. E.g. Boca Raton is in the Miami MSA (33100) but its division is
 * "West Palm Beach-Boca Raton-Delray Beach, FL" (48424) — and that's what
 * FHFA publishes. Staten Island is in the NY MSA (35620) but its division
 * is "New York-Jersey City-White Plains, NY-NJ" (35614).
 *
 * So we carry BOTH codes per county and let main() prefer the division when
 * it's present in the HPI dataset.
 *
 * Returns Map<5-digit FIPS, { cbsa, division }>.
 */
function parseCbsaCounty(raw) {
  const lines = raw.trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header) throw new Error("empty NBER crosswalk");
  const map = new Map();
  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length < 12) continue;
    const cbsa = cols[0];
    const division = cols[1]; // may be empty
    const kind = cols[4];
    const stateFips = cols[9];
    const countyFips = cols[10];
    if (!cbsa || !stateFips || !countyFips) continue;
    if (!/^Metropolitan/i.test(kind)) continue;
    const geoid = `${stateFips}${countyFips}`;
    map.set(geoid, { cbsa, division: division || undefined });
  }
  return map;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"' && cur === "") {
        inQuote = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// Census ZCTA → County parsing
// ---------------------------------------------------------------------------

/**
 * Pipe-delimited. We take the county with the largest AREALAND_PART for
 * each ZCTA — that's the dominant county for mailing-address purposes.
 * Returns Map<zip5, countyFips>.
 */
function parseZctaCounty(raw) {
  const lines = raw.trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header) throw new Error("empty ZCTA→county file");
  const cols = header.split("|");
  const idxZcta = cols.indexOf("GEOID_ZCTA5_20");
  const idxCounty = cols.indexOf("GEOID_COUNTY_20");
  const idxArea = cols.indexOf("AREALAND_PART");
  if (idxZcta < 0 || idxCounty < 0 || idxArea < 0) {
    throw new Error(`Unexpected ZCTA header: ${header}`);
  }
  const best = new Map();
  for (const line of lines) {
    const row = line.split("|");
    const zcta = row[idxZcta];
    const county = row[idxCounty];
    const area = Number(row[idxArea]);
    if (!zcta || !county) continue;
    const prior = best.get(zcta);
    if (!prior || area > prior.area) {
      best.set(zcta, { county, area });
    }
  }
  const out = new Map();
  for (const [zcta, v] of best) out.set(zcta, v.county);
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Downloading FHFA HPI…");
  const hpiRaw = await fetchText(URLS.fhfaHpi);
  console.log(`  ${hpiRaw.length.toLocaleString()} bytes`);

  console.log("Downloading NBER CBSA→county crosswalk…");
  const cbsaCountyRaw = await fetchText(URLS.cbsaCounty);
  console.log(`  ${cbsaCountyRaw.length.toLocaleString()} bytes`);

  console.log("Downloading Census ZCTA→county relationship…");
  const zctaCountyRaw = await fetchText(URLS.zctaCounty);
  console.log(`  ${zctaCountyRaw.length.toLocaleString()} bytes`);

  const hpi = parseFhfaHpi(hpiRaw);
  const cbsaByCounty = parseCbsaCounty(cbsaCountyRaw);
  const countyByZip = parseZctaCounty(zctaCountyRaw);

  console.log(`HPI metros: ${Object.keys(hpi).length}`);
  console.log(`CBSA-covered counties: ${cbsaByCounty.size}`);
  console.log(`Zip codes with county: ${countyByZip.size}`);

  // Build zip → cbsa. For each county with a metropolitan division, prefer
  // the division code when it's in FHFA's HPI; otherwise fall back to the
  // parent MSA code if THAT is in HPI. Zips whose metro isn't in FHFA's
  // top-100 are skipped — lib/appreciation.ts returns null for those, and
  // the resolver falls back to DEFAULT_INPUTS.annualAppreciationPercent.
  const hpiCbsas = new Set(Object.keys(hpi));
  const zipToCbsa = {};
  let hits = 0;
  for (const [zip, countyFips] of countyByZip) {
    const mapping = cbsaByCounty.get(countyFips);
    if (!mapping) continue;
    let matched = null;
    if (mapping.division && hpiCbsas.has(mapping.division)) {
      matched = mapping.division;
    } else if (hpiCbsas.has(mapping.cbsa)) {
      matched = mapping.cbsa;
    }
    if (matched) {
      zipToCbsa[zip] = matched;
      hits++;
    }
  }
  console.log(`Zip codes mapped to an HPI metro: ${hits}`);

  // Strip latestIndex from the HPI output — only needed for debugging.
  const hpiOut = {};
  for (const [cbsa, info] of Object.entries(hpi)) {
    hpiOut[cbsa] = {
      name: info.name,
      rate5yr: info.rate5yr,
      rate10yr: info.rate10yr,
      asOf: info.asOf,
    };
  }

  const generatedAt = new Date().toISOString().slice(0, 10);
  const hpiFile = {
    _generatedAt: generatedAt,
    _source:
      "FHFA Purchase-Only HPI (100 largest MSAs), seasonally-adjusted index",
    metros: hpiOut,
  };
  const zipFile = {
    _generatedAt: generatedAt,
    _source:
      "Census 2020 ZCTA→County + NBER CBSA→FIPS; dominant-county match per ZCTA",
    zips: zipToCbsa,
  };

  writeFileSync(
    resolve(outputDir, "fhfa-hpi-metro.json"),
    JSON.stringify(hpiFile),
  );
  writeFileSync(
    resolve(outputDir, "zip-to-cbsa.json"),
    JSON.stringify(zipFile),
  );
  console.log(`Wrote data/fhfa-hpi-metro.json and data/zip-to-cbsa.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
