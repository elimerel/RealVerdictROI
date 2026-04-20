import type { NextRequest } from "next/server";

// Nominatim proxy. The browser can't set a custom User-Agent (it's a
// forbidden header), so we must relay the request from the server to comply
// with Nominatim's usage policy: https://operations.osmfoundation.org/policies/nominatim/
//
// We also cache for an hour to be a good citizen — the same query typed by
// two users in quick succession should not hit them twice.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export type AddressSuggestion = {
  /** Full human-readable address, ready to drop into a form field. */
  label: string;
  /** What Nominatim calls its canonical name — good as the list item title. */
  primary: string;
  /** Secondary line (city / state / postcode). */
  secondary: string;
  /** Lat / lon for future map features or more accurate RentCast calls. */
  lat: string;
  lon: string;
  /** Nominatim's internal id — stable across page loads for React keys. */
  placeId: number;
};

type NominatimRow = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 4) {
    return Response.json([]);
  }

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("limit", "5");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        // Required by Nominatim ToS — identifies our app and gives them a
        // way to reach us if usage becomes problematic.
        "User-Agent": "RealVerdict/1.0",
        Accept: "application/json",
      },
      // Keep repeated prefixes snappy without blowing through the free tier.
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return Response.json(
        { error: `Nominatim returned HTTP ${res.status}` },
        { status: 502 },
      );
    }

    const rows = (await res.json()) as NominatimRow[];
    const suggestions: AddressSuggestion[] = rows.map(formatRow);
    return Response.json(suggestions);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Autocomplete failed: ${message}` },
      { status: 502 },
    );
  }
}

function formatRow(r: NominatimRow): AddressSuggestion {
  const a = r.address ?? {};

  // Build a two-line display: street / city, state zip. Fall back to the
  // full display_name when parts are missing (parks, landmarks, etc).
  const streetParts = [a.house_number, a.road].filter(Boolean);
  const street =
    streetParts.join(" ") ||
    a.neighbourhood ||
    a.suburb ||
    r.display_name.split(",")[0] ||
    r.display_name;

  const cityish = a.city || a.town || a.village || a.hamlet || a.county;
  const cityLine = [cityish, a.state, a.postcode].filter(Boolean).join(", ");

  // The "label" is what gets dropped into the form field. Must be
  // RentCast-parseable, so we lean on Nominatim's own display_name when our
  // structured reassembly would be too sparse.
  const label =
    street && cityLine ? `${street}, ${cityLine}` : r.display_name;

  return {
    label,
    primary: street,
    secondary: cityLine || r.display_name.replace(`${street}, `, ""),
    lat: r.lat,
    lon: r.lon,
    placeId: r.place_id,
  };
}
