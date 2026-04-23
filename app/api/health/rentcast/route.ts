import { NextResponse } from "next/server";
import { logEvent } from "@/lib/observability";

// ---------------------------------------------------------------------------
// RentCast uptime + auth health check (§16.U #4 / §20.9 #6).
//
// Background: the entire strategic value of the product silently vanished
// once when a RentCast key rotated server-side and nothing alerted us — the
// resolver fell back to AVMs / public-records-only and continued returning
// successful 200s for weeks. Sentry's general 5xx alerts didn't fire because
// the resolver swallowed the auth error into a benign `notes` line. The
// only fix that actually prevents this is an external pinger that calls
// RentCast on a fixed interval with a known-good address and treats 401 /
// 403 as a paging-grade incident, separately from a generic 500.
//
// Ops contract:
//   - GET /api/health/rentcast → JSON `{ status, kind?, lastCheckedMs? }`.
//     `status` is one of "ok" | "auth-failure" | "rate-limited" | "down".
//   - HTTP status code mirrors `status`:
//     * 200 → ok
//     * 503 → any non-ok (auth-failure, rate-limited, down, no-key, etc.)
//   - The response body NEVER contains the raw API error string, the API
//     key, or the probe address. Same sanitization contract as the user
//     UI (§16.U #4 / §20.9 #5).
//   - Logs to observability with structured kind/status fields so Sentry
//     can alert on `kind = "auth"` separately from `kind = "down"`.
//
// Wire this up in UptimeRobot / Better Uptime / Healthchecks.io with:
//   - Probe interval: 5 min (RentCast is on a daily quota; 5 min keeps us
//     well under any realistic rate limit).
//   - Alert when: status code !== 200 for 2 consecutive checks (avoids
//     paging on a single transient blip).
//   - Page-grade routing: any response containing `"status":"auth-failure"`
//     in the JSON body — that's the silent-key-rotation case that already
//     cost us once.
//
// Probe address is taken from PROBE_ADDRESS env var (set to a publicly
// known address that RentCast definitely has on file — e.g. an iconic
// downtown landmark in a major MSA). Falls back to a hardcoded default
// so the route still works on first deploy. The probe address itself
// is treated as low-sensitivity (not a customer's address) but we still
// don't echo it in the response.
// ---------------------------------------------------------------------------

// Empire State Building. Public landmark, definitely indexed by RentCast.
// Override via env to a property in your highest-volume market if you'd
// rather monitor an address that exercises your hottest cache region.
const DEFAULT_PROBE_ADDRESS = "20 W 34th St, New York, NY 10001";

type HealthStatus =
  | { status: "ok" }
  | { status: "auth-failure"; statusCode: 401 | 403 }
  | { status: "rate-limited"; statusCode: 429 }
  | { status: "down"; statusCode?: number; reason: "http" | "network" | "no-data" | "bad-payload" }
  | { status: "no-key" };

export async function GET() {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    const body: HealthStatus = { status: "no-key" };
    logEvent("health.rentcast", { status: "no-key" });
    return NextResponse.json(body, { status: 503 });
  }

  const probeAddress = process.env.RENTCAST_PROBE_ADDRESS ?? DEFAULT_PROBE_ADDRESS;
  const url = new URL("https://api.rentcast.io/v1/properties");
  url.searchParams.set("address", probeAddress);

  const startedAt = Date.now();
  let result: HealthStatus;
  try {
    const res = await fetch(url.toString(), {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      // Don't cache health-check responses.
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      result = { status: "auth-failure", statusCode: res.status as 401 | 403 };
    } else if (res.status === 429) {
      result = { status: "rate-limited", statusCode: 429 };
    } else if (res.status === 404) {
      // 404 on a known-good address means RentCast lost the record — treat
      // as "down" rather than "ok", since something's broken. Operators
      // can swap PROBE_ADDRESS if they suspect false-positive 404s.
      result = { status: "down", statusCode: 404, reason: "no-data" };
    } else if (!res.ok) {
      result = { status: "down", statusCode: res.status, reason: "http" };
    } else {
      // Validate the body has at least the basic property shape so we
      // don't return "ok" on a degraded RentCast that returns 200 with
      // empty results.
      const data = (await res.json().catch(() => null)) as unknown;
      const property = Array.isArray(data) ? data[0] : data;
      const looksValid =
        property !== null &&
        typeof property === "object" &&
        ("formattedAddress" in (property as object) ||
          "bedrooms" in (property as object) ||
          "bathrooms" in (property as object));
      result = looksValid
        ? { status: "ok" }
        : { status: "down", reason: "bad-payload" };
    }
  } catch {
    result = { status: "down", reason: "network" };
  }

  const elapsedMs = Date.now() - startedAt;
  logEvent("health.rentcast", {
    status: result.status,
    statusCode: "statusCode" in result ? result.statusCode : undefined,
    elapsedMs,
  });

  return NextResponse.json(result, {
    status: result.status === "ok" ? 200 : 503,
    headers: {
      // Make the check pollable without polluting any CDN cache.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
