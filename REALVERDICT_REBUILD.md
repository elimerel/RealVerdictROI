# RealVerdict — Desktop CRM Rebuild Brief
## For Cursor / AI-assisted development

---

## 1. What this document is

This is a full architectural and implementation brief for a focused UI
restructure of RealVerdict. The engine, API routes, database, Stripe, and
Electron shell are **not changing**. This is purely a UI and routing
restructure to make the app feel like the desktop CRM it's supposed to be,
not the layered website it currently feels like.

Read this entire document before touching any code.

---

## 2. Background — what the problem is

RealVerdict started as a two-page website: a homepage with a form, and a
`/results` page that showed the analysis. Over time features were layered on
top — a sidebar, saved deals, a dashboard, a research browser — but the
underlying routing model never changed. It is still a website pretending to
be a desktop app.

The symptoms:
- Analyzing a deal navigates you away from what you were doing
- `/results` is a full page destination — context is lost every time
- `/search`, `/dashboard`, and `/leads` all do overlapping jobs; users
  have to pick between three places that answer the same question
- The search page has homepage-style hero copy and explanatory cards
  inside the authenticated app
- The same analysis UI is duplicated in five different places
  (`ElectronResultsView` in research/page.tsx, `SavedDealDetail` in
  leads, `HeroSection` in results, `DealCard` in dashboard,
  `verdict-display.tsx` in components) with slight variations
- `ResultsShell` detects Electron vs web and splits into two render
  paths — a sign the architecture is fighting itself

The one part of the app that already feels right: **the Leads page**.
Resizable panels, list on the left, detail on the right, no full-page
navigations. That pattern needs to become the entire app.

---

## 3. What we are NOT changing

These are completely off-limits for this rebuild. Do not touch them.

- `lib/calculations.ts` — all engine math
- `lib/comps.ts`, `lib/comparables.ts`, `lib/negotiation-pack.ts`
- `lib/estimators.ts`, `lib/market-data.ts`, `lib/market-context.ts`
- All API routes under `app/api/`
- `electron-app/main.js` and `electron-app/preload.js`
- `app/(marketing)/` — the public website stays exactly as it is
- `lib/supabase/`, `lib/ratelimit.ts`, `lib/pro.ts`
- Stripe integration
- `lib/tier-constants.ts`, `lib/stress-scenarios.ts`
- All vitest tests — these must stay green throughout

**Run `npm run check` (tsc + eslint + vitest) before and after every
meaningful change. Do not proceed if it goes red.**

---

## 4. The target — what we are building

### 4.1 Mental model

The app is a **persistent three-zone desktop shell**. The user never
navigates away from it. Content loads into zones; zones don't navigate
to pages.

```
┌─────────┬──────────────────────────┬──────────────────────┐
│         │                          │                      │
│ Sidebar │     Main workspace       │   Analysis panel     │
│  nav    │                          │   (persistent)       │
│         │   Deals list / browser   │                      │
│  4      │   / search results       │   Verdict, metrics,  │
│  items  │                          │   tabs, Pack button  │
│         │                          │                      │
└─────────┴──────────────────────────┴──────────────────────┘
```

### 4.2 Sidebar — 4 items only

Replace the current 5-item nav. New nav items:

```typescript
const navItems = [
  { title: "Deals",    icon: LayoutList, href: "/deals" },
  { title: "Research", icon: Globe,      href: "/research" },
  { title: "Insights", icon: BarChart3,  href: "/insights" },  // see note
  { title: "Settings", icon: Settings,   href: "/settings" },
]
```

**Insights note:** The current `/insights` page has hardcoded fake data
("47 markets tracked", "2,847 deals analyzed"). This is a stub. For now
rename the nav item but keep the existing page. Do NOT add real data to
it in this sprint — that's a separate project. It stays as-is, just
renamed in the nav.

Logo link goes to `/deals` not `/search`.

Remove `Search` and `Saved Deals` from the nav entirely. Their jobs are
absorbed by the Deals view.

### 4.3 The Deals view — the centerpiece

Route: `/deals` (new route, replaces `/search` and `/leads` as the
primary authenticated landing page)

**Layout:** Identical structure to the current Leads page — use
`ResizablePanelGroup` from shadcn/ui exactly as `LeadsClient.tsx` does.

Left panel (default ~35% width):
- Header bar with page title and a search/analyze input at the top
- List of saved deals below (same `SavedDealCard` component)
- Empty state when no deals yet: simple prompt to analyze first deal

Right panel (default ~65% width):
- When a deal is selected from the list → shows `<AnalysisPanel>`
- When nothing is selected → shows an empty state prompt
- When a new analysis is running → shows loading state then `<AnalysisPanel>`

The search input at the top of the left panel is the replacement for
the entire `/search` page. It accepts a Zillow URL or street address,
runs the analysis, and loads the result into the right panel. No page
navigation. No full-screen loading overlay. The result just appears in
the panel.

### 4.4 The analysis panel — the canonical component

**This is the most important new component in this rebuild.**

Create: `app/(app)/_components/AnalysisPanel.tsx`

This component replaces:
- `ElectronResultsView` in `research/page.tsx`
- `SavedDealDetail` in `leads/`
- The right-panel content in the new Deals view

It is a pure display component. It receives data as props and renders
the full analysis. It has no routing knowledge, no URL parsing, no
data fetching.

**Three width states, controlled by a `panelWidth` prop (number in px):**

- **Compact** (< 360px): Verdict badge + walk-away price + 4 key metric
  tiles (cash flow, cap rate, DSCR, CoC) + Save button + "Expand" hint.
  No tabs visible.

- **Expanded** (360px–520px): Everything in compact, plus the full tab
  strip (Numbers / Stress / Comps / Rubric / Ask AI) and their content
  below. This is the primary working state.

- **Focus** (> 520px or explicit focus mode): Full width, all tabs,
  Pack button prominent at top. Browser collapses when this mode is
  active in Research.

The component does NOT have a "view full analysis" button that navigates
anywhere. Depth comes from width, not navigation.

**Props interface:**

```typescript
type AnalysisPanelProps = {
  // Core analysis data
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  address?: string
  inputs: DealInputs

  // Optional rich data (available when livecomps ran)
  comps?: CompsResult | null
  comparables?: ComparablesAnalysis | null
  analysisContext?: ChatAnalysisContext

  // Auth/pro state needed for gating
  signedIn: boolean
  isPro: boolean
  supabaseConfigured: boolean

  // Panel width in px — drives compact/expanded/focus display mode
  panelWidth: number

  // Actions
  onSave?: () => void
  onClose?: () => void

  // Metadata
  savedDealId?: string   // set if this deal is already saved
  isLoading?: boolean    // show skeleton while analysis is running
}
```

**Tab content inside the panel:**

The tabs use the existing components verbatim — no rewrites:
- Numbers tab: `<EvidenceSection>` + `<BreakdownSection>`
- Stress tab: `<StressTestPanel>`
- Comps tab: `<CompsSection>` (Pro-gated same as today)
- Rubric tab: `<VerdictRubric>`
- Ask AI tab: `<FollowUpChat>`

In compact mode, tabs are hidden. In expanded and focus modes, tabs are
visible. Use the existing `<ResultsTabs>` component.

### 4.5 Research page — minimal changes

The Research page already works well. The only change:

Replace the inline `ElectronResultsView` function in `research/page.tsx`
with `<AnalysisPanel>` so it uses the canonical component. The panel
width state and drag handle already exist in that file — keep them as-is,
just swap the component rendered inside the panel.

Remove the `onViewFull` prop and the handler that navigates to `/results`.
There is no "view full analysis" button anymore. The panel itself is the
full analysis.

### 4.6 `/results` — demoted to share-link only

`app/(app)/results/page.tsx` stays but its job changes. It is no longer
a place users navigate to from within the app. It exists solely for:

1. Share links (when someone clicks a shared URL from outside the app)
2. Negotiation Pack links (external recipients)

Inside the app, nothing navigates to `/results`. The `fromelec=1` param
and all the Electron-detection logic in `ResultsShell.tsx` can be removed
— results never come from Electron navigating to `/results` anymore.

The page itself can stay mostly as-is for now — it still needs to work
for share links. What changes is that nothing inside the authenticated
app links to it.

### 4.7 Pages being retired

These routes should be removed or redirected:

- `/search` → redirect to `/deals`
- `/leads` → redirect to `/deals`
- `/dashboard` → redirect to `/deals`

The files `app/(app)/search/`, `app/(app)/leads/`, and
`app/(app)/dashboard/` can be deleted after the Deals view is working
and redirects are in place.

**Do not delete until the Deals view is fully functional and tested.**

---

## 5. Build order — do this sequence exactly

### Step 1 — Build `<AnalysisPanel>` (no routing changes yet)

Create `app/(app)/_components/AnalysisPanel.tsx`.

Start by extracting the display logic from `SavedDealDetail.tsx` — it
is the closest existing implementation to what we want. Then augment it
with the tab strip from `ResultsTabs` and the full tab content.

Verify it renders correctly by temporarily dropping it into the existing
Leads detail panel in place of `SavedDealDetail`. Run `npm run check`.
Everything should still pass.

Do not change any routes in this step.

### Step 2 — Wire Leads to use `<AnalysisPanel>`

In `app/(app)/leads/LeadsClient.tsx`, replace `<SavedDealDetail>` with
`<AnalysisPanel>`. Pass `panelWidth` from the resizable panel's current
width (use a `ResizeObserver` on the panel ref, or start with a static
default of 400).

Verify the Leads page still works and looks better. Run `npm run check`.

### Step 3 — Build the Deals view

Create `app/(app)/deals/page.tsx` and `app/(app)/deals/DealsClient.tsx`.

The layout is `ResizablePanelGroup` exactly like Leads. Left panel shows
the deal list + search input. Right panel shows `<AnalysisPanel>` for
whichever deal is selected.

The search input in the left panel header:
- Accepts Zillow URL or street address (same logic as current `/search`
  page's `submitSearch` function — copy it)
- On submit: calls `/api/property-resolve` (address) or the analyze
  pipeline (URL), shows a loading state in the right panel, then loads
  the result into `<AnalysisPanel>` when done
- Does NOT navigate to `/results`
- Newly analyzed deals are NOT auto-saved. There is a Save button inside
  `<AnalysisPanel>` the user clicks deliberately.

Data for the deal list comes from Supabase `deals` table, same query
as the current Leads page.

The default landing state (no deal selected) shows a simple empty-state
message in the right panel.

### Step 4 — Update the sidebar nav

In `components/layout/app-sidebar.tsx`:
- Replace the 5 nav items with the 4 new ones
- Change logo link from `/search` to `/deals`
- Update icons as needed

In `electron-app/main.js`:
- Change the post-login navigation from `/search` to `/deals`
  (the `expandToMainApp` function)

### Step 5 — Wire Research to use `<AnalysisPanel>`

In `app/(app)/research/page.tsx`:
- Replace the inline `ElectronResultsView` component with
  `<AnalysisPanel>`
- Remove `onViewFull` and the handler that pushes to `/results`
- Keep all the panel width state and drag handle logic — just change
  what renders inside the panel

### Step 6 — Add redirects and clean up

In `app/(app)/search/page.tsx`: add redirect to `/deals`
In `app/(app)/leads/page.tsx`: add redirect to `/deals`
In `app/(app)/dashboard/page.tsx`: add redirect to `/deals`

After redirects are confirmed working, delete the old page directories.

Update `electron-app/main.js` anywhere it references `/search` as a
URL to load.

### Step 7 — Clean up `ResultsShell`

`app/(app)/_components/results/ResultsShell.tsx` detects Electron vs web
to decide which wrapper to render. Now that Electron never navigates to
`/results`, this detection is no longer needed for the in-app experience.

Simplify `ResultsShell` to always render the web (dark standalone) layout
— it only renders for share links now, which are web-only contexts.

Remove `ElectronResultsHeader` from the same file.

---

## 6. Files being created

```
app/(app)/deals/page.tsx              # new Deals route (server component)
app/(app)/deals/DealsClient.tsx       # client — ResizablePanelGroup + search
app/(app)/_components/AnalysisPanel.tsx  # canonical analysis display component
```

---

## 7. Files being modified

```
components/layout/app-sidebar.tsx    # 4-item nav, logo href /deals
app/(app)/research/page.tsx          # swap ElectronResultsView → AnalysisPanel
app/(app)/leads/LeadsClient.tsx      # swap SavedDealDetail → AnalysisPanel
electron-app/main.js                 # expandToMainApp navigates to /deals
app/(app)/_components/results/ResultsShell.tsx  # simplify, remove Electron branch
```

---

## 8. Files being retired (after redirects confirmed)

```
app/(app)/search/          # → redirect to /deals
app/(app)/leads/           # → redirect to /deals
app/(app)/dashboard/       # → redirect to /deals
```

---

## 9. Files that do NOT change

```
app/(app)/results/         # stays for share links — do not touch
app/(app)/research/        # only the ElectronResultsView swap
app/(app)/settings/        # untouched
app/(app)/insights/        # untouched (stub stays as-is)
app/(marketing)/           # entire marketing site untouched
lib/                       # all engine/data code untouched
app/api/                   # all API routes untouched
electron-app/preload.js    # untouched
```

---

## 10. Key technical constraints

### Turbopack parser bug (CRITICAL)
This project uses Next.js with Turbopack. Turbopack misreads `/` as a
regex literal start in certain JSX positions.

**Never write:**
```tsx
{someNumber}/{otherNumber}         // ❌ breaks Turbopack
style={{ width: `${x}%` }}        // ❌ can break Turbopack
```

**Always write:**
```tsx
{someNumber + "/" + otherNumber}   // ✅
style={{ width: x + "%" }}        // ✅
```

### No `any` types
Use `unknown` and narrow. The codebase has zero `any` — keep it that way.

### Server components by default
`"use client"` only when you need state, effects, or browser APIs.
The Deals page server component fetches the deal list. `DealsClient`
handles interaction.

### `AnalysisPanel` is pure display
No data fetching inside `AnalysisPanel`. All data comes in as props.
This is non-negotiable — it's what allows the component to work
identically in Research, Deals, and anywhere else.

### Electron bounds sync
The Research page has `useElectronBounds` which calls
`window.electronAPI.updateBounds()` when the panel width changes.
This must continue to work after the `ElectronResultsView` swap. Do not
remove or break the bounds calculation logic.

### Panel width detection for `AnalysisPanel`
Use a `ResizeObserver` on the panel container ref to get the actual
rendered pixel width, then pass it as `panelWidth` to `<AnalysisPanel>`.
This is how the component decides compact vs expanded vs focus display.

---

## 11. What the finished product looks like

**User opens the app:**
- Lands on Deals view
- Left panel: their saved deal list, search bar at top
- Right panel: last analyzed deal (or empty state if first time)

**User wants to analyze a new deal:**
- Types address or pastes Zillow URL into search bar at top of left panel
- Right panel shows loading state
- Analysis appears in right panel
- User can scroll through metrics, tabs, stress test — all in the panel
- Save button in panel header saves it to the list on the left

**User browsing in Research:**
- Embedded browser on the left
- Hits Analyze on a listing
- Result loads into the right panel (compact by default)
- Drags handle left to expand panel for more detail
- Never navigates away from the browser

**User reviewing their pipeline:**
- Opens Deals
- Clicks any saved deal in the left list
- Full analysis loads in right panel
- No page transition, no context loss

**User forwards a Pack to their agent:**
- Agent receives a link to `/pack/[token]`
- Clicks it in their browser, sees the standalone Pack view
- Not the app — just the Pack artifact

---

## 12. Quality gates — must pass before any PR

```bash
npm run check    # tsc --noEmit + eslint --max-warnings 0 + vitest run
```

All 185 tests must pass. No new TypeScript errors. No new ESLint
warnings. If any test breaks during the refactor, fix it before
continuing to the next step.

---

## 13. What this does NOT include

The following are explicitly out of scope for this rebuild sprint:

- Any changes to analysis accuracy or the engine
- New features (bulk triage, alerts, Chrome extension)
- Calibration gauntlet (separate task)
- Stripe live-mode switch
- Custom domain setup
- The Insights page getting real data
- Mobile/responsive layout (desktop Electron first)
- Any change to how the Negotiation Pack is generated or displayed
  in its standalone view

---

## 14. The single north star question

After every change, ask: **"Does this feel like a CRM a rental investor
would open every morning, or does it feel like a website they visited?"**

If it feels like a website, something is wrong. The answer is always
to pull content into a panel, not to add more pages.
