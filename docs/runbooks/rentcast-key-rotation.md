# RentCast key rotation & auth-failure runbook

**Owner:** RealVerdict ops · **Severity if RentCast auth fails:** P1
**Related code:** `app/api/property-resolve/route.ts`, `app/api/health/rentcast/route.ts`
**Related Sentry rules:** `event.area = "api.property-resolve.rentcast"` AND `extra.kind = "auth"`

---

## Why this runbook exists

RentCast supplies the public-records facts and comp pool that power every
analysis. When the key rotates, expires, or gets revoked, the resolver
silently falls back to listing-data-only mode and continues returning
successful 200s — but every analysis loses the comp-derived fair value,
the homestead-trap detector, and the §16.D dedupe / scoring pipeline.

This silently happened once and was only discovered during a strategy-reset
audit (§16.U). The detection / recovery path below exists to make sure it
never silently happens again.

## How we know there's an incident

There are **three independent signals**, and any one of them should trigger
this runbook. We deliberately route them differently so a single source
failing (Sentry rate-limited, UptimeRobot down, etc.) doesn't blind us.

1. **Uptime check failure** (primary). UptimeRobot pings
   `GET https://<host>/api/health/rentcast` every 5 min. If 2 consecutive
   checks return non-200, page the on-call.
   - Body field `"status": "auth-failure"` → key is bad. Skip diagnostics,
     go straight to **Rotate the key** below.
   - Body field `"status": "rate-limited"` → quota exhausted. Rotate or
     upgrade plan; key itself is still valid.
   - Body field `"status": "down"` with `"reason": "http"` → RentCast is
     having an outage; defer to their status page before rotating.

2. **Sentry alert** on `area = "api.property-resolve.rentcast"`,
   `extra.kind = "auth"`. Fires per request, so set the alert threshold to
   3 events in 5 min to avoid paging on a single user-side hiccup.

3. **Resolver `notes` audit**. Run the SQL below against the `deals` table
   weekly to spot patterns of "Couldn't reach the property-records database"
   user-visible notes — that's the sanitized copy that shows up when
   RentCast is down.

   ```sql
   SELECT date_trunc('day', created_at) AS day,
          count(*) FILTER (WHERE notes::text ILIKE '%couldn%t reach the property-records database%') AS rentcast_down,
          count(*) AS total
   FROM deals
   WHERE created_at > now() - interval '7 days'
   GROUP BY 1
   ORDER BY 1 DESC;
   ```

## Rotate the RentCast key

Time budget: 5 minutes if you have a backup key in 1Password; 15 minutes
if you have to provision one through the dashboard.

1. **Check for a backup key first.** We keep a hot-spare in 1Password under
   `RealVerdict / RentCast / spare`. If present, **use it** — provisioning
   from the dashboard takes longer.

2. **If no spare is available, provision a new key.**
   - Sign in to <https://app.rentcast.io> with the ops account
     (creds in 1Password under `RealVerdict / RentCast / dashboard`).
   - **Settings → API Keys → Create new key**. Label it
     `realverdict-prod-<YYYY-MM-DD>`.
   - Copy the new key into 1Password as `current` (move the old `current`
     to `previous` if it's still alive — sometimes you can rescue it).

3. **Replace the key in Vercel.**
   - <https://vercel.com/realverdict/realverdictroi/settings/environment-variables>
   - Edit `RENTCAST_API_KEY`. Apply to **Production**, **Preview**, and
     **Development** (so engineers don't get hit with auth failures locally
     on the next pull).
   - Vercel will trigger a redeploy automatically; if it doesn't, redeploy
     the `production` branch manually.

4. **Verify recovery (≤ 2 min after deploy).**
   - `curl -i https://<host>/api/health/rentcast` → expect HTTP 200 and
     `"status":"ok"` in the body.
   - Run a real address through the homepage. The PDF "How we got these
     numbers" derivation should show comp-derived numbers, not
     listing-data-only.
   - Check Sentry — the `api.property-resolve.rentcast` `kind=auth` rate
     should drop to zero within a few minutes.

5. **Bump the resolver cache version** if any stale cached entries might
   be carrying the "Couldn't reach the property-records database" sanitized
   note from the outage. This forces a re-resolve on the next analysis.
   - Edit `app/api/property-resolve/route.ts`, increment `CACHE_VERSION`
     (e.g. `v14` → `v15`). Add a one-line comment in the version table
     pointing at the incident date.
   - Edit `app/_components/HomeAnalyzeForm.tsx`, increment
     `AUTOFILL_CACHE_VERSION`.
   - Push, redeploy.

6. **Post-incident.** Open a one-line incident note in Linear with:
   - Detection signal (uptime / sentry / SQL audit).
   - Time to detect and time to recover.
   - Whether the new key was a hot-spare or freshly provisioned.
   - Whether any user-facing analysis was returned with degraded data
     during the window (use the SQL query above to count).

## Why we don't show the user the raw error

Listed for posterity — see §16.U #4 / §20.9 #5. The
`api.property-resolve.rentcast` Sentry channel is the only place the raw
RentCast error string appears. The user UI sanitizes it to
`"Couldn't reach the property-records database — proceeding with listing
data only."` because:

1. Users can't act on the distinction between auth-failure and rate-limit.
2. Once Negotiation Packs are forwardable, raw API error text becomes a
   trust killer — sellers / agents would see an "invalid RentCast API
   key" string in the artifact.
3. The diagnostic distinction matters only to ops, and observability has
   the full detail.

If you ever feel the urge to thread the raw error back to the UI for
debugging, instead add a debug query param (`?debug=1`) that's gated on
an internal-only allowlist.

## Set up the uptime check (one-time, do this first)

1. UptimeRobot → **Add new monitor**.
2. Type: HTTP(S). URL: `https://<host>/api/health/rentcast`.
3. Interval: 5 min.
4. Keyword monitoring: alert on **does not contain** `"status":"ok"`.
5. Alert contacts: page the on-call (Slack `#realverdict-alerts` + email
   to ops). Two consecutive failures before paging.

## Optional: configure the probe address

By default the health check pings RentCast for the Empire State Building
(`20 W 34th St, New York, NY 10001`) — a public landmark RentCast definitely
has indexed. If you want the probe to exercise your hottest cache region,
set `RENTCAST_PROBE_ADDRESS` in Vercel to a property in your highest-volume
market. Don't use a customer's address — the probe address shows up in
RentCast's request logs.
