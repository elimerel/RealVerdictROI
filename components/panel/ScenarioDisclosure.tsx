"use client"

// ── Scenario editor — shared between the Browse panel and the Pipeline
// detail view. Lets the user model alternatives ("what if I offered
// $440k?", "what if I put 30% down?") against an analyzed listing without
// changing the saved analysis. Edits drive live recompute of the metric
// cards above via lib/scenario.ts. Whether overrides persist is up to the
// host — the disclosure itself just owns the form UI.

import React, { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { ScenarioOverrides } from "@/lib/scenario"
import type { PanelResult, SourceKind } from "@/lib/electron"

const SCENARIO_TIP = "Model alternatives without changing the saved analysis. Edits update the metrics above instantly."

interface ScenarioDisclosureProps {
  baseInputs:    PanelResult["inputs"]
  baseListPrice: PanelResult["listPrice"]
  provenance:    PanelResult["provenance"]
  siteName:      PanelResult["siteName"]
  overrides:     ScenarioOverrides
  setOverrides:  React.Dispatch<React.SetStateAction<ScenarioOverrides>>
  open:          boolean
  setOpen:       React.Dispatch<React.SetStateAction<boolean>>
}

export function ScenarioDisclosure({
  baseInputs, provenance, siteName,
  overrides, setOverrides, open, setOpen,
}: ScenarioDisclosureProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const update = <K extends keyof ScenarioOverrides>(key: K, value: ScenarioOverrides[K]) => {
    setOverrides((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div style={{ borderBottom: "1px solid var(--rv-border)" }}>
      <Button
        onClick={() => setOpen((v) => !v)}
        title={SCENARIO_TIP}
        variant="ghost"
        className="w-full flex items-center justify-between px-4 py-3 h-auto rounded-none"
      >
        <span
          className="text-[10px] uppercase tracking-widest font-medium"
          style={{ color: "var(--rv-t3)" }}
        >
          Adjust assumptions
        </span>
        <svg
          width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden
          style={{
            color:      "var(--rv-t4)",
            transform:  open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 160ms cubic-bezier(0.32,0.72,0,1)",
          }}
        >
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>

      {open && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          <ScenarioRow
            label="Your offer"
            attribution={attributionFor(provenance.listPrice.source, siteName)}
            inputType="currency"
            value={overrides.purchasePrice ?? baseInputs.purchasePrice}
            defaultValue={baseInputs.purchasePrice}
            onChange={(v) => update("purchasePrice", v ?? undefined)}
          />
          <ScenarioRow
            label="Down payment"
            attribution="from your defaults"
            inputType="percent"
            value={overrides.downPaymentPct ?? baseInputs.downPaymentPct * 100}
            defaultValue={baseInputs.downPaymentPct * 100}
            onChange={(v) => update("downPaymentPct", v ?? undefined)}
          />
          <ScenarioRow
            label="Interest rate"
            attribution={attributionFor(provenance.interestRate.source, siteName)}
            inputType="rate"
            value={overrides.interestRate ?? baseInputs.interestRate}
            defaultValue={baseInputs.interestRate}
            onChange={(v) => update("interestRate", v ?? undefined)}
          />
          <ScenarioRow
            label="Monthly rent"
            attribution={attributionFor(provenance.rent.source, siteName)}
            inputType="currency"
            value={overrides.monthlyRent ?? baseInputs.monthlyRent}
            defaultValue={baseInputs.monthlyRent}
            onChange={(v) => update("monthlyRent", v ?? undefined)}
          />
          <ScenarioRow
            label="Vacancy"
            attribution="from your defaults"
            inputType="percent"
            value={overrides.vacancyPct ?? baseInputs.vacancyPct * 100}
            defaultValue={baseInputs.vacancyPct * 100}
            onChange={(v) => update("vacancyPct", v ?? undefined)}
          />

          <Button
            onClick={() => setShowAdvanced((v) => !v)}
            variant="ghost"
            size="xs"
            className="self-start mt-0.5 text-[10.5px]"
          >
            {showAdvanced ? "Hide advanced" : "Advanced (loan term, taxes, reserves)"}
          </Button>

          {showAdvanced && (
            <div className="flex flex-col gap-2 pt-0.5">
              <ScenarioRow
                label="Loan term"
                attribution="from your defaults"
                inputType="years"
                value={overrides.loanTermYears ?? baseInputs.loanTermYears}
                defaultValue={baseInputs.loanTermYears}
                onChange={(v) => update("loanTermYears", v ?? undefined)}
              />
              <ScenarioRow
                label="Property tax"
                attribution={attributionFor(provenance.propertyTax.source, siteName)}
                inputType="currency"
                value={overrides.annualPropertyTax ?? baseInputs.annualPropertyTax}
                defaultValue={baseInputs.annualPropertyTax}
                suffix="/yr"
                onChange={(v) => update("annualPropertyTax", v ?? undefined)}
              />
              <ScenarioRow
                label="Insurance"
                attribution={attributionFor(provenance.insurance.source, siteName)}
                inputType="currency"
                value={overrides.annualInsurance ?? baseInputs.annualInsurance}
                defaultValue={baseInputs.annualInsurance}
                suffix="/yr"
                onChange={(v) => update("annualInsurance", v ?? undefined)}
              />
              <ScenarioRow
                label="Monthly HOA"
                attribution={provenance.hoa ? attributionFor(provenance.hoa.source, siteName) : "from your defaults"}
                inputType="currency"
                value={overrides.monthlyHOA ?? baseInputs.monthlyHOA}
                defaultValue={baseInputs.monthlyHOA}
                suffix="/mo"
                onChange={(v) => update("monthlyHOA", v ?? undefined)}
              />
              <ScenarioRow
                label="Management"
                attribution="from your defaults"
                inputType="percent"
                value={overrides.managementPct ?? baseInputs.managementPct * 100}
                defaultValue={baseInputs.managementPct * 100}
                onChange={(v) => update("managementPct", v ?? undefined)}
              />
              <ScenarioRow
                label="Maintenance"
                attribution="from your defaults"
                inputType="percent"
                value={overrides.maintenancePct ?? baseInputs.maintenancePct * 100}
                defaultValue={baseInputs.maintenancePct * 100}
                onChange={(v) => update("maintenancePct", v ?? undefined)}
              />
              <ScenarioRow
                label="CapEx reserve"
                attribution="from your defaults"
                inputType="percent"
                value={overrides.capexPct ?? baseInputs.capexPct * 100}
                defaultValue={baseInputs.capexPct * 100}
                onChange={(v) => update("capexPct", v ?? undefined)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** One scenario input row — label inline with attribution (in tooltip),
 *  then input on the right. Single line per row; input self-formats based
 *  on `inputType` so the user can type $440000 (currency), 25 (percent),
 *  6.30 (rate), or 30 (years) without thinking about formatting. Fires
 *  onChange with `null` when the user clears the field; the caller treats
 *  null as "remove this override and fall back to the default." */
function ScenarioRow({
  label, attribution, inputType, value, defaultValue, suffix, onChange,
}: {
  label:        string
  attribution:  string
  inputType:    "currency" | "percent" | "rate" | "years"
  value:        number
  defaultValue: number
  suffix?:      string
  onChange:     (v: number | null) => void
}) {
  const [text, setText] = useState<string>(formatForInput(value, inputType))
  const lastSeenValue = useRef<number>(value)
  if (value !== lastSeenValue.current && Math.abs(value - Number(text)) > 0.001) {
    lastSeenValue.current = value
    setText(formatForInput(value, inputType))
  }
  const isDefault = Math.abs(value - defaultValue) < 0.001
  const prefix = inputType === "currency" ? "$" : ""
  const inputSuffix =
    suffix             ?? (
    inputType === "percent" ? "%"  :
    inputType === "rate"    ? "%"  :
    inputType === "years"   ? "yr" :
                              "")

  return (
    <div className="flex items-center gap-2 min-w-0">
      <p
        className="text-[12px] leading-none truncate min-w-0 flex-1"
        style={{ color: isDefault ? "var(--rv-t2)" : "var(--rv-t1)" }}
        title={attribution}
      >
        {label}
        {!isDefault && (
          <span
            className="ml-1.5"
            style={{ color: "var(--rv-accent)", fontSize: "9px", verticalAlign: "1px" }}
          >
            ●
          </span>
        )}
      </p>
      <div
        className="flex items-center gap-0.5 rounded-[6px] shrink-0"
        style={{
          background: "var(--rv-elev-2)",
          border:     `0.5px solid ${isDefault ? "var(--rv-border)" : "var(--rv-accent-border)"}`,
          padding:    "3px 7px",
          width:      112,
        }}
      >
        {prefix && <span className="text-[11.5px]" style={{ color: "var(--rv-t4)" }}>{prefix}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[^0-9.]/g, "")
            setText(cleaned)
            if (cleaned === "" || cleaned === ".") { onChange(null); return }
            const n = Number(cleaned)
            if (Number.isFinite(n)) onChange(n)
          }}
          onBlur={(e) => {
            const v = Number(e.target.value.replace(/[^0-9.]/g, ""))
            if (Number.isFinite(v)) setText(formatForInput(v, inputType))
          }}
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12px] tabular-nums leading-none text-right"
          style={{ color: "var(--rv-t1)" }}
          spellCheck={false}
        />
        {inputSuffix && (
          <span className="text-[11.5px]" style={{ color: "var(--rv-t4)" }}>{inputSuffix}</span>
        )}
      </div>
    </div>
  )
}

function formatForInput(value: number, inputType: "currency" | "percent" | "rate" | "years"): string {
  if (inputType === "currency") return Math.round(value).toLocaleString("en-US")
  if (inputType === "rate")     return value.toFixed(2)
  if (inputType === "years")    return String(Math.round(value))
  return value.toFixed(value < 1 ? 2 : 1)  // percent
}

/** Map a SourceKind + siteName to a one-line attribution shown as a tooltip
 *  on the scenario row's label. Mirrors the SourceMark tooltip language. */
function attributionFor(source: SourceKind, siteName: string | null): string {
  switch (source) {
    case "listing":     return siteName ? `from the ${siteName} listing` : "from the listing"
    case "hud_fmr":     return "from HUD FMR"
    case "fred":        return "from FRED"
    case "ai_estimate": return "estimated by AI"
    case "default":     return "from your defaults"
    case "user":        return "edited by you"
  }
}
