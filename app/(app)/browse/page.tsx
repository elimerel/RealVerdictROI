"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import type { NavUpdate, ElectronBounds } from "@/lib/electron"
import Toolbar from "@/components/browser/Toolbar"
import Panel   from "@/components/panel"

const PANEL_WIDTH = 340

type PanelPhase = "hidden" | "analyzing" | "ready" | "error"

export default function BrowsePage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const urlbarRef    = useRef<HTMLInputElement>(null)

  const [nav,         setNav]         = useState<NavUpdate>({})
  const [panelPhase,  setPanelPhase]  = useState<PanelPhase>("hidden")
  const [panelOpen,   setPanelOpen]   = useState(false)
  const [browserReady, setBrowserReady] = useState(false)

  const api = typeof window !== "undefined" ? window.electronAPI : undefined

  // ── Compute bounds for the WebContentsView ──────────────────────────────────

  const getBrowserBounds = useCallback((): ElectronBounds | null => {
    if (!containerRef.current) return null
    const el   = containerRef.current
    const rect = el.getBoundingClientRect()
    const dpr  = window.devicePixelRatio ?? 1

    const panelPx = panelOpen ? Math.round(PANEL_WIDTH * dpr) : 0

    return {
      x:      Math.round(rect.left  * dpr),
      y:      Math.round(rect.top   * dpr),
      width:  Math.round(rect.width * dpr) - panelPx,
      height: Math.round(rect.height * dpr),
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
      api.navigate("https://www.zillow.com")
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
    if (containerRef.current) obs.observe(containerRef.current)
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

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full h-full bg-[var(--f-bg)] overflow-hidden"
    >
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

      {/* ── Browser pane + panel ───────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Transparent placeholder for the WebContentsView (sized via bounds) */}
        <div className="flex-1 min-w-0" />

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
