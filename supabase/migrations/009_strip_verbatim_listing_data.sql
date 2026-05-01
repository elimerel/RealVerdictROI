-- Legal hardening pass — strip previously-stored verbatim listing copy.
--
-- Earlier builds of RealVerdict persisted two pieces of content that
-- crossed into copyrighted-content territory:
--
--   1. listing_details.listingRemarks
--      Verbatim 1-3 sentence quote of the listing's marketing
--      description ("about this home"). Marketing copy is the property
--      of the listing agent / broker. Storing and surfacing it as a
--      "From the listing" quote block in the dossier was a derivative
--      use we don't want on file.
--
--   2. risk_flags
--      Originally extracted as "verbatim or near-verbatim phrases
--      lifted from the page". The new prompt asks the model to
--      generate SHORT FACTUAL TAGS in its own words (≤3 words each)
--      and the API + extractor coercer reject anything longer. Any
--      pre-existing rows in the table may still contain lifted
--      phrases.
--
-- This migration:
--   a) Removes the listingRemarks key from every existing
--      listing_details JSONB blob (preserves all other detail fields).
--   b) NULLs out risk_flags for every existing row, on the principle
--      that we'd rather lose old tags than keep ones generated under
--      the old "verbatim" instructions.
--
-- Going forward:
--   - The save route's sanitizeListingDetails() does not accept a
--     listingRemarks field at all; clients can't put it back.
--   - The save route's sanitizeRiskFlags() rejects anything longer
--     than 32 chars or 3 words.
--   - The extractor prompt + coercer (lib/extractor + electron-app)
--     enforce the same contract upstream.
--
-- Idempotent — safe to re-run.

UPDATE public.deals
   SET listing_details = listing_details - 'listingRemarks'
 WHERE listing_details ? 'listingRemarks';

UPDATE public.deals
   SET risk_flags = NULL
 WHERE risk_flags IS NOT NULL;
