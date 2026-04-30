"use client"

import { useEffect, useState } from "react"
import { Settings as SettingsIcon, User, CreditCard, Sliders, CheckCircle2 } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
      <header className="h-14 flex items-center gap-3 border-b border-border px-4 shrink-0">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <SettingsIcon className="h-4 w-4" />
          <span>Settings</span>
        </div>
      </header>

      <div className="p-6 max-w-2xl space-y-6">
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
    <Card className="bg-card/50">
      <CardHeader>
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Profile</CardTitle>
        </div>
        <CardDescription>Your account information.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-[12px]">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[12px]">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background"
            />
          </div>
        </div>
        <Button size="sm" onClick={handleSave}>
          {saved ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Saved</> : "Save changes"}
        </Button>
      </CardContent>
    </Card>
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
    <Card className="bg-card/50">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Default assumptions</CardTitle>
        </div>
        <CardDescription>
          Pre-fill these on every new listing so you don&rsquo;t have to re-edit each time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={handleSave}>
            {saved ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Saved</> : "Save defaults"}
          </Button>
          <button
            onClick={handleReset}
            className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset to factory
          </button>
        </div>
      </CardContent>
    </Card>
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
      <Label className="text-[12px]">{label}</Label>
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
        <Input
          type="text"
          inputMode="decimal"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="border-0 bg-transparent p-0 h-auto text-sm font-mono tabular-nums focus-visible:ring-0 focus-visible:ring-offset-0"
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
    <Card className="bg-card/50">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Subscription</CardTitle>
        </div>
        <CardDescription>Manage your billing and plan.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-foreground">Pro</p>
            <p className="text-[11px] text-muted-foreground/65">$12 / month, billed monthly</p>
          </div>
          <Button variant="outline" size="sm">Manage</Button>
        </div>
      </CardContent>
    </Card>
  )
}
