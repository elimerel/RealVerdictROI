"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  analyseDeal,
  formatCurrency,
  formatPercent,
  inputsToSearchParams,
  sanitiseInputs,
  type DealAnalysis,
  type DealInputs,
  type VerdictTier,
} from "@/lib/calculations";

const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "STRONG BUY",
  good: "GOOD DEAL",
  fair: "BORDERLINE",
  poor: "PASS",
  avoid: "AVOID",
};

type Knob = {
  key: keyof DealInputs;
  label: string;
  min: (base: number) => number;
  max: (base: number) => number;
  step: number;
  format: (value: number, base: number) => string;
};

const KNOBS: Knob[] = [
  {
    key: "purchasePrice",
    label: "Purchase price",
    min: (base) => Math.round(base * 0.7),
    max: (base) => Math.round(base * 1.15),
    step: 1_000,
    format: (v, base) => `${formatCurrency(v, 0)} (${pct(v, base)})`,
  },
  {
    key: "loanInterestRate",
    label: "Interest rate",
    min: () => 2,
    max: () => 12,
    step: 0.125,
    format: (v) => `${v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`,
  },
  {
    key: "downPaymentPercent",
    label: "Down payment",
    min: () => 5,
    max: () => 50,
    step: 1,
    format: (v) => `${v.toFixed(0)}%`,
  },
  {
    key: "monthlyRent",
    label: "Monthly rent",
    min: (base) => Math.round(base * 0.7),
    max: (base) => Math.round(base * 1.3),
    step: 25,
    format: (v, base) => `${formatCurrency(v, 0)}/mo (${pct(v, base)})`,
  },
  {
    key: "vacancyRatePercent",
    label: "Vacancy rate",
    min: () => 0,
    max: () => 30,
    step: 1,
    format: (v) => `${v.toFixed(0)}%`,
  },
];

function pct(value: number, base: number): string {
  if (base === 0) return "—";
  const delta = ((value - base) / base) * 100;
  if (Math.abs(delta) < 0.05) return "no change";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}% vs original`;
}

export default function WhatIfPanel({
  baseInputs,
  baseAnalysis,
  address,
}: {
  baseInputs: DealInputs;
  baseAnalysis: DealAnalysis;
  address?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DealInputs>(baseInputs);

  const draftAnalysis = useMemo(() => {
    try {
      return analyseDeal(sanitiseInputs(draft));
    } catch {
      return null;
    }
  }, [draft]);

  const reset = () => setDraft(baseInputs);

  const applyAsNewVerdict = () => {
    const params = inputsToSearchParams(sanitiseInputs(draft));
    if (address) params.set("address", address);
    router.push(`/results?${params.toString()}`);
  };

  const isDirty = KNOBS.some((k) => draft[k.key] !== baseInputs[k.key]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
            What-if
          </div>
          <h2 className="mt-1 text-2xl font-semibold text-zinc-100 sm:text-3xl">
            Move the numbers. See the verdict change.
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Drag a slider — every metric below recomputes instantly using the
            same engine that produced the original verdict.
          </p>
        </div>
        {isDirty && (
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
          >
            Reset to original
          </button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {KNOBS.map((knob) => {
          const base = baseInputs[knob.key];
          const value = draft[knob.key];
          const min = knob.min(base);
          const max = knob.max(base);
          return (
            <div key={knob.key} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <label
                  htmlFor={`whatif-${knob.key}`}
                  className="text-xs font-medium text-zinc-400"
                >
                  {knob.label}
                </label>
                <span
                  className="font-mono text-xs tabular-nums text-zinc-200"
                  style={{
                    color: value !== base ? "var(--accent)" : undefined,
                  }}
                >
                  {knob.format(value, base)}
                </span>
              </div>
              <input
                id={`whatif-${knob.key}`}
                type="range"
                min={min}
                max={max}
                step={knob.step}
                value={value}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    [knob.key]: Number(e.target.value),
                  }))
                }
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-[var(--accent)]"
                style={{ accentColor: "var(--accent)" }}
              />
            </div>
          );
        })}
      </div>

      {draftAnalysis && (
        <DeltaGrid base={baseAnalysis} draft={draftAnalysis} />
      )}

      {isDirty && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={applyAsNewVerdict}
            style={{ backgroundColor: "var(--accent)" }}
            className="rounded-md px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
          >
            Run a fresh verdict on these numbers →
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-100"
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function DeltaGrid({
  base,
  draft,
}: {
  base: DealAnalysis;
  draft: DealAnalysis;
}) {
  const rows: Array<{
    label: string;
    base: string;
    draft: string;
    delta: string;
    deltaTone: "good" | "bad" | "neutral";
  }> = [
    moneyRow("Monthly cash flow", base.monthlyCashFlow, draft.monthlyCashFlow, true),
    pctRow("Cap rate", base.capRate, draft.capRate, true),
    pctRow("Cash-on-cash", base.cashOnCashReturn, draft.cashOnCashReturn, true),
    dscrRow("DSCR", base.dscr, draft.dscr),
    pctRow("IRR (hold period)", base.irr, draft.irr, true),
    pctRow("Total ROI", base.totalROI, draft.totalROI, true),
    pctRow(
      "Break-even occupancy",
      base.breakEvenOccupancy,
      draft.breakEvenOccupancy,
      false,
    ),
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr_1fr] divide-y divide-zinc-800 sm:divide-y-0 sm:divide-x">
        <HeaderCell>Metric</HeaderCell>
        <HeaderCell align="right">Original</HeaderCell>
        <HeaderCell align="right">What-if</HeaderCell>
        <HeaderCell align="right">Δ</HeaderCell>
      </div>
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr_1fr] divide-y divide-zinc-800 border-t border-zinc-800 sm:divide-y-0 sm:divide-x"
        >
          <Cell>{row.label}</Cell>
          <Cell align="right" mono className="text-zinc-400">
            {row.base}
          </Cell>
          <Cell align="right" mono className="text-zinc-100 font-semibold">
            {row.draft}
          </Cell>
          <Cell align="right" mono className={tone(row.deltaTone)}>
            {row.delta}
          </Cell>
        </div>
      ))}
      <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr_1fr] border-t border-zinc-800 divide-y divide-zinc-800 sm:divide-y-0 sm:divide-x bg-zinc-900/40">
        <Cell>
          <span className="text-xs uppercase tracking-wider text-zinc-500">
            Verdict
          </span>
        </Cell>
        <Cell align="right" className="text-xs font-bold uppercase tracking-wider text-zinc-500">
          {TIER_LABEL[base.verdict.tier]}
        </Cell>
        <Cell
          align="right"
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: "var(--accent)" }}
        >
          {TIER_LABEL[draft.verdict.tier]}
        </Cell>
        <Cell align="right" className={tone(verdictTone(base.verdict.tier, draft.verdict.tier))}>
          {verdictDelta(base.verdict.tier, draft.verdict.tier)}
        </Cell>
      </div>
    </div>
  );
}

function HeaderCell({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div
      className={`px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </div>
  );
}

function Cell({
  children,
  align = "left",
  mono = false,
  className = "",
  style,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`px-4 py-3 text-sm ${align === "right" ? "text-right" : ""} ${
        mono ? "font-mono tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

function tone(t: "good" | "bad" | "neutral"): string {
  if (t === "good") return "text-emerald-400";
  if (t === "bad") return "text-red-400";
  return "text-zinc-500";
}

// ---------------------------------------------------------------------------
// Row builders

function moneyRow(
  label: string,
  base: number,
  draft: number,
  higherIsBetter: boolean,
) {
  const delta = draft - base;
  return {
    label,
    base: formatCurrency(base, 0),
    draft: formatCurrency(draft, 0),
    delta: formatDelta(delta, (n) => formatCurrency(Math.abs(n), 0)),
    deltaTone: deltaTone(delta, higherIsBetter),
  };
}

function pctRow(
  label: string,
  base: number,
  draft: number,
  higherIsBetter: boolean,
) {
  const validBase = isFinite(base);
  const validDraft = isFinite(draft);
  const delta = validBase && validDraft ? draft - base : 0;
  return {
    label,
    base: validBase ? formatPercent(base, 2) : "—",
    draft: validDraft ? formatPercent(draft, 2) : "—",
    delta:
      validBase && validDraft
        ? formatDelta(delta * 100, (n) => `${Math.abs(n).toFixed(2)}pt`)
        : "—",
    deltaTone:
      validBase && validDraft ? deltaTone(delta, higherIsBetter) : "neutral",
  };
}

function dscrRow(label: string, base: number, draft: number) {
  const baseStr = isFinite(base) ? base.toFixed(2) : "∞";
  const draftStr = isFinite(draft) ? draft.toFixed(2) : "∞";
  const delta = isFinite(base) && isFinite(draft) ? draft - base : 0;
  return {
    label,
    base: baseStr,
    draft: draftStr,
    delta:
      isFinite(base) && isFinite(draft)
        ? formatDelta(delta, (n) => Math.abs(n).toFixed(2))
        : "—",
    deltaTone: deltaTone(delta, true),
  };
}

function formatDelta(delta: number, fmt: (n: number) => string): string {
  if (Math.abs(delta) < 0.005) return "—";
  return delta > 0 ? `+${fmt(delta)}` : `−${fmt(delta)}`;
}

function deltaTone(
  delta: number,
  higherIsBetter: boolean,
): "good" | "bad" | "neutral" {
  if (Math.abs(delta) < 0.005) return "neutral";
  const isUp = delta > 0;
  if (higherIsBetter) return isUp ? "good" : "bad";
  return isUp ? "bad" : "good";
}

const TIER_RANK: Record<VerdictTier, number> = {
  avoid: 0,
  poor: 1,
  fair: 2,
  good: 3,
  excellent: 4,
};

function verdictTone(
  base: VerdictTier,
  draft: VerdictTier,
): "good" | "bad" | "neutral" {
  if (TIER_RANK[draft] > TIER_RANK[base]) return "good";
  if (TIER_RANK[draft] < TIER_RANK[base]) return "bad";
  return "neutral";
}

function verdictDelta(base: VerdictTier, draft: VerdictTier): string {
  const diff = TIER_RANK[draft] - TIER_RANK[base];
  if (diff === 0) return "—";
  return diff > 0 ? `+${diff} tier${diff === 1 ? "" : "s"}` : `${diff} tier${diff === -1 ? "" : "s"}`;
}
