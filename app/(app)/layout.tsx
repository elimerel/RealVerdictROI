"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarProvider, useSidebar, SidebarInset } from "@/components/ui/sidebar"
import SidebarToggle from "@/components/sidebar/toggle"
import { PanelStateProvider } from "@/components/panel/context"
// PanelToggle is no longer mounted at app-layout level — it lives inline
// inside the Toolbar now, so it sits naturally in the chrome.
import CommandPalette from "@/components/command-palette"
import ToastHost from "@/components/ToastHost"
import { MapShellProvider, useMapShell } from "@/lib/mapShell"
import { fetchPipeline, DEALS_CHANGED_EVENT } from "@/lib/pipeline"
import AppTopBar from "@/components/AppTopBar"
// BrowseTabsRow + BookmarksBar removed from the persistent shell.
// Top chrome is now one row on every route — Pipeline / Settings /
// Browse are visually identical at the top edge.
// BookmarksBar removed — the persistent row was duplicative with the
// site shortcuts already on the Browse start screen. Removing it
// reduces top chrome by one row, makes Browse closer to the same
// height as Pipeline / Settings, and gives the user one less band of
// visual chrome above the actual content.
import PanelToggle from "@/components/browser/PanelToggle"
import { TopBarSlotsProvider } from "@/lib/topBarSlots"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { BrowsePage as BrowsePageRaw } from "./browse/page"
import { PipelinePage as PipelinePageRaw } from "./pipeline/page"
import { SettingsPage as SettingsPageRaw } from "./settings/page"
import { DealWorkspace } from "./pipeline/[id]/page"

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
  // shadcn's useSidebar exposes toggleSidebar (not toggle). Same job:
  // collapses/expands the rail in response to a menu accelerator.
  const { toggleSidebar } = useSidebar()
  useEffect(() => {
    const off = window.__rvOnShortcut?.((kind, arg) => {
      if (kind === "navigate" && typeof arg === "string") router.push(arg)
      else if (kind === "toggle-sidebar") toggleSidebar()
    })
    return () => { off?.() }
  }, [router, toggleSidebar])
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
  // Detect the per-deal workspace (/pipeline/<uuid>) — a 4th layer that
  // sits above the Pipeline index. When active, the index hides and
  // the workspace component renders with the deal id parsed from the
  // path. Pipeline (the index) takes any /pipeline route that isn't
  // /pipeline/<id>; the workspace takes /pipeline/<id>.
  const dealWorkspaceMatch = pathname.match(/^\/pipeline\/([^/]+)$/)
  const dealId = dealWorkspaceMatch ? dealWorkspaceMatch[1] : null
  const route =
    dealId                          ? "deal"
    : pathname.startsWith("/pipeline") ? "pipeline"
    : pathname.startsWith("/settings") ? "settings"
    : "browse"
  // Stamp a data attribute on <body> so route-dependent chrome (the
  // sidebar's top strip color) can adapt via CSS.
  useEffect(() => {
    if (typeof document === "undefined") return
    // Per-deal workspace counts as the pipeline section for chrome
    // purposes (sidebar nav still highlights Pipeline).
    document.body.dataset.rvRoute = route === "deal" ? "pipeline" : route
  }, [route])
  // Memoize the four layer styles so a route flip only mutates the
  // affected entries. Without this React sees fresh style objects on
  // every pathname change and reapplies inline styles to all layers.
  const browseStyle   = useMemo(() => layerStyleFor(route === "browse"),   [route])
  const pipelineStyle = useMemo(() => layerStyleFor(route === "pipeline"), [route])
  const settingsStyle = useMemo(() => layerStyleFor(route === "settings"), [route])
  const dealStyle     = useMemo(() => layerStyleFor(route === "deal"),     [route])
  return (
    <div
      className="relative flex flex-col flex-1 min-h-0"
      style={SHELL_STYLE}
    >
      <div style={browseStyle}><BrowsePage /></div>
      <div style={pipelineStyle}><PipelinePage /></div>
      <div style={settingsStyle}><SettingsPage /></div>
      <div style={dealStyle}><DealWorkspace dealId={dealId} /></div>
    </div>
  )
}

// Hoisted out of AlwaysMountedRoutes so the object is stable across
// every render, not re-created. Tiny fix individually; in aggregate
// these matter when the parent re-renders on every pathname change.
const SHELL_STYLE: React.CSSProperties = { pointerEvents: "none" }
const LAYER_BASE: React.CSSProperties = {
  position:      "absolute",
  inset:         0,
  display:       "flex",
  flexDirection: "column",
  minHeight:     0,
  // 160ms opacity crossfade on route change. Apple-spring curve
  // (cubic-bezier(0.32,0.72,0,1)) so the fade SETTLES, not snaps.
  // Inactive layers are fully transparent (visibility:hidden cuts
  // hit-testing); active is opaque. Without this, route changes
  // hard-flickered between always-mounted layers.
  transition:    "opacity 160ms cubic-bezier(0.32, 0.72, 0, 1)",
}
// LAYER_VISIBLE used to set pointerEvents:"auto" — but that meant the
// layer wrapper caught clicks even when an inner descendant set pe:none
// (Pipeline's Map view tried to let drags fall through to MapShell).
// Now: pe:none on the layer too. Each route's outer wrapper sets pe:auto
// itself; Pipeline can additionally toggle to pe:none in Map view to
// punch through to the persistent map.
const LAYER_VISIBLE: React.CSSProperties = { ...LAYER_BASE, visibility: "visible", pointerEvents: "none", opacity: 1 }
const LAYER_HIDDEN:  React.CSSProperties = { ...LAYER_BASE, visibility: "hidden",  pointerEvents: "none", opacity: 0 }
function layerStyleFor(active: boolean) {
  return active ? LAYER_VISIBLE : LAYER_HIDDEN
}

/** Mirror the THEME_SCRIPT logic at runtime. Called on every
 *  theme:changed broadcast. Writes to localStorage as the pre-paint
 *  hint for the next mount. */
function applyThemeClass(resolved: string, picked?: string) {
  const cls = document.documentElement.classList
  cls.remove("theme-charcoal-warm", "theme-charcoal-cinema", "theme-light", "theme-paper", "theme-paper-dark")
  if (resolved === "paper")      cls.add("theme-paper")
  if (resolved === "paper-dark") cls.add("theme-paper-dark")
  // .dark covers any remaining `dark:` Tailwind variants.
  if (resolved === "paper-dark") cls.add("dark"); else cls.remove("dark")
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

/** MapShellLayer — REMOVED from the persistent shell.
 *
 *  Originally Mapbox lived here (mounted always, fixed-position) so
 *  Browse could show it as an ambient backdrop AND Pipeline could
 *  use it as the canvas for the deal list's map view, sharing the
 *  same instance for free continuity between the two routes.
 *
 *  After the CRM rebuild, Browse no longer shows the map at all and
 *  Pipeline only shows it when viewMode === "map". Keeping a Mapbox
 *  GL instance + tile requests + ResizeObserver running constantly
 *  for a surface that's invisible 95% of the time was wasteful —
 *  ~30-40MB and constant GPU work for nothing.
 *
 *  MapShell now mounts INSIDE the Pipeline page, conditional on Map
 *  view. The MapShellProvider context (deals, selectedId, etc.)
 *  stays at app-shell level so other components can publish to it
 *  without depending on Map-view being open. */

/** TopBarGlobalCluster — pinned to the FAR right of the AppTopBar.
 *  Houses persistent controls. ProfileAvatar removed: NavUser in the
 *  sidebar footer (bottom-left) is the canonical user surface, having
 *  it in two places was redundant chrome. PanelToggle stays for
 *  Browse only. */
function TopBarGlobalCluster() {
  const pathname = usePathname()
  const inBrowse = pathname.startsWith("/browse")
  return (
    <>
      {inBrowse && <PanelToggle />}
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
            {/* Shell architecture:
                  Row 1 (top): full-width URL bar / page title — always
                  42px tall, consistent across every route. Macros
                  traffic lights live naturally in its top-left.
                  Row 2 (rest): sidebar (full height of remaining space)
                  + right column (route-specific chrome above content).

                The "different per route" problem the previous design
                had is solved by keeping the URL bar height fixed and
                pushing route-specific extras (Browse's tabs +
                bookmarks bar) into the RIGHT column — so the sidebar
                always starts at y=42 regardless of route. */}
            <div
              className="flex flex-col w-screen h-screen overflow-hidden"
              // Outer shell uses the chrome tone (matches the topbar
              // and sidebar) so the main content can sit inside as a
              // rounded "panel," with the chrome wrapping it like a
              // tray. Linear / Notion / Mercury all use this — content
              // floats inside chrome rather than running edge-to-edge.
              // Was --rv-bg (now near-white) which gave the layout no
              // separation between content and chrome.
              style={{ background: "var(--sidebar)" }}
            >
              {/* AppTopBar — persistent global chrome, full window
                  width, ~42px. Traffic light region clears via
                  internal padding. Same height every route. */}
              <AppTopBar globalCluster={<TopBarGlobalCluster />} />
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <AppSidebar />
                <SidebarInset
                  className="flex flex-col min-w-0 h-full overflow-hidden"
                  // Override shadcn's default bg-background — the
                  // chrome (--sidebar tone, painted on the outer
                  // shell) needs to show through the inner main's
                  // margins so the content panel reads as floating
                  // inside a chrome tray.
                  style={{ background: "transparent" }}
                >
                  {/* Browser chrome rows (tabs + bookmarks) removed
                      from the persistent shell entirely. The shell is
                      now ONE row on every route — Pipeline / Settings
                      / Browse are visually identical at the top edge.
                      Tabs are still accessible via the keyboard
                      (⌘T new, ⌘W close, ⌘1..9 switch); the URL bar
                      in AppTopBar handles navigation. Bookmarks live
                      on the Browse start screen. */}
                  <main
                    className="flex flex-col flex-1 min-w-0 min-h-0 relative overflow-hidden"
                    style={{
                      // Content "panel" — sits inside the chrome tray
                      // with small margins so the chrome (--sidebar
                      // color from the outer shell) shows around it.
                      // Rounded on the inner-facing corners; right edge
                      // stays flush with the window unless we add a
                      // right margin too. Linear pattern: content lifts
                      // off the chrome instead of running edge-to-edge.
                      marginTop:    6,
                      marginRight:  6,
                      marginBottom: 6,
                      borderRadius: 10,
                      // The body bg paints inside the rounded corners
                      // so the panel has its own clean white surface
                      // independent of children.
                      background:   "var(--background)",
                      // Subtle hairline reinforces the panel edge
                      // without competing with the rounding.
                      boxShadow:    "0 0 0 0.5px var(--rv-border)",
                    }}
                  >
                    {/* MapShell removed from here — Pipeline mounts it
                        inside its own body when Map view is active. */}
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
                </SidebarInset>
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
