"use client"

import { useSidebar } from "./context"
import { Button } from "@/components/ui/button"

/**
 * Sidebar toggle — single element, fixed at window x=86 / y=12.
 *
 * Lives at the WINDOW level (above sidebar + content). Never moves no
 * matter what state the sidebar is in:
 *   - sidebar full   (≥160 wide): button sits inside sidebar's top strip
 *   - sidebar icons  (80 wide):    button sits at the boundary (~6px into toolbar)
 *   - sidebar hidden (0 wide):     button sits over toolbar
 *
 * Either way, the visible window-coordinate is the same.
 */
export default function SidebarToggle() {
  const { toggle } = useSidebar()
  return (
    <Button
      onClick={toggle}
      title="Toggle sidebar (⌘\\)"
      aria-label="Toggle sidebar"
      variant="ghost"
      size="icon-sm"
      className="rv-sidebar-toggle fixed z-50"
      style={{
        top:             12,
        left:            86,
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </Button>
  )
}
