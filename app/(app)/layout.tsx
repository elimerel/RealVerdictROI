"use client"

import { memo, useEffect, useState } from "react"
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
import AppTopBar from "@/components/AppTopBar"
import BrowseTabsRow from "@/components/BrowseTabsRow"
import BookmarksBar from "@/components/BookmarksBar"
import PanelToggle from "@/components/browser/PanelToggle"
import { TopBarSlotsProvider } from "@/lib/topBarSlots"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { BrowsePage as BrowsePageRaw } from "./browse/page"
import { PipelinePage as PipelinePageRaw } from "./pipeline/page"
import { SettingsPage as SettingsPageRaw } from "./settings/page"

// Memoize the three always-mounted pages so AlwaysMountedRoutes'
// pathname re-render doesn't cascade into a full re-render of all
// three large trees on every nav click. Without this, switching
// sections walks ~6,000 lines of React component each time. None of
// the pages take props, so memo's default shallow compare is enough.
const BrowsePage   = memo(BrowsePageRaw)
const PipelinePage = memo(PipelinePageRaw)
const SettingsPage = memo(SettingsPageRaw)

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
/** AlwaysMountedRoutes — keep all three top-level surfaces alive at
 *  layout level and toggle visibility via CSS based on pathname.
 *  Switching between Browse and Pipeline no longer remounts; tabs,
 *  scroll, panel state, list selection all survive. The {children}
 *  Next.js renders for the matched route is a stub returning null. */
function AlwaysMountedRoutes() {
  const pathname = usePathname()
  const route =
    pathname.startsWith("/pipeline") ? "pipeline"
    : pathname.startsWith("/settings") ? "settings"
    : "browse"
  // Stamp a data attribute on <body> so route-dependent chrome (the
  // sidebar's top strip color) can adapt via CSS.
  useEffect(() => {
    if (typeof document === "undefined") return
    document.body.dataset.rvRoute = route
  }, [route])
  const layerStyle = (active: boolean): React.CSSProperties => ({
    position:      "absolute",
    inset:         0,
    display:       "flex",
    flexDirection: "column",
    minHeight:     0,
    visibility:    active ? "visible" : "hidden",
    pointerEvents: active ? "auto"    : "none",
  })
  return (
    <div
      className="relative flex flex-col flex-1 min-h-0"
      style={{ pointerEvents: "none" }}
    >
      <div style={layerStyle(route === "browse")}><BrowsePage /></div>
      <div style={layerStyle(route === "pipeline")}><PipelinePage /></div>
      <div style={layerStyle(route === "settings")}><SettingsPage /></div>
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

/** MapShellLayer — the persistent map. Position-FIXED to the viewport
 *  so its size is constant across route changes (Mapbox doesn't get
 *  resize events when chrome animates above).
 *
 *  No scrim layer anymore. The previous design used a route-controlled
 *  opacity overlay (0 in Pipeline, ~0.86 in Browse) to fade the map
 *  down where it shouldn't dominate. That opacity transition was
 *  flickering on every route change — too many animations
 *  competing. Replaced by structural opacity: routes that don't want
 *  the map (Browse, Settings) just render opaque content over it.
 *  Pipeline keeps its transparent middle column so the map remains
 *  the canvas there. Simpler, no transition glitches.
 */
function MapShellLayer() {
  const { open: sbOpen, width: sbWidth } = useSidebar()
  const left = sbOpen ? sbWidth : 0
  return (
    <div
      style={{
        // 42 — matches the AppTopBar height. Map sits behind the
        // toolbar; routes that don't show tab strip / bookmarks
        // bar (Pipeline / Settings) reveal the map starting at the
        // bottom edge of the toolbar.
        position: "fixed",
        top:      42,
        left,
        right:    0,
        bottom:   0,
        zIndex:   0,
        transition: "left 220ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      <MapShell />
    </div>
  )
}

/** TopBarGlobalCluster — pinned to the FAR right of the AppTopBar.
 *  Houses persistent controls. The Chrome reference for this region
 *  is profile/extensions/menu — a small rhythm of round icon
 *  buttons that anchors the right side of the chrome. We keep ours
 *  sparse but real: PanelToggle on Browse (the analysis surface) +
 *  a profile avatar that links to Settings on every route. No
 *  decorative-only icons. */
function TopBarGlobalCluster() {
  const pathname = usePathname()
  const inBrowse = pathname.startsWith("/browse")
  return (
    <>
      {inBrowse && <PanelToggle />}
      <ProfileAvatar />
    </>
  )
}

/** Round 28px button at the far right of the AppTopBar — visual
 *  weight + a quick path to Settings (the Chrome equivalent of the
 *  profile circle that opens account / sync). Reads the signed-in
 *  email and uses the first letter as the initial; falls back to a
 *  generic glyph if Supabase isn't configured. */
function ProfileAvatar() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    import("@/lib/supabase/client").then(({ createClient }) => {
      createClient().auth.getUser().then(({ data }) => {
        if (!cancelled) setEmail(data.user?.email ?? null)
      })
    }).catch(() => { /* unconfigured — leave null */ })
    return () => { cancelled = true }
  }, [])
  const initial = email ? (email[0] ?? "?").toUpperCase() : null
  // shadcn Avatar inside a button so it's clickable + reads as the
  // canonical "profile chip" from the design system. Same primitive
  // the sidebar's AccountRow uses, so the two profile surfaces feel
  // unified.
  return (
    <button
      onClick={() => router.push("/settings")}
      title={email ?? "Settings"}
      aria-label="Account & settings"
      className="shrink-0 transition-opacity hover:opacity-90"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <Avatar className="size-7">
        <AvatarFallback
          className="text-[11px] font-semibold"
          style={{ background: "var(--rv-accent)", color: "white" }}
        >
          {initial ?? "?"}
        </AvatarFallback>
      </Avatar>
    </button>
  )
}

/** Brand removed from AppTopBar — moved into the sidebar at the top
 *  of nav so the wordmark is column-aligned with the nav items
 *  below it. The AppTopBar's left zone is now just a drag region
 *  for the macOS traffic lights. */

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <PanelStateProvider>
        <MapShellProvider>
          <TopBarSlotsProvider>
            <ShortcutHost />
            <ThemeHydrator />
            <DealsHydrator />
            <div
              className="flex flex-col w-screen h-screen overflow-hidden"
              style={{ background: "var(--rv-bg)" }}
            >
              {/* BrowseTabsRow — Chrome-style tabs row that sits
                  ABOVE the AppTopBar. Collapses to 0 height on non-
                  Browse routes. Browse portals its TabStrip into
                  this row's slot; the URL toolbar stays in the
                  AppTopBar below, restoring the "tabs above URL"
                  ordering Chrome users expect. */}
              <BrowseTabsRow />
              {/* AppTopBar — persistent global chrome bar mounted ONCE
                  at the shell level. Each route portals its mode-
                  specific UI INTO this bar via the TopBarSlots
                  provider; the bar itself never re-mounts on route
                  change. */}
              <AppTopBar
                globalCluster={<TopBarGlobalCluster />}
              />
              {/* BookmarksBar — Chrome's third chrome row. Sits
                  directly below the URL toolbar; collapses to 0
                  height on non-Browse routes. */}
              <BookmarksBar />
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <Sidebar />
                <main className="flex flex-col flex-1 min-w-0 h-full relative">
                  {/* Persistent map + scrim sit behind the routed content,
                      so navigating between Browse and Pipeline never
                      re-mounts the map. */}
                  <MapShellLayer />
                  <div
                    className="relative flex flex-col flex-1 min-h-0"
                    style={{ zIndex: 2, pointerEvents: "none" }}
                  >
                    <AlwaysMountedRoutes />
                    {/* Next.js still renders the matched route's
                        default export here (each is a stub returning
                        null). Keeps routing/URL behavior intact while
                        the actual content lives in AlwaysMountedRoutes
                        above. */}
                    <div style={{ display: "none" }}>{children}</div>
                  </div>
                </main>
              </div>
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
          </TopBarSlotsProvider>
        </MapShellProvider>
      </PanelStateProvider>
    </SidebarProvider>
  )
}
