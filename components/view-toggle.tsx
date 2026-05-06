"use client"

// ViewToggle — Linear/Vercel/Stripe-style segmented control with a
// SLIDING indicator. The active "pill" is one absolutely-positioned
// element that animates its width + x-offset between tabs using the
// Apple-spring curve. Replaces the per-tab bg-class swap which read
// as static-snap. The motion makes mode switching feel physical.
//
// Implementation notes:
//   - Tab buttons are tracked via refs so we can read their bbox and
//     position the indicator without measurement guesswork.
//   - One ResizeObserver re-calibrates on window resize (the sub-bar
//     can wrap on narrow widths; the indicator must follow).
//   - First paint: indicator placed without transition so it doesn't
//     "fly in" on mount. After mount, transitions are enabled.

import * as React from "react"
import { cn } from "@/lib/utils"

export interface ViewToggleProps<T extends string = string> {
  modes:    readonly T[]
  active:   T
  onChange: (mode: T) => void
  className?: string
}

export function ViewToggle<T extends string>({
  modes, active, onChange, className,
}: ViewToggleProps<T>) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const tabRefs      = React.useRef<Map<T, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = React.useState<{ x: number; w: number } | null>(null)
  const [mounted, setMounted]     = React.useState(false)

  const recalc = React.useCallback(() => {
    const c = containerRef.current
    const el = tabRefs.current.get(active)
    if (!c || !el) return
    const cb = c.getBoundingClientRect()
    const eb = el.getBoundingClientRect()
    setIndicator({ x: eb.left - cb.left, w: eb.width })
  }, [active])

  // Recalc on active change + on layout settle.
  React.useLayoutEffect(() => {
    recalc()
    // Mark mounted on next frame so the first placement is instant
    // (no "flying-in" animation from x=0).
    const t = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(t)
  }, [recalc])

  // Re-measure when the container resizes (responsive layout, font
  // load shift, etc.).
  React.useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(() => recalc())
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [recalc])

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative inline-flex items-center rounded-full border border-foreground/[0.07] bg-muted p-0.5",
        className
      )}
      role="tablist"
      aria-label="View mode"
    >
      {/* Sliding indicator — single pill that follows the active tab. */}
      {indicator && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-full bg-background shadow-sm"
          style={{
            left:       indicator.x,
            width:      indicator.w,
            transition: mounted
              ? "left 320ms cubic-bezier(0.32, 0.72, 0, 1), width 320ms cubic-bezier(0.32, 0.72, 0, 1)"
              : "none",
          }}
        />
      )}

      {modes.map((mode) => (
        <button
          key={mode}
          ref={(el) => {
            if (el) tabRefs.current.set(mode, el)
            else    tabRefs.current.delete(mode)
          }}
          role="tab"
          aria-selected={active === mode}
          onClick={() => onChange(mode)}
          className={cn(
            "relative z-[1] px-3 h-7 text-[12px] font-medium tracking-tight rounded-full transition-colors capitalize",
            active === mode
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {mode}
        </button>
      ))}
    </div>
  )
}
