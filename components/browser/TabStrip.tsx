"use client"

import { Plus, X } from "lucide-react"
import type { TabInfo } from "@/lib/electron"

interface TabStripProps {
  tabs:        TabInfo[]
  activeId:    string | null
  /** Left padding so the strip clears the macOS traffic lights / sidebar
   *  toggle in icons-only / hidden modes. Same logic as the Toolbar. */
  paddingLeft: number
  onActivate:  (id: string) => void
  onClose:     (id: string) => void
  onNew:       () => void
}

/** Compact tab strip — sits above the toolbar on /browse only. Renders
 *  nothing when there's only a single tab and it's empty (i.e., the
 *  start screen state). */
export default function TabStrip({
  tabs, activeId, paddingLeft, onActivate, onClose, onNew,
}: TabStripProps) {
  if (tabs.length === 0) return null
  // Hide the strip entirely when there's just one empty tab — keeps the
  // start screen feeling clean. The "+" still lives in the toolbar (next
  // to the panel toggle) for users who want to make a second tab early.
  const onlyOneEmpty = tabs.length === 1 && !tabs[0].url
  if (onlyOneEmpty) return null

  return (
    <div
      className="flex items-stretch shrink-0 select-none rv-tabstrip relative"
      style={{
        height:           38,                    // bumped from 34 for breathability
        paddingLeft,
        paddingRight:     8,
        WebkitAppRegion:  "drag",
        // Shared elev-3 surface with the toolbar below — no border
        // between them. The tabs sit IN the chrome, not on top of it.
        background:       "var(--rv-elev-3)",
        transition:       "padding-left 220ms cubic-bezier(0.32, 0.72, 0, 1)",
      } as React.CSSProperties}
    >
      <div
        className="flex items-stretch gap-[2px] flex-1 min-w-0 overflow-x-auto rv-tabstrip-scroll"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {tabs.map((t) => (
          <TabItem
            key={t.id}
            tab={t}
            active={t.id === activeId}
            onActivate={() => onActivate(t.id)}
            onClose={() => onClose(t.id)}
          />
        ))}
        <button
          onClick={onNew}
          title="New tab (⌘T)"
          aria-label="New tab"
          className="self-center inline-flex items-center justify-center rounded-[6px]"
          style={{
            width:       24,
            height:      24,
            marginLeft:  4,
            color:       "var(--rv-t4)",
            background:  "transparent",
            transition:  "color 100ms cubic-bezier(0.4, 0, 0.2, 1), background-color 100ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color      = "var(--rv-t2)"
            e.currentTarget.style.background = "var(--rv-elev-2)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color      = "var(--rv-t4)"
            e.currentTarget.style.background = "transparent"
          }}
        >
          <Plus size={12} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  )
}

function TabItem({
  tab, active, onActivate, onClose,
}: {
  tab:        TabInfo
  active:     boolean
  onActivate: () => void
  onClose:    () => void
}) {
  return (
    <div
      onClick={onActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onActivate() }}
      className="group relative flex items-center gap-2 cursor-default select-none"
      style={{
        // Slightly wider + taller for breathability; fully rounded so
        // each tab reads as its own object inside the chrome strip.
        width:        200,
        minWidth:     200,
        maxWidth:     200,
        height:       30,
        padding:      "0 10px 0 12px",
        marginTop:    4,
        marginBottom: 4,
        borderRadius: 8,
        // Active = lifted, recessed bg + hairline border + soft inner
        // top highlight. Inactive = quiet, no border. The shared elev-3
        // toolbar background means the active tab reads as MORE lifted,
        // not as a separate surface.
        background:   active ? "var(--rv-bg)" : "transparent",
        color:        active ? "var(--rv-t1)" : "var(--rv-t3)",
        boxShadow:    active
          ? "0 0 0 0.5px var(--rv-border-mid), inset 0 1px 0 rgba(255,255,255,0.06)"
          : "none",
        transition:   "background-color 120ms cubic-bezier(0.4, 0, 0.2, 1), color 120ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 120ms",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--rv-elev-2)"
          e.currentTarget.style.color      = "var(--rv-t1)"
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent"
          e.currentTarget.style.color      = "var(--rv-t3)"
        }
      }}
    >
      {/* Loading indicator — only when this URL is actually going to
          trigger analysis. Showing the green pulse on every page load
          (Google searches, news sites, anything) reads as "analysis
          starting" when nothing of the kind is happening. Quiet by
          default; light up only when there's something to wait for. */}
      {tab.loading && tab.isListing && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: "var(--rv-accent)", animation: "dotPulse 1.4s ease-in-out infinite" }}
        />
      )}
      <span
        className="text-[12px] truncate flex-1 leading-none"
        style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.005em" }}
      >
        {tab.title || (tab.url ? new URL(tab.url).hostname.replace(/^www\./, "") : "New tab")}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        title="Close tab (⌘W)"
        aria-label="Close tab"
        className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center rounded-[4px] transition-all shrink-0"
        style={{
          width:       16,
          height:      16,
          color:       "var(--rv-t4)",
          background:  "transparent",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)"; e.currentTarget.style.background = "var(--rv-elev-4)" }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t4)"; e.currentTarget.style.background = "transparent" }}
      >
        <X size={10} strokeWidth={1.8} />
      </button>
    </div>
  )
}
