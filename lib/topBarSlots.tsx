"use client"

// TopBarSlots — portal-target context for the persistent AppTopBar.
//
// Each route owns a piece of UI that should render INSIDE the
// AppTopBar's adaptive center (URL bar in Browse, stage chip + Compare
// in Pipeline, etc.). To keep that UI part of its route's React tree
// — so it has access to all the route's state without lifting — the
// AppTopBar exposes a DOM element per mode, and the route uses
// `createPortal` to render its content INTO that element.
//
// The result: the AppTopBar persists across route changes (never
// re-mounts), but each route still owns and manages its own slot
// content via React's normal component tree.

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"

interface SlotTargets {
  browse:     HTMLElement | null
  pipeline:   HTMLElement | null
  settings:   HTMLElement | null
  /** Browse-only secondary slot — sits ABOVE the AppTopBar in a
   *  separate row. Restores the Chrome-style "tabs above URL bar"
   *  ordering: TabStrip lives here, the URL toolbar lives in
   *  `browse` (the AppTopBar's adaptive center). The row collapses
   *  to 0 height when the slot is empty (non-browse routes). */
  browseTabs: HTMLElement | null
  /** Pinned-right contextual buttons for Browse — sits between the
   *  URL toolbar (center) and the global cluster (far right).
   *  Currently hosts the panel's Save / Stage / Open actions when a
   *  listing is loaded, so those buttons live in the top bar instead
   *  of consuming vertical space inside the analysis panel. */
  browseAux:  HTMLElement | null
  setBrowse:     (el: HTMLElement | null) => void
  setPipeline:   (el: HTMLElement | null) => void
  setSettings:   (el: HTMLElement | null) => void
  setBrowseTabs: (el: HTMLElement | null) => void
  setBrowseAux:  (el: HTMLElement | null) => void
}

const TopBarSlotsCtx = createContext<SlotTargets | null>(null)

export function TopBarSlotsProvider({ children }: { children: ReactNode }) {
  const [browse, setBrowse]         = useState<HTMLElement | null>(null)
  const [pipeline, setPipeline]     = useState<HTMLElement | null>(null)
  const [settings, setSettings]     = useState<HTMLElement | null>(null)
  const [browseTabs, setBrowseTabs] = useState<HTMLElement | null>(null)
  const [browseAux, setBrowseAux]   = useState<HTMLElement | null>(null)

  const setBrowseStable     = useCallback((el: HTMLElement | null) => setBrowse(el),     [])
  const setPipelineStable   = useCallback((el: HTMLElement | null) => setPipeline(el),   [])
  const setSettingsStable   = useCallback((el: HTMLElement | null) => setSettings(el),   [])
  const setBrowseTabsStable = useCallback((el: HTMLElement | null) => setBrowseTabs(el), [])
  const setBrowseAuxStable  = useCallback((el: HTMLElement | null) => setBrowseAux(el),  [])

  return (
    <TopBarSlotsCtx.Provider
      value={{
        browse, pipeline, settings, browseTabs, browseAux,
        setBrowse:     setBrowseStable,
        setPipeline:   setPipelineStable,
        setSettings:   setSettingsStable,
        setBrowseTabs: setBrowseTabsStable,
        setBrowseAux:  setBrowseAuxStable,
      }}
    >
      {children}
    </TopBarSlotsCtx.Provider>
  )
}

export function useTopBarSlots(): SlotTargets {
  const v = useContext(TopBarSlotsCtx)
  if (!v) throw new Error("useTopBarSlots must be used inside TopBarSlotsProvider")
  return v
}
