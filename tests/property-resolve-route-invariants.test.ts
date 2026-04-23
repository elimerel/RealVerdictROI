import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// §20.8 architecture invariant: the resolver MUST NOT pull comps. Comp
// pulls happen only on /results behind an explicit "Run live comp
// analysis" click. If anyone re-introduces an import of fetchComps or
// analyzeComparables in this route, browse-and-bounce traffic starts
// burning RentCast quota again and the unit economics break.
//
// This is a structural test — it reads the source file directly so it
// catches reintroduction even when the import isn't reachable at runtime.
describe("property-resolve route — §20.8 invariants", () => {
  const source = readFileSync(
    join(__dirname, "..", "app", "api", "property-resolve", "route.ts"),
    "utf8",
  );

  it("does NOT import fetchComps from @/lib/comps", () => {
    expect(source).not.toMatch(
      /import\s+\{[^}]*\bfetchComps\b[^}]*\}\s+from\s+["']@\/lib\/comps["']/,
    );
  });

  it("does NOT import analyzeComparables from @/lib/comparables", () => {
    expect(source).not.toMatch(
      /import\s+\{[^}]*\banalyzeComparables\b[^}]*\}\s+from\s+["']@\/lib\/comparables["']/,
    );
  });

  it("does NOT call fetchComps anywhere in the file", () => {
    expect(source).not.toMatch(/\bfetchComps\s*\(/);
  });

  it("does NOT call analyzeComparables anywhere in the file", () => {
    expect(source).not.toMatch(/\banalyzeComparables\s*\(/);
  });

  it("declares mode: 'fast' on every ResolveResult", () => {
    // emptyResult() is the only constructor of ResolveResult. If it stops
    // setting mode: "fast", the type system + this assertion together
    // catch it.
    expect(source).toMatch(/mode:\s*["']fast["']/);
  });

  it("CACHE_VERSION is at v15 or later (so v14 entries with comp data invalidate)", () => {
    const m = source.match(/CACHE_VERSION\s*=\s*["']v(\d+)["']/);
    expect(m, "CACHE_VERSION declaration not found").not.toBeNull();
    const v = Number(m![1]);
    expect(v).toBeGreaterThanOrEqual(15);
  });
});
