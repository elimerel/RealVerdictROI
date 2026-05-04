"use client"

// BrowseTabsRow — the row of tabs that sits ABOVE the AppTopBar in
// Browse mode. Restores Chrome's "tabs above URL bar" ordering: the
// TabStrip lives here, the URL toolbar lives in the AppTopBar below.
// Active tab visually merges DOWN into the AppTopBar (same surface
// tone, no border between them) — the standard Chrome pattern.
//
// The row is always mounted (so the portal target is stable) but
// CSS-collapses to 0 height when the slot is empty (i.e., no current
// route is portaling tabs into it). Only Browse routes do.

import { usePathname } from "next/navigation"
import { useTopBarSlots } from "@/lib/topBarSlots"

export default function BrowseTabsRow() {
  const pathname = usePathname()
  const { setBrowseTabs } = useTopBarSlots()
  const isBrowse = pathname.startsWith("/browse")

  return (
    <div
      className="shrink-0 flex items-end relative"
      style={{
        // 40px tall on Browse, 0 elsewhere. Animated height transition
        // at 140ms — fast enough that map flicker isn't perceptible
        // AND coalesces under the MapShell's 160ms resize debounce
        // (which fires once after the layout settles). Net effect:
        // smooth chrome on route change, single map redraw at the
        // end, no per-frame flicker.
        // 36px — Wexond's titlebar height (4 margin + 32 tab). Reads
        // as a denser, more tool-like tab strip than the 40px softer
        // modern-Chrome height.
        height:          isBrowse ? 36 : 0,
        // Distinctly darker than the AppTopBar's --rv-surface beneath.
        // The contrast is what creates Chrome's three-band layered
        // chrome — when the active tab lifts up to the URL band's
        // tone, it must look like a different surface from this one.
        background:      "color-mix(in srgb, var(--rv-bg) 78%, black)",
        WebkitAppRegion: "drag",
        zIndex:          51,
        // 160ms — synced with AppTopBar's mode cross-fade so both
        // chrome animations finish in the same beat. Mismatched
        // timings made the route transition feel staggered.
        transition:      "height 160ms cubic-bezier(0.32, 0.72, 0, 1)",
      } as React.CSSProperties}
    >
      <div
        ref={setBrowseTabs}
        className="flex items-end w-full h-full"
        style={{
          opacity:       isBrowse ? 1 : 0,
          pointerEvents: isBrowse ? "auto" : "none",
          transition:    "opacity 160ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      />
    </div>
  )
}
