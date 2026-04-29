import { generateObject } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { z } from "zod"
import type { NextRequest } from "next/server"
import type { DealInputs } from "@/lib/calculations"

// ---------------------------------------------------------------------------
// Called by the Chrome extension / Electron browser:analyze IPC.
// Receives already-rendered page text (extracted by the content script
// directly from the DOM — no scraping needed) and returns:
//   1. Structured property data for the deal calculator
//   2. Negative risk signals scanned from the page
//   3. ARV + rehab estimates for the wholesaler/flip walk-away formula
// Model priority: Claude (Anthropic) > GPT-4o-mini (OpenAI)
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
// Schema — investor-grade extraction for both buy-and-hold AND flip analysis
// ---------------------------------------------------------------------------

const NegativeSignalSchema = z.object({
  signal: z.string(),
  excerpt: z.string().max(120),
  severity: z.enum(["high", "medium", "low"]),
})

const PageCompSchema = z.object({
  address:   z.string(),
  soldPrice: z.number(),
  beds:      z.number().nullable().optional(),
  baths:     z.number().nullable().optional(),
  sqft:      z.number().nullable().optional(),
  soldDate:  z.string().nullable().optional(),
})

const InvestorExtractionSchema = z.object({
  // Core listing facts
  address:             z.string().nullable(),
  listPrice:           z.number().nullable(),
  monthlyRentEstimate: z.number().nullable(),
  beds:                z.number().nullable(),
  baths:               z.number().nullable(),
  sqft:                z.number().nullable(),
  yearBuilt:           z.number().nullable(),
  propertyType:        z.string().nullable(),
  monthlyHOA:          z.number().nullable(),
  annualPropertyTax:   z.number().nullable(),
  annualInsurance:     z.number().nullable(),

  // Flip / wholesale fields
  arvEstimate:         z.number().nullable(),
  estimatedRehabCost:  z.number().nullable(),

  // Nearby recently sold properties from the listing page (optional)
  pageComps: z.array(PageCompSchema).optional(),

  // Risk signal scan — the most important part for deal snipers
  negativeSignals: z.array(NegativeSignalSchema),

  confidence: z.enum(["high", "medium", "low"]),
  siteName:   z.string().nullable(),
})

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(title: string, url: string, text: string): string {
  return `You are a real estate data extractor for a financial deal engine. Your job is to read listing page text and extract facts with exact accuracy.

STRICT RULES:
- Return null for ANY field not explicitly stated on the page. Never estimate, infer, or invent values.
- All money values must be plain numbers — no $ signs, no commas, no formatting.
- This data feeds a financial engine. Wrong numbers produce wrong verdicts. Accuracy over completeness.
- siteName: the platform name (e.g. "Zillow", "Redfin", "Realtor.com", "MLS").
- confidence: "high" if address and price are clearly present, "medium" if one is unclear, "low" if both are missing.
- arvEstimate: only if an ARV or "after-repair value" is explicitly stated on the page — not estimated by you.
- estimatedRehabCost: only if a rehab/renovation cost is explicitly stated on the page — not estimated by you.

RENT — CRITICAL RULE:
- monthlyRentEstimate: ONLY set this if the page shows a figure explicitly labeled as "Rent Zestimate", "Estimated rent", "Rental estimate", "Market rent", or a clearly identified monthly rental value.
- NEVER use "Est. payment", "Estimated payment", "Monthly payment", "P&I", or any figure that represents a mortgage payment, loan payment, or financing estimate. These are completely different from rent.
- On for-sale listing pages, the large monthly figure is almost always the mortgage payment — NOT rent. Do not confuse them.
- If no explicit rental estimate is shown, return null for monthlyRentEstimate.

NEGATIVE SIGNAL SCAN — scan the full text for these investor red flags:

HIGH severity:
  - Probate/estate: "subject to probate", "probate sale", "estate sale", "court approval required"
  - Foundation/structural: "foundation issue", "foundation crack", "structural damage", "structural repair"
  - Title: "encroachment", "title issues", "quiet title", "boundary dispute"
  - Liens: "tax lien", "back taxes", "judgment lien", "mechanic's lien"

MEDIUM severity:
  - Financing: "cash only", "cash buyers only", "no financing", "as-is", "sold as-is"
  - Damage: "fire damage", "water damage", "flood damage", "mold", "asbestos", "lead paint"
  - Condition: "needs work", "investor special", "TLC", "major repairs", "gut renovation"

LOW severity:
  - "short sale", "bank owned", "REO", "pre-foreclosure", "auction"
  - "easement", "right of way", "deed restriction", "HOA violation"

NEARBY RECENTLY SOLD PROPERTIES:
If the page lists recently sold or comparable nearby properties, extract up to 10 as pageComps. Each needs address, soldPrice (number), and whatever else is visible (beds, baths, sqft, soldDate).

Page title: ${title}
Page URL: ${url}

Page text:
${text}`
}

// ---------------------------------------------------------------------------
// Key resolution — try Anthropic first, fall back to OpenAI
// ---------------------------------------------------------------------------

type ModelBundle =
  | { provider: "anthropic"; key: string }
  | { provider: "openai";    key: string }
  | null

function resolveModel(req: NextRequest): ModelBundle {
  // 1. Keys forwarded by the Electron desktop app as request headers.
  //    This lets users supply their own API keys without server env vars.
  const headerAnthropic = req.headers.get("x-anthropic-key")
  if (headerAnthropic) return { provider: "anthropic", key: headerAnthropic }

  const headerOpenAI = req.headers.get("x-openai-key")
  if (headerOpenAI) return { provider: "openai", key: headerOpenAI }

  // 2. Anthropic from env (Vercel environment variable)
  const anthropicEnv = process.env.ANTHROPIC_API_KEY
  if (anthropicEnv) return { provider: "anthropic", key: anthropicEnv }

  // 3. OpenAI from env (Vercel environment variable)
  const openaiEnv = process.env.OPENAI_API_KEY
  if (openaiEnv) return { provider: "openai", key: openaiEnv }

  return null
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const cors = CORS_HEADERS

  try {
    const body = await req.json().catch(() => ({})) as {
      url?: string
      text?: string
      title?: string
    }

    if (!body.text || body.text.length < 50) {
      return Response.json({ error: "No page text provided." }, { status: 400, headers: cors })
    }

    const bundle = resolveModel(req)
    if (!bundle) {
      return Response.json(
        { error: "No AI API key found. Add an Anthropic or OpenAI key in Settings." },
        { status: 503, headers: cors },
      )
    }

    const prompt = buildPrompt(
      body.title ?? "",
      body.url ?? "",
      body.text.slice(0, 20000),
    )

    // Step 1: AI extraction
    let extracted: z.infer<typeof InvestorExtractionSchema>

    if (bundle.provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey: bundle.key })
      const result = await generateObject({
        model: anthropic("claude-haiku-4-5"),
        schema: InvestorExtractionSchema,
        prompt,
      })
      extracted = result.object
    } else {
      const openai = createOpenAI({ apiKey: bundle.key })
      const result = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: InvestorExtractionSchema,
        prompt,
      })
      extracted = result.object
    }

    // Step 2: Build DealInputs from extracted data
    const inputs: Partial<DealInputs> = {}
    const notes: string[] = []
    const warnings: string[] = []
    const facts: Record<string, unknown> = {}

    if (extracted.listPrice)           inputs.purchasePrice     = extracted.listPrice
    if (extracted.monthlyRentEstimate) inputs.monthlyRent       = extracted.monthlyRentEstimate
    if (extracted.monthlyHOA)          inputs.monthlyHOA        = extracted.monthlyHOA
    if (extracted.annualPropertyTax)   inputs.annualPropertyTax = extracted.annualPropertyTax
    if (extracted.annualInsurance)     inputs.annualInsurance   = extracted.annualInsurance
    if (extracted.beds)                facts.bedrooms           = extracted.beds
    if (extracted.baths)               facts.bathrooms          = extracted.baths
    if (extracted.sqft)                facts.squareFeet         = extracted.sqft
    if (extracted.yearBuilt)           facts.yearBuilt          = extracted.yearBuilt
    if (extracted.propertyType)        facts.propertyType       = extracted.propertyType

    const modelLabel = bundle.provider === "anthropic" ? "Claude Haiku" : "GPT-4o-mini"
    const siteName = extracted.siteName ?? new URL(body.url ?? "https://unknown").hostname
    notes.push(
      `Read from ${siteName} via ${modelLabel} · confidence: ${extracted.confidence}`
    )

    // Surface high-severity signals as warnings so they appear in the UI
    for (const sig of extracted.negativeSignals) {
      if (sig.severity === "high") {
        warnings.push(`⚠ ${sig.signal}: "${sig.excerpt}"`)
      }
    }

    // Build per-field provenance so the distribution engine knows which inputs
    // are solid (extracted from the listing) vs defaulted.
    const provenance: Record<string, { source: string; confidence: string; note: string }> = {}
    if (extracted.listPrice) {
      provenance.purchasePrice = { source: "zillow-listing", confidence: "high", note: `List price from ${siteName}` }
    }
    if (extracted.monthlyRentEstimate) {
      provenance.monthlyRent = { source: "zillow-listing", confidence: "medium", note: `Rent Zestimate from ${siteName} — verify with local rental comps before offering` }
    }
    if (extracted.monthlyHOA) {
      provenance.monthlyHOA = { source: "zillow-listing", confidence: "high", note: `HOA fee stated on listing` }
    }
    if (extracted.annualPropertyTax) {
      provenance.annualPropertyTax = { source: "zillow-listing", confidence: "high", note: `Property tax from listing` }
    }
    if (extracted.annualInsurance) {
      provenance.annualInsurance = { source: "zillow-listing", confidence: "medium", note: `Insurance shown on listing — get a real quote before offering` }
    }

    return Response.json(
      {
        address:         extracted.address ?? undefined,
        inputs,
        facts,
        notes,
        warnings,
        provenance,
        siteName:        extracted.siteName,
        confidence:      extracted.confidence,
        negativeSignals: extracted.negativeSignals,
        arvEstimate:     extracted.arvEstimate ?? undefined,
        rehabCostEstimate: extracted.estimatedRehabCost ?? undefined,
        modelUsed:       bundle.provider,
        pageComps:       extracted.pageComps && extracted.pageComps.length > 0
                           ? extracted.pageComps : undefined,
      },
      { headers: cors },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error."
    return Response.json({ error: message }, { status: 500, headers: cors })
  }
}
