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

  // §16.U.1 #4 / §20.9 #7 regression — Polson rent pool had two listings
  // for the same unit with a spurious bare numeric ("2") wedged between
  // the street number and the street name. The old key treated them as
  // distinct; the new key collapses both.
  it("collapses bare-numeric building/lot artifacts (Polson regression)", () => {
    expect(buildingKey("150 Claffey Dr Unit Gdn")).toBe("150 claffey dr");
    expect(buildingKey("150 2 Claffey Dr Unit Gdn")).toBe("150 claffey dr");
    expect(buildingKey("150-2 Claffey Dr")).toBe("150 claffey dr");
    expect(buildingKey("150/2 Claffey Dr")).toBe("150 claffey dr");
  });

  it("normalises street suffix variations", () => {
    expect(buildingKey("100 Main Street")).toBe("100 main st");
    expect(buildingKey("100 Main St")).toBe("100 main st");
    expect(buildingKey("100 Main Drive")).toBe("100 main dr");
    expect(buildingKey("100 Main Dr")).toBe("100 main dr");
    expect(buildingKey("100 Main Avenue")).toBe("100 main ave");
    expect(buildingKey("100 Main Ave")).toBe("100 main ave");
  });

  it("normalises directional prefixes", () => {
    expect(buildingKey("100 North Main St")).toBe("100 n main st");
    expect(buildingKey("100 N Main St")).toBe("100 n main st");
    expect(buildingKey("100 Southeast Main St")).toBe("100 se main st");
    expect(buildingKey("100 SE Main St")).toBe("100 se main st");
  });

  it("does NOT collapse genuinely different streets", () => {
    // Same street number, different suffix — must stay distinct.
    expect(buildingKey("100 Main St")).not.toBe(buildingKey("100 Main Ave"));
    // Same street, different directional — must stay distinct.
    expect(buildingKey("100 N Main St")).not.toBe(buildingKey("100 S Main St"));
    // Numbered street ("5 Ave" = "5th Avenue") — bare numeric is part of
    // the street NAME, not a lot/building artifact, so it must survive.
    expect(buildingKey("123 5 Ave")).toBe("123 5 ave");
    expect(buildingKey("123 6 Ave")).toBe("123 6 ave");
    expect(buildingKey("123 5 Ave")).not.toBe(buildingKey("123 6 Ave"));
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

  // §16.U.1 #4 / §20.9 #7 end-to-end. With only 3 comps in a thin market,
  // the old key kept the duplicate Claffey listing as a distinct comp,
  // dragging the median from $2,000 → $1,675. The new key collapses them.
  it("collapses Polson-shaped near-duplicate addresses (rent thin-market regression)", () => {
    const items = [
      mk({ address: "150 Claffey Dr Unit Gdn", price: 1_675 }),
      mk({ address: "150 2 Claffey Dr Unit Gdn", price: 1_675 }),
      mk({ address: "200 Main St", price: 2_000 }),
      mk({ address: "300 Oak Ln", price: 2_100 }),
    ];
    const out = dedupeByBuilding(items, 2);
    // 4 raw → 3 buildings (the two Claffey listings collapse).
    expect(out).toHaveLength(3);
    const claffey = out.find((c) => /claffey/i.test(c.address))!;
    expect(claffey.rolledUpCount).toBe(2);
  });
});
