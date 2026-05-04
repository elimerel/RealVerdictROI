"use client"

// StageMenu — dropdown for moving a deal between pipeline stages.
// Built on shadcn DropdownMenu (Radix DropdownMenuPrimitive) so we
// inherit accessible keyboard nav, focus trap, escape-to-close, and
// portal positioning — replacing the previous hand-rolled outside-
// click + manual fixed-positioning logic.

import { ChevronDown } from "lucide-react"
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "@/lib/pipeline"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export default function StageMenu({
  stage, onChange,
}: {
  stage:    DealStage
  onChange: (s: DealStage) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium tracking-tight transition-colors h-8 px-3 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{
          color:      "var(--rv-accent)",
          background: "var(--rv-accent-dim)",
          border:     "0.5px solid var(--rv-accent-border)",
        }}
      >
        {STAGE_LABEL[stage]}
        <ChevronDown size={11} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]">
        {DEAL_STAGES.map((s) => (
          <DropdownMenuItem
            key={s}
            onSelect={() => onChange(s)}
            className="justify-between"
            style={s === stage ? { color: "var(--rv-accent)" } : undefined}
          >
            {STAGE_LABEL[s]}
            {s === stage && (
              <span
                className="ml-2 inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--rv-accent)" }}
              />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
