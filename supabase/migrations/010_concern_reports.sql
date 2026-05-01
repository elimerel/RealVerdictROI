-- Concern-report inbox.
--
-- Backs the public form at /report. Anonymous submissions are allowed
-- (no auth required) so any rights holder, abuse reporter, or curious
-- visitor can reach us through a structured channel. Reading rows is
-- restricted to the service role — there is no SELECT policy for the
-- anon role, and RLS is on. The marketing form inserts via a Next.js
-- server action that uses the service-role key.
--
-- Idempotent.

create table if not exists public.concern_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- Reporter contact (optional but strongly encouraged so we can reply).
  name        text,
  email       text,

  -- The kind of concern. Free-form so we don't paint ourselves into a
  -- corner with an enum, but the form's <select> populates it from a
  -- known list ("dmca", "data-accuracy", "abuse", "other").
  kind        text,

  -- The URL the reporter is concerned about, if any.
  subject_url text,

  -- The message body. Capped at 8000 chars at the API layer.
  message     text not null,

  -- Operational fields — reporter IP and user-agent help us recognise
  -- genuine reports vs spam without storing more than necessary.
  ip          inet,
  user_agent  text
);

create index if not exists concern_reports_created_at_idx
  on public.concern_reports (created_at desc);

alter table public.concern_reports enable row level security;

-- Insert is open to anon — the form is public.
drop policy if exists "concern_reports_anon_insert" on public.concern_reports;
create policy "concern_reports_anon_insert" on public.concern_reports
  for insert to anon with check (true);

drop policy if exists "concern_reports_authed_insert" on public.concern_reports;
create policy "concern_reports_authed_insert" on public.concern_reports
  for insert to authenticated with check (true);

-- No SELECT / UPDATE / DELETE policies for non-service roles. Reading
-- the inbox requires the service-role key (used by an admin script or
-- Supabase dashboard).
