import { generateObject } from "ai"
import { openai } from "@ai-sdk/openai"
import { z } from "zod"
import type { NextRequest } from "next/server"
import type { DealInputs } from "@/lib/calculations"

// ---------------------------------------------------------------------------
// This endpoint is called by the Chrome extension.
// It receives already-rendered page text (extracted by the content script
// directly from the DOM — no scraping, no Browserbase needed) and returns
// structured property data + supplemental estimates from property-resolve.
// ---------------------------------------------------------------------------

export const maxDuration = 30

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

const PagePropertySchema = z.object({
  address:              z.string().nullable(),
  listPrice:            z.number().nullable(),
  monthlyRentEstimate:  z.number().nullable(),
  beds:                 z.number().nullable(),
  baths:                z.number().nullable(),
  sqft:                 z.number().nullable(),
  yearBuilt:            z.number().nullable(),
  propertyType:         z.string().nullable(),
  monthlyHOA:           z.number().nullable(),
  annualPropertyTax:    z.number().nullable(),
  annualInsurance:      z.number().nullable(),
  confidence:           z.enum(["high", "medium", "low"]),
  siteName:             z.string().nullable(),
})

export async function POST(req: NextRequest) {
  // CORS headers go on EVERY response — including errors — so the extension
  // never sees a bare network failure instead of the real error message.
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

    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { error: "OPENAI_API_KEY is not configured on the server." },
        { status: 503, headers: cors },
      )
    }

    // Step 1: AI extraction from the rendered page text
    const { object: extracted } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: PagePropertySchema,
      prompt: `Extract real estate listing data from this rendered page text.
Return null for any field not found. All money values should be plain numbers.

Page title: ${body.title ?? ""}
Page URL: ${body.url ?? ""}

Page text:
${body.text.slice(0, 20000)}`,
    })

    // Step 2: fill gaps with property-resolve (rent estimate, tax, rate, appreciation)
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

    notes.push(
      `Read directly from ${extracted.siteName ?? new URL(body.url ?? "https://unknown").hostname} · confidence: ${extracted.confidence}`
    )

    if (extracted.address) {
      try {
        const origin = new URL(req.url).origin
        const res = await fetch(
          `${origin}/api/property-resolve?address=${encodeURIComponent(extracted.address)}`,
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
              // @ts-expect-error dynamic merge
              inputs[key] = v
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

    return Response.json(
      {
        address:    extracted.address ?? undefined,
        inputs,
        facts,
        notes,
        warnings,
        provenance: {},
        siteName:   extracted.siteName,
        confidence: extracted.confidence,
      },
      { headers: cors },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error."
    return Response.json({ error: message }, { status: 500, headers: cors })
  }
}
