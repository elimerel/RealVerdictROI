"use client"

import { useSidebar } from "./context"

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
    <button
      onClick={toggle}
      title="Toggle sidebar (⌘\\)"
      aria-label="Toggle sidebar"
      className="rv-sidebar-toggle"
      style={{
        position:        "fixed",
        top:             12,
        left:            86,
        width:           28,
        height:          28,
        borderRadius:    7,
        border:          "none",
        background:      "transparent",
        color:           "var(--rv-t2)",
        display:         "inline-flex",
        alignItems:      "center",
        justifyContent:  "center",
        cursor:          "default",
        zIndex:          50,
        WebkitAppRegion: "no-drag",
        transition:
          "color 100ms cubic-bezier(0.4, 0, 0.2, 1), background-color 100ms cubic-bezier(0.4, 0, 0.2, 1)",
      } as React.CSSProperties}
      onMouseEnter={(e) => {
        e.currentTarget.style.color      = "var(--rv-t1)"
        e.currentTarget.style.background = "rgba(120,120,128,0.18)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color      = "var(--rv-t2)"
        e.currentTarget.style.background = "transparent"
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </button>
  )
}
