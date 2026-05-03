-- RealVerdict — watch this listing.
--
-- Adds a `watching` flag to saved_deals. Watched deals get periodic
-- price/status checks (the cron implementation is a separate phase).
--
-- Idempotent — safe to re-run.

alter table public.saved_deals
  add column if not exists watching boolean not null default false;

-- Cheap query: "all watched deals for this user" — read every time we run
-- the watch check, so worth indexing partially.
create index if not exists saved_deals_user_watching_idx
  on public.saved_deals (user_id) where watching = true;
