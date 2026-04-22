import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  sessionGet,
  sessionSet,
  sessionDelete,
  sessionClearNamespace,
  normalizeCacheKey,
} from "./client-session-cache";

// Minimal sessionStorage stand-in. vitest runs in node by default and window
// is undefined, so we splice one in for these tests and tear it down after.

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  quota = Infinity;
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

let memStore: MemoryStorage;

const g = globalThis as unknown as { window?: { sessionStorage: Storage } };

beforeEach(() => {
  memStore = new MemoryStorage();
  g.window = { sessionStorage: memStore as unknown as Storage };
});

afterEach(() => {
  delete g.window;
  vi.useRealTimers();
});

describe("sessionGet / sessionSet — happy path", () => {
  it("round-trips an object", () => {
    sessionSet("ns", "k", { a: 1, b: "two" }, 60_000);
    const out = sessionGet<{ a: number; b: string }>("ns", "k");
    expect(out).toEqual({ a: 1, b: "two" });
  });

  it("returns null for a key that was never written", () => {
    expect(sessionGet("ns", "missing")).toBeNull();
  });

  it("namespaces are isolated — same id under different ns doesn't collide", () => {
    sessionSet("ns-a", "k", 1, 60_000);
    sessionSet("ns-b", "k", 2, 60_000);
    expect(sessionGet<number>("ns-a", "k")).toBe(1);
    expect(sessionGet<number>("ns-b", "k")).toBe(2);
  });
});

describe("TTL expiry", () => {
  it("returns null after the TTL has elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    sessionSet("ns", "k", "value", 1_000);
    // Not expired yet.
    vi.setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    expect(sessionGet<string>("ns", "k")).toBe("value");
    // Past expiry.
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    expect(sessionGet<string>("ns", "k")).toBeNull();
  });

  it("evicts the expired entry from storage on miss so quota recovers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    sessionSet("ns", "k", "value", 1_000);
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    expect(sessionGet<string>("ns", "k")).toBeNull();
    // Expired entry should have been purged opportunistically.
    expect(memStore.getItem("rvr:cache:ns:k")).toBeNull();
  });
});

describe("sessionDelete", () => {
  it("removes a single entry but leaves siblings alone", () => {
    sessionSet("ns", "a", 1, 60_000);
    sessionSet("ns", "b", 2, 60_000);
    sessionDelete("ns", "a");
    expect(sessionGet("ns", "a")).toBeNull();
    expect(sessionGet<number>("ns", "b")).toBe(2);
  });
});

describe("sessionClearNamespace", () => {
  it("wipes only the target namespace", () => {
    sessionSet("old", "a", 1, 60_000);
    sessionSet("old", "b", 2, 60_000);
    sessionSet("new", "a", 9, 60_000);
    sessionClearNamespace("old");
    expect(sessionGet("old", "a")).toBeNull();
    expect(sessionGet("old", "b")).toBeNull();
    expect(sessionGet<number>("new", "a")).toBe(9);
  });
});

describe("defensive handling", () => {
  it("returns null when window is undefined (SSR context)", () => {
    delete g.window;
    expect(sessionGet("ns", "k")).toBeNull();
    // sessionSet should no-op without throwing.
    expect(() => sessionSet("ns", "k", "v", 1000)).not.toThrow();
  });

  it("returns null when the stored value is not valid JSON", () => {
    memStore.setItem("rvr:cache:ns:k", "not json {{{");
    expect(sessionGet("ns", "k")).toBeNull();
  });

  it("returns null when the stored value lacks the expected shape", () => {
    memStore.setItem("rvr:cache:ns:k", JSON.stringify({ no: "exp field" }));
    expect(sessionGet("ns", "k")).toBeNull();
  });

  it("silently swallows QuotaExceededError from setItem", () => {
    memStore.quota = 10; // any JSON we write will blow the quota
    expect(() =>
      sessionSet("ns", "k", { massive: "x".repeat(500) }, 60_000),
    ).not.toThrow();
    expect(sessionGet("ns", "k")).toBeNull();
  });
});

describe("normalizeCacheKey", () => {
  it("is case-insensitive and whitespace-collapsing", () => {
    expect(normalizeCacheKey("  123 Main   St, Austin  ")).toBe(
      "123 main   st, austin".replace(/\s+/g, " "),
    );
    expect(normalizeCacheKey("123 Main St, Austin TX")).toBe(
      normalizeCacheKey("123 main st, austin tx"),
    );
  });

  it("keeps unit numbers distinct", () => {
    expect(normalizeCacheKey("100 Oak Ave")).not.toBe(
      normalizeCacheKey("100 Oak Ave Apt 4"),
    );
  });

  it("strips trailing punctuation", () => {
    expect(normalizeCacheKey("100 Oak Ave,")).toBe("100 oak ave");
    expect(normalizeCacheKey("100 Oak Ave.")).toBe("100 oak ave");
  });
});
