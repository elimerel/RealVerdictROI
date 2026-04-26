import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ConfidenceLevel, ProvenanceSource } from "@/lib/types"

interface ProvenanceBadgeProps {
  source: ProvenanceSource
  confidence: ConfidenceLevel
  tooltip?: string
  className?: string
}

const sourceLabels: Record<ProvenanceSource, string> = {
  "zillow-listing": "Zillow",
  rentcast: "RentCast",
  "rent-comps": "Comps",
  fred: "FRED",
  "fhfa-hpi": "FHFA",
  "fema-nfhl": "FEMA",
  "state-average": "State Avg",
  "state-investor-rate": "Inv. Rate",
  "national-average": "Nat. Avg",
  default: "Default",
  user: "User",
}

const confidenceConfig: Record<
  ConfidenceLevel,
  { bg: string; text: string; border: string }
> = {
  high: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
  },
  medium: {
    bg: "bg-sky-500/10",
    text: "text-sky-400",
    border: "border-sky-500/20",
  },
  low: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
  },
}

export function ProvenanceBadge({
  source,
  confidence,
  tooltip,
  className,
}: ProvenanceBadgeProps) {
  const config = confidenceConfig[confidence]
  const label = sourceLabels[source]

  const badge = (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider",
        config.bg,
        config.text,
        config.border,
        className
      )}
    >
      {label}
    </span>
  )

  if (!tooltip) {
    return badge
  }

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
