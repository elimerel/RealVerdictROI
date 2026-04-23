import type { DealInputs } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// ZIP-level ACS snapshot + deal-structure signals for /results and /api/chat.
// Census ACS 5-year at ZCTA — no HUD token required. HUD FMR can layer on
// later behind HUD_USER_API_TOKEN if we want voucher-style floors.
// ---------------------------------------------------------------------------

export type AcsZipProfile = {
  zip: string;
  vintageYear: number;
  medianGrossRentMonthly: number;
  medianOwnerOccupiedValue: number;
  medianHouseholdIncome: number;
  housingVacancyRate: number;
};

/** Subset merged into ChatAnalysisContext — keep in sync with route.ts */
export type MarketSignals = {
  marketZip?: string;
  acsVintageYear?: number;
  zipMedianGrossRentMonthly?: number;
  zipMedianOwnerOccupiedValue?: number;
  zipMedianHouseholdIncome?: number;
  zipHousingVacancyRate?: number;
  userMonthlyRentToZipMedianRatio?: number;
  listPriceToAnnualGrossRentMultiple?: number;
  annualGrossYieldPercent?: number;
  dealStructureArchetype?: "equity_heavy" | "income_slanted" | "balanced";
};

/** Best-effort US ZIP: trailing 12345 or 12345-6789, else "ST 12345". */
export function extractUsZipFromAddress(address: string): string | undefined {
  const t = address.trim();
  if (!t) return undefined;
  const tail = t.match(/(\d{5})(?:-\d{4})?\s*$/);
  if (tail) return tail[1];
  const st = t.match(/\b[A-Za-z]{2}\s+(\d{5})(?:-\d{4})?\b/);
  if (st) return st[1];
  return undefined;
}

export function classifyDealStructureArchetype(
  purchasePrice: number,
  monthlyRent: number,
): "equity_heavy" | "income_slanted" | "balanced" | undefined {
  const annual = monthlyRent * 12;
  if (!purchasePrice || purchasePrice <= 0 || !annual || annual <= 0)
    return undefined;
  const multiple = purchasePrice / annual;
  if (multiple >= 22) return "equity_heavy";
  if (multiple <= 14) return "income_slanted";
  return "balanced";
}

export function buildMarketSignals(
  inputs: DealInputs,
  zip: string | undefined,
  acs: AcsZipProfile | null,
): MarketSignals {
  const annualRent = inputs.monthlyRent * 12;
  const hasPrice = inputs.purchasePrice > 0 && annualRent > 0;
  const listMult = hasPrice
    ? inputs.purchasePrice / annualRent
    : undefined;
  const grossYield = hasPrice ? (annualRent / inputs.purchasePrice) * 100 : undefined;
  const archetype = classifyDealStructureArchetype(
    inputs.purchasePrice,
    inputs.monthlyRent,
  );

  const out: MarketSignals = {
    marketZip: zip,
    listPriceToAnnualGrossRentMultiple: listMult,
    annualGrossYieldPercent: grossYield,
    dealStructureArchetype: archetype,
  };

  if (!acs) return out;

  out.acsVintageYear = acs.vintageYear;
  out.zipMedianGrossRentMonthly = acs.medianGrossRentMonthly;
  out.zipMedianOwnerOccupiedValue = acs.medianOwnerOccupiedValue;
  out.zipMedianHouseholdIncome = acs.medianHouseholdIncome;
  out.zipHousingVacancyRate = acs.housingVacancyRate;

  if (acs.medianGrossRentMonthly > 0 && inputs.monthlyRent > 0) {
    out.userMonthlyRentToZipMedianRatio =
      inputs.monthlyRent / acs.medianGrossRentMonthly;
  }

  return out;
}

const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const pct = (n: number, digits = 0) =>
  `${(n * 100).toFixed(digits).replace(/\.0+$/, "")}%`;

/** One-line transparency for the hero — null when there is nothing to say. */
export function formatMarketSignalsHeroLine(s: MarketSignals): string | null {
  const parts: string[] = [];
  if (s.marketZip) {
    parts.push(`ZCTA ${s.marketZip}`);
  }
  if (s.acsVintageYear) {
    parts.push(`ACS ${s.acsVintageYear}`);
  }
  if (s.zipMedianGrossRentMonthly && s.zipMedianGrossRentMonthly > 0) {
    parts.push(`ZIP median gross rent ~${money(s.zipMedianGrossRentMonthly)}/mo`);
  }
  if (s.zipHousingVacancyRate !== undefined && s.zipHousingVacancyRate > 0) {
    parts.push(`ZIP housing vacancy ~${pct(s.zipHousingVacancyRate, 1)}`);
  }
  if (s.userMonthlyRentToZipMedianRatio !== undefined) {
    parts.push(
      `pro-forma rent ${s.userMonthlyRentToZipMedianRatio.toFixed(2)}× ZIP median gross rent`,
    );
  }
  if (s.listPriceToAnnualGrossRentMultiple !== undefined) {
    parts.push(
      `${s.listPriceToAnnualGrossRentMultiple.toFixed(1)}× list / annual gross rent (your inputs)`,
    );
  }
  if (s.dealStructureArchetype) {
    const label =
      s.dealStructureArchetype === "equity_heavy"
        ? "equity-heavy vs rent"
        : s.dealStructureArchetype === "income_slanted"
          ? "rent-heavy vs list"
          : "mixed list/rent geometry";
    parts.push(label);
  }

  if (parts.length === 0) return null;
  return parts.join(" · ");
}
