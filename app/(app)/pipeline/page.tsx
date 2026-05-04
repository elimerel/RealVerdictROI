"use client"

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
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
} from "lucide-react"
import { useSidebar, SNAP_ICONS } from "@/components/sidebar/context"
import { SourceMark } from "@/components/source/SourceMark"
import { Currency } from "@/lib/format"
import {
  DEAL_STAGES,
  STAGE_LABEL,
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
import PipelineMap from "@/components/PipelineMap"
import { Map as MapIcon, List as ListIcon } from "lucide-react"

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
    multiSelected
      ? "linear-gradient(90deg, rgba(48,164,108,0.20) 0%, rgba(48,164,108,0.08) 60%, rgba(48,164,108,0.02) 100%)"
    : active
      ? "linear-gradient(90deg, rgba(48,164,108,0.14) 0%, rgba(48,164,108,0.05) 60%, rgba(48,164,108,0.01) 100%)"
    : "transparent"

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
        if (!active && !multiSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"
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
        className="shrink-0 self-center flex items-center justify-center rounded-full transition-all duration-150"
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

      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <p
              className="text-[13px] font-semibold leading-tight tabular-nums truncate"
              style={{ color: "var(--rv-t1)" }}
            >
              {headline}
            </p>
            {sub && (
              <p className="text-[11px] mt-0.5 leading-tight truncate" style={{ color: "var(--rv-t3)" }}>
                {sub}
              </p>
            )}
          </div>
          <span
            className="text-[10px] tabular-nums shrink-0"
            style={{ color: "var(--rv-t4)" }}
            title={`In ${STAGE_LABEL[deal.stage]} since ${new Date(deal.updated_at).toLocaleDateString()}`}
          >
            {timeInStage(deal.updated_at)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10.5px]" style={{ color: "var(--rv-t4)" }}>
          <span
            className="inline-flex items-center text-[10px] rounded px-[5px] py-[1px]"
            style={{
              color: "var(--rv-t3)",
              background: "var(--rv-elev-2)",
              border: "0.5px solid var(--rv-border)",
            }}
          >
            {STAGE_LABEL[deal.stage]}
          </span>
          <span
            className="tabular-nums font-semibold"
            style={{ color: cashFlowTone(cashFlow), fontSize: "11.5px" }}
          >
            {cashFlow == null
              ? "—"
              : <><Currency value={cashFlow} signed /><span style={{ color: "var(--rv-t4)", fontWeight: 400 }}>/mo</span></>}
          </span>
          {deal.tags?.[0] && (
            <span className="truncate">{deal.tags[0]}</span>
          )}
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
        className="inline-flex items-center gap-1.5 rounded-[7px] text-[12px] font-medium tracking-tight transition-colors"
        style={{
          padding:    "5px 9px 5px 11px",
          color:      "var(--rv-accent)",
          background: "rgba(48,164,108,0.10)",
          border:     "0.5px solid rgba(48,164,108,0.22)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(48,164,108,0.16)" }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(48,164,108,0.10)" }}
      >
        {STAGE_LABEL[stage]}
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && (
        <div
          className="absolute z-30 left-0 top-full mt-1 flex flex-col rv-menu-pop"
          style={{
            background: "var(--rv-popover-bg)",
            backdropFilter: "blur(30px) saturate(160%)",
            WebkitBackdropFilter: "blur(30px) saturate(160%)",
            border: "0.5px solid var(--rv-border-mid)",
            borderRadius: 8,
            boxShadow: "var(--rv-shadow-outer-md)",
            minWidth: 140,
            padding: 4,
          }}
        >
          {DEAL_STAGES.map((s) => (
            <button
              key={s}
              onClick={() => { onChange(s); setOpen(false) }}
              className="text-left rounded-[6px] text-[12px] transition-colors"
              style={{
                padding:    "6px 9px",
                color:      s === stage ? "var(--rv-accent)" : "var(--rv-t2)",
                background: "transparent",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-3)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
            >
              {STAGE_LABEL[s]}
              {s === stage && (
                <span
                  className="ml-2 inline-block w-1.5 h-1.5 rounded-full align-middle"
                  style={{ background: "var(--rv-accent)" }}
                />
              )}
            </button>
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

  return (
    <div className="flex flex-col h-full overflow-hidden relative" style={{ background: "var(--rv-bg)" }}>
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
              className="tracking-[-0.022em] leading-none tabular-nums"
              style={{
                color:      "var(--rv-t1)",
                fontSize:   32,
                fontFamily: "var(--rv-font-display)",
                fontWeight: 500,
              }}
            >
              <Currency value={deal.list_price} whole />
            </p>
          )}
          {address && (
            <p className="text-[12.5px] mt-1.5 leading-snug" style={{ color: "var(--rv-t3)" }}>
              {address}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2 text-[11px]" style={{ color: "var(--rv-t4)" }}>
            {deal.beds      != null && <span>{deal.beds} bd</span>}
            {deal.baths     != null && <span>{deal.baths} ba</span>}
            {deal.sqft      != null && <span>{deal.sqft.toLocaleString()} sqft</span>}
            {deal.year_built != null && <span>Built {deal.year_built}</span>}
            {deal.site_name && <span>· {deal.site_name}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={async () => {
              const next = !deal.watching
              const ok = await setDealWatching(deal.id, next)
              if (ok) onChange({ ...deal, watching: next })
            }}
            title={deal.watching ? "Stop watching this deal" : "Watch — get notified on price changes"}
            className="inline-flex items-center gap-1.5 rounded-[7px] text-[12px] font-medium tracking-tight transition-colors"
            style={{
              padding:    "5px 9px",
              color:      deal.watching ? "var(--rv-accent)" : "var(--rv-t3)",
              background: deal.watching ? "rgba(48,164,108,0.10)" : "var(--rv-elev-2)",
              border:     `0.5px solid ${deal.watching ? "rgba(48,164,108,0.22)" : "var(--rv-border)"}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = deal.watching ? "rgba(48,164,108,0.18)" : "var(--rv-elev-4)"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = deal.watching ? "rgba(48,164,108,0.10)" : "var(--rv-elev-2)"
            }}
          >
            {deal.watching ? <Bell size={11} strokeWidth={2} /> : <BellOff size={11} strokeWidth={2} />}
            {deal.watching ? "Watching" : "Watch"}
          </button>
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
                className="inline-flex items-center text-[11px] tracking-tight rounded-full px-2 py-[2px]"
                style={{
                  color:      "var(--rv-t2)",
                  background: "var(--rv-elev-2)",
                  border:     "0.5px solid var(--rv-border)",
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
            <p className="text-[10px] uppercase tracking-widest font-medium mb-2" style={{ color: "var(--rv-t4)" }}>
              Notes
            </p>
            <p className="text-[13px] leading-[1.55]" style={{ color: "var(--rv-t1)" }}>
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
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowDefault((v) => !v)}
                  className="text-[11px] tracking-tight transition-colors"
                  style={{ color: "var(--rv-t3)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t3)" }}
                  title={usingScenario ? "Show the original analysis" : "Show your scenario"}
                >
                  {usingScenario ? "Show default" : "Show scenario"}
                </button>
                <button
                  onClick={() => setOverrides({})}
                  className="text-[11px] tracking-tight transition-colors"
                  style={{ color: "var(--rv-t3)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t3)" }}
                  title="Clear all overrides and return to the default analysis"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <DetailMetric
              label="Cash Flow"
              value={<><Currency value={metrics.monthlyCashFlow} signed /><span style={{ color: "var(--rv-t4)", fontSize: "0.7em", marginLeft: 2 }}>/mo</span></>}
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
              <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--rv-t4)" }}>
                {label}
              </p>
              <p className="text-[13px] tabular-nums" style={{ color: "var(--rv-t2)" }}>{value}</p>
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
            <p className="text-[10px] uppercase tracking-widest font-medium mb-2.5" style={{ color: "var(--rv-t4)" }}>
              Worth knowing
            </p>
            <div className="flex flex-col gap-2.5">
              {riskFlags.map((flag, i) => (
                <div key={i} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>
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
          <p className="text-[10px] uppercase tracking-widest font-medium mb-2" style={{ color: "var(--rv-t4)" }}>
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

        {/* Notes */}
        <div className="px-6 py-4" style={{ borderBottom: "0.5px solid var(--rv-border)" }}>
          <p className="text-[10px] uppercase tracking-widest font-medium mb-2" style={{ color: "var(--rv-t4)" }}>
            Your notes
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Anything you want to remember about this one…"
            className="w-full bg-transparent border-none outline-none text-[13px] leading-relaxed resize-none"
            style={{
              color:        "var(--rv-t1)",
              minHeight:    72,
              padding:      "8px 10px",
              borderRadius: 8,
              background:   "var(--rv-elev-1)",
              border:       "0.5px solid var(--rv-border)",
            }}
          />
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-6 py-4">
          <button
            onClick={onOpenInBrowse}
            className="inline-flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-[12px] font-medium tracking-tight transition-colors"
            style={{
              color:      "var(--rv-t1)",
              background: "var(--rv-elev-3)",
              border:     "0.5px solid var(--rv-border)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-4)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--rv-elev-3)" }}
          >
            <ExternalLink size={11} strokeWidth={2} />
            Open listing
          </button>
          <button
            onClick={onOpenInBrowse}
            className="inline-flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-[12px] font-medium tracking-tight transition-colors"
            style={{
              color:      "var(--rv-t2)",
              background: "var(--rv-elev-2)",
              border:     "0.5px solid var(--rv-border)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-4)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--rv-elev-2)" }}
            title="Open in browser, then re-analyze from the panel"
          >
            <RefreshCw size={11} strokeWidth={2} />
            Re-analyze
          </button>
          <span className="flex-1" />
          {confirmDelete ? (
            <>
              <span className="text-[11.5px]" style={{ color: "var(--rv-t3)" }}>
                Delete this deal?
              </span>
              <button
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-[12px] font-medium tracking-tight transition-colors"
                style={{
                  color:      "var(--rv-bad)",
                  background: "rgba(255,87,87,0.10)",
                  border:     "0.5px solid rgba(255,87,87,0.25)",
                }}
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="inline-flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-[12px] tracking-tight transition-colors"
                style={{ color: "var(--rv-t3)" }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-[12px] font-medium tracking-tight transition-colors"
              style={{ color: "var(--rv-t3)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-bad)" }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t3)" }}
            >
              <Trash2 size={11} strokeWidth={2} />
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailMetric({
  label, value, sub, color, delta,
}: {
  label: string
  /** Accepts either string or rich JSX (e.g. <Currency> for the cash-flow
   *  value with Mercury-style superscript decimals). */
  value: React.ReactNode
  sub?: string
  color: string
  /** Small "+$650/mo vs default" line beneath the value when the user is
   *  viewing their scenario. Color follows tone (positive = green). */
  delta?: { text: string; tone: "pos" | "neg" | "neutral" } | null
}) {
  const deltaColor =
    delta?.tone === "pos" ? "var(--rv-pos)" :
    delta?.tone === "neg" ? "var(--rv-neg)" :
                            "var(--rv-t4)"
  return (
    <div
      className="flex flex-col gap-1 rounded-[10px] min-w-0 overflow-hidden"
      style={{
        padding:   "10px 14px 11px",
        background: "var(--rv-elev-2)",
        border:     "0.5px solid var(--rv-border-mid)",
        boxShadow:  "var(--rv-shadow-inset), var(--rv-shadow-outer-sm)",
      }}
    >
      <p className="text-[9.5px] uppercase tracking-widest font-medium truncate" style={{ color: "var(--rv-t4)" }}>
        {label}
      </p>
      <p
        className="font-bold tabular-nums leading-none truncate"
        style={{ color, fontSize: 22, letterSpacing: "-0.02em", marginTop: 2 }}
      >
        {value}
      </p>
      {delta && (
        <p
          className="text-[10px] leading-none tabular-nums truncate"
          style={{ color: deltaColor, marginTop: 1 }}
          title="vs default analysis"
        >
          {delta.text}
        </p>
      )}
      {sub && (
        <p className="text-[10.5px] leading-none truncate" style={{ color: "var(--rv-t3)", marginTop: 1 }}>{sub}</p>
      )}
    </div>
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
      <span className="text-[12px]" style={{ color: "var(--rv-t3)" }}>{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12.5px] tabular-nums truncate" style={{ color: "var(--rv-t2)" }}>{value}</span>
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
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--rv-bg)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-6 py-4 shrink-0"
        style={{
          borderBottom: "0.5px solid var(--rv-border)",
          background:   "var(--rv-elev-1)",
          boxShadow:    "inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <GitCompareArrows size={14} strokeWidth={1.7} style={{ color: "var(--rv-accent)" }} />
          <h2 className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--rv-t1)" }}>
            Side-by-side
          </h2>
          <span className="text-[12px]" style={{ color: "var(--rv-t4)" }}>
            {deals.length} deals
          </span>
        </div>
        <button
          onClick={onClear}
          className="inline-flex items-center gap-1 text-[12px]"
          style={{ color: "var(--rv-t3)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)" }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t3)" }}
        >
          Done comparing
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto panel-scroll">
        {/* AI factual diff — quiet card above the table when available */}
        {(summary || summaryLoading) && (
          <div className="px-6 pt-5">
            <div
              className="flex items-start gap-2.5 rounded-[10px] px-4 py-3"
              style={{
                background: "rgba(48,164,108,0.06)",
                border:     "0.5px solid rgba(48,164,108,0.18)",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 mt-[7px]"
                style={{ background: summary ? "var(--rv-accent)" : "rgba(48,164,108,0.5)" }}
              />
              <p
                className="text-[12.5px] leading-relaxed"
                style={{ color: summary ? "var(--rv-t1)" : "var(--rv-t3)" }}
              >
                {summary ?? "Reading the differences…"}
              </p>
            </div>
          </div>
        )}
        <div className="px-6 py-5">
          <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <th
                  className="text-left text-[10px] uppercase tracking-widest font-medium pb-3"
                  style={{ color: "var(--rv-t4)" }}
                >
                  {/* Empty corner cell */}
                </th>
                {deals.map((d) => (
                  <th
                    key={d.id}
                    className="text-left pb-3 px-3 align-bottom min-w-[140px]"
                  >
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12.5px] font-semibold leading-tight tabular-nums truncate" style={{ color: "var(--rv-t1)" }}>
                          {d.list_price ? fmtCurrency(d.list_price) : "—"}
                        </p>
                        <button
                          onClick={() => onRemove(d.id)}
                          aria-label="Remove from comparison"
                          className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded transition-colors"
                          style={{ color: "var(--rv-t4)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)"; e.currentTarget.style.background = "var(--rv-elev-3)" }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t4)"; e.currentTarget.style.background = "transparent" }}
                        >
                          <X size={11} strokeWidth={1.8} />
                        </button>
                      </div>
                      {(d.address || d.city) && (
                        <p
                          className="text-[10.5px] leading-tight truncate"
                          style={{ color: "var(--rv-t3)" }}
                          title={[d.address, d.city, d.state].filter(Boolean).join(", ")}
                        >
                          {[d.address, d.city, d.state].filter(Boolean).join(", ")}
                        </p>
                      )}
                      <button
                        onClick={() => onOpenInBrowse(d.source_url)}
                        className="inline-flex items-center gap-1 text-[10.5px] mt-0.5 self-start"
                        style={{ color: "var(--rv-accent)" }}
                      >
                        <ExternalLink size={9} strokeWidth={2} />
                        Open
                      </button>
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
        className="text-[11px] uppercase tracking-widest font-medium pr-4 py-2.5 align-top"
        style={{ color: "var(--rv-t4)", whiteSpace: "nowrap", borderTop: "0.5px solid var(--rv-border)" }}
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
      if (v == null) return <span style={{ color: "var(--rv-t4)" }}>—</span>
      const tone = (row as { tone?: string }).tone
      if (tone === "good-positive") {
        return <span>{`${v >= 0 ? "+" : ""}${fmtCurrency(v)}${row.label.includes("/") ? "" : ""}`}</span>
      }
      return <span>{fmtCurrency(v)}</span>
    }
    case "pct": {
      const v = row.values[idx]
      return v == null ? <span style={{ color: "var(--rv-t4)" }}>—</span> : <span>{fmtPct(v)}</span>
    }
    case "num": {
      const v = row.values[idx]
      return v == null
        ? <span style={{ color: "var(--rv-t4)" }}>—</span>
        : <span>{v.toFixed(row.dec ?? 2)}</span>
    }
    case "text": {
      const v = row.values[idx]
      return v
        ? <span className="block truncate" title={v} style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
        : <span style={{ color: "var(--rv-t4)" }}>—</span>
    }
    case "tags": {
      const tags = row.values[idx]
      if (!tags || tags.length === 0) return <span style={{ color: "var(--rv-t4)" }}>—</span>
      return (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="inline-flex items-center text-[10px] tracking-tight rounded-full px-1.5 py-[1px]"
              style={{
                color:      "var(--rv-t2)",
                background: "var(--rv-elev-2)",
                border:     "0.5px solid var(--rv-border)",
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
          <p className="text-[14px] font-medium" style={{ color: "var(--rv-t1)" }}>
            Your pipeline is empty
          </p>
          <p className="text-[12.5px] mt-2 leading-relaxed max-w-[300px]" style={{ color: "var(--rv-t3)" }}>
            Save a listing from Browse to start your pipeline. ⌘S on any listing while it's analyzed.
          </p>
        </>
      ) : filtered === 0 ? (
        <>
          <p className="text-[14px] font-medium" style={{ color: "var(--rv-t1)" }}>
            Nothing in this stage
          </p>
          <p className="text-[12.5px] mt-2 leading-relaxed max-w-[300px]" style={{ color: "var(--rv-t3)" }}>
            Switch stages from the sidebar — or save more deals from Browse.
          </p>
        </>
      ) : (
        <>
          <p className="text-[14px] font-medium" style={{ color: "var(--rv-t1)" }}>
            Pick a deal
          </p>
          <p className="text-[12.5px] mt-2 leading-relaxed max-w-[300px]" style={{ color: "var(--rv-t3)" }}>
            Click any row on the left to see the full snapshot.
          </p>
        </>
      )}
    </div>
  )
}

// ── View toggle — segmented Map | List pill ─────────────────────────────
//
// Modeled after Apple's segmented control + Linear's view toggles.
// Compact, unmistakably a mode switch (not a button), accent-tinted on
// the active half. Lives at the start of the page header so it reads as
// the primary navigation move within the Pipeline page.

function ViewToggle({
  mode, onChange,
}: {
  mode:     "list" | "map"
  onChange: (m: "list" | "map") => void
}) {
  const Btn = ({ value, icon, label }: { value: "list" | "map"; icon: React.ReactNode; label: string }) => {
    const active = mode === value
    return (
      <button
        onClick={() => onChange(value)}
        title={`${label} view`}
        aria-label={`${label} view`}
        className="inline-flex items-center justify-center transition-colors"
        style={{
          width:        28,
          height:       24,
          color:        active ? "var(--rv-accent)" : "var(--rv-t3)",
          background:   active ? "var(--rv-bg)" : "transparent",
          borderRadius: 5,
          boxShadow:    active ? "0 1px 2px rgba(0,0,0,0.18), 0 0 0 0.5px var(--rv-border)" : "none",
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--rv-t1)" }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--rv-t3)" }}
      >
        {icon}
      </button>
    )
  }
  return (
    <div
      className="inline-flex items-center shrink-0"
      style={{
        padding:      2,
        background:   "var(--rv-elev-2)",
        border:       "0.5px solid var(--rv-border)",
        borderRadius: 7,
        gap:          2,
      }}
    >
      <Btn value="map"  icon={<MapIcon  size={13} strokeWidth={1.8} />} label="Map" />
      <Btn value="list" icon={<ListIcon size={13} strokeWidth={1.8} />} label="List" />
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

const STAGES_VALID = new Set<DealStage>(DEAL_STAGES)
const LIST_W_DEFAULT = 360
const LIST_W_MIN     = 280
const LIST_W_MAX     = 520

export default function PipelinePage() {
  return <Suspense><PipelinePageInner /></Suspense>
}

function PipelinePageInner() {
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const stageParam    = searchParams.get("stage") as DealStage | null
  const stageFilter   = stageParam && STAGES_VALID.has(stageParam) ? stageParam : null
  /** Optional `?id=<dealId>` deep-link — when present and the deal exists in
   *  the loaded set, we pre-select it so links from the Browse start screen
   *  ("open in pipeline") land directly on the right detail view. */
  const idParam       = searchParams.get("id")

  const { open: sbOpen, width: sbWidth } = useSidebar()
  const headerPadL =
    sbOpen && sbWidth >= SNAP_ICONS ? 16
    : sbOpen                         ? 38
    :                                  120

  const [deals,  setDeals]  = useState<SavedDeal[] | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [selId,  setSelId]  = useState<string | null>(null)
  const [listW,  setListW]  = useState<number>(LIST_W_DEFAULT)
  /** View mode — toggles the main pane between the dense list view
   *  (existing) and the geographic map view (deals as pins on a Mapbox
   *  surface). Defaults to map for the at-a-glance "where is everything"
   *  experience that no other tool in the category gives you. Persists
   *  to localStorage so the user lands in their preferred view next time. */
  const [viewMode, setViewMode] = useState<"list" | "map">(() => {
    if (typeof window === "undefined") return "map"
    return (localStorage.getItem("rv-pipeline-view") as "list" | "map") ?? "map"
  })
  useEffect(() => {
    try { localStorage.setItem("rv-pipeline-view", viewMode) } catch {}
  }, [viewMode])
  /** Theme awareness — Mapbox style needs to flip on theme change.
   *  Subscribes to the html element's class changes so it stays in sync
   *  if the user switches themes mid-session. */
  const [mapStyleId, setMapStyleId] = useState<"dark" | "light">(() => {
    if (typeof document === "undefined") return "dark"
    return document.documentElement.classList.contains("theme-light") ? "light" : "dark"
  })
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setMapStyleId(document.documentElement.classList.contains("theme-light") ? "light" : "dark")
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
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

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const onFocus = () => refresh()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [refresh])

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

  return (
    <div className="flex flex-col h-full overflow-hidden relative" style={{ background: "var(--rv-bg)" }}>
      {/* Atmospheric bloom — same source-light technique as Browse */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 65% 28% at 50% -1%, rgba(48,164,108,0.05) 0%, transparent 55%)",
          zIndex: 0,
        }}
      />
      {/* Header */}
      <div
        className="flex items-center shrink-0 relative"
        style={{
          height:          52,
          paddingLeft:     headerPadL,
          paddingRight:    16,
          WebkitAppRegion: "drag",
          borderBottom:    "0.5px solid var(--rv-border)",
          transition:      "padding-left 220ms cubic-bezier(0.32, 0.72, 0, 1)",
          zIndex: 1,
        } as React.CSSProperties}
      >
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} className="flex items-center gap-3 min-w-0">
          {/* View toggle — segmented pill (Map | List). Map is the default;
              the geographic view is RealVerdict's signature in this category.
              The toggle sits at the front of the header so it reads as the
              primary mode-switch, not a buried preference. */}
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <div className="flex items-baseline gap-2.5 min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight shrink-0" style={{ color: "var(--rv-t1)" }}>
              {stageTitle}
            </h1>
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
                  <span style={{ color: "var(--rv-t4)" }}>·</span>
                  <span>avg </span>
                  <span style={{ color: stats.avgCashFlow < 0 ? "var(--rv-neg)" : "var(--rv-t3)" }}>
                    <Currency value={Math.round(stats.avgCashFlow)} signed />/mo
                  </span>
                </>
              )}
              {summaryExpanded && stats.exposure != null && (
                <>
                  <span style={{ color: "var(--rv-t4)" }}>·</span>
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
                <span
                  className="text-[11.5px] tracking-tight tabular-nums"
                  style={{ color: "var(--rv-t2)" }}
                >
                  {compareIds.size === 0
                    ? "Select listings"
                    : compareIds.size === 1
                    ? "1 picked · need one more"
                    : `${compareIds.size} of 4 picked`}
                </span>
                <button
                  onClick={() => { setCompareMode(false); setCompareIds(new Set()) }}
                  className="text-[11.5px] tracking-tight rounded-[6px] px-2 py-[3px] transition-colors"
                  style={{ color: "var(--rv-t3)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t3)" }}
                >
                  Cancel
                </button>
                {compareIds.size >= 2 && (
                  <button
                    onClick={() => setCompareMode(false)}
                    className="inline-flex items-center gap-1.5 rounded-[7px] text-[12px] font-medium tracking-tight"
                    style={{
                      padding:    "5px 11px",
                      color:      "white",
                      background: "var(--rv-accent)",
                      border:     "0.5px solid rgba(0,0,0,0.16)",
                      boxShadow:  "0 1px 0 rgba(255,255,255,0.10) inset, 0 1px 2px rgba(0,0,0,0.16)",
                    }}
                    title="View the side-by-side comparison"
                  >
                    Compare {compareIds.size}
                  </button>
                )}
              </>
            ) : compareIds.size > 0 ? (
              <>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-medium tabular-nums"
                  style={{
                    color:      "var(--rv-accent)",
                    background: "rgba(48,164,108,0.10)",
                    border:     "0.5px solid rgba(48,164,108,0.22)",
                  }}
                >
                  <GitCompareArrows size={11} strokeWidth={2} />
                  {compareIds.size === 1 ? "1 selected" : `Comparing ${compareIds.size}`}
                </span>
                <button
                  onClick={() => setCompareIds(new Set())}
                  className="text-[11.5px] tracking-tight rounded-[6px] px-2 py-[3px] transition-colors"
                  style={{ color: "var(--rv-t3)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t3)" }}
                >
                  Clear
                </button>
              </>
            ) : (
              // Idle Compare button — accent-tinted so it reads as a
              // real feature, not just a header chip. Bigger padding,
              // accent-colored icon, accent-tinted background that
              // strengthens on hover. This is the entry point users
              // actually need to find.
              <button
                onClick={() => setCompareMode(true)}
                title="Pick 2-4 deals to see them side-by-side. Tip: right-click or drag a row up to add it without entering this mode."
                className="inline-flex items-center gap-1.5 rounded-[8px] text-[12px] font-medium tracking-tight transition-all"
                style={{
                  padding:    "6px 12px",
                  color:      "var(--rv-accent)",
                  background: "rgba(48,164,108,0.10)",
                  border:     "0.5px solid rgba(48,164,108,0.28)",
                  boxShadow:  "0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.10)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(48,164,108,0.18)"
                  e.currentTarget.style.borderColor = "rgba(48,164,108,0.40)"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(48,164,108,0.10)"
                  e.currentTarget.style.borderColor = "rgba(48,164,108,0.28)"
                }}
              >
                <GitCompareArrows size={12} strokeWidth={2.2} />
                Compare deals
              </button>
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
              <span
                className="text-[11.5px] tracking-tight rv-watch-toast"
                style={{ color: "var(--rv-t2)" }}
              >
                {checkResult}
              </span>
            )}
            <button
              onClick={onCheckUpdates}
              disabled={checking}
              title={`Re-check ${watchedCount} watched ${watchedCount === 1 ? "deal" : "deals"} for price changes`}
              className="inline-flex items-center gap-1.5 rounded-[7px] text-[12px] font-medium tracking-tight transition-colors disabled:opacity-50"
              style={{
                padding:    "6px 10px",
                color:      "var(--rv-t2)",
                background: "var(--rv-elev-2)",
                border:     "0.5px solid var(--rv-border)",
              }}
              onMouseEnter={(e) => {
                if (!checking) e.currentTarget.style.background = "var(--rv-elev-4)"
              }}
              onMouseLeave={(e) => {
                if (!checking) e.currentTarget.style.background = "var(--rv-elev-2)"
              }}
            >
              <RefreshCw
                size={11}
                strokeWidth={2}
                className={checking ? "animate-spin" : ""}
                style={{ animationDuration: checking ? "1s" : undefined }}
              />
              {checking ? `Checking ${watchedCount}…` : `Check ${watchedCount}`}
            </button>
          </div>
        )}
      </div>

      {/* Compare-mode banner — slides in below the header to make the
          mode change obvious. Stays out of the layout when not in mode
          (max-height 0). The same accent system as the header chip,
          but spread across the full width so it reads as a state, not a
          control. */}
      <CompareModeBanner active={compareMode} count={compareIds.size} />

      {/* Body — list + splitter + detail */}
      <div className="flex flex-1 min-h-0 relative" style={{ zIndex: 1 }}>
        {error && (
          <div className="flex items-center justify-center w-full">
            <p className="text-[13px]" style={{ color: "var(--rv-bad)" }}>{error}</p>
          </div>
        )}

        {!error && deals !== null && (
          <>
            {/* LEFT pane — map or list, swapped by viewMode. Map gets fluid
                width (flex-1) since it's a canvas; list gets a fixed width
                with a draggable splitter. The detail rail on the right
                stays the same in both modes. */}
            {viewMode === "map" ? (
              <div className="flex-1 min-w-0 h-full" style={{ borderRight: selId ? "0.5px solid var(--rv-border)" : "none" }}>
                <PipelineMap
                  deals={filtered}
                  selectedId={selId}
                  onSelect={setSelId}
                  styleId={mapStyleId}
                />
              </div>
            ) : (
              <>
                <div
                  className="shrink-0 flex flex-col h-full overflow-hidden"
                  style={{
                    width:        listW,
                    borderRight:  "0.5px solid var(--rv-border)",
                  }}
                >
                  <div className="flex-1 overflow-y-auto panel-scroll relative">
                    {/* Drop target — slides in from the top whenever any row
                        is being dragged, gives a visual landing pad with
                        "Drop to add to Compare". Hidden otherwise. */}
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
                {/* Splitter */}
                <div
                  onPointerDown={onSplitDown}
                  onPointerMove={onSplitMove}
                  onPointerUp={onSplitUp}
                  onPointerCancel={onSplitUp}
                  className="rv-splitter shrink-0 cursor-col-resize select-none"
                  style={{ width: 4 }}
                  title="Drag to resize"
                />
              </>
            )}
            {/* Detail — three states:
                  - 2+ deals selected: side-by-side comparison
                  - in compare mode with 0-1 picked: a focused "Selecting"
                    pane with picked-deal previews + instructions, so the
                    detail area becomes part of the selection experience
                    instead of looking like a stale focal deal
                  - otherwise: single deal detail OR empty state

                In MAP mode, the detail rail is fixed-width (440px) and
                only renders when there's a selection — the map gets the
                rest of the canvas. In LIST mode, the detail uses flex-1
                as before. */}
            <div
              className={viewMode === "map" ? "shrink-0 h-full" : "flex-1 min-w-0 h-full"}
              style={viewMode === "map"
                ? {
                    width:      selected || compareDeals.length >= 2 || compareMode ? 440 : 0,
                    overflow:   "hidden",
                    transition: "width 240ms cubic-bezier(0.32, 0.72, 0, 1)",
                  }
                : undefined}
            >
              {compareDeals.length >= 2 ? (
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
              ) : compareMode ? (
                <CompareSelectingPane
                  picked={(deals ?? []).filter((d) => compareIds.has(d.id))}
                  onRemove={(id) => setCompareIds((prev) => {
                    const next = new Set(prev); next.delete(id); return next
                  })}
                />
              ) : selected ? (
                <DealDetail deal={selected} onChange={onDealChange} />
              ) : (
                <DetailEmpty filtered={filtered.length} hasAny={(deals?.length ?? 0) > 0} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Slim banner that drops in below the header when compareMode is on.
 *  Visually announces the mode change ("you're now picking deals to
 *  compare") and shows a live counter. Slides via max-height + opacity so
 *  the layout shift is smooth, not abrupt. The X icon at the right exits
 *  the mode (mirrors Cancel in the header). Clicking the banner itself
 *  is inert — it's a status surface. */
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
        borderBottom: active ? "0.5px solid rgba(48,164,108,0.22)" : "0.5px solid transparent",
        transition:   "max-height 220ms cubic-bezier(0.32,0.72,0,1), opacity 200ms cubic-bezier(0.32,0.72,0,1), border-bottom-color 200ms ease",
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
        <span
          className="text-[12px] tracking-tight"
          style={{ color: "var(--rv-t2)" }}
        >
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
    <div
      className="h-full overflow-y-auto panel-scroll flex flex-col items-center justify-center gap-6 px-8"
      style={{
        // Subtle accent wash signals "you're in compare mode" without
        // overwhelming. Pulls the eye back to the list (the action
        // surface) rather than competing with it.
        background:           "linear-gradient(180deg, rgba(48,164,108,0.04) 0%, transparent 40%), var(--rv-bg)",
      }}
    >
      <div className="flex flex-col items-center gap-3 text-center max-w-[420px]">
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 44, height: 44,
            background: "rgba(48,164,108,0.12)",
            border:     "0.5px solid rgba(48,164,108,0.26)",
            color:      "var(--rv-accent)",
          }}
        >
          <GitCompareArrows size={20} strokeWidth={1.8} />
        </div>
        <p className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--rv-t1)" }}>
          {picked.length === 0
            ? "Pick deals to compare"
            : "Add at least one more"}
        </p>
        <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--rv-t3)" }}>
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
              className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-[10px] transition-all"
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
                  <p
                    className="text-[12px] font-semibold tabular-nums truncate w-full text-center"
                    style={{ color: "var(--rv-t1)" }}
                  >
                    {deal.list_price != null
                      ? <Currency value={deal.list_price} whole />
                      : "—"}
                  </p>
                  <p
                    className="text-[10.5px] truncate w-full text-center leading-tight"
                    style={{ color: "var(--rv-t3)" }}
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
                <span className="text-[11px]" style={{ color: "var(--rv-t4)" }}>
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
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center gap-3">
      <p className="text-[12.5px]" style={{ color: "var(--rv-t2)" }}>
        {hasAny ? `Nothing in ${stageTitle}` : "No saved deals yet"}
      </p>
      {hasAny ? (
        <button
          onClick={onClearStage}
          className="text-[11.5px] underline-offset-2"
          style={{ color: "var(--rv-accent)" }}
        >
          See all active
        </button>
      ) : (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--rv-t4)" }}>
          Open Browse, find a listing, hit Save.
        </p>
      )}
    </div>
  )
}
