import Link from "next/link"
import { Zap } from "lucide-react"

export function MarketingHeader() {
  return (
    <header
      className="sticky top-0 z-40 h-14 flex items-center border-b backdrop-blur-md"
      style={{
        background: "oklch(from var(--rv-surface-bg) l c h / 85%)",
        borderColor: "var(--rv-fill-border)",
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <div
            className="flex h-6 w-6 items-center justify-center rounded-[6px]"
            style={{
              background: "var(--rv-accent)",
              boxShadow: "0 1px 3px var(--rv-accent-border), inset 0 0 0 0.5px oklch(1 0 0 / 20%)",
            }}
          >
            <Zap className="h-3 w-3 text-white" strokeWidth={2.5} />
          </div>
          <span
            className="text-[13px] font-semibold"
            style={{ color: "var(--rv-t1)", letterSpacing: "-0.012em" }}
          >
            RealVerdict
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {[
            { href: "/methodology", label: "Methodology" },
            { href: "/pricing",     label: "Pricing" },
            { href: "/download",    label: "Download" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors"
              style={{ color: "var(--rv-t2)" }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.color = "var(--rv-t1)"
                ;(e.currentTarget as HTMLElement).style.background = "var(--rv-fill-1)"
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.color = "var(--rv-t2)"
                ;(e.currentTarget as HTMLElement).style.background = ""
              }}
            >
              {label}
            </Link>
          ))}
          <Link
            href="/research"
            className="ml-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{
              background: "var(--rv-accent)",
              color: "white",
              letterSpacing: "-0.005em",
            }}
          >
            Open app
          </Link>
        </nav>
      </div>
    </header>
  )
}
