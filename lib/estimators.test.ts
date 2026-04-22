import { describe, it, expect } from "vitest";
import {
  estimateAnnualInsurance,
  estimateAnnualPropertyTax,
  detectStateFromAddress,
} from "./estimators";

describe("detectStateFromAddress", () => {
  it("reads a trailing 2-letter state code", () => {
    expect(detectStateFromAddress("123 Main St, Austin, TX 78722")).toBe("TX");
    expect(detectStateFromAddress("1401 Ocean Dr, Miami Beach, FL 33139")).toBe("FL");
    expect(detectStateFromAddress("37 Merker Dr, Edison, NJ 08817")).toBe("NJ");
  });

  it("reads a trailing state code with no ZIP", () => {
    expect(detectStateFromAddress("50 Broadway, Staten Island, NY")).toBe("NY");
  });

  it("reads full state names (lowercase-safe)", () => {
    expect(detectStateFromAddress("100 Test Rd, Anytown, california")).toBe("CA");
    expect(detectStateFromAddress("1 Road, Ville, New Hampshire 03301")).toBe("NH");
  });

  it("returns undefined for bogus input", () => {
    expect(detectStateFromAddress("")).toBeUndefined();
    expect(detectStateFromAddress("not a real address")).toBeUndefined();
    expect(detectStateFromAddress("123 Main St ZZ 99999")).toBeUndefined();
  });
});

describe("estimateAnnualInsurance", () => {
  it("is 0 with medium/low confidence when home value is missing", () => {
    const e = estimateAnnualInsurance(0, "FL");
    expect(e.value).toBe(0);
    expect(e.confidence).toBe("low");
  });

  it("FL premium is materially higher than NY for the same home", () => {
    const fl = estimateAnnualInsurance(500_000, "FL");
    const ny = estimateAnnualInsurance(500_000, "NY");
    expect(fl.value).toBeGreaterThan(ny.value * 2);
  });

  it("state match is tagged as medium confidence, national fallback as low", () => {
    expect(estimateAnnualInsurance(300_000, "TX").confidence).toBe("medium");
    expect(estimateAnnualInsurance(300_000).confidence).toBe("low");
  });

  it("scales linearly with home value", () => {
    const small = estimateAnnualInsurance(200_000, "TX").value;
    const big = estimateAnnualInsurance(800_000, "TX").value;
    // 4× home value → roughly 4× premium (allow 1$ rounding)
    expect(big / small).toBeCloseTo(4, 1);
  });
});

describe("estimateAnnualPropertyTax", () => {
  it("NJ (highest rate state) is multiples higher than HI (lowest)", () => {
    const nj = estimateAnnualPropertyTax(400_000, "NJ");
    const hi = estimateAnnualPropertyTax(400_000, "HI");
    expect(nj.value).toBeGreaterThan(hi.value * 5);
  });

  it("zero home value returns 0 with low confidence", () => {
    const e = estimateAnnualPropertyTax(0, "NJ");
    expect(e.value).toBe(0);
    expect(e.confidence).toBe("low");
  });

  it("falls back to national average with low confidence when state unknown", () => {
    const e = estimateAnnualPropertyTax(400_000);
    expect(e.confidence).toBe("low");
    expect(e.source).toBe("national-average");
    expect(e.value).toBeGreaterThan(0);
  });
});
