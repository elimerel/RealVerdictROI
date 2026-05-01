-- Persist the AI's verbal "take" + risk-flag chips + listing details that
-- the Browse extractor produces, so saved deals carry that context into
-- the Pipeline. Without this columns set the dossier loses three rows
-- of context the moment the user clicks Save.
--
-- All columns are JSONB (or text for the take) so the schema can evolve
-- without further migrations as the extractor grows.
-- Safe to re-run.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS ai_take         text,
  ADD COLUMN IF NOT EXISTS risk_flags      jsonb,
  ADD COLUMN IF NOT EXISTS listing_details jsonb;

-- Listing-detail shape (stored as a flat object, all keys optional):
--   {
--     daysOnMarket?: number
--     originalListPrice?: number
--     priceHistoryNote?: string         e.g. "Reduced 4/12: $545k → $530k"
--     listingDate?: string              ISO date
--     listingRemarks?: string
--     mlsNumber?: string
--     schoolRating?: number             0-10
--     walkScore?: number                0-100
--     lotSqft?: number
--   }
--
-- risk_flags is a string[] of phrases lifted verbatim from the listing
--   ("foundation issues", "tenant-occupied through 2027", etc.).
