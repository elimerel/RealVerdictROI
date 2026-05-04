"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTopBarSlots } from "@/lib/topBarSlots"
import { Slider } from "@/components/ui/slider"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Trash2,
  Sliders,
  ShieldCheck,
  Command,
  Info,
  Palette,
} from "lucide-react"
import { useSidebar, SNAP_ICONS } from "@/components/sidebar/context"
import { createClient } from "@/lib/supabase/client"
import type { InvestmentPrefs, ThemePicked, MapStyleKey } from "@/lib/electron"
import { PREFS_CHANGED_EVENT } from "@/lib/useMapStyle"

// ── Section frame ─────────────────────────────────────────────────────────
//
// Each section is its own anchored block (id from the slug) with a
// bigger title, an optional icon, an optional description, then a
// hairline gradient divider, then a lifted card holding the section's
// content. Same magazine-style hierarchy used on the workstation
// start screen — premium and breathable.

function SettingsSection({
  id, title, description, icon, children,
}: {
  id:           string
  title:        string
  description?: string
  icon?:        React.ReactNode
  children:     React.ReactNode
}) {
  return (
    <section id={id} className="flex flex-col gap-4 scroll-mt-12">
      <div className="flex items-center gap-3">
        {icon && <span style={{ color: "var(--rv-accent)" }}>{icon}</span>}
        <h2
          className="leading-tight font-semibold tracking-tight"
          style={{
            color:    "var(--rv-t1)",
            fontSize: 20,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </h2>
      </div>
      {description && (
        <p className="text-[13px] leading-relaxed max-w-[560px]" style={{ color: "var(--rv-t3)" }}>
          {description}
        </p>
      )}
      <Card className="flex flex-col gap-5 mt-1 p-5">
        {children}
      </Card>
    </section>
  )
}

// ── Slider row (percent value) ────────────────────────────────────────────

function PercentRow({
  label, hint, value, min, max, step, onChange,
}: {
  label:     string
  hint?:     string
  value:     number
  min:       number
  max:       number
  step:      number
  onChange:  (v: number) => void
}) {
  return (
    <div className="flex items-center gap-5">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium leading-tight" style={{ color: "var(--rv-t1)" }}>
          {label}
        </p>
        {hint && (
          <p className="text-[11.5px] leading-snug mt-1" style={{ color: "var(--rv-t4)" }}>
            {hint}
          </p>
        )}
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(Array.isArray(v) ? (v[0] ?? value) : v)}
        className="flex-1 max-w-[200px]"
      />
      <span
        className="w-[56px] text-right tabular-nums text-[13px] font-medium"
        style={{ color: "var(--rv-t1)" }}
      >
        {(value * 100).toFixed(value < 0.1 && step < 0.005 ? 1 : 0)}%
      </span>
    </div>
  )
}

function BpsRow({
  label, hint, value, onChange,
}: {
  label:    string
  hint?:    string
  value:    number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-5">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium leading-tight" style={{ color: "var(--rv-t1)" }}>
          {label}
        </p>
        {hint && (
          <p className="text-[11.5px] leading-snug mt-1" style={{ color: "var(--rv-t4)" }}>
            {hint}
          </p>
        )}
      </div>
      <Slider
        min={0}
        max={150}
        step={5}
        value={[value]}
        onValueChange={(v) => onChange(Array.isArray(v) ? (v[0] ?? value) : v)}
        className="flex-1 max-w-[200px]"
      />
      <span
        className="w-[56px] text-right tabular-nums text-[13px] font-medium"
        style={{ color: "var(--rv-t1)" }}
      >
        +{value} bps
      </span>
    </div>
  )
}

// ── Theme Picker ──────────────────────────────────────────────────────────
//
// Five visual cards in a row: System / Dark / Warm Charcoal / Cinema /
// Light. Each card shows a mini preview of what its theme looks like,
// the active card has the standard accent-bar marker. Click sets the
// theme via electronAPI.setTheme — main applies vibrancy + nativeTheme
// + backgroundColor + persists, then broadcasts theme:changed which the
// (app) layout's ThemeHydrator catches and applies the html class.

interface ThemeOptionDef {
  picked:  ThemePicked
  label:   string
  /** Surface, lifted-card, accent-line tones that drive the preview. */
  preview: { bg: string; surface: string; line: string }
  /** When true, render the card as a split (half dark / half light) so
   *  the System option visually communicates "follows your mac." */
  split?:  boolean
}

const THEME_OPTIONS_DEF: ThemeOptionDef[] = [
  { picked: "system",        label: "System",   preview: { bg: "#0d0d0f", surface: "#1e1e22", line: "#30a46c" }, split: true },
  { picked: "dark",          label: "Dark",     preview: { bg: "#0d0d0f", surface: "#1e1e22", line: "#30a46c" } },
  { picked: "charcoal-warm", label: "Charcoal", preview: { bg: "#16120e", surface: "#2c241c", line: "#30a46c" } },
  { picked: "light",         label: "Light",    preview: { bg: "#f5f5f7", surface: "#ffffff", line: "#30a46c" } },
]

function ThemePickerSection() {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined
  const [active, setActive] = useState<ThemePicked | null>(null)

  // Hydrate from main on mount and listen for changes (e.g. system flip).
  useEffect(() => {
    // Optimistic seed from localStorage so the active card is correct on
    // first paint even before the IPC round-trip resolves.
    try {
      const saved = localStorage.getItem("rv-theme") as ThemePicked | null
      if (saved) setActive(saved)
    } catch {}
    if (!api?.getTheme) return
    api.getTheme().then((t) => setActive(t.picked)).catch(() => {})
    const off = api.onThemeChanged?.(({ picked }) => setActive(picked))
    return () => { off?.() }
  }, [api])

  const choose = useCallback((theme: ThemePicked) => {
    setActive(theme) // optimistic UI

    // Apply the class IMMEDIATELY in the renderer so the user sees a
    // visible change on click — don't wait for the IPC round-trip +
    // broadcast back. This way the picker works even if the native side
    // is slow or the broadcast doesn't fire for some reason.
    let resolved: string = theme
    if (theme === "system") {
      resolved = (typeof window !== "undefined" && window.matchMedia &&
                  window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"
    }
    const cls = document.documentElement.classList
    cls.remove("theme-charcoal-warm", "theme-charcoal-cinema", "theme-light")
    if (resolved === "charcoal-warm") cls.add("theme-charcoal-warm")
    if (resolved === "light")         cls.add("theme-light")
    if (resolved === "light") cls.remove("dark"); else cls.add("dark")

    try { localStorage.setItem("rv-theme", theme) } catch {}
    // Native side (vibrancy + window bg + persistence). Fire-and-forget;
    // the visible change already happened above.
    void api?.setTheme?.(theme)
  }, [api])

  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      description="Pick how RealVerdict looks. System follows your macOS appearance preference; the others are explicit."
      icon={<Palette size={14} strokeWidth={1.7} />}
    >
      <div className="flex flex-wrap gap-2.5">
        {THEME_OPTIONS_DEF.map((opt) => {
          const isActive = active === opt.picked
          return (
            <button
              key={opt.picked}
              onClick={() => choose(opt.picked)}
              aria-pressed={isActive}
              className="group relative flex flex-col items-stretch text-left transition-transform duration-100"
              style={{
                width:  104,
                cursor: "default",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.02)" }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)" }}
            >
              {/* Preview card — visually mirrors the theme it represents. */}
              <div
                className="relative rounded-[10px] overflow-hidden"
                style={{
                  height:     72,
                  border:     `0.5px solid ${isActive ? "var(--rv-accent-border)" : "var(--rv-border)"}`,
                  background: opt.preview.bg,
                  boxShadow:  isActive ? "0 0 0 1px var(--rv-accent-border)" : "none",
                }}
              >
                {/* For System, paint a diagonal split so the card communicates
                    "this adapts." Half left = dark surface, half right = light. */}
                {opt.split && (
                  <div
                    className="absolute inset-0"
                    style={{
                      background: "linear-gradient(110deg, #0d0d0f 0%, #0d0d0f 49%, #f5f5f7 51%, #f5f5f7 100%)",
                    }}
                  />
                )}
                {/* A representative "card" inside the preview — same trick
                    Mercury / Linear use to make their theme thumbnails feel
                    like the real surface. */}
                <div
                  className="absolute"
                  style={{
                    left:         12,
                    right:        12,
                    bottom:       10,
                    height:       28,
                    borderRadius: 5,
                    background:   opt.split ? "rgba(255,255,255,0.10)" : opt.preview.surface,
                    border:       opt.picked === "light" ? "0.5px solid rgba(0,0,0,0.08)" : "0.5px solid rgba(255,255,255,0.08)",
                  }}
                />
                {/* Tiny accent-line — the forest green is consistent across
                    every theme, so it shows up identically in every preview. */}
                <div
                  className="absolute"
                  style={{
                    left:         12,
                    top:          12,
                    width:        24,
                    height:       3,
                    borderRadius: 2,
                    background:   opt.preview.line,
                  }}
                />
                {/* Active-state checkmark in the corner. */}
                {isActive && (
                  <div
                    className="absolute inline-flex items-center justify-center rounded-full"
                    style={{
                      top:        6,
                      right:      6,
                      width:      16,
                      height:     16,
                      background: "var(--rv-accent)",
                      color:      "#0a0a0c",
                    }}
                  >
                    <Check size={10} strokeWidth={2.6} />
                  </div>
                )}
              </div>
              <span
                className="mt-2 text-[12px] tracking-tight text-center"
                style={{
                  color:      isActive ? "var(--rv-t1)" : "var(--rv-t2)",
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                {opt.label}
              </span>
            </button>
          )
        })}
      </div>
    </SettingsSection>
  )
}

// ── Map appearance ────────────────────────────────────────────────────────
//
// Picker for the persistent Mapbox shell's style. "Auto" follows the
// current app theme (dark in charcoal, light in light). Specific keys
// override theme. Live-updates the mounted MapShell via a custom
// "rv:prefs-changed" event — no remount, no reload.

const MAP_STYLE_OPTIONS: Array<{ key: MapStyleKey; label: string; preview: string }> = [
  { key: "auto",                    label: "Auto · follow theme", preview: "linear-gradient(135deg,#2a2a2a 0%,#2a2a2a 49%,#f5f5f7 51%,#f5f5f7 100%)" },
  { key: "dark-v11",                label: "Dark",                preview: "#1a1d23" },
  { key: "light-v11",               label: "Light",               preview: "#eef0f2" },
  { key: "streets-v12",             label: "Streets",             preview: "linear-gradient(180deg,#dfe6e3 0%,#cdd9d6 100%)" },
  { key: "outdoors-v12",            label: "Outdoors",            preview: "linear-gradient(180deg,#d8e3c9 0%,#bdcca9 100%)" },
  { key: "navigation-night-v1",     label: "Navigation night",    preview: "#0e1118" },
  { key: "satellite-streets-v12",   label: "Satellite",           preview: "linear-gradient(135deg,#3a4f31 0%,#5b6b3e 60%,#a8a07a 100%)" },
]

function MapStyleSection() {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined
  const [active, setActive] = useState<MapStyleKey>("auto")

  useEffect(() => {
    let cancelled = false
    api?.getInvestmentPrefs?.().then((p) => {
      if (cancelled) return
      setActive((p.mapStyle as MapStyleKey | undefined) ?? "auto")
    })
    return () => { cancelled = true }
  }, [api])

  const choose = useCallback((key: MapStyleKey) => {
    setActive(key) // optimistic
    void api?.setInvestmentPrefs?.({ mapStyle: key })
    // Broadcast so the persistent MapShell + any other listeners
    // re-fetch and apply the change without remounting.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT))
    }
  }, [api])

  return (
    <SettingsSection
      id="map-appearance"
      title="Map appearance"
      description="The look of the persistent map behind Browse and inside Pipeline. Auto matches your theme; specific styles override it."
      icon={<Palette size={14} strokeWidth={1.7} />}
    >
      <div className="flex flex-wrap gap-2.5">
        {MAP_STYLE_OPTIONS.map((opt) => {
          const isActive = active === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => choose(opt.key)}
              aria-pressed={isActive}
              className="group relative flex flex-col items-stretch text-left transition-transform duration-100"
              style={{ width: 120, cursor: "default" }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.02)" }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)" }}
            >
              <div
                className="relative rounded-[10px] overflow-hidden"
                style={{
                  height:     64,
                  border:     `0.5px solid ${isActive ? "var(--rv-accent-border)" : "var(--rv-border)"}`,
                  background: opt.preview,
                  boxShadow:  isActive ? "0 0 0 1px var(--rv-accent-border)" : "none",
                }}
              >
                {/* Tiny pin in the corner so each preview reads as
                    "this is a map," not just a colored rectangle. */}
                <span
                  className="absolute"
                  style={{
                    bottom: 8, right: 10,
                    width: 7, height: 7, borderRadius: 99,
                    background: "var(--rv-accent)",
                    border: "1.2px solid rgba(255,255,255,0.92)",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
                  }}
                />
              </div>
              <p
                className="mt-2 text-[12px] font-medium tracking-tight"
                style={{ color: isActive ? "var(--rv-accent)" : "var(--rv-t2)" }}
              >
                {opt.label}
              </p>
            </button>
          )
        })}
      </div>
    </SettingsSection>
  )
}

// ── Investment Defaults ───────────────────────────────────────────────────

function InvestmentDefaultsSection() {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined
  const [prefs, setPrefs] = useState<InvestmentPrefs | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    api?.getInvestmentPrefs?.().then((p) => { if (!cancelled) setPrefs(p) })
    return () => { cancelled = true }
  }, [api])

  const update = useCallback((patch: Partial<InvestmentPrefs>) => {
    setPrefs((prev) => prev ? { ...prev, ...patch } : prev)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void api?.setInvestmentPrefs?.(patch)
    }, 350) // debounce slider drags
  }, [api])

  if (!prefs) return null

  return (
    <SettingsSection
      id="investment-defaults"
      title="Investment defaults"
      description="The assumptions used when analyzing every listing. Tune to match how you actually underwrite — these flow straight into Cash Flow / Cap Rate / DSCR."
      icon={<Sliders size={14} strokeWidth={1.7} />}
    >
      <PercentRow
        label="Down payment"
        hint="What you put down as a percent of price."
        value={prefs.downPaymentPct}
        min={0.05} max={0.5} step={0.01}
        onChange={(v) => update({ downPaymentPct: v })}
      />
      <PercentRow
        label="Vacancy"
        hint="Months empty per year, as a percent of gross rent."
        value={prefs.vacancyPct}
        min={0} max={0.15} step={0.005}
        onChange={(v) => update({ vacancyPct: v })}
      />
      <PercentRow
        label="Management"
        hint="Property management fee, percent of collected rent."
        value={prefs.managementPct}
        min={0} max={0.15} step={0.005}
        onChange={(v) => update({ managementPct: v })}
      />
      <PercentRow
        label="Maintenance"
        hint="Routine repairs reserve, percent of gross rent."
        value={prefs.maintenancePct}
        min={0} max={0.15} step={0.005}
        onChange={(v) => update({ maintenancePct: v })}
      />
      <PercentRow
        label="CapEx reserve"
        hint="Capital improvements reserve, percent of gross rent."
        value={prefs.capexPct}
        min={0} max={0.15} step={0.005}
        onChange={(v) => update({ capexPct: v })}
      />
      <BpsRow
        label="Rate adjustment"
        hint="Basis points added on top of the FRED-quoted 30Y rate for investor loans."
        value={prefs.rateAdjustmentBps}
        onChange={(v) => update({ rateAdjustmentBps: v })}
      />

      {/* Personal "buy bar" — when set, the analysis panel renders a
          quiet "above bar" / "below bar" pill on each metric card.
          Not a verdict; just memory of the user's own criteria so
          they don't have to re-evaluate from scratch on every listing.
          Empty = no bar = no pill rendered for that metric. */}
      <div
        className="mt-2 pt-5"
        style={{ borderTop: "0.5px solid var(--rv-border)" }}
      >
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--rv-accent)" }}>
          Your buy bar
        </p>
        <p className="text-[12px] leading-snug mb-4" style={{ color: "var(--rv-t3)" }}>
          Optional. The numbers you actually buy at. Each metric in the panel will quietly say "above bar" or "below bar" — not a score, just memory of your criteria.
        </p>
        <div className="flex flex-col gap-3.5">
          <ThresholdRow
            label="Min cap rate"
            hint="e.g., 6 = won't buy below 6% cap"
            unit="%"
            value={prefs.minCapRate ?? null}
            onChange={(v) => update({ minCapRate: v == null ? null : v / 100 })}
            displayScale={100}
            placeholder="6"
          />
          <ThresholdRow
            label="Min cash flow"
            hint="e.g., 200 = won't buy below $200/mo"
            unit="$/mo"
            value={prefs.minCashFlow ?? null}
            onChange={(v) => update({ minCashFlow: v })}
            placeholder="200"
          />
          <ThresholdRow
            label="Min DSCR"
            hint="e.g., 1.20 = won't buy below 1.2× debt coverage"
            unit="×"
            value={prefs.minDscr ?? null}
            onChange={(v) => update({ minDscr: v })}
            placeholder="1.20"
            allowDecimal
          />
        </div>
      </div>
    </SettingsSection>
  )
}

// ── Threshold row ────────────────────────────────────────────────────
// Used for the "buy bar" personal-criteria thresholds. Empty input =
// null = bar disabled (no pill rendered for that metric). All three
// rows share this so the visual rhythm in Settings is consistent.

function ThresholdRow({
  label, hint, unit, value, onChange, placeholder, displayScale = 1, allowDecimal,
}: {
  label:        string
  hint:         string
  unit:         string
  value:        number | null
  onChange:     (v: number | null) => void
  placeholder:  string
  /** Scale factor for display — e.g., 100 to show 0.06 as "6". */
  displayScale?: number
  allowDecimal?: boolean
}) {
  const display = value == null ? "" : String(value * displayScale)
  return (
    <div className="flex items-center gap-5">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium leading-tight" style={{ color: "var(--rv-t1)" }}>
          {label}
        </p>
        <p className="text-[11.5px] leading-snug mt-1" style={{ color: "var(--rv-t4)" }}>
          {hint}
        </p>
      </div>
      <div
        className="inline-flex items-center gap-1.5 rounded-[7px]"
        style={{
          background: "var(--rv-elev-2)",
          border:     "0.5px solid var(--rv-border)",
          padding:    "5px 10px",
          width:      130,
          // contain the input so its default min-width (which is wider
          // than the box) doesn't push the unit chip outside.
          minWidth:   0,
        }}
      >
        <input
          type="text"
          inputMode={allowDecimal ? "decimal" : "numeric"}
          value={display}
          placeholder={placeholder}
          onChange={(e) => {
            const cleaned = allowDecimal
              ? e.target.value.replace(/[^0-9.]/g, "")
              : e.target.value.replace(/[^0-9]/g, "")
            if (cleaned === "" || cleaned === ".") { onChange(null); return }
            const n = Number(cleaned)
            if (!Number.isFinite(n)) { onChange(null); return }
            onChange(n / displayScale)
          }}
          // min-w-0 on the input so flex-1 actually shrinks it below
          // the browser's default ~150px min-width — was pushing the
          // unit (%, $/mo, ×) clean out of the box.
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] tabular-nums font-medium"
          style={{ color: "var(--rv-t1)" }}
          size={1}
        />
        <span className="text-[11.5px] shrink-0" style={{ color: "var(--rv-t4)" }}>{unit}</span>
      </div>
    </div>
  )
}

// ── Privacy & Data ────────────────────────────────────────────────────────

function PrivacyDataSection() {
  const [clearing,  setClearing]  = useState<"history" | "deals" | null>(null)
  const [confirm,   setConfirm]   = useState<"history" | "deals" | null>(null)

  const onClearHistory = useCallback(async () => {
    setClearing("history")
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from("browse_history").delete().eq("user_id", user.id)
      }
    } finally {
      setClearing(null)
      setConfirm(null)
    }
  }, [])

  const onDeleteAllDeals = useCallback(async () => {
    setClearing("deals")
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from("saved_deals").delete().eq("user_id", user.id)
      }
    } finally {
      setClearing(null)
      setConfirm(null)
    }
  }, [])

  return (
    <SettingsSection
      id="privacy"
      title="Privacy & data"
      description="RealVerdict only logs listing-domain URLs, never general browsing. Everything's stored under your account; you can wipe it any time."
      icon={<ShieldCheck size={14} strokeWidth={1.7} />}
    >
      <DataRow
        label="Browse history"
        hint="The list of listings the embedded browser has loaded. Powers Recent Listings + the personalized greeting."
        actionLabel="Clear history"
        onAction={() => setConfirm("history")}
        confirming={confirm === "history"}
        loading={clearing === "history"}
        onConfirm={onClearHistory}
        onCancel={() => setConfirm(null)}
      />
      <DataRow
        label="All saved deals"
        hint="Every deal in your Pipeline (across every stage). This is destructive — your snapshots, tags, notes, and stage history are gone forever."
        actionLabel="Delete all deals"
        destructive
        onAction={() => setConfirm("deals")}
        confirming={confirm === "deals"}
        loading={clearing === "deals"}
        onConfirm={onDeleteAllDeals}
        onCancel={() => setConfirm(null)}
      />
    </SettingsSection>
  )
}

function DataRow({
  label, hint, actionLabel, destructive, onAction, confirming, loading, onConfirm, onCancel,
}: {
  label:       string
  hint:        string
  actionLabel: string
  destructive?: boolean
  onAction:    () => void
  confirming:  boolean
  loading:     boolean
  onConfirm:   () => void
  onCancel:    () => void
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium leading-tight" style={{ color: "var(--rv-t1)" }}>
          {label}
        </p>
        <p className="text-[11px] leading-relaxed mt-1" style={{ color: "var(--rv-t4)" }}>
          {hint}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {confirming ? (
          <>
            <Button
              onClick={onConfirm}
              disabled={loading}
              variant={destructive ? "destructive" : "secondary"}
              size="sm"
            >
              {loading ? "Working…" : "Confirm"}
            </Button>
            <Button onClick={onCancel} variant="ghost" size="sm">
              Cancel
            </Button>
          </>
        ) : (
          <Button onClick={onAction} variant="secondary" size="sm">
            {destructive && <Trash2 size={11} strokeWidth={2} />}
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────

function ShortcutsSection() {
  const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
  const mod = isMac ? "⌘" : "Ctrl"
  const shortcuts = [
    { keys: `${mod} K`,       desc: "Open command palette" },
    { keys: `${mod} S`,       desc: "Save current listing to Watching" },
    { keys: `${mod} L`,       desc: "Focus the URL bar" },
    { keys: `${mod} R`,       desc: "Reload the current page" },
    { keys: `${mod} \\`,      desc: "Toggle the sidebar" },
    { keys: `${mod} 1`,       desc: "Jump to Browse" },
    { keys: `${mod} 2`,       desc: "Jump to Pipeline" },
    { keys: `${mod} 3`,       desc: "Jump to Settings" },
    { keys: `${mod} ⌥ I`,     desc: "Open developer tools" },
    { keys: `${mod}-click`,   desc: "Multi-select deals to compare" },
  ]
  return (
    <SettingsSection
      id="shortcuts"
      title="Keyboard shortcuts"
      description="The fewer trips to the trackpad, the better."
      icon={<Command size={14} strokeWidth={1.7} />}
    >
      <div className="flex flex-col gap-2">
        {shortcuts.map((s) => (
          <div key={s.keys} className="flex items-center justify-between gap-3">
            <span className="text-[12.5px]" style={{ color: "var(--rv-t2)" }}>{s.desc}</span>
            <kbd
              className="inline-flex items-center gap-1 px-1.5 py-[3px] text-[10.5px] tracking-wider rounded-[5px]"
              style={{
                background: "var(--rv-elev-2)",
                color:      "var(--rv-t2)",
                border:     "0.5px solid var(--rv-border)",
                fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
              }}
            >
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}

// ── Account ───────────────────────────────────────────────────────────────

function AccountSection() {
  const [email,   setEmail]   = useState<string | null>(null)
  const [signing, setSigning] = useState(false)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setEmail(data.user?.email ?? null)
    })
    return () => { cancelled = true }
  }, [])

  const onSignOut = useCallback(async () => {
    if (signing) return
    setSigning(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch { /* fall through */ }
    void window.electronAPI?.signedOut()
  }, [signing])

  return (
    <SettingsSection
      id="account"
      title="Account"
      description="Saves and pipeline live under this account on your Supabase project."
      icon={<KeyRound size={14} strokeWidth={1.7} />}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{
              background: "var(--rv-accent)",
              color:      "rgba(0,0,0,0.85)",
              fontSize:   12,
              fontWeight: 600,
            }}
          >
            {email ? email[0]?.toUpperCase() : "·"}
          </div>
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium truncate" style={{ color: "var(--rv-t1)" }}>
              {email ?? "Not signed in"}
            </p>
            <p className="text-[11px]" style={{ color: "var(--rv-t4)" }}>
              {email ? "Signed in" : "Open Browse to sign in"}
            </p>
          </div>
        </div>
        {email && (
          <Button onClick={onSignOut} variant="secondary" size="sm">
            <LogOut size={11} strokeWidth={2} />
            Sign out
          </Button>
        )}
      </div>
    </SettingsSection>
  )
}

// ── Advanced (API keys) ────────────────────────────────────────────────────

interface KeyFieldProps {
  label:        string
  hint:         string
  hasValueFn:   () => Promise<boolean>
  saveFn:       (key: string) => Promise<{ ok: boolean }>
  consoleUrl?:  string
}

function KeyField({ label, hint, hasValueFn, saveFn, consoleUrl }: KeyFieldProps) {
  const [hasKey,    setHasKey]    = useState<boolean | null>(null)
  const [editing,   setEditing]   = useState(false)
  const [value,     setValue]     = useState("")
  const [showChars, setShowChars] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    hasValueFn().then((b) => { if (!cancelled) setHasKey(b) })
    return () => { cancelled = true }
  }, [hasValueFn])

  const saving = useRef(false)
  const onSave = useCallback(async () => {
    if (saving.current) return
    if (!value.trim()) return
    saving.current = true
    const res = await saveFn(value.trim())
    saving.current = false
    if (res.ok) {
      setHasKey(true); setEditing(false); setValue("")
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    }
  }, [value, saveFn])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[12.5px] font-medium" style={{ color: "var(--rv-t1)" }}>
          {label}
        </label>
        {savedFlash && (
          <span className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: "var(--rv-accent)" }}>
            <Check size={11} strokeWidth={2.2} /> Saved
          </span>
        )}
      </div>
      {!editing && hasKey ? (
        <div
          className="flex items-center gap-2.5 rounded-[8px]"
          style={{ padding: "9px 12px", background: "var(--rv-elev-2)", border: "0.5px solid var(--rv-border)" }}
        >
          <KeyRound size={13} strokeWidth={1.7} style={{ color: "var(--rv-accent)" }} />
          <span className="text-[12px] tabular-nums flex-1" style={{ color: "var(--rv-t2)" }}>
            ••••••••••••••••••••
          </span>
          <Button
            onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0) }}
            variant="ghost"
            size="xs"
          >
            Replace
          </Button>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 rounded-[8px]"
          style={{ padding: "2px 4px 2px 12px", background: "var(--rv-elev-2)", border: "0.5px solid var(--rv-border)" }}
        >
          <input
            ref={inputRef}
            type={showChars ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onSave() } if (e.key === "Escape") { setEditing(false); setValue("") } }}
            placeholder="sk-ant-…"
            className="flex-1 bg-transparent border-none outline-none text-[12.5px] leading-none py-2"
            style={{ color: "var(--rv-t1)", fontFamily: "ui-monospace, SF Mono, Menlo, monospace" }}
            spellCheck={false}
            autoComplete="off"
          />
          <Button
            onClick={() => setShowChars((v) => !v)}
            variant="ghost"
            size="icon-xs"
            aria-label={showChars ? "Hide key" : "Show key"}
          >
            {showChars ? <EyeOff size={12} strokeWidth={1.8} /> : <Eye size={12} strokeWidth={1.8} />}
          </Button>
          <Button
            onClick={onSave}
            disabled={!value.trim()}
            variant="default"
            size="xs"
          >
            Save
          </Button>
        </div>
      )}
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--rv-t4)" }}>
        {hint}
        {consoleUrl && (
          <>
            {" "}
            <a href={consoleUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline" style={{ color: "var(--rv-t3)" }}>
              Get a key →
            </a>
          </>
        )}
      </p>
    </div>
  )
}

function AdvancedSection() {
  const [open, setOpen] = useState(false)
  const api = typeof window !== "undefined" ? window.electronAPI : undefined

  return (
    <section className="flex flex-col gap-3">
      <Button
        onClick={() => setOpen((v) => !v)}
        variant="ghost"
        className="justify-between text-left h-auto py-2"
      >
        <span className="text-[12px] font-medium tracking-tight" style={{ color: "var(--rv-t3)" }}>
          Advanced
        </span>
        <span style={{ color: "var(--rv-t4)" }}>
          <ChevronDown
            size={13}
            strokeWidth={1.8}
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)" }}
          />
        </span>
      </Button>
      {open && (
        <div
          className="flex flex-col gap-5 rounded-[10px] rv-advanced-pop"
          style={{
            padding:    "16px 18px",
            background: "var(--rv-elev-1)",
            border:     "0.5px dashed var(--rv-border-mid)",
          }}
        >
          <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--rv-t3)" }}>
            <span style={{ color: "var(--rv-t2)" }}>For developers and self-hosted setups.</span>{" "}
            Eventually RealVerdict will manage AI keys for you. Until then, the AI features (extraction, tags, the daily greeting) need a key — stored only on this device.
          </p>
          <KeyField
            label="Anthropic API key"
            hint="Primary path — Haiku for extraction, tags, and greetings."
            hasValueFn={() => api?.hasAnthropicKey?.() ?? Promise.resolve(false)}
            saveFn={(k) => api?.setAnthropicKey?.(k) ?? Promise.resolve({ ok: false })}
            consoleUrl="https://console.anthropic.com/settings/keys"
          />
          <KeyField
            label="OpenAI API key"
            hint="Optional fallback when Anthropic is unset."
            hasValueFn={() => api?.hasOpenAIKey?.() ?? Promise.resolve(false)}
            saveFn={(k) => api?.setOpenAIKey?.(k) ?? Promise.resolve({ ok: false })}
            consoleUrl="https://platform.openai.com/api-keys"
          />
        </div>
      )}
    </section>
  )
}

// ── About ─────────────────────────────────────────────────────────────────

function AboutSection() {
  return (
    <SettingsSection
      id="about"
      title="About"
      icon={<Info size={14} strokeWidth={1.7} />}
    >
      <div className="flex flex-col gap-2 text-[12px]" style={{ color: "var(--rv-t2)" }}>
        <div className="flex justify-between"><span style={{ color: "var(--rv-t3)" }}>Version</span><span className="tabular-nums">0.1.0 (dev)</span></div>
        <div className="flex justify-between"><span style={{ color: "var(--rv-t3)" }}>Storage</span><span>Local config + your Supabase project</span></div>
        <div className="flex justify-between"><span style={{ color: "var(--rv-t3)" }}>Telemetry</span><span>None</span></div>
      </div>
      <div className="flex gap-3 text-[11.5px]" style={{ color: "var(--rv-t3)" }}>
        <a href="https://realverdict.app/privacy" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Privacy</a>
        <a href="https://realverdict.app/terms"   target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Terms</a>
        <a href="https://realverdict.app/report"  target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Report a concern</a>
      </div>
    </SettingsSection>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

// Named export — imported by AppLayout for always-mounted rendering.
export function SettingsPage() {
  const { settings: settingsSlot } = useTopBarSlots()

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        background: "var(--rv-bg)",
        // No explicit pointerEvents — AlwaysMountedRoutes' active
        // layer handles pe. Setting auto here would make Settings
        // intercept clicks on /browse / /pipeline because Settings
        // stays mounted underneath them.
      }}
    >
      {/* Title portals into the persistent AppTopBar's settings slot
          so the bar renders our content without re-mounting on
          navigation. The portal is conditional on the slot ref being
          attached (it gets set after AppTopBar's first render). */}
      {settingsSlot && createPortal(
        <h1
          className="text-[15px] font-semibold tracking-tight px-3"
          style={{ color: "var(--rv-t1)" }}
        >
          Settings
        </h1>,
        settingsSlot,
      )}
      {/* Header removed — moved to the persistent AppTopBar at the
          shell level. Settings is now pure content. */}

      {/* Centered single column — Mercury-style settings surface. Hero
          intro at the top sets the tone before sections begin, so
          Settings reads as a real page in the app, not a config dump. */}
      <div className="flex-1 min-h-0 overflow-y-auto rv-invisible-scroll">
        <div className="max-w-[680px] mx-auto px-8 pt-16 pb-20 flex flex-col gap-14">
          {/* Hero — display serif headline + buddy-voice subtitle.
              Same typographic treatment as the Browse greeting so
              Settings sits in the same visual family. */}
          <div className="flex flex-col gap-3">
            <h1
              className="leading-[1.0] tracking-[-0.025em]"
              style={{
                color:      "var(--rv-t1)",
                fontSize:   42,
                fontFamily: "var(--rv-font-display)",
                fontWeight: 500,
              }}
            >
              Settings
            </h1>
            <p
              className="leading-snug"
              style={{
                color:      "var(--rv-t2)",
                fontSize:   15,
                fontFamily: "var(--rv-font-display)",
                fontWeight: 400,
                letterSpacing: "-0.012em",
                maxWidth:   560,
              }}
            >
              Tune the analysis defaults, switch themes, manage your account.
              Everything stays on this device unless you sign in.
            </p>
          </div>

          <ThemePickerSection />
          <MapStyleSection />
          <InvestmentDefaultsSection />
          <AccountSection />
          <PrivacyDataSection />
          <ShortcutsSection />
          <AboutSection />
          <AdvancedSection />
        </div>
      </div>
    </div>
  )
}

// Route stub — actual content rendered always-mounted at layout level.
export default function SettingsRouteStub() {
  return null
}
