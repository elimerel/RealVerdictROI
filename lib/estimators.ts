// State-level estimators for insurance and property tax.
//
// These exist so that when RentCast doesn't return a number for a field, we
// can still give the user a defensible estimate with a citation, instead of
// silently falling back to a single national flat rate.
//
// Data sources:
//   - Insurance: Insurance Information Institute "Facts + Statistics: Homeowners
//     and renters insurance" 2023-2024 averages, expressed as a percent of
//     dwelling value.
//   - Property tax: Tax Foundation "State and Local Property Tax Collections
//     Per Capita" 2024, converted to effective rate on owner-occupied homes.
//
// Numbers should be revisited annually. They are rough — a real quote depends
// on coverage, age, materials, claims history, and ZIP — so we always tag
// estimates with low/medium confidence and surface the reasoning to the user.

export type StateCode =
  | "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "FL" | "GA"
  | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME" | "MD"
  | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH" | "NJ"
  | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI" | "SC"
  | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI" | "WY"
  | "DC";

// Annual homeowners insurance premium expressed as a percent of home value.
// e.g. 0.45 = $450/yr per $100,000 of dwelling value.
const INSURANCE_RATE_BY_STATE: Record<StateCode, number> = {
  // Hurricane / wind / hail belt — premiums run multiples of the national avg
  FL: 1.45, LA: 1.40, OK: 1.20, TX: 1.05, MS: 0.95, AL: 0.85, AR: 0.80,
  KS: 0.75, NE: 0.70, CO: 0.70, SD: 0.65, ND: 0.55, IA: 0.55, MO: 0.55,
  MN: 0.50, TN: 0.50, GA: 0.55, SC: 0.65, NC: 0.55, KY: 0.50, IN: 0.45,
  // Wildfire-exposed
  CA: 0.45, NV: 0.40, AZ: 0.40, NM: 0.55, MT: 0.50, ID: 0.45, WY: 0.45,
  UT: 0.30, OR: 0.30, WA: 0.30,
  // Northeast / Midwest with low catastrophe loss
  IL: 0.50, OH: 0.40, MI: 0.40, WI: 0.35, PA: 0.40, NY: 0.45, NJ: 0.50,
  CT: 0.45, RI: 0.55, MA: 0.40, NH: 0.30, VT: 0.30, ME: 0.40,
  MD: 0.40, DE: 0.40, VA: 0.40, WV: 0.40, DC: 0.40,
  // Hawaii + Alaska
  HI: 0.40, AK: 0.50,
};

const NATIONAL_INSURANCE_RATE = 0.50;

// Effective owner-occupied property tax rate by state (annual % of value).
// Used only when RentCast / public records don't return an actual tax bill.
const TAX_RATE_BY_STATE: Record<StateCode, number> = {
  HI: 0.32, AL: 0.41, CO: 0.51, NV: 0.55, UT: 0.57, SC: 0.57, LA: 0.55,
  WV: 0.59, DE: 0.61, AZ: 0.62, WY: 0.61, AR: 0.62, TN: 0.66, ID: 0.69,
  CA: 0.75, MS: 0.79, NM: 0.80, VA: 0.82, NC: 0.82, MT: 0.84, KY: 0.85,
  IN: 0.85, FL: 0.91, OK: 0.90, GA: 0.92, ND: 0.99, WA: 0.94, OR: 0.93,
  MO: 1.01, MD: 1.05, MN: 1.11, ME: 1.24, MA: 1.20, AK: 1.19, SD: 1.24,
  KS: 1.41, MI: 1.54, OH: 1.59, IA: 1.57, RI: 1.63, PA: 1.49, NY: 1.73,
  WI: 1.85, NE: 1.73, TX: 1.80, VT: 1.90, CT: 2.15, NH: 2.09, IL: 2.27,
  NJ: 2.49, DC: 0.62,
};

const NATIONAL_TAX_RATE = 1.10;

// ---------------------------------------------------------------------------

export type Estimate = {
  value: number;
  /** 'high' = sourced public record, 'medium' = state average, 'low' = national fallback */
  confidence: "high" | "medium" | "low";
  source: string;
  /** Human-readable reasoning the UI can show in a tooltip. */
  note: string;
};

export function estimateAnnualInsurance(
  homeValue: number,
  state?: StateCode,
): Estimate {
  if (!homeValue || homeValue <= 0) {
    return {
      value: 0,
      confidence: "low",
      source: "default",
      note: "Insurance estimate requires a home value first.",
    };
  }
  const rate = state ? INSURANCE_RATE_BY_STATE[state] : NATIONAL_INSURANCE_RATE;
  const annual = Math.round((homeValue * rate) / 100);
  return {
    value: annual,
    confidence: state ? "medium" : "low",
    source: state ? `state-average:${state}` : "national-average",
    note: state
      ? `${state} averages roughly ${rate.toFixed(2)}% of dwelling value per year. Actual quotes vary by coverage, deductible, claims history, and ZIP.`
      : `Used the U.S. national average of ${rate.toFixed(2)}% of value. Add a state in the address for a tighter estimate.`,
  };
}

export function estimateAnnualPropertyTax(
  homeValue: number,
  state?: StateCode,
): Estimate {
  if (!homeValue || homeValue <= 0) {
    return {
      value: 0,
      confidence: "low",
      source: "default",
      note: "Property tax estimate requires a home value first.",
    };
  }
  const rate = state ? TAX_RATE_BY_STATE[state] : NATIONAL_TAX_RATE;
  const annual = Math.round((homeValue * rate) / 100);
  return {
    value: annual,
    confidence: state ? "medium" : "low",
    source: state ? `state-effective-rate:${state}` : "national-average",
    note: state
      ? `Estimated using ${state}'s effective owner-occupied tax rate of ${rate.toFixed(2)}%. Actual bill depends on assessed value, exemptions, and local millage.`
      : `Used the U.S. national average of ${rate.toFixed(2)}%. Add a state in the address for a tighter estimate.`,
  };
}

// ---------------------------------------------------------------------------
// Address parsing — best-effort state extraction. Handles both 2-letter codes
// ("Austin, TX 78722") and full names ("Austin, Texas 78722").
// ---------------------------------------------------------------------------

export function detectStateFromAddress(address: string): StateCode | undefined {
  if (!address) return undefined;
  const upper = address.toUpperCase().trim();

  // Strip ZIP if present so the trailing token is the state.
  const noZip = upper.replace(/\b\d{5}(?:-\d{4})?\b/, "").trim();

  // Try exact 2-letter state code at end (e.g. ", TX")
  const twoLetter = noZip.match(/[,\s]([A-Z]{2})\.?$/);
  if (twoLetter && isValidStateCode(twoLetter[1])) {
    return twoLetter[1] as StateCode;
  }

  // Try full state name anywhere (rare, but possible)
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    if (upper.includes(name)) return code as StateCode;
  }

  return undefined;
}

function isValidStateCode(code: string): code is StateCode {
  return code in INSURANCE_RATE_BY_STATE;
}

const STATE_NAMES: Record<StateCode, string> = {
  AL: "ALABAMA", AK: "ALASKA", AZ: "ARIZONA", AR: "ARKANSAS", CA: "CALIFORNIA",
  CO: "COLORADO", CT: "CONNECTICUT", DE: "DELAWARE", FL: "FLORIDA", GA: "GEORGIA",
  HI: "HAWAII", ID: "IDAHO", IL: "ILLINOIS", IN: "INDIANA", IA: "IOWA",
  KS: "KANSAS", KY: "KENTUCKY", LA: "LOUISIANA", ME: "MAINE", MD: "MARYLAND",
  MA: "MASSACHUSETTS", MI: "MICHIGAN", MN: "MINNESOTA", MS: "MISSISSIPPI",
  MO: "MISSOURI", MT: "MONTANA", NE: "NEBRASKA", NV: "NEVADA", NH: "NEW HAMPSHIRE",
  NJ: "NEW JERSEY", NM: "NEW MEXICO", NY: "NEW YORK", NC: "NORTH CAROLINA",
  ND: "NORTH DAKOTA", OH: "OHIO", OK: "OKLAHOMA", OR: "OREGON", PA: "PENNSYLVANIA",
  RI: "RHODE ISLAND", SC: "SOUTH CAROLINA", SD: "SOUTH DAKOTA", TN: "TENNESSEE",
  TX: "TEXAS", UT: "UTAH", VT: "VERMONT", VA: "VIRGINIA", WA: "WASHINGTON",
  WV: "WEST VIRGINIA", WI: "WISCONSIN", WY: "WYOMING", DC: "DISTRICT OF COLUMBIA",
};
