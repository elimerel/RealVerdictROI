-- RealVerdict — per-deal AI chat history.
--
-- The per-deal workspace (app/(app)/pipeline/[id]/page.tsx) hosts the
-- buddy as a first-class persistent column. Without persistence, the
-- conversation evaporates the moment the user closes the page — which
-- defeats the whole "buddy that remembers" premise. This migration
-- adds a single nullable JSONB column to saved_deals to store the
-- chat thread for each deal.
--
-- Schema: array of ChatMessage objects (id / role / content / at). The
-- shape mirrors lib/electron.ts::ChatMessage. NULL = no thread yet.
-- Keeping it denormalized on the deal row (vs. a separate `chats`
-- table) is correct for MVP: one thread per deal, always loaded with
-- the deal, always written by the same user, queried only by deal id.
-- Cap the thread to ~100 turns in the renderer; older turns get
-- trimmed before persist so the row doesn't grow unbounded.
--
-- Idempotent — safe to re-run.

alter table public.saved_deals
  add column if not exists chat jsonb;

-- No index — we never filter by chat contents, only fetch alongside
-- the full deal row.
