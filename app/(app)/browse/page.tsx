"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import type { NavUpdate, ElectronBounds } from "@/lib/electron"
import Toolbar from "@/components/browser/Toolbar"
import Panel   from "@/components/panel"

const PANEL_WIDTH = 340

type PanelPhase = "hidden" | "analyzing" | "ready" | "error"

export default function BrowsePage() {
  const browserPaneRef = useRef<HTMLDivElement>(null)   // the area BELOW the toolbar
  const urlbarRef      = useRef<HTMLInputElement>(null)

  const [nav,          setNav]          = useState<NavUpdate>({})
  const [panelPhase,   setPanelPhase]   = useState<PanelPhase>("hidden")
  const [panelOpen,    setPanelOpen]    = useState(false)
  const [browserReady, setBrowserReady] = useState(false)

  const api = typeof window !== "undefined" ? window.electronAPI : undefined

  // ── Compute bounds for the WebContentsView ──────────────────────────────────

  const getBrowserBounds = useCallback((): ElectronBounds | null => {
    if (!browserPaneRef.current) return null
    const rect = browserPaneRef.current.getBoundingClientRect()
    // Electron setBounds uses logical (CSS) pixels — no DPR multiplication needed.
    // Subtract panel width so the embedded browser doesn't overlap the panel.
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

  // ── Create embedded browser on mount ───────────────────────────────────────

  useEffect(() => {
    if (!api || browserReady) return

    const b = getBrowserBounds()
    if (!b) return

    api.createBrowser(b).then(() => {
      setBrowserReady(true)
      // No default URL — show the placeholder so the user can navigate anywhere
    })

    return () => {
      api.destroyBrowser()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  // ── Keep browser bounds in sync ─────────────────────────────────────────────

  useEffect(() => {
    if (!browserReady) return
    pushBounds()
  }, [panelOpen, browserReady, pushBounds])

  useEffect(() => {
    const obs = new ResizeObserver(pushBounds)
    if (browserPaneRef.current) obs.observe(browserPaneRef.current)
    return () => obs.disconnect()
  }, [pushBounds])

  // ── IPC listeners ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!api) return

    const offNav = api.onNavUpdate((payload) => setNav(payload))

    const offAnalyzing = api.onPanelAnalyzing(() => {
      setPanelPhase("analyzing")
      setPanelOpen(true)
    })

    const offReady = api.onPanelReady(() => {
      setPanelPhase("ready")
      setPanelOpen(true)
    })

    const offHide = api.onPanelHide(() => {
      setPanelOpen(false)
      setTimeout(() => setPanelPhase("hidden"), 280)
    })

    const offError = api.onPanelError(() => {
      setPanelPhase("error")
    })

    const offFocus = api.onFocusUrlbar(() => {
      urlbarRef.current?.focus()
      urlbarRef.current?.select()
    })

    return () => {
      offNav()
      offAnalyzing()
      offReady()
      offHide()
      offError()
      offFocus()
    }
  }, [api])

  // ── Nav actions ─────────────────────────────────────────────────────────────

  const navigate  = (url: string) => api?.navigate(url)
  const goBack    = () => api?.back()
  const goForward = () => api?.forward()
  const reload    = () => api?.reload()

  const isAnalyzing = panelPhase === "analyzing"
  const showPlaceholder = browserReady && !nav.url

  return (
    <div className="flex flex-col w-full h-full bg-[var(--f-bg)] overflow-hidden">
      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <Toolbar
        nav={nav}
        isAnalyzing={isAnalyzing}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onNavigate={navigate}
        urlbarRef={urlbarRef}
      />

      {/* ── Browser pane + panel — ref goes HERE so bounds exclude toolbar ── */}
      <div ref={browserPaneRef} className="flex flex-1 min-h-0 relative">
        {/* Transparent placeholder for the WebContentsView (sized via bounds) */}
        <div className="flex-1 min-w-0 relative">
          {showPlaceholder && <StartPlaceholder onNavigate={navigate} />}
        </div>

        {/* Slide-in panel */}
        {panelOpen && (
          <div
            style={{ width: PANEL_WIDTH, flexShrink: 0 }}
            className="h-full"
          >
            <Panel />
          </div>
        )}
      </div>
    </div>
  )
}

function StartPlaceholder({ onNavigate }: { onNavigate: (url: string) => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-6 pointer-events-none select-none">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--accent)]"
        style={{ boxShadow: "0 2px 8px var(--accent-border)" }}
      >
        <svg width="20" height="20" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7 1L3 8h4l-1 5 5-7H7l1-5z" fill="white" strokeWidth="0"/>
        </svg>
      </div>
      <div>
        <p className="text-[13px] font-medium text-[var(--f-t1)]">Navigate to any listing</p>
        <p className="mt-1 text-[12px] text-[var(--f-t3)]">
          Zillow, Redfin, Realtor.com, LoopNet, and more
        </p>
      </div>
      <p className="text-[11px] text-[var(--f-t4)]">
        RealVerdict will automatically analyze listings as you browse
      </p>
    </div>
  )
}
