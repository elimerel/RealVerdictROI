# RealVerdict — Project Context

Use this file to onboard a new chat or agent quickly. **`HANDOFF.md`** stays the repo “spec” for engine, `/results`, and Pack-era history; this file tracks the **desktop app surface** and shared stack.

---

## What this is

**RealVerdict** is a desktop (Electron) app for rental investors: browse a listing URL in an embedded browser, underwrite in a right-hand **Dossier** panel, save to **Pipeline**, compare metrics. The renderer is the same **Next.js** app deployed on Vercel — not a separate UI codebase.

---

## Stack

| Layer | Tech |
|-------|------|
| Desktop shell | Electron (`electron-app/main.js`, `preload.js`) |
| UI / SSR / API | Next.js App Router + Turbopack |
| Styling | Tailwind CSS 4 (`app/globals.css`), shadcn/ui |
| Auth + DB | Supabase |
| Payments | Stripe |
| Deploy | Vercel (web); DMG via `electron-app` / `electron-builder` |

**AI:** Both OpenAI (e.g. Ask AI / some routes per `HANDOFF.md`) and Anthropic (e.g. deal narrative) may appear — check the specific `app/api/*` route before assuming one vendor.

---

## Architecture fact (important)

The Electron app is a **shell that loads the deployed Next URL** (e.g. production site).  

- UI / React / CSS changes → push to `main` → Vercel deploy → users see them after refresh (no DMG reinstall).
- **Main process / preload** changes → rebuild the desktop artifact.

**Explicit product decision:** A full **static `next export` bundle inside Electron** was scoped and **rejected for now** — the app depends on server routes, Supabase, Stripe, and AI. Revisit only with a deliberate backend/shell architecture project (see `HANDOFF.md` §1b).

---

## Authenticated app routes (`app/(app)/`)

| Route | In-app name | Role |
|-------|-------------|------|
| `/research` | **Browse** | Webview + URL bar + **DossierPanel** analysis rail (~440px width constant in `research/page.tsx`) |
| `/deals` | **Pipeline** | Saved deals: search, filter chips, table + card views, same **DossierPanel** when a row/card is selected |
| `/settings` | **Settings** | Profile, assumptions, subscription |

**Sidebar** (`components/layout/app-sidebar.tsx`): three items — Browse, Pipeline, Settings. **Default:** icon-only collapsed (`SidebarProvider defaultOpen={false}` in `app/(app)/layout.tsx`). Tooltips (~500ms delay) on nav buttons.

Shared chrome: `KeyboardShortcuts.tsx` (⌘1/2/3 navigation, ⌘N search/URL, ⌘F filter, etc.), drag regions on page headers for macOS.

---

## Core analysis UI: `DossierPanel`

`app/(app)/_components/DossierPanel.tsx` — canonical underwriting panel:

- Modules: identity → hero metrics (DSCR, cash/mo, cap) → summary + break-even → assumptions (lifted surface) → collapsible breakdown/stress/projection.
- **Hero numbers:** 28px mono; cash line uses compact **k** notation so values don’t truncate in three columns.
- **Severity:** only the **worst-offending** metric per deal is strongly tinted (`lib/severity.ts` + `.rv-tone-*` in `globals.css`).

Older docs may say “AnalysisPanel” — that name is obsolete; use **DossierPanel**.

---

## Typography / color (polish v2)

Hierarchy tokens in `app/globals.css`:

- `--rv-t1` … `--rv-t4` (+ `.rv-t1` … `.rv-t4`) — primary → secondary → tertiary → disabled/placeholder aligned to a Mercury/Linear-style contrast ladder.
- **Mono:** JetBrains Mono via `next/font/local` as `--rv-font-mono` (Tailwind `font-mono`).

---

## Electron IPC (sketch)

`window.electronAPI` (see `electron-app/preload.js`): browser bounds, navigate, analyze current page, etc. Bounds account for sidebar + right panel width.

---

## Core math

`lib/calculations.ts` — `sanitiseInputs`, `analyseDeal`, `findOfferCeiling`, formatting helpers. **No I/O** in this file.

---

## Deploy workflow

```bash
npm run deploy    # or: push main (Vercel) + rebuild DMG when electron-app changes
```

Reinstall the DMG only when **`electron-app/`** (or packaging config) changes.

---

## Turbopack constraint

Avoid JSX patterns that confuse the parser (see `AGENTS.md` / prior notes):

```tsx
// Bad: {a}/{b}  or  style={{ width: `${a}%` }} in fragile positions
// Prefer string concat or precomputed variables
```

---

## Environment variables

See `HANDOFF.md` §4 for the full table. Typical: Supabase, Stripe, OpenAI, RentCast, Redis, etc.

---

## Current state (2026-05-01)

- **Polish v1 + v2** shipped: native-feel inputs, chips, sidebar, shortcuts, window state persistence, text hierarchy, pipeline density, panel scroll containment.
- **Phase 2** (native shell: splash, menus, updater, tray, …) — planned, not fully shipped; see `HANDOFF.md` §1b.
- **Quality:** run `npm run check` before merge; some **vitest** failures have been **pre-existing** in pack-route invariant tests — confirm against `main` before blaming new work.

---

## Related docs

- `HANDOFF.md` — engine, `/results`, Pack, resolver, positioning guard rails.
- `REALVERDICT_CONTEXT.md` — longer desktop/product narrative (should match this file; if they diverge, update both).
- `HANDOFF_ARCHIVE.md` — historical snapshot from 2026-04-22 **plus** 2026-05 addendum at top.
