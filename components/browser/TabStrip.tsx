"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"
import type { TabInfo } from "@/lib/electron"

interface TabStripProps {
  tabs:        TabInfo[]
  activeId:    string | null
  /** Left padding so the strip clears the macOS traffic lights / sidebar
   *  toggle in icons-only / hidden modes. Same logic as the Toolbar. */
  paddingLeft: number
  onActivate:  (id: string) => void
  onClose:     (id: string) => void
  onNew:       () => void
  /** Drag-to-reorder commit handler. Receives the new ordered list of
   *  tab ids when the user drops a tab. Wired to electronAPI.reorderTabs
   *  in the host page. */
  onReorder?:  (orderedIds: string[]) => void
}

/** Compact tab strip — sits above the toolbar on /browse only. Renders
 *  nothing when there's only a single tab and it's empty (i.e., the
 *  start screen state). */
export default function TabStrip({
  tabs, activeId, paddingLeft, onActivate, onClose, onNew, onReorder,
}: TabStripProps) {
  // Track drag state — which tab id is being dragged, and which gap
  // the cursor is hovering over. Used for the visual drop indicator
  // and to compute the reorder on drop.
  const [draggingId, setDraggingId]   = useState<string | null>(null)
  const [hoverIndex, setHoverIndex]   = useState<number | null>(null)

  // Always render the strip — even with zero tabs or a single empty
  // tab. Reserving the space removes the layout shift that happens
  // when the second tab opens (the toolbar would otherwise jump down
  // by 40px). Same behavior as Chrome/Safari — the strip is part of
  // the chrome, not contingent on tab count.
  if (tabs.length === 0) return null

  // Commit a reorder. Insert the dragged tab at the targetIndex (in the
  // new array, with the dragged tab removed first), then fire onReorder
  // with the resulting id sequence.
  const commitReorder = (draggedId: string, targetIndex: number) => {
    if (!onReorder) return
    const ids = tabs.map((t) => t.id)
    const fromIndex = ids.indexOf(draggedId)
    if (fromIndex === -1 || fromIndex === targetIndex) return
    ids.splice(fromIndex, 1)
    // Adjust target if it was after the dragged tab (since we removed one).
    const adjusted = targetIndex > fromIndex ? targetIndex - 1 : targetIndex
    ids.splice(adjusted, 0, draggedId)
    onReorder(ids)
  }

  return (
    <div
      className="flex items-stretch shrink-0 select-none rv-tabstrip relative"
      style={{
        height:           40,
        paddingLeft,
        paddingRight:     8,
        WebkitAppRegion:  "drag",
        // Strip is the DARK back layer (in shadow). Toolbar + active
        // tab are LIGHTER (alive, forward). Same Chrome-style
        // hierarchy as before.
        background:       "var(--rv-bg)",
        transition:       "padding-left 220ms cubic-bezier(0.32, 0.72, 0, 1)",
      } as React.CSSProperties}
    >
      <div
        className="flex items-stretch gap-[2px] flex-1 min-w-0 overflow-x-auto rv-tabstrip-scroll"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {tabs.map((t, i) => {
          // Live rearrangement: while dragging, the OTHER tabs shift via
          // transform to make space for the dragged tab to land. Same
          // motion as Chrome's tab drag — eyes track where the tab will
          // end up before the drop commits.
          const draggingFromIndex = draggingId
            ? tabs.findIndex((x) => x.id === draggingId)
            : -1
          const TAB_WIDTH = 222   // 220 + 2px gap
          let xOffset = 0
          if (draggingId && draggingFromIndex !== -1 && hoverIndex !== null && t.id !== draggingId) {
            // Dragging right: tabs in (from, hover) shift LEFT
            if (draggingFromIndex < hoverIndex && i > draggingFromIndex && i < hoverIndex) {
              xOffset = -TAB_WIDTH
            }
            // Dragging left: tabs in [hover, from) shift RIGHT
            if (draggingFromIndex > hoverIndex && i >= hoverIndex && i < draggingFromIndex) {
              xOffset = TAB_WIDTH
            }
          }
          return (
            <TabItem
              key={t.id}
              tab={t}
              active={t.id === activeId}
              isDragging={draggingId === t.id}
              xOffset={xOffset}
              onActivate={() => onActivate(t.id)}
              onClose={() => onClose(t.id)}
              onDragStart={() => setDraggingId(t.id)}
              onDragOver={(beforeOrAfter) => {
                setHoverIndex(beforeOrAfter === "before" ? i : i + 1)
              }}
              onDragEnd={() => {
                if (draggingId && hoverIndex !== null) {
                  commitReorder(draggingId, hoverIndex)
                }
                setDraggingId(null)
                setHoverIndex(null)
              }}
            />
          )
        })}
        <button
          onClick={onNew}
          title="New tab (⌘T)"
          aria-label="New tab"
          className="self-center inline-flex items-center justify-center rounded-[6px]"
          style={{
            width:       24,
            height:      24,
            marginLeft:  4,
            color:       "var(--rv-t4)",
            background:  "transparent",
            transition:  "color 100ms cubic-bezier(0.4, 0, 0.2, 1), background-color 100ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color      = "var(--rv-t2)"
            e.currentTarget.style.background = "var(--rv-elev-2)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color      = "var(--rv-t4)"
            e.currentTarget.style.background = "transparent"
          }}
        >
          <Plus size={12} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  )
}

function TabItem({
  tab, active, isDragging, xOffset,
  onActivate, onClose, onDragStart, onDragOver, onDragEnd,
}: {
  tab:        TabInfo
  active:     boolean
  isDragging: boolean
  /** Horizontal pixel offset for live rearrangement during drag.
   *  CSS transition handles the slide animation. */
  xOffset:    number
  onActivate: () => void
  onClose:    () => void
  onDragStart: () => void
  onDragOver:  (beforeOrAfter: "before" | "after") => void
  onDragEnd:   () => void
}) {
  return (
    <div
      onClick={onActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onActivate() }}
      // Native HTML5 drag — works smoothly with React's render. The
      // tab is the drag source AND a drop target; we compute whether
      // the cursor is in the left or right half to decide insert before
      // or after this tab.
      draggable
      onDragStart={(e) => {
        // Set a transparent drag image so the browser doesn't render a
        // ghost — the visual feedback comes from the dimmed source tab
        // + the drop indicator line.
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", tab.id)
        onDragStart()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        const rect = e.currentTarget.getBoundingClientRect()
        const midX = rect.left + rect.width / 2
        onDragOver(e.clientX < midX ? "before" : "after")
      }}
      onDragEnd={onDragEnd}
      onDrop={(e) => { e.preventDefault(); onDragEnd() }}
      className="group relative flex items-center gap-2 cursor-default select-none"
      style={{
        width:        220,
        minWidth:     220,
        maxWidth:     220,
        height:       34,
        padding:      "0 10px 0 12px",
        marginTop:    6,
        // Active tab matches the toolbar surface (var(--rv-surface)) and
        // overlaps the toolbar's top edge by 2px so they read as ONE
        // continuous lit surface — no hairline. Inactive tabs are
        // transparent over the dark strip = recessed in shadow.
        marginBottom: active ? -2 : 0,
        borderTopLeftRadius:  8,
        borderTopRightRadius: 8,
        borderBottomLeftRadius:  0,
        borderBottomRightRadius: 0,
        background:   active ? "var(--rv-surface)" : "transparent",
        color:        active ? "var(--rv-t1)" : "var(--rv-t3)",
        opacity:      isDragging ? 0.4 : 1,
        transform:    xOffset !== 0 ? `translateX(${xOffset}px)` : undefined,
        transition:   "background-color 120ms cubic-bezier(0.4, 0, 0.2, 1), color 120ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms, transform 220ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--rv-elev-2)"
          e.currentTarget.style.color      = "var(--rv-t1)"
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent"
          e.currentTarget.style.color      = "var(--rv-t3)"
        }
      }}
    >
      {/* Loading indicator — only when this URL is actually going to
          trigger analysis. Showing the green pulse on every page load
          (Google searches, news sites, anything) reads as "analysis
          starting" when nothing of the kind is happening. Quiet by
          default; light up only when there's something to wait for. */}
      {tab.loading && tab.isListing && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: "var(--rv-accent)", animation: "dotPulse 1.4s ease-in-out infinite" }}
        />
      )}
      <span
        className="text-[12px] truncate flex-1 leading-none"
        style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.005em" }}
      >
        {tab.title || (tab.url ? new URL(tab.url).hostname.replace(/^www\./, "") : "New tab")}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        title="Close tab (⌘W)"
        aria-label="Close tab"
        className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center rounded-[4px] transition-all shrink-0"
        style={{
          width:       16,
          height:      16,
          color:       "var(--rv-t4)",
          background:  "transparent",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)"; e.currentTarget.style.background = "var(--rv-elev-4)" }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t4)"; e.currentTarget.style.background = "transparent" }}
      >
        <X size={10} strokeWidth={1.8} />
      </button>
    </div>
  )
}
