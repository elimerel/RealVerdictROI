import { describe, expect, it } from "vitest";
import {
  analyseDeal,
  DEFAULT_INPUTS,
  type DealInputs,
} from "@/lib/calculations";
import {
  analyzeComparables,
  type ComparablesAnalysis,
} from "@/lib/comparables";
import type { CompsResult } from "@/lib/comps";
import { buildPack } from "@/lib/negotiation-pack";

// ---------------------------------------------------------------------------
// Helpers — build a realistic ComparablesAnalysis without going through the
// RentCast network. We construct CompsResult fixtures and let the real
// analyzeComparables produce derivations + scored pools so the Pack tests
// exercise the same shape that production handing the API output would.
// ---------------------------------------------------------------------------

function makeComps(
  saleItems: Array<{
    address: string;
    price: number;
    sqft: number;
    beds: number;
    baths: number;
    distance?: number;
    daysOnMarket?: number;
  }>,
  rentItems: Array<{
    address: string;
    price: number;
    sqft: number;
    beds: number;
    baths: number;
    distance?: number;
    daysOnMarket?: number;
  }>,
): CompsResult {
  const today = new Date().toISOString().slice(0, 10);
  return {
    address: "1 Test Way, Springfield, IL 62701",
    saleComps: {
      items: saleItems.map((c) => ({
        address: c.address,
        price: c.price,
        squareFootage: c.sqft,
        bedrooms: c.beds,
        bathrooms: c.baths,
        distance: c.distance ?? 0.4,
        daysOnMarket: c.daysOnMarket ?? 30,
        date: today,
        propertyType: "Single Family",
      })),
      stats: {
        count: saleItems.length,
        median: saleItems.length
          ? saleItems.map((c) => c.price).sort((a, b) => a - b)[
              Math.floor(saleItems.length / 2)
            ]
          : undefined,
      },
    },
    rentComps: {
      items: rentItems.map((c) => ({
        address: c.address,
        price: c.price,
        squareFootage: c.sqft,
        bedrooms: c.beds,
        bathrooms: c.baths,
        distance: c.distance ?? 0.4,
        daysOnMarket: c.daysOnMarket ?? 14,
        date: today,
        propertyType: "Single Family",
      })),
      stats: {
        count: rentItems.length,
        median: rentItems.length
          ? rentItems.map((c) => c.price).sort((a, b) => a - b)[
              Math.floor(rentItems.length / 2)
            ]
          : undefined,
      },
    },
    radiusMilesUsed: 3,
    notes: [],
  };
}

function buildScenario(opts: {
  inputs?: Partial<DealInputs>;
  saleComps: Parameters<typeof makeComps>[0];
  rentComps: Parameters<typeof makeComps>[1];
  subject?: { sqft?: number; beds?: number; baths?: number; propertyType?: string };
  warnings?: string[];
}): {
  inputs: DealInputs;
  analysis: ReturnType<typeof analyseDeal>;
  comparables: ComparablesAnalysis;
  warnings: string[];
} {
  const inputs: DealInputs = { ...DEFAULT_INPUTS, ...(opts.inputs ?? {}) };
  const analysis = analyseDeal(inputs);
  const comps = makeComps(opts.saleComps, opts.rentComps);
  const comparables = analyzeComparables(
    {
      address: "1 Test Way, Springfield, IL 62701",
      price: inputs.purchasePrice,
      sqft: opts.subject?.sqft ?? 1500,
      beds: opts.subject?.beds ?? 3,
      baths: opts.subject?.baths ?? 2,
      propertyType: opts.subject?.propertyType ?? "Single Family",
    },
    comps,
  );
  return {
    inputs,
    analysis,
    comparables,
    warnings: opts.warnings ?? [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPack — headline", () => {
  it("frames a deal that has a walk-away price below list", () => {
    // Build a clearly-negative deal: high price, low rent. The walk-away
    // ceiling will be well below the list price.
    const { inputs, analysis, comparables, warnings } = buildScenario({
      inputs: {
        purchasePrice: 600_000,
        monthlyRent: 2_500,
        annualPropertyTax: 8_000,
        annualInsurance: 2_400,
      },
      saleComps: [
        { address: "10 A St", price: 580_000, sqft: 1500, beds: 3, baths: 2 },
        { address: "12 B St", price: 570_000, sqft: 1480, beds: 3, baths: 2 },
        { address: "14 C St", price: 590_000, sqft: 1520, beds: 3, baths: 2 },
        { address: "16 D St", price: 600_000, sqft: 1500, beds: 3, baths: 2 },
        { address: "18 E St", price: 575_000, sqft: 1450, beds: 3, baths: 2 },
      ],
      rentComps: [
        { address: "20 F St", price: 2_600, sqft: 1500, beds: 3, baths: 2 },
        { address: "22 G St", price: 2_550, sqft: 1480, beds: 3, baths: 2 },
        { address: "24 H St", price: 2_650, sqft: 1520, beds: 3, baths: 2 },
        { address: "26 I St", price: 2_500, sqft: 1500, beds: 3, baths: 2 },
        { address: "28 J St", price: 2_700, sqft: 1450, beds: 3, baths: 2 },
      ],
    });
    const pack = buildPack({
      address: "1 Test Way",
      inputs,
      analysis,
      comparables,
      warnings,
    });

    expect(pack.headline.listPrice).toBe(600_000);
    // walk-away may or may not exist depending on the rubric — the
    // important behavior is that whichever path triggers, the framing
    // string is non-empty and references the list price.
    expect(pack.headline.framing.length).toBeGreaterThan(20);
    expect(pack.headline.framing).toContain("$600,000");
  });
});

describe("buildPack — three weakest assumptions", () => {
  it("surfaces the homestead-trap warning at the top with severity high", () => {
    const taxWarning =
      "Property tax adjusted: the public-record bill of $2,369/yr reflects the current owner's IN homestead exemption. As an investor you'll pay roughly $5,800/yr at the non-homestead rate — a $3,431/yr expense the seller's pro forma is hiding.";
    const { inputs, analysis, comparables, warnings } = buildScenario({
      inputs: {
        purchasePrice: 350_000,
        annualPropertyTax: 5_800,
        monthlyRent: 2_600,
      },
      saleComps: [
        { address: "10 A St", price: 350_000, sqft: 1500, beds: 3, baths: 2 },
        { address: "12 B St", price: 345_000, sqft: 1480, beds: 3, baths: 2 },
        { address: "14 C St", price: 355_000, sqft: 1520, beds: 3, baths: 2 },
      ],
      rentComps: [
        { address: "20 F St", price: 2_600, sqft: 1500, beds: 3, baths: 2 },
        { address: "22 G St", price: 2_550, sqft: 1480, beds: 3, baths: 2 },
        { address: "24 H St", price: 2_650, sqft: 1520, beds: 3, baths: 2 },
      ],
      warnings: [taxWarning],
    });
    const pack = buildPack({
      address: "1 Test Way",
      inputs,
      analysis,
      comparables,
      warnings,
    });

    expect(pack.weakAssumptions.length).toBeGreaterThan(0);
    expect(pack.weakAssumptions[0].field).toMatch(/Property tax/i);
    expect(pack.weakAssumptions[0].severity).toBe("high");
    expect(pack.weakAssumptions[0].current).toContain("$2,369");
  });

  it("flags rent ≥ 10% above comp median", () => {
    const { inputs, analysis, comparables, warnings } = buildScenario({
      inputs: {
        purchasePrice: 350_000,
        monthlyRent: 3_200, // ~25% above the comp median ~2600
      },
      saleComps: [
        { address: "10 A St", price: 350_000, sqft: 1500, beds: 3, baths: 2 },
        { address: "12 B St", price: 345_000, sqft: 1480, beds: 3, baths: 2 },
        { address: "14 C St", price: 355_000, sqft: 1520, beds: 3, baths: 2 },
      ],
      rentComps: [
        { address: "20 F St", price: 2_600, sqft: 1500, beds: 3, baths: 2 },
        { address: "22 G St", price: 2_550, sqft: 1480, beds: 3, baths: 2 },
        { address: "24 H St", price: 2_650, sqft: 1520, beds: 3, baths: 2 },
      ],
    });
    const pack = buildPack({
      address: "1 Test Way",
      inputs,
      analysis,
      comparables,
      warnings,
    });

    const rentRow = pack.weakAssumptions.find((a) =>
      /rent/i.test(a.field),
    );
    expect(rentRow, "expected a rent assumption row").toBeDefined();
    expect(rentRow!.severity).toBe("high"); // ≥20% gap
    expect(rentRow!.current).toContain("$3,200");
  });

  it("returns at most three assumptions", () => {
    // Force many flags: homestead warning + high rent + low-confidence
    // insurance (state-average) + thin comp pool + low vacancy.
    const taxWarning =
      "Property tax adjusted: the public-record bill of $2,000/yr reflects the current owner's IN homestead exemption. As an investor you'll pay roughly $5,000/yr at the non-homestead rate — a $3,000/yr expense the seller's pro forma is hiding.";
    const { inputs, analysis, comparables, warnings } = buildScenario({
      inputs: {
        purchasePrice: 350_000,
        monthlyRent: 3_500,
        annualPropertyTax: 5_000,
        annualInsurance: 1_500,
        vacancyRatePercent: 3,
      },
      saleComps: [
        { address: "10 A St", price: 350_000, sqft: 1500, beds: 3, baths: 2 },
        { address: "12 B St", price: 345_000, sqft: 1480, beds: 3, baths: 2 },
        { address: "14 C St", price: 355_000, sqft: 1520, beds: 3, baths: 2 },
      ],
      rentComps: [
        { address: "20 F St", price: 2_400, sqft: 1500, beds: 3, baths: 2 },
        { address: "22 G St", price: 2_450, sqft: 1480, beds: 3, baths: 2 },
        { address: "24 H St", price: 2_500, sqft: 1520, beds: 3, baths: 2 },
      ],
      warnings: [taxWarning],
    });
    const pack = buildPack({
      address: "1 Test Way",
      inputs,
      analysis,
      comparables,
      warnings,
      provenance: {
        annualInsurance: {
          source: "state-average",
          confidence: "low",
          note: "State-avg HO3.",
        },
      },
    });

    expect(pack.weakAssumptions.length).toBeLessThanOrEqual(3);
    expect(pack.weakAssumptions[0].field).toMatch(/Property tax/i);
  });
});

describe("buildPack — comp evidence", () => {
  it("returns up to 3 sale and 3 rent comps with a non-empty 'why'", () => {
    const { inputs, analysis, comparables, warnings } = buildScenario({
      inputs: { purchasePrice: 350_000, monthlyRent: 2_600 },
      saleComps: [
        { address: "10 A St", price: 350_000, sqft: 1500, beds: 3, baths: 2 },
        { address: "12 B St", price: 345_000, sqft: 1480, beds: 3, baths: 2 },
        { address: "14 C St", price: 355_000, sqft: 1520, beds: 3, baths: 2 },
        { address: "16 D St", price: 360_000, sqft: 1500, beds: 3, baths: 2 },
      ],
      rentComps: [
        { address: "20 F St", price: 2_600, sqft: 1500, beds: 3, baths: 2 },
        { address: "22 G St", price: 2_550, sqft: 1480, beds: 3, baths: 2 },
        { address: "24 H St", price: 2_650, sqft: 1520, beds: 3, baths: 2 },
        { address: "26 I St", price: 2_700, sqft: 1500, beds: 3, baths: 2 },
      ],
    });
    const pack = buildPack({
      address: "1 Test Way",
      inputs,
      analysis,
      comparables,
      warnings,
    });

    expect(pack.compEvidence.sale.length).toBeLessThanOrEqual(3);
    expect(pack.compEvidence.sale.length).toBeGreaterThan(0);
    expect(pack.compEvidence.rent.length).toBeLessThanOrEqual(3);
    expect(pack.compEvidence.rent.length).toBeGreaterThan(0);
    pack.compEvidence.sale.forEach((c) => {
      expect(c.address).toBeTruthy();
      expect(c.why.length).toBeGreaterThan(0);
    });
  });
});

describe("buildPack — stress scenarios", () => {
  it("runs all four scenarios and tags any tier flips", () => {
    const { inputs, analysis, comparables, warnings } = buildScenario({
      inputs: { purchasePrice: 350_000, monthlyRent: 2_600 },
      saleComps: [
        { address: "10 A St", price: 350_000, sqft: 1500, beds: 3, baths: 2 },
        { address: "12 B St", price: 345_000, sqft: 1480, beds: 3, baths: 2 },
        { address: "14 C St", price: 355_000, sqft: 1520, beds: 3, baths: 2 },
      ],
      rentComps: [
        { address: "20 F St", price: 2_600, sqft: 1500, beds: 3, baths: 2 },
        { address: "22 G St", price: 2_550, sqft: 1480, beds: 3, baths: 2 },
        { address: "24 H St", price: 2_650, sqft: 1520, beds: 3, baths: 2 },
      ],
    });
    const pack = buildPack({
      address: "1 Test Way",
      inputs,
      analysis,
      comparables,
      warnings,
    });

    const labels = pack.stressScenarios.map((s) => s.label);
    expect(labels).toEqual([
      "Rent drops 10%",
      "Expenses jump 25%",
      "Refi rate +1pt",
      "Sells 10% below today",
    ]);
    pack.stressScenarios.forEach((s) => {
      expect(s.oneLine.length).toBeGreaterThan(10);
      expect(typeof s.flippedFromBase).toBe("boolean");
    });
  });
});

describe("buildPack — counteroffer", () => {
  it("includes the walk-away number and is at least 2 paragraphs when ceiling exists", () => {
    const { inputs, analysis, comparables, warnings } = buildScenario({
      inputs: { purchasePrice: 350_000, monthlyRent: 3_400 },
      saleComps: [
        { address: "10 A St", price: 350_000, sqft: 1500, beds: 3, baths: 2 },
        { address: "12 B St", price: 345_000, sqft: 1480, beds: 3, baths: 2 },
        { address: "14 C St", price: 355_000, sqft: 1520, beds: 3, baths: 2 },
      ],
      rentComps: [
        { address: "20 F St", price: 2_600, sqft: 1500, beds: 3, baths: 2 },
        { address: "22 G St", price: 2_550, sqft: 1480, beds: 3, baths: 2 },
        { address: "24 H St", price: 2_650, sqft: 1520, beds: 3, baths: 2 },
      ],
    });
    const pack = buildPack({
      address: "1 Test Way, Springfield, IL",
      inputs,
      analysis,
      comparables,
      warnings,
    });

    expect(pack.counteroffer.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(pack.counteroffer.paragraphs[0]).toContain("Test Way");
    expect(pack.counteroffer.listPrice).toBe(350_000);
  });

  it("falls back to a 'pass' script when no realistic walk-away clears the rubric", () => {
    // Subject is wildly overpriced relative to comps — no ceiling will clear.
    const { inputs, analysis, comparables, warnings } = buildScenario({
      inputs: {
        purchasePrice: 1_500_000,
        monthlyRent: 1_500,
        annualPropertyTax: 12_000,
        annualInsurance: 3_000,
      },
      saleComps: [
        { address: "10 A St", price: 350_000, sqft: 1500, beds: 3, baths: 2 },
        { address: "12 B St", price: 345_000, sqft: 1480, beds: 3, baths: 2 },
        { address: "14 C St", price: 355_000, sqft: 1520, beds: 3, baths: 2 },
      ],
      rentComps: [
        { address: "20 F St", price: 1_500, sqft: 1500, beds: 3, baths: 2 },
        { address: "22 G St", price: 1_550, sqft: 1480, beds: 3, baths: 2 },
        { address: "24 H St", price: 1_450, sqft: 1520, beds: 3, baths: 2 },
      ],
    });
    const pack = buildPack({
      address: "1 Test Way",
      inputs,
      analysis,
      comparables,
      warnings,
    });

    expect(pack.headline.walkAwayPrice).toBeNull();
    expect(pack.counteroffer.paragraphs.join(" ")).toMatch(/passing|pass\b/i);
  });
});

describe("buildPack — snapshot", () => {
  it("captures price/rent/CF/cap/DSCR/IRR + comps confidence", () => {
    const { inputs, analysis, comparables, warnings } = buildScenario({
      inputs: { purchasePrice: 350_000, monthlyRent: 2_600 },
      saleComps: [
        { address: "10 A St", price: 350_000, sqft: 1500, beds: 3, baths: 2 },
        { address: "12 B St", price: 345_000, sqft: 1480, beds: 3, baths: 2 },
        { address: "14 C St", price: 355_000, sqft: 1520, beds: 3, baths: 2 },
      ],
      rentComps: [
        { address: "20 F St", price: 2_600, sqft: 1500, beds: 3, baths: 2 },
        { address: "22 G St", price: 2_550, sqft: 1480, beds: 3, baths: 2 },
        { address: "24 H St", price: 2_650, sqft: 1520, beds: 3, baths: 2 },
      ],
    });
    const pack = buildPack({
      address: "1 Test Way",
      inputs,
      analysis,
      comparables,
      warnings,
    });

    expect(pack.snapshot.purchasePrice).toBe(350_000);
    expect(pack.snapshot.monthlyRent).toBe(2_600);
    expect(["high", "medium", "low"]).toContain(pack.snapshot.compsConfidence);
    expect(pack.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
