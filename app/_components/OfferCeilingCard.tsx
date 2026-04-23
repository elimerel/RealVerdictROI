import type { CSSProperties } from "react";
import {
  type DealInputs,
  findOfferCeiling,
  formatCurrency,
  type VerdictTier,
} from "@/lib/calculations";

const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "STRONG BUY",
  good: "GOOD DEAL",
  fair: "BORDERLINE",
  poor: "PASS",
  avoid: "AVOID",
};

// Use a dimmer accent palette so the card harmonizes with /results' --accent.
const TIER_DOT: Record<VerdictTier, string> = {
  excellent: "#22c55e",
  good: "#22c55e",
  fair: "#eab308",
  poor: "#ef4444",
  avoid: "#ef4444",
};

// ---------------------------------------------------------------------------
// Negotiation-anchor card. Shows the highest price the deal can carry while
// still earning each verdict tier. This is the single most actionable artifact
// of the entire analysis — investors literally walk into a negotiation with
// these numbers.
//
// Key UX decision: the *headline* shows the best tier reachable within a
// realistic negotiation band (≤15% under list), not the absolute best tier.
// Showing "Max offer $367k for STRONG BUY" on a $510k listing reads as a
// nonsensical lowball; showing "Max offer $466k for BORDERLINE" reflects an
// offer an investor would actually make.
// ---------------------------------------------------------------------------

export default function OfferCeilingCard({
  inputs,
  marketValueCap,
  marketValueCapSource,
}: {
  inputs: DealInputs;
  /**
   * Market-value anchor used to clamp tier ceilings. Pass
   * `comps.marketValue.value` when comps are available (source="comps"),
   * else the subject's list price (source="list"). Without this, the income
   * rubric alone can return walk-away prices 5-10× fair value on rent-heavy
   * listings — the exact bug the user caught ($3.4M walk-away on a $540k list
   * with $472k fair value).
   */
  marketValueCap?: number;
  marketValueCapSource?: "comps" | "list";
}) {
  const ceiling = findOfferCeiling(inputs, {
    marketValueCap,
    marketValueCapSource,
  });
  const current = ceiling.currentPrice;
  const currentTier = ceiling.currentTier;

  // Order tiers worst-to-best so the card reads like a price ladder going up.
  const ladder: { tier: VerdictTier; price: number | undefined }[] = [
    { tier: "excellent", price: ceiling.excellent },
    { tier: "good", price: ceiling.good },
    { tier: "fair", price: ceiling.fair },
    { tier: "poor", price: ceiling.poor },
  ];

  const primary = ceiling.primaryTarget;
  const stretch = ceiling.stretchTarget;
  const buydown = ceiling.rateBuydown;

  // Price that would clear the BORDERLINE threshold — shown in the
  // no-walk-away case so the user sees the magnitude of the discount the
  // deal would need to work. If even 'fair' is unreachable, fall back to
  // 'good' or 'excellent'.
  const fairPrice = ceiling.fair;
  const goodPrice = ceiling.good;
  const excellentPrice = ceiling.excellent;
  const firstReachable = fairPrice ?? goodPrice ?? excellentPrice;
  const firstReachableTier: VerdictTier | null = fairPrice
    ? "fair"
    : goodPrice
      ? "good"
      : excellentPrice
        ? "excellent"
        : null;

  const headlineCopy = (() => {
    if (!primary) {
      // Best-case scenario for this deal is PASS or worse inside the
      // realistic negotiation band. Tell the user plainly — don't hide
      // the verdict behind a phantom walk-away number.
      if (firstReachable !== undefined && firstReachableTier) {
        const cut = current - firstReachable;
        const pct = ((cut / Math.max(1, current)) * 100).toFixed(1);
        return `Skip — this deal can't clear ${TIER_LABEL[firstReachableTier]} without ${formatCurrency(cut, 0)} off list (${pct}% under asking). That's outside normal negotiation range. The rent the property produces doesn't cover the carry at realistic offers.`;
      }
      return "Skip — no price clears the rubric at these assumptions. Rent vs. carrying cost can't be reconciled by negotiation alone. If the rent estimate looks low to you, check the 'How we got these numbers' panel and rerun with a corrected number.";
    }
    if (primary.price >= current) {
      const room = primary.price - current;
      return `You have ${formatCurrency(room, 0)} of room above asking before this slips below ${TIER_LABEL[primary.tier]}. Good setup.`;
    }
    const cut = current - primary.price;
    const pct = primary.discountPercent.toFixed(1);
    return `Negotiate ${formatCurrency(cut, 0)} off (${pct}% under list) to bring this to ${TIER_LABEL[primary.tier]}.`;
  })();

  const stretchCopy = (() => {
    if (!stretch || !primary) return null;
    const stretchCut = Math.max(0, current - stretch.price);
    const extraCut = Math.max(0, primary.price - stretch.price);
    if (stretchCut <= 0) return null;
    return `To push this to ${TIER_LABEL[stretch.tier]}, you'd need ${formatCurrency(stretchCut, 0)} off (${stretch.discountPercent.toFixed(1)}% under list) — another ${formatCurrency(extraCut, 0)} beyond the headline offer.`;
  })();

  const buydownCopy = (() => {
    if (!buydown || buydown.priceEquivPer1pt <= 0) return null;
    return `Equivalent lever: buy the rate down 1 point for ~${formatCurrency(buydown.costPer1pt, 0)} upfront — same impact as ~${formatCurrency(buydown.priceEquivPer1pt, 0)} off the price.`;
  })();

  // Market-value anchor note. Shown when a cap is supplied so the investor
  // understands the walk-away number is disciplined by comp-derived fair
  // value (or list price, as a weaker anchor). This is what stops the card
  // from ever suggesting "pay $3.4M for a $540k listing" again.
  const capCopy = (() => {
    if (!ceiling.marketValueCap) return null;
    const { cap, source, binding } = ceiling.marketValueCap;
    const label = source === "comps" ? "comp-derived fair value" : "list price";
    if (binding) {
      return `Bounded by ${label}: walk-away ceiling capped at ${formatCurrency(cap, 0)} (5% premium over anchor). The income rubric alone would accept a higher price, but paying above market value means buying negative equity on day one.`;
    }
    return `Market-value anchor: ${formatCurrency(cap, 0)} (5% premium over ${label}). The rubric ceilings above are all below this — the income math is the binding constraint here, not overpayment risk.`;
  })();

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6">
      <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        Walk-away price
      </div>
      <div className="text-base sm:text-lg font-semibold text-zinc-100">
        {!primary ? (
          <span style={{ color: "var(--accent)" }}>
            Walk away.{" "}
            <span className="text-zinc-400 font-normal text-sm">
              No realistic offer makes this a buy.
            </span>
          </span>
        ) : (
          <>
            Max offer:{" "}
            <span style={{ color: "var(--accent)" }}>
              {formatCurrency(primary.price, 0)}
            </span>{" "}
            <span className="text-zinc-500 font-normal text-sm">
              for {TIER_LABEL[primary.tier]}
            </span>
          </>
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-400">{headlineCopy}</p>

      {(stretchCopy || buydownCopy || capCopy) && (
        <div className="mt-3 space-y-1 text-xs text-zinc-500 leading-relaxed">
          {stretchCopy && <p>{stretchCopy}</p>}
          {buydownCopy && <p>{buydownCopy}</p>}
          {capCopy && <p>{capCopy}</p>}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-1.5">
        {ladder.map(({ tier, price }) => {
          const dot: CSSProperties = { backgroundColor: TIER_DOT[tier] };
          const isCurrent = tier === currentTier;
          const isPrimary = primary && tier === primary.tier;
          const reachable = price !== undefined;
          return (
            <div
              key={tier}
              className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 ${isCurrent ? "bg-zinc-800/60" : isPrimary ? "bg-zinc-800/30" : ""}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={dot}
                />
                <span className="text-sm font-semibold uppercase tracking-wider text-zinc-300 truncate">
                  {TIER_LABEL[tier]}
                </span>
                {isCurrent && (
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    you are here
                  </span>
                )}
                {!isCurrent && isPrimary && (
                  <span
                    className="text-[10px] font-medium uppercase tracking-wider"
                    style={{ color: "var(--accent)" }}
                  >
                    target offer
                  </span>
                )}
              </div>
              <div className="font-mono text-sm tabular-nums text-zinc-100">
                {reachable
                  ? `≤ ${formatCurrency(price, 0)}`
                  : "— not reachable"}
              </div>
            </div>
          );
        })}
      </div>

      {!primary && ceiling.poor !== undefined && (
        <p className="mt-3 text-[11px] leading-snug text-zinc-500">
          The PASS row is the list-capped ceiling of the PASS band (still not
          AVOID in the model) — not a price to offer. BORDERLINE or better is
          where a buy could start on these inputs.
        </p>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
        Currently:{" "}
        <span className="font-mono tabular-nums text-zinc-300">
          {formatCurrency(current, 0)}
        </span>{" "}
        →{" "}
        <span className="font-semibold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
          {TIER_LABEL[currentTier]}
        </span>
      </div>
    </div>
  );
}
