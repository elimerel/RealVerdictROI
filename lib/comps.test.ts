import { describe, it, expect } from "vitest";
import { buildingKey, dedupeByBuilding } from "./comps";
import type { Comp } from "./comps";

const mk = (o: Partial<Comp> & { address: string; price: number }): Comp => ({
  bedrooms: 2,
  bathrooms: 2,
  squareFootage: 900,
  propertyType: "Condo",
  rolledUpCount: 1,
  distance: 0.5,
  ...o,
});

describe("buildingKey", () => {
  it("normalises apartment/unit suffixes", () => {
    expect(buildingKey("2000 Schindler Dr Unit B16, Austin, TX")).toBe(
      "2000 schindler dr",
    );
    expect(buildingKey("2000 Schindler Dr Unit B20, Austin, TX")).toBe(
      "2000 schindler dr",
    );
  });

  it("normalises # and Suite suffixes", () => {
    expect(buildingKey("1401 Ocean Dr #214")).toBe("1401 ocean dr");
    expect(buildingKey("1401 Ocean Dr Suite 301")).toBe("1401 ocean dr");
    expect(buildingKey("1401 Ocean Dr Apt 5B")).toBe("1401 ocean dr");
  });

  it("leaves non-unit addresses untouched", () => {
    expect(buildingKey("37 Merker Dr, Edison, NJ")).toBe("37 merker dr");
  });
});

describe("dedupeByBuilding", () => {
  it("collapses multiple units in one building into a single representative", () => {
    const items = [
      mk({ address: "1401 Ocean Dr Unit 100, Miami Beach, FL", price: 900_000 }),
      mk({ address: "1401 Ocean Dr Unit 200, Miami Beach, FL", price: 1_100_000 }),
      mk({ address: "1401 Ocean Dr Unit 300, Miami Beach, FL", price: 1_000_000 }),
      mk({ address: "500 Somewhere Else, Miami Beach, FL", price: 850_000 }),
    ];
    const out = dedupeByBuilding(items, 2);
    expect(out).toHaveLength(2);
    const ocean = out.find((c) => /ocean/i.test(c.address))!;
    expect(ocean.rolledUpCount).toBe(3);
    // The representative's price should be the MEDIAN of the collapsed group,
    // not an arbitrary one — 1_000_000 for prices [900k, 1000k, 1100k].
    expect(ocean.price).toBe(1_000_000);
  });

  it("preserves rolledUpCount=1 when no collapse happens", () => {
    const items = [
      mk({ address: "1 A St, X", price: 500_000 }),
      mk({ address: "2 B St, X", price: 510_000 }),
    ];
    const out = dedupeByBuilding(items, 2);
    expect(out).toHaveLength(2);
    expect(out.every((c) => (c.rolledUpCount ?? 1) === 1)).toBe(true);
  });

  it("picks the representative closest in beds to the subject", () => {
    const items = [
      mk({ address: "1 Tower Rd Unit A, X", price: 500_000, bedrooms: 1 }),
      mk({ address: "1 Tower Rd Unit B, X", price: 600_000, bedrooms: 2 }),
      mk({ address: "1 Tower Rd Unit C, X", price: 700_000, bedrooms: 3 }),
    ];
    // Subject is 2bd — the 2bd representative should win.
    const out = dedupeByBuilding(items, 2);
    expect(out).toHaveLength(1);
    expect(out[0].bedrooms).toBe(2);
  });
});
