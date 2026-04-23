// ---------------------------------------------------------------------------
// Comp Reasoning Explainer (HANDOFF §20.4).
//
// Sits at the top of the Comps tab on /results when live comp data is
// loaded. For each comp pool (sale + rent), surfaces:
//
//   1. The p25 / median / p75 band with sample size and radius — so the
//      reader sees the SHAPE of the pool, not just one number.
//   2. The N comps the engine actually used in its derivation, each with a
//      one-line "why included" sentence sourced from matchReasons +
//      pricePerSqft + distance. This is the "show your work" spine of the
//      Pack — same data the buildPack() picker uses.
//   3. The comps that were in the raw pool but did NOT make the engine's
//      selection, with a one-line "why excluded" derived from missReasons
//      (when scored) or a generic "outside the top N for this subject"
//      fallback (when the comp never made it past initial filtering).
//
// Why this exists: §16.U complaints documented that investors couldn't
// tell why two comp tables on the same page disagreed (Reality Check
// median vs derived value). The Explainer makes the engine's filtering
// observable so they can challenge specific exclusions instead of
// distrusting the whole tab.
// ---------------------------------------------------------------------------

import type { ComparablesAnalysis, ScoredComp } from "@/lib/comparables";
import type { Comp, CompsResult } from "@/lib/comps";
import { formatCurrency } from "@/lib/calculations";

export default function CompReasoningPanel({
  comps,
  comparables,
}: {
  comps: CompsResult;
  comparables: ComparablesAnalysis | null;
}) {
  if (!comparables) return null;

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6">
      <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        Comp reasoning
      </div>
      <h2 className="text-base font-semibold text-zinc-100">
        Why these comps shaped the verdict
      </h2>
      <p className="mt-1 text-sm text-zinc-400">
        The engine doesn&apos;t average every nearby listing — it scores
        each comp on bed/bath match, distance, recency, and unit-size
        proximity, then takes the top N. Below is the actual selection.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PoolColumn
          title="Sale comp selection"
          rawPool={comps.saleComps.items}
          derivation={comparables.marketValue}
          unit="sale"
          radius={comps.radiusMilesUsed}
        />
        <PoolColumn
          title="Rent comp selection"
          rawPool={comps.rentComps.items}
          derivation={comparables.marketRent}
          unit="rent"
          radius={comps.radiusMilesUsed}
        />
      </div>
    </section>
  );
}

function PoolColumn({
  title,
  rawPool,
  derivation,
  unit,
  radius,
}: {
  title: string;
  rawPool: Comp[];
  derivation: NonNullable<ComparablesAnalysis["marketValue"]> | null;
  unit: "sale" | "rent";
  radius: number;
}) {
  const used: ScoredComp[] = derivation?.compsUsed ?? [];
  const usedByAddress = new Set(used.map((c) => c.address));
  const excluded = rawPool.filter((c) => !usedByAddress.has(c.address));

  const p25 = derivation?.p25;
  const p75 = derivation?.p75;
  const median = derivation?.medianAbsolute;
  const perSqft = derivation?.medianPerSqft;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <div className="mt-0.5 text-xs text-zinc-500">
          {derivation
            ? `${used.length} used of ${derivation.totalAvailable} available within ${derivation.radiusMilesUsed}mi · confidence ${derivation.confidence}`
            : `${rawPool.length} in raw pool within ${radius}mi · engine couldn't derive a value`}
        </div>
      </div>

      {derivation && median && p25 && p75 && (
        <div className="grid grid-cols-3 gap-2 rounded-md border border-zinc-800/60 bg-zinc-950/50 p-3 text-center text-xs">
          <BandCell label="25th" value={formatCurrency(p25, 0)} unit={unit} />
          <BandCell
            label="Median"
            value={formatCurrency(median, 0)}
            unit={unit}
            strong
          />
          <BandCell label="75th" value={formatCurrency(p75, 0)} unit={unit} />
          {perSqft && (
            <div className="col-span-3 mt-1 text-[10px] uppercase tracking-wider text-zinc-500">
              {unit === "sale"
                ? `Median $/sqft: $${perSqft.toFixed(0)}`
                : `Median rent $/sqft/mo: $${perSqft.toFixed(2)}`}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
          Used in the derivation
        </div>
        {used.length === 0 ? (
          <p className="text-xs text-zinc-500">
            None of the {rawPool.length} raw comps cleared the scoring
            threshold for this subject.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {used.map((c, i) => (
              <li
                key={`${c.address}-${i}`}
                className="rounded-md border border-emerald-900/40 bg-emerald-950/20 p-3 text-xs"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-zinc-100 truncate">
                    {c.address}
                  </div>
                  <div className="font-mono tabular-nums text-zinc-200">
                    {c.price ? formatCurrency(c.price, 0) : "—"}
                    {unit === "rent" && c.price ? "/mo" : ""}
                  </div>
                </div>
                <div className="mt-1 text-zinc-400">
                  {buildIncludedWhy(c, unit)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {excluded.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-zinc-500 transition hover:text-zinc-300">
            Excluded by the scorer ({excluded.length})
            <span className="ml-1 text-zinc-600 group-open:hidden">
              ▸ show why
            </span>
            <span className="ml-1 hidden text-zinc-600 group-open:inline">
              ▾ hide
            </span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {excluded.slice(0, 8).map((c, i) => (
              <li
                key={`${c.address}-${i}`}
                className="rounded border border-zinc-800/60 bg-zinc-950/40 p-2 text-xs text-zinc-400"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="truncate font-medium text-zinc-300">
                    {c.address}
                  </div>
                  <div className="font-mono tabular-nums text-zinc-400">
                    {c.price ? formatCurrency(c.price, 0) : "—"}
                  </div>
                </div>
                <div className="mt-0.5 text-zinc-500">
                  {buildExcludedWhy(c)}
                </div>
              </li>
            ))}
            {excluded.length > 8 && (
              <li className="text-[10px] text-zinc-600">
                + {excluded.length - 8} more not shown
              </li>
            )}
          </ul>
        </details>
      )}

      {derivation && derivation.workLog.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-zinc-500 transition hover:text-zinc-300">
            Engine work log
            <span className="ml-1 text-zinc-600 group-open:hidden">
              ▸ show steps
            </span>
            <span className="ml-1 hidden text-zinc-600 group-open:inline">
              ▾ hide
            </span>
          </summary>
          <ul className="mt-2 list-disc pl-4 text-xs text-zinc-400 space-y-1">
            {derivation.workLog.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-comp prose. Same shape as buildPack uses — one source of truth for the
// "why this comp" sentence so the Pack and the Explainer can never drift.
// ---------------------------------------------------------------------------

function buildIncludedWhy(comp: ScoredComp, unit: "sale" | "rent"): string {
  const bits: string[] = [];
  if (comp.matchReasons.length > 0) {
    bits.push(...comp.matchReasons.slice(0, 2));
  }
  if (comp.pricePerSqft) {
    bits.push(
      unit === "sale"
        ? `$${comp.pricePerSqft.toFixed(0)}/sqft`
        : `$${comp.pricePerSqft.toFixed(2)}/sqft/mo`,
    );
  }
  if (comp.distance != null && comp.distance >= 0) {
    bits.push(`${comp.distance.toFixed(1)}mi away`);
  }
  if (comp.daysOnMarket != null && comp.daysOnMarket >= 0) {
    bits.push(
      unit === "sale"
        ? `${comp.daysOnMarket}d on market`
        : `listed ${comp.daysOnMarket}d ago`,
    );
  }
  if (bits.length === 0) {
    return "Cleared all scoring thresholds for this subject.";
  }
  return bits.join(" · ");
}

function buildExcludedWhy(comp: Comp): string {
  // Raw Comps never went through the scorer (no missReasons attached), so
  // we synthesize a quick "why" from the most actionable signals: distance,
  // recency, and obvious size mismatch when the underwriting target sqft
  // is implied. We deliberately keep this short — the engine work log
  // above tells the full story.
  const bits: string[] = [];
  if (comp.distance != null && comp.distance > 1.5) {
    bits.push(`${comp.distance.toFixed(1)}mi away (outside tight radius)`);
  }
  if (
    comp.daysOnMarket != null &&
    typeof comp.daysOnMarket === "number" &&
    comp.daysOnMarket > 180
  ) {
    bits.push(`${comp.daysOnMarket}d on market (stale)`);
  }
  if (comp.squareFootage && comp.squareFootage > 0) {
    bits.push(`${comp.squareFootage} sqft`);
  } else {
    bits.push("missing sqft (can't normalize)");
  }
  if (bits.length === 0) {
    bits.push("Outside the top N for this subject.");
  }
  return bits.join(" · ");
}

function BandCell({
  label,
  value,
  unit,
  strong,
}: {
  label: string;
  value: string;
  unit: "sale" | "rent";
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-zinc-500 uppercase tracking-wider text-[10px]">
        {label}
      </div>
      <div
        className={`font-mono tabular-nums ${
          strong ? "text-zinc-100 font-semibold" : "text-zinc-300"
        }`}
      >
        {value}
        {unit === "rent" ? "/mo" : ""}
      </div>
    </div>
  );
}
