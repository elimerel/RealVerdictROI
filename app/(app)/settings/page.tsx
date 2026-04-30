"use client"

import { useEffect, useState } from "react"
import { Settings as SettingsIcon, User, CreditCard, Sliders, CheckCircle2 } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DEFAULT_INPUTS } from "@/lib/calculations"

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
      <header className="drag-region h-14 flex items-center gap-3 border-b border-border px-4 shrink-0 select-none">
        <SidebarTrigger className="-ml-1 no-drag-region" />
        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground"
             style={{ letterSpacing: "-0.012em" }}>
          <SettingsIcon className="h-4 w-4" />
          <span>Settings</span>
        </div>
      </header>

      <div className="p-8 max-w-2xl space-y-10 no-drag-region">
        <ProfileCard />
        <DefaultsCard />
        <SubscriptionCard />
      </div>
    </SidebarInset>
  )
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileCard() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    setName(localStorage.getItem("realverdict:profile:name") ?? "")
    setEmail(localStorage.getItem("realverdict:profile:email") ?? "")
  }, [])

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
  const [defaults, setDefaults] = useState<AssumptionDefaults>(defaultsFromInputs)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDefaults(readDefaults())
  }, [])

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
