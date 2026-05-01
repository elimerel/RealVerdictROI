# RealVerdictROI — Project Handoff

> **How to read this doc (agent pointer, 2026-05-01):**
>
> This file is the active spec. It's intentionally short. For **desktop
> shell routes** (`app/(app)/`), UX polish tokens, and the current
> Pipeline/Browse mental model, also read `CONTEXT.md` and
> `REALVERDICT_CONTEXT.md` — they track the Electron-first surface.
> Historical web-`/results` Pack-era detail lives in `HANDOFF_ARCHIVE.md`.
> Don't re-read the archive every turn.
>
> **Read top-to-bottom on the first turn of a new chat.** After that,
> jump to the section that matches the task:
>
> - Starting fresh? → **§1 Current state + §1b Roadmap + §15 Next chat prompt**
> - Touching **Browse / Pipeline / `DossierPanel`?** → **§5.1** + `CONTEXT.md`
> - Touching the engine or `findOfferCeiling`? → **§6, §7**
> - Touching **extract → analyze** wiring / APIs in *this* tree? → **§8**
> - Touching **marketing pages**? → **§10**
> - **Historical** `/results`, Pack, `property-resolve`, RentCast resolver UI?
>   → **`HANDOFF_ARCHIVE.md` only** (paths may not exist here; grep first).
> - Philosophy / positioning disagreement? → **§2** then archive §20.5–20.11.
>
> Rules that never bend:
> - No I/O in `lib/calculations.ts` — same input, same output, always.
> - Every `/results` input lives in the query string. Don't hide state.
> - Don't add a metric without a matching `scoreXxx()` RubricItem.
> - Fix the derivation, don't paper over it with a warning bubble.
> - No emojis in product UI unless the user explicitly asks.

---

## 1. Current state

**Shipped and live** (as of 2026-05-01):

- **Desktop product (primary surface)**: The shipped experience is an
  **Electron** app whose renderer loads the **Vercel-hosted Next.js**
  app (`app/(app)/`). **Bundling the renderer as a static export inside
  the `.app` is explicitly off the table** for now: the app depends on
  Supabase, Stripe, AI, and server routes, so a `next export`-style
  move would be a large backend/architecture project, not a polish item.
  Improvements that don't require that refactor ship as UI + optional
  main-process tweaks (window state, IPC, etc.).
- **UX polish (Phase 1–2 boundary)**:
  - **Polish pass v1** (shipped): Muted severity palette,
    worst-offender-only metric coloring (`lib/severity.ts`), native-style
    inputs (`.rv-input`), chips (`.rv-chip`), pill CTA (`.rv-pill`),
    sidebar tooltips, global ⌘ shortcuts (`KeyboardShortcuts.tsx`),
    drag regions on headers, JetBrains Mono wired for `font-mono`,
    window bounds persistence in `electron-app/main.js`.
  - **Polish pass v2 — readability & craft** (shipped): Explicit text
    tiers (`--rv-t1` … `--rv-t4` / `.rv-t1` … `.rv-t4` in `globals.css`),
    `DossierPanel` split into clear modules (identity / hero / summary /
    assumptions surface / collapsibles), **28px** hero numbers with
    compact cash-flow display, Pipeline table density + brighter primary
    copy, active sort column highlighting, **sidebar defaults to
    icon-collapsed** (`SidebarProvider defaultOpen={false}`), scroll
    containment fixes on the right panel (`overscroll-behavior: contain`
    + removed clipping wrappers where needed).
  - **Deferred for later**: Fake dark mode for embedded Zillow
    (`invert` in webview) — trialed as quick fix only; full
    "our own listing summary card" belongs with future extension /
    architecture work.
- **Engine**: `findOfferCeiling` disciplined by comp-derived market value
  (5% premium allowed). The $3.4M-walk-away-on-$540k-listing bug is gone.
- **Architecture (§20.8, archive era)**: full-page `/results` used fast
  estimate by default (no RentCast) until `?livecomps=1`. **This tree**
  uses **Browse + `DossierPanel`** instead of that page — the pattern
  still informs API cost discipline if resolver routes return.
- **Negotiation Pack** (historical / other branches): one-click PDF export
  from a full **`/results`** + live-comps flow was shipped in the **archive**
  era. **This repository revision** does not include `app/pack/` or
  `/api/pack/generate` — treat Pack as **roadmap / marketing copy** until
  routes are reintroduced.
- **Comp Reasoning Explainer** (archive / `/results` Comps tab): rendered
  why each comp was included or excluded. Not bundled here; see archive
  if re-porting comp UI.
- **Pricing**: single $29/mo Pro tier. Free tier: 3 live comp analyses/week
  (same window the rate limiter enforces; aligns with homepage + pricing).
- **Homepage + pricing copy**: ICP = **buy-and-hold rental investors**.
  Underwriting + walk-away first; Pack when negotiating. Hero eyebrow
  "Buy-and-hold rental investors" / walk-away headline (see `app/page.tsx`).
- **Monetization infrastructure**: Stripe checkout + portal + webhook,
  Supabase `subscriptions`, per-user + per-IP free-tier limiters,
  Supabase `negotiation_packs`. Stripe is in test mode until we have at
  least one "I'd pay for that specifically" investor demo.
- **Quality gates**: 185 vitest tests pass; `npx tsc --noEmit` clean;
  `npx eslint` clean; `next build` clean.

**Pending** (in priority order, from `HANDOFF_ARCHIVE.md §20.15`):

1. **Calibration gauntlet** — user pastes 10 listing URLs into
   `calibration/listings.json` and runs `npm run calibrate`. Report
   flags anything failing objective sanity checks (walk-away band, cap
   rate band, cash-flow identity, list-vs-comp sanity, rent sanity,
   comp-pool depth). **Scoring no longer asks for user gut verdicts**
   (see 2026-04-22 ship note below).
   - **Tooling**: `calibration/listings.json` + `npm run calibrate` +
     `app/api/calibrate/route.ts`. Writes a timestamped Markdown report
     to `calibration/results-<stamp>.md`. Process exits non-zero on any
     sanity-check failure. See `calibration/README.md`. Production
     calls require `CALIBRATION_SECRET` env.
2. **Investor demo signal** — at least one person who says "I'd pay for
   the Pack specifically." Only after that do we flip Stripe to live.
3. **One-time Pack purchase path** — $19–29 Stripe Checkout with no
   signup until after payment. Deferred; only build if demand signals.
4. ~~**Dashboard polish**~~ Shipped 2026-04-22.
5. ~~**Garbled negative-CF copy**~~ Shipped 2026-04-22.
6. ~~**Error boundary on `/results`**~~ Shipped 2026-04-22.
7. ~~**Cross-tab numeric reconciliation (§20.9 #11)**~~ Shipped
   2026-04-22. Cross-tab audit found and fixed: Pack route was passing
   `currentListPrice` unconditionally while `/results` gated it on
   `?listed=1`, so Pack fair value + walk-away could drift from what
   the page showed. Fixed by threading `isListed` through
   `PackGenerateButton` → `/api/pack/generate`. Cap rate standardized
   to 2 decimals everywhere (was 1 in hero, 2 in Evidence). "Total
   return" ($) in Evidence renamed to "Total profit" to disambiguate
   from "Total ROI" (%) on Stress / What-if.
8. ~~**AI chat underutilization**~~ Shipped 2026-04-22. `/api/chat`
   now accepts an optional `analysisContext` (walk-away price, fair
   value, market rent, top-3 weak assumptions) computed once in
   `app/results/page.tsx` and piped into both `InitialVerdict` and
   `FollowUpChat`. System prompt cites the walk-away explicitly when
   the user asks "what should I offer?" — no more AI-invented numbers
   contradicting OfferCeilingCard. Chat's rent-10% and rate+1pt stress
   scenarios now run the full `analyseDeal` instead of a simplified
   delta, matching the Stress tab.
9. ~~**Calibration oracle model**~~ Shipped 2026-04-22. Previous
   "score vs operator gut" model was flawed (operator isn't an
   investor). Replaced with 9 objective sanity checks baked into
   `/api/calibrate` response. Operator only needs to paste URLs —
   zero gut input required.

**Manual operator tasks (required before launch):**

- Run `supabase/migrations/004_negotiation_packs.sql` in the Supabase SQL
  editor. Without it `/api/pack/generate` 500s. Idempotent.
- Create the $29/mo Stripe Price (Stripe forbids editing live Price
  amounts), update `STRIPE_PRICE_ID_PRO` in Vercel + `.env.local`,
  verify checkout shows $29.

### 1b. Product roadmap (direction locked with user, 2026)

Ordered phases — later phases are **future**, not current sprint work:

| Phase | Focus | Notes |
|-------|--------|--------|
| **1** | Visual / native-feel polish **without** renderer bundling | Largely shipped (polish v1 + v2). |
| **2** | Native shell quality | Splash, skeletons, prefetch, native menus, notifications, window polish, auto-updater, tray — **still open**; no static-export requirement. |
| **3** | Web dashboard | Lift Pipeline + compare to **app.realverdict.com** (or similar). |
| **4** | Chrome extension | In-browser underwriting; pairs with "our panel over listing" story. |
| **5** | Marketing site | Rebuild **realverdict.com** around the new product narrative. |

**Explicitly out of scope (for now):** Rewriting Electron to embed a fully offline/static Next build unless/until backend is re-architected — cost estimate was on the order of **20–40+ hours** and was rejected in favor of phased polish above.

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
- **Don't remove underwriting transparency** from the active analysis UI.
  On legacy `/results` that was `HowWeGotThese`; today **`DossierPanel`**
  carries factual summary + assumption provenance — don't strip it.
- **Don't reintroduce the mocked analysis universe.** All analysis goes
  through `analyseDeal()`. Primary surfaces today: **`DossierPanel`** on
  `/research` and `/deals`; legacy **full-page `/results`** may exist only
  in other branches or the archive — **grep this repo** before assuming.
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

### 5.1 This repository (authoritative — Electron + slim web app)

**Always verify with `glob` / your IDE**; this list can drift.

```
app/
  layout.tsx                 # Root: fonts (Inter + JetBrains Mono), theme, analytics
  globals.css                # Tailwind 4 + .rv-* design tokens
  sitemap.ts, robots.ts
  auth/callback/route.ts     # Supabase OAuth
  (app)/                     # Authenticated product shell
    layout.tsx               # SidebarProvider (default collapsed), KeyboardShortcuts
    research/page.tsx        # Browse — browser + DossierPanel
    research/_components/
    deals/page.tsx, deals/DealsClient.tsx, deals/SavedDealCard.tsx
    settings/page.tsx
    insights/page.tsx        # Stub / non-core unless product revives it
    components/              # electron-expand, sidebar-data-loader
    _components/
      DossierPanel.tsx       # Canonical analysis panel
      KeyboardShortcuts.tsx
      VerdictRubric.tsx, SaveDealButton.tsx, …
  (marketing)/               # Public marketing site (route group)
    page.tsx                 # Homepage at /
    pricing/, about/, methodology/, download/, privacy/, terms/, report/
    _components/
  (auth)/login/              # Login UI
  api/
    extract/route.ts         # Listing extraction → lib/extractor
    deals/save/route.ts, deals/[id]/route.ts
    compare/route.ts
    stripe/{checkout,portal,webhook}/route.ts
    auth/signout/route.ts
    report-concern/route.ts
    og/route.tsx
electron-app/
  main.js                    # Window, WebContentsView bounds, state persistence
  preload.js                 # contextBridge → electronAPI
lib/
  calculations.ts            # Pure engine (§6)
  severity.ts                # Worst-offender coloring for metrics
  extractor/                 # Page → DealInputs
  lead-adapter.ts, tier-constants.ts, types.ts
  supabase/, stripe.ts, pro.ts, ratelimit.ts, kv-cache.ts, …
components/
  layout/app-sidebar.tsx     # Browse | Pipeline | Settings
  ui/                        # shadcn
supabase/migrations/
tests/
```

### 5.2 Not in this tree (archive / other branches)

These appear in **`HANDOFF_ARCHIVE.md`** and older prompts but **are not
present in this checkout**: full-page **`app/results/`**, **Pack**
routes (`/api/pack/*`, `app/pack/`), **`/api/property-resolve`**, **`/api/comps`**,
**`HomeAnalyzeForm`**, **`lib/comparables.ts`**, **`lib/negotiation-pack.ts`**, etc.
**Grep before importing** from the archive; treat archive prose as
**historical** unless you reintroduce the files.

---

## 6. Calculation engine (`lib/calculations.ts`)

Exports to remember — almost every change touches one:

```ts
DealInputs                   // Input schema
AnalyseDealOptions           // Optional comp-derived market rent for verdict rubric
DealAnalysis                 // Output: projection, KPIs, verdict
VerdictTier                  // "excellent" | "good" | "fair" | "poor" | "avoid"
RubricItem / Verdict         // Scored signals + rollup
DEFAULT_INPUTS
analyseDeal(inputs, evidence?) // Pure. No I/O. Second arg adds "Pro forma vs comps rent" rubric row only — KPIs still use the user's monthlyRent.
sanitiseInputs(raw)          // Clamps every numeric field to a sane range.
findOfferCeiling(inputs, { marketValueCap?, analyseDealOptions? }) // Walk-away — see §7.
inputsToSearchParams / inputsFromSearchParams  // Deep linking (when used)
formatCurrency / formatPercent / formatNumber
```

The file is large — rubric, scoring, projection, DSCR, IRR, cap,
cash-on-cash, break-even, GRM, `findOfferCeiling`. Don't split casually;
cohesion keeps changes safe.

**Optional `evidence` / comps:** When a deployment has live comp
derivation, callers pass `AnalyseDealOptions` so the rubric can react to
pro-forma vs market rent without rewriting the user's rent. This repo's
**desktop flow** may not wire that path — check call sites in
`DossierPanel`, `DealsClient`, `research/page.tsx`, and tests.

---

## 7. `findOfferCeiling` — the walk-away solver

Lives in `lib/calculations.ts`. **In this repo** it is consumed by
`DossierPanel`, `DealsClient` / `SavedDealCard`, `research/page.tsx`, and
`app/api/og/route.tsx`. Older **OfferCeilingCard** / full-page `/results`
UIs are **not in this tree** — see the archive if you need that UX spec.

```ts
export type OfferCeiling = {
  excellent?: number;
  good?: number;
  fair?: number;
  poor?: number;
  currentPrice: number;
  currentTier: VerdictTier;
  recommendedCeiling?: { price: number; tier: VerdictTier };
  /** Best tier reachable within ≤15% under list; excludes `poor` (PASS). */
  primaryTarget?: { price: number; tier: VerdictTier; discountPercent: number };
  stretchTarget?: { price: number; tier: VerdictTier; discountPercent: number };
  marketValueCap?: {
    cap: number;
    source: "comps" | "list";
    binding: boolean;
  };
};

findOfferCeiling(inputs, {
  marketValueCap?: number,
  marketValueCapSource?: "comps"|"list",
  marketValueCapPremium?: number,      // default 1.05 — 5% over anchor
  analyseDealOptions?: AnalyseDealOptions,
});
```

**Algorithm (summary):**

- Verdict score is monotonically non-increasing as price rises.
- Binary search on `[1k, min(rubricUpper, marketValueCap * premium)]`.
- Rounded to $500.
- **`primaryTarget` never uses PASS (`poor`).** When nothing better than
  PASS clears the realistic band, treat as a walk-away scenario — **`DossierPanel`**
  surfaces break-even / metrics rather than a full tier ladder card.

**Market value cap:** Without a cap, income-only rubric can produce absurd
ceilings. Callers pass `marketValueCap` from comp fair value or list price
when available. **`DossierPanel`** recomputes `findOfferCeiling` when
assumption inputs change.

---

## 8. Data pipeline **(this repository)**

### 8.1 Listing → `DealInputs`

- **`POST /api/extract`** — `lib/extractor`: AI-assisted extraction from
  listing HTML / structured signals; returns UI-safe error codes (no raw
  provider errors).
- **Electron** `research` flow: main process + IPC feed the same extraction
  path for the embedded browser URL (see `electron-app/preload.js` and
  `research/page.tsx`).

### 8.2 Persistence + compare + billing

- **`/api/deals/save`**, **`/api/deals/[id]`** — saved Pipeline deals.
- **`/api/compare`** — multi-deal comparison for the client.
- **`/api/stripe/*`**, **`/api/auth/signout`**, **`/api/report-concern`**, **`/api/og`**.

### 8.3 Resolver / RentCast / comps (ops)

Some **ops runbooks** still mention **`/api/property-resolve`** and RentCast.
That route **does not exist in this checkout**. When debugging data
quality, **grep `app/api`** and follow **`docs/runbooks/rentcast-key-rotation.md`**
only for steps that match files actually on disk.

---

## 9. Authenticated UI architecture (**`app/(app)/`**)

There is **no** `app/results/page.tsx` **in this tree.** The shipped product
surface is:

- **`DossierPanel`** (`app/(app)/_components/DossierPanel.tsx`) — hero
  metrics (DSCR, cash/mo, cap), summary, assumptions, collapsible
  breakdowns; uses `analyseDeal` + `findOfferCeiling`.
- **Parents:** `research/page.tsx` (Browse), `DealsClient.tsx` (Pipeline
  selection + right rail).

Supporting pieces: `KeyboardShortcuts.tsx`, `SavedDealCard.tsx`, tier styling
from `lib/tier-constants.ts` and local components. **Do not** assume
`app/_components/results/HeroSection.tsx` exists unless you add it back.

---

## 10. Marketing site (`app/(marketing)/`)

**Homepage:** `app/(marketing)/page.tsx` (serves **`/`** via the route group).

**Pricing:** `app/(marketing)/pricing/page.tsx` (+ `GetProButton.tsx`).

**Other public routes in this group:** `about`, `methodology`, `download`,
`privacy`, `terms`, `report`.

Copy may still emphasize Pack / walk-away / investor ICP — **`grep` and
`tests/`** enforce whatever invariants remain. If a test file references
`/results` or Pack routes that are absent, treat the test as **legacy**
until updated (see `tests/pack-routes-invariants.test.ts` status on `main`).

**`HowWeGotThese` on `/results`:** not applicable in this tree unless that
page is reintroduced. Transparency for underwriting is implemented inside
**`DossierPanel`** sections and tooltips instead.

---

## 11. Negotiation Pack + Comp Reasoning (**archive / other branches**)

The **Negotiation Pack** PDF flow, **`/api/pack/generate`**, **`CompReasoningPanel`**,
and the **Comps tab** on a dedicated **`/results`** page are **not implemented
in this repository revision.** The historical spec (data flow, components,
PDF rendering) lives in **`HANDOFF_ARCHIVE.md`** (search for Pack, `pack/generate`,
`CompReasoning`).

If Pack work resumes, **re-add the routes and libs** and update this section —
do not assume those files exist because older HANDOFF text mentioned them.

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
- **`app/(app)/`** analysis surfaces may set tier-driven accents; prefer
  design tokens (`.rv-*`, `TIER_*` helpers) over hard-coded colors.
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
Read HANDOFF.md §1 + §1b + §2 first. CONTEXT.md + REALVERDICT_CONTEXT.md
for the Electron app routes and current UI patterns.

Current surface: Electron loads Vercel-hosted Next.js — primary UX is
Browse (/research) + Pipeline (/deals) + Settings; detail/analysis is
DossierPanel (right rail). Static Next export for Electron deferred;
phased roadmap §1b.

Polish v1+v2 shipped (2026-05): severity discipline, typography tiers,
sidebar default collapsed, panel modules, pipeline table density, scroll
fixes. Phase 2 = native shell quality (see §1b).

**This repo’s on-disk layout** is §**5.1** (`app/(app)/` + extractor APIs).
Pack / full-page `/results` / property-resolve are **§5.2** / archive unless
restored — grep before implementing.

Run npm run check before pushing. HANDOFF_ARCHIVE.md = history + deep engine eras.
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

If you need a fact that isn't in this file, grep the archive. For **what
files exist on disk today**, **§5.1** and a repo search beat archive prose.
If the archive and **§5.1** disagree on layout, **§5.1** wins.
