"use client";

import { useState } from "react";
import { type YearProjection, formatCurrency } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// 5-year equity + cumulative cash-flow projection chart.
// Pure SVG — no external charting dependency. Two series:
//   • Equity (grey area + line)   — how much of the property you own over time
//   • Cumulative cash flow (line) — running total of net cash in/out
//
// The accent color is passed in from the page so the cash-flow line ties
// into the verdict tier color.
// ---------------------------------------------------------------------------

const W = 580;
const H = 220;
const PAD = { top: 20, right: 100, bottom: 44, left: 76 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function abbrev(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export default function ProjectionChart({
  projection,
  accentColor,
}: {
  projection: YearProjection[];
  accentColor: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!projection || projection.length < 2) return null;

  const n = projection.length;

  const allY = projection.flatMap((p) => [p.equityEnd, p.cumulativeCashFlow]);
  const yMin = Math.min(0, ...allY);
  const yMax = Math.max(...allY);
  const yRange = yMax - yMin || 1;

  // Pad 8% top so labels don't clip
  const yMinPadded = yMin - yRange * 0.02;
  const yMaxPadded = yMax + yRange * 0.08;
  const yRangePadded = yMaxPadded - yMinPadded;

  const xScale = (i: number) => PAD.left + (i / (n - 1)) * PLOT_W;
  const yScale = (v: number) =>
    PAD.top + ((yMaxPadded - v) / yRangePadded) * PLOT_H;

  const zeroY = yScale(0);

  // Equity area + line
  const equityPts = projection.map((p, i) => [xScale(i), yScale(p.equityEnd)] as [number, number]);
  const equityLinePath = `M ${equityPts.map(([x, y]) => `${x},${y}`).join(" L ")}`;
  const equityAreaPath = `${equityLinePath} L ${equityPts[n - 1][0]},${zeroY} L ${equityPts[0][0]},${zeroY} Z`;

  // Cash flow line
  const cfPts = projection.map((p, i) => [xScale(i), yScale(p.cumulativeCashFlow)] as [number, number]);
  const cfLinePath = `M ${cfPts.map(([x, y]) => `${x},${y}`).join(" L ")}`;

  // Y-axis grid: 4 horizontal lines
  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = yMinPadded + (yRangePadded * i) / gridCount;
    return { y: yScale(v), label: abbrev(v) };
  }).filter((g) => g.y >= PAD.top - 2 && g.y <= PAD.top + PLOT_H + 2);

  const finalEquity = projection[n - 1].equityEnd;
  const finalCF = projection[n - 1].cumulativeCashFlow;
  const cfPositive = finalCF >= 0;

  const hovered = hoverIdx !== null ? projection[hoverIdx] : null;

  return (
    <div className="w-full select-none">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full overflow-visible"
        style={{ height: "auto" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Grid lines */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              y1={g.y}
              x2={PAD.left + PLOT_W}
              y2={g.y}
              stroke="#27272a"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={g.y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fill="#52525b"
            >
              {g.label}
            </text>
          </g>
        ))}

        {/* Zero line (thicker if visible) */}
        {zeroY >= PAD.top && zeroY <= PAD.top + PLOT_H && (
          <line
            x1={PAD.left}
            y1={zeroY}
            x2={PAD.left + PLOT_W}
            y2={zeroY}
            stroke="#3f3f46"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        )}

        {/* Equity area fill */}
        <defs>
          <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3f3f46" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#3f3f46" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={equityAreaPath} fill="url(#equityGrad)" />
        <path
          d={equityLinePath}
          fill="none"
          stroke="#71717a"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Cash flow line */}
        <path
          d={cfLinePath}
          fill="none"
          stroke={cfPositive ? "#22c55e" : "#ef4444"}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* X axis labels */}
        {projection.map((p, i) => (
          <text
            key={p.year}
            x={xScale(i)}
            y={PAD.top + PLOT_H + 18}
            textAnchor="middle"
            fontSize="10"
            fill="#52525b"
          >
            Yr {p.year}
          </text>
        ))}

        {/* End labels */}
        <text
          x={xScale(n - 1) + 8}
          y={equityPts[n - 1][1]}
          dominantBaseline="middle"
          fontSize="10"
          fill="#71717a"
          fontWeight="500"
        >
          {abbrev(finalEquity)}
        </text>
        <text
          x={xScale(n - 1) + 8}
          y={cfPts[n - 1][1]}
          dominantBaseline="middle"
          fontSize="10"
          fill={cfPositive ? "#22c55e" : "#ef4444"}
          fontWeight="600"
        >
          {abbrev(finalCF)}
        </text>

        {/* Hover interaction layer */}
        {projection.map((p, i) => (
          <rect
            key={i}
            x={xScale(i) - PLOT_W / (2 * (n - 1))}
            y={PAD.top}
            width={PLOT_W / (n - 1)}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}

        {/* Hover indicator */}
        {hoverIdx !== null && (
          <g>
            <line
              x1={xScale(hoverIdx)}
              y1={PAD.top}
              x2={xScale(hoverIdx)}
              y2={PAD.top + PLOT_H}
              stroke="#52525b"
              strokeWidth="1"
              strokeDasharray="3 2"
            />
            <circle
              cx={equityPts[hoverIdx][0]}
              cy={equityPts[hoverIdx][1]}
              r="4"
              fill="#71717a"
              stroke="#18181b"
              strokeWidth="2"
            />
            <circle
              cx={cfPts[hoverIdx][0]}
              cy={cfPts[hoverIdx][1]}
              r="4"
              fill={cfPositive ? "#22c55e" : "#ef4444"}
              stroke="#18181b"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {/* Hover tooltip */}
      {hovered && (
        <div className="mt-1 flex items-center gap-5 text-xs text-zinc-400 tabular-nums">
          <span>
            <span className="text-zinc-600">Year {hovered.year}</span>
          </span>
          <span>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-zinc-600" />
            Equity{" "}
            <span className="font-mono font-semibold text-zinc-300">
              {formatCurrency(hovered.equityEnd, 0)}
            </span>
          </span>
          <span>
            <span
              className={`mr-1.5 inline-block h-2 w-2 rounded-full ${cfPositive ? "bg-emerald-500" : "bg-red-500"}`}
            />
            Cumulative cash flow{" "}
            <span
              className={`font-mono font-semibold ${cfPositive ? "text-emerald-400" : "text-red-400"}`}
            >
              {formatCurrency(hovered.cumulativeCashFlow, 0)}
            </span>
          </span>
        </div>
      )}

      {/* Legend */}
      {!hovered && (
        <div className="mt-1 flex items-center gap-5 text-xs text-zinc-600">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-zinc-600" />
            Equity
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${cfPositive ? "bg-emerald-500" : "bg-red-500"}`}
            />
            Cumulative cash flow
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-px w-4 border-t border-dashed border-zinc-600" />
            Break-even
          </span>
        </div>
      )}
    </div>
  );
}
