"use client"

import { useState, useEffect, useRef, useCallback } from "react"
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
    <div className="flex flex-col w-full h-full overflow-hidden" style={{ background: "var(--rv-bg)" }}>
      <Toolbar
        nav={nav}
        isAnalyzing={panelPhase === "analyzing"}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onNavigate={navigate}
        urlbarRef={urlbarRef}
      />

      <div ref={browserPaneRef} className="flex flex-1 min-h-0 relative">
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

function StartScreen({ onNavigate }: { onNavigate: (url: string) => void }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center px-8 select-none"
      style={{ background: "var(--rv-bg)" }}
    >
      {/* Logo mark */}
      <div
        className="flex h-11 w-11 items-center justify-center rounded-[11px] mb-6"
        style={{
          background: "var(--rv-accent)",
          boxShadow: "0 0 0 1px var(--rv-accent-border), 0 4px 16px var(--rv-accent-dim)",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7 1L3 8h4l-1 5 5-7H7l1-5z" fill="white"/>
        </svg>
      </div>

      {/* Greeting */}
      <h1
        className="text-[22px] font-semibold tracking-tight mb-1"
        style={{ color: "var(--rv-t1)" }}
      >
        {greeting()}
      </h1>
      <p className="text-[13px] mb-8" style={{ color: "var(--rv-t3)" }}>
        Navigate to any listing to start analyzing
      </p>

      {/* Site grid */}
      <div className="grid grid-cols-3 gap-2 w-full max-w-sm">
        {SUGGESTED.map(({ label, url, desc }) => (
          <button
            key={url}
            onClick={() => onNavigate(url)}
            className="flex flex-col gap-1 rounded-xl px-3 py-3 text-left transition-all duration-100"
            style={{
              background: "var(--rv-surface)",
              border: "1px solid var(--rv-border)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--rv-border-mid)"
              e.currentTarget.style.background  = "var(--rv-raised)"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--rv-border)"
              e.currentTarget.style.background  = "var(--rv-surface)"
            }}
          >
            <span className="text-[12px] font-medium" style={{ color: "var(--rv-t1)" }}>
              {label}
            </span>
            <span className="text-[11px] leading-tight" style={{ color: "var(--rv-t4)" }}>
              {desc}
            </span>
          </button>
        ))}
      </div>

      {/* Footer hint */}
      <p className="mt-8 text-[11px]" style={{ color: "var(--rv-t4)" }}>
        RealVerdict analyzes listings automatically as you browse
      </p>
    </div>
  )
}
