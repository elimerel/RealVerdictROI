import { describe, it, expect } from "vitest";
import {
  analyzeComparables,
  type SubjectSnapshot,
} from "./comparables";
import type { Comp, CompsResult } from "./comps";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);

const comp = (o: Partial<Comp> & { price: number }): Comp => ({
  address: o.address ?? "100 Test St, Anytown, NY",
  bedrooms: o.bedrooms ?? 3,
  bathrooms: o.bathrooms ?? 2,
  squareFootage: o.squareFootage ?? 1500,
  yearBuilt: o.yearBuilt ?? 1995,
  price: o.price,
  daysOnMarket: o.daysOnMarket,
  date: o.date ?? today,
  distance: o.distance ?? 0.5,
  status: o.status,
  id: o.id,
  propertyType: o.propertyType ?? "Single Family",
  rolledUpCount: o.rolledUpCount ?? 1,
});

const emptyStats = { count: 0 };

const buildCompsResult = (saleItems: Comp[], rentItems: Comp[]): CompsResult => ({
  address: "Subject, Test, NY",
  saleComps: { items: saleItems, stats: emptyStats },
  rentComps: { items: rentItems, stats: emptyStats },
  radiusMilesUsed: 3,
  notes: [],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analyzeComparables — basics", () => {
  it("returns nulls when no comps are supplied", () => {
    const out = analyzeComparables(
      { address: "123 Main St", beds: 3, baths: 2, sqft: 1500 },
      null,
    );
    expect(out.marketValue).toBeNull();
    expect(out.marketRent).toBeNull();
  });

  it("derives value and rent from simple matched comps", () => {
    const subject: SubjectSnapshot = {
      address: "123 Main St",
      beds: 3,
      baths: 2,
      sqft: 1500,
      propertyType: "Single Family",
    };
    const sale = [
      comp({ price: 300_000, address: "1 A St" }),
      comp({ price: 310_000, address: "2 B St" }),
      comp({ price: 290_000, address: "3 C St" }),
      comp({ price: 305_000, address: "4 D St" }),
      comp({ price: 295_000, address: "5 E St" }),
    ];
    const rent = [
      comp({ price: 2_400, address: "1 A St" }),
      comp({ price: 2_500, address: "2 B St" }),
      comp({ price: 2_600, address: "3 C St" }),
      comp({ price: 2_550, address: "4 D St" }),
      comp({ price: 2_450, address: "5 E St" }),
    ];
    const out = analyzeComparables(subject, buildCompsResult(sale, rent));
    expect(out.marketValue?.value).toBeGreaterThan(270_000);
    expect(out.marketValue?.value).toBeLessThan(340_000);
    expect(out.marketRent?.value).toBeGreaterThan(2_300);
    expect(out.marketRent?.value).toBeLessThan(2_700);
  });

  it("sanitises beds=0 / sqft=0 subjects to undefined (prevents silent filter disable)", () => {
    const subject: SubjectSnapshot = {
      address: "123 Main St",
      beds: 0,
      baths: 0,
      sqft: 0,
    };
    const sale = [comp({ price: 300_000 }), comp({ price: 310_000 })];
    const out = analyzeComparables(subject, buildCompsResult(sale, []));
    expect(out.subject.beds).toBeUndefined();
    expect(out.subject.baths).toBeUndefined();
    expect(out.subject.sqft).toBeUndefined();
  });
});

describe("analyzeComparables — HOA override (Boca fix)", () => {
  // A "Townhouse" listing with a material HOA is condo-style ownership.
  // A pool of detached SFR comps must NOT be allowed to price that subject at
  // SFR levels — we should see a hard type mismatch penalty degrade the
  // derivation or the confidence.

  it("hard-downgrades SFR comps when subject has high HOA", () => {
    const subjectCondo: SubjectSnapshot = {
      address: "100 HOA Condo Way",
      beds: 3,
      baths: 2,
      sqft: 1500,
      propertyType: "Townhouse",
      monthlyHOA: 450,
    };
    const sfrComps: Comp[] = [
      comp({ price: 600_000, propertyType: "Single Family", address: "1 SFR" }),
      comp({ price: 620_000, propertyType: "Single Family", address: "2 SFR" }),
      comp({ price: 590_000, propertyType: "Single Family", address: "3 SFR" }),
      comp({ price: 605_000, propertyType: "Single Family", address: "4 SFR" }),
    ];
    const condoComps: Comp[] = [
      comp({ price: 300_000, propertyType: "Condo", address: "1 Condo" }),
      comp({ price: 310_000, propertyType: "Condo", address: "2 Condo" }),
      comp({ price: 295_000, propertyType: "Condo", address: "3 Condo" }),
      comp({ price: 305_000, propertyType: "Condo", address: "4 Condo" }),
    ];

    const mixedPool = [...condoComps, ...sfrComps];
    const out = analyzeComparables(
      subjectCondo,
      buildCompsResult(mixedPool, []),
    );
    // Derivation should NOT land anywhere near the SFR cluster (~600k). It's
    // allowed to blend when both categories are present, but the SFR pool
    // must not dominate — we want at least 15% below the SFR median (~600k)
    // and the SFRs in the comps-used list should be flagged as type
    // mismatches via missReasons.
    expect(out.marketValue).not.toBeNull();
    expect(out.marketValue!.value).toBeLessThan(510_000);
    const compsUsed = out.marketValue!.compsUsed;
    // Every SFR that made the list should be flagged as a type mismatch.
    const sfrUsed = compsUsed.filter((c) => /single family/i.test(c.propertyType ?? ""));
    for (const s of sfrUsed) {
      expect(s.missReasons.join(" ").toLowerCase()).toMatch(/single family|townhouse/i);
    }
  });

  it("pure-condo comp pool for a high-HOA subject produces a condo-priced derivation", () => {
    const subject: SubjectSnapshot = {
      address: "100 HOA Condo Way",
      beds: 3, baths: 2, sqft: 1500,
      propertyType: "Townhouse",
      monthlyHOA: 450,
    };
    const condoComps: Comp[] = [
      comp({ price: 300_000, propertyType: "Condo" }),
      comp({ price: 310_000, propertyType: "Condo" }),
      comp({ price: 295_000, propertyType: "Condo" }),
      comp({ price: 305_000, propertyType: "Condo" }),
    ];
    const out = analyzeComparables(subject, buildCompsResult(condoComps, []));
    expect(out.marketValue!.value).toBeLessThan(350_000);
    expect(out.marketValue!.value).toBeGreaterThan(270_000);
  });

  it("does not treat a $50/mo HOA as condo-style (threshold safety)", () => {
    const subject: SubjectSnapshot = {
      address: "100 Low HOA Rd",
      beds: 3,
      baths: 2,
      sqft: 1500,
      propertyType: "Single Family",
      monthlyHOA: 50, // trivial — below 200 threshold
    };
    const sfrComps: Comp[] = [
      comp({ price: 600_000, propertyType: "Single Family" }),
      comp({ price: 620_000, propertyType: "Single Family" }),
      comp({ price: 590_000, propertyType: "Single Family" }),
      comp({ price: 605_000, propertyType: "Single Family" }),
    ];
    const out = analyzeComparables(subject, buildCompsResult(sfrComps, []));
    expect(out.marketValue?.value).toBeGreaterThan(550_000);
  });
});

describe("analyzeComparables — market anchor override", () => {
  const subject: SubjectSnapshot = {
    address: "100 Comp Disagree Ct",
    beds: 3,
    baths: 2,
    sqft: 1500,
    propertyType: "Single Family",
    // The market has clearly priced this unit at ~$400k — recent sale + list.
    lastSalePrice: 400_000,
    lastSaleDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    currentListPrice: 405_000,
    expectedAppreciation: 0.03,
  };

  it("blends toward anchors when comps disagree by more than 25%", () => {
    // Comps say $600k — 50% above the market anchors.
    const hotComps: Comp[] = [
      comp({ price: 600_000 }),
      comp({ price: 620_000 }),
      comp({ price: 590_000 }),
      comp({ price: 605_000 }),
      comp({ price: 610_000 }),
    ];
    const out = analyzeComparables(subject, buildCompsResult(hotComps, []));
    expect(out.marketValue).not.toBeNull();
    // Blended value must fall BETWEEN anchors ($400k) and comps ($600k),
    // closer to anchors (policy: 35% comp + 65% anchor).
    expect(out.marketValue!.value).toBeGreaterThan(400_000);
    expect(out.marketValue!.value).toBeLessThan(550_000);
    expect(out.marketValue!.confidence).toBe("low");
    // workLog should mention the anchor divergence
    const logJoined = out.marketValue!.workLog.join(" ");
    expect(logJoined.toLowerCase()).toMatch(/anchor|disagree|divergence/);
  });

  it("adds a confirmation note when comps agree with anchors within 12%", () => {
    const agreeingComps: Comp[] = [
      comp({ price: 395_000 }),
      comp({ price: 410_000 }),
      comp({ price: 405_000 }),
      comp({ price: 400_000 }),
      comp({ price: 415_000 }),
    ];
    const out = analyzeComparables(subject, buildCompsResult(agreeingComps, []));
    const logJoined = out.marketValue!.workLog.join(" ");
    expect(logJoined.toLowerCase()).toMatch(/cross-check|agree/);
    expect(out.marketValue!.value).toBeGreaterThan(390_000);
    expect(out.marketValue!.value).toBeLessThan(420_000);
  });
});
