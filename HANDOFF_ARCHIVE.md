# RealVerdictROI — HANDOFF archive (snapshot: 2026-04-22)

> **This file is a full-history archive**, not the active handoff.
>
> The active handoff lives in `HANDOFF.md` at the repo root. That file is
> deliberately kept short — current state, current architecture, what's
> pending. This archive contains the full accumulated context that got us
> here: every shipped fix (§16 A–U), the data-source roadmap (§17), the
> strategy-reset working list (§19), and the pre-ship strategic reasoning
> behind the Pack / pricing / architecture changes (§20 rationale
> subsections).
>
> **When to read this file:**
> - You need to understand why a past decision was made and the active
>   HANDOFF doesn't explain it.
> - You're auditing whether a prior bug was fixed (grep for the symptom).
> - You want the historical unit-economics math that justified the $29
>   price or the `defer-comp-pulls` architecture pivot.
>
> **When NOT to read this file:** for routine changes. The active
> HANDOFF has the current repo shape, the current component map, the
> current pending list. Start there.
>
> Frozen state at snapshot time: 169 tests pass; tsc + eslint + next build
> all clean; Pack + Comp Reasoning shipped; $29 reprice live; §20.8
> architecture live; walk-away market-value cap live; Pack-first homepage
> + pricing live.
>
> **Addendum (2026-05-01):** The live product emphasis shifted to an
> **Electron-first desktop** shell (`electron-app/`) loading the same
> Next app from Vercel. Primary authenticated UX: **Browse** (`/research`,
> embedded listing browser + `DossierPanel`), **Pipeline** (`/deals`,
> saved deals table/cards + same panel), **Settings**. Two UI polish
> passes landed (tokens in `app/globals.css`, `lib/severity.ts`,
> `DossierPanel.tsx`, `DealsClient.tsx`, sidebar default collapsed).
> **Bundling the renderer as static HTML inside Electron** was evaluated
> and **deferred** (server/auth/AI deps). See **HANDOFF.md §1 + §1b** and
> **REALVERDICT_CONTEXT.md** for the authoritative current-state summary;
> the body below remains a **historical** snapshot from 2026-04-22.

---

# RealVerdictROI — Project Handoff (historical preamble)

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

**Next chat's starting prompt (recommended):** "Phase M shipped + Wave 1 credibility/conversion fixes shipped — read §16.S first, then continue Wave 1 P0 items still requiring operator action (auth flow, custom domain, annual plan, legal pages)."

### 16.S — Phase M shipped + Wave 1 (credibility / conversion floor)

This entry covers two layers of work shipped in the most recent session:
**Phase M (Stripe + paid gating)** and **Wave 1** (positioning fixes + table-stakes infrastructure for a real launch).

#### Phase M — Stripe checkout + paid gating (deployed to prod, test mode)

- **`supabase/migrations/003_subscriptions.sql`** — `subscriptions(user_id PK, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end, cancel_at_period_end, updated_at)` with RLS (owner-only SELECT, all writes via service-role from the webhook).
- **`lib/pro.ts`** — `getProStatus(userId)` (memoized via `React.cache`) and `isPro(user)`. Source of truth: `subscriptions.status IN ('active','trialing')` with non-expired `current_period_end`.
- **`lib/stripe.ts`** — `getStripe()` singleton + `appBaseUrl()` helper.
- **`lib/supabase/service.ts`** — `createServiceRoleClient()` for webhook + portal route. Bypasses RLS.
- **`/api/stripe/checkout`** — POST. Signed-in users only. Creates a `subscription` checkout session with `client_reference_id = user.id`. Rate-limited via new `stripe-checkout` limiter.
- **`/api/stripe/webhook`** — POST. Verifies signature, handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Wrapped in `withErrorReporting`. Reads `current_period_end` from `SubscriptionItem` first (Stripe API ≥2025-08-27 moved it there), falls back to `Subscription` for older fixtures.
- **`/api/stripe/portal`** — POST. Looks up `stripe_customer_id` for the signed-in user via service-role client, mints a Billing Portal session, 303-redirects. Reuses `stripe-checkout` limiter.
- **Free-tier limits** (added to `lib/ratelimit.ts`): `analysis-free-anon` (5/week), `analysis-free-user` (3/week), `stripe-webhook`, `stripe-checkout`. Enforced in `app/results/page.tsx` for non-Pro users — exceeding it renders `AnalysisQuotaExceeded` (countdown + upgrade CTA).
- **Pro gating, client + server**:
  - Comps tab on `/results` — Pro only; non-Pro see `ProCompsTeaser`.
  - Save Deal — Pro only; client button redirects to `/pricing`, server `/api/deals/save` returns 402 `pro_required`.
  - `/compare` remote sync — Pro only; non-Pro retain `localStorage` only. Server `/api/compare` returns 402 for non-Pro.
- **`lib/observability.ts`** — `captureError` rewritten to extract messages and fields (`code`, `details`, `hint`, `status`) from any object shape, not just `Error`. Fixes the `"[object Object]"` Sentry events from Supabase `PostgrestError` and Stripe error objects.
- **`/dashboard`** now shows a Plan badge (Pro · status / Free · upgrade), a "Manage billing" form-POST in the header for Pro users, and a `?checkout=success` welcome banner.

#### Wave 1 — Credibility + conversion floor (shipped this session)

The Phase M code shipped paid functionality, but the surface around it still read like an unfinished side project. Wave 1 closes that gap:

- **Homepage rewritten** — dropped the "Early beta · built by one person · free while we're finding fit" badge. New H1: *"Know the max price this deal still works at."* Subhead leads with the walk-away angle: "walk into negotiations with a number, not a feeling." Bottom CTA replaced the "looking for 10 investors" beta-hunt with a real Pro upgrade pitch + methodology link. Footer gained Methodology / About / Pricing / Compare links.
- **Pricing page reconciled with reality** — removed false claims ("AI advisor", "Address auto-fill", "PDF export" were listed as Pro features but are actually free / don't exist). New Free list correctly enumerates: 5/week limit, all metrics, walk-away ceiling, stress test, what-if sliders, auto-fill, AI advisor, share links. New Pro list is honest and tight: "Everything in Free with no weekly limit", live comps tab, saved portfolio, cross-device compare sync, 7-day refund. FAQ expanded with what-counts-as-an-analysis, what's-actually-different-in-Pro, and data-source attribution.
- **`/about` page** — anti-hype positioning. Section headers: "Most rental analyzers tell you what you want to hear" → "We built RealVerdict because we kept watching that happen" → "What's different here" (live data, walk-away price, stress tests, no vague verdicts) → "What we're not" (no brokerage, no course, no Discord-mastermind, no lender referral kickbacks).
- **`/methodology` page** — `Methodology · How RealVerdict scores a deal`. Six sections: source table for every input, exact formulas (NOI / cap / cash flow / DSCR / CoC / break-even / IRR), tier scoring table (75-100 STRONG BUY through 0-14 AVOID), walk-away binary search, stress test list, comps logic, "what we don't do (yet)". This is the SEO + trust anchor.
- **`/results` hero restructured** — address now displayed as a prominent line *above* the verdict tier label (was previously a small inline pipe-separated string below). Subject identity is anchored above the answer.
- **`/dashboard`** — Manage Billing form POST + Plan badge + welcome banner (see Phase M list above; shipped together).
- **`app/sitemap.ts` + `app/robots.ts`** — indexable: `/`, `/pricing`, `/methodology`, `/about`. Disallowed: `/results` (per-deal URLs are crawl waste, not content), `/api/`, `/dashboard`, `/compare`. Reads `NEXT_PUBLIC_SITE_URL` → `NEXT_PUBLIC_APP_URL` → `VERCEL_URL` in that order.
- **Quality gates green** — `npm run check`: tsc clean, eslint clean, **101/101 vitest pass**. (One stale empty `node_modules/@types/cheerio` directory was deleted; cheerio was removed in Q1 but a leftover dir was tripping `tsc`'s automatic-types include.)

#### What still needs operator action (Wave 1 P0 follow-ups)

Code-side Wave 1 is done. These items can't be solved by editing files:

1. **Auth signup friction** — Supabase free-tier email confirmations are slow / spam-bucketed. Pick one: (a) disable email confirmation in Supabase dashboard (`Authentication → Providers → Email → Confirm email OFF`) for now, or (b) wire up Google OAuth (Google Cloud project + Supabase Provider config). Until this is fixed, anonymous traffic that wants to upgrade hits a wall.
2. **Production URL env** — canonical domain is **realverdict.app** (hardcoded as Electron default; Vercel should set `NEXT_PUBLIC_SITE_URL` + `NEXT_PUBLIC_APP_URL` to `https://realverdict.app`). Update Supabase auth redirect URLs and Stripe webhook if still pointed at an old `*.vercel.app` host.
3. **Annual plan** — create a yearly recurring price in Stripe (suggest $190/yr ≈ "2 months free"), expose as a second `STRIPE_PRICE_ID_PRO_ANNUAL` env var, add a monthly/annual toggle on `/pricing`.
4. **Legal pages** — Privacy Policy + Terms of Service. Stripe will eventually require them. Skip a generic boilerplate; use Termly or a lawyer.
5. **Apply migration 003** — `supabase/migrations/003_subscriptions.sql` must be run in the Supabase SQL editor (in addition to 001 and 002 from Q6) before Pro gating works in prod.

#### Next chat starting prompt — SUPERSEDED

The original Wave 1 follow-on prompt (build bulk import) was overwritten by §16.T below.
Read §16.T first.


### 16.T — STRATEGY RESET: stop building, start auditing

**Date:** end of the same session that shipped §16.S (Phase M + Wave 1). The user paused execution to step back and challenge the product's actual moat and accuracy. **No code was changed in this entry — it documents a decision, not a ship.**

#### What the user said, in their own framing

1. "Lets actually take a step back and look at the actual product we are selling, how it can beat the competition and stand out and be a really powerful tool doing something better or that nobody's doing that people would actually pay for."
2. "Our product isn't actually ready yet as the analysis and all that still has major problems so we will have to work through those."
3. "I could send you the Zillow page, RealVerdict dashboard, and results page and you can rethink and go over how you actually go about taking in all the data that you do and not only giving accurate results but also utilizing that data in the best way to get across to the user."
4. The user agreed to swap to a fresh agent for the audit/strategy session, and to bring back the Chrome extension idea (originally Phase 5 distribution) into scope as potentially the actual product surface.

#### Honest read on where the product stands

Wave 1 made the *surface* presentable. The product underneath is still a slightly-better DealCheck, not something defensibly different. Specifically:

- **Differentiation today is thin.** The walk-away price is novel. The rubric is tighter than competitors. Both are real but neither is enough — the rest of the surface (Numbers / Stress / What-if / Rubric / Comps tabs) is generic-calculator UX. An active investor paying $35/mo for DealCheck has no compelling reason to switch.
- **Analysis quality is unverified.** The user states it has "major problems" but we haven't enumerated them. Until we audit on real listings the user has opinions about, every positioning conversation is downstream of a foundation we don't trust.
- **We have no validated buyer.** Phase Q + Phase M shipped on the assumption that real investors would convert at $19/mo. Zero conversions to date. The pricing thesis is unfalsified.
- **The Chrome extension was deferred too aggressively.** It was filed as Phase 5 "after launch" distribution. If the new positioning becomes "negotiation weapon for active buyers," the extension may be the actual product surface — the verdict overlays Zillow, where buyers already live, instead of being a tab they have to remember to visit. This needs to be weighed seriously, not buried.

#### Ideas that came out of the strategic conversation (not committed to)

These are candidate product bets for the new agent to weigh against each other. None are decided:

1. **The Negotiation Pack** — every verdict generates a ready-to-send PDF/email: walk-away price + comp evidence + 3 weakest assumptions in the listing pro forma + stress scenarios that break it. Investor forwards to seller's agent as counteroffer rationale. *Nobody is doing this.*
2. **Bulk pipeline triage** — paste 20 Zillow URLs, get 20 sortable verdicts. Real investors look at 30–100 listings/week and need to kill 95% in seconds.
3. **Listing-quality intelligence** — auto-flag DOM anomalies, recent price drops, suspicious photos, agent-remarks weasel-words ("as-is," "investor special"), comp-mismatch on bed/bath count. Reading the listing like a 10-year pro, automated.
4. **Comp reasoning explainer** — not just "5 comps, median $385k" but *why* these 5, where they disagree, what the implied range is with a confidence interval.
5. **Live deal alerts** — "watch 78745, alert me on STRONG BUYs." Sticky recurring-revenue play.
6. **Chrome / browser extension** — verdict overlay on Zillow itself. Zero-friction. Free distribution channel via Chrome Web Store. Could be the actual product, not a feature.

The combo I'd argue most strongly for in the next session: **#6 (extension) + #1 (negotiation pack)** — meet buyers where they shop, then arm them with the offer rationale. Pitch becomes *"DealCheck calculates. RealVerdict closes."*

#### Diagnostic questions the new agent must answer before recommending a build

The user offered to send screenshots / URLs of (a) a real Zillow listing they have an opinion on, (b) the RealVerdict /results page for that same listing, (c) their dashboard. The new agent should ask for those *first* and use them to answer:

1. **Are rent estimates off?** RentCast tends to overshoot in B/C neighborhoods, undershoot in A.
2. **Are property tax estimates off?** RentCast assessor data is patchy; state-level fallback can be wildly wrong (TX effective rate varies 1.5%–3.5% by school district).
3. **Is the verdict tier wrong on real deals?** Are STRONG BUYs the user would pass on showing up? Are deals they'd grab marked PASS?
4. **Are comps catching the wrong properties?** 1-mile radius is too tight rural / too loose urban; bed/bath matching breaks on duplexes/condos.
5. **Is the walk-away price unrealistic?** Showing $-$200k offers, or showing prices indistinguishable from list?
6. **Is autofill missing critical inputs?** HOA, last-sale, year built, sqft are the usual culprits.
7. **What killer info is on the page in raw form but isn't being used?** E.g. the listing has DOM data, photo count, price history, school ratings — what are we ignoring?

#### Operator items still open from §16.S (not invalidated)

These remain real and unfinished:
1. Confirm **realverdict.app** is live in DNS/Vercel and dashboards (Supabase redirects, Stripe) match — the codebase assumes this host, not `*.vercel.app`
2. Annual plan in Stripe ($190/yr ≈ "2 months free")
3. Privacy + Terms (use Termly, not boilerplate)
4. Stripe live-mode switch (only after the above)

The user has done: applied migration 003, disabled Supabase email confirmation, committed + pushed Wave 1.

#### Next chat starting prompt — USE THIS ONE

```
Read §16.T first, then §16.S, then §19.

We are NOT building features in this session. The plan is:

1. Audit analysis quality on real Zillow listings I'll send you. Tell me
   what's wrong, with specifics. Use the diagnostic questions in §16.T.

2. Based on that audit + the candidate bets in §16.T, propose a sharpened
   product positioning. Be willing to recommend killing features we built.

3. Recommend the single next product bet — argue for one of: the negotiation
   pack, bulk triage, listing-quality intelligence, comp reasoning explainer,
   live deal alerts, or the Chrome extension. The Chrome extension is back
   on the table — weigh it as a potential product surface, not just a
   distribution channel.

4. Write your conclusions into HANDOFF.md as §16.U + §20 so we have a
   permanent record before any code is written.

Switch to plan mode (read-only) until I explicitly ask you to write code.
Ask me for the Zillow URLs and screenshots before doing anything else.
```


### 16.U — Audit findings from the strategy-reset session (2026-04-22)

This entry documents the audit the user asked for in §16.T. Session covered: listing #1 only (14215 Hawk Stream Cv, Hoagland, IN 46745, $299,900, 3bd/2ba/1,637 sqft, detached SFR despite Zillow label), discovery + mid-session remediation of a production RentCast outage, and the positioning reset locked into §20 below. Listings #2 and #3 were not audited this session — strategic direction was locked on the grounds that the findings here were strong enough to ground positioning, and the engine-level bugs will reappear on any listing.

#### P0 discovered and fixed mid-session — RentCast API key invalid in production

The Comps tab on the Hoagland listing showed *"Only 0 sale comp(s) and 0 rent comp(s) within 10mi"* and the footer carried the literal string **"Invalid RentCast API key"** twice (once per side). Implications:

- Every analysis running in prod for some unknown duration was operating with **zero comp data**. The entire §16.C/D/E comp-scoring stack (DOM penalty, dedupe-by-building, HOA-aware property-type override, market anchors, sold-preferred filter) was dead code — none of it runs without a comp pool.
- Monthly rent fell through to Zillow Rent Zestimate; sale-price anchor defaulted to list price with no comp-derived cross-check.
- The product's entire data-moat narrative (*"live comps, walk-away price, market-anchored value"*) was fiction in prod. The surface looked fine — the analysis was DealCheck-quality running on Zillow data.
- §16.K Stage 1's 8→11 → 3→5 call reduction was moot — every call was failing 401 before it ever counted against any quota.

Remediation this session:
- User updated `RENTCAST_API_KEY` in Vercel (Production + Preview + Development scopes) and in `.env.local`.
- User triggered a fresh prod build via `git commit --allow-empty -m "..." && git push`.
- Verification: a fresh Hoagland-area analysis returned 12 sale comps (median $276,450) + 3 rent comps (median $1,550). RentCast is live.

**Root-cause forensics not done** — filed in §20.9 as mandatory follow-up:
- How long the key was invalid (Sentry should know; we never checked).
- Why Sentry/Upstash/Vercel logs didn't raise the 401s to the surface. Either `@sentry/nextjs` isn't initialized in prod (check `SENTRY_DSN`), or our `captureError` call path on RentCast 401 is swallowing them.
- No runbook exists for RentCast key rotation. Add one.

#### Priority-ordered findings from listing #1

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **Property type "Condo" is wrong** on a detached SFR with $29/mo HOA. Zillow's `HomeTypeCategoryEnum` mislabels HOA-lite suburbs as condos. Once `inferSubjectCategory` (§16.E) reads `condo-apt`, every real-SFR peer receives the SFR↔condo-apt penalty (−50), filtering the comp pool away from correct peers. Bed/bath/sqft/HOA signals should trump Zillow's category field when they disagree. | P1 engine | `inferSubjectCategory` in `lib/comparables.ts` + resolver category pass-through |
| 2 | **State detection failed on `Hoagland, IN 46745`**. The 2-letter `IN` token is in the address. Insurance still fell to the 0.5%-of-value national fallback. The banner told the user to "add a state in the address" when the state was already there. Suspected: the Zillow-URL flow normalizes addresses differently than direct-address flow and loses the state token before `detectStateFromAddress` runs. | P1 engine | `lib/estimators.ts` detectStateFromAddress + resolver Zillow flow |
| 3 | **Property tax $2,369/yr is the owner-occupant homesteaded rate** (0.79% effective on $299,900 = IN 1% homestead cap). An investor loses homestead and gets the 2% non-homestead cap post-purchase → real tax ~$5,500–6,000/yr → $250–300/mo additional expense → CF drops from −$348/mo to ~−$600/mo. This bug affects every state with a homestead exemption (IN, FL, TX, CA, GA, etc.) — distorts verdicts on the majority of U.S. investment properties. Expected fix: when resolver concludes property will be a rental (no homestead assumption by the investor), substitute state × non-homestead cap, do not propagate the current-owner assessor line-item. | **P1 engine — highest impact** | Resolver tax-rate path + RentCast assessor pass-through |
| 4 | **Internal error text leaked to user UI**. "invalid RentCast API key" appeared verbatim in the autofill summary line. Even after the key is fixed, the pattern (raw API errors in user-facing copy) is a trust killer — must never happen again, especially once Packs become forwardable. | P1 copy | `HomeAnalyzeForm` autofill summary rendering |
| 5 | **"Reality Check" card contradicts the engine's own derivation.** Card says rent is *"41% above median ($1,550/mo)"* while the engine is simultaneously projecting $2,190 for the subject. The engine uses §16.D's sub-multiplicative sqft scaling on comps that are all smaller than subject; the card uses raw median. Page presents two different truths about the same comp pool. | P1 presentation | `/results` Reality Check card + `analyzeComparables` |
| 6 | **"Reality Check" sale-side "6% below median" is not sqft-normalized.** Subject 1,637 sqft at $259,900 = $159/sqft vs comp median ~1,900 sqft at $276,450 = $145/sqft. Subject is ~9% *more expensive* per foot, not cheaper. The headline is leading investors to the wrong conclusion. | P1 presentation | Reality Check card |
| 7 | **"Sells 10% below today" stress row shows unchanged year-1 metrics** (CF/DSCR/cap). Year-1 operations don't depend on exit price — row is dead information. Either drop, reframe as "forced sale year 1," or swap display columns to exit-sensitive metrics (IRR, total ROI, net proceeds). | P2 | Stress test tab |
| 8 | **Cross-tab numeric inconsistencies**. Break-even 114% (Numbers) vs 113.61% (What-if). "Total return $120,718" (Numbers, dollar amount) vs "Total ROI 111.57%" (What-if, ratio) — different metrics with similar labels. Interest rate slider default 6% vs FRED rate 6.3%. Individually trivial, collectively corrosive. | P2 | Results tabs |
| 9 | **FHFA appreciation silently defaults to 3% blanket** for Fort Wayne (outside FHFA top-100 MSA set). No badge disclosing the fallback. Fort Wayne's real ~5–5.5% 10yr HPI CAGR would nudge IRR across the §16.A 8% rescue threshold on some deals. | P2 silent gap | `lib/appreciation.ts` coverage + UI badge |
| 10 | **Rent growth 2.5% shown on form; ~3.0% implied** by year-by-year table ($22,494 Y1 → $29,310 Y10 = 3.00% CAGR). Either the form input is ignored or another input bleeds into the rent projection. | P3 | Results projection math |
| 11 | **"National average" insurance banner** reads as a product bug even when state detection works — phrasing *"Add a state in the address for a tighter estimate"* invites the user to doubt their own input. | P2 copy | Banner text |
| 12 | **Walk-away card's "Target offer = PASS" framing is honest, not a pitch.** On listings where only PASS clears the realistic 15% band, the card correctly says so. But "the most you can pay while we still say don't buy" is an anti-sale, not a negotiation number. The product's headline promise (walk-away price as negotiation lever) inverts on these listings. Not a bug — a copy and framing problem. Better: when no tier better than PASS is realistic, the card should lead with the Negotiation Pack's "three reasons this deal doesn't work" summary instead of a PASS-tier offer number. | P2 framing | `OfferCeilingCard` + (future) Negotiation Pack |

#### What is correct and defensible on listing #1

- Address parse clean; autofill ran end-to-end.
- Base calc engine (NOI, CF, DSCR, cap, CoC, IRR) is internally consistent with its inputs.
- Verdict tier **AVOID** is defensible given the rubric: IRR 6.9% misses the 8% appreciation-rescue threshold (§16.A), so year-1 CF penalties apply fully. When fixes #1-3 land, the deal gets worse, not better — AVOID likely stands.
- HOA $29/mo, insurance ~$1,500/yr are roughly right ballpark for IN (despite how insurance arrived there).
- FEMA flood correctly silent (Zone X, no bump expected).
- Running totals on "Cash to close" and "Year-by-year projection" tie out to the inputs they're fed.

#### The single most important positive signal

The **"Reality Check"** card on the Comps tab. Two lines, one opinion per side:

> *"Your purchase price is 6% below the median nearby sale ($276,450).*
> *Your rent assumption is 41% above the median nearby rental ($1,550/mo). Verify with at least 3 comps before banking on it."*

Despite findings #5–#6, that card does in two lines what DealCheck takes seven tabs to pretend to do. It's the product's strongest UX artifact and the instinct this product is built around. §20 doubles down on this opinion layer as the positioning.

#### Remaining audit work

Listings #2 (the BUY you'd actually make) and #3 (edge case) were not audited in this session. Strategy was locked on the grounds that:
1. The RentCast outage + Reality Check findings were sufficient to shape positioning.
2. Findings #1–#3 are engine-level bugs that will reappear on any listing; another audit confirming them adds no new information.
3. Locking now unblocks the build wave earlier; listings #2-3 can refine the fix list without overturning positioning.

**Listing #2 audited 2026-04-22 — see §16.U.1 below.** Listing #3 still pending. The §20 revisit trigger remains: if listing #3 surfaces the product labelling a BUY as AVOID for reasons the user rejects, **§20 must be revisited before any code ships** — that outcome would mean the opinion layer is miscalibrated and can't carry the pitch.

### 16.U.1 — Listing #2 audit: 105 11th Ave W, Polson, MT 59860 (2026-04-22)

**Subject:** 2bd/1ba, 1,632 sqft, built 1968, no HOA. List $315,000. Inputs used: 20% down, 6% rate (FRED-seeded), 30yr, $5k rehab, 5% vacancy, 5% maint, 8% PM, 5% CapEx. Modeled rent $2,000/mo (matches the 3-comp rent pool median).

**Product output:** **PASS**, CF -$275/mo, CoC -4.3%, DSCR 0.82, IRR 8.0%, equity multiple 2.28x, total return $139k over 10yr. Walk-away card: max offer $315,000 for PASS, $0 of room above asking, $57,500 off (18.3%) needed to push to BORDERLINE.

**Comp pool:** 12 sale comps median $339,950 (raw) / $258/sqft → $420k normalized to subject's 1,632 sqft → 33% disagreement with anchors → §16.E blend 35/65 → $352k blended fair value. 3 rent comps median $2,000/mo (only 3 with bed-match, 2 are near-duplicates of the same Claffey Dr building).

#### Target-demographic verdict — taking the active-investor seat

**Hard PASS, matching the product.** A serious rental investor with 5–10 properties looking at this would pass for these specific reasons:

1. **0.63% rent/price ratio** is a structural failure of the 1% rule, not a near-miss. Even in HCOL markets, active investors find 0.8–1.0% deals. Below 0.65% you are not buying cash flow — you are speculating on appreciation.
2. **Seven straight years of negative cash flow.** The Y1–Y10 projection in the PDF shows the deal does not turn cash-positive until Y8 (+$254). That is roughly $12,000 of out-of-pocket checks across 7 years on a $77k initial investment — 15% of capital eaten by bleed before the first dollar of cash flow.
3. **2bd/1ba is the wrong unit profile for SFR rental.** 3bd/2ba is the minimum viable family-rental floor. A 2/1 in a town of ~5,000 has a thin tenant pool — the product's modeled 5% vacancy is optimistic in a market where one re-rent cycle takes 2–3 months.
4. **A 1968 home with 5% CapEx reserves is underbudgeted.** Roof, HVAC, electrical, windows on a 58-year-old home: realistic reserves are 8–12%. Adjust that alone and CF drops from -$275 to -$400+, which breaks the IRR-rescue threshold.
5. **The PASS verdict hinges on IRR landing exactly at 8.0%** — the §16.A appreciation-rescue cliff. If real Lake County MT appreciation is 2% instead of 3%, IRR drops below 8%, rescue does not fire, verdict flips to AVOID. **The deal's tier is determined by an unknown the product itself estimated with a blanket — the least-confident kind of PASS.**
6. **$0 of negotiation room above asking.** A good deal has a 10–20% cushion between list and walk-away. This has zero. Any small surprise (tax reassessment, $5k roof patch, one extra month of vacancy) loses money.

**Counter-arguments considered and rejected:** Flathead Lake appreciation tailwind exists but applies to lake-frontage, not in-town 1968 workforce homes. Land value will appreciate but does not pay a mortgage. MT no-state-income-tax helps paper returns but not enough to flip the deal.

**This is the calibration point §16.U.0 was missing.** The product's PASS verdict on a deal a target-demographic investor would also pass on confirms the opinion layer is directionally correct on a second independent listing. **§20 positioning survives calibration.**

#### Confirmed bugs from listing #1 (still live, now two-listing-confirmed)

| # | Finding | Status |
|---|---|---|
| 1 | **Reality Check sqft-normalization broken.** Card on the Comps tab says *"purchase price is 7% below median nearby sale ($339,950)"*. Engine's own derivation (PDF "How we got these numbers") computes *"median sale $258/sqft × subject 1,632 sqft = $420,000, 33% disagreement with anchors → blend 35/65 → $352,000."* Reality Check uses raw median, engine uses normalized + anchor-blended value. Two truths on the same page. | Two-listing-confirmed P1 — fix is unambiguous before Pack |
| 2 | **FHFA appreciation blanket silently applying** to Lake County MT (Polson is outside FHFA top-100 metros). Trailing Lake County HPI runs ~5–7%/yr; product is using 3% blanket. Deal's PASS-vs-AVOID verdict literally hinges on this assumption. | Two-listing-confirmed P1 |
| 3 | **Stress-test row "Sells 10% below today" flips verdict from PASS → AVOID** with identical CF (-$275), DSCR (0.82), and Cap (4.63%) displayed in the table. The flip is driven by IRR dropping below 8.0%, but IRR is not in the stress columns — user has zero way to see why the verdict changed. | **Upgraded P2 → P1 credibility.** An unexplained verdict flip is worse than a dead row. |

#### New findings from listing #2

| # | Finding | Severity |
|---|---|---|
| 4 | **`dedupeByBuilding` (§16.D) fails on near-duplicate addresses.** Rent pool has `150 Claffey Dr Unit Gdn` and `150 2 Claffey Dr Unit Gdn` treated as distinct comps — almost certainly the same unit listed twice (digit/whitespace variation defeats the building-key normalization). With only 3 comps in the pool, two collapsing to one drops median rent from $2,000 to $1,675 and would flip Reality Check from green ("in line") to amber (19% above). **Silently inflates rent medians in any thin market.** | **P1 engine** |
| 5 | **Comp scoring lacks a $/sqft outlier filter.** Sale pool includes `39245 Bishop Lndg` at $1.35M / 1,359 sqft = **$993/sqft** (almost certainly Flathead Lake waterfront), `904 4th St E` at $363/sqft, and `12 Country Club Dr Unit 7` at $451/sqft, alongside in-town 1968 workforce comps at $200–250/sqft. Type/bed/bath/distance scoring does not catch this — a lake-frontage SFR is formally "the same" as a 1968 in-town SFR by those attributes. The outliers dragged the $/sqft median to $258 and produced the $420k subject valuation that the engine then had to anchor-rescue down to $352k. **Needs a $/sqft z-score filter (drop comps >2σ from pool mean) before the median is taken.** | **P1 engine** |
| 6 | **Walk-away card copy "Good setup" contradicts "$0 of room above asking."** Current text: *"Max offer: $315,000 for PASS. You have $0 of room above asking before this slips below PASS. Good setup."* Zero room means tightrope, not a good setup — the deal is at the PASS ceiling, not comfortably within it. Pack-ready rewrite: *"$0 of negotiation room at current list. The deal clears PASS at asking but every stress scenario turns it to AVOID. A credible counteroffer starts at $257,500 — 18% under list."* | **P2 copy** — illustrative of why the Pack is the right next product (current copy is tone-deaf to what the numbers say) |
| 7 | **"Watch out for: One extra month of vacancy costs $2,000, wiping out 0 months of current cash flow."** Same garbled template as listing #1's Flash Point. When current CF is negative, the "wiping out N months" math produces 0 or negative, and the template renders the literal string *"0 months."* Needs a negative-CF special case. | **P2 copy** |

#### What's working well on listing #2 — amplify these in the Pack

- **Subject vs market GRM widget** in the PDF: *"PRICE / ANNUAL RENT (GRM) 13.1× — Market ~14.2×"*. The cleanest per-market-benchmarked opinion in the entire product. This is the same DNA as the Reality Check card — a single number with a market reference, no abstraction. Replicate the pattern for cap rate (already partially there: *"Cap 4.63% — Market cap ~4.6%"*), DSCR vs market DSCR, and yield curve.
- **"How we got these numbers" derivation narrative.** Lines 10–20 of the PDF — *"Pulled 12 sale comps → scored and kept top 6 → median $/sqft × subject sqft → 33% disagreement with anchors → blend 35/65 → $352k"* — is the strongest single output the product has ever produced. **It already contains the Negotiation Pack's "three weakest assumptions" section in raw form.** The Pack does not need new derivation logic; it wraps this existing narrative into a forwardable artifact that ends with a counteroffer recommendation.
- **State detection worked here** (MT correctly inferred, no national-avg insurance banner). Confirms listing #1's IN-detection failure was Zillow-URL flow specific, not universal. Worth scoping the §16.U finding #2 fix to the URL-flow normalization path.
- **Year built (1968) was successfully captured** from Zillow payload. Confirms year-built autofill works when the data is available; listing #1's missing year-built was a per-listing data gap, not systemic.

#### Net effect on §20

§20.9 gains 2 new P1 engine fixes (dedupeByBuilding, $/sqft outlier filter) and one upgraded P1 (stress-test IRR column). §20.12 gains a calibration-confirmed note. The Negotiation Pack thesis is hardened, not changed — this audit produced the single most important data point of the strategy reset: **the opinion layer works on independent calibration.**


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

---

## 19. Open product questions — strategy reset working list

Working list for the post-§16.T strategy reset. Each item is open until explicitly resolved by the user. The new agent should treat this as the agenda, work through it in order, and write resolutions back into HANDOFF as items get answered.

### 19.1 — Analysis accuracy audit (BLOCKING)

The user states the analysis "still has major problems." We have not enumerated them. Until this is resolved, no positioning or feature work is justified.

**Method:** user provides 2–3 real Zillow listings they have a strong opinion on. For each:

- Compare what RealVerdict's `/results` page shows vs. what the listing actually says vs. what the user believes is true.
- Specifically audit: AVM / list price, market rent, property tax, insurance, HOA, year built, sqft, beds/baths, comps selection, walk-away price, verdict tier.
- Identify: which numbers are wrong, which are missing, which are present but presented poorly.

**Deliverable:** new section §16.U documenting findings + a prioritized fix list.

### 19.2 — Positioning decision

What is RealVerdict, in one sentence, that DealCheck / Stessa / Mashvisor cannot also claim?

**Candidates surfaced in the strategy conversation (§16.T):**

| Positioning | Centerpiece feature | Honest cost |
|---|---|---|
| **Negotiation weapon for active buyers** | Walk-away price + Negotiation Pack | Forces us to build the Pack and prove the math |
| **Pipeline triage at scale** | Bulk URL → sortable verdicts | Forces us to optimize for speed-of-judgment, not depth-of-analysis |
| **Listing-quality intelligence** | Auto-flag DOM, price drops, agent-remarks weasel-words | Forces us to scrape and reason about Zillow itself, not just AVM |
| **Browser-native verdict** | Chrome extension overlays Zillow | Forces us to build + maintain an extension, comply with Chrome Web Store, handle MLS-data terms |

These are not mutually exclusive but pursuing all four = pursuing none. **Pick one to be the headline, at most one as supporting.** Defer the rest to future waves.

### 19.3 — Chrome extension: feature, surface, or product?

The extension was deferred to Phase 5 distribution in the original plan. Re-evaluating in light of §16.T:

- **As a feature:** thin wrapper over the existing web app. Low-effort, low-distinctiveness.
- **As a surface:** the primary place users interact with RealVerdict. Web dashboard becomes the portfolio + history. Verdicts happen on Zillow.
- **As the product:** RealVerdict.com becomes a marketing site + onboarding for the extension; the actual product is the extension. Web verdict still exists for share-link recipients without the extension.

This decision should fall out of §19.2. If the positioning is "negotiation weapon for active buyers," option 2 or 3 is likely. If it's "pipeline triage at scale," the extension is supporting at most.

### 19.4 — Data quality remediation, after §19.1

Once we know what's wrong from §19.1, the fix work likely splits into:

- **Per-source recalibration** — RentCast AVM bias by neighborhood tier, tax-rate fallback by school district not state, HOA detection from listing text not just RentCast field, etc.
- **Per-derivation hardening** — comp filtering when the area is dense vs. rural, walk-away binary search guard rails when verdict score is non-monotonic, etc.
- **Per-presentation cleanup** — what's on the page in raw form but isn't being used, what's presented in a way that hides the answer.

Defer until §19.1 is done.

### 19.5 — Distribution & first-paying-customer plan

The product has no validated buyer. Stripe is in test mode. Zero conversions. Before live-mode switch:

- Identify 5–10 active investors in the user's network or BiggerPockets / REI subreddits to demo the post-§16.U product to.
- Get qualitative feedback: would they pay $19/mo? $35? $50? What would they need to see to switch from DealCheck?
- Only after at least 1 person says "I'd pay" → switch Stripe to live mode + ship the killer feature from §19.2 → ask them to convert.

### 19.6 — Operator items still open from §16.S

These do not block the strategy work but remain real:

- [ ] Custom domain (`realverdict.app` or `.io`)
- [ ] Annual Stripe plan ($190/yr)
- [ ] Privacy + Terms (Termly)
- [ ] Stripe live-mode switch (only after the killer feature from §19.2 is shipped + at least 1 demo says "yes")

---

## 20. Strategy conclusion — positioning and the next product bet

Written 2026-04-22 after the audit session documented in §16.U. This section resolves §19.2 (positioning decision), §19.3 (Chrome extension question), and partially resolves §19.4 (data-quality remediation plan). Subsequent pricing and architecture choices in Wave 1 / §16.S are revised here.

### 20.1 Economic reality (read this first — everything below depends on it)

Current architecture burns 3–5 RentCast calls per fresh-address autofill. Serious investors analyze fresh listings nobody else in the user base has seen → 60–100 calls/mo per active user. RentCast pricing: **$12/mo covers 50 calls, then $0.20/call marginal**. Real variable cost per paying user at the current "comps on every autofill" pattern: **$12–20/mo in RentCast alone**, plus ~$1 Stripe, plus hosting and other upstreams (trivial at this scale).

| Scenario | Gross margin per user |
|---|---|
| $19/mo Pro paying user at 20 analyses/mo | −$2 to +$6 |
| $29/mo Pro paying user at 20 analyses/mo | +$8 to +$16 |
| Free user at 5/wk (current Wave 1 quota) | **−$2 to −$4 per user** (actively subsidizing non-converters) |
| Free user at 3/mo (proposed new quota) | −$0 to −$1 per user |

**The existing Wave 1 pricing ($19/mo + 5 free/wk) cannot scale to profitability.** This single fact supersedes most positioning debates. A product that costs more to run than it charges is not a product, regardless of how good the pitch is. Every strategy decision below follows from this.

### 20.2 Positioning

**One-line pitch:** ***RealVerdict makes the offer, not the math.***

**Longer form:** Every Verdict produces a ready-to-send Negotiation Pack — walk-away price, the three weakest assumptions in the seller's pro forma, the comp evidence, and the stress scenarios that break their math. Forward it to your agent before you tour.

**Tagline alongside Pack:** *DealCheck calculates. RealVerdict closes.*

This supersedes Wave 1's homepage framing (*"Know the max price this deal still works at"*) — same core idea, but abstract. The Pack is a concrete artifact the investor actually uses, not a number they read on a dashboard.

**What this positioning does:**
- Takes the walk-away price (the only truly unique thing in the product today, §16.B) and makes it the foundation of an artifact the investor forwards to a human.
- Reuses comps and analysis already pulled on the current /results page — **zero new RentCast cost**.
- Is not replicable by DealCheck/Stessa/Mashvisor in a month; it requires the opinion layer (rubric, stress tests, walk-away math) we've already built, wrapped in a new presentation primitive.
- Turns the product into its own viral loop: every forwarded Pack exposes a new agent, seller, and parallel-investor to RealVerdict.
- Legitimately justifies $29/mo (see §20.7).

**What this positioning kills:**
- *"Better analysis than DealCheck"* — true but unpersuasive; investors don't switch calculators over a tighter rubric.
- *"Live comps"* — RentCast has those for $12/mo; this narrative makes us a wrapper.
- *"Faster than a spreadsheet"* — table stakes within 12 months.

### 20.3 Primary bet: the Negotiation Pack

**What it is:** on every `/results` page, a one-click "Generate Negotiation Pack" button that produces a shareable PDF or public link containing:

1. **Headline** — walk-away price with its realism band (§16.B), list price, the delta, and one sentence framing ("This deal clears our rubric at or below $X; the seller is asking $Y").
2. **The three weakest assumptions in the seller's pro forma**, sourced from the derivation. Examples drawn from listing #1:
   - *"Seller's implied rent is 41% above comp median — verify with 3 comps before banking on it."*
   - *"Tax shown reflects current owner's homestead cap — investor's post-sale tax will be ~2.1× ($5,800 vs $2,369 on this property)."*
   - *"Insurance listed is 0.5% of value flat — real flood/state-adjusted quote likely $X/yr."*
3. **Comp evidence** — 3–5 comps, bed/bath/sqft/$/distance, with one-line reasons each was included.
4. **Stress scenarios that break the seller's numbers** — rent drop 10%, expense jump 25%, exit 10% below today, refi rate +1pt. Specifically framed as "the seller's asking price requires all of these to go right."
5. **Counteroffer script** — 2-3 paragraphs of plain English the investor can literally forward to their agent, with the walk-away number anchored inside it.

**Why it wins:**
- Nobody else does this. DealCheck/Stessa output internal dashboards, not forward-to-my-agent artifacts.
- Reuses every piece of data the engine already computes — zero incremental RentCast cost.
- Legitimately justifies a premium over DealCheck — this is a negotiation tool, not a calculator.
- Viral loop: every forwarded Pack lands in an agent's inbox. One in ten agents will click through and check out the product.

**What has to ship first for the Pack to be credible** — priority-ordered in §20.9. A Pack built on top of the P1 bugs in §16.U (homestead-trap tax, Condo misclassification, state detection) produces confident-looking numbers that are wrong. Every forwarded Pack with a wrong number damages the brand irreversibly.

### 20.4 Supporting bet: the Comp Reasoning Explainer

**What it is:** rewrite the Comps tab from a table-of-comps into an opinionated explanation. Today we show a list of comps. Tomorrow we show:

- The 3–5 comps that actually drove the derivation, with *"why this one"* per comp ("same bed/bath, same ZIP, sold within 60 days").
- The 1–2 comps we explicitly excluded and why ("active 180 days without selling — the market has rejected this price").
- The implied range — 25th–75th percentile of the scored pool, not raw median.
- Sqft normalization shown explicitly: "median comp $/sqft × subject sqft" = the rent/value the engine actually uses.
- A confidence band: *"High: 8 SFR comps, same ZIP, tight range"* vs *"Low: 3 rent comps, all smaller than subject, widest 10mi"*.

**Why it pairs with the Pack:** Pack's "three weakest assumptions" section is generated from exactly this reasoning. Comp Reasoning is the engine; the Pack is the presentation.

**Fixes findings #5–#6 from §16.U** at the same time: the Reality Check card stops being a standalone widget at odds with the engine's own numbers, and becomes the summary row of the Comp Reasoning page.

**Zero new RentCast cost** — pure presentation layer over the comp pool already fetched.

### 20.5 Kill list

These are not "deferred." They are "do not build." Revisit only if positioning changes.

- **Bulk triage (paste 20 URLs).** 20 × 3–5 RentCast calls = 60–100 calls per session = $12–20 variable cost per triage run. An investor running 10 triage sessions/mo costs $120–200 in RentCast against $29 revenue. Unit economics break before the product works.
- **Live deal alerts / watchlists with scheduled polling.** N users × M watched listings × daily polls = thousands of calls/day. Even with aggressive zip-level cross-user caching, listing-status polling is a different workload than comp pulls and burns Zillow/RentCast regardless. Revisit only after the Pack has paying users and revenue funds the upstream.
- **Chrome extension as primary product surface.** Two failure modes: (a) auto-fire on every Zillow page view is unaffordable — RentCast burn scales with casual browsing, not intent; (b) click-to-analyze is just a faster web-app launcher, not a differentiated product. May revisit much later as a read-only overlay that surfaces existing-cached verdicts without triggering fresh RentCast pulls — but not as the next bet.
- **SEO / paid-acquisition push while the P1 engine bugs are live.** Amplification on top of broken homestead-trap tax fallback or Condo misclassification produces Packs that look authoritative but are wrong on the most common U.S. investment-property scenarios. Worse than no push at all.

### 20.6 Parked (interesting, not the next bet)

- **Listing-Quality Intelligence** — auto-flag DOM, price drops, photo reads, agent-remarks weasel-words. Structurally cost-safe (Zillow scrape, no RentCast). Best played as **content inside the Negotiation Pack** (*"seller has been on market 147 days — motivated"*), not as a separate product surface. Park until Pack MVP ships; then layer in as Pack enhancement.

### 20.7 Pricing change — $19 → $29

**Recommendation: single Pro tier at $29/mo, tightened free quota.**

**Free tier:** **3 analyses/month** (down from 5/week). 5/week was sized before the unit-economics math was done; it amounts to a $4/mo subsidy per non-converting user. 3/mo is enough for a skeptic to kick the tires, not enough to run a real deal flow. All features unlocked on the 3 analyses — no feature gating on free. Scarcity forces the upgrade decision fast.

**Pro: $29/mo monthly, $279/yr annual (≈2 months free).** Unlimited analyses, Negotiation Pack generation, Comp Reasoning Explainer, saved portfolio, cross-device compare sync, 7-day refund. The Pack is the **headline feature**, not a Pro-only upsell — it's the reason anyone pays.

**Why $29, not $19 or $39:**
- $19 is unprofitable at typical active-investor usage (§20.1). Shipping a Pack over unprofitable unit economics just accelerates the loss.
- $39 starts costing more than DealCheck ($35) without a premium-tier feature set to justify it; and at pre-revenue scale, $39 is a bigger psychological ask.
- $29 nets ≈$28 after Stripe, ≈$13–15 after RentCast at typical use. Sustainable without being rich. Explicitly below DealCheck so the "cheaper and better opinion" pitch works on the pricing page.

**Grandfathering:** any user who converted during Wave 1 at $19 gets price-locked at $19 forever, with Pack included. Zero existing paying users as of session end, so this is an empty guarantee — but state it publicly.

### 20.8 Architecture change — defer comp pulls until intent is expressed

Today every autofill triggers 3–5 RentCast calls whether the user engages or bounces. This is what makes the free-tier and low-intent-user economics punishing. **Do not ship the Pack without this change.**

Proposal:
- **Autofill shows Zillow Zestimate + list price + FRED rate + state-avg insurance + homestead-corrected tax immediately.** Sub-second response, zero RentCast hit. Labeled transparently (*"Fast initial estimate — Zillow Zestimate. Click 'Run live comp analysis' for comp-derived rent/value."*).
- **One "Run live comp analysis" button on /results** triggers the actual RentCast pulls when the user actively wants the opinion.
- Pack generation and Comp Reasoning **require** live-comp mode (natural Pro gate for unlimited Pack generation).
- Numbers/Stress/What-if/Rubric tabs remain functional on the fast estimate so browse-and-bounce users get a usable opinion without burning RentCast quota.

**Expected impact:** 60–80% reduction in RentCast calls. Browse-and-bounce traffic (free-tier casuals, landing-page visitors, people who don't convert) stops costing us money. The "better than Zestimate" claim remains true — it's just gated behind one intentional click.

This supersedes the Stage 2/3 RentCast cost work mentioned in §16.K (sessionStorage comp sharing, etc.) — this goes further by not firing the comp pull on autofill at all.

### 20.9 What must ship before the Pack is credible

Priority-ordered, referencing §16.U + §16.U.1 findings. Numbers 1–9 are the minimum P1 floor (engine + monitoring + comp-pool integrity); 10 is the architecture change; 11–12 polish; 13–14 the new product surfaces.

1. **Fix the homestead-trap on property tax** (§16.U #3). Every IN/FL/TX/CA/GA investment property we've ever analyzed is likely carrying the wrong tax. Approach: when resolver concludes the property is being bought as a rental, substitute state × non-homestead cap on assessed value, do NOT use the current-owner assessor line-item.
2. **Fix Condo misclassification** (§16.U #1). Bed/bath/sqft/HOA heuristics should override Zillow's `HomeTypeCategoryEnum` when they disagree. Until this lands, §16.E's comp-filter logic actively excludes correct peers on HOA-lite SFRs.
3. **Fix state detection in the Zillow-URL flow** (§16.U #2). Root-cause why the state token is lost in the URL-flow normalization but preserved in direct-address flow. Listing #2 (MT) confirmed the direct-address flow works — scope the fix to the URL normalization path only.
4. **Reconcile the Reality Check card with the engine's own derivation** (§16.U #5–#6, two-listing-confirmed via §16.U.1 #1). Apply sqft normalization consistently; surface the normalized + anchor-blended comparison, not the raw-median delta. Listing #2 made this finding airtight — the card and the PDF derivation say different things about the same comp pool on every listing.
5. **Strip internal error strings from user-facing copy** (§16.U #4). "Invalid RentCast API key" and any equivalent raw-API-error text must never appear in the UI again — mandatory once Packs become forwardable.
6. **Monitor RentCast 401/403 specifically.** Sentry should alert on sustained auth failures, not just 5xx. Add an hourly uptime check that pings `/v1/properties?address=<known-good>` with the prod key; wire to PagerDuty/email/Slack. The entire strategic value of the product vanished silently because a key rotated without a monitor. This cannot happen again.
7. **Fix `dedupeByBuilding` near-duplicate address fragility** (§16.U.1 #4 — NEW from listing #2). Rent pool on Polson had `150 Claffey Dr Unit Gdn` and `150 2 Claffey Dr Unit Gdn` treated as distinct comps. Building-key normalization needs to handle: leading digit/word variations, unit-suffix variations, whitespace differences. With 3-comp pools common in thin markets, a single duplicate-pair distorts the median by 15–25%. Test fixtures should include real-world dirty addresses.
8. **Add a $/sqft outlier filter to comp scoring** (§16.U.1 #5 — NEW from listing #2). Sale pool on Polson included a $993/sqft Flathead Lake waterfront comp alongside in-town 1968 SFRs at $200/sqft. Type/bed/bath/distance scoring is blind to this. Approach: after the existing §16.C scoring pass, compute the $/sqft pool z-score and drop comps >2σ from the trimmed mean before taking the median. Logs should record dropped outliers and surface them in the workLog so the user can audit the trim. Without this, §16.E's anchor-blend has to keep doing the cleanup work the comp pool itself should have done.
9. **Make stress-test verdict flips explainable** (§16.U #7, **upgraded P2 → P1** by §16.U.1). On listing #2 the "Sells 10% below today" row showed identical CF/DSCR/Cap as the base PASS verdict but flipped to AVOID — the IRR drop driving the flip is invisible because the table doesn't show IRR. An unexplained verdict flip is a bigger credibility hit than a dead row. Add IRR (and Total ROI) columns to the stress table; for any verdict change, surface the metric that drove it inline ("verdict flipped because IRR dropped from 8.0% to 6.2%").
10. **Implement §20.8 architecture change** (defer comp pulls until intent). Pack economics depend on this.
11. **Reconcile cross-tab numeric inconsistencies** (§16.U #8). Break-even, Total return vs Total ROI, rate slider default. P2 — does not block Pack but should ship in same wave.
12. **Fix garbled negative-CF copy templates** ("wiping out 0 months of current cash flow" — §16.U.1 #7). Negative-CF special case in the Flash Point / "Watch out for" template. P2.
13. **Build the Negotiation Pack UI and PDF export.** The §16.U.1 audit confirmed the raw material already exists — the PDF's "How we got these numbers" derivation IS the Pack's "three weakest assumptions" section. The build is wrapping, not generating from scratch.
14. **Build the Comp Reasoning Explainer page.** Once outlier-trim (item 8) and dedupe (item 7) ship, the explainer can show exactly which comps were kept, dropped, and why.

**Order matters.** A Pack built on top of bugs #1–#9 is worse than no Pack — each forwarded Pack with a wrong number damages the brand in the exact audience the viral loop needs. Fix the foundation, then ship the presentation.

### 20.10 Explicitly NOT recommended

- **Do not rip out existing tabs.** Numbers, Stress test, What-if, Rubric, Comps — keep them all. Some paying users will want to scrutinize the math. The Pack sits on top of them, not in their place.
- **Do not rip out existing Pro features** (comps-tab Pro gating, Save Deal, cross-device compare sync). They're fine as Pro features; they just stop being the headline.
- **Do not pause §16.S operator items** (custom domain, legal pages, live-mode Stripe). Those still need to happen in parallel. Just don't flip Stripe live-mode until the Pack is shipped AND at least one person has said "I'd pay" for the Pack specifically (§19.5).
- **Do not assume this positioning is permanent.** Revisit in 90 days with real conversion data. If the Pack doesn't move the needle, listing-quality intel (§20.6) becomes the next candidate.
- **Do not re-audit listings #2–#3 as a gate for shipping.** Audit them when convenient; append to §16.U. Only revisit §20 if listing #2 (the BUY) surfaces an accuracy problem where the product would label the BUY as AVOID for reasons the user rejects. That outcome would mean the opinion layer is miscalibrated and positioning can't carry the pitch.

### 20.11 Success criteria (90 days from Pack ship)

Minimum bar to call this positioning correct:

- **≥10 paying customers at $29/mo** — conversion rate ≥2% of completed analyses, meaning the Pack is actually pulling its weight.
- **≥1 Pack forwarded to an external agent/seller per week** — the viral loop has a pulse.
- **RentCast monthly cost ≤30% of revenue** — §20.8 architecture change is landing as expected.
- **Month-3 churn ≤15%** — the Pack earns its price across multiple deals, not just one-time-use.

If any fail, the *positioning* is wrong, not the execution. Revisit §19 candidates (Listing-Quality Intel jumps up, extension stays dead).

Failure modes to watch for specifically:

| Failure mode | Signal | Likely cause |
|---|---|---|
| Packs generated but never forwarded | Download/share rates flat | Pack is treated as a product feature, not a communication artifact — the whole moat premise is wrong, revisit positioning |
| Packs forwarded but no inbound traffic from receivers | Referral analytics zero | Viral loop broken at the receiver end — revisit Pack design (is it forwardable? is the link shareable? is there a "RealVerdict did this" footer?) |
| RentCast cost blows past 30% of revenue | Upstash billing + RentCast invoice | §20.8 architecture change didn't land — need zip-level cross-user caching, or renegotiate with RentCast for volume pricing |
| High sign-ups but low Pack generation | Funnel drop at "Run live comp analysis" button | Analysis is doing the job without the Pack — the Pack isn't differentiated enough, or analysis is too good standalone |

### 20.12 What this resolves in §19

- **§19.2 (positioning decision):** RESOLVED — "negotiation weapon for active buyers," centerpiece is the Negotiation Pack.
- **§19.3 (Chrome extension):** RESOLVED — not the next bet, for cost reasons (§20.5). Consider as read-only cached-verdict overlay much later.
- **§19.4 (data quality remediation):** partially resolved by §20.9 items 1–9. Ordering and priority locked.
- **§19.1 (analysis accuracy audit):** partially resolved by §16.U (listing #1) and §16.U.1 (listing #2). **Calibration confirmed on a second independent listing** — the product's PASS verdict on Polson, MT matches the verdict a target-demographic active investor would produce, for the same reasons. The opinion-layer thesis underlying §20 is no longer dependent on a single data point. Listing #3 still pending but not blocking; revisit-§20 trigger condition (a BUY mislabeled AVOID) remains in §20.10.
- **§19.5 (distribution & first-paying-customer plan):** stands as-is — still need 5–10 investor demos; now demoing the Pack, not the calculator.
- **§19.6 (operator items from §16.S):** stands as-is. Custom domain / annual plan / legal pages / live-mode switch all still required in parallel.

### 20.16 §20.3 + §20.4 + §20.10 — Negotiation Pack, Comp Reasoning Explainer, $29 reprice — SHIPPED (2026-04-22)

The Pack ship is in. Pricing copy is repriced to the $29 single-tier model. The actual Stripe price ID switch is the only remaining non-code task — it's a Stripe Dashboard change the operator does once before flipping live mode (see "Stripe handoff" at the end of this section).

| Surface | Implementation |
|---|---|
| **Data layer (Pack payload)** | `lib/negotiation-pack.ts` — pure module: `PackPayload` type + `buildPack({inputs, analysis, comparables, warnings, provenance})`. Picks the **three weakest assumptions** from resolver warnings (homestead trap → high), comp-derived rent gap (≥10% / ≥$75 → high or medium), insurance provenance (state-average / NFHL → flagged), thin sale comp pool (<3 → medium), default vacancy (≤5% → low), and orders by severity. Picks **top-3 sale + top-3 rent comp evidence** with a one-line `why` (matchReasons + $/sqft + distance + caveat). Runs **four stress scenarios** (Rent −10%, Expenses +25%, Refi rate +1pt, Sells 10% below) and tags `flippedFromBase` on any verdict tier change. Builds the **counteroffer script** as 2–3 forwardable paragraphs anchoring the walk-away price. |
| **Persistence** | `supabase/migrations/004_negotiation_packs.sql` — new `public.negotiation_packs` table. Columns: `id uuid pk, share_token text unique, user_id uuid → auth.users, payload jsonb (frozen PackPayload), address, verdict, walk_away_price, list_price, is_public bool default true, revoked_at timestamptz, created_at`. Indexed on `share_token` (hot path) + `(user_id, created_at desc)` (dashboard). RLS: SELECT requires owner OR `is_public AND revoked_at IS NULL`; INSERT/UPDATE/DELETE owner-only. **You must run this SQL in the Supabase SQL editor before the route works in any environment.** |
| **Generation API** | `POST /api/pack/generate` — auth-gated (must be signed in; Pack is the funnel TO Pro, not gated BY Pro). Re-pulls comps server-side via `fetchComps` (cache-served when the user just ran live-comp on `/results` seconds ago, so no double RentCast charge), runs `analyzeComparables`, calls `buildPack`, generates a 144-bit base64url `share_token`, inserts the row, returns `{ packId, shareToken, shareUrl }`. Rate-limited via new `pack-generate` limiter (30/hr per user). |
| **Web view** | `app/pack/[shareToken]/page.tsx` — public, no-chrome viewer at `/pack/<token>`. Renders headline framing, the three weakest assumptions, comp evidence (top-3 sale + top-3 rent), stress scenarios table with verdict-flip tagging, the counteroffer script in a forwardable card, and a generation snapshot. Anonymous-readable (RLS lets `is_public AND revoked_at IS NULL` rows through the anon client). "Download PDF" button at the top. |
| **PDF export** | `app/pack/[shareToken]/pdf/route.ts` + `lib/pack-pdf.tsx` — `@react-pdf/renderer`-backed Letter-size PDF rendering the same `PackPayload` as the web view (so the two cannot drift). Filename slugifies the address. Runs on the Node runtime (react-pdf needs Buffer + canvas-free primitives that aren't on the edge). New dep: `@react-pdf/renderer`. |
| **CTA wiring** | `app/_components/PackGenerateButton.tsx` — accent-colored primary button on the `/results` action row. Visible **only when** `liveComps && comparables && address` (the live-comp path opt-in is the gate; on the fast estimate the button is hidden). Anonymous click → `/login?mode=signup&redirect=...`; signed-in click POSTs to `/api/pack/generate` and routes to `/pack/<shareToken>` on success. |
| **Comp Reasoning Explainer (§20.4)** | `app/_components/CompReasoningPanel.tsx` — sits at the top of the Comps tab. Shows the p25/median/p75 band per pool with sample size + radius + confidence. Lists the comps the engine **actually used** in the derivation, each with a one-line "why included" sourced from `matchReasons + $/sqft + distance + daysOnMarket` (same source-of-truth function as the Pack picker). Lists comps **excluded** from the engine's selection inside a collapsed `<details>` with a synthesized "why excluded" (distance / staleness / missing sqft). Surfaces the engine's `workLog` in a second collapsed section. |
| **Pricing reprice (§20.10)** | `app/pricing/page.tsx` — Pro repriced **$19 → $29/mo**. Free tier reframed: **unlimited fast estimates + 3 live comp pulls per month** (matches §20.7). Pro tier now leads with "unlimited live comp analyses" and "Negotiation Pack" + "Comp Reasoning Explainer" instead of generic feature parity. FAQ rewritten to explain the fast vs live-comp distinction. |
| **Rate limiter** | `lib/ratelimit.ts` — new `pack-generate` limiter, 30/hr keyed by user id. |

**Files added:** `lib/negotiation-pack.ts`, `lib/negotiation-pack.test.ts`, `lib/pack-pdf.tsx`, `app/api/pack/generate/route.ts`, `app/pack/[shareToken]/page.tsx`, `app/pack/[shareToken]/pdf/route.ts`, `app/_components/PackGenerateButton.tsx`, `app/_components/CompReasoningPanel.tsx`, `supabase/migrations/004_negotiation_packs.sql`, `tests/pack-routes-invariants.test.ts`.

**Files modified:** `app/results/page.tsx` (HeroSection/HeroActions plumb `packEligible` + `subjectFacts`; PackGenerateButton mounted on the action row), `app/_components/CompsSection.tsx` (renders `CompReasoningPanel` when `comparables` present), `app/pricing/page.tsx` (full reprice + copy rewrite), `lib/ratelimit.ts` (new `pack-generate` limiter).

**Test status at ship time:** 162 tests pass across 12 files (added 8 structural pack-route invariants on top of 9 buildPack unit tests). `tsc --noEmit` clean. `eslint .` clean. `next build` clean — all four new routes (`/api/pack/generate`, `/pack/[shareToken]`, `/pack/[shareToken]/pdf`) registered.

**Stripe handoff (operator must do):** The new `$29` is marketing copy only — the live billed amount comes from the `STRIPE_PRICE_ID_PRO` env var pointing at a Stripe Price object. Before flipping Stripe to live mode:
1. In Stripe Dashboard → Products → RealVerdict Pro, create a new Price at **$29.00 USD recurring monthly** (or update the existing Price — but Stripe forbids editing the amount on a live Price, so a NEW Price object is the canonical move).
2. Copy the new `price_xxx` id and update `STRIPE_PRICE_ID_PRO` in Vercel (production) + `.env.local` (local).
3. Verify `/pricing` → "Get Pro" → Stripe checkout session shows $29.00.
4. Then flip Stripe to live mode per §10 / §19.5.

**Supabase handoff (operator must do):** Run `supabase/migrations/004_negotiation_packs.sql` in the Supabase SQL editor (Project → SQL → New query → paste → Run). Idempotent — safe to re-run. Without this, `/api/pack/generate` returns a 500 with a "Did you run the migration?" hint.

**Unblocked next:**
- Investor demo (§19.5 signal). Need at least one "I'd pay for that specifically" before live Stripe flip.
- Listing #3 audit (when the user sends it). Only revisit §20 if listing #3 produces a BUY mislabeled as AVOID.
- §20.9 #11–#12 (cross-tab numeric reconciliation + garbled negative-CF copy). P2 polish.

### 20.14 §20.8 architecture change — SHIPPED (2026-04-22)

The architecture pivot is in. The resolver no longer pulls comps. Browse-and-bounce traffic costs at most one RentCast `/properties` call per fresh address (instead of 4–6). Live-comp mode is opt-in via a "Run live comp analysis" button on `/results`. The fast estimate runs every tab on Zillow Zestimate + FRED rate + state-average insurance + homestead-corrected tax — no quota burn, no comp-pool hit.

| Surface | Before | After |
|---|---|---|
| `/api/property-resolve` | `fetchRentcast` + `fetchComps` + `analyzeComparables` on every autofill | `fetchRentcast` only (one `/properties` call). Rent falls back to Zillow rent Zestimate; price falls back to Zillow Zestimate. `comparables` field removed from `ResolveResult`. |
| `/results` first paint | `fetchComps` + `analyzeComparables` always (a SECOND comp pull on top of the resolver's) | Comp fetch + analysis only when `?livecomps=1`. CTA banner above the hero invites the user to opt in. |
| Quota | Burned on every `/results` view (browse-and-bounce free users used up 5/wk just looking) | Burned only on `?livecomps=1`. Free users get 3 live-comp analyses per month (the §20.7 number). |
| Comps tab | Pro: `CompsSection` (with `comps` data). Free: `ProCompsTeaser`. | Pro on fast path: `CompsSection` shows a "Run live comp analysis" CTA in place of the comp tables. Pro on live: full tables. Free: still `ProCompsTeaser` (Comp Reasoning Explainer remains the Pro feature per §20.7). |
| `HomeAnalyzeForm` | `AUTOFILL_CACHE_VERSION = v3` | `v4` — invalidates any cached resolver payload that still carries comp-derived rent provenance. |
| `ResultsWarningsBanner` | Read namespace `results-warnings:v1` while form wrote `results-warnings:v3` — silent dead code since the v2 bump | Now reads `results-warnings:v4`, in lockstep with the form. (Pre-existing bug fixed in passing.) |

**Files changed:** `app/api/property-resolve/route.ts` (resolver surgery — three `resolveFromComparables` call sites removed, the function itself deleted, imports stripped, cache `v14 → v15`), `app/results/page.tsx` (`livecomps` flag + `RunLiveCompsCTA` component + quota gating), `app/_components/CompsSection.tsx` (new `liveCompsHref` prop + opt-in empty state), `app/_components/HomeAnalyzeForm.tsx` (cache version bump), `app/_components/ResultsWarningsBanner.tsx` (namespace mismatch fix), `tests/property-resolve-route-invariants.test.ts` (NEW — 6 structural assertions guarding the no-comp-pull contract against accidental regression).

**Test status at ship time:** 145 tests pass across 10 files. `tsc --noEmit` clean. `eslint .` clean.

**Expected impact (per §20.8):** 60–80% reduction in RentCast calls. Specifically:
- Free-tier casuals who browse-and-bounce now cost zero RentCast (was 4–6 per autofill).
- Address-only autofill drops from 4–6 calls to 1 call (`/properties` only).
- Zillow URL autofill drops from 4–6 calls to 1 call (`/properties` for last-sale + tax + lat/lng; comp pulls deferred).
- Live-comp mode (the user opted in) costs the same 3–5 calls it always did, but now only when there's real intent.

**Unblocked next:** §20.3 (Negotiation Pack) + §20.4 (Comp Reasoning Explainer). Both consume `comparables` from the live-comp path, which is now the natural Pro funnel.

### 20.13 §20.9 items 1–9 — SHIPPED (2026-04-22)

The P1 engine + monitoring + comp-pool floor is in. Pack work is unblocked
on the engine side; remaining gates are §20.8 architecture (item 10) and
positive investor demo feedback before flipping Stripe live.

Cache versions bumped: resolver `v11 → v14` (one bump per item triplet to
keep the changelog readable), client autofill `v1 → v3`. Both invalidate
on next deploy.

| § | What shipped | Where | New tests |
|---|---|---|---|
| 20.9 #1 | Homestead-trap property tax fallback. Investor (non-homestead) state rate is the default; assessor line-items reflecting the current owner's homestead exemption are detected and overridden, with both numbers surfaced in the provenance note + a user-visible warning explaining the dollar delta. | `lib/estimators.ts` (`detectHomesteadTrap`, investor rate table), `app/api/property-resolve/route.ts` (override + warning), `app/_components/HomeAnalyzeForm.tsx` (provenance label) | `lib/estimators.test.ts` — 8 new tests including the Hoagland numbers ($299,900 / $2,369/yr → IN trap fires). |
| 20.9 #2 | Property-type misclassification (Condo on HOA-lite SFR). Symmetric override: Zillow's "Condo" / "Apartment" label is overridden when structural signals (≥3bd, ≥1500sqft, HOA < $75/mo) say SFR. The reclassification reason is prepended to the comp `workLog`, and the existing `>$200 HOA` SFR→condo override now emits the same explanation. | `lib/comparables.ts` (`inferSubjectCategory` returns `CategoryDecision`, plumbed through `derive`) | `lib/comparables.test.ts` — 6 new tests (Hoagland fix; real condo NOT overridden; small condo / apartment label / rent symmetry). |
| 20.9 #3 | State detection in Zillow-URL flow. Two-layer fix: (a) `lib/estimators.ts:detectStateFromAddress` was eating the first 5-digit run, which is the *street number* on addresses like `14215 Hawk Stream Cv` — switched to a trailing-anchored ZIP strip; (b) Zillow URL flow now propagates state explicitly via the `state` field on `/api/zillow-parse`'s response, sourced from either Zillow's structured blob OR the URL slug, validated against the canonical US state code set. The address composition format also moved to canonical `"Street, City, ST ZIP"`. | `lib/zillow-url.ts` (NEW — extracted helpers), `app/api/zillow-parse/route.ts`, `app/api/property-resolve/route.ts` (explicit-state pass-through) | `lib/zillow-url.test.ts` (NEW — 14 tests) + `lib/estimators.test.ts` (Hoagland 5-digit-street regression). |
| 20.9 #4 | Reality Check card reconciliation. The card now consumes the engine's `marketValue.value` / `marketRent.value` (sqft-normalized + anchor-blended) when present, falling back to raw pool median only when the engine couldn't derive. Card and PDF derivation now tell ONE story. | `app/_components/CompsSection.tsx` (`pickAnchor` helper, `RealityCheck` props expanded) + `app/results/page.tsx` (passes `comparables` through) | (UI surface — covered indirectly by the engine tests for §20.9 #2 / #8.) |
| 20.9 #5 | Internal error text scrubbed from user-facing copy. RentCast errors now classified into `auth / no-data / rate-limit / network / http`; only sanitized one-liners reach the UI (`"Couldn't reach the property-records database — proceeding with listing data only."`). Raw error string + status code go to `logEvent`/`captureError`. Same contract for Zillow scrape errors. The legacy `RentCast: ` note prefix is gone since the new copy is self-describing. | `app/api/property-resolve/route.ts` (`RentcastErrorKind` + `userSafeRentcastNote`), `app/_components/HomeAnalyzeForm.tsx` (safer error-message extraction with regex guard against API-key strings) | (Captured by the operational logging — Sentry rules now key on `extra.kind=auth`.) |
| 20.9 #6 | RentCast 401/403 monitoring. New `GET /api/health/rentcast` endpoint pings RentCast with a known-good probe address (`RENTCAST_PROBE_ADDRESS` env var, defaults to Empire State Building) and returns 200/`{status:"ok"}` or 503/`{status:"auth-failure" \| "rate-limited" \| "down" \| "no-key"}`. Sanitization contract identical to the user UI — no API key, no probe address, no raw error string in the response body. Wires up cleanly to UptimeRobot / Better Uptime. | `app/api/health/rentcast/route.ts` (NEW), `docs/runbooks/rentcast-key-rotation.md` (NEW — full incident runbook with rotation playbook, Sentry rule shape, and the SQL audit query for retro detection). | (Endpoint — exercise via curl in CI smoke test if desired.) |
| 20.9 #7 | `dedupeByBuilding` near-duplicate fix. New `buildingKey` normalizer (a) splits on `-` and `/` so `150-2 Claffey Dr` and `150 Claffey Dr` collapse, (b) drops bare-numeric tokens wedged between street number and street name (the Polson `150 2 Claffey Dr` case) when the next token isn't a directional or street suffix, and (c) canonicalizes street suffixes (`Drive`/`Dr`) and directionals (`North`/`N`). Carefully avoids over-collapsing — `100 Main St` ≠ `100 Main Ave`, `100 N Main` ≠ `100 S Main`, and numbered streets like `123 5 Ave` survive intact. | `lib/comps.ts` (`buildingKey` rewritten with `STREET_SUFFIX_CANON` + `DIR_CANON` tables) | `lib/comps.test.ts` — 6 new tests (Polson regression + suffix normalization + directional normalization + the must-NOT-collapse cases). |
| 20.9 #8 | $/sqft outlier z-score filter. Path A of `derive` now drops comps whose $/sqft is >2σ from the pool mean BEFORE the median is taken. Floor: pool must be ≥5 to compute meaningful stdev, never trim below 3. Each dropped comp is named in the `workLog` with its $/sqft so the user can audit the trim. The §16.E anchor-blend stops carrying the comp pool's cleanup load. | `lib/comparables.ts` (`trimOutlierPricePerSqft` + Path A integration) | `lib/comparables.test.ts` — 4 new tests (luxury rehab dropped; small-pool guard; tight-pool no-op; floor protection at 3 comps). |
| 20.9 #9 | Stress-test verdict-flip transparency. Stress test grid now shows IRR and Total ROI alongside CF/DSCR/Cap, and any tier change vs the base verdict displays a small `↓ on DSCR` / `↑ on IRR` badge under the tier label, with the full base→stressed metric values in the hover tooltip. Driven by walking the rubric `breakdown` and finding the largest-magnitude per-category point delta. | `app/_components/StressTestPanel.tsx` (`diagnoseVerdictFlip`, `shortMetricName`, two new columns) | (UI surface — exercises existing `analyseDeal` rubric.) |

**Test status at ship time:** 139 tests pass across 9 files (`lib/estimators`, `lib/comparables`, `lib/comps`, `lib/zillow-url`, `lib/calculations`, `lib/ratelimit`, `lib/flood`, `lib/client-session-cache`, `lib/kv-cache`). `tsc --noEmit` clean. `eslint .` clean.

**Remaining gates before Pack ship:**
- §20.9 #10 — defer comp pulls until intent (the §20.8 architecture change). Engine fixes 1–9 are now invariant against this — they apply identically whether the comp pull happens at autofill or at intent-click.
- §20.9 #11–#12 — cross-tab numeric reconciliation + garbled negative-CF copy. P2 polish, do these in the Pack-build wave.
- §19.5 demo signal — "I'd pay for that specifically" before Stripe live-mode flip.

### 20.18 Pack-first repositioning — SHIPPED 2026-04-22

**Why:** Homepage sold the walk-away price (correct) but never mentioned
the Negotiation Pack (the primary product bet). Pricing page buried the
Pack as a single bullet in the Pro column. Prospects had no way to know
the Pack existed, let alone that it was free for their first 3 listings
a week. The product had shipped and was invisible.

**What changed (copy-only — no functional gate changes):**

`app/page.tsx` — homepage
- Hero eyebrow: **"For your next offer"** (beachhead customer callout —
  investors with a specific listing in hand, not passive browsers).
- Hero headline: **"Walk in with a number. Not a feeling."** (the
  emotional pitch that generalizes across experience levels).
- Hero subhead: names the Pack explicitly, lists the four deliverables
  the Pack contains (walk-away price, weakest assumptions, comp evidence,
  counteroffer script).
- Free-quota callout: **"Free for your first 3 listings a week. $29/mo
  for unlimited."** — accurate to `analysis-free-user` limiter
  (3 tokens / 7-day rolling window in `lib/ratelimit.ts`).
- Value-prop section title changed from generic "three cards" to **"What's
  in the Pack"**. Cards now name: walk-away price, three weakest
  assumptions, counteroffer script. Replaces reality-checked-rents and
  stress-tested-verdict (which were true but redundant against the Pack
  framing — stress tests ARE part of the Pack).
- How-it-works step 2 rewritten to "Run a live comp analysis" (with the
  explicit mention of p25/median/p75 and comp reasoning). Step 3
  rewritten to "Generate the Pack" — product-forward CTA naming.
- Bottom CTA rewritten to lead with the 3-free-per-week quota and the
  $29 unlimited upgrade path. Primary button text changed from
  "Analyze a deal" → **"Try it on your next listing"**.

`app/pricing/page.tsx`
- Page headline changed from "Simple, honest pricing" → **"The Pack is
  free for your first 3 listings a week."** — the pricing page is now
  selling the product, not describing tiers.
- New `<PackAnatomy />` section above the tier cards: six cards, one
  per Pack pillar (walk-away price, weakest assumptions, comp evidence,
  stress scenarios, counteroffer script, agent-ready PDF + share link).
  This is the "what you actually get" visual that was missing.
- Free tier card rewritten to lead with **"3 full Negotiation Packs per
  week"** as the highlighted feature. Pro tier card rewritten to lead
  with **"Unlimited Negotiation Packs"**. Both tier CTAs updated
  ("Try a Pack free" / unchanged Pro button).
- FAQ expanded and rewritten — first question is now "The Pack is
  really free? What's the catch?" and the answer explicitly explains
  the 3/week quota + when upgrading makes sense. Added a "Who is this
  for?" question naming the beachhead (investors making their next
  offer).

`tests/pack-routes-invariants.test.ts`
- Updated the pricing-page invariant to assert "3 full Negotiation
  Packs per week" (matching the new copy).
- Added a homepage invariant: asserts the Pack is named, "For your
  next offer" appears (beachhead), and "3 listings a week" is visible
  (free-tier quota communicated).

**What did NOT change (and why):**
- Rate limiter budgets (`analysis-free-user` = 3/week, `analysis-free-anon`
  = 5/week). The 3/week cap on live-comp analyses already translates to
  3 free Packs/week — generous enough that word-of-mouth beats
  extraction. Tightening would create the wrong "greedy product"
  signal.
- Pack generation API still auth-required but not Pro-gated. Any
  signed-in user can generate Packs up to the underlying live-comp
  quota. No schema changes needed.
- Stripe $29/mo price ID is unchanged. No one-time Pack purchase path
  yet — deferred until repositioning has been live long enough to see
  whether there's demand for that specific wedge (see §20.19 plan
  below).

**Result:** 169/169 tests pass (+1 homepage invariant). tsc + next build
clean. Homepage and /pricing now name the Pack as the primary product;
the 3-free-Packs-per-week quota is the front-door hook that replaces
the previous "3 analyses per month" framing (which was inaccurate to the
actual rate limiter anyway).

### 20.17 Walk-away price market-value cap — SHIPPED 2026-04-22

**Bug (user-reported):** On a listing at $539,800 asking with comp-derived
fair value $472,000, the walk-away card was displaying **`POOR ≤ $3,459,000`**.
A walk-away price 6.4× list and 7.3× fair value is not a negotiation
number — it's product-ending nonsense in an investor demo.

**Root cause:** `findOfferCeiling` (`lib/calculations.ts` L947) binary-searched
the range `[$1k, max(listPrice × 5, $5M)]` for the max price at which the
*income rubric* (DSCR, cap rate, cash flow, IRR) still cleared each tier.
On rent-heavy listings — especially ones where `monthlyRent` from RentCast
overstated what the property actually rents for — the solver happily
returned $3.4M because "even at $3.4M the cash flow math clears POOR."
Market value was never checked. The ceiling was pure income math with
zero overpayment discipline.

**Fix:** `findOfferCeiling` now accepts a `marketValueCap` option. The
solver's upper bound is clamped to `min(rubricUpper, cap × premium)`, so
every returned tier ceiling is simultaneously constrained by (a) the
rubric and (b) "never pay more than N% over market value."

| Caller | Anchor used | Rationale |
| --- | --- | --- |
| `/results` page (`OfferCeilingCard`) | `comps.marketValue.value` if available, else `inputs.purchasePrice` | Prefer comp-derived fair value; fall back to list price when comps haven't been pulled (fast-estimate mode per §20.8). |
| `lib/negotiation-pack.ts` (`buildPack`) | `comps.marketValue.value`, else `listPrice` | Same discipline flows into the Pack payload + PDF so the counteroffer script never suggests paying 6× market value. |
| `app/api/og/route.tsx` | `inputs.purchasePrice` | OG previews have no comp access. List-price cap prevents a shared social-card image from ever displaying an absurd walk-away number. |

Default `marketValueCapPremium = 1.05` — a 5% "I want this specific
property" cushion over the anchor. Above that, paying more is buying
negative equity on day one no matter how well the income math works. The
premium is configurable per-call; pass `1.0` for a hard cap at the anchor.

**UI copy:** `OfferCeilingCard` now shows a small explanatory line at the
bottom of the card:

- **Cap is binding** (rubric ceiling > cap): *"Bounded by comp-derived
  fair value: walk-away ceiling capped at $495,600 (5% premium over
  anchor). The income rubric alone would accept a higher price, but
  paying above market value means buying negative equity on day one."*
- **Cap is non-binding** (rubric ceiling ≤ cap): *"Market-value anchor:
  $X (5% premium over comp-derived fair value). The rubric ceilings
  above are all below this — the income math is the binding constraint
  here, not overpayment risk."*

This flips the walk-away card from "here's the math ceiling, good luck"
into "here's the market-disciplined walk-away price, and here's exactly
why we set it here." That's a demo-defensible story.

**Reproducer test:** `lib/calculations.test.ts` now includes a
`marketValueCap` describe block with six tests, the first of which
asserts that on a rent-heavy listing (`$540k list, $15k/mo rent`) the
uncapped rubric returns ceilings >$1.6M — reproducing the exact bug shape
— and the next tests prove the cap clamps them to ≤$495,600 (cap × 1.05).
Locks in regression prevention.

**Result:** 168/168 tests pass (+6 from 162). tsc + next build clean.
The $3,459,000 walk-away number on a $540k listing is now impossible —
any tier ceiling on that listing is mathematically bounded at
`max(listPrice, fairValue) × 1.05`.

### 20.15 Next chat starting prompt — USE THIS ONE

```
Read §20.18 first (Pack-first repositioning — shipped 2026-04-22),
then §20.17 (walk-away market-value cap — shipped same day, fixes
user-reported $3.4M-walk-away-on-$540k-listing bug), then §20.16
(Negotiation Pack + Comp Reasoning Explainer + $29 reprice), then
§20.14 (§20.8 architecture), then §20.13 (§20.9 items 1–9). The whole
roadmap from §20.3, §20.4, §20.7, §20.8, §20.9, §20.10, §20.17, §20.18
is in. 169 tests pass. tsc + eslint + next build all clean.

Next strategic focus (user-approved "move forward" direction):
  - Reposition funnel copy + free tier — target newer investors making
    their first 10 offers; reframe free tier (e.g., unlimited fast
    estimates + 1 free Pack lifetime, or 10 live comp pulls/month).
  - Ship one-time Pack purchase path ($19-29 Stripe Checkout, no
    signup required until after payment) so the Pack has a lower
    friction way to get in front of buyers.
  - Calibration gauntlet: 10 more listings across diverse markets +
    property types to validate the engine. User should source these.

Two manual operator tasks remain before launch:
  1. Run supabase/migrations/004_negotiation_packs.sql in the Supabase
     SQL editor (idempotent). Without it /api/pack/generate 500s.
  2. Create the new $29/mo Stripe Price (Stripe forbids editing live
     Price amounts), update STRIPE_PRICE_ID_PRO in Vercel + .env.local,
     verify the checkout session shows $29.

Then collect investor demo signal (§19.5). Need at least one "I'd pay
for that specifically" before flipping Stripe to live mode. That's the
gate.

If a third listing audit comes in, run it through the same protocol as
the first two (§16.U, §16.U.1) — only revisit §20 if it produces a BUY
mislabeled as AVOID for reasons the user rejects.

Pending P2 polish (do these only when there's a clear product reason):
  - §20.9 #11 — cross-tab numeric reconciliation (one number per metric
    everywhere on /results). The Reality Check / How We Got These
    reconciliation in §20.9 #4 already half-handled this; #11 is the
    remaining audit pass.
  - §20.9 #12 — garbled negative-CF copy. Some empty-state strings
    still read awkwardly when monthly cash flow is negative.

If you want to re-validate the prior fixes before building on top of
them, the historical specification of what shipped is below — kept for
audit purposes only.

Original §20.9 ship order, all complete:
  1. Homestead-trap property tax fallback (highest impact — affects
     every IN/FL/TX/CA/GA investment property the product has analyzed)
  2. Property-type misclassification (Condo on HOA-lite SFR)
  3. State detection in Zillow-URL flow (direct-address flow works,
     scope the fix to URL normalization only)
  4. Reality Check card sqft normalization + anchor-blend reconciliation
     (two-listing-confirmed; card and PDF derivation say different
     things about the same comp pool on every listing)
  5. Strip internal error text from user UI
  6. RentCast 401/403 monitoring + uptime check + key-rotation runbook
  7. dedupeByBuilding near-duplicate address fix (rent pool integrity
     in thin markets)
  8. $/sqft outlier z-score filter in comp scoring (so anchor-blend
     stops doing the comp pool's cleanup work)
  9. Stress-test verdict-flip transparency (add IRR + Total ROI columns,
     surface the metric driving any verdict change inline)

Listing #3 audit is still pending but NOT blocking. If user sends it,
audit and append as §16.U.2. Only revisit §20 if listing #3 produces a
BUY mislabeled as AVOID for reasons the user rejects.
```
