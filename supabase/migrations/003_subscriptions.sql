-- RealVerdictROI — Stripe subscription mirror (one row per user).
--
-- Written only by /api/stripe/webhook using SUPABASE_SERVICE_ROLE_KEY
-- (bypasses RLS). Clients read their own row via the anon key + session.
--
-- Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

create table if not exists public.subscriptions (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id       text not null unique,
  stripe_subscription_id   text,
  status                   text not null,
  price_id                 text,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  updated_at               timestamptz not null default now()
);

create index if not exists subscriptions_subscription_idx
  on public.subscriptions (stripe_subscription_id);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_owner_select" on public.subscriptions;
create policy "subscriptions_owner_select" on public.subscriptions
  for select using (auth.uid() = user_id);
