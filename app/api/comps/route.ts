import type { NextRequest } from "next/server";
import { fetchComps } from "@/lib/comps";
import { enforceRateLimit } from "@/lib/ratelimit";
import { withErrorReporting } from "@/lib/observability";

// ---------------------------------------------------------------------------
// /api/comps?address=...&beds=3&baths=2&sqft=1500&radius=1
//
// Thin wrapper over lib/comps.ts so the frontend can fetch comps standalone
// (e.g. for refresh or future filter UI).
// ---------------------------------------------------------------------------

export const GET = withErrorReporting("api.comps", async (req: NextRequest) => {
  const limited = await enforceRateLimit(req, "comps");
  if (limited) return limited;

  if (!process.env.RENTCAST_API_KEY) {
    return Response.json(
      { error: "RENTCAST_API_KEY is not configured." },
      { status: 503 },
    );
  }

  const params = req.nextUrl.searchParams;
  const address = params.get("address")?.trim();
  if (!address || address.length < 5) {
    return Response.json(
      { error: "Provide a full street address." },
      { status: 400 },
    );
  }

  const result = await fetchComps({
    address,
    beds: numberOrUndef(params.get("beds")),
    baths: numberOrUndef(params.get("baths")),
    sqft: numberOrUndef(params.get("sqft")),
    radiusMiles: numberOrUndef(params.get("radius")),
    propertyType: params.get("propertyType") ?? undefined,
  });

  if (!result) {
    return Response.json({ error: "Comps unavailable." }, { status: 502 });
  }
  return Response.json(result);
});

function numberOrUndef(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return isFinite(n) ? n : undefined;
}
