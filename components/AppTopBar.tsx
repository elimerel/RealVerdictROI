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

  // Persist mode for cross-fade easing — both old and new layers stay
  // mounted; only opacity flips.
  const [, setPrev] = useState<Mode>(mode)
  useEffect(() => { setPrev(mode) }, [mode])

  return (
    <header
      className="shrink-0 relative flex items-stretch select-none"
      style={{
        height:          52,
        background:      "var(--rv-surface)",
        // No border, no shadow. The previous hairline + shadow
        // combination read as a faint lighter line between chrome
        // and the panel/list — what the user described as a "gap."
        // The tone difference between --rv-surface (chrome) and
        // --rv-bg (canvas) is enough boundary on its own.
        zIndex:          50,
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      {/* Brand zone — left, fixed. The traffic-lights area on macOS
          sits over this region; brand mark stamps app identity right
          next to them. */}
      <div
        className="flex items-center shrink-0"
        style={{
          // Reserves space for the macOS traffic lights (x=16..72)
          // AND the fixed-positioned SidebarToggle button (x=86..114).
          // 124 = 114 + 10px breath. Without this clearance, the
          // adaptive center's content (Pipeline's "All Active" title,
          // Browse's URL toolbar) gets covered by the toggle.
          paddingLeft:  124,
          paddingRight: 12,
          gap:          10,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        {brand}
      </div>

      {/* Adaptive center — three overlapping mode layers. Each layer
          owns a portal-target div that the route portals its content
          into. Inactive layers stay mounted (so portal targets stay
          stable in the DOM) but get pointer-events:none + opacity 0. */}
      <div
        className="flex-1 relative min-w-0"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <ModeLayer active={mode === "browse"}>
          <div ref={setBrowse} className="flex items-center w-full h-full" />
        </ModeLayer>
        <ModeLayer active={mode === "pipeline"}>
          <div ref={setPipeline} className="flex items-center w-full h-full" />
        </ModeLayer>
        <ModeLayer active={mode === "settings"}>
          <div ref={setSettings} className="flex items-center w-full h-full" />
        </ModeLayer>
      </div>

      {/* Browse-aux slot — pinned right, sits between the adaptive
          center and global cluster. Hosts route-specific contextual
          buttons (Save / Stage / Open for Browse when a listing is
          loaded). Empty for non-Browse routes. */}
      <div
        ref={setBrowseAux}
        className="flex items-center shrink-0"
        style={{
          gap: 6,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      />

      {/* Global cluster — right, fixed. Always-reachable controls
          regardless of route. */}
      <div
        className="flex items-center shrink-0"
        style={{
          paddingLeft:  10,
          paddingRight: 12,
          gap:          6,
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
