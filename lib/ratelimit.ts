// Rate limiting for our API routes.
//
// Design:
//   - Upstash Ratelimit (Redis-backed, free tier) is the production path.
//     Works across Vercel lambdas — a single IP hitting two lambdas shares
//     the same bucket, unlike in-memory counters which reset per lambda.
//   - When UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are missing
//     (dev without the env, or a future self-hosted deploy) we fall back
//     to a per-process in-memory sliding window. Works in dev, degrades
//     gracefully in single-lambda production, documented in HANDOFF §16.M.
//   - Buckets are keyed per endpoint × per identifier (IP or user-id).
//     Each endpoint has a different cost profile so the limits differ.
//
// API for callers (route handlers):
//
//   const { allowed, retryAfter } = await rateLimit(req, "property-resolve");
//   if (!allowed) return rateLimitedResponse(retryAfter);
//
// That's the whole surface. All the Upstash / fallback logic stays here.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ---------------------------------------------------------------------------
// Limiter catalog — one entry per API route we protect. Numbers reflect
// realistic solo-investor usage patterns, not theoretical throughput.
//
// "autofill" is the core flow: an investor types in an address, hits Enter,
// and gets back a filled form. At 20/hour a user could realistically analyse
// 20 properties in a sitting — anything beyond that on a single IP is
// scripted / abusive. The rest are scaled proportionally.
// ---------------------------------------------------------------------------

export type LimiterName =
  | "property-resolve"
  | "zillow-parse"
  | "comps"
  | "chat"
  | "deals-save"
  | "address-autocomplete"
  | "stripe-webhook"
  | "stripe-checkout"
  | "analysis-free-anon"
  | "analysis-free-user";

type LimiterSpec = {
  /** Human-readable budget, for logging / debugging. */
  label: string;
  /** Token count per window. */
  tokens: number;
  /** Window size in seconds. */
  windowSeconds: number;
};

const LIMITS: Record<LimiterName, LimiterSpec> = {
  // Expensive autofill pipeline: FRED + FEMA + Census + up to 5 RentCast
  // calls + (optional) Zillow scraper. 20/hour per IP is plenty for a real
  // user (1 analysis every 3 minutes sustained) and shuts down scripted
  // scraping fast.
  "property-resolve": { label: "autofill", tokens: 20, windowSeconds: 3600 },

  // Zillow parse goes through ScraperAPI, which bills per request. 10/hour
  // is generous but any more would be rent-seeking on our API key.
  "zillow-parse": { label: "zillow", tokens: 10, windowSeconds: 3600 },

  // Comps route is a thin RentCast wrapper. Slightly higher since a user
  // may refresh the comps tab a few times per analysis.
  comps: { label: "comps", tokens: 30, windowSeconds: 3600 },

  // OpenAI-backed chat. 30/hour is already $0.30+ of tokens on gpt-4o at
  // normal answer lengths. Any abusive pattern hits this wall quickly.
  chat: { label: "chat", tokens: 30, windowSeconds: 3600 },

  // Supabase-write. Keyed by user id when authed so this is per-user, not
  // per-IP. 60/hour is an absurdly fast pace for saving real deals.
  "deals-save": { label: "save", tokens: 60, windowSeconds: 3600 },

  // Keystroke-level. Without a cap a bored user could burn through
  // Mapbox / Google credits. 2 per second sustained is plenty for real typing.
  "address-autocomplete": { label: "autocomplete", tokens: 120, windowSeconds: 60 },

  // Stripe webhook — all workers share one bucket key in the handler so
  // bursty retries from Stripe IPs don't trip a per-IP false positive.
  "stripe-webhook": { label: "stripe-webhook", tokens: 500, windowSeconds: 60 },

  // Checkout session creation — per signed-in user, not IP.
  "stripe-checkout": { label: "stripe-checkout", tokens: 10, windowSeconds: 3600 },

  // Free-tier full analyses (/results) — rolling 7-day windows.
  "analysis-free-anon": {
    label: "analysis-free-ip",
    tokens: 5,
    windowSeconds: 7 * 24 * 3600,
  },
  "analysis-free-user": {
    label: "analysis-free-user",
    tokens: 3,
    windowSeconds: 7 * 24 * 3600,
  },
};

const MAX_WINDOW_MS = Math.max(
  ...Object.values(LIMITS).map((s) => s.windowSeconds * 1000),
);

// ---------------------------------------------------------------------------
// Backend selection — pick once at module load.
// ---------------------------------------------------------------------------

let upstashLimiters: Partial<Record<LimiterName, Ratelimit>> | null = null;

function getUpstashLimiters() {
  if (upstashLimiters) return upstashLimiters;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const redis = new Redis({ url, token });
  const map: Partial<Record<LimiterName, Ratelimit>> = {};
  for (const [name, spec] of Object.entries(LIMITS) as Array<
    [LimiterName, LimiterSpec]
  >) {
    map[name] = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        spec.tokens,
        `${spec.windowSeconds} s`,
      ),
      analytics: false,
      prefix: `rvr:rl:${name}`,
    });
  }
  upstashLimiters = map;
  return map;
}

// ---------------------------------------------------------------------------
// In-memory sliding window fallback — used when Upstash creds are absent.
//
// A per-process Map<bucketKey, number[]> where the value is the list of
// request timestamps (ms) within the window. We trim old timestamps on
// every check and count the rest.
// ---------------------------------------------------------------------------

type InMemoryBucket = number[];
const memoryStore = new Map<string, InMemoryBucket>();
// Periodic sweep of expired buckets so the Map doesn't grow unbounded.
// Called opportunistically from rateLimit(); not a setInterval because that
// would keep lambdas alive indefinitely on Vercel.
const SWEEP_EVERY_N_CHECKS = 1000;
let checksSinceSweep = 0;
function sweepExpired(now: number) {
  for (const [key, timestamps] of memoryStore.entries()) {
    if (timestamps.length === 0) {
      memoryStore.delete(key);
      continue;
    }
    const oldest = timestamps[0];
    if (now - oldest > MAX_WINDOW_MS) {
      memoryStore.delete(key);
    }
  }
}

export function inMemoryCheck(
  name: LimiterName,
  identifier: string,
  nowMs: number = Date.now(),
): { allowed: boolean; retryAfter: number } {
  const spec = LIMITS[name];
  const windowMs = spec.windowSeconds * 1000;
  const key = `${name}:${identifier}`;

  checksSinceSweep++;
  if (checksSinceSweep >= SWEEP_EVERY_N_CHECKS) {
    checksSinceSweep = 0;
    sweepExpired(nowMs);
  }

  const existing = memoryStore.get(key) ?? [];
  const cutoff = nowMs - windowMs;
  const fresh = existing.filter((t) => t > cutoff);

  if (fresh.length >= spec.tokens) {
    // Oldest timestamp + windowMs = when the budget frees up by one token.
    const oldest = fresh[0];
    const retryMs = Math.max(0, oldest + windowMs - nowMs);
    memoryStore.set(key, fresh);
    return { allowed: false, retryAfter: Math.ceil(retryMs / 1000) };
  }

  fresh.push(nowMs);
  memoryStore.set(key, fresh);
  return { allowed: true, retryAfter: 0 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type RateLimitResult = {
  allowed: boolean;
  retryAfter: number; // seconds until the caller should retry
  backend: "upstash" | "memory";
};

/**
 * Check whether `identifier` (usually an IP, sometimes a user id) has
 * remaining budget for `name`. Returns immediately; always succeeds when
 * the backend is unreachable (fail-open — rate limiting must never
 * produce a worse user experience than no rate limiting at all).
 */
export async function checkRateLimit(
  name: LimiterName,
  identifier: string,
): Promise<RateLimitResult> {
  const upstash = getUpstashLimiters();
  const limiter = upstash?.[name];
  if (limiter) {
    try {
      const r = await limiter.limit(identifier);
      const retryAfter = r.success
        ? 0
        : Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
      return { allowed: r.success, retryAfter, backend: "upstash" };
    } catch {
      // Upstash blip — do not block the user. Log-only.
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[ratelimit] upstash failed for ${name}, falling open`);
      }
      return { allowed: true, retryAfter: 0, backend: "upstash" };
    }
  }

  const r = inMemoryCheck(name, identifier);
  return { ...r, backend: "memory" };
}

/**
 * Resolve a request to a rate-limit identifier. Prefer a supplied userId
 * (e.g. from a Supabase session); fall back to IP from `x-forwarded-for`
 * (Vercel sets this) or `x-real-ip`; fall back to "anonymous" so the
 * limit still applies but coarsely.
 */
export function identifierFor(
  request: Request,
  userId?: string | null,
): string {
  if (userId) return `u:${userId}`;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    // x-forwarded-for can be a comma-separated chain; the first entry is
    // the client.
    const ip = xff.split(",")[0]?.trim();
    if (ip) return `ip:${ip}`;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return `ip:${real.trim()}`;
  return "ip:anonymous";
}

/**
 * Produce the 429 Response directly. Centralized so every route returns
 * the same shape (JSON + Retry-After header).
 */
export function rateLimitedResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Too many requests from your IP. Please slow down.",
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.max(1, retryAfter)),
      },
    },
  );
}

/**
 * Convenience: one-shot guard for route handlers.
 *
 *   const limited = await enforceRateLimit(req, "property-resolve");
 *   if (limited) return limited;
 *
 * Returns the 429 Response when limited, or null when the request is
 * allowed to proceed.
 */
export async function enforceRateLimit(
  request: Request,
  name: LimiterName,
  userId?: string | null,
): Promise<Response | null> {
  const identifier = identifierFor(request, userId);
  const { allowed, retryAfter } = await checkRateLimit(name, identifier);
  if (allowed) return null;
  return rateLimitedResponse(retryAfter);
}

/**
 * Same as enforceRateLimit but with an explicit identifier (e.g. a fixed
 * global key for Stripe webhooks where every request shares one bucket).
 */
export async function enforceRateLimitByKey(
  name: LimiterName,
  identifier: string,
): Promise<Response | null> {
  const { allowed, retryAfter } = await checkRateLimit(name, identifier);
  if (allowed) return null;
  return rateLimitedResponse(retryAfter);
}

// Exported for tests to reset state between cases.
export function __resetInMemoryStoreForTests() {
  memoryStore.clear();
  checksSinceSweep = 0;
}
