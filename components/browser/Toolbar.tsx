"use client"

import { useState, useRef, useEffect, KeyboardEvent } from "react"
import type { NavUpdate } from "@/lib/electron"

// ── Icons ─────────────────────────────────────────────────────────────────────

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ForwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ReloadIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden
      className={spinning ? "animate-spin" : ""}
      style={{ animationDuration: "0.7s" }}
    >
      <path
        d="M11.5 7A4.5 4.5 0 1 1 9.2 3.2M11.5 2v3h-3"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

function AnalyzingDots() {
  return (
    <span className="flex gap-0.5 items-center ml-1" title="Analyzing listing…">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1 h-1 rounded-full bg-[var(--accent)] dot-pulse"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  )
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

interface ToolbarProps {
  nav:         NavUpdate
  isAnalyzing: boolean
  onBack:      () => void
  onForward:   () => void
  onReload:    () => void
  onNavigate:  (url: string) => void
  urlbarRef?:  React.RefObject<HTMLInputElement | null>
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
      url = url.includes(".") ? `https://${url}` : `https://www.google.com/search?q=${encodeURIComponent(url)}`
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
      className="w-7 h-7 flex items-center justify-center rounded-md transition-colors
                 text-[var(--f-t2)] hover:text-[var(--f-t1)] hover:bg-[var(--f-border)]
                 disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  )

  return (
    <div
      className="flex items-center h-10 bg-[var(--f-toolbar)] border-b border-[var(--f-border)] shrink-0 select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Interactive controls — no-drag so clicks register; pl-20 clears macOS traffic lights */}
      <div
        className="flex items-center gap-1.5 flex-1 pl-20 pr-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Back / Forward / Reload */}
        <NavBtn onClick={onBack}    disabled={!nav.canGoBack}    title="Back">    <BackIcon />    </NavBtn>
        <NavBtn onClick={onForward} disabled={!nav.canGoForward} title="Forward"> <ForwardIcon /> </NavBtn>
        <NavBtn onClick={onReload}  title="Reload">
          <ReloadIcon spinning={nav.loading} />
        </NavBtn>

        {/* URL bar */}
        <div className="flex-1 flex items-center relative mx-1">
          <div
            className="w-full h-7 flex items-center rounded-lg bg-[var(--f-bg)] border border-[var(--f-border)]
                       px-3 gap-1.5 cursor-text transition-colors hover:border-[var(--f-t3)]"
            onClick={startEdit}
          >
            {editing ? (
              <input
                ref={resolvedRef as React.RefObject<HTMLInputElement>}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKey}
                onBlur={() => setEditing(false)}
                className="flex-1 bg-transparent border-none outline-none text-[12px] text-[var(--f-t1)]
                           font-mono truncate"
                spellCheck={false}
                autoComplete="off"
              />
            ) : (
              <>
                <span className="flex-1 text-[12px] text-[var(--f-t2)] truncate leading-none">
                  {displayUrl || "Type a URL…"}
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
