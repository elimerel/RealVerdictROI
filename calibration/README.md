# Calibration harness

Purpose: run real listings through the engine end-to-end and score the
output against your gut. Used for sanity-checking the engine before
launch and for regression-testing whenever we change `findOfferCeiling`,
the comp derivation, or the scoring rubric.

See `HANDOFF.md §1` for the role this plays in the pending plan.

## Quick start

```bash
# 1. Edit calibration/listings.json — add 10 listings, each with:
#      url (Zillow homedetails) or address
#      gut ("STRONG BUY" | "GOOD DEAL" | "BORDERLINE" | "PASS" | "AVOID")
#      label, notes (optional)

# 2. Start the dev server (so the endpoint is reachable)
npm run dev

# 3. In a second terminal, run the harness
npm run calibrate
```

The harness writes `calibration/results-<timestamp>.md` with:

- A summary table — address · list · walk-away · fair value · verdict ·
  your gut · match? · cap · DSCR · monthly CF.
- Per-listing detail — top 3 weakest assumptions, red flags / resolver
  warnings, comp pool size.
- Process exits with code `1` if any listing is a **hard miss**
  (engine verdict is >1 tier away from your gut). Close calls (1 tier
  off, e.g. STRONG BUY vs GOOD DEAL) are flagged but don't fail.

## Running against production

```bash
BASE_URL=https://realverdict.app \
CALIBRATION_SECRET=<the-secret-you-set-in-vercel> \
npm run calibrate
```

The endpoint (`/api/calibrate`) is protected by `CALIBRATION_SECRET`. In
dev, if the env var is absent, the endpoint allows calls through so
local iteration "just works." In production without the env var set,
it 503s — we never want this endpoint open to the internet since every
call hits RentCast.

## How the scoring works

The `matchIcon` helper compares engine verdict to your gut:

| Distance | Icon | Meaning |
|---|---|---|
| Exact match | `✓ match` | Engine agrees with you |
| 1 tier off | `~ close` | Probably fine, worth a quick look |
| 2+ tiers off | `✗ MISS` | Something is wrong — fix before launch |

**One `✗ MISS` blocks launch.** A single miss on a real listing
(especially a STRONG BUY that becomes an AVOID or vice versa) is the
fastest way to lose credibility in a demo, and it'll happen in front of
an investor if we let it slip.

## Philosophy — what this doesn't replace

- **Unit tests** (`npm test`) still cover the pure math. Keep writing
  them for every scoring-rubric change.
- **Investor peer review.** The harness scores against YOUR gut.
  Whether real investors agree with the engine is a different question
  that only live demos can answer.
- **Back-testing against sold-price data.** Would require reconstructing
  historical listings, which we don't have tooling for yet. Add only if
  the current layers show systemic issues.
