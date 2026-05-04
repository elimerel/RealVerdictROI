"use client"

// AmbientBackdrop — the app's atmospheric layer.
//
// Lives at z-index -1 behind every surface (Browse, Pipeline, Settings,
// the panel, everything). Subtly visible at the edges of cards and
// through the panel glass. Reacts to a small set of "moods" the React
// app drives: idle, browsing, deciding, comparing, alerting.
//
// Today this renders a CSS mesh gradient placeholder so the architecture
// is in place. Swap to <Rive /> when the user provides a .riv file —
// only this file needs to change; the BackdropMoodContext stays.

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"

// ── Mood model ──────────────────────────────────────────────────────────
//
// The mood is the high-level state the backdrop should reflect. Components
// across the app call setMood() to nudge it. Mood transitions are smooth
// (the backdrop animates between states), never abrupt.

export type BackdropMood =
  | "idle"        // default — calm, neutral
  | "browsing"    // user is on the Browse page actively scanning
  | "deciding"    // user has the panel open analyzing a listing
  | "comparing"   // user is in the comparison view
  | "alerting"    // a price drop / stale watch / something to look at

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

/** Hook for any component to read or nudge the backdrop's mood. */
export function useBackdropMood() {
  return useContext(BackdropContext)
}

// ── Rendered backdrop ───────────────────────────────────────────────────

/**
 * The actual atmospheric layer. Currently a CSS mesh-gradient placeholder
 * that drifts slowly and shifts hue on mood change. When the user supplies
 * a .riv file (drop into /public/backdrop.riv), this component swaps to
 * a Rive canvas instead — the BackdropProvider/useBackdropMood API stays
 * stable so consumers don't change.
 *
 * The placeholder is intentionally calm: 4 radial gradients positioned at
 * the corners, slowly orbiting via CSS keyframes, with low opacity so the
 * UI on top stays the focus. Mood changes shift the dominant color blob.
 */
export function AmbientBackdrop() {
  const { mood } = useBackdropMood()

  // Per-mood color palette. Pulled from the app's design tokens so the
  // backdrop stays in palette regardless of theme. Each tuple is two
  // dominant colors (warm + cool / accent + neutral) that the gradient
  // animates between.
  const palette = MOOD_PALETTE[mood]

  // Detect if a real Rive file exists. If yes, render Rive; if no, render
  // the CSS placeholder. The check is best-effort — we listen for a
  // global flag set when the .riv loads successfully (see useRiveBackdrop
  // below). Until then, the placeholder is what shows.
  const [hasRive] = useState(false)  // flip to true when .riv is wired

  return (
    <div
      aria-hidden
      className="rv-ambient-backdrop"
      style={{
        position:       "fixed",
        inset:          0,
        zIndex:         -1,
        pointerEvents:  "none",
        // Crucial: the body needs to be transparent / show this through.
        // We layer the app on top using its own bg tokens; the backdrop
        // peeks through panels via the existing glass treatment.
        overflow:       "hidden",
      }}
    >
      {hasRive ? (
        // Real Rive will live here once a .riv file is provided.
        // import { useRive } from "@rive-app/react-canvas"
        // <Rive src="/backdrop.riv" stateMachines="Mood" ... />
        null
      ) : (
        <CSSMeshBackdrop palette={palette} mood={mood} />
      )}
    </div>
  )
}

// Mood → color tuple. Subtle differences — the backdrop should never
// loudly announce a mood change, just nudge the atmosphere.
const MOOD_PALETTE: Record<BackdropMood, { a: string; b: string; c: string }> = {
  // Default — earthy warm charcoal with a hint of forest
  idle:      { a: "rgba(48, 164, 108, 0.05)",  b: "rgba(194, 117, 74, 0.04)", c: "rgba(48, 164, 108, 0.03)" },
  // Active browsing — slightly cooler, more accent green
  browsing:  { a: "rgba(48, 164, 108, 0.07)",  b: "rgba(48, 164, 108, 0.04)", c: "rgba(120, 180, 200, 0.03)" },
  // Deciding (panel open) — warm, calm, focus
  deciding:  { a: "rgba(48, 164, 108, 0.06)",  b: "rgba(48, 164, 108, 0.03)", c: "rgba(194, 117, 74, 0.04)" },
  // Comparing — neutral, balanced, gives the table breathing room
  comparing: { a: "rgba(120, 130, 140, 0.04)", b: "rgba(48, 164, 108, 0.03)", c: "rgba(120, 130, 140, 0.03)" },
  // Alerting — clay shifts dominant
  alerting:  { a: "rgba(194, 117, 74, 0.08)",  b: "rgba(194, 117, 74, 0.05)", c: "rgba(245, 158, 11, 0.04)" },
}

/** CSS-mesh-gradient placeholder. Three radial gradients positioned at
 *  fixed anchors; opacity and color shift smoothly on mood change. The
 *  gradients themselves drift via a long-period CSS keyframe so the
 *  atmosphere feels alive without ever being distracting. */
function CSSMeshBackdrop({
  palette, mood,
}: {
  palette: { a: string; b: string; c: string }
  mood:    BackdropMood
}) {
  return (
    <>
      {/* Three orbiting blobs. Each is a radial gradient anchored to a
          point that drifts slowly via CSS animation. The colors come
          from the mood palette. Opacity transitions on mood change. */}
      <div
        className="rv-ambient-blob rv-ambient-blob-a"
        style={{ background: `radial-gradient(circle at center, ${palette.a} 0%, transparent 60%)`, transition: "background 1200ms ease" }}
      />
      <div
        className="rv-ambient-blob rv-ambient-blob-b"
        style={{ background: `radial-gradient(circle at center, ${palette.b} 0%, transparent 65%)`, transition: "background 1200ms ease" }}
      />
      <div
        className="rv-ambient-blob rv-ambient-blob-c"
        style={{ background: `radial-gradient(circle at center, ${palette.c} 0%, transparent 70%)`, transition: "background 1200ms ease" }}
      />
      {/* Mood label for debugging — invisible but inspectable */}
      <span data-rv-backdrop-mood={mood} style={{ display: "none" }} />
    </>
  )
}

// ── Mood drivers ────────────────────────────────────────────────────────
//
// Tiny hook: when a component mounts, set the backdrop mood. On unmount,
// returns to idle. Lets pages/components declare "while I'm visible, the
// backdrop should feel like X."

export function useSetMoodWhileMounted(mood: BackdropMood) {
  const { setMood } = useBackdropMood()
  useEffect(() => {
    setMood(mood)
    return () => setMood("idle")
  }, [mood, setMood])
}
