"use client"

// ---------------------------------------------------------------------------
// Pipeline — saved-deal library
// ---------------------------------------------------------------------------
//
// Strict scope per the rebuild: this is a clean library of saved deals.
// You analyze deals in the Browse view; you store and revisit them here.
//
// What this page IS:
//   - List of saved deals on the left, with fast filter + sort.
//   - DossierPanel (the same one as Browse) on the right showing the
//     selected deal — single source of truth for the analysis surface.
//   - Compare action: select 2-4 rows → floating bar → side-by-side view
//     with metric deltas and a winner indicator per metric.
//   - "Open original listing" jumps the user back to the source URL.
//   - Delete a saved deal.
//
// What this page is NOT (and what was ripped out):
//   - No address-autocomplete search (use Browse to add deals).
//   - No "pending card" UX (saving happens from the Browse panel only).
//   - No probabilistic verdict, no Monte Carlo, no narrative-pack PDF.
//   - No AI narrative call on row select. The model's "take" is captured
//     at extraction time and travels with the deal.
//
// Strangler-fig discipline: this file pulls only from /lib/calculations,
// /lib/lead-adapter, /lib/listing-detect, and the shared SavedDealCard +
// DossierPanel. No imports from /lib/distribution-engine, /lib/comparables,
// /lib/comps, /lib/market-data, /lib/estimators, /lib/flood, /lib/pack-pdf,
// /lib/zillow-url, /lib/negotiation-pack, /lib/stress-scenarios.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react"
import { Search, X, Check, Trash2, ExternalLink, Plus } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import {
  analyseDeal,
  findOfferCeiling,
  formatCurrency,
  formatPercent,
  sanitiseInputs,
  type DealAnalysis,
  type OfferCeiling,
} from "@/lib/calculations"
import DossierPanel from "../_components/DossierPanel"
import { sourceLabel, type SourceTag } from "@/lib/listing-detect"
import type { SavedDeal } from "./SavedDealCard"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type DealsClientProps = {
  deals: SavedDeal[]
  signedIn: boolean
  isPro: boolean
  supabaseConfigured: boolean
}

type SortKey = "date" | "address" | "asking" | "cashflow" | "dscr" | "caprate"
type SortDir = "asc" | "desc"

type ComputedDeal = {
  deal: SavedDeal
  analysis: DealAnalysis
  walkAway: OfferCeiling | null
  source: SourceTag
}

const SESSION_SELECTED_KEY = "rv:pipeline:selected"

function readSelected(): string | null {
  if (typeof window === "undefined") return null
  return window.sessionStorage.getItem(SESSION_SELECTED_KEY)
}

function detectSourceFromUrl(url: string | null | undefined): SourceTag {
  if (!url) return null
  const m = url.match(/^https?:\/\/(?:www\.)?(zillow|redfin|realtor|homes|trulia|movoto|loopnet|compass)\.com\//i)
  return (m?.[1]?.toLowerCase() as SourceTag) ?? null
}

// ---------------------------------------------------------------------------
// DealsClient
// ---------------------------------------------------------------------------

export function DealsClient({ deals, signedIn, isPro, supabaseConfigured }: DealsClientProps) {
  // Local copies that survive optimistic delete.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(() => readSelected())
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set())
  const [compareOpen, setCompareOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  // Persist selection across reloads.
  useEffect(() => {
    if (selectedId) window.sessionStorage.setItem(SESSION_SELECTED_KEY, selectedId)
    else            window.sessionStorage.removeItem(SESSION_SELECTED_KEY)
  }, [selectedId])

  // Compute analysis once per deal — DealRow.results is stale; derive fresh.
  const computed = useMemo(() => {
    const out = new Map<string, ComputedDeal>()
    for (const deal of deals) {
      if (deletedIds.has(deal.id)) continue
      try {
        const inputs   = sanitiseInputs(deal.inputs)
        const analysis = analyseDeal(inputs)
        const walkAway = (() => {
          try { return findOfferCeiling(inputs) } catch { return null }
        })()
        const source  = (deal.source_site as SourceTag) ?? detectSourceFromUrl(deal.source_url)
        out.set(deal.id, { deal, analysis, walkAway, source })
      } catch {
        // Skip rows whose inputs are corrupt — they'd render zeros.
      }
    }
    return out
  }, [deals, deletedIds])

  // Filtered + sorted list.
  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const list = Array.from(computed.values()).filter(({ deal }) => {
      if (!term) return true
      return (deal.address ?? "").toLowerCase().includes(term)
    })
    list.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case "address":  cmp = (a.deal.address ?? "").localeCompare(b.deal.address ?? ""); break
        case "asking":   cmp = a.deal.inputs.purchasePrice - b.deal.inputs.purchasePrice; break
        case "cashflow": cmp = a.analysis.monthlyCashFlow - b.analysis.monthlyCashFlow; break
        case "dscr":
          cmp = (isFinite(a.analysis.dscr) ? a.analysis.dscr : 999)
              - (isFinite(b.analysis.dscr) ? b.analysis.dscr : 999)
          break
        case "caprate":  cmp = a.analysis.capRate - b.analysis.capRate; break
        case "date":     cmp = +new Date(a.deal.created_at) - +new Date(b.deal.created_at); break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
    return list
  }, [computed, filter, sortKey, sortDir])

  // Default selection — derived from rows during render rather than via
  // an effect (per React docs §You Might Not Need an Effect). When the
  // current selection is missing or invalid, fall back to the first row.
  const effectiveSelectedId =
    selectedId && computed.has(selectedId)
      ? selectedId
      : rows[0]?.deal.id ?? null
  const selected = effectiveSelectedId ? computed.get(effectiveSelectedId) ?? null : null

  // Optimistic delete — remove from view, fire request, restore on failure.
  const handleDelete = useCallback(async (id: string) => {
    setDeletedIds((prev) => {
      const next = new Set(prev); next.add(id); return next
    })
    if (selectedId === id) setSelectedId(null)
    setCompareIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev); next.delete(id); return next
    })
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(id)}`, { method: "DELETE" })
      if (!res.ok) throw new Error("delete failed")
    } catch {
      setDeletedIds((prev) => {
        const next = new Set(prev); next.delete(id); return next
      })
    }
  }, [selectedId])

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 4) next.add(id)
      return next
    })
  }, [])

  const handleOpenSource = useCallback((url: string) => {
    if (!url) return
    if (typeof window !== "undefined" && window.electronAPI?.navigate) {
      window.localStorage.setItem("rv:browse:return-url", url)
      window.location.href = "/research"
    } else {
      window.open(url, "_blank")
    }
  }, [])

  const sortToggle = useCallback((key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir(key === "address" ? "asc" : "desc") }
  }, [sortKey])

  // Keyboard navigation — j/k to move between deals, ⌘O to open the
  // original listing for the selected deal, ⌘F or "/" to focus the filter,
  // x to toggle compare on the selected row.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField = !!target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )

      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") ||
          (!inField && e.key === "/")) {
        e.preventDefault()
        const el = document.querySelector<HTMLInputElement>('input[placeholder="Filter by address"]')
        if (el) { el.focus(); el.select() }
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        const deal = effectiveSelectedId
          ? rows.find((r) => r.deal.id === effectiveSelectedId)?.deal
          : null
        if (deal?.source_url) {
          e.preventDefault()
          handleOpenSource(deal.source_url)
        }
        return
      }

      if (inField) return

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault()
        if (rows.length === 0) return
        const idx = rows.findIndex((r) => r.deal.id === effectiveSelectedId)
        const nextIdx = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1)
        setSelectedId(rows[nextIdx].deal.id)
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault()
        if (rows.length === 0) return
        const idx = rows.findIndex((r) => r.deal.id === effectiveSelectedId)
        const nextIdx = idx <= 0 ? 0 : idx - 1
        setSelectedId(rows[nextIdx].deal.id)
      } else if (e.key === "x" && effectiveSelectedId) {
        e.preventDefault()
        toggleCompare(effectiveSelectedId)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [rows, effectiveSelectedId, toggleCompare, handleOpenSource])

  // ---------------------------------------------------------------------
  // Empty state — never lived analyses
  // ---------------------------------------------------------------------
  if (deals.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 px-6 rv-surface-bg">
        <div className="h-12 w-12 rounded-full rv-surface-2 flex items-center justify-center">
          <Plus className="h-5 w-5 text-muted-foreground/60" strokeWidth={1.5} />
        </div>
        <div className="space-y-1.5 max-w-[34ch]">
          <p className="text-[14px] font-medium rv-t1">Your pipeline is empty</p>
          <p className="text-[13px] rv-t3 leading-relaxed">
            Open a real estate listing in Browse — the analysis pops out in the right panel,
            and you can save it from there.
          </p>
        </div>
        <Link
          href="/research"
          className="rv-pill mt-2 text-[12px]"
        >
          Open Browse
        </Link>
      </div>
    )
  }

  // ---------------------------------------------------------------------
  // Main two-pane layout
  // ---------------------------------------------------------------------
  return (
    <div className="flex-1 flex min-h-0 rv-surface-bg">
      {/* ── Left pane: filter + table of saved deals ─────────────────── */}
      <div className="w-[420px] shrink-0 flex flex-col rv-surface-1 border-r border-border min-w-0">
        {/* Filter */}
        <div className="px-4 pt-4 pb-3 shrink-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/45" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by address"
              className="w-full pl-8 pr-3 h-8 rounded-md bg-[var(--rv-surface-2)] border border-white/5 text-[12px] placeholder:text-muted-foreground/40 focus:outline-none focus:border-white/15 transition-colors"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center rounded text-muted-foreground/55 hover:text-foreground"
                aria-label="Clear filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Header row */}
        <div className="px-4 pb-2 grid grid-cols-[20px_1fr_72px_56px] items-center text-[10px] uppercase tracking-[0.08em] text-muted-foreground/50">
          <span aria-hidden="true" />
          <SortHeader label="Address"   active={sortKey === "address"}  dir={sortDir} onClick={() => sortToggle("address")} />
          <SortHeader label="Cash / mo" active={sortKey === "cashflow"} dir={sortDir} onClick={() => sortToggle("cashflow")} align="end" />
          <SortHeader label="DSCR"      active={sortKey === "dscr"}     dir={sortDir} onClick={() => sortToggle("dscr")} align="end" />
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {rows.length === 0 ? (
            <div className="px-6 py-10 text-center text-[12px] rv-t3">
              No deals match “{filter}”.
            </div>
          ) : (
            <ul className="pb-24">
              {rows.map(({ deal, analysis, source }) => {
                const isSelected = deal.id === effectiveSelectedId
                const isCompared = compareIds.has(deal.id)
                const sourceText = sourceLabel(source) || ""
                return (
                  <li
                    key={deal.id}
                    className={cn(
                      "rv-row group grid grid-cols-[20px_1fr_72px_56px] items-center px-4 h-12 cursor-pointer min-w-0 select-none",
                      isSelected && "rv-row--selected",
                    )}
                    onClick={() => setSelectedId(deal.id)}
                  >
                    {/* Compare checkbox */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleCompare(deal.id) }}
                      className={cn(
                        "h-4 w-4 rounded-[3px] flex items-center justify-center transition-all",
                        "border border-white/10 hover:border-white/30",
                        isCompared
                          ? "bg-[var(--rv-accent)] border-[var(--rv-accent)] opacity-100"
                          : "opacity-0 group-hover:opacity-60",
                      )}
                      aria-label={isCompared ? "Remove from compare" : "Add to compare"}
                    >
                      {isCompared && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                    </button>

                    {/* Address + source */}
                    <div className="min-w-0">
                      <p className="text-[12.5px] rv-t1 truncate" style={{ letterSpacing: "-0.005em" }}>
                        {deal.address ?? "Unknown address"}
                      </p>
                      {sourceText && (
                        <p className="text-[10px] rv-t3 font-mono uppercase tracking-[0.06em]">{sourceText}</p>
                      )}
                    </div>

                    {/* Cash flow */}
                    <p
                      className={cn(
                        "text-right text-[12px] font-mono rv-num tabular-nums",
                        analysis.monthlyCashFlow < 0 ? "rv-tone-bad" : "rv-t1",
                      )}
                    >
                      {(analysis.monthlyCashFlow >= 0 ? "+" : "−") +
                        formatCurrency(Math.abs(Math.round(analysis.monthlyCashFlow)), 0)}
                    </p>

                    {/* DSCR */}
                    <p className="text-right text-[12px] font-mono rv-num tabular-nums rv-t2">
                      {Number.isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "\u221E"}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Floating compare bar */}
        {compareIds.size > 0 && (
          <div className="absolute bottom-5 left-5 right-5 max-w-[400px] rv-surface-2 border border-white/10 rounded-lg shadow-2xl px-4 py-3 flex items-center gap-3 z-30">
            <span className="text-[12px] rv-t1 font-medium">{compareIds.size} selected</span>
            <span className="text-[11px] rv-t3">— up to 4 to compare</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setCompareIds(new Set())}
              className="text-[11px] rv-t3 hover:rv-t1 transition-colors px-2 py-1"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={compareIds.size < 2}
              onClick={() => setCompareOpen(true)}
              className="rv-pill text-[12px] px-3 py-1.5 disabled:opacity-40 disabled:pointer-events-none"
            >
              Compare
            </button>
          </div>
        )}
      </div>

      {/* ── Right pane: dossier for selected deal ───────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selected ? (
          <>
            <div className="shrink-0 flex items-center gap-2 h-12 px-5 border-b border-border">
              <p className="text-[12px] rv-t3 font-mono uppercase tracking-[0.08em]">
                {sourceLabel(selected.source) || "Saved deal"}
              </p>
              <div className="flex-1" />
              {selected.deal.source_url && (
                <button
                  type="button"
                  onClick={() => handleOpenSource(selected.deal.source_url!)}
                  className="inline-flex items-center gap-1.5 text-[11px] rv-t2 hover:rv-t1 transition-colors px-2 py-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open original
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDelete(selected.deal.id)}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/55 hover:text-red-400 transition-colors px-2 py-1"
                aria-label="Delete deal"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <DossierPanel
              key={selected.deal.id}
              analysis={selected.analysis}
              walkAway={selected.walkAway}
              inputs={selected.deal.inputs}
              address={selected.deal.address ?? undefined}
              propertyFacts={selected.deal.property_facts ?? undefined}
              source={selected.source as DossierSource}
              sourceUrl={selected.deal.source_url}
              onOpenSource={handleOpenSource}
              signedIn={signedIn}
              isPro={isPro}
              supabaseConfigured={supabaseConfigured}
              panelWidth={520}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[13px] rv-t3">
            Select a deal to view the dossier.
          </div>
        )}
      </div>

      {/* ── Compare overlay ─────────────────────────────────────────── */}
      {compareOpen && (
        <CompareOverlay
          ids={Array.from(compareIds)}
          computed={computed}
          onClose={() => setCompareOpen(false)}
          onClear={() => { setCompareIds(new Set()); setCompareOpen(false) }}
          onOpenSource={handleOpenSource}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SortHeader — table column header that toggles sort
// ---------------------------------------------------------------------------

function SortHeader({
  label, active, dir, onClick, align,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  align?: "start" | "end"
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 hover:text-foreground transition-colors",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      <span>{label}</span>
      {active && <span aria-hidden="true">{dir === "asc" ? "▲" : "▼"}</span>}
    </button>
  )
}

// ---------------------------------------------------------------------------
// CompareOverlay — 2-4 properties side-by-side with metric deltas + winners
// ---------------------------------------------------------------------------

type DossierSource = "zillow" | "redfin" | "realtor" | "homes" | "trulia" | "movoto" | null

function CompareOverlay({
  ids, computed, onClose, onClear, onOpenSource,
}: {
  ids: string[]
  computed: Map<string, ComputedDeal>
  onClose: () => void
  onClear: () => void
  onOpenSource: (url: string) => void
}) {
  const cards = ids
    .map((id) => computed.get(id))
    .filter((c): c is ComputedDeal => !!c)

  if (cards.length < 2) {
    return (
      <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm flex items-center justify-center">
        <button onClick={onClose} className="rv-pill">Close</button>
      </div>
    )
  }

  const dscrVals = cards.map((c) => isFinite(c.analysis.dscr) ? c.analysis.dscr : 999)
  const cfVals   = cards.map((c) => c.analysis.monthlyCashFlow)
  const capVals  = cards.map((c) => c.analysis.capRate)
  const cocVals  = cards.map((c) => c.analysis.cashOnCashReturn)
  const beVals   = cards.map((c) => c.walkAway?.recommendedCeiling?.price ?? 0)
  const bestDscr = Math.max(...dscrVals)
  const worstDscr = Math.min(...dscrVals)
  const bestCf = Math.max(...cfVals)
  const worstCf = Math.min(...cfVals)
  const bestCap = Math.max(...capVals)
  const worstCap = Math.min(...capVals)
  const bestCoc = Math.max(...cocVals)
  const worstCoc = Math.min(...cocVals)
  const bestBe = Math.max(...beVals)
  const worstBe = Math.min(...beVals)

  return (
    <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm flex flex-col">
      <header className="h-14 flex items-center gap-3 px-5 border-b border-border shrink-0">
        <h2 className="text-[13px] font-semibold tracking-tight">Compare</h2>
        <span className="text-[11px] rv-t3">{cards.length} properties</span>
        <div className="flex-1" />
        <button onClick={onClear} className="text-[11px] rv-t3 hover:rv-t1 transition-colors px-2 py-1">
          Clear selection
        </button>
        <button
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors"
          aria-label="Close compare"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div
        className={cn(
          "flex-1 overflow-auto grid gap-4 p-5",
          cards.length === 2 ? "grid-cols-2"
            : cards.length === 3 ? "grid-cols-3"
            : "grid-cols-4",
        )}
      >
        {cards.map((c, i) => (
          <CompareColumn
            key={c.deal.id}
            card={c}
            onOpenSource={onOpenSource}
            highlights={{
              dscr: dscrVals[i] === bestDscr ? "best" : dscrVals[i] === worstDscr ? "worst" : undefined,
              cf:   cfVals[i]   === bestCf   ? "best" : cfVals[i]   === worstCf   ? "worst" : undefined,
              cap:  capVals[i]  === bestCap  ? "best" : capVals[i]  === worstCap  ? "worst" : undefined,
              coc:  cocVals[i]  === bestCoc  ? "best" : cocVals[i]  === worstCoc  ? "worst" : undefined,
              be:   beVals[i]   === bestBe   ? "best" : beVals[i]   === worstBe   ? "worst" : undefined,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function CompareColumn({
  card, highlights, onOpenSource,
}: {
  card: ComputedDeal
  highlights: {
    dscr?: "best" | "worst"
    cf?: "best" | "worst"
    cap?: "best" | "worst"
    coc?: "best" | "worst"
    be?: "best" | "worst"
  }
  onOpenSource: (url: string) => void
}) {
  const { deal, analysis, walkAway } = card
  const cf = analysis.monthlyCashFlow
  const dscr = analysis.dscr
  const cap = analysis.capRate
  const coc = analysis.cashOnCashReturn
  const breakEven = walkAway?.recommendedCeiling?.price ?? null

  return (
    <div className="rv-surface-2 rounded-lg p-5 space-y-5 min-w-0">
      <div className="space-y-1.5">
        <p className="text-[13px] font-semibold tracking-tight rv-t1 truncate">
          {deal.address ?? "Unknown address"}
        </p>
        <p className="text-[11px] rv-t3 font-mono rv-num">
          {[
            deal.property_facts?.beds   != null && `${deal.property_facts.beds} bd`,
            deal.property_facts?.baths  != null && `${deal.property_facts.baths} ba`,
            deal.property_facts?.sqft   != null && `${deal.property_facts.sqft.toLocaleString()} sqft`,
          ].filter(Boolean).join("  ·  ")}
        </p>
        <p className="text-[11px] rv-t3 font-mono rv-num">
          Asking {formatCurrency(deal.inputs.purchasePrice, 0)}
          {breakEven != null && <> · BE {formatCurrency(breakEven, 0)}</>}
        </p>
        {deal.source_url && (
          <button
            type="button"
            onClick={() => onOpenSource(deal.source_url!)}
            className="text-[10px] rv-t3 hover:rv-t1 inline-flex items-center gap-1 mt-1 transition-colors"
          >
            <ExternalLink className="h-2.5 w-2.5" />
            Open original
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 pt-3 border-t border-white/[0.06]">
        <CompareMetric label="DSCR"          value={Number.isFinite(dscr) ? dscr.toFixed(2) : "\u221E"} highlight={highlights.dscr} />
        <CompareMetric label="Cash / mo"     value={(cf >= 0 ? "+" : "−") + formatCurrency(Math.abs(cf), 0)} highlight={highlights.cf} tone={cf < 0 ? "bad" : undefined} />
        <CompareMetric label="Cap rate"      value={formatPercent(cap, 2)} highlight={highlights.cap} />
        <CompareMetric label="Cash-on-cash"  value={formatPercent(coc, 2)} highlight={highlights.coc} />
        <CompareMetric label="Break-even"    value={breakEven != null ? formatCurrency(breakEven, 0) : "—"} highlight={highlights.be} />
      </div>
    </div>
  )
}

function CompareMetric({
  label, value, highlight, tone,
}: {
  label: string
  value: string
  highlight?: "best" | "worst"
  tone?: "bad"
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-3">
      <p className="text-[10px] uppercase tracking-[0.08em] rv-t3">{label}</p>
      <p
        className={cn(
          "font-mono rv-num text-right",
          highlight === "best"  && "rv-t1 font-semibold",
          highlight === "worst" && "rv-t4",
          !highlight && "rv-t2",
          tone === "bad" && "rv-tone-bad",
        )}
        style={{ fontSize: "15px", letterSpacing: "-0.005em" }}
      >
        {value}
      </p>
    </div>
  )
}
