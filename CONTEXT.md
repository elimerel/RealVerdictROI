# RealVerdict — Project Context

Use this file to onboard any Claude/AI session quickly.

---

## What is this

**RealVerdict** is a desktop app for real estate investors to analyze deals.
You browse a Zillow/Redfin/Realtor.com listing inside the app, hit Analyze,
and instantly get: walk-away ceiling price, cash flow, cap rate, DSCR,
cash-on-cash return, risk signals, and a scored verdict (Strong Buy → Walk Away).

---

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Electron (electron-app/) |
| Web app / UI | Next.js 16 App Router + Turbopack |
| Styling | Tailwind + shadcn/ui |
| Auth + DB | Supabase |
| Payments | Stripe |
| Deployment | Vercel (web) + electron-forge (DMG) |
| AI | Anthropic Claude (claude-haiku-4-5 default, claude-sonnet for analysis) |

---

## Key architecture fact

The Electron app is a **shell that loads the Vercel URL**.
- UI/logic changes → push to GitHub → Vercel auto-deploys → users see it instantly (no reinstall)
- Electron shell changes (sidebar, IPC, window chrome) → need `npm run deploy` to build new DMG

---

## Repository layout

```
realverdictroi/
├── app/(app)/              # All authenticated pages
│   ├── research/page.tsx   # ⭐ Main page — browser + analysis panel
│   ├── results/page.tsx    # Full analysis report page
│   ├── leads/              # Saved Deals CRM (LeadsClient, SavedDealCard, SavedDealDetail)
│   ├── dashboard/          # Dashboard
│   ├── settings/           # User settings
│   └── _components/        # Shared components (ResultsHeader, etc.)
├── electron-app/
│   ├── main.js             # ⭐ Electron main process — window, sidebar, IPC, browser view
│   └── preload.js          # contextBridge — exposes electronAPI to renderer
├── lib/
│   ├── calculations.ts     # ⭐ Core math — analyseDeal(), findOfferCeiling(), sanitiseInputs()
│   ├── market-data.ts      # Free market context — HUD FMR, ZORI rent index, Walk Score
│   ├── market-context.ts   # MarketSignals type + AI market context builder
│   ├── tier-constants.ts   # TIER_ACCENT, TIER_LABEL (Strong Buy / Good Deal / Fair / Risky / Walk Away)
│   ├── types.ts            # Shared types
│   └── calculations.ts     # DealInputs, DealAnalysis types + all ROI math
├── deploy.sh               # One-command deploy: git commit + push + build DMG
└── CONTEXT.md              # This file
```

---

## The research page (most important file)

`app/(app)/research/page.tsx` — the core Electron experience:

- **Left pane**: embedded browser (Electron `WebContentsView` layered on top via IPC)
- **Right panel**: analysis panel, toggled with BarChart3 button, **drag-to-resize** (min 280px, max 600px, default 380px)
- **Analyze button**: reads the current listing page via structured extractors (Zillow/Redfin/Realtor.com) + AI fallback
- **WalkAwayBlock**: shows ceiling price, math breakdown, % over/under
- **RiskSignals**: collapsible (collapsed by default), shows AI-detected red flags
- **ElectronResultsView**: full analysis inside the panel (metrics, score breakdown, actions)

Key components defined in this file:
- `WalkAwayBlock` — ceiling price card
- `RiskSignals` — collapsible risk flag list
- `ElectronResultsView` — full analysis panel content
- `ResearchPage` — main page component

---

## Electron IPC (how browser ↔ app talk)

`window.electronAPI` is exposed via `preload.js`:
- `showBrowser(bounds)` / `hideBrowser()` / `createBrowser(bounds)` — manage WebContentsView
- `navigate(url)` / `back()` / `forward()` / `reload()`
- `analyze()` — runs structured extractor on current page, returns deal inputs
- `onNavUpdate(cb)` — listen for URL/title/isListing changes
- `saveDeal(deal)` — persist to Supabase via IPC

Bounds shape: `{ x, y, width, height }` calculated from sidebar state + panel width.

---

## Core math (lib/calculations.ts)

- `sanitiseInputs(inputs)` — fills in defaults, validates
- `analyseDeal(inputs)` → `DealAnalysis` — all metrics
- `findOfferCeiling(inputs)` → ceiling price targets (primary, aggressive, conservative)
- `inputsToSearchParams(inputs)` — serialize inputs to URL for results page

Key metrics computed: `monthlyCashFlow`, `capRate`, `cashOnCashReturn`, `dscr`, `grossRentMultiplier`, `totalCashInvested`

---

## Verdict tiers

```
"strong"  → Strong Buy  (green)
"good"    → Good Deal   (emerald)
"fair"    → Fair Deal   (yellow)
"risky"   → Risky       (orange)
"walk"    → Walk Away   (red)
```

Defined in `lib/tier-constants.ts` as `TIER_LABEL` and `TIER_ACCENT`.

---

## Market data (lib/market-data.ts)

Free sources, all fail-silently (never block analysis):
- **HUD FMR** — Fair Market Rents by ZIP, requires `HUD_USER_TOKEN` env var
- **ZORI** — Zillow rent index CSV, no key needed
- **HUD AMI** — Area Median Income by county, same `HUD_USER_TOKEN`
- **Walk Score** — requires `WALK_SCORE_API_KEY` (deferred — need domain for API key)

---

## Deploy workflow

```bash
npm run deploy          # in project root
```

This runs `deploy.sh`:
1. `git add -A && git commit` (if there are changes)
2. `git push origin main` → Vercel auto-deploys the web app
3. `cd electron-app && npm install && npm run make` → builds new DMG at `electron-app/out/make/`

**Only reinstall the DMG when `electron-app/main.js` or `preload.js` changes.**
All other changes go live automatically via Vercel.

---

## Known Turbopack quirks (IMPORTANT for Cursor prompts)

This project uses **Next.js 16 with Turbopack**. Turbopack has a parser bug where
it misreads `/` as a regex literal start in certain JSX positions:

**NEVER write this in JSX:**
```tsx
{someNumber}/{otherNumber}          // ❌ Turbopack sees / as regex
style={{ width: `${x}%` }}          // ❌ % after } in template literal can confuse it
```

**Always write this instead:**
```tsx
{someNumber + "/" + otherNumber}    // ✅ or precompute as const scoreText = ...
style={{ width: x + "%" }}          // ✅ string concat instead of template literal
```

---

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
OPENAI_API_KEY
HUD_USER_TOKEN              # HUD FMR + AMI data
WALK_SCORE_API_KEY          # deferred (needs domain)
STRIPE_SECRET_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
```

---

## Current state (as of 2026-04-28)

- Vercel deployment: fixing Turbopack build errors (latest commit: d551e93)
- Electron DMG: built at `electron-app/out/make/RealVerdict-1.0.0-arm64.dmg`
- All UI changes go live via Vercel — no DMG reinstall needed for most changes
- Walk Score integration: deferred until real domain available
