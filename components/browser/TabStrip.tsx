"use client"

// TabStrip — Chrome-style tab row that lives inside BrowseTabsRow,
// above the AppTopBar. Active tab merges DOWN into the AppTopBar
// (same surface tone, no separating border) using rounded
// outer-bottom corners on the strip-edge contour.
//
// Drag-to-reorder uses POINTER EVENTS (not HTML5 drag-and-drop) so
// the dragged tab is constrained to the strip — it can't be dragged
// off into the desktop like a draggable image. The dragged tab
// follows the cursor horizontally only; other tabs reflow live as
// the cursor crosses midpoints. Same choreography as Chrome.

import { useEffect, useRef, useState } from "react"
import { Plus, X } from "lucide-react"
import type { TabInfo } from "@/lib/electron"

interface TabStripProps {
  tabs:        TabInfo[]
  activeId:    string | null
  paddingLeft: number
  onActivate:  (id: string) => void
  onClose:     (id: string) => void
  onNew:       () => void
  onReorder?:  (orderedIds: string[]) => void
}

const TAB_WIDTH = 222   // 220 + 2px gap

// Pull a 16px favicon from Google's S2 service. Free, no API key, and
// already cached by Chromium so the request is near-instant after the
// first load. Returns null when the URL has no host (new tab).
function faviconUrlFor(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (!u.hostname) return null
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`
  } catch { return null }
}

export default function TabStrip({
  tabs, activeId, paddingLeft, onActivate, onClose, onNew, onReorder,
}: TabStripProps) {
  // Drag state lives in a ref (so listeners read the latest values
  // without re-binding) plus mirror state for rendering. The mirror
  // updates on each pointermove via setState — coalesced by React's
  // batching so it's smooth.
  const dragRef = useRef<{
    id:           string
    fromIndex:    number
    startClientX: number
    /** Bounding rect of the strip's inner row, captured at drag start
     *  so we can compute the cursor's position WITHIN it as the
     *  source of truth for "where would the dragged tab land?" */
    stripLeft:    number
    stripWidth:   number
    /** Live current index — recomputed on each pointermove so other
     *  tabs reflow as the user drags past their midpoints. */
    currentIndex: number
  } | null>(null)
  const stripInnerRef = useRef<HTMLDivElement>(null)

  const [draggingId,   setDraggingId]   = useState<string | null>(null)
  const [hoverIndex,   setHoverIndex]   = useState<number | null>(null)
  const [dragOffsetX,  setDragOffsetX]  = useState(0)

  if (tabs.length === 0) return null

  const beginDrag = (tabId: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (!stripInnerRef.current) return
    const fromIndex = tabs.findIndex((t) => t.id === tabId)
    if (fromIndex === -1) return
    const rect = stripInnerRef.current.getBoundingClientRect()
    dragRef.current = {
      id:           tabId,
      fromIndex,
      startClientX: e.clientX,
      stripLeft:    rect.left,
      stripWidth:   rect.width,
      currentIndex: fromIndex,
    }
    setDraggingId(tabId)
    setHoverIndex(fromIndex)
    setDragOffsetX(0)

    const onMove = (ev: PointerEvent) => {
      const s = dragRef.current
      if (!s) return
      // Horizontal cursor delta from where we started — that's the
      // visual offset of the dragged tab.
      const dx = ev.clientX - s.startClientX
      setDragOffsetX(dx)
      // Compute "where would this tab land if released now?" by
      // turning the cursor's position within the strip into an
      // index. Clamp to valid range.
      const cursorXInStrip = ev.clientX - s.stripLeft
      const rawIndex = Math.floor(cursorXInStrip / TAB_WIDTH)
      const newIndex = Math.max(0, Math.min(tabs.length - 1, rawIndex))
      if (newIndex !== s.currentIndex) {
        s.currentIndex = newIndex
        setHoverIndex(newIndex)
      }
    }
    const onUp = () => {
      const s = dragRef.current
      if (s && s.fromIndex !== s.currentIndex && onReorder) {
        const ids = tabs.map((t) => t.id)
        const [moved] = ids.splice(s.fromIndex, 1)
        ids.splice(s.currentIndex, 0, moved)
        onReorder(ids)
      }
      dragRef.current = null
      setDraggingId(null)
      setHoverIndex(null)
      setDragOffsetX(0)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup",   onUp)
      window.removeEventListener("pointercancel", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup",   onUp)
    window.addEventListener("pointercancel", onUp)
  }

  return (
    <div
      className="flex items-stretch shrink-0 select-none rv-tabstrip relative"
      style={{
        height:           36,
        paddingLeft,
        paddingRight:     8,
        WebkitAppRegion:  "drag",
        background:       "transparent",
        transition:       "padding-left 220ms cubic-bezier(0.32, 0.72, 0, 1)",
      } as React.CSSProperties}
    >
      <div
        ref={stripInnerRef}
        className="flex items-stretch gap-[2px] flex-1 min-w-0 overflow-x-auto rv-tabstrip-scroll"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {tabs.map((t, i) => {
          const dragging = draggingId === t.id
          // Live rearrangement: while dragging, OTHER tabs shift to
          // make space for the dragged tab's anticipated landing
          // position (hoverIndex). The dragged tab itself uses
          // dragOffsetX for cursor-tracking instead of an indexed
          // shift.
          let xOffset = 0
          if (draggingId && hoverIndex !== null && !dragging) {
            const fromIndex = dragRef.current?.fromIndex ?? -1
            // Dragging right (from < hover): tabs in (from..hover] shift LEFT
            if (fromIndex < hoverIndex && i > fromIndex && i <= hoverIndex) {
              xOffset = -TAB_WIDTH
            }
            // Dragging left (from > hover): tabs in [hover..from) shift RIGHT
            if (fromIndex > hoverIndex && i >= hoverIndex && i < fromIndex) {
              xOffset = TAB_WIDTH
            }
          }
          return (
            <TabItem
              key={t.id}
              tab={t}
              active={t.id === activeId}
              isDragging={dragging}
              xOffset={dragging ? dragOffsetX : xOffset}
              onActivate={() => onActivate(t.id)}
              onClose={() => onClose(t.id)}
              onPointerDown={(e) => beginDrag(t.id, e)}
            />
          )
        })}
        <button
          onClick={onNew}
          title="New tab (⌘T)"
          aria-label="New tab"
          className="self-center inline-flex items-center justify-center rounded-full"
          style={{
            width:       28,
            height:      28,
            marginLeft:  6,
            color:       "var(--rv-t3)",
            background:  "transparent",
            transition:  "color 100ms cubic-bezier(0.4, 0, 0.2, 1), background-color 100ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color      = "var(--rv-t1)"
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color      = "var(--rv-t3)"
            e.currentTarget.style.background = "transparent"
          }}
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

function TabItem({
  tab, active, isDragging, xOffset,
  onActivate, onClose, onPointerDown,
}: {
  tab:        TabInfo
  active:     boolean
  isDragging: boolean
  xOffset:    number
  onActivate: () => void
  onClose:    () => void
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
}) {
  // Track whether this is a click vs drag. Threshold of 3px before
  // we consider it a drag — avoids stealing clicks. The Chrome
  // pattern: pointer-down on a tab activates it; if you start moving
  // BEFORE releasing, that's a drag.
  const downRef = useRef<{ startX: number; activated: boolean } | null>(null)

  return (
    <div
      onPointerDown={(e) => {
        // Left-button only.
        if (e.button !== 0) return
        downRef.current = { startX: e.clientX, activated: false }
        // Activate the tab immediately on press (Chrome behavior).
        if (!active) {
          onActivate()
          downRef.current.activated = true
        }
      }}
      onPointerMove={(e) => {
        const d = downRef.current
        if (!d) return
        if (Math.abs(e.clientX - d.startX) > 3) {
          // Movement past threshold — promote to a drag.
          downRef.current = null
          onPointerDown(e)
        }
      }}
      onPointerUp={() => { downRef.current = null }}
      className="group relative flex items-center gap-2 cursor-default select-none"
      style={{
        width:        220,
        minWidth:     220,
        height:       "100%",
        padding:      "0 12px",
        // The 2px overlap onto AppTopBar below so the active tab
        // visually merges into the URL bar with no hairline. Same
        // Chrome trick — active tab's bottom edge is BEHIND the
        // toolbar's top edge.
        marginBottom: active ? -2 : 0,
        // Chrome-style outer bottom corners only — top corners are
        // rounded, bottom corners are square so the active tab's
        // bottom merges flush into AppTopBar. Keeps the "tab is
        // part of the toolbar" reading.
        // 4px top corners (Wexond / classic-Chrome). Subtle rounding
        // reads as utilitarian; the bigger 13px curve reads softer
        // and more "consumer browser." This aesthetic favors tool.
        borderTopLeftRadius:     4,
        borderTopRightRadius:    4,
        borderBottomLeftRadius:  0,
        borderBottomRightRadius: 0,
        // Inactive tabs are FLAT against the band — no chip fill, no
        // outline. Just dimmer text. The active tab is the only one
        // that lifts (matches the URL bar surface beneath) and curves
        // into the AppTopBar via a 2px overlap. This is the Chrome
        // pattern: one selected card, the rest are labels on a band.
        background:   active ? "var(--rv-surface)" : "transparent",
        color:        active ? "var(--rv-t1)" : "var(--rv-t3)",
        opacity:      isDragging ? 0.85 : 1,
        transform:    xOffset !== 0 ? `translateX(${xOffset}px)` : undefined,
        boxShadow:    "none",
        transition:   isDragging
          ? "background-color 120ms cubic-bezier(0.4, 0, 0.2, 1), color 120ms cubic-bezier(0.4, 0, 0.2, 1)"
          : "background-color 120ms cubic-bezier(0.4, 0, 0.2, 1), color 120ms cubic-bezier(0.4, 0, 0.2, 1), transform 220ms cubic-bezier(0.32, 0.72, 0, 1)",
        zIndex:       isDragging ? 5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)"
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
      {/* Chrome-style hairline separator on the right edge of every
          inactive tab — fades out on hover. Centered ~50% height. */}
      {!active && (
        <span
          aria-hidden
          className="absolute pointer-events-none rv-tab-divider"
          style={{
            right:      0,
            top:        "25%",
            height:     "50%",
            width:      1,
            background: "rgba(255, 255, 255, 0.08)",
          }}
        />
      )}
      {/* Site favicon — pulled from Google's free S2 service so we
          don't need to extract one ourselves per page. Falls back to
          a generic globe glyph when the URL is empty (new tab) or
          while loading replaces it with a pulsing accent dot. */}
      <span
        aria-hidden
        className="shrink-0 inline-flex items-center justify-center"
        style={{ width: 16, height: 16 }}
      >
        {tab.loading ? (
          <span
            className="rounded-full"
            style={{
              width: 8, height: 8,
              background: "var(--rv-accent)",
              animation: "dotPulse 1.4s ease-in-out infinite",
            }}
          />
        ) : faviconUrlFor(tab.url) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={faviconUrlFor(tab.url) ?? undefined}
            alt=""
            width={16}
            height={16}
            style={{ width: 16, height: 16, borderRadius: 3 }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden" }}
          />
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" opacity="0.4"/>
          </svg>
        )}
      </span>
      <span className="flex-1 min-w-0 truncate text-[12.5px] tracking-tight">
        {tab.title || tab.url || "New tab"}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        onPointerDown={(e) => { e.stopPropagation() }}
        title="Close (⌘W)"
        aria-label="Close tab"
        className="shrink-0 inline-flex items-center justify-center rounded-[5px] opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          width:  18,
          height: 18,
          color:  "var(--rv-t3)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)"; e.currentTarget.style.background = "var(--rv-elev-4)" }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t3)"; e.currentTarget.style.background = "transparent" }}
      >
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  )
}
