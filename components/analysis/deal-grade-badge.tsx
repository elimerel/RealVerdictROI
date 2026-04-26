import { cn } from "@/lib/utils"
import type { DealGrade } from "@/lib/types"

interface DealGradeBadgeProps {
  grade: DealGrade
  size?: "sm" | "md" | "lg"
  className?: string
}

const gradeConfig: Record<
  DealGrade,
  { bg: string; text: string; border: string }
> = {
  A: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
  },
  B: {
    bg: "bg-sky-500/10",
    text: "text-sky-400",
    border: "border-sky-500/20",
  },
  C: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
  },
  D: {
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-500/20",
  },
  F: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/20",
  },
}

const sizeConfig = {
  sm: "h-5 w-5 text-[10px]",
  md: "h-6 w-6 text-xs",
  lg: "h-8 w-8 text-sm",
}

export function DealGradeBadge({
  grade,
  size = "md",
  className,
}: DealGradeBadgeProps) {
  const config = gradeConfig[grade]

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-md border font-semibold font-mono",
        config.bg,
        config.text,
        config.border,
        sizeConfig[size],
        className
      )}
    >
      {grade}
    </div>
  )
}
