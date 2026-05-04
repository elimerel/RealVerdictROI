"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState, Suspense } from "react"
import {
  Compass, LayoutGrid, Settings,
  Eye, Star, Send, Trophy, CircleSlash,
} from "lucide-react"
import { useSidebar, SIDEBAR_FULL_DEFAULT, SIDEBAR_FULL_MIN, SIDEBAR_FULL_MAX, SIDEBAR_ICONS_W, SNAP_HIDE, SNAP_ICONS } from "./context"
import {
  DEALS_CHANGED_EVENT,
  DEAL_STAGES,
  STAGE_LABEL,
  fetchActivePipelineCount,
  fetchStageCounts,
  fetchStartScreenContext,
  type DealStage,
  type StartScreenContext,
} from "@/lib/pipeline"

/** Section label — uppercase tracking-widest divider that groups the nav
 *  rows below it. Same pattern every reference uses (Modulix MAIN MENU,
 *  Hume TEXT TO SPEECH, Technolize OVERVIEW, Sapphire GENERAL). Quiet by
 *  design — it's a chapter heading, not a clickable thing. */
function SidebarSection({ label }: { label: string }) {
  return (
    <p
      className="text-[9.5px] uppercase tracking-[0.14em] font-semibold select-none"
      style={{
        color:        "var(--rv-t4)",
        padding:      "12px 12px 4px",
        marginTop:    2,
      }}
    >
      {label}
    </p>
  )
}

function NavItem({
  href, label, icon, active, iconsOnly, badge,
}: {
  href: string
  label: string
  icon: React.ReactNode
  active: boolean
  iconsOnly: boolean
  badge?: number
}) {
  return (
    <Link
      href={href}
      className="relative flex items-center select-none rounded-[7px]"
      style={{
        height:        36,
        gap:           iconsOnly ? 0 : 9,
        padding:       iconsOnly ? 0 : "0 10px",
        justifyContent: iconsOnly ? "center" : "flex-start",
        color:         active ? "var(--rv-t1)" : "var(--rv-t2)",
        background:    active ? "var(--rv-accent-dim)" : "transparent",
        boxShadow:     active ? "inset 0 0 0 0.5px var(--rv-accent-border)" : "none",
        fontSize:      13,
        fontWeight:    active ? 500 : 400,
        letterSpacing: "-0.005em",
        whiteSpace:    "nowrap",
        overflow:      "hidden",
        minWidth:      0,
        transition:    "color 100ms cubic-bezier(0.4, 0, 0.2, 1), background 100ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 100ms",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color      = "var(--rv-t1)"
          e.currentTarget.style.background = "var(--rv-elev-3)"
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color      = "var(--rv-t2)"
          e.currentTarget.style.background = "transparent"
        }
      }}
    >
      <span
        className="shrink-0 flex items-center"
        style={{ color: active ? "var(--rv-accent)" : "inherit" }}
      >{icon}</span>
      {!iconsOnly && (
        <>
          <span className="truncate flex-1">{label}</span>
          {badge != null && badge > 0 && (
            <span
              className="shrink-0 inline-flex items-center justify-center rounded-full text-[10.5px] tabular-nums"
              style={{
                minWidth:    16,
                height:      16,
                padding:     "0 5px",
                color:       active ? "var(--rv-accent)" : "var(--rv-t3)",
                background:  active ? "rgba(48,164,108,0.16)" : "var(--rv-elev-3)",
                fontWeight:  500,
              }}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </Link>
  )
}

/** Ambient buddy chip — a single quiet note above the account row that
 *  surfaces real pipeline signal in the user's words ("Watching 3", "1 idle
 *  for over a week"). Renders only when there's something concrete to say.
 *
 *  This is the "buddy" half of the workstation/buddy balance — the AI is
 *  quietly aware of your activity without ever taking up real estate.
 *  Stays silent on first-time, empty-pipeline accounts. */
function AmbientChip() {
  const [ctx, setCtx] = useState<StartScreenContext | null>(null)
  useEffect(() => {
    let cancelled = false
    const refresh = () => fetchStartScreenContext()
      .then((c) => { if (!cancelled) setCtx(c) })
      .catch(() => {})
    refresh()
    window.addEventListener(DEALS_CHANGED_EVENT, refresh)
    return () => { cancelled = true; window.removeEventListener(DEALS_CHANGED_EVENT, refresh) }
  }, [])

  const note = ctx ? buildAmbientNote(ctx) : null
  if (!note) return null

  // Color: clay (the "attention warranted" tone) when the buddy actually
  // noticed something stale; muted otherwise. Subtle but real — clay only
  // appears when there's something to act on, so when you see it, you read
  // it. Same psychological move as Stripe's amber dot for "needs review."
  const color = note.tone === "clay" ? "var(--rv-clay)" : "var(--rv-t3)"

  // Padding mirrors AccountRow's outer margin (mx-2) + inner padding (px-3) so
  // the chip text sits at the SAME left edge as the email label below it,
  // reading as a single bottom-of-sidebar block. mb-1.5 keeps a clear visual
  // gap so the chip never visually crashes into the avatar/email row.
  return (
    <div className="px-5 mt-2 mb-1.5 rv-ambient-in flex items-center gap-1.5">
      {note.tone === "clay" && (
        <span
          aria-hidden
          className="shrink-0 rounded-full"
          style={{ width: 5, height: 5, background: "var(--rv-clay)" }}
        />
      )}
      <p
        className="text-[11px] leading-tight"
        style={{ color, letterSpacing: "-0.005em" }}
        title="From your pipeline"
      >
        {note.text}
      </p>
    </div>
  )
}

function buildAmbientNote(ctx: StartScreenContext): { text: string; tone: "clay" | "muted" } | null {
  const { staleWatching, watchingCount, savedThisWeek, activeCount } = ctx.pipeline
  if (staleWatching > 0) {
    return {
      text: staleWatching === 1
        ? "1 deal idle for over a week"
        : `${staleWatching} idle for over a week`,
      tone: "clay",
    }
  }
  if (savedThisWeek >= 3) return { text: `${savedThisWeek} saves this week`, tone: "muted" }
  if (watchingCount > 0)  return { text: watchingCount === 1 ? "Watching 1" : `Watching ${watchingCount}`, tone: "muted" }
  if (activeCount   > 0)  return { text: `${activeCount} in pipeline`, tone: "muted" }
  return null
}

/** Account row — bottom of the sidebar in full mode. Avatar + email +
 *  click-to-Settings. Quietly hides if not signed in. */
function AccountRow() {
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient()
      supabase.auth.getUser().then(({ data }) => {
        if (!cancelled) setEmail(data.user?.email ?? null)
      })
    }).catch(() => { /* not configured — leave email null */ })
    return () => { cancelled = true }
  }, [])

  if (!email) return null
  const initial = (email[0] ?? "?").toUpperCase()
  // Show only the local part (before @) when the address is long. Most
  // sidebars at 220-260px can't fit a full corporate email.
  const display = email.includes("@") && email.length > 22
    ? email.slice(0, email.indexOf("@"))
    : email

  return (
    <Link
      href="/settings"
      className="shrink-0 flex items-center gap-2.5 px-3 py-2.5 mx-2 mb-2 rounded-[7px] transition-colors"
      style={{
        background: "transparent",
        border:     "0.5px solid transparent",
      }}
      title={email}
      onMouseEnter={(e) => {
        e.currentTarget.style.background  = "var(--rv-elev-2)"
        e.currentTarget.style.borderColor = "var(--rv-border)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background  = "transparent"
        e.currentTarget.style.borderColor = "transparent"
      }}
    >
      <span
        className="shrink-0 inline-flex items-center justify-center rounded-full"
        style={{
          width:       24,
          height:      24,
          background:  "var(--rv-accent)",
          color:       "rgba(0,0,0,0.85)",
          fontSize:    11,
          fontWeight:  600,
        }}
      >
        {initial}
      </span>
      <span
        className="text-[12px] truncate"
        style={{ color: "var(--rv-t1)", letterSpacing: "-0.005em" }}
      >
        {display}
      </span>
    </Link>
  )
}

/** Stage sub-item — secondary nav row that lives nested under "Pipeline".
 *  Smaller/quieter than NavItem to read as a child. Empty stages render
 *  with muted text instead of a count chip — keeps the column's vertical
 *  rhythm clean. */
function StageSubItem({
  stage, active, count,
}: {
  stage: DealStage
  active: boolean
  count: number
}) {
  return (
    <Link
      href={`/pipeline?stage=${stage}`}
      className="flex items-center select-none rounded-[6px]"
      style={{
        height:        28,
        padding:       "0 10px",
        gap:           8,
        color:         active ? "var(--rv-t1)" : "var(--rv-t2)",
        background:    active ? "var(--rv-accent-dim)" : "transparent",
        boxShadow:     active ? "inset 0 0 0 0.5px var(--rv-accent-border)" : "none",
        fontSize:      12,
        fontWeight:    active ? 500 : 400,
        letterSpacing: "-0.005em",
        whiteSpace:    "nowrap",
        overflow:      "hidden",
        minWidth:      0,
        transition:    "color 100ms cubic-bezier(0.4, 0, 0.2, 1), background 100ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color      = "var(--rv-t1)"
          e.currentTarget.style.background = "var(--rv-elev-2)"
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color      = "var(--rv-t2)"
          e.currentTarget.style.background = "transparent"
        }
      }}
    >
      <span className="truncate flex-1">{STAGE_LABEL[stage]}</span>
      <span
        className="text-[10.5px] tabular-nums shrink-0"
        style={{ color: count === 0 ? "var(--rv-t4)" : active ? "var(--rv-accent)" : "var(--rv-t3)" }}
      >
        {count}
      </span>
    </Link>
  )
}

/** Pipeline icon + hover flyout for icons-only mode. The icon itself is
 *  a NavItem that links to /pipeline (active stage = null = "All active").
 *  Hovering anywhere on the icon row reveals a small floating menu to the
 *  right with all five stages + counts. The menu stays open while the
 *  cursor is on either the icon OR the menu (a 100ms close delay bridges
 *  the gap between them). Mouse leaves both → closes. */
/** Lucide icon for each pipeline stage. Used as the mini stage icons that
 *  drop down under the Pipeline button when the sidebar is in icons-only
 *  mode and the user is on /pipeline — same role as StageSubItem in
 *  expanded mode, but visualized as icons instead of labels. */
const STAGE_ICON: Record<DealStage, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  watching:   Eye,
  interested: Star,
  offered:    Send,
  won:        Trophy,
  passed:     CircleSlash,
}

/** Pipeline icon + per-stage icon strip below it (icons-only mode). When
 *  the user is on /pipeline, five mini stage icons render directly under
 *  the Pipeline button — same nav targets as the expanded sidebar's
 *  StageSubItem rows, but drawn as compact icons that fit the collapsed
 *  column. Hovering any of them reveals the stage name + count via the
 *  native title tooltip. */
function PipelineIconStrip({
  activeCount, stageCounts, selectedStage, onPipeline, isPipelineActive,
}: {
  activeCount:      number
  stageCounts:      Record<DealStage, number>
  selectedStage:    DealStage | null
  onPipeline:       boolean
  isPipelineActive: boolean
}) {
  // Always-mounted wrapper so CSS transitions can run on max-height /
  // opacity / translateY when onPipeline flips. Each icon also has a
  // staggered transition-delay so they cascade in instead of all snapping
  // at once — the same trick that makes Mac toolbars feel premium.
  const STAGE_ICON_HEIGHT = 28      // matches StageMiniIcon's height
  const STAGE_ICON_GAP    = 2
  const STRIP_PADDING_TOP = 4
  const expandedMaxH =
    DEAL_STAGES.length * STAGE_ICON_HEIGHT
    + (DEAL_STAGES.length - 1) * STAGE_ICON_GAP
    + STRIP_PADDING_TOP

  return (
    <>
      <NavItem
        href="/pipeline"
        label="Pipeline"
        icon={<LayoutGrid size={15} strokeWidth={1.7} />}
        active={isPipelineActive || (onPipeline && !isPipelineActive)}
        iconsOnly={true}
        badge={activeCount}
      />
      <div
        className="flex flex-col items-center"
        style={{
          gap:           STAGE_ICON_GAP,
          paddingTop:    onPipeline ? STRIP_PADDING_TOP : 0,
          maxHeight:     onPipeline ? expandedMaxH : 0,
          opacity:       onPipeline ? 1 : 0,
          transform:     onPipeline ? "translateY(0)" : "translateY(-3px)",
          overflow:      "hidden",
          // Spring-y close-out at the same easing the sidebar resize uses,
          // so the motion vocabulary is consistent. Slightly longer on
          // open (240) than close (180) — opens want to feel inviting,
          // closes want to get out of the way.
          transition:    onPipeline
            ? "max-height 240ms cubic-bezier(0.32,0.72,0,1), opacity 200ms cubic-bezier(0.32,0.72,0,1) 40ms, transform 240ms cubic-bezier(0.32,0.72,0,1), padding-top 200ms cubic-bezier(0.32,0.72,0,1)"
            : "max-height 180ms cubic-bezier(0.4,0,0.2,1), opacity 120ms cubic-bezier(0.4,0,0.2,1), transform 180ms cubic-bezier(0.4,0,0.2,1), padding-top 180ms cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        {DEAL_STAGES.map((stage, i) => (
          <div
            key={stage}
            style={{
              opacity:    onPipeline ? 1 : 0,
              transform:  onPipeline ? "translateY(0)" : "translateY(-6px)",
              transition: onPipeline
                ? `opacity 220ms cubic-bezier(0.32,0.72,0,1) ${60 + i * 28}ms, transform 240ms cubic-bezier(0.32,0.72,0,1) ${60 + i * 28}ms`
                : `opacity 120ms cubic-bezier(0.4,0,0.2,1), transform 140ms cubic-bezier(0.4,0,0.2,1)`,
            }}
          >
            <StageMiniIcon
              stage={stage}
              active={onPipeline && selectedStage === stage}
              count={stageCounts[stage]}
            />
          </div>
        ))}
      </div>
    </>
  )
}

/** Compact stage icon for icons-only sidebar mode. Smaller hit target than
 *  NavItem (28px vs 36px), centered icon, accent-tinted when active. The
 *  count rides as a tiny superscript bubble in the top-right of the icon
 *  when > 0, so the user can see at-a-glance which stages have content
 *  without expanding the sidebar. Tooltip shows full stage name + count. */
function StageMiniIcon({
  stage, active, count,
}: {
  stage:  DealStage
  active: boolean
  count:  number
}) {
  const Icon = STAGE_ICON[stage]
  const label = STAGE_LABEL[stage]
  return (
    <Link
      href={`/pipeline?stage=${stage}`}
      title={count > 0 ? `${label} · ${count}` : label}
      className="relative flex items-center justify-center rounded-[6px] transition-colors"
      style={{
        width:      28,
        height:     28,
        color:      active ? "var(--rv-accent)" : "var(--rv-t3)",
        background: active ? "rgba(48,164,108,0.12)" : "transparent",
        border:     active ? "0.5px solid rgba(48,164,108,0.22)" : "0.5px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(120,120,128,0.12)"
          e.currentTarget.style.color      = "var(--rv-t1)"
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent"
          e.currentTarget.style.color      = "var(--rv-t3)"
        }
      }}
    >
      <Icon size={13} strokeWidth={1.8} />
      {count > 0 && (
        <span
          className="absolute tabular-nums"
          style={{
            top:           1,
            right:         1,
            minWidth:      11,
            height:        11,
            padding:       "0 2px",
            fontSize:      8,
            lineHeight:    "11px",
            fontWeight:    600,
            color:         "var(--rv-t4)",
            background:    "var(--rv-elev-3)",
            borderRadius:  6,
            textAlign:     "center",
          }}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  )
}

export default function Sidebar() {
  return <Suspense><SidebarInner /></Suspense>
}

function SidebarInner() {
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const { open, width, setWidth } = useSidebar()
  const sidebarRef = useRef<HTMLDivElement>(null)

  const iconsOnly = open && width < SNAP_ICONS

  // Pipeline-aware nav: when the user is on /pipeline, the sidebar
  // expands the Pipeline section with stage children + counts. Selected
  // stage comes from ?stage=... URL param. "All active" is the default.
  const onPipeline    = pathname.startsWith("/pipeline")
  const selectedStage = searchParams.get("stage") as DealStage | null

  // Per-stage counts. Two-tier hydration: the active count badge for the
  // collapsed Pipeline row + per-stage counts for the expanded sub-nav.
  const [activeCount, setActiveCount] = useState<number>(0)
  const [stageCounts, setStageCounts] = useState<Record<DealStage, number>>({
    watching: 0, interested: 0, offered: 0, won: 0, passed: 0,
  })
  useEffect(() => {
    const refresh = () => {
      fetchActivePipelineCount().then(setActiveCount)
      fetchStageCounts().then((c) => setStageCounts({
        watching: c.watching, interested: c.interested, offered: c.offered,
        won: c.won, passed: c.passed,
      }))
    }
    refresh()
    const onFocus = () => refresh()
    window.addEventListener(DEALS_CHANGED_EVENT, refresh)
    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener(DEALS_CHANGED_EVENT, refresh)
      window.removeEventListener("focus", onFocus)
    }
  }, [])

  // ── Drag-to-resize ────────────────────────────────────────────────────────
  // Tiny movement threshold before pointerdown is treated as a drag. Mac
  // trackpads force-click + tap-to-click can fire pointer events from
  // micro contact; the threshold filters those out without making the
  // handle feel unresponsive. 2px is small enough that real intentional
  // drags activate the moment the cursor crosses a single pixel grid.
  const DRAG_THRESHOLD_PX = 2

  const dragStateRef = useRef<{
    startX: number
    startWidth: number
    pointerId: number
    activated: boolean
  } | null>(null)

  const onDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!open) return
      e.preventDefault()
      // Capture immediately so subsequent pointermoves fire on this
      // element even if the cursor leaves the narrow handle. Without
      // capture, a quick down→sideways gesture loses the events and the
      // drag never activates — which feels broken.
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
      dragStateRef.current = {
        startX:     e.clientX,
        startWidth: width,
        pointerId:  e.pointerId,
        activated:  false,
      }
    },
    [open, width]
  )

  const onDragMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current
      if (!s) return
      const dx = e.clientX - s.startX

      // Wait until the cursor has moved past the deadzone before treating
      // this as a drag. Until then, no state changes — the user might just
      // be hovering or did an accidental tap.
      if (!s.activated) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
        s.activated = true
        // Pointer was already captured at pointerdown; just lock the
        // global cursor so the user gets the col-resize feedback even
        // when they drift past the sidebar's edge mid-drag.
        document.body.style.cursor = "col-resize"
      }

      const target = Math.max(0, Math.min(SIDEBAR_FULL_MAX, s.startWidth + dx))
      setWidth(target, { live: true })
    },
    [setWidth]
  )

  const onDragEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current
      if (!s) return
      const wasActivated = s.activated
      const dx = e.clientX - s.startX
      dragStateRef.current = null

      // Pointer was captured at pointerdown — release on every release so
      // the next click works even if the user didn't actually drag.
      try { e.currentTarget.releasePointerCapture(s.pointerId) } catch {}
      if (wasActivated) document.body.style.cursor = ""

      // Pointerdown without crossing the deadzone — treat as a click /
      // accidental tap. Don't snap, don't fire any setWidth.
      if (!wasActivated) return

      const target = s.startWidth + dx
      if (target < SNAP_HIDE) {
        setWidth(0, { live: false, close: true })
      } else if (target < SNAP_ICONS) {
        setWidth(SIDEBAR_ICONS_W, { live: false })
      } else {
        const clamped = Math.max(SIDEBAR_FULL_MIN, Math.min(SIDEBAR_FULL_MAX, target))
        setWidth(clamped, { live: false })
      }
    },
    [setWidth]
  )

  // Settle the inline width to the React state value (CSS transitions handle
  // the animation between values). During a live drag, we set inline width
  // ourselves; the state-driven render below then takes over on release.
  useEffect(() => {
    if (!sidebarRef.current) return
    sidebarRef.current.style.width = open ? `${width}px` : "0px"
  }, [open, width])

  return (
    <aside
      ref={sidebarRef}
      data-icons-only={iconsOnly || undefined}
      data-open={open || undefined}
      className="rv-sidebar shrink-0 h-full flex flex-col relative overflow-hidden"
      style={{
        width: open ? width : 0,
        transition: dragStateRef.current
          ? "none"
          : "width 220ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      {/* Top strip — 52px, drag region for moving the window. In FULL mode
          carries the sidebar tint up to y=0 so the sidebar visually covers
          the corner. In ICONS mode the tint is removed, so the strip merges
          with the toolbar (toolbar appears to span corner-to-corner). */}
      <div
        className="rv-sidebar-top shrink-0"
        style={{
          height:          52,
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      />

      {/* Body — nav + account row. Always tinted. */}
      <div
        className="rv-sidebar-body flex flex-col flex-1 min-w-0"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Brand wordmark — sits right below the traffic-light drag zone.
            Full mode: green square + "RealVerdict" text. Icons-only: just
            the square, centered. Gives the sidebar a product identity
            rather than a blank draggable strip. */}
        <div
          className="shrink-0 flex items-center"
          style={{
            height:          36,
            padding:         iconsOnly ? "0 4px" : "0 12px",
            justifyContent:  iconsOnly ? "center" : "flex-start",
            gap:             8,
            marginBottom:    4,
          }}
        >
          <div
            style={{
              width:        20,
              height:       20,
              borderRadius: 5,
              background:   "var(--rv-accent)",
              flexShrink:   0,
              boxShadow:    "0 2px 6px rgba(48,164,108,0.35)",
            }}
          />
          {!iconsOnly && (
            <span
              className="text-[13px] font-semibold tracking-[-0.01em] truncate"
              style={{ color: "var(--rv-t1)" }}
            >
              RealVerdict
            </span>
          )}
        </div>

        <nav
          className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden"
          style={{ padding: iconsOnly ? "2px 4px" : "2px 8px", gap: 2 }}
        >
          {/* Section divider — uppercase muted label, same pattern every
              reference uses (Modulix MAIN MENU, Hume TEXT TO SPEECH,
              Technolize OVERVIEW). Hidden in icons-only mode where there's
              no room for a label. */}
          {!iconsOnly && <SidebarSection label="Workspace" />}
          <NavItem
            href="/browse"
            label="Browse"
            icon={<Compass size={15} strokeWidth={1.7} />}
            active={pathname === "/browse"}
            iconsOnly={iconsOnly}
          />
          {iconsOnly ? (
            // In icons mode, the per-stage labels don't fit inline. Render
            // mini stage icons stacked under the Pipeline button instead —
            // each stage gets its own glyph (Eye for Watching, Star for
            // Interested, etc.), so the user can navigate between stages
            // without expanding the sidebar back open. Same nav targets as
            // the expanded sidebar's StageSubItem rows.
            <PipelineIconStrip
              activeCount={activeCount}
              stageCounts={stageCounts}
              selectedStage={selectedStage}
              onPipeline={onPipeline}
              isPipelineActive={pathname === "/pipeline" && selectedStage === null}
            />
          ) : (
            <>
              <NavItem
                href="/pipeline"
                label="Pipeline"
                icon={<LayoutGrid size={15} strokeWidth={1.7} />}
                active={pathname === "/pipeline" && selectedStage === null}
                iconsOnly={false}
                badge={activeCount}
              />
              {onPipeline && (
                <div className="flex flex-col" style={{ gap: 1, paddingLeft: 24, paddingTop: 2, paddingBottom: 2 }}>
                  {DEAL_STAGES.map((stage) => (
                    <StageSubItem
                      key={stage}
                      stage={stage}
                      active={selectedStage === stage}
                      count={stageCounts[stage]}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          {!iconsOnly && <SidebarSection label="Account" />}
          <NavItem
            href="/settings"
            label="Settings"
            icon={<Settings size={15} strokeWidth={1.7} />}
            active={pathname === "/settings"}
            iconsOnly={iconsOnly}
          />
        </nav>

        {/* Ambient chip + account row — pinned to the bottom of the sidebar
            in full mode. Both hidden in icons-only since there's no room
            for the labels. Clicking the account row opens Settings. */}
        {!iconsOnly && (
          <>
            <AmbientChip />
            <AccountRow />
          </>
        )}
      </div>

      {/* Resize handle pinned to right edge. The HIT area is 8px wide
          (clickable strip), but the visible bar (rendered via ::after at
          right:0) sits flush at the sidebar's edge. Wider hit area is the
          difference between "feels precise" and "feels like the cursor
          is lying about being draggable." */}
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        className="rv-sidebar-handle absolute"
        style={{
          top:         52,
          right:       0,
          bottom:      0,
          width:       8,
          cursor:      "col-resize",
          display:     open ? "block" : "none",
          touchAction: "none",
          zIndex:      5,
        }}
      />
    </aside>
  )
}

// Re-export constants from context for places that need to hardcode (e.g.
// computing browserView bounds from sidebar width).
export {
  SIDEBAR_FULL_DEFAULT,
  SIDEBAR_FULL_MIN,
  SIDEBAR_FULL_MAX,
  SIDEBAR_ICONS_W,
  SNAP_HIDE,
  SNAP_ICONS,
}
