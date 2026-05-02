"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import type { NavUpdate, ElectronBounds } from "@/lib/electron"
import Toolbar from "@/components/browser/Toolbar"
import Panel   from "@/components/panel"

const PANEL_WIDTH = 340

type PanelPhase = "hidden" | "analyzing" | "ready" | "error"

export default function BrowsePage() {
  const browserPaneRef = useRef<HTMLDivElement>(null)
  const urlbarRef      = useRef<HTMLInputElement>(null)

  const [nav,          setNav]          = useState<NavUpdate>({})
  const [panelPhase,   setPanelPhase]   = useState<PanelPhase>("hidden")
  const [panelOpen,    setPanelOpen]    = useState(false)
  const [browserReady, setBrowserReady] = useState(false)

  const api = typeof window !== "undefined" ? window.electronAPI : undefined

  const getBrowserBounds = useCallback((): ElectronBounds | null => {
    if (!browserPaneRef.current) return null
    const rect = browserPaneRef.current.getBoundingClientRect()
    const panelW = panelOpen ? PANEL_WIDTH : 0
    return {
      x:      Math.round(rect.left),
      y:      Math.round(rect.top),
      width:  Math.max(200, Math.round(rect.width) - panelW),
      height: Math.round(rect.height),
    }
  }, [panelOpen])

  const pushBounds = useCallback(() => {
    if (!api) return
    const b = getBrowserBounds()
    if (b) api.updateBounds(b)
  }, [api, getBrowserBounds])

  useEffect(() => {
    if (!api || browserReady) return
    const b = getBrowserBounds()
    if (!b) return
    api.createBrowser(b).then(() => setBrowserReady(true))
    return () => { api.destroyBrowser() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  useEffect(() => {
    if (!browserReady) return
    pushBounds()
  }, [panelOpen, browserReady, pushBounds])

  useEffect(() => {
    const obs = new ResizeObserver(pushBounds)
    if (browserPaneRef.current) obs.observe(browserPaneRef.current)
    return () => obs.disconnect()
  }, [pushBounds])

  useEffect(() => {
    if (!api) return
    const offNav      = api.onNavUpdate((p) => setNav(p))
    const offAnalyzing = api.onPanelAnalyzing(() => { setPanelPhase("analyzing"); setPanelOpen(true) })
    const offReady    = api.onPanelReady(() => { setPanelPhase("ready"); setPanelOpen(true) })
    const offHide     = api.onPanelHide(() => { setPanelOpen(false); setTimeout(() => setPanelPhase("hidden"), 220) })
    const offError    = api.onPanelError(() => setPanelPhase("error"))
    const offFocus    = api.onFocusUrlbar(() => { urlbarRef.current?.focus(); urlbarRef.current?.select() })
    return () => { offNav(); offAnalyzing(); offReady(); offHide(); offError(); offFocus() }
  }, [api])

  const navigate  = (url: string) => api?.navigate(url)
  const goBack    = () => api?.back()
  const goForward = () => api?.forward()
  const reload    = () => api?.reload()

  const showPlaceholder = browserReady && !nav.url

  return (
    // No background on this root — toolbar (transparent) shows vibrancy.
    // StartScreen and WebContentsView handle their own backgrounds below.
    <div className="flex flex-col w-full h-full overflow-hidden">
      <Toolbar
        nav={nav}
        isAnalyzing={panelPhase === "analyzing"}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onNavigate={navigate}
        urlbarRef={urlbarRef}
      />

      {/* Browser pane has SOLID dark bg — websites and StartScreen render on
          a real surface. Toolbar above stays transparent so vibrancy shows. */}
      <div
        ref={browserPaneRef}
        className="flex flex-1 min-h-0 relative"
        style={{ background: "#0d0d0f" }}
      >
        <div className="flex-1 min-w-0 relative">
          {showPlaceholder && <StartScreen onNavigate={navigate} />}
        </div>

        {panelOpen && (
          <div style={{ width: PANEL_WIDTH, flexShrink: 0 }} className="h-full">
            <Panel />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Start screen ──────────────────────────────────────────────────────────────

const SUGGESTED = [
  { label: "Zillow",      url: "https://www.zillow.com",          desc: "Browse MLS listings" },
  { label: "Redfin",      url: "https://www.redfin.com",          desc: "Agent-assisted deals" },
  { label: "Realtor.com", url: "https://www.realtor.com",         desc: "NAR data feed" },
  { label: "LoopNet",     url: "https://www.loopnet.com",         desc: "Commercial properties" },
  { label: "Crexi",       url: "https://www.crexi.com",           desc: "CRE marketplace" },
  { label: "MLS",         url: "https://www.homes.com",           desc: "Direct MLS data" },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

/** Day-of-week / time-of-day aware subtitle — feels like a work buddy.
 *  These are the FALLBACKS for when there's no user data yet.  Once we
 *  have browse history + saved deals, these get replaced with personalized
 *  insights ("3 listings in Austin under your cap rate this week", etc). */
function subhead() {
  const now    = new Date()
  const day    = now.getDay()                 // 0 = Sun
  const hour   = now.getHours()
  const isMon  = day === 1
  const isFri  = day === 5
  const isWknd = day === 0 || day === 6
  const isLate = hour >= 20 || hour < 6
  const isVeryLate = hour >= 1 && hour < 5

  // Pick from variations randomly so it doesn't feel scripted on revisits
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]

  if (isVeryLate)            return pick([
    "It's late. You sure about this one?",
    "Burning the midnight oil on a deal?",
    "Whatever you're looking at better cash flow.",
  ])
  if (isMon && hour < 12)    return pick([
    "Fresh week. What's on your radar?",
    "Monday energy. Find me something good.",
    "New week, new comps.",
  ])
  if (isFri && hour >= 14)   return pick([
    "Closing thoughts before the weekend?",
    "Friday reflection — anything to lock in?",
    "One more before you log off?",
  ])
  if (isWknd)                return pick([
    "Quiet day to dig into a deal.",
    "Weekend warrior mode. Let's underwrite.",
    "No comps Sunday. (Just kidding, paste away.)",
  ])
  if (isLate)                return pick([
    "Late-night underwriting, eh? Let's go.",
    "Numbers don't sleep. Apparently neither do you.",
  ])
  if (hour < 12)             return pick([
    "Open any listing and I'll do the math.",
    "Drop a URL, I'll tell you if it's any good.",
    "What're we looking at this morning?",
  ])
  if (hour < 17)             return pick([
    "Got a property in mind? Drop it in.",
    "Show me something interesting.",
    "Paste a listing — I'll handle the boring parts.",
  ])
  return pick([
    "Anything you saw today worth a closer look?",
    "End-of-day deal? Drop it in.",
    "One more lap before dinner?",
  ])
}

/** Stable value across re-renders — like useMemo([]) but explicit. */
function useMemoOnce<T>(factory: () => T): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, [])
}

/** Subhead that types itself in character-by-character on mount.
 *  Cursor blinks subtly while typing, fades out when done. */
function TypingSubhead({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState("")
  const [done,  setDone]  = useState(false)

  useEffect(() => {
    let i = 0
    let raf = 0
    let lastTick = performance.now()
    const STEP = 22  // ms between characters

    function tick(now: number) {
      if (now - lastTick >= STEP) {
        i++
        lastTick = now
        setShown(text.slice(0, i))
      }
      if (i < text.length) raf = requestAnimationFrame(tick)
      else setTimeout(() => setDone(true), 450)
    }
    // Start typing after the staggered fade-in finishes (~80ms)
    const startDelay = setTimeout(() => { raf = requestAnimationFrame(tick) }, 80)
    return () => { clearTimeout(startDelay); cancelAnimationFrame(raf) }
  }, [text])

  return (
    <p
      className={className}
      style={{ color: "var(--rv-t3)", letterSpacing: "-0.005em", minHeight: "1.4em" }}
    >
      {shown}
      <span
        aria-hidden
        style={{
          display:        "inline-block",
          width:          1,
          height:         "1em",
          marginLeft:     2,
          verticalAlign:  "-0.13em",
          background:     "var(--rv-t2)",
          opacity:        done ? 0 : 1,
          animation:      done ? "none" : "rv-cursor-blink 1.05s steps(1, end) infinite",
          transition:     "opacity 350ms ease-out",
        }}
      />
    </p>
  )
}

function StartScreen({ onNavigate }: { onNavigate: (url: string) => void }) {
  // Compute once at mount — day/time-aware text shouldn't flicker on resize.
  // useMemo ensures these don't re-evaluate when React re-renders during
  // window-resize bound updates.
  const greet = useMemoOnce(() => greeting())
  const sub   = useMemoOnce(() => subhead())

  return (
    <div
      // GPU-compositing hint — `will-change: transform` puts this on its own
      // layer so window resize doesn't repaint it
      className="absolute inset-0 flex flex-col items-center justify-center px-8 select-none rv-start-fade"
      style={{ background: "var(--rv-bg)", willChange: "transform" }}
    >
      {/* Soft radial glow from the forest-green accent */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 42% at 50% 40%, rgba(48,164,108,0.06) 0%, transparent 72%)",
        }}
      />

      <div className="relative flex flex-col items-center">
        {/* Greeting — animates in */}
        <h1
          className="rv-greeting text-[34px] font-semibold tracking-[-0.030em] text-center"
          style={{ color: "var(--rv-t1)", lineHeight: 1.05 }}
        >
          {greet}
        </h1>

        {/* Subhead — types itself in once on mount, work-buddy vibe */}
        <TypingSubhead text={sub} className="rv-subhead mt-3 mb-12 text-[13.5px] text-center" />

        {/* Site shortcuts — 3 columns */}
        <div className="rv-grid grid grid-cols-3 gap-[6px] w-full max-w-[340px]">
          {SUGGESTED.map(({ label, url, desc }) => (
            <button
              key={url}
              onClick={() => onNavigate(url)}
              className="flex flex-col gap-[5px] rounded-[10px] px-3 py-[10px] text-left transition-all duration-100"
              style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.09)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)" }}
            >
              <span
                className="text-[12px] font-medium leading-none"
                style={{ color: "var(--rv-t1)" }}
              >
                {label}
              </span>
              <span
                className="text-[10.5px] leading-snug"
                style={{ color: "var(--rv-t4)" }}
              >
                {desc}
              </span>
            </button>
          ))}
        </div>

        {/* Keyboard shortcut hint */}
        <p
          className="rv-hint mt-9 flex items-center gap-1.5 text-[11px]"
          style={{ color: "var(--rv-t4)" }}
        >
          <kbd
            className="inline-flex items-center justify-center rounded px-1 py-[1px] text-[10px] font-medium"
            style={{
              background: "rgba(255,255,255,0.07)",
              color: "var(--rv-t3)",
              minWidth: 18,
            }}
          >
            ⌘L
          </kbd>
          to focus URL bar
        </p>
      </div>
    </div>
  )
}
