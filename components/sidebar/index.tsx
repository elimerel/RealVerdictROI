"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

// ── Icons ──────────────────────────────────────────────────────────────────────

function IconCompass() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M11.5 6.5l-2 4.5-4.5 2 2-4.5 4.5-2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  )
}

function IconLayers() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M9 2L15.5 5.5 9 9 2.5 5.5 9 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/>
      <path d="M2.5 9L9 12.5 15.5 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M2.5 12.5L9 16 15.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
      <path
        d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.55 3.55l1.41 1.41M13.04 13.04l1.41 1.41M14.45 3.55l-1.41 1.41M4.96 13.04l-1.41 1.41"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
      />
    </svg>
  )
}

// ── Nav item ───────────────────────────────────────────────────────────────────

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
      title={label}
      className="group relative flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-100"
      style={{
        color:      active ? "var(--rv-t1)"     : "var(--rv-t3)",
        background: active ? "var(--rv-raised)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color      = "var(--rv-t2)"
          e.currentTarget.style.background = "var(--rv-glass-hover, rgba(255,255,255,0.05))"
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color      = "var(--rv-t3)"
          e.currentTarget.style.background = "transparent"
        }
      }}
    >
      {icon}
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-4 rounded-r-full"
          style={{ background: "var(--rv-accent)" }}
        />
      )}
    </Link>
  )
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

export const SIDEBAR_W = 52

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <div
      className="flex flex-col items-center shrink-0 h-full"
      style={{
        width: SIDEBAR_W,
        background: "var(--rv-glass)",
        borderRight: "1px solid var(--rv-border)",
      }}
    >
      {/* Traffic light clearance — drag zone at the top */}
      <div
        className="w-full shrink-0"
        style={{
          height: 40,
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      />

      {/* Wordmark — no-drag so it's not accidentally dragged */}
      <div
        className="w-full flex items-center justify-center pb-3"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <span
          className="text-[9px] font-bold tracking-[0.12em] uppercase rotate-[-90deg] whitespace-nowrap select-none"
          style={{ color: "var(--rv-t4)" }}
        >
          RV
        </span>
      </div>

      {/* Nav items */}
      <nav
        className="flex flex-col items-center gap-1 flex-1 w-full px-1.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <NavItem
          href="/browse"
          label="Browse"
          icon={<IconCompass />}
          active={pathname === "/browse"}
        />
        <NavItem
          href="/pipeline"
          label="Pipeline"
          icon={<IconLayers />}
          active={pathname === "/pipeline"}
        />
      </nav>

      {/* Bottom — settings */}
      <div
        className="flex flex-col items-center pb-4 px-1.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <NavItem
          href="/settings"
          label="Settings"
          icon={<IconSettings />}
          active={pathname === "/settings"}
        />
      </div>
    </div>
  )
}
