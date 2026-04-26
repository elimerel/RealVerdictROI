import type { CSSProperties } from "react";
import {
  type AnalyseDealOptions,
  type DealInputs,
  findOfferCeiling,
  formatCurrency,
  type VerdictTier,
} from "@/lib/calculations";
import { TIER_LABEL, TIER_ACCENT as TIER_DOT } from "@/lib/tier-constants";

const LADDER_ORDER = ["excellent", "good", "fair", "poor"] as const;
type LadderTier = (typeof LADDER_ORDER)[number];

function ceilingForTier(
  c: ReturnType<typeof findOfferCeiling>,
  tier: LadderTier,
): number | undefined {
  switch (tier) {
    case "excellent":
      return c.excellent;
    case "good":
      return c.good;
    case "fair":
      return c.fair;
    case "poor":
      return c.poor;
    default: {
      const _x: never = tier;
      return _x;
    }
  }
}

/** Tiers more optimistic than `first` — those ceilings read as absurd on a high ask. */
function optimisticTiersAbove(first: "excellent" | "good" | "fair"): Set<VerdictTier> {
  if (first === "fair") return new Set(["excellent", "good"]);
  if (first === "good") return new Set(["excellent"]);
  return new Set();
}

// ---------------------------------------------------------------------------
// Negotiation-anchor card. Shows the highest price the deal can carry while
// still earning each verdict tier. This is the single most actionable artifact
// of the entire analysis — investors literally walk into a negotiation with
// these numbers.
//
// Key UX decision: the *headline* shows the best tier reachable within a
// realistic negotiation band (≤15% under list), not the absolute best tier.
//
// When there is NO primary target (deal fails inside that band), showing
// STRONG BUY at $174k on a $540k ask reads like parody — those rows are still
// true rubric crossings but we collapse them behind <details> and foreground
// only the nearest crossing (e.g. BORDERLINE) + PASS.
// ---------------------------------------------------------------------------

export default function OfferCeilingCard({
  inputs,
  marketValueCap,
  marketValueCapSource,
  analyseDealOptions,
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
  analyseDealOptions?: AnalyseDealOptions;
}) {
  const ceiling = findOfferCeiling(inputs, {
    marketValueCap,
    marketValueCapSource,
    analyseDealOptions,
  });
  const current = ceiling.currentPrice;
  const currentTier = ceiling.currentTier;

  const ladder: { tier: LadderTier; price: number | undefined }[] =
    LADDER_ORDER.map((tier) => ({
      tier,
      price: ceilingForTier(ceiling, tier),
    }));

  const primary = ceiling.primaryTarget;
  const stretch = ceiling.stretchTarget;
  const buydown = ceiling.rateBuydown;

  const fairPrice = ceiling.fair;
  const goodPrice = ceiling.good;
  const excellentPrice = ceiling.excellent;
  const firstReachable = fairPrice ?? goodPrice ?? excellentPrice;
  const firstReachableTier: "excellent" | "good" | "fair" | null = fairPrice
    ? "fair"
    : goodPrice
      ? "good"
      : excellentPrice
        ? "excellent"
        : null;

  const hiddenOptimistic =
    !primary && firstReachableTier
      ? optimisticTiersAbove(firstReachableTier)
      : new Set<VerdictTier>();

  const visibleLadder = ladder.filter((row) => !hiddenOptimistic.has(row.tier));

  const hiddenWithPrices = LADDER_ORDER.filter(
    (t) => hiddenOptimistic.has(t) && ceilingForTier(ceiling, t) !== undefined,
  ).map((t) => ({
    tier: t,
    price: ceilingForTier(ceiling, t) as number,
  }));

  const headlineCopy = (() => {
    if (!primary) {
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

  const capCopy = (() => {
    if (!ceiling.marketValueCap) return null;
    const { cap, source, binding } = ceiling.marketValueCap;
    const label = source === "comps" ? "comp-derived fair value" : "list price";
    if (binding) {
      return `Bounded by ${label}: walk-away ceiling capped at ${formatCurrency(cap, 0)} (5% premium over anchor). The income rubric alone would accept a higher price, but paying above market value means buying negative equity on day one.`;
    }
    return `Market-value anchor: ${formatCurrency(cap, 0)} (5% premium over ${label}). The rubric ceilings above are all below this — the income math is the binding constraint here, not overpayment risk.`;
  })();

  const constraintPill = (() => {
    if (!ceiling.marketValueCap) return "income-bound";
    return ceiling.marketValueCap.binding ? "comp-bound" : "income-bound";
  })();

  const collapsedRubricNote =
    !primary && hiddenWithPrices.length > 0 ? (
      <p className="mb-2 text-xs leading-snug text-zinc-500">
        {hiddenWithPrices
          .map(
            ({ tier, price }) =>
              `${TIER_LABEL[tier]} (≤${formatCurrency(price, 0)})`,
          )
          .join(" · ")}{" "}
        — rubric math only at those prices, not asks anyone would make on a{" "}
        {formatCurrency(current, 0)} listing. The rows below are the nearest
        crossings that still relate to your ask.
      </p>
    ) : null;

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6">
      <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        Walk-away price
      </div>
      {!primary ? (
        <div className="text-4xl font-bold leading-none" style={{ color: "var(--accent)" }}>
          Walk away.
          <p className="mt-2 text-sm font-normal text-zinc-400 leading-snug">
            No realistic offer makes this a buy.
          </p>
        </div>
      ) : (
        <>
          <div className="font-mono text-4xl font-bold leading-none tabular-nums" style={{ color: "var(--accent)" }}>
            {formatCurrency(primary.price, 0)}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-500">Max offer for</span>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
              style={{
                background: `${TIER_DOT[primary.tier]}22`,
                color: TIER_DOT[primary.tier],
                border: `1px solid ${TIER_DOT[primary.tier]}44`,
              }}
            >
              {TIER_LABEL[primary.tier]}
            </span>
            <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              {constraintPill}
            </span>
          </div>
        </>
      )}
      <p className="mt-2 text-sm text-zinc-400">{headlineCopy}</p>

      {(stretchCopy || buydownCopy || capCopy) && (
        <div className="mt-3 space-y-1 text-xs text-zinc-500 leading-relaxed">
          {stretchCopy && <p>{stretchCopy}</p>}
          {buydownCopy && <p>{buydownCopy}</p>}
          {capCopy && <p>{capCopy}</p>}
        </div>
      )}

      <div className="mt-5">
        {collapsedRubricNote}
        <div className="mb-2 flex items-end justify-between gap-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          <span>Tier</span>
          <span className="text-right">Max price in band</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {visibleLadder.map(({ tier, price }) => (
            <TierLadderRow
              key={tier}
              tier={tier}
              price={price}
              primary={primary}
              currentTier={currentTier}
            />
          ))}
        </div>

        {!primary && hiddenWithPrices.length > 0 && (
          <details className="mt-3 rounded-md border border-zinc-800/80 bg-zinc-950/40 px-3 py-2 text-[11px] text-zinc-500">
            <summary className="cursor-pointer font-medium text-zinc-400 hover:text-zinc-300">
              Full four-tier rubric (methodology / transparency)
            </summary>
            <div className="mt-2 flex flex-col gap-1.5 border-t border-zinc-800/60 pt-2">
              {ladder.map(({ tier, price }) => (
                <TierLadderRow
                  key={tier}
                  tier={tier}
                  price={price}
                  primary={primary}
                  currentTier={currentTier}
                />
              ))}
            </div>
          </details>
        )}
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
        <span
          className="font-semibold uppercase tracking-wider"
          style={{ color: "var(--accent)" }}
        >
          {TIER_LABEL[currentTier]}
        </span>
      </div>
    </div>
  );
}

function TierLadderRow({
  tier,
  price,
  primary,
  currentTier,
}: {
  tier: VerdictTier;
  price: number | undefined;
  primary: { tier: VerdictTier } | undefined;
  currentTier: VerdictTier;
}) {
  const dot: CSSProperties = { backgroundColor: TIER_DOT[tier] };
  const isCurrent = tier === currentTier;
  const isPrimary = primary && tier === primary.tier;
  const reachable = price !== undefined;
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 ${isCurrent ? "bg-zinc-800/60" : isPrimary ? "bg-zinc-800/30" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={dot}
        />
        <span className="truncate text-sm font-semibold uppercase tracking-wider text-zinc-300">
          {TIER_LABEL[tier]}
        </span>
        {isCurrent && (
          <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-300">
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
      <div
        className="font-mono text-sm tabular-nums text-zinc-100"
        title={
          tier === "poor" && !primary && reachable
            ? "List-capped top of the PASS rubric band (still not AVOID). Not a price to offer — BORDERLINE or better is where a buy could start."
            : reachable
              ? "Largest purchase price at which the verdict is still at least this tier (rubric)."
              : undefined
        }
      >
        {reachable ? `≤ ${formatCurrency(price, 0)}` : "— not reachable"}
      </div>
    </div>
  );
}
