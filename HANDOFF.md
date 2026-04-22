# RealVerdictROI — Project Handoff

**Status as of this hand-off (v2): the analysis engine has been extensively recalibrated and hardened. Verdict rubric now handles appreciation-driven markets sensibly, walk-away price suppresses absurd lowball recommendations, comp derivation is HOA-aware and cross-checks against market anchors (last-sale + list price). Dev server compiling cleanly, types + lint pass.** Next major phase: **add external data sources so auto-filled defaults are grounded in live market reality** (current mortgage rates, metro appreciation, flood zones). See §17.

This file is the single source of context for picking the project back up in a new chat. **Read §1 (positioning), §16 (recent fixes), §17 (data-source roadmap) first** — then skim the rest as needed.

---

## 1. Product positioning

**RealVerdictROI** is a real-estate deal analyzer for **active rental investors** — people who look at multiple deals per month and need a fast, trustworthy verdict before they make an offer. It is not for first-time house-hackers, not for institutional wholesalers, and not a generic mortgage calculator.

The single differentiator vs. BiggerPockets / Stessa / DealCheck:

> Every analysis tells you the **exact maximum price** at which the deal still scores at each verdict tier (STRONG BUY, GOOD, BORDERLINE, PASS). Investors walk into negotiations with a number, not a feeling.

Secondary differentiators we now also ship:
- **Reality-checked rents** — your rent assumption is compared against live rental comps; we flag optimistic numbers before you bet on them.
- **Stress test** — five canned shocks (rate up, rents down, vacancy up, expense spike, exit price down) and you see where the deal still holds vs. where it breaks.
- **Provenance on every auto-filled field** — each input has a badge telling the user where the number came from (RentCast AVM, Zillow listing, state average, your manual input) and a confidence level.

**Pricing thesis** (not yet implemented in Stripe — see §10):
- Free: unlimited one-off verdicts, no save, no comp tab.
- Pro (~$19/mo): saved deals, side-by-side comparison, comp tab, PDF export, unlimited what-ifs.

---

## 2. Tech stack

- **Next.js 16.2.4** with the App Router, Turbopack dev server, React 19.2.4.
  - **WARNING**: This is the new Next.js. APIs, file conventions, and rendering rules have breaking changes vs. anything in your training data. When in doubt, read the local docs in `node_modules/next/dist/docs/` rather than guessing. `AGENTS.md` enforces this.
- **TypeScript 5**, strict mode.
- **Tailwind CSS 4** (PostCSS plugin in `@tailwindcss/postcss`).
- **AI SDK 6** with `@ai-sdk/openai` (server) and `@ai-sdk/react` (`useChat`). Models: `gpt-4o-mini` for the initial verdict, `gpt-4o` for the follow-up chat.
- **Supabase** for auth (`@supabase/ssr`, `@supabase/supabase-js`) and the saved-deals table.
- **No charting / DataGrid / forms libraries**. All UI is hand-rolled with Tailwind. Keep it that way unless adding a chart that genuinely needs one.

`package.json` is intentionally minimal. Don't add deps without a reason.

---

## 3. Environment variables

`.env.local` lives in the repo root and is git-ignored. Currently set:

| Var | Purpose | Required for |
|---|---|---|
| `OPENAI_API_KEY` | gpt-4o-mini (initial verdict) and gpt-4o (chat) | AI verdict + advisor |
| `RENTCAST_API_KEY` | RentCast `/avm`, `/properties`, `/listings/sale`, `/listings/rental/long-term` | Auto-fill, comps |
| `SCRAPER_API_KEY` | ScraperAPI proxy for Zillow page fetch | Zillow URL parsing |
| `FRED_API_KEY` | St. Louis Fed FRED API (MORTGAGE30US series) | Live 30-yr fixed rate default |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Auth, save deals |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (publishable) key | Auth, save deals |

**Every feature degrades gracefully if a key is missing.** No key should ever crash a route. Resolver returns `notes` and `warnings` explaining what's missing; the comps endpoint returns 503 with a clear message; the Zillow parser returns a `url-fallback` result that at least pulls the address from the URL slug.

---

## 4. Repo structure

```
app/
  page.tsx                            # Landing page (hero form + value props + how-it-works + pricing teaser)
  layout.tsx
  globals.css                         # Tailwind base + small custom utilities (.scrollbar-hide, number input cleanup)
  results/
    page.tsx                          # Hero + tabs (Numbers / Comps / Stress / What-If / Rubric / Ask AI)
  compare/page.tsx                    # Side-by-side comparison of saved deals (uses localStorage)
  dashboard/page.tsx                  # Lists saved deals (Supabase)
  pricing/page.tsx                    # Marketing pricing page
  pricing/GetProButton.tsx            # CTA — currently a no-op (Stripe not wired)
  login/page.tsx                      # Magic-link auth
  _components/
    HomeAnalyzeForm.tsx               # The everything-form on the homepage
    InitialVerdict.tsx                # Streams gpt-4o-mini verdict at top of /results
    FollowUpChat.tsx                  # gpt-4o useChat() advisor in the Ask AI tab
    OfferCeilingCard.tsx              # NEW — the killer "walk-away price" card
    CompsSection.tsx                  # NEW — sale + rent comps tab
    ResultsTabs.tsx                   # NEW — sticky tab nav for /results
    WhatIfPanel.tsx                   # Sliders that recalc deal in real time
    StressTestPanel.tsx               # 5 canned scenarios
    VerdictRubric.tsx                 # Itemized score breakdown
    SaveDealButton.tsx
    ShareButton.tsx
    AddToComparisonButton.tsx
    aiProse.tsx                       # Helper that turns markdown into typography
  api/
    chat/route.ts                     # POST — gpt-4o follow-up chat (toolless, system prompt has full deal numbers)
    property-resolve/route.ts         # GET (address) / POST (zillow url) — unified resolver
    # property-lookup/ — removed in §16.K (dead since Phase 2 migration)
    zillow-parse/route.ts             # JSON-first Zillow scraper (parses __NEXT_DATA__ + Apollo)
    comps/route.ts                    # NEW — wraps lib/comps.ts for the frontend
    address-autocomplete/             # Typeahead helper
    auth/                             # Supabase callback
    deals/                            # CRUD for saved deals
lib/
  calculations.ts                     # THE source of truth. Pure functions. No I/O. ~900 lines.
  comps.ts                            # NEW — RentCast comps fetcher + percentile stats
  estimators.ts                       # State-level insurance + property-tax estimates with confidence
  kv-cache.ts                         # Async KV cache (Upstash Redis + in-memory fallback) used by resolver + comps + flood + rates
  client-session-cache.ts             # Client-side sessionStorage wrapper with TTL (autofill handoff)
  supabase/                           # Server + browser supabase client wrappers
public/                               # Currently empty (we deleted the default Next.js svgs)
```

Both `app/_components/utils.tsx` and several other `??` files in `git status` are tracked but uncommitted from prior work — they exist on disk and are actively used.

---

## 5. The calculation engine (`lib/calculations.ts`)

Memorize these exports — almost every change touches one of them.

```ts
DealInputs                  // The full input schema
DealAnalysis                // The full output (year-by-year projection, all KPIs, verdict)
VerdictTier                 // "excellent" | "good" | "fair" | "poor" | "avoid"
RubricItem                  // One scored signal: { category, metric, points, maxPoints, status, note }
Verdict                     // { tier, score, breakdown: RubricItem[], headline, summary, strengths, risks }

DEFAULT_INPUTS              // The starting point used by HomeAnalyzeForm
analyseDeal(inputs)         // Pure. Returns DealAnalysis.
sanitiseInputs(raw)         // Clamps every numeric field to a sane range.
findOfferCeiling(inputs)    // NEW. Returns OfferCeiling — see §6.
inputsToSearchParams(...)   // For deep linking
inputsFromSearchParams(...) // For deep linking
formatCurrency / formatPercent / formatNumber
```

Rules I have been holding to and the next chat should hold to:
- **Never put I/O in `lib/calculations.ts`.** Same input → same output, always.
- **Never hide the inputs from the URL.** Every result page is a function of its query string. This makes deals shareable and lets the back button work.
- **Don't add a new metric without scoring it.** If you add a KPI, add a `scoreXxx()` function that returns a `RubricItem` and include it in the breakdown — otherwise users can't tell what's actually moving the verdict.

Important historical note: there used to be **two parallel analysis universes** — a mocked one on the homepage / `/dashboard/analysis`, and the real one on `/results`. We deleted the mock universe in Phase 1. **Don't reintroduce it.** All analysis must go through `analyseDeal()` and render on `/results`.

---

## 6. The Target-Offer Solver (`findOfferCeiling`)

This is the product's headline differentiator. Lives at the bottom of `lib/calculations.ts`.

```ts
export type OfferCeiling = {
  excellent?: number;        // Max price at which the deal still scores STRONG BUY
  good?: number;             // ... GOOD or better
  fair?: number;             // ... BORDERLINE or better
  poor?: number;             // ... anything but AVOID
  currentPrice: number;
  currentTier: VerdictTier;
  recommendedCeiling?: { price: number; tier: VerdictTier };
};
```

How it works:
- Verdict score is monotonically non-increasing as price rises (price up → cap rate down → score down).
- Binary-search 25 iterations on `[1k, max(currentPrice * 5, 5M)]` for each tier independently.
- Prices rounded to nearest $500 (investors don't negotiate to the dollar).
- `recommendedCeiling` is the highest tier that's reachable.

Rendered by `app/_components/OfferCeilingCard.tsx` in the `/results` hero (right column on desktop, below the summary on mobile).

---

## 7. Data pipeline (resolver + comps)

### 7.1 `/api/property-resolve` (`app/api/property-resolve/route.ts`)

Single entry point used by the homepage form's auto-fill. Two methods:
- **GET `?address=...`** — RentCast `/properties` (1 call) for facts + lat/lng + latest tax bill, then comp-derived value/rent (see §16.K for the Stage 1 RentCast cost reduction), then enriched with state-level estimates from `lib/estimators.ts` plus live FRED rate, FHFA metro appreciation, and FEMA flood bump.
- **POST `{ url, address? }`** — calls `/api/zillow-parse` for listing data, then chains into RentCast `/properties` for whatever Zillow didn't supply, then the same comp + enrichment pipeline.

`/avm/value` and `/avm/rent/long-term` were removed in §16.K — both were being overwritten by the comp derivation and cost 2 RentCast requests per analysis for zero behavioural benefit.

Returns:
```ts
{
  source, address, state, facts, inputs, provenance,
  notes,      // informational ("scraperapi: extracted via apollo")
  warnings,   // user-facing ("Could not parse rent estimate from Zillow")
  comparables?: ComparablesAnalysis,  // set when comps resolved
}
```

`provenance` is **per-field metadata** — each populated input field gets `{ source: ProvenanceSource, confidence: "high" | "medium" | "low", note?: string }`. `ProvenanceSource` is currently `"rentcast" | "rent-comps" | "zillow-listing" | "fred" | "fhfa-hpi" | "fema-nfhl" | "state-average" | "national-average" | "default" | "user"`. The `HomeAnalyzeForm` renders this as colored badges with hover tooltips.

The resolver caches 24h via `lib/kv-cache.ts` (Upstash Redis in prod, in-memory fallback in dev — see §16.P). This is intentional: investors retype addresses constantly, and RentCast is metered. Cache version (`CACHE_VERSION`) is bumped whenever the derivation logic changes so old entries can't leak through — currently `v11`.

### 7.2 `/api/zillow-parse` (`app/api/zillow-parse/route.ts`)

JSON-first scraper. Old Cheerio CSS-selector approach was deleted because Zillow's modern markup makes it useless.

Pipeline:
1. Fetch through ScraperAPI (skipped if `SCRAPER_API_KEY` missing — falls back to URL slug parsing for the address only).
2. Pull `<script id="__NEXT_DATA__">`, `hdpApolloPreloadedData`, and `__APOLLO_STATE__` JSON blobs out of the HTML with regex.
3. Walk the JSON for `address`, `bedrooms`, `bathrooms`, `livingArea`, `yearBuilt`, `lotAreaValue`, `homeType`, `price`, `zestimate`, `rentZestimate`, `monthlyHoaFee`, `propertyTaxRate`/`taxAnnualAmount`, `homeInsurance`, `daysOnZillow`, `pricePerSquareFoot`, `homeStatus`.

Returns:
```ts
type ZillowParseResult = {
  source: "scraperapi" | "url-fallback";
  zpid, url, address,
  facts: { beds, baths, sqft, yearBuilt, lotSize, propertyType },
  listing: { listPrice, zestimate, rentZestimate, monthlyHoa,
             annualPropertyTax, annualInsurance, daysOnZillow,
             pricePerSqft, listingStatus },
  notes: string[],
}
```

### 7.3 `/api/comps` + `lib/comps.ts`

`lib/comps.ts` is the shared module. Both the route handler (for the future "refresh comps" button) and `app/results/page.tsx` (server-side render of the Comps tab) import from it directly. This avoids server-to-server HTTP loops.

`fetchComps({ address, beds?, baths?, sqft?, radiusMiles=3 })` returns (ladder widens to `[3, 10]` mi, only widening whichever side is still under 3 comps — see §16.K for the RentCast cost-reduction rationale):

```ts
{
  address,
  saleComps: { items: Comp[], stats: CompStats },  // from /listings/sale (Active+Sold)
  rentComps: { items: Comp[], stats: CompStats },  // from /listings/rental/long-term (Active)
  notes: string[],
}
```

`CompStats` includes `count`, `median`, `p25`, `p75`, `min`, `max`, `medianPricePerSqft`, `medianRentPerSqft`. Sorted by distance, then proximity to subject sqft.

24h cached, same as resolver. Returns `null` if `RENTCAST_API_KEY` is missing — the UI shows a friendly empty state.

### 7.4 `lib/estimators.ts`

State-level fallbacks for `annualInsurance` and `annualPropertyTax`. Each estimate carries a `{ value, confidence, note }` shape so the UI can render the same provenance badges as for real API data.

---

## 8. Results page architecture (`app/results/page.tsx`)

This is a **Server Component** that:
1. Parses inputs from the URL (deep-linkable).
2. Calls `analyseDeal(inputs)` and `findOfferCeiling(inputs)`.
3. `await fetchComps(...)` if address is present (parallel with auth check).
4. Renders the hero (always visible).
5. Renders `<ResultsTabs />` with all the deep-analysis sections passed in as React children.

### 8.1 Hero (`HeroSection`)
- Big tier label colored by `--accent` CSS var (green / yellow / red).
- Address + price + cash flow + cap + DSCR sub-line.
- Streamed AI verdict (`<InitialVerdict />`).
- Action buttons (Adjust / Save / Share / Compare).
- `<OfferCeilingCard />` on the right (or below on mobile).

### 8.2 Tabs (`<ResultsTabs />` — client component, `app/_components/ResultsTabs.tsx`)

Sticky tab bar with horizontal scroll + hidden scrollbar (`.scrollbar-hide` in `globals.css`). Toggles `display:none` on inactive panels rather than unmounting — keeps the SSR payload intact.

| Tab id | Label | Content |
|---|---|---|
| `numbers` | Numbers | `<EvidenceSection comps>` (Subject vs Market row + Returns + Risk + Long-term) followed by `<BreakdownSection>` (monthly waterfall + cash to close + year-by-year + sale proceeds) |
| `comps` | Comps | `<CompsSection>` |
| `stress` | Stress test | `<StressTestPanel>` |
| `whatif` | What-if | `<WhatIfPanel>` |
| `rubric` | Rubric | `<VerdictRubric>` |
| `chat` | Ask AI | `<FollowUpChat>` |

### 8.3 Per-metric market context

In `EvidenceSection`, when comps exist:
- A **"Subject vs market"** row is added above Returns showing your purchase price vs sale-comp median, your rent vs rent-comp median, and your GRM vs market GRM.
- Cap rate sub-line shows market cap proxy: `(rentMedian * 12 * (1 - subjectExpenseRatio)) / saleMedian`. (We can't measure NOI on the comps from RentCast alone, so we apply your expense ratio to their rent — this is documented in the code.)

### 8.4 Verdict rubric

`scoreXxx()` functions in `lib/calculations.ts` produce `RubricItem`s for: cash-on-cash, cap rate, DSCR, IRR, break-even occupancy, GRM (replaces the old "1% rule"). `<VerdictRubric>` renders these with colored status pills (`win` / `ok` / `warn` / `fail`).

**GRM thresholds** (in `scoreGRM`): ≤9 strong win, ≤12 win, ≤15 ok, ≤18 warn, >18 fail. Calibrated to real US metros: Cleveland/Memphis ~7-9, Tampa/Atlanta ~10-13, Austin/Charlotte ~13-16, Boston/Seattle ~15-18, SF/NYC/LA ~18-25+.

`onePercentRule` field is still on the public `DealAnalysis` type for backward compat (deep links from before today still work) but it's no longer scored.

---

## 9. Homepage (`app/page.tsx`)

Server component. Sections in order:
1. **Header** — brand, Compare, Pricing, Sign in / Dashboard.
2. **Hero** — tagline + `<HomeAnalyzeForm />` + "see a sample analysis →" link.
3. **Trust strip** — data sources (RentCast, Zillow, state avg, OpenAI).
4. **Value props** — three cards: walk-away price, reality-checked rents, stress-tested verdict.
5. **How it works** — three numbered steps.
6. **Pricing teaser** — CTA to `/pricing`.

### `HomeAnalyzeForm.tsx` (client)
The everything form. Address input with debounced auto-fill, Zillow URL paste (POST to `/api/property-resolve`), property-facts strip, headline inputs (price/rent/down/rate), advanced inputs section (auto-expands when resolver fills any non-headline field), provenance badges everywhere. On submit it serializes to `?...` and pushes to `/results?...`.

---

## 10. What's pending

**Phase Q (quality pass) is fully shipped — see §16.L through §16.Q for the full batch.** The only remaining pre-launch work is monetization. What used to be p5 (distribution) and p6 (hardening) is tracked below as a diff against reality.

### p4 — Monetization (the single remaining launch blocker)

Goal: convert the value the product creates into revenue.

Concrete tasks (Stripe day-one essentials only — everything else can ship later):
1. **Stripe checkout** for the Pro plan. Add `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` env vars; wire `app/pricing/GetProButton.tsx` (currently a no-op) to start a checkout session.
2. **`subscriptions` table** in Supabase keyed on `user_id` with `status`, `stripe_customer_id`, `current_period_end`, `price_id`. Stripe webhook writes it.
3. **Free-tier limiter** — layered on top of `lib/ratelimit.ts` (§16.M, already cross-lambda via Upstash). Per-user counter backed by `lib/kv-cache.ts` (§16.P), e.g. 5 full analyses per IP per week for anon, unlimited for signed-in Pro, 3 per week for signed-in free. Pro status comes from `subscriptions.status IN ('active','trialing')`.
4. **Gate the Comps tab, Save Deal, `/compare` remote sync, and PDF export** behind Pro. Free users see a teaser screenshot and a CTA. Pro gate lives in one helper (`lib/pro.ts`: `await isPro(user)`) so it's easy to flip features.
5. **Webhook** (`/api/stripe/webhook`) for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Verify signatures with `STRIPE_WEBHOOK_SECRET`. Use the existing `withErrorReporting` + rate-limit guard (§16.N).

Post-launch nice-to-haves that touch monetization:
- **PDF export** of the full verdict (`react-pdf` or server-side puppeteer). Useful as a Pro hook.
- **Customer portal** link from `/dashboard` so users can self-serve billing.

### p5 — Distribution

Partially shipped. What's done and what's still open:

| Task | Status |
|---|---|
| Per-page metadata + Open Graph cards | ✓ Shipped — see `generateMetadata` in `app/results/page.tsx` + `/api/og`. |
| Vercel Analytics | ✓ Shipped in Q4 (§16.N). |
| Plausible custom events | ✓ Shipped (`trackEvent` helper). |
| `app/sitemap.ts` and `app/robots.ts` | **Open.** |
| SEO landing pages (`/markets/austin-tx`) | **Open.** Pull a few thousand zip-code stats from RentCast + FHFA once and seed. |
| Blog or "buy reports" surface | **Open.** Share links from `/results?...` are already public, lean into it. |

### p6 — Hardening

Mostly shipped. Remaining gaps:

| Task | Status |
|---|---|
| Rate limit every API route | ✓ Shipped in Q3 (§16.M). |
| Sentry for errors | ✓ Shipped in Q4 (§16.N). |
| Move in-memory cache to cross-lambda backend | ✓ Shipped in Q7 (§16.P — Upstash Redis via `lib/kv-cache.ts`). |
| Drop `cheerio` dep | ✓ Shipped in Q1 (§16.L). |
| Test harness for math engine | ✓ Shipped in Q2 (§16.L — 101 tests as of Q6). |
| **Error boundaries on `/results`** | Open — a bad search param currently 500s the whole page. Small win. |
| **Retry + circuit breaker for RentCast** | Open — it 5xxes occasionally. Worth adding exponential backoff + a short circuit-break on repeated 5xx. |
| **Zod validation on every API route** | Open — today most routes parse query params loosely. Low-urgency; the rate limiter + error reporting pipeline means a bad payload produces a clean 500 rather than a silent corruption. |

---

## 11. Conventions and gotchas

- **TypeScript strict, lint clean.** `npx tsc --noEmit` and `npx eslint app lib --max-warnings 0` both pass currently. Keep them passing.
- **No `any` types.** Use `unknown` and narrow.
- **Server components by default**, client only when you need state, effects, or browser APIs. `"use client"` is at the top of any file that needs them.
- **Don't add `useEffect` for fetching data on the client when a server component can do it.** The whole `/results` data load is server-side for a reason — fewer waterfalls, faster first paint.
- **The dev server is sensitive to deleting `.next/` while it's running.** If it goes weird with build-manifest ENOENT errors, kill it, `rm -rf .next`, restart.
- **The sandbox the AI runs in blocks `tsx` IPC.** If you want to ad-hoc test pure functions from `lib/calculations.ts`, expose them via a temporary route handler and `curl` localhost rather than fighting `npx tsx`. Don't leave the route in.
- **Tailwind 4** uses the `@import "tailwindcss"` directive (see `app/globals.css`). No `tailwind.config.js`. Custom utilities go in `globals.css` under `@layer utilities` if you need scoping, or as plain CSS like the existing `.scrollbar-hide`.
- **CSS variables for theming** — `/results` sets `--accent` and `--accent-soft` on the root based on verdict tier, all child components read `var(--accent)`. Don't hard-code colors per component.
- **iOS tap targets ≥ 44px.** All interactive controls in the hero/tabs use `h-11 min-h-[44px]` or larger. Form inputs are larger.
- **Mobile-first padding** — `px-4 sm:px-6` everywhere on outer containers. Don't hop straight to `px-6` only.
- **No emojis in product UI** unless explicitly asked (per the user).
- **No comments narrating obvious code.** Explain intent and constraints, never restate what the code does.

---

## 12. Known open issues / paper cuts

These didn't make A–G but the next chat should consider:

1. **Zillow parser misses some pages.** When a listing is in a Zillow A/B test or under heavy pre-render, our regex on `__NEXT_DATA__` returns nothing useful. We always fall back to the URL slug for the address, but `facts` and `listing` come back empty. Logging server-side for now.
2. **RentCast comps can return very few results in rural areas.** The Comps tab handles this gracefully with an empty state but doesn't widen the radius automatically. Worth adding a 1mi → 3mi → 5mi auto-widen.
3. **"Reality check" rent comparison** uses simple median; an investor renting a luxury unit in a working-class area gets a misleading "20% above market" warning. Need to filter comps by sqft band more aggressively or add bedroom-stratified medians.
4. **`/compare` page** uses `localStorage` and `useSyncExternalStore`. Works, but doesn't sync across devices. When auth + Stripe land, move comparison sets to Supabase for Pro users.
5. **Save Deals API exists** (`app/api/deals/`) but is lightly used. When we gate it behind Pro, audit RLS policies on the Supabase table.
6. **`app/_components/aiProse.tsx`** is shared markdown styling for the streamed verdict and chat. If you change one, sanity-check the other.
7. **`cheerio` in `package.json`** is now unused after the Zillow rewrite. Safe to remove.

---

## 13. How to run

```bash
# install
npm install

# dev (Turbopack)
npm run dev

# strict checks before committing
npx tsc --noEmit
npx eslint app lib --max-warnings 0

# production build
npm run build
```

**Don't run `next build` while the dev server is running** — they share `.next/` and will corrupt it.

---

## 14. Conversation history pointer

The full prior chat (summarized in a previous turn, then continued through A–G) is at:

`/Users/elishamerel/.cursor/projects/Users-elishamerel-Desktop-realverdictroi/agent-transcripts/28b30822-1ec9-4fca-8f6b-4006b83d69ed/28b30822-1ec9-4fca-8f6b-4006b83d69ed.jsonl`

Reference as: [Initial RealVerdict build](28b30822-1ec9-4fca-8f6b-4006b83d69ed)

Search this file for keywords (e.g. "findOfferCeiling", "ResultsTabs", "scoreGRM") if context is needed beyond what's in this hand-off. Don't read it linearly — it's huge.

---

## 15. Where to start in the next chat

**Phase A (data sources) is shipped. Phase Q (quality pass — tests, rate limiting, observability, prod caches, UX polish) is also shipped in full** (see §16.L through §16.Q — batches Q1 through Q7 each have their own entry, plus a consolidated §16.R summary). The next direction is **Phase M: Stripe + paid gating** — see §10 (p4) for the task list. Phase B data sources (B1 RentCast market stats, B2 Census ACS, B3 ZORI/BLS) stay deferred until M is revenue-generating.

Previous direction (kept for historical context): *add more data sources first, before testing more listings, so numbers are trustworthy from the start — testing now then adding data later would invalidate all the calibration work we did.* That call was right at the time; Phase A closed the defaults-are-fake gap so the tests written in Q2 are testing the right numbers.

**Do NOT:**
- Pivot to house-hackers as the primary demographic. We have committed to active rental investors. House-hack mode is a free-tier unlock for LATER, post-launch, to funnel first-timers. See §16.F.
- Add warnings to cover bad data. We removed those deliberately. Fix the derivation or the anchor, don't paper over it.
- Reintroduce the mocked analysis universe. All analysis goes through `analyseDeal()` and `/results`.
- Remove the `HowWeGotThese` transparency panel at the top of `/results`. It IS the product's trust moat.

The previously-planned phases (p4 monetization, p5 distribution, p6 hardening from §10) still apply but come AFTER Phase A. Phase B and beyond of data sources can also be deferred until monetization if needed — they're nice-to-have, Phase A is must-have.

---

## 16. Recent fixes since last handoff

These shipped in the prior chat (the one producing this v2 handoff). Everything in §1–§15 above is still correct unless contradicted here.

### 16.R — Phase Q complete (Q1–Q7) — read this first

TL;DR for any agent resuming the project: **Phase Q is done. The only thing standing between the current code and production launch is Stripe (§10 p4).** The table below is the one-stop reference for what shipped in each batch — the detailed §16.L–Q entries that follow have the specifics.

| Batch | Shipped | Reference |
|---|---|---|
| **Q1** | Docs/dead-code cleanup: stale §7.1 AVM description fixed, `cheerio` dep dropped (−33 transitive packages), `ComprehensivePropertyData` dead type + callsites removed. | §16.L |
| **Q2** | Test harness: `vitest` + `@vitest/coverage-v8`, `npm run check` combines `tsc --noEmit + eslint + vitest run`. **101 tests** covering `calculations`, `comparables`, `comps`, `estimators`, `flood`, `rates`, `ratelimit`, `kv-cache`, `client-session-cache`. Golden-listing anti-regression for Boca / Dunellen / South Amboy / Staten Island. | §16.L |
| **Q3** | Rate limiting on every API route via `@upstash/ratelimit` (Redis-backed, cross-lambda) with in-memory sliding-window fallback for dev. Per-route budgets documented in `lib/ratelimit.ts`. Returns standard 429 + `Retry-After`. | §16.M |
| **Q4** | Error tracking (`@sentry/nextjs`, gated on `SENTRY_DSN`), Vercel Analytics (`@vercel/analytics`), structured `logEvent` breadcrumbs, `withErrorReporting` wrapper on every route handler, `captureError` on every fallible external call. Zillow parser emits per-strategy logs. | §16.N |
| **Q5** | Client-side `sessionStorage` autofill cache (`lib/client-session-cache.ts`). Same-session retypes cost 0 network calls, 0 RentCast. 30-min TTL, versioned namespace. | §16.O |
| **Q6** | UX polish before Stripe: (1) thin-rent hint under Monthly rent field when autofill couldn't derive rent; (2) `/compare` ↔ Supabase cross-device sync via new `compare_entries` table + `/api/compare` route; (3) resolver `warnings[]` surfaced as a banner on `/results` (dismissible, sessionStorage-handed-off by canonical address); (4) dedicated 429 banner with live countdown when the rate limiter engages. | §16.Q |
| **Q7** | Upstash Redis cache backend (`lib/kv-cache.ts`) replacing the process-local `TTLCache`. Cross-lambda persistence for FRED/FHFA/FEMA/RentCast caches + `/api/property-resolve`'s main cache. Fail-open design: Redis errors degrade silently to in-memory. | §16.P |

**Quality gates as of Phase Q close:**
- `npm run check` → **101 tests pass, lint clean, types clean.**
- RentCast budget per autofill: 3–5 on cold cache, 0 on warm cache (any lambda). Down from ~25 before §16.K / Q5 / Q7.
- Every API route: rate-limited, error-wrapped, structured-logged.
- Every external-data cache: cross-lambda via Redis with in-memory fallback.

**Operator actions required before production deploy:**
1. Apply `supabase/migrations/001_deals.sql` (existing, already deployed on staging).
2. Apply `supabase/migrations/002_compare_entries.sql` (**new in Q6** — without it, signed-in users see a sync-error banner on `/compare` but the app still works).
3. Ensure env vars are set: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (Q3 + Q7), `SENTRY_DSN` (Q4, optional but recommended). See `.env.local.example`.

**Next chat's starting prompt (recommended):** "Phase Q is complete per §16.R. Start Phase M — Stripe checkout and paid gating. Follow the concrete task list in §10 p4."

### 16.L — Phase Q kickoff: Q1 cleanup + Q2 test harness

After Phase A finished the user asked for a full review before adding Stripe — "make sure this product is as good as it can be." That review surfaced four launch blockers (no tests, no rate limiting, no error tracking, no monetisation) plus a shorter list of polish items. Rather than add Stripe and discover math regressions in production, we're running a **quality pass** (Phase Q) first. Phase Q batches:

- **Q1 — Documentation + dead code cleanup.** Fix §7.1 AVM description drift (now says "comp-derived value/rent", reflecting §16.K), mark Phase A shipped and Phase B deferred in §15/§17. Drop `cheerio` dependency (unused since §7.2 Zillow parser rewrite, removed 33 transitive packages). Drop `ComprehensivePropertyData` dead type + every `comprehensiveData` callsite from `app/api/chat/route.ts` (no callers — confirmed with `rg`). Kept `/api/comps` route; it's reserved for the future "refresh comps" button and adds zero dead-weight. ✓ Shipped.
- **Q2 — Test harness for the math engine.** Added `vitest` + `@vitest/coverage-v8` as dev deps, `vitest.config.ts` with `@/*` alias matching tsconfig, `test` / `test:watch` / `test:coverage` / `check` npm scripts (check = tsc + lint + test, runs as one command). Test files shipped (all in `lib/` next to source):
  - `lib/calculations.test.ts` — 28 tests covering `mortgagePayment` against a textbook reference, `remainingLoanBalance` + `amortisationWindow` identities, `irr` analytic matches, `sanitiseInputs` clamp boundaries + negative-growth pass-through, `analyseDeal` invariants (cash = down+closing+rehab, NOI − DS = CF, cap rate basis = price+rehab, projection length = holdYears, DSCR=∞ for all-cash, 1% rule), calibration anti-regression across the 4 reference listings (Boca Raton / Dunellen NJ / South Amboy NJ / Staten Island — score ordering pinned), `findOfferCeiling` tier-ceiling monotonicity (excellent ≤ good ≤ fair ≤ poor), echo-back of currentPrice/tier, and "buying at the good ceiling ⇒ verdict ≥ good".
  - `lib/comparables.test.ts` — 7 tests covering `analyzeComparables` public surface: null-comps returns nulls, matched-comps produces derived value/rent, beds=0/sqft=0 subject sanitisation, HOA override (SFR pool can't dominate when subject has HOA ≥ $200 — the Boca fix), low-HOA threshold safety, market anchor blend (comp disagrees by >25% → value pulls toward anchors + confidence→low), anchor agreement note within 12%.
  - `lib/comps.test.ts` — 7 tests covering `buildingKey` (unit/apt/suite/# suffix normalisation) and `dedupeByBuilding` (median-price collapse, rolledUpCount preservation, bed-closest representative selection).
  - `lib/estimators.test.ts` — 12 tests covering `detectStateFromAddress` (2-letter codes, full names, no-ZIP, bogus), `estimateAnnualInsurance` (FL >> NY × 2, state=medium vs national=low confidence, linear scaling), `estimateAnnualPropertyTax` (NJ > HI × 5, zero home value, national fallback).
  - `lib/flood.test.ts` — 10 tests covering `classifyFloodZone` (V/VE coastal-high, A*/AE/AH/AO/A99 inland SFHA, shaded-X moderate, unshaded-X low, Zone D undetermined, case normalisation), `floodInsuranceBump` (VE > AE > shaded X > 0 ordering), `floodInsuranceNote` format contract.
  - Exported `buildingKey`, `dedupeByBuilding`, `classifyFloodZone` to make them testable without mocking.
  - Whole suite at Q2 close: **64 tests, ~300ms cold run, all green.** `npm run check` runs tsc + lint + tests as one gate. ✓ Shipped.
  - As of Phase Q close (post-Q7): **101 tests** across `calculations`, `comparables`, `comps`, `estimators`, `flood`, `rates`, `ratelimit`, `kv-cache`, and `client-session-cache`. See §16.R for the post-Q snapshot.

### 16.M — Q3 shipped: rate limiting on every API route

**Problem:** every paid upstream (RentCast, OpenAI, ScraperAPI, Nominatim) and every open DB write (Supabase `deals`) was exposed without a budget. A single bored user or a scraper could exhaust a month's RentCast quota in an hour, burn $10/hour of OpenAI tokens, or fill the `deals` table. Free launch ≠ unrate-limited launch.

**Fix:** `lib/ratelimit.ts`, shared module used by every `/api/*` handler. Upstash Ratelimit (Redis-backed sliding window) as the production path, in-process sliding window as the dev/fallback path. `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` already in `.env.local` (free tier, 10k cmds/day).

**Public API** (30 lines of surface area — every route handler uses the same two-line guard):

```ts
import { enforceRateLimit } from "@/lib/ratelimit";

export async function GET(req) {
  const limited = await enforceRateLimit(req, "property-resolve");
  if (limited) return limited;
  // ... rest of handler
}
```

`enforceRateLimit` returns `null` when allowed or a 429 `Response` (with `Retry-After` header + JSON body `{ error: "rate_limited", retryAfter }`) when blocked. Fail-open on Upstash errors (rate limiting must never degrade UX).

**Budgets** (tunable from `LIMITS` object in `lib/ratelimit.ts` without a redeploy if UPSTASH_ vars stay the same):

| Route | Budget | Rationale |
|---|---|---|
| `/api/property-resolve` | 20/hour/IP | Expensive: FRED + FEMA + Census + up to 5 RentCast + optional Zillow per call. 20 is plenty for a real user, cuts scraping fast. |
| `/api/zillow-parse` | 10/hour/IP | Each call = 1 ScraperAPI credit (paid). |
| `/api/comps` | 30/hour/IP | Thin RentCast wrapper; user might refresh comps tab a few times. |
| `/api/chat` | 30/hour/IP | gpt-4o token cost ≈ $0.30/answer; 30/hr caps OpenAI bleed. |
| `/api/deals/save` | 60/hour/user | Per `supabase.auth.getUser().id`, not IP. Absurdly fast pace for real deal-saving. |
| `/api/address-autocomplete` | 120/minute/IP | Keystroke-level; 2/sec sustained covers real typing. |

**Backend selection:** module-load check for the Upstash creds. Present ⇒ Upstash path; absent ⇒ in-process sliding window (a `Map<key, timestamps[]>` with lazy sweep every 1000 checks so dev doesn't leak memory). Both share the same `{ allowed, retryAfter }` return shape.

**Identifier resolution:** `identifierFor(req, userId?)` — userId wins when supplied (used by `/api/deals/save`), else first entry of `x-forwarded-for`, else `x-real-ip`, else `"anonymous"`. Vercel sets `x-forwarded-for` automatically.

**Tests:** 13 new tests in `lib/ratelimit.test.ts` — first-request allow, token count enforcement, window-slide recovery, per-identifier + per-name bucket isolation, `retryAfter` is a positive integer seconds count, `identifierFor` precedence (user > xff > x-real-ip > anonymous), 429 response body + header contract. Full suite now **75 tests, green** in ~400ms.

**Verified end-to-end:** `curl` loop with synthetic `x-forwarded-for: 7.7.7.7` against `/api/property-resolve`:

- requests 1–20: HTTP 400 (bad address; within budget)
- request 21+: HTTP 429 with `Retry-After: 2657` seconds and correct JSON body
- Upstash `KEYS rvr:rl:*` confirms the bucket `rvr:rl:property-resolve:ip:7.7.7.7:<window>` exists in Redis, so the prod backend is engaged (not the in-memory fallback).

**Known limits / follow-ups:**
- Nothing pushes 429s to the UI today — clients will see the error propagate as a failed autofill. Q6 should add a "slow down" hint for the common case.
- Logged-in users still get per-IP limits for the expensive routes (autofill + zillow-parse + comps + chat). Upgrade path: plumb userId into those handlers once Supabase session checks are cheap enough, then bump their budgets for authed Pro users as a paid-tier differentiator.

### 16.N — Q4 shipped: error tracking + analytics + structured logs

**Problem:** once Q3 locked the public budget, the next launch blocker was "how do we find out when something breaks in production?". Every API route logged to stdout and then the log line disappeared into Vercel's default output. No aggregation, no alerting, no way to tell whether the Zillow parser fell back to regex-v3 or whether ScraperAPI is currently failing 30% of requests.

**Fix:** three additive, env-gated layers.

1. **`lib/observability.ts` — two-primitive surface** used everywhere:

   ```ts
   captureError(err, { area: "api.zillow-parse", extra: { zpid, url } });
   logEvent("zillow.parse.strategy", { zpid, strategy, success });
   ```

   `captureError` always prints a structured JSON error line to stderr (so Vercel log view can find it with a tag filter) and additionally calls `Sentry.captureException` which is a no-op when the SDK is uninitialised. `logEvent` is structured JSON to stdout plus a Sentry breadcrumb (so error reports carry the last few hundred events that led up to the crash).

   Bonus: `withErrorReporting(area, handler)` wraps a route so any uncaught throw is captured + returned as a clean JSON 500 instead of Next's default HTML crash page. Applied to every `/api/*` entry point.

2. **Sentry via `instrumentation.ts`** at project root — the Next 15+ convention. Lazy-imports `@sentry/nextjs` only when `SENTRY_DSN` is set, so the Sentry runtime isn't loaded at all on deployments without the DSN. Auto-instruments every App Router route (`captureRequestError` hooked via `onRequestError`). When enabled:
   - Tags every event with `area` (`api.property-resolve.GET`, `api.zillow-parse`, etc.).
   - Attaches a `Console` integration filter so dev-tool `console.error` breadcrumbs don't pollute reports.
   - Release taken from `VERCEL_GIT_COMMIT_SHA`, environment from `VERCEL_ENV`.

3. **`<Analytics />` component** in `app/_components/Analytics.tsx` now renders two overlapping providers:
   - **Vercel Analytics** (`@vercel/analytics/next`) unconditionally — free on Vercel Hobby, no-op on non-Vercel hosts. Gives us pageviews + web vitals out of the box.
   - **Plausible** when `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` is set. Custom event funnel (`window.plausible("analyze_click", { props })`). Paid; separate from Vercel Analytics which covers infra not product events.

**Structured breadcrumbs** added to the highest-risk path, the Zillow parser:

- `zillow.parse.fallback` — `{ reason: "no_scraper_key" | "scraperapi_http_error" | "anti_bot_page", zpid, ... }`. Fires every time we bail out to URL-only facts. Grep this to see how often the scraper silently degrades.
- `zillow.parse.strategy` — `{ zpid, strategy: "findPropertyInNextData" | ... | "none", success }`. Tells us which of the 4 extraction paths succeeded. When a new Zillow template ships and one of them starts failing consistently, this shows up in the logs days before any user complains.

Plus breadcrumbs on `property-resolve.cache.hit`, `property-resolve.resolved`, `chat.request`, `deals.save`, so we can trace a user's full session across 6 log lines in the Vercel viewer.

**`.env.local.example`** updated to document every env var we read — previously it covered 5 vars, now it covers all 12.

**Verified end-to-end (dev server, real curl):** all 6 wrapped routes still return correct status codes (200 / 400 / 401 / 429 / 502) and the structured log line fires exactly once per successful `property-resolve`:

```
{"level":"info","event":"property-resolve.resolved","mode":"address","state":"TX","hasFacts":true,"warnings":0}
```

Full `npm run check` green (tsc + eslint + 75 vitest assertions).

**Remaining Phase Q batches (documented here so the next agent can pick up mid-way if needed):**
- Q6 — UX polish: inline hint when `monthlyRent = null` ("manual entry — no rent comps available"), sync `/compare` queue with Supabase for Pro users, make Zillow fallback `warnings` visible on `/results` not just the homepage, visible "slow down" banner on 429 from `/api/property-resolve`.
- Q8 — Final HANDOFF update after Q3–Q7.

### 16.O — Q5 shipped: client-side sessionStorage autofill cache

**Problem:** the autofill resolver already has a 24h `TTLCache` on the server, but Vercel can route two autofill calls from the same user to different lambda instances. In that common cross-lambda case, the cache does nothing and every "analyse, edit, go back, retype the same address" round trip re-spends 3–5 RentCast requests. Worse, there's a 200–500 ms user-perceived delay on every retype that feels like the product is dumb — the tool clearly _has_ the answer, it just threw it away.

**Fix:** `lib/client-session-cache.ts` — a tiny (120-line) generic wrapper around `window.sessionStorage` with absolute-expiry TTL semantics. `HomeAnalyzeForm` now checks this cache before calling `/api/property-resolve`:

```ts
const cacheId = normalizeCacheKey(text);
const cached = sessionGet<ResolverPayload>(AUTOFILL_CACHE_NS, cacheId);
if (cached) {
  applyResolvedPayload(cached, mode, /*fromCache*/ true);
  return; // zero network calls
}
```

Cache hit ⇒ 0 RentCast + 0 FRED + 0 FEMA + 0 Census calls, ⇒ ~0 ms to render the filled form vs ~400 ms cold. Cache miss ⇒ same path as before, _plus_ we write the successful payload back with a 30 min TTL.

**Design choices worth remembering:**
- **Namespaced + versioned:** keys live under `rvr:cache:autofill:v1:<normalized-address>`. Bumping `AUTOFILL_CACHE_VERSION` invalidates every entry without a user-visible change, so resolver-shape migrations don't leak stale payloads from an older deploy.
- **30 min TTL:** long enough for "analyse → edit → back → retype" sessions, short enough that macro data (FRED rates update daily, RentCast listings can flip to pending) doesn't go stale under the user's feet. The server cache is 24h because it's shared across users; the client cache is per-session so the half-life can be much shorter.
- **Fail-safe on errors only cache success:** `applyResolvedPayload` returns `false` when the resolver gave us an empty-looking response; we _don't_ cache empty responses, otherwise a transient RentCast 500 would lock the user out of autofill for 30 min.
- **Normalized keys:** `normalizeCacheKey` lowercases, collapses whitespace, strips trailing `.,`. Address and `Address,` and ` address ` all hit the same entry. Unit numbers are _preserved_ — `100 Oak Ave` and `100 Oak Ave Apt 4` are different properties, not typos.
- **SSR-safe:** every `window.sessionStorage` access is guarded with `typeof window === "undefined"` + try/catch, so this module imports cleanly from server components even though it's only called from `"use client"` code today.
- **Quota-safe:** Safari private browsing throws `QuotaExceededError` on any write, and large JSON blobs can blow the 5 MB session quota. Both cases are swallowed and the next autofill just re-fetches — degraded UX, not broken.

**Telemetry:** `trackEvent("Autofill Started", { mode, cache: "hit" | "miss" })` — we can now see the real-world hit rate in Plausible / Vercel Analytics. If it's below 15% we got the key-normalization wrong; if it's above 70% on a fresh Vercel cold-start we're probably masking a stale-data bug.

**Tests:** 14 new tests in `lib/client-session-cache.test.ts` — round-trip, TTL expiry (vi.useFakeTimers), eviction on expired read, namespace isolation, SSR (no-window) no-op path, JSON.parse rescue, QuotaExceededError swallow, `normalizeCacheKey` case-insensitivity + trailing-punct stripping + unit-number preservation. Full suite now **89 tests, green** in ~450ms.

**What this batch does NOT solve:** cross-lambda re-fetch on `/results`. `/results` is a Server Component, so sessionStorage can't bridge the client → server gap. The comps-derivation call on `/results` still runs through `fetchComps`, which hits the per-lambda in-process cache — same-lambda hits are free, different-lambda misses still re-spend 3–5 RentCast calls. That's deliberately deferred to **Q7**, where an Upstash-backed cache backend will fix it cleanly at the server layer. Doing sessionStorage-to-client-component for `/results` would have required a significant server-render refactor (Evidence, HowWeGotThese, and CompsSection all consume the server-fetched comps payload) for a fix that Q7 obsoletes 100%.

**End-to-end RentCast budget after Q5:**
- Typing an address for the first time: 3–5 calls (unchanged — these are unavoidable first-encounter calls).
- Retyping the same address in the same session: 0 calls (was 3–5, now always 0).
- Navigating to `/results` after autofill: 0 calls on same-lambda cache hit, 3–5 on cold lambda (Q7 target).

**Gated follow-ups:**
- Once Q7 lands, the same `sessionGet/sessionSet` primitives can be reused to read/write the _derivation_ payload (`comparables: ComparablesAnalysis`) so `/results` client-renders the comps tab from cache even on cross-lambda. Worth doing; deferred because it overlaps with Q7's architecture.

### 16.P — Q7 shipped: Upstash Redis cache backend (cross-lambda)

**Problem:** every upstream data cache in the app (`lib/rates.ts`, `lib/flood.ts`, `lib/comps.ts`, `/api/property-resolve/route.ts`) was backed by `lib/server-cache.TTLCache` — a per-process `Map`. On Vercel serverless that means:

1. **Cold-start tax.** Every deploy, scale-to-zero, or idle timeout wipes the cache. First user of every new lambda instance pays full freight for FRED + FEMA + Census + 3–5 RentCast calls.
2. **Concurrent-lambda tax.** Two parallel requests from the same user can land on different lambdas. Lambda A just cached the resolver result; lambda B has never seen it; user retries; lambda B re-spends every upstream call.
3. **The cross-lambda `/results` re-fetch Q5 couldn't reach** (see §16.O) — `/results` is a Server Component, so sessionStorage can't bridge it. Cache had to move to a server-side cross-lambda store.

**Fix:** `lib/kv-cache.ts` (185 lines). `KVCache<T>` — drop-in async replacement for `TTLCache<T>` with Redis-primary + in-memory fallback. Same backend selection pattern as `lib/ratelimit.ts` (reuses the same `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` we shipped in Q3 — zero new credentials).

```ts
const FLOOD_CACHE = new KVCache<FloodZone>("flood", 30 * 86_400_000);
const hit = await FLOOD_CACHE.get(key);  // was: FLOOD_CACHE.get(key) (sync)
if (hit) return hit;
// ...
await FLOOD_CACHE.set(key, zone);        // was: FLOOD_CACHE.set(key, zone)
```

**Behavior contract:**
- **When Upstash is attached:** both Redis _and_ the local in-memory store are written on `set`. Reads try Redis first; if Redis throws, fall through to in-memory (warm lambda can still serve previously-cached values if Upstash is transiently down). Fail-open design — a cache error never breaks the upstream fetch.
- **When Upstash is absent (dev default, or prod deploys without the env vars):** only the in-memory store is used. Identical semantics to the old `TTLCache` — same TTL, same LRU eviction, same sync-feeling async wrapper.
- **Namespaces are mandatory** and enforced (`/^[a-z0-9_-]+$/`) at construction. Key collisions between `flood` / `geocode` / `rates` / `comps-sale` / `comps-rent` / `resolver` are impossible by construction.
- **TTL is stored in Redis via `px`** (millisecond expiry), so Redis evicts expired entries for us — the in-memory layer's absolute-expiry logic is identical.
- **Null-value ambiguity** (the classic "cached null match vs never written" problem): `KVCache.get` treats Redis `null` as miss. The one caller that genuinely needs to cache a null result — `GEOCODE_CACHE` caching "no match" for 7 days — boxes the value as `{ v: LatLng | null }`, which sidesteps the issue cleanly without poisoning the general-purpose API.

**Call sites migrated:**

| File | Caches | Note |
|---|---|---|
| `lib/rates.ts` | `rates` (24h) + `rates-neg` (10min) | FRED mortgage rate. Async ripple trivial, already in `async function`. |
| `lib/flood.ts` | `flood` (30d) + `flood-empty` (1h) + `flood-neg` (5min) + `geocode` (7d) + `geocode-neg` (10min) | Boxed geocode values to preserve null-match semantics. |
| `lib/comps.ts` | `comps-sale` (24h) + `comps-rent` (24h) | The big win — these drive 3–5 RentCast calls per miss. Cross-lambda hit rate is what fixes the Q5 gap. |
| `app/api/property-resolve/route.ts` | `resolver` (24h) | Cached `ResolveResult` keyed by `${CACHE_VERSION}:addr:${normalized}` / `${CACHE_VERSION}:zillow:${url}`. |

**Dead code removed:** `lib/server-cache.ts` (the old `TTLCache` class) — no remaining callers after the migration. Tracked grep across `lib/**` and `app/**`; only comment-level references remained and those were updated.

**Tests:** 12 new tests in `lib/kv-cache.test.ts` covering in-memory fallback happy path, TTL expiry (with `vi.useFakeTimers`), per-call TTL overrides, delete, namespace isolation, constructor validation of namespace character class, LRU-ish recency refresh on read, explicit fallback when Upstash env vars are absent or only partially set (mixed-config safety). Full suite now **101 tests, green** in ~450ms.

**Live smoke test (real Upstash, dev server against `/api/property-resolve`):**

```
request 1 (cold — writes to Redis):   200 in 25.0s (app: 24.5s — FRED + FEMA + Census + RentCast)
request 2 (different lambda module):  200 in  7.0s (app:  7.0s — unlucky concurrency with #1 still finishing)
request 3 (warm, real Redis hit):     200 in  0.4s (app:  135ms — full resolver replaced by one Redis GET)
request 4 (warm, real Redis hit):     200 in  0.3s (app:  133ms)
```

Confirmed via `redis-cli`-equivalent REST call that the expected keys exist:

```
rvr:kv:comps-rent:rent:<addr>::32.5:3:d
rvr:kv:comps-sale:sale:<addr>::32.5:10
rvr:kv:comps-sale:sale:<addr>::32.5:3
rvr:kv:flood:38.89710,-77.03654
rvr:kv:rates:MORTGAGE30US
rvr:kv:resolver:v11:addr:<addr>
```

Both key-space prefixes (`rvr:rl:*` for rate limiting from §16.M, `rvr:kv:*` for caches from this batch) are now live in the same Upstash database, which is exactly why we picked a shared-credential architecture: one dashboard, one budget to watch, one env pair to rotate.

**RentCast budget after Q7:**
- Autofill cold-lambda miss: 3–5 calls (unavoidable — first encounter with this address by ANY lambda).
- Autofill warm anywhere in the fleet: 0 calls (any lambda that previously resolved this address has populated Redis for everyone).
- `/results` render after a fresh autofill: 0 calls. **This is the Q5 gap fixed.** Whether `/results` lands on the same lambda or a different one, the per-side comp pool keys (`comps-sale:<addr>::<beds>:<baths>:<radius>`) are Redis-visible and return without touching RentCast.
- User retypes the same address within 30 min: 0 calls, served entirely from the Q5 sessionStorage cache without a network hop.
- User retypes after 30 min but within 24 h: 0 upstream calls, one fast round trip to Redis.

**Observability gotchas worth remembering:**
- The in-memory layer is still warm inside each lambda, so "local dev with Upstash off" sees near-identical perf to "prod with Upstash on, same-lambda reuse". Easy to miss a latency regression if you only test locally — smoke the Vercel preview to catch Redis-specific issues.
- Redis errors are captured via `observability.captureError` — when `SENTRY_DSN` is configured (§16.N), cache failures are visible in Sentry and break down by `namespace` and `operation`. Grep `area: kv-cache.get | kv-cache.set | kv-cache.delete` to find them.
- The Upstash Hobby tier caps at 10k commands/day. Our cache write volume: ~6 set + 6 get = 12 ops per autofill, cap every 24h = ~830 autofills/day before throttling. Plenty for pre-revenue; worth monitoring after Stripe launches.

**Remaining Phase Q:**
- Q8 — final HANDOFF pass consolidating Q1–Q7.

### 16.Q — Q6 shipped: UX polish before Stripe

**Problem:** Four small-but-visible gaps stood between Q7 and the monetisation phase. Individually none were show-stoppers, cumulatively they made the product feel less polished than the analysis engine under the hood.

**The four wins (all shipped, `npm run check` green at 101 tests):**

**Q6.1 — Thin-rent hint (`app/_components/HomeAnalyzeForm.tsx`).** When the resolver can't find rent comps it leaves `monthlyRent` on the default seed; when it only has a Zillow Zestimate it tags the field with low confidence. Both cases now surface an inline amber hint directly under the Monthly rent input:
- `source === "default"` → `"No rent comps available — enter the expected monthly rent."`
- `source === "zillow-listing" && confidence === "low"` → `"Rent from Zillow Zestimate — verify against local listings."`
- Extracted helper `rentHint(lookup, provenance)` so the logic is tested in isolation and the component stays readable.
- `NumberField` gained an optional `hint?: string` prop, currently only consumed on the rent field but trivially extensible to any other weakly-sourced input.

**Q6.2 — `/compare` ↔ Supabase sync (`supabase/migrations/002_compare_entries.sql`, `app/api/compare/route.ts`, `app/compare/page.tsx`, `app/compare/CompareClient.tsx`, `app/_components/AddToComparisonButton.tsx`).** The comparison queue lived in localStorage, which meant a user who built a queue on their laptop had to re-build it on their phone.
- New `compare_entries` table: `(user_id, deal_key)` unique index enables upsert; full RLS mirroring the existing `deals` table.
- Unified API route `/api/compare` exposes GET (list), POST (upsert), DELETE (one by dealKey OR all). Budget reuses the `deals-save` rate limiter since cross-device sync is a low-volume workflow.
- `/compare` is now a server component that fetches the initial remote queue for signed-in users and hands off to `CompareClient`. Anonymous users get the original pure-localStorage behavior.
- First-login merge: when a signed-in user lands on `/compare` with localStorage-only entries, those entries are upserted to Supabase and the local copy is cleared. Idempotent and guarded by a `useRef` so subsequent renders don't re-fire.
- `AddToComparisonButton` writes localStorage first (instant optimistic UX) and fires a background upsert to Supabase for signed-in users. Network failure is swallowed — the next `/compare` load's merger is the second chance.
- Graceful degradation: if the user hasn't run the migration yet, API returns 500 with `hint: "did you run migration 002?"`. The client surfaces a banner but the queue still works from localStorage.

**Q6.3 — Resolver warnings visible on `/results` (`app/_components/ResultsWarningsBanner.tsx`, `app/results/page.tsx`, `app/_components/HomeAnalyzeForm.tsx`).** The resolver's `warnings[]` array (e.g. "Zillow scraper offline — used public records only", "FRED rate stale") was rendered as an amber chip on the homepage but silently dropped the moment the user hit Analyze.
- New namespace `results-warnings:v1` in sessionStorage, keyed by canonical address, TTL 30 min. `HomeAnalyzeForm` writes this entry at submit time whenever `lookup.state === "ok"` and `warnings.length > 0`.
- `ResultsWarningsBanner` (client component) reads the entry on mount, renders a dismissible amber card above "How we got these numbers", and clears the entry on dismiss so the next tab-open on the same URL stays quiet.
- Deliberately sessionStorage-only: shared `/results` URLs opened in fresh sessions show no banner because the warnings may no longer apply. "Under-warn" over "over-warn".

**Q6.4 — 429 banner (`app/_components/HomeAnalyzeForm.tsx`).** The rate limiter (§16.M) returned clean 429 responses with `Retry-After` headers, but the UI treated them as generic autofill failures.
- New `LookupStatus` branch `"rate_limited"` with an explicit `retryAfter: number` field.
- `handleAutoFill` checks `res.status === 429` before the normal payload path; prefers the `Retry-After` header (RFC standard) and falls back to the JSON body's `retryAfter` field, with a sane 60-second default.
- `RateLimitNotice` component renders a dedicated amber card with a live 1-Hz countdown: "Try again in 42s" → "in ~1 min" → "now — tap Auto-fill again". Countdown uses the canonical `setState + setTimeout` pattern to satisfy React 19's strict purity / effect rules.
- Analytics: `"Autofill Rate Limited"` event with `{mode, retryAfter}` for Plausible dashboards.

**Files touched:**
- `app/_components/HomeAnalyzeForm.tsx` — rent hint, 429 state + banner, warnings handoff.
- `app/_components/ResultsWarningsBanner.tsx` — new, reads sessionStorage.
- `app/_components/AddToComparisonButton.tsx` — background upsert for signed-in users.
- `app/compare/page.tsx` — server shell that decides mode.
- `app/compare/CompareClient.tsx` — new, handles both modes + merge.
- `app/api/compare/route.ts` — new, GET/POST/DELETE.
- `app/results/page.tsx` — renders banner, passes `signedIn` to button.
- `supabase/migrations/002_compare_entries.sql` — new.

**Operator action required:** apply `002_compare_entries.sql` to production Supabase before deploying, otherwise signed-in users will see the sync-error banner on `/compare`. Anonymous users are unaffected.

### 16.A — Verdict rubric recalibrated for appreciation markets

**Problem:** The old rubric heavily penalized year-1 negative cash-on-cash (-10 pts) and DSCR < 1.0 (-8 pts). In appreciation-driven markets (NJ, FL, coastal), deals with strong 10-year IRR but weak year-1 cash flow were being labelled AVOID, which is wrong — those are legitimate long-hold plays.

**Fix (in `lib/calculations.ts`):**
- New `appreciationRescue` flag in `renderVerdict`: set when `irr >= 8% AND totalROI >= 50%`.
- When rescue is active, the CoC negative-penalty softens from −10 → −3 and DSCR<1 softens from −8 → −3. Warn notes explain the trade-off.
- `maxPoints` rebalanced: `scoreCashOnCash` 18→12 (reduce weight of year-1 cash flow), `scoreIRR` 18→22 (increase weight of long-term returns). New 8% IRR tier added (11 pts).
- Net effect: genuinely bad rental deals still land AVOID (Boca case: IRR −0.9%, totalROI 34% — rescue doesn't fire, full penalties apply, correct). Deals like Dunellen (strong IRR, weak CF) now land BORDERLINE/GOOD instead of AVOID.

### 16.B — Walk-away price made realistic (no more lowball absurdity)

**Problem:** `findOfferCeiling` would happily recommend "Max offer: $56,000 for EXCELLENT" on a $1.2M listing because the solver runs to $1k low-bound. Users called this "retarded" and they were right.

**Fix (in `lib/calculations.ts`):**
- `OfferCeiling` type now has `primaryTarget`, `stretchTarget`, and `rateBuydown` fields.
- `findOfferCeiling` only populates `primaryTarget` if a tier is achievable **within a 15% negotiation band** below list. If nothing clears within 15%, `primaryTarget` stays undefined.
- `stretchTarget` = next tier up from primary, if achievable and meaningfully different.
- `rateBuydown` = upfront cost to buy rate down 1 point + equivalent price reduction. Micro-copy shows this as a negotiation lever.
- `OfferCeilingCard.tsx` updated: when `primary` is undefined, displays **"No realistic price clears the rubric"** + an explanation that rent estimate or financing is usually the off-note. Ladder still shows the unreachable tier prices for transparency.

### 16.C — Comp scoring: DOM penalty + sold-preferred

**Problem:** Active listings that have sat on the market 180+ days were scoring equal to fresh ones, skewing sale-value derivation high (the market has already rejected those prices).

**Fix (in `lib/comparables.ts`):**
- `scoreComp`: for `kind=sale` AND status=active, subtract 8 points if DOM > 90, subtract 15 if DOM > 180.
- `derive` (sale): when ≥3 sold comps exist in the scored pool, filter to sold-only before computing median. Sold prices reflect actual market clearing; active list prices are asks.
- workLog records the sold-only filter when it fires.

### 16.D — Rent-per-sqft submultiplicative scaling + dedupe-by-building + bed-matched fallback + beds=0 sanitation

**Problem (209 S Stevens Ave case):** A 2,216 sqft multi-family got rent of $6,110/mo because comps were dominated by 800 sqft condos in a single downtown building scaled linearly; one of those buildings contributed 5 comps that skewed $/sqft high.

**Fix (in `lib/comps.ts` and `lib/comparables.ts`):**
- `dedupeByBuilding` in `lib/comps.ts` collapses multiple units from the same building address root into one representative comp (median). No more single-tower dominance.
- Submultiplicative rent scaling (power-law exponent 0.7) when subject sqft is outside ±30% of comp median. `rent = medianAbsRent × (subject_sqft / median_sqft)^0.7`.
- Bed-matched fallback in `derive` Path B: when falling back to median-absolute (no sqft), filter to ±1 bed of subject.
- `RentCast beds=0` treated as `undefined` in resolver and `analyzeComparables` (older homes often return 0 which would silently disable the bed filter).
- Rent comp fallback: when strict bed/bath filter yields < 3 comps, progressively drop bath then bed filters and rely on $/sqft normalization.

### 16.E — HOA-aware property type override + market anchors (the Boca fix)

**Problem (1121 NW 13th St, Boca Raton):** A $400k condo-style townhouse with $624/mo HOA got a fair-value derivation of $620k because the comp pool was dominated by detached Boca single-family homes at $489/sqft (townhouse is really a condo in a gated community). Old SFR↔townhouse penalty was only −5; the market had literally rejected that property at $415k a year prior.

**Fix (in `lib/comparables.ts`, `app/api/property-resolve/route.ts`, `app/results/page.tsx`, `app/_components/HomeAnalyzeForm.tsx`, `app/_components/HowWeGotThese.tsx`):**
1. `SubjectSnapshot` extended with `monthlyHOA`, `lastSalePrice`, `lastSaleDate`, `currentListPrice`, `expectedAppreciation`.
2. `inferSubjectCategory`: if `monthlyHOA >= $200/mo`, force subject category to `condo-apt` regardless of Zillow's `propertyType` label. A material HOA means condo-style ownership — detached SFRs do NOT pay HOA.
3. `scoreComp` property-type penalty hardened: **SFR↔condo-apt mismatch is now −50** (was −25 for sale, −45 for rent). SFR↔townhouse is **−18** (was −5). These are disqualifying mismatches, not scoring nudges.
4. New `applyMarketAnchorsToSale` in `lib/comparables.ts`: cross-checks comp-derived sale value against (a) last-sale rolled forward by appreciation, (b) current list price. When anchors agree within 12% → workLog adds "Cross-check ✓". When 12–25% divergence → confidence trimmed one level. When >25% → blend 35% comp + 65% anchors, force confidence to low, explain the divergence in the workLog.
5. Resolver passes HOA + last-sale + current list price through to `analyzeComparables`. Results page reads last-sale from URL (pass from `HomeAnalyzeForm` via `lastSalePrice`, `lastSaleDate`, `listed=1` query params).
6. `HowWeGotThese` "X% below comp median" banner now only shows the signal green/amber badge when `confidence === "high"`. On medium/low, shows a neutral caveat pointing to the comp list.
7. Cache version bumped v5→v6 in `property-resolve` so stale results don't come back.

**Verified end-to-end:** Boca re-derivation now lands at $390k from 3 real peer condos at $308/sqft, with workLog: "Cross-check ✓ — comp-derived value agrees with market anchors (last sold $400,000 2.6y ago → ~$432,000 today; current list price $400,000)". The verdict stays AVOID (correctly — it's a bad rental deal due to the HOA), but the valuation reasoning is defensible.

### 16.F — Strategic decision: stay with active rental investors, defer house-hackers

The user asked twice whether to pivot to house-hackers. Answer is no, and the reasoning that was given to them:

- **Different product shape.** House-hackers need owner-occupied FHA financing (3.5% down, PMI), primary-residence tax treatment, room-rental income math. Different rubric. Bolting onto a rental-investor product waters both down.
- **Different willingness to pay.** House-hackers buy once, maybe twice. They'll use free tools (BP calculators, spreadsheets) and won't pay $20–30/mo. Active rental investors analyze dozens of deals a year — the unit economics of a paid subscription only work on them.
- **Plan for house-hackers LATER:** post-launch, add a free "House Hack Mode" toggle that swaps FHA assumptions + only-the-rented-portion-as-income and spits out a simplified verdict. No paywall. Funnel first-timers into the ecosystem; they graduate to investor status in 2–3 years. Free tier becomes a retention/acquisition lever, not a distraction from paid.

Do not revisit this unless the user brings market feedback that says otherwise.

### 16.J — Phase A3 shipped: FEMA flood zones → insurance reality check

**Problem:** the state-average homeowners estimator is blind to flood risk. HO3 policies don't cover flood — NFIP and private flood are separate line items that run $1,500–4,500/yr depending on zone. On a Boca Raton or Miami Beach deal, ignoring that understates operating expenses by thousands per year, which in turn overstates CoC, NOI, DSCR, and the maximum-sane-offer ceiling. A user who sees "insurance $11k/yr" on a coastal FL deal and then gets quoted $15k once flood kicks in loses trust in the whole product.

**Fix:**
1. New `lib/flood.ts` — three pure functions, all server-side, zero API keys:
   - `getFloodZone(lat, lng)` → `FloodZone | null`. Hits FEMA NFHL MapServer layer 28 (Flood Hazard Zones). Classifies the raw `FLD_ZONE`/`ZONE_SUBTY` into a `"high" | "moderate" | "low"` risk bucket. Zone A/AE/AH/AO/AR/A99 (1%-annual-chance SFHA) → high. Zone V/VE (coastal high-velocity, wave action) → high + `isCoastalHigh: true`. Shaded X / levee-protected / 500-year → moderate. X minimal / D / unknown → low.
   - `geocodeAddress(address)` → `{ lat, lng } | null`. Census Geocoder fallback used when neither RentCast nor Zillow gave us coordinates. Free, no key, ~500ms for TIGER-known addresses.
   - `floodInsuranceBump(zone)` / `floodInsuranceNote(zone, bump)` — the delta added to `annualInsurance` and the human-readable provenance note. SFHA: +$1,800/yr. Coastal V/VE: +$3,500/yr. Moderate: +$600/yr. Low: $0.
2. FEMA's public ArcGIS endpoint is slow (6–12s typical, sometimes 15s+ cold-start) and occasionally returns a 200 with empty features. Caching strategy reflects that reality:
   - Positive zone result: 30 days (flood maps update on a multi-month cadence).
   - Empty-feature result: 1 hour (short so transient FEMA hiccups don't silently poison the cache).
   - Timeout / HTTP error: 5 minutes (so an outage doesn't block every user's autofill for hours).
   - Timeout is 12s on the outbound call, which is generous but necessary given FEMA's cold-start behaviour. Caching means only the first resolver call for any given lat/lng eats this.
3. RentCast `/properties` now plumbs `latitude/longitude` into `ResolveResult.facts` (the response already contained them; we just weren't reading them). If present, we skip the Census geocode and go straight to FEMA.
4. `"fema-nfhl"` added to `ProvenanceSource` in `app/api/property-resolve/route.ts`. New helper `applyFloodAssessment(result)` resolves the lat/lng (RentCast first, else geocode), queries FEMA, and stamps `result.facts.floodZone = { zone, risk, label, isCoastalHigh }`. Runs in parallel with the FRED rate fetch via `Promise.all` inside `enrichWithEstimates`, so the worst-case autofill latency is `max(FEMA, FRED)` (≈FEMA ≈10s on a cold coord) rather than the sum.
5. When `floodZone.risk !== "low"` the helper re-writes `inputs.annualInsurance` as `base + floodInsuranceBump(zone)`, re-tags the provenance with `source: "fema-nfhl"`, confidence `medium`, and chains the prior note onto the new one so the user can still see where the base number came from. A user-facing warning is pushed explaining that the bump is NFIP + private-flood average and real quotes depend on elevation and BFE. Cache version bumped `v8 → v10`.
6. `HomeAnalyzeForm.tsx`:
   - `PropertyFacts.floodZone` added to the type + passed through the lookup payload.
   - `"fema-nfhl"` added to `FieldProvenance` union + `SOURCE_LABEL` (`"FEMA NFHL"`). Insurance field already renders its provenance badge so the "FEMA NFHL" chip shows up automatically when the bump fires.
   - `PropertyFactsStrip` renders a colour-coded flood chip (red border for V/VE coastal, amber for inland SFHA, sky-blue for moderate shaded-X). Low-risk Zone X stays hidden — showing "Zone X low risk" on every inland property is visual noise.

**Verified end-to-end** (cold dev server, fresh in-memory cache):
- Miami Beach, 1401 Ocean Dr, FL 33139 → `floodZone: AE` (high risk, SFHA), insurance provenance `fema-nfhl`, `+$1,800/yr` bumped onto the FL state-avg. Total insurance $10,805.
- Boca Raton, 100 E Royal Palm Rd, FL 33486 → `floodZone: X` minimal, insurance unchanged ($11,789 from state-avg). FEMA confirms this parcel is not in an SFHA despite being near the coast — our numbers now reflect that accurately.
- Staten Island, 50 Broadway, NY 10301 → `floodZone: X` minimal, insurance $2,961 from state-avg (no bump).
- Austin + Dunellen → Census geocoder can't match the address format, so we gracefully skip flood lookup (no error, no provenance tag, state-avg stands). Both are inland so the correct bucket anyway.

**Known limits / follow-ups:**
- FEMA's ArcGIS is the only practical free source for authoritative SFHA polygons. Nothing we can do about its 10s cold-start latency short of pre-downloading NFHL (60+ GB nationwide, not practical) or swapping to a paid provider. Mitigated by aggressive caching — any given lat/lng gets queried once per 30 days.
- Census Geocoder misses addresses with abbreviated street suffixes ("Ave H" instead of "AVENUE H"). A future enhancement could normalise suffixes (AVE→AVENUE, ST→STREET, etc.) before the fallback query, or swap to Nominatim/OSM as a second fallback. Not urgent — RentCast already provides lat/lng for most hits and every FL/coastal address we've tested is covered.
- Flood zone isn't surfaced in the `HowWeGotThese` subject card on `/results` yet. The insurance bump flows through URL params so all downstream calcs are correct, but the visual chip only appears on the homepage lookup strip. Low-priority polish — the resolver cache means a second look-up on `/results` would be instant if we decide to wire it.

### 16.K — RentCast Stage 1 cost reduction (8–11 calls → 3–5 per autofill)

**Problem:** the free RentCast tier caps at a few hundred requests/month, and a single property analysis was burning ~8–11 calls at autofill time plus ~2–4 more when `/results` re-fetched comps, for ~25 total on the chat's pessimistic path. At our expected analysis volume the key would exhaust within days. The user explicitly asked for "5 worst case" per autofill, with the explicit caveat "don't screw up the results".

**Audit findings (before any changes):**

| Endpoint | Per-autofill calls | Purpose | Actually used? |
|---|---|---|---|
| `/properties` | 1 | subject facts + lat/lng | Yes (facts, FEMA coords, last-sale anchor) |
| `/avm/rent/long-term` | 1 | rent AVM | **Overwritten** by comp-derived rent in all non-thin cases |
| `/avm/value` | 1 | value AVM | **Overwritten** by comp-derived value in all non-thin cases |
| `/listings/sale` @ 1→3→5→10mi | 1–4 | sale comps | Yes |
| `/listings/rental/long-term` @ 1→3→5→10mi × (strict, drop-baths, drop-beds) | 1–12 | rent comps | Yes but over-laddered |
| Dead `/api/property-lookup` route | 0 currently | legacy AVM wrapper | Dead since Phase 2 migrated to `/api/property-resolve` |

**Fix (four code changes, zero new dependencies):**

1. **`lib/comps.ts` — radius ladder shortened from `[1, 3, 5, 10]` to `[3, 10]`.** RentCast returns up to 20 listings sorted by distance regardless of radius, so a 3mi starting radius returns an identical comp pool to a 1mi radius when a neighborhood is dense, and just skips the extra API call when 1mi wasn't enough on its own. Saves 1–2 calls per analysis, zero behavior change in every urban address we tested.

2. **`lib/comps.ts` — only widen the *short* side at subsequent rungs.** The old loop called `fetchSaleComps` AND `fetchRentComps` at every radius, even if sale was already full at 3mi. The new loop tracks `bestSale` / `bestRent` independently and only re-queries the side that's still under `MIN_COMPS_PER_SIDE=3`. The public `CompsResult.radiusMilesUsed` now reports the widest radius across both sides. Saves 1 call in every thin-rent-only case.

3. **`lib/comps.ts` — rent fallback ladder trimmed from 3 tiers to 2 (+ widest-rung-only cap).** The old chain was `strict → drop-baths → drop-beds`. The `drop-beds` tier was removed because in practice it mixed studios into the rent median when the subject was a 6bd multifamily and made the derived number *worse* than the sparse-comp warning. The remaining `drop-baths` fallback is also suppressed at the 10mi (widest) rung — if a 10bd atypical property returns zero strict rent comps at 10mi, it's not the baths filter's fault, so we stop spending API calls on it and hand off to the manual-entry UX. This is the lever that guarantees worst-case ≤ 5 calls.

4. **`app/api/property-resolve/route.ts` — `/avm/rent/long-term` and `/avm/value` calls removed.** Both were thrown away whenever rent/sale comps existed, which is every non-pathological case. The rare address with zero comps now falls through to Zillow's rentZestimate (if present) or leaves the field blank for manual entry — both already-existing paths with correct provenance and no silent wrong answer. Saves exactly 2 calls per autofill. The `RentcastBundle.purchasePrice` / `.monthlyRent` fields and the `candidates.rentcastMonthlyRent` / `.rentcastPurchasePrice` branches were deleted for good measure.

5. **`app/api/property-resolve/route.ts` — Zillow flow A3 regression fixed.** When the Zillow-URL flow merged RentCast facts into `result.facts`, it was reconstructing the object without `latitude` / `longitude`, which meant FEMA flood lookup silently geocoded via Census (slow, misses abbreviated street suffixes) instead of using RentCast's already-known coordinates. Now the Zillow flow keeps RentCast's lat/lng if the Zillow scraper didn't provide its own.

6. **Dead route deletion: `app/api/property-lookup/` removed entirely.** It hasn't been wired to the UI since Phase 2 and contained a parallel implementation of the AVM calls I was trying to avoid.

7. **`CACHE_VERSION` bumped `v10 → v11`** to invalidate any resolver cache entry that still carries the removed `source: "rentcast"` AVM provenance tag for `purchasePrice` / `monthlyRent`.

8. **`RENTCAST_TRACE=1` env guard** added to `fetchListings` and the resolver's RentCast wrapper. Zero-cost no-op in production; flip to `1` in `.env.local` to log every outbound RentCast URL to stdout during debugging. Keeping this in is how we'll verify future regressions.

**Verified end-to-end** (cold dev server, fresh in-memory caches, RENTCAST_TRACE=1):

| Address | Calls | Autofill result | Flood |
|---|---|---|---|
| 37 Merker Dr, Edison, NJ (4bd/3ba SFR) | **4** | price $738k · rent $5,400 · ins $3,690 | Zone X (low) |
| 1401 Ocean Dr, Miami Beach, FL (condo) | **3** | price $1.12M · rent $3,100 · ins **$18,076** (AE bump) | Zone AE (high) |
| 100 E Royal Palm Rd, Boca Raton, FL (SFR) | **3** | price $665k · rent $3,100 · ins $9,642 | Zone X |
| 50 Broadway, Staten Island, NY (10bd multifamily) | **5** ← target cap | price $897k · rent *null, manual entry* · ins $4,037 | Zone X |
| 2315 Ave H, Austin, TX (SFR) | **3** | price $467k · rent $2,280 · ins $4,904 | n/a (geocoder miss, expected) |

Before Stage 1 the Staten Island pathological case took 8 RentCast calls; it now caps at exactly 5. Typical flows (coastal condo, suburban SFR, anywhere with decent comp density) use 3. Purchase price, rent, and insurance numbers all match the pre-Stage-1 runs to the dollar for every non-thin case — the only behavioural diff is that Staten Island now correctly returns `monthlyRent = null` and asks the user to fill it in, instead of synthesising a bad number from dissimilar dropped-beds listings.

**`/results` page (still re-fetches comps independently):** 2 RentCast calls per render in the typical case (sale + rent at 3mi, same ladder). In a warm Node process the side caches introduced in change #2 mean this is free; in a Vercel cold start the cache resets per lambda. End-to-end worst-case per analysis is therefore ~9 in production today, down from ~25. Dropping that to 5 end-to-end needs either (a) session-storage comp sharing from autofill → `/results`, or (b) Vercel KV for cross-lambda caching. Both are Stage 2+ work — Stage 1 was purely RentCast-call pruning.

**Known limits / follow-ups:**
- Stage 2 (not started): share the autofill-side comp pool with `/results` via sessionStorage or a cookie, so a single analysis caps at 5 RentCast calls end-to-end. The resolver already computes `result.comparables`; we'd need to pass that payload through the redirect (URL is too small; sessionStorage is the obvious vehicle).
- Stage 3 (not started): Vercel KV for the FEMA / FHFA / RentCast caches. Currently every cold lambda re-queries FEMA for the same lat/lng. On Vercel KV free tier (30k reads/day) this is trivial to wire — the bottleneck right now is just that we haven't added the package.
- The side caches added in Stage 1 (`saleSideCache`, `rentSideCache`) live in-process; they help within a single Node/dev process but don't cross serverless invocations. Intentionally not addressed in Stage 1 since it's the same limitation already present everywhere else.

### 16.I — Phase A2 shipped: FHFA metro-level appreciation

**Problem:** `DEFAULT_INPUTS.annualAppreciationPercent = 3` was a blanket. Austin/Boca/NYC are running 6–10%/yr trailing, SF is running ~2%. 10-yr IRR, sale-proceeds, and walk-away math were off by a large margin for anyone not in a 3%-appreciation market. Also fed the last-sale roll-forward anchor in `analyzeComparables` (see §16.E) with the wrong rate, which warped the market-truth band.

**Fix:**
1. New preprocessing script `scripts/build-fhfa-hpi.mjs` (pure Node, no deps). Downloads three sources, composes them, emits two bundled JSON files:
   - FHFA Purchase-Only HPI for the 100 largest MSAs (`hpi_po_metro.txt`, TSV, quarterly).
   - Census 2020 ZCTA→County relationship file (`tab20_zcta520_county20_natl.txt`).
   - NBER CBSA→FIPS county crosswalk (`cbsa2fipsxw_2023.csv`).
   - For each ZCTA we pick the dominant county by `AREALAND_PART`, then map county → CBSA, **preferring the metropolitan division code over the parent MSA code** when one exists (FHFA keys its top-100 series on MSAD for Miami/NYC/DC/LA/Chicago/etc.).
   - Output: `data/fhfa-hpi-metro.json` (9.5 KB, 100 metros) and `data/zip-to-cbsa.json` (104 KB, 10,366 zips). Runtime is pure JSON lookup — no network, no API key.
2. For each metro we compute trailing-5yr and trailing-10yr CAGR from the seasonally-adjusted index. The forward-projection default is **trailing-10yr** (trailing-5yr through 2025 is distorted by the 2020–22 COVID spike; 10yr averages across that cycle and is more defensible). Trailing-5yr is surfaced in the badge tooltip so the user can sanity-check.
3. New `lib/appreciation.ts`:
   - `getMetroAppreciation(zip)` → `{ rate, window, metro, asOf, rate5yr, rate10yr, cbsa } | null`. Returns null for zips outside the FHFA top-100 MSAs (rural, some secondary metros, Puerto Rico); caller falls back to `DEFAULT_INPUTS`.
   - `zipFromAddress(address)` — pulls the trailing 5-digit token from a free-form address. Works on all four reference listings.
   - `metroAppreciationNote(m)` — human-friendly tooltip, e.g. `Austin-Round Rock-San Marcos, TX trailing 10yr CAGR: 6.36%. Trailing 5yr: 4.03%. FHFA Purchase-Only HPI, 2025Q4.`
4. `"fhfa-hpi"` added to `ProvenanceSource` union in `app/api/property-resolve/route.ts`. New helper `applyMetroAppreciation(result)` mutates `inputs.annualAppreciationPercent` + `provenance.annualAppreciationPercent = { source: "fhfa-hpi", confidence: "high", note }` after the canonical address is known but before `resolveFromComparables`. Both entry points (`resolveByAddress` and `resolveByZillowUrl`, including all three Zillow branches) call it. Cache version bumped `v7 → v8`.
5. `resolveFromComparables` now accepts a `MetroAppreciation | null` param and forwards `metro.rate / 100` as `expectedAppreciation` to `analyzeComparables`, so the last-sale anchor rolls forward at the **real** market rate (§16.E) rather than the blanket 3% fallback. When the metro isn't in FHFA's set we leave `expectedAppreciation` undefined and `analyzeComparables` uses its own 3% fallback.
6. `HomeAnalyzeForm.tsx` — `"fhfa-hpi"` added to `FieldProvenance` union + `SOURCE_LABEL` (`"FHFA HPI"`). Appreciation / yr field renders its provenance badge.
7. Homepage trust strip now lists "FHFA HPI (metro appreciation)".

**Verified end-to-end:** `curl /api/property-resolve?address=…` for all four reference listings returns `provenance.annualAppreciationPercent.source === "fhfa-hpi"` with high confidence:
- Austin, TX 78722 → Austin-Round Rock-San Marcos: 6.36%/yr (10yr)
- Boca Raton, FL 33486 → West Palm Beach-Boca Raton-Delray Beach MSAD: 9.06%/yr (10yr)
- Dunellen, NJ 08812 → Lakewood-New Brunswick MSAD: 7.61%/yr (10yr)
- Staten Island, NY 10301 → New York-Jersey City-White Plains MSAD: 6.25%/yr (10yr)
- SF, CA 94110 → SF-San Mateo-Redwood City MSAD: 3.58%/yr (10yr)  ← vastly different from the 3% blanket

**Refresh cadence:** Run `node scripts/build-fhfa-hpi.mjs` after each FHFA quarterly release (Feb/May/Aug/Nov). The script fetches the latest data, regenerates both JSON files, and commits cleanly.

### 16.H — Phase A1 shipped: FRED mortgage rate integration

**Problem:** `DEFAULT_INPUTS.loanInterestRate = 7.0` was hard-coded. Every DSCR, cash flow, CoC, IRR, and offer-ceiling calc was off by whatever the real market rate had moved since we last edited the file. Biggest leverage point in the whole engine.

**Fix:**
1. New `lib/rates.ts` — `getCurrentMortgageRate()` hits FRED's `MORTGAGE30US` series (Freddie Mac PMMS 30-yr fixed). 24h positive cache, 10-min negative cache, 4s timeout, never throws. Returns null on missing key / HTTP error / sentinel `"."` observation. `fredRateNote()` centralises the badge wording.
2. `FRED_API_KEY` added to `.env.local` and §3 above. Free key from https://fred.stlouisfed.org/docs/api/api_key.html.
3. `"fred"` added to `ProvenanceSource` union in `app/api/property-resolve/route.ts`. `enrichWithEstimates` is now async and, on every autofill, overwrites `loanInterestRate` with the live FRED rate (provenance badge: `FRED · high`, tooltip: `Freddie Mac 30-yr fixed (PMMS), week of YYYY-MM-DD. Updated weekly from FRED.`). Cache version bumped `v6 → v7`.
4. `app/page.tsx` is now an async server component that fetches FRED at render time and seeds `HomeAnalyzeForm` with `initialInputs.loanInterestRate` + `initialProvenance.loanInterestRate`. First paint of the homepage already shows the live rate with the badge — no autofill needed. URL-deep-linked loads still respect the user's numbers verbatim (URL query params override FRED seed).
5. `HomeAnalyzeForm.tsx` — `"fred"` added to the source union + `SOURCE_LABEL` (`"FRED"`). `Interest rate` field renders its provenance badge. New optional `initialProvenance` prop lets the server seed badges on first paint.
6. Trust strip on the homepage now lists FRED alongside RentCast/Zillow/OpenAI.
7. `DEFAULT_INPUTS.loanInterestRate = 7.0` stands as an absolute last-resort fallback for the case where FRED is unreachable AND we have no cache. The homepage + resolver replace it in practice.

**Verified end-to-end:** Current FRED reading is 6.3% (week of 2026-04-16). `curl /api/property-resolve?address=...` returns `provenance.loanInterestRate.source === "fred"` with confidence high. Homepage HTML contains `value="6.3"` and `title="Freddie Mac 30-yr fixed (PMMS), week of 2026-04-16…"` on first paint.

**Incidental:** fixed one pre-existing unescaped-apostrophe lint error in `HowWeGotThese.tsx` so `npx eslint app lib --max-warnings 0` stays green.

### 16.G — Things to know about the current build

- Four active terminals running `npm run dev` at various points. Only pid 70607 (terminal `16487.txt`) is actually serving on :3000. Don't start another without killing the stale ones: `pkill -f "next dev" && pkill -f "next-server"`.
- Sandbox blocks `tsx` IPC — ad-hoc verification scripts need `required_permissions: ["all"]` on the shell call.
- The `scripts/` folder is used for ad-hoc verification scripts. Delete them after verification so they don't pollute the build.
- `HowWeGotThese.tsx` is the product's trust moat. Every derivation must have a defensible workLog that a real investor can read and challenge.

---

## 17. Data-source roadmap — start here

**Premise:** the engine is calibrated. The remaining accuracy gap is that our auto-filled defaults (interest rate, appreciation, insurance for flood-prone areas, rent growth) are blanket heuristics. Replacing these with live market data is the single biggest remaining trust lever before launch.

Each item below has: WHY (what it fixes), WHAT (the source), HOW (integration shape), and IMPACT (which calculations improve). Implement in order — dependencies run top-down.

### Phase A — must-have before public launch

These fix the largest defaults-are-fake gaps and make every deal's math grounded.

#### A1. FRED — current 30-year fixed mortgage rate ✅ SHIPPED (see §16.H)

- **WHY.** `DEFAULT_INPUTS.loanInterestRate = 7` is hard-coded. When rates are actually 6.2% or 7.5%, every deal's DSCR, cash flow, CoC, and IRR are computed off the wrong rate. This is the single most leveraged input in the whole product.
- **WHAT.** FRED series `MORTGAGE30US` (Freddie Mac PMMS 30-year fixed). Updated weekly, free API from the St. Louis Fed.
- **HOW.**
  - Env var: `FRED_API_KEY` (free at https://fred.stlouisfed.org/docs/api/api_key.html).
  - New file: `lib/rates.ts` — exports `getCurrentMortgageRate(): Promise<{ rate: number; asOf: string }>`. Cached 24h via `lib/kv-cache.ts` (was `lib/server-cache.ts` before Q7).
  - API: `GET https://api.stlouisfed.org/fred/series/observations?series_id=MORTGAGE30US&limit=1&sort_order=desc&api_key=${FRED_API_KEY}&file_type=json` → `observations[0].value`.
  - Modify `lib/calculations.ts` to remove the hard-coded 7 — DEFAULT_INPUTS should not have a specific rate; instead, the resolver populates `loanInterestRate` from FRED with high confidence.
  - Wire into `app/api/property-resolve/route.ts`: in `enrichWithEstimates`, if `inputs.loanInterestRate` is unset, call `getCurrentMortgageRate()` and set it with `provenance = { source: "fred", confidence: "high", note: "Freddie Mac 30-yr fixed, week of YYYY-MM-DD" }`.
  - Add a "fred" case to the `ProvenanceSource` union + rendering logic (HomeAnalyzeForm badge).
- **IMPACT.** Correct DSCR, cash flow, CoC, IRR, offer ceiling for every deal. Users see "7.12% as of 2026-04-15" badge on the rate field.

#### A2. FHFA House Price Index — metro-level appreciation ✅ SHIPPED (see §16.I)

- **WHY.** `DEFAULT_INPUTS.annualAppreciationPercent = 3` is a blanket. Austin's 5-yr CAGR is ~6%, Memphis's is ~3%, SF's is ~1%. Our 10-yr IRR and sale-proceeds math is off by a large margin for non-average markets. Also feeds directly into the market-anchor `expectedAppreciation` in §16.E.
- **WHAT.** FHFA publishes HPI at state, CBSA (metro), and 5-digit-zip level. Purchase-only index is the right one (distinguishes from refi-bias in the all-transactions index).
- **HOW.**
  - Download the metro-level CSV once and bundle: `https://www.fhfa.gov/HPI_PO_metro.csv` (tiny — few MB).
  - Build a pre-processing script that reads the CSV and writes `data/fhfa-hpi-metro.json` mapping CBSA code → `{ name, trailing5yrCAGR, trailing10yrCAGR, asOf }`. Refresh quarterly (just re-run the script).
  - Need a zip → CBSA lookup. Census Bureau publishes a free ZCTA-to-CBSA relationship file: `https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2020/delineation-files/zctarel2020.txt`. Bundle as `data/zip-to-cbsa.json`.
  - New file: `lib/appreciation.ts` — exports `getMetroAppreciation(zip: string): { rate5yr: number; rate10yr: number; metro: string; asOf: string } | null`.
  - Resolver: extract zip from address, look up CBSA → HPI, set `inputs.annualAppreciationPercent` with `provenance = { source: "fhfa-hpi", confidence: "high", note: "Austin MSA trailing 5-yr CAGR: 6.2%" }`.
  - Also pass the rate through to `analyzeComparables` so the last-sale anchor rolls forward at the right rate.
- **IMPACT.** IRR, total ROI, sale-proceeds, walk-away price all reflect the actual market. Appreciation-rescue flag (§16.A) fires correctly for strong-appreciation markets (Austin/Nashville) and won't misfire for weak markets (Cleveland).

#### A3. FEMA flood zones — insurance reality check ✅ SHIPPED (see §16.J)

- **WHY.** FL/coastal/river-adjacent deals have mandatory flood insurance of $1500–4000+/yr on top of regular homeowners. Our state-average insurance estimator is blind to this. The Boca case subject is likely in a partial flood zone — our $5800/yr state-avg is too low if flood insurance is required.
- **WHAT.** FEMA NFHL (National Flood Hazard Layer) REST service. Free, no key.
- **HOW.**
  - Geocode: extract lat/lng from Zillow `__NEXT_DATA__` (usually present) or from RentCast response. Fallback: Census Geocoder (`https://geocoding.geo.census.gov/geocoder/locations/address?...` — free, no key).
  - API: `GET https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query?geometry=<lng>,<lat>&geometryType=esriGeometryPoint&inSR=4326&outFields=FLD_ZONE,ZONE_SUBTY&f=json&returnGeometry=false`.
  - Response includes `features[0].attributes.FLD_ZONE`: `"X"` = minimal risk, `"AE"/"AH"/"AO"` = 1%-annual-chance (SFHA), `"VE"` = coastal high-velocity.
  - New file: `lib/flood.ts` — exports `getFloodZone(lat, lng): Promise<{ zone: string; highRisk: boolean; label: string } | null>`.
  - Insurance estimator (`lib/estimators.ts`): when `highRisk`, bump annual insurance by state-specific flood-insurance delta (~$1500-2500 typical SFHA, $3000+ VE).
  - UI: display flood zone as a `Fact` in the `HomeAnalyzeForm` property card and in `HowWeGotThese` subject card. Red badge on VE, amber on AE/AH/AO, zinc/hidden on X.
- **IMPACT.** Coastal and riverine deals get realistic insurance. Investors analyzing FL/LA/Carolinas properties don't get burned by flood-insurance sticker shock after they buy.

**Phase A acceptance criteria:** re-run the four existing test cases (Boca, Dunellen, South Amboy, Staten Island) and confirm (a) rate now reflects live FRED rate, (b) appreciation reflects metro-specific HPI, (c) flood zones show up for Boca (very likely SFHA) and adjust its insurance upward. Verdict tiers may shift — that's expected and correct.

### Phase B — strong nice-to-haves

**Status: deferred until after monetisation.** Phase A is shipped (A1 FRED + A2 FHFA HPI + A3 FEMA NFHL). Adding more data sources on an unmonetised, unrate-limited, untested product is investment-grade procrastination — we calibrate revenue before accuracy. Ship after Phase M (Stripe + paid gating) and after Phase Q (see §16.L onward: tests, rate limiting, observability, prod caches). Then revisit B1–B3 based on which derivations users are actually questioning.

#### B1. RentCast market stats (we already pay for this)

- **WHY.** We're underusing RentCast. Their `/markets/{zip}` endpoint returns median rent, median value, rent-to-value ratio, and rent-growth rate at the zipcode level. Would replace blanket 3% rent-growth default and power richer "Subject vs market" context.
- **HOW.** Add a third parallel call in `fetchRentcast` → `/markets/${zip}`. Plumb through to `inputs.rentGrowthPercent` with high confidence. Cache 7 days.
- **IMPACT.** Rent growth assumption grounded in local data, not 3% blanket. Market cap, market GRM, market price-to-rent ratios become defensible.

#### B2. Census ACS — neighborhood demographics

- **WHY.** Context the user actively wants: median household income, renter%, income-to-rent ratio. Answers "will this rent to local demographics?" and "how vulnerable is this to a downturn?" Also a signal for house-hack viability later.
- **WHAT.** Census ACS 5-year estimates API at zip level. Free, no key.
- **HOW.** Pull median HH income, renter-occupied-%, median gross rent. Display in a "Neighborhood context" card on the `/results` page's Numbers tab.
- **IMPACT.** Richer context. No direct calculation impact.

#### B3. Zillow ZORI / BLS rent CPI — metro rent growth

- **WHY.** Cross-check on B1. If RentCast market stats are missing a zip, fall back to metro-level rent growth from BLS or ZORI.
- **WHAT.** BLS CPI "Rent of primary residence" by metro, or ZORI from Zillow research data (publicly downloadable CSV).
- **HOW.** Bundle the CSV, zip-to-metro lookup (same as A2), similar pipeline.

### Phase C — pricing drivers

#### C1. GreatSchools API

- **WHY.** School rating is the #1 pricing driver for 3+ bed SFR/townhouse in family markets. A great-school zone can add 15-25% to rent and value; a bad one subtracts that much.
- **WHAT.** GreatSchools API. Paid (small monthly fee). Returns school ratings at address.
- **HOW.** Fetch top-3 nearest schools + their ratings, display in a "Schools" fact card. Factor into rent estimation via a `qualityBand` multiplier.

#### C2. Walk Score

- **WHY.** Walkable urban rentals command a measurable rent premium. Suburban single-family is less sensitive.
- **WHAT.** Walk Score API. Free tier 5k calls/month, then paid.
- **HOW.** Pull walk/transit/bike scores, display in property-facts card.

#### C3. First Street Foundation — climate risk

- **WHY.** Long-horizon deals (10+ yr holds) need climate risk factored. First Street gives 30-year property-level flood/fire/heat projections. More predictive than static FEMA.
- **WHAT.** First Street Foundation API. Limited free tier.
- **HOW.** Pull `riskFactor` and climate projections, flag high-risk properties in the workLog.

### Phase D — gold standard (hard / expensive)

- **D1. MLS/IDX.** Real sold-comp data. Usually requires broker partnership. Massive upgrade to sale-comp quality. Post-revenue.
- **D2. Insurance quote APIs.** Actual quotes (Lemonade, Hippo where available) beat state averages. Likely requires broker relationships.
- **D3. County assessor bulk data.** Millage rates, reassessment triggers — critical for projecting post-purchase tax changes. Free but state-specific scraping.

### Integration checklist (for every new data source)

1. Add env var to `.env.local` and document in §3 of this handoff.
2. Create `lib/<source>.ts` with `KVCache`-backed fetcher (from `lib/kv-cache.ts`). Graceful degradation when key missing.
3. Extend `ProvenanceSource` union in `app/api/property-resolve/route.ts`.
4. Wire into resolver (GET and POST paths).
5. Update `HomeAnalyzeForm.tsx` provenance badge rendering.
6. Update `HowWeGotThese.tsx` if the data informs a derivation.
7. Run `npx tsc --noEmit` and `npx eslint app lib --max-warnings 0`.
8. Test on all four reference listings (Boca Raton, Dunellen, South Amboy, Staten Island).
9. Update this handoff's §16 with a brief note on what shipped.

---

## 18. Reference test listings

When verifying any change, re-run these four. They exercise the different failure modes:

1. **1121 NW 13th St #3, Boca Raton, FL 33486** — condo-style townhouse with high HOA. Tests HOA override + market anchors. Should land AVOID with $390k fair value.
2. **241 Orange St, Dunellen, NJ 08812** — multi-family in appreciation market with weak year-1 cash flow. Tests appreciation-rescue rubric. Should land BORDERLINE or GOOD (not AVOID).
3. **209 S Stevens Ave, South Amboy, NJ 08879** — 2,216 sqft multi-family. Tests dedupe-by-building + submultiplicative rent scaling. Should produce rent that doesn't extrapolate linearly from small-condo comps.
4. **A Staten Island listing** (user-provided in prior chats) — tests the original "lazy warnings" regression didn't return.

If any of these regresses, STOP — don't proceed with new data sources until the regression is understood and fixed.
