// ---------------------------------------------------------------------------
// Extractor entry point — Stages 2 & 3 of the pipeline
// ---------------------------------------------------------------------------
//
// Pipeline overview (full picture lives in docs/architecture):
//   Stage 1 — Host gate         (lib/listing-detect)
//   Stage 2 — Page signal scan  (lib/extractor/signals.ts)
//   Stage 3 — LLM deep read     (this file)
//   Stage 4 — Underwriting math (lib/underwriting/analyse.ts)
//
// Stage 1 is the caller's responsibility. We run Stages 2 → 3 here.
// Each stage can short-circuit with a structured ExtractErrorCode the
// renderer maps to calm in-panel copy. The renderer never sees a raw
// API error.
// ---------------------------------------------------------------------------

import type {
  ExtractInput,
  ExtractResult,
  ListingFacts,
  PageKind,
  Confidence,
  ExtractErrorCode,
  FactsMeta,
  FieldMeta,
} from "./types"
import { userMessageFor } from "./types"
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt"
import { looksLikeCaptcha, MIN_PAGE_TEXT_LENGTH, hostnameFor } from "./heuristics"
import { scanSignals } from "./signals"

export type Provider =
  | { kind: "anthropic"; apiKey: string }
  | { kind: "openai"; apiKey: string }

const ANTHROPIC_MODEL = "claude-haiku-4-5"
const OPENAI_MODEL = "gpt-4o-mini"

const VALID_KINDS: PageKind[] = [
  "listing-rental", "listing-flip", "listing-land", "listing-newbuild",
  "listing-multifamily", "search-results", "neighborhood", "agent-profile",
  "captcha", "non-real-estate", "unknown",
]

// ---------------------------------------------------------------------------
// Coercion — defensive parsing of model output. Models occasionally return
// numbers as strings, "n/a"/"null" strings, or extra keys. We coerce.
// ---------------------------------------------------------------------------

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "")
    if (!cleaned || cleaned.toLowerCase() === "null" || cleaned.toLowerCase() === "n/a") return null
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function coerceString(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t || t.toLowerCase() === "null" || t.toLowerCase() === "n/a") return null
  return t
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => coerceString(x))
    .filter((x): x is string => x !== null)
    .slice(0, 10)
}

function coerceFacts(raw: Record<string, unknown> | undefined): ListingFacts {
  const f = raw ?? {}
  return {
    address:            coerceString(f.address),
    city:               coerceString(f.city),
    state:              coerceString(f.state),
    zip:                coerceString(f.zip),

    listPrice:          coerceNumber(f.listPrice ?? f.price),
    originalListPrice:  coerceNumber(f.originalListPrice),
    daysOnMarket:       coerceNumber(f.daysOnMarket),
    priceHistoryNote:   coerceString(f.priceHistoryNote),

    beds:               coerceNumber(f.beds ?? f.bedrooms),
    baths:              coerceNumber(f.baths ?? f.bathrooms),
    fullBaths:          coerceNumber(f.fullBaths),
    halfBaths:          coerceNumber(f.halfBaths),
    sqft:               coerceNumber(f.sqft ?? f.squareFeet),
    lotSqft:            coerceNumber(f.lotSqft),
    yearBuilt:          coerceNumber(f.yearBuilt),
    garageSpaces:       coerceNumber(f.garageSpaces),
    stories:            coerceNumber(f.stories),
    propertyType:       coerceString(f.propertyType),

    monthlyRent:        coerceNumber(f.monthlyRent ?? f.rent),
    monthlyHOA:         coerceNumber(f.monthlyHOA ?? f.hoa),
    annualPropertyTax:  coerceNumber(f.annualPropertyTax ?? f.tax ?? f.propertyTax),
    annualInsuranceEst: coerceNumber(f.annualInsuranceEst ?? f.insurance),

    conditionNotes:     coerceString(f.conditionNotes),
    riskFlags:          coerceStringArray(f.riskFlags),

    mlsNumber:          coerceString(f.mlsNumber),
    listingDate:        coerceString(f.listingDate),
    listingRemarks:     coerceString(f.listingRemarks),
    schoolRating:       coerceNumber(f.schoolRating),
    walkScore:          coerceNumber(f.walkScore),

    siteName:           coerceString(f.siteName),
  }
}

function coerceKind(v: unknown): PageKind {
  if (typeof v === "string" && (VALID_KINDS as string[]).includes(v)) return v as PageKind
  return "unknown"
}

function coerceConfidence(v: unknown): Confidence {
  if (v === "high" || v === "medium" || v === "low") return v
  return "low"
}

function coerceMeta(raw: unknown): FactsMeta {
  if (!raw || typeof raw !== "object") return {}
  const out: FactsMeta = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue
    const obj = v as Record<string, unknown>
    const m: FieldMeta = {
      source: "listing",
      confidence: coerceConfidence(obj.confidence),
      note: coerceString(obj.note) ?? undefined,
    }
    out[k as keyof ListingFacts] = m
  }
  return out
}

function classifyError(err: unknown): ExtractErrorCode {
  const msg = err instanceof Error ? err.message : String(err)
  if (/too many properties|tool input schema|input_schema/i.test(msg)) return "schema_too_complex"
  if (/network|fetch|ETIMEDOUT|ECONNRESET|abort|aborted/i.test(msg)) return "network"
  return "unknown"
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

type RawResponse = {
  kind?: unknown
  confidence?: unknown
  facts?: Record<string, unknown>
  meta?: unknown
  take?: unknown
}

function parseModelOutput(raw: string): RawResponse | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as RawResponse
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Provider calls — Anthropic / OpenAI. Plain JSON output, no tool-use,
// so the wide schema doesn't trip Anthropic's property cap.
// ---------------------------------------------------------------------------

async function callAnthropic(apiKey: string, input: ExtractInput, signal?: AbortSignal): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    }),
    signal: signal ?? AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`)
  }
  const json = await res.json() as { content?: Array<{ text?: string }> }
  return json.content?.[0]?.text ?? ""
}

async function callOpenAI(apiKey: string, input: ExtractInput, signal?: AbortSignal): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    }),
    signal: signal ?? AbortSignal.timeout(25_000),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 200)}`)
  }
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  return json.choices?.[0]?.message?.content ?? ""
}

// ---------------------------------------------------------------------------
// Default provenance for facts the model returned. Each field gets a meta
// entry so the panel can show a confidence dot. The model's per-field meta
// (when supplied) overrides these defaults.
// ---------------------------------------------------------------------------

function buildDefaultMeta(facts: ListingFacts, modelMeta: FactsMeta): FactsMeta {
  const out: FactsMeta = {}
  const addIf = (k: keyof ListingFacts, conf: Confidence, note?: string) => {
    const v = facts[k]
    const has = Array.isArray(v) ? v.length > 0 : v != null
    if (has) out[k] = { source: "listing", confidence: conf, note }
  }
  // High-confidence-by-default fields (these are typically labeled clearly)
  addIf("listPrice",          "high")
  addIf("address",            "high")
  addIf("beds",               "high")
  addIf("baths",              "high")
  addIf("sqft",               "high")
  addIf("yearBuilt",          "high")
  addIf("monthlyHOA",         "high")
  addIf("annualPropertyTax",  "high")
  addIf("mlsNumber",          "high")

  // Medium-by-default — these come from model estimates that we want the
  // user to see flagged so they know to verify.
  addIf("monthlyRent",        "medium", "Rental estimate from listing — verify against local comps before offering.")
  addIf("annualInsuranceEst", "medium", "Listing-side insurance estimate — your actual quote may differ.")
  addIf("schoolRating",       "medium")
  addIf("walkScore",          "medium")

  // Apply model overrides on top.
  for (const [k, m] of Object.entries(modelMeta)) {
    out[k as keyof ListingFacts] = m
  }
  return out
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export async function extractFromPage(
  input: ExtractInput,
  provider: Provider,
  options: { signal?: AbortSignal } = {},
): Promise<ExtractResult> {
  // Pre-flight 1: page too short to bother
  if (!input.text || input.text.length < MIN_PAGE_TEXT_LENGTH) {
    return errorResult("page_too_short", { siteName: hostnameFor(input.url) })
  }

  // Pre-flight 2: captcha / verification screens
  if (looksLikeCaptcha(input.title, input.text)) {
    return errorResult("captcha", { siteName: hostnameFor(input.url) })
  }

  // Stage 2: page signal scan
  const signals = scanSignals(input.text)
  if (signals.looksLikeSearchResults) {
    return errorResult("search_results_page", { siteName: hostnameFor(input.url) })
  }
  if (!signals.looksLikeListing) {
    return errorResult("no_signals", { siteName: hostnameFor(input.url) })
  }

  // Stage 3: LLM deep read
  let raw: string
  try {
    raw = provider.kind === "anthropic"
      ? await callAnthropic(provider.apiKey, input, options.signal)
      : await callOpenAI(provider.apiKey, input, options.signal)
  } catch (err) {
    return errorResult(classifyError(err))
  }

  const parsed = parseModelOutput(raw)
  if (!parsed) return errorResult("low_confidence")

  const kind = coerceKind(parsed.kind)
  const confidence = coerceConfidence(parsed.confidence)
  const facts = coerceFacts(parsed.facts)
  const modelMeta = coerceMeta(parsed.meta)
  const take = coerceString(parsed.take)

  // Honor the model's own classification for sentinel kinds.
  if (kind === "captcha") {
    return errorResult("captcha", { siteName: facts.siteName ?? hostnameFor(input.url) })
  }
  if (kind === "search-results") {
    return errorResult("search_results_page", { siteName: facts.siteName ?? hostnameFor(input.url) })
  }

  const isListingKind = kind.startsWith("listing-")
  const hasUsableData =
    (facts.listPrice && facts.listPrice > 1000) ||
    (facts.address && facts.address.length > 5)

  if (!isListingKind || !hasUsableData || confidence === "low") {
    return errorResult("low_confidence", {
      siteName: facts.siteName ?? hostnameFor(input.url),
      partial: facts,
    })
  }

  const meta = buildDefaultMeta(facts, modelMeta)

  return {
    ok: true,
    kind,
    confidence,
    facts: {
      ...facts,
      siteName: facts.siteName ?? hostnameFor(input.url),
    },
    meta,
    take,
    modelUsed: provider.kind,
  }
}

function errorResult(
  code: ExtractErrorCode,
  extra: { siteName?: string | null; partial?: Partial<ListingFacts> } = {},
): ExtractResult {
  return {
    ok: false,
    errorCode: code,
    message: userMessageFor(code),
    partial: extra.partial ?? (extra.siteName ? { siteName: extra.siteName } : undefined),
  }
}

// ---------------------------------------------------------------------------
// Public re-exports
// ---------------------------------------------------------------------------

export type {
  ExtractInput,
  ExtractResult,
  ListingFacts,
  PageKind,
  Confidence,
  ExtractErrorCode,
  FactsMeta,
  FieldMeta,
} from "./types"
export { userMessageFor, isListing } from "./types"
export { scanSignals } from "./signals"
