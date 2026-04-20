-- RealVerdictROI — deals table + RLS.
--
-- Run this once in the Supabase SQL editor (Project → SQL → New query).
-- It's idempotent: safe to re-run.

create extension if not exists "pgcrypto";

create table if not exists public.deals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  address     text,
  inputs      jsonb not null,
  results     jsonb not null,
  verdict     text not null
);

-- Fast "my deals, newest first" queries.
create index if not exists deals_user_created_idx
  on public.deals (user_id, created_at desc);

-- Row-level security: a user can only see / mutate their own rows.
alter table public.deals enable row level security;

drop policy if exists "deals_owner_select" on public.deals;
create policy "deals_owner_select" on public.deals
  for select using (auth.uid() = user_id);

drop policy if exists "deals_owner_insert" on public.deals;
create policy "deals_owner_insert" on public.deals
  for insert with check (auth.uid() = user_id);

drop policy if exists "deals_owner_update" on public.deals;
create policy "deals_owner_update" on public.deals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "deals_owner_delete" on public.deals;
create policy "deals_owner_delete" on public.deals
  for delete using (auth.uid() = user_id);
