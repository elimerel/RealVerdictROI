"use client"

// ── Per-deal workspace ──────────────────────────────────────────────────
//
// The Pipeline slide-out is for triage ("is this deal worth my time?").
// THIS page is for working a deal in depth — the surface where the user
// sits down with the buddy and actually decides what to do.
//
// Linear / Mercury / Stripe pattern: the index/list view has a slide-out
// for quick-look, and a dedicated route for "I'm working on this thing
// now." We had the slide-out; this page is the missing workspace.
//
// Layout: 44px header strip on top + two-column body.
//   Left  (flex-1)  — the same Panel that Browse and the slide-out use,
//                     rendered with actionRowCollapsed so it's just the
//                     analysis (hero, metrics, scenarios, sources).
//                     Chat is suppressed inside the panel because it's
//                     already in the right column as a first-class
//                     surface.
//   Right (400px)   — persistent AI chat. Always-visible workspace
//                     companion, not an afterthought. This is the buddy.
//
// Reuses the existing scenario persistence, watching toggle, stage move,
// notes, delete — everything the slide-out's DealDetail does — without
// duplicating the analysis surface.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ChevronRight, ExternalLink, Trash2, Bell, BellOff, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BuddyMark } from "@/components/BuddyMark"
import { Currency } from "@/lib/format"
import { cn } from "@/lib/utils"
import Panel from "@/components/panel"
import PanelChat from "@/components/panel/Chat"
import {
  fetchPipeline,
  fetchDealActivity,
  logChatCleared,
  moveDealStage,
  setDealWatching,
  updateDealNotes,
  updateDealScenario,
  updateDealChat,
  deleteDeal,
  STAGE_LABEL,
  type SavedDeal,
  type DealStage,
  type ActivityEvent,
} from "@/lib/pipeline"
import { useEscape } from "@/lib/escapeStack"
import { useBuyBar } from "@/lib/useBuyBar"
import { applyScenarioFromBus, hasActiveScenario, resetScenarioFromBus, type ScenarioOverrides } from "@/lib/scenario"
import type { ChatContext, ChatMessage } from "@/lib/electron"

export default function DealWorkspacePage() {
  const params  = useParams<{ id: string }>()
  return <DealWorkspace dealId={params?.id ?? null} />
}

type PortfolioFact = {
  key:    "cap" | "cf" | "price"
  label:  string
  delta:  string
  tone:   "pos" | "neg" | "neutral"
  /** Magnitude used to rank facts — bigger swing surfaces first. */
  weight: number
}

/** Pure component form — takes dealId as a prop so the (app) layout's
 *  AlwaysMountedRoutes can render it as an extra layer based on
 *  pathname (Next.js page routing alone wouldn't show it; the layout
 *  hides `{children}` in favor of always-mounted top-level surfaces). */
export function DealWorkspace({ dealId }: { dealId: string | null }) {
  const router  = useRouter()
  const buyBar  = useBuyBar()

  // ── Load the deal ────────────────────────────────────────────────────
  // fetchPipeline returns the user's full active set; we filter to the
  // requested id. Pipeline is small (rarely > 200 rows) so a per-page
  // dedicated IPC isn't worth the surface area yet. Falls through to
  // a "not found" state if the id doesn't match (deleted in another
  // tab, or the user typed a stale URL).
  const [deal,     setDeal]     = useState<SavedDeal | null>(null)
  // Hold onto the full pipeline set for the "Similar in your pipeline"
  // strip — same fetch, no extra round-trip. Filtered + scored in a
  // useMemo below.
  const [allDeals, setAllDeals] = useState<SavedDeal[]>([])
  const [loading,  setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  useEffect(() => {
    if (!dealId) return
    let cancelled = false
    setLoading(true); setNotFound(false)
    void fetchPipeline().then((rows) => {
      if (cancelled) return
      setAllDeals(rows)
      const match = rows.find((d) => d.id === dealId)
      if (match) {
        setDeal(match)
        // Hydrate the chat thread so the buddy resumes the prior
        // conversation. NULL = no thread saved yet (or the migration
        // hasn't been applied) → start empty.
        setChatMessages(Array.isArray(match.chat) ? match.chat : [])
      } else {
        setNotFound(true)
      }
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setNotFound(true); setLoading(false)
    })
    return () => { cancelled = true }
  }, [dealId])

  // ── Similar deals — surfaces other rows in the user's pipeline that
  // are close to this one so the workspace doubles as a "what else am
  // I looking at?" cross-reference. Without this, the workspace is
  // single-deal-shaped; you have to leave to compare. With it, the
  // top of the workspace says "you have 3 similar saves; here they
  // are." Click → jump to that deal's workspace.
  //
  // Similarity is a simple weighted score (NOT an ML thing): same
  // city +3, same state +1, same property type +2, list price within
  // 25% +2 / 50% +1, same beds +1. Anything ≥3 counts as "similar."
  // Cap at 4 cards so the strip stays scannable.
  const similar = useMemo<SavedDeal[]>(() => {
    if (!deal || allDeals.length <= 1) return []
    const refPrice = deal.list_price ?? null
    const refType  = deal.snapshot?.propertyType ?? null
    const scored = allDeals
      .filter((d) => d.id !== deal.id)
      .map((d) => {
        let score = 0
        if (deal.city && d.city && d.city === deal.city)   score += 3
        if (deal.state && d.state && d.state === deal.state) score += 1
        if (refType && d.snapshot?.propertyType === refType) score += 2
        if (refPrice && d.list_price) {
          const ratio = Math.abs(d.list_price - refPrice) / refPrice
          if (ratio <= 0.25)      score += 2
          else if (ratio <= 0.50) score += 1
        }
        if (deal.beds != null && d.beds === deal.beds) score += 1
        return { d, score }
      })
      .filter(({ score }) => score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
    return scored.map(({ d }) => d)
  }, [deal, allDeals])

  // ── Portfolio context — buddy-style observation that lives in the
  // workspace header strip so the user lands with one concrete frame
  // ("you're looking at a deal X vs your typical save"). Computed from
  // the user's other active saves (excludes this deal, excludes won/
  // passed since those aren't part of "what I'm currently shopping").
  // Returns up to 3 facts ranked by magnitude — only the largest moves
  // are worth surfacing; otherwise the strip is noise.
  const portfolioContext = useMemo<{ facts: PortfolioFact[]; n: number }>(() => {
    if (!deal || allDeals.length <= 1) return { facts: [], n: 0 }
    const peers = allDeals.filter((d) =>
      d.id !== deal.id &&
      d.stage !== "won" &&
      d.stage !== "passed"
    )
    if (peers.length === 0) return { facts: [], n: 0 }
    const avg = (xs: number[]) => xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length
    const avgCap     = avg(peers.map((d) => d.snapshot?.metrics?.capRate).filter((v): v is number => Number.isFinite(v as number)))
    const avgCashFlow = avg(peers.map((d) => d.snapshot?.metrics?.monthlyCashFlow).filter((v): v is number => Number.isFinite(v as number)))
    const avgPrice    = avg(peers.map((d) => d.list_price).filter((v): v is number => v != null && Number.isFinite(v)))

    const myCap   = deal.snapshot?.metrics?.capRate
    const myCash  = deal.snapshot?.metrics?.monthlyCashFlow
    const myPrice = deal.list_price

    const facts: PortfolioFact[] = []
    if (avgCap != null && myCap != null && Number.isFinite(myCap)) {
      const deltaPts = (myCap - avgCap) * 100
      if (Math.abs(deltaPts) >= 0.10) {
        facts.push({
          key: "cap",
          label: "Cap rate",
          delta: deltaPts >= 0 ? `+${deltaPts.toFixed(2)} pts` : `${deltaPts.toFixed(2)} pts`,
          tone: deltaPts >= 0 ? "pos" : "neg",
          weight: Math.abs(deltaPts),
        })
      }
    }
    if (avgCashFlow != null && myCash != null && Number.isFinite(myCash)) {
      const delta = myCash - avgCashFlow
      if (Math.abs(delta) >= 25) {
        const sign = delta >= 0 ? "+" : "−"
        facts.push({
          key: "cf",
          label: "Cash flow",
          delta: `${sign}$${Math.round(Math.abs(delta)).toLocaleString()}/mo`,
          tone: delta >= 0 ? "pos" : "neg",
          weight: Math.abs(delta) / 100,
        })
      }
    }
    if (avgPrice != null && myPrice != null) {
      const ratio = (myPrice - avgPrice) / avgPrice
      if (Math.abs(ratio) >= 0.05) {
        const pct = Math.round(Math.abs(ratio) * 100)
        facts.push({
          key: "price",
          label: "Price",
          delta: ratio >= 0 ? `+${pct}%` : `−${pct}%`,
          // For price, "above average" isn't necessarily good — leave
          // it neutral so we don't paint expensive deals green.
          tone: "neutral",
          weight: Math.abs(ratio) * 10,
        })
      }
    }
    facts.sort((a, b) => b.weight - a.weight)
    return { facts: facts.slice(0, 3), n: peers.length }
  }, [deal, allDeals])

  // True when the user has set ANY buy-bar threshold in Investment
  // Defaults. Drives the onboarding nudge below — if false, we surface
  // a single-line prompt instead of the buy-bar deltas, so the user
  // who hasn't onboarded that surface yet learns it exists.
  const hasBuyBarSet = useMemo(
    () => buyBar.minCapRate != null || buyBar.minCashFlow != null || buyBar.minDscr != null,
    [buyBar],
  )

  // ── Buy-bar context — surface where this deal sits relative to the
  // user's own thresholds (set in Investment Defaults). Same visual
  // treatment as the portfolio strip, but the "neutral" frame is
  // YOUR criteria, not your portfolio. Only renders the metrics for
  // which a threshold is actually set; if the user hasn't set
  // anything, the strip hides entirely.
  const buyBarFacts = useMemo<PortfolioFact[]>(() => {
    if (!deal) return []
    const out: PortfolioFact[] = []
    const m = deal.snapshot?.metrics
    if (buyBar.minCapRate != null && m?.capRate != null && Number.isFinite(m.capRate)) {
      const deltaPts = (m.capRate - buyBar.minCapRate) * 100
      out.push({
        key: "cap",
        label: "Cap rate",
        delta: deltaPts >= 0 ? `+${deltaPts.toFixed(2)} pts` : `${deltaPts.toFixed(2)} pts`,
        tone: deltaPts >= 0 ? "pos" : "neg",
        weight: Math.abs(deltaPts),
      })
    }
    if (buyBar.minCashFlow != null && m?.monthlyCashFlow != null && Number.isFinite(m.monthlyCashFlow)) {
      const delta = m.monthlyCashFlow - buyBar.minCashFlow
      const sign = delta >= 0 ? "+" : "−"
      out.push({
        key: "cf",
        label: "Cash flow",
        delta: `${sign}$${Math.round(Math.abs(delta)).toLocaleString()}/mo`,
        tone: delta >= 0 ? "pos" : "neg",
        weight: Math.abs(delta) / 100,
      })
    }
    if (buyBar.minDscr != null && m?.dscr != null && Number.isFinite(m.dscr)) {
      const delta = m.dscr - buyBar.minDscr
      out.push({
        key: "price",   // re-use the "neutral" key slot
        label: "DSCR",
        delta: delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2),
        tone: delta >= 0 ? "pos" : "neg",
        weight: Math.abs(delta) * 10,
      })
    }
    return out
  }, [deal, buyBar])

  // ── Activity timeline — fetched on mount + whenever a mutation
  // happens, so the user sees their own stage move / re-analyze land
  // immediately. Right-column "Activity" tab renders this. Newest-first.
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const refreshActivity = useCallback(async () => {
    if (!dealId) return
    setActivityLoading(true)
    try {
      const rows = await fetchDealActivity(dealId, 50)
      setActivity(rows)
    } finally {
      setActivityLoading(false)
    }
  }, [dealId])
  useEffect(() => {
    if (!dealId) return
    void refreshActivity()
  }, [dealId, refreshActivity])

  // Right-column tabs — Buddy (chat, default) | Activity (timeline) |
  // Sources (provenance for every number on the panel).
  const [rightTab, setRightTab] = useState<"buddy" | "activity" | "sources">("buddy")

  // Esc → back to /pipeline. Gated on dealId because the workspace is
  // always mounted (parent layout uses always-mounted layers); the Esc
  // handler should only register when the workspace is the active
  // route, otherwise pressing Esc on the Pipeline index would push
  // /pipeline (a no-op nav) and the next Esc would do nothing.
  useEscape(dealId !== null, () => router.push("/pipeline"))

  // ── Chat tool-use bridge ─────────────────────────────────────────────
  // The chat IPC (electron-app/main.js::ai:chat-deal) defines tools
  // adjust_scenario + reset_scenario. When Claude calls one, main.js
  // broadcasts ai:apply-scenario / ai:reset-scenario to every window.
  // Browse subscribes for its panel; without this bridge the workspace
  // would receive the event but nothing would feed it into the
  // scenario bus → the metric cards wouldn't move when the buddy says
  // "I bumped you to 30% down." Gated on dealId so the bridge only
  // pumps while the workspace is the active route (workspace is
  // always-mounted by the layout's AlwaysMountedRoutes pattern).
  useEffect(() => {
    if (dealId === null) return
    const api = typeof window !== "undefined" ? window.electronAPI : undefined
    if (!api?.onApplyScenario) return
    return api.onApplyScenario((changes) => {
      applyScenarioFromBus(changes as Partial<ScenarioOverrides>)
    })
  }, [dealId])

  useEffect(() => {
    if (dealId === null) return
    const api = typeof window !== "undefined" ? window.electronAPI : undefined
    if (!api?.onResetScenario) return
    return api.onResetScenario(() => resetScenarioFromBus())
  }, [dealId])

  // ── Mutations ────────────────────────────────────────────────────────
  // Refresh activity after each mutation so the Activity tab reflects
  // the move the user just made (small delay so the deal_events insert
  // — which is fire-and-forget after the saved_deals update — has time
  // to land).
  const refreshActivitySoon = useCallback(() => {
    setTimeout(() => { void refreshActivity() }, 250)
  }, [refreshActivity])

  const onMoveStage = useCallback(async (next: DealStage) => {
    if (!deal || next === deal.stage) return
    const ok = await moveDealStage(deal.id, next)
    if (ok) {
      setDeal({ ...deal, stage: next, updated_at: new Date().toISOString() })
      refreshActivitySoon()
    }
  }, [deal, refreshActivitySoon])

  const onToggleWatching = useCallback(async () => {
    if (!deal) return
    const next = !deal.watching
    const ok = await setDealWatching(deal.id, next)
    if (ok) {
      setDeal({ ...deal, watching: next })
      refreshActivitySoon()
    }
  }, [deal, refreshActivitySoon])

  const onOpenInBrowse = useCallback(() => {
    if (!deal) return
    router.push(`/browse?url=${encodeURIComponent(deal.source_url)}`)
  }, [router, deal])

  const [confirmDelete, setConfirmDelete] = useState(false)
  const onDelete = useCallback(async () => {
    if (!deal) return
    const ok = await deleteDeal(deal.id)
    if (ok) router.push("/pipeline")
  }, [deal, router])

  // Scenario persist — debounced 350ms, mirrors the slide-out + Browse.
  const scenarioWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (scenarioWriteTimer.current) clearTimeout(scenarioWriteTimer.current)
  }, [])
  const onScenarioChange = useCallback((s: ScenarioOverrides | null) => {
    if (!deal) return
    setDeal((prev) => prev ? { ...prev, scenario: s } : prev)
    if (scenarioWriteTimer.current) clearTimeout(scenarioWriteTimer.current)
    scenarioWriteTimer.current = setTimeout(() => {
      void updateDealScenario(deal.id, s).then((ok) => {
        // updateDealScenario logs a deal_event ("scenario_changed" or
        // "scenario_cleared") on success. Re-fetch the timeline so the
        // user's edit shows up without flipping tabs / reloading.
        if (ok) refreshActivitySoon()
      })
    }, 350)
  }, [deal, refreshActivitySoon])

  // ── Chat wiring (same shape as Browse) ───────────────────────────────
  // Local-only message history for now — Phase 2 can persist the
  // conversation to the saved_deals row so the buddy remembers across
  // reopens. Today: open the deal, fresh chat. Closing the page loses
  // the history; that's the deliberate MVP scope.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading,  setChatLoading]  = useState(false)
  const chatContext = useMemo<ChatContext | undefined>(() => {
    if (!deal) return undefined
    const r = deal.snapshot
    return {
      listing: {
        address:           r.address,
        city:              r.city,
        state:             r.state,
        zip:               r.zip,
        propertyType:      r.propertyType,
        listPrice:         r.listPrice,
        beds:              r.beds,
        baths:             r.baths,
        sqft:              r.sqft,
        yearBuilt:         r.yearBuilt,
        monthlyCashFlow:   r.metrics.monthlyCashFlow,
        capRate:           r.metrics.capRate,
        cashOnCash:        r.metrics.cashOnCash,
        dscr:              r.metrics.dscr,
        grm:               r.metrics.grm,
        monthlyRent:       r.inputs.monthlyRent,
        monthlyMortgage:   r.metrics.monthlyMortgage,
        annualPropertyTax: r.inputs.annualPropertyTax,
        monthlyHOA:        r.inputs.monthlyHOA,
        annualInsurance:   r.inputs.annualInsurance,
        riskFlags:         r.riskFlags,
        siteName:          r.siteName,
      },
      pipeline: {
        activeCount:  1,
        commonCities: [],
      },
    }
  }, [deal])

  // Debounced chat persist. Bounces against rapid back-and-forth so we
  // hit Supabase once per stable thread state, not per message. The
  // workspace's chat is the buddy's memory — the moment the assistant
  // replies, the new (user, assistant) pair gets persisted.
  const chatWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (chatWriteTimer.current) clearTimeout(chatWriteTimer.current)
  }, [])
  const persistChat = useCallback((next: ChatMessage[]) => {
    if (!deal) return
    if (chatWriteTimer.current) clearTimeout(chatWriteTimer.current)
    chatWriteTimer.current = setTimeout(() => {
      void updateDealChat(deal.id, next)
    }, 400)
  }, [deal])

  const onChatSend = useCallback(async (userMessage: ChatMessage) => {
    if (!chatContext) return
    setChatMessages((prev) => [...prev, userMessage])
    setChatLoading(true)
    try {
      const history = chatMessages
      const res = await window.electronAPI?.chatDeal(userMessage.content, chatContext, history)
      const replyText = res?.ok && res.response
        ? res.response
        : "I couldn't reach the assistant — try that again in a moment."
      const assistantMsg: ChatMessage = {
        id:      `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        role:    "assistant",
        content: replyText,
        at:      Date.now(),
      }
      setChatMessages((prev) => {
        const next = [...prev, assistantMsg]
        persistChat(next)
        return next
      })
    } finally {
      setChatLoading(false)
    }
  }, [chatContext, chatMessages, persistChat])

  const onChatClear = useCallback(() => {
    setChatMessages([])
    persistChat([])
    if (deal) {
      void logChatCleared(deal.id)
      refreshActivitySoon()
    }
  }, [persistChat, deal, refreshActivitySoon])

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <BuddyMark size={22} tone="muted" />
      </div>
    )
  }

  if (notFound || !deal) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background gap-4 px-6 text-center">
        <div className="flex items-center justify-center size-12 rounded-xl bg-muted">
          <BuddyMark size={22} tone="muted" />
        </div>
        <div className="flex flex-col gap-1.5 max-w-[340px]">
          <p className="text-foreground" style={{ fontFamily: "var(--rv-font-display)", fontSize: 16, fontWeight: 500, letterSpacing: "-0.012em" }}>
            That deal isn't in your pipeline.
          </p>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            It may have been removed, or the link is from another account.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => router.push("/pipeline")}>
          Back to Pipeline
        </Button>
      </div>
    )
  }

  const address = [deal.address, deal.city, deal.state].filter(Boolean).join(", ")

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden" style={{ pointerEvents: "auto" }}>
      {/* Workspace header — Linear-style. Back link, address breadcrumb,
          identity (source), and the deal-level actions (Watch / Stage /
          Open / Delete) live here. The route's title bar above this
          renders the persistent AppTopBar; we don't compete with that. */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 border-b border-foreground/[0.07]"
        style={{ height: 44 }}
      >
        <button
          onClick={() => router.push("/pipeline")}
          className="inline-flex items-center gap-1.5 text-[12px] tracking-tight text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded-md"
          title="Back to Pipeline (Esc)"
        >
          <ChevronRight size={13} strokeWidth={2.2} style={{ transform: "rotate(180deg)" }} />
          <span>Pipeline</span>
        </button>
        <span aria-hidden className="size-1 rounded-full bg-foreground/[0.18]" style={{ width: 4, height: 4 }} />
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-[13px] font-medium truncate text-foreground">
            {deal.address ?? "—"}
          </span>
          <span className="text-[11.5px] truncate text-muted-foreground/80">
            {[deal.city, deal.state].filter(Boolean).join(", ")}
          </span>
          {/* Scenario-active chip — only shows when overrides are set,
              either via the scenario editor OR a chat tool call. Click
              clears via the scenario bus, which cascades through Panel's
              ResultPane → onScenarioChange → debounced persist. Lets
              the user reset without scrolling down to the editor. */}
          {hasActiveScenario(deal.scenario) && (
            <button
              onClick={() => resetScenarioFromBus()}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-[2px] text-[10.5px] font-medium tracking-tight transition-colors text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 shrink-0"
              title="Reset scenario — return to default analysis"
            >
              <span className="rounded-full bg-primary" style={{ width: 5, height: 5 }} />
              Scenario active
              <span className="text-primary/60">·</span>
              <span className="text-primary">Reset</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant={deal.watching ? "primary" : "secondary"}
            size="sm"
            onClick={onToggleWatching}
            title={deal.watching ? "Stop watching" : "Watch — get notified on price changes"}
            icon={deal.watching ? <Bell size={11} strokeWidth={2} /> : <BellOff size={11} strokeWidth={2} />}
          >
            {deal.watching ? "Watching" : "Watch"}
          </Button>
          <StageMenu stage={deal.stage} onChange={onMoveStage} />
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenInBrowse}
            icon={<ExternalLink size={11} strokeWidth={2} />}
            title="Open this listing in the browser"
          >
            Open
          </Button>
          {confirmDelete ? (
            <>
              <span className="text-[11.5px] text-muted-foreground">Delete?</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={onDelete}
                style={{ color: "var(--rv-neg)", borderColor: "var(--rv-neg-bg)" }}
              >
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              icon={<Trash2 size={11} strokeWidth={2} />}
              title="Delete this deal"
            />
          )}
        </div>
      </div>

      {/* Buy-bar onboarding nudge — single-line prompt that takes the
          buy-bar strip's slot when the user hasn't set ANY thresholds
          in Investment Defaults. Without this the workspace silently
          drops a major framing surface for first-time users. The
          nudge introduces the concept and gets them one click from
          the settings tab where they can dial it in. */}
      {!hasBuyBarSet && (
        <button
          onClick={() => router.push("/settings?tab=investment")}
          className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-foreground/[0.07] text-left transition-colors hover:bg-foreground/[0.03] w-full"
          style={{ background: "var(--rv-elev-1, transparent)" }}
          title="Set your buy-bar thresholds in Settings → Investment Defaults"
        >
          <Sparkles size={11} strokeWidth={2} className="text-primary shrink-0" />
          <span className="text-[12px] tracking-tight text-foreground">
            Set your buy bar
          </span>
          <span className="text-[11.5px] text-muted-foreground truncate">
            so I can frame each deal against your criteria
          </span>
          <span className="ml-auto text-[11px] text-primary shrink-0">
            Set thresholds →
          </span>
        </button>
      )}

      {/* Buy-bar context strip — sits ABOVE the portfolio strip so the
          user's own thresholds (their criteria) are the FIRST frame
          they read; "vs others I've saved" is the second. Hides if
          the user hasn't set any thresholds in Investment Defaults. */}
      {buyBarFacts.length > 0 && (
        <div
          className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-foreground/[0.07]"
          style={{ background: "var(--rv-elev-1, transparent)" }}
        >
          <span className="text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground">
            Vs your buy bar
          </span>
          <span aria-hidden className="size-1 rounded-full bg-foreground/[0.18]" style={{ width: 4, height: 4 }} />
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            {buyBarFacts.map((f) => (
              <span key={f.key} className="inline-flex items-baseline gap-1 text-[11.5px] tabular-nums">
                <span className="text-muted-foreground">{f.label}</span>
                <span
                  className="font-medium"
                  style={{
                    color:
                      f.tone === "pos" ? "var(--rv-pos)" :
                      f.tone === "neg" ? "var(--rv-neg)" :
                                          "var(--rv-t2)",
                  }}
                >
                  {f.delta}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Portfolio context strip — buddy observation about how this
          deal stacks against the user's other active saves. Only renders
          when there are peers AND at least one delta is meaningful (cap
          ≥ 0.10 pts, cash flow ≥ $25/mo, price ≥ 5%). For a single-deal
          pipeline the strip hides — there's nothing to compare to.
          This is what makes the workspace feel like the buddy actually
          knows your portfolio: the moment you land, it's framed against
          the rest of what you're shopping. */}
      {portfolioContext.facts.length > 0 && (
        <div
          className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-foreground/[0.07]"
          style={{ background: "var(--rv-elev-1, transparent)" }}
        >
          <span className="text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground">
            Vs your pipeline
          </span>
          <span className="text-[11px] text-muted-foreground/60 tabular-nums">
            {portfolioContext.n} {portfolioContext.n === 1 ? "save" : "saves"}
          </span>
          <span aria-hidden className="size-1 rounded-full bg-foreground/[0.18]" style={{ width: 4, height: 4 }} />
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            {portfolioContext.facts.map((f) => (
              <span key={f.key} className="inline-flex items-baseline gap-1 text-[11.5px] tabular-nums">
                <span className="text-muted-foreground">{f.label}</span>
                <span
                  className="font-medium"
                  style={{
                    color:
                      f.tone === "pos"     ? "var(--rv-pos)" :
                      f.tone === "neg"     ? "var(--rv-t3)" :
                                              "var(--rv-t2)",
                  }}
                >
                  {f.delta}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Body — 2 columns. Left scrolls the analysis; right hosts the
          buddy. Both columns are full height of the workspace body. */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT — analysis surface. Same Panel that Browse + slide-out
            use, just with actionRowCollapsed (the workspace header
            already owns Watch/Stage/Open/Delete) and chat suppressed
            (it lives in the right column). The "Similar in your
            pipeline" strip sits above the Panel so the workspace
            does what the slide-out can't — give cross-deal context
            from the user's actual portfolio at a glance. */}
        <div className="flex-1 min-w-0 h-full overflow-hidden border-r border-foreground/[0.07] flex flex-col">
          {similar.length > 0 && (
            <SimilarDealsStrip deals={similar} onOpen={(id) => router.push(`/pipeline/${id}`)} />
          )}
          <div className="flex-1 min-h-0">
            <Panel
              state={{ phase: "ready", result: deal.snapshot }}
              isSaved
              savedStage={STAGE_LABEL[deal.stage]}
              buyBar={buyBar}
              initialScenario={deal.scenario ?? null}
              onScenarioChange={onScenarioChange}
              actionRowCollapsed
            />
          </div>
        </div>

        {/* RIGHT — tabbed companion column. Buddy (chat) is the default;
            Activity shows the deal's stage history + scenario tweaks +
            re-analyses + price drops. Tabs keep both surfaces first-
            class without crushing either into a disclosure. */}
        <div
          className="shrink-0 h-full flex flex-col bg-background"
          style={{ width: 400 }}
        >
          <div
            className="shrink-0 flex items-center gap-1 px-2 border-b border-foreground/[0.07]"
            style={{ height: 36 }}
          >
            <RightTabButton active={rightTab === "buddy"}    onClick={() => setRightTab("buddy")}    label="Buddy" />
            <RightTabButton active={rightTab === "activity"} onClick={() => setRightTab("activity")} label="Activity" count={activity.length} />
            <RightTabButton active={rightTab === "sources"}  onClick={() => setRightTab("sources")}  label="Sources" />
          </div>

          {/* BUDDY TAB — render unconditionally but toggle visibility so
              PanelChat (which absolutely-positions at bottom of its
              relative parent) keeps mounted state + scroll position
              when the user switches tabs. Hiding via display only. */}
          <div
            className="flex-1 min-h-0 relative"
            style={{ display: rightTab === "buddy" ? "block" : "none" }}
          >
            {chatContext && (
              <PanelChat
                messages={chatMessages}
                context={chatContext}
                loading={chatLoading}
                onSend={onChatSend}
                onClear={onChatClear}
              />
            )}
          </div>

          {/* ACTIVITY TAB — timeline of deal_events. */}
          <div
            className="flex-1 min-h-0 overflow-y-auto panel-scroll"
            style={{ display: rightTab === "activity" ? "block" : "none" }}
          >
            <ActivityTimeline events={activity} loading={activityLoading} dealCreatedAt={deal.created_at} />
          </div>

          {/* SOURCES TAB — provenance for every number on the panel.
              Compact rendering of the same groups the SourcesDrawer
              shows; lives here so the user doesn't have to open a
              drawer that overlays their analysis to inspect origins. */}
          <div
            className="flex-1 min-h-0 overflow-y-auto panel-scroll"
            style={{ display: rightTab === "sources" ? "block" : "none" }}
          >
            <SourcesTab result={deal.snapshot} siteName={deal.site_name} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Right-column tab button ─────────────────────────────────────────────
function RightTabButton({
  active, onClick, label, count,
}: {
  active:  boolean
  onClick: () => void
  label:   string
  count?:  number
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] tracking-tight transition-colors"
      style={{
        color:      active ? "var(--rv-t1)" : "var(--rv-t3)",
        background: active ? "var(--rv-elev-2)" : "transparent",
        fontWeight: active ? 500 : 400,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--rv-t2)" }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--rv-t3)" }}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className="text-[10.5px] tabular-nums text-muted-foreground/70">
          {count}
        </span>
      )}
    </button>
  )
}

// ── Activity timeline ────────────────────────────────────────────────────
// Renders deal_events for one deal, newest-first. Each row: a colored
// dot, a short past-tense sentence ("Moved to Interested"), and a
// relative timestamp ("3d ago"). The "Saved" event sits at the bottom
// as the origin marker.

function ActivityTimeline({
  events, loading, dealCreatedAt,
}: {
  events:        ActivityEvent[]
  loading:       boolean
  dealCreatedAt: string
}) {
  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[12px] text-muted-foreground">
        Loading activity…
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0 px-2 py-2">
      {events.length === 0 && (
        <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
          No activity yet for this deal.
        </div>
      )}
      {events.map((ev) => (
        <ActivityRow key={ev.id} event={ev} />
      ))}
      <div className="px-3 py-2 mt-2 border-t border-foreground/[0.05]">
        <p className="text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground/60">
          First saved
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
          {new Date(dealCreatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>
    </div>
  )
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const { kind, payload, at } = event
  const { tone, line } = describeEvent(kind, payload)
  return (
    <div className="flex items-start gap-2.5 px-3 py-2 rounded-md hover:bg-foreground/[0.03] transition-colors">
      <span
        aria-hidden
        className="shrink-0 rounded-full mt-1.5"
        style={{
          width: 6, height: 6,
          background:
            tone === "pos" ? "var(--rv-pos)" :
            tone === "neg" ? "var(--rv-neg)" :
                              "var(--rv-t4)",
        }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] leading-snug text-foreground">{line}</p>
        <p className="text-[10.5px] text-muted-foreground tabular-nums mt-0.5">
          {relativeTime(at)}
        </p>
      </div>
    </div>
  )
}

/** Translate a deal_event into a one-line past-tense description.
 *  Tone drives the dot color: positive (green), negative (red), or
 *  neutral. Stage moves are neutral by default; price drops are
 *  positive (good for the buyer); price increases are negative. */
function describeEvent(kind: string, payload: Record<string, unknown> | null): { tone: "pos" | "neg" | "neutral"; line: string } {
  switch (kind) {
    case "saved":
      return { tone: "neutral", line: "Saved to pipeline" }
    case "stage_changed": {
      const to = (payload?.to as string) ?? "—"
      const label = STAGE_LABEL[(to as DealStage)] ?? to
      return { tone: "neutral", line: `Moved to ${label}` }
    }
    case "reanalyzed":
      return { tone: "neutral", line: "Re-analyzed with current market data" }
    case "tags_updated":
      return { tone: "neutral", line: "Updated tags" }
    case "scenario_changed": {
      // The payload IS the ScenarioOverrides object (only keys the
      // user set). Format the most informative 1–2 fields: prefer
      // the "headline" inputs (price, down, rate, rent) over the
      // advanced ones. If the override set has nothing recognizable,
      // fall back to the generic line.
      const summary = summarizeScenario(payload)
      return { tone: "neutral", line: summary ? `Adjusted scenario · ${summary}` : "Adjusted scenario" }
    }
    case "scenario_cleared":
      return { tone: "neutral", line: "Cleared scenario — back to default" }
    case "note_edited": {
      // Payload carries { length: <chars> }. Brief summary so a flurry
      // of edits doesn't read identically; if the note is empty, the
      // user actually deleted it — frame as "Cleared notes."
      const len = Number((payload as Record<string, unknown> | null)?.length ?? 0)
      if (len === 0) return { tone: "neutral", line: "Cleared notes" }
      return { tone: "neutral", line: `Updated notes${len > 0 ? ` · ${len} chars` : ""}` }
    }
    case "chat_cleared":
      return { tone: "neutral", line: "Cleared the buddy conversation" }
    case "price_changed": {
      const delta = Number(payload?.delta ?? 0)
      const abs   = Math.abs(delta)
      const sign  = delta < 0 ? "−" : "+"
      const fmtd  = `$${Math.round(abs).toLocaleString()}`
      return {
        tone: delta < 0 ? "pos" : "neg",
        line: `Price ${delta < 0 ? "dropped" : "rose"} ${sign}${fmtd}`,
      }
    }
    default:
      return { tone: "neutral", line: kind.replace(/_/g, " ") }
  }
}

/** Render the first 2 headline keys of a ScenarioOverrides payload as
 *  a compact human string. Used by the activity timeline so a
 *  "scenario_changed" row reads "Adjusted scenario · 30% down · 5.95% rate"
 *  instead of just "Adjusted scenario." Headline keys are the ones the
 *  user usually pulls on; advanced keys (HOA, insurance, mgmt %) get a
 *  generic count footer. */
function summarizeScenario(payload: Record<string, unknown> | null): string | null {
  if (!payload || typeof payload !== "object") return null
  const fmt = (k: string, v: unknown): string | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null
    switch (k) {
      case "purchasePrice":     return `Offer $${Math.round(v).toLocaleString()}`
      case "downPaymentPct":    return `${v}% down`
      case "interestRate":      return `${v}% rate`
      case "monthlyRent":       return `$${Math.round(v).toLocaleString()}/mo rent`
      case "vacancyPct":        return `${v}% vacancy`
      case "loanTermYears":     return `${v}yr term`
      case "annualPropertyTax": return `Tax $${Math.round(v).toLocaleString()}/yr`
      case "annualInsurance":   return `Ins $${Math.round(v).toLocaleString()}/yr`
      case "monthlyHOA":        return `HOA $${Math.round(v).toLocaleString()}/mo`
      case "managementPct":     return `${v}% mgmt`
      case "maintenancePct":    return `${v}% maint`
      case "capexPct":          return `${v}% capex`
      default:                  return null
    }
  }
  // Headline order matches the "5 main inputs" of the scenario editor
  // — these are what the user is most likely to be moving.
  const headlineOrder = [
    "purchasePrice", "downPaymentPct", "interestRate", "monthlyRent", "vacancyPct",
  ] as const
  const headline: string[] = []
  for (const k of headlineOrder) {
    const s = fmt(k, (payload as Record<string, unknown>)[k])
    if (s) headline.push(s)
    if (headline.length >= 2) break
  }
  if (headline.length > 0) {
    const otherCount = Object.keys(payload).filter((k) => !headlineOrder.includes(k as typeof headlineOrder[number])).length
    return otherCount > 0
      ? `${headline.join(" · ")} +${otherCount} more`
      : headline.join(" · ")
  }
  // Advanced-only changes — just say how many overrides are active.
  const total = Object.keys(payload).length
  return total > 0 ? `${total} override${total === 1 ? "" : "s"}` : null
}

/** "3d ago" / "Just now" / "May 4". Past-tense, terse. */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)        return "Just now"
  if (ms < 3600_000)      return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000)    return `${Math.floor(ms / 3600_000)}h ago`
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// ── Stage dropdown ──────────────────────────────────────────────────────
// Local copy of the Pipeline page's StageMenu so the workspace doesn't
// import from a sibling page file. Tiny, no behavior drift between the
// two surfaces.

import { ChevronDown } from "lucide-react"
import { DEAL_STAGES } from "@/lib/pipeline"

function StageMenu({ stage, onChange }: { stage: DealStage; onChange: (s: DealStage) => void }) {
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
        className="inline-flex items-center gap-1.5 rounded-[7px] text-[12px] font-medium tracking-tight transition-colors text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15"
        style={{ padding: "5px 9px 5px 11px" }}
      >
        {STAGE_LABEL[stage]}
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && (
        <div
          className="absolute z-30 left-0 top-full mt-1 flex flex-col rv-menu-pop border border-border"
          style={{
            background: "var(--rv-popover-bg)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            borderRadius: 8,
            boxShadow: "var(--rv-shadow-outer-md)",
            minWidth: 140,
            padding: 4,
          }}
        >
          {DEAL_STAGES.map((s) => (
            <Button
              key={s}
              onClick={() => { onChange(s); setOpen(false) }}
              variant="ghost"
              size="sm"
              className="justify-start"
              style={{ color: s === stage ? "var(--rv-accent)" : "var(--rv-t2)" }}
            >
              {STAGE_LABEL[s]}
              {s === stage && (
                <span
                  className="ml-2 inline-block w-1.5 h-1.5 rounded-full align-middle"
                  style={{ background: "var(--rv-accent)" }}
                />
              )}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Similar deals strip ────────────────────────────────────────────────
// Compact horizontal cards above the Panel that surface other deals in
// the user's pipeline close to this one (same city / similar price /
// similar type). Click a card → navigate to that deal's workspace.
// Without this, the workspace is single-deal-shaped — leaves you to
// remember which other saves are similar. With it, cross-deal context
// is the first thing you see when you sit down to work on a deal.

function SimilarDealsStrip({
  deals, onOpen,
}: {
  deals:  SavedDeal[]
  onOpen: (id: string) => void
}) {
  return (
    <div
      className="shrink-0 flex flex-col gap-2 px-4 py-3 border-b border-foreground/[0.07]"
      style={{ background: "var(--rv-elev-1, transparent)" }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground">
          Similar in your pipeline
        </span>
        <span className="text-[11px] text-muted-foreground/60 tabular-nums">
          {deals.length}
        </span>
      </div>
      <div className="flex items-stretch gap-2 overflow-x-auto panel-scroll">
        {deals.map((d) => {
          const cf = d.snapshot?.metrics?.monthlyCashFlow
          const cap = d.snapshot?.metrics?.capRate
          return (
            <button
              key={d.id}
              onClick={() => onOpen(d.id)}
              className="shrink-0 flex flex-col items-start gap-1 text-left rounded-[8px] px-3 py-2 transition-colors hover:bg-foreground/[0.04]"
              style={{
                width: 180,
                border: "0.5px solid var(--rv-border)",
                background: "var(--rv-surface)",
              }}
              title={`${[d.address, d.city, d.state].filter(Boolean).join(", ")} — open in workspace`}
            >
              <p className="text-[12px] font-medium leading-tight truncate w-full text-foreground">
                {d.address ?? "—"}
              </p>
              <p className="text-[11px] truncate w-full leading-tight text-muted-foreground">
                {[d.city, d.state].filter(Boolean).join(", ") || d.site_name}
              </p>
              <div className="flex items-baseline gap-2 w-full mt-1">
                <span className="text-[12px] font-medium tabular-nums text-foreground">
                  {d.list_price != null ? <Currency value={d.list_price} compact /> : "—"}
                </span>
                {Number.isFinite(cf) && cf != null && (
                  <span
                    className={cn(
                      "text-[11px] tabular-nums",
                    )}
                    style={{
                      color: cf >= 0 ? "var(--rv-pos)" : "var(--rv-t3)",
                    }}
                  >
                    <Currency value={cf} signed />/mo
                  </span>
                )}
                {Number.isFinite(cap) && cap != null && (
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                    {(cap * 100).toFixed(2)}%
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Sources tab ──────────────────────────────────────────────────────────
// Same provenance grouping as SourcesDrawer in components/panel/index.tsx,
// re-rendered as a compact in-tab list (no drawer chrome, no hero — the
// workspace already has its own header). Every number on the analysis
// panel ties back to one of these origins; this view makes that promise
// visible without overlaying the analysis with a drawer.

import type { PanelResult, SourceKind as SourceKindType } from "@/lib/electron"
import { siteGlyph } from "@/components/source/SourceMark"

const SOURCE_LABEL: Record<SourceKindType, string> = {
  listing:     "Listing page",
  hud_fmr:     "HUD Fair Market Rent",
  fred:        "Federal Reserve (FRED)",
  ai_estimate: "AI estimate",
  default:     "Industry default",
  user:        "Your override",
}

const SOURCE_ORDER: Record<SourceKindType, number> = {
  listing: 0, hud_fmr: 1, fred: 2, user: 3, ai_estimate: 4, default: 5,
}

const SOURCE_TONE: Record<SourceKindType, "data" | "estimate" | "default"> = {
  listing: "data", hud_fmr: "data", fred: "data", user: "data",
  ai_estimate: "estimate", default: "default",
}

function SourcesTab({ result, siteName }: { result: PanelResult; siteName: string | null }) {
  type Group = { source: SourceKindType; facts: Array<{ label: string; value: string }> }
  const groups = new Map<SourceKindType, Group>()
  const add = (source: SourceKindType, label: string, value: string) => {
    const g = groups.get(source)
    if (g) g.facts.push({ label, value })
    else groups.set(source, { source, facts: [{ label, value }] })
  }

  const fmtCurrency = (n: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
  const fmtPct = (n: number | null) =>
    n == null ? "—" : `${(n * 100).toFixed(2)}%`

  const p = result.provenance
  if (result.listPrice != null) add(p.listPrice.source, "List price",  fmtCurrency(result.listPrice))
  if (result.beds      != null) add("listing", "Beds",                 String(result.beds))
  if (result.baths     != null) add("listing", "Baths",                String(result.baths))
  if (result.sqft      != null) add("listing", "Sq ft",                result.sqft.toLocaleString())
  if (result.yearBuilt != null) add("listing", "Year built",           String(result.yearBuilt))
  if (result.address)           add("listing", "Address",              [result.address, result.city, result.state, result.zip].filter(Boolean).join(", "))

  add(p.rent.source,         "Rent",          `${fmtCurrency(p.rent.value)}/mo`)
  add(p.interestRate.source, "Interest rate", fmtPct(p.interestRate.value / 100))
  add(p.propertyTax.source,  "Property tax",  `${fmtCurrency(p.propertyTax.value)}/yr`)
  if (p.hoa) add(p.hoa.source, "HOA", `${fmtCurrency(p.hoa.value)}/mo`)
  add(p.insurance.source,    "Insurance",     `${fmtCurrency(p.insurance.value)}/yr`)

  const sorted = Array.from(groups.values()).sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source])

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <p className="text-[11.5px] leading-relaxed text-muted-foreground px-1">
        Every number on the panel ties back to one of these origins.
      </p>
      {sorted.map((g) => (
        <div
          key={g.source}
          className="flex flex-col gap-2 rounded-[10px] px-3 py-2.5"
          style={{
            background: "var(--rv-elev-1, transparent)",
            border:     "0.5px solid var(--rv-border)",
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="shrink-0 inline-flex items-center justify-center rounded-md text-[10px] font-semibold"
              style={{
                width:      18, height: 18,
                background: SOURCE_TONE[g.source] === "data"
                  ? "rgba(48,164,108,0.12)"
                  : SOURCE_TONE[g.source] === "estimate"
                  ? "rgba(218,165,32,0.16)"
                  : "var(--rv-elev-2)",
                color: SOURCE_TONE[g.source] === "data"
                  ? "var(--rv-pos)"
                  : SOURCE_TONE[g.source] === "estimate"
                  ? "#b48232"
                  : "var(--rv-t3)",
                border: "0.5px solid var(--rv-border)",
              }}
            >
              {g.source === "listing" ? siteGlyph(siteName).slice(0, 2) :
               g.source === "fred"    ? "FR" :
               g.source === "hud_fmr" ? "HU" :
               g.source === "user"    ? "U"  :
               g.source === "ai_estimate" ? "AI" :
                                            "·"}
            </span>
            <p className="text-[12px] font-medium tracking-tight text-foreground">
              {g.source === "listing" && siteName ? `${SOURCE_LABEL.listing} · ${siteName}` : SOURCE_LABEL[g.source]}
            </p>
          </div>
          <div className="flex flex-col gap-1 pl-[26px]">
            {g.facts.map((f, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] text-muted-foreground truncate">{f.label}</span>
                <span className="text-[11.5px] tabular-nums text-foreground shrink-0 truncate" title={f.value}>
                  {f.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
