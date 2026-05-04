"use client"

// AmbientBackdrop — the app's atmospheric layer.
//
// Lives at z-index -1 behind every surface. Adapts to TIME OF DAY rather
// than being random — the light always comes from a specific direction
// (anchored to the bottom, like horizon glow or firelight) and shifts
// color through the day. Morning is warm-gold rising from bottom-left;
// midday is cool-calm from above; golden hour is deep amber from
// bottom-right; night is a quiet ember at the bottom-center.
//
// The composition feels DELIBERATE — like sunlight coming through a
// window, not blobs orbiting at random. This is the move that makes the
// backdrop feel designed instead of generative-AI.

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react"

// ── Mood model (kept for back-compat — components can still call setMood
// to nudge tones, but the dominant signal is time of day now) ──────────

export type BackdropMood =
  | "idle" | "browsing" | "deciding" | "comparing" | "alerting"

interface BackdropContextValue {
  mood: BackdropMood
  setMood: (m: BackdropMood) => void
}

const BackdropContext = createContext<BackdropContextValue>({
  mood: "idle",
  setMood: () => {},
})

export function BackdropProvider({ children }: { children: ReactNode }) {
  const [mood, setMoodState] = useState<BackdropMood>("idle")
  const setMood = useCallback((m: BackdropMood) => setMoodState(m), [])
  return (
    <BackdropContext.Provider value={{ mood, setMood }}>
      {children}
    </BackdropContext.Provider>
  )
}

export function useBackdropMood() {
  return useContext(BackdropContext)
}

export function useSetMoodWhileMounted(mood: BackdropMood) {
  const { setMood } = useBackdropMood()
  useEffect(() => {
    setMood(mood)
    return () => setMood("idle")
  }, [mood, setMood])
}

// ── Time-of-day palette ─────────────────────────────────────────────────
//
// Each phase defines a horizon glow (the dominant bottom-anchored light)
// and a counter-light (a small soft glow in the opposite corner for
// compositional balance). The colors evoke real-world light at that
// time — golden hour is genuinely amber, night is genuinely cool.

interface ScenePalette {
  /** Dominant bottom-anchored glow — color, opacity, horizontal anchor (0–100%). */
  horizon: {
    color:  string
    opacity: number
    anchor:  number
  }
  /** Soft counter-light in the opposite top corner. Compositional weight. */
  counter: {
    color:  string
    opacity: number
    anchor:  number   // horizontal anchor (0 = left, 100 = right)
    fromTop: number   // vertical anchor from top (0 = at top, 30 = 30% down)
  }
  /** Phase label — for debugging and the "From your buddy" line. */
  label: string
}

function paletteForHour(h: number): ScenePalette {
  if (h >= 5 && h < 8) {
    // Dawn — cool blue rising from bottom, hint of pink. Light anchored
    // bottom-center, counter glow upper-left.
    return {
      horizon: { color: "rgba(180, 140, 175, 0.55)", opacity: 1, anchor: 50 },
      counter: { color: "rgba(140, 170, 200, 0.30)", opacity: 1, anchor: 18, fromTop: 8 },
      label:   "dawn",
    }
  }
  if (h >= 8 && h < 12) {
    // Morning — warm gold rising from bottom-left. Counter glow top-right.
    return {
      horizon: { color: "rgba(220, 180, 110, 0.55)", opacity: 1, anchor: 30 },
      counter: { color: "rgba(150, 180, 200, 0.25)", opacity: 1, anchor: 82, fromTop: 6 },
      label:   "morning",
    }
  }
  if (h >= 12 && h < 16) {
    // Midday — calm cool light from above-center, modest bottom warmth.
    return {
      horizon: { color: "rgba(160, 180, 170, 0.40)", opacity: 1, anchor: 50 },
      counter: { color: "rgba(180, 200, 215, 0.30)", opacity: 1, anchor: 50, fromTop: 5 },
      label:   "midday",
    }
  }
  if (h >= 16 && h < 19) {
    // Golden hour — deep amber from bottom-right (low slanting sun).
    return {
      horizon: { color: "rgba(235, 165, 95, 0.65)", opacity: 1, anchor: 70 },
      counter: { color: "rgba(140, 90, 80, 0.35)", opacity: 1, anchor: 25, fromTop: 12 },
      label:   "golden hour",
    }
  }
  if (h >= 19 && h < 21) {
    // Dusk — warm pink horizon transitioning cool above.
    return {
      horizon: { color: "rgba(220, 130, 110, 0.60)", opacity: 1, anchor: 60 },
      counter: { color: "rgba(120, 140, 175, 0.35)", opacity: 1, anchor: 28, fromTop: 8 },
      label:   "dusk",
    }
  }
  if (h >= 21 || h < 2) {
    // Night — quiet warm ember at bottom-center. Like firelight in a dark room.
    return {
      horizon: { color: "rgba(180, 110, 70, 0.50)", opacity: 1, anchor: 50 },
      counter: { color: "rgba(70, 90, 120, 0.30)", opacity: 1, anchor: 80, fromTop: 4 },
      label:   "night",
    }
  }
  // Late night / pre-dawn (2–5am) — deep cool blue, very quiet.
  return {
    horizon: { color: "rgba(90, 110, 150, 0.40)", opacity: 1, anchor: 50 },
    counter: { color: "rgba(140, 100, 120, 0.20)", opacity: 1, anchor: 70, fromTop: 6 },
    label:   "late night",
  }
}

// Mood-based opacity nudges. The dominant signal is time of day; mood
// just brightens or quiets the same composition.
const MOOD_INTENSITY: Record<BackdropMood, number> = {
  idle:      1.00,
  browsing:  1.05,
  deciding:  0.95,   // calmer when focused on a deal
  comparing: 0.85,   // step back when comparing
  alerting:  1.15,   // slightly louder when something needs attention
}

// ── Rendered backdrop ───────────────────────────────────────────────────

export function AmbientBackdrop() {
  const { mood } = useBackdropMood()

  // Compute palette based on current hour. We re-derive every 10 minutes
  // so the backdrop drifts through the day if the app is left open.
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const id = setInterval(() => setHour(new Date().getHours()), 10 * 60_000)
    return () => clearInterval(id)
  }, [])

  const palette  = useMemo(() => paletteForHour(hour), [hour])
  const intensity = MOOD_INTENSITY[mood]

  return (
    <div
      aria-hidden
      className="rv-ambient-backdrop"
      style={{
        position:      "fixed",
        inset:         0,
        zIndex:        -1,
        pointerEvents: "none",
        overflow:      "hidden",
        background:    "var(--rv-bg)",
      }}
    >
      {/* Horizon glow — the dominant bottom-anchored light source. Width
          covers the lower half of the viewport, anchored horizontally per
          time of day. Slow horizontal drift gives it the "breathing"
          quality of real light without ever feeling random. */}
      <div
        className="rv-horizon-glow"
        style={{
          position: "absolute",
          left:     `${palette.horizon.anchor - 60}%`,
          right:    `${100 - (palette.horizon.anchor + 60)}%`,
          bottom:   "-30vh",
          height:   "75vh",
          background: `radial-gradient(ellipse at 50% 100%, ${withOpacity(palette.horizon.color, intensity)} 0%, transparent 70%)`,
          filter:   "blur(24px)",
          transition: "background 2400ms cubic-bezier(0.32, 0.72, 0, 1), left 2400ms ease, right 2400ms ease",
        }}
      />

      {/* Counter-light — small soft glow in the opposite corner.
          Compositional balance, like a window letting in indirect sky
          light to balance the firelight from the floor. */}
      <div
        className="rv-counter-glow"
        style={{
          position: "absolute",
          left:     `${palette.counter.anchor - 25}%`,
          width:    "50vw",
          top:      `${palette.counter.fromTop - 25}vh`,
          height:   "55vh",
          background: `radial-gradient(ellipse at 50% 50%, ${withOpacity(palette.counter.color, intensity * 0.85)} 0%, transparent 65%)`,
          filter:   "blur(40px)",
          transition: "background 2400ms cubic-bezier(0.32, 0.72, 0, 1), left 2400ms ease",
        }}
      />

      {/* Debug label — invisible but inspectable */}
      <span data-rv-backdrop-phase={palette.label} data-rv-backdrop-mood={mood} style={{ display: "none" }} />
    </div>
  )
}

/** Re-tint a base color with a multiplied alpha (for mood intensity). */
function withOpacity(rgba: string, mult: number): string {
  // Parse "rgba(R, G, B, A)" → return same colors with A * mult.
  const m = rgba.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/)
  if (!m) return rgba
  const r = m[1], g = m[2], b = m[3]
  const a = m[4] ? Number(m[4]) : 1
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a * mult)).toFixed(3)})`
}
