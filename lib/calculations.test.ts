import { describe, it, expect } from "vitest";
import {
  DEFAULT_INPUTS,
  analyseDeal,
  findOfferCeiling,
  mortgagePayment,
  remainingLoanBalance,
  amortisationWindow,
  irr,
  sanitiseInputs,
  type DealInputs,
} from "./calculations";

const make = (overrides: Partial<DealInputs> = {}): DealInputs => ({
  ...DEFAULT_INPUTS,
  ...overrides,
});

describe("mortgagePayment", () => {
  it("matches the textbook amortisation formula for 7% / 30yr / 300k", () => {
    const p = mortgagePayment(300_000, 7, 30);
    // Expected monthly P&I ≈ 1995.91 (well-known reference)
    expect(p).toBeGreaterThan(1990);
    expect(p).toBeLessThan(2001);
  });

  it("returns 0 for zero principal or term", () => {
    expect(mortgagePayment(0, 7, 30)).toBe(0);
    expect(mortgagePayment(300_000, 7, 0)).toBe(0);
  });

  it("handles zero interest as straight-line amortisation", () => {
    const p = mortgagePayment(120_000, 0, 10);
    expect(p).toBeCloseTo(120_000 / 120, 4);
  });
});

describe("remainingLoanBalance + amortisationWindow", () => {
  it("fully amortises to ~0 at term end", () => {
    const bal = remainingLoanBalance(300_000, 7, 30, 360);
    expect(bal).toBeLessThan(1);
  });

  it("balance decreases monotonically over time", () => {
    const balances = [0, 60, 120, 240, 360].map((m) =>
      remainingLoanBalance(300_000, 7, 30, m),
    );
    for (let i = 1; i < balances.length; i++) {
      expect(balances[i]).toBeLessThan(balances[i - 1]);
    }
  });

  it("window principal + interest ≈ total payment × months", () => {
    const { principalPaid, interestPaid } = amortisationWindow(300_000, 7, 30, 0, 12);
    const payment = mortgagePayment(300_000, 7, 30);
    expect(principalPaid + interestPaid).toBeCloseTo(payment * 12, 0);
  });
});

describe("irr", () => {
  it("matches analytic 10% on a 4yr +10% return", () => {
    // $1,000 invested, $1,464.10 returned at year 4 — IRR is exactly 10%
    const rate = irr([-1_000, 0, 0, 0, 1_464.1]);
    expect(rate).toBeCloseTo(0.1, 3);
  });

  it("returns NaN when there is no sign change", () => {
    expect(irr([1, 2, 3])).toBeNaN();
    expect(irr([-1, -2, -3])).toBeNaN();
  });

  it("handles deals with negative IRR", () => {
    const rate = irr([-1_000, 0, 0, 0, 500]);
    expect(rate).toBeLessThan(0);
    expect(rate).toBeGreaterThan(-0.2);
  });
});

describe("sanitiseInputs", () => {
  it("clamps percentages to 0..100", () => {
    const s = sanitiseInputs(
      make({ downPaymentPercent: 300, vacancyRatePercent: -5 }),
    );
    expect(s.downPaymentPercent).toBe(100);
    expect(s.vacancyRatePercent).toBe(0);
  });

  it("forces hold period to be >= 1 year and integer", () => {
    expect(sanitiseInputs(make({ holdPeriodYears: 0 })).holdPeriodYears).toBe(1);
    expect(sanitiseInputs(make({ holdPeriodYears: 7.4 })).holdPeriodYears).toBe(7);
  });

  it("allows negative growth rates (e.g. depreciating markets)", () => {
    const s = sanitiseInputs(make({ annualAppreciationPercent: -2 }));
    expect(s.annualAppreciationPercent).toBe(-2);
  });
});

describe("analyseDeal — invariants", () => {
  it("total cash invested = down + closing + rehab", () => {
    const a = analyseDeal(make());
    expect(a.totalCashInvested).toBeCloseTo(
      a.downPayment + a.closingCosts + a.inputs.rehabCosts,
      4,
    );
  });

  it("loan amount + down payment == purchase price", () => {
    const a = analyseDeal(make());
    expect(a.loanAmount + a.downPayment).toBeCloseTo(a.inputs.purchasePrice, 4);
  });

  it("annual cashflow = NOI − debt service", () => {
    const a = analyseDeal(make());
    expect(a.annualCashFlow).toBeCloseTo(a.annualNOI - a.annualDebtService, 2);
  });

  it("cap rate uses (price + rehab) as basis, not price alone", () => {
    const a = analyseDeal(make({ purchasePrice: 400_000, rehabCosts: 100_000 }));
    expect(a.capRate).toBeCloseTo(a.annualNOI / 500_000, 6);
  });

  it("projection has exactly holdPeriodYears entries", () => {
    const a = analyseDeal(make({ holdPeriodYears: 7 }));
    expect(a.projection).toHaveLength(7);
  });

  it("projection years are 1..N with no gaps", () => {
    const a = analyseDeal(make({ holdPeriodYears: 10 }));
    expect(a.projection.map((p) => p.year)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("cumulative cashflow is monotonically non-decreasing in growing-rent case", () => {
    const a = analyseDeal(
      make({ annualRentGrowthPercent: 5, annualExpenseGrowthPercent: 2 }),
    );
    // positive deal → cumulative must never go backwards
    if (a.monthlyCashFlow > 0) {
      const cum = a.projection.map((y) => y.cumulativeCashFlow);
      for (let i = 1; i < cum.length; i++) {
        expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1] - 0.01);
      }
    }
  });

  it("produces a verdict tier that is one of the 5 valid tiers", () => {
    const a = analyseDeal(make());
    expect(["excellent", "good", "fair", "poor", "avoid"]).toContain(a.verdict.tier);
  });

  it("all-cash deal (100% down) has zero debt service and infinite DSCR", () => {
    const a = analyseDeal(make({ downPaymentPercent: 100 }));
    expect(a.loanAmount).toBe(0);
    expect(a.annualDebtService).toBe(0);
    expect(a.dscr).toBe(Infinity);
  });

  it("1% rule is reported as monthly rent / purchase price", () => {
    const a = analyseDeal(make({ purchasePrice: 260_000, monthlyRent: 2_600 }));
    expect(a.onePercentRule).toBeCloseTo(0.01, 6);
  });
});

describe("analyseDeal — reference listings (calibration anti-regression)", () => {
  // These four addresses were used to calibrate the rubric. The test doesn't
  // pin exact scores (that'd fight the rubric every time we tune it), but it
  // DOES pin tier ordering so a subsequent refactor can't silently invert them.
  //
  // Source: HANDOFF.md §18. Numbers are the rent/price pairs a user would
  // actually see after autofill.
  const bocaRaton = make({
    purchasePrice: 665_000, monthlyRent: 3_100, monthlyHOA: 450,
    annualPropertyTax: 9_500, annualInsurance: 9_642, vacancyRatePercent: 8,
  });
  const dunellenNJ = make({
    purchasePrice: 520_000, monthlyRent: 3_800, monthlyHOA: 0,
    annualPropertyTax: 12_200, annualInsurance: 2_400, vacancyRatePercent: 5,
  });
  const southAmboyNJ = make({
    purchasePrice: 385_000, monthlyRent: 3_200, monthlyHOA: 0,
    annualPropertyTax: 7_800, annualInsurance: 1_800, vacancyRatePercent: 5,
  });
  const statenIsland = make({
    purchasePrice: 897_000, monthlyRent: 8_500, monthlyHOA: 0,
    annualPropertyTax: 12_500, annualInsurance: 4_037, vacancyRatePercent: 5,
  });

  it("produces a verdict for each reference deal without throwing", () => {
    for (const inputs of [bocaRaton, dunellenNJ, southAmboyNJ, statenIsland]) {
      const a = analyseDeal(inputs);
      expect(Number.isFinite(a.verdict.score)).toBe(true);
      expect(a.verdict.score).toBeGreaterThanOrEqual(0);
      expect(a.verdict.score).toBeLessThanOrEqual(100);
    }
  });

  it("Boca Raton deal scores worse than South Amboy (HOA + tax + insurance drag)", () => {
    const scoreBoca = analyseDeal(bocaRaton).verdict.score;
    const scoreAmboy = analyseDeal(southAmboyNJ).verdict.score;
    expect(scoreAmboy).toBeGreaterThan(scoreBoca);
  });
});

describe("findOfferCeiling", () => {
  it("tier ceilings are monotonically non-decreasing from 'excellent' down to 'poor'", () => {
    // Each ceiling is "max price at which the deal scores AT LEAST this tier".
    // More lenient tier → more prices qualify → higher ceiling. So the order
    // excellent → good → fair → poor should be non-decreasing.
    const c = findOfferCeiling(
      make({ purchasePrice: 400_000, monthlyRent: 3_500, annualPropertyTax: 6_000 }),
    );
    const order: Array<keyof typeof c> = ["excellent", "good", "fair", "poor"];
    let prev = -Infinity;
    for (const key of order) {
      const v = c[key];
      if (typeof v === "number") {
        expect(v).toBeGreaterThanOrEqual(prev - 1); // −1$ slack for binary-search rounding
        prev = v;
      }
    }
  });

  it("echoes back the supplied price and tier unchanged", () => {
    const inputs = make({ purchasePrice: 421_234 });
    const c = findOfferCeiling(inputs);
    const base = analyseDeal(inputs);
    expect(c.currentPrice).toBe(421_234);
    expect(c.currentTier).toBe(base.verdict.tier);
  });

  it("buying at the 'good' ceiling actually produces a good-or-better verdict", () => {
    const c = findOfferCeiling(
      make({ purchasePrice: 350_000, monthlyRent: 3_200 }),
    );
    if (typeof c.good === "number") {
      const a = analyseDeal(make({ purchasePrice: c.good, monthlyRent: 3_200 }));
      const rank = ["avoid", "poor", "fair", "good", "excellent"].indexOf(
        a.verdict.tier,
      );
      expect(rank).toBeGreaterThanOrEqual(3); // good or excellent
    }
  });

  it("paying $1k is always enough to hit the highest achievable tier", () => {
    // This pins the lower bound of the search — if someone breaks the clamp
    // the solver would omit ceilings even for trivially profitable prices.
    const c = findOfferCeiling(
      make({ purchasePrice: 350_000, monthlyRent: 3_200 }),
    );
    // At $1k purchase price a reasonable deal must be at least "good".
    const near = analyseDeal(make({ purchasePrice: 1_000, monthlyRent: 3_200 }));
    const rank = ["avoid", "poor", "fair", "good", "excellent"].indexOf(
      near.verdict.tier,
    );
    expect(rank).toBeGreaterThanOrEqual(3);
    expect(c.poor).toBeDefined();
  });

  describe("marketValueCap — walk-away discipline vs pure income rubric", () => {
    // Reproduces the user-reported bug: a rent-heavy listing where the
    // income rubric alone says "even at $3.4M this still scores POOR", but
    // comp-derived fair value is ~$472k and list is $540k. Without a cap the
    // walk-away number is nonsense; with a cap it's disciplined by market.
    const rentHeavy = (): DealInputs =>
      make({
        purchasePrice: 540_000,
        monthlyRent: 15_000, // unrealistically high → rubric extends upward
        annualPropertyTax: 6_000,
        annualInsurance: 1_500,
        downPaymentPercent: 25,
        loanInterestRate: 7,
      });

    it("without a cap, rubric ceilings can exceed 3x list price on rent-heavy listings", () => {
      const c = findOfferCeiling(rentHeavy());
      const maxTierPrice = Math.max(
        c.excellent ?? 0,
        c.good ?? 0,
        c.fair ?? 0,
        c.poor ?? 0,
      );
      // This is the exact shape of the bug — no cap = absurd number.
      expect(maxTierPrice).toBeGreaterThan(540_000 * 3);
    });

    it("comp-derived cap clamps every tier ceiling at cap × 1.05 (5% premium)", () => {
      const c = findOfferCeiling(rentHeavy(), {
        marketValueCap: 472_000,
        marketValueCapSource: "comps",
      });
      const cap = 472_000 * 1.05; // = $495,600
      for (const tier of ["excellent", "good", "fair", "poor"] as const) {
        const price = c[tier];
        if (typeof price === "number") {
          expect(price).toBeLessThanOrEqual(cap + 500); // $500 rounding slack
        }
      }
    });

    it("records binding=true when cap actually clipped the rubric ceiling", () => {
      const c = findOfferCeiling(rentHeavy(), {
        marketValueCap: 472_000,
        marketValueCapSource: "comps",
      });
      expect(c.marketValueCap).toBeDefined();
      expect(c.marketValueCap?.cap).toBeCloseTo(472_000 * 1.05, 0);
      expect(c.marketValueCap?.source).toBe("comps");
      expect(c.marketValueCap?.binding).toBe(true);
    });

    it("records binding=false when rubric ceiling is already below cap", () => {
      // Marginal cash flow → rubric ceiling is low, cap is high, cap doesn't bind.
      const c = findOfferCeiling(
        make({ purchasePrice: 400_000, monthlyRent: 2_800 }),
        { marketValueCap: 2_000_000, marketValueCapSource: "list" },
      );
      expect(c.marketValueCap?.binding).toBe(false);
    });

    it("custom premium respected — premium=1 means hard cap at anchor", () => {
      const c = findOfferCeiling(rentHeavy(), {
        marketValueCap: 472_000,
        marketValueCapPremium: 1,
      });
      for (const tier of ["excellent", "good", "fair", "poor"] as const) {
        const price = c[tier];
        if (typeof price === "number") {
          expect(price).toBeLessThanOrEqual(472_000 + 500);
        }
      }
    });

    it("invalid / non-positive caps are ignored", () => {
      const unclipped = findOfferCeiling(rentHeavy()).poor ?? 0;
      for (const bad of [0, -100, NaN, Infinity]) {
        const c = findOfferCeiling(rentHeavy(), { marketValueCap: bad });
        expect(c.marketValueCap).toBeUndefined();
        expect(c.poor).toBe(unclipped);
      }
    });
  });
});
