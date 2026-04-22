// KV cache — Redis-primary, in-memory fallback. Cross-lambda by default.
//
// Problem this solves
// -------------------
// Every upstream data cache in this codebase (RentCast per-side comp pools,
// FEMA flood zones, Census geocodes, FRED mortgage rate, FHFA HPI, resolver
// final payloads) was backed by lib/server-cache.TTLCache — a per-process
// Map. On Vercel serverless that cache resets on every cold start and is
// unshared across parallel lambda invocations. In practice two flows that
// hit the same address 10 seconds apart can still double-spend every
// upstream call because they happened to land on different lambdas.
//
// Fix: push the cache behind the same Upstash Redis instance we already pay
// for in lib/ratelimit.ts. Same credentials, same module-load guard, same
// fallback semantics. Net result: a warm cache survives cold starts AND is
// shared across every concurrent lambda.
//
// Design contract
// ---------------
//   - Redis backend when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//     are both set. We use JSON-serialized values with native key-level
//     TTL (`px`) so Redis evicts expired entries for us. Prefix: `rvr:kv:`.
//   - In-memory fallback otherwise, identical semantics (absolute expiry,
//     LRU-ish eviction at MAX_ENTRIES). Used in dev, in tests, and in any
//     production deploy that chose not to attach Upstash.
//   - All operations are async. Redis is inherently async so callers have
//     to `await`; the fallback pretends to be async via Promise.resolve.
//   - Fail-open: a Redis error never surfaces to the caller. We log via
//     captureError() and return undefined from get / no-op on set. A
//     caching layer should never break the upstream call.
//   - Namespaced per-consumer so a key collision between, say, "flood"
//     and "rates" is impossible: callers pass a `namespace` to the
//     constructor.
//   - Versioned via caller-supplied key prefix when the shape of cached
//     values changes. We deliberately do NOT try to version automatically;
//     leaving that to the caller makes cache invalidation explicit.
//
// Usage
// -----
//   const floodCache = new KVCache<FloodZone>("flood", 30 * DAY_MS);
//   const hit = await floodCache.get(key);
//   if (hit !== undefined) return hit;
//   const zone = await fetchFromFema(...);
//   await floodCache.set(key, zone);

import { Redis } from "@upstash/redis";
import { captureError } from "./observability";

// Key prefix for every Redis key written by this module. Matches the
// `rvr:rl:` pattern used by ratelimit.ts so an Upstash dashboard can filter
// our app's keys cleanly from any other tenant.
const REDIS_KEY_PREFIX = "rvr:kv:";

// In-memory fallback cap. Generous enough to absorb a single lambda's
// working set but small enough that a misbehaving loop can't OOM.
const MAX_IN_MEMORY_ENTRIES = 1000;

// ---------------------------------------------------------------------------
// Backend selection — once per process. Same pattern as ratelimit.ts so
// env-gating behavior is identical: either BOTH creds present => Redis,
// or fallback. Mixed configuration silently falls back (and we log once).
// ---------------------------------------------------------------------------

let redisClient: Redis | null | undefined;
let redisConfigLogged = false;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!redisConfigLogged) {
      redisConfigLogged = true;
      console.info(
        "[kv-cache] Upstash Redis not configured — using in-memory fallback.",
      );
    }
    redisClient = null;
    return null;
  }

  try {
    redisClient = new Redis({ url, token });
    return redisClient;
  } catch (err) {
    captureError(err, { area: "kv-cache.init" });
    redisClient = null;
    return null;
  }
}

// Exported for tests only. Lets unit tests force-reselect the backend
// between runs after mutating process.env.
export function __resetRedisClientForTests() {
  redisClient = undefined;
  redisConfigLogged = false;
}

// ---------------------------------------------------------------------------
// In-memory fallback store — shared across all KVCache instances. Namespace
// is baked into the key so instances don't stomp each other.
// ---------------------------------------------------------------------------

type InMemoryEntry = {
  value: unknown;
  expiresAt: number;
};

const memoryStore = new Map<string, InMemoryEntry>();

function memGet<T>(fullKey: string): T | undefined {
  const hit = memoryStore.get(fullKey);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    memoryStore.delete(fullKey);
    return undefined;
  }
  // Refresh recency for LRU-ish eviction.
  memoryStore.delete(fullKey);
  memoryStore.set(fullKey, hit);
  return hit.value as T;
}

function memSet<T>(fullKey: string, value: T, ttlMs: number): void {
  if (memoryStore.size >= MAX_IN_MEMORY_ENTRIES) {
    const oldest = memoryStore.keys().next().value;
    if (oldest) memoryStore.delete(oldest);
  }
  memoryStore.set(fullKey, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export function __resetMemoryStoreForTests() {
  memoryStore.clear();
}

// ---------------------------------------------------------------------------
// KVCache — one instance per logical cache (flood, geocode, rates, comps,
// resolver). Namespace is required to keep key spaces disjoint.
// ---------------------------------------------------------------------------

export class KVCache<T> {
  constructor(
    private readonly namespace: string,
    private readonly defaultTtlMs: number,
  ) {
    if (!namespace || !/^[a-z0-9_-]+$/i.test(namespace)) {
      throw new Error(
        `KVCache namespace must be non-empty and [a-z0-9_-]+, got ${JSON.stringify(namespace)}`,
      );
    }
  }

  private fullKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private redisKey(key: string): string {
    return `${REDIS_KEY_PREFIX}${this.fullKey(key)}`;
  }

  /** Read a value. Returns `undefined` on miss, expiry, parse error, or
   *  backend failure. Never throws. */
  async get(key: string): Promise<T | undefined> {
    const redis = getRedis();
    if (redis) {
      try {
        // Upstash's Redis client auto-deserializes JSON values it wrote.
        const raw = await redis.get<T>(this.redisKey(key));
        return raw === null ? undefined : (raw as T);
      } catch (err) {
        captureError(err, {
          area: "kv-cache.get",
          extra: { namespace: this.namespace, key },
        });
        // Fall through to in-memory layer as a secondary backstop. This is
        // a belt-and-suspenders move: if Upstash is transiently down, a
        // warm lambda can still serve cached values it wrote in a previous
        // successful call.
        return memGet<T>(this.fullKey(key));
      }
    }
    return memGet<T>(this.fullKey(key));
  }

  /** Write a value. `ttlMs` overrides the constructor default for this
   *  entry only. Silently swallows backend failures. */
  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    // Always write to the in-memory layer too, so a single-lambda hot path
    // gets O(1) reads even when Redis is attached.
    memSet(this.fullKey(key), value, effectiveTtl);

    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(this.redisKey(key), value, { px: effectiveTtl });
      } catch (err) {
        captureError(err, {
          area: "kv-cache.set",
          extra: { namespace: this.namespace, key },
        });
      }
    }
  }

  /** Explicit delete — useful when upstream invalidates (e.g. the caller
   *  detected the cached entry is stale by some out-of-band signal). */
  async delete(key: string): Promise<void> {
    memoryStore.delete(this.fullKey(key));
    const redis = getRedis();
    if (redis) {
      try {
        await redis.del(this.redisKey(key));
      } catch (err) {
        captureError(err, {
          area: "kv-cache.delete",
          extra: { namespace: this.namespace, key },
        });
      }
    }
  }
}
