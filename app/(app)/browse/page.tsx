"use client"

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import type { ChatContext, ChatMessage, NavUpdate, PanelPayload, PanelResult, TabInfo } from "@/lib/electron"
import Toolbar from "@/components/browser/Toolbar"
import TabStrip from "@/components/browser/TabStrip"
import Panel, { type PanelContentState, type ManualFacts } from "@/components/panel"
import { useSidebar, SNAP_ICONS } from "@/components/sidebar/context"
import { Bookmark, RefreshCw, PanelRight, GitCompareArrows, FilePlus } from "lucide-react"
import { usePaletteActions, type Action as PaletteAction } from "@/components/command-palette"
import {
  computePipelineAverages,
  fetchSavedByUrl,
  fetchPipeline,
  fetchStartScreenContext,
  fetchUrlViewStats,
  fetchWeeklyDigest,
  logBrowseVisit,
  runWatchChecks,
  saveDeal,
  STAGE_LABEL,
  updateDealScenario,
  updateDealTags,
  type DealStage,
  type RecentListing,
  type SavedDeal,
  type StartScreenContext,
  type UrlViewStats,
  type WeeklyDigest,
  DEALS_CHANGED_EVENT,
} from "@/lib/pipeline"
import { useRegisterPanelState } from "@/components/panel/context"
import { SourceMark } from "@/components/source/SourceMark"
import { Currency } from "@/lib/format"
import { applyScenarioFromBus, type ScenarioOverrides } from "@/lib/scenario"
import ActivityFeed from "@/components/ActivityFeed"
import { showToast } from "@/lib/toast"

// Default width matches the Pipeline detail rail (440px) so the panel
// feels like the same surface across the app — solid, deliberate,
// app-native. User can still drag wider for extra breathing room.
const PANEL_W_DEFAULT = 440
const PANEL_W_MIN     = 360
const PANEL_W_MAX     = 720
const SPLITTER_W      = 4

// Module-level cache for the start-screen data. The /browse page unmounts
// when the user navigates to /pipeline or /settings, so without this every
// return trip would refetch from Supabase + show an empty StartScreen for
// 200-400ms while the IPC roundtrip runs. The cache is populated on first
// fetch and read synchronously on every subsequent mount, with a background
// refresh to catch any external changes (saves from another tab, etc.).
let _cachedStartCtx: StartScreenContext | null = null
let _cachedActiveDeals: SavedDeal[] = []

// Tracks whether the StartScreen's intro animations have already played
// in this session. After the first play, subsequent mounts skip them so
// the screen reappears instantly when navigating back instead of replaying
// the staggered fade-in cascade every single time.
let _startScreenIntroPlayed = false

// Pretty site name from a URL — used for the browse_history row + future
// site-icon rendering. Falls back to hostname so we never log empty strings.
function extractSiteName(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "")
    const root = host.split(".").slice(-2)[0]
    if (!root) return host
    return root.charAt(0).toUpperCase() + root.slice(1)
  } catch {
    return null
  }
}

export default function BrowsePage() {
  return <Suspense><BrowsePageInner /></Suspense>
}

function BrowsePageInner() {
  const urlbarRef     = useRef<HTMLInputElement>(null)
  const searchParams  = useSearchParams()
  const router        = useRouter()

  const [nav,           setNav]           = useState<NavUpdate>({})
  const [panelOpen,     setPanelOpen]     = useState(false)
  const [panelContent,  setPanelContent]  = useState<PanelContentState>({ phase: "empty", hasListing: false })
  const [panelW,        setPanelW]        = useState(PANEL_W_DEFAULT)
  const [browserReady,  setBrowserReady]  = useState(false)
  /** Map of source_url → SavedDeal for the current user. Hydrated once on
   *  mount + updated optimistically on save. The "Saved · <stage>" chip on
   *  the panel reads from this. */
  const [savedByUrl, setSavedByUrl] = useState<Record<string, SavedDeal>>({})

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [tabs,       setTabs]       = useState<TabInfo[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const { open: sbOpenForTabs, width: sbWidthForTabs } = useSidebar()
  // Tab strip's left padding mirrors the toolbar so the first tab clears
  // the macOS traffic lights + the global sidebar-toggle button.
  const tabStripPadL =
    sbOpenForTabs && sbWidthForTabs >= SNAP_ICONS ? 8
    : sbOpenForTabs                                ? 38
    :                                                120

  const api = typeof window !== "undefined" ? window.electronAPI : undefined

  // Hydrate the saved-deals cache once on mount. Failures (not signed in,
  // network issue) leave the cache empty, which is safe — the panel just
  // won't show the "Saved" chip until the user does sign in.
  useEffect(() => {
    let cancelled = false
    fetchSavedByUrl().then((map) => {
      if (!cancelled) setSavedByUrl(map)
    })
    return () => { cancelled = true }
  }, [])

  // AI tool-use bridge — when Claude calls adjust_scenario via the chat
  // handler in main.js, the renderer hears it here and forwards the
  // partial overrides into the scenario bus. The active ResultPane is
  // subscribed and merges the change live; metrics recompute instantly.
  useEffect(() => {
    if (!api?.onApplyScenario) return
    return api.onApplyScenario((changes) => {
      // Cast: the IPC payload is Record<string, number>, the bus
      // accepts Partial<ScenarioOverrides>. Same shape modulo typing.
      applyScenarioFromBus(changes as Partial<ScenarioOverrides>)
    })
  }, [api])

  // Log every listing-URL navigation to browse_history. Listing-only by
  // design — non-real-estate URLs aren't tracked. The nav.isListing flag
  // is computed in main from the URL heuristic.
  const lastLoggedUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (!nav.url || !nav.isListing) return
    if (nav.loading) return // wait for the page to settle
    if (lastLoggedUrlRef.current === nav.url) return
    lastLoggedUrlRef.current = nav.url
    logBrowseVisit({
      url:      nav.url,
      title:    nav.title,
      siteName: extractSiteName(nav.url),
    })
  }, [nav.url, nav.isListing, nav.loading, nav.title])

  // Fetch view stats for the current URL — powers the "You've seen this"
  // indicator in the panel. Reads AFTER the new visit is logged so the
  // count includes today.
  const [viewStats, setViewStats] = useState<UrlViewStats | null>(null)
  useEffect(() => {
    if (!nav.url || !nav.isListing) { setViewStats(null); return }
    let cancelled = false
    // Tiny delay so the just-logged visit lands first.
    const t = setTimeout(() => {
      fetchUrlViewStats(nav.url!).then((s) => {
        if (!cancelled) setViewStats(s)
      })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [nav.url, nav.isListing])

  // Reserved right-edge strip = panel + splitter handle (when open). Main
  // process uses this to compute the embedded browser's right edge against
  // the current nextViewBounds — no per-frame IPC during window resize.
  const reservedRight = panelOpen ? panelW + SPLITTER_W : 0

  // Tabs persist across route navigation so the user doesn't lose their
  // research when bouncing between Browse / Pipeline / Settings. On mount
  // we ensure at least one tab exists and reveal the active view; on
  // unmount we just hide (park off-screen) the tab views — they stay alive
  // in main with their full state.
  useEffect(() => {
    if (!api) return
    let cancelled = false
    if (!browserReady) {
      api.createBrowser({ panelWidth: reservedRight }).then(() => {
        if (!cancelled) setBrowserReady(true)
      })
    } else {
      api.showBrowser({ panelWidth: reservedRight })
    }
    return () => {
      cancelled = true
      api.hideBrowser()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  // Deep-link from Pipeline card click: /browse?url=...
  // Once the embedded browser is ready, navigate it to the requested URL,
  // then strip the query param so a refresh doesn't re-trigger.
  useEffect(() => {
    if (!api || !browserReady) return
    const target = searchParams.get("url")
    if (!target) return
    api.navigate(target)
    router.replace("/browse")
  }, [api, browserReady, searchParams, router])

  // Snap the BrowserView's bounds in one step (animate: false) instead of
  // ticking them every frame for 220ms. On heavy pages like Zillow each
  // setBounds triggers a Chromium re-layout that takes 50-200ms; ticking
  // ~14 times in 220ms queues up reflows faster than they can complete and
  // the panel slide reads as choppy/lagging. With the snap, the page reflows
  // ONCE and the React panel slides smoothly via its own CSS transition into
  // the now-empty area. The brief moment where the dark frame area is wider
  // than the still-sliding panel is the tradeoff, and it reads cleanly.
  useEffect(() => {
    if (!browserReady || !api) return
    api.setLayout({ panelWidth: reservedRight, animate: false })
  }, [api, browserReady, reservedRight])

  // Hide the embedded WebContentsView whenever the start screen is showing
  // (no URL loaded). The native view is composed *over* React's DOM, so even
  // an empty browser would intercept clicks on the start-screen buttons.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!api || !browserReady) return
    if (!nav.url) {
      api.hideBrowser()
    } else {
      api.showBrowser({ panelWidth: reservedRight })
    }
  }, [api, browserReady, nav.url])

  // Subscribe to tab state. Main broadcasts on every change (create, close,
  // activate, navigate). We mirror it locally for the strip + active-tab
  // gating logic.
  useEffect(() => {
    if (!api?.onTabsState) return
    const off = api.onTabsState(({ tabs: list, activeId }) => {
      setTabs(list)
      setActiveTabId(activeId)
    })
    // Pull the initial state too — onTabsState only fires on changes.
    api.listTabs?.().then((arr) => {
      setTabs(arr)
      // listTabs payload doesn't include activeId; first onTabsState event
      // will fix it. Pessimistically use the first tab's id as active.
      if (arr.length && !activeTabId) setActiveTabId(arr[0].id)
    }).catch(() => {})
    return () => { off() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  useEffect(() => {
    if (!api) return
    const offNav = api.onNavUpdate((p) => setNav((prev) => ({ ...prev, ...p })))

    // panel:analyzing — runs in the BACKGROUND. We update the phase so
    // the toolbar dots animate and any already-open panel reflects the
    // state, but we DON'T auto-open the panel here. The panel pops only
    // when there's a fully-formed result (panel:ready) or an error
    // (panel:error). Drive-by browsing on a real-estate site no longer
    // jolts the user with an empty analyzing pane.
    const offAnalyzing = api.onPanelAnalyzing(() => {
      setPanelContent({ phase: "analyzing" })
    })

    const offReady = api.onPanelReady((payload: PanelPayload) => {
      if (payload.ok) {
        setPanelContent({ phase: "ready", result: payload as PanelResult })
      } else {
        setPanelContent({ phase: "error", message: (payload as { message: string }).message })
      }
      setPanelOpen(true)
    })

    const offHide = api.onPanelHide(() => {
      // Auto-hide event from main (e.g. user navigated to a non-listing).
      // Reset content to "empty" so the next manual open shows the right CTA.
      setPanelOpen(false)
      setPanelContent({ phase: "empty", hasListing: false })
    })

    const offError = api.onPanelError((message: string) => {
      setPanelContent({ phase: "error", message })
      setPanelOpen(true)
    })

    // Download lifecycle — surfaces a small toast at the bottom-right when
    // the user triggers a download (right-click → Save Image, or any direct
    // file link in the embedded browser). The toast auto-dismisses; it's
    // ambient feedback, not a blocking dialog.
    const offDownload = api.onDownloadState?.((payload) => {
      setDownloadToast(payload)
    }) ?? (() => {})

    // ⌘L (focus URL bar) is handled inside Toolbar — it owns the editing
    // state and a raw .focus() here would no-op when the input isn't
    // mounted yet.
    return () => { offNav(); offAnalyzing(); offReady(); offHide(); offError(); offDownload() }
  }, [api])

  // Auto-dismiss the download toast 3.5s after the most-recent state change.
  // Manually-cancelled downloads dismiss immediately; "started" pulses for
  // longer so the user notices the file is on its way.
  const [downloadToast, setDownloadToast] = useState<import("@/lib/electron").DownloadState | null>(null)
  useEffect(() => {
    if (!downloadToast) return
    const ms = downloadToast.state === "started" ? 4000 : 3500
    const t = setTimeout(() => setDownloadToast(null), ms)
    return () => clearTimeout(t)
  }, [downloadToast])

  // Keep the "empty" pane's hasListing flag in sync with current nav state
  // so the manual-open CTA reads correctly without an extra render hop.
  useEffect(() => {
    setPanelContent((prev) => {
      if (prev.phase !== "empty") return prev
      return { phase: "empty", hasListing: !!nav.isListing }
    })
  }, [nav.isListing])

  // ── Splitter drag ──────────────────────────────────────────────────────────
  const draggingRef = useRef(false)
  const splitterRef = useRef<HTMLDivElement>(null)

  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.cursor = "col-resize"
  }, [])
  const moveDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    const w = window.innerWidth - e.clientX - SPLITTER_W / 2
    setPanelW(Math.max(PANEL_W_MIN, Math.min(PANEL_W_MAX, Math.round(w))))
  }, [])
  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    document.body.style.cursor = ""
    if (splitterRef.current) splitterRef.current.style.background = "transparent"
  }, [])

  const navigate  = (url: string) => api?.navigate(url)
  const goBack    = () => api?.back()
  const goForward = () => api?.forward()
  const reload    = () => api?.reload()

  // ── Panel actions ──────────────────────────────────────────────────────────
  // Reanalyze drives the panel through the FULL flow in main: extraction →
  // /api/analyze → broadcast panel:ready / panel:error. We listen for those
  // broadcasts via the existing useEffect, so this callback only kicks off
  // the work and never has to handle the result directly.
  const reanalyze = useCallback(() => {
    if (!api) return
    setPanelContent({ phase: "analyzing" })
    setPanelOpen(true)
    api.reanalyze().catch((err) => {
      console.error("[reanalyze] IPC failed:", err)
      setPanelContent({ phase: "error", message: "Couldn't reach the analyzer." })
    })
  }, [api])

  // Safety net — the analyze pipeline has multiple failure modes in main
  // (DOM polling, Haiku, /api/analyze fetch). Each broadcasts an error on
  // failure, but if any path silently dies the panel would sit on the
  // spinner forever. Time it out at 60s and surface a friendly fallback so
  // the user can retry rather than staring at a frozen state.
  useEffect(() => {
    if (panelContent.phase !== "analyzing") return
    const t = setTimeout(() => {
      setPanelContent((prev) => prev.phase === "analyzing"
        ? { phase: "error", message: "Analysis is taking too long. Try Re-analyze." }
        : prev)
    }, 60_000)
    return () => clearTimeout(t)
  }, [panelContent.phase])

  const startManualEntry = useCallback(() => {
    setPanelContent({ phase: "manual-entry" })
    setPanelOpen(true)
  }, [])

  const cancelManualEntry = useCallback(() => {
    setPanelContent({ phase: "empty", hasListing: !!nav.isListing })
  }, [nav.isListing])

  const submitManualEntry = useCallback(async (facts: ManualFacts) => {
    setPanelContent({ phase: "analyzing" })
    setPanelOpen(true)
    try {
      // Bypass main's auto-analyze chain — call /api/analyze directly with
      // a synthetic extraction shape matching what main sends.
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extraction: {
            ok: true,
            kind: "listing-rental",
            confidence: "high",
            facts: {
              listPrice:          facts.listPrice,
              monthlyRent:        facts.monthlyRent,
              monthlyHOA:         facts.monthlyHOA,
              annualPropertyTax:  facts.annualPropertyTax,
              annualInsuranceEst: facts.annualInsuranceEst,
              address:            facts.address || null,
              city:               facts.city || null,
              state:              facts.state || null,
              zip:                facts.zip || null,
              beds:               facts.beds,
              baths:              facts.baths,
              sqft:               facts.sqft,
              yearBuilt:          facts.yearBuilt,
              propertyType:       facts.propertyType || null,
              siteName:           extractSiteName(nav.url ?? "") ?? null,
              riskFlags:          [],
            },
            meta: {},
            take: null,
          },
          // Manual entry doesn't have access to user prefs from this side,
          // but main will fall back to safe defaults via DEFAULT_INPUTS.
          prefs: {},
        }),
      })
      if (!res.ok) {
        setPanelContent({ phase: "error", message: "Analysis failed. Try again." })
        return
      }
      const result = await res.json()
      setPanelContent({ phase: "ready", result })
    } catch (err) {
      setPanelContent({ phase: "error", message: "Couldn't reach the analyzer." })
    }
  }, [nav.url])

  const togglePanel = useCallback(() => {
    setPanelOpen((wasOpen) => {
      if (wasOpen) return false
      // Opening: if we don't have a result yet, kick off analysis.
      if (panelContent.phase === "empty" && nav.isListing) {
        // Use setTimeout to avoid setting state-during-render warnings —
        // the setPanelOpen update is in flight, reanalyze sets phase next.
        setTimeout(reanalyze, 0)
      }
      return true
    })
  }, [panelContent.phase, nav.isListing, reanalyze])

  // Push the panel state up to the layout-level context so the pinned
  // smart panel toggle (top-right) can render the right state — analyzing
  // halo, ready badge, open/closed treatment — without owning the state.
  useRegisterPanelState({
    isOpen: panelOpen,
    phase:  panelContent.phase,
    toggle: togglePanel,
  })

  // Pending scenario for the currently-viewed unsaved listing. Persisted
  // separately from savedByUrl because there's no row to attach to yet —
  // when the user hits Save, this rides along into saveDeal so the
  // scenario lands in the pipeline together with the snapshot. Keyed by
  // URL so switching tabs doesn't bleed one listing's overrides into
  // another. Cleared after a successful save (the saved row is now the
  // source of truth).
  const [pendingScenario, setPendingScenario] = useState<Record<string, ScenarioOverrides | null>>({})

  const saveCurrentListing = useCallback(async () => {
    if (panelContent.phase !== "ready") return
    const url = nav.url
    if (!url) return
    if (savedByUrl[url]) return

    const result   = panelContent.result
    const scenario = pendingScenario[url] ?? null

    // Optimistic save — the saved-chip lights up the moment the user
    // hits ⌘S. The network call runs in the background; if it fails
    // (auth expired, offline), we silently revert the local state and
    // log. For the scan-loop user opening 30+ panels per evening, the
    // wait between click and visual feedback was the worst part of the
    // flow. This collapses it to zero. Same pattern as Linear's
    // optimistic mutations and Apple Notes' instant write.
    const now = new Date().toISOString()
    const optimistic: SavedDeal = {
      id:                  `temp-${Date.now()}`,
      user_id:             "",  // unknown until the server returns the real row
      source_url:          url,
      address:             result.address,
      city:                result.city,
      state:               result.state,
      zip:                 result.zip,
      list_price:          result.listPrice,
      beds:                result.beds,
      baths:               result.baths,
      sqft:                result.sqft,
      year_built:          result.yearBuilt,
      site_name:           result.siteName,
      stage:               "watching",
      tags:                [],
      notes:               null,
      watching:            true,
      created_at:          now,
      updated_at:          now,
      last_revisited_at:   null,
      last_reanalyzed_at:  null,
      snapshot:            result,
      scenario,
    }
    setSavedByUrl((prev) => ({ ...prev, [url]: optimistic }))
    setPendingScenario((prev) => {
      if (!(url in prev)) return prev
      const next = { ...prev }; delete next[url]; return next
    })

    // Buddy toast — observe something interesting about the save.
    // Compares the saved deal against the user's portfolio so the
    // toast reads as a real noticing ("This one's above your average")
    // not a generic confirmation ("Saved successfully").
    const savedCount = Object.keys(savedByUrl).length + 1   // +1 for this save
    const otherDeals = Object.values(savedByUrl)
    const otherCFs   = otherDeals.map((d) => d.snapshot?.metrics?.monthlyCashFlow).filter((n): n is number => Number.isFinite(n))
    const avgCF      = otherCFs.length > 0 ? otherCFs.reduce((a, b) => a + b, 0) / otherCFs.length : null
    const thisCF     = result.metrics?.monthlyCashFlow ?? null

    let detail: string | undefined
    if (avgCF != null && thisCF != null && otherCFs.length >= 2) {
      const delta = thisCF - avgCF
      if (Math.abs(delta) >= 50) {
        const sign = delta > 0 ? "+" : "−"
        detail = `${sign}$${Math.abs(Math.round(delta))}/mo vs your portfolio average`
      }
    }
    if (!detail) {
      detail = savedCount === 1
        ? "Your first deal."
        : `${savedCount} in your pipeline now.`
    }

    showToast({
      message: "Saved to Watching.",
      detail,
      tone:    "pos",
      action:  {
        label:   "View →",
        onClick: () => router.push("/pipeline"),
      },
    })

    const saved = await saveDeal({ sourceUrl: url, result, scenario })
    if (!saved) {
      // Revert: the network call failed. Silently roll back the optimistic
      // row so the chip stops claiming the deal is saved.
      console.warn("[saveDeal] failed — reverting optimistic save")
      setSavedByUrl((prev) => {
        const next = { ...prev }
        if (next[url]?.id === optimistic.id) delete next[url]
        return next
      })
      return
    }
    // Replace the optimistic row with the real saved row from Supabase.
    setSavedByUrl((prev) => ({ ...prev, [url]: saved }))

    // Fire-and-forget: ask Haiku for 2-3 short factual tags. On success,
    // patch the saved row + local cache. On failure, the deal just stays
    // untagged — tags are nice-to-have, not load-bearing.
    void api?.tagDeal({
      address:         result.address,
      city:            result.city,
      state:           result.state,
      propertyType:    result.propertyType,
      listPrice:       result.listPrice,
      beds:            result.beds,
      baths:           result.baths,
      sqft:            result.sqft,
      yearBuilt:       result.yearBuilt,
      monthlyCashFlow: result.metrics.monthlyCashFlow,
      capRate:         result.metrics.capRate,
      dscr:            result.metrics.dscr,
      riskFlags:       result.riskFlags,
      siteName:        result.siteName,
    }).then(async (resp) => {
      if (!resp?.ok || resp.tags.length === 0) return
      const ok = await updateDealTags(saved.id, resp.tags)
      if (ok) {
        setSavedByUrl((prev) => ({
          ...prev,
          [url]: { ...prev[url], tags: resp.tags },
        }))
      }
    }).catch(() => { /* silent */ })
  }, [panelContent, nav.url, savedByUrl, pendingScenario, api])

  // Scenario persist callback the panel debounces. Saved listings: write
  // to the pipeline row (and patch local cache so Recent strip / averages
  // stay in sync). Unsaved listings: stash in pendingScenario keyed by
  // URL so it can ride along into the next saveDeal call.
  const onScenarioChange = useCallback((scenario: ScenarioOverrides | null) => {
    const url = nav.url
    if (!url) return
    const saved = savedByUrl[url]
    if (saved) {
      setSavedByUrl((prev) => ({ ...prev, [url]: { ...prev[url], scenario } }))
      void updateDealScenario(saved.id, scenario)
    } else {
      setPendingScenario((prev) => ({ ...prev, [url]: scenario }))
    }
  }, [nav.url, savedByUrl])

  // Menu accelerators broadcast shortcut:* — listen for the ones that
  // are contextual to /browse: save-listing and reanalyze. Both fire
  // regardless of focus (browserView, sidebar, or React content), which
  // is the reason we route through the menu rather than window keydown.
  useEffect(() => {
    const off = window.__rvOnShortcut?.((kind) => {
      if (kind === "save-listing" && panelContent.phase === "ready") {
        void saveCurrentListing()
      } else if (kind === "reanalyze" && nav.isListing) {
        reanalyze()
      }
    })
    return () => { off?.() }
  }, [panelContent.phase, saveCurrentListing, reanalyze, nav.isListing])

  const currentSaved      = nav.url ? savedByUrl[nav.url] : undefined
  const currentSavedStage = currentSaved ? STAGE_LABEL[currentSaved.stage] : undefined
  const isCurrentSaved    = !!currentSaved
  // Hydrate the scenario editor: prefer the saved row's stored scenario;
  // fall back to anything the user was modeling on this URL pre-save.
  const currentInitialScenario =
    currentSaved?.scenario ?? (nav.url ? pendingScenario[nav.url] ?? null : null)

  // Personal benchmarks — computed from the user's saved-deal snapshots.
  // Drives the panel's "vs your saves" line. Updates live as the user
  // saves more deals (savedByUrl changes → re-derive). Excludes deals
  // in "passed" since those aren't part of the active portfolio.
  const pipelineAverages = useMemo(
    () => computePipelineAverages(Object.values(savedByUrl)),
    [savedByUrl]
  )

  // ── Auto-watch agent — silent background re-check on app launch ─────────
  //
  // Watch is the agentic surface — once a deal is flagged, the user
  // should never have to manually press a button to find out if anything
  // changed. On the first /browse mount per ≥18h window, run the watch
  // checks in the background, surface a small banner if any prices
  // moved, and stamp localStorage so we don't re-run on every mount.
  // Failures (no key, no watched deals, network down) are silent — the
  // banner only appears when there's something to show.
  const [watchNotice, setWatchNotice] = useState<{
    changed: number; checked: number; deltaTotal: number
  } | null>(null)
  const watchCheckedThisMount = useRef(false)

  useEffect(() => {
    if (watchCheckedThisMount.current) return
    if (typeof window === "undefined") return
    watchCheckedThisMount.current = true

    const KEY  = "rv-watch-last-run"
    const TTL  = 18 * 60 * 60 * 1000 // 18h
    const last = (() => { try { return Number(localStorage.getItem(KEY) ?? 0) } catch { return 0 } })()
    if (Date.now() - last < TTL) return

    // Fire-and-forget. We stamp the timestamp BEFORE the check so a
    // crash mid-run doesn't lock us into retrying every mount.
    try { localStorage.setItem(KEY, String(Date.now())) } catch {}
    void (async () => {
      try {
        const summary = await runWatchChecks()
        if (summary.checked === 0) return // no watched deals — silent
        if (summary.changed === 0) return // nothing moved — silent
        const totalDelta = summary.changes.reduce((a, c) => a + c.delta, 0)
        setWatchNotice({
          changed:    summary.changed,
          checked:    summary.checked,
          deltaTotal: totalDelta,
        })
      } catch { /* swallow — banner stays hidden */ }
    })()
  }, [])

  // ── Per-tab chat history ──────────────────────────────────────────────────
  // Each tab gets its own conversation log. Switching tabs swaps which
  // log shows in the panel; closing a tab discards its log. Resets when
  // the tab navigates to a different URL (chat is bound to the listing,
  // not the tab itself).
  const [chatByTab,   setChatByTab]   = useState<Record<string, ChatMessage[]>>({})
  const [chatLoading, setChatLoading] = useState(false)
  const chatLastUrl   = useRef<Record<string, string>>({})
  const activeChat    = activeTabId ? (chatByTab[activeTabId] ?? []) : []

  // If the active tab navigates to a new URL, reset its chat — the
  // conversation was about the previous listing.
  useEffect(() => {
    if (!activeTabId || !nav.url) return
    if (chatLastUrl.current[activeTabId] === nav.url) return
    chatLastUrl.current[activeTabId] = nav.url
    setChatByTab((prev) => {
      if (!prev[activeTabId] || prev[activeTabId].length === 0) return prev
      const next = { ...prev }
      delete next[activeTabId]
      return next
    })
  }, [activeTabId, nav.url])

  // Build the chat context bundle from the panel's current ready state.
  const chatContext = useMemo<ChatContext | undefined>(() => {
    if (panelContent.phase !== "ready") return undefined
    const r = panelContent.result
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
        activeCount:  Object.keys(savedByUrl).length,
        commonCities: Array.from(new Set(
          Object.values(savedByUrl).map((d) => d.city).filter(Boolean) as string[]
        )).slice(0, 5),
      },
    }
  }, [panelContent, savedByUrl])

  const onChatSend = useCallback(async (userMessage: ChatMessage) => {
    if (!activeTabId || !chatContext) return
    // Optimistic — append the user message immediately.
    setChatByTab((prev) => ({
      ...prev,
      [activeTabId]: [...(prev[activeTabId] ?? []), userMessage],
    }))
    setChatLoading(true)
    try {
      const history = chatByTab[activeTabId] ?? []
      const res = await api?.chatDeal(userMessage.content, chatContext, history)
      const replyText = res?.ok && res.response
        ? res.response
        : "I couldn't reach the assistant — try that again in a moment."
      const assistantMsg: ChatMessage = {
        id:      `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        role:    "assistant",
        content: replyText,
        at:      Date.now(),
      }
      setChatByTab((prev) => ({
        ...prev,
        [activeTabId]: [...(prev[activeTabId] ?? []), assistantMsg],
      }))
    } finally {
      setChatLoading(false)
    }
  }, [activeTabId, chatContext, chatByTab, api])

  const onChatClear = useCallback(() => {
    if (!activeTabId) return
    setChatByTab((prev) => {
      const next = { ...prev }
      delete next[activeTabId]
      return next
    })
  }, [activeTabId])

  // Wire context-aware actions into the global ⌘K palette. The palette
  // calls these builders when it opens, so we get fresh values without
  // re-registering on every render.
  usePaletteActions(() => {
    const acts: PaletteAction[] = []
    const onListing = !!nav.isListing && !!nav.url

    if (onListing && panelContent.phase === "ready" && !isCurrentSaved) {
      acts.push({
        id:       "browse-save",
        group:    "Actions",
        label:    "Save current listing",
        sub:      [nav.title, currentSavedStage].filter(Boolean).join(" · ") || nav.url || "",
        Icon:     Bookmark,
        shortcut: "⌘S",
        run:      () => { void saveCurrentListing() },
      })
    }
    if (onListing) {
      acts.push({
        id:    "browse-reanalyze",
        group: "Actions",
        label: panelContent.phase === "ready" ? "Re-analyze this listing" : "Analyze this listing",
        Icon:  RefreshCw,
        run:   reanalyze,
      })
    }
    acts.push({
      id:    "browse-toggle-panel",
      group: "Actions",
      label: panelOpen ? "Hide analysis panel" : "Show analysis panel",
      Icon:  PanelRight,
      run:   togglePanel,
    })
    return acts
  })

  // Start-screen context bundle — recent listings + pipeline signals.
  // Seeded synchronously from the module-level cache so re-entering /browse
  // from another route doesn't flash an empty StartScreen while the IPC
  // refetch runs. The background refresh keeps the cache fresh.
  const [startCtx, setStartCtx] = useState<StartScreenContext | null>(_cachedStartCtx)
  // Active saved deals (Watching / Interested / Offered), newest-first.
  // The start screen renders these as the visual centerpiece — the user's
  // own portfolio is the surface, not a generic greeting + launcher.
  const [activeDeals, setActiveDeals] = useState<SavedDeal[]>(_cachedActiveDeals)
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      fetchStartScreenContext().then((ctx) => {
        if (cancelled) return
        _cachedStartCtx = ctx
        setStartCtx(ctx)
      })
      fetchPipeline().then((deals) => {
        if (cancelled) return
        const ACTIVE: DealStage[] = ["watching", "interested", "offered"]
        const next = deals.filter((d) => ACTIVE.includes(d.stage)).slice(0, 5)
        _cachedActiveDeals = next
        setActiveDeals(next)
      }).catch(() => {})
    }
    refresh()
    window.addEventListener(DEALS_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(DEALS_CHANGED_EVENT, refresh)
    }
  }, [])

  const showPlaceholder = browserReady && !nav.url

  return (
    // FULL-HEIGHT PANEL ARCHITECTURE: the page is a top-level flex-row.
    // The chrome (tabs + toolbar + browser) lives in the LEFT column;
    // the analysis panel is its sibling on the right, full window height.
    // Treats the panel as a primary surface like the sidebar — same
    // pattern Cursor / Linear / VS Code use.
    <div className="flex w-full h-full overflow-hidden">
      {/* Left column — tabs + toolbar + browser content */}
      <div className="flex flex-col flex-1 min-w-0">
        <TabStrip
          tabs={tabs}
          activeId={activeTabId}
          paddingLeft={tabStripPadL}
          onActivate={(id) => {
            setActiveTabId(id)
            void api?.activateTab(id)
          }}
          onClose={(id)    => api?.closeTab(id)}
          onNew={()        => api?.newTab()}
          onReorder={(orderedIds) => {
            setTabs((prev) => {
              const byId = new Map(prev.map((t) => [t.id, t]))
              return orderedIds.map((id) => byId.get(id)).filter(Boolean) as typeof prev
            })
            void api?.reorderTabs(orderedIds)
          }}
        />
        <Toolbar
          nav={nav}
          isAnalyzing={panelContent.phase === "analyzing"}
          onBack={goBack}
          onForward={goForward}
          onReload={reload}
          onNavigate={navigate}
          urlbarRef={urlbarRef}
        />

        {/* Browser pane — fills remaining vertical space in this column */}
        <div
          className="flex-1 min-h-0 relative"
          style={{
            background: nav.url ? "var(--rv-scrim-strong)" : "transparent",
          }}
        >
          <div className="absolute inset-0">
            {showPlaceholder && (
              <>
                {watchNotice && (
                  <WatchNoticeBanner
                    notice={watchNotice}
                    onClick={() => router.push("/pipeline")}
                    onDismiss={() => setWatchNotice(null)}
                  />
                )}
                <StartScreen
                  onNavigate={navigate}
                  ctx={startCtx}
                  activeDeals={activeDeals}
                  onSaveCurrent={saveCurrentListing}
                  canSave={!!nav.url && panelContent.phase === "ready" && !isCurrentSaved}
                  onCompare={() => router.push("/pipeline")}
                  onReanalyze={reanalyze}
                  canReanalyze={!!nav.url && nav.isListing}
                  onManual={startManualEntry}
                  onOpenInPipeline={(id) => router.push(`/pipeline?id=${id}`)}
                />
              </>
            )}
          </div>

          {downloadToast && <DownloadToast payload={downloadToast} onDismiss={() => setDownloadToast(null)} />}
        </div>
      </div>

      {/* Panel column — full window height when open */}
      {panelOpen && (
        <>
          <div
            ref={splitterRef}
            role="separator"
              aria-orientation="vertical"
              aria-label="Resize panel"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--rv-border-mid)")}
              onMouseLeave={(e) => { if (!draggingRef.current) e.currentTarget.style.background = "transparent" }}
              className="shrink-0 h-full select-none transition-colors duration-100"
              style={{ width: SPLITTER_W, cursor: "col-resize", background: "transparent" }}
            />
            <div style={{ width: panelW, flexShrink: 0 }} className="h-full">
              <Panel
                state={panelContent}
                isSaved={isCurrentSaved}
                savedStage={currentSavedStage}
                viewStats={viewStats ?? undefined}
                pipelineAverages={pipelineAverages}
                initialScenario={currentInitialScenario}
                onScenarioChange={onScenarioChange}
                onClose={() => setPanelOpen(false)}
                onSave={saveCurrentListing}
                onReanalyze={reanalyze}
                onStartManualEntry={startManualEntry}
                onSubmitManualEntry={submitManualEntry}
                onCancelManualEntry={cancelManualEntry}
                chatMessages={activeChat}
                chatLoading={chatLoading}
                chatContext={chatContext}
                onChatSend={onChatSend}
                onChatClear={onChatClear}
              />
            </div>
          </>
        )}
    </div>
  )
}

// ── Start screen ──────────────────────────────────────────────────────────────

const SUGGESTED = [
  { label: "Zillow",      url: "https://www.zillow.com",          desc: "Browse MLS listings" },
  { label: "Redfin",      url: "https://www.redfin.com",          desc: "Agent-assisted deals" },
  { label: "Realtor.com", url: "https://www.realtor.com",         desc: "NAR data feed" },
  { label: "LoopNet",     url: "https://www.loopnet.com",         desc: "Commercial properties" },
  { label: "Crexi",       url: "https://www.crexi.com",           desc: "CRE marketplace" },
  { label: "MLS",         url: "https://www.homes.com",           desc: "Direct MLS data" },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

/** Buddy observation — one substantive line under the greeting.
 *  This is what a partner would say glancing at your pipeline over
 *  morning coffee. NOT a stat strip ("3 watching · 2 interested") —
 *  a real noticing ("Two of your watching deals haven't moved in a
 *  week"). One observation per visit, picked from a priority order
 *  so the most interesting truth always wins.
 *
 *  Returns plain text. Calling code wraps in display serif so the
 *  observation reads as the buddy's voice, not a system label. */
function buddyObservation(activeDeals: SavedDeal[], ctx: StartScreenContext | null): string {
  const empty = activeDeals.length === 0

  // First-time / empty pipeline — invitation, not data.
  if (empty) {
    const lines = [
      "Open a listing and I'll start the math.",
      "Nothing in your pipeline yet — let's find the first one.",
      "Drop any Zillow or Redfin URL in the bar above. I'll do the rest.",
    ]
    return lines[Math.floor(Math.random() * lines.length)]
  }

  // Stale watching — most actionable observation, surface first.
  const stale = ctx?.pipeline?.staleWatching ?? 0
  if (stale > 0) {
    return stale === 1
      ? "One of your watching deals hasn't moved in over a week."
      : `${stale} of your watching deals haven't moved in over a week.`
  }

  // Recent activity — fresh saves are a good signal.
  const recentSaves = ctx?.pipeline?.savedThisWeek ?? 0
  if (recentSaves >= 3) {
    return `You've saved ${recentSaves} listings this week. Want to compare them?`
  }
  if (recentSaves === 0 && activeDeals.length > 0) {
    // Quiet week — gentle nudge.
    const newest = activeDeals.reduce((a, b) =>
      new Date(a.created_at).getTime() > new Date(b.created_at).getTime() ? a : b
    )
    const days = Math.floor((Date.now() - new Date(newest.created_at).getTime()) / 86400000)
    if (days >= 7) {
      return days >= 14
        ? `It's been ${days} days since your last save. Quiet stretch.`
        : "Quiet week so far — nothing new in your pipeline since last weekend."
    }
  }

  // Cash flow story — calm portfolio observation.
  const cf = activeDeals.map((d) => d.snapshot?.metrics?.monthlyCashFlow).filter((n): n is number => Number.isFinite(n))
  if (cf.length >= 2) {
    const positive = cf.filter((n) => n > 0).length
    const total    = cf.length
    if (positive === total)  return "Every deal in your pipeline cash flows positive."
    if (positive === 0)      return "None of your saved deals cash flow positive yet — worth filtering by your defaults."
  }

  // Watching count — neutral fallback.
  const watching = ctx?.pipeline?.watchingCount ?? 0
  if (watching > 0) {
    return watching === 1
      ? "One deal in Watching. Quiet day."
      : `${watching} deals in Watching. Calm in here today.`
  }

  // Generic friendly fallback — never says nothing.
  return "Welcome back."
}

/** Best-effort first name from a Supabase user. Tries OAuth metadata first
 *  (Google/Apple sign-in usually populate `given_name` or `full_name`),
 *  then falls back to the email's local part split on a separator. Returns
 *  null when there's nothing usable — the greeting stays unnamed instead
 *  of showing something awkward like a full corporate-prefix string. */
function extractFirstName(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): string | null {
  if (!user) return null
  const meta = user.user_metadata ?? {}
  const cap  = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  const given = (meta.given_name ?? meta.first_name) as string | undefined
  if (typeof given === "string" && given.trim()) return cap(given.trim().split(/\s+/)[0])
  const full = (meta.full_name ?? meta.name) as string | undefined
  if (typeof full === "string" && full.trim()) return cap(full.trim().split(/\s+/)[0])
  // Email fallback — only safe when the local part splits cleanly on a
  // separator (period / underscore / dash). For "elisha.merel@..." this
  // gives "Elisha". For an unbroken local part like "elishamerel@..."
  // we'd be guessing where the name ends, so we skip and stay unnamed.
  const email = user.email ?? ""
  const local = email.split("@")[0] ?? ""
  if (!local) return null
  const parts = local.split(/[._\-+]/).filter(Boolean)
  if (parts.length >= 2 && /^[a-zA-Z]+$/.test(parts[0])) return cap(parts[0])
  return null
}

/** Day-of-week / time-of-day aware subtitle — feels like a work buddy.
 *  When the user has browse history or saved deals, weave that signal in.
 *  When the slate is empty, fall back to time/day variations. */
function subhead(ctx: StartScreenContext | null) {
  const now    = new Date()
  const day    = now.getDay()                 // 0 = Sun
  const hour   = now.getHours()
  const isMon  = day === 1
  const isFri  = day === 5
  const isWknd = day === 0 || day === 6
  const isLate = hour >= 20 || hour < 6
  const isVeryLate = hour >= 1 && hour < 5

  // Pick from variations randomly so it doesn't feel scripted on revisits
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]

  // Pipeline-aware variants take priority when there's a real signal.
  // We don't repeat the observation card content — these are flavor lines.
  if (ctx) {
    const { activeCount, watchingCount } = ctx.pipeline
    const recents = ctx.recentListings.length

    if (isVeryLate && activeCount > 0) return pick([
      "Late lap on the pipeline?",
      "Numbers don't sleep, apparently.",
    ])
    if (isMon && hour < 12 && activeCount > 0) return pick([
      `${activeCount} on deck this week. Where to?`,
      "Fresh week. Pick one off the pile.",
    ])
    if (isFri && hour >= 14 && watchingCount > 0) return pick([
      "Anything to lock in before the weekend?",
      "Closing thoughts on a deal you've been eyeing?",
    ])
    if (recents > 0 && activeCount === 0) return pick([
      "You've been browsing — anything worth saving?",
      "Want to lock in something you saw?",
    ])
  }

  if (isVeryLate)            return pick([
    "It's late. You sure about this one?",
    "Burning the midnight oil on a deal?",
    "Whatever you're looking at better cash flow.",
  ])
  if (isMon && hour < 12)    return pick([
    "Fresh week. What's on your radar?",
    "Monday energy. Find me something good.",
    "New week, new comps.",
  ])
  if (isFri && hour >= 14)   return pick([
    "Closing thoughts before the weekend?",
    "Friday reflection — anything to lock in?",
    "One more before you log off?",
  ])
  if (isWknd)                return pick([
    "Quiet day to dig into a deal.",
    "Weekend warrior mode. Let's underwrite.",
    "No comps Sunday. (Just kidding, paste away.)",
  ])
  if (isLate)                return pick([
    "Late-night underwriting, eh? Let's go.",
    "Numbers don't sleep. Apparently neither do you.",
  ])
  if (hour < 12)             return pick([
    "Open any listing and I'll do the math.",
    "Drop a URL, I'll tell you if it's any good.",
    "What're we looking at this morning?",
  ])
  if (hour < 17)             return pick([
    "Got a property in mind? Drop it in.",
    "Show me something interesting.",
    "Paste a listing — I'll handle the boring parts.",
  ])
  return pick([
    "Anything you saw today worth a closer look?",
    "End-of-day deal? Drop it in.",
    "One more lap before dinner?",
  ])
}

/** Cache + fetch the AI-generated greeting line for today.
 *
 *  Shape: localStorage[ "rv-ai-greeting" ] = { day, line }. Day is the
 *  local date as YYYY-MM-DD so the line refreshes across midnight rather
 *  than across UTC midnight. If the AI call fails we DON'T cache — that
 *  way the next mount tries again instead of silently using a stale fallback.
 */
// Bump the version suffix any time the prompt or context shape changes
// so that today's cached line gets refreshed immediately instead of
// serving the previous prompt's output until tomorrow.
const GREETING_CACHE_KEY = "rv-ai-greeting-v2"
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
async function resolveGreeting(ctx: StartScreenContext): Promise<string | null> {
  if (typeof window === "undefined") return null
  const api = window.electronAPI
  if (!api?.generateGreeting) return null

  // Try cached for today first.
  try {
    const raw = localStorage.getItem(GREETING_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { day?: string; line?: string }
      if (parsed.day === todayKey() && parsed.line && typeof parsed.line === "string") {
        return parsed.line
      }
    }
  } catch { /* fall through to fetch */ }

  // Build the compact context payload. Recent listings get trimmed to a
  // few items + just the address/site so the prompt stays small.
  const now = new Date()
  const payload = {
    hour:        now.getHours(),
    dayOfWeek:   now.getDay(),
    isWeekend:   now.getDay() === 0 || now.getDay() === 6,
    recentListings: ctx.recentListings.slice(0, 4).map((r) => ({
      address:   r.address,
      siteName:  r.site_name,
      visitedAt: r.visited_at,
    })),
    pipeline: ctx.pipeline,
  }

  try {
    const res = await api.generateGreeting(payload)
    if (res?.ok && res.line) {
      try {
        localStorage.setItem(GREETING_CACHE_KEY, JSON.stringify({ day: todayKey(), line: res.line }))
      } catch { /* quota / private mode — fine */ }
      return res.line
    }
  } catch { /* IPC failed */ }
  return null
}

/** Subhead that types itself in character-by-character on mount.
 *  Cursor blinks subtly while typing, fades out when done. */
function TypingSubhead({ text, className, animate = true, style }: { text: string; className?: string; animate?: boolean; style?: React.CSSProperties }) {
  // When animate is false (subsequent mounts in the same session), render the
  // full text immediately and skip the cursor — no point replaying the
  // character-by-character cascade every time the user navigates back to
  // /browse from /pipeline or /settings.
  const [shown, setShown] = useState<string>(animate ? "" : text)
  const [done,  setDone]  = useState<boolean>(!animate)

  useEffect(() => {
    if (!animate) { setShown(text); setDone(true); return }
    let i = 0
    let raf = 0
    let lastTick = performance.now()
    const STEP = 22  // ms between characters

    function tick(now: number) {
      if (now - lastTick >= STEP) {
        i++
        lastTick = now
        setShown(text.slice(0, i))
      }
      if (i < text.length) raf = requestAnimationFrame(tick)
      else setTimeout(() => setDone(true), 450)
    }
    // Start typing after the staggered fade-in finishes (~80ms)
    const startDelay = setTimeout(() => { raf = requestAnimationFrame(tick) }, 80)
    return () => { clearTimeout(startDelay); cancelAnimationFrame(raf) }
  }, [text, animate])

  return (
    <p
      className={className}
      style={{
        color:         "var(--rv-t3)",
        letterSpacing: "-0.005em",
        minHeight:     "1.4em",
        ...style,
      }}
    >
      {shown}
      <span
        aria-hidden
        style={{
          display:        "inline-block",
          width:          1,
          height:         "1em",
          marginLeft:     2,
          verticalAlign:  "-0.13em",
          background:     "var(--rv-t2)",
          opacity:        done ? 0 : 1,
          animation:      done ? "none" : "rv-cursor-blink 1.05s steps(1, end) infinite",
          transition:     "opacity 350ms ease-out",
        }}
      />
    </p>
  )
}

// ── Dashboard primitives + cards ─────────────────────────────────────────
//
// Lifted from Mercury's dashboard pattern. DashboardCard is the primitive
// shell — every workstation-mode card uses it. Specific card components
// (PipelineDashCard, MarketDashCard, SinceLastLookCard, QuickSearchesCard)
// compose DashboardCard with their own header + body content.

// ── HeroStatsStrip — Modulix / Finexy hero pattern ────────────────────────
//
// Four cards across the top of the workstation, each with the big confident
// number treatment: muted uppercase label, bold tabular value (28-32px), an
// optional trend chip below. This is the visual hero of the start screen.
// Every reference (Modulix Pending Orders 219, Finexy Total Earnings $950,
// Sapphire Students 16,892) opens this way — the user's portfolio numbers
// dominate the page before anything else.

function HeroStatsStrip({
  activeDeals, ctx,
}: {
  activeDeals: SavedDeal[]
  ctx:         StartScreenContext | null
}) {
  const stats = useMemo(() => {
    let exposure = 0
    let cashFlowSum = 0
    let cashFlowCount = 0
    let capSum = 0
    let capCount = 0
    for (const d of activeDeals) {
      if (typeof d.list_price === "number" && Number.isFinite(d.list_price)) exposure += d.list_price
      const m = d.snapshot?.metrics
      if (m && Number.isFinite(m.monthlyCashFlow)) { cashFlowSum += m.monthlyCashFlow; cashFlowCount++ }
      if (m && Number.isFinite(m.capRate))         { capSum      += m.capRate;         capCount++ }
    }
    return {
      active:      activeDeals.length,
      exposure:    exposure || null,
      avgCashFlow: cashFlowCount > 0 ? cashFlowSum / cashFlowCount : null,
      avgCap:      capCount      > 0 ? capSum      / capCount      : null,
    }
  }, [activeDeals])

  const fmtCompactCurrency = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
    return `$${Math.round(n).toLocaleString()}`
  }
  const fmtCash = (n: number) =>
    `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString()}`

  const savedThisWeek = ctx?.pipeline?.savedThisWeek ?? 0
  const watchingCount = ctx?.pipeline?.watchingCount ?? 0

  return (
    <div className="grid grid-cols-4 gap-3 mt-4">
      <HeroStatCard
        label="Active deals"
        value={String(stats.active)}
        sub={watchingCount > 0 ? `${watchingCount} watching` : undefined}
        trend={savedThisWeek > 0
          ? { text: `+${savedThisWeek} this week`, tone: "pos" }
          : null}
      />
      <HeroStatCard
        label="Total exposure"
        value={stats.exposure != null ? fmtCompactCurrency(stats.exposure) : "—"}
        sub={stats.exposure != null ? "across pipeline" : undefined}
        trend={null}
      />
      <HeroStatCard
        label="Avg cash flow"
        value={stats.avgCashFlow != null
          ? `${fmtCash(stats.avgCashFlow)}`
          : "—"}
        valueSuffix="/mo"
        tone={stats.avgCashFlow != null && stats.avgCashFlow < 0 ? "neg" : "neutral"}
        sub="across saved deals"
        trend={null}
      />
      <HeroStatCard
        label="Avg cap rate"
        value={stats.avgCap != null ? `${(stats.avgCap * 100).toFixed(2)}%` : "—"}
        sub="weighted mean"
        trend={null}
      />
    </div>
  )
}

function HeroStatCard({
  label, value, valueSuffix, sub, trend, tone = "neutral",
}: {
  label:        string
  value:        string
  /** Tiny suffix appended after the main value at smaller weight (e.g. "/mo"). */
  valueSuffix?: string
  sub?:         string
  trend:        { text: string; tone: "pos" | "neg" | "neutral" } | null
  tone?:        "neg" | "neutral"
}) {
  const valueColor = tone === "neg" ? "var(--rv-neg)" : "var(--rv-t1)"
  const trendColor =
    trend?.tone === "pos" ? "var(--rv-pos)" :
    trend?.tone === "neg" ? "var(--rv-neg)" :
                            "var(--rv-t4)"
  return (
    <div
      className="rounded-[14px] flex flex-col"
      style={{
        padding:    "16px 18px 18px",
        background: "var(--rv-elev-3)",
        border:     "0.5px solid var(--rv-border-mid)",
        boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 20px rgba(0,0,0,0.36)",
      }}
    >
      <p
        className="text-[10px] uppercase tracking-widest font-medium"
        style={{ color: "var(--rv-t4)" }}
      >
        {label}
      </p>
      <div className="flex items-baseline gap-1 mt-3">
        <span
          className="tabular-nums leading-none"
          style={{
            color:         valueColor,
            fontSize:      32,
            letterSpacing: "-0.025em",
            fontFamily:    "var(--rv-font-display)",
            fontWeight:    500,
          }}
        >
          {value}
        </span>
        {valueSuffix && (
          <span
            className="font-medium tabular-nums"
            style={{ color: "var(--rv-t4)", fontSize: 12 }}
          >
            {valueSuffix}
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between mt-2.5 gap-2 min-h-[14px]">
        {sub && (
          <span className="text-[11px] truncate" style={{ color: "var(--rv-t3)" }}>
            {sub}
          </span>
        )}
        {trend && (
          <span
            className="text-[11px] tracking-tight tabular-nums shrink-0 ml-auto"
            style={{ color: trendColor }}
          >
            {trend.text}
          </span>
        )}
      </div>
    </div>
  )
}

function DashboardCard({
  title, action, children, className,
}: {
  title:    string
  action?:   React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-[14px] flex flex-col ${className ?? ""}`}
      style={{
        background: "var(--rv-elev-3)",
        border:     "0.5px solid var(--rv-border-mid)",
        boxShadow:  "inset 0 1px 0 rgba(255,255,255,0.07), 0 6px 20px rgba(0,0,0,0.36)",
      }}
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <p
          className="text-[9.5px] uppercase tracking-widest font-medium"
          style={{ color: "var(--rv-t4)" }}
        >
          {title}
        </p>
        {action}
      </div>
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  )
}

/** Action button row — Mercury's Send/Transfer/Deposit/Request/Upload bill
 *  pattern. Primary action filled in accent (the only place forest green
 *  appears on the screen); secondary actions are neutral pills. */
function ActionButtonRow({
  onSaveCurrent, canSave,
  onCompare,
  onReanalyze, canReanalyze,
  onManual,
}: {
  onSaveCurrent?: () => void
  canSave?:       boolean
  onCompare?:     () => void
  onReanalyze?:   () => void
  canReanalyze?:  boolean
  onManual?:      () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={canSave ? onSaveCurrent : undefined}
        disabled={!canSave}
        className="inline-flex items-center gap-1.5 rounded-full text-[12.5px] font-medium tracking-tight transition-all duration-100 disabled:cursor-default"
        style={{
          padding:    "7px 14px",
          color:      canSave ? "#0a0a0c" : "var(--rv-t4)",
          background: canSave ? "var(--rv-accent)" : "var(--rv-elev-2)",
          border:     "0.5px solid transparent",
          opacity:    canSave ? 1 : 0.55,
        }}
        onMouseEnter={(e) => { if (canSave) e.currentTarget.style.transform = "scale(1.02)" }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)" }}
        title={canSave ? "Save the current listing to Watching (⌘S)" : "Open a listing first to save it"}
      >
        <Bookmark size={12} strokeWidth={2.2} />
        Save current
      </button>
      <ActionPill onClick={onCompare} icon={<GitCompareArrows size={11} strokeWidth={2} />} title="Compare deals in your pipeline">
        Compare
      </ActionPill>
      <ActionPill onClick={canReanalyze ? onReanalyze : undefined} disabled={!canReanalyze} icon={<RefreshCw size={11} strokeWidth={2} />} title={canReanalyze ? "Re-run analysis on the current listing" : "Open a listing first"}>
        Re-analyze
      </ActionPill>
      <ActionPill onClick={onManual} icon={<FilePlus size={11} strokeWidth={2} />} title="Enter listing facts manually">
        Add manually
      </ActionPill>
    </div>
  )
}

function ActionPill({
  onClick, disabled, icon, children, title,
}: {
  onClick?:  () => void
  disabled?: boolean
  icon?:     React.ReactNode
  children:  React.ReactNode
  title?:    string
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full text-[12px] font-medium tracking-tight transition-colors disabled:cursor-default"
      style={{
        padding:    "6px 12px",
        color:      "var(--rv-t2)",
        background: "var(--rv-elev-2)",
        border:     "0.5px solid var(--rv-border)",
        opacity:    disabled ? 0.45 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.background = "var(--rv-elev-3)"
        e.currentTarget.style.color      = "var(--rv-t1)"
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        e.currentTarget.style.background = "var(--rv-elev-2)"
        e.currentTarget.style.color      = "var(--rv-t2)"
      }}
    >
      {icon}
      {children}
    </button>
  )
}

/** PipelineDashCard — Mercury "Mercury balance" + "Accounts" card energy.
 *  Header is the section label + "N active" count + small "View all"
 *  link. Body is a list of deal rows. Each row has the brand logo, the
 *  address/price, and the cash-flow signal — clicking takes the user to
 *  the Pipeline detail view (NOT to the listing URL — Pipeline has its
 *  own "View listing" button for that). */
function PipelineDashCard({
  deals, onOpenInPipeline,
}: {
  deals:            SavedDeal[]
  onOpenInPipeline: (dealId: string) => void
}) {
  return (
    <DashboardCard
      title={`Your pipeline · ${deals.length} active`}
      action={
        <button
          onClick={() => onOpenInPipeline("")}
          className="text-[11px] tracking-tight transition-colors"
          style={{ color: "var(--rv-t3)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t1)" }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t3)" }}
          title="Open the full Pipeline view"
        >
          View all →
        </button>
      }
    >
      <div className="flex flex-col">
        {deals.map((deal, i) => {
          const cashFlow = deal.snapshot?.metrics?.monthlyCashFlow ?? null
          const address  = [deal.address, deal.city].filter(Boolean).join(", ") || (deal.site_name ?? "Saved listing")
          const cashColor = cashFlow == null
            ? "var(--rv-t4)"
            : cashFlow < 0 ? "var(--rv-neg)" : "var(--rv-t2)"
          return (
            <button
              key={deal.id}
              onClick={() => onOpenInPipeline(deal.id)}
              className="group flex items-center gap-4 px-5 text-left"
              style={{
                paddingTop:    14,
                paddingBottom: 14,
                background:    "transparent",
                borderTop:     "0.5px solid var(--rv-border)",
                transition:    "background 100ms",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-3)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
              title="Open in Pipeline"
            >
              <SourceMark source="listing" siteName={deal.site_name} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate leading-tight" style={{ color: "var(--rv-t1)" }}>
                  {address}
                </p>
                {deal.list_price != null && (
                  <p className="text-[11.5px] tabular-nums leading-tight mt-0.5" style={{ color: "var(--rv-t3)" }}>
                    <Currency value={deal.list_price} whole />
                  </p>
                )}
              </div>
              {cashFlow != null && (
                <div className="shrink-0 text-right">
                  <span
                    className="tabular-nums font-bold"
                    style={{ color: cashColor, fontSize: 18, letterSpacing: "-0.025em" }}
                  >
                    <Currency value={cashFlow} signed />
                  </span>
                  <span className="block text-[9.5px] tracking-wide" style={{ color: "var(--rv-t4)" }}>/mo</span>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </DashboardCard>
  )
}

/** MarketDashCard — Mercury rate ticker. Today shows just the 30Y from
 *  FRED; future-proof to add 10Y/7Y as additional rows. */
function MarketDashCard() {
  const [rate, setRate] = useState<{ rate: number; asOf: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    window.electronAPI?.getMortgageRate?.().then((r) => {
      if (cancelled || !r.ok) return
      setRate({ rate: r.rate, asOf: r.asOf })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const asOf = rate ? new Date(rate.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null

  return (
    <DashboardCard title="30-yr fixed">
      <div className="flex flex-col px-5 pb-4" style={{ gap: 4 }}>
        <span
          className="tabular-nums font-bold leading-none"
          style={{ color: "var(--rv-t1)", fontSize: 28, letterSpacing: "-0.03em" }}
        >
          {rate ? `${rate.rate.toFixed(2)}%` : "—"}
        </span>
        <p className="text-[10.5px]" style={{ color: "var(--rv-t4)" }}>
          {asOf ? `${asOf} · FRED` : "Loading…"}
        </p>
      </div>
    </DashboardCard>
  )
}

/** SinceLastLookCard — placeholder for now. Real wiring (rate deltas,
 *  DOM changes on watching deals, status flips) is a follow-up that
 *  needs runWatchChecks integration. Today shows a calm "All caught up"
 *  state that doesn't lie about having data we don't have. */
function SinceLastLookCard({ activeDeals }: { activeDeals: SavedDeal[] }) {
  // Best-effort: derive simple signals from what we already have on hand.
  // Real watch-check integration comes in the next round.
  const items: { dot: string; text: string }[] = []
  if (activeDeals.length > 0) {
    const stale = activeDeals.filter((d) => {
      const age = Date.now() - new Date(d.updated_at).getTime()
      return age > 7 * 86400000  // > 1 week
    })
    if (stale.length > 0) {
      items.push({
        dot: "var(--rv-warn)",
        text: stale.length === 1
          ? `1 watching deal idle for over a week`
          : `${stale.length} watching deals idle for over a week`,
      })
    }
  }
  if (items.length === 0) {
    items.push({ dot: "var(--rv-t4)", text: "All caught up — nothing changed since you last looked." })
  }

  return (
    <DashboardCard title="Since you last looked">
      <div className="flex flex-col gap-2.5 px-5 pb-4">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span
              className="mt-[6px] shrink-0 rounded-full"
              style={{ width: 5, height: 5, background: it.dot }}
            />
            <span className="text-[12.5px] leading-relaxed" style={{ color: "var(--rv-t2)" }}>
              {it.text}
            </span>
          </div>
        ))}
      </div>
    </DashboardCard>
  )
}

/** QuickSearchesCard — pre-seeded saved-search shortcuts. Each one is a
 *  label + URL template that opens a pre-filtered Zillow search in the
 *  embedded browser. Stored in localStorage for now (settings-managed
 *  later). Pre-seed with sensible defaults if empty. */
interface QuickSearch { id: string; label: string; url: string }

function QuickSearchesCard({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [items, setItems] = useState<QuickSearch[]>([])
  useEffect(() => {
    try {
      const raw = localStorage.getItem("rv-quick-searches")
      if (raw) {
        const parsed = JSON.parse(raw) as QuickSearch[]
        if (Array.isArray(parsed) && parsed.length > 0) { setItems(parsed); return }
      }
    } catch {}
    // Default seed — useful templates derived from common investor queries.
    const seeded: QuickSearch[] = [
      { id: "1", label: "Reno SFH < $500k",   url: "https://www.zillow.com/homes/Reno,-NV_rb/" },
      { id: "2", label: "Vegas duplex",        url: "https://www.zillow.com/homes/Las-Vegas,-NV_rb/" },
      { id: "3", label: "Phoenix triplex",     url: "https://www.zillow.com/homes/Phoenix,-AZ_rb/" },
    ]
    setItems(seeded)
    try { localStorage.setItem("rv-quick-searches", JSON.stringify(seeded)) } catch {}
  }, [])

  return (
    <DashboardCard title="Quick searches">
      <div className="flex flex-col gap-1 px-3 pb-3">
        {items.map((q) => (
          <button
            key={q.id}
            onClick={() => onNavigate(q.url)}
            className="text-left rounded-[7px] px-2 py-1.5 transition-colors text-[12.5px]"
            style={{ color: "var(--rv-t1)", background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-2)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
          >
            {q.label}
          </button>
        ))}
      </div>
    </DashboardCard>
  )
}

function StartScreen({
  onNavigate,
  ctx,
  activeDeals,
  onSaveCurrent,
  canSave,
  onCompare,
  onReanalyze,
  canReanalyze,
  onManual,
  onOpenInPipeline,
}: {
  onNavigate: (url: string) => void
  ctx: StartScreenContext | null
  /** User's active saved deals (Watching/Interested/Offered), newest first.
   *  Surfaced as the visual centerpiece so the start screen reads as the
   *  user's own workstation instead of a generic launcher. */
  activeDeals: SavedDeal[]
  /** Action button row — Mercury-style dashboard top strip. Each handler
   *  is optional + gated by its `can*` flag. */
  onSaveCurrent?: () => void
  canSave?:       boolean
  onCompare?:     () => void
  onReanalyze?:   () => void
  canReanalyze?:  boolean
  onManual?:      () => void
  /** Open a saved deal in the Pipeline detail view (not the embedded
   *  browser). The Pipeline page already has its own "View listing"
   *  button for opening the source URL, so clicking a row in the
   *  start-screen Pipeline card should take the user to manage that
   *  deal, not navigate the embed. */
  onOpenInPipeline?: (dealId: string) => void
}) {
  // Greeting + subhead are stable once chosen — picked from the context
  // bundle when it arrives, then frozen for the lifetime of this mount.
  // The subhead aspires to be Haiku-generated once per day; if AI fails
  // or no key is set, falls back to the rules-based variant.
  const [greet, setGreet] = useState<string>("")
  const [sub,   setSub]   = useState<string>("")
  // Pulled from auth so the greeting can address the user by first name
  // ("Good evening, Eli"). Nullable — falls back to the bare greeting
  // when not signed in or when no name can be inferred from metadata.
  const [firstName, setFirstName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient()
      supabase.auth.getUser().then(({ data }) => {
        if (cancelled) return
        setFirstName(extractFirstName(data.user))
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (greet) return
    setGreet(greeting())
    // Provide an immediate rules-based subhead so the start screen never
    // shows blank text. Haiku's response (when it lands) replaces it.
    setSub(subhead(ctx))
    if (!ctx) return
    void resolveGreeting(ctx).then((line) => { if (line) setSub(line) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx])

  // Compose the displayed greeting. Adds the first name when we have one.
  const greetWithName = greet
    ? (firstName ? `${greet}, ${firstName}` : greet)
    : ""

  // Skip the staggered intro animations on every remount within the same
  // session. The first paint after launch gets the full cascade; navigating
  // back from /pipeline or /settings should feel instant, not replay the
  // 600ms entrance every time. The flag lives at module scope so it
  // persists across mounts.
  const playIntro = !_startScreenIntroPlayed
  useEffect(() => {
    if (!_startScreenIntroPlayed) _startScreenIntroPlayed = true
  }, [])
  const introCls = (cls: string) => playIntro ? cls : ""

  const observation = ctx ? buildObservation(ctx) : null
  const recents     = ctx?.recentListings ?? []
  // First-time signal: zero recent listings AND zero pipeline activity.
  // First-time gets the centered welcome layout (greeting + onboarding).
  // Everyone else gets the workstation layout — the user's actual data
  // takes over the surface, and the greeting hero sits above it.
  const isFirstTime =
    !!ctx &&
    ctx.recentListings.length === 0 &&
    ctx.pipeline.activeCount === 0 &&
    ctx.pipeline.savedThisWeek === 0

  // Workstation mode kicks in when there's any signal (deals or recents).
  // We ALSO use a localStorage hint from the previous mount so we don't
  // flash the centered welcome layout on every navigation back to /browse
  // while ctx is still loading. The hint is best-effort — once ctx loads
  // it takes over as the source of truth.
  const hasData = activeDeals.length > 0 || recents.length > 0
  const [layoutHint, setLayoutHint] = useState<"workstation" | "welcome" | null>(null)
  useEffect(() => {
    try {
      const v = localStorage.getItem("rv-start-layout")
      if (v === "workstation" || v === "welcome") setLayoutHint(v)
    } catch { /* localStorage unavailable */ }
  }, [])
  // Persist the resolved layout for the next mount — this is what kills
  // the one-frame flash when the user re-enters /browse from another page.
  useEffect(() => {
    if (!ctx) return
    const resolved = isFirstTime ? "welcome" : (hasData ? "workstation" : "welcome")
    try { localStorage.setItem("rv-start-layout", resolved) } catch {}
  }, [ctx, isFirstTime, hasData])

  // Resolved mode: ctx truth when available, else last-known hint, else
  // workstation as a safe default (matches what most return visits land in).
  const isWorkstation = ctx
    ? !isFirstTime && hasData
    : (layoutHint ?? "workstation") === "workstation"

  return (
    <div
      // Layout pivots on the user's state:
      //   - workstation mode: top-anchored, content starts near the top
      //     and reads as a dashboard
      //   - welcome / sparse: vertically centered, classic empty-state
      // Either way, content max-width is 540px so we don't sprawl on
      // wide windows.
      className={`absolute inset-0 flex flex-col items-center px-12 select-none ${introCls("rv-start-fade")} overflow-y-auto rv-invisible-scroll ${
        isWorkstation ? "justify-start pt-16" : "justify-center"
      }`}
    >
      {/* Per-screen atmospheric gradient removed — the global
          AmbientBackdrop (z-index -1) handles atmosphere everywhere now. */}

      <div className={`relative flex flex-col w-full ${
        isWorkstation
          ? "max-w-[920px] items-stretch"
          : "max-w-[560px] items-center py-10"
      }`}>
        {isWorkstation ? (
          // ── WORKSTATION MODE ─────────────────────────────────────────────
          // Layout: greeting (large) → action chips → full-width pipeline
          // section (the hero) → 3-column stat strip below. Breaking the
          // old 2×2 equal-weight card grid — the pipeline is the main thing,
          // everything else is supporting context.
          <>
            {/* Greeting + buddy observation — the personal moment. The
                greeting names you; the line below is what your buddy would
                say if they were sitting across from you, glancing at your
                pipeline. Bigger and quieter than a stat strip — this is
                supposed to feel like someone paying attention, not a
                dashboard heading. */}
            <div className={`${introCls("rv-greeting")} flex flex-col items-stretch w-full mb-10`}>
              <h1
                className="tracking-[-0.025em] leading-[1.0]"
                style={{
                  color:      "var(--rv-t1)",
                  fontSize:   52,
                  fontFamily: "var(--rv-font-display)",
                  fontWeight: 500,
                }}
              >
                {greetWithName || " "}
              </h1>
              <p
                className={`${introCls("rv-subhead")} mt-4 leading-snug`}
                style={{
                  color:      "var(--rv-t2)",
                  fontSize:   17,
                  fontFamily: "var(--rv-font-display)",
                  fontWeight: 400,
                  letterSpacing: "-0.012em",
                  maxWidth:   560,
                }}
              >
                {buddyObservation(activeDeals, ctx)}
              </p>
            </div>

            <ActionButtonRow
              onSaveCurrent={onSaveCurrent}
              canSave={canSave}
              onCompare={onCompare}
              onReanalyze={onReanalyze}
              canReanalyze={canReanalyze}
              onManual={onManual}
            />

            {/* Today feed — what changed since you last looked. Only
                renders when there's actual recent activity. Generous
                top spacing so it doesn't crowd the buddy line. */}
            <div className={`${introCls("rv-grid")} mt-2`}>
              <ActivityFeed limit={8} />
            </div>

            {/* Hero stat cards — 4 across. Constant context. Generous
                spacing for the breathable workstation feel. */}
            {activeDeals.length > 0 && (
              <div className={`${introCls("rv-grid")} mt-6`}>
                <HeroStatsStrip activeDeals={activeDeals} ctx={ctx} />
              </div>
            )}

            {/* Pipeline — full-width list. The deal list IS the content. */}
            {activeDeals.length > 0 && onOpenInPipeline && (
              <div className={`${introCls("rv-grid")} mt-6 mb-10`}>
                <PipelineDashCard deals={activeDeals} onOpenInPipeline={onOpenInPipeline} />
              </div>
            )}

            <p
              className={`${introCls("rv-hint")} mt-6 flex items-center gap-1.5 text-[11px] px-1`}
              style={{ color: "var(--rv-t4)" }}
            >
              <kbd
                className="inline-flex items-center justify-center rounded px-1 py-[1px] text-[10px] font-medium"
                style={{ background: "var(--rv-elev-3)", color: "var(--rv-t3)", minWidth: 18 }}
              >
                ⌘L
              </kbd>
              to focus URL bar
            </p>
          </>
        ) : (
          // ── WELCOME / SPARSE MODE ───────────────────────────────────────
          // Centered greeting hero. Used for first-time users and the brief
          // moment between sign-up and first save. Bigger, breathable,
          // inviting — the "first impression" surface of the whole app.
          <>
            <h1
              className={`${introCls("rv-greeting")} text-center leading-[1.0] tracking-[-0.025em]`}
              style={{
                color:      "var(--rv-t1)",
                fontSize:   54,
                fontFamily: "var(--rv-font-display)",
                fontWeight: 500,
              }}
            >
              {greetWithName || " "}
            </h1>
            {sub && (
              <TypingSubhead
                text={sub}
                className={`${introCls("rv-subhead")} mt-4 text-center leading-snug`}
                animate={playIntro}
                style={{
                  color:      "var(--rv-t2)",
                  fontSize:   17,
                  fontFamily: "var(--rv-font-display)",
                  fontWeight: 400,
                  letterSpacing: "-0.012em",
                  maxWidth:   560,
                }}
              />
            )}

            {/* First-time welcome — three concrete steps, bigger card.  */}
            {isFirstTime && (
              <div
                className="mt-10 w-full max-w-[520px] flex flex-col gap-4 rounded-[14px] px-6 py-6"
                style={{
                  background: "var(--rv-elev-2)",
                  border:     "0.5px solid var(--rv-border-mid)",
                  boxShadow:  "var(--rv-shadow-inset), var(--rv-shadow-outer-sm)",
                }}
              >
                <p
                  className="text-[10px] uppercase tracking-widest font-medium"
                  style={{ color: "var(--rv-t4)" }}
                >
                  Three steps to get rolling
                </p>
                <OnboardStep
                  n={1}
                  title="Open a listing"
                  body="Click any card below — Zillow, Redfin, Realtor — or paste a URL into the bar above. The analysis panel opens automatically."
                />
                <OnboardStep
                  n={2}
                  title="Save what's worth a second look"
                  body="Hit ⌘S or the bookmark. Saved deals land in your Watching pipeline."
                />
                <OnboardStep
                  n={3}
                  title="Run your pipeline from one place"
                  body="Open Pipeline (⌘2). See your portfolio on a map, compare side-by-side, move deals between stages."
                />
              </div>
            )}

            {/* Site shortcuts (welcome mode only) */}
            <div className="mt-8 w-full">
              <p
                className="text-[10px] uppercase tracking-widest font-medium mb-2 text-center"
                style={{ color: "var(--rv-t4)" }}
              >
                Or start from
              </p>
              <div className="flex flex-wrap items-center justify-center gap-1.5 w-full max-w-[460px] mx-auto">
                {SUGGESTED.map(({ label, url, desc }) => (
                  <button
                    key={url}
                    onClick={() => onNavigate(url)}
                    title={desc}
                    className="text-[12px] font-medium tracking-tight rounded-full transition-all duration-100"
                    style={{
                      color:      "var(--rv-t2)",
                      background: "var(--rv-elev-2)",
                      border:     "0.5px solid var(--rv-border)",
                      padding:    "5px 11px",
                      lineHeight: 1.1,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--rv-elev-4)"
                      e.currentTarget.style.color      = "var(--rv-t1)"
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--rv-elev-2)"
                      e.currentTarget.style.color      = "var(--rv-t2)"
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-7 flex flex-col items-center">
              <MortgageRateLine />
              <p
                className={`${introCls("rv-hint")} mt-3 flex items-center gap-1.5 text-[11px]`}
                style={{ color: "var(--rv-t4)" }}
              >
                <kbd
                  className="inline-flex items-center justify-center rounded px-1 py-[1px] text-[10px] font-medium"
                  style={{
                    background: "var(--rv-elev-3)",
                    color: "var(--rv-t3)",
                    minWidth: 18,
                  }}
                >
                  ⌘L
                </kbd>
                to focus URL bar
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Workstation-mode subtitle — factual one-liner derived from real data,
 *  not AI prose. Mercury's pattern: "Last login Apr 28 · 2 unread tasks."
 *  Ours: "3 watching · last save 4 days ago" or similar. */
function workstationSubtitle(activeDeals: SavedDeal[], ctx: StartScreenContext | null): string {
  const parts: string[] = []
  const counts: Partial<Record<string, number>> = {}
  for (const d of activeDeals) counts[d.stage] = (counts[d.stage] ?? 0) + 1
  if (counts.watching)  parts.push(`${counts.watching} watching`)
  if (counts.interested) parts.push(`${counts.interested} interested`)
  if (counts.offered)   parts.push(`${counts.offered} offered`)
  if (parts.length === 0 && activeDeals.length > 0) parts.push(`${activeDeals.length} active`)

  // Last save freshness — soft signal of recency.
  if (activeDeals.length > 0) {
    const newest = activeDeals.reduce((a, b) =>
      new Date(a.created_at).getTime() > new Date(b.created_at).getTime() ? a : b
    )
    const days = Math.floor((Date.now() - new Date(newest.created_at).getTime()) / 86400000)
    if (days === 0)      parts.push("last save today")
    else if (days === 1) parts.push("last save yesterday")
    else if (days < 30)  parts.push(`last save ${days}d ago`)
  }

  if (parts.length === 0) return "Welcome back."
  return parts.join(" · ")
}

/** Weekly digest card — "last 7 days, here's what happened" recap.
 *  Renders only when there's at least one event worth surfacing AND the
 *  user hasn't already dismissed this week's card.
 *
 *  Week is keyed by ISO year-week so dismissing on Wednesday keeps it
 *  hidden through Saturday and rolls over fresh on Monday. */
function WeeklyDigestCard({ onPick }: { onPick: (url: string) => void }) {
  const [digest, setDigest]    = useState<WeeklyDigest | null>(null)
  const [dismissed, setDismissed] = useState<boolean>(true) // pessimistic until we read
  const weekKey = useMemo(() => isoWeekKey(new Date()), [])

  useEffect(() => {
    let cancelled = false
    try {
      const last = localStorage.getItem("rv-digest-dismissed")
      setDismissed(last === weekKey)
    } catch { setDismissed(false) }
    fetchWeeklyDigest().then((d) => { if (!cancelled) setDigest(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [weekKey])

  const onDismiss = useCallback(() => {
    try { localStorage.setItem("rv-digest-dismissed", weekKey) } catch {}
    setDismissed(true)
  }, [weekKey])

  if (dismissed) return null
  if (!digest) return null
  // Hide entirely if there's truly nothing — saves+stageMoves+priceChanges
  // all zero, no most-viewed listing. The user shouldn't see "0 saves" as
  // a result. The observation card above can carry the load when stats
  // are sparse.
  const total = digest.saves + digest.stageMoves + digest.priceChanges
  if (total === 0 && !digest.mostViewed) return null

  const fmtCurrency = (n: number) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n)

  return (
    <div
      className="mt-7 w-full max-w-[460px] flex flex-col gap-3 rounded-[12px] px-5 py-4"
      style={{
        background: "var(--rv-elev-2)",
        border:     "0.5px solid var(--rv-border)",
      }}
    >
      <div className="flex items-center justify-between">
        <p
          className="text-[10px] uppercase tracking-widest font-medium"
          style={{ color: "var(--rv-t4)" }}
        >
          Past 7 days
        </p>
        <button
          onClick={onDismiss}
          className="text-[10px] tracking-tight transition-colors"
          style={{ color: "var(--rv-t4)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t2)" }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t4)" }}
          title="Hide for the rest of the week"
        >
          Dismiss
        </button>
      </div>

      {/* Stat row — only renders the chips that have non-zero counts */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
        {digest.saves > 0 && (
          <DigestStat n={digest.saves} label={digest.saves === 1 ? "save" : "saves"} />
        )}
        {digest.stageMoves > 0 && (
          <DigestStat n={digest.stageMoves} label={digest.stageMoves === 1 ? "move" : "moves"} />
        )}
        {digest.priceChanges > 0 && (
          <DigestStat
            n={digest.priceChanges}
            label={`${digest.priceChanges === 1 ? "price change" : "price changes"}${digest.priceDelta !== 0 ? ` · ${digest.priceDelta >= 0 ? "+" : ""}${fmtCurrency(digest.priceDelta)}` : ""}`}
          />
        )}
      </div>

      {/* Most-viewed callout */}
      {digest.mostViewed && (
        <button
          onClick={() => onPick(digest.mostViewed!.url)}
          className="flex items-center gap-2.5 rounded-[8px] px-3 py-2 text-left transition-colors mt-1"
          style={{
            background: "rgba(48,164,108,0.06)",
            border:     "0.5px solid rgba(48,164,108,0.18)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(48,164,108,0.10)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(48,164,108,0.06)" }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "var(--rv-accent)" }}
          />
          <p className="text-[12px] leading-snug flex-1 min-w-0 truncate" style={{ color: "var(--rv-t1)" }}>
            You revisited{" "}
            <span style={{ color: "var(--rv-t1)", fontWeight: 500 }}>
              {digest.mostViewed.address || prettyHostname(digest.mostViewed.url)}
            </span>{" "}
            <span style={{ color: "var(--rv-t3)" }}>
              {digest.mostViewed.count} times.
            </span>
          </p>
        </button>
      )}
    </div>
  )
}

function DigestStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="text-[20px] font-semibold tabular-nums leading-none"
        style={{ color: "var(--rv-t1)", letterSpacing: "-0.02em" }}
      >
        {n}
      </span>
      <span className="text-[11px]" style={{ color: "var(--rv-t3)" }}>
        {label}
      </span>
    </div>
  )
}

/** ISO year-week (e.g. "2026-W14") — stable identifier for "this week"
 *  that rolls over on Monday. Used to key dismissal in localStorage. */
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`
}

/** Auto-watch agent banner — surfaces when the silent background check
 *  found price changes. Click to jump to Pipeline; X to dismiss. Quiet
 *  forest-green tint so it reads as informational, not an alert. */
function WatchNoticeBanner({
  notice, onClick, onDismiss,
}: {
  notice:    { changed: number; checked: number; deltaTotal: number }
  onClick:   () => void
  onDismiss: () => void
}) {
  const fmtCurrency = (n: number) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n)
  const sign = notice.deltaTotal >= 0 ? "+" : ""
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 rounded-[8px] px-3 py-2 rv-watch-banner"
      style={{
        top:        16,
        background: "rgba(48,164,108,0.10)",
        border:     "0.5px solid rgba(48,164,108,0.22)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        maxWidth:   460,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: "var(--rv-accent)" }}
      />
      <button
        onClick={onClick}
        className="text-[12px] tracking-tight text-left flex-1 min-w-0"
        style={{ color: "var(--rv-t1)" }}
      >
        <span style={{ fontWeight: 500 }}>
          {notice.changed} of your watched deals moved
        </span>
        <span className="ml-1" style={{ color: "var(--rv-t3)" }}>
          · net {sign}{fmtCurrency(notice.deltaTotal)}
        </span>
      </button>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 inline-flex items-center justify-center rounded transition-colors"
        style={{
          width:  18,
          height: 18,
          color:  "var(--rv-t4)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t2)" }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t4)" }}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
          <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

/** Live 30-year mortgage rate from FRED. Quiet by design — single line,
 *  small text, fades away if no rate is available. The point is to give
 *  the user one ambient market data point as they sit at the start
 *  screen, not to be a dashboard widget. */
function MortgageRateLine() {
  const [rate, setRate] = useState<{ rate: number; asOf: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    window.electronAPI?.getMortgageRate?.().then((r) => {
      if (cancelled || !r.ok) return
      setRate({ rate: r.rate, asOf: r.asOf })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!rate) return null
  const asOf = new Date(rate.asOf).toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  })
  return (
    <p
      className="rv-hint mt-9 flex items-center gap-2 text-[11px] tabular-nums"
      style={{ color: "var(--rv-t4)", letterSpacing: "-0.005em" }}
      title={`30-Year Fixed Mortgage Rate · FRED PMMS · published ${rate.asOf}`}
    >
      <span style={{ color: "var(--rv-t3)" }}>30-yr fixed</span>
      <span
        className="font-semibold"
        style={{ color: "var(--rv-t1)" }}
      >
        {rate.rate.toFixed(2)}%
      </span>
      <span style={{ color: "var(--rv-t4)" }}>·</span>
      <span>{asOf}</span>
      <span style={{ color: "var(--rv-t4)" }}>·</span>
      <span className="uppercase tracking-widest" style={{ fontSize: 10 }}>FRED</span>
    </p>
  )
}

function OnboardStep({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="shrink-0 w-5 h-5 rounded-full inline-flex items-center justify-center text-[10.5px] font-semibold tabular-nums"
        style={{
          color:      "var(--rv-accent)",
          background: "rgba(48,164,108,0.12)",
          border:     "0.5px solid rgba(48,164,108,0.25)",
        }}
      >
        {n}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium leading-tight" style={{ color: "var(--rv-t1)" }}>
          {title}
        </p>
        <p className="text-[11.5px] leading-snug mt-1" style={{ color: "var(--rv-t3)" }}>
          {body}
        </p>
      </div>
    </div>
  )
}

/** Active-deals card — your actual portfolio, on the start screen. Each row
 *  shows the address, list price, and at-a-glance cash-flow signal so the
 *  user can scan the state of their pipeline without leaving Browse. Click
 *  any row to deep-link back into the listing in the embedded browser.
 *
 *  This is the single highest-leverage move away from "generic launcher"
 *  toward "your workstation" — Linear/Mercury/Cursor all lead with the
 *  user's data, not a greeting. */
function ActiveDealsCard({
  deals, onOpen,
}: {
  deals:  SavedDeal[]
  onOpen: (url: string) => void
}) {
  const fmtCurrency = (n: number | null | undefined) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    }).format(n)
  const fmtCash = (n: number | null | undefined) =>
    n == null ? null : `${n >= 0 ? "+" : ""}${fmtCurrency(n)}/mo`

  return (
    <div
      className="mt-6 w-full rounded-[12px] overflow-hidden"
      style={{
        background: "var(--rv-elev-1)",
        border:     "0.5px solid var(--rv-border)",
        // Inset highlight on the top edge — same lifted-card trick used
        // on the metric cards in the panel. Reads as a layered surface
        // instead of a darker rectangle on a darker rectangle.
        boxShadow:  "var(--rv-shadow-inset)",
      }}
    >
      <div className="flex items-baseline justify-between px-4 pt-3 pb-2.5">
        <p
          className="text-[10px] uppercase tracking-widest font-medium"
          style={{ color: "var(--rv-t4)" }}
        >
          Your pipeline
        </p>
        <span className="text-[10.5px] tabular-nums" style={{ color: "var(--rv-t4)" }}>
          {deals.length} active
        </span>
      </div>
      <div className="flex flex-col">
        {deals.map((deal) => {
          const cashFlow = deal.snapshot?.metrics?.monthlyCashFlow ?? null
          const cashStr  = fmtCash(cashFlow)
          const cashColor = cashFlow == null
            ? "var(--rv-t4)"
            : cashFlow < 0 ? "var(--rv-neg)" : "var(--rv-t2)"
          const address = deal.address
            ? [deal.address, deal.city].filter(Boolean).join(", ")
            : (deal.site_name ?? "Saved listing")

          return (
            <button
              key={deal.id}
              onClick={() => onOpen(deal.source_url)}
              className="group flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
              style={{
                background: "transparent",
                borderTop:  "0.5px solid var(--rv-border)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-2)" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
            >
              <span
                className="text-[11px] uppercase tracking-wider shrink-0 w-[68px]"
                style={{ color: "var(--rv-t4)" }}
              >
                {STAGE_LABEL[deal.stage]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] truncate leading-tight" style={{ color: "var(--rv-t1)" }}>
                  {address}
                </p>
                {deal.list_price != null && (
                  <p className="text-[10.5px] tabular-nums leading-tight mt-0.5" style={{ color: "var(--rv-t4)" }}>
                    {fmtCurrency(deal.list_price)}
                  </p>
                )}
              </div>
              {cashStr && (
                <span
                  className="text-[12px] tabular-nums shrink-0"
                  style={{ color: cashColor }}
                >
                  {cashStr}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Download toast — small floating chip at the bottom-right of the browse
 *  area. Reads the most recent download lifecycle event from the embedded
 *  browser. Three visual modes:
 *    - started:   accent-color spinner + "Downloading filename"
 *    - completed: green checkmark + "Saved filename to Downloads"
 *    - cancelled / interrupted: muted icon + "Download {state}"
 *  Auto-dismisses after a few seconds; no blocking dialogs. */
function DownloadToast({
  payload, onDismiss,
}: {
  payload:   import("@/lib/electron").DownloadState
  onDismiss: () => void
}) {
  const isDone   = payload.state === "completed"
  const isFail   = payload.state === "cancelled" || payload.state === "interrupted"
  const isActive = payload.state === "started"

  const message = isActive
    ? `Downloading ${payload.filename}`
    : isDone
      ? `Saved ${payload.filename} to Downloads`
      : `Download ${payload.state}`

  return (
    <div
      className="absolute z-30 rv-download-toast"
      style={{
        right:        16,
        bottom:       16,
        maxWidth:     320,
      }}
    >
      <div
        className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5"
        style={{
          background:     "var(--rv-toast-bg)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          border:         "0.5px solid var(--rv-border-mid)",
          boxShadow:      "var(--rv-shadow-outer-lg), var(--rv-shadow-inset)",
        }}
      >
        <span
          className="shrink-0 inline-flex items-center justify-center"
          style={{
            width:  18,
            height: 18,
            color:  isDone ? "var(--rv-pos)" : isFail ? "var(--rv-neg)" : "var(--rv-accent)",
          }}
        >
          {isActive ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="rv-download-spin">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
              <path d="M7 1.5a5.5 5.5 0 0 1 5.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : isDone ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 7.5l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          )}
        </span>
        <span
          className="flex-1 text-[12px] leading-tight truncate"
          style={{ color: "var(--rv-t1)" }}
        >
          {message}
        </span>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 inline-flex items-center justify-center rounded-[5px]"
          style={{
            width:  18,
            height: 18,
            color:  "var(--rv-t4)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t2)" }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t4)" }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/** Compact "recent listing" row — site name + address (or title) + age. */
function RecentRow({ listing, onOpen }: { listing: RecentListing; onOpen: (url: string) => void }) {
  const headline = listing.address || listing.title || prettyHostname(listing.url)
  const sub      = listing.site_name ?? prettyHostname(listing.url)
  const age      = relativeShort(listing.visited_at)

  return (
    <button
      onClick={() => onOpen(listing.url)}
      className="group flex items-center gap-3 rounded-[8px] px-3 py-2 text-left transition-all duration-100"
      style={{ background: "var(--rv-elev-2)" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rv-elev-4)" }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--rv-elev-2)" }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0 opacity-50"
        style={{ background: "var(--rv-accent)" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] truncate leading-tight" style={{ color: "var(--rv-t1)" }}>
          {headline}
        </p>
        <p className="text-[10.5px] truncate leading-tight mt-0.5" style={{ color: "var(--rv-t4)" }}>
          {sub}
        </p>
      </div>
      <span className="text-[10px] tabular-nums shrink-0" style={{ color: "var(--rv-t4)" }}>
        {age}
      </span>
    </button>
  )
}

/** Friendly hostname — strips "www.", capitalizes the brand. */
function prettyHostname(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "")
    return host
  } catch {
    return url
  }
}

/** "5m ago" / "3h" / "2d" / "Mar 4" — keep it tight. */
function relativeShort(at: string): string {
  const ms = Date.now() - new Date(at).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 60)  return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24)   return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7)   return `${day}d`
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/**
 * Pick at most ONE observation worth surfacing. Returns null when nothing
 * is interesting — better to say nothing than pad. Order matters: stronger
 * signals first. (Phase 5 of the build will swap this for a daily
 * Haiku-generated line based on the same context.)
 */
function buildObservation(ctx: StartScreenContext): string | null {
  const { activeCount, watchingCount, staleWatching, savedThisWeek } = ctx.pipeline

  if (staleWatching > 0) {
    return staleWatching === 1
      ? "1 deal in Watching for over a week. Worth a second look?"
      : `${staleWatching} deals in Watching for over a week. Want to revisit?`
  }
  if (savedThisWeek >= 3) {
    return `You've saved ${savedThisWeek} deals this week. Strong momentum.`
  }
  if (activeCount >= 5) {
    return `${activeCount} active deals in your pipeline.`
  }
  if (watchingCount === 1 && activeCount === 1) {
    return "One in Watching — your next move is up to you."
  }
  return null
}
