"use client"

import { useState, useRef, useEffect, KeyboardEvent } from "react"
import type { NavUpdate } from "@/lib/electron"

function BackIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M8.5 2L4 6.5l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ForwardIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M4.5 2L9 6.5 4.5 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ReloadIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden
      className={spinning ? "animate-spin" : ""}
      style={{ animationDuration: "0.65s" }}
    >
      <path
        d="M11.5 7A4.5 4.5 0 1 1 9.2 3.2M11.5 2v3h-3"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

function SidebarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  )
}

function AnalyzingDots() {
  return (
    <span className="flex gap-[3px] items-center" title="Analyzing listing…">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[5px] h-[5px] rounded-full dot-pulse"
          style={{ background: "var(--rv-accent)", animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  )
}

interface ToolbarProps {
  nav:        NavUpdate
  isAnalyzing: boolean
  onBack:     () => void
  onForward:  () => void
  onReload:   () => void
  onNavigate: (url: string) => void
  urlbarRef?: React.RefObject<HTMLInputElement | null>
}

export default function Toolbar({
  nav,
  isAnalyzing,
  onBack,
  onForward,
  onReload,
  onNavigate,
  urlbarRef,
}: ToolbarProps) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(200)
  const inputRef = useRef<HTMLInputElement>(null)
  const resolvedRef = urlbarRef ?? inputRef

  // Subscribe to shell sidebar state + live width. The toolbar's left
  // padding is computed to keep the leftmost button always at window
  // x≥84 — past the macOS traffic lights (which sit at x=14-72) — across
  // all sidebar states (full / icons-only / hidden). Without the width
  // subscription, in icons-only mode the toggle would land at x=68 and
  // overlap the traffic lights.
  useEffect(() => {
    const offState = window.shellAPI?.onSidebarState?.((open) => setSidebarOpen(open))
    const offWidth = window.shellAPI?.onSidebarWidth?.((w) => setSidebarWidth(w))
    return () => { offState?.(); offWidth?.() }
  }, [])

  const effectiveSidebarWidth = sidebarOpen ? sidebarWidth : 0
  // Toolbar lives inside nextView which sits at x=effectiveSidebarWidth in
  // window coords. Padding the toolbar by (84 - effectiveSidebarWidth) puts
  // the leftmost button at window x=84 — clear of the traffic lights and
  // at the same window position whenever the sidebar is narrow or hidden.
  // When the sidebar is wide, the natural left edge is already past x=84,
  // so we drop to a small visual padding (8px).
  const TRAFFIC_LIGHT_CLEARANCE = 84
  const toolbarPadL = Math.max(8, TRAFFIC_LIGHT_CLEARANCE - effectiveSidebarWidth)

  const displayUrl = nav.url ?? ""

  function startEdit() {
    setDraft(displayUrl)
    setEditing(true)
    setTimeout(() => resolvedRef.current?.select(), 0)
  }

  function commit() {
    setEditing(false)
    if (!draft.trim()) return
    let url = draft.trim()
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = url.includes(".")
        ? `https://${url}`
        : `https://www.google.com/search?q=${encodeURIComponent(url)}`
    }
    onNavigate(url)
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")  { commit(); return }
    if (e.key === "Escape") { setEditing(false); return }
  }

  const NavBtn = ({
    onClick, disabled, title, children,
  }: {
    onClick: () => void
    disabled?: boolean
    title: string
    children: React.ReactNode
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      className="w-7 h-7 flex items-center justify-center rounded-[7px] transition-all duration-100
                 text-[rgba(245,245,247,0.42)] hover:text-[rgba(245,245,247,0.95)] hover:bg-white/[0.07]
                 disabled:opacity-25 disabled:pointer-events-none"
    >
      {children}
    </button>
  )

  return (
    /* Whole toolbar is a drag region (no-drag set on interactive children) */
    <div
      className="flex items-center shrink-0 select-none"
      style={{
        height:          52,
        WebkitAppRegion: "drag",
        background:      "transparent",
        paddingLeft:     toolbarPadL,
      } as React.CSSProperties}
    >
      {/* Inner wrapper stays a DRAG region for window-move; each button
          opts out via `no-drag`. Sidebar toggle is leftmost — moves with
          the toolbar's left edge instead of needing reserved shell
          territory (which used to leave a 120 px black bar). */}
      <div className="flex items-center gap-1 flex-1 pr-2">
        <NavBtn onClick={() => window.shellAPI?.toggleSidebar?.()} title="Toggle sidebar">
          <SidebarIcon />
        </NavBtn>

        {/* Browser nav */}
        <NavBtn onClick={onBack}    disabled={!nav.canGoBack}    title="Back">    <BackIcon />    </NavBtn>
        <NavBtn onClick={onForward} disabled={!nav.canGoForward} title="Forward"> <ForwardIcon /> </NavBtn>
        <NavBtn onClick={onReload}  title="Reload">
          <ReloadIcon spinning={nav.loading} />
        </NavBtn>

        {/* URL bar */}
        <div className="flex-1 mx-1.5">
          <div
            className="w-full h-[28px] flex items-center gap-2 rounded-[7px] px-3 cursor-text
                       transition-all duration-150"
            style={{
              background:      editing ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
              border:          "none",
              WebkitAppRegion: "no-drag",
            } as React.CSSProperties}
            onClick={startEdit}
          >
            {editing ? (
              <input
                ref={resolvedRef as React.RefObject<HTMLInputElement>}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKey}
                onBlur={() => setEditing(false)}
                className="flex-1 bg-transparent border-none outline-none text-[12px] leading-none"
                style={{ color: "rgba(245,245,247,0.95)" }}
                spellCheck={false}
                autoComplete="off"
              />
            ) : (
              <>
                <span
                  className="flex-1 text-[12px] truncate leading-none"
                  style={{ color: displayUrl ? "rgba(245,245,247,0.75)" : "rgba(245,245,247,0.30)" }}
                >
                  {displayUrl || "Navigate to any listing…"}
                </span>
                {isAnalyzing && <AnalyzingDots />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
