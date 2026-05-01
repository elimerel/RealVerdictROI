import Link from "next/link"
import { Zap } from "lucide-react"

export function MarketingFooter() {
  return (
    <footer
      className="border-t py-12"
      style={{ borderColor: "var(--rv-fill-border)" }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 self-start shrink-0">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-[7px]"
              style={{
                background: "var(--rv-accent)",
                boxShadow: "0 1px 3px var(--rv-accent-border), inset 0 0 0 0.5px oklch(1 0 0 / 20%)",
              }}
            >
              <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
            </div>
            <span className="text-[14px] font-semibold" style={{ color: "var(--rv-t1)", letterSpacing: "-0.012em" }}>
              RealVerdict
            </span>
          </Link>

          {/* Nav groups */}
          <div className="flex flex-wrap gap-x-12 gap-y-6">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--rv-t3)" }}>
                Product
              </p>
              <nav className="flex flex-col gap-1.5">
                {[
                  { href: "/methodology", label: "Methodology" },
                  { href: "/pricing", label: "Pricing" },
                  { href: "/download", label: "Download" },
                  { href: "/deals", label: "Web app" },
                ].map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className="text-[13px] transition-colors hover:text-foreground"
                    style={{ color: "var(--rv-t2)" }}
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--rv-t3)" }}>
                Company
              </p>
              <nav className="flex flex-col gap-1.5">
                {[
                  { href: "/about", label: "About" },
                  { href: "/terms", label: "Terms" },
                  { href: "/privacy", label: "Privacy" },
                  { href: "/report", label: "Report a concern" },
                ].map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className="text-[13px] transition-colors hover:text-foreground"
                    style={{ color: "var(--rv-t2)" }}
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </div>

        <div
          className="mt-10 pt-8 border-t"
          style={{ borderColor: "var(--rv-fill-border)" }}
        >
          <p className="text-[11px] leading-relaxed max-w-2xl" style={{ color: "var(--rv-t4)" }}>
            RealVerdict is an analytical tool for educational purposes. Always verify
            property data and consult licensed professionals before making real estate
            decisions. Outputs are not investment advice or recommendations.
          </p>
        </div>
      </div>
    </footer>
  )
}
