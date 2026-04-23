import { describe, expect, it } from "vitest";
import {
  buildMarketSignals,
  classifyDealStructureArchetype,
  extractUsZipFromAddress,
  formatMarketSignalsHeroLine,
} from "./market-context";
import { DEFAULT_INPUTS } from "./calculations";

describe("extractUsZipFromAddress", () => {
  it("reads trailing ZIP", () => {
    expect(extractUsZipFromAddress("123 Main St, Edison NJ 08837")).toBe(
      "08837",
    );
  });

  it("reads ZIP+4 suffix", () => {
    expect(extractUsZipFromAddress("PO Box 1, Somewhere CA 90001-1234")).toBe(
      "90001",
    );
  });

  it("reads ST ZIP pattern", () => {
    expect(extractUsZipFromAddress("Main St, Austin TX 78701")).toBe("78701");
  });

  it("returns undefined when absent", () => {
    expect(extractUsZipFromAddress("123 Main Street")).toBeUndefined();
  });
});

describe("classifyDealStructureArchetype", () => {
  it("tags high list-to-rent multiples", () => {
    expect(classifyDealStructureArchetype(800_000, 2000)).toBe("equity_heavy");
  });

  it("tags low multiples", () => {
    expect(classifyDealStructureArchetype(200_000, 2000)).toBe("income_slanted");
  });

  it("tags the middle band", () => {
    expect(classifyDealStructureArchetype(400_000, 2000)).toBe("balanced");
  });

  it("returns undefined without valid geometry", () => {
    expect(classifyDealStructureArchetype(0, 2000)).toBeUndefined();
    expect(classifyDealStructureArchetype(400_000, 0)).toBeUndefined();
  });
});

describe("buildMarketSignals", () => {
  it("merges ACS and deal geometry", () => {
    const inputs = { ...DEFAULT_INPUTS, purchasePrice: 400_000, monthlyRent: 2000 };
    const acs = {
      zip: "08837",
      vintageYear: 2023,
      medianGrossRentMonthly: 1778,
      medianOwnerOccupiedValue: 432_500,
      medianHouseholdIncome: 107_948,
      housingVacancyRate: 313 / 7670,
    };
    const s = buildMarketSignals(inputs, "08837", acs);
    expect(s.marketZip).toBe("08837");
    expect(s.acsVintageYear).toBe(2023);
    expect(s.zipMedianGrossRentMonthly).toBe(1778);
    expect(s.userMonthlyRentToZipMedianRatio).toBeCloseTo(2000 / 1778, 5);
    expect(s.dealStructureArchetype).toBe("balanced");
  });

  it("works without ACS", () => {
    const inputs = { ...DEFAULT_INPUTS, purchasePrice: 900_000, monthlyRent: 2000 };
    const s = buildMarketSignals(inputs, "08837", null);
    expect(s.marketZip).toBe("08837");
    expect(s.acsVintageYear).toBeUndefined();
    expect(s.dealStructureArchetype).toBe("equity_heavy");
  });
});

describe("formatMarketSignalsHeroLine", () => {
  it("returns null for empty signals", () => {
    expect(formatMarketSignalsHeroLine({})).toBeNull();
  });

  it("joins non-empty fragments", () => {
    const line = formatMarketSignalsHeroLine({
      marketZip: "08837",
      acsVintageYear: 2023,
      zipMedianGrossRentMonthly: 1778,
      listPriceToAnnualGrossRentMultiple: 16.7,
      dealStructureArchetype: "balanced",
    });
    expect(line).toContain("08837");
    expect(line).toContain("ACS 2023");
    expect(line).toContain("1,778");
    expect(line).toContain("16.7×");
    expect(line).toContain("mixed");
  });
});
