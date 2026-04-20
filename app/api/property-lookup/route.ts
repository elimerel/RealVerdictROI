import type { NextRequest } from "next/server";

// RentCast API reference: https://developers.rentcast.io/reference/
// We call three endpoints in parallel when possible and collapse the payload
// into a small, UI-friendly shape. Anything the client doesn't fill gets
// silently dropped — RentCast is spotty outside major US metros, so the form
// needs to degrade gracefully when data is missing.

const RENTCAST_BASE = "https://api.rentcast.io/v1";

export type PropertyLookupResult = {
  address: string;
  rent?: { low: number; mid: number; high: number };
  value?: { low: number; mid: number; high: number };
  property?: {
    propertyType?: string;
    bedrooms?: number;
    bathrooms?: number;
    squareFootage?: number;
    yearBuilt?: number;
    lastSalePrice?: number;
    lastSaleDate?: string;
    annualPropertyTax?: number;
  };
  // Which fields the client should pre-fill + badge as auto-filled.
  autoFilled: {
    monthlyRent?: number;
    purchasePrice?: number;
    annualPropertyTax?: number;
  };
  notes: string[];
};

type RentAvm = {
  rent?: number;
  rentRangeLow?: number;
  rentRangeHigh?: number;
};

type ValueAvm = {
  price?: number;
  priceRangeLow?: number;
  priceRangeHigh?: number;
};

type PropertyRecord = {
  formattedAddress?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  // Tax data is keyed by year: { "2023": { total, ... } }
  propertyTaxes?: Record<string, { total?: number; year?: number }>;
};

export async function GET(req: NextRequest) {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "RENTCAST_API_KEY is not set. Add it to .env.local and restart the dev server.",
      },
      { status: 500 },
    );
  }

  const address = req.nextUrl.searchParams.get("address")?.trim();
  if (!address || address.length < 5) {
    return Response.json(
      { error: "Provide a full street address (e.g. '123 Main St, City, ST')." },
      { status: 400 },
    );
  }

  try {
    // Kick all three requests off in parallel; none of them depend on each
    // other, and a missing response should not cascade into a total failure.
    const [propRes, rentRes, valueRes] = await Promise.all([
      rentcast<PropertyRecord[] | PropertyRecord>(`/properties`, { address }, apiKey),
      rentcast<RentAvm>(`/avm/rent/long-term`, { address }, apiKey),
      rentcast<ValueAvm>(`/avm/value`, { address }, apiKey),
    ]);

    const propertyRaw = Array.isArray(propRes.data)
      ? propRes.data[0]
      : propRes.data;
    const rent = propRes.ok && rentRes.ok ? rentRes.data : undefined;
    const value = valueRes.ok ? valueRes.data : undefined;

    const notes: string[] = [];
    if (!propRes.ok) notes.push(`Property record: ${propRes.error}`);
    if (!rentRes.ok) notes.push(`Rent estimate: ${rentRes.error}`);
    if (!valueRes.ok) notes.push(`Value estimate: ${valueRes.error}`);

    const latestTax = latestPropertyTax(propertyRaw?.propertyTaxes);

    const result: PropertyLookupResult = {
      address: propertyRaw?.formattedAddress ?? address,
      rent:
        rent?.rent && rent?.rentRangeLow && rent?.rentRangeHigh
          ? {
              low: Math.round(rent.rentRangeLow),
              mid: Math.round(rent.rent),
              high: Math.round(rent.rentRangeHigh),
            }
          : undefined,
      value:
        value?.price && value?.priceRangeLow && value?.priceRangeHigh
          ? {
              low: Math.round(value.priceRangeLow),
              mid: Math.round(value.price),
              high: Math.round(value.priceRangeHigh),
            }
          : undefined,
      property: propertyRaw
        ? {
            propertyType: propertyRaw.propertyType,
            bedrooms: propertyRaw.bedrooms,
            bathrooms: propertyRaw.bathrooms,
            squareFootage: propertyRaw.squareFootage,
            yearBuilt: propertyRaw.yearBuilt,
            lastSalePrice: propertyRaw.lastSalePrice,
            lastSaleDate: propertyRaw.lastSaleDate,
            annualPropertyTax: latestTax,
          }
        : undefined,
      autoFilled: {},
      notes,
    };

    // Auto-fill rule: we only fill a field if we have a reasonable number.
    // Everything we fill is badged on the client so the user can see (and
    // override) what we changed.
    if (result.rent) result.autoFilled.monthlyRent = result.rent.mid;
    if (result.value) result.autoFilled.purchasePrice = result.value.mid;
    if (latestTax && latestTax > 0)
      result.autoFilled.annualPropertyTax = latestTax;

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Property lookup failed: ${message}` },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// RentCast helper — all endpoints share auth + JSON handling.
// We return a discriminated result so a single upstream 404 doesn't blow up
// the whole response.
// ---------------------------------------------------------------------------

type RentcastOk<T> = { ok: true; data: T; error?: undefined };
type RentcastErr = { ok: false; data?: undefined; error: string };

async function rentcast<T>(
  path: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<RentcastOk<T> | RentcastErr> {
  const url = new URL(`${RENTCAST_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      "X-Api-Key": apiKey,
      Accept: "application/json",
    },
    // RentCast data doesn't change second-to-second. Cache for a day to avoid
    // blowing through the free-tier quota on repeated typos.
    next: { revalidate: 86_400 },
  });

  if (!res.ok) {
    if (res.status === 404) return { ok: false, error: "no data for this address" };
    if (res.status === 401)
      return { ok: false, error: "invalid RentCast API key" };
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `HTTP ${res.status}${text ? ` — ${text.slice(0, 120)}` : ""}`,
    };
  }

  const data = (await res.json()) as T;
  return { ok: true, data };
}

function latestPropertyTax(
  taxes: PropertyRecord["propertyTaxes"],
): number | undefined {
  if (!taxes) return undefined;
  const entries = Object.values(taxes).filter((t) => t?.total && t.total > 0);
  if (entries.length === 0) return undefined;
  // Prefer the most recent year if present.
  entries.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return Math.round(entries[0].total!);
}
