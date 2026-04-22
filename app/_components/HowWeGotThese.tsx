import type {
  ComparablesAnalysis,
  Derivation,
  ScoredComp,
} from "@/lib/comparables";

// ---------------------------------------------------------------------------
// HowWeGotThese — the "show your work" panel.
//
// Top of the /results page. Lays out:
//   - Subject property card (address, beds, baths, sqft, year, price, $/sqft)
//   - Market value derivation: median $/sqft of comps × subject sqft
//   - Market rent derivation: median $/sqft of rent comps × subject sqft
//   - Every comp used (sortable table: address, beds/baths, sqft, price, $/sqft, distance, match score)
//
// Design goal: when a real investor sees this panel they can say "yep, those
// are the right comps and the math checks out" — or "no, comp #3 is a burnout,
// I'll drop it and re-run". Transparency IS the product.
// ---------------------------------------------------------------------------

type Props = {
  comparables: ComparablesAnalysis | null;
  subjectPrice: number;
  subjectRent: number;
};

const fmtUSD0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const fmtUSD2 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);

export default function HowWeGotThese({
  comparables,
  subjectPrice,
  subjectRent,
}: Props) {
  if (!comparables) return null;

  const { subject, marketValue, marketRent } = comparables;
  const hasAnyDerivation = marketValue || marketRent;
  if (!hasAnyDerivation) return null;

  // Compute the subject's $/sqft against comps so the user can eyeball whether
  // this property is priced above, at, or below the market band.
  const subjectPPSF =
    subject.sqft && subject.sqft > 0 && subjectPrice > 0
      ? subjectPrice / subject.sqft
      : undefined;
  const subjectRentPSF =
    subject.sqft && subject.sqft > 0 && subjectRent > 0
      ? subjectRent / subject.sqft
      : undefined;

  return (
    <section className="mb-6 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-100 sm:text-xl">
          How we got these numbers
        </h2>
        <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          Median $/sqft × subject sqft
        </span>
      </header>

      {/* Subject card */}
      <div className="mb-5 rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          Subject property
        </div>
        <div className="text-[15px] font-medium text-zinc-100">{subject.address || "—"}</div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-300">
          {subject.beds ? (
            <Stat label="Beds" value={String(subject.beds)} />
          ) : null}
          {subject.baths ? (
            <Stat label="Baths" value={String(subject.baths)} />
          ) : null}
          {subject.sqft ? (
            <Stat label="Sqft" value={subject.sqft.toLocaleString()} />
          ) : null}
          {subject.yearBuilt ? (
            <Stat label="Year" value={String(subject.yearBuilt)} />
          ) : null}
          {subjectPrice > 0 ? (
            <Stat label="Price" value={fmtUSD0(subjectPrice)} />
          ) : null}
          {subjectPPSF ? (
            <Stat label="$/sqft" value={fmtUSD0(subjectPPSF)} />
          ) : null}
          {subjectRent > 0 ? (
            <Stat label="Rent" value={`${fmtUSD0(subjectRent)}/mo`} />
          ) : null}
          {subjectRentPSF ? (
            <Stat
              label="Rent/sqft"
              value={`${fmtUSD2(subjectRentPSF)}/mo`}
            />
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {marketValue ? (
          <DerivationCard
            title="Fair value (from sale comps)"
            subjectCurrent={subjectPrice}
            derivation={marketValue}
            unit="$"
          />
        ) : (
          <EmptyDerivation title="Fair value" reason="No usable sale comps nearby." />
        )}
        {marketRent ? (
          <DerivationCard
            title="Market rent (from rental comps)"
            subjectCurrent={subjectRent}
            derivation={marketRent}
            unit="$/mo"
            perSqftUnit="$/sqft/mo"
          />
        ) : (
          <EmptyDerivation title="Market rent" reason="No usable rent comps nearby." />
        )}
      </div>

      {/* Comps tables */}
      {marketValue && marketValue.compsUsed.length > 0 ? (
        <CompsTable
          title={`Sale comps used (${marketValue.compsUsed.length})`}
          comps={marketValue.compsUsed}
          kind="sale"
        />
      ) : null}
      {marketRent && marketRent.compsUsed.length > 0 ? (
        <CompsTable
          title={`Rent comps used (${marketRent.compsUsed.length})`}
          comps={marketRent.compsUsed}
          kind="rent"
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">
        {label}
      </span>
      <span className="font-medium text-zinc-100">{value}</span>
    </div>
  );
}

function DerivationCard({
  title,
  subjectCurrent,
  derivation,
  unit,
  perSqftUnit,
}: {
  title: string;
  subjectCurrent: number;
  derivation: Derivation;
  unit: "$" | "$/mo";
  perSqftUnit?: string;
}) {
  const rounded =
    unit === "$/mo"
      ? Math.round(derivation.value / 10) * 10
      : Math.round(derivation.value / 1000) * 1000;
  const displayValue = unit === "$/mo" ? `${fmtUSD0(rounded)}/mo` : fmtUSD0(rounded);
  const subjectVsComp =
    subjectCurrent > 0 && derivation.value > 0
      ? (subjectCurrent - derivation.value) / derivation.value
      : null;

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-zinc-100">{displayValue}</div>
        <ConfidenceDot confidence={derivation.confidence} />
      </div>
      {derivation.p25 && derivation.p75 ? (
        <div className="mt-1 text-xs text-zinc-500">
          Comp band: {unit === "$/mo"
            ? `${fmtUSD0(derivation.p25)} – ${fmtUSD0(derivation.p75)}/mo`
            : `${fmtUSD0(derivation.p25)} – ${fmtUSD0(derivation.p75)}`}
        </div>
      ) : null}

      {/* The math, step by step. */}
      <ol className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-zinc-300">
        {derivation.workLog.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="select-none text-zinc-600">{i + 1}.</span>
            <span>{line}</span>
          </li>
        ))}
      </ol>

      {subjectVsComp !== null && Math.abs(subjectVsComp) >= 0.08 ? (
        // Framing matters here. When the derivation is HIGH confidence AND
        // the subject is priced below/above the comp-derived value, that
        // signal is real. When confidence is medium/low, a raw "X% below
        // comp median" line is misleading — it implies a bargain when in
        // reality the comp pool may be mistyped (SFR comps on a condo-style
        // townhouse) or too thin. In those cases, show a neutral caveat
        // instead of a green/amber signal.
        derivation.confidence === "high" ? (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-xs ${
              subjectVsComp > 0
                ? "border-amber-500/40 bg-amber-500/5 text-amber-200"
                : "border-emerald-500/40 bg-emerald-500/5 text-emerald-200"
            }`}
          >
            Your number is{" "}
            <span className="font-semibold">
              {(Math.abs(subjectVsComp) * 100).toFixed(0)}%{" "}
              {subjectVsComp > 0 ? "above" : "below"}
            </span>{" "}
            the comp median
            {perSqftUnit && derivation.medianPerSqft
              ? ` (comps say ${fmtUSD2(derivation.medianPerSqft)} ${perSqftUnit})`
              : ""}
            .
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-zinc-700/60 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
            Subject is{" "}
            <span className="font-semibold text-zinc-300">
              {(Math.abs(subjectVsComp) * 100).toFixed(0)}%{" "}
              {subjectVsComp > 0 ? "above" : "below"}
            </span>{" "}
            comp-derived value — but this derivation is{" "}
            <span className="font-semibold text-zinc-300">
              {derivation.confidence} confidence
            </span>
            . Check the comp list below: if they&apos;re a different property type
            or wrong size, the gap is explained by the pool, not by the deal.
          </div>
        )
      ) : null}
    </div>
  );
}

function EmptyDerivation({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </div>
      <div className="text-sm text-zinc-400">{reason}</div>
    </div>
  );
}

function ConfidenceDot({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const label =
    confidence === "high"
      ? "high confidence"
      : confidence === "medium"
        ? "medium confidence"
        : "low confidence";
  const color =
    confidence === "high"
      ? "bg-emerald-400"
      : confidence === "medium"
        ? "bg-sky-400"
        : "bg-amber-400";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-zinc-500"
      title={label}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />
      {confidence}
    </span>
  );
}

// ---------------------------------------------------------------------------

function CompsTable({
  title,
  comps,
  kind,
}: {
  title: string;
  comps: ScoredComp[];
  kind: "sale" | "rent";
}) {
  return (
    <details className="mt-5 rounded-xl border border-zinc-800/60 bg-zinc-950/40">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-200 transition hover:text-zinc-50">
        {title}
        <span className="ml-2 text-xs font-normal text-zinc-500">
          (click to expand)
        </span>
      </summary>
      <div className="overflow-x-auto border-t border-zinc-800/60">
        <table className="w-full text-[13px]">
          <thead className="bg-zinc-950/60 text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Address</th>
              <th className="px-3 py-2 text-right font-medium">Bd/Ba</th>
              <th className="px-3 py-2 text-right font-medium">Sqft</th>
              <th className="px-3 py-2 text-right font-medium">
                {kind === "sale" ? "Price" : "Rent"}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {kind === "sale" ? "$/sqft" : "$/sqft/mo"}
              </th>
              <th className="px-3 py-2 text-right font-medium">Dist</th>
              <th className="px-3 py-2 text-right font-medium">Match</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {comps.map((c, i) => (
              <tr
                key={c.id ?? `${c.address}-${i}`}
                className="border-t border-zinc-800/40"
              >
                <td className="px-3 py-2 text-zinc-200">{c.address}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.bedrooms ?? "—"}/{c.bathrooms ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.squareFootage ? c.squareFootage.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.price ? fmtUSD0(c.price) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.pricePerSqft
                    ? kind === "sale"
                      ? fmtUSD0(c.pricePerSqft)
                      : fmtUSD2(c.pricePerSqft)
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {typeof c.distance === "number" ? `${c.distance.toFixed(2)}mi` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <ScorePill score={c.score} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "bg-emerald-500/15 text-emerald-300"
      : score >= 65
        ? "bg-sky-500/15 text-sky-300"
        : score >= 45
          ? "bg-amber-500/15 text-amber-300"
          : "bg-zinc-700/30 text-zinc-400";
  return (
    <span
      className={`inline-flex min-w-[2.5rem] justify-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {Math.round(score)}
    </span>
  );
}
