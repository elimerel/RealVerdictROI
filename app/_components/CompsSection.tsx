import Link from "next/link";
import type { CompsResult } from "@/lib/comps";
import { formatCurrency, type DealAnalysis } from "@/lib/calculations";
import type { ComparablesAnalysis } from "@/lib/comparables";
import CompReasoningPanel from "./CompReasoningPanel";

// ---------------------------------------------------------------------------
// Comps panel — sale + rent comps with median anchors and an explicit
// "your number vs the market" call-out for both price and rent.
// Renders nothing useful if comps is null (no address) or empty (out of area).
//
// The Reality Check headline ALWAYS reflects the engine's derived fair
// value / rent (sqft-normalized + anchor-blended) when those exist, never
// the raw pool median. The raw median lives on as the small p25/median/p75
// anchor band under each comp table — it's still useful as "this is the
// shape of the pool" but it's no longer making a verdict against the
// subject. This fixes §16.U #5–6 / §16.U.1 #1 / §20.9 #4: the card and the
// engine's "How we got these numbers" PDF derivation now tell ONE story.
// ---------------------------------------------------------------------------

export default function CompsSection({
  analysis,
  comps,
  comparables,
  address,
  liveCompsHref,
}: {
  analysis: DealAnalysis;
  comps: CompsResult | null;
  comparables: ComparablesAnalysis | null;
  address: string | undefined;
  /** When present, the user hasn't opted into live comps yet — surface a
   *  CTA pointing at this URL instead of the generic "service unavailable"
   *  empty state. Only set on the fast-estimate path (§20.8). */
  liveCompsHref?: string;
}) {
  if (!address) {
    return (
      <EmptyState>
        Add a property address on the home page to pull live sale and rental
        comps for this area.
      </EmptyState>
    );
  }
  if (!comps) {
    if (liveCompsHref) {
      return (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-300">
          <div className="font-semibold text-zinc-100">
            No live comps loaded yet.
          </div>
          <p className="mt-2 text-zinc-400">
            The numbers above are running on the fast estimate (Zillow
            Zestimate, FRED rate, state-average tax + insurance). Pull the
            actual sale + rent comp pool for this address to unlock the
            Negotiation Pack and the Comp Reasoning Explainer.
          </p>
          <Link
            href={liveCompsHref}
            className="mt-4 inline-flex h-10 items-center rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-white"
          >
            Run live comp analysis
          </Link>
        </div>
      );
    }
    return (
      <EmptyState>
        Comps service unavailable right now. Check that{" "}
        <code className="font-mono text-zinc-300">RENTCAST_API_KEY</code> is
        configured.
      </EmptyState>
    );
  }

  const saleStats = comps.saleComps.stats;
  const rentStats = comps.rentComps.stats;
  const subjectPrice = analysis.inputs.purchasePrice;
  const subjectRent = analysis.inputs.monthlyRent;
  const radius = comps.radiusMilesUsed;

  return (
    <section className="flex flex-col gap-8">
      {/* Reality-check headline — uses the engine's sqft-normalized +
          anchor-blended derivation when available, otherwise falls back
          to the raw pool median. Never two truths on one page. */}
      <RealityCheck
        subjectPrice={subjectPrice}
        subjectRent={subjectRent}
        saleStats={saleStats}
        rentStats={rentStats}
        marketValue={comparables?.marketValue ?? null}
        marketRent={comparables?.marketRent ?? null}
      />

      {/* §20.4 Comp Reasoning Explainer — only renders when we have a real
          comparables analysis (i.e. user opted into live comps). */}
      {comparables && (
        <CompReasoningPanel comps={comps} comparables={comparables} />
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <CompTable
          title="Sale comps nearby"
          subtitle={
            saleStats.median
              ? `${saleStats.count} listings within ${radius}mi · median ${formatCurrency(saleStats.median, 0)}`
              : `No active or sold listings within ${radius}mi`
          }
          subjectLabel="Your purchase price"
          subjectValue={subjectPrice}
          stats={saleStats}
          comps={comps.saleComps.items}
          unit="sale"
          radius={radius}
        />
        <CompTable
          title="Rent comps nearby"
          subtitle={
            rentStats.median
              ? `${rentStats.count} listings within ${radius}mi · median ${formatCurrency(rentStats.median, 0)}/mo`
              : `No active rentals within ${radius}mi`
          }
          subjectLabel="Your projected rent"
          subjectValue={subjectRent}
          stats={rentStats}
          comps={comps.rentComps.items}
          unit="rent"
          radius={radius}
        />
      </div>

      {comps.notes.length > 0 && (
        <ul className="text-xs text-zinc-500 list-disc pl-5 space-y-1">
          {comps.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Reality check — turn raw medians into one or two pointed sentences:
// "Your rent is 14% above the median for nearby 3-bed listings".
// ---------------------------------------------------------------------------

type Derivation = NonNullable<ComparablesAnalysis["marketValue"]>;

/**
 * Choose the anchor the Reality Check should compare the subject against.
 * Engine-derived value (sqft-normalized + anchor-blended) wins when
 * available — that's the same number the "How we got these numbers"
 * derivation surfaces. Raw pool median is only the fallback.
 */
function pickAnchor(
  derivation: Derivation | null,
  rawMedian: number | undefined,
):
  | { value: number; label: string; suffix: string }
  | null {
  if (derivation && derivation.value > 0) {
    // The engine's derived value is sqft-normalized + anchor-blended —
    // the same number "How we got these numbers" surfaces above.
    const suffix =
      derivation.confidence === "low"
        ? " Confidence is low — see the derivation note above for caveats."
        : "";
    return {
      value: derivation.value,
      label: "the comp-derived fair value",
      suffix,
    };
  }
  if (rawMedian && rawMedian > 0) {
    return {
      value: rawMedian,
      label: "the median nearby listing",
      suffix: "",
    };
  }
  return null;
}

/**
 * Reality Check headline. Always pulls its number from the engine's
 * derivation when one exists (sqft-normalized + anchor-blended). The raw
 * pool median is only a last-resort fallback for cases where the engine
 * couldn't produce a derivation (e.g. <3 sqft-bearing comps).
 *
 * Why: §16.U #5–6 and §16.U.1 #1 documented that the old card compared
 * the subject to the raw median — a number the engine itself doesn't
 * trust for unit-size mismatches or anchor disagreement. That produced
 * "Reality Check says rent is 41% above median" while the same engine
 * was projecting subject rent at the engine's normalized number a few
 * inches away on the page. Two truths, one analysis.
 */
function RealityCheck({
  subjectPrice,
  subjectRent,
  saleStats,
  rentStats,
  marketValue,
  marketRent,
}: {
  subjectPrice: number;
  subjectRent: number;
  saleStats: { median?: number };
  rentStats: { median?: number };
  marketValue: Derivation | null;
  marketRent: Derivation | null;
}) {
  const lines: { text: string; tone: "good" | "warn" | "bad" | "neutral" }[] = [];

  // ----- Sale side -----
  const saleAnchor = pickAnchor(marketValue, saleStats.median);
  if (saleAnchor && subjectPrice > 0) {
    const delta = (subjectPrice - saleAnchor.value) / saleAnchor.value;
    if (Math.abs(delta) >= 0.03) {
      const direction = delta > 0 ? "above" : "below";
      const tone = delta > 0.1 ? "warn" : delta < -0.1 ? "good" : "neutral";
      lines.push({
        text: `Your purchase price is ${(Math.abs(delta) * 100).toFixed(0)}% ${direction} ${saleAnchor.label} (${formatCurrency(saleAnchor.value, 0)}).${saleAnchor.suffix}`,
        tone,
      });
    } else {
      lines.push({
        text: `Your purchase price is in line with ${saleAnchor.label} (${formatCurrency(saleAnchor.value, 0)}).${saleAnchor.suffix}`,
        tone: "good",
      });
    }
  }

  // ----- Rent side -----
  const rentAnchor = pickAnchor(marketRent, rentStats.median);
  if (rentAnchor && subjectRent > 0) {
    const delta = (subjectRent - rentAnchor.value) / rentAnchor.value;
    if (Math.abs(delta) >= 0.05) {
      const direction = delta > 0 ? "above" : "below";
      // Optimistic rent assumption is the #1 way investors fool themselves.
      const tone = delta > 0.1 ? "bad" : delta > 0.05 ? "warn" : "good";
      lines.push({
        text: `Your rent assumption is ${(Math.abs(delta) * 100).toFixed(0)}% ${direction} ${rentAnchor.label} (${formatCurrency(rentAnchor.value, 0)}/mo). ${delta > 0.05 ? "Verify with at least 3 comps before banking on it." : ""}`.trim() + rentAnchor.suffix,
        tone,
      });
    } else {
      lines.push({
        text: `Your rent assumption is in line with ${rentAnchor.label} (${formatCurrency(rentAnchor.value, 0)}/mo).${rentAnchor.suffix}`,
        tone: "good",
      });
    }
  }

  if (lines.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5">
      <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        Reality check
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {lines.map((l, i) => (
          <li
            key={i}
            className={
              l.tone === "good"
                ? "text-emerald-300"
                : l.tone === "warn"
                  ? "text-amber-300"
                  : l.tone === "bad"
                    ? "text-red-300"
                    : "text-zinc-300"
            }
          >
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single comps table (sale OR rent). Subject row pinned at the top.
// ---------------------------------------------------------------------------

function CompTable({
  title,
  subtitle,
  subjectLabel,
  subjectValue,
  stats,
  comps,
  unit,
  radius,
}: {
  title: string;
  subtitle: string;
  subjectLabel: string;
  subjectValue: number;
  stats: {
    count: number;
    median?: number;
    p25?: number;
    p75?: number;
    medianPricePerSqft?: number;
    medianRentPerSqft?: number;
  };
  comps: Array<{
    address: string;
    bedrooms?: number;
    bathrooms?: number;
    squareFootage?: number;
    price?: number;
    distance?: number;
    daysOnMarket?: number;
    status?: string;
  }>;
  unit: "sale" | "rent";
  radius: number;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 overflow-hidden">
      <div className="px-5 pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">{subtitle}</div>
      </div>

      {stats.median && stats.p25 && stats.p75 && (
        <div className="px-5 pt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-zinc-500 uppercase tracking-wider">25th</div>
            <div className="font-mono tabular-nums text-zinc-300">
              {formatCurrency(stats.p25, 0)}
            </div>
          </div>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider">Median</div>
            <div className="font-mono tabular-nums text-zinc-100 font-semibold">
              {formatCurrency(stats.median, 0)}
            </div>
          </div>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider">75th</div>
            <div className="font-mono tabular-nums text-zinc-300">
              {formatCurrency(stats.p75, 0)}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2 text-left font-medium">Address</th>
              <th className="px-2 py-2 text-right font-medium">Bd/Ba</th>
              <th className="px-2 py-2 text-right font-medium">Sqft</th>
              <th className="px-4 py-2 text-right font-medium">
                {unit === "sale" ? "Price" : "Rent/mo"}
              </th>
              <th className="px-2 py-2 text-right font-medium">Mi</th>
            </tr>
          </thead>
          <tbody>
            {/* Subject row */}
            <tr className="border-b border-zinc-800 bg-zinc-800/40">
              <td className="px-4 py-2.5 text-zinc-100 font-semibold">
                {subjectLabel}
              </td>
              <td className="px-2 py-2.5 text-right text-zinc-400">—</td>
              <td className="px-2 py-2.5 text-right text-zinc-400">—</td>
              <td
                className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold"
                style={{ color: "var(--accent)" }}
              >
                {subjectValue > 0 ? formatCurrency(subjectValue, 0) : "—"}
              </td>
              <td className="px-2 py-2.5 text-right text-zinc-400">—</td>
            </tr>

            {comps.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-xs text-zinc-500"
                >
                  No comps within {radius}mi.
                </td>
              </tr>
            )}

            {comps.slice(0, 8).map((c, i) => {
              const beds = c.bedrooms ? `${c.bedrooms}` : "—";
              const baths = c.bathrooms ? `${c.bathrooms}` : "—";
              return (
                <tr
                  key={`${c.address}-${i}`}
                  className={i % 2 === 1 ? "bg-zinc-900/40" : ""}
                >
                  <td className="px-4 py-2 text-zinc-300 truncate max-w-[220px]">
                    {c.address}
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-400 font-mono tabular-nums">
                    {beds}/{baths}
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-400 font-mono tabular-nums">
                    {c.squareFootage ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-100 font-mono tabular-nums">
                    {c.price ? formatCurrency(c.price, 0) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-500 font-mono tabular-nums">
                    {c.distance !== undefined ? c.distance.toFixed(2) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-8 text-sm text-zinc-400">
      {children}
    </div>
  );
}
