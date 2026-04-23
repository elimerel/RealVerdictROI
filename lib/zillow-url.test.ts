import { describe, expect, it } from "vitest";
import {
  addressFromSlug,
  extractZpidAndSlug,
  stateFromSlugAddress,
} from "./zillow-url";

describe("extractZpidAndSlug", () => {
  it("parses the canonical /homedetails/<slug>/<zpid>_zpid/ URL", () => {
    const out = extractZpidAndSlug(
      "https://www.zillow.com/homedetails/14215-Hawk-Stream-Cv-Hoagland-IN-46745/12345678_zpid/",
    );
    expect(out).toEqual({
      zpid: "12345678",
      slug: "14215-Hawk-Stream-Cv-Hoagland-IN-46745",
    });
  });

  it("parses the slug-less /homedetails/<zpid>_zpid/ form", () => {
    // No real slug — the segment-walk falls back to the prior path token
    // ("homedetails"). That's a benign fallback; the resolver still gets
    // a usable zpid for downstream RentCast / address resolution.
    const out = extractZpidAndSlug(
      "https://www.zillow.com/homedetails/12345678_zpid/",
    );
    expect(out?.zpid).toBe("12345678");
  });

  it("parses the building-first /b/<zpid>/ form", () => {
    const out = extractZpidAndSlug("https://www.zillow.com/b/12345678/");
    expect(out?.zpid).toBe("12345678");
  });

  it("parses the search ?zpid= fallback form", () => {
    const out = extractZpidAndSlug(
      "https://www.zillow.com/homes/for_sale/?zpid=12345678",
    );
    expect(out).toEqual({ zpid: "12345678", slug: "" });
  });

  it("rejects non-Zillow URLs", () => {
    expect(extractZpidAndSlug("https://www.realtor.com/foo/12345_zpid/")).toBeNull();
  });

  it("rejects URLs without a zpid", () => {
    expect(
      extractZpidAndSlug("https://www.zillow.com/homes/for_sale/"),
    ).toBeNull();
  });
});

describe("addressFromSlug", () => {
  it("converts the Hoagland slug to a canonical, comma-separated address", () => {
    expect(
      addressFromSlug("14215-Hawk-Stream-Cv-Hoagland-IN-46745"),
    ).toBe("14215 Hawk Stream Cv, Hoagland, IN 46745");
  });

  it("falls back to a space-joined string when the slug is too short", () => {
    expect(addressFromSlug("foo-bar")).toBe("foo bar");
  });
});

describe("stateFromSlugAddress (§16.U #2 — URL-flow state detection)", () => {
  it("recovers IN from the Hoagland slug-derived address", () => {
    expect(
      stateFromSlugAddress("14215 Hawk Stream Cv, Hoagland, IN 46745"),
    ).toBe("IN");
  });

  it("recovers MT from the Polson slug-derived address (listing #2 calibration)", () => {
    expect(
      stateFromSlugAddress("105 11th Ave W, Polson, MT 59860"),
    ).toBe("MT");
  });

  it("recovers state when ZIP is missing (sometimes Zillow ships incomplete blobs)", () => {
    expect(stateFromSlugAddress("105 11th Ave W, Polson, MT")).toBe("MT");
  });

  it("validates against the canonical US state code set", () => {
    // ZZ is not a real state — must NOT be returned even though the regex
    // shape (",ZZ") is satisfied.
    expect(stateFromSlugAddress("100 Fake St, Townville, ZZ 99999")).toBeUndefined();
  });

  it("returns undefined for obviously missing state", () => {
    expect(stateFromSlugAddress("Hoagland 46745")).toBeUndefined();
    expect(stateFromSlugAddress("")).toBeUndefined();
  });

  it("handles the canonical-format address that the route now composes", () => {
    // §16.U #2 ROOT CAUSE regression: the old composed format was
    // "Street City, ST ZIP" (no comma between street and city). The new
    // canonical format is "Street, City, ST ZIP". Both should resolve.
    expect(
      stateFromSlugAddress("14215 Hawk Stream Cv Hoagland, IN 46745"),
    ).toBe("IN");
    expect(
      stateFromSlugAddress("14215 Hawk Stream Cv, Hoagland, IN 46745"),
    ).toBe("IN");
  });
});
