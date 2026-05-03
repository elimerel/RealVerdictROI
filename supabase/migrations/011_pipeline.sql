-- RealVerdict — pipeline tables.
--
-- Three tables for the pipeline / browser-app flow:
--   saved_deals     — canonical pipeline entries (kanban stages)
--   browse_history  — listing URL navigation log (powers Recent Listings
--                     strip + personalized greeting context)
--   deal_events     — activity feed source (saves, stage changes, etc.)
--
-- All tables are user-scoped via auth.uid() with RLS. Idempotent — safe to
-- re-run.

create extension if not exists "pgcrypto";

-- ── saved_deals ────────────────────────────────────────────────────────────

create table if not exists public.saved_deals (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Pipeline placement
  stage             text not null default 'watching'
    check (stage in ('watching', 'interested', 'offered', 'won', 'passed')),

  -- Source link — where the user was when they hit Save
  source_url        text not null,
  site_name         text,

  -- Denormalized identity columns for fast list rendering. Full snapshot
  -- still lives in `snapshot` jsonb; these are for the 80% query path.
  address           text,
  city              text,
  state             text,
  zip               text,
  list_price        numeric,
  beds              numeric,
  baths             numeric,
  sqft              integer,
  year_built        integer,

  -- Frozen snapshot of the full PanelResult at save time. The user sees
  -- whatever the metrics were the day they saved, even if the listing
  -- page changes later. Re-analyze creates a NEW snapshot in-place.
  snapshot          jsonb not null,

  -- Auto-generated short factual tags ("fixer-upper", "high-cash-flow").
  -- AI-generated at save time, user-overridable. Empty array allowed.
  tags              text[] not null default '{}',

  -- User's private freeform notes about the deal.
  notes             text,

  -- Activity timestamps for "you've seen this before" hints + insights.
  last_revisited_at timestamptz,
  last_reanalyzed_at timestamptz
);

-- One save per (user, URL) — clicking Save twice is a no-op, not a dupe.
create unique index if not exists saved_deals_user_url_uniq
  on public.saved_deals (user_id, source_url);

-- "My pipeline, newest first" + "by stage" common queries.
create index if not exists saved_deals_user_created_idx
  on public.saved_deals (user_id, created_at desc);
create index if not exists saved_deals_user_stage_idx
  on public.saved_deals (user_id, stage, updated_at desc);

-- Auto-bump updated_at on any change. Critical for the kanban "days in
-- stage" indicator — we want the timestamp to reflect when the deal
-- actually moved, not when it was first saved.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists saved_deals_touch on public.saved_deals;
create trigger saved_deals_touch
  before update on public.saved_deals
  for each row execute function public.touch_updated_at();

-- RLS: row owner only.
alter table public.saved_deals enable row level security;

drop policy if exists "saved_deals_owner_select" on public.saved_deals;
create policy "saved_deals_owner_select" on public.saved_deals
  for select using (auth.uid() = user_id);

drop policy if exists "saved_deals_owner_insert" on public.saved_deals;
create policy "saved_deals_owner_insert" on public.saved_deals
  for insert with check (auth.uid() = user_id);

drop policy if exists "saved_deals_owner_update" on public.saved_deals;
create policy "saved_deals_owner_update" on public.saved_deals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "saved_deals_owner_delete" on public.saved_deals;
create policy "saved_deals_owner_delete" on public.saved_deals
  for delete using (auth.uid() = user_id);

-- ── browse_history ─────────────────────────────────────────────────────────

create table if not exists public.browse_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  visited_at  timestamptz not null default now(),

  url         text not null,
  site_name   text,
  title       text,
  -- Address pulled from the panel result (when available) so the Recent
  -- strip can show meaningful text without re-parsing the URL.
  address     text
);

-- "Recent for this user" + de-duplication queries.
create index if not exists browse_history_user_visited_idx
  on public.browse_history (user_id, visited_at desc);

-- Helper: most recent N listings the user navigated to, deduped by URL.
-- Lets us avoid the same listing appearing 5 times in Recent Listings.
create or replace view public.recent_listings as
select distinct on (user_id, url)
  user_id, url, site_name, title, address, visited_at
from public.browse_history
order by user_id, url, visited_at desc;

alter table public.browse_history enable row level security;

drop policy if exists "browse_history_owner_select" on public.browse_history;
create policy "browse_history_owner_select" on public.browse_history
  for select using (auth.uid() = user_id);

drop policy if exists "browse_history_owner_insert" on public.browse_history;
create policy "browse_history_owner_insert" on public.browse_history
  for insert with check (auth.uid() = user_id);

drop policy if exists "browse_history_owner_delete" on public.browse_history;
create policy "browse_history_owner_delete" on public.browse_history
  for delete using (auth.uid() = user_id);

-- ── deal_events ────────────────────────────────────────────────────────────
--
-- Append-only log of meaningful changes. Powers:
--   - the activity feed (planned phase 2 layer)
--   - the personalized-greeting context bundle ("you saved 3 this week")
--   - future audit / undo features
--
-- Tiny rows, kept forever.

create table if not exists public.deal_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  deal_id     uuid references public.saved_deals(id) on delete cascade,
  at          timestamptz not null default now(),

  -- Open-ended on purpose — we'll add new event kinds without migrations.
  -- Current uses: 'saved', 'stage_changed', 'reanalyzed', 'note_added',
  -- 'tags_updated', 'price_changed'.
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb
);

create index if not exists deal_events_user_at_idx
  on public.deal_events (user_id, at desc);
create index if not exists deal_events_deal_idx
  on public.deal_events (deal_id, at desc);

alter table public.deal_events enable row level security;

drop policy if exists "deal_events_owner_select" on public.deal_events;
create policy "deal_events_owner_select" on public.deal_events
  for select using (auth.uid() = user_id);

drop policy if exists "deal_events_owner_insert" on public.deal_events;
create policy "deal_events_owner_insert" on public.deal_events
  for insert with check (auth.uid() = user_id);
