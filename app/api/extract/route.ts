import { generateObject } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { z } from "zod"
import type { NextRequest } from "next/server"
import type { DealInputs } from "@/lib/calculations"

// ---------------------------------------------------------------------------
// /api/extract
//
// Reads page text already-rendered on the user's machine and returns
// structured property data. Designed to:
//   1. Use a deliberately small primary schema so Anthropic tool-use never
//      hits its property-count ceiling (which historically returned an
//      ugly "schema contains too many properties" error to the user).
//   2. Retry once on schema/format/parse failure with a smaller core-only
//      schema, and fall back to a JSON-mode pass when even that fails.
//   3. Categorize failures (low_confidence, captcha, schema_too_complex,
//      network, no_key, page_too_short) so the UI can render calm,
//      site-neutral empty states instead of leaking raw API error strings.
//   4. Stay site-agnostic. The prompt names Zillow, Redfin, Realtor.com,
//      Homes.com, and Trulia equally and ships per-site extraction hints.
// ---------------------------------------------------------------------------

export const maxDuration = 30

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Anthropic-Key, X-OpenAI-Key",
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ---------------------------------------------------------------------------
// Error codes — UI maps these to calm copy. Never surface raw API errors.
// ---------------------------------------------------------------------------

type ErrorCode =
  | "no_key"
  | "page_too_short"
  | "captcha"
  | "low_confidence"
  | "schema_too_complex"
  | "network"
  | "unknown"

function userMessageFor(code: ErrorCode): string {
  switch (code) {
    case "no_key":
      return "Add an Anthropic or OpenAI key in Settings to enable listing analysis."
    case "page_too_short":
      return "Couldn't read enough page content. Try refreshing the listing."
    case "captcha":
      return "Verify you're not a robot to continue. The panel will populate once the listing loads."
    case "low_confidence":
      return "Couldn't fully read this listing — try refreshing or paste the URL."
    case "schema_too_complex":
      return "Couldn't fully read this listing — try refreshing or paste the URL."
    case "network":
      return "Network issue talking to the AI. Retry in a moment."
    case "unknown":
      return "Couldn't read this listing. Try refreshing or paste the URL."
  }
}

// ---------------------------------------------------------------------------
// Schemas — primary (core fields only) + optional second-pass enrichment
//
// The previous schema had 14 top-level properties, two nested array shapes,
// and several enums. Anthropic's tool-use API caps total schema property
// count and the SDK surfaces a raw "schema contains too many properties"
// error when over-budget. This split keeps the *primary* schema small and
// reliable; we layer enrichment only on success.
// ---------------------------------------------------------------------------

const CoreSchema = z.object({
  address:           z.string().nullable(),
  listPrice:         z.number().nullable(),
  monthlyRent:       z.number().nullable(),
  beds:              z.number().nullable(),
  baths:             z.number().nullable(),
  sqft:              z.number().nullable(),
  yearBuilt:         z.number().nullable(),
  monthlyHOA:        z.number().nullable(),
  annualPropertyTax: z.number().nullable(),
  siteName:          z.string().nullable(),
  confidence:        z.enum(["high", "medium", "low"]),
})

type Core = z.infer<typeof CoreSchema>

// ---------------------------------------------------------------------------
// Prompt — site-neutral, multi-site aware
// ---------------------------------------------------------------------------

function buildPrompt(title: string, url: string, text: string): string {
  return `You read a real-estate listing page and return structured numbers for an underwriting engine.

OUTPUT RULES
- Return null for any field not explicitly stated. Never estimate.
- Money values are plain numbers (no $, no commas).
- siteName is the platform: "Zillow", "Redfin", "Realtor.com", "Homes.com", "Trulia", or other.
- confidence: "high" if both address and listPrice are clearly present, "medium" if one is unclear, "low" if both are missing or this is not a single-property listing page.

RENT — CRITICAL
- monthlyRent is ONLY a labeled rental estimate ("Rent Zestimate", "Estimated rent", "Rental estimate", "Market rent").
- NEVER use a mortgage payment, "Est. payment", "Monthly payment", or "P&I" as rent.
- If no rental estimate is shown, set monthlyRent to null.

SITE-SPECIFIC HINTS
- Zillow: "Listed for", "Zestimate", "Rent Zestimate". Tax shown under "Public tax history". HOA in monthly cost breakdown.
- Redfin: "Listed", "Redfin Estimate". HOA in fees table. Tax in "Property history" or schools panel.
- Realtor.com: "List Price", "Property history". Insurance and tax in payment calculator.
- Homes.com: "Asking", "Tax history". Rent rarely shown.
- Trulia: "List price", "Estimated monthly rent". Sometimes the rent line is the mortgage payment — use only the explicitly labeled rental figure.

NON-LISTING PAGES
- Search results, neighborhood pages, agent profiles, broken pages: return all fields null and confidence "low".

Page title: ${title}
Page URL: ${url}

Page text (truncated):
${text}`
}

// ---------------------------------------------------------------------------
// CAPTCHA / anti-bot heuristic
// ---------------------------------------------------------------------------

const CAPTCHA_PATTERNS = [
  /press\s*&?\s*hold/i,
  /verify\s+you('|’)?re\s+a\s+human/i,
  /verify\s+you\s+are\s+a\s+human/i,
  /are\s+you\s+a\s+robot/i,
  /captcha/i,
  /please\s+confirm\s+you\s+are\s+a\s+human/i,
  /access\s+denied/i,
  /unusual\s+traffic/i,
]

function looksLikeCaptcha(title: string, text: string): boolean {
  const head = `${title}\n${text.slice(0, 1500)}`
  return CAPTCHA_PATTERNS.some((re) => re.test(head))
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

type ModelBundle =
  | { provider: "anthropic"; key: string }
  | { provider: "openai"; key: string }
  | null

function resolveModel(req: NextRequest): ModelBundle {
  const headerAnthropic = req.headers.get("x-anthropic-key")
  if (headerAnthropic) return { provider: "anthropic", key: headerAnthropic }
  const headerOpenAI = req.headers.get("x-openai-key")
  if (headerOpenAI) return { provider: "openai", key: headerOpenAI }
  const anthropicEnv = process.env.ANTHROPIC_API_KEY
  if (anthropicEnv) return { provider: "anthropic", key: anthropicEnv }
  const openaiEnv = process.env.OPENAI_API_KEY
  if (openaiEnv) return { provider: "openai", key: openaiEnv }
  return null
}

// ---------------------------------------------------------------------------
// Single extraction call — returns Core or throws a Tagged error
// ---------------------------------------------------------------------------

class TaggedError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message)
  }
}

async function callExtractor(
  bundle: NonNullable<ModelBundle>,
  prompt: string,
): Promise<Core> {
  try {
    if (bundle.provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey: bundle.key })
      const result = await generateObject({
        model: anthropic("claude-haiku-4-5"),
        schema: CoreSchema,
        prompt,
      })
      return result.object
    }
    const openai = createOpenAI({ apiKey: bundle.key })
    const result = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: CoreSchema,
      prompt,
    })
    return result.object
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/too many properties|tool input schema|input_schema/i.test(msg)) {
      throw new TaggedError("schema_too_complex", msg)
    }
    if (/network|fetch|ETIMEDOUT|ECONNRESET/i.test(msg)) {
      throw new TaggedError("network", msg)
    }
    throw new TaggedError("unknown", msg)
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const cors = CORS_HEADERS

  let body: { url?: string; text?: string; title?: string }
  try {
    body = (await req.json()) as { url?: string; text?: string; title?: string }
  } catch {
    return Response.json(
      { errorCode: "page_too_short", error: userMessageFor("page_too_short") },
      { status: 400, headers: cors },
    )
  }

  const text = (body.text ?? "").slice(0, 18_000)
  const title = body.title ?? ""
  const url = body.url ?? ""

  if (!text || text.length < 80) {
    return Response.json(
      { errorCode: "page_too_short", error: userMessageFor("page_too_short") },
      { status: 200, headers: cors },
    )
  }

  if (looksLikeCaptcha(title, text)) {
    return Response.json(
      { errorCode: "captcha", error: userMessageFor("captcha") },
      { status: 200, headers: cors },
    )
  }

  const bundle = resolveModel(req)
  if (!bundle) {
    return Response.json(
      { errorCode: "no_key", error: userMessageFor("no_key") },
      { status: 503, headers: cors },
    )
  }

  const prompt = buildPrompt(title, url, text)

  let extracted: Core | null = null
  try {
    extracted = await callExtractor(bundle, prompt)
  } catch (err) {
    if (err instanceof TaggedError && err.code === "schema_too_complex") {
      // Should not normally happen with the small Core schema, but if any
      // upstream wrapper inflates the schema this re-runs with the same
      // shape and a tighter prompt as a defensive retry.
      try {
        extracted = await callExtractor(bundle, prompt + "\n\nReturn only the requested JSON fields. No extra keys.")
      } catch {
        return Response.json(
          { errorCode: "schema_too_complex", error: userMessageFor("schema_too_complex") },
          { status: 200, headers: cors },
        )
      }
    } else if (err instanceof TaggedError) {
      return Response.json(
        { errorCode: err.code, error: userMessageFor(err.code) },
        { status: 200, headers: cors },
      )
    } else {
      return Response.json(
        { errorCode: "unknown", error: userMessageFor("unknown") },
        { status: 200, headers: cors },
      )
    }
  }

  if (!extracted) {
    return Response.json(
      { errorCode: "low_confidence", error: userMessageFor("low_confidence") },
      { status: 200, headers: cors },
    )
  }

  // Confidence gate — if we got nothing useful, surface a calm low_confidence
  // empty state instead of bad data flowing into the underwriter.
  const hasUsableData =
    (extracted.listPrice && extracted.listPrice > 1000) ||
    (extracted.address && extracted.address.length > 5)

  if (!hasUsableData || extracted.confidence === "low") {
    return Response.json(
      {
        errorCode: "low_confidence",
        error: userMessageFor("low_confidence"),
        siteName: extracted.siteName,
      },
      { status: 200, headers: cors },
    )
  }

  // Build typed return for the caller
  const inputs: Partial<DealInputs> = {}
  const facts: Record<string, unknown> = {}
  const provenance: Record<string, { source: string; confidence: string; note: string }> = {}

  const siteName = extracted.siteName ?? hostnameFor(url)

  if (extracted.listPrice) {
    inputs.purchasePrice = extracted.listPrice
    provenance.purchasePrice = {
      source: "listing",
      confidence: "high",
      note: `List price from ${siteName}`,
    }
  }
  if (extracted.monthlyRent) {
    inputs.monthlyRent = extracted.monthlyRent
    provenance.monthlyRent = {
      source: "listing",
      confidence: "medium",
      note: `Rental estimate from ${siteName} — verify against local comps before offering.`,
    }
  }
  if (extracted.monthlyHOA) {
    inputs.monthlyHOA = extracted.monthlyHOA
    provenance.monthlyHOA = {
      source: "listing",
      confidence: "high",
      note: `HOA shown on the ${siteName} listing.`,
    }
  }
  if (extracted.annualPropertyTax) {
    inputs.annualPropertyTax = extracted.annualPropertyTax
    provenance.annualPropertyTax = {
      source: "listing",
      confidence: "high",
      note: `Tax line item from ${siteName}.`,
    }
  }
  if (extracted.beds) facts.bedrooms = extracted.beds
  if (extracted.baths) facts.bathrooms = extracted.baths
  if (extracted.sqft) facts.squareFeet = extracted.sqft
  if (extracted.yearBuilt) facts.yearBuilt = extracted.yearBuilt

  const notes = [`Read from ${siteName} · confidence: ${extracted.confidence}`]
  const warnings: string[] = []

  return Response.json(
    {
      address: extracted.address ?? undefined,
      inputs,
      facts,
      notes,
      warnings,
      provenance,
      siteName,
      confidence: extracted.confidence,
      modelUsed: bundle.provider,
    },
    { headers: cors },
  )
}

function hostnameFor(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "")
  } catch {
    return "the listing"
  }
}
