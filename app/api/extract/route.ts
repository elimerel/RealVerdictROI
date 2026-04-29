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
  return `You are a professional real estate deal underwriter for high-velocity investors (wholesalers and flippers). Your job is to extract structured data from this listing page with maximum precision.

EXTRACTION RULES:
- Return null for any field not found. All money values = plain numbers (no $ signs).
- siteName: the platform name (e.g. "Zillow", "Redfin", "Realtor.com", "MLS").
- confidence: "high" if you found the address and list price clearly, "medium" if you inferred values, "low" if the page is sparse.

NEGATIVE SIGNAL SCAN — CRITICAL:
Search the FULL page text for these investor red flags and list EVERY one you find. Be thorough — these signals can kill a deal.

HIGH severity (walk away immediately):
  - Probate/estate: "subject to probate", "probate sale", "estate sale", "court approval"
  - Foundation: "foundation", "foundation issue", "foundation crack", "structural"
  - Title: "encroachment", "title issues", "quiet title", "boundary dispute"
  - Liens: "tax lien", "back taxes", "judgment lien", "mechanic's lien"

MEDIUM severity (investigate before offering):
  - Financing: "cash only", "cash buyers only", "no financing", "as-is", "sold as-is"
  - Damage: "fire damage", "water damage", "flood damage", "mold", "asbestos", "lead paint"
  - Condition: "needs work", "investor special", "TLC", "major repairs", "gut renovation"

LOW severity (note for due diligence):
  - "short sale", "bank owned", "REO", "pre-foreclosure", "auction"
  - "easement", "right of way", "deed restriction", "HOA violation"

NEARBY RECENTLY SOLD PROPERTIES:
If the page lists "recently sold", "similar homes sold", "comparable sales", or any nearby sold properties, extract up to 10 as pageComps. Each should have address, soldPrice, beds, baths, sqft (if visible), and soldDate. These are sale comps that help anchor fair value. Extract them even if they're only partially visible.

ARV ESTIMATE:
Based on all visible data (neighborhood, comps, Zestimate, sold prices nearby, $/sqft patterns), estimate the After Repair Value — what this property is worth fully renovated. If you see a "Zestimate", nearby sold prices, or $/sqft data, use it. If the listing says "recently renovated", the ARV ≈ list price.

REHAB COST ESTIMATE:
Based on condition signals in the listing, estimate rehab cost:
- "Move-in ready", "fully renovated", "turnkey" → $0–$5,000
- "Needs cosmetic updates", "dated kitchen/bath" → $15,000–$40,000
- "Needs work", "TLC", "investor special" → $40,000–$80,000
- "Major repairs", "gut renovation", fire/water damage → $80,000–$150,000+
Return null if you cannot make a reasonable estimate.

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
        model: anthropic("claude-sonnet-4-6"),
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

    const modelLabel = bundle.provider === "anthropic" ? "Claude" : "GPT-4o-mini"
    notes.push(
      `Read from ${extracted.siteName ?? new URL(body.url ?? "https://unknown").hostname} via ${modelLabel} · confidence: ${extracted.confidence}`
    )

    // Step 3: Fill gaps via property-resolve.
    // skipRentcast=true — /api/extract is an automatic analysis path;
    // RentCast must never fire automatically (cost leak prevention).
    if (extracted.address) {
      try {
        const origin = new URL(req.url).origin
        const res = await fetch(
          `${origin}/api/property-resolve?address=${encodeURIComponent(extracted.address)}&skipRentcast=true`,
          { signal: AbortSignal.timeout(15000) },
        )
        if (res.ok) {
          const resolved = await res.json() as {
            inputs?: Partial<DealInputs>
            notes?: string[]
            warnings?: string[]
            facts?: Record<string, unknown>
          }
          for (const [k, v] of Object.entries(resolved.inputs ?? {})) {
            const key = k as keyof DealInputs
            if (inputs[key] == null && v != null) {
              (inputs as Record<string, unknown>)[key] = v
            }
          }
          Object.assign(facts, resolved.facts)
          notes.push(...(resolved.notes ?? []))
          warnings.push(...(resolved.warnings ?? []))
        }
      } catch {
        warnings.push("Supplemental estimates unavailable — using listing data only.")
      }
    }

    // Surface high-severity signals as warnings so they appear in the UI
    for (const sig of extracted.negativeSignals) {
      if (sig.severity === "high") {
        warnings.push(`⚠ ${sig.signal}: "${sig.excerpt}"`)
      }
    }

    return Response.json(
      {
        address:         extracted.address ?? undefined,
        inputs,
        facts,
        notes,
        warnings,
        provenance:      {},
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
