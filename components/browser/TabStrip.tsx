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
        height:           40,
        paddingLeft,
        paddingRight:     8,
        WebkitAppRegion:  "drag",
        // Strip is the DARK back layer (in shadow). Toolbar + active
        // tab are LIGHTER (alive, forward). Using rv-surface for the
        // toolbar gives a stronger color shift than the previous
        // elev-3 over the warm-charcoal canvas — the hierarchy now
        // reads clearly: dark strip → lighter active tab merging into
        // lighter toolbar. Same as Chrome.
        background:       "var(--rv-bg)",
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
        width:        220,
        minWidth:     220,
        maxWidth:     220,
        height:       34,
        padding:      "0 10px 0 12px",
        marginTop:    6,
        // Active tab matches the toolbar surface (var(--rv-surface)) and
        // overlaps the toolbar's top edge by 2px so they read as ONE
        // continuous lit surface — no hairline. Inactive tabs are
        // transparent over the dark strip = recessed in shadow.
        marginBottom: active ? -2 : 0,
        borderTopLeftRadius:  8,
        borderTopRightRadius: 8,
        borderBottomLeftRadius:  0,
        borderBottomRightRadius: 0,
        background:   active ? "var(--rv-surface)" : "transparent",
        color:        active ? "var(--rv-t1)" : "var(--rv-t3)",
        // No border on the active tab — clean continuous merge with
        // the toolbar below. Visual definition comes purely from the
        // bg color difference (light tab over dark strip).
        transition:   "background-color 120ms cubic-bezier(0.4, 0, 0.2, 1), color 120ms cubic-bezier(0.4, 0, 0.2, 1)",
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
