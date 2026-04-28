-- Add ai_narrative column to deals table.
-- Stores an AI-generated plain-English narrative produced after analysis.
-- Shape: { summary, opportunity, risk, generatedAt }
-- Safe to re-run (ADD COLUMN IF NOT EXISTS).

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS ai_narrative jsonb;
