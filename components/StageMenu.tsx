"use client"

// StageMenu — dropdown for moving a deal between pipeline stages.
//
// Used in the Pipeline detail rail header and the Browse panel's
// action row (when a listing is already saved). Same shape and
// behavior in both places — extracted here so the two surfaces
// can't drift visually.

import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "@/lib/pipeline"

export default function StageMenu({
  stage, onChange,
}: {
  stage:    DealStage
  onChange: (s: DealStage) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-[7px] text-[12px] font-medium tracking-tight transition-colors"
        style={{
          padding:    "5px 9px 5px 11px",
          color:      "var(--rv-accent)",
          background: "var(--rv-accent-dim)",
          border:     "0.5px solid var(--rv-accent-border)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--rv-accent) 22%, transparent)" }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--rv-accent-dim)" }}
      >
        {STAGE_LABEL[stage]}
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && (
        <div
          className="absolute z-30 left-0 top-full mt-1 flex flex-col rv-menu-pop"
          style={{
            background:           "var(--rv-popover-bg)",
            backdropFilter:       "blur(30px) saturate(160%)",
            WebkitBackdropFilter: "blur(30px) saturate(160%)",
            border:               "0.5px solid var(--rv-border-mid)",
            borderRadius:         8,
            boxShadow:            "var(--rv-shadow-outer-md)",
            minWidth:             140,
            padding:              4,
          }}
        >
          {DEAL_STAGES.map((s) => (
            <button
              key={s}
              onClick={() => { onChange(s); setOpen(false) }}
              className="text-left rounded-[6px] text-[12px] transition-colors"
              style={{
                padding:    "6px 9px",
                color:      s === stage ? "var(--rv-accent)" : "var(--rv-t2)",
                background: "transparent",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-3)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
            >
              {STAGE_LABEL[s]}
              {s === stage && (
                <span
                  className="ml-2 inline-block w-1.5 h-1.5 rounded-full align-middle"
                  style={{ background: "var(--rv-accent)" }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
