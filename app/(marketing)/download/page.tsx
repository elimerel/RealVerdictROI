import Link from "next/link"
import type { Metadata } from "next"
import {
  Download, CheckCircle2, Globe, Zap, Lock, Monitor,
  ArrowRight, BarChart3, BookOpen,
} from "lucide-react"
import { MarketingHeader } from "../_components/MarketingHeader"
import { MarketingFooter } from "../_components/MarketingFooter"

export const metadata: Metadata = {
  title: "Download — RealVerdict Desktop",
  description:
    "RealVerdict for Mac — a native desktop app with a built-in browser. Browse Zillow or Redfin inside the app and analyze any listing automatically.",
}

const DMG_ARM64 = "https://github.com/elimerel/RealVerdictROI/releases/latest/download/RealVerdict-1.0.0-arm64.dmg"
const DMG_X64   = "https://github.com/elimerel/RealVerdictROI/releases/latest/download/RealVerdict-1.0.0.dmg"
const DMG_URL   = DMG_ARM64

const desktopFeatures = [
  {
    icon: Globe,
    title: "Native browser, built in",
    description:
      "Browse Zillow, Redfin, and Realtor.com inside the app. The panel updates automatically as you scroll through listings — no clicking, no copy-pasting.",
  },
  {
    icon: Zap,
    title: "Instant analysis",
    description:
      "Every listing page is analyzed the moment you land on it. Cap rate, cash-on-cash, DSCR, and your max offer price — all in under 10 seconds.",
  },
  {
    icon: Lock,
    title: "Your data stays local",
    description:
      "Browsing history lives on your machine. Nothing is sent to a server except the AI extraction call for property data.",
  },
  {
    icon: BarChart3,
    title: "Full analysis, save & compare",
    description:
      "Every analysis opens into the full deal view. Tweak assumptions, save to your pipeline, and compare against other properties.",
  },
]

const comparison = [
  { feature: "Cap rate, CoC, DSCR, GRM",          web: true,  desktop: true },
  { feature: "Max offer price",                     web: true,  desktop: true },
  { feature: "Paste any listing URL",               web: true,  desktop: true },
  { feature: "Search by address",                   web: true,  desktop: true },
  { feature: "Save deals to pipeline",              web: true,  desktop: true },
  { feature: "Stress tests",                        web: true,  desktop: true },
  { feature: "Built-in browser",                    web: false, desktop: true },
  { feature: "Auto-analyze on page load",           web: false, desktop: true },
  { feature: "Browse Zillow/Redfin in the app",    web: false, desktop: true },
  { feature: "Session persists while browsing",     web: false, desktop: true },
]

export default function DownloadPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--rv-surface-bg)" }}>
      <MarketingHeader />

      <main className="flex-1">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-4xl px-6 pt-20 pb-12 text-center space-y-7">
          <div
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-medium"
            style={{
              background: "var(--rv-surface-2)",
              border: "1px solid var(--rv-fill-border)",
              color: "var(--rv-t2)",
            }}
          >
            <Monitor className="h-3.5 w-3.5" />
            macOS 12+ · Apple Silicon &amp; Intel · Free
          </div>

          <h1
            className="text-[44px] sm:text-[64px] font-bold leading-[1.05] text-balance mx-auto"
            style={{ color: "var(--rv-t1)", letterSpacing: "-0.035em", maxWidth: "18ch" }}
          >
            RealVerdict{" "}
            <span style={{ color: "var(--rv-accent)" }}>for Mac</span>
          </h1>

          <p
            className="mx-auto text-[17px] leading-relaxed text-balance"
            style={{ color: "var(--rv-t2)", maxWidth: "48ch" }}
          >
            A native desktop app with a browser built in. Browse any listing site and
            the analysis appears beside the page — automatically, without leaving the app.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-2">
            <div className="flex flex-col items-center gap-2">
              <a
                href={DMG_ARM64}
                className="inline-flex items-center justify-center gap-2.5 h-12 px-7 rounded-full text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--rv-accent)", boxShadow: "0 4px 16px var(--rv-accent-border)" }}
              >
                <Download className="h-5 w-5" />
                Download for Mac (Apple Silicon)
              </a>
              <a
                href={DMG_X64}
                className="text-[12px] underline underline-offset-2 transition-colors"
                style={{ color: "var(--rv-t3)" }}
              >
                Intel Mac? Download here
              </a>
            </div>
            <Link
              href="/research"
              className="inline-flex items-center justify-center gap-2 h-12 px-7 rounded-full text-[14px] font-semibold transition-colors hover:bg-[var(--rv-fill-1)]"
              style={{ color: "var(--rv-t1)", border: "1px solid var(--rv-fill-border-strong)" }}
            >
              <Globe className="h-4 w-4" />
              Use web version instead
            </Link>
          </div>

          <p className="text-[12px]" style={{ color: "var(--rv-t4)" }}>
            ~115 MB · macOS 12 Monterey or later · No account required to get started
          </p>
        </section>

        {/* ── App window mockup ────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 pb-20">
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              border: "1px solid var(--rv-fill-border)",
              boxShadow: "0 24px 80px oklch(0 0 0 / 8%), 0 0 0 1px oklch(0 0 0 / 5%)",
            }}
          >
            {/* Window chrome */}
            <div
              className="flex items-center gap-2 px-4 py-3 border-b"
              style={{ background: "var(--rv-toolbar)", borderColor: "var(--rv-fill-border)" }}
            >
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full" style={{ background: "#ff5f57" }} />
                <div className="h-3 w-3 rounded-full" style={{ background: "#febc2e" }} />
                <div className="h-3 w-3 rounded-full" style={{ background: "#28c840" }} />
              </div>
              <div
                className="flex-1 mx-4 flex items-center gap-2 h-6 rounded-md px-3"
                style={{ background: "oklch(0 0 0 / 5%)" }}
              >
                <Globe className="h-3 w-3 shrink-0" style={{ color: "var(--rv-t4)" }} />
                <span className="text-[11px] font-mono" style={{ color: "var(--rv-t3)" }}>
                  zillow.com/homedetails/123-oak-st…
                </span>
              </div>
              <div
                className="px-3 py-1 rounded-full text-white text-[10px] font-semibold"
                style={{ background: "var(--rv-accent)" }}
              >
                Analyzing
              </div>
            </div>

            {/* Window body */}
            <div className="grid" style={{ gridTemplateColumns: "200px 1fr 260px", height: "280px" }}>
              {/* Sidebar */}
              <div
                className="border-r p-3 space-y-1 hidden sm:block"
                style={{ background: "var(--rv-toolbar)", borderColor: "var(--rv-fill-border)" }}
              >
                {["Browse", "Pipeline", "Compare", "Settings"].map((item) => (
                  <div
                    key={item}
                    className="h-8 rounded-md px-3 flex items-center text-[12px] font-medium"
                    style={{
                      background: item === "Browse" ? "var(--rv-fill-3)" : "transparent",
                      color: item === "Browse" ? "var(--rv-t1)" : "var(--rv-t3)",
                      borderLeft: item === "Browse" ? "2px solid var(--rv-accent)" : "2px solid transparent",
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>

              {/* Browser pane */}
              <div
                className="relative flex items-center justify-center"
                style={{ background: "#fafafa" }}
              >
                <div className="flex flex-col items-center gap-2" style={{ color: "var(--rv-t4)", opacity: 0.4 }}>
                  <Globe className="h-8 w-8" />
                  <p className="text-[11px]">Native browser — Zillow, Redfin, Realtor.com</p>
                </div>
                <div
                  className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[10px] font-semibold"
                  style={{ background: "var(--rv-good)" }}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Listing detected
                </div>
              </div>

              {/* Results pane */}
              <div
                className="border-l p-4 space-y-4 hidden sm:block"
                style={{ background: "var(--rv-surface-bg)", borderColor: "var(--rv-fill-border)" }}
              >
                <div className="space-y-1">
                  <p className="text-[9px] uppercase tracking-widest font-medium" style={{ color: "var(--rv-t3)" }}>Verdict</p>
                  <p className="text-[13px] font-bold" style={{ color: "var(--rv-good)" }}>Strong Deal</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] uppercase tracking-widest font-medium" style={{ color: "var(--rv-t3)" }}>Max offer</p>
                  <p className="text-[22px] font-bold font-mono leading-none" style={{ color: "var(--rv-t1)", letterSpacing: "-0.025em" }}>$412k</p>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {["Cap 6.2%", "CoC 8.4%", "DSCR 1.24", "CF +$340"].map((m) => (
                    <div
                      key={m}
                      className="rounded-lg px-2 py-1.5"
                      style={{ background: "var(--rv-surface-2)", border: "1px solid var(--rv-fill-border)" }}
                    >
                      <p className="text-[9px] font-mono" style={{ color: "var(--rv-t2)" }}>{m}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Divider ── */}
        <div className="border-t" style={{ borderColor: "var(--rv-fill-border)" }} />

        {/* ── Features grid ────────────────────────────────────── */}
        <section className="py-24" style={{ background: "var(--rv-surface-2)" }}>
          <div className="mx-auto max-w-5xl px-6 space-y-12">
            <div className="text-center">
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--rv-accent)" }}>
                Why desktop
              </p>
              <h2
                className="text-[32px] sm:text-[40px] font-bold leading-[1.1]"
                style={{ color: "var(--rv-t1)", letterSpacing: "-0.025em" }}
              >
                Built for how you actually browse deals.
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {desktopFeatures.map((f) => (
                <div
                  key={f.title}
                  className="rounded-2xl p-6 space-y-3"
                  style={{
                    background: "var(--rv-surface-bg)",
                    border: "1px solid var(--rv-fill-border)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-9 w-9 rounded-xl flex items-center justify-center"
                      style={{ background: "var(--rv-accent-subtle)", border: "1px solid var(--rv-accent-border)" }}
                    >
                      <f.icon className="h-4 w-4" style={{ color: "var(--rv-accent)" }} />
                    </div>
                    <p className="text-[15px] font-semibold" style={{ color: "var(--rv-t1)" }}>{f.title}</p>
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Comparison table ─────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-6 py-24 space-y-10">
          <div className="text-center">
            <h2
              className="text-[32px] sm:text-[40px] font-bold leading-[1.1]"
              style={{ color: "var(--rv-t1)", letterSpacing: "-0.025em" }}
            >
              Web vs. Desktop
            </h2>
          </div>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid var(--rv-fill-border)" }}
          >
            <table className="w-full text-[13px]">
              <thead>
                <tr
                  className="border-b"
                  style={{ background: "var(--rv-surface-2)", borderColor: "var(--rv-fill-border)" }}
                >
                  <th className="text-left px-5 py-3.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--rv-t3)" }}>
                    Feature
                  </th>
                  <th className="text-center px-5 py-3.5 text-[10px] font-semibold uppercase tracking-widest w-28" style={{ color: "var(--rv-t3)" }}>
                    Web
                  </th>
                  <th className="text-center px-5 py-3.5 text-[10px] font-semibold uppercase tracking-widest w-28" style={{ color: "var(--rv-accent)" }}>
                    Desktop
                  </th>
                </tr>
              </thead>
              <tbody style={{ background: "var(--rv-surface-bg)" }}>
                {comparison.map((row) => (
                  <tr
                    key={row.feature}
                    className="border-b last:border-0"
                    style={{ borderColor: "var(--rv-fill-border)" }}
                  >
                    <td className="px-5 py-3" style={{ color: "var(--rv-t2)" }}>{row.feature}</td>
                    <td className="px-5 py-3 text-center">
                      {row.web
                        ? <CheckCircle2 className="h-4 w-4 mx-auto" style={{ color: "var(--rv-t3)" }} />
                        : <span style={{ color: "var(--rv-fill-border-strong)" }}>—</span>
                      }
                    </td>
                    <td className="px-5 py-3 text-center">
                      <CheckCircle2 className="h-4 w-4 mx-auto" style={{ color: "var(--rv-accent)" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Install steps ────────────────────────────────────── */}
        <section className="py-24 border-t" style={{ background: "var(--rv-surface-2)", borderColor: "var(--rv-fill-border)" }}>
          <div className="mx-auto max-w-3xl px-6 space-y-10">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" style={{ color: "var(--rv-t3)" }} />
              <h2
                className="text-[24px] font-bold"
                style={{ color: "var(--rv-t1)", letterSpacing: "-0.02em" }}
              >
                Installation
              </h2>
            </div>
            <ol className="space-y-6">
              {[
                ["Download", "Click the button above. Choose Apple Silicon for M1/M2/M3/M4 Macs, or Intel for older models."],
                ["Install", "Open the downloaded .dmg and drag RealVerdict into your Applications folder."],
                ["Launch", "Open the app. macOS may ask you to confirm — click Open."],
                ["API key", "Add your OpenAI or Anthropic API key in Settings → API Keys to unlock AI-powered analysis."],
              ].map(([title, body], i) => (
                <li key={title as string} className="flex gap-4">
                  <span
                    className="h-7 w-7 rounded-full text-white text-[12px] font-bold flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "var(--rv-accent)" }}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[14px] font-semibold" style={{ color: "var(--rv-t1)" }}>{title}</p>
                    <p className="text-[13px] leading-relaxed mt-0.5" style={{ color: "var(--rv-t2)" }}>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-6 py-28 text-center space-y-8">
          <h2
            className="text-[32px] sm:text-[44px] font-bold leading-[1.08]"
            style={{ color: "var(--rv-t1)", letterSpacing: "-0.03em" }}
          >
            Ready to analyze your next deal?
          </h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={DMG_URL}
              className="inline-flex items-center justify-center gap-2.5 h-12 px-8 rounded-full text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "var(--rv-accent)", boxShadow: "0 4px 16px var(--rv-accent-border)" }}
            >
              <Download className="h-4 w-4" />
              Download RealVerdict for Mac
            </a>
            <Link
              href="/research"
              className="inline-flex items-center justify-center gap-2 h-12 px-8 rounded-full text-[14px] font-semibold transition-colors hover:bg-[var(--rv-fill-1)]"
              style={{ color: "var(--rv-t1)", border: "1px solid var(--rv-fill-border-strong)" }}
            >
              <ArrowRight className="h-4 w-4" />
              Try the web app first
            </Link>
          </div>
          <p className="text-[12px]" style={{ color: "var(--rv-t4)" }}>
            Free to download ·{" "}
            <Link href="/pricing" className="underline underline-offset-2" style={{ color: "var(--rv-t3)" }}>
              See pricing
            </Link>
          </p>
        </section>

      </main>

      <MarketingFooter />
    </div>
  )
}
