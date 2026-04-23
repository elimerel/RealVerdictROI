#!/usr/bin/env node
// ---------------------------------------------------------------------------
// scripts/calibrate.mjs
//
// Runs every listing in calibration/listings.json through /api/calibrate
// and writes a timestamped Markdown report to calibration/results-<date>.md.
//
// Usage:
//   npm run calibrate                         # against http://localhost:3000
//   BASE_URL=https://realverdict.app \
//   CALIBRATION_SECRET=xxx npm run calibrate  # against prod
//
// SCORING MODEL (2026-04-22 rewrite):
//   The previous version asked the operator for a "gut" verdict per
//   listing and compared engine output against it. That was a flawed
//   oracle — the operator is the builder, not an experienced investor,
//   and using their gut as ground truth made the harness a mirror.
//
//   The current model scores the engine against OBJECTIVE, AUTOMATABLE
//   anchors (the /api/calibrate response's `sanityChecks` array):
//     - Walk-away ∈ [30%, 110%] of list
//     - Cap rate ∈ [1%, 20%]
//     - Cash-flow identity (annualCF ≈ NOI − debt service)
//     - Monthly × 12 ≈ annual
//     - List vs comp fair value within 2x
//     - Assumed rent vs comp rent within 40%
//     - ≥3 sale comps, ≥3 rent comps
//     - Verdict tier is a known value
//
//   A failed check means EITHER the engine produced nonsense OR the
//   listing has genuinely extreme economics. Either way it deserves a
//   manual look. The harness exits non-zero if ANY check fails,
//   suitable for CI wiring later.
//
// Your only job is to paste URLs into calibration/listings.json. Nothing
// else.
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.CALIBRATION_SECRET ?? "";
const LISTINGS_PATH = "calibration/listings.json";

const VERDICT_LABEL = {
  excellent: "STRONG BUY",
  good: "GOOD DEAL",
  fair: "BORDERLINE",
  poor: "PASS",
  avoid: "AVOID",
};

// ---------------------------------------------------------------------------
// Formatting helpers. Small by design — keep the script dep-free.
// ---------------------------------------------------------------------------

function fmtUSD(n) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPct(n, decimals = 2) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${(n * 100).toFixed(decimals)}%`;
}

function escapeMd(s) {
  if (!s) return "";
  return String(s).replace(/\|/g, "\\|");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let raw;
  try {
    raw = await readFile(LISTINGS_PATH, "utf8");
  } catch (err) {
    console.error(`Could not read ${LISTINGS_PATH}: ${err.message}`);
    console.error(
      `Create it with:\n{ "listings": [{ "url": "https://www.zillow.com/homedetails/..." }] }`,
    );
    process.exit(1);
  }

  const { listings } = JSON.parse(raw);
  if (!Array.isArray(listings) || listings.length === 0) {
    console.error(`${LISTINGS_PATH} has no listings to run.`);
    process.exit(1);
  }

  console.log(
    `Running ${listings.length} listing(s) against ${BASE_URL}/api/calibrate ...`,
  );

  const results = [];
  for (const [i, listing] of listings.entries()) {
    const label = listing.label ?? listing.url ?? listing.address ?? `#${i + 1}`;
    process.stdout.write(`  [${i + 1}/${listings.length}] ${label} ... `);

    const params = new URLSearchParams();
    if (listing.url) params.set("url", listing.url);
    else if (listing.address) params.set("address", listing.address);
    else {
      console.log("SKIP (no url or address)");
      results.push({ listing, error: "missing url/address" });
      continue;
    }
    if (SECRET) params.set("secret", SECRET);

    try {
      const t0 = Date.now();
      const res = await fetch(`${BASE_URL}/api/calibrate?${params}`);
      const elapsed = Date.now() - t0;
      if (!res.ok) {
        const body = await res.text();
        console.log(`HTTP ${res.status} (${elapsed}ms)`);
        results.push({
          listing,
          error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
        });
        continue;
      }
      const json = await res.json();
      const failedChecks = json.sanityFailed ?? 0;
      const suffix = failedChecks > 0 ? ` · ${failedChecks} CHECK${failedChecks === 1 ? "" : "S"} FAILED` : "";
      console.log(
        `${VERDICT_LABEL[json.verdict] ?? json.verdict} (${elapsed}ms)${suffix}`,
      );
      results.push({ listing, data: json });
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ listing, error: err.message });
    }
  }

  // ---------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = `calibration/results-${stamp}.md`;

  const lines = [];
  lines.push(`# Calibration report · ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Target: \`${BASE_URL}\``);
  lines.push(`Listings: ${listings.length}`);
  lines.push("");

  // Summary table ------------------------------------------------------
  lines.push("## Summary");
  lines.push("");
  lines.push(
    "| # | Address | List | Walk-away | Fair value | Verdict | Sanity | Cap | DSCR | Mo. CF |",
  );
  lines.push("|---|---|---:|---:|---:|---|---|---:|---:|---:|");

  results.forEach((r, idx) => {
    if (!r.data) {
      lines.push(
        `| ${idx + 1} | ${escapeMd(r.listing.label ?? r.listing.url ?? r.listing.address ?? "?")} | — | — | — | ERROR | — | — | — | — |`,
      );
      return;
    }
    const d = r.data;
    const addr = d.address ?? r.listing.label ?? r.listing.url ?? "?";
    const sanityCell =
      d.sanityFailed === 0
        ? `✓ ${d.sanityPassed}/${d.sanityPassed}`
        : `✗ ${d.sanityFailed}/${d.sanityPassed + d.sanityFailed} FAIL`;
    lines.push(
      `| ${idx + 1} | ${escapeMd(addr)} | ${fmtUSD(d.listPrice)} | ${fmtUSD(d.walkAwayPrice)} | ${fmtUSD(d.fairValue)} | ${VERDICT_LABEL[d.verdict] ?? d.verdict} | ${sanityCell} | ${fmtPct(d.capRate)} | ${isFinite(d.dscr) ? d.dscr.toFixed(2) : "∞"} | ${fmtUSD(d.monthlyCashFlow)} |`,
    );
  });
  lines.push("");

  // Per-listing detail -------------------------------------------------
  lines.push("## Per-listing detail");
  results.forEach((r, idx) => {
    lines.push("");
    lines.push(
      `### ${idx + 1}. ${r.listing.label ?? r.data?.address ?? r.listing.url ?? r.listing.address ?? "?"}`,
    );
    if (r.listing.url) lines.push(`- Source: <${r.listing.url}>`);
    if (r.listing.notes) lines.push(`- Notes: ${r.listing.notes}`);

    if (!r.data) {
      lines.push("");
      lines.push(`**ERROR:** \`${r.error}\``);
      return;
    }

    const d = r.data;
    lines.push("");
    lines.push(
      `- **Verdict:** ${VERDICT_LABEL[d.verdict] ?? d.verdict}`,
    );
    lines.push(
      `- **List:** ${fmtUSD(d.listPrice)} · **Walk-away:** ${fmtUSD(d.walkAwayPrice)} (${d.walkAwayTier ? VERDICT_LABEL[d.walkAwayTier] : "—"}${d.walkAwayDiscountPercent !== null ? `, ${d.walkAwayDiscountPercent.toFixed(1)}% off list` : ""})`,
    );
    lines.push(
      `- **Fair value:** ${fmtUSD(d.fairValue)}${d.fairValueConfidence ? ` (${d.fairValueConfidence} confidence)` : ""} · **Market rent:** ${fmtUSD(d.marketRent)} · **Assumed rent:** ${fmtUSD(d.monthlyRent)}`,
    );
    lines.push(`- **Comp pool:** ${d.saleCompsCount} sale / ${d.rentCompsCount} rent`);
    lines.push(
      `- **Cap rate:** ${fmtPct(d.capRate)} · **DSCR:** ${isFinite(d.dscr) ? d.dscr.toFixed(2) : "∞"} · **CoC:** ${fmtPct(d.cashOnCashReturn)} · **IRR:** ${fmtPct(d.irr)} · **Monthly CF:** ${fmtUSD(d.monthlyCashFlow)}`,
    );

    // Sanity checks block
    if (d.sanityChecks?.length) {
      lines.push("");
      lines.push(
        `**Sanity checks:** ${d.sanityPassed} passed · ${d.sanityFailed} failed`,
      );
      d.sanityChecks.forEach((c) => {
        const icon = c.pass ? "✓" : "✗ FAIL";
        lines.push(
          `- ${icon} ${escapeMd(c.label)} — ${escapeMd(c.detail)}`,
        );
      });
    }

    if (d.weakAssumptions?.length) {
      lines.push("");
      lines.push("**Top 3 weakest assumptions:**");
      d.weakAssumptions.forEach((w, i) => {
        lines.push(
          `${i + 1}. **${escapeMd(w.field)}** — current: ${escapeMd(w.current)} · realistic: ${escapeMd(w.realistic)} · gap: ${escapeMd(w.gap)}`,
        );
      });
    }

    if (d.redFlags?.length) {
      lines.push("");
      lines.push("**Red flags / resolver warnings:**");
      d.redFlags.forEach((rf) => lines.push(`- ${escapeMd(rf)}`));
    }
  });

  // Failure / risk summary --------------------------------------------
  const errs = results.filter((r) => !r.data);
  const sanityFailures = results.filter(
    (r) => r.data && (r.data.sanityFailed ?? 0) > 0,
  );

  if (errs.length) {
    lines.push("");
    lines.push("## Failures");
    errs.forEach((r, i) => {
      lines.push(
        `- [${i + 1}] ${escapeMd(r.listing.label ?? r.listing.url ?? r.listing.address ?? "?")}: ${escapeMd(r.error)}`,
      );
    });
  }

  if (sanityFailures.length) {
    lines.push("");
    lines.push("## Sanity-check failures (needs operator review)");
    sanityFailures.forEach((r) => {
      const addr = r.data.address ?? r.listing.label ?? r.listing.url ?? "?";
      const failed = r.data.sanityChecks.filter((c) => !c.pass);
      lines.push("");
      lines.push(`**${escapeMd(addr)}**`);
      failed.forEach((c) =>
        lines.push(`- ${escapeMd(c.label)}: ${escapeMd(c.detail)}`),
      );
    });
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join("\n"), "utf8");

  console.log("");
  console.log(`Report written to: ${outPath}`);
  console.log(
    `Summary: ${results.length - errs.length} ok · ${errs.length} errors · ${sanityFailures.length} with sanity-check failures`,
  );
  if (errs.length > 0 || sanityFailures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
