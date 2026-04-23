import { describe, it, expect } from "vitest";
import {
  detectHomesteadTrap,
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

  // §16.U #2 / §20.9 #3 regression. The Hoagland listing has a 5-digit
  // street number ("14215"), which the old `\b\d{5}\b` ZIP-strip regex
  // ate as the FIRST 5-digit run, leaving the real ZIP dangling at the
  // end and breaking the trailing-state regex. The trailing-anchored
  // strip fixes it.
  it("handles 5-digit street numbers (Hoagland listing regression)", () => {
    expect(
      detectStateFromAddress("14215 Hawk Stream Cv, Hoagland, IN 46745"),
    ).toBe("IN");
    expect(
      detectStateFromAddress("12345 Elm St, Anytown, GA 30301-1234"),
    ).toBe("GA");
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

  it("defaults to investor (non-homestead) rate in homestead-trap states", () => {
    // Listing #1 numbers: $299,900 IN. Owner-occupied IN rate is 0.85%
    // (~$2,549/yr). Investor IN rate is 1.85% (~$5,548/yr).
    const investor = estimateAnnualPropertyTax(299_900, "IN");
    expect(investor.source).toBe("state-investor-rate:IN");
    expect(investor.value).toBeGreaterThan(5_000);
    expect(investor.value).toBeLessThan(6_000);
    expect(investor.note).toMatch(/non-homestead/);

    const ownerOccupied = estimateAnnualPropertyTax(299_900, "IN", {
      ownerOccupied: true,
    });
    expect(ownerOccupied.source).toBe("state-effective-rate:IN");
    expect(ownerOccupied.value).toBeGreaterThan(2_000);
    expect(ownerOccupied.value).toBeLessThan(3_000);
    // Investor rate must be materially higher than owner-occupied
    expect(investor.value).toBeGreaterThan(ownerOccupied.value * 1.5);
  });

  it("homestead-trap states all return investor-rate provenance by default", () => {
    for (const state of ["IN", "FL", "TX", "CA", "GA", "MI"] as const) {
      const e = estimateAnnualPropertyTax(400_000, state);
      expect(e.source).toBe(`state-investor-rate:${state}`);
      expect(e.confidence).toBe("medium");
    }
  });

  it("non-homestead-trap states use the state effective rate (no investor override)", () => {
    // MT has no significant homestead/non-homestead delta. The investor
    // estimate should equal the owner-occupied estimate.
    const investor = estimateAnnualPropertyTax(315_000, "MT");
    const ownerOccupied = estimateAnnualPropertyTax(315_000, "MT", {
      ownerOccupied: true,
    });
    expect(investor.value).toBe(ownerOccupied.value);
    expect(investor.source).toBe("state-effective-rate:MT");
  });
});

describe("detectHomesteadTrap", () => {
  it("detects the trap on Hoagland, IN (listing #1 from §16.U)", () => {
    // $2,369/yr on $299,900 = 0.79% — that's the IN homestead cap rate.
    // Investor rate is 1.85%, so we expect a trap with an investor estimate
    // of ~$5,548/yr.
    const trap = detectHomesteadTrap(2_369, 299_900, "IN");
    expect(trap).not.toBeNull();
    expect(trap!.state).toBe("IN");
    expect(trap!.observedRate).toBeCloseTo(0.79, 1);
    expect(trap!.investorRate).toBe(1.85);
    expect(trap!.investorEstimate).toBeGreaterThan(5_000);
    expect(trap!.investorEstimate).toBeLessThan(6_000);
  });

  it("does NOT trip when the line-item is already at the investor rate", () => {
    // A FL property where the assessor bill matches the non-homestead rate
    // (e.g. an existing investor-owned property) should be left alone.
    const investorRateFL = 0.0145;
    const homeValue = 400_000;
    const annualTax = Math.round(homeValue * investorRateFL);
    expect(detectHomesteadTrap(annualTax, homeValue, "FL")).toBeNull();
  });

  it("does NOT trip in non-homestead-trap states even when rate is low", () => {
    // MT, NY, NJ, etc. — owner-occupied and investor effectively pay the
    // same rate, so a low public-record bill is just a stale assessment,
    // not a homestead trap.
    expect(detectHomesteadTrap(800, 300_000, "MT")).toBeNull();
    expect(detectHomesteadTrap(2_500, 500_000, "NY")).toBeNull();
  });

  it("does NOT trip on missing inputs", () => {
    expect(detectHomesteadTrap(0, 300_000, "IN")).toBeNull();
    expect(detectHomesteadTrap(2_000, 0, "IN")).toBeNull();
    expect(detectHomesteadTrap(2_000, 300_000, undefined)).toBeNull();
  });

  it("handles each homestead-trap state when current owner is homesteaded", () => {
    // Roughly half the investor rate — a clear homestead signal in each state.
    const cases: Array<[Parameters<typeof detectHomesteadTrap>[2], number, number]> = [
      ["IN", 300_000, 300_000 * 0.008],
      ["FL", 400_000, 400_000 * 0.006],
      ["TX", 350_000, 350_000 * 0.010],
      ["CA", 800_000, 800_000 * 0.005], // SOH-capped from a 1990s purchase
      ["GA", 250_000, 250_000 * 0.005],
      ["MI", 220_000, 220_000 * 0.011],
    ];
    for (const [state, value, tax] of cases) {
      const trap = detectHomesteadTrap(tax, value, state);
      expect(trap, `expected trap for ${state}`).not.toBeNull();
      expect(trap!.investorEstimate).toBeGreaterThan(tax);
    }
  });
});
