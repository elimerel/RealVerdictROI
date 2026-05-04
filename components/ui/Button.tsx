"use client"

// Button — the app's three-tier button system.
//
// The user called out that "everything looks the same" — every action,
// state badge, and toggle was using the accent-dim soft pill with a
// hairline border. That's the AI-template look: same component pattern
// repeated for every interactive element regardless of intent.
//
// Real button hierarchies (Mercury, Linear, Cursor) use three distinct
// languages by intent:
//
//   Primary — filled accent. The ONE action that matters on this surface.
//             Maximum one per visible surface. Heavy weight.
//
//   Secondary — neutral surface, hairline border, no accent fill.
//               Re-analyze, Open listing, Cancel, Re-check. Quiet.
//
//   Ghost — text-only with optional icon. Tertiary navigation, footer
//           links, "Show more". Almost no chrome.
//
// State badges (Watching, Saved, Interested) are NOT buttons — they're
// status displays. Use SourceMark or a colored dot pattern, not Button.

import React from "react"

type Variant = "primary" | "secondary" | "ghost"
type Size    = "sm" | "md"

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant
  size?:    Size
  /** Optional icon — renders to the left of children. Use sparingly;
   *  not every button needs one. */
  icon?:    React.ReactNode
  loading?: boolean
}

export function Button({
  variant = "secondary",
  size    = "md",
  icon,
  loading,
  children,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading

  // Per-size dimensions. md is the default for actions; sm is for compact
  // inline contexts (toolbar chips, list rows).
  const dims = size === "sm"
    ? { height: 26, padding: "0 10px",   fontSize: 11.5, radius: 6, gap: 4 }
    : { height: 32, padding: "0 14px",   fontSize: 12.5, radius: 7, gap: 6 }

  // Per-variant base styles. Primary is the only one with shadow; the
  // others stay flat to read as "secondary intent." Hover is a small
  // brightness shift, not a color change.
  const variantStyles: Record<Variant, React.CSSProperties> = {
    primary: {
      color:      "#0a0a0c",
      background: "var(--rv-accent)",
      border:     "0.5px solid transparent",
      boxShadow:  "0 1px 2px rgba(0, 0, 0, 0.20)",
      fontWeight: 600,
    },
    secondary: {
      color:      "var(--rv-t1)",
      background: "var(--rv-elev-3)",
      border:     "0.5px solid var(--rv-border)",
      boxShadow:  "none",
      fontWeight: 500,
    },
    ghost: {
      color:      "var(--rv-t2)",
      background: "transparent",
      border:     "0.5px solid transparent",
      boxShadow:  "none",
      fontWeight: 500,
    },
  }

  return (
    <button
      {...rest}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center tracking-tight transition-colors disabled:opacity-40 disabled:cursor-default ${rest.className ?? ""}`}
      style={{
        height:        dims.height,
        padding:       dims.padding,
        gap:           dims.gap,
        fontSize:      dims.fontSize,
        borderRadius:  dims.radius,
        whiteSpace:    "nowrap",
        ...variantStyles[variant],
        ...style,
      }}
      onMouseEnter={(e) => {
        if (isDisabled) return
        if (variant === "primary") {
          e.currentTarget.style.background = "color-mix(in srgb, var(--rv-accent) 88%, white)"
        } else if (variant === "secondary") {
          e.currentTarget.style.background = "var(--rv-elev-4)"
        } else if (variant === "ghost") {
          e.currentTarget.style.color = "var(--rv-t1)"
        }
      }}
      onMouseLeave={(e) => {
        if (isDisabled) return
        Object.assign(e.currentTarget.style, variantStyles[variant])
      }}
    >
      {icon && <span className="shrink-0 inline-flex items-center" aria-hidden>{icon}</span>}
      {children}
    </button>
  )
}
