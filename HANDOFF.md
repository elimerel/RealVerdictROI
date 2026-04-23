# RealVerdictROI — Project Handoff

> **How to read this doc (agent pointer, 2026-04-22):**
>
> This file is the active spec. It's intentionally short. If you need a
> historical detail — what shipped when, why a past decision was made,
> the unit-economics math that drove the $29 price, the exact list of
> §20.9 bugs — read `HANDOFF_ARCHIVE.md`. Don't re-read it every turn.
>
> **Read top-to-bottom on the first turn of a new chat.** After that,
> jump to the section that matches the task:
>
> - Starting fresh? → **§1 Current state + §13 Next chat prompt**
> - Touching the engine or `findOfferCeiling`? → **§5, §6**
> - Touching data pipeline / resolver / RentCast? → **§7**
> - Touching `/results`? → **§8** (component map)
> - Touching Pack / comp reasoning? → **§9**
> - Writing copy on home / pricing? → **§10**
> - Philosophy / positioning disagreement with a past decision? → **§2**
>   then `HANDOFF_ARCHIVE.md §20.5, §20.10, §20.11` (guard rails).
>
> Rules that never bend:
> - No I/O in `lib/calculations.ts` — same input, same output, always.
> - Every `/results` input lives in the query string. Don't hide state.
> - Don't add a metric without a matching `scoreXxx()` RubricItem.
> - Fix the derivation, don't paper over it with a warning bubble.
> - No emojis in product UI unless the user explicitly asks.

---

## 1. Current state

**Shipped and live** (as of 2026-04-22):

- **Engine**: `findOfferCeiling` disciplined by comp-derived market value
  (5% premium allowed). The $3.4M-walk-away-on-$540k-listing bug is gone.
- **Architecture (§20.8)**: `/results` is a fast estimate by default (no
  RentCast). Comps + Pack require explicit `?livecomps=1` opt-in.
- **Negotiation Pack**: one-click PDF export from `/results` with
  walk-away price, three weakest assumptions, comp evidence, stress
  scenarios, counteroffer script. Pro-gated; free users get 3 Packs/week.
- **Comp Reasoning Explainer**: Comps tab renders why each comp was
  included or excluded, with p25/median/p75 bands.
- **Pricing**: single $29/mo Pro tier. Free tier: 3 full analyses/week.
- **Homepage + pricing copy**: Pack-first framing. "For your next offer.
  Walk in with a number. Not a feeling."
- **Monetization infrastructure**: Stripe checkout + portal + webhook,
  Supabase `subscriptions`, per-user + per-IP free-tier limiters,
  Supabase `negotiation_packs`. Stripe is in test mode until we have at
  least one "I'd pay for that specifically" investor demo.
- **Quality gates**: 169 vitest tests pass; `npx tsc --noEmit` clean;
  `npx eslint` clean; `next build` clean.

**Pending** (in priority order, from `HANDOFF_ARCHIVE.md §20.15`):

1. **Calibration gauntlet** — user sources 10 more listings across
   diverse markets + property types; audit output for any BUY-labeled-
   AVOID regressions.
2. **Investor demo signal** — at least one person who says "I'd pay for
   the Pack specifically." Only after that do we flip Stripe to live.
3. **One-time Pack purchase path** — $19–29 Stripe Checkout with no
   signup until after payment. Deferred; only build if demand signals.
4. **Dashboard polish** — no UI lists a user's past Packs yet.
5. **P2 polish from `HANDOFF_ARCHIVE.md §20.9 #11/#12`** — cross-tab
   numeric reconciliation, garbled negative-CF copy templates.

**Manual operator tasks (required before launch):**

- Run `supabase/migrations/004_negotiation_packs.sql` in the Supabase SQL
  editor. Without it `/api/pack/generate` 500s. Idempotent.
- Create the $29/mo Stripe Price (Stripe forbids editing live Price
  amounts), update `STRIPE_PRICE_ID_PRO` in Vercel + `.env.local`,
  verify checkout shows $29.

---

## 2. Positioning (locked; don't second-guess without revisiting the archive)

**One-liner:** *RealVerdict makes the offer, not the math.*

**Longer form:** every analysis produces a ready-to-send Negotiation
Pack — walk-away price, three weakest assumptions in the seller's pro
forma, comp evidence, stress scenarios that break the seller's math,
counteroffer script. Forward it to your agent before you tour.

**Tagline alongside the Pack:** *DealCheck calculates. RealVerdict closes.*

**Who the product is for:** active rental investors making multiple
offers per month. NOT first-time house-hackers, NOT institutional
wholesalers, NOT a generic mortgage calculator.

**What makes it defensible:** the walk-away number is only useful
because it's backed by live RentCast comps, a market-value cap, a
transparent derivation, and an opinionated rubric. DealCheck + Stessa
produce dashboards; RealVerdict produces an artifact you forward to a
human. Every forwarded Pack is a seed of viral distribution.

**Guard rails** (see `HANDOFF_ARCHIVE.md §20.5, §20.10` for full rationale):

- **Don't build bulk triage** (paste 20 URLs). Unit economics break
  before the product works: 20 URLs × 3–5 RentCast calls = $12-20 per
  session against $29/mo revenue.
- **Don't build live deal alerts / watchlists.** Same cost story.
- **Don't build the Chrome extension as the primary product surface.**
  Auto-fire on every Zillow view is unaffordable; click-to-analyze is
  just a faster launcher. Maybe later as a read-only cached-verdict
  overlay, but not the next bet.
- **Don't pivot to house-hackers** as the primary demographic. Free-tier
  unlock later, post-launch, to funnel first-timers. Committed to active
  rental investors.
- **Don't remove the `HowWeGotThese` transparency panel** at the top of
  `/results`. It IS the product's trust moat.
- **Don't reintroduce the mocked analysis universe.** All analysis goes
  through `analyseDeal()` and `/results`.
- **Don't cover bad data with a warning bubble.** Fix the derivation.

**Success criteria to revisit positioning in 90 days:** ≥10 paying
customers, ≥1 Pack forwarded externally per week, RentCast cost ≤30% of
revenue, month-3 churn ≤15%. If any fail, positioning is wrong, not
execution.

---

## 3. Tech stack

- **Next.js 16.2.4** App Router, Turbopack, React 19.2.4. This is the
  new Next.js — APIs and file conventions have breaking changes vs.
  training data. Read `node_modules/next/dist/docs/` in doubt;
  `AGENTS.md` enforces this.
- **TypeScript 5 strict**, no `any` — narrow from `unknown`.
- **Tailwind CSS 4** via PostCSS. No `tailwind.config.js`; `@import "tailwindcss"` in `globals.css`.
- **AI SDK 6** — `gpt-4o-mini` for the initial verdict, `gpt-4o` for follow-up chat.
- **Supabase** auth + `deals`, `subscriptions`, `negotiation_packs`, `compare_entries` tables.
- **Stripe** for Pro subscription (test mode) + webhook + portal.
- **Upstash Redis** for cross-lambda KV cache + rate limiter (in-memory fallback in dev).
- **`@react-pdf/renderer`** for Pack PDF generation (Node.js runtime).
- **Sentry + Vercel Analytics + Plausible** (gated on env vars).
- **No charting / DataGrid / forms libraries.** All UI hand-rolled.

`package.json` is intentionally minimal. Don't add deps without a reason.

---

## 4. Environment variables

`.env.local` lives in the repo root and is git-ignored. Every feature
degrades gracefully if a key is missing — no key should ever crash a
route.

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | gpt-4o-mini (verdict) + gpt-4o (chat). |
| `RENTCAST_API_KEY` | RentCast `/properties` + `/listings/sale` + `/listings/rental/long-term`. |
| `SCRAPER_API_KEY` | ScraperAPI proxy for Zillow fetch. |
| `FRED_API_KEY` | FRED MORTGAGE30US series (live 30-yr rate). |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role client (webhooks + portal). |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_ID_PRO` | Stripe Pro checkout. |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | KV cache + rate limiter (optional — in-memory fallback). |
| `SENTRY_DSN` | Error tracking (optional). |
| `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` | Canonical URL for sitemap + OG + Stripe redirects. |

---

## 5. Repo structure

```
app/
  page.tsx                      # Homepage (Pack-first framing)
  layout.tsx
  globals.css
  results/page.tsx              # Orchestrator — parses URL, auth + quota gates,
                                #   fetches comps, renders sections. Lean.
  pack/[shareToken]/            # Pack viewer + PDF export
    page.tsx                    #   HTML rendering of the Pack
    pdf/route.ts                #   Node runtime @react-pdf/renderer stream
  compare/page.tsx              # Side-by-side (Supabase-synced for Pro)
  dashboard/page.tsx            # Saved deals + plan badge + manage billing
  pricing/page.tsx              # Pack-first pricing page
  about/page.tsx                # Anti-hype positioning
  methodology/page.tsx          # SEO + trust anchor: exact formulas + scoring
  login/page.tsx                # Magic-link auth
  sitemap.ts + robots.ts        # Indexes / , /pricing, /methodology, /about
  _components/
    HomeAnalyzeForm.tsx         # Homepage form — address + Zillow URL + headlines
    InitialVerdict.tsx          # Streamed gpt-4o-mini verdict
    FollowUpChat.tsx            # gpt-4o Ask-AI tab
    OfferCeilingCard.tsx        # Walk-away price card (marketValueCap aware)
    CompsSection.tsx            # Sale + rent comp grid + Comp Reasoning panel
    CompReasoningPanel.tsx      # "Why we kept / why we dropped each comp"
    HowWeGotThese.tsx           # Top-of-page derivation transparency
    WhatIfPanel.tsx             # Sliders — client-side recalc
    StressTestPanel.tsx         # 5 canned shocks (IRR + ROI surfaced)
    VerdictRubric.tsx           # Itemized rubric items
    PackGenerateButton.tsx      # Pack generation CTA (Pro + Pack-eligible only)
    SaveDealButton.tsx          # Pro-gated
    ShareButton.tsx
    AddToComparisonButton.tsx
    ResultsTabs.tsx             # Sticky tab nav
    ResultsWarningsBanner.tsx   # Dismissible warnings handed off from homepage
    AnalysisQuotaExceeded.tsx   # Quota-gate fallback
    ProCompsTeaser.tsx          # Non-Pro fallback for Comps tab
    results/                    # /results-specific components (the split from §8)
      ResultsHeader.tsx
      HeroSection.tsx           # HeroSection + HeroActions + RunLiveCompsCTA
      EvidenceSection.tsx
      BreakdownSection.tsx
      tier-style.ts             # TIER_LABEL + TIER_ACCENT + tone helpers
  api/
    property-resolve/route.ts   # Fast estimate (§20.8 mode:"fast") → enriched inputs
    zillow-parse/route.ts       # JSON-first scrape of Zillow HTML
    comps/route.ts              # Wraps lib/comps.ts for the frontend
    pack/generate/route.ts      # Builds Pack, persists negotiation_packs row
    pack/share/[shareToken]/    # Public Pack fetch (share + PDF)
    stripe/checkout/route.ts    # Signed-in → subscription checkout
    stripe/webhook/route.ts     # checkout.session.completed + sub.updated/deleted
    stripe/portal/route.ts      # Billing portal
    og/route.tsx                # Open Graph image generator
    chat/route.ts               # gpt-4o Ask-AI
    deals/ + compare/ + auth/   # CRUD + sync + Supabase callback
lib/
  calculations.ts               # Pure. DealInputs → DealAnalysis. See §5.
  comps.ts                      # RentCast fetcher + percentile stats
  comparables.ts                # analyzeComparables — "how we got these" derivation
  estimators.ts                 # State-level insurance + tax fallbacks (homestead-aware)
  negotiation-pack.ts           # buildPack(inputs, analysis, comps, comparables, subject)
  pack-pdf.tsx                  # @react-pdf/renderer document
  kv-cache.ts                   # Upstash Redis + in-memory fallback
  client-session-cache.ts       # sessionStorage wrapper (autofill handoff)
  ratelimit.ts                  # Per-route budgets (pack-generate, analysis-free-*)
  observability.ts              # logEvent, captureError, withErrorReporting
  pro.ts                        # isPro(user) — subscriptions-table source of truth
  stripe.ts, supabase/{server,browser,service,config}.ts
public/
supabase/migrations/            # 001_deals, 002_compare_entries, 003_subscriptions, 004_negotiation_packs
tests/                          # Structural invariants (routes, copy, wiring)
```

---

## 6. Calculation engine (`lib/calculations.ts`)

Exports to remember — almost every change touches one:

```ts
DealInputs                   // Input schema
DealAnalysis                 // Output: projection, KPIs, verdict
VerdictTier                  // "excellent" | "good" | "fair" | "poor" | "avoid"
RubricItem / Verdict         // Scored signals + rollup
DEFAULT_INPUTS
analyseDeal(inputs)          // Pure. No I/O.
sanitiseInputs(raw)          // Clamps every numeric field to a sane range.
findOfferCeiling(inputs, { marketValueCap? }) // Walk-away solver — see §7.
inputsToSearchParams / inputsFromSearchParams  // Deep linking
formatCurrency / formatPercent / formatNumber
```

The file is ~1000 lines. It's large because it's the product: rubric,
scoring, projection, DSCR, IRR, cap, cash-on-cash, break-even, GRM,
`findOfferCeiling`, provenance helpers. Don't split it; the cohesion is
what makes changes safe.

---

## 7. `findOfferCeiling` — the walk-away solver

Lives at the bottom of `lib/calculations.ts`. Rendered by
`app/_components/OfferCeilingCard.tsx` in the `/results` hero.

```ts
export type OfferCeiling = {
  excellent?: number;
  good?: number;
  fair?: number;
  poor?: number;
  currentPrice: number;
  currentTier: VerdictTier;
  recommendedCeiling?: { price: number; tier: VerdictTier };
  marketValueCap?: {
    cap: number;
    source: "comps" | "list";
    binding: boolean;   // true if the cap actively clipped a tier ceiling
  };
};

findOfferCeiling(inputs, {
  marketValueCap?: number,             // comp fair value when available, else list
  marketValueCapSource?: "comps"|"list",
  marketValueCapPremium?: number,      // default 1.05 — 5% over anchor
});
```

How it works:

- Verdict score is monotonically non-increasing as price rises.
- Binary-search 25 iterations on `[1k, min(rubricUpper, marketValueCap * premium)]`.
- Rounded to $500 (investors don't negotiate to the dollar).
- Without `marketValueCap`, income-rubric alone can return absurd
  ceilings on rent-heavy listings (the $3.4M-on-a-$540k-listing bug).
  The cap is derived in `/results` from `comparables.marketValue.value`
  when available (`source: "comps"`), list price otherwise
  (`source: "list"`). `OfferCeilingCard` renders the cap reason in
  copy under the tier grid.

---

## 8. Data pipeline (resolver + comps)

### 8.1 `/api/property-resolve` (`app/api/property-resolve/route.ts`)

Single entry point used by the homepage form's auto-fill. Two methods:

- **GET `?address=...`** — RentCast `/properties` (1 call) for facts +
  lat/lng + latest tax bill, then state-level estimates from
  `lib/estimators.ts` plus live FRED rate, FHFA metro appreciation, and
  FEMA flood bump.
- **POST `{ url, address? }`** — `/api/zillow-parse` for listing data,
  then RentCast `/properties` for the gaps, then the same enrichment.

**§20.8 fast-estimate mode (SHIPPED):** `property-resolve` returns
`mode: "fast"` and **does not** call `fetchComps` or `analyzeComparables`.
Comp analysis is deferred until the user clicks "Run live comp
analysis" on `/results` (which appends `?livecomps=1`). Browse-and-
bounce traffic costs zero RentCast. Cache versions: `CACHE_VERSION v11`,
`AUTOFILL_CACHE_VERSION v4`.

Returns:

```ts
{
  source, address, state, facts, inputs, provenance, notes, warnings,
  mode: "fast",
  // (comparables NOT included in fast mode)
}
```

`provenance` is per-field: `{ source, confidence, note }` with
`source ∈ "rentcast"|"rent-comps"|"zillow-listing"|"fred"|"fhfa-hpi"|"fema-nfhl"|"state-average"|"national-average"|"default"|"user"`.
`HomeAnalyzeForm` renders colored badges + tooltips.

### 8.2 `/api/zillow-parse` (`app/api/zillow-parse/route.ts`)

JSON-first scraper. Pulls `__NEXT_DATA__` + Apollo state out of the
HTML with regex, walks for address/beds/baths/sqft/yearBuilt/lotSize/
homeType/price/zestimate/rentZestimate/monthlyHoaFee/tax/insurance/DOM.
Falls back to URL-slug parsing if ScraperAPI is missing.

### 8.3 `/api/comps` + `lib/comps.ts`

`fetchComps({ address, beds?, baths?, sqft?, radiusMiles=3 })`. Both
the route handler and `/results` import from `lib/comps.ts` directly
(no server-to-server loop). Radius ladders 3→10mi, only widening the
side still under 3 comps. Returns `null` if the key is missing.
`CompStats` includes `count`, `median`, `p25`, `p75`, `min`, `max`,
`medianPricePerSqft`, `medianRentPerSqft`. Cached 24h cross-lambda.

### 8.4 `lib/comparables.ts`

`analyzeComparables(subject, comps)` is the derivation engine. Dedupes
by building, filters HOA-lite SFRs vs condos, applies $/sqft outlier
z-score trim, builds workLog entries so the UI can show "how we got
this number." Feeds both `HowWeGotThese`, `CompReasoningPanel`, and the
Pack's "three weakest assumptions."

---

## 9. Results page architecture (`app/results/page.tsx`)

Orchestrator pattern. The page itself is ~420 lines:

1. Parse URL inputs.
2. Auth + Pro check.
3. Quota gate (only when `?livecomps=1` AND non-Pro).
4. `analyseDeal(inputs)`.
5. If `?livecomps=1` + address → `fetchComps` + `analyzeComparables`.
6. Set CSS vars `--accent` + `--accent-soft` from tier.
7. Render `<ResultsHeader>` → `<ResultsWarningsBanner>` →
   `<HowWeGotThese>` → `<RunLiveCompsCTA>` (fast-estimate only) →
   `<HeroSection>` → `<ResultsTabs>` (Numbers / Comps / Stress /
   What-if / Rubric / Ask AI) → footer.

Component map under `app/_components/results/`:

- **`tier-style.ts`** — `TIER_LABEL`, `TIER_ACCENT`, `WARN_COLOR`,
  `BAD_COLOR`, `Tone` type, `toneToStyle`, `toneCoC / toneCap / toneDSCR
  / toneBreakEven / toneGRM`. Shared across hero + evidence + breakdown.
- **`ResultsHeader.tsx`** — top nav.
- **`HeroSection.tsx`** — verdict tier + walk-away + AI summary +
  actions. Also exports `RunLiveCompsCTA` (the fast-estimate-only
  "Run live comp analysis" banner) and houses `HeroActions` + `EditIcon`
  as internal components.
- **`EvidenceSection.tsx`** — Numbers tab top half. Subject-vs-market
  (only when comps exist), Returns, Risk, Long-term groups.
- **`BreakdownSection.tsx`** — Numbers tab bottom half. Monthly
  waterfall + cash to close + projection table + sale proceeds. Panel
  / Table / TableRow primitives are inlined here because they're only
  used by these four tables.

Pro-gating: the Comps tab is Pro-only; non-Pro see `<ProCompsTeaser>`.
The Pack generate button only renders when `liveComps && comparables &&
address` (`packEligible`).

---

## 10. Homepage + pricing (Pack-first framing, locked)

**Homepage (`app/page.tsx`)** — 2026-04-22 Pack-first rewrite:

- Eyebrow "For your next offer."
- H1 "Walk in with a number. Not a feeling."
- Subhead names the Pack and its deliverables.
- Free-quota callout: "Free for your first 3 listings a week. $29/mo
  for unlimited."
- Value-prop section titled "What's in the Pack" — three `ValueCard`s:
  walk-away price, three weakest assumptions, counteroffer script.
- "How it works": (1) paste Zillow URL, (2) run a live comp analysis,
  (3) generate the Pack.
- Bottom CTA: "Try it on your next listing."

**Pricing (`app/pricing/page.tsx`)**:

- Headline "The Pack is free for your first 3 listings a week."
- `<PackAnatomy />` section above the tier cards — six pillars of the
  Pack, visualized.
- Free tier featured bullet: "3 full Negotiation Packs per week."
  CTA "Try a Pack free."
- Pro tier featured bullet: "Unlimited Negotiation Packs." Subhead
  "For investors making multiple offers a month."
- FAQ explicitly clarifies the free-tier quota + who this is for.

Structural invariants enforced in `tests/pack-routes-invariants.test.ts`.

**Supporting marketing pages (already shipped, untouched by 2026-04-22):**
`/methodology` (SEO + trust anchor — exact formulas), `/about`
(anti-hype positioning), `/compare`, `/dashboard`.

---

## 11. Negotiation Pack + Comp Reasoning Explainer

### 11.1 Pack

**Data flow:**

1. User on `/results?livecomps=1` clicks `<PackGenerateButton>`.
2. POST `/api/pack/generate` — rate-limited (`pack-generate`),
   Pro-gated via `isPro`, quota-gated for free tier.
3. Server calls `lib/negotiation-pack.ts::buildPack(inputs, analysis,
   comps, comparables, subject)` which computes `marketValueAnchor`
   from `comparables.marketValue?.value ?? inputs.purchasePrice`,
   passes it to `findOfferCeiling`, derives three weakest assumptions
   from the `analyzeComparables` workLog, selects 3–5 comps, and emits
   a `PackPayload`.
4. Persist to Supabase `negotiation_packs` (user_id, share_token,
   payload JSONB, pdf_url).
5. Response includes `shareUrl: /pack/<shareToken>` and `pdfUrl:
   /pack/<shareToken>/pdf`.

**Rendering:**

- `/pack/[shareToken]/page.tsx` — public HTML view of the Pack. Any
  visitor with the link can read it (by design — it's a shared artifact).
- `/pack/[shareToken]/pdf/route.ts` — Node runtime,
  `@react-pdf/renderer` `renderToStream`, serves
  `PackDocument(payload)` from `lib/pack-pdf.tsx`.

### 11.2 Comp Reasoning Explainer

`app/_components/CompReasoningPanel.tsx`. Lives inside `<CompsSection>`
when `comparables` is non-null. Shows:

- The 3–5 comps that actually drove the derivation, each with a short
  "why this one" line.
- Any explicitly excluded comps and the reason.
- p25 / median / p75 band from the scored pool.
- Sqft normalization rendered explicitly.
- Confidence band (counts, range, distance).

---

## 12. Reference test listings

When verifying any change, re-run these. They exercise the different
failure modes:

1. **1121 NW 13th St #3, Boca Raton, FL 33486** — condo-style townhouse
   with high HOA. Tests HOA override + market anchors. Should land
   AVOID with ≈$390k fair value.
2. **241 Orange St, Dunellen, NJ 08812** — multi-family in appreciation
   market, weak year-1 CF. Tests appreciation-rescue rubric. Should
   land BORDERLINE or GOOD (not AVOID).
3. **209 S Stevens Ave, South Amboy, NJ 08879** — 2,216 sqft
   multi-family. Tests dedupe-by-building + submultiplicative rent
   scaling.
4. **Staten Island listing** (user-provided) — tests the original
   "lazy warnings" regression didn't return.

Recent calibration (2026-04-22): **Hoagland IN** and **Polson MT**
both produced the correct verdict tier. Don't revisit §20 unless a
listing produces a BUY mislabeled as AVOID for reasons the user rejects.

If any of these regresses, STOP — don't proceed until fixed.

---

## 13. Conventions and gotchas

- `npm run check` runs tsc + eslint + vitest. Keep them all green.
- **No `any` types.** Use `unknown` and narrow.
- **Server components by default.** `"use client"` only when you need
  state, effects, or browser APIs.
- Don't add `useEffect` for fetching data on the client when a server
  component can do it.
- Dev server is sensitive to deleting `.next/` while running. If it
  goes weird, kill it, `rm -rf .next`, restart.
- The sandbox blocks `tsx` IPC — don't ad-hoc test with `npx tsx`.
  Expose a temporary route + curl localhost instead.
- Tailwind 4, `@import "tailwindcss"` in `globals.css`. No config file.
- `/results` sets `--accent` + `--accent-soft` on the root by tier;
  all children read `var(--accent)`. Don't hard-code colors.
- iOS tap targets ≥44px. All interactive controls use
  `h-11 min-h-[44px]` or larger.
- Mobile-first padding: `px-4 sm:px-6` on outer containers.
- **No emojis in product UI** unless explicitly asked.
- **No comments narrating obvious code.** Explain intent and
  constraints, never restate what the code does.

---

## 14. How to run

```bash
npm install

# dev (Turbopack)
npm run dev

# strict checks before committing
npm run check        # tsc --noEmit + eslint --max-warnings 0 + vitest run

# production build
npm run build
```

**Don't run `next build` while the dev server is running** — they
share `.next/` and will corrupt it.

---

## 15. Next chat starting prompt — USE THIS ONE

```
Read HANDOFF.md §1 + §2 first. Current state: Pack + Comp Reasoning
Explainer shipped; $29 reprice live; §20.8 fast-estimate architecture
live; walk-away market-value cap live; Pack-first homepage + pricing
live. 169 tests pass. tsc + eslint + next build all clean.

Two manual operator tasks remain before launch:
  1. Run supabase/migrations/004_negotiation_packs.sql.
  2. Create $29/mo Stripe Price, update STRIPE_PRICE_ID_PRO.

Next strategic focus (user-approved):
  - Calibration gauntlet: 10 more listings across diverse markets +
    property types to validate the engine. User sources these.
  - Collect investor demo signal. At least one "I'd pay for that
    specifically" before flipping Stripe to live mode.
  - One-time Pack purchase path ($19-29 Stripe Checkout, no signup
    until after payment) — deferred; only build if demand signals.
  - Dashboard polish: list a user's past Packs.

Pending P2 polish (do these only when there's a clear product reason):
  - Cross-tab numeric reconciliation (HANDOFF_ARCHIVE.md §20.9 #11).
  - Garbled negative-CF copy templates (§20.9 #12).

If a listing audit comes in, only revisit §20 if it produces a BUY
mislabeled as AVOID for reasons the user rejects. All §20 P1 items
(§20.9 #1-#9) and architecture (§20.8) have shipped. See
HANDOFF_ARCHIVE.md for the full ship history if you need it.
```

---

## 16. Where the rest lives

Everything else is in `HANDOFF_ARCHIVE.md`:

- §16 A–U — full ship history by phase (A rate/appreciation/flood,
  K RentCast cost reduction, L–Q quality pass, R Phase Q summary,
  S Phase M + Wave 1, T strategy reset, U audit findings).
- §17 — data-source roadmap (A shipped, B/C/D still aspirational).
- §18 — earlier version of the reference test listings.
- §19 — strategy-reset working list (mostly resolved by §20).
- §20.1–§20.12 — the strategic reasoning behind the Pack + $29 + §20.8.
- §20.13, §20.14, §20.16, §20.17, §20.18 — per-subsection ship logs.
- §20.15 — prior next-chat starting prompt (superseded by §15 above).

If you need a fact that isn't in this file, grep the archive. If the
current HANDOFF and the archive disagree, HANDOFF wins.
