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

// RealVerdict atmospheric palette — the actual colors that show up in the
// backdrop, not generic green/orange. Tuned to feel like firelight on
// aged wood, dawn over hilly landscape, moss on warm stone. Each mood
// is six colors mapping to the six gradient blobs (a-f). The far layer
// (a, b) sets base mood; near layer (c, d) adds saturated highlights;
// e is the bright catch-the-light spot; f is the warm shadow weight.

interface BackdropPalette {
  a: string  // far blob — top-left, base warmth
  b: string  // far blob — bottom-right, base depth
  c: string  // near blob — right, screen-blend highlight
  d: string  // near blob — left, screen-blend highlight
  e: string  // tiny bright spot — composition catch
  f: string  // bottom shadow — compositional weight
}

const MOOD_PALETTE: Record<BackdropMood, BackdropPalette> = {
  // Idle — dusk over hills. Deep forest base, clay edge, amber catch.
  idle: {
    a: "rgba(31, 79, 61, 0.55)",     // deep forest — base mood
    b: "rgba(58, 38, 28, 0.50)",     // dark umber — depth
    c: "rgba(48, 164, 108, 0.18)",   // forest green highlight
    d: "rgba(194, 117, 74, 0.18)",   // clay highlight
    e: "rgba(245, 198, 130, 0.20)",  // warm amber catch
    f: "rgba(45, 30, 22, 0.45)",     // bottom warm shadow
  },
  // Browsing — slightly more forest, more active "scanning" energy.
  browsing: {
    a: "rgba(36, 90, 70, 0.60)",
    b: "rgba(58, 38, 28, 0.50)",
    c: "rgba(48, 164, 108, 0.24)",   // brighter green
    d: "rgba(194, 117, 74, 0.16)",
    e: "rgba(220, 230, 200, 0.22)",  // cooler catch (morning light)
    f: "rgba(45, 30, 22, 0.45)",
  },
  // Deciding — panel open, focused. Warmer, slower, more contemplative.
  deciding: {
    a: "rgba(31, 79, 61, 0.50)",
    b: "rgba(78, 50, 38, 0.55)",     // warmer umber
    c: "rgba(48, 164, 108, 0.16)",
    d: "rgba(194, 117, 74, 0.22)",   // more clay
    e: "rgba(245, 198, 130, 0.22)",
    f: "rgba(60, 38, 28, 0.50)",
  },
  // Comparing — neutral cooler, lets the comparison data breathe.
  comparing: {
    a: "rgba(36, 70, 80, 0.55)",     // cool slate
    b: "rgba(45, 50, 56, 0.55)",
    c: "rgba(48, 164, 108, 0.14)",
    d: "rgba(120, 140, 160, 0.16)",
    e: "rgba(200, 215, 225, 0.20)",
    f: "rgba(40, 45, 52, 0.50)",
  },
  // Alerting — clay dominates, amber catch brighter. Calm urgency.
  alerting: {
    a: "rgba(78, 45, 30, 0.65)",     // deep terracotta base
    b: "rgba(58, 38, 28, 0.55)",
    c: "rgba(194, 117, 74, 0.30)",   // big clay highlight
    d: "rgba(245, 158, 11, 0.18)",   // amber
    e: "rgba(255, 210, 140, 0.28)",
    f: "rgba(60, 32, 22, 0.55)",
  },
}

/** Six-blob volumetric backdrop. Far layer (a, b) sets base mood; near
 *  layer (c, d) adds saturated highlights via mix-blend-mode: screen so
 *  overlaps brighten like firelight on wood; e adds a bright catch-the-
 *  light spot; f anchors the bottom with a warm shadow. The colors come
 *  from the mood palette and transition over 1.2s when mood changes. */
function CSSMeshBackdrop({
  palette, mood,
}: {
  palette: BackdropPalette
  mood:    BackdropMood
}) {
  const grad = (color: string, falloff = 60) =>
    `radial-gradient(circle at center, ${color} 0%, transparent ${falloff}%)`
  const trans = "background 1400ms cubic-bezier(0.32, 0.72, 0, 1)"
  return (
    <>
      <div className="rv-ambient-blob rv-ambient-blob-a" style={{ background: grad(palette.a, 55), transition: trans }} />
      <div className="rv-ambient-blob rv-ambient-blob-b" style={{ background: grad(palette.b, 55), transition: trans }} />
      <div className="rv-ambient-blob rv-ambient-blob-c" style={{ background: grad(palette.c, 65), transition: trans }} />
      <div className="rv-ambient-blob rv-ambient-blob-d" style={{ background: grad(palette.d, 65), transition: trans }} />
      <div className="rv-ambient-blob rv-ambient-blob-e" style={{ background: grad(palette.e, 70), transition: trans }} />
      <div className="rv-ambient-blob rv-ambient-blob-f" style={{ background: grad(palette.f, 60), transition: trans }} />
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
