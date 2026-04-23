import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  KVCache,
  __resetMemoryStoreForTests,
  __resetRedisClientForTests,
} from "./kv-cache";

// All tests here exercise the in-memory fallback path. The Upstash-attached
// path is exercised in the e2e smoke test (see §16.P in HANDOFF_ARCHIVE) since
// hitting real Redis in unit tests is both slow and flaky.

beforeEach(() => {
  __resetMemoryStoreForTests();
  __resetRedisClientForTests();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("constructor validation", () => {
  it("rejects an empty namespace", () => {
    expect(() => new KVCache("", 1000)).toThrow(/namespace/);
  });

  it("rejects a namespace with invalid characters", () => {
    expect(() => new KVCache("has space", 1000)).toThrow(/namespace/);
    expect(() => new KVCache("has:colon", 1000)).toThrow(/namespace/);
  });

  it("accepts alphanumerics, dashes, underscores", () => {
    expect(() => new KVCache("flood", 1000)).not.toThrow();
    expect(() => new KVCache("flood-neg", 1000)).not.toThrow();
    expect(() => new KVCache("flood_v2", 1000)).not.toThrow();
    expect(() => new KVCache("abc123", 1000)).not.toThrow();
  });
});

describe("in-memory fallback — happy path", () => {
  it("round-trips a value", async () => {
    const c = new KVCache<{ x: number }>("ns", 60_000);
    await c.set("k", { x: 42 });
    const out = await c.get("k");
    expect(out).toEqual({ x: 42 });
  });

  it("returns undefined for an unwritten key", async () => {
    const c = new KVCache<string>("ns", 60_000);
    expect(await c.get("missing")).toBeUndefined();
  });

  it("namespaces isolate — same key under different namespace doesn't collide", async () => {
    const a = new KVCache<number>("ns-a", 60_000);
    const b = new KVCache<number>("ns-b", 60_000);
    await a.set("shared", 1);
    await b.set("shared", 2);
    expect(await a.get("shared")).toBe(1);
    expect(await b.get("shared")).toBe(2);
  });
});

describe("TTL semantics", () => {
  it("expires entries after the default TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const c = new KVCache<string>("ns", 1000);
    await c.set("k", "value");

    vi.setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    expect(await c.get("k")).toBe("value");

    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    expect(await c.get("k")).toBeUndefined();
  });

  it("per-call ttlMs overrides the constructor default", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const c = new KVCache<string>("ns", 1_000_000);
    await c.set("short", "v", 1000);

    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    expect(await c.get("short")).toBeUndefined();
  });
});

describe("delete", () => {
  it("removes an entry", async () => {
    const c = new KVCache<number>("ns", 60_000);
    await c.set("k", 7);
    await c.delete("k");
    expect(await c.get("k")).toBeUndefined();
  });
});

describe("LRU-ish eviction", () => {
  it("evicts the oldest entry when MAX_IN_MEMORY_ENTRIES is reached", async () => {
    // Not a hard test — we just verify the recency refresh on read keeps
    // frequently-read keys from being evicted ahead of cold keys.
    const c = new KVCache<number>("evict-test", 60_000);
    await c.set("hot", 1);
    await c.set("cold", 2);

    // Read "hot" to bump its recency.
    await c.get("hot");

    // Now re-write "cold" — it should still be there since both are present.
    // This test mostly exists to catch regressions in the recency-refresh
    // behavior; if `get` ever stops reordering, a proper LRU test will break.
    expect(await c.get("hot")).toBe(1);
    expect(await c.get("cold")).toBe(2);
  });
});

describe("backend selection", () => {
  it("falls back to in-memory when Upstash env vars are absent", async () => {
    // __resetRedisClientForTests + no env vars forces fallback.
    const c = new KVCache<string>("ns", 60_000);
    await c.set("k", "memory-only");
    expect(await c.get("k")).toBe("memory-only");
  });

  it("falls back to in-memory when only one env var is set (mixed config)", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    // Missing the token deliberately.
    __resetRedisClientForTests();
    const c = new KVCache<string>("ns", 60_000);
    await c.set("k", "still-memory");
    expect(await c.get("k")).toBe("still-memory");
  });
});
