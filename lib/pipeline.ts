// Client-side helpers for pipeline-related Supabase tables.
//
// Used by the Browse panel (Save Deal), the Pipeline page, and the
// personalized greeting on Browse start screen. All queries assume
// the user is authenticated; RLS on the tables enforces ownership.

import { createClient } from "@/lib/supabase/client"
import type { PanelResult } from "@/lib/electron"
import type { ScenarioOverrides } from "@/lib/scenario"

// ── Cross-component change events ─────────────────────────────────────────
// Fires whenever the local pipeline state changes (save, move, re-analyze,
// delete). Components like the sidebar's "Pipeline · N" count listen to
// this so they refresh without polling.
export const DEALS_CHANGED_EVENT = "rv:deals-changed"
function dispatchDealsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DEALS_CHANGED_EVENT))
  }
}

export type DealStage = "watching" | "interested" | "offered" | "won" | "passed"

/** Color a deal's pin/dot/badge gets across every surface where it
 *  appears (map pins, list-row dots, stage chips). Defining it once here
 *  guarantees the map and the list show identical visual identity per
 *  stage — flip a row's stage in the list, the matching pin changes
 *  color in the map without coordination. Forest green family for
 *  active progress; clay for "needs attention"; muted for inactive. */
export const STAGE_COLOR: Record<DealStage, string> = {
  watching:   "#c2754a",  // clay — passive interest
  interested: "#30a46c",  // accent green — active interest
  offered:    "#2f9c69",  // pos green — committed
  won:        "#1f6f4a",  // dark green — closed
  passed:     "#666666",  // muted — out
}

export const DEAL_STAGES: DealStage[] = [
  "watching",
  "interested",
  "offered",
  "won",
  "passed",
]

export const STAGE_LABEL: Record<DealStage, string> = {
  watching:   "Watching",
  interested: "Interested",
  offered:    "Offered",
  won:        "Won",
  passed:     "Passed",
}

export interface SavedDeal {
  id:                  string
  user_id:             string
  created_at:          string
  updated_at:          string
  stage:               DealStage
  source_url:          string
  site_name:           string | null
  address:             string | null
  city:                string | null
  state:               string | null
  zip:                 string | null
  list_price:          number | null
  beds:                number | null
  baths:               number | null
  sqft:                number | null
  year_built:          number | null
  snapshot:            PanelResult
  /** User's "what if I offered $440k?" override layer. NULL = no scenario,
   *  render the snapshot. Sparse — only includes keys the user changed. */
  scenario:            ScenarioOverrides | null
  tags:                string[]
  notes:               string | null
  watching:            boolean
  last_revisited_at:   string | null
  last_reanalyzed_at:  string | null
}

export interface RecentListing {
  user_id:    string
  url:        string
  site_name:  string | null
  title:      string | null
  address:    string | null
  visited_at: string
}

// ── Save / load ────────────────────────────────────────────────────────────

interface SaveInput {
  sourceUrl: string
  result:    PanelResult
  /** Optional scenario to persist alongside the snapshot. If the user
   *  was modeling overrides on this listing before hitting Save, those
   *  ride along into the pipeline so reopening shows their alternate
   *  view immediately, not the default. NULL/omitted → no scenario. */
  scenario?: ScenarioOverrides | null
}

// Track whether the `scenario` column has been confirmed missing from
// the user's Supabase. Set on first PGRST204 response so saveDeal +
// updateDealScenario stop writing the column (and stop console-spamming)
// for the rest of the session. Apply migration 013_scenarios.sql in
// Supabase to re-enable persistence.
let _scenarioColumnMissing = false

/**
 * Save a deal to the user's pipeline at stage = "watching" by default.
 * Idempotent: if the URL is already saved for this user, returns the
 * existing row without changing stage.
 */
export async function saveDeal({ sourceUrl, result, scenario }: SaveInput): Promise<SavedDeal | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    console.warn("[pipeline] saveDeal: not signed in")
    return null
  }

  // Build the row. The `scenario` field requires migration 013 — if
  // that migration hasn't been applied to the user's Supabase, including
  // the column in the insert will fail with PGRST204. We try with it
  // first; on column-missing error, retry without it (graceful degrade).
  const baseRow = {
    user_id:    user.id,
    stage:      "watching" as const,
    source_url: sourceUrl,
    site_name:  result.siteName,
    address:    result.address,
    city:       result.city,
    state:      result.state,
    zip:        result.zip,
    list_price: result.listPrice,
    beds:       result.beds,
    baths:      result.baths,
    sqft:       result.sqft,
    year_built: result.yearBuilt,
    snapshot:   result,
    tags:       [] as string[],
  }
  const scenarioValue = scenario && Object.keys(scenario).length > 0 ? scenario : null

  // First try to fetch an existing row — if one exists, return it as-is.
  const existing = await supabase
    .from("saved_deals")
    .select("*")
    .eq("user_id", user.id)
    .eq("source_url", sourceUrl)
    .maybeSingle()

  if (existing.data) return existing.data as SavedDeal

  // Try insert with scenario field unless we already know the column
  // doesn't exist (process-wide flag from updateDealScenario).
  const tryWith = !_scenarioColumnMissing
  const rowToInsert = tryWith ? { ...baseRow, scenario: scenarioValue } : baseRow

  let { data, error } = await supabase
    .from("saved_deals")
    .insert(rowToInsert)
    .select()
    .single()

  // If the scenario column is missing on this Supabase, retry without it.
  // Migration 013_scenarios.sql adds the column; until then, scenarios
  // work in memory but don't persist (already handled in updateDealScenario).
  if (error && error.code === "PGRST204" && tryWith) {
    _scenarioColumnMissing = true
    console.warn(
      "[pipeline] saveDeal: scenario column missing — retrying without it. Apply supabase/migrations/013_scenarios.sql to enable persistence."
    )
    const retry = await supabase
      .from("saved_deals")
      .insert(baseRow)
      .select()
      .single()
    data  = retry.data
    error = retry.error
  }

  if (error) {
    console.error("[pipeline] saveDeal insert error:", error)
    return null
  }

  // Fire-and-forget activity event for the feed / greeting context.
  void supabase.from("deal_events").insert({
    user_id: user.id,
    deal_id: data.id,
    kind:    "saved",
    payload: { stage: "watching", site_name: result.siteName },
  })

  dispatchDealsChanged()
  return data as SavedDeal
}

/** Personal benchmarks computed from the user's saved deals — feeds the
 *  panel's "vs your saves" line so every analysis is contextualized
 *  against THIS user's actual portfolio, not generic thresholds. */
export interface PipelineAverages {
  /** Number of deals contributing to the averages. The "vs" line only
   *  renders when this is >= 2 — single-sample averages are noisy and
   *  don't read as benchmarks. */
  count:           number
  avgCashFlow:     number | null
  avgCapRate:      number | null
  avgDscr:         number | null
}

export function computePipelineAverages(deals: SavedDeal[]): PipelineAverages {
  // Only count Watching/Interested/Offered/Won deals — Passed deals
  // were rejected and dragging them into the average is misleading.
  const eligible = deals.filter((d) => d.stage !== "passed")
  const cashFlows: number[] = []
  const capRates:  number[] = []
  const dscrs:     number[] = []
  for (const d of eligible) {
    const m = d.snapshot?.metrics
    if (!m) continue
    if (Number.isFinite(m.monthlyCashFlow)) cashFlows.push(m.monthlyCashFlow)
    if (Number.isFinite(m.capRate))         capRates.push(m.capRate)
    if (Number.isFinite(m.dscr))            dscrs.push(m.dscr)
  }
  const mean = (xs: number[]) => xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length
  return {
    count:       eligible.length,
    avgCashFlow: mean(cashFlows),
    avgCapRate:  mean(capRates),
    avgDscr:     mean(dscrs),
  }
}

/** All of the user's saved deals, newest-first. */
export async function fetchPipeline(): Promise<SavedDeal[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("saved_deals")
    .select("*")
    .order("created_at", { ascending: false })
  if (error) {
    console.error("[pipeline] fetchPipeline error:", error)
    return []
  }
  return (data ?? []) as SavedDeal[]
}

/** Map of source_url → SavedDeal for the current user. Used by Browse to
 *  render the "Saved · <stage>" chip without an extra round-trip per nav. */
export async function fetchSavedByUrl(): Promise<Record<string, SavedDeal>> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("saved_deals")
    .select("*")
  if (error) {
    console.error("[pipeline] fetchSavedByUrl error:", error)
    return {}
  }
  const map: Record<string, SavedDeal> = {}
  for (const d of (data ?? []) as SavedDeal[]) {
    map[d.source_url] = d
  }
  return map
}

// ── Stage / mutate ─────────────────────────────────────────────────────────

export async function moveDealStage(dealId: string, stage: DealStage): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  // Read previous stage so we can capture it in the event payload.
  const prev = await supabase
    .from("saved_deals")
    .select("stage")
    .eq("id", dealId)
    .single()

  const { error } = await supabase
    .from("saved_deals")
    .update({ stage })
    .eq("id", dealId)
  if (error) {
    console.error("[pipeline] moveDealStage error:", error)
    return false
  }
  void supabase.from("deal_events").insert({
    user_id: user.id,
    deal_id: dealId,
    kind:    "stage_changed",
    payload: { from: prev.data?.stage ?? null, to: stage },
  })
  dispatchDealsChanged()
  return true
}

export async function updateDealSnapshot(
  dealId: string,
  result: PanelResult,
): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const update = {
    snapshot:           result,
    address:            result.address,
    city:               result.city,
    state:              result.state,
    zip:                result.zip,
    list_price:         result.listPrice,
    beds:               result.beds,
    baths:              result.baths,
    sqft:               result.sqft,
    year_built:         result.yearBuilt,
    last_reanalyzed_at: new Date().toISOString(),
  }
  const { error } = await supabase.from("saved_deals").update(update).eq("id", dealId)
  if (error) {
    console.error("[pipeline] updateDealSnapshot error:", error)
    return false
  }
  void supabase.from("deal_events").insert({
    user_id: user.id,
    deal_id: dealId,
    kind:    "reanalyzed",
    payload: {},
  })
  dispatchDealsChanged()
  return true
}

export async function updateDealTags(dealId: string, tags: string[]): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { error } = await supabase.from("saved_deals").update({ tags }).eq("id", dealId)
  if (error) {
    console.error("[pipeline] updateDealTags error:", error)
    return false
  }
  void supabase.from("deal_events").insert({
    user_id: user.id,
    deal_id: dealId,
    kind:    "tags_updated",
    payload: { tags },
  })
  return true
}

/** Persist (or clear) the user's scenario overrides for a saved deal.
 *  Pass an object of overrides to set, or null to clear back to default.
 *  Empty objects are treated as null — no point storing "user opened the
 *  editor but didn't change anything."
 *
 *  Caller pattern: debounce edits in the UI (~300ms) so we're not writing
 *  on every keystroke, then call once. */

export async function updateDealScenario(
  dealId:   string,
  scenario: ScenarioOverrides | null,
): Promise<boolean> {
  if (_scenarioColumnMissing) return false   // quietly degrade
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const value = scenario && Object.keys(scenario).length > 0 ? scenario : null
  const { error } = await supabase
    .from("saved_deals")
    .update({ scenario: value })
    .eq("id", dealId)
  if (error) {
    // PGRST204 = "column doesn't exist" — migration 013_scenarios.sql
    // hasn't been applied. Set the flag, log once with actionable
    // guidance, then stop trying. Scenarios still work in memory; just
    // don't persist across sessions until the migration runs.
    if (error.code === "PGRST204") {
      _scenarioColumnMissing = true
      console.warn(
        "[pipeline] scenario column missing — apply supabase/migrations/013_scenarios.sql to enable persistence. Scenarios will work in memory but not persist."
      )
      return false
    }
    console.error("[pipeline] updateDealScenario error:", error)
    return false
  }
  void supabase.from("deal_events").insert({
    user_id: user.id,
    deal_id: dealId,
    kind:    value ? "scenario_changed" : "scenario_cleared",
    payload: value ?? {},
  })
  dispatchDealsChanged()
  return true
}

export async function updateDealNotes(dealId: string, notes: string): Promise<boolean> {
  const supabase = createClient()
  const { error } = await supabase.from("saved_deals").update({ notes }).eq("id", dealId)
  if (error) {
    console.error("[pipeline] updateDealNotes error:", error)
    return false
  }
  return true
}

/** Re-check every watched deal: navigate a hidden background view to
 *  the source URL, re-extract via Haiku, compare price to the stored
 *  snapshot. Persists changes to Supabase + emits deal_events.
 *
 *  Returns a summary the caller can show in a toast: how many were
 *  checked, how many had price changes, and the delta total. Sequential
 *  by design (in main) — typical 10-deal portfolio takes 1-2 minutes. */
export interface WatchCheckSummary {
  checked:     number
  changed:     number
  failed:      number
  changes:     Array<{ dealId: string; address: string | null; delta: number }>
}

export async function runWatchChecks(): Promise<WatchCheckSummary> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const empty: WatchCheckSummary = { checked: 0, changed: 0, failed: 0, changes: [] }
  if (!user) return empty

  // Pull every watched deal for this user.
  const { data: watched, error } = await supabase
    .from("saved_deals")
    .select("id, source_url, list_price, address, snapshot")
    .eq("watching", true)
  if (error || !watched || watched.length === 0) return empty

  const api = window.electronAPI
  if (!api?.checkWatchedDeals) return empty

  const inputs = watched.map((d) => ({
    id:         d.id,
    source_url: d.source_url,
    list_price: d.list_price ?? null,
  }))

  const { results } = await api.checkWatchedDeals(inputs)
  const summary: WatchCheckSummary = { ...empty }

  for (const r of results) {
    summary.checked++
    if (!r.ok) { summary.failed++; continue }
    if (!r.priceChanged) continue

    summary.changed++
    const deal = watched.find((d) => d.id === r.id)
    summary.changes.push({
      dealId:  r.id,
      address: deal?.address ?? null,
      delta:   r.delta ?? 0,
    })

    // Persist new price + emit a deal_event so the activity feed has it.
    const newSnapshot = deal?.snapshot
      ? { ...(deal.snapshot as PanelResult), listPrice: r.newListPrice ?? null }
      : null
    await supabase.from("saved_deals")
      .update({
        list_price:        r.newListPrice ?? null,
        last_reanalyzed_at: new Date().toISOString(),
        ...(newSnapshot ? { snapshot: newSnapshot } : {}),
      })
      .eq("id", r.id)

    await supabase.from("deal_events").insert({
      user_id: user.id,
      deal_id: r.id,
      kind:    "price_changed",
      payload: {
        from:  r.prevListPrice ?? null,
        to:    r.newListPrice ?? null,
        delta: r.delta ?? null,
      },
    })
  }

  if (summary.changed > 0) dispatchDealsChanged()
  return summary
}

/** Toggle the "watching" flag — when true, the deal is eligible for
 *  periodic price/status re-checks. */
export async function setDealWatching(dealId: string, watching: boolean): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { error } = await supabase
    .from("saved_deals")
    .update({ watching })
    .eq("id", dealId)
  if (error) {
    console.error("[pipeline] setDealWatching error:", error)
    return false
  }
  void supabase.from("deal_events").insert({
    user_id: user.id,
    deal_id: dealId,
    kind:    watching ? "watch_on" : "watch_off",
    payload: {},
  })
  dispatchDealsChanged()
  return true
}

export async function deleteDeal(dealId: string): Promise<boolean> {
  const supabase = createClient()
  const { error } = await supabase.from("saved_deals").delete().eq("id", dealId)
  if (error) {
    console.error("[pipeline] deleteDeal error:", error)
    return false
  }
  dispatchDealsChanged()
  return true
}

// ── Active count (sidebar badge) ──────────────────────────────────────────

/**
 * Active = anything not Won and not Passed. Quick read for the sidebar's
 * "Pipeline · N" indicator. Returns 0 on auth/network failure rather than
 * blowing up — the sidebar shouldn't be a chokepoint.
 */
export async function fetchActivePipelineCount(): Promise<number> {
  const supabase = createClient()
  const { count, error } = await supabase
    .from("saved_deals")
    .select("id", { count: "exact", head: true })
    .not("stage", "in", "(won,passed)")
  if (error) {
    console.error("[pipeline] fetchActivePipelineCount error:", error)
    return 0
  }
  return count ?? 0
}

/** Per-stage counts for the sidebar's pipeline sub-nav. Total = active + won + passed. */
export type StageCounts = Record<DealStage, number> & { total: number }

export async function fetchStageCounts(): Promise<StageCounts> {
  const empty: StageCounts = {
    watching: 0, interested: 0, offered: 0, won: 0, passed: 0, total: 0,
  }
  const supabase = createClient()
  // Single query returning all rows' stages — cheaper than 5 count queries.
  const { data, error } = await supabase
    .from("saved_deals")
    .select("stage")
  if (error || !data) {
    if (error) console.error("[pipeline] fetchStageCounts error:", error)
    return empty
  }
  const counts = { ...empty }
  for (const row of data as { stage: DealStage }[]) {
    counts[row.stage] = (counts[row.stage] ?? 0) + 1
    counts.total++
  }
  return counts
}

// ── Start-screen context bundle ────────────────────────────────────────────
//
// One round-trip that powers the composed Browse start screen: greeting +
// observation card + recent listings. Designed to fail soft — every field
// has a sensible empty default so the screen still renders if the user
// isn't signed in or Supabase is unreachable.

export interface StartScreenContext {
  recentListings: RecentListing[]
  pipeline: {
    activeCount:      number
    watchingCount:    number
    /** "Watching" deals last touched >7 days ago — gentle nudge surface. */
    staleWatching:    number
    /** Saves in the past 7 days — momentum signal. */
    savedThisWeek:    number
  }
}

const EMPTY_CONTEXT: StartScreenContext = {
  recentListings: [],
  pipeline: {
    activeCount:   0,
    watchingCount: 0,
    staleWatching: 0,
    savedThisWeek: 0,
  },
}

export async function fetchStartScreenContext(): Promise<StartScreenContext> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return EMPTY_CONTEXT

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()

  const [recent, active, watching, stale, saves] = await Promise.all([
    supabase
      .from("recent_listings")
      .select("*")
      .order("visited_at", { ascending: false })
      .limit(6),
    supabase
      .from("saved_deals")
      .select("id", { count: "exact", head: true })
      .not("stage", "in", "(won,passed)"),
    supabase
      .from("saved_deals")
      .select("id", { count: "exact", head: true })
      .eq("stage", "watching"),
    supabase
      .from("saved_deals")
      .select("id", { count: "exact", head: true })
      .eq("stage", "watching")
      .lt("updated_at", sevenDaysAgo),
    supabase
      .from("deal_events")
      .select("id", { count: "exact", head: true })
      .eq("kind", "saved")
      .gt("at", sevenDaysAgo),
  ])

  return {
    recentListings: (recent.data ?? []) as RecentListing[],
    pipeline: {
      activeCount:   active.count   ?? 0,
      watchingCount: watching.count ?? 0,
      staleWatching: stale.count    ?? 0,
      savedThisWeek: saves.count    ?? 0,
    },
  }
}

// ── Weekly digest ──────────────────────────────────────────────────────────
//
// Quiet "last week in your pipeline" recap. Pulled once on mount of the
// Browse start screen; only the surface decides whether to render the
// digest card based on whether there's anything worth saying. We
// deliberately don't compute the date-range cutoff in JS — Supabase does
// the filtering server-side so we ship as little data over the wire as
// possible.

export interface WeeklyDigest {
  /** Number of save events in the last 7 days. */
  saves:         number
  /** Number of stage-change events in the last 7 days. */
  stageMoves:    number
  /** Number of price-change events emitted by the watch system. */
  priceChanges:  number
  /** Aggregate dollar change across all price moves. Negative = drops. */
  priceDelta:    number
  /** Most-revisited listing (by browse_history count) — the deal you keep
   *  going back to, suggesting it's the one you can't decide about. */
  mostViewed:   { url: string; address: string | null; count: number } | null
}

const EMPTY_DIGEST: WeeklyDigest = {
  saves: 0, stageMoves: 0, priceChanges: 0, priceDelta: 0, mostViewed: null,
}

export async function fetchWeeklyDigest(): Promise<WeeklyDigest> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return EMPTY_DIGEST

  const since = new Date(Date.now() - 7 * 86400_000).toISOString()

  const [saves, stageMoves, priceChanges, history] = await Promise.all([
    supabase.from("deal_events")
      .select("id", { count: "exact", head: true })
      .eq("kind", "saved")
      .gt("at", since),
    supabase.from("deal_events")
      .select("id", { count: "exact", head: true })
      .eq("kind", "stage_changed")
      .gt("at", since),
    // Price changes need the payload so we can sum the deltas — head:false
    // intentionally; we want the rows.
    supabase.from("deal_events")
      .select("payload")
      .eq("kind", "price_changed")
      .gt("at", since),
    supabase.from("browse_history")
      .select("url, address")
      .gt("visited_at", since),
  ])

  // Sum price deltas client-side (Postgres aggregate would need a view).
  let priceDelta = 0
  let priceCount = 0
  for (const row of (priceChanges.data ?? []) as Array<{ payload: { delta?: number } }>) {
    const d = row.payload?.delta
    if (typeof d === "number" && Number.isFinite(d)) {
      priceDelta += d
      priceCount++
    }
  }

  // Most-viewed: dedupe browse_history by URL and pick the highest count.
  const viewCounts = new Map<string, { count: number; address: string | null }>()
  for (const r of (history.data ?? []) as Array<{ url: string; address: string | null }>) {
    const cur = viewCounts.get(r.url)
    if (cur) cur.count++
    else viewCounts.set(r.url, { count: 1, address: r.address })
  }
  let mostViewed: WeeklyDigest["mostViewed"] = null
  let bestCount = 0
  for (const [url, v] of viewCounts) {
    if (v.count > bestCount && v.count >= 3) { // 3+ views = actually "kept going back"
      bestCount = v.count
      mostViewed = { url, address: v.address, count: v.count }
    }
  }

  return {
    saves:        saves.count ?? 0,
    stageMoves:   stageMoves.count ?? 0,
    priceChanges: priceCount,
    priceDelta,
    mostViewed,
  }
}

// ── Browse history ─────────────────────────────────────────────────────────

interface LogVisitInput {
  url:       string
  siteName?: string | null
  title?:    string | null
  address?:  string | null
}

// ── Activity feed ─────────────────────────────────────────────────────────
//
// The Today feed on the Browse start screen reads from this. Pulls the
// last N deal_events with their associated saved_deal context (address,
// list_price, site_name) so the feed cards can render rich previews
// without a second roundtrip per row. Events are returned newest-first.

export type ActivityEventKind =
  | "saved" | "stage_changed" | "reanalyzed" | "tags_updated"
  | "price_changed" | "scenario_changed" | "scenario_cleared"

export interface ActivityEvent {
  id:        string
  at:        string
  kind:      ActivityEventKind
  /** Deal context joined from saved_deals — null if the deal was deleted. */
  deal:      Pick<SavedDeal, "id" | "address" | "city" | "state" | "list_price" | "site_name" | "stage" | "source_url"> | null
  /** Event-kind-specific payload (price delta, new stage, etc.). */
  payload:   Record<string, unknown> | null
}

/** Fetch the user's recent deal activity for the Today feed. Default limit
 *  is 30 — enough to show "what changed since you last looked" without
 *  overwhelming. The returned events join the deal context inline so the
 *  feed can render addresses + prices without per-row queries. */
export async function fetchActivityFeed(limit = 30): Promise<ActivityEvent[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from("deal_events")
    .select(`
      id, at, kind, payload,
      deal:saved_deals(id, address, city, state, list_price, site_name, stage, source_url)
    `)
    .eq("user_id", user.id)
    .order("at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[pipeline] fetchActivityFeed error:", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id:      row.id as string,
    at:      row.at as string,
    kind:    row.kind as ActivityEventKind,
    payload: (row.payload ?? null) as Record<string, unknown> | null,
    deal:    Array.isArray(row.deal)
      ? (row.deal[0] ?? null)
      : (row.deal ?? null),
  })) as ActivityEvent[]
}

/** Log a listing-URL navigation. Fire-and-forget — failures don't block UI. */
export function logBrowseVisit(v: LogVisitInput): void {
  const supabase = createClient()
  void supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) return
    void supabase.from("browse_history").insert({
      user_id:   user.id,
      url:       v.url,
      site_name: v.siteName ?? null,
      title:     v.title ?? null,
      address:   v.address ?? null,
    })
  })
}

/** Most recent listings the user navigated to, deduped by URL. */
export async function fetchRecentListings(limit = 6): Promise<RecentListing[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("recent_listings")
    .select("*")
    .order("visited_at", { ascending: false })
    .limit(limit)
  if (error) {
    console.error("[pipeline] fetchRecentListings error:", error)
    return []
  }
  return (data ?? []) as RecentListing[]
}

export interface UrlViewStats {
  count:        number
  firstSeenAt:  string | null
  lastSeenAt:   string | null
}

/** How many times has the user visited this URL? Used by the panel's
 *  "Viewed N times" indicator. firstSeenAt powers "first seen 3d ago". */
export async function fetchUrlViewStats(url: string): Promise<UrlViewStats> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("browse_history")
    .select("visited_at")
    .eq("url", url)
    .order("visited_at", { ascending: true })
  if (error || !data) {
    return { count: 0, firstSeenAt: null, lastSeenAt: null }
  }
  return {
    count:       data.length,
    firstSeenAt: data[0]?.visited_at ?? null,
    lastSeenAt:  data[data.length - 1]?.visited_at ?? null,
  }
}
