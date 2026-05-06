"use client"

// AppTopBar — the persistent global chrome bar at y=0..52, mounted
// ONCE at the app shell level. Never re-mounts on route change.
//
// Architecture: ONE bar that morphs between modes based on the active
// route. Browse → omnibox URL/search. Pipeline → stage chip + Compare.
// Settings → title. The same physical element renders all three;
// modes cross-fade with a tight opacity+slide transition so route
// changes feel like the bar adapting rather than refreshing.
//
// Slot-based: each mode's content lives inside its own route's React
// tree (so it has access to the route's state) but renders DOM-wise
// inside the AppTopBar via React Portal. The slot DOM elements are
// exposed through TopBarSlotsProvider; routes consume them with
// createPortal. The AppTopBar itself never touches route state.

import { useEffect, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { useTopBarSlots } from "@/lib/topBarSlots"

type Mode = "browse" | "pipeline" | "settings" | "other"

function modeForPath(pathname: string): Mode {
  if (pathname.startsWith("/browse"))   return "browse"
  if (pathname.startsWith("/pipeline")) return "pipeline"
  if (pathname.startsWith("/settings")) return "settings"
  return "other"
}

export default function AppTopBar({
  brand,
  globalCluster,
}: {
  brand?:         ReactNode
  globalCluster?: ReactNode
}) {
  const pathname = usePathname()
  const mode = modeForPath(pathname)
  const { setBrowse, setPipeline, setSettings, setBrowseAux } = useTopBarSlots()
  // SidebarToggle is now always visible (was previously hidden when
  // sidebar was open), so the brand zone always needs to clear the
  // toggle's right edge (x=118) plus a small gap. 124px covers
  // traffic lights (16-80) + toggle (86-118) + 6px breathing room.
  const brandZonePadL = 124

  // Persist mode for cross-fade easing — both old and new layers stay
  // mounted; only opacity flips.
  const [, setPrev] = useState<Mode>(mode)
  useEffect(() => { setPrev(mode) }, [mode])

  // Drag architecture:
  // The <header> is the SINGLE drag declaration. Its bbox covers the
  // entire 42px × full-width title-bar rectangle. Per Chromium's
  // draggable-region union, every pixel inside that bbox is drag
  // EXCEPT where a descendant explicitly declares
  // WebkitAppRegion: "no-drag" — those rectangles are carved out.
  //
  // Critical: do NOT declare drag on intermediate wrappers (brand
  // zone, adaptive center, aux slot, global cluster). Doing so adds
  // their bboxes to the drag union BEFORE descendants' no-drag rects
  // are subtracted — which in practice works the same as the
  // header's drag, BUT introduces edge cases where the visible
  // button bbox is smaller than its parent's flex height, leaving
  // strips ABOVE/BELOW each button as drag region. Clicks on those
  // strips fail (drag intent without movement). Single drag at the
  // outer-most level avoids this entirely.
  //
  // Each interactive widget (button, input, custom click div) MUST
  // declare its own WebkitAppRegion: "no-drag" to be clickable.
  return (
    <header
      className="shrink-0 relative flex items-stretch select-none"
      style={{
        height:          42,
        // Chrome tone — matches the sidebar so the entire chrome
        // (topbar + sidebar) reads as ONE recessed surface, with
        // body content brightest. Was `--rv-surface` (pure white in
        // light mode) which made the topbar BRIGHTER than the body
        // — Linear/Mercury have chrome receding, not popping.
        background:      "var(--sidebar)",
        zIndex:          50,
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      <div
        className="flex items-center shrink-0"
        style={{
          paddingLeft:  brandZonePadL,
          paddingRight: 12,
          gap:          10,
          transition:   "padding-left 220ms cubic-bezier(0.32, 0.72, 0, 1)",
        } as React.CSSProperties}
      >
        {brand}
      </div>

      <div className="flex-1 relative min-w-0">
        <ModeLayer active={mode === "browse"}>
          <div ref={setBrowse}   className="flex items-center w-full h-full" />
        </ModeLayer>
        <ModeLayer active={mode === "pipeline"}>
          <div ref={setPipeline} className="flex items-center w-full h-full" />
        </ModeLayer>
        <ModeLayer active={mode === "settings"}>
          <div ref={setSettings} className="flex items-center w-full h-full" />
        </ModeLayer>
      </div>

      {/* Aux slot + global cluster — explicit no-drag carve-outs.
          The header's drag rect would otherwise include the buttons
          portaled here (Save deal / Watch / Open / Stage menu /
          PanelToggle), making them un-clickable. Carving the whole
          right cluster out of the drag region keeps every button
          inside reliably clickable without each one having to
          re-declare no-drag. */}
      <div
        ref={setBrowseAux}
        className="flex items-center shrink-0"
        style={{
          gap: 4,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      />

      <div
        className="flex items-center shrink-0"
        style={{
          paddingLeft:  6,
          paddingRight: 10,
          gap:          4,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        {globalCluster}
      </div>
    </header>
  )
}

function ModeLayer({
  active, children,
}: {
  active:   boolean
  children: ReactNode
}) {
  return (
    <div
      aria-hidden={!active}
      style={{
        position:      "absolute",
        inset:         0,
        opacity:       active ? 1 : 0,
        transform:     active ? "translateY(0)" : "translateY(-2px)",
        // 160ms — synced with BrowseTabsRow's height transition so
        // chrome settles in one coordinated beat.
        transition:    "opacity 160ms cubic-bezier(0.32, 0.72, 0, 1), transform 160ms cubic-bezier(0.32, 0.72, 0, 1)",
        pointerEvents: active ? "auto" : "none",
      }}
      className="flex items-center"
    >
      {children}
    </div>
  )
}
