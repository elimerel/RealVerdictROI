"use client"

import * as React from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  DEAL_STAGES,
  STAGE_LABEL,
  type DealStage,
  type SavedDeal,
} from "@/lib/pipeline"

/** PipelineKanban — Pipedrive-style stage board.
 *
 *  Drag-and-drop via @dnd-kit (the same lib used by GitHub Projects,
 *  Linear, etc.) — accessibility, keyboard nav, touch, and collision
 *  detection are library-handled. We only render the surface and call
 *  back on drop.
 *
 *  Lanes = the 5 DealStages defined in lib/pipeline. Cards inside each
 *  lane are sorted by created_at (newest first). Dropping a card on a
 *  different lane fires onMoveStage with the new stage; the parent
 *  component handles the IPC + optimistic update.
 *
 *  Click a card (without dragging) → onSelect. Same handler the table
 *  view uses, so the detail panel opens with the same behavior. */

type KanbanProps = {
  deals:        SavedDeal[]
  onSelect:     (id: string) => void
  onMoveStage:  (id: string, nextStage: DealStage) => void
}

const STAGE_TONE: Record<DealStage, string> = {
  watching:   "bg-primary/10 text-primary",
  interested: "bg-primary/15 text-primary",
  offered:    "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  won:        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  passed:     "bg-muted text-muted-foreground",
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${n < 0 ? "−" : ""}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${n < 0 ? "−" : ""}$${(abs / 1_000).toFixed(1)}k`
  return `${n < 0 ? "−" : ""}$${Math.round(abs).toLocaleString("en-US")}`
}

// ── Card ──────────────────────────────────────────────────────────────────

function DealCard({
  deal,
  onSelect,
  isOverlay,
}: {
  deal:      SavedDeal
  onSelect:  (id: string) => void
  isOverlay?: boolean
}) {
  const cf = deal.snapshot.metrics.monthlyCashFlow
  const cap = deal.snapshot.metrics.capRate
  const tone = cf == null ? "" : cf >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
  const cityState = [deal.city, deal.state].filter(Boolean).join(", ")

  return (
    <Card
      data-slot="card"
      onClick={() => !isOverlay && onSelect(deal.id)}
      className={cn(
        "p-3 cursor-grab active:cursor-grabbing transition-shadow",
        isOverlay ? "shadow-lg ring-2 ring-primary" : "hover:shadow-sm"
      )}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-medium truncate">{deal.address ?? "—"}</span>
            {cityState && (
              <span className="text-[11.5px] text-muted-foreground truncate">{cityState}</span>
            )}
          </div>
          {deal.list_price != null && (
            <span className="text-[12px] tabular-nums text-muted-foreground shrink-0">
              {fmtCurrency(deal.list_price)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className={cn("text-[12px] tabular-nums", tone)}>
            {cf != null ? fmtCurrency(cf) : "—"}
            {cf != null && <span className="ml-0.5 text-[10.5px] text-muted-foreground">/mo</span>}
          </span>
          <span className="text-[11.5px] tabular-nums text-muted-foreground">
            {cap != null && Number.isFinite(cap) ? `${(cap * 100).toFixed(2)}% cap` : ""}
          </span>
        </div>
      </div>
    </Card>
  )
}

function SortableDealCard(props: { deal: SavedDeal; onSelect: (id: string) => void }) {
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id: props.deal.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DealCard deal={props.deal} onSelect={props.onSelect} />
    </div>
  )
}

// ── Lane ──────────────────────────────────────────────────────────────────

function Lane({
  stage,
  deals,
  onSelect,
}: {
  stage:    DealStage
  deals:    SavedDeal[]
  onSelect: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane-${stage}` })

  return (
    <div className="flex flex-col gap-2 min-w-[280px] w-[280px] shrink-0">
      <div className="flex items-center justify-between px-1">
        <Badge variant="outline" className={cn("capitalize", STAGE_TONE[stage])}>
          {STAGE_LABEL[stage]}
        </Badge>
        <span className="text-[11.5px] tabular-nums text-muted-foreground">
          {deals.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col gap-2 rounded-xl border border-dashed p-2 min-h-[120px] flex-1 transition-colors",
          isOver ? "border-primary bg-primary/5" : "border-border bg-muted/40"
        )}
      >
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map((d) => (
            <SortableDealCard key={d.id} deal={d} onSelect={onSelect} />
          ))}
          {deals.length === 0 && (
            <div className="flex items-center justify-center h-full py-6 text-[11.5px] text-muted-foreground">
              Drop deals here
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  )
}

// ── Board ─────────────────────────────────────────────────────────────────

export function PipelineKanban({ deals, onSelect, onMoveStage }: KanbanProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null)

  // 6px activation distance keeps a click from triggering a drag — the
  // user has to actually move the pointer before sortable engages, so
  // "click to open" still works on cards.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  // Group by stage
  const byStage = React.useMemo(() => {
    const out: Record<DealStage, SavedDeal[]> = {
      watching: [], interested: [], offered: [], won: [], passed: [],
    }
    for (const d of deals) (out[d.stage] ?? out.watching).push(d)
    for (const k of Object.keys(out) as DealStage[]) {
      out[k].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
    return out
  }, [deals])

  const activeDeal = activeId ? deals.find((d) => d.id === activeId) ?? null : null

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const activeDealId = String(active.id)
    const overId = String(over.id)

    // Determine target stage: lane drop → over.id is `lane-<stage>`;
    // card drop within a lane → over.id is the card id, look up its stage.
    let targetStage: DealStage | null = null
    if (overId.startsWith("lane-")) {
      targetStage = overId.slice("lane-".length) as DealStage
    } else {
      const overDeal = deals.find((d) => d.id === overId)
      if (overDeal) targetStage = overDeal.stage
    }
    if (!targetStage) return

    const movingDeal = deals.find((d) => d.id === activeDealId)
    if (!movingDeal || movingDeal.stage === targetStage) return

    onMoveStage(activeDealId, targetStage)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {/* Right-edge mask hints there's more content offscreen when the
          board exceeds viewport width. The CSS mask fades the rightmost
          24px to transparent, so the user reads "more →" without
          needing a separate arrow chrome. */}
      <div
        className="flex gap-4 overflow-x-auto pb-4 px-1"
        style={{
          maskImage: "linear-gradient(to right, black calc(100% - 24px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to right, black calc(100% - 24px), transparent 100%)",
        }}
      >
        {DEAL_STAGES.map((stage) => (
          <Lane key={stage} stage={stage} deals={byStage[stage]} onSelect={onSelect} />
        ))}
      </div>
      <DragOverlay>
        {activeDeal && (
          <DealCard deal={activeDeal} onSelect={() => {}} isOverlay />
        )}
      </DragOverlay>
    </DndContext>
  )
}
