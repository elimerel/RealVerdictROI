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
        overflow:       "hidden",
        // Solid base color so blobs render against a defined canvas.
        // The body above is transparent so this is what shows through
        // empty page areas. Theme-aware via --rv-bg.
        background:     "var(--rv-bg)",
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
  // Idle — dusk over hills. Forest + clay + amber, BRIGHT enough to
  // actually register against the warm-charcoal canvas. Each color is
  // LIGHTER than #16120e so it adds light, not darkness. This is what
  // separates a visible backdrop from an invisible one.
  idle: {
    a: "rgba(70, 140, 100, 0.65)",   // bright forest — base mood, visible
    b: "rgba(140, 80, 50, 0.60)",    // warm clay — visible depth
    c: "rgba(48, 164, 108, 0.55)",   // accent green highlight
    d: "rgba(220, 130, 80, 0.50)",   // bright clay highlight
    e: "rgba(255, 210, 140, 0.45)",  // warm amber catch (the glint)
    f: "rgba(120, 70, 45, 0.55)",    // warm bottom shadow
  },
  browsing: {
    a: "rgba(60, 150, 110, 0.70)",
    b: "rgba(140, 80, 50, 0.55)",
    c: "rgba(70, 200, 130, 0.55)",   // brighter green
    d: "rgba(200, 130, 90, 0.45)",
    e: "rgba(230, 240, 200, 0.45)",  // cooler catch
    f: "rgba(120, 70, 45, 0.50)",
  },
  deciding: {
    a: "rgba(70, 140, 100, 0.60)",
    b: "rgba(160, 95, 60, 0.65)",    // warmer umber
    c: "rgba(48, 164, 108, 0.50)",
    d: "rgba(220, 130, 80, 0.60)",   // more clay
    e: "rgba(255, 210, 140, 0.50)",
    f: "rgba(135, 75, 50, 0.55)",
  },
  comparing: {
    a: "rgba(80, 130, 150, 0.60)",   // cool slate
    b: "rgba(95, 105, 115, 0.55)",
    c: "rgba(48, 164, 108, 0.40)",
    d: "rgba(150, 175, 195, 0.45)",
    e: "rgba(220, 230, 240, 0.45)",
    f: "rgba(70, 80, 90, 0.55)",
  },
  alerting: {
    a: "rgba(170, 90, 55, 0.75)",    // deep terracotta base
    b: "rgba(140, 80, 50, 0.65)",
    c: "rgba(220, 130, 80, 0.65)",   // big clay highlight
    d: "rgba(245, 158, 11, 0.50)",   // amber
    e: "rgba(255, 210, 140, 0.55)",
    f: "rgba(130, 65, 40, 0.60)",
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
