"use client"

import * as React from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, BookmarkPlus, Trash2, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "@/lib/pipeline"

/** PipelineViewsMenu — saved-views dropdown that replaces the static
 *  "All active" title in the Pipeline header.
 *
 *  Two layers of presets:
 *    - Built-in: "All active" + each DealStage. Always present.
 *    - User-saved: persisted to localStorage. Created from the
 *      current filter state via "Save current as…"; deletable
 *      individually. Each row stores `{name, stage}` — future
 *      iterations can extend to multi-axis filters (tag, min cash
 *      flow, etc.) without changing the UI.
 *
 *  Outsourced surfaces:
 *    - shadcn DropdownMenu (cmdk-style menu primitive) for the list
 *    - shadcn Button (via the trigger render prop pattern)
 *    - lucide icons for the affordances
 *
 *  Active view detection: by stage param. The currently-applied view
 *  gets a check mark on the left, so the user always sees which view
 *  is in effect. */

const STORAGE_KEY = "rv-pipeline-saved-views"

export type SavedView = {
  id:    string
  name:  string
  stage: DealStage | null  // null = "All active" (no stage filter)
}

function readSavedViews(): SavedView[] {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v: unknown): v is SavedView =>
      v != null && typeof v === "object" &&
      "id" in v && "name" in v &&
      typeof (v as SavedView).id === "string" &&
      typeof (v as SavedView).name === "string"
    )
  } catch {
    return []
  }
}

function writeSavedViews(views: SavedView[]) {
  if (typeof localStorage === "undefined") return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(views)) } catch { /* private mode */ }
}

export type PipelineViewsMenuProps = {
  currentStage:    DealStage | null
  onApplyView:     (stage: DealStage | null) => void
}

export function PipelineViewsMenu({ currentStage, onApplyView }: PipelineViewsMenuProps) {
  const [savedViews, setSavedViews] = React.useState<SavedView[]>([])
  const [naming, setNaming]         = React.useState(false)
  const [draftName, setDraftName]   = React.useState("")

  React.useEffect(() => { setSavedViews(readSavedViews()) }, [])

  const activeBuiltIn = currentStage === null ? "all" : currentStage
  // A saved view is "active" if its stage matches the current filter
  // AND no built-in matches more specifically (built-ins always win
  // when the user has the same stage filter applied without a saved
  // view name attached). For simplicity: highlight a saved view only
  // when its stage exactly matches AND the user explicitly applied it
  // (we'd need a separate flag for that — leave for now and just
  // check by stage).

  const persistAdd = React.useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const next: SavedView = {
      id:    crypto.randomUUID(),
      name:  trimmed,
      stage: currentStage,
    }
    const updated = [...savedViews, next]
    setSavedViews(updated)
    writeSavedViews(updated)
    setNaming(false)
    setDraftName("")
  }, [currentStage, savedViews])

  const persistRemove = React.useCallback((id: string) => {
    const updated = savedViews.filter((v) => v.id !== id)
    setSavedViews(updated)
    writeSavedViews(updated)
  }, [savedViews])

  const currentTitle = currentStage === null
    ? "All active"
    : STAGE_LABEL[currentStage]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <button
            type="button"
            className="inline-flex items-center gap-1.5 -mx-1 px-1 rounded hover:bg-muted/60 transition-colors"
          />
        )}
      >
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          {currentTitle}
        </span>
        <ChevronDown size={13} strokeWidth={2.2} className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-56">
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
          Built-in views
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onApplyView(null)}>
          <Check
            size={13}
            className={cn(
              activeBuiltIn === "all" ? "opacity-100 text-primary" : "opacity-0"
            )}
          />
          All active
        </DropdownMenuItem>
        {DEAL_STAGES.map((s) => (
          <DropdownMenuItem key={s} onClick={() => onApplyView(s)}>
            <Check
              size={13}
              className={cn(
                activeBuiltIn === s ? "opacity-100 text-primary" : "opacity-0"
              )}
            />
            {STAGE_LABEL[s]}
          </DropdownMenuItem>
        ))}

        {savedViews.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
              Saved views
            </DropdownMenuLabel>
            {savedViews.map((v) => (
              <DropdownMenuItem
                key={v.id}
                onClick={() => onApplyView(v.stage)}
                // Don't auto-close on the trash click; we render that
                // button as a child that stops propagation.
                className="group/sv"
              >
                <Check size={13} className="opacity-0" />
                <span className="flex-1 truncate">{v.name}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    persistRemove(v.id)
                  }}
                  className="opacity-0 group-hover/sv:opacity-60 hover:!opacity-100 transition-opacity"
                  title="Delete view"
                  aria-label={`Delete view ${v.name}`}
                >
                  <Trash2 size={12} />
                </button>
              </DropdownMenuItem>
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        {!naming ? (
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault() // keep menu open
              setNaming(true)
            }}
          >
            <BookmarkPlus size={13} />
            Save current view as…
          </DropdownMenuItem>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-1.5">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")  persistAdd(draftName)
                if (e.key === "Escape") { setNaming(false); setDraftName("") }
              }}
              placeholder="View name"
              className="flex-1 h-7 px-2 text-[12.5px] rounded-md bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
            <button
              type="button"
              onClick={() => persistAdd(draftName)}
              disabled={!draftName.trim()}
              className="text-[11.5px] font-medium text-primary disabled:opacity-40 px-1.5"
            >
              Save
            </button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
