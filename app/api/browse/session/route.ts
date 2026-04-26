import type { NextRequest } from "next/server"
import { createBrowseSession, endBrowseSession, actInSession } from "@/lib/browserbase"
import { enforceRateLimit } from "@/lib/ratelimit"
import { withErrorReporting } from "@/lib/observability"

export const maxDuration = 60

// POST — create a new session, optionally navigate to initialUrl, return first screenshot
export const POST = withErrorReporting(
  "api.browse.session.create",
  async (req: NextRequest) => {
    const limited = await enforceRateLimit(req, "property-resolve")
    if (limited) return limited

    if (!process.env.BROWSERBASE_API_KEY) {
      return Response.json({ error: "Browser integration not configured." }, { status: 503 })
    }

    const { url } = (await req.json().catch(() => ({}))) as { url?: string }

    const sessionId = await createBrowseSession()

    // Navigate to initial URL and capture first screenshot
    const startUrl = url && url.startsWith("http") ? url : "https://zillow.com"
    const state = await actInSession(sessionId, { type: "navigate", url: startUrl })

    return Response.json({ sessionId, ...state })
  },
)

// DELETE — end a session
export const DELETE = withErrorReporting(
  "api.browse.session.end",
  async (req: NextRequest) => {
    const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string }
    if (sessionId) await endBrowseSession(sessionId)
    return Response.json({ ok: true })
  },
)
