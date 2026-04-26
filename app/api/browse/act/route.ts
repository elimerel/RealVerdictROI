import type { NextRequest } from "next/server"
import { actInSession, type BrowseAction } from "@/lib/browserbase"
import { enforceRateLimit } from "@/lib/ratelimit"
import { withErrorReporting } from "@/lib/observability"

export const maxDuration = 60

export const POST = withErrorReporting(
  "api.browse.act",
  async (req: NextRequest) => {
    const limited = await enforceRateLimit(req, "property-resolve")
    if (limited) return limited

    if (!process.env.BROWSERBASE_API_KEY) {
      return Response.json({ error: "Browser integration not configured." }, { status: 503 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: string
      action?: BrowseAction
    }

    if (!body.sessionId || !body.action) {
      return Response.json({ error: "sessionId and action are required." }, { status: 400 })
    }

    const state = await actInSession(body.sessionId, body.action)
    return Response.json(state)
  },
)
