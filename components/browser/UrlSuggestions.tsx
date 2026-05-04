"use client"

// UrlSuggestions — the dropdown that opens under the toolbar URL bar
// when the user starts editing. Mirrors the autocomplete pattern from
// Chrome / Arc / Dia: recent listings (filtered by typed text), site
// suggestions when the field is empty, and a "Search Google for X"
// fallback when the input doesn't look like a URL.
//
// Keyboard navigation works via arrow keys ↑/↓ and Enter — same model
// as Chrome's omnibox. Mouse click also navigates. The toolbar passes
// in the current draft; selecting any row calls onPick with the URL.

import { useEffect, useState, useRef } from "react"
import { Compass, History, Search, Globe } from "lucide-react"
import { fetchRecentListings, type RecentListing } from "@/lib/pipeline"

const SUGGESTED_SITES: { label: string; url: string; tagline: string }[] = [
  { label: "Zillow",      url: "https://www.zillow.com",       tagline: "Listings + rent estimates" },
  { label: "Redfin",      url: "https://www.redfin.com",       tagline: "Listings + comparable sales" },
  { label: "Realtor.com", url: "https://www.realtor.com",      tagline: "MLS-aggregated listings" },
  { label: "LoopNet",     url: "https://www.loopnet.com",      tagline: "Commercial properties" },
]

export interface SuggestionRow {
  kind:    "history" | "site" | "search"
  url:     string
  primary: string
  sub?:    string
  /** site name for the icon — Z, R, etc. — when kind is history. */
  siteName?: string | null
}

interface Props {
  /** Current text in the URL input. Empty string = show defaults. */
  draft:    string
  /** Selected row index (driven by keyboard nav from the parent). */
  selected: number
  /** Fired when the user clicks a row OR when the parent presses Enter
   *  — the parent reads the current selection and calls this. */
  onPick:   (url: string) => void
  /** Tells the parent how many rows are visible so arrow-key nav clamps
   *  correctly. */
  onRowsChange: (rows: SuggestionRow[]) => void
}

export default function UrlSuggestions({ draft, selected, onPick, onRowsChange }: Props) {
  const [recent, setRecent] = useState<RecentListing[]>([])
  const lastRowsRef = useRef<string>("")

  // Hydrate recent listings on mount. Refresh on every focus
  // (parent unmounts/mounts the dropdown each editing session).
  useEffect(() => {
    let cancelled = false
    fetchRecentListings(20).then((rows) => { if (!cancelled) setRecent(rows) })
    return () => { cancelled = true }
  }, [])

  // Compose the visible rows from draft + recent + sites + search fallback.
  // Filtering is case-insensitive and matches across URL, title, address.
  const trimmed = draft.trim().toLowerCase()
  const filteredHistory = recent.filter((r) => {
    if (!trimmed) return true
    return (r.url.toLowerCase().includes(trimmed)
         || (r.title ?? "").toLowerCase().includes(trimmed)
         || (r.address ?? "").toLowerCase().includes(trimmed))
  }).slice(0, 6)

  const rows: SuggestionRow[] = []

  // History rows first — these are the user's actual past navigations,
  // most likely what they want.
  filteredHistory.forEach((r) => {
    rows.push({
      kind:     "history",
      url:      r.url,
      primary:  r.title || r.address || r.url,
      sub:      r.address && r.title ? r.address : r.url,
      siteName: r.site_name,
    })
  })

  // Site suggestions when there's no history match (or empty draft).
  if (!trimmed || filteredHistory.length < 3) {
    SUGGESTED_SITES.forEach((s) => {
      const matches = !trimmed
        || s.label.toLowerCase().includes(trimmed)
        || s.url.toLowerCase().includes(trimmed)
      if (matches && !rows.some((r) => r.url === s.url)) {
        rows.push({ kind: "site", url: s.url, primary: s.label, sub: s.tagline })
      }
    })
  }

  // Search fallback — only when draft has content and doesn't look like
  // a URL (no dot, no protocol). Matches Chrome's omnibox behavior.
  if (trimmed && !trimmed.includes(".") && !trimmed.startsWith("http")) {
    rows.push({
      kind:    "search",
      url:     `https://www.google.com/search?q=${encodeURIComponent(draft.trim())}`,
      primary: `Search the web for "${draft.trim()}"`,
      sub:     "via Google",
    })
  }

  // Notify parent of row changes so arrow-key nav can clamp. Stringify
  // for cheap diffing — rows is a small array.
  useEffect(() => {
    const sig = rows.map((r) => r.url).join("|")
    if (sig !== lastRowsRef.current) {
      lastRowsRef.current = sig
      onRowsChange(rows)
    }
  })

  if (rows.length === 0) return null

  return (
    <div
      className="absolute left-0 right-0 top-full mt-1.5 rounded-[10px] overflow-hidden rv-suggestions-pop"
      style={{
        zIndex:         50,
        background:     "var(--rv-popover-bg)",
        backdropFilter: "blur(30px) saturate(160%)",
        WebkitBackdropFilter: "blur(30px) saturate(160%)",
        border:         "0.5px solid var(--rv-border-mid)",
        boxShadow:      "0 12px 32px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.04) inset",
        padding:        4,
      }}
      onMouseDown={(e) => e.preventDefault()}  // keep input focused
    >
      {rows.map((row, i) => (
        <SuggestionRowEl
          key={`${row.kind}-${row.url}-${i}`}
          row={row}
          active={i === selected}
          onClick={() => onPick(row.url)}
        />
      ))}
    </div>
  )
}

function SuggestionRowEl({
  row, active, onClick,
}: {
  row:    SuggestionRow
  active: boolean
  onClick: () => void
}) {
  const Icon = row.kind === "history" ? History : row.kind === "search" ? Search : Globe
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className="w-full flex items-center gap-3 text-left rounded-[7px]"
      style={{
        padding:    "8px 10px",
        background: active ? "var(--rv-elev-3)" : "transparent",
        transition: "background 80ms",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-3)" }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? "var(--rv-elev-3)" : "transparent" }}
    >
      <span
        className="shrink-0 inline-flex items-center justify-center rounded-full"
        style={{
          width:  22,
          height: 22,
          color:  active ? "var(--rv-accent)" : "var(--rv-t3)",
          background: "var(--rv-elev-2)",
        }}
      >
        <Icon size={11} strokeWidth={2} />
      </span>
      <div className="flex-1 min-w-0 flex items-baseline gap-2">
        <span
          className="text-[13px] truncate"
          style={{ color: "var(--rv-t1)", letterSpacing: "-0.005em" }}
        >
          {row.primary}
        </span>
        {row.sub && (
          <span className="text-[11.5px] truncate" style={{ color: "var(--rv-t4)" }}>
            {row.sub}
          </span>
        )}
      </div>
    </button>
  )
}
