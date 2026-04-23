import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Structural invariants for the Negotiation Pack feature (HANDOFF §11).
//
// Mirrors the property-resolve invariant test pattern — these don't run the
// route handlers (which require a Next runtime, Supabase env, and request
// objects) but they DO assert the file shape, import graph, and export
// surface so the wiring can't silently regress.
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..");

function readSource(rel: string): string {
  const p = join(ROOT, rel);
  expect(existsSync(p), `file should exist: ${rel}`).toBe(true);
  return readFileSync(p, "utf8");
}

describe("Negotiation Pack — file + wiring invariants", () => {
  it("Supabase migration 004_negotiation_packs.sql exists and declares the table", () => {
    const sql = readSource("supabase/migrations/004_negotiation_packs.sql");
    expect(sql).toMatch(/create\s+table[^;]*public\.negotiation_packs/i);
    expect(sql).toMatch(/share_token\s+text\s+not\s+null\s+unique/i);
    expect(sql).toMatch(/payload\s+jsonb\s+not\s+null/i);
    expect(sql).toMatch(/enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/is_public\s*=\s*true/i);
  });

  it("POST /api/pack/generate exists, is auth-gated, and writes negotiation_packs", () => {
    const src = readSource("app/api/pack/generate/route.ts");
    expect(src).toMatch(/export\s+const\s+POST\s*=/);
    expect(src).toMatch(/getUser\s*\(\s*\)/);
    expect(src).toMatch(/from\s*\(\s*["']negotiation_packs["']\s*\)/);
    expect(src).toMatch(/buildPack\s*\(/);
    expect(src).toMatch(/randomBytes\s*\(\s*18\s*\)/);
  });

  it("POST /api/pack/generate enforces a per-user rate limit", () => {
    const src = readSource("app/api/pack/generate/route.ts");
    expect(src).toMatch(/enforceRateLimit\s*\([^)]*["']pack-generate["']/);
  });

  it("public pack viewer page exists at /pack/[shareToken]", () => {
    const src = readSource("app/pack/[shareToken]/page.tsx");
    expect(src).toMatch(/export\s+default\s+(async\s+)?function/);
    expect(src).toMatch(/share_token/);
    expect(src).toMatch(/negotiation_packs/);
  });

  it("PDF export route exists at /pack/[shareToken]/pdf and uses react-pdf", () => {
    const src = readSource("app/pack/[shareToken]/pdf/route.ts");
    expect(src).toMatch(/export\s+const\s+GET\s*=/);
    expect(src).toMatch(/renderToStream/);
    expect(src).toMatch(/PackDocument/);
    expect(src).toMatch(/runtime\s*=\s*["']nodejs["']/);
  });

  it("PackGenerateButton exists and is wired into the results action row", () => {
    const btn = readSource("app/_components/PackGenerateButton.tsx");
    expect(btn).toMatch(/fetch\s*\(\s*["']\/api\/pack\/generate["']/);
    // The results page orchestrator decides packEligible and threads it
    // into HeroSection; HeroSection actually renders PackGenerateButton.
    // Both halves of the wiring are invariants we want to lock in.
    const results = readSource("app/results/page.tsx");
    expect(results).toMatch(/packEligible/);
    expect(results).toMatch(/HeroSection/);
    const hero = readSource("app/_components/results/HeroSection.tsx");
    expect(hero).toMatch(/PackGenerateButton/);
    expect(hero).toMatch(/packEligible/);
  });

  it("CompReasoningPanel is rendered inside CompsSection when comparables exist", () => {
    const section = readSource("app/_components/CompsSection.tsx");
    expect(section).toMatch(/CompReasoningPanel/);
  });

  it("pricing page reflects the $29 single-tier model with Pack-first framing", () => {
    const src = readSource("app/pricing/page.tsx");
    expect(src).toMatch(/\$29/);
    expect(src).not.toMatch(/\$19[^0-9]/);
    expect(src).toMatch(/Negotiation Pack/);
    // Free tier quota has to be explicit on the page so prospects know
    // exactly what they're getting. The rate limiter enforces 3 per 7-day
    // rolling window (see lib/ratelimit.ts `analysis-free-user`); the copy
    // must match that or we're lying to free-tier users.
    expect(src).toMatch(/3 full Negotiation Packs per week/i);
  });

  it("homepage surfaces the Negotiation Pack as the headline deliverable", () => {
    const src = readSource("app/page.tsx");
    expect(src).toMatch(/Negotiation Pack/);
    // Beachhead framing — the hero should call out "next offer" to anchor
    // the target customer (investors about to submit an offer).
    expect(src).toMatch(/For your next offer/i);
    // Free-quota callout has to match the pricing page (and the rate
    // limiter) so the homepage-to-pricing transition isn't dissonant.
    expect(src).toMatch(/3 listings a week/i);
  });
});
