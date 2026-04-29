"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import type { FieldProvenance, ProvenanceSource } from "@/lib/types"

// ---------------------------------------------------------------------------
// Source abbreviations — what appears in the chip
// ---------------------------------------------------------------------------

const SOURCE_ABBREV: Record<ProvenanceSource, string> = {
  "zillow-listing":     "ZILLOW",
  "rentcast":           "RENTCAST",
  "rent-comps":         "COMPS",
  "fred":               "FRED",
  "fhfa-hpi":           "FHFA",
  "fema-nfhl":          "FEMA",
  "state-average":      "STATE",
  "state-investor-rate":"STATE",
  "national-average":   "NATIONAL",
  "default":            "DEFAULT",
  "user":               "MANUAL",
}

// ---------------------------------------------------------------------------
// Colors per confidence level
// Chip background + text color. We use opacity tokens so they work on
// any dark surface without hard-coding a specific background.
// ---------------------------------------------------------------------------

type ConfidenceStyle = {
  chip:  string   // bg + text (Tailwind)
  dot:   string   // colored dot
  label: string
}

const CONFIDENCE_STYLE: Record<string, ConfidenceStyle> = {
  high: {
    chip:  "bg-white/6 text-white/40 hover:bg-white/10 hover:text-white/70",
    dot:   "bg-emerald-500/70",
    label: "Verified",
  },
  medium: {
    chip:  "bg-amber-500/10 text-amber-400/70 hover:bg-amber-500/18 hover:text-amber-400",
    dot:   "bg-amber-400",
    label: "Estimated",
  },
  low: {
    chip:  "bg-red-500/10 text-red-400/60 hover:bg-red-500/16 hover:text-red-400",
    dot:   "bg-red-400",
    label: "Assumed",
  },
}

// ---------------------------------------------------------------------------
// Popover — the tooltip content shown on click
// ---------------------------------------------------------------------------

function SourcePopover({
  provenance,
  onClose,
}: {
  provenance: FieldProvenance
  onClose: () => void
}) {
  const style = CONFIDENCE_STYLE[provenance.confidence] ?? CONFIDENCE_STYLE.high
  const note  = provenance.note ?? provenance.tooltip

  return (
    <div className="absolute bottom-full left-0 mb-2 z-50 w-60 rounded-lg border border-white/10 bg-[oklch(0.14_0.013_252)] p-3 shadow-2xl text-[11px] leading-relaxed">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", style.dot)} />
          <span className="font-mono font-semibold text-white/70 tracking-wider text-[10px] uppercase">
            {SOURCE_ABBREV[provenance.source] ?? provenance.source}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider" style={{
          color: provenance.confidence === "high" ? "#22c55e" :
                 provenance.confidence === "medium" ? "#eab308" : "#ef4444",
          opacity: 0.8,
        }}>
          {style.label}
        </span>
      </div>

      {/* Note */}
      {note && (
        <p className="text-white/50 leading-relaxed">{note}</p>
      )}

      {/* Close */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute top-2 right-2 text-white/20 hover:text-white/50 transition-colors"
        aria-label="Close"
      >
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SourceTag — the main export
//
// Renders as a compact chip: [SOURCE_ABBREV] with confidence-appropriate
// colors. Click expands to a popover with full source + note.
//
// Usage:
//   <SourceTag provenance={inputProvenance.monthlyRent} />
//   <SourceTag provenance={inputProvenance.loanInterestRate} showDot={false} />
// ---------------------------------------------------------------------------

export default function SourceTag({
  provenance,
  className,
}: {
  provenance: FieldProvenance | null | undefined
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  if (!provenance) return null

  const style = CONFIDENCE_STYLE[provenance.confidence] ?? CONFIDENCE_STYLE.high
  const abbrev = SOURCE_ABBREV[provenance.source] ?? provenance.source.toUpperCase()

  return (
    <span ref={ref} className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 h-4 rounded text-[9px] font-mono font-semibold uppercase tracking-[0.06em] transition-all duration-100 cursor-pointer select-none",
          style.chip,
        )}
        aria-label={`Data source: ${abbrev}`}
      >
        <span className={cn("h-1 w-1 rounded-full shrink-0", style.dot)} />
        {abbrev}
      </button>

      {open && (
        <SourcePopover
          provenance={provenance}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  )
}
