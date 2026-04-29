"use client";

import { cn } from "@/lib/utils";
import type { FieldProvenance } from "@/lib/types";

// ---------------------------------------------------------------------------
// Confidence dot colors
// ---------------------------------------------------------------------------

const CONFIDENCE_DOT: Record<"high" | "medium" | "low", string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-400",
  low: "bg-red-400/80",
};

const CONFIDENCE_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "Verified data",
  medium: "Estimated",
  low: "Assumed default",
};

// ---------------------------------------------------------------------------
// Tooltip (pure CSS — no external deps)
// ---------------------------------------------------------------------------

function ProvenanceTooltip({ provenance }: { provenance: FieldProvenance }) {
  const note = provenance.note ?? provenance.tooltip;
  const label = CONFIDENCE_LABEL[provenance.confidence];
  const text = [label, note ? `— ${note}` : "", `(${provenance.source})`]
    .filter(Boolean)
    .join(" ");

  return (
    <span className="group relative inline-flex items-center">
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full shrink-0 cursor-help",
          CONFIDENCE_DOT[provenance.confidence],
        )}
        aria-label={text}
      />
      {/* Tooltip bubble */}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 hidden group-hover:block">
        <span className="block max-w-[240px] whitespace-normal rounded bg-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-200 shadow-lg ring-1 ring-zinc-700">
          {text}
        </span>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// AnnotatedValue
// ---------------------------------------------------------------------------

/**
 * Wraps a formatted value with an optional confidence indicator dot.
 *
 * The dot is only shown when `provenance` is provided AND confidence is
 * not "high" (i.e. the value is estimated or defaulted). High-confidence
 * values are shown without any indicator so the UI stays clean.
 *
 * Usage:
 *   <AnnotatedValue value="$2,600/mo" provenance={annotated.monthlyRent.provenance} />
 */
export default function AnnotatedValue({
  value,
  provenance,
  className,
}: {
  value: React.ReactNode;
  provenance?: FieldProvenance | null;
  className?: string;
}) {
  const showDot = provenance && provenance.confidence !== "high";

  return (
    <span className={cn("inline-flex items-baseline gap-1", className)}>
      <span>{value}</span>
      {showDot && (
        <span className="self-center">
          <ProvenanceTooltip provenance={provenance} />
        </span>
      )}
    </span>
  );
}
