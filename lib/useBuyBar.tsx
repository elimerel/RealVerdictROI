"use client"

// useBuyBar — read the user's personal criteria thresholds from
// InvestmentPrefs. Drives the "above bar / below bar" pills on
// metric cards (cash flow / cap rate / DSCR).
//
// Returns null fields when no bar is set; the metric card just won't
// render a pill in that case. No verdict — just memory of the user's
// own criteria so they don't have to re-evaluate from scratch on
// every listing.

import { useEffect, useState } from "react"

export interface BuyBar {
  minCapRate?:  number | null
  minCashFlow?: number | null
  minDscr?:     number | null
}

export function useBuyBar(): BuyBar {
  const [bar, setBar] = useState<BuyBar>({})
  useEffect(() => {
    let cancelled = false
    const api = typeof window !== "undefined" ? window.electronAPI : undefined
    if (!api?.getInvestmentPrefs) return
    void api.getInvestmentPrefs().then((p) => {
      if (cancelled) return
      setBar({
        minCapRate:  p.minCapRate  ?? null,
        minCashFlow: p.minCashFlow ?? null,
        minDscr:     p.minDscr     ?? null,
      })
    })
    return () => { cancelled = true }
  }, [])
  return bar
}
