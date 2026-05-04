"use client"

// MapShell context — the source-of-truth for the persistent map layer.
//
// Why this exists: Browse and Pipeline both want a map of the user's
// saved deals. Rendering a separate Mapbox instance on each route meant
// two geocodes, two style loads, two fit-bounds passes, and a visible
// re-mount when navigating between them. The user noticed the seam.
//
// The fix: ONE Mapbox instance lives at the app-shell level (mounted
// inside AppLayout, behind the routed content). Routes communicate
// with it through this context — they push the deal list, set scrim
// opacity (how much to obscure the map), tell it which deals to show
// as pins, and subscribe to pin clicks. The map itself never remounts.
//
// The result: clicking a pin in Browse triggers a flyTo on the SAME
// map you'll see in Pipeline. The route changes, the panels slide in,
// and the camera glides to the right viewport — one motion across what
// used to feel like two pages.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { SavedDeal } from "@/lib/pipeline"

export interface CameraTarget {
  lng:   number
  lat:   number
  /** Optional zoom override. Omitted = current zoom held. */
  zoom?: number
  /** Animation duration in ms. Omitted = use shell default. */
  duration?: number
}

interface MapShellApi {
  /** Full deal list — the universe of pins the map could show. */
  deals: SavedDeal[]
  /** Subset of deal IDs that should render as pins. NULL = show all
   *  deals (Browse default). Pipeline narrows this to the current
   *  stage filter. */
  visibleDealIds: Set<string> | null
  /** Active selection — drives the marker's selected style. */
  selectedId: string | null
  /** Scrim opacity over the map, 0 (map fully visible) → 1 (map fully
   *  hidden behind canvas). Browse uses ~0.93 to render the map as a
   *  faint ambient hint; Pipeline uses 0 to make it the canvas. */
  scrimOpacity: number
  /** Camera target — when set, the shell flies to it. Setting again
   *  (even with same coords) re-fires the flyTo, so route pages can
   *  trigger a refit by writing a fresh value. */
  cameraTarget: CameraTarget | null

  setDeals:           (d: SavedDeal[]) => void
  setVisibleDealIds:  (ids: Set<string> | null) => void
  setSelectedId:      (id: string | null) => void
  setScrimOpacity:    (n: number) => void
  flyTo:              (t: CameraTarget) => void

  /** Subscribe to pin clicks. Returns an unsubscribe function. The
   *  shell calls these when a pin is clicked AFTER updating selectedId,
   *  so subscribers can react (e.g., navigate to /pipeline?id=…). */
  onPinClick: (cb: (id: string) => void) => () => void
  /** Internal — used by MapShell to broadcast a pin click to subscribers. */
  _broadcastPinClick: (id: string) => void

  /** Whether the shell is mounted (used by routes that want to render
   *  a fallback if the shell isn't available — e.g., during route
   *  transitions before context is ready). */
  ready: boolean
  setReady: (b: boolean) => void
}

const MapShellCtx = createContext<MapShellApi | null>(null)

export function MapShellProvider({ children }: { children: ReactNode }) {
  const [deals, setDeals]                   = useState<SavedDeal[]>([])
  const [visibleDealIds, setVisibleDealIds] = useState<Set<string> | null>(null)
  const [selectedId, setSelectedId]         = useState<string | null>(null)
  // Default 0.94: routes that don't opt in get the map nearly fully
  // hidden, so first paint never accidentally exposes the canvas.
  const [scrimOpacity, setScrimOpacity]     = useState<number>(0.94)
  const [cameraTarget, setCameraTarget]     = useState<CameraTarget | null>(null)
  const [ready, setReady]                   = useState<boolean>(false)

  // Pin-click subscribers stored in a ref so the broadcast callback
  // doesn't change identity between renders.
  const listenersRef = useRef<Set<(id: string) => void>>(new Set())

  const onPinClick = useCallback((cb: (id: string) => void) => {
    listenersRef.current.add(cb)
    return () => { listenersRef.current.delete(cb) }
  }, [])

  const _broadcastPinClick = useCallback((id: string) => {
    listenersRef.current.forEach((cb) => cb(id))
  }, [])

  const flyTo = useCallback((t: CameraTarget) => {
    // Always create a new object reference so React triggers an effect
    // even if coords are the same as last time (e.g., refit request).
    setCameraTarget({ ...t })
  }, [])

  const value = useMemo<MapShellApi>(() => ({
    deals, visibleDealIds, selectedId, scrimOpacity, cameraTarget,
    setDeals, setVisibleDealIds, setSelectedId, setScrimOpacity,
    flyTo, onPinClick, _broadcastPinClick,
    ready, setReady,
  }), [
    deals, visibleDealIds, selectedId, scrimOpacity, cameraTarget,
    flyTo, onPinClick, _broadcastPinClick, ready,
  ])

  return <MapShellCtx.Provider value={value}>{children}</MapShellCtx.Provider>
}

export function useMapShell(): MapShellApi {
  const v = useContext(MapShellCtx)
  if (!v) throw new Error("useMapShell must be used inside MapShellProvider")
  return v
}

