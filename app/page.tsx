import Link from "next/link"
import type { Metadata } from "next"
import {
  TrendingUp, Globe, Monitor, Download, CheckCircle2,
  ArrowRight, DollarSign, BarChart3, Percent, ShieldCheck,
  Zap, Search,
} from "lucide-react"

export const metadata: Metadata = {
  title: "RealVerdict — Know your walk-away price before you make an offer",
  description:
    "Underwrite any rental property in seconds. Paste a listing URL or address — get cap rate, cash-on-cash, DSCR, and the exact maximum offer where the deal still clears.",
}

// Nav shared across all sections
function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/70 bg-white/80 backdrop-blur-md dark:border-zinc-800/70 dark:bg-black/60">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-50">
            <TrendingUp className="h-4 w-4 text-white dark:text-zinc-900" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            RealVerdict
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="/methodology"
            className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 hidden sm:block"
          >
            Methodology
          </Link>
          <Link
            href="/pricing"
            className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 hidden sm:block"
          >
            Pricing
          </Link>
          <Link
            href="/download"
            className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 hidden md:flex items-center gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Mac App
          </Link>
          <Link
            href="/search"
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Use web app
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </nav>
      </div>
    </header>
  )
}

const metrics = [
  { icon: DollarSign, label: "Monthly cash flow",  example: "+$340 / mo" },
  { icon: Percent,    label: "Cap rate",            example: "6.2%" },
  { icon: BarChart3,  label: "Cash-on-cash",        example: "8.4%" },
  { icon: TrendingUp, label: "DSCR",                example: "1.24" },
  { icon: ShieldCheck,label: "Walk-away price",     example: "$412,000" },
  { icon: Zap,        label: "Verdict",             example: "Strong deal" },
]

const webFeatures = [
  "Cap rate, cash-on-cash, DSCR, GRM",
  "Walk-away price (max offer to still clear)",
  "Paste any listing URL — we read the page",
  "Search by address with auto-fill",
  "Save deals to your Leads inbox",
  "Market insights dashboard",
]

const desktopExtras = [
  "Native browser built into the app",
  "Browse Zillow, Redfin, Realtor.com directly",
  "One-click analysis from any listing page",
  "No copy-pasting URLs — just hit Analyze",
  "Session persists as you browse",
  "Works entirely on your machine",
]

const steps = [
  {
    n: "01",
    title: "Find a listing",
    body: "Paste a URL from Zillow, Redfin, Realtor.com, Homes.com, or Trulia — or type an address. On desktop, just browse inside the app.",
  },
  {
    n: "02",
    title: "We run the numbers",
    body: "Our engine reads purchase price, rent estimate, taxes, HOA, and insurance from the live page — then runs cap rate, DSCR, cash-on-cash, and GRM automatically.",
  },
  {
    n: "03",
    title: "You get a verdict",
    body: "A clear pass/warn/fail across five criteria, a walk-away price, and every assumption you can tweak. No spreadsheet required.",
  },
]

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950 min-h-screen">
      <MarketingNav />

      <main>
        {/* ── Hero ── */}
        <section className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-32 text-center space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-medium text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Used by buy-and-hold investors across the US
          </div>

          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 text-balance leading-[1.1]">
            Know your walk-away price<br className="hidden sm:block" />
            <span className="text-emerald-600 dark:text-emerald-400"> before you make an offer.</span>
          </h1>

          <p className="mx-auto max-w-xl text-lg text-zinc-600 dark:text-zinc-400 text-balance">
            Paste a listing URL or enter an address. RealVerdict reads the page, runs the numbers, and tells you if the deal clears — and exactly how much you can offer.
          </p>

          {/* Dual CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <a
              href="/download"
              className="group inline-flex items-center gap-2.5 rounded-xl bg-zinc-900 px-6 py-3.5 text-base font-semibold text-white shadow-lg transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 w-full sm:w-auto justify-center"
            >
              <Monitor className="h-5 w-5" />
              Download for Mac
              <span className="ml-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">FREE</span>
            </a>
            <Link
              href="/search"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-6 py-3.5 text-base font-semibold text-zinc-900 shadow-sm transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800 w-full sm:w-auto justify-center"
            >
              <Globe className="h-5 w-5" />
              Use web app
            </Link>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            macOS 12+ · Apple Silicon &amp; Intel ·{" "}
            <Link href="/pricing" className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300">
              Free tier available
            </Link>
          </p>
        </section>

        {/* ── Metrics strip ── */}
        <section className="border-y border-zinc-200/80 bg-zinc-50/60 dark:border-zinc-800/80 dark:bg-zinc-900/40 py-10">
          <div className="mx-auto max-w-5xl px-6">
            <p className="text-center text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-8">
              Every analysis includes
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {metrics.map((m) => (
                <div key={m.label} className="flex flex-col items-center gap-2 text-center">
                  <div className="h-9 w-9 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shadow-sm">
                    <m.icon className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                  </div>
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{m.label}</p>
                  <p className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{m.example}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-28 space-y-12">
          <div className="text-center space-y-3">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              How it works
            </h2>
            <p className="text-zinc-500 dark:text-zinc-400 max-w-lg mx-auto">
              From listing to verdict in under 30 seconds.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {steps.map((s) => (
              <div key={s.n} className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-3xl font-bold font-mono text-zinc-200 dark:text-zinc-700">{s.n}</p>
                <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{s.title}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Web vs Desktop ── */}
        <section className="border-y border-zinc-200/80 bg-zinc-50/60 dark:border-zinc-800/80 dark:bg-zinc-900/40 py-20 sm:py-28">
          <div className="mx-auto w-full max-w-5xl px-6 space-y-12">
            <div className="text-center space-y-3">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                Web app or desktop?
              </h2>
              <p className="text-zinc-500 dark:text-zinc-400 max-w-lg mx-auto">
                Both analyze deals fully. The desktop app adds a native browser so you never leave the app.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Web card */}
              <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-7 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                    <Globe className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-50">Web App</p>
                    <p className="text-xs text-zinc-500">browser.realverdictroi.com</p>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {webFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                  <li className="flex items-start gap-2.5 text-sm text-zinc-400 dark:text-zinc-600">
                    <span className="h-4 w-4 text-center shrink-0 mt-0.5 text-base leading-none">—</span>
                    Browser research (desktop only)
                  </li>
                </ul>
                <Link
                  href="/search"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50 transition hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <Search className="h-4 w-4" />
                  Open web app
                </Link>
              </div>

              {/* Desktop card */}
              <div className="rounded-2xl border-2 border-zinc-900 dark:border-zinc-100 bg-white dark:bg-zinc-900 p-7 space-y-5 relative overflow-hidden">
                <div className="absolute top-4 right-4 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-white uppercase tracking-wider">
                  Recommended
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
                    <Monitor className="h-5 w-5 text-white dark:text-zinc-900" />
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-50">Desktop App</p>
                    <p className="text-xs text-zinc-500">macOS · Free download</p>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {webFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                  {desktopExtras.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-zinc-900 dark:text-zinc-100 font-medium">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/download"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-200"
                >
                  <Download className="h-4 w-4" />
                  Download for Mac — Free
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="mx-auto w-full max-w-3xl px-6 py-20 sm:py-28 text-center space-y-7">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Stop guessing. Start knowing.
          </h2>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
            Every offer you make without a walk-away price is a guess. RealVerdict turns any listing into a clear yes, warn, or no — in seconds.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/download"
              className="inline-flex items-center gap-2.5 rounded-xl bg-zinc-900 px-6 py-3.5 text-base font-semibold text-white shadow-lg transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 w-full sm:w-auto justify-center"
            >
              <Download className="h-5 w-5" />
              Download for Mac
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-6 py-3.5 text-base font-semibold text-zinc-900 shadow-sm transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800 w-full sm:w-auto justify-center"
            >
              <Globe className="h-5 w-5" />
              Try the web app
            </Link>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="border-t border-zinc-200/80 dark:border-zinc-800/80 py-10">
          <div className="mx-auto max-w-6xl px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-50">
                <TrendingUp className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
              </div>
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">RealVerdict</span>
            </Link>
            <nav className="flex items-center gap-5 text-xs text-zinc-500 dark:text-zinc-500">
              <Link href="/about"       className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">About</Link>
              <Link href="/methodology" className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Methodology</Link>
              <Link href="/pricing"     className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Pricing</Link>
              <Link href="/download"    className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Download</Link>
              <Link href="/search"      className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Web app</Link>
            </nav>
          </div>
        </footer>
      </main>
    </div>
  )
}
