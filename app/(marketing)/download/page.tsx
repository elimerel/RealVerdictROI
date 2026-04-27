import Link from "next/link"
import type { Metadata } from "next"
import {
  Download, CheckCircle2, Globe, Zap, Lock, Monitor,
  ArrowRight, TrendingUp, BarChart3, BookOpen, Search,
} from "lucide-react"

export const metadata: Metadata = {
  title: "Download — RealVerdict Desktop",
  description:
    "RealVerdict for Mac — a native desktop app with a built-in browser. Browse Zillow or Redfin inside the app and analyze any listing in one click.",
}

const DMG_URL = "https://github.com/elimerel/RealVerdictROI/releases/latest/download/RealVerdictROI.dmg"

const desktopFeatures = [
  {
    icon: Globe,
    title: "Native browser, built in",
    description:
      "Browse Zillow, Redfin, and Realtor.com inside the app. Hit Analyze and the numbers are pulled directly from the live page — no screenshots, no scraping.",
  },
  {
    icon: Zap,
    title: "One-click analysis",
    description:
      "Every listing page gets an Analyze button. Cap rate, cash-on-cash, DSCR, and your walk-away price — all in under 10 seconds.",
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
      "Every analysis opens into the full deal view. Tweak assumptions, save to your leads inbox, and compare against other properties.",
  },
]

const comparison = [
  { feature: "Cap rate, CoC, DSCR, GRM",          web: true,  desktop: true },
  { feature: "Walk-away price",                     web: true,  desktop: true },
  { feature: "Paste any listing URL",               web: true,  desktop: true },
  { feature: "Search by address",                   web: true,  desktop: true },
  { feature: "Save deals to inbox",                 web: true,  desktop: true },
  { feature: "Market insights",                     web: true,  desktop: true },
  { feature: "Built-in browser",                    web: false, desktop: true },
  { feature: "One-click analyze from listing page", web: false, desktop: true },
  { feature: "Browse Zillow/Redfin in the app",    web: false, desktop: true },
  { feature: "Session persists while browsing",     web: false, desktop: true },
]

export default function DownloadPage() {
  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950 min-h-screen">

      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-zinc-200/70 bg-white/80 backdrop-blur-md dark:border-zinc-800/70 dark:bg-black/60">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-50">
              <TrendingUp className="h-4 w-4 text-white dark:text-zinc-900" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">RealVerdict</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href="/pricing"
              className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 hidden sm:block"
            >
              Pricing
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center gap-1.5 font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Web app</span>
            </Link>
            <a
              href={DMG_URL}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">

        {/* Hero */}
        <section className="mx-auto w-full max-w-4xl px-6 py-20 sm:py-28 text-center space-y-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-medium text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <Monitor className="h-3.5 w-3.5" />
            macOS 12+ · Apple Silicon &amp; Intel · Free
          </div>

          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 text-balance leading-[1.1]">
            RealVerdict<br className="hidden sm:block" />
            <span className="text-emerald-600 dark:text-emerald-400"> for Mac</span>
          </h1>

          <p className="mx-auto max-w-xl text-lg text-zinc-600 dark:text-zinc-400 text-balance">
            A native desktop app with a browser built in. Browse any listing site and analyze deals in one click — without ever leaving the app.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-2">
            <a
              href={DMG_URL}
              className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-zinc-900 px-7 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Download className="h-5 w-5" />
              Download for macOS
            </a>
            <Link
              href="/search"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-7 py-4 text-base font-semibold text-zinc-900 shadow-sm transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              <Search className="h-5 w-5" />
              Use web version instead
            </Link>
          </div>

          <p className="text-xs text-zinc-400 dark:text-zinc-600">
            ~120 MB download · No account required to get started
          </p>
        </section>

        {/* App window mockup */}
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 overflow-hidden shadow-2xl">
            {/* Window chrome */}
            <div className="flex items-center gap-2 px-4 py-3 bg-zinc-200/80 dark:bg-zinc-800/80 border-b border-zinc-300/60 dark:border-zinc-700/60">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-amber-400" />
                <div className="h-3 w-3 rounded-full bg-emerald-400" />
              </div>
              <div className="flex-1 mx-4 flex items-center gap-2 h-6 bg-white/60 dark:bg-zinc-700/60 rounded-md px-3">
                <Globe className="h-3 w-3 text-zinc-400 shrink-0" />
                <span className="text-[11px] text-zinc-500 font-mono">zillow.com/homedetails/123-oak-st…</span>
              </div>
              <div className="px-3 py-1 rounded-md bg-emerald-600 text-white text-[10px] font-semibold">
                Analyze this property
              </div>
            </div>

            {/* Window body */}
            <div className="grid h-56 sm:h-72" style={{ gridTemplateColumns: "200px 1fr 260px" }}>
              {/* Sidebar */}
              <div className="border-r border-zinc-300/60 dark:border-zinc-700/60 bg-zinc-200/40 dark:bg-zinc-800/40 p-3 space-y-1 hidden sm:block">
                {["Search", "Research", "Leads", "Insights", "Settings"].map((item) => (
                  <div
                    key={item}
                    className={`h-8 rounded-md px-3 flex items-center text-xs font-medium ${
                      item === "Research"
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-500"
                    }`}
                  >
                    {item}
                  </div>
                ))}
              </div>

              {/* Browser pane */}
              <div className="bg-zinc-950 flex flex-col items-center justify-center gap-2 px-4">
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-zinc-600">
                  <Globe className="h-8 w-8 opacity-20" />
                  <p className="text-[11px] opacity-40">Native browser — Zillow, Redfin, Realtor.com</p>
                  <div className="absolute top-6 left-6 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-[10px] font-medium">
                    <CheckCircle2 className="h-3 w-3" />
                    Listing detected
                  </div>
                </div>
              </div>

              {/* Results pane */}
              <div className="border-l border-zinc-300/60 dark:border-zinc-700/60 bg-white dark:bg-zinc-900 p-4 space-y-3 hidden sm:block">
                <div className="space-y-1">
                  <p className="text-[9px] uppercase tracking-wider text-zinc-400">Verdict</p>
                  <p className="text-sm font-bold text-emerald-600">Strong Deal</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] uppercase tracking-wider text-zinc-400">Walk-away</p>
                  <p className="text-lg font-bold font-mono">$412k</p>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {["Cap 6.2%", "CoC 8.4%", "DSCR 1.24", "CF +$340"].map((m) => (
                    <div key={m} className="rounded-md border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 px-2 py-1.5">
                      <p className="text-[9px] font-mono text-zinc-500">{m}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features grid */}
        <section className="border-y border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-900/40 py-20">
          <div className="mx-auto max-w-5xl px-6 space-y-10">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 text-center">
              Why use the desktop app?
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {desktopFeatures.map((f) => (
                <div key={f.title} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                      <f.icon className="h-4.5 w-4.5 text-zinc-600 dark:text-zinc-400" />
                    </div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-50">{f.title}</p>
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Comparison table */}
        <section className="mx-auto max-w-3xl px-6 py-20 space-y-8">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 text-center">
            Web vs. Desktop
          </h2>
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Feature</th>
                  <th className="text-center px-5 py-3.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-28">Web</th>
                  <th className="text-center px-5 py-3.5 text-xs font-semibold text-zinc-900 dark:text-zinc-50 uppercase tracking-wider w-28">Desktop</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-950">
                {comparison.map((row, i) => (
                  <tr key={row.feature} className={`border-b border-zinc-100 dark:border-zinc-900 last:border-0 ${i % 2 === 0 ? "" : "bg-zinc-50/50 dark:bg-zinc-900/30"}`}>
                    <td className="px-5 py-3.5 text-sm text-zinc-700 dark:text-zinc-300">{row.feature}</td>
                    <td className="px-5 py-3.5 text-center">
                      {row.web
                        ? <CheckCircle2 className="h-4 w-4 text-zinc-400 mx-auto" />
                        : <span className="text-zinc-300 dark:text-zinc-700">—</span>
                      }
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Install steps */}
        <section className="border-t border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-900/40 py-20">
          <div className="mx-auto max-w-3xl px-6 space-y-8">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-zinc-500" />
              <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Installation</h2>
            </div>
            <ol className="space-y-5">
              {[
                ["Download", "Click the button above to download RealVerdictROI.dmg."],
                ["Install", "Open the .dmg and drag RealVerdict into your Applications folder."],
                ["Launch", "Open the app. macOS may ask you to confirm — click Open. It's code-signed."],
                ["API key", "Add your OpenAI API key in Settings → API Keys to unlock AI-powered analysis."],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-4">
                  <span className="h-7 w-7 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-3xl px-6 py-20 text-center space-y-6">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Ready to analyze your next deal?
          </h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={DMG_URL}
              className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-zinc-900 px-7 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Download className="h-5 w-5" />
              Download RealVerdict for Mac
            </a>
            <Link
              href="/search"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-7 py-4 text-base font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ArrowRight className="h-4 w-4" />
              Try the web app first
            </Link>
          </div>
          <p className="text-xs text-zinc-400">
            Free to download ·{" "}
            <Link href="/pricing" className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300">See pricing</Link>
          </p>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-200/80 dark:border-zinc-800/80 py-10">
          <div className="mx-auto max-w-6xl px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-50">
                <TrendingUp className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
              </div>
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">RealVerdict</span>
            </Link>
            <nav className="flex items-center gap-5 text-xs text-zinc-500">
              <Link href="/"            className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Home</Link>
              <Link href="/about"       className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">About</Link>
              <Link href="/methodology" className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Methodology</Link>
              <Link href="/pricing"     className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Pricing</Link>
              <Link href="/search"      className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Web app</Link>
            </nav>
          </div>
        </footer>
      </main>
    </div>
  )
}
