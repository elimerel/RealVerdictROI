"use client"

import { useEffect, useRef, useState } from "react"
import { usePanelState } from "@/components/panel/context"
import { Button } from "@/components/ui/button"

/**
 * PanelToggle — single window-level button at the top-right of the app
 * frame, mirroring the SidebarToggle pattern at the top-left. Replaces
 * the small inline panel-toggle that used to sit at the end of the URL
 * bar; this is now the only entry point to the right-side analysis panel.
 *
 * State machine (driven by the PanelStateContext):
 *   - hidden:    no listing loaded / not on /browse
 *   - idle:      listing loaded, no analysis in flight, panel closed
 *   - analyzing: work in flight — perimeter arc traces around the icon
 *   - ready:     fresh result available, panel currently CLOSED — small
 *                accent badge dot appears in the upper-right of the icon
 *   - open:      panel is visible — neutral lift + accent icon color
 *   - error:     analysis failed — icon picks up the warn (amber) tint
 *
 * Animations are deliberately Apple-fintech smooth: a single perimeter
 * arc that rotates continuously while analyzing (no pulsing rings, no
 * breathing glow), a one-shot scale-settle when the badge appears, and
 * a 220ms color tint on state transitions. Same motion language as the
 * rest of the app's chrome.
 */
export default function PanelToggle() {
  const { isOpen, phase, toggle } = usePanelState()

  // Track the "ready badge should be visible" state separately from
  // phase. It turns on when phase becomes "ready" and the panel is
  // closed, and clears once the user opens the panel — so the badge
  // does its job (signaling fresh result) and then gracefully exits.
  const [showReadyBadge, setShowReadyBadge] = useState(false)
  const lastPhaseRef = useRef<typeof phase>(phase)
  useEffect(() => {
    const prev = lastPhaseRef.current
    lastPhaseRef.current = phase
    if (phase === "ready" && prev !== "ready" && !isOpen) {
      setShowReadyBadge(true)
    }
    if (isOpen && showReadyBadge) {
      setShowReadyBadge(false)
    }
  }, [phase, isOpen, showReadyBadge])

  // Hide entirely when there's no panel to toggle (no listing, or user
  // is on /pipeline / /settings — nothing to gate).
  if (!toggle || phase === null) return null

  const isAnalyzing = phase === "analyzing"
  const isError     = phase === "error"
  const isReady     = phase === "ready"

  // Icon color cascade: open > ready+badge > error > idle
  const iconColor = isOpen
    ? "var(--rv-accent)"
    : (isReady && showReadyBadge)
      ? "var(--rv-accent)"
      : isError
        ? "var(--rv-warn)"
        : "var(--rv-t2)"

  // Background only when "open" — quiet matte lift. Hover handled inline.
  const bgRest = isOpen ? "var(--rv-elev-4)" : "transparent"

  // Active-tinted bg when open OR when there's a fresh result to draw
  // attention to. Restful otherwise.
  const restBg =
    isOpen
      ? "var(--rv-accent-dim)"
      : (isReady && showReadyBadge)
        ? "var(--rv-accent-dim)"
        : "var(--rv-elev-3)"

  return (
    <Button
      onClick={toggle}
      title={isOpen ? "Hide analysis (⌘\\\\)" : "Show analysis (⌘\\\\)"}
      aria-label={isOpen ? "Hide analysis panel" : "Show analysis panel"}
      variant="secondary"
      size="default"
      className="rv-panel-toggle relative h-9 gap-1.5 rounded-lg"
      style={{
        background:      restBg,
        color:           iconColor,
        border:          "0.5px solid var(--rv-border-mid)",
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}>
      <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden style={{ overflow: "visible" }}>
        {/* Perimeter arc — only renders while analyzing. The svg group
            rotates continuously; the arc itself is a partial circle
            (stroke-dasharray controls the visible length). Stroke is
            currentColor at half-opacity, so it inherits the accent
            without fighting the icon for visual weight. */}
        {isAnalyzing && (
          <g className="rv-panel-arc">
            <circle
              cx="14"
              cy="14"
              r="12"
              fill="none"
              stroke="var(--rv-accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="22 53"
              opacity="0.85"
            />
          </g>
        )}

        {/* Panel-right icon — solid, always at iconColor. Same glyph as
            the old toolbar button so the muscle memory carries over. */}
        <g transform="translate(7,7)" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <rect x="0.5" y="0.5" width="13" height="13" rx="2.5" />
          <line x1="9" y1="0.5" x2="9" y2="13.5" />
        </g>
      </svg>

      {/* Label — "Analysis" reads as a real primary control. Hidden
          when there's a fresh-result badge so the badge dot has room. */}
      <span style={{ marginLeft: -2 }}>Analysis</span>

      {/* Ready badge — small filled accent dot at the top-right corner. */}
      {showReadyBadge && (
        <span
          aria-hidden
          className="rv-panel-badge"
          style={{
            position:     "absolute",
            top:          -3,
            right:        -3,
            width:        9,
            height:       9,
            borderRadius: 999,
            background:   "var(--rv-accent)",
            boxShadow:    "0 0 0 2px var(--rv-badge-ring)",
          }}
        />
      )}
    </Button>
  )
}
