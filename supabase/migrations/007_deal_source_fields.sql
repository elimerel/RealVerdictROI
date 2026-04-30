-- Persist original listing provenance for saved pipeline deals.
alter table public.deals
  add column if not exists source_url text,
  add column if not exists source_site text;
