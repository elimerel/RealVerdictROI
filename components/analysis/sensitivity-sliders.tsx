"use client"

import { useState } from "react"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

interface SliderConfig {
  key: string
  label: string
  baseValue: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  unit?: string
}

interface SensitivitySlidersProps {
  purchasePrice: number
  interestRate: number
  monthlyRent: number
  vacancyRate: number
  appreciationRate: number
  managementRate: number
  onValuesChange?: (values: Record<string, number>) => void
  className?: string
}

export function SensitivitySliders({
  purchasePrice,
  interestRate,
  monthlyRent,
  vacancyRate,
  appreciationRate,
  managementRate,
  onValuesChange,
  className,
}: SensitivitySlidersProps) {
  const [values, setValues] = useState({
    purchasePrice,
    interestRate,
    monthlyRent,
    vacancyRate,
    appreciationRate,
    managementRate,
  })

  const sliders: SliderConfig[] = [
    {
      key: "purchasePrice",
      label: "Purchase Price",
      baseValue: purchasePrice,
      min: purchasePrice * 0.85,
      max: purchasePrice * 1.15,
      step: 1000,
      format: (v) =>
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(v),
    },
    {
      key: "interestRate",
      label: "Interest Rate",
      baseValue: interestRate,
      min: Math.max(interestRate - 2, 3),
      max: interestRate + 2,
      step: 0.125,
      format: (v) => `${v.toFixed(3)}%`,
    },
    {
      key: "monthlyRent",
      label: "Monthly Rent",
      baseValue: monthlyRent,
      min: monthlyRent * 0.8,
      max: monthlyRent * 1.2,
      step: 25,
      format: (v) =>
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(v),
    },
    {
      key: "vacancyRate",
      label: "Vacancy Rate",
      baseValue: vacancyRate,
      min: 0,
      max: 20,
      step: 0.5,
      format: (v) => `${v.toFixed(1)}%`,
    },
    {
      key: "appreciationRate",
      label: "Appreciation",
      baseValue: appreciationRate,
      min: 0,
      max: 8,
      step: 0.1,
      format: (v) => `${v.toFixed(1)}%`,
    },
    {
      key: "managementRate",
      label: "Prop. Management",
      baseValue: managementRate,
      min: 0,
      max: 15,
      step: 0.5,
      format: (v) => `${v.toFixed(1)}%`,
    },
  ]

  const handleSliderChange = (key: string, newValue: number[]) => {
    const updated = { ...values, [key]: newValue[0] }
    setValues(updated)
    onValuesChange?.(updated)
  }

  const getDelta = (current: number, base: number): string => {
    const diff = ((current - base) / base) * 100
    if (Math.abs(diff) < 0.1) return ""
    return diff > 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`
  }

  return (
    <div className={cn("rounded-lg border border-border bg-card/50", className)}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium">Sensitivity Analysis</h3>
        <button
          onClick={() => {
            const reset = {
              purchasePrice,
              interestRate,
              monthlyRent,
              vacancyRate,
              appreciationRate,
              managementRate,
            }
            setValues(reset)
            onValuesChange?.(reset)
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Reset
        </button>
      </div>
      <div className="p-4 space-y-5">
        {sliders.map((slider) => {
          const currentValue = values[slider.key as keyof typeof values]
          const delta = getDelta(currentValue, slider.baseValue)

          return (
            <div key={slider.key} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{slider.label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums">
                    {slider.format(currentValue)}
                  </span>
                  {delta && (
                    <span
                      className={cn(
                        "text-xs font-mono tabular-nums",
                        delta.startsWith("+")
                          ? slider.key === "purchasePrice" ||
                            slider.key === "interestRate" ||
                            slider.key === "vacancyRate" ||
                            slider.key === "managementRate"
                            ? "text-red-400"
                            : "text-emerald-400"
                          : slider.key === "purchasePrice" ||
                            slider.key === "interestRate" ||
                            slider.key === "vacancyRate" ||
                            slider.key === "managementRate"
                          ? "text-emerald-400"
                          : "text-red-400"
                      )}
                    >
                      {delta}
                    </span>
                  )}
                </div>
              </div>
              <Slider
                value={[currentValue]}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                onValueChange={(v) => handleSliderChange(slider.key, v)}
                className="[&>span:first-child]:bg-muted [&>span:first-child>span]:bg-foreground"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
