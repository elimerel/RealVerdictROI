import { generateObject } from "ai"
import { openai } from "@ai-sdk/openai"
import { z } from "zod"
import type { NextRequest } from "next/server"
import { visitPage } from "@/lib/browserbase"
import { enforceRateLimit } from "@/lib/ratelimit"
import { withErrorReporting } from "@/lib/observability"
import type { DealInputs } from "@/lib/calculations"

export const maxDuration = 60

// ---------------------------------------------------------------------------
// What we ask GPT to extract from the rendered page text
// ---------------------------------------------------------------------------

const PagePropertySchema = z.object({
  address: z.string().nullable().describe("Full street address including city, state, zip"),
  listPrice: z.number().nullable().describe("Listing/asking price in USD"),
  monthlyRentEstimate: z.number().nullable().describe("Monthly rent estimate shown on the page (e.g. Zestimate rent, Redfin estimate)"),
  beds: z.number().nullable().describe("Number of bedrooms"),
  baths: z.number().nullable().describe("Number of bathrooms"),
  sqft: z.number().nullable().describe("Square footage"),
  yearBuilt: z.number().nullable().describe("Year the property was built"),
  propertyType: z.string().nullable().describe("Property type: Single Family, Condo, Townhouse, Multi-family, etc."),
  monthlyHOA: z.number().nullable().describe("Monthly HOA fee in USD"),
  annualPropertyTax: z.number().nullable().describe("Annual property tax in USD"),
  annualInsurance: z.number().nullable().describe("Annual homeowners insurance in USD"),
  confidence: z.enum(["high", "medium", "low"]).describe("How confident you are in the extracted data"),
  siteName: z.string().nullable().describe("Name of the site: Zillow, Redfin, Realtor.com, etc."),
})

type PageProperty = z.infer<typeof PagePropertySchema>

// ---------------------------------------------------------------------------
// Response type — ResolverPayload shape + screenshot for the client
// ---------------------------------------------------------------------------

export type BrowseResponse = {
  address?: string
  inputs: Partial<DealInputs>
  facts: Record<string, unknown>
  notes: string[]
  warnings: string[]
  provenance: Record<string, unknown>
  screenshot: string
  siteName: string | null
  confidence: PageProperty["confidence"]
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const POST = withErrorReporting(
  "api.browse",
  async (req: NextRequest) => {
    const limited = await enforceRateLimit(req, "property-resolve")
    if (limited) return limited

    if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
      return Response.json(
        { error: "Browser integration is not configured on this server." },
        { status: 503 },
      )
    }

    let url: string
    try {
      const body = (await req.json()) as { url?: string }
      url = body?.url?.trim() ?? ""
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 })
    }

    if (!url || !url.startsWith("http")) {
      return Response.json({ error: "Provide a full listing URL." }, { status: 400 })
    }

    // -----------------------------------------------------------------------
    // Step 1: visit the page with a real browser
    // -----------------------------------------------------------------------
    const page = await visitPage(url)

    // -----------------------------------------------------------------------
    // Step 2: extract structured property data from the rendered text
    // -----------------------------------------------------------------------
    const { object: extracted } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: PagePropertySchema,
      prompt: `You are extracting real estate listing data from a rendered property listing page.
Extract every field you can find. Use null for anything not mentioned on the page.
For prices, return plain numbers (no dollar signs or commas).

Page title: ${page.title}
Page URL: ${page.finalUrl}

Page content:
${page.text}`,
    })

    // -----------------------------------------------------------------------
    // Step 3: fill gaps by calling property-resolve internally (rent, tax,
    // appreciation, mortgage rate — everything the page doesn't show)
    // -----------------------------------------------------------------------
    const notes: string[] = []
    const warnings: string[] = []
    const provenance: Record<string, unknown> = {}
    const facts: Record<string, unknown> = {}

    if (extracted.beds) facts.bedrooms = extracted.beds
    if (extracted.baths) facts.bathrooms = extracted.baths
    if (extracted.sqft) facts.squareFeet = extracted.sqft
    if (extracted.yearBuilt) facts.yearBuilt = extracted.yearBuilt
    if (extracted.propertyType) facts.propertyType = extracted.propertyType

    // Base inputs from what we read off the page
    const inputs: Partial<DealInputs> = {}
    if (extracted.listPrice)          inputs.purchasePrice = extracted.listPrice
    if (extracted.monthlyRentEstimate) inputs.monthlyRent = extracted.monthlyRentEstimate
    if (extracted.monthlyHOA)         inputs.monthlyHOA = extracted.monthlyHOA
    if (extracted.annualPropertyTax)  inputs.annualPropertyTax = extracted.annualPropertyTax
    if (extracted.annualInsurance)    inputs.annualInsurance = extracted.annualInsurance

    notes.push(`Data read from ${extracted.siteName ?? new URL(page.finalUrl).hostname} (confidence: ${extracted.confidence})`)

    // Call property-resolve to fill in anything the page didn't have
    if (extracted.address) {
      try {
        const origin = new URL(req.url).origin
        const res = await fetch(
          `${origin}/api/property-resolve?address=${encodeURIComponent(extracted.address)}`,
          { signal: AbortSignal.timeout(20000) },
        )
        if (res.ok) {
          type ResolveHit = {
            inputs?: Partial<DealInputs>
            notes?: string[]
            warnings?: string[]
            provenance?: Record<string, unknown>
            facts?: Record<string, unknown>
          }
          const resolved = (await res.json()) as ResolveHit

          // Merge — page data wins, resolved fills gaps
          if (resolved.inputs) {
            for (const [k, v] of Object.entries(resolved.inputs)) {
              const key = k as keyof DealInputs
              if (inputs[key] == null && v != null) {
                // @ts-expect-error dynamic merge
                inputs[key] = v
              }
            }
          }
          Object.assign(facts, resolved.facts)
          Object.assign(provenance, resolved.provenance)
          notes.push(...(resolved.notes ?? []))
          warnings.push(...(resolved.warnings ?? []))
        }
      } catch {
        warnings.push("Couldn't fetch supplemental estimates — analysis uses listing data only.")
      }
    }

    const result: BrowseResponse = {
      address: extracted.address ?? undefined,
      inputs,
      facts,
      notes,
      warnings,
      provenance,
      screenshot: page.screenshot,
      siteName: extracted.siteName,
      confidence: extracted.confidence,
    }

    return Response.json(result)
  },
)
