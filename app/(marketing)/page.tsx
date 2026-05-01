import Link from "next/link"
import type { Metadata } from "next"
import {
  Globe, Monitor, Download, CheckCircle2, ArrowRight,
  DollarSign, BarChart3, Percent, ShieldCheck, Zap,
  LayoutList, Settings, ArrowLeft, RotateCw, ChevronRight,
  TrendingUp,
} from "lucide-react"
import { MarketingFooter } from "./_components/MarketingFooter"

export const metadata: Metadata = {
  title: "RealVerdict — Know your walk-away price before you make an offer",
  description:
    "Underwrite any rental property in seconds. Browse Zillow or Redfin inside the app — cap rate, DSCR, cash flow, and your exact walk-away price appear as you scroll.",
}

function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 h-14 flex items-center border-b border-[var(--rv-fill-border)] bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-[7px] shrink-0"
            style={{ background: "var(--rv-accent)", boxShadow: "0 1px 3px var(--rv-accent-border), inset 0 0 0 0.5px oklch(1 0 0 / 20%)" }}
          >
            <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
          </div>
          <span className="text-[14px] font-semibold tracking-tight text-foreground" style={{ letterSpacing: "-0.012em" }}>
            RealVerdict
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/methodology" className="hidden sm:flex h-8 items-center px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-[var(--rv-fill-1)]">
            Methodology
          </Link>
          <Link href="/pricing" className="hidden sm:flex h-8 items-center px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-[var(--rv-fill-1)]">
            Pricing
          </Link>
          <Link href="/login" className="hidden sm:flex h-8 items-center px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-[var(--rv-fill-1)]">
            Sign in
          </Link>
          <Link
            href="/download"
            className="ml-2 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--rv-accent)" }}
          >
            <Download className="h-3 w-3" />
            Download
          </Link>
        </nav>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// App mockup — pure HTML/CSS representation of the desktop app.
// Shows the split-view: sidebar + browser pane + DossierPanel with sample data.
// This is the key Mercury-inspired element: show the actual product.
// ---------------------------------------------------------------------------

function AppMockup() {
  return (
    <div
      className="w-full rounded-xl overflow-hidden select-none"
      style={{
        boxShadow: "0 24px 80px oklch(0 0 0 / 12%), 0 8px 24px oklch(0 0 0 / 8%), 0 0 0 1px oklch(0 0 0 / 8%)",
        background: "var(--rv-toolbar)",
      }}
    >
      {/* Window title bar */}
      <div
        className="flex items-center h-9 px-4 gap-3 border-b"
        style={{ borderColor: "var(--rv-fill-border)", background: "var(--rv-toolbar)" }}
      >
        <div className="flex gap-1.5 shrink-0">
          <div className="h-3 w-3 rounded-full" style={{ background: "#ff5f57" }} />
          <div className="h-3 w-3 rounded-full" style={{ background: "#febc2e" }} />
          <div className="h-3 w-3 rounded-full" style={{ background: "#28c840" }} />
        </div>
        {/* Browser navigation controls */}
        <div className="flex items-center gap-0.5 shrink-0">
          <div className="h-5 w-5 rounded flex items-center justify-center opacity-30">
            <ArrowLeft className="h-3 w-3" />
          </div>
          <div className="h-5 w-5 rounded flex items-center justify-center opacity-30">
            <ArrowLeft className="h-3 w-3 scale-x-[-1]" />
          </div>
          <div className="h-5 w-5 rounded flex items-center justify-center opacity-50">
            <RotateCw className="h-3 w-3" />
          </div>
        </div>
        {/* URL bar */}
        <div
          className="flex-1 h-6 rounded-md flex items-center gap-2 px-2.5 max-w-[420px] mx-auto"
          style={{ background: "oklch(0 0 0 / 6%)" }}
        >
          <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "var(--rv-accent)" }} />
          <span className="text-[10px] font-mono truncate" style={{ color: "var(--rv-t3)" }}>
            zillow.com/homedetails/4821-barton-creek-austin-tx
          </span>
        </div>
        <div className="shrink-0 w-20" />
      </div>

      {/* App body */}
      <div className="flex" style={{ height: "400px" }}>
        {/* Sidebar — icon-only collapsed state */}
        <div
          className="w-12 shrink-0 flex flex-col items-center pt-3 pb-3 border-r gap-1"
          style={{ background: "var(--rv-toolbar)", borderColor: "var(--rv-fill-border)" }}
        >
          {/* Logo mark */}
          <div
            className="h-7 w-7 rounded-[7px] flex items-center justify-center mb-2"
            style={{
              background: "var(--rv-accent)",
              boxShadow: "0 1px 3px var(--rv-accent-border), inset 0 0 0 0.5px oklch(1 0 0 / 20%)",
            }}
          >
            <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
          </div>
          {/* Browse — active */}
          <div
            className="h-8 w-8 rounded-md flex items-center justify-center"
            style={{
              background: "var(--rv-fill-3)",
              borderLeft: "2px solid var(--rv-accent)",
            }}
          >
            <Globe className="h-4 w-4" style={{ color: "var(--rv-t1)" }} />
          </div>
          {/* Pipeline */}
          <div className="h-8 w-8 rounded-md flex items-center justify-center" style={{ borderLeft: "2px solid transparent" }}>
            <LayoutList className="h-4 w-4" style={{ color: "var(--rv-t3)" }} />
          </div>
          {/* Settings */}
          <div className="h-8 w-8 rounded-md flex items-center justify-center mt-auto" style={{ borderLeft: "2px solid transparent" }}>
            <Settings className="h-4 w-4" style={{ color: "var(--rv-t3)" }} />
          </div>
        </div>

        {/* Browser pane — blurred/stylized listing content */}
        <div className="flex-1 relative overflow-hidden" style={{ background: "#fff" }}>
          {/* Stylized listing page content */}
          <div className="p-5 space-y-3 pointer-events-none" style={{ filter: "blur(1px)", opacity: 0.6 }}>
            {/* Price */}
            <div className="h-7 w-36 rounded-md" style={{ background: "oklch(0 0 0 / 8%)" }} />
            <div className="h-4 w-56 rounded" style={{ background: "oklch(0 0 0 / 5%)" }} />
            <div className="flex gap-3 mt-1">
              <div className="h-4 w-20 rounded" style={{ background: "oklch(0 0 0 / 5%)" }} />
              <div className="h-4 w-20 rounded" style={{ background: "oklch(0 0 0 / 5%)" }} />
              <div className="h-4 w-24 rounded" style={{ background: "oklch(0 0 0 / 5%)" }} />
            </div>
            {/* Hero image placeholder */}
            <div className="h-36 rounded-lg mt-2" style={{ background: "oklch(0 0 0 / 6%)" }} />
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-20 rounded-md" style={{ background: "oklch(0 0 0 / 4%)" }} />
              ))}
            </div>
            <div className="space-y-2 mt-1">
              <div className="h-3 w-full rounded" style={{ background: "oklch(0 0 0 / 4%)" }} />
              <div className="h-3 w-5/6 rounded" style={{ background: "oklch(0 0 0 / 4%)" }} />
              <div className="h-3 w-3/4 rounded" style={{ background: "oklch(0 0 0 / 4%)" }} />
            </div>
          </div>
          {/* Auto-analysis indicator */}
          <div
            className="absolute top-3 right-3 flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-full text-white"
            style={{ background: "var(--rv-accent)", boxShadow: "0 2px 8px var(--rv-accent-border)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white/80 animate-pulse" />
            Analyzing
          </div>
        </div>

        {/* Right: DossierPanel */}
        <div
          className="w-56 shrink-0 flex flex-col border-l overflow-hidden"
          style={{ background: "#fff", borderColor: "var(--rv-fill-border)" }}
        >
          {/* Panel header / collapse control */}
          <div
            className="h-9 shrink-0 flex items-center px-3 border-b"
            style={{ borderColor: "var(--rv-fill-border)", background: "var(--rv-toolbar)" }}
          >
            <div className="h-6 w-6 rounded flex items-center justify-center" style={{ color: "var(--rv-t3)" }}>
              <ChevronRight className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1" />
            <span className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1" style={{ color: "var(--rv-t3)" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--rv-good)" }} />
              Live
            </span>
          </div>

          {/* Identity */}
          <div className="px-4 pt-3.5 pb-3 border-b" style={{ borderColor: "var(--rv-fill-border)" }}>
            <p className="text-[12px] font-semibold leading-tight" style={{ color: "var(--rv-t1)", letterSpacing: "-0.01em" }}>
              4821 Barton Creek Blvd
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--rv-t3)" }}>Austin, TX 78735</p>
            <p className="text-[10px] mt-2 leading-snug" style={{ color: "var(--rv-t2)" }}>
              Solid cash-flowing rental at current asking price.
            </p>
          </div>

          {/* Hero metrics — 3 columns */}
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--rv-fill-border)" }}>
            <div className="grid grid-cols-3 gap-2">
              {/* DSCR */}
              <div className="space-y-1">
                <p className="text-[8px] font-medium uppercase tracking-widest" style={{ color: "var(--rv-t3)" }}>DSCR</p>
                <p className="text-[17px] font-mono font-medium leading-none" style={{ color: "var(--rv-good)", letterSpacing: "-0.01em" }}>1.24</p>
                <p className="text-[8px]" style={{ color: "var(--rv-t3)" }}>comfortable</p>
              </div>
              {/* Cap rate */}
              <div className="space-y-1">
                <p className="text-[8px] font-medium uppercase tracking-widest" style={{ color: "var(--rv-t3)" }}>CAP</p>
                <p className="text-[17px] font-mono font-medium leading-none" style={{ color: "var(--rv-t1)", letterSpacing: "-0.01em" }}>6.2%</p>
                <p className="text-[8px]" style={{ color: "var(--rv-t3)" }}>above floor</p>
              </div>
              {/* Cash flow */}
              <div className="space-y-1">
                <p className="text-[8px] font-medium uppercase tracking-widest" style={{ color: "var(--rv-t3)" }}>CASH</p>
                <p className="text-[17px] font-mono font-medium leading-none" style={{ color: "var(--rv-good)", letterSpacing: "-0.01em" }}>+$340</p>
                <p className="text-[8px]" style={{ color: "var(--rv-t3)" }}>/ month</p>
              </div>
            </div>
          </div>

          {/* Walk-away price — the key metric */}
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--rv-fill-border)" }}>
            <p className="text-[8px] font-medium uppercase tracking-widest mb-1.5" style={{ color: "var(--rv-t3)" }}>Walk-away price</p>
            <p className="text-[22px] font-mono font-semibold leading-none" style={{ color: "var(--rv-t1)", letterSpacing: "-0.025em" }}>$412,000</p>
            <p className="text-[8px] mt-1" style={{ color: "var(--rv-t3)" }}>max offer to clear all thresholds</p>
          </div>

          {/* Verdict */}
          <div className="px-4 py-3">
            <div
              className="rounded-full py-1.5 text-[9px] font-semibold text-center tracking-wide"
              style={{ background: "var(--rv-good-sub)", color: "var(--rv-good)" }}
            >
              Strong deal
            </div>
          </div>

          {/* Assumptions preview */}
          <div className="px-4 pb-4 mt-auto space-y-1.5">
            {[
              { label: "Down payment", val: "25%" },
              { label: "Interest rate", val: "7.25%" },
              { label: "Vacancy", val: "5%" },
            ].map(({ label, val }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[8px]" style={{ color: "var(--rv-t3)" }}>{label}</span>
                <span
                  className="text-[8px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "var(--rv-fill-1)", color: "var(--rv-t2)" }}
                >
                  {val}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const metrics = [
  { icon: DollarSign, label: "Monthly cash flow",  value: "+$340 / mo" },
  { icon: Percent,    label: "Cap rate",            value: "6.2%" },
  { icon: BarChart3,  label: "Cash-on-cash",        value: "8.4%" },
  { icon: TrendingUp, label: "DSCR",                value: "1.24" },
  { icon: ShieldCheck,label: "Walk-away price",     value: "$412,000" },
  { icon: Zap,        label: "Instant verdict",     value: "Strong deal" },
]

const steps = [
  {
    n: "01",
    title: "Open a listing",
    body: "Browse Zillow, Redfin, Realtor.com, or any site inside the app. On web, paste a URL. The moment you land on a property page, the panel wakes up.",
  },
  {
    n: "02",
    title: "Numbers appear",
    body: "The engine reads price, rent estimate, taxes, HOA, and insurance directly from the page — then runs cap rate, DSCR, cash-on-cash, and GRM automatically.",
  },
  {
    n: "03",
    title: "Make a better offer",
    body: "You get the exact walk-away price, a clear pass/warn/fail across five criteria, and every assumption you can tweak. No spreadsheet. No guessing.",
  },
]

const webFeatures = [
  "Cap rate, cash-on-cash, DSCR, GRM",
  "Walk-away price (max offer to still clear)",
  "Paste any listing URL — we read the page",
  "Save deals to your Pipeline",
]

const desktopExtras = [
  "Native browser built in — browse without leaving",
  "Auto-analyzes every listing page you visit",
  "Session persists across listings",
  "Runs entirely on your machine",
]

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#fff" }}>
      <MarketingNav />

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="mx-auto w-full max-w-6xl px-6 pt-16 pb-12 sm:pt-24 sm:pb-16">
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-medium mb-8"
            style={{
              background: "var(--rv-accent-subtle)",
              color: "var(--rv-accent)",
              border: "1px solid var(--rv-accent-border)",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--rv-accent)" }} />
            Built for buy-and-hold rental investors
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            {/* Left — headline + CTAs */}
            <div className="space-y-8">
              <h1
                className="text-[40px] sm:text-[52px] font-bold leading-[1.08] text-balance"
                style={{ color: "var(--rv-t1)", letterSpacing: "-0.03em" }}
              >
                Know your walk-away price before you make an offer.
              </h1>
              <p className="text-[17px] leading-relaxed max-w-[42ch]" style={{ color: "var(--rv-t2)" }}>
                Browse any listing site inside the app. Cap rate, DSCR, cash flow,
                and the exact maximum offer that still clears — all in the panel
                beside the page, without copy-pasting a thing.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/download"
                  className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-full text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: "var(--rv-accent)", boxShadow: "0 4px 14px var(--rv-accent-border)" }}
                >
                  <Monitor className="h-4 w-4" />
                  Download for Mac
                  <span
                    className="ml-0.5 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide"
                    style={{ background: "oklch(1 0 0 / 20%)" }}
                  >
                    FREE
                  </span>
                </Link>
                <Link
                  href="/deals"
                  className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-full text-[14px] font-semibold transition-colors hover:bg-[var(--rv-fill-1)]"
                  style={{
                    color: "var(--rv-t1)",
                    border: "1px solid var(--rv-fill-border-strong)",
                  }}
                >
                  <Globe className="h-4 w-4" />
                  Try web app
                </Link>
              </div>

              <p className="text-[12px]" style={{ color: "var(--rv-t4)" }}>
                macOS 12+ · Apple Silicon &amp; Intel · Free tier available
              </p>
            </div>

            {/* Right — metrics preview strip (visible on mobile above mockup) */}
            <div className="hidden lg:grid grid-cols-2 gap-3">
              {metrics.map((m) => (
                <div
                  key={m.label}
                  className="flex items-center gap-3 rounded-xl p-4"
                  style={{
                    background: "var(--rv-surface-2)",
                    border: "1px solid var(--rv-fill-border)",
                  }}
                >
                  <div
                    className="h-9 w-9 rounded-lg shrink-0 flex items-center justify-center"
                    style={{ background: "white", border: "1px solid var(--rv-fill-border)" }}
                  >
                    <m.icon className="h-4 w-4" style={{ color: "var(--rv-t2)" }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--rv-t3)" }}>
                      {m.label}
                    </p>
                    <p className="text-[14px] font-mono font-semibold" style={{ color: "var(--rv-good)", letterSpacing: "-0.01em" }}>
                      {m.value}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* App mockup — full width below the two-col hero */}
          <div className="mt-14 sm:mt-16">
            <AppMockup />
          </div>

          {/* Mobile metrics strip */}
          <div className="mt-8 grid grid-cols-2 gap-3 lg:hidden">
            {metrics.map((m) => (
              <div
                key={m.label}
                className="flex items-center gap-3 rounded-xl p-3.5"
                style={{
                  background: "var(--rv-surface-2)",
                  border: "1px solid var(--rv-fill-border)",
                }}
              >
                <div
                  className="h-8 w-8 rounded-lg shrink-0 flex items-center justify-center"
                  style={{ background: "white", border: "1px solid var(--rv-fill-border)" }}
                >
                  <m.icon className="h-3.5 w-3.5" style={{ color: "var(--rv-t2)" }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--rv-t3)" }}>
                    {m.label}
                  </p>
                  <p className="text-[13px] font-mono font-semibold" style={{ color: "var(--rv-good)", letterSpacing: "-0.01em" }}>
                    {m.value}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Divider ── */}
        <div className="border-t" style={{ borderColor: "var(--rv-fill-border)" }} />

        {/* ── How it works ── */}
        <section className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <div className="max-w-lg mb-14">
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--rv-accent)" }}>
              How it works
            </p>
            <h2
              className="text-[32px] sm:text-[40px] font-bold leading-[1.1]"
              style={{ color: "var(--rv-t1)", letterSpacing: "-0.025em" }}
            >
              From listing to verdict in under 30 seconds.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {steps.map((s) => (
              <div key={s.n} className="space-y-4">
                <p
                  className="text-[40px] font-bold font-mono leading-none"
                  style={{ color: "var(--rv-fill-border-strong)", letterSpacing: "-0.04em" }}
                >
                  {s.n}
                </p>
                <div
                  className="w-8 h-px"
                  style={{ background: "var(--rv-accent)" }}
                />
                <p
                  className="text-[18px] font-semibold"
                  style={{ color: "var(--rv-t1)", letterSpacing: "-0.015em" }}
                >
                  {s.title}
                </p>
                <p className="text-[14px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Divider ── */}
        <div style={{ height: "1px", background: "var(--rv-fill-border)" }} />

        {/* ── Web vs Desktop ── */}
        <section className="py-20 sm:py-28" style={{ background: "var(--rv-surface-2)" }}>
          <div className="mx-auto w-full max-w-6xl px-6 space-y-12">
            <div className="max-w-lg">
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--rv-accent)" }}>
                Two ways in
              </p>
              <h2
                className="text-[32px] sm:text-[40px] font-bold leading-[1.1]"
                style={{ color: "var(--rv-t1)", letterSpacing: "-0.025em" }}
              >
                Web app or desktop?
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>
                Both analyze deals fully. The desktop app adds a native browser so you never leave the app — just browse and the numbers appear.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Web card */}
              <div
                className="rounded-2xl p-7 space-y-6"
                style={{
                  background: "white",
                  border: "1px solid var(--rv-fill-border)",
                  boxShadow: "0 1px 4px oklch(0 0 0 / 4%)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center"
                    style={{ background: "var(--rv-surface-2)", border: "1px solid var(--rv-fill-border)" }}
                  >
                    <Globe className="h-5 w-5" style={{ color: "var(--rv-t2)" }} />
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold" style={{ color: "var(--rv-t1)" }}>Web App</p>
                    <p className="text-[12px]" style={{ color: "var(--rv-t3)" }}>realverdict.app</p>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {webFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13px]" style={{ color: "var(--rv-t2)" }}>
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--rv-accent)" }} />
                      {f}
                    </li>
                  ))}
                  <li className="flex items-start gap-2.5 text-[13px]" style={{ color: "var(--rv-t4)" }}>
                    <span className="h-4 w-4 text-center shrink-0 mt-0.5 leading-none">—</span>
                    Native browser (desktop only)
                  </li>
                </ul>
                <Link
                  href="/deals"
                  className="inline-flex w-full items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-semibold transition-colors hover:bg-[var(--rv-fill-1)]"
                  style={{ border: "1px solid var(--rv-fill-border-strong)", color: "var(--rv-t1)" }}
                >
                  Open web app
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {/* Desktop card — recommended */}
              <div
                className="rounded-2xl p-7 space-y-6 relative overflow-hidden"
                style={{
                  background: "white",
                  border: "2px solid var(--rv-accent)",
                  boxShadow: "0 4px 16px var(--rv-accent-subtle)",
                }}
              >
                <div
                  className="absolute top-5 right-5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wider text-white"
                  style={{ background: "var(--rv-accent)" }}
                >
                  RECOMMENDED
                </div>
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center"
                    style={{ background: "var(--rv-accent)", boxShadow: "0 2px 8px var(--rv-accent-border)" }}
                  >
                    <Monitor className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold" style={{ color: "var(--rv-t1)" }}>Desktop App</p>
                    <p className="text-[12px]" style={{ color: "var(--rv-t3)" }}>macOS · Free download</p>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {[...webFeatures, ...desktopExtras].map((f, i) => (
                    <li
                      key={f}
                      className="flex items-start gap-2.5 text-[13px]"
                      style={{ color: i >= webFeatures.length ? "var(--rv-t1)" : "var(--rv-t2)", fontWeight: i >= webFeatures.length ? 500 : 400 }}
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--rv-accent)" }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/download"
                  className="inline-flex w-full items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: "var(--rv-accent)" }}
                >
                  <Download className="h-4 w-4" />
                  Download for Mac — Free
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32 text-center space-y-8">
          <h2
            className="text-[36px] sm:text-[48px] font-bold leading-[1.08]"
            style={{ color: "var(--rv-t1)", letterSpacing: "-0.03em" }}
          >
            Stop guessing.<br className="hidden sm:block" /> Start knowing.
          </h2>
          <p className="text-[16px] leading-relaxed max-w-[38ch] mx-auto" style={{ color: "var(--rv-t2)" }}>
            Every offer you make without a walk-away price is a guess. RealVerdict turns any listing into a clear yes, warn, or no — in seconds.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href="/download"
              className="inline-flex items-center justify-center gap-2.5 h-12 px-8 rounded-full text-[15px] font-semibold text-white transition-opacity hover:opacity-90 w-full sm:w-auto"
              style={{ background: "var(--rv-accent)", boxShadow: "0 6px 20px var(--rv-accent-border)" }}
            >
              <Download className="h-4 w-4" />
              Download for Mac
            </Link>
            <Link
              href="/deals"
              className="inline-flex items-center justify-center gap-2 h-12 px-8 rounded-full text-[15px] font-semibold transition-colors hover:bg-[var(--rv-fill-1)] w-full sm:w-auto"
              style={{ color: "var(--rv-t1)", border: "1px solid var(--rv-fill-border-strong)" }}
            >
              <Globe className="h-4 w-4" />
              Try the web app
            </Link>
          </div>
        </section>

        <MarketingFooter />
      </main>
    </div>
  )
}
