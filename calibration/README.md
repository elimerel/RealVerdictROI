# Calibration harness

Purpose: run real listings through the engine end-to-end and score the
output against **objective sanity anchors** — not operator gut. Used
for regression-testing whenever we change `findOfferCeiling`, the comp
derivation, or the scoring rubric.

## TL;DR — what you do

1. Paste Zillow listing URLs into `calibration/listings.json`.
2. Run `npm run calibrate`.
3. Open the `calibration/results-<timestamp>.md` report and look at
   which rows have sanity-check failures.

That's it. No PDFs, no screenshots, no verdict guessing. The harness
exits non-zero if any listing has a sanity failure, so this is
CI-wireable later.

## Quick start

```bash
# 1. Edit calibration/listings.json — add listings, each needs url OR
#    address. `label` and `notes` are optional free-form strings.

# 2. Start the dev server (so the endpoint is reachable)
npm run dev

# 3. In a second terminal, run the harness
npm run calibrate
```

## Running against production

```bash
BASE_URL=https://realverdict.app \
CALIBRATION_SECRET=<the-secret-you-set-in-vercel> \
npm run calibrate
```

The endpoint (`/api/calibrate`) is protected by `CALIBRATION_SECRET`.
In dev, if the env var is absent, the endpoint allows calls through so
local iteration "just works." In production without the env var set,
it 401s — we never want this endpoint open to the internet since every
call hits RentCast.

## How the scoring works — objective sanity anchors

Each listing runs through the full pipeline (resolve → fetch comps →
analyse → build Pack). The engine's output is then checked against
these automatable anchors:

| Check | Passes when |
|---|---|
| Walk-away band | Walk-away price ∈ [30%, 110%] of list price |
| Cap rate band | Cap rate ∈ [1%, 20%] |
| DSCR sanity | DSCR is finite-and-≥0 OR infinite (no debt) |
| Cash flow identity | `annualCashFlow ≈ annualNOI − annualDebtService` (±$5) |
| Monthly/annual consistency | `monthlyCashFlow × 12 ≈ annualCashFlow` (±$12) |
| Fair value vs list | List ∈ [50%, 200%] of comp fair value |
| Assumed rent vs comp rent | Assumed rent ∈ [60%, 140%] of comp market rent |
| Comp pool depth | ≥3 sale comps AND ≥3 rent comps |
| Known verdict tier | Verdict is one of the 5 known tiers |

**A failure means EITHER the engine produced a nonsense number OR the
listing has genuinely extreme economics.** Both cases deserve manual
review. The whole point is that the operator doesn't need to be an
investor to spot these — the bands are wide enough that a passing row
is "probably sensible" and a failing row is "something's off."

## Why no "your gut verdict" anymore?

Previous versions asked the operator for a STRONG BUY / PASS / AVOID
call per listing and scored against it. We removed that because:

- The operator is the builder, not an investor. Their gut on a
  specific market carries no signal.
- Gut calibration made the harness a mirror — the engine was being
  scored against a guess informed by the engine.
- The objective anchors above catch every bug the gut-compare ever
  caught (e.g. the $3.4M walk-away on a $540k listing fails the
  walk-away band check immediately) and they catch bugs the gut never
  could have (cash-flow identity drift, monthly/annual inconsistency).

## Philosophy — what this doesn't replace

- **Unit tests** (`npm test`) still cover the pure math. Keep writing
  them for every scoring-rubric change.
- **Real investor peer review.** Whether an investor would accept a
  walk-away price the engine outputs is a different question the
  sanity harness can't answer — only an actual demo answers that.
- **Back-testing against historical sold-price data.** Would require
  reconstructing listings at the time they went live, which we don't
  have tooling for. Revisit only if the current layers surface
  systemic issues.
