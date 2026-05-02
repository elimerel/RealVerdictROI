"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Compass, LayoutGrid, Settings } from "lucide-react"

export const SIDEBAR_W = 240

function NavItem({
  href, label, icon, active,
}: {
  href: string
  label: string
  icon: React.ReactNode
  active: boolean
}) {
  return (
    <Link
      href={href}
      className="relative flex items-center gap-2.5 rounded-[7px] select-none"
      style={{
        height:        32,
        padding:       "0 10px",
        color:         active ? "rgba(245,245,247,0.96)" : "rgba(245,245,247,0.45)",
        background:    active ? "rgba(255,255,255,0.10)" : "transparent",
        fontSize:      13,
        fontWeight:    active ? 500 : 400,
        letterSpacing: "-0.005em",
        whiteSpace:    "nowrap",
        // Snappy: fast hover (100ms), Apple-style easing
        transition:    "color 100ms cubic-bezier(0.4, 0, 0.2, 1), background-color 100ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color      = "rgba(245,245,247,0.85)"
          e.currentTarget.style.background = "rgba(255,255,255,0.06)"
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color      = "rgba(245,245,247,0.45)"
          e.currentTarget.style.background = "transparent"
        }
      }}
    >
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full shrink-0"
          style={{ width: 2.5, height: 14, background: "#30a46c" }}
        />
      )}
      <span className="shrink-0 flex items-center">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  )
}

export default function Sidebar({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  const pathname = usePathname()

  return (
    <div
      className="shrink-0 h-full overflow-hidden flex flex-col"
      style={{
        // GPU-accelerated isn't possible for width changes, but width on
        // a single container with no children layout shifts inside is
        // perfectly smooth at this size.  Apple's snappy easing curve.
        width:      open ? SIDEBAR_W : 0,
        background: "#16161a",
        transition: "width 280ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      {/* Inner stays fixed-width — content doesn't reflow when collapsing,
          it just clips behind the closing edge.  Way smoother. */}
      <div
        className="flex flex-col h-full"
        style={{ width: SIDEBAR_W, minWidth: SIDEBAR_W }}
      >
        {/* ── Traffic-light row ──────────────────────────────────────────────
            52px tall.  macOS renders red/yellow/green at x:16, y:18.
            The collapse button sits flush right.  Whole row is a drag handle
            EXCEPT the button (`no-drag`). */}
        <div
          className="flex items-center justify-end shrink-0"
          style={{
            height:          52,
            paddingRight:    8,
            WebkitAppRegion: "drag",
          } as React.CSSProperties}
        >
          <button
            onClick={onToggle}
            title="Hide sidebar"
            aria-label="Hide sidebar"
            className="flex items-center justify-center rounded-[7px]"
            style={{
              width:           28,
              height:          28,
              color:           "rgba(245,245,247,0.32)",
              background:      "transparent",
              flexShrink:      0,
              transition:      "color 100ms, background-color 100ms",
              WebkitAppRegion: "no-drag",
            } as React.CSSProperties}
            onMouseEnter={(e) => {
              e.currentTarget.style.color      = "rgba(245,245,247,0.92)"
              e.currentTarget.style.background = "rgba(255,255,255,0.08)"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color      = "rgba(245,245,247,0.32)"
              e.currentTarget.style.background = "transparent"
            }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>

        {/* ── Navigation ──────────────────────────────────────────────────── */}
        <nav
          className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden"
          style={{
            padding:         "2px 8px",
            gap:             2,
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties}
        >
          <NavItem
            href="/browse"
            label="Browse"
            icon={<Compass size={15} strokeWidth={1.7} />}
            active={pathname === "/browse"}
          />
          <NavItem
            href="/pipeline"
            label="Pipeline"
            icon={<LayoutGrid size={15} strokeWidth={1.7} />}
            active={pathname === "/pipeline"}
          />
        </nav>

        {/* ── Bottom (settings) ───────────────────────────────────────────── */}
        <div
          className="shrink-0"
          style={{
            padding:         "0 8px 16px",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties}
        >
          <NavItem
            href="/settings"
            label="Settings"
            icon={<Settings size={15} strokeWidth={1.7} />}
            active={pathname === "/settings"}
          />
        </div>
      </div>
    </div>
  )
}
