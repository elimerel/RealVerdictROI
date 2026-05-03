"use client"

import React from "react"

// ── Premium currency formatting
// ──────────────────────────────────────────────────────────────────────────
//
// Mercury renders amounts like "$5,216,471.18" with the `.18` superscript
// and slightly smaller. That single typographic choice does enormous
// premium-feel work — it reads as serious financial software instead of
// generic Tailwind. We follow the same pattern across the app.
//
// Two entry points:
//   <Currency value={n} />      JSX with .cents superscripted (preferred)
//   formatCurrency(n)           plain string for input placeholders, tooltips
//
// Both honor the `compact` flag for huge numbers ($1.55M instead of
// $1,550,000) and the `signed` flag for deltas (+$140 / −$1,061).

interface CurrencyOpts {
  /** Round to integer dollars and skip the .cents tail entirely.
   *  Useful for list prices ($474,900) where cents are noise. */
  whole?:    boolean
  /** Render large amounts as $1.5M / $880K / $4.2B. Off by default. */
  compact?:  boolean
  /** Prefix positive values with "+". Negatives always get "−" via the
   *  formatter regardless of this flag. */
  signed?:   boolean
}

/** Plain-string currency (no JSX). Use when a string is required —
 *  placeholders, aria-labels, tooltips, console logs, search keys.
 *  Renders cents as plain `.18`, not superscript. */
export function formatCurrency(n: number | null | undefined, opts: CurrencyOpts = {}): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const { whole, compact, signed } = opts
  if (compact) return formatCompact(n, signed)
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })
  const out = fmt.format(Math.abs(n))
  const sign = n < 0 ? "−" : (signed ? "+" : "")
  return `${sign}${out}`
}

/** Pretty $1.5M / $880K / $4.2B. Drops cents always; one decimal of
 *  precision for the leading magnitude. */
function formatCompact(n: number, signed?: boolean): string {
  const abs = Math.abs(n)
  let out: string
  if      (abs >= 1_000_000_000) out = `$${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`
  else if (abs >= 1_000_000)     out = `$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  else if (abs >= 1_000)         out = `$${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  else                           out = `$${Math.round(abs).toLocaleString()}`
  const sign = n < 0 ? "−" : (signed ? "+" : "")
  return `${sign}${out}`
}

/** Currency rendered as JSX with .cents (or fractional) superscripted.
 *  Use this everywhere a currency appears in UI — Mercury-style premium
 *  financial typography. The cents element is rendered at ~70% of the
 *  parent font size, lifted ~0.18em, and inherits color from the parent.
 *  When `whole` is set or the amount has no cents, no superscript is
 *  rendered (clean integer dollar amount). */
export function Currency({
  value, whole, compact, signed, className,
}: CurrencyOpts & {
  value:      number | null | undefined
  className?: string
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className={className}>—</span>
  }

  // Compact mode never has cents — render as plain string in a single span
  // so caller styling applies cleanly. Same for `whole` mode.
  if (compact || whole) {
    return <span className={className}>{formatCurrency(value, { whole, compact, signed })}</span>
  }

  // Format the absolute value to dollars + 2-digit cents, then split so we
  // can render the cents portion as superscript. Negative gets the minus
  // sign (using the typographic minus "−" not hyphen-minus "-").
  const abs = Math.abs(value)
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const full = fmt.format(abs)                         // "$5,216,471.18"
  const dot  = full.lastIndexOf(".")
  const dollars = dot >= 0 ? full.slice(0, dot) : full // "$5,216,471"
  const cents   = dot >= 0 ? full.slice(dot + 1) : ""  // "18"
  const sign    = value < 0 ? "−" : (signed ? "+" : "")

  // If the cents are .00 the superscript reads as visual noise — drop it
  // and render a clean integer dollar amount.
  if (cents === "00") return <span className={className}>{sign}{dollars}</span>

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {sign}{dollars}
      <span
        style={{
          fontSize:      "0.7em",
          verticalAlign: "0.18em",
          marginLeft:    "0.05em",
          letterSpacing: "0.01em",
        }}
      >
        {cents}
      </span>
    </span>
  )
}
