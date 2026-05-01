// ---------------------------------------------------------------------------
// Extractor — shared types
// ---------------------------------------------------------------------------
//
// The extractor is the brain of RealVerdict. A single AI pass takes the
// rendered DOM text of whatever page the user is on and answers three
// questions in one shot:
//
//   1. What KIND of page is this? (PageKind)
//   2. If it's a listing, what are the FACTS? (ListingFacts — rich)
//   3. What's the AI's CONFIDENCE per field?
//
// We deliberately ask the LLM for a wide schema. Because we use plain
// JSON output (not Anthropic tool-use), there's no property cap. A wide
// schema is the wedge — DealCheck and competitors only read what their
// scrapers were built for; we read what the page actually says, including
// fine print they miss.
// ---------------------------------------------------------------------------

export type PageKind =
  | "listing-rental"        // single property — for sale, rent-friendly underwriting
  | "listing-flip"          // single property — flip/wholesale signals dominant
  | "listing-land"          // raw land / lot
  | "listing-newbuild"      // new construction / pre-sale
  | "listing-multifamily"   // 2-4 unit / small multifamily
  | "search-results"        // a list of properties, not a single listing
  | "neighborhood"          // neighborhood / market overview page
  | "agent-profile"         // agent or office page
  | "captcha"               // human-verification screen blocking content
  | "non-real-estate"       // any page that isn't real estate at all
  | "unknown"               // model couldn't classify confidently

export type Confidence = "high" | "medium" | "low"

/** Per-field provenance & confidence. Lets the panel show a confidence
 *  dot next to each value and explain where the number came from. */
export type FieldMeta = {
  source: "listing" | "inferred" | "user" | "verified"
  confidence: Confidence
  /** Short human note shown on hover. */
  note?: string
}

/** The rich extraction. Every field is optional — the model returns null
 *  when something isn't shown on the page, never an estimate. */
export type ListingFacts = {
  // Identity
  address:          string | null
  city:             string | null
  state:            string | null
  zip:              string | null

  // Pricing
  listPrice:        number | null
  /** Original list price if a reduction is shown (signals motivation). */
  originalListPrice: number | null
  /** "Days on market"-style figure, in days. */
  daysOnMarket:     number | null
  /** Plain text describing the price history if shown. */
  priceHistoryNote: string | null

  // Physical
  beds:             number | null
  baths:            number | null
  fullBaths:        number | null
  halfBaths:        number | null
  sqft:             number | null
  /** Lot size in square feet (we'll convert from acres if needed). */
  lotSqft:          number | null
  yearBuilt:        number | null
  garageSpaces:     number | null
  stories:          number | null
  propertyType:     string | null   // "Single Family", "Condo", "Townhouse", "2-4 Unit"

  // Money flows
  monthlyRent:        number | null   // labeled rental estimate ONLY (not mortgage)
  monthlyHOA:         number | null
  annualPropertyTax:  number | null
  annualInsuranceEst: number | null   // model can read "est. insurance" lines

  // Quality / risk signals — short FACTUAL tags the model generates
  // in its own words. Bounded vocabulary to avoid republishing
  // marketing copy from the source listing. See CONTENT-USAGE RULES
  // in lib/extractor/prompt.ts.
  conditionTag:     string | null   // "move-in ready" | "needs work" | "recently renovated" | "as-is" | "tear-down" | "new construction"
  riskFlags:        string[]        // short factual tags ≤3 words: ["flood zone","septic","high HOA",...]

  // Listing meta
  mlsNumber:        string | null
  listingDate:      string | null   // ISO date if parseable, else free text
  // (listingRemarks intentionally removed — see CONTENT-USAGE RULES.
  // Verbatim listing descriptions are copyrighted by the listing
  // agent / broker and we don't store them anywhere in the system.)
  schoolRating:     number | null   // 1-10 if a single composite is shown
  /** Walk score, transit score, bike score (best-effort). */
  walkScore:        number | null

  // Source attribution
  siteName:         string | null
}

/** Categorical error codes the renderer maps to calm in-panel copy.
 *  We never let a raw API error reach the user. */
export type ExtractErrorCode =
  | "no_key"
  | "page_too_short"
  | "no_signals"           // Stage 2 didn't find enough listing fingerprints
  | "search_results_page"  // Stage 2 detected many listings — wrong page type
  | "captcha"
  | "low_confidence"
  | "schema_too_complex"   // legacy — kept for back-compat
  | "network"
  | "unknown"

/** Per-field meta map, keyed by ListingFacts keys. */
export type FactsMeta = Partial<Record<keyof ListingFacts, FieldMeta>>

/** What the renderer ultimately gets per page navigation. */
export type ExtractResult =
  | {
      ok: true
      kind: PageKind
      confidence: Confidence
      facts: ListingFacts
      meta: FactsMeta
      /** A model-written one-sentence take on the deal at face value. */
      take: string | null
      modelUsed: "anthropic" | "openai"
    }
  | {
      ok: false
      errorCode: ExtractErrorCode
      message: string
      partial?: Partial<ListingFacts>
    }

export type ExtractInput = {
  url: string
  title: string
  text: string
}

// ---------------------------------------------------------------------------
// User-facing copy for each error code.
// ---------------------------------------------------------------------------

export function userMessageFor(code: ExtractErrorCode): string {
  switch (code) {
    case "no_key":
      return "Add an Anthropic or OpenAI key in Settings to enable listing analysis."
    case "page_too_short":
      return "Couldn't read enough page content. Try refreshing the listing."
    case "no_signals":
      return "This doesn't look like a single listing. Open a property page to analyze it."
    case "search_results_page":
      return "Looks like a search results page. Open a listing to analyze it."
    case "captcha":
      return "Verify you're not a robot to continue. The panel will populate once the listing loads."
    case "low_confidence":
      return "Couldn't confidently read this listing — try refreshing or paste the URL."
    case "schema_too_complex":
      return "Couldn't fully read this listing — try refreshing or paste the URL."
    case "network":
      return "Network issue talking to the AI. Retry in a moment."
    case "unknown":
      return "Couldn't read this page. Try refreshing or paste the URL."
  }
}

// ---------------------------------------------------------------------------
// Page-kind helpers
// ---------------------------------------------------------------------------

export function isListing(kind: PageKind): boolean {
  return (
    kind === "listing-rental" ||
    kind === "listing-flip" ||
    kind === "listing-land" ||
    kind === "listing-newbuild" ||
    kind === "listing-multifamily"
  )
}
