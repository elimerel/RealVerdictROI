"use client"

import {
  createContext, useCallback, useContext, useEffect, useState,
} from "react"

// ── Panel state context
//
// Lifts the right-side analysis panel's state out of /browse so the
// layout-level smart panel button (top-right, pinned) can subscribe
// regardless of which route the user is on.
//
// Two contexts on purpose: the *state* context changes on every panel
// transition (toggle, phase change) and is consumed by the toggle button
// via usePanelState; the *setter* context is memoized once and never
// changes, so useRegisterPanelState's effect can list it as a dep
// without retriggering on every state update. Combining the two into
// one context (and putting both in useMemo deps) creates an infinite
// loop — every set bumps the value, every value bump re-runs the
// effect that called set in the first place.

export type PanelPhase =
  | "empty"
  | "analyzing"
  | "ready"
  | "error"
  | "manual-entry"

export interface PanelState {
  /** Whether the right-side analysis panel is currently visible. */
  isOpen: boolean
  /** Current phase of the analysis pipeline. null when no listing is loaded
   *  — the toggle hides itself in this case. */
  phase: PanelPhase | null
  /** Toggle handler exposed by /browse. null when not on /browse. */
  toggle: (() => void) | null
}

const EMPTY: PanelState = { isOpen: false, phase: null, toggle: null }

const PanelStateContext  = createContext<PanelState>(EMPTY)
const PanelSetterContext = createContext<((patch: Partial<PanelState>) => void) | null>(null)

export function PanelStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PanelState>(EMPTY)
  // Stable setter — never re-creates, so consumers can list it in
  // useEffect deps without triggering re-runs.
  const set = useCallback((patch: Partial<PanelState>) => {
    setState((prev) => {
      // Skip the state update entirely when nothing actually changes —
      // the panel state updates dozens of times during analysis and we
      // don't want every consumer to re-render needlessly.
      const next = { ...prev, ...patch }
      if (next.isOpen === prev.isOpen
        && next.phase  === prev.phase
        && next.toggle === prev.toggle) return prev
      return next
    })
  }, [])
  return (
    <PanelSetterContext.Provider value={set}>
      <PanelStateContext.Provider value={state}>
        {children}
      </PanelStateContext.Provider>
    </PanelSetterContext.Provider>
  )
}

/** Read the panel state. Used by the smart toggle button at the layout
 *  level. Returns the EMPTY state if used outside the provider so a
 *  forgotten <PanelStateProvider> doesn't crash the app. */
export function usePanelState(): PanelState {
  return useContext(PanelStateContext)
}

/** Register the current panel state from /browse. Pushes the live
 *  values up into the context so the pinned button can render them.
 *  Resets to nulls on unmount so the button hides when the user
 *  navigates away from /browse. */
export function useRegisterPanelState(state: PanelState) {
  const set = useContext(PanelSetterContext)
  useEffect(() => {
    if (!set) return
    set(state)
    return () => { set(EMPTY) }
  }, [set, state.isOpen, state.phase, state.toggle])
}
