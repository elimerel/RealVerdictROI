"use client"

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react"
import type { NavUpdate } from "@/lib/electron"
import { useSidebar } from "@/components/sidebar/context"
import { SNAP_ICONS } from "@/components/sidebar/context"
import UrlSuggestions, { type SuggestionRow } from "./UrlSuggestions"
import PanelToggle from "./PanelToggle"

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
  nav:           NavUpdate
  isAnalyzing:   boolean
  onBack:        () => void
  onForward:     () => void
  onReload:      () => void
  onNavigate:    (url: string) => void
  urlbarRef?:    React.RefObject<HTMLInputElement | null>
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
  // Suggestion dropdown state — selected row index + the rows currently
  // visible (the dropdown reports its rows up so arrow-key nav can clamp).
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const [visibleRows, setVisibleRows] = useState<SuggestionRow[]>([])
  // Reset selection to top whenever the user types — Chrome/Arc behavior.
  useEffect(() => { setSelectedSuggestion(0) }, [draft])

  // The sidebar's mode dictates how much left padding the toolbar needs
  // to clear the global sidebar-toggle button (fixed at window x=86-114):
  //   - full   (sidebar >=120): toggle sits inside the sidebar; toolbar
  //     starts past x=120 already → just an 8px visual breath.
  //   - icons  (sidebar=80):    toolbar starts at x=80; toggle covers x=86-114
  //     → pad 38 (toolbar-relative) to clear x=118 visible toolbar content.
  //   - hidden (sidebar=0):     toolbar starts at x=0; toggle covers x=86-114
  //     → pad 120 to push content past traffic lights AND toggle.
  const { open, width } = useSidebar()
  let toolbarPadL = 8
  if (!open)                  toolbarPadL = 120  // hidden
  else if (width < SNAP_ICONS) toolbarPadL = 38   // icons

  const displayUrl = nav.url ?? ""

  const startEdit = useCallback(() => {
    // Idempotent — clicks bubbling from the input itself shouldn't reset
    // the draft the user is mid-typing.
    if (editing) return
    setDraft(displayUrl)
    setEditing(true)
    // Focus + select on the next paint. .select() alone doesn't move
    // focus; without explicit .focus(), clicking the wrapper leaves
    // focus on whatever had it before (often browserView), and typed
    // characters go there instead of the URL bar — which is why hitting
    // Enter sometimes did nothing.
    setTimeout(() => {
      const el = resolvedRef.current
      if (!el) return
      el.focus()
      el.select()
    }, 0)
  }, [editing, displayUrl, resolvedRef])

  // ⌘L (View → Open URL Bar) broadcasts `browser:focus-urlbar`. Subscribe
  // here so the URL bar enters edit mode AND focuses, even when the
  // embedded browserView had focus a moment ago.
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onFocusUrlbar) return
    return api.onFocusUrlbar(() => startEdit())
  }, [startEdit])

  /**
   * Commit the typed URL or search. Reads draft directly off `e` so we
   * never miss a navigation when the input blurs in the same tick. Order
   * matters: navigate first, then exit edit mode — flipping editing to
   * false unmounts the input and any pending state would be discarded.
   */
  function commit(value: string) {
    const trimmed = value.trim()
    if (!trimmed) {
      setEditing(false)
      return
    }
    let url = trimmed
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = url.includes(".")
        ? `https://${url}`
        : `https://www.google.com/search?q=${encodeURIComponent(url)}`
    }
    onNavigate(url)
    setEditing(false)
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      // If the user has navigated to a suggestion via arrow keys, commit
      // THAT URL — otherwise commit whatever they typed. Same Chrome behavior.
      const picked = visibleRows[selectedSuggestion]
      if (picked) {
        onNavigate(picked.url)
        setEditing(false)
      } else {
        commit((e.currentTarget as HTMLInputElement).value)
      }
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedSuggestion((s) => Math.min(s + 1, Math.max(0, visibleRows.length - 1)))
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedSuggestion((s) => Math.max(s - 1, 0))
      return
    }
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
                 text-[var(--rv-t2)] hover:text-[var(--rv-t1)] hover:bg-[var(--rv-elev-4)]
                 active:bg-[var(--rv-elev-5)]
                 disabled:opacity-25 disabled:pointer-events-none"
    >
      {children}
    </button>
  )

  return (
    <div
      className="flex items-center shrink-0 select-none"
      style={{
        height:          52,
        WebkitAppRegion: "drag",
        // --rv-surface so the toolbar matches the ACTIVE tab's bg
        // exactly. That's the visual handoff: the active tab "merges"
        // into the toolbar (same color), inactive tabs sit on the
        // darker strip behind. Chrome's pattern. The previous attempt
        // to push the toolbar onto --rv-bg broke that handoff.
        background:      "var(--rv-surface)",
        boxShadow:       "0 1px 0 rgba(0,0,0,0.30), 0 6px 18px rgba(0,0,0,0.30)",
        paddingLeft:     toolbarPadL,
        paddingRight:    8,
        transition:      "padding-left 220ms cubic-bezier(0.32, 0.72, 0, 1)",
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-1 flex-1 pr-2">
        <NavBtn onClick={onBack}    disabled={!nav.canGoBack}    title="Back">    <BackIcon />    </NavBtn>
        <NavBtn onClick={onForward} disabled={!nav.canGoForward} title="Forward"> <ForwardIcon /> </NavBtn>
        <NavBtn onClick={onReload}  title="Reload">
          <ReloadIcon spinning={nav.loading} />
        </NavBtn>

        <div className="flex-1 mx-1.5 relative">
          <div
            className="w-full h-[36px] flex items-center gap-2 rounded-[9px] px-4 cursor-text
                       transition-all duration-150"
            style={{
              // Default state: FLAT — same surface as the toolbar (rv-surface),
              // no inset shadow, no border. Reads as part of the toolbar
              // chrome, no chrome competing for attention.
              //
              // Editing state: recessed — darker bg (rv-bg) with a subtle
              // dark inset shadow at the top. Now it reads as a depression
              // you're filling in. This is the moment when the input matters.
              background: editing ? "var(--rv-bg)" : "transparent",
              border:     editing
                ? "0.5px solid var(--rv-border-mid)"
                : "0.5px solid transparent",
              boxShadow:  editing ? "inset 0 1px 1px rgba(0, 0, 0, 0.18)" : "none",
              WebkitAppRegion: "no-drag",
            } as React.CSSProperties}
            onClick={startEdit}
            onMouseEnter={(e) => {
              if (editing) return
              e.currentTarget.style.background = "var(--rv-elev-3)"
              e.currentTarget.style.borderColor = "var(--rv-border-mid)"
            }}
            onMouseLeave={(e) => {
              if (editing) return
              e.currentTarget.style.background = "var(--rv-elev-2)"
              e.currentTarget.style.borderColor = "var(--rv-elev-3)"
            }}
          >
            {editing ? (
              <input
                ref={resolvedRef as React.RefObject<HTMLInputElement>}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKey}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => setEditing(false)}
                className="flex-1 bg-transparent border-none outline-none text-[13px] leading-none"
                style={{ color: "var(--rv-t1)" }}
                spellCheck={false}
                autoComplete="off"
              />
            ) : (
              <>
                <span
                  className="flex-1 text-[13px] truncate leading-none"
                  style={{ color: displayUrl ? "var(--rv-t1)" : "var(--rv-t3)" }}
                >
                  {displayUrl || "Navigate to any listing…"}
                </span>
                {isAnalyzing && <AnalyzingDots />}
              </>
            )}
          </div>
          {/* Suggestion dropdown — Chrome-omnibox-style autocomplete. */}
          {editing && (
            <UrlSuggestions
              draft={draft}
              selected={selectedSuggestion}
              onPick={(url) => {
                onNavigate(url)
                setEditing(false)
              }}
              onRowsChange={setVisibleRows}
            />
          )}
        </div>

        {/* Analysis panel toggle — lives inline in the toolbar now (was a
            fixed-position window button). Right side, after the URL bar,
            same height. Reads as a primary control. */}
        <PanelToggle />
      </div>
    </div>
  )
}
