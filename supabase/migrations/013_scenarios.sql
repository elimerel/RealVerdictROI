-- RealVerdict — per-deal scenario overrides.
--
-- A "scenario" is the user's "what if I offered $440k?" / "what if I put 30%
-- down?" alternate view of an analyzed listing. The original AI extraction
-- + market data (`snapshot.metrics`) stays untouched as the source of truth;
-- the scenario layer rides on top, recomputed live in the renderer via
-- `lib/calculations.ts::analyseDeal` + `lib/scenario.ts::recomputeMetrics`.
--
-- Schema choice: a single nullable JSONB column on `saved_deals`. NULL =
-- no scenario set, render the snapshot. JSONB shape mirrors the
-- `ScenarioOverrides` interface in lib/scenario.ts — sparse object keyed
-- by override field, only includes keys the user actually changed. Keeping
-- this denormalized in the deal row (vs. a separate scenarios table) is
-- correct for MVP — one scenario per deal, always loaded with the deal,
-- always written by the same user.
--
-- Idempotent — safe to re-run.

alter table public.saved_deals
  add column if not exists scenario jsonb;

-- Note: no index needed — we only ever read the scenario alongside the
-- full deal row, never query/filter by scenario contents.
