-- RealVerdictROI — negotiation_packs table + RLS.
--
-- Backs the Negotiation Pack feature (HANDOFF §20.3). One row per generated
-- Pack, stored as a frozen snapshot (PackPayload JSON) so the public share
-- link keeps showing the exact numbers the investor generated even if the
-- live engine moves underneath them.
--
-- Run this once in the Supabase SQL editor (Project → SQL → New query).
-- It's idempotent: safe to re-run.

create extension if not exists "pgcrypto";

create table if not exists public.negotiation_packs (
  id            uuid primary key default gen_random_uuid(),
  -- Public, unguessable URL slug. The web view at /pack/<share_token> reads
  -- by this column, never by id, so an attacker cannot enumerate packs by
  -- guessing UUIDs. encode(gen_random_bytes(18), 'base64url') gives a 24-char
  -- token with 144 bits of entropy.
  share_token   text not null unique,
  user_id       uuid references auth.users(id) on delete cascade,
  -- Frozen pack contents (PackPayload from lib/negotiation-pack.ts). All
  -- numbers, comp evidence, stress scenarios, counteroffer paragraphs are
  -- in here. Snapshot, not live.
  payload       jsonb not null,
  -- Denormalized for the dashboard listing — avoids parsing payload.
  address       text,
  verdict       text,
  walk_away_price numeric,
  list_price    numeric,
  -- Visibility. Public packs render at /pack/<share_token> for anyone with
  -- the link; private packs require the owner to be signed in. Default
  -- public so the share-with-agent flow works out of the box.
  is_public     boolean not null default true,
  created_at    timestamptz not null default now(),
  -- Soft delete: nulled-out user_id rows whose share_token still resolves
  -- show a "this pack was deleted" page rather than 404. Lets us honor
  -- explicit revoke without breaking already-sent agent links.
  revoked_at    timestamptz
);

-- Lookups by share_token are the hot path (every page view, every PDF render).
create index if not exists negotiation_packs_share_token_idx
  on public.negotiation_packs (share_token);

-- Owner dashboard: "my packs, newest first".
create index if not exists negotiation_packs_user_created_idx
  on public.negotiation_packs (user_id, created_at desc);

-- Row-level security.
alter table public.negotiation_packs enable row level security;

-- SELECT policy: a row is readable when EITHER (a) the requester owns it,
-- OR (b) the row is public and unrevoked. The (b) branch is what makes the
-- "send link to agent" flow work without forcing the agent to sign in.
drop policy if exists "packs_select" on public.negotiation_packs;
create policy "packs_select" on public.negotiation_packs
  for select using (
    auth.uid() = user_id
    OR (is_public = true AND revoked_at IS NULL)
  );

-- INSERT policy: only the authenticated user can create their own pack.
-- Anonymous Pack generation is intentionally NOT supported — Pack is the
-- primary Pro funnel (§20.3) so we want the user signed in by then.
drop policy if exists "packs_insert" on public.negotiation_packs;
create policy "packs_insert" on public.negotiation_packs
  for insert with check (auth.uid() = user_id);

-- UPDATE policy: only the owner. Used for is_public toggle + revoked_at.
drop policy if exists "packs_update" on public.negotiation_packs;
create policy "packs_update" on public.negotiation_packs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- DELETE policy: only the owner. Cascade from auth.users handles the
-- "user deleted their account" case automatically.
drop policy if exists "packs_delete" on public.negotiation_packs;
create policy "packs_delete" on public.negotiation_packs
  for delete using (auth.uid() = user_id);
