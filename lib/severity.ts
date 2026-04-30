/**
 * Severity & worst-offender helpers.
 *
 * Threshold logic for the three hero metrics (DSCR, monthly cash flow, cap
 * rate) plus a single function that picks the most-bad metric for a deal.
 *
 * Why this exists: prior to Phase 1 polish, every failing metric on every
 * pipeline card was painted red. With three failing metrics × eight cards
 * the eye saw a wall of red and the signal was lost. The new rule: for any
 * given deal, color *only* the worst-offending metric. Other failing metrics
 * stay in neutral tone but keep their threshold caption ("below 1.0",
 * "negative", "below 5%") so the user still sees that they're under water.
 */

export type Severity = "neutral" | "good" | "warn" | "bad"

export type MetricKey = "dscr" | "cashFlow" | "capRate"

export function dscrSeverity(dscr: number): Severity {
  if (!Number.isFinite(dscr)) return "good" // no debt → trivially "good"
  if (dscr >= 1.25) return "neutral"
  if (dscr >= 1.0)  return "warn"
  return "bad"
}

export function cashFlowSeverity(cf: number): Severity {
  if (cf >= 150) return "neutral"
  if (cf >= 0)   return "warn"
  return "bad"
}

export function capRateSeverity(cap: number): Severity {
  if (cap >= 0.06) return "neutral"
  if (cap >= 0.05) return "warn"
  return "bad"
}

/**
 * Numeric severity score used to rank metrics against each other.
 * Higher = worse. A "bad" DSCR (< 1.0) is the most severe failure — the
 * property does not service its debt — so it outranks negative cash flow
 * and a sub-5% cap rate. Negative cash flow outranks low cap rate because
 * cash flow is the cash the investor lives on; cap rate is a yield ratio.
 */
function rank(key: MetricKey, sev: Severity): number {
  if (sev === "neutral" || sev === "good") return 0
  // Bad = severe failure of the threshold; warn = soft fail.
  const base = sev === "bad" ? 100 : 10
  // Tie-breaker by metric importance.
  const weight = key === "dscr" ? 3 : key === "cashFlow" ? 2 : 1
  return base + weight
}

/**
 * Returns the metric key that's the worst offender on this deal, or null
 * if everything is at or above threshold. Callers paint just this metric
 * with a tone color and leave the others neutral.
 */
export function worstOffender(
  dscr: number,
  cashFlow: number,
  capRate: number,
): MetricKey | null {
  const candidates: { key: MetricKey; sev: Severity }[] = [
    { key: "dscr",     sev: dscrSeverity(dscr) },
    { key: "cashFlow", sev: cashFlowSeverity(cashFlow) },
    { key: "capRate",  sev: capRateSeverity(capRate) },
  ]
  let best: { key: MetricKey; score: number } | null = null
  for (const c of candidates) {
    const s = rank(c.key, c.sev)
    if (s > 0 && (best === null || s > best.score)) {
      best = { key: c.key, score: s }
    }
  }
  return best?.key ?? null
}

/**
 * Convenience wrapper used by callers that already know which metric they
 * are rendering. If `metricKey` is the worst offender on the deal, returns
 * its real severity; otherwise returns "neutral" so the metric stays calm
 * in the UI even when it would individually qualify as "warn" or "bad".
 */
export function tonedSeverity(
  metricKey: MetricKey,
  dscr: number,
  cashFlow: number,
  capRate: number,
): Severity {
  const worst = worstOffender(dscr, cashFlow, capRate)
  if (worst !== metricKey) return "neutral"
  switch (metricKey) {
    case "dscr":     return dscrSeverity(dscr)
    case "cashFlow": return cashFlowSeverity(cashFlow)
    case "capRate":  return capRateSeverity(capRate)
  }
}
