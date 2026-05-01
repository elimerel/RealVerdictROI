import { describe, expect, it } from "vitest"
import { scanSignals } from "./signals"

describe("Stage 2 signal scan", () => {
  it("rejects empty / non-real-estate text", () => {
    const r = scanSignals("Welcome to YouTube. Sign in to like videos. Subscribe.")
    expect(r.looksLikeListing).toBe(false)
    expect(r.looksLikeSearchResults).toBe(false)
  })

  it("rejects a generic news article that mentions a price in passing", () => {
    const r = scanSignals(
      "The housing market continues to surge. Median prices reached $450,000 nationally last quarter, " +
      "according to NAR. Mortgage rates remain elevated."
    )
    expect(r.looksLikeListing).toBe(false)
  })

  it("accepts a typical Zillow listing fingerprint", () => {
    const r = scanSignals(`
      123 Main St, Austin, TX 78701
      Listed for $625,000 · Zestimate $610,000
      3 beds · 2 baths · 1,820 sqft · Year built 1998
      Rent Zestimate: $2,950/mo
      Property tax history shows annual taxes of $7,450.
      Days on Zillow: 12
      MLS# 4823109
    `)
    expect(r.looksLikeListing).toBe(true)
    expect(r.looksLikeSearchResults).toBe(false)
    expect(r.score).toBeGreaterThanOrEqual(10)
  })

  it("accepts a Redfin-style listing", () => {
    const r = scanSignals(`
      456 Oak Avenue, Seattle, WA
      Listed at $920,000. Redfin Estimate: $905,000.
      4 beds, 2.5 baths, 2,430 square feet
      Lot size: 6,200 sqft. Year built 2005.
      HOA $0/mo. Property tax $11,200 annually.
    `)
    expect(r.looksLikeListing).toBe(true)
  })

  it("flags a search results page", () => {
    const r = scanSignals(`
      1,247 homes for sale in Austin, TX
      Sort by: Price · Beds · Newest
      Save search
      $499,000 · 3 bd · 2 ba
      $625,000 · 4 bd · 2.5 ba
      $399,000 · 2 bd · 1 ba
      $799,000 · 5 bd · 3 ba
      $549,000 · 3 bd · 2 ba
      $689,000 · 4 bd · 2 ba
      $429,000 · 2 bd · 2 ba
      $999,000 · 5 bd · 4 ba
      $375,000 · 2 bd · 1 ba
      Showing 1-25 of 1,247
    `)
    expect(r.looksLikeSearchResults).toBe(true)
  })

  it("flags a page with > 14 distinct prices and no listing URL as search results", () => {
    // Stay under $1M so the thousands separator regex matches every price.
    const prices = Array.from({ length: 16 }, (_, i) => `$${300 + i * 25},000`).join(" · ")
    const r = scanSignals(`Real estate listings: ${prices}`)
    expect(r.looksLikeSearchResults).toBe(true)
  })

  it("does NOT flag a real Zillow listing as search results just because the page has many price snippets (carousels, similar homes, price history)", () => {
    // Real listings on Zillow / Redfin / Realtor routinely have 8-12 price
    // strings from "similar homes" + price history tables. The URL is the
    // tiebreaker.
    const carouselPrices = Array.from({ length: 12 }, (_, i) => `$${400 + i * 25},000`).join(" · ")
    const text = `
      7367 Rutherford Dr, Reno, NV 89506
      Listed for $530,000  ·  Zestimate $545,000
      3 beds · 2 baths · 1,725 sqft · Year built 2018
      Days on Zillow: 4 · MLS# RNV-12345
      Rent Zestimate: $3,022/mo
      Similar homes: ${carouselPrices}
    `
    const r = scanSignals(text, "https://www.zillow.com/homedetails/7367-Rutherford-Dr-Reno-NV-89506/184652637_zpid/")
    expect(r.looksLikeListing).toBe(true)
    expect(r.looksLikeSearchResults).toBe(false)
  })
})
