"use client"

import { useSidebar } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Sidebar toggle — fixed at window x=86 / y=12, visible in BOTH states
 * (sidebar open → click to collapse, sidebar closed → click to expand).
 * The sidebar header pads its content past x=124 so the wordmark
 * doesn't sit underneath the toggle when the sidebar is open.
 */
export default function SidebarToggle() {
  const { toggleSidebar: toggle } = useSidebar()
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={toggle}
        aria-label="Toggle sidebar"
        // top=5 centers the 32px toggle at y=21 — matching the 42px
        // AppTopBar center + the traffic lights' new y=15 center.
        // All three (traffic lights / toggle / topbar widgets) now
        // sit on the same vertical line. z=60 keeps the toggle above
        // the topbar (z=50) so it's never covered.
        className="rv-sidebar-toggle fixed inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        style={{
          top:             5,
          left:            86,
          zIndex:          60,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </TooltipTrigger>
      <TooltipContent side="bottom">Toggle sidebar  ⌘\</TooltipContent>
    </Tooltip>
  )
}
