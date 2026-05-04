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

// ── Brand-locked palette ────────────────────────────────────────────────
//
// The backdrop colors NEVER change. Same warm earth + forest + clay
// family as the rest of the app, always. Like Linear's purple sky or
// Stripe's gradient — the consistency IS the signature.
//
// Time of day affects only INTENSITY and ANCHOR POSITION — never color.
// At night the whole composition quiets to ~60%; at midday it brightens
// to 100%. The horizon's anchor rotates left→center→right through the
// day like a sun arc, so the light feels like it's tracking the time
// without ever escaping the brand family.
//
// Mood is a tiny intensity nudge (±15%) on top of that. Same color
// palette for everything; only the dimmer moves.

const BRAND_HORIZON = "rgba(196, 130, 75, 0.55)"   // warm amber clay — the firelight
const BRAND_COUNTER = "rgba(48, 164, 108, 0.35)"   // forest green — the cool counterlight

/** Time-of-day intensity multiplier. Quiet at night, full midday. */
function intensityForHour(h: number): number {
  if (h >= 22 || h < 5)  return 0.60   // night — backdrop recedes
  if (h >= 5 && h < 8)   return 0.75   // dawn
  if (h >= 8 && h < 11)  return 0.90   // morning
  if (h >= 11 && h < 16) return 1.00   // midday — peak presence
  if (h >= 16 && h < 19) return 0.95   // afternoon / golden
  return 0.80                          // dusk
}

/** Sun-arc anchor — left in morning, center at midday, right in evening.
 *  Returns 0–100 (horizontal % across viewport). */
function horizonAnchorForHour(h: number): number {
  // Map 6am → 30%, 12pm → 50%, 6pm → 70%. Clamped outside.
  if (h < 6)  return 30
  if (h > 18) return 70
  return 30 + ((h - 6) / 12) * 40
}

function counterAnchorForHour(h: number): number {
  // Counter glow sits OPPOSITE the horizon anchor.
  return 100 - horizonAnchorForHour(h)
}

const MOOD_INTENSITY: Record<BackdropMood, number> = {
  idle:      1.00,
  browsing:  1.05,
  deciding:  0.95,
  comparing: 0.85,
  alerting:  1.15,
}

// ── Rendered backdrop ───────────────────────────────────────────────────

export function AmbientBackdrop() {
  const { mood } = useBackdropMood()

  // Re-derive intensity + sun-arc anchor every 10 minutes if the app is
  // left open, so the backdrop quiets at night and the light source
  // gradually rotates through the day. COLORS never change.
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const id = setInterval(() => setHour(new Date().getHours()), 10 * 60_000)
    return () => clearInterval(id)
  }, [])

  const intensity = useMemo(
    () => intensityForHour(hour) * MOOD_INTENSITY[mood],
    [hour, mood]
  )
  const horizonX = useMemo(() => horizonAnchorForHour(hour), [hour])
  const counterX = useMemo(() => counterAnchorForHour(hour), [hour])

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
      {/* Horizon glow — the dominant bottom-anchored light. Warm clay,
          always. Anchor X moves left→right through the day (sun arc).
          Color is brand-locked. */}
      <div
        className="rv-horizon-glow"
        style={{
          position: "absolute",
          left:     `${horizonX - 60}%`,
          right:    `${100 - (horizonX + 60)}%`,
          bottom:   "-30vh",
          height:   "75vh",
          background: `radial-gradient(ellipse at 50% 100%, ${withOpacity(BRAND_HORIZON, intensity)} 0%, transparent 70%)`,
          filter:   "blur(24px)",
          transition: "background 2400ms cubic-bezier(0.32, 0.72, 0, 1), left 2400ms ease, right 2400ms ease",
        }}
      />

      {/* Counter-light — forest green from the opposite top corner.
          Compositional balance, brand-locked. */}
      <div
        className="rv-counter-glow"
        style={{
          position: "absolute",
          left:     `${counterX - 25}%`,
          width:    "50vw",
          top:      "-15vh",
          height:   "55vh",
          background: `radial-gradient(ellipse at 50% 50%, ${withOpacity(BRAND_COUNTER, intensity * 0.85)} 0%, transparent 65%)`,
          filter:   "blur(40px)",
          transition: "background 2400ms cubic-bezier(0.32, 0.72, 0, 1), left 2400ms ease",
        }}
      />

      {/* Debug label — invisible but inspectable */}
      <span data-rv-backdrop-hour={hour} data-rv-backdrop-mood={mood} style={{ display: "none" }} />
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
