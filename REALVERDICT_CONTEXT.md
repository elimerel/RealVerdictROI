# RealVerdict — Current State Context

**Last updated: 2026-05-01**

---

## What this product is

RealVerdict is a **desktop-first** underwriting tool for active rental investors shopping many listings per week. It is intentionally sharp and dense: browse a listing, see DSCR / cash flow / cap / walk-away logic fast, save to a pipeline, iterate assumptions without leaving the shell.

**Positioning** (unchanged): competitors lead with dashboards; RealVerdict leads with a **decision** and a negotiable ceiling. Tagline stance: *DealCheck calculates. RealVerdict closes.* Full positioning and guard rails live in **`HANDOFF.md` §2**.

---

## Stack

| Layer | Tech |
|-------|------|
| Desktop shell | Electron (`electron-app/`) |
| UI | Next.js App Router (Vercel) |
| Styling | Tailwind 4, shadcn/ui, design tokens in `app/globals.css` |
| Auth + DB | Supabase |
| Payments | Stripe (test mode in development) |
| AI | Multiple backends by route — OpenAI and Anthropic both appear (narrative, chat, etc.); inspect `app/api/*` for the source of truth |

The Electron **renderer loads the deployed Next app URL**. UI changes ship via Git → Vercel; only **main process / preload** changes require a new DMG.

---

## Architectural decision you must not “unforget”

Shipping a **fully static, offline Next bundle inside Electron** (classic `next export` pattern) was assessed and **deferred**. The product depends on **server routes, Supabase, Stripe, and AI**. A proper offline shell would mean a large backend/IPC refactor (order-of-days work), not a polish task.  

**Implication:** treat the app as **Electron chrome + remote Next** until a deliberate Phase B architecture project is approved. See **`HANDOFF.md` §1 + §1b** for the phased roadmap (native shell polish → web dashboard → extension → marketing site).

---

## Authenticated shell (what actually ships today)

### Sidebar — three destinations only

From `components/layout/app-sidebar.tsx`:

| Label | Path | Purpose |
|-------|------|---------|
| **Browse** | `/research` | Embedded listing browser + **DossierPanel** |
| **Pipeline** | `/deals` | Saved deals — table + cards + same panel |
| **Settings** | `/settings` | Account, defaults, billing |

There is **no Insights item in the sidebar** (any “Insights” route is non-core / stub unless product changes).

**Default sidebar state:** **icon-only** (collapsed) on launch — `SidebarProvider defaultOpen={false}` in `app/(app)/layout.tsx`. Expanded mode shows the RealVerdict wordmark next to the logo; collapsed is **logo only**. Tooltips use ~500ms delay (`TooltipProvider`).

### Pipeline (`/deals`)

Implemented in `app/(app)/deals/DealsClient.tsx` (and related components).

- **Search:** Zillow URL or address.
- **Filters:** chips such as “All”, cash-flow-positive, DSCR threshold, cap threshold (tier verdict filters may still exist in code paths — verify UI).
- **Views:** table (comparison) + card grid; row/card selection opens **`DossierPanel`** in the right rail.
- **Table UX (polish v2):** tighter horizontal padding, **14px** body + mono numerics for metrics, primary address line bright (`text-foreground` / tier tokens), subtitle line smaller; **active sort column** header reads as primary; row hover/selection feedback is **fast** (short transition); **worst-offender-only** cell coloring via `lib/severity.ts`.

**Card view** (`SavedDealCard.tsx`): uses the same severity discipline so one metric “screams red” per card.

### Browse (`/research`)

`app/(app)/research/page.tsx`: browser chrome + **DossierPanel** when analysis is available. Right panel width constant **`RIGHT_PANEL_W = 440`** (was 420) to fit hero numbers.

**Known gap:** embedded listing sites (e.g. Zillow) are **light-themed** inside the dark chrome. A quick **CSS invert** hack in the webview was considered and **not** merged as product quality; the “right” fix is a first-party summary surface or extension overlay — future work.

---

## DossierPanel (replaces “AnalysisPanel” in older notes)

**File:** `app/(app)/_components/DossierPanel.tsx`

Single vertical scroll (with **`overscroll-behavior: contain`** on the scroll container) so **only the panel** scrolls, not the whole window layout.

**Module layout (polish v2):**

1. **Identity** — address (H1-scale), property facts + asking, source badge; bottom hairline.
2. **Hero metrics** — three columns: DSCR, **Cash / mo**, cap rate. Numbers **28px** mono; labels/captions use the `--rv-t*` hierarchy; **only worst metric** gets strong `.rv-tone-*` color.
3. **Summary** — factual one-liner at **primary** text tier (`.rv-t1` / foreground), not washed-out muted gray.
4. **Break-even** — demoted line under summary (tertiary / small).
5. **Assumptions** — section title + **lifted block** (`bg-white/[0.02]`, rounded) containing rent / vacancy / rate / down inputs (`.rv-input`).
6. **Collapsibles** — monthly breakdown, stress test, projection; tertiary labels.

**Cash display:** values like `−$1.2k` / `+$3.4k` avoid truncation; `/mo` context is in the **Cash / mo** label.

---

## Design system snapshot

- **Sans:** Inter. **Mono:** JetBrains Mono (`--rv-font-mono`, Tailwind `font-mono`).
- **Text tiers:** `--rv-t1`–`--rv-t4` in `globals.css` with utilities `.rv-t1` … `.rv-t4` (primary / secondary / tertiary / disabled).
- **Semantic metrics:** `--rv-bad`, `--rv-warn`, `--rv-good` (muted, not neon).
- **Components:** `.rv-input`, `.rv-chip`, `.rv-pill`, `.rv-pill-saved`; severity **`.rv-tone-*`**.
- **Keyboard:** `app/(app)/_components/KeyboardShortcuts.tsx` dispatches custom events for page-level focus targets.

---

## AI narrative

Deal narratives may still be generated and stored on **`deals.ai_narrative`** (jsonb). **DossierPanel** consumes a **short factual summary** when present; full multi-field narrative UX may differ from early “AnalysisPanel” docs. Confirm fields in `DossierPanel` props and `/api/deals/narrative` if changing prompts.

---

## Verdict tiers

Still defined in `lib/tier-constants.ts` / `tier-style.ts` (tier strings like `"excellent"` … `"avoid"` map to Strong Buy → Walk Away labels). Pipeline cards and filters may reference these — grep before editing.

---

## Database (Supabase)

Core tables include `deals`, `subscriptions`, `negotiation_packs`, `compare_entries`, etc. Migrations under `supabase/migrations/` — newer migrations (e.g. concern reports) may exist; **do not** assume only 001–006.

---

## Quality gates

- **`npm run check`** — project gate (tsc, eslint, vitest) before confident merges.
- **Vitest:** historically **7 failures** in `tests/pack-routes-invariants.test.ts` were **pre-existing** (missing legacy files); verify on clean `main` before treating as regression.
- **ESLint:** large warning counts can include generated/electron output — scope lint to `app/`, `lib/`, `components/` when triaging.

---

## What not to do (inherits from HANDOFF)

- No Silent I/O inside `lib/calculations.ts`.
- Don’t “fix” bad underwriting math with warning bubbles only — fix derivation.
- Don’t assume every agent task is **`/results`-first** — desktop **`(app)`** routes are the primary product surface.

---

## Doc map

| File | Role |
|------|------|
| `HANDOFF.md` | Active spec: engine, resolver, `/results`, Pack, positioning |
| `HANDOFF_ARCHIVE.md` | Long history + **2026-05 addendum** at top |
| `CONTEXT.md` | Shorter agent onboarding (should match this file) |
| `AGENTS.md` | Next.js version warning for agents |

If **`HANDOFF.md §1`** and this file disagree on **current desktop state**, update **both** — `HANDOFF.md` wins on engine/Pack facts; **this file** and **`CONTEXT.md`** should stay in sync for Electron UX.
