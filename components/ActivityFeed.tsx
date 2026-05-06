"use client"

// ActivityFeed — the "Today feed" that opens the workstation.
//
// What changed since you last looked: every save, stage move, price
// change, scenario edit. Each event is a compact row with an iconographic
// dot, a one-line title, deal context, and a relative timestamp. Click
// any row to jump to the deal in the Pipeline.
//
// Design intent: this is the AI-buddy's morning briefing rendered as
// data. The feed reads like Linear's inbox or Mercury's transactions —
// dense, scannable, click-to-open. Not a dashboard widget; the actual
// surface the user lands on. The hero stats sit BELOW the feed as
// constant context.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Bookmark, ArrowDownToLine, ArrowUpFromLine, RefreshCw, Tag, Sliders, X,
} from "lucide-react"
import {
  fetchActivityFeed,
  STAGE_LABEL,
  type ActivityEvent,
  type ActivityEventKind,
  type DealStage,
  DEALS_CHANGED_EVENT,
} from "@/lib/pipeline"
import { Currency } from "@/lib/format"

/** Map an event kind to its visual signature: icon, color (forest green
 *  for affirmative actions, clay for attention-warranted, muted for
 *  housekeeping), and a verb for the title. */
function eventStyle(e: ActivityEvent): {
  icon: React.ReactNode
  color: string
  bg: string
} {
  switch (e.kind) {
    case "saved":
      return { icon: <Bookmark size={11} strokeWidth={2.2} />, color: "var(--rv-accent)", bg: "rgba(48,164,108,0.14)" }
    case "stage_changed": {
      const newStage = (e.payload?.to ?? e.payload?.stage) as DealStage | undefined
      const isAdvance = newStage === "interested" || newStage === "offered" || newStage === "won"
      return {
        icon: isAdvance
          ? <ArrowUpFromLine size={11} strokeWidth={2.2} />
          : <ArrowDownToLine size={11} strokeWidth={2.2} />,
        color: isAdvance ? "var(--rv-accent)" : "var(--rv-t3)",
        bg:    isAdvance ? "rgba(48,164,108,0.14)" : "var(--rv-elev-2)",
      }
    }
    case "price_changed": {
      const delta = Number(e.payload?.delta ?? 0)
      const isDrop = delta < 0
      return {
        icon: isDrop
          ? <ArrowDownToLine size={11} strokeWidth={2.2} />
          : <ArrowUpFromLine size={11} strokeWidth={2.2} />,
        // Price drops are clay — attention warranted, the buddy noticed.
        // Increases are muted — info, not action.
        color: isDrop ? "var(--rv-clay)" : "var(--rv-t3)",
        bg:    isDrop ? "var(--rv-clay-dim)" : "var(--rv-elev-2)",
      }
    }
    case "reanalyzed":
      return { icon: <RefreshCw size={11} strokeWidth={2.2} />, color: "var(--rv-t3)", bg: "var(--rv-elev-2)" }
    case "tags_updated":
      return { icon: <Tag size={11} strokeWidth={2.2} />, color: "var(--rv-t3)", bg: "var(--rv-elev-2)" }
    case "scenario_changed":
    case "scenario_cleared":
      return { icon: <Sliders size={11} strokeWidth={2.2} />, color: "var(--rv-t3)", bg: "var(--rv-elev-2)" }
    default:
      return { icon: <Bookmark size={11} strokeWidth={2.2} />, color: "var(--rv-t3)", bg: "var(--rv-elev-2)" }
  }
}

/** One-line headline for the event. Reads like a notification, not a log
 *  entry: "Price dropped $15,000 on 1234 Main St." */
function eventTitle(e: ActivityEvent): React.ReactNode {
  const addr = e.deal?.address ?? e.deal?.city ?? "a saved deal"
  switch (e.kind) {
    case "saved":
      return <>Saved <span style={{ color: "var(--rv-t1)", fontWeight: 500 }}>{addr}</span></>
    case "stage_changed": {
      const to = (e.payload?.to ?? e.payload?.stage) as DealStage | undefined
      const stageLabel = to ? STAGE_LABEL[to] : "next stage"
      return <>Moved <span style={{ color: "var(--rv-t1)", fontWeight: 500 }}>{addr}</span> to {stageLabel}</>
    }
    case "price_changed": {
      const delta = Number(e.payload?.delta ?? 0)
      const verb = delta < 0 ? "dropped" : "increased"
      return (
        <>
          Price {verb}{" "}
          <span style={{ color: delta < 0 ? "var(--rv-clay)" : "var(--rv-t1)", fontWeight: 500 }}>
            <Currency value={Math.abs(delta)} whole />
          </span>{" "}
          on <span style={{ color: "var(--rv-t1)", fontWeight: 500 }}>{addr}</span>
        </>
      )
    }
    case "reanalyzed":
      return <>Re-analyzed <span style={{ color: "var(--rv-t1)", fontWeight: 500 }}>{addr}</span></>
    case "tags_updated":
      return <>Tagged <span style={{ color: "var(--rv-t1)", fontWeight: 500 }}>{addr}</span></>
    case "scenario_changed":
      return <>Adjusted scenario on <span style={{ color: "var(--rv-t1)", fontWeight: 500 }}>{addr}</span></>
    case "scenario_cleared":
      return <>Cleared scenario on <span style={{ color: "var(--rv-t1)", fontWeight: 500 }}>{addr}</span></>
    default:
      return <>Activity on <span style={{ color: "var(--rv-t1)", fontWeight: 500 }}>{addr}</span></>
  }
}

/** Relative time — "just now", "12m", "3h", "2d", "3w". Keeps the feed
 *  scannable without forcing the user to parse timestamps. */
function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return ""
  const min = Math.floor(ms / 60_000)
  if (min < 1)   return "just now"
  if (min < 60)  return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24)   return `${hr}h`
  const d = Math.floor(hr / 24)
  if (d  < 7)    return `${d}d`
  const w = Math.floor(d / 7)
  return `${w}w`
}

interface Props {
  /** Maximum number of rows to render. The feed is opinionated about
   *  density — past 12 events the workstation gets noisy. */
  limit?: number
}

export default function ActivityFeed({ limit = 12 }: Props) {
  const router = useRouter()
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = () => fetchActivityFeed(limit)
      .then((rows) => { if (!cancelled) setEvents(rows) })
      .catch(() => { if (!cancelled) setEvents([]) })
    refresh()
    window.addEventListener(DEALS_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(DEALS_CHANGED_EVENT, refresh)
    }
  }, [limit])

  // Loading state — don't render anything until we know whether there's
  // activity to show. The feed is conditional from the parent's POV.
  if (events === null) return null
  if (events.length === 0) {
    return (
      // Empty state lifted onto a Card surface so it sits above the
      // body bg with a clear edge. Dashed border + sage-tinted icon
      // make it read as "intentionally blank, here's what'd appear"
      // rather than "broken / forgot to render."
      <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 flex flex-col items-center justify-center text-center gap-3">
        <div className="size-9 rounded-full bg-primary/10 inline-flex items-center justify-center">
          <Bookmark size={15} strokeWidth={2} className="text-primary" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <p className="text-[12.5px] font-medium text-foreground">Quiet in here.</p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground max-w-[260px]">
            Saves, stage moves, and price drops will show up here when there's something to say.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="w-full rounded-[14px] overflow-hidden"
      style={{
        background: "var(--rv-elev-2)",
        border:     "0.5px solid var(--rv-border-mid)",
        boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.20)",
      }}
    >
      <div className="flex items-baseline justify-between px-5 pt-4 pb-3">
        <p
          className="text-[9.5px] uppercase tracking-widest font-medium"
          style={{ color: "var(--rv-t4)" }}
        >
          Today
        </p>
        <span
          className="text-[10.5px] tabular-nums"
          style={{ color: "var(--rv-t4)" }}
          title="Recent activity across your pipeline"
        >
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>
      <div className="flex flex-col">
        {events.map((event) => (
          <ActivityRow
            key={event.id}
            event={event}
            onOpen={() => {
              if (!event.deal) return
              router.push(`/pipeline?id=${event.deal.id}`)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function ActivityRow({
  event, onOpen,
}: {
  event:  ActivityEvent
  onOpen: () => void
}) {
  const style = eventStyle(event)
  const ts    = relativeTime(event.at)
  const isClickable = !!event.deal

  return (
    <button
      onClick={isClickable ? onOpen : undefined}
      disabled={!isClickable}
      className="group flex items-center gap-3 px-5 text-left transition-colors disabled:cursor-default"
      style={{
        paddingTop:    11,
        paddingBottom: 11,
        background:    "transparent",
        borderTop:     "0.5px solid var(--rv-border)",
      }}
      onMouseEnter={(e) => {
        if (isClickable) e.currentTarget.style.background = "var(--rv-elev-3)"
      }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
      title={isClickable ? "Open in Pipeline" : "Deal no longer in pipeline"}
    >
      {/* Iconographic chip — color-coded by event kind so the row strip
          reads as a glanceable activity stream. Same circle pattern as
          the SourceMark chips for visual consistency. */}
      <span
        className="shrink-0 inline-flex items-center justify-center rounded-full"
        style={{
          width:      22,
          height:     22,
          color:      style.color,
          background: style.bg,
          border:     "0.5px solid var(--rv-border)",
        }}
      >
        {style.icon}
      </span>
      <span
        className="flex-1 min-w-0 text-[12.5px] leading-tight truncate"
        style={{ color: "var(--rv-t2)" }}
      >
        {eventTitle(event)}
      </span>
      <span
        className="shrink-0 text-[10.5px] tabular-nums"
        style={{ color: "var(--rv-t4)" }}
      >
        {ts}
      </span>
    </button>
  )
}
