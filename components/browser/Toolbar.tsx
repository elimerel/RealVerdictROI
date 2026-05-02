"use client"

import { useState, useRef, KeyboardEvent } from "react"
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
  const inputRef = useRef<HTMLInputElement>(null)
  const resolvedRef = urlbarRef ?? inputRef

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
      className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-100
                 text-[var(--rv-t3)] hover:text-[var(--rv-t1)] hover:bg-white/[0.06]
                 disabled:opacity-25 disabled:pointer-events-none"
    >
      {children}
    </button>
  )

  return (
    /* Outer div is drag region — window draggable by grabbing the toolbar */
    <div
      className="flex items-center h-10 border-b shrink-0 select-none"
      style={{
        WebkitAppRegion: "drag",
        background: "var(--rv-glass)",
        borderColor: "var(--rv-border)",
      } as React.CSSProperties}
    >
      {/* Inner no-drag zone: pl-20 clears macOS traffic lights */}
      <div
        className="flex items-center gap-1 flex-1 pl-20 pr-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Nav buttons */}
        <NavBtn onClick={onBack}    disabled={!nav.canGoBack}    title="Back">    <BackIcon />    </NavBtn>
        <NavBtn onClick={onForward} disabled={!nav.canGoForward} title="Forward"> <ForwardIcon /> </NavBtn>
        <NavBtn onClick={onReload}  title="Reload">
          <ReloadIcon spinning={nav.loading} />
        </NavBtn>

        {/* URL bar */}
        <div className="flex-1 mx-1.5">
          <div
            className="w-full h-[26px] flex items-center gap-2 rounded-[7px] px-3 cursor-text
                       transition-all duration-150"
            style={{
              background: editing ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${editing ? "var(--rv-border-mid)" : "var(--rv-border)"}`,
            }}
            onClick={startEdit}
          >
            {editing ? (
              <input
                ref={resolvedRef as React.RefObject<HTMLInputElement>}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKey}
                onBlur={() => setEditing(false)}
                className="flex-1 bg-transparent border-none outline-none text-[11.5px] leading-none font-mono"
                style={{ color: "var(--rv-t1)" }}
                spellCheck={false}
                autoComplete="off"
              />
            ) : (
              <>
                <span
                  className="flex-1 text-[11.5px] truncate leading-none"
                  style={{ color: displayUrl ? "var(--rv-t2)" : "var(--rv-t4)" }}
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
