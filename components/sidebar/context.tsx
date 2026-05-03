"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"

// ── Width constants ────────────────────────────────────────────────────────
// Full mode: drag-resizable between MIN and MAX.
// Icons mode: fixed width clearing macOS traffic lights at x=14-72.
//   - 80 = traffic-lights right edge (74) + 6px breathing room.
// Snap thresholds for drag-release (where the cursor lands decides mode).
export const SIDEBAR_FULL_DEFAULT = 220
export const SIDEBAR_FULL_MIN     = 160
export const SIDEBAR_FULL_MAX     = 280
export const SIDEBAR_ICONS_W      = 80
export const SNAP_HIDE            = 36
export const SNAP_ICONS           = 120

const STORAGE_KEY = "rv-sidebar-v4"
type Persisted = { open: boolean; width: number }

interface SidebarCtx {
  open: boolean
  width: number
  toggle: () => void
  /**
   * Update the sidebar width. `live: true` = mid-drag (no persist, no
   * animation hint to browserView so it tracks the cursor 1:1). On drag
   * release, call with live:false to settle. `close: true` snaps closed.
   */
  setWidth: (w: number, opts?: { live?: boolean; close?: boolean }) => void
}

const SidebarContext = createContext<SidebarCtx>({
  open:    true,
  width:   SIDEBAR_FULL_DEFAULT,
  toggle:  () => {},
  setWidth: () => {},
})

export const useSidebar = () => useContext(SidebarContext)

/**
 * Push the layout to main so browserView's bounds track the sidebar.
 * We always pass animate: false now — animating bounds at 60fps for
 * 220ms triggers a Chromium re-layout PER tick, which on heavy pages
 * (Zillow, Redfin) takes 50-200ms each and queues up faster than they
 * complete, producing a visibly choppy chase. One snap = one reflow.
 *
 * Closes are deferred (see SLIDE_MS) because the sidebar's own CSS
 * width transition needs to play out before BrowserView reclaims the
 * left edge — otherwise the sidebar gets covered by BrowserView before
 * the user sees it slide closed.
 */
function pushLayout(sidebarWidth: number) {
  if (typeof window === "undefined") return
  const api = window.electronAPI
  if (!api?.setLayout) return
  api.setLayout({ sidebarWidth, animate: false })
}

/** Matches the sidebar's CSS width transition in components/sidebar/index.tsx
 *  ("width 220ms cubic-bezier(0.32, 0.72, 0, 1)"). Used to defer the
 *  BrowserView snap on close so the sidebar's slide stays visible. */
const SIDEBAR_SLIDE_MS = 220
function pushLayoutDeferred(sidebarWidth: number) {
  if (typeof window === "undefined") return
  setTimeout(() => pushLayout(sidebarWidth), SIDEBAR_SLIDE_MS)
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open,  setOpen]        = useState<boolean>(true)
  const [width, setWidthState]  = useState<number>(SIDEBAR_FULL_DEFAULT)
  /** Last user-chosen "open" width — what toggle() reopens to. */
  const toggleWidthRef = useRef<number>(SIDEBAR_FULL_DEFAULT)
  const hydratedRef    = useRef(false)

  // Hydrate from localStorage on mount.
  useEffect(() => {
    let initialOpen  = true
    let initialWidth = SIDEBAR_FULL_DEFAULT
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const p: Persisted = JSON.parse(raw)
        if (typeof p.open === "boolean") initialOpen = p.open
        if (typeof p.width === "number" && Number.isFinite(p.width)) {
          initialWidth = p.width < SNAP_ICONS
            ? SIDEBAR_ICONS_W
            : Math.max(SIDEBAR_FULL_MIN, Math.min(SIDEBAR_FULL_MAX, p.width))
        }
      }
    } catch { /* fresh state on parse failure */ }
    setOpen(initialOpen)
    setWidthState(initialWidth)
    toggleWidthRef.current = initialWidth
    hydratedRef.current = true
    pushLayout(initialOpen ? initialWidth : 0)
  }, [])

  // Persist whenever (open, width) settles.
  useEffect(() => {
    if (!hydratedRef.current) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ open, width } as Persisted))
    } catch { /* quota / private mode — fine */ }
  }, [open, width])

  const toggle = useCallback(() => {
    if (open) {
      // Close: sidebar narrows via CSS transition (220ms). Defer the
      // BrowserView snap until the sidebar has finished sliding —
      // otherwise BrowserView would cover the sidebar's React DOM
      // before the user gets to see it close.
      toggleWidthRef.current = width
      setOpen(false)
      pushLayoutDeferred(0)
    } else {
      // Open: snap BrowserView immediately to make room. The sidebar
      // then CSS-slides into the now-empty area. ONE page reflow at
      // t=0 instead of ~14 if we animated bounds in lockstep.
      const restored = toggleWidthRef.current
      setWidthState(restored)
      setOpen(true)
      pushLayout(restored)
    }
  }, [open, width])

  const setWidth = useCallback<SidebarCtx["setWidth"]>((w, opts) => {
    if (opts?.close) {
      toggleWidthRef.current = width
      setOpen(false)
      pushLayoutDeferred(0)
      return
    }
    setWidthState(w)
    if (opts?.live) {
      // Live drag: track 1:1 with the cursor, snap each tick.
      pushLayout(w)
    } else {
      // Settled — snap BrowserView to the new width.
      toggleWidthRef.current = w
      if (!open) setOpen(true)
      pushLayout(w)
    }
  }, [open, width])

  return (
    <SidebarContext.Provider value={{ open, width, toggle, setWidth }}>
      {children}
    </SidebarContext.Provider>
  )
}
