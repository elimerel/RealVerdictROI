import type { DealInputs } from "@/lib/calculations";
import type { FreeMarketContext } from "@/lib/market-data";

// ---------------------------------------------------------------------------
// ZIP-level ACS snapshot + deal-structure signals for /results and /api/chat.
// Census ACS 5-year at ZCTA — no HUD token required.
// Free market context (HUD FMR, ZORI, Walk Score) layers on via FreeMarketContext.
// ---------------------------------------------------------------------------

export type AcsZipProfile = {
  zip: string;
  vintageYear: number;
  medianGrossRentMonthly: number;
  medianOwnerOccupiedValue: number;
  medianHouseholdIncome: number;
  housingVacancyRate: number;
};

/** Lightweight page-extracted comp (nearby sold homes from listing JSON). */
export type PageComp = {
  address: string;
  soldPrice: number;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  soldDate?: string | null;
};

/** Subset merged into ChatAnalysisContext — keep in sync with route.ts */
export type MarketSignals = {
  // ACS / deal-structure (existing)
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

  // HUD Fair Market Rents
  hudFmrBr1?: number;
  hudFmrBr2?: number;
  hudFmrBr3?: number;
  hudFmrMetro?: string;
  hudFmrYear?: number;
  hudFmrSmallArea?: boolean;

  // ZORI observed rent index
  zoriMedianRent?: number;
  zoriAsOf?: string;

  // Walk Score
  walkScore?: number;
  walkDescription?: string;
  transitScore?: number;
  bikeScore?: number;

  // HUD Area Median Income
  amiMedianFamilyIncome?: number;
  amiAreaName?: string;
  amiYear?: number;

  // Page comps (nearby sold homes extracted from listing JSON)
  pageCompCount?: number;
  pageCompMedianSoldPrice?: number;
  pageCompMedianPricePerSqft?: number;
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
  free?: FreeMarketContext | null,
  pageComps?: PageComp[] | null,
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

  // ACS data
  if (acs) {
    out.acsVintageYear = acs.vintageYear;
    out.zipMedianGrossRentMonthly = acs.medianGrossRentMonthly;
    out.zipMedianOwnerOccupiedValue = acs.medianOwnerOccupiedValue;
    out.zipMedianHouseholdIncome = acs.medianHouseholdIncome;
    out.zipHousingVacancyRate = acs.housingVacancyRate;

    if (acs.medianGrossRentMonthly > 0 && inputs.monthlyRent > 0) {
      out.userMonthlyRentToZipMedianRatio =
        inputs.monthlyRent / acs.medianGrossRentMonthly;
    }
  }

  // HUD FMR
  if (free?.hudFmr) {
    const fmr = free.hudFmr;
    if (fmr.br1 > 0) out.hudFmrBr1 = fmr.br1;
    if (fmr.br2 > 0) out.hudFmrBr2 = fmr.br2;
    if (fmr.br3 > 0) out.hudFmrBr3 = fmr.br3;
    if (fmr.metro ?? fmr.county) out.hudFmrMetro = fmr.metro ?? fmr.county;
    out.hudFmrYear = fmr.year;
    out.hudFmrSmallArea = fmr.smallArea;
  }

  // ZORI rent index
  if (free?.rentTrend) {
    out.zoriMedianRent = free.rentTrend.medianRent;
    out.zoriAsOf = free.rentTrend.asOf;
  }

  // Walk Score
  if (free?.walkScore) {
    out.walkScore = free.walkScore.walkScore;
    out.walkDescription = free.walkScore.walkDescription;
    if (free.walkScore.transitScore !== undefined) out.transitScore = free.walkScore.transitScore;
    if (free.walkScore.bikeScore !== undefined) out.bikeScore = free.walkScore.bikeScore;
  }

  // HUD AMI
  if (free?.hudAmi) {
    out.amiMedianFamilyIncome = free.hudAmi.medianFamilyIncome;
    if (free.hudAmi.areaName) out.amiAreaName = free.hudAmi.areaName;
    out.amiYear = free.hudAmi.year;
  }

  // Page comps — compute median sold price and median price/sqft
  if (pageComps && pageComps.length > 0) {
    out.pageCompCount = pageComps.length;

    const prices = pageComps
      .map((c) => c.soldPrice)
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    if (prices.length > 0) {
      const mid = Math.floor(prices.length / 2);
      out.pageCompMedianSoldPrice =
        prices.length % 2 === 0
          ? Math.round((prices[mid - 1] + prices[mid]) / 2)
          : prices[mid];
    }

    const ppsf = pageComps
      .filter((c) => c.soldPrice > 0 && c.sqft && c.sqft > 0)
      .map((c) => c.soldPrice / c.sqft!)
      .sort((a, b) => a - b);
    if (ppsf.length > 0) {
      const mid = Math.floor(ppsf.length / 2);
      out.pageCompMedianPricePerSqft = Math.round(
        ppsf.length % 2 === 0
          ? (ppsf[mid - 1] + ppsf[mid]) / 2
          : ppsf[mid],
      );
    }
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
  if (s.zoriMedianRent && s.zoriMedianRent > 0) {
    const tag = s.zoriAsOf ? ` (ZORI ${s.zoriAsOf})` : " (ZORI)";
    parts.push(`observed market rent ~${money(s.zoriMedianRent)}/mo${tag}`);
  }
  if (s.hudFmrBr2 && s.hudFmrBr2 > 0) {
    const area = s.hudFmrMetro ? ` · ${s.hudFmrMetro}` : "";
    const label = s.hudFmrSmallArea ? "ZIP" : "county";
    parts.push(`HUD FMR 2BR ~${money(s.hudFmrBr2)}/mo (${label}-level${area})`);
  }
  if (s.amiMedianFamilyIncome && s.amiMedianFamilyIncome > 0) {
    const ami = s.amiMedianFamilyIncome;
    const tier =
      ami < 55_000
        ? "Lower income market"
        : ami < 85_000
          ? "Moderate income market"
          : ami < 120_000
            ? "High income market"
            : "Very high income market";
    parts.push(`Area Median Income: ${money(ami)} · ${tier}`);
  }
  if (s.walkScore !== undefined) {
    const desc = s.walkDescription ? ` — ${s.walkDescription}` : "";
    parts.push(`Walk Score ${s.walkScore}${desc}`);
  }
  if (s.transitScore !== undefined) {
    parts.push(`Transit ${s.transitScore}`);
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
  if (s.pageCompCount && s.pageCompCount > 0) {
    const ppsf = s.pageCompMedianPricePerSqft
      ? ` · ~${money(s.pageCompMedianPricePerSqft)}/sqft`
      : "";
    const medPrice = s.pageCompMedianSoldPrice
      ? ` median ${money(s.pageCompMedianSoldPrice)}`
      : "";
    parts.push(`${s.pageCompCount} page comps${medPrice}${ppsf}`);
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
