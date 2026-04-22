-- RealVerdictROI — compare_entries table for cross-device comparison sync.
--
-- Problem this solves:
--   The /compare queue has lived in localStorage since day one, which means
--   a user who adds three properties on their laptop has to re-add them on
--   their phone. For signed-in users we want the queue to round-trip
--   through Supabase so switching devices Just Works.
--
-- Anonymous users keep the pure-localStorage behavior; nothing in this
-- migration is required for the app to run. If you haven't applied it,
-- /compare silently falls back to localStorage-only (see /api/compare/*
-- route handlers — they return 503 when the table is missing and the
-- client swallows the failure).
--
-- Run this once in the Supabase SQL editor (Project → SQL → New query).
-- Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

create table if not exists public.compare_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Stable per-deal identifier produced client-side (price+rent+ts style).
  -- Enforced-unique per user so the same deal added twice is upsert, not
  -- a duplicate row.
  deal_key    text not null,
  address     text,
  inputs      jsonb not null,
  added_at    timestamptz not null default now(),
  unique (user_id, deal_key)
);

-- Fast "my compare queue, newest first" queries.
create index if not exists compare_entries_user_added_idx
  on public.compare_entries (user_id, added_at desc);

-- Row-level security: user can only see / mutate their own queue.
alter table public.compare_entries enable row level security;

drop policy if exists "compare_owner_select" on public.compare_entries;
create policy "compare_owner_select" on public.compare_entries
  for select using (auth.uid() = user_id);

drop policy if exists "compare_owner_insert" on public.compare_entries;
create policy "compare_owner_insert" on public.compare_entries
  for insert with check (auth.uid() = user_id);

drop policy if exists "compare_owner_update" on public.compare_entries;
create policy "compare_owner_update" on public.compare_entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "compare_owner_delete" on public.compare_entries;
create policy "compare_owner_delete" on public.compare_entries
  for delete using (auth.uid() = user_id);
