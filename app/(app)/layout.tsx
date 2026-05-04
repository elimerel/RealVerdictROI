"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import Sidebar from "@/components/sidebar"
import { SidebarProvider, useSidebar } from "@/components/sidebar/context"
import SidebarToggle from "@/components/sidebar/toggle"
import { PanelStateProvider } from "@/components/panel/context"
// PanelToggle is no longer mounted at app-layout level — it lives inline
// inside the Toolbar now, so it sits naturally in the chrome.
import CommandPalette from "@/components/command-palette"
import ToastHost from "@/components/ToastHost"
import MapShell from "@/components/MapShell"
import { MapShellProvider, useMapShell } from "@/lib/mapShell"
import { fetchPipeline, DEALS_CHANGED_EVENT } from "@/lib/pipeline"

/**
 * Wires menu-accelerator IPC events from main.js into the React tree:
 *   shortcut:navigate       — route push to a top-level page
 *   shortcut:toggle-sidebar — toggle the left rail
 * Other shortcut events (save, reanalyze, open-palette) are handled by
 * the components that own that state.
 */
function ShortcutHost() {
  const router = useRouter()
  const { toggle } = useSidebar()
  useEffect(() => {
    const off = window.__rvOnShortcut?.((kind, arg) => {
      if (kind === "navigate" && typeof arg === "string") router.push(arg)
      else if (kind === "toggle-sidebar") toggle()
    })
    return () => { off?.() }
  }, [router, toggle])
  return null
}

/** Live theme hydrator. Listens for theme:changed broadcasts from main
 *  (sent on user picks, system-theme flips when in System mode, and on
 *  startup) and updates the <html> class set so the token overrides
 *  apply across the whole app. The pre-paint THEME_SCRIPT in
 *  app/layout.tsx handles the FIRST frame; this handles every change
 *  after that. */
function ThemeHydrator() {
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined
    if (!api?.onThemeChanged) return
    // On mount, ask main for the persisted theme — covers the case where
    // the user changed the theme in another window or on a previous run.
    api.getTheme?.().then((t) => { if (t) applyThemeClass(t.resolved, t.picked) }).catch(() => {})
    const off = api.onThemeChanged(({ picked, resolved }) => {
      applyThemeClass(resolved, picked)
    })
    return () => { off?.() }
  }, [])
  return null
}

/** RouteFader — soft cross-fade + tiny Y-translate when the user
 *  navigates between top-level surfaces (Browse / Pipeline / Settings).
 *  Keyed on pathname so each surface gets its own mount cycle, with the
 *  CSS animation re-running on every key change. The motion is short
 *  (180ms) and small (4px) — present enough that surface swaps feel
 *  intentional, quiet enough that it never feels like the app is
 *  showing off. Same easing as the rest of the chrome. */
function RouteFader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div
      key={pathname}
      className="flex flex-col flex-1 min-h-0 rv-route-fade"
      // pointer-events:none so any transparent gap inside a route's
      // tree (e.g., Pipeline's exposed map middle) lets drags fall
      // through to the persistent MapShell behind. Opaque surfaces
      // inside each route opt back in with pointer-events:auto.
      style={{ pointerEvents: "none" }}
    >
      {children}
    </div>
  )
}

/** Mirror the THEME_SCRIPT logic at runtime. Called on every
 *  theme:changed broadcast. Writes to localStorage as the pre-paint
 *  hint for the next mount. */
function applyThemeClass(resolved: string, picked?: string) {
  const cls = document.documentElement.classList
  cls.remove("theme-charcoal-warm", "theme-charcoal-cinema", "theme-light")
  if (resolved === "charcoal-warm") cls.add("theme-charcoal-warm")
  if (resolved === "light")         cls.add("theme-light")
  if (resolved === "light") cls.remove("dark"); else cls.add("dark")
  if (picked) {
    try { localStorage.setItem("rv-theme", picked) } catch { /* private mode */ }
  }
}

/** DealsHydrator — fetches the user's saved deals once and pushes them
 *  into the MapShell context. Lives at app-shell scope so the deal list
 *  is the same source-of-truth across every route. Browse and Pipeline
 *  read from it instead of fetching independently. */
function DealsHydrator() {
  const { setDeals } = useMapShell()
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void fetchPipeline().then((d) => { if (!cancelled) setDeals(d) }).catch(() => {})
    }
    refresh()
    // Re-fetch whenever any route mutates the pipeline (save, stage move,
    // delete) so the persistent map stays in sync without props.
    window.addEventListener(DEALS_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(DEALS_CHANGED_EVENT, refresh)
    }
  }, [setDeals])
  return null
}

/** GoogleMapsPrefetch — warms Google's Maps Embed JS bundle once at
 *  app boot via a tiny hidden iframe. Subsequent property-view embeds
 *  in the panel reuse the cached bundle, so they paint in <500ms
 *  instead of the cold-start ~2s. The prefetch URL points to a
 *  geographic null island (0,0) and is invisible (1×1 px, opacity 0)
 *  — purely a cache primer. Skipped entirely when no Google key is
 *  set or when the cache has already been warmed this session. */
function GoogleMapsPrefetch() {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
  const [warmed, setWarmed] = useState(false)
  useEffect(() => {
    if (!key) return
    // Use sessionStorage so we don't refetch on every route change /
    // remount within the same window.
    try {
      if (sessionStorage.getItem("rv-gmaps-warmed") === "1") {
        setWarmed(true)
        return
      }
      // Fire after a short idle so the prefetch never competes with
      // first-paint of the actual UI.
      const t = setTimeout(() => {
        sessionStorage.setItem("rv-gmaps-warmed", "1")
        setWarmed(true)
      }, 1500)
      return () => clearTimeout(t)
    } catch { /* sessionStorage unavailable */ }
  }, [key])
  if (!key || !warmed) return null
  return (
    <iframe
      aria-hidden
      tabIndex={-1}
      title=""
      src={`https://www.google.com/maps/embed/v1/place?key=${key}&q=0,0&maptype=satellite&zoom=2`}
      style={{
        position:      "fixed",
        top:           0,
        left:          0,
        width:         1,
        height:        1,
        opacity:       0,
        pointerEvents: "none",
        border:        0,
      }}
    />
  )
}

/** MapShellLayer — the persistent map + the scrim that controls how
 *  much of it is visible per route. Sits BEHIND the routed content
 *  inside <main>. */
function MapShellLayer() {
  const { scrimOpacity } = useMapShell()
  return (
    <>
      {/* The map itself, full-coverage of the main content area. */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <MapShell />
      </div>
      {/* Scrim — a layer of canvas-color that fades the map down per
          route. Browse keeps it nearly opaque (faint hint); Pipeline
          drops it to 0 (map is the canvas). Pointer-events:none so
          clicks pass through to the map. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          zIndex:     1,
          background: "var(--rv-bg)",
          opacity:    scrimOpacity,
          transition: "opacity 320ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      />
    </>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <PanelStateProvider>
        <MapShellProvider>
          <ShortcutHost />
          <ThemeHydrator />
          <DealsHydrator />
          <div
            className="flex w-screen h-screen overflow-hidden"
            style={{ background: "var(--rv-bg)" }}
          >
            <Sidebar />
            <main className="flex flex-col flex-1 min-w-0 h-full relative">
              {/* Persistent map + scrim sit behind the routed content,
                  so navigating between Browse and Pipeline never
                  re-mounts the map. The route content sits at z-index
                  2 with transparent regions where it wants the map to
                  show through. */}
              <MapShellLayer />
              <div
                className="relative flex flex-col flex-1 min-h-0"
                style={{ zIndex: 2, pointerEvents: "none" }}
              >
                <RouteFader>{children}</RouteFader>
              </div>
            </main>
          </div>
          <SidebarToggle />
          <CommandPalette />
          {/* Buddy toast surface — bottom-right. The buddy's voice in
              the moment (saved, stage moved, price drop, etc.). */}
          <ToastHost />
          {/* Warm Google Maps Embed bundle so the first PropertyView
              iframe in the panel paints fast instead of cold-loading
              ~2 seconds of Google JS. */}
          <GoogleMapsPrefetch />
        </MapShellProvider>
      </PanelStateProvider>
    </SidebarProvider>
  )
}
