"use client"

import * as React from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  GitCompareArrows,
  ChevronUp,
  Trash2,
  X,
} from "lucide-react"
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "@/lib/pipeline"

/** PipelineBulkBar — floating action bar for multi-select.
 *
 *  Appears at the bottom-center of the Pipeline body when 1+ deals are
 *  checked. Surfaces the actions that pre-existed but were buried:
 *  Compare (2-4), Move to stage (any count), Delete (any count).
 *
 *  Pure presentational — handlers come from the parent. Same pattern
 *  as Mercury's bulk transaction bar or Linear's issue selection bar:
 *  appears on demand, doesn't take page space when there's no
 *  selection. */

export type PipelineBulkBarProps = {
  count:        number
  /** True only when count is in compare's valid range (2..4). */
  canCompare:   boolean
  onCompare:    () => void
  onMoveStage:  (stage: DealStage) => void
  onDelete:     () => void
  onClear:      () => void
}

export function PipelineBulkBar({
  count,
  canCompare,
  onCompare,
  onMoveStage,
  onDelete,
  onClear,
}: PipelineBulkBarProps) {
  // Two-step delete: first click switches the button to "Confirm",
  // second click executes. Avoids needing AlertDialog primitive.
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)
  React.useEffect(() => {
    if (!confirmingDelete) return
    const t = setTimeout(() => setConfirmingDelete(false), 4000)
    return () => clearTimeout(t)
  }, [confirmingDelete])

  // Hide when count drops to zero (parent unmounts us anyway, but this
  // covers any race where count=0 lingers a frame).
  if (count === 0) return null

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-40",
        "inline-flex items-center gap-1 rounded-full bg-card border border-border shadow-lg",
        "pl-3 pr-1.5 h-11"
      )}
      style={{ pointerEvents: "auto" }}
      role="toolbar"
      aria-label="Bulk actions"
    >
      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
        {count} selected
      </Badge>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      {canCompare && (
        <Button variant="ghost" size="sm" onClick={onCompare}>
          <GitCompareArrows />
          Compare
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          <ChevronUp />
          Move to stage
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" sideOffset={8} className="min-w-44">
          {DEAL_STAGES.map((s) => (
            <DropdownMenuItem key={s} onClick={() => onMoveStage(s)}>
              {STAGE_LABEL[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "transition-colors",
          confirmingDelete && "text-destructive hover:text-destructive"
        )}
        onClick={() => {
          if (confirmingDelete) {
            onDelete()
            setConfirmingDelete(false)
          } else {
            setConfirmingDelete(true)
          }
        }}
      >
        <Trash2 />
        {confirmingDelete ? `Confirm delete (${count})` : "Delete"}
      </Button>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClear}
        title="Clear selection (Esc)"
        aria-label="Clear selection"
      >
        <X />
      </Button>
    </div>
  )
}
