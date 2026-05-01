"use client"

import { useState } from "react"
import { Settings as SettingsIcon, User, CreditCard, Sliders, CheckCircle2, Palette, Sun, Moon, Monitor, BookOpen } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DEFAULT_INPUTS } from "@/lib/calculations"
import { cn } from "@/lib/utils"
import { readTheme, setTheme as applyAndPersistTheme, type Theme } from "@/lib/theme"

const DEFAULTS_KEY = "realverdict:defaults:v1"

type AssumptionDefaults = {
  downPaymentPercent: number
  loanInterestRate: number
  vacancyRatePercent: number
  // The original opex is split into maintenance/management/capex; we surface
  // a single combined "operating expenses" knob and split it evenly.
  operatingExpensesPercent: number
}

function readDefaults(): AssumptionDefaults {
  if (typeof window === "undefined") return defaultsFromInputs()
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY)
    if (!raw) return defaultsFromInputs()
    const parsed = JSON.parse(raw) as Partial<AssumptionDefaults>
    const fallback = defaultsFromInputs()
    return {
      downPaymentPercent:
        typeof parsed.downPaymentPercent === "number" ? parsed.downPaymentPercent : fallback.downPaymentPercent,
      loanInterestRate:
        typeof parsed.loanInterestRate === "number" ? parsed.loanInterestRate : fallback.loanInterestRate,
      vacancyRatePercent:
        typeof parsed.vacancyRatePercent === "number" ? parsed.vacancyRatePercent : fallback.vacancyRatePercent,
      operatingExpensesPercent:
        typeof parsed.operatingExpensesPercent === "number" ? parsed.operatingExpensesPercent : fallback.operatingExpensesPercent,
    }
  } catch {
    return defaultsFromInputs()
  }
}

function defaultsFromInputs(): AssumptionDefaults {
  return {
    downPaymentPercent: DEFAULT_INPUTS.downPaymentPercent,
    loanInterestRate:   DEFAULT_INPUTS.loanInterestRate,
    vacancyRatePercent: DEFAULT_INPUTS.vacancyRatePercent,
    operatingExpensesPercent:
      DEFAULT_INPUTS.maintenancePercent +
      DEFAULT_INPUTS.propertyManagementPercent +
      DEFAULT_INPUTS.capexReservePercent,
  }
}

export default function SettingsPage() {
  return (
    <SidebarInset>
      <header className="rv-toolbar-strip drag-region h-14 flex items-center gap-3 px-4 shrink-0 select-none">
        <SidebarTrigger className="-ml-1 no-drag-region" />
        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground"
             style={{ letterSpacing: "-0.012em" }}>
          <SettingsIcon className="h-4 w-4" />
          <span>Settings</span>
        </div>
      </header>

      <div className="p-8 max-w-2xl space-y-10 no-drag-region overflow-auto">
        <ProfileCard />
        <AppearanceCard />
        <DefaultsCard />
        <SubscriptionCard />
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// Appearance — theme switcher.
//
// Renders 4 mini swatches the user can click to pick: Dark / Light /
// System / Paper. The active swatch carries a subtle ring + accent label.
// We persist + apply on click; no separate Save button — the change is
// the action.
// ---------------------------------------------------------------------------

function AppearanceCard() {
  // Lazy initializer: read once during the first render. readTheme()
  // already guards against SSR (returns "system" when window is
  // undefined), so we don't need a separate useEffect — that pattern
  // would also trip the cascading-renders lint.
  const [theme, setTheme] = useState<Theme>(() => readTheme())

  const onPick = (t: Theme) => {
    setTheme(t)
    applyAndPersistTheme(t)
  }

  return (
    <SettingsSection
      icon={<Palette className="h-4 w-4 text-muted-foreground/80" />}
      title="Appearance"
      description="Pick the surface that fits how you read numbers. Paper is the warm scrapbook variant — calmer than light mode, easier on the eyes for long sessions."
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ThemeSwatch
          theme="dark"
          label="Dark"
          icon={<Moon className="h-3.5 w-3.5" />}
          active={theme === "dark"}
          onPick={onPick}
          tones={{ bg: "#0a0a0b", surface: "#1a1a1f", text: "#f5f5f5", accent: "#e8e0c8" }}
        />
        <ThemeSwatch
          theme="light"
          label="Light"
          icon={<Sun className="h-3.5 w-3.5" />}
          active={theme === "light"}
          onPick={onPick}
          tones={{ bg: "#fafafa", surface: "#ffffff", text: "#101014", accent: "#5b6b88" }}
        />
        <ThemeSwatch
          theme="system"
          label="System"
          icon={<Monitor className="h-3.5 w-3.5" />}
          active={theme === "system"}
          onPick={onPick}
          // Half-and-half preview: literal split so the user sees the
          // theme follows the OS. The "card" reads on both halves.
          tones={{ bg: "linear-gradient(90deg,#0a0a0b 0 50%,#fafafa 50% 100%)", surface: "transparent", text: "#9ca3af", accent: "#9ca3af" }}
        />
        <ThemeSwatch
          theme="paper"
          label="Paper"
          icon={<BookOpen className="h-3.5 w-3.5" />}
          active={theme === "paper"}
          onPick={onPick}
          tones={{ bg: "#f4ecdc", surface: "#ede1c8", text: "#3a2c1a", accent: "#a98041" }}
        />
      </div>
    </SettingsSection>
  )
}

function ThemeSwatch({
  theme, label, icon, active, onPick, tones,
}: {
  theme: Theme
  label: string
  icon: React.ReactNode
  active: boolean
  onPick: (t: Theme) => void
  tones: { bg: string; surface: string; text: string; accent: string }
}) {
  // The preview is a real mini fintech card, not three thin bars. Each
  // swatch is a horizontal "screenshot" of the theme: header strip, a
  // chunky number stand-in (DSCR), and a label dot. Sized so all four
  // sit at exactly the same height in the 4-up grid.
  return (
    <button
      type="button"
      onClick={() => onPick(theme)}
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg p-2 text-left transition-all w-full",
        "border bg-transparent",
        active
          ? "border-[var(--rv-accent-border)]"
          : "border-[var(--rv-fill-border)] hover:border-[var(--rv-fill-border-strong)]",
      )}
      aria-pressed={active}
    >
      <div
        className="relative w-full aspect-[16/9] rounded-md overflow-hidden border border-black/5"
        style={{ background: tones.bg }}
      >
        {/* Sidebar rail */}
        <div
          className="absolute left-0 top-0 bottom-0 w-2"
          style={{ background: tones.surface, opacity: 0.55 }}
        />
        {/* Card */}
        <div
          className="absolute left-3 right-1.5 top-1.5 bottom-1.5 rounded-[3px] p-1.5 flex flex-col justify-between"
          style={{ background: tones.surface }}
        >
          {/* "label" line */}
          <div className="flex items-center gap-1">
            <span
              className="block h-[3px] w-2 rounded-full"
              style={{ background: tones.accent }}
            />
            <span
              className="block h-[3px] w-3 rounded-full opacity-60"
              style={{ background: tones.text }}
            />
          </div>
          {/* "DSCR" hero number — chunky bar */}
          <div
            className="block h-1.5 w-1/2 rounded-[1px]"
            style={{ background: tones.text }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between px-0.5">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground">
          {icon}
          {label}
        </span>
        {active && (
          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--rv-accent)]" />
        )}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileCard() {
  // Lazy initializers read once during the first render. The previous
  // useEffect+setState pattern triggers React's cascading-renders lint.
  const [name, setName] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("realverdict:profile:name") ?? ""
  )
  const [email, setEmail] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("realverdict:profile:email") ?? ""
  )
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    if (typeof window === "undefined") return
    localStorage.setItem("realverdict:profile:name", name)
    localStorage.setItem("realverdict:profile:email", email)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <SettingsSection
      icon={<User className="h-4 w-4 text-muted-foreground/80" />}
      title="Profile"
      description="Your account information."
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/55">Name</Label>
          <div className="rv-input flex items-center px-3 py-2">
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email" className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/55">Email</Label>
          <div className="rv-input flex items-center px-3 py-2">
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
      </div>
      <Button size="sm" onClick={handleSave} className="mt-1">
        {saved ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Saved</> : "Save changes"}
      </Button>
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------------
// SettingsSection — borderless card replacement.
// Uses spacing + a single hairline divider between sections (provided by
// the parent's space-y) instead of a visible 1px box around each section.
// ---------------------------------------------------------------------------
function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-5">
      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground"
              style={{ letterSpacing: "-0.012em" }}>
            {title}
          </h2>
        </div>
        <p className="text-[12px] text-muted-foreground/65 leading-relaxed">{description}</p>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Defaults — assumption knobs that pre-fill every new analysis
// ---------------------------------------------------------------------------

function DefaultsCard() {
  // Lazy initializer: readDefaults already SSR-guards so it returns
  // factory defaults on the server, and the persisted values in the
  // browser. Avoids the cascading-renders effect pattern.
  const [defaults, setDefaults] = useState<AssumptionDefaults>(() => readDefaults())
  const [saved, setSaved] = useState(false)

  const update = (k: keyof AssumptionDefaults, v: string) => {
    const num = parseFloat(v)
    if (!Number.isFinite(num)) return
    setDefaults((d) => ({ ...d, [k]: num }))
  }

  const handleSave = () => {
    if (typeof window === "undefined") return
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(defaults))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    const next = defaultsFromInputs()
    setDefaults(next)
    if (typeof window !== "undefined") {
      localStorage.setItem(DEFAULTS_KEY, JSON.stringify(next))
    }
  }

  return (
    <SettingsSection
      icon={<Sliders className="h-4 w-4 text-muted-foreground/80" />}
      title="Default assumptions"
      description="Pre-fill these on every new listing so you don't have to re-edit each time."
    >
      <div className="grid grid-cols-2 gap-4">
        <DefaultField
          label="Down payment"
          value={defaults.downPaymentPercent}
          suffix="%"
          onChange={(v) => update("downPaymentPercent", v)}
        />
        <DefaultField
          label="Interest rate"
          value={defaults.loanInterestRate}
          suffix="%"
          onChange={(v) => update("loanInterestRate", v)}
        />
        <DefaultField
          label="Vacancy"
          value={defaults.vacancyRatePercent}
          suffix="%"
          onChange={(v) => update("vacancyRatePercent", v)}
        />
        <DefaultField
          label="Operating expenses"
          value={defaults.operatingExpensesPercent}
          suffix="% of rent"
          onChange={(v) => update("operatingExpensesPercent", v)}
        />
      </div>
      <div className="flex items-center gap-4 pt-1">
        <Button size="sm" onClick={handleSave}>
          {saved ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Saved</> : "Save defaults"}
        </Button>
        <button
          onClick={handleReset}
          className="text-[12px] text-muted-foreground hover:text-foreground transition-colors duration-100"
        >
          Reset to factory
        </button>
      </div>
    </SettingsSection>
  )
}

function DefaultField({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string
  value: number
  suffix?: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/55">{label}</Label>
      <div className="rv-input flex items-center gap-2 px-3 py-2">
        <input
          type="text"
          inputMode="decimal"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent p-0 text-sm font-mono rv-num"
        />
        {suffix && (
          <span className="text-[11px] font-mono text-muted-foreground/55 shrink-0">{suffix}</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

function SubscriptionCard() {
  return (
    <SettingsSection
      icon={<CreditCard className="h-4 w-4 text-muted-foreground/80" />}
      title="Subscription"
      description="Manage your billing and plan."
    >
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-[13px] font-medium text-foreground">Pro</p>
          <p className="text-[11px] text-muted-foreground/65 font-mono rv-num">$12 / month, billed monthly</p>
        </div>
        <Button variant="outline" size="sm">Manage</Button>
      </div>
    </SettingsSection>
  )
}
