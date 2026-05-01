# RealVerdict — Current State Context
## Last updated: April 29, 2026

---

## What this product is

RealVerdict is a lightweight desktop CRM for active rental property investors. 
Target user: someone actively shopping for their next rental property, looking 
at 20-30 listings a week, needs to know fast whether a deal works and what to offer.

The product is intentionally lightweight. Fast, focused, sharp. Not a heavy 
dashboard. Every feature earns its place.

**Core value proposition:** Every competitor (DealCheck, Mashvisor, Stessa) 
gives you metrics. RealVerdict gives you a decision — should I pursue this 
and what should I offer. The walk-away price and AI narrative are the 
differentiated features. Tagline: "DealCheck calculates. RealVerdict closes."

---

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Electron (electron-app/) |
| Web app / UI | Next.js App Router + Turbopack |
| Styling | Tailwind + shadcn/ui |
| Auth + DB | Supabase |
| Payments | Stripe (test mode) |
| Deployment | Vercel (web) |
| AI | Anthropic Claude (claude-haiku-4-5-20251001) |

The Electron app is a shell that loads the Vercel URL. UI changes → push 
to GitHub → Vercel auto-deploys → users see it instantly. No reinstall needed 
unless electron-app/main.js or preload.js change.

---

## Current architecture — what was built in the last session

### The full rebuild that happened

The app was completely restructured from a website-style multi-page app into 
a persistent desktop CRM shell. This was a ground-up architectural change.

**What was deleted:**
- /dashboard — redundant, redirected to /deals
- /search — redundant, redirected to /deals  
- /leads — redundant, redirected to /deals
- /compare — not integrated into CRM shell
- /results — rebuilt as a minimal share-link view only
- HomeAnalyzeForm, InitialVerdict, HowWeGotThese, OfferCeilingCard — all deleted
- SavedDealDetail — replaced by AnalysisPanel
- DashboardClient — dead code, deleted
- ResultsShell Electron detection — simplified

**What was built:**
- /deals — the new primary authenticated landing (card grid + analysis panel)
- AnalysisPanel — canonical analysis display component used everywhere
- AI narrative system — Claude generates deal narratives, stored in Supabase
- Auto-save — new analyses save automatically, no manual save button needed
- Delete deals — trash icon on hover, confirmation, instant UI update

---

## App structure — authenticated shell

```
Sidebar (4 items):
  Deals     → /deals     (primary — pipeline + analysis)
  Research  → /research  (Electron browser for browsing listings)
  Insights  → /insights  (stub, coming later)
  Settings  → /settings  (account + billing)
```

After login, Electron navigates to /deals. The sidebar is collapsible to 
icon mode. Width 200px expanded, 52px collapsed.

---

## The Deals view — the centerpiece

**Layout:** Two zones side by side.

**Left zone (card grid):**
- Search bar at top — accepts Zillow URL or street address
- Filter pills: All / Strong Buy / Good Deal / Fair / Risky / Walk Away
- Two-column card grid of saved deals
- Clicking a card opens the right panel

**Right zone (analysis panel):**
- Opens when a card is clicked
- Shows the full deal analysis
- Closeable with X button

**Card design (SavedDealCard.tsx):**
- 4px left border in tier accent color
- Address (truncated)
- Property facts strip (beds · baths · sqft) if available
- Verdict badge (Strong Buy / Good Deal / Fair / Risky / Walk Away)
- Walk-away price — dominant number, text-[22px] font-bold
- Three metrics in a row: cash flow (colored), cap rate, DSCR
- Timestamp bottom right
- Delete icon — hidden, appears on hover only

**Auto-save behavior:**
New analyses save automatically when signedIn && isPro && supabaseConfigured. 
AI narrative generates immediately after save in background. 
No manual save button for new analyses.
Duplicate prevention: checks for same purchasePrice + monthlyRent in last 5 minutes.

---

## The Analysis Panel (AnalysisPanel.tsx)

No tabs. Pure vertical scroll. Three zones:

**Zone 1 — AI Narrative (top)**
- Shows if ai_narrative exists with non-empty content
- summary: text-sm text-foreground leading-relaxed
- opportunity: text-sm text-muted-foreground, emerald dot prefix
- risk: text-sm text-muted-foreground, amber dot prefix
- No label, no "AI" badge — content earns its own authority
- max-w-[65ch] for readable line length

**Zone 2 — Decision**
- Walk-away price: large, font-mono, dominant
- Asking price and gap below it
- Tier accent left border on the container

**Zone 3 — Metrics**
- Open grid, NO boxes or tiles
- Four numbers sitting directly on dark surface
- Values: text-[15px] font-mono font-semibold on top
- Labels: text-[10px] uppercase tracking-wider muted below
- Secondary row: GRM · Break-even · IRR · LTV in one muted line

**Then inline (no tabs):**
- Stress test table (StressTestPanel)
- Monthly breakdown waterfall (BreakdownSection)
- Year-by-year projection table

**Panel header:**
- Verdict badge with tier accent color (orange "Risky", red "Walk Away" etc.)
- Address and property facts

---

## AI Narrative System

**Route:** /api/deals/narrative/route.ts

**Trigger:** Fires after auto-save completes. Also fires retroactively when 
a saved deal with missing/empty narrative is clicked.

**Model:** claude-haiku-4-5-20251001 via Anthropic SDK direct (not AI SDK)

**Storage:** deals.ai_narrative (jsonb) — { summary, opportunity, risk, generatedAt }

**Voice rules (system prompt):**
- Maximum 15 words per sentence
- No semicolons, no em dashes, no compound clauses
- summary: one sentence, verdict + biggest reason, specific number
- opportunity: two sentences max, real numbers, specific upside
- risk: two sentences max, specific threat with exact number
- Never generic — every statement references actual computed data

**Data sent to Claude:**
purchasePrice, monthlyRent, downPaymentPercent, loanInterestRate,
monthlyCashFlow, capRate, cashOnCashReturn, dscr, grossRentMultiplier,
irr, totalCashInvested, breakEvenOccupancy, verdict.tier, verdict.score,
verdict.summary, walkAway.recommendedCeiling, primaryTarget,
totalProfit, totalROI, netSaleProceeds, holdPeriodYears,
firstPositiveCashFlowYear, totalCashFlow, projectedSalePrice, address

**Client-side:** localNarratives Map stores narrative immediately when route 
responds — no dependency on router.refresh() for display.

---

## Verdict tiers

```
"excellent" → Strong Buy  (emerald  #00c896)
"good"      → Good Deal   (green    #4ade80)
"fair"      → Fair        (amber    #f59e0b)
"poor"      → Risky       (orange   #f97316)
"avoid"     → Walk Away   (red      #ef4444)
```

Defined in lib/tier-constants.ts and app/(app)/_components/results/tier-style.ts

---

## Design system — current state

**Font:** Inter (next/font/google), tabular-nums globally on body

**Color palette (dark mode):**
- Background:  oklch(0.095 0.012 250) — deep cool near-black
- Card:        oklch(0.135 0.011 250) — slightly elevated
- Sidebar:     oklch(0.110 0.012 250) — slightly darker than shell
- Secondary:   oklch(0.185 0.010 250)
- Border:      oklch(1 0 0 / 8%)
- Foreground:  near white, cool
- Muted:       oklch(0.55 0.008 250)

**The only real color in the UI is the verdict tier accent.** Everything else 
is monochrome.

**Spacing:** Sections use space-y-7 (28px). Hairline dividers between sections.

---

## Database — Supabase

```
deals table columns:
  id            uuid PK
  user_id       uuid FK → auth.users
  created_at    timestamptz
  address       text (nullable)
  inputs        jsonb (DealInputs)
  results       jsonb (DealAnalysis)
  verdict       text
  property_facts jsonb (nullable)
  ai_narrative  jsonb (nullable) — { summary, opportunity, risk, generatedAt }
```

Migrations applied: 001_deals, 002_compare_entries, 003_subscriptions, 
004_negotiation_packs, 005_property_facts, 006_ai_narrative

---

## What does NOT change — ever

- lib/calculations.ts — all engine math
- lib/comps.ts, lib/comparables.ts, lib/negotiation-pack.ts
- lib/estimators.ts, lib/market-data.ts, lib/market-context.ts
- All API routes under app/api/ (except narrative prompt text)
- electron-app/preload.js
- app/(marketing)/ — the public marketing website
- lib/supabase/, lib/ratelimit.ts, lib/pro.ts
- All vitest tests — 185 total, 7 known pre-existing failures

**Run npm run check before and after every change.**

---

## Known issues / what's still not done

- Insights page is a stub — no real data, shows "coming soon"
- Stripe is in test mode — no paying customers yet
- Canonical public URL is **realverdict.app** (Electron packaged build defaults
  to `https://realverdict.app`; override with `REALVERDICT_APP_URL` for previews).
  Set `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` in Vercel to match.
- Walk-away price in the panel could be more visually dominant
- No Strong Buy deal in the pipeline to test positive verdict state
- Research page web fallback is minimal (desktop-only feature)
- The Negotiation Pack (PDF export) exists but Pack generate button 
  only shows when livecomps ran — most analyses are fast estimates

---

## Turbopack constraint — CRITICAL

Never write this in JSX:
```tsx
{someNumber}/{otherNumber}          // ❌ Turbopack sees / as regex
style={{ width: `${x}%` }}         // ❌ can break Turbopack
```

Always write:
```tsx
{someNumber + "/" + otherNumber}    // ✅
style={{ width: x + "%" }}         // ✅
```

---

## Environment variables required

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY              ← required for AI narrative
STRIPE_SECRET_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
RENTCAST_API_KEY
```

---

## Current quality gates

- TypeScript: clean
- ESLint: 1,789 pre-existing errors all in compiled artifacts 
  (electron-app/, .next/, extension/) — zero in source files
- Vitest: 178 pass, 7 known pre-existing failures
- next build: clean
