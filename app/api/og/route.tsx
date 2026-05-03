import { ImageResponse } from "next/og";
import {
  analyseDeal,
  findOfferCeiling,
  formatCurrency,
  formatPercent,
  inputsFromSearchParams,
} from "@/lib/calculations";

export const runtime = "edge";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };

// ---------------------------------------------------------------------------
// Dynamic Open Graph image for /results.
//
// URL: /api/og?purchasePrice=...&monthlyRent=...&...&address=...
// Takes the same search params as /results and renders a branded verdict card
// so that shared links (Twitter, Reddit, iMessage, Slack) look professional
// instead of blank.
// ---------------------------------------------------------------------------

// ImageResponse can't read CSS variables — importing hex values directly.
import { TIER_LABEL, TIER_ACCENT } from "@/lib/tier-constants";

const BG = "#09090b"; // zinc-950
const MUTED = "#a1a1aa"; // zinc-400
const DIM = "#52525b"; // zinc-600
const TEXT = "#fafafa"; // zinc-50

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const inputs = inputsFromSearchParams(params);
  const analysis = analyseDeal(inputs);
  const ceiling = findOfferCeiling(inputs, {
    // OG previews don't have comp access. Cap at list price so the shared
    // image never shows an absurd walk-away number (the 5% premium in the
    // solver gives this a reasonable headroom).
    marketValueCap: inputs.purchasePrice > 0 ? inputs.purchasePrice : undefined,
    marketValueCapSource: "list",
  });

  const tier = analysis.verdict.tier;
  const accent = TIER_ACCENT[tier];
  const label = TIER_LABEL[tier];

  const address = typeof params.address === "string" ? params.address : "";
  const priceLine = formatCurrency(inputs.purchasePrice, 0);
  const cashFlow = `${formatCurrency(analysis.monthlyCashFlow, 0)} / mo`;
  const cap = `${formatPercent(analysis.capRate, 1)} cap`;
  const dscr = isFinite(analysis.dscr)
    ? `${analysis.dscr.toFixed(2)} DSCR`
    : "∞ DSCR";

  const recommended = ceiling.recommendedCeiling;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          padding: "64px 72px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* TOP — wordmark + tier accent bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: TEXT,
              letterSpacing: "-0.02em",
            }}
          >
            RealVerdict
          </div>
          <div
            style={{
              width: 6,
              height: 28,
              background: accent,
              borderRadius: 3,
            }}
          />
          <div
            style={{
              fontSize: 18,
              color: DIM,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Rental Deal Analysis
          </div>
        </div>

        {/* MIDDLE — tier label + supporting numbers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 128,
              fontWeight: 800,
              color: accent,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              display: "flex",
            }}
          >
            {label}
          </div>
          {address && (
            <div
              style={{
                fontSize: 28,
                color: TEXT,
                maxWidth: 1000,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "flex",
              }}
            >
              {address}
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: 32,
              fontSize: 26,
              color: MUTED,
            }}
          >
            <span style={{ display: "flex" }}>{priceLine}</span>
            <span style={{ color: DIM, display: "flex" }}>·</span>
            <span style={{ display: "flex" }}>{cashFlow}</span>
            <span style={{ color: DIM, display: "flex" }}>·</span>
            <span style={{ display: "flex" }}>{cap}</span>
            <span style={{ color: DIM, display: "flex" }}>·</span>
            <span style={{ display: "flex" }}>{dscr}</span>
          </div>
        </div>

        {/* BOTTOM — walk-away price callout + footer */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 32,
          }}
        >
          {recommended ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  fontSize: 16,
                  color: DIM,
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  display: "flex",
                }}
              >
                Walk-away price
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
                <div
                  style={{
                    fontSize: 48,
                    fontWeight: 700,
                    color: accent,
                    letterSpacing: "-0.02em",
                    display: "flex",
                  }}
                >
                  {formatCurrency(recommended.price, 0)}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    color: MUTED,
                    display: "flex",
                  }}
                >
                  for {TIER_LABEL[recommended.tier]}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}

          <div
            style={{
              fontSize: 16,
              color: DIM,
              letterSpacing: "0.06em",
              display: "flex",
            }}
          >
            realverdict.app
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
