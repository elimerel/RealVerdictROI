"use client"

import * as React from "react"
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { STAGE_LABEL, type DealStage, type SavedDeal } from "@/lib/pipeline"

/** PipelineDealTable — Pipedrive-grade sortable table view of saved deals.
 *
 *  Replaces (as a view-mode option, not wholesale) the list-row pattern.
 *  Each row is an investor's mental model of a deal: address, stage,
 *  the four numbers that decide it, age in pipeline. Click a row to open
 *  the detail panel (same as list-row click). Multi-select for compare/
 *  bulk-action lives in the leftmost checkbox column. */

export type PipelineDealTableProps = {
  deals:        SavedDeal[]
  selectedId:   string | null
  onSelect:     (id: string) => void
  /** Multi-select for compare; empty array = no compare selection */
  selectedIds:  string[]
  onToggleSelect: (id: string) => void
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${n < 0 ? "−" : ""}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${n < 0 ? "−" : ""}$${(abs / 1_000).toFixed(1)}k`
  return `${n < 0 ? "−" : ""}$${Math.round(abs).toLocaleString("en-US")}`
}

function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${(n * 100).toFixed(decimals)}%`
}

function ageInDays(iso: string): number {
  const created = new Date(iso).getTime()
  return Math.max(0, Math.round((Date.now() - created) / (1000 * 60 * 60 * 24)))
}

const STAGE_TONE: Record<DealStage, string> = {
  watching:   "bg-primary/10 text-primary",
  interested: "bg-primary/15 text-primary",
  offered:    "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  won:        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  passed:     "bg-muted text-muted-foreground",
}

export function PipelineDealTable({
  deals,
  selectedId,
  onSelect,
  selectedIds,
  onToggleSelect,
}: PipelineDealTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "created_at", desc: true },
  ])

  const columns = React.useMemo<ColumnDef<SavedDeal>[]>(() => [
    {
      id: "select",
      header: () => null,
      cell: ({ row }) => (
        <Checkbox
          checked={selectedIds.includes(row.original.id)}
          onCheckedChange={() => onToggleSelect(row.original.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select deal"
        />
      ),
      enableSorting: false,
      size: 32,
    },
    {
      accessorKey: "address",
      header: "Address",
      cell: ({ row }) => {
        const d = row.original
        const street = d.address ?? "—"
        const cityState = [d.city, d.state].filter(Boolean).join(", ")
        return (
          <div className="flex flex-col">
            <span className="font-medium">{street}</span>
            {cityState && (
              <span className="text-xs text-muted-foreground">{cityState}</span>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "stage",
      header: "Stage",
      cell: ({ row }) => {
        const s = row.original.stage
        return (
          <Badge variant="outline" className={cn("capitalize", STAGE_TONE[s])}>
            {STAGE_LABEL[s] ?? s}
          </Badge>
        )
      },
    },
    {
      accessorKey: "list_price",
      header: "List price",
      cell: ({ row }) => (
        <span className="tabular-nums">{fmtCurrency(row.original.list_price)}</span>
      ),
    },
    {
      id: "monthlyCashFlow",
      header: "Cash flow",
      accessorFn: (d) => d.snapshot.metrics.monthlyCashFlow,
      cell: ({ getValue }) => {
        const v = getValue() as number
        const tone = v == null ? "" : v >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
        return (
          <span className={cn("tabular-nums", tone)}>
            {v != null ? fmtCurrency(v) : "—"}
            {v != null && <span className="ml-0.5 text-xs text-muted-foreground">/mo</span>}
          </span>
        )
      },
    },
    {
      id: "capRate",
      header: "Cap",
      accessorFn: (d) => d.snapshot.metrics.capRate,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{fmtPct(getValue() as number)}</span>
      ),
    },
    {
      id: "dscr",
      header: "DSCR",
      accessorFn: (d) => d.snapshot.metrics.dscr,
      cell: ({ getValue }) => {
        const v = getValue() as number
        return (
          <span className="tabular-nums">
            {v != null && Number.isFinite(v) ? v.toFixed(2) : "—"}
          </span>
        )
      },
    },
    {
      accessorKey: "site_name",
      header: "Source",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground capitalize">
          {row.original.site_name ?? "—"}
        </span>
      ),
    },
    {
      id: "age",
      header: "Age",
      accessorKey: "created_at",
      cell: ({ row }) => {
        const age = ageInDays(row.original.created_at)
        return <span className="text-xs text-muted-foreground tabular-nums">{age}d</span>
      },
      sortingFn: (a, b) => new Date(a.original.created_at).getTime() - new Date(b.original.created_at).getTime(),
    },
  ], [selectedIds, onToggleSelect])

  const table = useReactTable({
    data: deals,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((h) => {
                const sortDir = h.column.getIsSorted()
                const canSort = h.column.getCanSort()
                return (
                  <TableHead
                    key={h.id}
                    className={cn(
                      "h-10 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                      canSort && "cursor-pointer select-none hover:text-foreground"
                    )}
                    onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                  >
                    {h.isPlaceholder ? null : (
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {canSort && (
                          sortDir === "asc"  ? <ArrowUpIcon className="size-3" /> :
                          sortDir === "desc" ? <ArrowDownIcon className="size-3" /> :
                          <ArrowUpDownIcon className="size-3 opacity-30" />
                        )}
                      </span>
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-sm text-muted-foreground">
                No deals match the current filters.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-selected={selectedId === row.original.id}
                onClick={() => onSelect(row.original.id)}
                className={cn(
                  "cursor-pointer",
                  selectedId === row.original.id && "bg-primary/5"
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
