import type { NextRequest } from "next/server"
import { extractFromPage, userMessageFor, type Provider } from "@/lib/extractor"

// ---------------------------------------------------------------------------
// /api/extract
//
// Thin wrapper over lib/extractor. The heavy lifting — single-pass kind
// classification + fact extraction + UI-safe error coding — lives in the
// shared module so the Electron main process and (future) browser
// extension can use exactly the same brain.
//
// We never return raw API errors. Every failure mode (no_key,
// page_too_short, captcha, low_confidence, schema_too_complex, network,
// unknown) collapses to a structured errorCode + UI-safe message.
// ---------------------------------------------------------------------------

export const maxDuration = 30

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Anthropic-Key, X-OpenAI-Key",
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

function resolveProvider(req: NextRequest): Provider | null {
  const ah = req.headers.get("x-anthropic-key")
  if (ah) return { kind: "anthropic", apiKey: ah }
  const oh = req.headers.get("x-openai-key")
  if (oh) return { kind: "openai", apiKey: oh }
  if (process.env.ANTHROPIC_API_KEY) {
    return { kind: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY }
  }
  if (process.env.OPENAI_API_KEY) {
    return { kind: "openai", apiKey: process.env.OPENAI_API_KEY }
  }
  return null
}

export async function POST(req: NextRequest) {
  let body: { url?: string; text?: string; title?: string }
  try {
    body = (await req.json()) as { url?: string; text?: string; title?: string }
  } catch {
    return Response.json(
      { ok: false, errorCode: "page_too_short", message: userMessageFor("page_too_short") },
      { status: 400, headers: CORS },
    )
  }

  const provider = resolveProvider(req)
  if (!provider) {
    return Response.json(
      { ok: false, errorCode: "no_key", message: userMessageFor("no_key") },
      { status: 503, headers: CORS },
    )
  }

  const result = await extractFromPage(
    {
      url: body.url ?? "",
      title: body.title ?? "",
      text: body.text ?? "",
    },
    provider,
  )

  return Response.json(result, { headers: CORS })
}
