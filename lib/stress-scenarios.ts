import type { DealInputs } from "./calculations";

// ---------------------------------------------------------------------------
// Canonical stress-test scenarios shared by the results page UI
// (StressTestPanel.tsx) and the Negotiation Pack PDF (negotiation-pack.ts).
//
// Previously the UI ran 5 scenarios and the Pack ran 4 — different sets —
// so an investor could negotiate on a scenario that never appeared in the
// Pack their agent received. All five scenarios now live here and both
// consumers import from this file.
// ---------------------------------------------------------------------------

export type StressScenario = {
  key: string;
  label: string;
  description: string;
  apply: (b: DealInputs) => DealInputs;
};

export const STRESS_SCENARIOS: StressScenario[] = [
  {
    key: "rent-drop",
    label: "Rent drops 10%",
    description: "Soft rental market or you misjudged comps",
    apply: (b) => ({ ...b, monthlyRent: Math.round(b.monthlyRent * 0.9) }),
  },
  {
    key: "rate-up",
    label: "Refi rate +1pt",
    description:
      "If you bought variable or have to refi at a higher rate",
    apply: (b) => ({ ...b, loanInterestRate: b.loanInterestRate + 1 }),
  },
  {
    key: "vacancy-bad-year",
    label: "Bad year: 1.5 mo vacancy",
    description: "Eviction, turnover, or a long re-rent",
    apply: (b) => ({
      ...b,
      vacancyRatePercent: Math.max(b.vacancyRatePercent, 12.5),
    }),
  },
  {
    key: "expenses-spike",
    label: "Expenses jump 25%",
    description:
      "Roof, HVAC, insurance hike, or a big-ticket repair year",
    apply: (b) => ({
      ...b,
      maintenancePercent: b.maintenancePercent * 1.25,
      annualInsurance: Math.round(b.annualInsurance * 1.25),
      annualPropertyTax: Math.round(b.annualPropertyTax * 1.05),
    }),
  },
  {
    key: "exit-down",
    label: "Sells 10% below today",
    description: "If the area cools and you exit at a discount",
    apply: (b) => ({
      ...b,
      annualAppreciationPercent:
        b.annualAppreciationPercent -
        100 *
          (1 - Math.pow(0.9, 1 / Math.max(1, b.holdPeriodYears))),
    }),
  },
];
