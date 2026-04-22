import { describe, it, expect, beforeEach } from "vitest";
import {
  inMemoryCheck,
  identifierFor,
  rateLimitedResponse,
  __resetInMemoryStoreForTests,
} from "./ratelimit";

beforeEach(() => {
  __resetInMemoryStoreForTests();
});

describe("inMemoryCheck — sliding window", () => {
  it("allows the first request for a fresh identifier", () => {
    const r = inMemoryCheck("chat", "ip:1.2.3.4");
    expect(r.allowed).toBe(true);
    expect(r.retryAfter).toBe(0);
  });

  it("enforces the per-window token count", () => {
    // Autofill is 20 tokens/hour. 21st in the same hour must be rejected.
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 20; i++) {
      const r = inMemoryCheck("property-resolve", "ip:test", t0 + i);
      expect(r.allowed).toBe(true);
    }
    const blocked = inMemoryCheck("property-resolve", "ip:test", t0 + 20);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("frees the oldest token after the window elapses", () => {
    const t0 = 1_700_000_000_000;
    const windowMs = 3_600_000; // 1h for property-resolve

    for (let i = 0; i < 20; i++) {
      inMemoryCheck("property-resolve", "ip:window", t0 + i);
    }
    const blocked = inMemoryCheck("property-resolve", "ip:window", t0 + 100);
    expect(blocked.allowed).toBe(false);

    // After the full window elapses past the oldest token, one slot is free.
    const unblocked = inMemoryCheck(
      "property-resolve",
      "ip:window",
      t0 + windowMs + 1,
    );
    expect(unblocked.allowed).toBe(true);
  });

  it("buckets are per identifier and per limiter name", () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 10; i++) {
      expect(
        inMemoryCheck("zillow-parse", "ip:A", t0 + i).allowed,
      ).toBe(true);
    }
    // ip:A is maxed (zillow-parse is 10/hour)
    expect(inMemoryCheck("zillow-parse", "ip:A", t0 + 10).allowed).toBe(false);
    // ip:B is fresh
    expect(inMemoryCheck("zillow-parse", "ip:B", t0 + 10).allowed).toBe(true);
    // ip:A on a different limiter is fresh
    expect(inMemoryCheck("chat", "ip:A", t0 + 10).allowed).toBe(true);
  });

  it("retryAfter is a positive integer seconds count when blocked", () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 10; i++) {
      inMemoryCheck("zillow-parse", "ip:retry", t0 + i);
    }
    const r = inMemoryCheck("zillow-parse", "ip:retry", t0 + 20);
    expect(r.allowed).toBe(false);
    expect(Number.isInteger(r.retryAfter)).toBe(true);
    expect(r.retryAfter).toBeGreaterThan(0);
    expect(r.retryAfter).toBeLessThanOrEqual(3600);
  });
});

describe("identifierFor", () => {
  const mkReq = (headers: Record<string, string>) =>
    new Request("https://example.com/", { headers });

  it("prefers an explicit userId", () => {
    const req = mkReq({ "x-forwarded-for": "1.2.3.4" });
    expect(identifierFor(req, "user-xyz")).toBe("u:user-xyz");
  });

  it("falls back to the first IP in x-forwarded-for", () => {
    const req = mkReq({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" });
    expect(identifierFor(req)).toBe("ip:1.2.3.4");
  });

  it("falls back to x-real-ip if no x-forwarded-for", () => {
    const req = mkReq({ "x-real-ip": "5.6.7.8" });
    expect(identifierFor(req)).toBe("ip:5.6.7.8");
  });

  it("returns anonymous when no IP headers are set", () => {
    const req = mkReq({});
    expect(identifierFor(req)).toBe("ip:anonymous");
  });
});

describe("rateLimitedResponse", () => {
  it("returns a 429 with Retry-After header and JSON body", async () => {
    const res = rateLimitedResponse(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfter).toBe(42);
  });

  it("floors Retry-After to a minimum of 1 (so clients never see 0)", () => {
    const res = rateLimitedResponse(0);
    expect(res.headers.get("Retry-After")).toBe("1");
  });
});
