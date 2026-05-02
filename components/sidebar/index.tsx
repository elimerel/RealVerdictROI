"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

export const SIDEBAR_W = 56

function IconBrowse() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
      <circle cx="8.5" cy="8.5" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M10.8 5.7l-1.8 4.2-4.2 1.8 1.8-4.2 4.2-1.8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  )
}

function IconPipeline() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9.5" y="1.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="1.5" y="9.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9.5" y="9.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
      <circle cx="8.5" cy="8.5" r="2.2" stroke="currentColor" strokeWidth="1.4"/>
      <path
        d="M8.5 1.5v1.8M8.5 13.7v1.8M1.5 8.5h1.8M13.7 8.5h1.8M3.55 3.55l1.27 1.27M12.18 12.18l1.27 1.27M13.45 3.55l-1.27 1.27M4.82 12.18l-1.27 1.27"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
      />
    </svg>
  )
}

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
      className="relative flex items-center justify-center rounded-xl transition-all duration-100"
      style={{
        width: 36,
        height: 36,
        color:      active ? "var(--rv-t1)"  : "var(--rv-t3)",
        background: active ? "rgba(255,255,255,0.08)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color      = "var(--rv-t2)"
          e.currentTarget.style.background = "rgba(255,255,255,0.05)"
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
      {/* Active pill */}
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
          style={{
            width: 2.5,
            height: 16,
            background: "var(--rv-accent)",
          }}
        />
      )}
    </Link>
  )
}

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
      {/* Traffic light + drag zone */}
      <div
        className="w-full shrink-0"
        style={{ height: 52, WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* Nav items */}
      <nav
        className="flex flex-col items-center gap-1.5 flex-1 w-full"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <NavItem href="/browse"   label="Browse"   icon={<IconBrowse />}   active={pathname === "/browse"} />
        <NavItem href="/pipeline" label="Pipeline" icon={<IconPipeline />} active={pathname === "/pipeline"} />
      </nav>

      {/* Bottom */}
      <div
        className="flex flex-col items-center pb-5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <NavItem href="/settings" label="Settings" icon={<IconSettings />} active={pathname === "/settings"} />
      </div>
    </div>
  )
}
