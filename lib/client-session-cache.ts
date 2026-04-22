// Client-side sessionStorage cache with TTL.
//
// Why bother when /api/property-resolve already has a 24h server-side cache?
// Two reasons:
//
//   1. Network-free instant hit. The server-side KVCache is Redis-backed and
//      cross-lambda, but a Redis GET still costs one network round trip plus
//      a re-send of the entire resolver payload. sessionStorage is <1ms and
//      keeps the entire request path local to the browser.
//
//   2. Instant feel. A sessionStorage read is <1ms vs ~200ms for a warm
//      resolver call. "Typed A → edit → back → retype A → instantly filled"
//      feels like the tool remembers, which is a big UX win on a paid product.
//
// Safe to import anywhere: all accesses go through try/catch so Safari
// private browsing (which blocks sessionStorage writes) degrades to "cache
// miss" rather than throwing.

/** Entry wrapper — stores the absolute expiry time, not a TTL, so the
 *  session survives tab suspend/resume without drifting.  */
type Entry<T> = {
  v: T;
  /** Epoch milliseconds at which this entry becomes invalid. */
  exp: number;
};

const DEFAULT_PREFIX = "rvr:cache:";

function buildKey(namespace: string, id: string): string {
  return `${DEFAULT_PREFIX}${namespace}:${id}`;
}

/** SSR-safe sessionStorage accessor. Returns null on the server or when
 *  the browser has disabled storage. */
function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Read a value from the session cache. Returns `null` on miss, expiry,
 * parse error, or storage unavailability — callers should always treat
 * a null as "go do the network call".
 */
export function sessionGet<T>(namespace: string, id: string): T | null {
  const s = store();
  if (!s) return null;
  let raw: string | null;
  try {
    raw = s.getItem(buildKey(namespace, id));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as Entry<T>;
    if (!entry || typeof entry !== "object") return null;
    if (typeof entry.exp !== "number" || entry.exp <= Date.now()) {
      // Expired — opportunistically drop so we don't leak.
      try {
        s.removeItem(buildKey(namespace, id));
      } catch {
        /* ignore */
      }
      return null;
    }
    return entry.v as T;
  } catch {
    return null;
  }
}

/**
 * Write a value to the session cache with a TTL in milliseconds. Silently
 * fails if storage is unavailable or the quota is exceeded — this is a
 * best-effort optimization, never a correctness-critical write.
 */
export function sessionSet<T>(
  namespace: string,
  id: string,
  value: T,
  ttlMs: number,
): void {
  const s = store();
  if (!s) return;
  const entry: Entry<T> = { v: value, exp: Date.now() + ttlMs };
  try {
    s.setItem(buildKey(namespace, id), JSON.stringify(entry));
  } catch {
    // QuotaExceededError or JSON.stringify throwing on circular refs.
    // Not worth falling back to anything — we just won't have a cache hit.
  }
}

/** Remove a single entry — used when we know the backing data is stale
 *  (e.g. the resolver returned an error). */
export function sessionDelete(namespace: string, id: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(buildKey(namespace, id));
  } catch {
    /* ignore */
  }
}

/** Nuke every entry under a namespace. Useful when versioning a payload
 *  shape — bump a version constant, call this once, old entries are gone. */
export function sessionClearNamespace(namespace: string): void {
  const s = store();
  if (!s) return;
  const prefix = buildKey(namespace, "");
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    /* ignore */
  }
}

/**
 * Normalize an address/URL so two visually-equivalent inputs share a cache
 * entry. Lowercase, collapse whitespace, strip trailing commas/dots.
 *
 * We deliberately DON'T strip unit numbers — "123 Main Apt 4" and "123 Main"
 * are different addresses and deserve different cache entries.
 */
export function normalizeCacheKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]+$/g, "");
}
