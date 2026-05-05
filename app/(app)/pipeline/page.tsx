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
import { useBuyBar } from "@/lib/useBuyBar"
import { geocode } from "@/lib/mapbox"
import Panel from "@/components/panel"
import { useEscape } from "@/lib/escapeStack"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import ActivityFeed from "@/components/ActivityFeed"
import { BuddyMark } from "@/components/BuddyMark"
import { PipelineVelocityChart } from "@/components/pipeline-velocity-chart"
import { PipelineDealTable } from "@/components/pipeline-deal-table"
import { PipelineKanban } from "@/components/pipeline-kanban"
import { PipelineBulkBar } from "@/components/pipeline-bulk-bar"
import { PipelineViewsMenu } from "@/components/pipeline-views-menu"

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
  deal, active, multiSelected, compareMode, onSelect, onContextMenuAdd, onDragStartRow, onDragEndRow,
}: {
  deal:           SavedDeal
  active:         boolean
  multiSelected:  boolean
  /** When true, the row reveals a checkbox on its left edge and clicks
   *  toggle selection rather than navigating. Drives the "selection
   *  mode" feel — clear visual signal you're in a different state. */
  compareMode:    boolean
  onSelect:       (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => void
  /** Right-click adds (or removes) the row from the compare set. Same
   *  effect as ⌘-clicking, but discoverable without the keyboard hint —
   *  matches the "right-click to do the secondary thing" mac convention. */
  onContextMenuAdd: () => void
  /** Drag-up to compare — fired on dragstart/dragend so the parent can
   *  reveal a drop target at the top of the list. */
  onDragStartRow: (id: string) => void
  onDragEndRow:   () => void
}) {
  const cashFlow = deal.snapshot?.metrics?.monthlyCashFlow ?? null
  const address  = [deal.address, deal.city, deal.state].filter(Boolean).join(", ")
  const headline: React.ReactNode = deal.list_price != null
    ? <Currency value={deal.list_price} whole />
    : (address || "Saved deal")
  const sub = deal.list_price != null && address ? address : (deal.site_name ?? null)

  // Selection visual: in compare mode, multi-selected rows get a confident
  // accent tint with an accent left bar — clearly different from an "active
  // detail focus" tint. Outside compare mode, the focal row gets the same
  // accent treatment. Reads as: "this row is one of the things I picked."
  const bg =
    multiSelected ? "var(--rv-accent-dim)" :
    active        ? "var(--rv-accent-dim)" :
                    "transparent"

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
      onContextMenu={(e) => { e.preventDefault(); onContextMenuAdd() }}
      className="relative flex items-start gap-3 text-left select-none w-full"
      style={{
        padding:       "12px 16px",
        background:    bg,
        transition:    "background 120ms cubic-bezier(0.4,0,0.2,1)",
        borderLeft:    `2px solid ${multiSelected || active ? "var(--rv-accent)" : "transparent"}`,
        borderBottom:  "0.5px solid var(--rv-border)",
      }}
      onMouseEnter={(e) => {
        if (!active && !multiSelected) e.currentTarget.style.background = "var(--rv-elev-2)"
      }}
      onMouseLeave={(e) => {
        if (!active && !multiSelected) e.currentTarget.style.background = "transparent"
      }}
    >
      {/* Selection checkbox — only rendered in compare mode. Animates in
          via width transition so the row content slides right to make
          room rather than jumping. Filled-accent check when selected,
          empty circle outline when not. Clear, scannable selection state
          that matches Apple Mail / Notion bulk-select conventions. */}
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

      {/* Source brand-mark — at-a-glance signal of where this deal came
          from (Z = Zillow, R = Redfin, RC = Realtor.com, etc.). Lives at
          the start of the row so the user can scan the strip and group
          deals by source without reading. */}
      <span className="mt-[3px] shrink-0">
        <SourceMark source="listing" siteName={deal.site_name} />
      </span>

      {/* Mercury-row layout: identity column (address + price + meta) on
          the left, cash-flow chip on the right. The address is the
          row's identity (what an investor remembers); price is the
          supporting figure; stage + property type are quiet meta. The
          cash-flow chip is the at-a-glance signal — sage tint if
          positive, brick tint if negative. Reads at scan-speed
          without becoming a CSV dump. */}
      <div className="flex items-start justify-between gap-3 min-w-0 flex-1">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          {/* Address — primary identity. Falls back to the price when
              we don't have an address (rare, but property listings
              with sparse extraction can lack one). */}
          <p className="text-[13px] font-medium leading-tight truncate text-foreground">
            {address || (deal.list_price != null ? <Currency value={deal.list_price} whole /> : "Saved deal")}
          </p>
          {/* Supporting line: price + property type. The price is muted
              because the address has already been read; the supporting
              line is for "what is this listing." */}
          <p className="text-[11.5px] leading-tight truncate text-muted-foreground tabular-nums">
            {deal.list_price != null && address && (
              <>
                <Currency value={deal.list_price} whole />
                {(deal.tags?.[0] || deal.snapshot?.propertyType) && <span className="text-muted-foreground/60"> · </span>}
              </>
            )}
            {deal.tags?.[0] ?? deal.snapshot?.propertyType ?? deal.site_name ?? null}
          </p>
          {/* Stage chip — colored dot matches the map pin so List ↔ Map
              maintains visual identity. Smaller and quieter than the
              cash flow chip on the right. */}
          <span className="inline-flex items-center gap-1.5 text-[10.5px] rounded-full px-2 py-[1px] text-muted-foreground bg-muted self-start mt-0.5">
            <span
              aria-hidden
              className="rounded-full shrink-0"
              style={{
                width:  5,
                height: 5,
                background: STAGE_COLOR[deal.stage],
              }}
            />
            {STAGE_LABEL[deal.stage]}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {/* Cash-flow chip — sage tint when positive, brick tint when
              negative. The at-a-glance answer: "is this deal making or
              losing me money?" Larger than other meta because it's the
              load-bearing signal in the row. */}
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
          {/* Time-in-stage — small + muted. Useful for "is this getting
              stale" reads without being prominent. */}
          <span
            className="text-[10px] tabular-nums text-muted-foreground/60"
            title={`In ${STAGE_LABEL[deal.stage]} since ${new Date(deal.updated_at).toLocaleDateString()}`}
          >
            {timeInStage(deal.updated_at)}
          </span>
        </div>
      </div>
    </button>
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
    <div ref={ref} className="relative inline-flex">
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
      className="flex flex-col h-full overflow-hidden"
      // Transparent + pe:none so the empty middle column lets drags
      // fall through to the persistent MapShell underneath. Each
      // opaque surface inside (header, list, splitter, detail rail,
      // compare panes) opts back in with pointer-events: auto.
      style={{ background: "transparent", pointerEvents: "none" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-6 py-4 shrink-0 bg-background"
        style={{
          borderBottom:  "0.5px solid var(--rv-border)",
          position:      "relative",
          zIndex:        3,
          pointerEvents: "auto",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <GitCompareArrows size={14} strokeWidth={1.7} className="text-primary" />
          <h2 className="text-[14px] font-semibold tracking-tight text-foreground">
            Side-by-side
          </h2>
          <span className="text-[12px] text-muted-foreground/60">
            {deals.length} deals
          </span>
        </div>
        <Button onClick={onClear} variant="ghost" size="xs">
          Done comparing
        </Button>
      </div>

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
            Your pipeline is empty
          </p>
          <p className="text-[12.5px] mt-2 leading-relaxed max-w-[300px] text-muted-foreground">
            Save a listing from Browse to start your pipeline. ⌘S on any listing while it's analyzed.
          </p>
        </>
      ) : filtered === 0 ? (
        <>
          <p className="text-[14px] font-medium text-foreground">
            Nothing in this stage
          </p>
          <p className="text-[12.5px] mt-2 leading-relaxed max-w-[300px] text-muted-foreground">
            Switch stages from the sidebar — or save more deals from Browse.
          </p>
        </>
      ) : (
        <>
          <p className="text-[14px] font-medium text-foreground">
            Pick a deal
          </p>
          <p className="text-[12.5px] mt-2 leading-relaxed max-w-[300px] text-muted-foreground">
            Click any row on the left to see the full snapshot.
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
  const [viewMode, setViewMode] = useState<"deals" | "table" | "kanban" | "map">(() => {
    if (typeof window === "undefined") return "deals"
    const saved = localStorage.getItem("rv-pipeline-view")
    if (saved === "map" || saved === "table" || saved === "kanban" || saved === "deals") return saved
    return "deals"
  })
  useEffect(() => {
    try { localStorage.setItem("rv-pipeline-view", viewMode) } catch { /* private mode */ }
  }, [viewMode])
  /** Expanded summary in the page header — by default we show just the
   *  deal count; clicking the chevron reveals the avg cash flow and
   *  total exposure inline. Keeps the header clean for routine browsing
   *  but lets the user drill in when they want the at-a-glance numbers. */
  const [summaryExpanded, setSummaryExpanded] = useState<boolean>(false)

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

  // Filtered list — selected stage from URL, defaulting to "active" (no Won/Passed)
  const filtered = useMemo<SavedDeal[]>(() => {
    if (!deals) return []
    if (stageFilter) return deals.filter((d) => d.stage === stageFilter)
    return deals.filter((d) => d.stage !== "won" && d.stage !== "passed")
  }, [deals, stageFilter])

  // Auto-select the first row when the list changes if nothing is selected
  // OR the previously selected deal is no longer in the filtered set.
  // If a `?id=` deep-link is present and matches a loaded deal, that wins
  // over the auto-first-row pick. Once consumed, we strip it from the URL
  // so a refresh doesn't re-trigger.
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
    if (!selId || !filtered.find((d) => d.id === selId)) {
      setSelId(filtered[0].id)
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
        setCheckResult(`No price changes across ${summary.checked} watched ${summary.checked === 1 ? "deal" : "deals"}.`)
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
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} className="flex items-center gap-3 min-w-0">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <PipelineViewsMenu
              currentStage={stageFilter}
              onApplyView={(stage) => {
                router.push("/pipeline" + (stage ? `?stage=${stage}` : ""))
              }}
            />
            {/* Click-to-expand summary. Default state: just the deal
                count + a small chevron. Expanded: also shows avg cash
                flow and total exposure inline. Keeps the header clean
                for routine browsing without hiding the numbers entirely
                from power users. */}
            <button
              onClick={() => setSummaryExpanded((v) => !v)}
              className="inline-flex items-baseline gap-1.5 text-[12px] tabular-nums truncate transition-colors"
              style={{ color: "var(--rv-t4)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t2)" }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t4)" }}
              title={summaryExpanded ? "Hide pipeline summary" : "Show pipeline summary"}
            >
              <span>{total === 1 ? "1 deal" : `${total} deals`}</span>
              {summaryExpanded && stats.avgCashFlow != null && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span>avg </span>
                  <span style={{ color: stats.avgCashFlow < 0 ? "var(--rv-neg)" : "var(--rv-t3)" }}>
                    <Currency value={Math.round(stats.avgCashFlow)} signed />/mo
                  </span>
                </>
              )}
              {summaryExpanded && stats.exposure != null && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span><Currency value={stats.exposure} compact /> exposure</span>
                </>
              )}
              <ChevronDown
                size={11}
                strokeWidth={2}
                style={{
                  marginLeft: 2,
                  transform: summaryExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 160ms cubic-bezier(0.32,0.72,0,1)",
                  alignSelf: "center",
                }}
              />
            </button>
          </div>
        </div>
        {/* Canvas toggle — Deals (default, dashboard view) vs. Map
            (geographic view). Lives early in the header so it reads
            as a primary mode-switch, not buried after the Compare
            button. Hidden when the comparison view is active (the
            map is irrelevant when comparing). */}
        {compareDeals.length < 2 && (
          <div
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            className="ml-2 inline-flex items-center rounded-full border border-border bg-muted p-0.5"
            role="tablist"
            aria-label="View mode"
          >
            <button
              role="tab"
              aria-selected={viewMode === "deals"}
              onClick={() => setViewMode("deals")}
              className={cn(
                "px-3 h-7 text-[12px] font-medium tracking-tight rounded-full transition-colors",
                viewMode === "deals"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Deals
            </button>
            <button
              role="tab"
              aria-selected={viewMode === "table"}
              onClick={() => setViewMode("table")}
              className={cn(
                "px-3 h-7 text-[12px] font-medium tracking-tight rounded-full transition-colors",
                viewMode === "table"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Table
            </button>
            <button
              role="tab"
              aria-selected={viewMode === "kanban"}
              onClick={() => setViewMode("kanban")}
              className={cn(
                "px-3 h-7 text-[12px] font-medium tracking-tight rounded-full transition-colors",
                viewMode === "kanban"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Kanban
            </button>
            <button
              role="tab"
              aria-selected={viewMode === "map"}
              onClick={() => setViewMode("map")}
              className={cn(
                "px-3 h-7 text-[12px] font-medium tracking-tight rounded-full transition-colors",
                viewMode === "map"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Map
            </button>
          </div>
        )}
        {/* Compare control — three visual states:
              - idle (not in mode, no selection): a confident accent-tinted
                button so the feature reads as a real call-to-action, not
                just another header chip
              - compare mode active: live selection counter + primary
                "Compare N" CTA (when ≥ 2 selected) + neutral Cancel
              - lingering selection from right-click / ⌘-click outside
                mode: "Comparing N" status + Clear */}
        {(compareMode || compareIds.size > 0 || total > 1) && (
          <div
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            className="ml-4 inline-flex items-center gap-2"
          >
            {compareMode ? (
              <>
                {/* 4 slot dots that fill in as the user picks deals. Reads
                    at a glance: how many you have vs the cap. */}
                <div className="flex items-center gap-1 mr-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      style={{
                        width:  6, height: 6, borderRadius: 99,
                        background: i < compareIds.size ? "var(--rv-accent)" : "var(--rv-elev-3)",
                        border:     i < compareIds.size ? "none" : "0.5px solid var(--rv-border)",
                        transition: "background-color 160ms ease",
                      }}
                    />
                  ))}
                </div>
                <span className="text-[11.5px] tracking-tight tabular-nums text-muted-foreground">
                  {compareIds.size === 0
                    ? "Select listings"
                    : compareIds.size === 1
                    ? "1 picked · need one more"
                    : `${compareIds.size} of 4 picked`}
                </span>
                <Button
                  onClick={() => { setCompareMode(false); setCompareIds(new Set()) }}
                  variant="ghost"
                  size="xs"
                >
                  Cancel
                </Button>
                {compareIds.size >= 2 && (
                  <Button
                    onClick={() => setCompareMode(false)}
                    variant="default"
                    size="sm"
                    title="View the side-by-side comparison"
                  >
                    Compare {compareIds.size}
                  </Button>
                )}
              </>
            ) : compareIds.size > 0 ? (
              <>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-medium tabular-nums text-primary bg-primary/10"
                  style={{
                    border: "0.5px solid rgba(48,164,108,0.22)",
                  }}
                >
                  <GitCompareArrows size={11} strokeWidth={2} />
                  {compareIds.size === 1 ? "1 selected" : `Comparing ${compareIds.size}`}
                </span>
                <Button
                  onClick={() => setCompareIds(new Set())}
                  variant="ghost"
                  size="xs"
                >
                  Clear
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCompareMode(true)}
                title="Pick 2-4 deals to see them side-by-side"
                icon={<GitCompareArrows size={11} strokeWidth={2} />}
              >
                Compare
              </Button>
            )}
          </div>
        )}
        <span className="flex-1" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
        {watchedCount > 0 && (
          <div
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            className="flex items-center gap-2"
          >
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
      // Cream surface guarantees the dark MapShell (which lives behind
      // every route) never bleeds through to the user. The Map view
      // explicitly sets transparent middle column when it wants the
      // map visible; the rest of Pipeline stays opaque.
      className="flex flex-col h-full overflow-hidden relative bg-background"
    >
      {/* Pipeline header content portals into the persistent
          AppTopBar's pipeline slot so the bar adapts without
          re-mounting. Page renders body only. */}
      {pipelineTopBarSlot && createPortal(pipelineHeaderContent, pipelineTopBarSlot)}

      {/* Compare-mode banner — slides in to make the mode change
          obvious. Stays out of the layout when not in mode
          (max-height 0). */}
      <div style={{ pointerEvents: "auto" }}>
        <CompareModeBanner active={compareMode} count={compareIds.size} />
      </div>

      {/* Stats strip — Mercury-style portfolio summary across the top
          of the Deals canvas. Four cards: Active / Exposure / Avg cash
          flow / Avg cap rate. Only renders in Deals mode (Map mode is
          for geographic exploration; numbers there would compete) and
          only when there are filtered deals to summarize. Computed from
          the same `stats` object the topbar header already uses, so the
          numbers are consistent with the inline summary expander. */}
      {viewMode === "deals" && filtered.length > 0 && (
        <div
          className="shrink-0 px-6 pt-5 pb-4 bg-background border-b border-border"
          style={{ pointerEvents: "auto" }}
        >
          {/* Stagger fade animation removed — it cost 380ms of perceived
              lag on every Pipeline mount before the user could see the
              stat cards. Always-mounted-routes flips visibility on
              every nav, which means this animation re-played on every
              Browse → Pipeline switch. Not worth the snappy nav. */}
          <div className="grid grid-cols-1 gap-4 max-w-[1280px] mx-auto *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs sm:grid-cols-2 xl:grid-cols-4">
            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Active deals</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {String(stats.active)}
                </CardTitle>
                {watchedCount > 0 && (
                  <CardAction>
                    <Badge variant="outline">{watchedCount} watching</Badge>
                  </CardAction>
                )}
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1.5 border-t-0 bg-transparent pt-0 text-sm">
                <div className="text-muted-foreground">In your pipeline right now</div>
              </CardFooter>
            </Card>
            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Total exposure</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {stats.exposure != null ? fmtCurrencyCompact(stats.exposure) : "—"}
                </CardTitle>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1.5 border-t-0 bg-transparent pt-0 text-sm">
                <div className="text-muted-foreground">Across saved deals</div>
              </CardFooter>
            </Card>
            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Avg cash flow</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {stats.avgCashFlow != null
                    ? `${stats.avgCashFlow >= 0 ? "+" : "−"}$${Math.abs(Math.round(stats.avgCashFlow)).toLocaleString("en-US")}`
                    : "—"}
                  {stats.avgCashFlow != null && (
                    <span className="ml-1 text-base font-normal text-muted-foreground">/mo</span>
                  )}
                </CardTitle>
                {stats.avgCashFlow != null && (
                  <CardAction>
                    <Badge variant="outline">
                      {stats.avgCashFlow >= 0 ? <TrendingUpIcon /> : <TrendingDownIcon />}
                      {stats.avgCashFlow >= 0 ? "Positive" : "Negative"}
                    </Badge>
                  </CardAction>
                )}
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1.5 border-t-0 bg-transparent pt-0 text-sm">
                <div className="text-muted-foreground">Per door, after expenses</div>
              </CardFooter>
            </Card>
            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Avg cap rate</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {stats.avgCap != null ? `${(stats.avgCap * 100).toFixed(2)}%` : "—"}
                </CardTitle>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1.5 border-t-0 bg-transparent pt-0 text-sm">
                <div className="text-muted-foreground">Weighted mean across pipeline</div>
              </CardFooter>
            </Card>
          </div>

          {/* Pipeline velocity — area chart of deals added per day on top
              of the running total. Shows up only when there's at least
              one saved deal (otherwise it's an empty rectangle). */}
          {filtered.length > 0 && (
            <div className="max-w-[1280px] mx-auto mt-4">
              <PipelineVelocityChart deals={deals ?? []} />
            </div>
          )}
        </div>
      )}

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
          // Loading / not-signed-in state. The route renders before
          // auth resolves; without this the body was empty (showing the
          // dark MapShell behind it). Cream surface + breathing buddy
          // mark keeps the user from seeing a black void.
          <div className="flex items-center justify-center w-full bg-background" style={{ pointerEvents: "auto" }}>
            <div className="flex flex-col items-center gap-4 max-w-[320px] text-center">
              <div className="flex aspect-square size-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                <BuddyMark size={22} state="thinking" />
              </div>
              <p
                className="text-foreground"
                style={{ fontFamily: "var(--rv-font-display)", fontSize: 16, fontWeight: 500, letterSpacing: "-0.012em" }}
              >
                Loading your pipeline…
              </p>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                If you're not signed in yet, head to Browse and sign in to sync your saved deals.
              </p>
            </div>
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

        {!error && deals !== null && viewMode !== "table" && viewMode !== "kanban" && (
          <>
            {/* LEFT — always-visible deal list. Resizable via splitter. */}
            <div
              className="shrink-0 flex flex-col h-full overflow-hidden"
              style={{
                width:        listW,
                background:   "var(--rv-bg)",
                // Right-edge hairline only — was a 30px-blur drop
                // shadow whose vertical blur extended above the
                // list's top edge, painting a faint dark band right
                // below the AppTopBar that read as a hairline gap.
                // Pure 1px hairline gives the same boundary
                // separation against the map without bleeding
                // upward.
                boxShadow:    "1px 0 0 rgba(255,255,255,0.06)",
                pointerEvents: "auto",
              }}
            >
              <div className="flex-1 overflow-y-auto panel-scroll relative">
                <CompareDropZone
                  visible={draggingDealId !== null}
                  onDrop={(id) => onCompareDrop(id)}
                />
                {filtered.length === 0 ? (
                  <ListEmpty stageTitle={stageTitle} hasAny={(deals?.length ?? 0) > 0} onClearStage={() => router.push("/pipeline")} />
                ) : (
                  filtered.map((deal) => (
                    <DealListRow
                      key={deal.id}
                      deal={deal}
                      active={compareIds.size < 2 && selId === deal.id}
                      multiSelected={compareIds.has(deal.id)}
                      compareMode={compareMode}
                      onSelect={(mods) => onRowClick(deal.id, mods)}
                      onContextMenuAdd={() => onRowToggleCompare(deal.id)}
                      onDragStartRow={onRowDragStart}
                      onDragEndRow={onRowDragEnd}
                    />
                  ))
                )}
              </div>
            </div>
            {/* Splitter — drag to resize the list pane */}
            <div
              onPointerDown={onSplitDown}
              onPointerMove={onSplitMove}
              onPointerUp={onSplitUp}
              onPointerCancel={onSplitUp}
              className={cn(
                "rv-splitter shrink-0 cursor-col-resize select-none",
                // In Deals mode the splitter inherits the same opaque
                // bg as the surrounding columns so the map doesn't peek
                // through the 4px resize gap. In Map mode it stays
                // transparent so drags can fall through to the map
                // (the splitter still resizes the list overlay).
                viewMode === "deals" && "bg-background"
              )}
              style={{ width: 4, pointerEvents: "auto" }}
              title="Drag to resize"
            />

            {/* MIDDLE — map + (in compare mode) selecting/comparison pane.
                The detail rail is hoisted OUT to be a top-level sibling so
                it spans the full pipeline body height — same architecture
                as the Browse panel. The map keeps the leftover space.
                pointer-events:none lets drags fall through to the map
                shell underneath; the compare panes (when present) re-
                enable pointer-events on themselves. */}
            <div
              className={`flex flex-1 min-w-0 h-full ${compareDeals.length >= 2 ? "flex-col" : "flex-row"}`}
              style={{ pointerEvents: "none" }}
            >
              <div
                className={cn(
                  compareDeals.length >= 2 ? "shrink-0 w-full" : "flex-1 min-w-0 h-full",
                  // Deals view: opaque cream surface — hides the map.
                  // Map view: transparent — the persistent MapShell
                  // shows through.
                  viewMode === "deals" && "bg-background"
                )}
                style={{
                  ...(compareDeals.length >= 2 ? { height: "45%" } : null),
                  pointerEvents: viewMode === "map" ? "none" : "auto",
                }}
              >
                {/* Deals view: Pipeline Pulse feed. The middle column
                    used to be the ambient map; now in Deals mode it's
                    the buddy's surface — recent activity across the
                    pipeline (saves, stage moves, watch alerts) so the
                    user has a "what changed" read every time they open
                    Pipeline. Generous spacing, max-width so the column
                    doesn't sprawl on wide windows.

                    Map view: transparent (renders nothing here, the
                    map shows through). */}
                {viewMode === "deals" && compareDeals.length < 2 && !compareMode && (
                  // Middle column when no deal is selected and not in
                  // compare mode. The old PipelinePulseHeader +
                  // PipelinePulseObservations have been retired —
                  // the SectionCards header + velocity chart at the top
                  // of the page now carry the same "what's happening"
                  // signal, so showing them here too was duplicate
                  // chrome that pushed the actual deal list off-screen.
                  // Activity feed stays — it's the only buddy-style
                  // surface that shows per-deal events (stage moves,
                  // watch alerts) which the header cards can't.
                  <div className="h-full overflow-y-auto panel-scroll">
                    <div className="max-w-[480px] mx-auto px-8 py-10">
                      <ActivityFeed limit={8} />
                    </div>
                  </div>
                )}
              </div>

              {compareDeals.length >= 2 ? (
                <div
                  className="flex-1 min-h-0 w-full"
                  style={{ borderTop: "0.5px solid var(--rv-border)", pointerEvents: "auto" }}
                >
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
              ) : compareMode ? (
                <div
                  className="shrink-0 h-full bg-background"
                  style={{
                    width:        320,
                    boxShadow:    "-1px 0 0 rgba(255,255,255,0.06)",
                    pointerEvents: "auto",
                  }}
                >
                  <CompareSelectingPane
                    picked={(deals ?? []).filter((d) => compareIds.has(d.id))}
                    onRemove={(id) => setCompareIds((prev) => {
                      const next = new Set(prev); next.delete(id); return next
                    })}
                  />
                </div>
              ) : null}
            </div>

            {/* RIGHT — full-height detail rail. Sibling of the list and
                map area, NOT nested inside the map column, so it spans the
                entire pipeline body height the same way the Browse panel
                does. Hidden during compare mode (the comparison view is
                the focus then). */}
            {!compareMode && compareDeals.length < 2 && (
              <div
                className="shrink-0 h-full bg-background"
                style={{
                  width:        selected ? 460 : 0,
                  overflow:     "hidden",
                  boxShadow:    "-1px 0 0 rgba(255,255,255,0.06)",
                  transition:   "width 240ms cubic-bezier(0.32, 0.72, 0, 1)",
                  pointerEvents: "auto",
                }}
              >
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

      {/* Bulk action bar — floats at bottom-center whenever 1+ deals
          are checked (table multi-select, compare-mode click-toggle,
          or right-click "add to compare"). Surfaces actions that
          previously lived only in per-row context menus: Compare (2-4),
          Move stage, Delete. Position: fixed → renders above any view
          mode without participating in layout. */}
      {compareIds.size > 0 && (
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

function CompareModeBanner({ active, count }: { active: boolean; count: number }) {
  const message = count === 0
    ? "Pick 2 to 4 deals from the list — click rows, right-click, or drag up."
    : count === 1
    ? "1 picked. Add at least one more to start comparing."
    : count >= 4
    ? "4 of 4 picked. Tap Compare in the header to view side-by-side."
    : `${count} of 4 picked. Tap Compare in the header when you're ready.`
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        maxHeight:    active ? 38 : 0,
        opacity:      active ? 1 : 0,
        overflow:     "hidden",
        background:   "rgba(48,164,108,0.10)",
        // Border collapses to 0 when inactive — was 0.5px solid
        // transparent which still claimed 0.5px of layout space
        // (transparent borders DO take up box-model space). That
        // 0.5px sliver was the "hairline gap" between the AppTopBar
        // and the list/rail in Pipeline. Now: no border = no space.
        borderBottom: active ? "0.5px solid rgba(48,164,108,0.22)" : "none",
        transition:   "max-height 220ms cubic-bezier(0.32,0.72,0,1), opacity 200ms cubic-bezier(0.32,0.72,0,1)",
      }}
    >
      <div className="flex items-center gap-2 px-4 h-[38px]">
        <span
          className="dot-pulse shrink-0"
          style={{
            width: 6, height: 6, borderRadius: 99,
            background: "var(--rv-accent)",
          }}
        />
        <span className="text-[12px] tracking-tight text-muted-foreground">
          {message}
        </span>
      </div>
    </div>
  )
}

/** Detail pane content while compareMode is active and the user hasn't
 *  picked enough deals yet. Replaces the stale single-deal detail with a
 *  visual representation of what's about to be compared — picked-deal
 *  cards plus empty placeholder slots — so the right side of the screen
 *  becomes part of the selection task instead of displaying unrelated
 *  context. */
function CompareSelectingPane({
  picked, onRemove,
}: {
  picked:   SavedDeal[]
  onRemove: (id: string) => void
}) {
  return (
    <div className="h-full overflow-y-auto panel-scroll flex flex-col items-center justify-center gap-6 px-8 bg-background">
      <div className="flex flex-col items-center gap-3 text-center max-w-[420px]">
        <div
          className="flex items-center justify-center rounded-full text-primary bg-primary/10"
          style={{
            width: 44, height: 44,
            border: "0.5px solid rgba(48,164,108,0.26)",
          }}
        >
          <GitCompareArrows size={20} strokeWidth={1.8} />
        </div>
        <p className="text-[15px] font-semibold tracking-tight text-foreground">
          {picked.length === 0
            ? "Pick deals to compare"
            : "Add at least one more"}
        </p>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {picked.length === 0
            ? "Click any row in the list, right-click to add it, or drag a row up. You can compare up to 4 deals at a time."
            : "Compare needs 2 or more deals to show side-by-side."}
        </p>
      </div>
      {/* Slot strip — 4 placeholder cards that fill in as the user picks */}
      <div className="flex items-stretch gap-2.5 w-full max-w-[560px]">
        {[0, 1, 2, 3].map((i) => {
          const deal = picked[i]
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-[10px] transition-opacity duration-150"
              style={{
                minHeight:  88,
                padding:    "10px 8px",
                background: deal ? "var(--rv-elev-2)" : "transparent",
                border:     deal
                  ? "0.5px solid rgba(48,164,108,0.30)"
                  : "1px dashed var(--rv-border-mid, var(--rv-border))",
              }}
            >
              {deal ? (
                <>
                  <p className="text-[12px] font-semibold tabular-nums truncate w-full text-center text-foreground">
                    {deal.list_price != null
                      ? <Currency value={deal.list_price} whole />
                      : "—"}
                  </p>
                  <p
                    className="text-[10.5px] truncate w-full text-center leading-tight text-muted-foreground"
                    title={[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}
                  >
                    {deal.address ?? deal.site_name ?? "Saved deal"}
                  </p>
                  <button
                    onClick={() => onRemove(deal.id)}
                    className="text-[10px] tracking-tight transition-colors mt-1"
                    style={{ color: "var(--rv-t4)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-neg)" }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t4)" }}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="text-[11px] text-muted-foreground/60">
                  Slot {i + 1}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

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
          {hasAny ? `Nothing in ${stageTitle}` : "Your pipeline is empty"}
        </p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {hasAny
            ? "Switch stages from the header — or save more deals from Browse."
            : "Open Browse, find a listing on Zillow / Redfin / anywhere, hit Save."}
        </p>
      </div>
      {hasAny && (
        <button
          onClick={onClearStage}
          className="mt-2 text-[12px] font-medium underline-offset-4 text-primary hover:underline"
        >
          See all active →
        </button>
      )}
    </div>
  )
}
