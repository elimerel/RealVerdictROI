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

describe("analyzeComparables — SFR override on HOA-lite Condo mislabel (Hoagland fix, §16.U #1)", () => {
  // The Hoagland listing was a 3bd/2ba/1,637 sqft detached SFR with $29/mo
  // HOA. Zillow's HomeTypeCategoryEnum returned "Condo", which made the old
  // inferSubjectCategory classify it as condo-apt. Every real-SFR comp then
  // received the −50 type-mismatch penalty in scoreComp, filtering the comp
  // pool away from the correct peers and producing a condo-priced derivation
  // for what was structurally a detached house.

  const hoaglandLikeSubject: SubjectSnapshot = {
    address: "14215 Hawk Stream Cv, Hoagland, IN",
    beds: 3,
    baths: 2,
    sqft: 1637,
    propertyType: "Condo", // Zillow's mislabel
    monthlyHOA: 29,
  };

  it("derives a SFR-priced value when the comp pool is detached SFRs", () => {
    const sfrComps: Comp[] = [
      comp({ price: 280_000, propertyType: "Single Family", squareFootage: 1600 }),
      comp({ price: 295_000, propertyType: "Single Family", squareFootage: 1700 }),
      comp({ price: 270_000, propertyType: "Single Family", squareFootage: 1500 }),
      comp({ price: 285_000, propertyType: "Single Family", squareFootage: 1650 }),
      comp({ price: 290_000, propertyType: "Single Family", squareFootage: 1620 }),
    ];
    const out = analyzeComparables(
      hoaglandLikeSubject,
      buildCompsResult(sfrComps, []),
    );
    expect(out.marketValue).not.toBeNull();
    // Pre-fix, the SFR pool was filtered away by the type penalty and the
    // derivation either produced nothing or anchored on whatever condos it
    // could find. Post-fix, the SFR comps drive a defensible value in the
    // $260k–$310k band.
    expect(out.marketValue!.value).toBeGreaterThan(260_000);
    expect(out.marketValue!.value).toBeLessThan(320_000);
    // Crucially, NO SFR comp in the pool should be flagged as a type
    // mismatch — the override means subject is now classified single-family.
    const sfrUsed = out.marketValue!.compsUsed.filter((c) =>
      /single family/i.test(c.propertyType ?? ""),
    );
    expect(sfrUsed.length).toBeGreaterThan(0);
    for (const s of sfrUsed) {
      expect(s.missReasons.join(" ").toLowerCase()).not.toMatch(/single family|condo/i);
    }
  });

  it("logs the reclassification in the workLog so the user can audit it", () => {
    const sfrComps: Comp[] = [
      comp({ price: 280_000, propertyType: "Single Family" }),
      comp({ price: 295_000, propertyType: "Single Family" }),
      comp({ price: 270_000, propertyType: "Single Family" }),
      comp({ price: 285_000, propertyType: "Single Family" }),
    ];
    const out = analyzeComparables(
      hoaglandLikeSubject,
      buildCompsResult(sfrComps, []),
    );
    const log = out.marketValue!.workLog.join(" ").toLowerCase();
    expect(log).toMatch(/reclassif/);
    expect(log).toMatch(/single-family/);
  });

  it("does NOT override a real condo with a real HOA (3bd, 1500sqft, $300 HOA)", () => {
    // A genuine medium-large condo (the kind that exists in metro Florida or
    // downtown high-rises) carries a material HOA. The SFR override must not
    // fire here — the subject must remain classified as condo-apt so SFR
    // comps continue to be flagged as type mismatches and condo comps drive
    // the derivation.
    const realCondo: SubjectSnapshot = {
      address: "100 Real Condo Way",
      beds: 3,
      baths: 2,
      sqft: 1500,
      propertyType: "Condo",
      monthlyHOA: 300,
    };
    const mixedComps: Comp[] = [
      comp({ price: 600_000, propertyType: "Single Family", address: "1 SFR" }),
      comp({ price: 620_000, propertyType: "Single Family", address: "2 SFR" }),
      comp({ price: 590_000, propertyType: "Single Family", address: "3 SFR" }),
      comp({ price: 300_000, propertyType: "Condo", address: "1 Condo" }),
      comp({ price: 310_000, propertyType: "Condo", address: "2 Condo" }),
      comp({ price: 295_000, propertyType: "Condo", address: "3 Condo" }),
      comp({ price: 305_000, propertyType: "Condo", address: "4 Condo" }),
    ];
    const out = analyzeComparables(realCondo, buildCompsResult(mixedComps, []));
    // No SFR-→ single-family reclassification should be in the workLog.
    const log = out.marketValue!.workLog.join(" ").toLowerCase();
    expect(log).not.toMatch(/single-family/);
    // SFR comps that made the pool must be flagged as type mismatches.
    const sfrUsed = out.marketValue!.compsUsed.filter((c) =>
      /single family/i.test(c.propertyType ?? ""),
    );
    for (const s of sfrUsed) {
      expect(s.missReasons.join(" ").toLowerCase()).toMatch(/condo|single family/i);
    }
    // The condo comps should dominate the derivation (subject correctly
    // classified as condo-apt → condo comps win on score).
    expect(out.marketValue!.value).toBeLessThan(450_000);
  });

  it("does NOT override a small condo (2bd/1100sqft) even with $0 HOA", () => {
    // Small no-HOA "condo" — could be a downtown loft or co-op apartment.
    // Structural signals don't strongly contradict the label (sqft < 1500),
    // so leave the explicit classification alone.
    const smallCondo: SubjectSnapshot = {
      address: "100 Loft St",
      beds: 2,
      baths: 1,
      sqft: 1100,
      propertyType: "Condo",
      monthlyHOA: 0,
    };
    const sfrComps: Comp[] = [
      comp({ price: 500_000, propertyType: "Single Family", bedrooms: 2, squareFootage: 1100 }),
      comp({ price: 510_000, propertyType: "Single Family", bedrooms: 2, squareFootage: 1100 }),
      comp({ price: 490_000, propertyType: "Single Family", bedrooms: 2, squareFootage: 1100 }),
      comp({ price: 505_000, propertyType: "Single Family", bedrooms: 2, squareFootage: 1100 }),
    ];
    const out = analyzeComparables(smallCondo, buildCompsResult(sfrComps, []));
    // SFR comps should still be flagged as type mismatches.
    const compsUsed = out.marketValue?.compsUsed ?? [];
    const sfrUsed = compsUsed.filter((c) => /single family/i.test(c.propertyType ?? ""));
    for (const s of sfrUsed) {
      expect(s.missReasons.join(" ").toLowerCase()).toMatch(/single family|condo/i);
    }
  });

  it("override fires symmetrically on the rent derivation, not just the sale derivation", () => {
    const rentComps: Comp[] = [
      comp({ price: 1500, propertyType: "Single Family", squareFootage: 1600 }),
      comp({ price: 1550, propertyType: "Single Family", squareFootage: 1700 }),
      comp({ price: 1480, propertyType: "Single Family", squareFootage: 1500 }),
      comp({ price: 1520, propertyType: "Single Family", squareFootage: 1650 }),
    ];
    const out = analyzeComparables(
      hoaglandLikeSubject,
      buildCompsResult([], rentComps),
    );
    expect(out.marketRent).not.toBeNull();
    // Pre-fix: condo-classified subject would have filtered every SFR rent
    // comp out via the SFR↔condo penalty, leaving no usable comps and the
    // derivation would have returned null.
    expect(out.marketRent!.value).toBeGreaterThan(1300);
    expect(out.marketRent!.value).toBeLessThan(1700);
    expect(out.marketRent!.workLog.join(" ").toLowerCase()).toMatch(/reclassif/);
  });

  it("HOA-lite SFR mislabeled as Apartment also gets reclassified", () => {
    // RentCast sometimes returns "Apartment" for the same HOA-lite SFR
    // scenario. The override must handle the broader condo-apt category.
    const apartmentLabeledSubject: SubjectSnapshot = {
      address: "12345 Suburb Ln",
      beds: 4,
      baths: 2.5,
      sqft: 2200,
      propertyType: "Apartment",
      monthlyHOA: 0,
    };
    const sfrComps: Comp[] = [
      comp({ price: 350_000, propertyType: "Single Family", bedrooms: 4, squareFootage: 2100 }),
      comp({ price: 365_000, propertyType: "Single Family", bedrooms: 4, squareFootage: 2200 }),
      comp({ price: 340_000, propertyType: "Single Family", bedrooms: 4, squareFootage: 2300 }),
      comp({ price: 355_000, propertyType: "Single Family", bedrooms: 4, squareFootage: 2150 }),
    ];
    const out = analyzeComparables(
      apartmentLabeledSubject,
      buildCompsResult(sfrComps, []),
    );
    // Override fires on apartment label too — comps drive the price.
    expect(out.marketValue!.value).toBeGreaterThan(330_000);
    expect(out.marketValue!.value).toBeLessThan(380_000);
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

describe("analyzeComparables — $/sqft outlier z-score filter (§16.U.1 #5 / §20.9 #8)", () => {
  const subject: SubjectSnapshot = {
    address: "123 Outlier Test Way",
    beds: 3,
    baths: 2,
    sqft: 1500,
    propertyType: "Single Family",
  };

  it("trims a single luxury-rehab outlier from the $/sqft pool", () => {
    // Five 'normal' comps clustered around $300/sqft + one $1,200/sqft
    // luxury rehab. Without the trim, the median bumps up significantly
    // and the anchor-blend has to clean it up. With the trim, the median
    // sits at the cluster's central tendency and the workLog names the
    // dropped comp.
    const normalComps: Comp[] = [
      comp({ price: 450_000, squareFootage: 1500, address: "1 Normal St" }),
      comp({ price: 460_000, squareFootage: 1500, address: "2 Normal St" }),
      comp({ price: 440_000, squareFootage: 1500, address: "3 Normal St" }),
      comp({ price: 455_000, squareFootage: 1500, address: "4 Normal St" }),
      comp({ price: 445_000, squareFootage: 1500, address: "5 Normal St" }),
    ];
    const luxury = comp({
      price: 1_800_000, // $1,200/sqft — way above mean
      squareFootage: 1500,
      address: "999 Luxury Way",
    });
    const out = analyzeComparables(
      subject,
      buildCompsResult([...normalComps, luxury], []),
    );
    expect(out.marketValue).not.toBeNull();
    const log = out.marketValue!.workLog.join(" ");
    expect(log.toLowerCase()).toMatch(/trimmed.*outlier/);
    expect(log).toContain("999 Luxury Way");
    // Headline value lands near the cluster median ($300/sqft × 1500 = $450k).
    expect(out.marketValue!.value).toBeGreaterThan(420_000);
    expect(out.marketValue!.value).toBeLessThan(490_000);
  });

  it("does NOT trim when the pool is too small (need ≥5 comps to compute meaningful stdev)", () => {
    const smallPool: Comp[] = [
      comp({ price: 450_000, squareFootage: 1500, address: "1 Small St" }),
      comp({ price: 460_000, squareFootage: 1500, address: "2 Small St" }),
      comp({ price: 1_500_000, squareFootage: 1500, address: "3 Small St" }),
    ];
    const out = analyzeComparables(subject, buildCompsResult(smallPool, []));
    const log = out.marketValue!.workLog.join(" ");
    expect(log.toLowerCase()).not.toMatch(/trimmed.*outlier/);
  });

  it("does NOT trim a homogeneous pool (low coefficient of variation)", () => {
    const tightPool: Comp[] = [
      comp({ price: 450_000, squareFootage: 1500, address: "1 A St" }),
      comp({ price: 452_000, squareFootage: 1500, address: "2 A St" }),
      comp({ price: 451_000, squareFootage: 1500, address: "3 A St" }),
      comp({ price: 453_000, squareFootage: 1500, address: "4 A St" }),
      comp({ price: 449_000, squareFootage: 1500, address: "5 A St" }),
    ];
    const out = analyzeComparables(subject, buildCompsResult(tightPool, []));
    const log = out.marketValue!.workLog.join(" ");
    expect(log.toLowerCase()).not.toMatch(/trimmed.*outlier/);
  });

  it("never trims the pool below 3 comps even if many are flagged", () => {
    // Two clusters: 3 normal at ~$300/sqft and 2 absurd at ~$2000/sqft.
    // The absurds qualify as outliers but trimming both would leave 3,
    // which equals the floor — so trimming proceeds. Add only ONE more
    // outlier here so the floor protection IS exercised.
    const pool: Comp[] = [
      comp({ price: 300_000, squareFootage: 1500, address: "1 Floor St" }),
      comp({ price: 305_000, squareFootage: 1500, address: "2 Floor St" }),
      comp({ price: 295_000, squareFootage: 1500, address: "3 Floor St" }),
      comp({ price: 3_000_000, squareFootage: 1500, address: "4 Floor St" }),
      comp({ price: 3_100_000, squareFootage: 1500, address: "5 Floor St" }),
    ];
    const out = analyzeComparables(subject, buildCompsResult(pool, []));
    expect(out.marketValue).not.toBeNull();
    // At least 3 comps survive (the trim floor).
    expect(out.marketValue!.compsUsed.length).toBeGreaterThanOrEqual(3);
  });
});
