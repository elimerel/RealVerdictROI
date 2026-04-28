-- Add property_facts column to deals table.
-- Stores beds/baths/sqft/yearBuilt/propertyType extracted at analysis time.
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

alter table public.deals
  add column if not exists property_facts jsonb;
