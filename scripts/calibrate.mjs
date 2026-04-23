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
// The report has one row per listing with columns:
//   Address · List · Walk-away · Fair value · Verdict · Your gut · Match?
// Plus per-row "Top 3 weakest assumptions" and "Red flags" blocks so we
// can scan for anything the engine got wrong.
//
// Designed to be diff-able run-over-run. When we change the engine we can
// re-run this and see which verdicts moved. No CI hookup — this is an
// operator tool, not a test.
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
  return `${n.toFixed(decimals)}%`;
}

function escapeMd(s) {
  if (!s) return "";
  // Pipe characters inside a Markdown table cell break the column layout.
  return String(s).replace(/\|/g, "\\|");
}

function matchIcon(engineTier, gut) {
  if (!gut) return "—";
  const label = VERDICT_LABEL[engineTier] ?? engineTier;
  if (!label) return "?";
  const normalizedEngine = label.toLowerCase().replace(/\s+/g, "");
  const normalizedGut = gut.toLowerCase().replace(/\s+/g, "");
  if (normalizedEngine === normalizedGut) return "✓ match";
  // Tier-directionally close: STRONG BUY vs GOOD DEAL, or PASS vs AVOID, are
  // "close enough" for calibration purposes — flag for review but don't
  // count as a hard miss.
  const tiers = ["excellent", "good", "fair", "poor", "avoid"];
  const gutTier = Object.entries(VERDICT_LABEL).find(
    ([, lbl]) => lbl.toLowerCase().replace(/\s+/g, "") === normalizedGut,
  )?.[0];
  if (!gutTier) return "?";
  const diff = Math.abs(tiers.indexOf(engineTier) - tiers.indexOf(gutTier));
  if (diff === 1) return "~ close";
  return "✗ MISS";
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
      `Create it with:\n{ "listings": [{ "url": "https://www.zillow.com/homedetails/...", "gut": "STRONG BUY", "notes": "..." }] }`,
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
      console.log(`${VERDICT_LABEL[json.verdict] ?? json.verdict} (${elapsed}ms)`);
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
    "| # | Address | List | Walk-away | Fair value | Verdict | Your gut | Match? | Cap | DSCR | Mo. CF |",
  );
  lines.push(
    "|---|---|---:|---:|---:|---|---|---|---:|---:|---:|",
  );

  results.forEach((r, idx) => {
    if (!r.data) {
      lines.push(
        `| ${idx + 1} | ${escapeMd(r.listing.label ?? r.listing.url ?? r.listing.address ?? "?")} | — | — | — | ERROR | ${escapeMd(r.listing.gut ?? "")} | — | — | — | — |`,
      );
      return;
    }
    const d = r.data;
    const addr = d.address ?? r.listing.label ?? r.listing.url ?? "?";
    lines.push(
      `| ${idx + 1} | ${escapeMd(addr)} | ${fmtUSD(d.listPrice)} | ${fmtUSD(d.walkAwayPrice)} | ${fmtUSD(d.fairValue)} | ${VERDICT_LABEL[d.verdict] ?? d.verdict} | ${escapeMd(r.listing.gut ?? "")} | ${matchIcon(d.verdict, r.listing.gut)} | ${fmtPct(d.capRate)} | ${isFinite(d.dscr) ? d.dscr.toFixed(2) : "∞"} | ${fmtUSD(d.monthlyCashFlow)} |`,
    );
  });
  lines.push("");

  // Per-listing detail -------------------------------------------------
  lines.push("## Per-listing detail");
  results.forEach((r, idx) => {
    lines.push("");
    lines.push(`### ${idx + 1}. ${r.listing.label ?? r.data?.address ?? r.listing.url ?? r.listing.address ?? "?"}`);
    if (r.listing.url) lines.push(`- Source: <${r.listing.url}>`);
    if (r.listing.notes) lines.push(`- Notes: ${r.listing.notes}`);

    if (!r.data) {
      lines.push("");
      lines.push(`**ERROR:** \`${r.error}\``);
      return;
    }

    const d = r.data;
    lines.push("");
    lines.push(`- **Verdict:** ${VERDICT_LABEL[d.verdict] ?? d.verdict}${r.listing.gut ? ` · your gut: ${r.listing.gut} · ${matchIcon(d.verdict, r.listing.gut)}` : ""}`);
    lines.push(`- **List:** ${fmtUSD(d.listPrice)} · **Walk-away:** ${fmtUSD(d.walkAwayPrice)} (${d.walkAwayTier ? VERDICT_LABEL[d.walkAwayTier] : "—"}${d.walkAwayDiscountPercent !== null ? `, ${d.walkAwayDiscountPercent.toFixed(1)}% off list` : ""})`);
    lines.push(`- **Fair value:** ${fmtUSD(d.fairValue)}${d.fairValueConfidence ? ` (${d.fairValueConfidence} confidence)` : ""} · **Market rent:** ${fmtUSD(d.marketRent)}`);
    lines.push(`- **Comp pool:** ${d.saleCompsCount} sale / ${d.rentCompsCount} rent`);
    lines.push(`- **Cap rate:** ${fmtPct(d.capRate)} · **DSCR:** ${isFinite(d.dscr) ? d.dscr.toFixed(2) : "∞"} · **CoC:** ${fmtPct(d.cashOnCashReturn)} · **IRR:** ${fmtPct(d.irr)} · **Monthly CF:** ${fmtUSD(d.monthlyCashFlow)}`);

    if (d.weakAssumptions?.length) {
      lines.push("");
      lines.push("**Top 3 weakest assumptions:**");
      d.weakAssumptions.forEach((w, i) => {
        lines.push(`${i + 1}. **${escapeMd(w.field)}** — current: ${escapeMd(w.current)} · realistic: ${escapeMd(w.realistic)} · gap: ${escapeMd(w.gap)}`);
      });
    }

    if (d.redFlags?.length) {
      lines.push("");
      lines.push("**Red flags / resolver warnings:**");
      d.redFlags.forEach((rf) => lines.push(`- ${escapeMd(rf)}`));
    }
  });

  // Failure summary ----------------------------------------------------
  const errs = results.filter((r) => !r.data);
  if (errs.length) {
    lines.push("");
    lines.push("## Failures");
    errs.forEach((r, i) => {
      lines.push(`- [${i + 1}] ${escapeMd(r.listing.label ?? r.listing.url ?? r.listing.address ?? "?")}: ${escapeMd(r.error)}`);
    });
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join("\n"), "utf8");

  const misses = results.filter(
    (r) => r.data && r.listing.gut && matchIcon(r.data.verdict, r.listing.gut) === "✗ MISS",
  );
  const closes = results.filter(
    (r) => r.data && r.listing.gut && matchIcon(r.data.verdict, r.listing.gut) === "~ close",
  );

  console.log("");
  console.log(`Report written to: ${outPath}`);
  console.log(`Summary: ${results.length - errs.length} ok · ${errs.length} errors · ${misses.length} hard misses · ${closes.length} close calls`);
  if (misses.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
