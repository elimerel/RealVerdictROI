"use client"

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react"
import { createPortal } from "react-dom"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUpIcon, TrendingDownIcon } from "lucide-react"
import { useTopBarSlots } from "@/lib/topBarSlots"
import { useIsActiveRoute } from "@/lib/useIsActiveRoute"
import {
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Trash2,
  ChevronDown,
  GitCompareArrows,
  X,
  Bell,
  BellOff,
  Sparkles,
  Search,
  ArrowDownUp,
  Maximize2,
} from "lucide-react"
import { SourceMark } from "@/components/source/SourceMark"
import { Currency } from "@/lib/format"
import {
  DEAL_STAGES,
  STAGE_LABEL,
  STAGE_COLOR,
  deleteDeal,
  fetchPipeline,
  moveDealStage,
  runWatchChecks,
  setDealWatching,
  updateDealNotes,
  updateDealScenario,
  type DealStage,
  type SavedDeal,
} from "@/lib/pipeline"
import { hasActiveScenario, recomputeMetrics, type ScenarioOverrides } from "@/lib/scenario"
import { ScenarioDisclosure } from "@/components/panel/ScenarioDisclosure"
import PropertyMap from "@/components/PropertyMap"
import { useMapShell } from "@/lib/mapShell"
import MapShell from "@/components/MapShell"
import { useBuyBar } from "@/lib/useBuyBar"
import { geocode } from "@/lib/mapbox"
import Panel from "@/components/panel"
import { useEscape } from "@/lib/escapeStack"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import ActivityFeed from "@/components/ActivityFeed"
import { BuddyMark } from "@/components/BuddyMark"
import { PipelineDealTable } from "@/components/pipeline-deal-table"
import { PipelineKanban } from "@/components/pipeline-kanban"
import { PipelineBulkBar } from "@/components/pipeline-bulk-bar"
import { PipelineViewsMenu } from "@/components/pipeline-views-menu"
import { ViewToggle } from "@/components/view-toggle"

// ── Format helpers ────────────────────────────────────────────────────────

const fmtCurrency = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency", currency: "USD", maximumFractionDigits: 0,
      }).format(n)

const fmtPct = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(2)}%`

const fmtMonthly = (n: number | null | undefined) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${fmtCurrency(n)}/mo`

// Negative cash flow gets the standard finance-red tint; everything else is
// neutral. We deliberately don't paint "good cash flow" green — color is
// data hygiene (this number is below zero), not a verdict on the deal.
const cashFlowTone = (v: number | null | undefined) =>
  v == null ? "var(--rv-t3)" :
  v < 0     ? "var(--rv-neg)" :
              "var(--rv-t2)"

// ── Pipeline sort options ──────────────────────────────────────────
// User-selectable ordering applied within each stage group. Default
// ("recent") matches how Linear / Mercury order — most-recently-touched
// items at the top so the user's eye lands on what they just worked on.
type SortKey =
  | "recent"        // updated_at desc  (default)
  | "saved-new"     // created_at desc  ("Recently saved")
  | "saved-old"     // created_at asc   ("Oldest saved")
  | "cashflow"      // monthlyCashFlow desc (best CF first)
  | "cap"           // capRate desc
  | "price-asc"     // list_price asc
  | "price-desc"    // list_price desc

const SORT_KEYS: SortKey[] = ["recent", "saved-new", "saved-old", "cashflow", "cap", "price-asc", "price-desc"]

const SORT_LABEL: Record<SortKey, string> = {
  "recent":     "Recent activity",
  "saved-new":  "Recently saved",
  "saved-old":  "Oldest saved",
  "cashflow":   "Cash flow (high → low)",
  "cap":        "Cap rate (high → low)",
  "price-asc":  "Price (low → high)",
  "price-desc": "Price (high → low)",
}

/** Returns a comparator function for the given sort key. NaN/null
 *  values sink to the bottom regardless of direction so "missing data"
 *  never beats "real data" in either direction. */
function sortComparator(key: SortKey): (a: SavedDeal, b: SavedDeal) => number {
  const ts = (s: string | null | undefined) => (s ? new Date(s).getTime() : 0)
  const num = (n: number | null | undefined) => (n != null && Number.isFinite(n) ? n : null)

  switch (key) {
    case "saved-new":  return (a, b) => ts(b.created_at) - ts(a.created_at)
    case "saved-old":  return (a, b) => ts(a.created_at) - ts(b.created_at)
    case "cashflow":   return (a, b) => {
      const av = num(a.snapshot?.metrics?.monthlyCashFlow)
      const bv = num(b.snapshot?.metrics?.monthlyCashFlow)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return bv - av
    }
    case "cap": return (a, b) => {
      const av = num(a.snapshot?.metrics?.capRate)
      const bv = num(b.snapshot?.metrics?.capRate)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return bv - av
    }
    case "price-asc":
    case "price-desc": return (a, b) => {
      const av = num(a.list_price)
      const bv = num(b.list_price)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return key === "price-asc" ? av - bv : bv - av
    }
    case "recent":
    default: return (a, b) => ts(b.updated_at) - ts(a.updated_at)
  }
}

function timeInStage(updatedAt: string): string {
  const ms = Date.now() - new Date(updatedAt).getTime()
  const days = Math.floor(ms / 86400000)
  if (days < 1)  return "Today"
  if (days < 7)  return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 30)}mo`
}

// ── List row ───────────────────────────────────────────────────────────────

function DealListRow({
  deal, active, multiSelected, compareMode, dense, hideStagePill, onSelect, onDoubleSelect, onContextMenuAdd, onDragStartRow, onDragEndRow,
}: {
  deal:           SavedDeal
  active:         boolean
  multiSelected:  boolean
  compareMode:    boolean
  /** Dense single-line layout (Linear-style columns) when true.
   *  Stacked / Mercury-row layout when false (Map view's narrow pane). */
  dense?:         boolean
  /** Suppress the inline stage pill in dense mode. Set when the parent
   *  is grouping rows by stage — the group header already names it. */
  hideStagePill?: boolean
  onSelect:       (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => void
  onDoubleSelect: () => void
  onContextMenuAdd: () => void
  onDragStartRow: (id: string) => void
  onDragEndRow:   () => void
}) {
  const cashFlow = deal.snapshot?.metrics?.monthlyCashFlow ?? null
  const capRate  = deal.snapshot?.metrics?.capRate ?? null
  const address  = [deal.address, deal.city, deal.state].filter(Boolean).join(", ")
  const bg =
    multiSelected ? "var(--rv-accent-dim)" :
    active        ? "var(--rv-accent-dim)" :
                    "transparent"

  // Stage tone for the inline pill (dense mode).
  const stageTone =
    deal.stage === "watching"   ? "bg-muted text-muted-foreground" :
    deal.stage === "interested" ? "bg-primary/10 text-primary"     :
    deal.stage === "offered"    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
    deal.stage === "won"        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" :
                                   "bg-muted text-muted-foreground"

  return (
    <button
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy"
        e.dataTransfer.setData("rv/deal-id", deal.id)
        onDragStartRow(deal.id)
      }}
      onDragEnd={() => onDragEndRow()}
      onClick={(e) => onSelect({ metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey })}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onDoubleSelect() }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenuAdd() }}
      className={cn(
        "relative block text-left select-none w-full group/row",
        // Outer button is just the click target + side gutters. The
        // hover/selected highlight paints on the INNER div below so
        // it reads as an inset rounded surface, not a full-bleed bar
        // — Linear's row pattern. Stacked (Map) rows keep full-bleed
        // hairline separation since the narrow pane has no breathing
        // room for inset margins.
      )}
      style={{
        paddingInline: dense ? 8 : 0,
      }}
      onMouseEnter={(e) => {
        const inner = e.currentTarget.querySelector<HTMLElement>("[data-row-inner]")
        if (inner && !active && !multiSelected) inner.style.background = "var(--rv-elev-2)"
      }}
      onMouseLeave={(e) => {
        const inner = e.currentTarget.querySelector<HTMLElement>("[data-row-inner]")
        if (inner && !active && !multiSelected) inner.style.background = "transparent"
      }}
    >
      <div
        data-row-inner
        className={cn(
          "relative",
          dense ? "flex items-center gap-3" : "flex items-start gap-3"
        )}
        style={{
          paddingBlock:  dense ? 6 : 9,
          paddingInline: dense ? 8 : 14,
          background:    bg,
          transition:    "background 140ms cubic-bezier(0.32,0.72,0,1)",
          borderRadius:  dense ? 6 : 0,
          borderBottom:  dense ? "none" : "0.5px solid oklch(from var(--foreground) l c h / 0.05)",
        }}
      >
        {/* Left accent bar — RealVerdict's sage indicator for active /
            multi-selected. Positioned absolutely so the rounded
            highlight stays clean (a 2px border on a rounded element
            would clip at the corners). */}
        {(multiSelected || active) && (
          <span
            aria-hidden
            className="absolute"
            style={{
              left: 2, top: 5, bottom: 5,
              width: 2,
              background: "var(--rv-accent)",
              borderRadius: 99,
            }}
          />
        )}
      {/* Compare-mode checkbox */}
      <span
        aria-hidden
        className="shrink-0 self-center flex items-center justify-center rounded-full transition-transform duration-150"
        style={{
          width:      compareMode ? 18 : 0,
          height:     18,
          marginLeft: compareMode ? 0  : -8,
          marginRight: compareMode ? 4 : 0,
          opacity:    compareMode ? 1  : 0,
          background: multiSelected ? "var(--rv-accent)" : "transparent",
          border:     multiSelected
            ? "1px solid var(--rv-accent)"
            : "1px solid var(--rv-border-mid, var(--rv-border))",
          color:      "white",
          overflow:   "hidden",
        }}
      >
        {multiSelected && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5.2 L4 7.2 L8 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>

      {/* Source mark — full brand logo on every row. The 6px-dot
          experiment lost the at-a-glance "this is from Zillow / Redfin"
          signal that the logos actually carry. Dense rows use a slightly
          larger logo (18px vs the previous 16px) so the brand reads
          cleanly without feeling toy-sized. */}
      <span className={cn("shrink-0", dense ? "self-center" : "mt-[3px]")}>
        <SourceMark source="listing" siteName={deal.site_name} size={dense ? "md" : "sm"} />
      </span>

      {dense ? (
        // === Dense single-line layout (Deals view, full-width pane) ===
        // Linear/Pipedrive scannable rows. Address takes flex space,
        // everything else right-aligned in fixed-width columns so the
        // user's eye can sweep down and compare without re-aligning.
        <>
          {/* Address — primary identity, takes available space */}
          <div className="flex-1 min-w-0 flex items-baseline gap-2">
            <span className="text-[13px] font-medium truncate text-foreground">
              {deal.address ?? "—"}
            </span>
            <span className="text-[11.5px] truncate text-muted-foreground/80 shrink-0">
              {[deal.city, deal.state].filter(Boolean).join(", ")}
            </span>
          </div>

          {/* Stage pill — suppressed when the parent is grouping by
              stage (the group header already names it). Linear pattern:
              don't repeat the group label on every row inside it. */}
          {!hideStagePill && (
            <span
              className={cn(
                "shrink-0 inline-flex items-center text-[10.5px] font-medium rounded-full px-2 py-[1px] capitalize",
                stageTone
              )}
              style={{ width: 78, justifyContent: "center" }}
            >
              {STAGE_LABEL[deal.stage]}
            </span>
          )}

          {/* List price */}
          <span className="shrink-0 text-[12px] tabular-nums text-foreground text-right" style={{ width: 80 }}>
            {deal.list_price != null ? <Currency value={deal.list_price} compact /> : "—"}
          </span>

          {/* Cash flow — monochrome per Linear restraint. Positive
              numbers get the sage accent (it's the only color the app
              ever uses for "good"); negative + null read in muted
              foreground tones, NOT alarming red. The minus sign +
              tabular-nums alignment carry the "negative" signal —
              repainting 90% of rows red was overworking color. */}
          <span
            className="shrink-0 text-[12px] font-medium tabular-nums text-right"
            style={{
              width: 90,
              color:
                cashFlow == null ? "var(--rv-t4)" :
                cashFlow >= 0    ? "var(--rv-pos)" :
                                    "var(--rv-t3)",
            }}
          >
            {cashFlow != null ? <><Currency value={cashFlow} signed /><span className="text-[10px] font-normal text-muted-foreground/70">/mo</span></> : "—"}
          </span>

          {/* Cap rate */}
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground text-right" style={{ width: 56 }}>
            {capRate != null && Number.isFinite(capRate) ? `${(capRate * 100).toFixed(2)}%` : "—"}
          </span>

          {/* Age in stage */}
          <span
            className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60 text-right"
            style={{ width: 36 }}
            title={`In ${STAGE_LABEL[deal.stage]} since ${new Date(deal.updated_at).toLocaleDateString()}`}
          >
            {timeInStage(deal.updated_at)}
          </span>
        </>
      ) : (
        // === Stacked layout (Map view, narrow pane) ===
        <div className="flex items-start justify-between gap-3 min-w-0 flex-1">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <p className="text-[13px] font-medium leading-tight truncate text-foreground">
              {address || (deal.list_price != null ? <Currency value={deal.list_price} whole /> : "Saved deal")}
            </p>
            <p className="text-[11.5px] leading-tight truncate text-muted-foreground tabular-nums">
              {deal.list_price != null && address && (
                <>
                  <Currency value={deal.list_price} whole />
                  {(deal.tags?.[0] || deal.snapshot?.propertyType) && <span className="text-muted-foreground/60"> · </span>}
                </>
              )}
              {deal.tags?.[0] ?? deal.snapshot?.propertyType ?? deal.site_name ?? null}
            </p>
            <span className="inline-flex items-center gap-1.5 text-[10.5px] rounded-full px-2 py-[1px] text-muted-foreground bg-muted self-start mt-0.5">
              <span aria-hidden className="rounded-full shrink-0" style={{ width: 5, height: 5, background: STAGE_COLOR[deal.stage] }} />
              {STAGE_LABEL[deal.stage]}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {cashFlow != null && (
              <span
                className={cn(
                  "inline-flex items-baseline gap-0.5 rounded-full px-2.5 py-[3px] text-[12px] font-medium tabular-nums",
                  cashFlow >= 0
                    ? "bg-emerald-500/10 text-emerald-700"
                    : "bg-rose-500/10 text-rose-700"
                )}
              >
                <Currency value={cashFlow} signed />
                <span className="text-[10px] opacity-70 font-normal">/mo</span>
              </span>
            )}
            <span
              className="text-[10px] tabular-nums text-muted-foreground/60"
              title={`In ${STAGE_LABEL[deal.stage]} since ${new Date(deal.updated_at).toLocaleDateString()}`}
            >
              {timeInStage(deal.updated_at)}
            </span>
          </div>
        </div>
      )}
      </div>
    </button>
  )
}

// ── Sort dropdown ─────────────────────────────────────────────────────────
// Linear-style. Quiet trigger reading "Sort: <current label>" with a small
// chevron; opens a menu with the seven sort options. Closes on outside
// click. The user can swap the ordering inside each stage group without
// having to touch the views menu.

function SortMenu({
  sortKey, onChange,
}: {
  sortKey:  SortKey
  onChange: (k: SortKey) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[12px] tracking-tight text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded-md"
        title="Sort deals within each stage"
      >
        <ArrowDownUp size={11} strokeWidth={2} />
        <span>{SORT_LABEL[sortKey]}</span>
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && (
        <div
          className="absolute z-30 right-0 top-full mt-1 flex flex-col rv-menu-pop border border-border"
          style={{
            background: "var(--rv-popover-bg)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            borderRadius: 8,
            boxShadow: "var(--rv-shadow-outer-md)",
            minWidth: 200,
            padding: 4,
          }}
        >
          {SORT_KEYS.map((k) => (
            <Button
              key={k}
              onClick={() => { onChange(k); setOpen(false) }}
              variant="ghost"
              size="sm"
              className="justify-start"
              style={{ color: k === sortKey ? "var(--rv-accent)" : "var(--rv-t2)" }}
            >
              {SORT_LABEL[k]}
              {k === sortKey && (
                <span
                  className="ml-auto inline-block w-1.5 h-1.5 rounded-full align-middle"
                  style={{ background: "var(--rv-accent)" }}
                />
              )}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Stage dropdown (Apple-style menu button) ─────────────────────────────

function StageMenu({
  stage, onChange,
}: {
  stage:    DealStage
  onChange: (s: DealStage) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-[7px] text-[12px] font-medium tracking-tight transition-colors text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15"
        style={{ padding: "5px 9px 5px 11px" }}
      >
        {STAGE_LABEL[stage]}
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && (
        <div
          className="absolute z-30 left-0 top-full mt-1 flex flex-col rv-menu-pop border border-border"
          style={{
            background: "var(--rv-popover-bg)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            borderRadius: 8,
            boxShadow: "var(--rv-shadow-outer-md)",
            minWidth: 140,
            padding: 4,
          }}
        >
          {DEAL_STAGES.map((s) => (
            <Button
              key={s}
              onClick={() => { onChange(s); setOpen(false) }}
              variant="ghost"
              size="sm"
              className="justify-start"
              style={{ color: s === stage ? "var(--rv-accent)" : "var(--rv-t2)" }}
            >
              {STAGE_LABEL[s]}
              {s === stage && (
                <span
                  className="ml-2 inline-block w-1.5 h-1.5 rounded-full align-middle"
                  style={{ background: "var(--rv-accent)" }}
                />
              )}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Detail pane ────────────────────────────────────────────────────────────

function DealDetail({
  deal, onChange,
}: {
  deal:     SavedDeal
  /** Bubble up the new local state (after stage change, note edit, delete) */
  onChange: (next: SavedDeal | null) => void
}) {
  const router = useRouter()
  const buyBar = useBuyBar()
  const pathname = usePathname()
  // Pipeline is always-mounted at layout level. The browseAux slot is
  // SHARED with Browse's Save/Stage buttons. If we portal here while
  // the user is on /browse, two routes' content collides in one DOM
  // node — clicks fight, layout flickers, the URL bar can become
  // unclickable. Gate every cross-route portal on routeActive.
  const routeActive = pathname.startsWith("/pipeline")
  const { browseAux: auxSlot } = useTopBarSlots()
  const snapshot = deal.snapshot
  const provenance = snapshot.provenance
  const riskFlags  = snapshot.riskFlags

  // Scenario layer: editable in-place. Overrides hydrate from the saved
  // row on mount (so reopening lands on the user's alternate view) and
  // persist back via updateDealScenario (debounced). The metric cards +
  // delta lines re-render live as the user edits — same model as the
  // Browse panel's ResultPane.
  const [overrides, setOverrides] = useState<ScenarioOverrides>(deal.scenario ?? {})
  const [editorOpen, setEditorOpen] = useState<boolean>(hasActiveScenario(deal.scenario))
  // When switching to a different deal, reset to that deal's stored
  // scenario. (deal.id is the only stable identity across rerenders.)
  const lastDealId = useRef<string>(deal.id)
  if (lastDealId.current !== deal.id) {
    lastDealId.current = deal.id
    setOverrides(deal.scenario ?? {})
    setEditorOpen(hasActiveScenario(deal.scenario))
  }

  // Debounced persist — same 350ms cadence as the panel. Skip the very
  // first effect run (post-hydrate) so we don't immediately overwrite the
  // row with its own value.
  const firstScenarioTick = useRef(true)
  useEffect(() => {
    if (firstScenarioTick.current) { firstScenarioTick.current = false; return }
    const id = setTimeout(() => {
      const next = hasActiveScenario(overrides) ? overrides : null
      void updateDealScenario(deal.id, next)
      onChange({ ...deal, scenario: next })
    }, 350)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, deal.id])

  const scenarioActive  = hasActiveScenario(overrides)
  const scenarioMetrics = useMemo(
    () => scenarioActive ? recomputeMetrics(snapshot.inputs, overrides) : null,
    [scenarioActive, snapshot.inputs, overrides]
  )
  const [showDefault, setShowDefault] = useState(false)
  const usingScenario = scenarioActive && !showDefault
  const metrics       = usingScenario ? scenarioMetrics! : snapshot.metrics
  const inputs        = snapshot.inputs

  const address = [deal.address, deal.city, deal.state].filter(Boolean).join(", ")

  // ── Notes (autosave on blur) ─────────────────────────────────────────────
  const [notes, setNotes] = useState<string>(deal.notes ?? "")
  // Reset when switching deals (deal.id changes).
  useEffect(() => { setNotes(deal.notes ?? "") }, [deal.id, deal.notes])
  const saveNotes = useCallback(async () => {
    if (notes === (deal.notes ?? "")) return
    await updateDealNotes(deal.id, notes)
    onChange({ ...deal, notes })
  }, [deal, notes, onChange])

  // ── Scenario persist (debounced inside the parent so Panel can fire
  //    onScenarioChange synchronously). Updates local state immediately
  //    so the metric cards re-render live; defers the Supabase write
  //    until the user has stopped typing. The previous architecture
  //    debounced inside the panel itself, which created a save-race
  //    (⌘S firing within the debounce window dropped the scenario). */
  const scenarioWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (scenarioWriteTimer.current) clearTimeout(scenarioWriteTimer.current)
  }, [])
  const onPanelScenarioChange = useCallback((s: ScenarioOverrides | null) => {
    onChange({ ...deal, scenario: s })
    if (scenarioWriteTimer.current) clearTimeout(scenarioWriteTimer.current)
    scenarioWriteTimer.current = setTimeout(() => {
      void updateDealScenario(deal.id, s)
    }, 350)
  }, [deal, onChange])

  // ── Actions ──────────────────────────────────────────────────────────────
  const onMoveStage = useCallback(async (s: DealStage) => {
    if (s === deal.stage) return
    const ok = await moveDealStage(deal.id, s)
    if (ok) onChange({ ...deal, stage: s, updated_at: new Date().toISOString() })
  }, [deal, onChange])

  const onOpenInBrowse = useCallback(() => {
    router.push(`/browse?url=${encodeURIComponent(deal.source_url)}`)
  }, [router, deal.source_url])

  const [confirmDelete, setConfirmDelete] = useState(false)
  const onDelete = useCallback(async () => {
    const ok = await deleteDeal(deal.id)
    if (ok) onChange(null)
  }, [deal.id, onChange])

  const cfTone = cashFlowTone(metrics.monthlyCashFlow)

  // ── Pipeline detail rail = shared Panel + a slim pipeline-actions
  //    strip on top. The custom "DealDetail body" that used to live
  //    here was a hand-rolled clone of Panel/ResultPane that drifted
  //    over time. By rendering the same Panel that Browse uses, both
  //    surfaces share one source of truth for the analysis layout.
  //    Only Pipeline-specific affordances (stage move, watch, delete)
  //    sit outside Panel.
  return (
    <div className="flex flex-col h-full overflow-hidden relative bg-background">
      {/* Pipeline-actions strip — moved out of the panel and portaled
          into the AppTopBar's aux slot. Watch / Stage / Open / Delete
          live pinned right of the "All Active · Compare" header
          content in the top bar, instead of consuming a row of space
          above the analysis content. The Panel below renders directly
          with its hero, no preceding strip. */}
      {auxSlot && routeActive && createPortal(
        <div className="flex items-center gap-2">
          {/* Open workspace — primary action, leftmost slot in the
              action row so it's the first thing the user reads.
              Routes to the per-deal workspace where the AI buddy
              lives in a dedicated column. The previous tucked-away
              "Open in full" pill in the panel's top-right floating
              chrome wasn't discoverable; users (including the
              builder) didn't notice it. This puts the move into the
              persistent topbar action row alongside Watch / Stage /
              Open. */}
          <Button
            variant="primary"
            size="sm"
            onClick={() => router.push(`/pipeline/${deal.id}`)}
            icon={<Maximize2 size={11} strokeWidth={2} />}
            title="Open the full deal workspace — analyze, run scenarios, talk to the buddy"
          >
            Open workspace
          </Button>
          <Button
            variant={deal.watching ? "primary" : "secondary"}
            size="sm"
            onClick={async () => {
              const next = !deal.watching
              const ok = await setDealWatching(deal.id, next)
              if (ok) onChange({ ...deal, watching: next })
            }}
            title={deal.watching ? "Stop watching this deal" : "Watch — get notified on price changes"}
            icon={deal.watching ? <Bell size={11} strokeWidth={2} /> : <BellOff size={11} strokeWidth={2} />}
          >
            {deal.watching ? "Watching" : "Watch"}
          </Button>
          <StageMenu stage={deal.stage} onChange={onMoveStage} />
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenInBrowse}
            icon={<ExternalLink size={11} strokeWidth={2} />}
            title="Open this listing in the browser"
          >
            Open
          </Button>
          {confirmDelete ? (
            <>
              <span className="text-[11.5px] text-muted-foreground">Delete?</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={onDelete}
                style={{ color: "var(--rv-neg)", borderColor: "var(--rv-neg-bg)" }}
              >
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              icon={<Trash2 size={11} strokeWidth={2} />}
              title="Delete this deal"
            />
          )}
        </div>,
        auxSlot,
      )}

      {/* The Panel renders the same analysis surface as Browse: hero
          (satellite + price + cash flow), action row, AI Noticed,
          metric cards, secondary metrics, scenario editor, sources.
          Pipeline-specific behavior:
            - state.phase = "ready" with the persisted snapshot
            - isSaved = true so the action row's primary shows
              "{stage}" disabled instead of "Save deal"
            - onScenarioChange persists to the saved_deals row
            - onOpenSource opens the listing's source URL in Browse */}
      <div className="flex-1 min-h-0 relative" style={{ zIndex: 1 }}>
        {/* In Pipeline detail, the topbar's auxSlot already renders
            Watching / StageMenu / Open / Delete. Don't pass
            onMoveStage / onOpenSource down so the panel doesn't
            render a duplicate stage menu inside its action row.
            actionRowCollapsed hides the row entirely in this mode. */}
        <Panel
          state={{ phase: "ready", result: deal.snapshot }}
          isSaved
          savedStage={STAGE_LABEL[deal.stage]}
          buyBar={buyBar}
          initialScenario={deal.scenario ?? null}
          onScenarioChange={onPanelScenarioChange}
          actionRowCollapsed
        />
      </div>
    </div>
  )

  // ── Legacy hand-rolled body retained below as `_legacyDealDetailBody`
  //    purely for diff context; it's never returned. Will be removed in
  //    a follow-up cleanup pass once the Panel-based detail rail has
  //    settled in production.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _legacyDealDetailBody() { return (
    <div className="flex flex-col h-full overflow-hidden relative bg-background">
      {/* Property location banner — slim Mapbox static-image preview that
          grounds the deal in physical space. Sits above the financial
          header so price/cash-flow stays the visual hero, but every deal
          now has a "where" not just a "what." */}
      {(deal.address || deal.city) && (
        <div className="px-6 pt-5 shrink-0 relative" style={{ zIndex: 1 }}>
          <PropertyMap
            address={deal.address}
            city={deal.city}
            state={deal.state}
            zip={deal.zip}
            size="banner"
            radius={10}
            view="satellite"
          />
        </div>
      )}
      {/* Header — title + actions */}
      <div
        className="flex items-start gap-3 px-6 py-5 shrink-0 relative"
        style={{
          borderBottom: "0.5px solid var(--rv-border)",
          zIndex: 1,
        }}
      >
        <div className="flex-1 min-w-0">
          {deal.list_price != null && (
            <p
              className="tracking-[-0.030em] leading-none tabular-nums text-foreground"
              style={{
                fontSize:   36,
                fontFamily: "var(--rv-font-display)",
                fontWeight: 500,
              }}
            >
              <Currency value={deal.list_price} whole />
            </p>
          )}
          {/* Cash flow as co-hero — same pattern as the Browse panel.
              Reads as the answer to 'is this a deal?' right next to the
              price so the visual hierarchy is consistent across surfaces. */}
          {Number.isFinite(metrics.monthlyCashFlow) && (
            <div className="flex items-baseline gap-2 mt-2">
              <span
                className="tabular-nums leading-none"
                style={{
                  color:      metrics.monthlyCashFlow < 0 ? "var(--rv-neg)" : "var(--rv-pos)",
                  fontSize:   22,
                  fontFamily: "var(--rv-font-display)",
                  fontWeight: 500,
                  letterSpacing: "-0.020em",
                }}
              >
                <Currency value={metrics.monthlyCashFlow} signed />
              </span>
              <span className="text-[11.5px] tracking-tight text-muted-foreground">
                cash flow / mo
              </span>
            </div>
          )}
          {address && (
            <p className="text-[12.5px] mt-3 leading-snug text-muted-foreground">
              {address}
            </p>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground/60">
            {deal.beds      != null && <span>{deal.beds} bd</span>}
            {deal.baths     != null && <span>{deal.baths} ba</span>}
            {deal.sqft      != null && <span>{deal.sqft.toLocaleString()} sqft</span>}
            {deal.year_built != null && <span>Built {deal.year_built}</span>}
            {deal.site_name && <span>· {deal.site_name}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant={deal.watching ? "primary" : "secondary"}
            size="sm"
            onClick={async () => {
              const next = !deal.watching
              const ok = await setDealWatching(deal.id, next)
              if (ok) onChange({ ...deal, watching: next })
            }}
            title={deal.watching ? "Stop watching this deal" : "Watch — get notified on price changes"}
            icon={deal.watching ? <Bell size={11} strokeWidth={2} /> : <BellOff size={11} strokeWidth={2} />}
          >
            {deal.watching ? "Watching" : "Watch"}
          </Button>
          <StageMenu stage={deal.stage} onChange={onMoveStage} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto panel-scroll relative" style={{ zIndex: 1 }}>
        {/* Tags */}
        {deal.tags.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5 px-6 py-4"
            style={{ borderBottom: "0.5px solid var(--rv-border)" }}
          >
            {deal.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center text-[11px] tracking-tight rounded-full px-2 py-[2px] text-muted-foreground bg-muted"
                style={{
                  border: "0.5px solid var(--rv-border)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Notes */}
        {deal.snapshot.take && (
          <div
            className="px-6 py-4"
            style={{ borderBottom: "0.5px solid var(--rv-border)" }}
          >
            <p className="text-[10px] uppercase tracking-widest font-medium mb-2 text-muted-foreground/60">
              Notes
            </p>
            <p className="text-[13px] leading-[1.55] text-foreground">
              {deal.snapshot.take}
            </p>
          </div>
        )}

        {/* Three key metrics */}
        <div
          className="px-6 py-5"
          style={{ borderBottom: "0.5px solid var(--rv-border)" }}
        >
          {scenarioActive && (
            <div className="flex items-center justify-between mb-3">
              <span
                className="inline-flex items-center gap-1.5 rounded-full text-[10.5px] font-medium tracking-tight"
                style={{
                  color:      usingScenario ? "var(--rv-accent)" : "var(--rv-t3)",
                  background: usingScenario ? "rgba(48,164,108,0.12)" : "var(--rv-elev-2)",
                  border:     `0.5px solid ${usingScenario ? "rgba(48,164,108,0.22)" : "var(--rv-border)"}`,
                  padding:    "3px 8px",
                }}
              >
                {usingScenario ? "Your scenario" : "Default analysis"}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  onClick={() => setShowDefault((v) => !v)}
                  variant="ghost"
                  size="xs"
                  title={usingScenario ? "Show the original analysis" : "Show your scenario"}
                >
                  {usingScenario ? "Show default" : "Show scenario"}
                </Button>
                <Button
                  onClick={() => setOverrides({})}
                  variant="ghost"
                  size="xs"
                  title="Clear all overrides and return to the default analysis"
                >
                  Reset
                </Button>
              </div>
            </div>
          )}
          <div className="rv-stagger grid grid-cols-3 gap-3">
            <DetailMetric
              label="Cash Flow"
              value={<><Currency value={metrics.monthlyCashFlow} signed /><span className="text-muted-foreground/60" style={{ fontSize: "0.7em", marginLeft: 2 }}>/mo</span></>}
              sub="per month"
              color={cfTone}
              delta={usingScenario ? formatDeltaPipe(metrics.monthlyCashFlow, snapshot.metrics.monthlyCashFlow, "currency") : null}
            />
            <DetailMetric
              label="Cap Rate"
              value={fmtPct(metrics.capRate)}
              sub={`${fmtPct(metrics.cashOnCash)} CoC`}
              color="var(--rv-t1)"
              delta={usingScenario ? formatDeltaPipe(metrics.capRate, snapshot.metrics.capRate, "pct") : null}
            />
            <DetailMetric
              label="DSCR"
              value={metrics.dscr.toFixed(2)}
              sub={metrics.dscr >= 1.0 ? "covers debt" : "debt risk"}
              color="var(--rv-t1)"
              delta={usingScenario ? formatDeltaPipe(metrics.dscr, snapshot.metrics.dscr, "ratio") : null}
            />
          </div>
        </div>

        {/* Secondary metrics */}
        <div
          className="grid grid-cols-2 gap-y-3 px-6 py-4"
          style={{ borderBottom: "0.5px solid var(--rv-border)" }}
        >
          {[
            { label: "GRM",             value: `${metrics.grm.toFixed(1)}×` },
            { label: "Break-even occ.", value: fmtPct(metrics.breakEvenOccupancy) },
            { label: "Monthly rent",    value: `${fmtCurrency(inputs.monthlyRent)}/mo` },
            { label: "Cash invested",   value: fmtCurrency(metrics.totalCashInvested) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] uppercase tracking-widest mb-1 text-muted-foreground/60">
                {label}
              </p>
              <p className="text-[13px] tabular-nums text-muted-foreground">{value}</p>
            </div>
          ))}
        </div>

        {/* Editable scenario — same disclosure component as the panel,
            persists to the saved deal row via debounced updateDealScenario.
            Open by default when overrides exist so reopening lands the
            user on their alternate view, not hidden under a closed panel. */}
        <ScenarioDisclosure
          baseInputs={snapshot.inputs}
          baseListPrice={snapshot.listPrice}
          provenance={snapshot.provenance}
          siteName={snapshot.siteName}
          overrides={overrides}
          setOverrides={setOverrides}
          open={editorOpen}
          setOpen={setEditorOpen}
        />

        {/* Worth knowing — neutral framing, no alarms. */}
        {riskFlags.length > 0 && (
          <div className="px-6 py-4" style={{ borderBottom: "0.5px solid var(--rv-border)" }}>
            <p className="text-[10px] uppercase tracking-widest font-medium mb-2.5 text-muted-foreground/60">
              Worth knowing
            </p>
            <div className="flex flex-col gap-2.5">
              {riskFlags.map((flag, i) => (
                <div key={i} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  <span
                    className="mt-[6px] shrink-0 rounded-full"
                    style={{ width: 5, height: 5, background: "var(--rv-warn)" }}
                  />
                  <span>{flag}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Provenance */}
        <div className="px-6 py-4" style={{ borderBottom: "0.5px solid var(--rv-border)" }}>
          <p className="text-[10px] uppercase tracking-widest font-medium mb-2 text-muted-foreground/60">
            Where numbers come from
          </p>
          <div className="flex flex-col">
            <ProvRow label="List price"    value={fmtCurrency(deal.list_price)}                      field={provenance.listPrice}    siteName={deal.site_name} />
            <ProvRow label="Rent"          value={`${fmtCurrency(provenance.rent.value)}/mo`}        field={provenance.rent}         siteName={deal.site_name} />
            <ProvRow label="Interest rate" value={fmtPct(provenance.interestRate.value / 100)}       field={provenance.interestRate} siteName={deal.site_name} />
            <ProvRow label="Property tax"  value={`${fmtCurrency(provenance.propertyTax.value)}/yr`} field={provenance.propertyTax}  siteName={deal.site_name} />
            {provenance.hoa && <ProvRow label="HOA" value={`${fmtCurrency(provenance.hoa.value)}/mo`} field={provenance.hoa} siteName={deal.site_name} />}
            <ProvRow label="Insurance"     value={`${fmtCurrency(provenance.insurance.value)}/yr`}   field={provenance.insurance}    siteName={deal.site_name} />
          </div>
        </div>

        {/* Notes — feels like a writing surface (Notes.app / Bear),
            not a form textarea. Display serif for the body, generous
            padding, no border, looks like paper you write on. Saves
            on blur — same auto-save behavior. */}
        <div className="px-6 py-5" style={{ borderBottom: "0.5px solid var(--rv-border)" }}>
          <p className="text-[10px] uppercase tracking-widest font-medium mb-3 text-muted-foreground/60">
            Your notes
          </p>
          <div
            className="rounded-[12px] transition-colors bg-muted"
            style={{
              border:  "0.5px solid var(--rv-border)",
              padding: "14px 16px",
            }}
          >
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="What stood out? Numbers you want to remember? Things to ask the agent…"
              className="w-full bg-transparent border-none outline-none resize-none text-foreground"
              style={{
                minHeight:     96,
                fontSize:      14,
                fontFamily:    "var(--rv-font-display)",
                fontWeight:    400,
                lineHeight:    1.55,
                letterSpacing: "-0.005em",
              }}
            />
          </div>
          <p className="text-[10.5px] mt-2 leading-snug text-muted-foreground/60">
            Saved automatically when you click away.
          </p>
        </div>

        {/* Footer actions — primary "Open listing" since that's the most
            common follow-up; everything else secondary or ghost. */}
        <div className="flex items-center gap-2 px-6 py-5">
          <Button
            variant="primary"
            onClick={onOpenInBrowse}
            icon={<ExternalLink size={11} strokeWidth={2} />}
          >
            Open listing
          </Button>
          <Button
            variant="secondary"
            onClick={onOpenInBrowse}
            title="Open in browser, then re-analyze from the panel"
            icon={<RefreshCw size={11} strokeWidth={2} />}
          >
            Re-analyze
          </Button>
          <span className="flex-1" />
          {confirmDelete ? (
            <>
              <span className="text-[11.5px] text-muted-foreground">
                Delete this deal?
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={onDelete}
                style={{ color: "var(--rv-neg)", borderColor: "var(--rv-neg-bg)" }}
              >
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              icon={<Trash2 size={11} strokeWidth={2} />}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  ) }
}

function DetailMetric({
  label, value, sub, color, delta,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  color: string
  delta?: { text: string; tone: "pos" | "neg" | "neutral" } | null
}) {
  const deltaColor =
    delta?.tone === "pos" ? "var(--rv-pos)" :
    delta?.tone === "neg" ? "var(--rv-neg)" :
                            "var(--rv-t4)"
  return (
    <Card className="rounded-[10px] gap-0 p-3 min-w-0 overflow-hidden hover:shadow-md transition-shadow">
      <div className="text-[9.5px] uppercase tracking-widest font-medium truncate text-muted-foreground/60">
        {label}
      </div>
      <div
        className="font-bold tabular-nums leading-none truncate mt-1"
        style={{ color, fontSize: 22, letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
      {delta && (
        <div
          className="text-[10px] leading-none tabular-nums truncate mt-1 inline-flex items-center gap-0.5"
          style={{ color: deltaColor }}
          title="vs default analysis"
        >
          {delta.tone === "pos" && "↑"}
          {delta.tone === "neg" && "↓"}
          {delta.text}
        </div>
      )}
      {sub && (
        <div className="text-[10.5px] leading-none truncate mt-1 text-muted-foreground">{sub}</div>
      )}
    </Card>
  )
}

/** Pipeline-page version of the delta formatter (the panel has its own;
 *  DRY'ing them would mean exposing format helpers that aren't otherwise
 *  shared). Identical contract: returns text + tone, or null when the
 *  delta is below the noise threshold. */
function formatDeltaPipe(
  scenarioValue: number,
  defaultValue:  number,
  kind:          "currency" | "pct" | "ratio",
): { text: string; tone: "pos" | "neg" | "neutral" } | null {
  if (!Number.isFinite(scenarioValue) || !Number.isFinite(defaultValue)) return null
  const delta = scenarioValue - defaultValue
  const epsilon = kind === "currency" ? 1 : kind === "pct" ? 0.0001 : 0.005
  if (Math.abs(delta) < epsilon) return null
  const sign = delta > 0 ? "+" : "−"
  const abs  = Math.abs(delta)
  let text: string
  if (kind === "currency")    text = `${sign}$${Math.round(abs).toLocaleString("en-US")}/mo vs default`
  else if (kind === "pct")    text = `${sign}${(abs * 100).toFixed(2)}pp vs default`
  else                        text = `${sign}${abs.toFixed(2)} vs default`
  const tone: "pos" | "neg" | "neutral" = delta > 0 ? "pos" : "neg"
  return { text, tone }
}

function ProvRow({
  label, value, field, siteName,
}: {
  label:     string
  value:     string
  field:     { source: string; confidence: string }
  siteName?: string | null
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 py-2 last:border-0"
      style={{ borderBottom: "0.5px solid var(--rv-border)" }}
    >
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12.5px] tabular-nums truncate text-muted-foreground">{value}</span>
        <SourceMark source={field.source} siteName={siteName} />
      </div>
    </div>
  )
}

// ── Comparison view ────────────────────────────────────────────────────────
//
// Side-by-side factual diff. No verdict, no scoring — just the numbers
// laid out so the differences are obvious at a glance. Cells where ALL
// deals share the same value are dimmed; cells where this row diverges
// from the rest are quietly highlighted, drawing the eye to the deltas.

function ComparisonView({
  deals, onClear, onRemove, onOpenInBrowse,
}: {
  deals:          SavedDeal[]
  onClear:        () => void
  onRemove:       (id: string) => void
  onOpenInBrowse: (url: string) => void
}) {
  // AI factual diff — rendered above the table when available. Rebuilt
  // whenever the comparison set changes. Failures (no key, network)
  // silently fall back to no summary; the table is the load-bearing UI.
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  useEffect(() => {
    let cancelled = false
    setSummary(null)
    setSummaryLoading(true)
    const payload = deals.map((d) => ({
      address:    d.address,
      city:       d.city,
      state:      d.state,
      propertyType: d.snapshot?.propertyType,
      listPrice:  d.list_price,
      beds:       d.beds,
      baths:      d.baths,
      sqft:       d.sqft,
      monthlyCashFlow: d.snapshot?.metrics?.monthlyCashFlow,
      capRate:    d.snapshot?.metrics?.capRate,
      cashOnCash: d.snapshot?.metrics?.cashOnCash,
      dscr:       d.snapshot?.metrics?.dscr,
      grm:        d.snapshot?.metrics?.grm,
      tags:       d.tags,
    }))
    void window.electronAPI?.compareDeals?.(payload).then((res) => {
      if (cancelled) return
      setSummaryLoading(false)
      if (res?.ok && res.summary) setSummary(res.summary)
    }).catch(() => { if (!cancelled) setSummaryLoading(false) })
    return () => { cancelled = true }
  }, [deals])

  const rows: ComparisonRowDef[] = [
    {
      kind: "text", label: "Address",
      values: deals.map((d) => [d.address, d.city, d.state].filter(Boolean).join(", ") || null),
    },
    { kind: "currency", label: "Price",
      values: deals.map((d) => d.list_price), tone: "neutral" },
    { kind: "text", label: "Beds",
      values: deals.map((d) => d.beds != null ? String(d.beds) : null) },
    { kind: "text", label: "Baths",
      values: deals.map((d) => d.baths != null ? String(d.baths) : null) },
    { kind: "text", label: "SqFt",
      values: deals.map((d) => d.sqft != null ? d.sqft.toLocaleString() : null) },
    { kind: "currency", label: "Cash flow / mo",
      values: deals.map((d) => d.snapshot.metrics.monthlyCashFlow), tone: "good-positive" },
    { kind: "pct", label: "Cap rate",
      values: deals.map((d) => d.snapshot.metrics.capRate), tone: "good-high" },
    { kind: "pct", label: "Cash on cash",
      values: deals.map((d) => d.snapshot.metrics.cashOnCash), tone: "good-high" },
    { kind: "num", label: "DSCR",
      values: deals.map((d) => d.snapshot.metrics.dscr), dec: 2, tone: "good-high" },
    { kind: "num", label: "GRM",
      values: deals.map((d) => d.snapshot.metrics.grm), dec: 1, tone: "good-low" },
    { kind: "pct", label: "Break-even occ.",
      values: deals.map((d) => d.snapshot.metrics.breakEvenOccupancy), tone: "good-low" },
    { kind: "currency", label: "Cash invested",
      values: deals.map((d) => d.snapshot.metrics.totalCashInvested), tone: "neutral" },
    { kind: "currency", label: "Monthly rent",
      values: deals.map((d) => d.snapshot.inputs.monthlyRent), tone: "neutral" },
    { kind: "tags", label: "Tags",
      values: deals.map((d) => d.tags) },
    { kind: "text", label: "Stage",
      values: deals.map((d) => STAGE_LABEL[d.stage]) },
  ]

  return (
    <div
      className="flex flex-col h-full overflow-hidden bg-background"
      // Used to be transparent + pe:none for the old 45% middle-column
      // overlay layout where this view sat over the MapShell. The new
      // full-canvas wrapper owns its own background and pointer events,
      // so this opts in fully — fixes the scroll-wheel-falling-through
      // bug where the user couldn't scroll the comparison content.
      style={{ pointerEvents: "auto" }}
    >
      {/* Internal header removed — the parent CompareWorkspace
          wrapper renders its own header (Back · "Comparing N deals" ·
          Clear) above this component, so duplicating it here was just
          two stacked title strips. */}

      <div className="flex-1 min-h-0 overflow-y-auto panel-scroll">
        {/* AI narration — prominent hero card above the table. The buddy
            reads the differences and tells you the story in display serif.
            Sets the frame for what the table below shows. */}
        {(summary || summaryLoading) && (
          <div className="px-6 pt-6">
            <div
              className="flex items-start gap-3.5 rounded-[14px] px-5 py-5"
              style={{
                background: "var(--rv-accent-dim)",
                border:     "0.5px solid var(--rv-accent-border)",
                boxShadow:  "var(--rv-shadow-inset)",
              }}
            >
              <span
                className="shrink-0 inline-flex items-center justify-center rounded-full mt-[2px]"
                style={{
                  width:      24,
                  height:     24,
                  color:      "var(--rv-accent)",
                  background: "rgba(48,164,108,0.18)",
                  border:     "0.5px solid var(--rv-accent-border)",
                }}
              >
                <Sparkles size={12} strokeWidth={2} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-primary">
                  AI Noticed
                </p>
                <p
                  className="mt-2 leading-snug"
                  style={{
                    color:         summary ? "var(--rv-t1)" : "var(--rv-t3)",
                    fontSize:      15,
                    fontFamily:    "var(--rv-font-display)",
                    fontWeight:    400,
                    letterSpacing: "-0.012em",
                  }}
                >
                  {summary ?? "Reading the differences…"}
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="px-6 py-5">
          <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="text-left text-[10px] uppercase tracking-widest font-medium pb-3 text-muted-foreground/60">
                  {/* Empty corner cell */}
                </th>
                {deals.map((d) => (
                  <th
                    key={d.id}
                    className="text-left pb-3 px-3 align-bottom min-w-[140px]"
                  >
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12.5px] font-semibold leading-tight tabular-nums truncate text-foreground">
                          {d.list_price ? fmtCurrency(d.list_price) : "—"}
                        </p>
                        <Button
                          onClick={() => onRemove(d.id)}
                          aria-label="Remove from comparison"
                          variant="ghost"
                          size="icon-xs"
                          className="size-5"
                        >
                          <X size={11} strokeWidth={1.8} />
                        </Button>
                      </div>
                      {(d.address || d.city) && (
                        <p
                          className="text-[10.5px] leading-tight truncate text-muted-foreground"
                          title={[d.address, d.city, d.state].filter(Boolean).join(", ")}
                        >
                          {[d.address, d.city, d.state].filter(Boolean).join(", ")}
                        </p>
                      )}
                      <Button
                        onClick={() => onOpenInBrowse(d.source_url)}
                        variant="link"
                        size="xs"
                        className="self-start mt-0.5 p-0 h-auto text-[10.5px] text-primary"
                      >
                        <ExternalLink size={9} strokeWidth={2} />
                        Open
                      </Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <ComparisonRow key={i} row={row} dealCount={deals.length} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ComparisonRow({ row, dealCount }: { row: ComparisonRowDef; dealCount: number }) {
  // Determine "best" cell per row when there's a meaningful comparison.
  // For tone === good-positive / good-high → highest non-null wins.
  // For tone === good-low → lowest non-null wins.
  // For neutral/text/tags → no winner highlighting.
  let winnerIdx = -1
  if (row.kind === "currency" || row.kind === "pct" || row.kind === "num") {
    const tone = (row as { tone?: string }).tone
    if (tone && tone !== "neutral") {
      const vals = row.values as (number | null)[]
      const valid = vals
        .map((v, i) => ({ v, i }))
        .filter((x) => x.v != null) as { v: number; i: number }[]
      if (valid.length > 0) {
        const best = tone === "good-low"
          ? valid.reduce((a, b) => (b.v < a.v ? b : a))
          : valid.reduce((a, b) => (b.v > a.v ? b : a))
        // For currency cash-flow specifically, only highlight if it's positive
        if (row.kind === "currency" && tone === "good-positive" && best.v <= 0) {
          // skip
        } else {
          winnerIdx = best.i
        }
      }
    }
  }

  return (
    <tr>
      <td
        className="text-[11px] uppercase tracking-widest font-medium pr-4 py-2.5 align-top whitespace-nowrap text-muted-foreground/60"
        style={{ borderTop: "0.5px solid var(--rv-border)" }}
      >
        {row.label}
      </td>
      {Array.from({ length: dealCount }).map((_, i) => {
        const isWinner = i === winnerIdx
        const cellStyle: React.CSSProperties = {
          padding:    "10px 12px",
          borderTop:  "0.5px solid var(--rv-border)",
          color:      isWinner ? "var(--rv-accent)" : "var(--rv-t1)",
          fontWeight: isWinner ? 500 : 400,
        }
        return (
          <td key={i} className="text-[12.5px] tabular-nums align-top" style={cellStyle}>
            <ComparisonCell row={row} idx={i} />
          </td>
        )
      })}
    </tr>
  )
}

function ComparisonCell({ row, idx }: { row: ComparisonRowDef; idx: number }) {
  switch (row.kind) {
    case "currency": {
      const v = row.values[idx]
      if (v == null) return <span className="text-muted-foreground/60">—</span>
      const tone = (row as { tone?: string }).tone
      if (tone === "good-positive") {
        return <span>{`${v >= 0 ? "+" : ""}${fmtCurrency(v)}${row.label.includes("/") ? "" : ""}`}</span>
      }
      return <span>{fmtCurrency(v)}</span>
    }
    case "pct": {
      const v = row.values[idx]
      return v == null ? <span className="text-muted-foreground/60">—</span> : <span>{fmtPct(v)}</span>
    }
    case "num": {
      const v = row.values[idx]
      return v == null
        ? <span className="text-muted-foreground/60">—</span>
        : <span>{v.toFixed(row.dec ?? 2)}</span>
    }
    case "text": {
      const v = row.values[idx]
      return v
        ? <span className="block truncate" title={v} style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
        : <span className="text-muted-foreground/60">—</span>
    }
    case "tags": {
      const tags = row.values[idx]
      if (!tags || tags.length === 0) return <span className="text-muted-foreground/60">—</span>
      return (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="inline-flex items-center text-[10px] tracking-tight rounded-full px-1.5 py-[1px] text-muted-foreground bg-muted"
              style={{
                border: "0.5px solid var(--rv-border)",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )
    }
  }
}

type ComparisonRowDef =
  | { kind: "currency"; label: string; values: (number | null)[]; tone?: string }
  | { kind: "pct";      label: string; values: (number | null)[]; tone?: string }
  | { kind: "num";      label: string; values: (number | null)[]; dec?: number; tone?: string }
  | { kind: "text";     label: string; values: (string | null)[] }
  | { kind: "tags";     label: string; values: string[][] }

// ── Empty state for the detail pane ───────────────────────────────────────

function DetailEmpty({ filtered, hasAny }: { filtered: number; hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-12 text-center">
      <div
        className="w-12 h-12 rounded-[12px] flex items-center justify-center mb-4"
        style={{
          background: "rgba(48,164,108,0.06)",
          border:     "0.5px solid rgba(48,164,108,0.18)",
          color:      "var(--rv-accent)",
        }}
      >
        <ChevronRight size={18} strokeWidth={1.6} />
      </div>
      {!hasAny ? (
        <>
          <p className="text-[14px] font-medium text-foreground">
            Nothing here yet.
          </p>
          <p className="text-[12.5px] mt-2 leading-relaxed max-w-[300px] text-muted-foreground">
            Find a listing, hit Save, and I'll start watching it for you.
          </p>
        </>
      ) : filtered === 0 ? (
        <>
          <p className="text-[14px] font-medium text-foreground">
            Quiet stage.
          </p>
          <p className="text-[12.5px] mt-2 leading-relaxed max-w-[300px] text-muted-foreground">
            Nothing's here right now. Other stages might have moves —
            try the view selector at the top.
          </p>
        </>
      ) : (
        <>
          <p className="text-[14px] font-medium text-foreground">
            Pick one to dig in.
          </p>
          <p className="text-[12.5px] mt-2 leading-relaxed max-w-[300px] text-muted-foreground">
            I'll pull the numbers, the comps, and what looks weird.
          </p>
        </>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

const STAGES_VALID = new Set<DealStage>(DEAL_STAGES)
const LIST_W_DEFAULT = 360
const LIST_W_MIN     = 280
const LIST_W_MAX     = 520

// Named export — imported by AppLayout for always-mounted rendering.
// Default export below is a stub returning null (Next.js routing
// needs it; actual content lives at layout level).
export function PipelinePage() {
  return <Suspense><PipelinePageInner /></Suspense>
}
export default function PipelineRouteStub() { return null }

function PipelinePageInner() {
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const { pipeline: pipelineTopBarSlot } = useTopBarSlots()
  // Always-mounted-routes gate. See lib/useIsActiveRoute.ts. Pipeline
  // is "active" only on /pipeline; while the user is on /browse or
  // /settings, the initial-fetch effect and the window-focus refetch
  // listener pause so we don't fire Supabase queries in the background.
  const isActive      = useIsActiveRoute("pipeline")
  const stageParam    = searchParams.get("stage") as DealStage | null
  const stageFilter   = stageParam && STAGES_VALID.has(stageParam) ? stageParam : null
  /** Optional `?id=<dealId>` deep-link — when present and the deal exists in
   *  the loaded set, we pre-select it so links from the Browse start screen
   *  ("open in pipeline") land directly on the right detail view. */
  const idParam       = searchParams.get("id")

  // Sidebar-aware header padding removed — Pipeline header now lives
  // inside the AppTopBar (always positioned past the sidebar's right
  // edge) so the route doesn't need to compute its own offsets.

  const [deals,  setDeals]  = useState<SavedDeal[] | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [selId,  setSelId]  = useState<string | null>(null)
  // Esc clears the selection in map mode (collapses the detail rail).
  // Registers only when a deal is selected AND we're in map mode, so
  // it won't fight other Esc handlers when no rail is open.
  const [listW,  setListW]  = useState<number>(LIST_W_DEFAULT)
  // Theme-aware Mapbox style is now owned by the persistent MapShell —
  // the local mapStyleId observer was removed when the local
  // PipelineMap mount went away.

  // Esc deselects the current deal — collapses the detail rail back to 0
  // and gives the map full canvas. Available whenever a deal is selected
  // (no longer view-mode-gated since list and map are always co-visible).
  useEscape(!!selId, () => setSelId(null))
  /** Cmd/Ctrl-click toggles deals into this set; the detail pane swaps
   *  to a comparison view when size >= 2. Plain click clears it back to
   *  single-select on the clicked row. Capped at 4 — past that, the
   *  comparison columns get cramped. */
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set())
  /** Explicit compare mode — toggled from the header "Compare" button.
   *  When ON, plain click adds/removes a row from the compare set (no
   *  ⌘ modifier needed), and the rows show stronger select-affordance.
   *  Power users can still ⌘-click outside compare mode for the same
   *  result. The mode auto-exits when the set drops to 0. */
  const [compareMode, setCompareMode] = useState<boolean>(false)
  /** Pipeline canvas mode — "deals" (default, dashboard-style: list +
   *  detail rail, NO map visible) or "map" (full-bleed map with a small
   *  list overlay). Replaces the previous "map ambient behind a scrim"
   *  layout that committed to neither — the user picks what they're
   *  looking at. Persists across route changes via localStorage so it
   *  feels like a stable preference rather than session-local state. */
  // viewMode initial state must match between server and client to avoid
  // hydration mismatches. Reading localStorage in the initializer caused
  // the server to render viewMode="deals" while the client read a saved
  // "map" — the wrapper div's className + pointerEvents differed and
  // React threw a hydration error. Now we always start at "deals" and
  // hydrate from localStorage in a post-mount effect (one extra render
  // on first paint, but no hydration warning and no flash since the
  // chrome is identical for the milliseconds between renders).
  const [viewMode, setViewMode] = useState<"deals" | "table" | "kanban" | "map">("deals")
  useEffect(() => {
    try {
      const saved = localStorage.getItem("rv-pipeline-view")
      if (saved === "map" || saved === "table" || saved === "kanban" || saved === "deals") {
        if (saved !== "deals") setViewMode(saved)
      }
    } catch { /* private mode */ }
    // Run only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    try { localStorage.setItem("rv-pipeline-view", viewMode) } catch { /* private mode */ }
  }, [viewMode])
  // ── Watch check progress ──────────────────────────────────────────────
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const watchedCount = useMemo(
    () => (deals ?? []).filter((d) => d.watching).length,
    [deals]
  )

  const refresh = useCallback(() => {
    fetchPipeline().then(setDeals).catch((e) => setError(e?.message ?? "Couldn't load pipeline"))
  }, [])

  // Initial / on-activation refetch. Gated on isActive so the first
  // Supabase fetch holds until the user actually navigates to /pipeline,
  // and re-fires once on every return so saved-deal state is fresh.
  useEffect(() => {
    if (!isActive) return
    refresh()
  }, [refresh, isActive])
  // Window-focus refetch. Gated on isActive so we don't fetch every
  // time the app regains focus while the user is on /browse — that's
  // a real cost when the user alt-tabs to a Zillow tab and back. Now
  // only re-fetches when /pipeline is the visible surface.
  useEffect(() => {
    if (!isActive) return
    const onFocus = () => refresh()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [refresh, isActive])

  // Free-text search across the deal list. Empty string = no filter.
  // Matches case-insensitively against address / city / state / zip /
  // tags / site name. Persists in component state only (clears on
  // navigation) — most users don't want yesterday's search re-applied.
  const [searchQuery, setSearchQuery] = useState<string>("")

  // Filtered list — selected stage from URL, defaulting to "active" (no
  // Won/Passed), then narrowed further by the free-text search query.
  const filtered = useMemo<SavedDeal[]>(() => {
    if (!deals) return []
    let out = stageFilter
      ? deals.filter((d) => d.stage === stageFilter)
      : deals.filter((d) => d.stage !== "won" && d.stage !== "passed")
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      out = out.filter((d) => {
        const haystack = [
          d.address, d.city, d.state, d.zip, d.site_name,
          ...(d.tags ?? []),
        ].filter(Boolean).join(" ").toLowerCase()
        return haystack.includes(q)
      })
    }
    return out
  }, [deals, stageFilter, searchQuery])

  // Sort key — applied within each stage group. Persisted to localStorage
  // so the user's preference survives reloads. Default: recent activity
  // (most-recently-touched deals surface first).
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    if (typeof window === "undefined") return "recent"
    const raw = (typeof localStorage !== "undefined" && localStorage.getItem("rv:pipeline:sort")) || ""
    return SORT_KEYS.includes(raw as SortKey) ? (raw as SortKey) : "recent"
  })
  useEffect(() => {
    try { localStorage.setItem("rv:pipeline:sort", sortKey) } catch {}
  }, [sortKey])

  // Group filtered deals by stage. Linear-pattern: rendering as
  // `▾ Watching 9 / ▾ Interested 1 / …` group headers retires the
  // per-row "Stage" column and pill. Within a group, sort by the
  // user-selected sort key. Stage order matches DEAL_STAGES.
  const grouped = useMemo<{ stage: DealStage; deals: SavedDeal[] }[]>(() => {
    const buckets: Record<DealStage, SavedDeal[]> = {
      watching: [], interested: [], offered: [], won: [], passed: [],
    }
    for (const d of filtered) buckets[d.stage].push(d)
    return DEAL_STAGES
      .map((stage) => ({
        stage,
        deals: buckets[stage].sort(sortComparator(sortKey)),
      }))
      .filter((g) => g.deals.length > 0)
  }, [filtered, sortKey])

  // Collapsed-stage state. Persisted in localStorage so opening the
  // Pipeline tomorrow keeps yesterday's scoping. Default: every group
  // expanded.
  const [collapsedStages, setCollapsedStages] = useState<Set<DealStage>>(() => {
    if (typeof window === "undefined") return new Set()
    try {
      const raw = localStorage.getItem("rv:pipeline:collapsed-stages")
      if (!raw) return new Set()
      const parsed = JSON.parse(raw) as DealStage[]
      return new Set(parsed.filter((s) => DEAL_STAGES.includes(s)))
    } catch { return new Set() }
  })
  useEffect(() => {
    try {
      localStorage.setItem(
        "rv:pipeline:collapsed-stages",
        JSON.stringify(Array.from(collapsedStages))
      )
    } catch {}
  }, [collapsedStages])
  const toggleStage = useCallback((s: DealStage) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })
  }, [])

  // Selection rules:
  //  - `?id=` deep-link wins (open Pipeline with a specific deal selected,
  //    e.g. "save in Add deal mode" auto-routes here with id pre-filled)
  //  - If the currently-selected deal disappears from the filtered set,
  //    drop the selection (don't slide to the next row — that's surprising)
  //  - Otherwise leave selection alone. NO auto-first-row pick on initial
  //    load — first paint shows nothing in the detail panel, the user
  //    scans their pipeline and clicks what they want.
  useEffect(() => {
    if (filtered.length === 0) { setSelId(null); return }
    if (idParam) {
      const match = (deals ?? []).find((d) => d.id === idParam)
      if (match) {
        setSelId(match.id)
        router.replace("/pipeline" + (stageFilter ? `?stage=${stageFilter}` : ""))
        return
      }
    }
    if (selId && !filtered.find((d) => d.id === selId)) {
      setSelId(null)
    }
  }, [filtered, selId, idParam, deals, router, stageFilter])

  const selected = useMemo(
    () => (deals ?? []).find((d) => d.id === selId) ?? null,
    [deals, selId]
  )

  // ── Persistent map shell wiring ────────────────────────────────────
  // Pipeline drops the scrim entirely (the shell map IS the canvas
  // here), narrows the visible pins to the current stage filter, and
  // syncs selection both ways (shell click → selId; selId change →
  // shell selectedId so the marker style updates without re-render).
  // When the user lands here from a Browse pin click, the shell's
  // camera is already gliding to the right deal — we don't need to
  // trigger another flyTo.
  // Destructure stable callbacks so effects don't re-fire when any
  // OTHER piece of shell state (cameraTarget, scrimOpacity) changes.
  // The setters/flyTo/onPinClick are useCallbacked in the provider so
  // their identity is stable across renders.
  const {
    setScrimOpacity:    shellSetScrim,
    setVisibleDealIds:  shellSetVisible,
    setSelectedId:      shellSetSelected,
    onPinClick:         shellOnPinClick,
    flyTo:              shellFlyTo,
  } = useMapShell()

  useEffect(() => {
    shellSetScrim(0)
    return () => { shellSetScrim(0.92) }
  }, [shellSetScrim])
  useEffect(() => {
    shellSetVisible(new Set(filtered.map((d) => d.id)))
  }, [filtered, shellSetVisible])
  useEffect(() => {
    shellSetSelected(selId)
  }, [selId, shellSetSelected])
  useEffect(() => {
    // Pin click → select the deal. The shell does NOT auto-fly the
    // camera; the user keeps their portfolio overview unless they
    // explicitly request a recenter (via the "fit all / focus pin"
    // controls). Auto-flying on every selection blew away the very
    // overview the user wanted preserved.
    return shellOnPinClick((id) => setSelId(id))
  }, [shellOnPinClick])
  // Intentionally NO auto-flyTo on `selected` change. The map stays
  // at its current camera; the marker style updates to reflect the
  // selection (handled inside MapShell). Users zoom/pan freely.

  // Resolved comparison set in list order (stable column layout).
  const compareDeals = useMemo<SavedDeal[]>(
    () => (deals ?? []).filter((d) => compareIds.has(d.id)),
    [deals, compareIds]
  )

  // Auto-exit compare mode when the user clears the set — keeps the header
  // copy honest and avoids stranding the user in "Done" state with nothing
  // selected. Also gracefully recovers from clicking "Clear" in the pill.
  useEffect(() => {
    if (compareMode && compareIds.size === 0) setCompareMode(false)
  }, [compareMode, compareIds.size])

  // Esc handlers for compare phases. The escape stack is LIFO, so when
  // the user is in the comparison workspace AND has a deal selected,
  // Esc closes the deal first (registered later above), then a second
  // Esc backs out of the comparison.
  // - Comparison full-canvas → Esc returns to picking with selections preserved
  // - Picking phase           → Esc cancels (clears mode + selections)
  useEscape(!compareMode && compareDeals.length >= 2, () => setCompareMode(true))
  useEscape(compareMode, () => { setCompareMode(false); setCompareIds(new Set()) })

  const onRowClick = useCallback(
    (id: string, mods: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
      // Plain click is "additive" when EITHER the user explicitly turned on
      // compare mode (header button) or holds ⌘/Ctrl (power-user shortcut).
      // Either path lands in the same toggle-into-set behavior — and the
      // header copy makes the mode visible so the feature stops being
      // hidden behind a modifier key.
      const additive = compareMode || mods.metaKey || mods.ctrlKey
      if (additive) {
        setCompareIds((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else if (next.size < 4) next.add(id)
          // If the user is starting a multi-selection from a single-selected
          // row, seed the set with the current focal row + the new one.
          if (selId && next.size === 1 && !next.has(selId)) next.add(selId)
          return next
        })
      } else {
        setCompareIds(new Set())
        setSelId(id)
      }
    },
    [selId, compareMode]
  )

  // Double-click handler — single-click selects the row (current behavior).
  // Double-click ALSO flies the map camera to the deal at street zoom,
  // and switches the view to Map mode if currently in Deals view so the
  // zoom is visible. This is the "show me this on the map" gesture —
  // analogous to double-clicking a folder in Finder to open it.
  const onRowDoubleClick = useCallback((id: string) => {
    const deal = (deals ?? []).find((d) => d.id === id)
    if (!deal) return
    // Linear pattern: single-click previews (slide-out), double-click
    // opens the focused workspace at /pipeline/[id]. The previous
    // behavior was a map-camera fly-to, which conflated "look at this
    // location" with "work on this deal" — those are different intents
    // and double-click belongs to the focus one.
    router.push(`/pipeline/${deal.id}`)
  }, [deals, router])

  // Right-click handler — toggle the row in/out of the compare set without
  // any modifier key. Same effect as ⌘-click but discoverable from a plain
  // mouse, matching the macOS "right-click for the secondary action"
  // expectation. Seeds the set with the currently-selected focal row when
  // moving from single → multi (otherwise the user loses their context).
  const onRowToggleCompare = useCallback(
    (id: string) => {
      setCompareIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else if (next.size < 4) next.add(id)
        if (selId && next.size === 1 && !next.has(selId)) next.add(selId)
        return next
      })
    },
    [selId]
  )

  // Drag-up to compare — when the user drags any row, a drop target slides
  // down at the top of the list. Releasing on it adds the dragged row to
  // the compare set (same effect as right-click / ⌘-click), giving a third
  // gesture-friendly entry point. Tracked here at the parent because the
  // drop zone needs to know when ANY row is being dragged.
  const [draggingDealId, setDraggingDealId] = useState<string | null>(null)
  const onRowDragStart = useCallback((id: string) => setDraggingDealId(id), [])
  const onRowDragEnd   = useCallback(() => setDraggingDealId(null), [])
  const onCompareDrop  = useCallback((id: string) => {
    onRowToggleCompare(id)
    setDraggingDealId(null)
  }, [onRowToggleCompare])

  const onDealChange = useCallback((next: SavedDeal | null) => {
    setDeals((prev) => {
      if (!prev) return prev
      if (next === null && selId) return prev.filter((d) => d.id !== selId)
      if (!next) return prev
      return prev.map((d) => (d.id === next.id ? next : d))
    })
    if (next === null) setSelId(null)
  }, [selId])

  // ── Splitter drag ──────────────────────────────────────────────────────
  const splitterDragRef = useRef(false)
  const onSplitDown = useCallback((e: React.PointerEvent) => {
    splitterDragRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.cursor = "col-resize"
  }, [])
  const onSplitMove = useCallback((e: React.PointerEvent) => {
    if (!splitterDragRef.current) return
    // Compute width relative to the page's left edge — sidebar width is
    // outside this layout, so clientX directly maps to list width.
    // A bit imprecise but plenty good for a splitter.
    const containerLeft = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect().left ?? 0
    const w = e.clientX - containerLeft
    setListW(Math.max(LIST_W_MIN, Math.min(LIST_W_MAX, w)))
  }, [])
  const onSplitUp = useCallback((e: React.PointerEvent) => {
    if (!splitterDragRef.current) return
    splitterDragRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    document.body.style.cursor = ""
  }, [])

  const stageTitle = stageFilter ? STAGE_LABEL[stageFilter] : "All active"
  const total      = filtered.length

  // ── Portfolio stats — Mercury Transactions "Net change / Money in /
  //     Money out" stats strip equivalent. Computed across the *filtered*
  //     set so changing the stage filter narrows the totals appropriately.
  //     Cap rate and cash flow are means; total exposure is the sum of
  //     list prices. Used in the stats strip just below the header.
  const stats = useMemo(() => {
    let exposure = 0
    let cashFlowSum = 0
    let cashFlowCount = 0
    let capSum = 0
    let capCount = 0
    for (const d of filtered) {
      if (typeof d.list_price === "number" && Number.isFinite(d.list_price)) exposure += d.list_price
      const m = d.snapshot?.metrics
      if (m && Number.isFinite(m.monthlyCashFlow)) { cashFlowSum += m.monthlyCashFlow; cashFlowCount++ }
      if (m && Number.isFinite(m.capRate))         { capSum      += m.capRate;         capCount++ }
    }
    return {
      active:      filtered.length,
      exposure:    exposure || null,
      avgCashFlow: cashFlowCount > 0 ? cashFlowSum / cashFlowCount : null,
      avgCap:      capCount      > 0 ? capSum      / capCount      : null,
    }
  }, [filtered])

  const onCheckUpdates = useCallback(async () => {
    if (checking || watchedCount === 0) return
    setChecking(true)
    setCheckResult(null)
    try {
      const summary = await runWatchChecks()
      if (summary.changed === 0) {
        setCheckResult(`Nothing's moved. Checked ${summary.checked} ${summary.checked === 1 ? "deal" : "deals"}.`)
      } else {
        const totalDelta = summary.changes.reduce((acc, c) => acc + c.delta, 0)
        const sign = totalDelta >= 0 ? "+" : ""
        setCheckResult(
          `${summary.changed} of ${summary.checked} moved · net ${sign}${fmtCurrency(totalDelta)}`,
        )
      }
      // Refresh the pipeline so any updated list_price values render.
      refresh()
    } catch (err) {
      setCheckResult(err instanceof Error ? err.message : "Check failed")
    } finally {
      setChecking(false)
      // Auto-clear the result message after a few seconds.
      setTimeout(() => setCheckResult(null), 6000)
    }
  }, [checking, watchedCount, refresh])

  // Pipeline's "header content" — stage title + summary + Compare
  // controls + Watch-check button — now portals INTO the persistent
  // AppTopBar's pipeline slot instead of rendering its own bar at
  // the top of the page. State stays in this component (so all the
  // useState / handlers wire correctly); only the DOM destination
  // changes via createPortal. The bar itself doesn't re-mount on
  // route change.
  const pipelineHeaderContent = (
    // No explicit pointerEvents — inherit from the AppTopBar
    // ModeLayer's `pointer-events: none/auto` based on whether
    // /pipeline is the active route. Setting auto here overrode the
    // ModeLayer's none and made this slot intercept clicks across the
    // adaptive center even when sitting under Browse's URL bar
    // (Browse's URL toolbar lives in the same adaptive-center area
    // via the browse slot). The intermittent "URL bar dead" bug.
    <div className="flex items-center w-full px-3 gap-3">
        {/* Title group — wrapper marks no-drag so the cluster of
            interactive controls (PipelineViewsMenu trigger + count
            button) reads as one click target. Drag handles come from
            the empty strips above/below this group within the 42px
            bar (this group is ~26px tall, centered). */}
        <div
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="flex items-center gap-3 min-w-0"
        >
          <div className="flex items-baseline gap-2.5 min-w-0">
            <PipelineViewsMenu
              currentStage={stageFilter}
              onApplyView={(stage) => {
                router.push("/pipeline" + (stage ? `?stage=${stage}` : ""))
              }}
            />
            {/* Quiet stat trail — always-visible single line of muted
                12px text. Replaces the old 4-card stat strip + click-
                to-expand toggle. Linear/Mercury restraint: count, then
                exposure / avg cash flow / avg cap, separated by middot.
                Lives in the title bar so the page body opens straight
                onto the deal list with no preamble. */}
            <div
              className="inline-flex items-baseline gap-1.5 text-[12px] tabular-nums truncate"
              style={{ color: "var(--rv-t4)" }}
            >
              <span>{total === 1 ? "1 deal" : `${total} deals`}</span>
              {stats.exposure != null && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span><Currency value={stats.exposure} compact /></span>
                </>
              )}
              {stats.avgCashFlow != null && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span style={{ color: stats.avgCashFlow < 0 ? "var(--rv-neg)" : "var(--rv-t4)" }}>
                    <Currency value={Math.round(stats.avgCashFlow)} signed />/mo
                  </span>
                </>
              )}
              {stats.avgCap != null && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span>{(stats.avgCap * 100).toFixed(2)}%</span>
                </>
              )}
              {watchedCount > 0 && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span>{watchedCount} watching</span>
                </>
              )}
            </div>
          </div>
        </div>
        {/* View-toggle pills, Compare control, and Watch button were
            here previously — they've moved to the Pipeline sub-bar
            (rendered below in the body) so the title bar holds only
            the page identity (view selector + count). The bar reads
            calmer + has more drag area, and the route-specific tools
            sit closer to the data they control. */}
        <span className="flex-1" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      </div>
  )

  // Sub-bar — Pipeline-specific controls (view-toggle, Compare, Watch).
  // Renders inline in the body (NOT in the AppTopBar slot) right above
  // the data view, so route-specific tools live with the data they
  // operate on. Always visible regardless of viewMode so the user can
  // switch views from anywhere.
  const pipelineSubBar = (
    <div
      className="shrink-0 flex items-center gap-3 px-4 border-b border-foreground/[0.07] bg-background"
      style={{ height: 40, pointerEvents: "auto" }}
    >
      {/* View-toggle pill — Deals / Table / Kanban / Map */}
      {compareDeals.length < 2 && (
        // Sliding-indicator view toggle. The active "pill" is a single
        // absolutely-positioned div that animates between tabs with
        // Apple-spring instead of swapping bg classes per-tab. Linear,
        // Vercel and Stripe all use this pattern — the motion makes
        // mode switching feel physical.
        <ViewToggle
          modes={["deals", "table", "kanban", "map"]}
          active={viewMode}
          onChange={(m) => setViewMode(m as typeof viewMode)}
        />
      )}

      {/* Compare entry — single button. The picking state (progress
          dots, "X of 4 picked", Compare CTA) moved out of the sub-bar
          and into the floating CompareSelectionBar at the bottom of
          the page so the sub-bar stays calm. Pressed → enters compare
          mode; the bottom bar appears, rows become pickable. */}
      {!compareMode && compareIds.size === 0 && total > 1 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setCompareMode(true)}
          title="Pick 2–4 deals to see them side-by-side"
          icon={<GitCompareArrows size={11} strokeWidth={2} />}
        >
          Compare
        </Button>
      )}

      {/* Spacer + Sort + Watch on the right */}
      <span className="flex-1" />
      {viewMode === "deals" && filtered.length > 1 && (
        <SortMenu sortKey={sortKey} onChange={setSortKey} />
      )}
      {watchedCount > 0 && (
        <div className="flex items-center gap-2">
          {checkResult && (
            <span className="text-[11.5px] tracking-tight rv-watch-toast text-muted-foreground">
              {checkResult}
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={onCheckUpdates}
            disabled={checking}
            title={`Re-check ${watchedCount} watched ${watchedCount === 1 ? "deal" : "deals"} for price changes`}
            icon={
              <RefreshCw
                size={11}
                strokeWidth={2}
                className={checking ? "animate-spin" : ""}
                style={{ animationDuration: checking ? "1s" : undefined }}
              />
            }
          >
            {checking ? `Checking ${watchedCount}…` : `Check ${watchedCount}`}
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <div
      // Map view: outer wrapper transparent so the persistent MapShell
      // (z=0 behind every route) shows through the middle column.
      // Other views: opaque cream so the map doesn't bleed through.
      // Earlier this was always `bg-background` opaque, which made
      // Map view render solid black (the wrapper hid the map
      // entirely, regardless of the inner middle column's transparency).
      className={cn(
        "flex flex-col h-full overflow-hidden relative",
        viewMode !== "map" && "bg-background"
      )}
      style={{
        // AlwaysMountedRoutes' layer is now pe:none — routes opt into
        // pe:auto on their own outer wrapper. Pipeline does that here,
        // EXCEPT in Map view where we want pe:none so drags fall
        // through to the persistent MapShell behind. Internal Pipeline
        // surfaces (deal list, splitter, detail rail, bulk bar) re-
        // enable pe:auto explicitly inside.
        pointerEvents: viewMode === "map" ? "none" : "auto",
      }}
    >
      {/* Pipeline header content portals into the persistent
          AppTopBar's pipeline slot so the bar adapts without
          re-mounting. Page renders body only. */}
      {pipelineTopBarSlot && createPortal(pipelineHeaderContent, pipelineTopBarSlot)}

      {/* Compare-mode banner — REMOVED. The picking state is now
          announced by the floating CompareSelectionBar at the bottom
          (no layout push) + the picked rows highlighting in the list.
          The banner duplicated information without adding direction. */}

      {/* Pipeline sub-bar — view-toggle, Compare control, Watch button.
          Always visible (regardless of viewMode) since it's the
          "what view do I want" surface. Sits on the body bg below
          the title bar. */}
      {pipelineSubBar}

      {/* Stat strip + velocity disclosure removed entirely. Stats now
          live as a quiet single-line trail in the title bar (12px,
          muted). Velocity moved off this page — it's an Insights-class
          surface, not something the user studies while triaging deals.
          The page body opens straight to the deal list. */}

      {/* Body — list (always) + map (always) + detail rail (slides in)
          OR comparison view (replaces map when comparing 2+).

          The architecture matches Zillow Map Search / Airbnb's map view:
          you can scan the list AND see geographic distribution AT THE
          SAME TIME, never one OR the other. Selecting a deal highlights
          it in both surfaces; the detail rail slides in over the right
          portion of the map (map stays visible underneath). */}
      <div
        className="flex flex-1 min-h-0 relative"
        style={{
          zIndex: 1,
          // pe:none on the body — every actual surface (list, detail
          // rail, compare panes) re-enables pointer-events on itself.
          // This lets drags in the empty middle region fall all the
          // way through to the MapShell at z-0 of <main>.
          pointerEvents: "none",
        }}
      >
        {error && (
          // Error state — fills the full body with a cream surface so
          // the dark MapShell underneath doesn't bleed through. Same
          // BuddyMark treatment as the empty state for consistency.
          <div className="flex items-center justify-center w-full bg-background" style={{ pointerEvents: "auto" }}>
            <div className="flex flex-col items-center gap-4 max-w-[320px] text-center">
              <div className="flex aspect-square size-12 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/20">
                <BuddyMark size={22} tone="muted" />
              </div>
              <div className="flex flex-col gap-1.5">
                <p
                  className="text-foreground"
                  style={{ fontFamily: "var(--rv-font-display)", fontSize: 16, fontWeight: 500, letterSpacing: "-0.012em" }}
                >
                  Couldn't load your pipeline
                </p>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {error}
                </p>
              </div>
            </div>
          </div>
        )}

        {!error && deals === null && (
          // Loading state — skeleton-shaped placeholders matching the
          // real layout (deal list rows on the left, generous middle
          // column, detail rail on the right). Replaces the centered
          // BuddyMark spinner. Premium pattern: when content is on its
          // way, show what it WILL look like, not a loading indicator.
          <div className="flex w-full bg-background" style={{ pointerEvents: "auto" }}>
            {/* Left list — 6 row skeletons. Sits on the body bg
                (--background) — the LISTINGS are work content, not
                chrome, so they share the bright work-surface plane.
                Was previously --sidebar (chrome tone) which made the
                whole list feel recessed instead of foreground. */}
            <div
              className="shrink-0 flex flex-col h-full overflow-hidden bg-background"
              style={{
                width:        listW,
              }}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-4 py-3 border-b border-foreground/[0.04] rv-skeleton-pulse"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="size-7 rounded-md bg-foreground/[0.06] shrink-0" />
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <div className="h-3 w-3/4 rounded bg-foreground/[0.08]" />
                    <div className="h-2.5 w-1/2 rounded bg-foreground/[0.05]" />
                  </div>
                  <div className="h-3 w-12 rounded bg-foreground/[0.06]" />
                </div>
              ))}
            </div>
            {/* Middle column — empty (matches layout when no selection) */}
            <div className="flex-1" />
            {/* Right rail — collapsed (matches no-selection state) */}
          </div>
        )}

        {!error && deals !== null && viewMode === "table" && (
          <div
            className="flex-1 overflow-y-auto panel-scroll bg-background px-6 py-4"
            style={{ pointerEvents: "auto" }}
          >
            <div className="max-w-[1280px] mx-auto">
              <PipelineDealTable
                deals={filtered}
                selectedId={selId}
                onSelect={(id) => onRowClick(id, { metaKey: false, ctrlKey: false, shiftKey: false })}
                selectedIds={Array.from(compareIds)}
                onToggleSelect={(id) => onRowToggleCompare(id)}
              />
            </div>
          </div>
        )}

        {!error && deals !== null && viewMode === "kanban" && (
          <div
            className="flex-1 overflow-y-auto panel-scroll bg-background px-4 py-4"
            style={{ pointerEvents: "auto" }}
          >
            <PipelineKanban
              deals={filtered}
              onSelect={(id) => onRowClick(id, { metaKey: false, ctrlKey: false, shiftKey: false })}
              onMoveStage={async (id, nextStage) => {
                // Optimistic flip — the card visibly lands in the new
                // lane immediately. moveDealStage IPC fires next; revert
                // on failure so the optimistic UI doesn't stick if the
                // network call fails.
                const before = deals?.find((d) => d.id === id)
                if (!before) return
                setDeals((prev) => prev?.map((d) =>
                  d.id === id
                    ? { ...d, stage: nextStage, updated_at: new Date().toISOString() }
                    : d
                ) ?? null)
                const ok = await moveDealStage(id, nextStage)
                if (!ok) {
                  setDeals((prev) => prev?.map((d) => d.id === id ? before : d) ?? null)
                }
              }}
            />
          </div>
        )}

        {/* MapShell — mounted ONLY when Map view is active. The Mapbox
            GL instance is heavy (~30-40MB + tile requests + GPU work)
            and used to live as a persistent app-shell layer for
            Browse + Pipeline ambient backdrops. After the rebuild,
            it's only ever visible here, so we mount on demand and
            tear down when leaving Map view. The MapShellProvider
            context above stays alive at app level so other code can
            publish deals/selection without depending on the map
            being mounted. */}
        {!error && deals !== null && viewMode === "map" && (
          // z=-1 puts the map BEHIND the static flex children below
          // (deal list pane, detail panel). Otherwise CSS stacking
          // paints positioned z=0 elements ON TOP of static block
          // children — the map would cover the deal list, which read
          // as the deal list being "see-through" (it was hidden, not
          // transparent). With z=-1 the map is the backdrop; the
          // opaque deal list + detail panel cover their portions and
          // the transparent middle column lets the map show through.
          <div
            className="absolute inset-0"
            style={{ zIndex: -1, pointerEvents: "auto" }}
          >
            <MapShell />
          </div>
        )}

        {/* COMPARISON WORKSPACE — full pipeline body.
            Renders only after the user explicitly clicks "Compare N"
            from the floating selection bar (compareMode flips false
            with 2+ selections preserved). The previous design squeezed
            the comparison into a 45% slice of a 3-column layout, which
            cropped content off-screen. Now ComparisonView gets the full
            canvas with a slim header strip for back-out + meta.
            Back returns to picking mode with selections preserved so
            the user can swap a deal out and re-enter comparison. */}
        {!error && deals !== null && !compareMode && compareDeals.length >= 2 && (
          <div
            className="flex flex-col w-full h-full bg-background"
            style={{ pointerEvents: "auto" }}
          >
            <div
              className="shrink-0 flex items-center gap-3 px-4 border-b border-foreground/[0.07]"
              style={{ height: 40 }}
            >
              <button
                onClick={() => setCompareMode(true)}
                className="inline-flex items-center gap-1.5 text-[12px] tracking-tight text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded-md"
                title="Back to picking (Esc)"
              >
                <ChevronRight
                  size={13}
                  strokeWidth={2.2}
                  style={{ transform: "rotate(180deg)" }}
                />
                <span>Back</span>
              </button>
              <span
                aria-hidden
                className="size-1 rounded-full bg-foreground/[0.18]"
                style={{ width: 4, height: 4 }}
              />
              <span className="text-[12px] tracking-tight text-foreground">
                Comparing {compareDeals.length} deals
              </span>
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="xs"
                onClick={() => { setCompareMode(false); setCompareIds(new Set()) }}
              >
                Clear
              </Button>
            </div>
            <div className="flex-1 min-h-0">
              <ComparisonView
                deals={compareDeals}
                onClear={() => setCompareIds(new Set())}
                onRemove={(id) => setCompareIds((prev) => {
                  const next = new Set(prev)
                  next.delete(id)
                  return next
                })}
                onOpenInBrowse={(url) => router.push(`/browse?url=${encodeURIComponent(url)}`)}
              />
            </div>
          </div>
        )}

        {!error && deals !== null && !(!compareMode && compareDeals.length >= 2) && viewMode !== "table" && viewMode !== "kanban" && (
          <>
            {/* LEFT — deal list.
                In Deals view: takes the full available width (no
                middle column / no splitter — the previous empty
                middle was wasted space + the user's eye competed
                between three regions). The detail rail still slides
                in from the right when a deal is selected.
                In Map view: fixed-width pane next to the splitter
                and map middle column. */}
            <div
              className={cn(
                "flex flex-col h-full overflow-hidden bg-background",
                viewMode === "map" ? "shrink-0" : "flex-1 min-w-0"
              )}
              style={{
                // Body bg, NOT --sidebar — the listings are work
                // content, not chrome. See the loading-state comment
                // above for full rationale.
                ...(viewMode === "map" ? { width: listW } : null),
                boxShadow:    viewMode === "map" ? "1px 0 0 rgba(255,255,255,0.06)" : undefined,
                pointerEvents: "auto",
              }}
            >
              {/* Search bar — filters the deal list by address / city /
                  state / zip / tag / source. Sticky at top of the list
                  pane so it stays visible while the user scrolls. */}
              <div className="shrink-0 px-3 py-2 border-b border-border bg-background">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Search ${(deals?.length ?? 0)} deal${deals?.length === 1 ? "" : "s"}…`}
                    className="w-full h-8 pl-8 pr-7 text-[12.5px] rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground"
                    aria-label="Search deals"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 size-4 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      aria-label="Clear search"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>
              {/* Column headers — only in dense (Deals) mode. Stage
                  column is GONE: deals are now grouped by stage with
                  collapsible group headers, so per-row stage data would
                  duplicate the header. Three columns of metrics +
                  address. */}
              {viewMode === "deals" && filtered.length > 0 && (
                <div
                  className="shrink-0 flex items-center gap-3 text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground border-b border-foreground/[0.07] bg-background"
                  style={{ padding: "6px 16px", paddingLeft: 8 + 8 + 28 + 12 /* outer + inner + sourcemark + gap, matches row's address text start */ }}
                >
                  <div className="flex-1 min-w-0">Address</div>
                  <span className="shrink-0 text-right" style={{ width: 80 }}>Price</span>
                  <span className="shrink-0 text-right" style={{ width: 90 }}>Cash flow</span>
                  <span className="shrink-0 text-right" style={{ width: 56 }}>Cap</span>
                  <span className="shrink-0 text-right" style={{ width: 36 }}>Age</span>
                </div>
              )}
              <div className="flex-1 overflow-y-auto panel-scroll relative">
                <CompareDropZone
                  visible={draggingDealId !== null}
                  onDrop={(id) => onCompareDrop(id)}
                />
                {filtered.length === 0 ? (
                  <ListEmpty stageTitle={stageTitle} hasAny={(deals?.length ?? 0) > 0} onClearStage={() => router.push("/pipeline")} />
                ) : viewMode === "deals" ? (
                  // Grouped rendering — Linear pattern. Each non-empty
                  // stage gets a collapsible header (▸ Watching 9) above
                  // its rows. Group order matches DEAL_STAGES.
                  grouped.map(({ stage, deals: stageDeals }) => {
                    const collapsed = collapsedStages.has(stage)
                    return (
                      <div key={stage}>
                        <button
                          onClick={() => toggleStage(stage)}
                          className="w-full flex items-center gap-2 text-left transition-colors hover:bg-foreground/[0.03]"
                          style={{
                            padding: "6px 16px",
                            background: "var(--rv-elev-1, transparent)",
                            borderBottom: "0.5px solid oklch(from var(--foreground) l c h / 0.05)",
                          }}
                          title={collapsed ? `Show ${STAGE_LABEL[stage]}` : `Hide ${STAGE_LABEL[stage]}`}
                        >
                          <ChevronDown
                            size={11}
                            strokeWidth={2.4}
                            className="text-muted-foreground"
                            style={{
                              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                              transition: "transform 160ms cubic-bezier(0.32,0.72,0,1)",
                            }}
                          />
                          <span
                            aria-hidden
                            className="rounded-full shrink-0"
                            style={{ width: 6, height: 6, background: STAGE_COLOR[stage] }}
                          />
                          <span className="text-[12px] font-medium text-foreground">
                            {STAGE_LABEL[stage]}
                          </span>
                          <span className="text-[11.5px] tabular-nums text-muted-foreground/70">
                            {stageDeals.length}
                          </span>
                        </button>
                        {!collapsed && stageDeals.map((deal) => (
                          <DealListRow
                            key={deal.id}
                            deal={deal}
                            active={compareIds.size < 2 && selId === deal.id}
                            multiSelected={compareIds.has(deal.id)}
                            compareMode={compareMode}
                            dense
                            hideStagePill
                            onSelect={(mods) => onRowClick(deal.id, mods)}
                            onDoubleSelect={() => onRowDoubleClick(deal.id)}
                            onContextMenuAdd={() => onRowToggleCompare(deal.id)}
                            onDragStartRow={onRowDragStart}
                            onDragEndRow={onRowDragEnd}
                          />
                        ))}
                      </div>
                    )
                  })
                ) : (
                  // Map view — narrow pane keeps the flat list (stacked
                  // rows). Group headers would chop the limited vertical
                  // space too aggressively here.
                  filtered.map((deal) => (
                    <DealListRow
                      key={deal.id}
                      deal={deal}
                      active={compareIds.size < 2 && selId === deal.id}
                      multiSelected={compareIds.has(deal.id)}
                      compareMode={compareMode}
                      dense={false}
                      onSelect={(mods) => onRowClick(deal.id, mods)}
                      onDoubleSelect={() => onRowDoubleClick(deal.id)}
                      onContextMenuAdd={() => onRowToggleCompare(deal.id)}
                      onDragStartRow={onRowDragStart}
                      onDragEndRow={onRowDragEnd}
                    />
                  ))
                )}
              </div>
            </div>
            {/* Splitter — only in Map view (where the list pane is
                resizable next to the map). In Deals view the list
                takes the full width and there's no splitter. */}
            {viewMode === "map" && (
              <div
                onPointerDown={onSplitDown}
                onPointerMove={onSplitMove}
                onPointerUp={onSplitUp}
                onPointerCancel={onSplitUp}
                className="rv-splitter shrink-0 cursor-col-resize select-none"
                style={{ width: 4, pointerEvents: "auto" }}
                title="Drag to resize"
              />
            )}

            {/* MIDDLE — only renders in Map view (the map shows through
                the transparent column). The compare-mode side pane and
                the 45%-height comparison-in-the-middle hack are gone:
                the comparison now takes the full pipeline body (handled
                by the COMPARISON WORKSPACE block above), and picking
                state is carried by the floating selection bar at the
                bottom + the dense list rows highlighting as picked. */}
            {viewMode === "map" && (
              <div
                className="flex flex-1 min-w-0 h-full"
                style={{ pointerEvents: "none" }}
              />
            )}

            {/* RIGHT — full-height detail rail. Sibling of the list and
                map area, NOT nested inside the map column, so it spans the
                entire pipeline body height the same way the Browse panel
                does. Hidden during compare mode (the comparison view is
                the focus then). */}
            {!compareMode && compareDeals.length < 2 && (
              <div
                className="shrink-0 h-full bg-background relative"
                style={{
                  width:        selected ? 460 : 0,
                  overflow:     "hidden",
                  boxShadow:    "-1px 0 0 rgba(255,255,255,0.06)",
                  transition:   "width 240ms cubic-bezier(0.32, 0.72, 0, 1)",
                  pointerEvents: "auto",
                }}
              >
                {/* Close (X) — floats top-right of the rail. The
                    "Open in full" pill that used to live next to it
                    is now the prominent "Open workspace" primary
                    button in the topbar action row (more discoverable
                    than a hidden floating chrome control). */}
                {selected && (
                  <button
                    onClick={() => setSelId(null)}
                    aria-label="Close"
                    title="Close (Esc)"
                    className="absolute z-20 inline-flex items-center justify-center rounded-full transition-colors"
                    style={{
                      top: 10,
                      right: 10,
                      width: 26,
                      height: 26,
                      background: "var(--rv-popover-bg)",
                      backdropFilter: "blur(10px) saturate(160%)",
                      WebkitBackdropFilter: "blur(10px) saturate(160%)",
                      border: "0.5px solid var(--rv-border)",
                      color: "var(--rv-t2)",
                      boxShadow: "var(--rv-shadow-outer-sm)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)" }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t2)" }}
                  >
                    <X size={13} strokeWidth={2.2} />
                  </button>
                )}
                {selected ? (
                  <DealDetail deal={selected} onChange={onDealChange} />
                ) : (
                  <DetailEmpty filtered={filtered.length} hasAny={(deals?.length ?? 0) > 0} />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Compare-mode selection bar — floats at bottom-center while
          the user is picking deals to compare. Replaces the old top
          banner + side selecting pane. Linear/Stripe pattern: a quiet
          floating bar that owns the picking state without pushing the
          layout around. Stays visible while picking 2-4; clicking
          Compare commits and launches the full-canvas comparison. */}
      {compareMode && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-3 py-2 rounded-full"
          style={{
            bottom: 20,
            background: "var(--rv-popover-bg)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            border: "0.5px solid var(--rv-border)",
            boxShadow: "var(--rv-shadow-outer-md)",
            pointerEvents: "auto",
          }}
        >
          <div className="flex items-center gap-1 pl-1">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                style={{
                  width: 6, height: 6, borderRadius: 99,
                  background: i < compareIds.size ? "var(--rv-accent)" : "var(--rv-elev-3)",
                  border: i < compareIds.size ? "none" : "0.5px solid var(--rv-border)",
                  transition: "background-color 160ms ease",
                }}
              />
            ))}
          </div>
          <span className="text-[12px] tracking-tight tabular-nums text-foreground">
            {compareIds.size === 0
              ? "Click deals to compare"
              : compareIds.size === 1
              ? "1 picked · pick one more"
              : `${compareIds.size} of 4 picked`}
          </span>
          <Button
            onClick={() => { setCompareMode(false); setCompareIds(new Set()) }}
            variant="ghost"
            size="xs"
          >
            Cancel
          </Button>
          {compareDeals.length >= 2 && (
            <Button
              onClick={() => setCompareMode(false)}
              variant="default"
              size="sm"
              icon={<GitCompareArrows size={11} strokeWidth={2} />}
              title={`Compare ${compareDeals.length} side-by-side`}
            >
              Compare {compareDeals.length}
            </Button>
          )}
        </div>
      )}

      {/* Bulk action bar — floats at bottom-center whenever 1+ deals
          are checked OUTSIDE compare mode (table multi-select or
          right-click "add to compare"). When compareMode is active,
          the dedicated CompareSelectionBar above takes over instead. */}
      {!compareMode && compareIds.size > 0 && (
        <PipelineBulkBar
          count={compareIds.size}
          canCompare={compareIds.size >= 2 && compareIds.size <= 4}
          onCompare={() => {
            // Existing compare flow already triggers when compareIds.size >= 2
            // and the comparison view replaces the map. Here we just make the
            // implicit explicit: clicking Compare from the bar mounts the view.
            setCompareMode(true)
          }}
          onMoveStage={async (stage) => {
            const ids = Array.from(compareIds)
            // Optimistic batch flip
            setDeals((prev) => prev?.map((d) =>
              ids.includes(d.id)
                ? { ...d, stage, updated_at: new Date().toISOString() }
                : d
            ) ?? null)
            // Fire IPCs in parallel; on any failure, refetch authoritative.
            const results = await Promise.all(ids.map((id) => moveDealStage(id, stage)))
            if (results.some((ok) => !ok)) {
              fetchPipeline().then((rows) => setDeals(rows ?? null)).catch(() => {})
            }
            setCompareIds(new Set())
          }}
          onDelete={async () => {
            const ids = Array.from(compareIds)
            // Optimistic remove
            setDeals((prev) => prev?.filter((d) => !ids.includes(d.id)) ?? null)
            await Promise.all(ids.map((id) => deleteDeal(id)))
            setCompareIds(new Set())
          }}
          onClear={() => setCompareIds(new Set())}
        />
      )}
    </div>
  )
}

/** Slim banner that drops in below the header when compareMode is on.
 *  Visually announces the mode change ("you're now picking deals to
 *  compare") and shows a live counter. Slides via max-height + opacity so
 *  the layout shift is smooth, not abrupt. The X icon at the right exits
 *  the mode (mirrors Cancel in the header). Clicking the banner itself
 *  is inert — it's a status surface. */
/** PipelinePulseObservations — always-on substance for the Pulse
 *  column. Computes interesting facts about the user's portfolio
 *  (stale watching deals, biggest market cluster, deals above the buy
 *  bar, range of cap rates, etc.) and renders the most relevant 2-4
 *  as small buddy-voice cards. The reason this exists: ActivityFeed
 *  returns null when there's no recent event, leaving the Pulse
 *  column visually empty. Observations are derived from the deal
 *  set itself, so there's always something to show.
 *
 *  Each observation is a small card with:
 *    - A subtle accent dot (sage / amber / muted)
 *    - One sentence in serif (the buddy's voice)
 *    - Optional small metadata line (count + context) */
function PipelinePulseObservations({ deals }: { deals: SavedDeal[] }) {
  type Observation = {
    id:    string
    tone:  "pos" | "warn" | "neutral"
    title: string
    note?: string
  }

  const observations = useMemo<Observation[]>(() => {
    const out: Observation[] = []
    if (deals.length === 0) {
      out.push({
        id: "empty",
        tone: "neutral",
        title: "Your pipeline is empty.",
        note: "Open Browse and save your first listing to start.",
      })
      return out
    }

    // Stale watching: deals in "watching" stage updated more than a week ago.
    const now = Date.now()
    const WEEK_MS = 7 * 86400_000
    const staleWatching = deals.filter((d) => {
      if (d.stage !== "watching") return false
      const updated = new Date(d.updated_at).getTime()
      return now - updated > WEEK_MS
    })
    if (staleWatching.length > 0) {
      out.push({
        id:    "stale-watching",
        tone:  "warn",
        title: staleWatching.length === 1
          ? "1 deal in Watching is over a week old."
          : `${staleWatching.length} deals in Watching are over a week old.`,
        note:  "Worth a second look — or move them along.",
      })
    }

    // Biggest cluster — most deals in a single city.
    const byCity = new Map<string, number>()
    for (const d of deals) {
      const city = (d.city ?? "").trim()
      if (!city) continue
      byCity.set(city, (byCity.get(city) ?? 0) + 1)
    }
    let topCity:  string | null = null
    let topCount: number = 0
    for (const [c, n] of byCity) {
      if (n > topCount) { topCity = c; topCount = n }
    }
    if (topCity && topCount >= 2) {
      out.push({
        id:    `cluster-${topCity}`,
        tone:  "pos",
        title: `Your tightest cluster: ${topCount} deals in ${topCity}.`,
        note:  "Concentrated portfolios know their market better.",
      })
    }

    // Cap rate range — useful framing when there's spread.
    const caps = deals
      .map((d) => d.snapshot?.metrics?.capRate)
      .filter((v): v is number => Number.isFinite(v))
    if (caps.length >= 3) {
      const lo = Math.min(...caps) * 100
      const hi = Math.max(...caps) * 100
      if (hi - lo >= 2) {
        out.push({
          id:    "cap-range",
          tone:  "neutral",
          title: `Cap rates across your pipeline range from ${lo.toFixed(1)}% to ${hi.toFixed(1)}%.`,
          note:  "Wide spread — different markets, different math.",
        })
      }
    }

    // Cash-flowing count — celebratory when many positive.
    const positive = deals.filter((d) => {
      const cf = d.snapshot?.metrics?.monthlyCashFlow
      return Number.isFinite(cf) && (cf as number) > 0
    })
    if (positive.length >= 1) {
      out.push({
        id:    "positive",
        tone:  "pos",
        title: positive.length === 1
          ? "1 deal in your pipeline cash flows positive."
          : `${positive.length} deals cash flow positive.`,
        note:  positive.length === deals.length
          ? "Everything in your watchlist is in the green."
          : undefined,
      })
    }

    // Recently saved — momentum signal.
    const SEVEN_DAYS_MS = 7 * 86400_000
    const recentSaves = deals.filter((d) => now - new Date(d.created_at).getTime() < SEVEN_DAYS_MS)
    if (recentSaves.length >= 2) {
      out.push({
        id:    "recent-saves",
        tone:  "pos",
        title: `You saved ${recentSaves.length} deals this week.`,
        note:  "Strong momentum.",
      })
    }

    // Trim to top 4 so the column stays scannable.
    return out.slice(0, 4)
  }, [deals])

  if (observations.length === 0) return null

  return (
    <div className="flex flex-col gap-2.5">
      {observations.map((obs) => (
        <div
          key={obs.id}
          className="flex items-start gap-3 rounded-[10px] border border-border bg-card px-4 py-3.5"
        >
          <span
            aria-hidden
            className="shrink-0 mt-[6px] rounded-full"
            style={{
              width:  6,
              height: 6,
              background:
                obs.tone === "pos"  ? "var(--rv-pos)"  :
                obs.tone === "warn" ? "var(--rv-warn)" :
                                      "var(--rv-t4)",
            }}
          />
          <div className="flex-1 min-w-0">
            <p
              className="leading-snug text-foreground"
              style={{
                fontFamily:    "var(--rv-font-display)",
                fontSize:      14,
                fontWeight:    400,
                letterSpacing: "-0.01em",
              }}
            >
              {obs.title}
            </p>
            {obs.note && (
              <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug">
                {obs.note}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** PipelinePulseHeader — small "Today" header for the Pipeline Pulse
 *  column. Shows the day name + a buddy-voice line (display serif) so
 *  the middle column reads as a curated surface, not a generic feed.
 *  Quiet by design — the activity rows below are the actual content. */
function PipelinePulseHeader() {
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" })
  const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[11px] font-medium tracking-tight text-muted-foreground/80 uppercase">
        <span>Today · {day}</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{date}</span>
      </div>
      <p
        className="leading-snug text-foreground"
        style={{
          fontFamily:    "var(--rv-font-display)",
          fontSize:      19,
          fontWeight:    500,
          letterSpacing: "-0.018em",
        }}
      >
        Here's what moved in your pipeline.
      </p>
    </div>
  )
}

/** PipelineStatCard — Mercury-style portfolio stat for the Pipeline
 *  Deals view header. Flat white card with hairline border, generous
 *  padding (Mercury runs ~24px), big serif number (32px), sentence-case
 *  label that breathes, optional inline sub. The number is the
 *  typographic event; everything else supports it. No gradients, no
 *  shadows — depth comes from the warm-cream/white surface contrast. */
function PipelineStatCard({
  label, value, valueSuffix, sub, tone = "neutral",
}: {
  label: string
  value: string
  valueSuffix?: string
  sub?: string
  tone?: "neg" | "neutral"
}) {
  return (
    <div className="flex flex-col rounded-[12px] border border-border bg-card px-6 py-5 min-w-0">
      <div className="text-[11px] font-medium text-muted-foreground tracking-tight truncate">
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5 min-w-0">
        <span
          className={cn(
            "tabular-nums leading-none truncate",
            tone === "neg" ? "text-rose-600" : "text-foreground"
          )}
          style={{
            fontFamily:    "var(--rv-font-display)",
            fontSize:      32,
            fontWeight:    500,
            letterSpacing: "-0.025em",
          }}
        >
          {value}
        </span>
        {valueSuffix && (
          <span
            className={cn(
              "tabular-nums",
              tone === "neg" ? "text-rose-500/80" : "text-muted-foreground"
            )}
            style={{ fontSize: 13, fontWeight: 500 }}
          >
            {valueSuffix}
          </span>
        )}
      </div>
      {sub && (
        <div className="mt-2 text-[12px] text-muted-foreground truncate">
          {sub}
        </div>
      )}
    </div>
  )
}

/** Compact currency formatter — $4.2M / $750K style. Used by the stat
 *  cards' Total Exposure value where we want the number to read at a
 *  glance instead of "$4,235,000". */
function fmtCurrencyCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (Math.abs(n) >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n).toLocaleString("en-US")}`
}

// CompareModeBanner removed — picking state lives in the floating
// CompareSelectionBar at the bottom now (no layout push).

// CompareSelectingPane removed — picking happens directly on the
// dense list (rows highlight as picked) with the floating
// CompareSelectionBar at the bottom as the status surface.

/** Drop target rendered above the deal list whenever a row is being
 *  dragged. Releasing on it adds the dragged row to the compare set. The
 *  drop zone slides in from the top (CSS transition on max-height) so it
 *  feels like a tray pulling open, not an abrupt overlay flash. Hover
 *  state (dragOver) tints the bar accent-green to confirm the drop will
 *  land. */
function CompareDropZone({
  visible, onDrop,
}: {
  visible: boolean
  onDrop:  (dealId: string) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); setOver(true) }}
      onDragOver={(e)  => { e.preventDefault(); e.dataTransfer.dropEffect = "copy" }}
      onDragLeave={()  => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData("rv/deal-id")
        setOver(false)
        if (id) onDrop(id)
      }}
      className="sticky top-0 z-20 flex items-center justify-center gap-2 select-none overflow-hidden"
      style={{
        // Sticky top positioning means the bar always rides at the top of
        // the visible scroll area — even mid-list drags can drop here.
        height:        visible ? 38 : 0,
        opacity:       visible ? 1 : 0,
        background:    over
          ? "rgba(48,164,108,0.18)"
          : "rgba(48,164,108,0.08)",
        borderBottom:  visible
          ? `0.5px solid ${over ? "rgba(48,164,108,0.45)" : "rgba(48,164,108,0.22)"}`
          : "0.5px solid transparent",
        color:         over ? "var(--rv-accent)" : "var(--rv-t2)",
        fontSize:      11.5,
        fontWeight:    500,
        letterSpacing: "-0.005em",
        transition:    "height 160ms cubic-bezier(0.32,0.72,0,1), opacity 160ms cubic-bezier(0.32,0.72,0,1), background-color 100ms ease, border-color 100ms ease, color 100ms ease",
      }}
      title="Release to add this listing to the compare set"
    >
      <GitCompareArrows size={11} strokeWidth={2} />
      Drop to add to Compare
    </div>
  )
}

function ListEmpty({
  stageTitle, hasAny, onClearStage,
}: {
  stageTitle: string
  hasAny:     boolean
  onClearStage: () => void
}) {
  return (
    // Empty state with the BuddyMark — the brand presence shows up in
    // the moments where there's "nothing here." Quiet, not desperate;
    // the buddy is just standing at the desk with no work to do yet.
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center gap-4">
      <div className="flex aspect-square size-12 items-center justify-center rounded-xl bg-primary/8 border border-primary/15">
        <BuddyMark size={22} tone="muted" />
      </div>
      <div className="flex flex-col gap-1.5 max-w-[280px]">
        <p
          className="text-foreground"
          style={{
            fontFamily: "var(--rv-font-display)",
            fontSize:   16,
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          {hasAny ? `Quiet in ${stageTitle.toLowerCase()}.` : "Nothing here yet."}
        </p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {hasAny
            ? "Other stages might have moves — try the view selector at the top."
            : "Find a listing on Zillow, Redfin, anywhere. Hit Save and I'll start watching."}
        </p>
      </div>
      {hasAny && (
        <button
          onClick={onClearStage}
          className="mt-2 text-[12px] font-medium underline-offset-4 text-primary hover:underline"
        >
          Show me everything active →
        </button>
      )}
    </div>
  )
}
