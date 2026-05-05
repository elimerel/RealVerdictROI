"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  Compass,
  LayoutGrid,
  Settings,
  Bookmark,
  History,
  Sparkles,
  type LucideIcon,
} from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  fetchPipeline,
  fetchRecentListings,
  STAGE_LABEL,
  type SavedDeal,
  type RecentListing,
} from "@/lib/pipeline"
import type { AskResponse } from "@/lib/electron"
import { useEscape } from "@/lib/escapeStack"

/**
 * Action in the palette. `run` is what fires on Enter or click. `score`
 * lets us pin commonly-used actions to the top of an unfiltered list.
 */
interface Action {
  id:        string
  group:     "Navigate" | "Recent" | "Saved" | "Actions" | "Ask"
  label:     string
  sub?:      string
  Icon?:     LucideIcon
  shortcut?: string
  run:       () => void
}

/** Lightweight global event bus so any component can request actions
 *  to be wired in. Avoids a heavy context for what's essentially a few
 *  callbacks. */
const PALETTE_OPEN_EVENT  = "rv:palette-open"
const PALETTE_CLOSE_EVENT = "rv:palette-close"

/** Open the palette from anywhere. */
export function openCommandPalette() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT))
  }
}
export function closeCommandPalette() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PALETTE_CLOSE_EVENT))
  }
}

// ── Page-side hook for injecting page-specific actions ─────────────────────
//
// Each route can call usePaletteActions([...]) on mount to add its own
// commands (e.g. Browse adds "Save current listing"). The actions live as
// long as the component is mounted; on unmount, they unregister.

const contextActions: Set<() => Action[]> = new Set()
const contextSubscribers: Set<() => void> = new Set()
function notifyContextChanged() { for (const cb of contextSubscribers) cb() }

export function usePaletteActions(builder: () => Action[]) {
  // Keep the latest builder in a ref so we don't churn the registration
  // on every render. Re-renders are common (state changes) — we only
  // want the SET to change when the route mounts/unmounts.
  const builderRef = useRef(builder)
  builderRef.current = builder

  useEffect(() => {
    const fn = () => builderRef.current()
    contextActions.add(fn)
    notifyContextChanged()
    return () => {
      contextActions.delete(fn)
      notifyContextChanged()
    }
  }, [])
}

// ── Palette component ──────────────────────────────────────────────────────

export default function CommandPalette() {
  const router   = useRouter()
  const pathname = usePathname()

  const [open,    setOpen]    = useState(false)
  const [query,   setQuery]   = useState("")
  const [recents, setRecents] = useState<RecentListing[]>([])
  const [deals,   setDeals]   = useState<SavedDeal[]>([])
  const [, forceTick]         = useState(0)
  /** Inline answer card — shown when Ask returns "answer" or "filter".
   *  Cleared on next query / next open. */
  const [askAnswer,  setAskAnswer]  = useState<{ text: string } | null>(null)
  const [askLoading, setAskLoading] = useState(false)

  // Subscribe to global open/close + ⌘K keyboard shortcut.
  // Two paths fire ⌘K:
  //   1. The native menu accelerator in main.js → IPC → __rvOnShortcut
  //      (works regardless of focus, even when the embedded browser owns it)
  //   2. window keydown — only fires when the React renderer has focus.
  //      Kept as a fallback for web preview.
  useEffect(() => {
    const onOpen  = () => setOpen(true)
    const onClose = () => setOpen(false)
    const onKey   = (e: KeyboardEvent) => {
      const mod = navigator.platform.startsWith("Mac") ? e.metaKey : e.ctrlKey
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener(PALETTE_OPEN_EVENT, onOpen)
    window.addEventListener(PALETTE_CLOSE_EVENT, onClose)
    window.addEventListener("keydown", onKey)
    const offShortcut = window.__rvOnShortcut?.((kind) => {
      if (kind === "open-palette") setOpen((v) => !v)
    })
    return () => {
      window.removeEventListener(PALETTE_OPEN_EVENT, onOpen)
      window.removeEventListener(PALETTE_CLOSE_EVENT, onClose)
      window.removeEventListener("keydown", onKey)
      offShortcut?.()
    }
  }, [])

  // Esc closes the palette via the global dismiss stack so it cooperates
  // with other dismissable surfaces (drawer, panel) — Esc closes the
  // topmost open thing, not the palette specifically.
  useEscape(open, () => setOpen(false))

  // Re-render when context actions change (mount/unmount of route).
  useEffect(() => {
    const cb = () => forceTick((t) => t + 1)
    contextSubscribers.add(cb)
    return () => { contextSubscribers.delete(cb) }
  }, [])

  // Reset query on each open. CommandDialog auto-focuses the input.
  useEffect(() => {
    if (!open) return
    setQuery("")
    setAskAnswer(null)
    // Pull fresh data on open so the lists reflect any saves since last open.
    fetchRecentListings(8).then(setRecents).catch(() => {})
    fetchPipeline().then(setDeals).catch(() => {})
  }, [open])

  // Clear the answer card whenever the user starts typing a fresh query.
  useEffect(() => { setAskAnswer(null) }, [query])

  // Ask — sends the query to Haiku with a compact context bundle.
  const onAsk = useCallback(async () => {
    const q = query.trim()
    if (!q || askLoading) return
    const api = window.electronAPI
    if (!api?.askQuery) {
      setAskAnswer({ text: "Ask requires an Anthropic key in Advanced settings." })
      return
    }
    setAskLoading(true)
    setAskAnswer(null)
    const context = {
      currentRoute: pathname,
      savedDeals: deals.slice(0, 30).map((d) => ({
        id:           d.id,
        address:      d.address,
        city:         d.city,
        state:        d.state,
        listPrice:    d.list_price,
        monthlyCashFlow: d.snapshot?.metrics?.monthlyCashFlow,
        capRate:      d.snapshot?.metrics?.capRate,
        dscr:         d.snapshot?.metrics?.dscr,
        stage:        d.stage,
        sourceUrl:    d.source_url,
        tags:         d.tags,
      })),
      recentListings: recents.slice(0, 6).map((r) => ({
        url: r.url, address: r.address, siteName: r.site_name,
      })),
    }
    let res: { ok: boolean; response: AskResponse | null; reason?: string } | null = null
    try { res = await api.askQuery(q, context) } catch { /* fall through */ }
    setAskLoading(false)
    if (!res?.ok || !res.response) {
      setAskAnswer({ text: "Couldn't reach the assistant. Try again in a moment." })
      return
    }
    const r = res.response
    if (r.kind === "answer") {
      setAskAnswer({ text: r.text })
    } else if (r.kind === "navigate") {
      router.push(r.url)
      setOpen(false)
    } else if (r.kind === "open") {
      router.push(`/browse?url=${encodeURIComponent(r.url)}`)
      setOpen(false)
    } else if (r.kind === "filter") {
      const params = new URLSearchParams()
      if (r.stage)        params.set("stage", r.stage)
      if (r.city)         params.set("city",  r.city)
      if (r.minCapRate    != null) params.set("minCap",      String(r.minCapRate))
      if (r.minCashFlow   != null) params.set("minCashFlow", String(r.minCashFlow))
      router.push(`/pipeline${params.toString() ? `?${params.toString()}` : ""}`)
      setOpen(false)
    } else {
      setAskAnswer({ text: "I'm not sure how to handle that yet." })
    }
  }, [query, askLoading, pathname, deals, recents, router])

  // Build the action list from current state + page-injected actions.
  const allActions: Action[] = useMemo(() => {
    if (!open) return []

    const acts: Action[] = []

    // Context actions from the current route (e.g. Save current listing).
    for (const fn of contextActions) {
      try { acts.push(...fn()) } catch { /* ignore failures */ }
    }

    // Navigate
    acts.push(
      { id: "nav-browse",   group: "Navigate", label: "Browse",   Icon: Compass,    shortcut: "⌘1", run: () => router.push("/browse") },
      { id: "nav-pipeline", group: "Navigate", label: "Pipeline", Icon: LayoutGrid, shortcut: "⌘2", run: () => router.push("/pipeline") },
      { id: "nav-settings", group: "Navigate", label: "Settings", Icon: Settings,   shortcut: "⌘3", run: () => router.push("/settings") },
    )

    // Recent listings — open in /browse via deep-link
    for (const r of recents) {
      const headline = r.address || r.title || prettyHost(r.url)
      acts.push({
        id:    `recent-${r.url}`,
        group: "Recent",
        label: headline,
        sub:   r.site_name ?? prettyHost(r.url),
        Icon:  History,
        run:   () => router.push(`/browse?url=${encodeURIComponent(r.url)}`),
      })
    }

    // Saved deals — open by URL
    for (const d of deals) {
      const headline = d.address
        ? [d.address, d.city, d.state].filter(Boolean).join(", ")
        : prettyHost(d.source_url)
      acts.push({
        id:    `deal-${d.id}`,
        group: "Saved",
        label: headline,
        sub:   `${STAGE_LABEL[d.stage]} · ${d.list_price ? fmtCurrency(d.list_price) : "—"}`,
        Icon:  Bookmark,
        run:   () => router.push(`/browse?url=${encodeURIComponent(d.source_url)}`),
      })
    }

    return acts
  }, [open, recents, deals, router])

  // "Ask…" entry — appears when the user has typed >= 3 chars AND the
  // current text doesn't exactly match a known action label. Always shown
  // last so the palette's keyboard-driven navigation reads naturally.
  const askEntry: Action | null = useMemo(() => {
    const q = query.trim()
    if (q.length < 3) return null
    return {
      id:    "ask-ai",
      group: "Ask",
      label: `Ask: "${q}"`,
      sub:   "AI answers from your saved deals + recent listings",
      Icon:  Sparkles,
      run:   () => { void onAsk() },
    }
  }, [query, onAsk])

  // Filter by query — simple substring is fine. The Ask entry, when
  // present, always tail-appends so it never gets filtered out.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = !q
      ? allActions
      : allActions.filter((a) =>
          a.label.toLowerCase().includes(q) ||
          a.sub?.toLowerCase().includes(q) ||
          a.group.toLowerCase().includes(q),
        )
    return askEntry ? [...base, askEntry] : base
  }, [query, allActions, askEntry])

  // Suppress nav-to-current entries — clutter.
  const filteredFinal = filtered.filter((a) => {
    if (a.id === "nav-browse"   && pathname === "/browse")   return false
    if (a.id === "nav-pipeline" && pathname === "/pipeline") return false
    if (a.id === "nav-settings" && pathname === "/settings") return false
    return true
  })

  // Group actions by category for the cmdk-rendered list.
  const groupedActions = groupKeysInOrder(filteredFinal).map((g) => ({
    name:  g,
    items: filteredFinal.filter((a) => a.group === g),
  }))

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Search saved deals, recent listings, or actions"
      className="max-w-[640px]"
    >
      {/* cmdk's built-in fuzzy filter clashes with our context actions
          (which are state-driven), so we drive filtering ourselves and
          tell cmdk to render every item via shouldFilter={false}. */}
      <Command shouldFilter={false} loop className="rounded-xl">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search saved deals, recent listings, or actions…"
        />
        {/* Inline AI answer card — sits above the list when Ask fires. */}
        {(askAnswer || askLoading) && (
          <div className="px-2 pt-2 pb-1">
            <div
              className="flex items-start gap-2.5 rounded-md px-3 py-2.5"
              style={{
                background: "var(--rv-accent-dim)",
                border:     "0.5px solid var(--rv-accent-border)",
              }}
            >
              <Sparkles size={12} strokeWidth={1.7} style={{ color: "var(--rv-accent)", marginTop: 2 }} />
              <p className="text-[12.5px] leading-relaxed" style={{ color: askLoading ? "var(--rv-t3)" : "var(--rv-t1)" }}>
                {askAnswer ? askAnswer.text : "Asking…"}
              </p>
            </div>
          </div>
        )}
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2 py-2">
              <Sparkles size={16} strokeWidth={1.5} style={{ color: "var(--rv-t4)" }} />
              <p className="text-[12.5px]" style={{ color: "var(--rv-t2)" }}>
                {query ? "No matches" : "Start typing to search"}
              </p>
              {query && (
                <p className="text-[11px]" style={{ color: "var(--rv-t4)" }}>
                  Try a stage, address, or "save"
                </p>
              )}
            </div>
          </CommandEmpty>
          {groupedActions.map(({ name, items }) => (
            <CommandGroup key={name} heading={name}>
              {items.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.id}-${a.label}`}
                  onSelect={() => {
                    a.run()
                    if (a.id !== "ask-ai") setOpen(false)
                  }}
                >
                  {a.Icon && <a.Icon className="text-muted-foreground" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] truncate leading-tight">{a.label}</div>
                    {a.sub && (
                      <div
                        className="text-[11px] truncate leading-tight mt-0.5"
                        style={{ color: "var(--rv-t4)" }}
                      >
                        {a.sub}
                      </div>
                    )}
                  </div>
                  {a.shortcut && (
                    <kbd
                      className="ml-auto hidden md:inline-flex items-center justify-center rounded px-1.5 py-[2px] text-[10px]"
                      style={{
                        background: "var(--rv-elev-2)",
                        color:      "var(--rv-t3)",
                        border:     "0.5px solid var(--rv-border)",
                      }}
                    >
                      {a.shortcut}
                    </kbd>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function groupKeysInOrder(list: Action[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const a of list) {
    if (seen.has(a.group)) continue
    seen.add(a.group)
    order.push(a.group)
  }
  return order
}

function prettyHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url }
}

function fmtCurrency(n: number | null) {
  if (n == null) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

// Re-export the Action type so route components can construct it.
export type { Action }
