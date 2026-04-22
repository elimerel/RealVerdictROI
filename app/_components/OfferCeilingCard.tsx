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

export default function OfferCeilingCard({ inputs }: { inputs: DealInputs }) {
  const ceiling = findOfferCeiling(inputs);
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

  const headlineCopy = (() => {
    if (!primary)
      return "No offer price clears the rubric at these assumptions. Usually the rent estimate or financing assumption is off — check the 'How we got these numbers' panel above.";
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

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6">
      <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        Walk-away price
      </div>
      <div className="text-base sm:text-lg font-semibold text-zinc-100">
        {!primary ? (
          <span className="text-zinc-300">
            No realistic price clears the rubric.
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

      {(stretchCopy || buydownCopy) && (
        <div className="mt-3 space-y-1 text-xs text-zinc-500 leading-relaxed">
          {stretchCopy && <p>{stretchCopy}</p>}
          {buydownCopy && <p>{buydownCopy}</p>}
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
