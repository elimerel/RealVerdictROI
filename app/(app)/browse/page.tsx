"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import type { NavUpdate, PanelPayload, PanelResult } from "@/lib/electron"
import Toolbar from "@/components/browser/Toolbar"
import Panel, { type PanelContentState } from "@/components/panel"

const PANEL_W_DEFAULT = 340
const PANEL_W_MIN     = 280
const PANEL_W_MAX     = 640
const SPLITTER_W      = 4

export default function BrowsePage() {
  const urlbarRef = useRef<HTMLInputElement>(null)

  const [nav,           setNav]           = useState<NavUpdate>({})
  const [panelOpen,     setPanelOpen]     = useState(false)
  const [panelContent,  setPanelContent]  = useState<PanelContentState>({ phase: "analyzing" })
  const [panelW,        setPanelW]        = useState(PANEL_W_DEFAULT)
  const [browserReady,  setBrowserReady]  = useState(false)
  // Live sidebar width — used to keep the StartScreen visually centered
  // to the WINDOW (not just nextView) by translating its content left
  // by half the sidebar width.
  const [sidebarOffset, setSidebarOffset] = useState(0)

  const api = typeof window !== "undefined" ? window.electronAPI : undefined

  // Reserved right-edge strip = panel + splitter handle (when open). Main
  // process uses this to compute the embedded browser's right edge against
  // the current nextViewBounds — no per-frame IPC during window resize.
  const reservedRight = panelOpen ? panelW + SPLITTER_W : 0

  useEffect(() => {
    if (!api || browserReady) return
    api.createBrowser({ panelWidth: reservedRight }).then(() => setBrowserReady(true))
    return () => { api.destroyBrowser() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  useEffect(() => {
    if (!browserReady || !api) return
    api.setLayout({ panelWidth: reservedRight })
  }, [api, browserReady, reservedRight])

  useEffect(() => {
    if (!api) return
    const offNav       = api.onNavUpdate((p) => setNav(p))
    const offAnalyzing = api.onPanelAnalyzing(() => {
      setPanelContent({ phase: "analyzing" })
      setPanelOpen(true)
    })
    const offReady = api.onPanelReady((payload: PanelPayload) => {
      if (payload.ok) {
        setPanelContent({ phase: "ready", result: payload as PanelResult })
      } else {
        setPanelContent({ phase: "error", message: (payload as { message: string }).message })
      }
      setPanelOpen(true)
    })
    const offHide  = api.onPanelHide(()   => setPanelOpen(false))
    const offError = api.onPanelError((message: string) => {
      setPanelContent({ phase: "error", message })
      setPanelOpen(true)
    })
    const offFocus = api.onFocusUrlbar(() => { urlbarRef.current?.focus(); urlbarRef.current?.select() })
    const offWidth = window.shellAPI?.onSidebarWidth?.((w) => setSidebarOffset(w)) ?? (() => {})
    return () => { offNav(); offAnalyzing(); offReady(); offHide(); offError(); offFocus(); offWidth() }
  }, [api])

  // ── Splitter drag ──────────────────────────────────────────────────────────
  const draggingRef = useRef(false)
  const splitterRef = useRef<HTMLDivElement>(null)

  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.cursor = "col-resize"
  }, [])
  const moveDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    const w = window.innerWidth - e.clientX - SPLITTER_W / 2
    setPanelW(Math.max(PANEL_W_MIN, Math.min(PANEL_W_MAX, Math.round(w))))
  }, [])
  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    document.body.style.cursor = ""
    if (splitterRef.current) splitterRef.current.style.background = "transparent"
  }, [])

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
        isAnalyzing={panelOpen && panelContent.phase === "analyzing"}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onNavigate={navigate}
        urlbarRef={urlbarRef}
      />

      {/* Browser pane stays transparent — the embedded browserView paints
          its own opaque backdrop when a URL is loaded; otherwise the macOS
          vibrancy material shows through, giving the StartScreen the same
          frosted-glass feel as the rest of the shell chrome. */}
      <div className="flex flex-1 min-h-0 relative">
        <div className="flex-1 min-w-0 relative">
          {showPlaceholder && <StartScreen onNavigate={navigate} sidebarOffset={sidebarOffset} />}
        </div>

        {panelOpen && (
          <>
            <div
              ref={splitterRef}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panel"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--rv-border-mid)")}
              onMouseLeave={(e) => { if (!draggingRef.current) e.currentTarget.style.background = "transparent" }}
              className="shrink-0 h-full select-none transition-colors duration-100"
              style={{ width: SPLITTER_W, cursor: "col-resize", background: "transparent" }}
            />
            <div style={{ width: panelW, flexShrink: 0 }} className="h-full">
              <Panel state={panelContent} onClose={() => setPanelOpen(false)} />
            </div>
          </>
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

function StartScreen({
  onNavigate,
  sidebarOffset = 0,
}: {
  onNavigate: (url: string) => void
  sidebarOffset?: number
}) {
  // Compute once at mount — day/time-aware text shouldn't flicker on resize.
  // useMemo ensures these don't re-evaluate when React re-renders during
  // window-resize bound updates.
  const greet = useMemoOnce(() => greeting())
  const sub   = useMemoOnce(() => subhead())

  // Shift content left by half the sidebar width so it reads as
  // window-centered, not nextView-centered. Without this, the greeting +
  // grid + glow drift right whenever the sidebar widens.
  const contentShift = -sidebarOffset / 2

  return (
    <div
      // GPU-compositing hint — `will-change: transform` puts this on its own
      // layer so window resize doesn't repaint it. No opaque background:
      // macOS vibrancy reads through nextView (transparent webContents bg)
      // for native chrome feel.
      className="absolute inset-0 flex flex-col items-center justify-center px-8 select-none rv-start-fade"
      style={{ willChange: "transform" }}
    >
      {/* Soft radial glow from the forest-green accent — also shifted so it
          stays anchored to the same window position as the content. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 42% at 50% 40%, rgba(48,164,108,0.06) 0%, transparent 72%)",
          transform: `translateX(${contentShift}px)`,
        }}
      />

      <div
        className="relative flex flex-col items-center"
        style={{ transform: `translateX(${contentShift}px)` }}
      >
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
