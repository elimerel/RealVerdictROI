/**
 * Annotated inputs — each field in DealInputs paired with its provenance.
 *
 * The calculation engine (`analyseDeal`) always receives plain `DealInputs`
 * (the `.value` of every field). `AnnotatedInputs` is a parallel structure
 * that travels alongside inputs and is consumed by:
 *
 *  - The distribution engine (`lib/distribution-engine.ts`), which maps
 *    confidence levels to uncertainty spreads and samples scenarios.
 *  - The UI, which shows confidence indicators next to metrics derived from
 *    low-confidence inputs.
 *  - The narrative layer, which reports which inputs drove the verdict.
 */

import type { FieldProvenance, ConfidenceLevel } from "./types";
import type { DealInputs } from "./calculations";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type AnnotatedField<T> = {
  value: T;
  provenance: FieldProvenance;
};

export type AnnotatedInputs = {
  [K in keyof DealInputs]: AnnotatedField<DealInputs[K]>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PROVENANCE: FieldProvenance = {
  source: "default",
  confidence: "low",
  note: "Default value — update with actual property data for a reliable verdict.",
};

/**
 * Wrap every field in DealInputs with default (low-confidence) provenance.
 * Used as the starting point before overlaying extracted / resolved data.
 */
export function annotateWithDefaults(inputs: DealInputs): AnnotatedInputs {
  const result: Partial<AnnotatedInputs> = {};
  for (const key of Object.keys(inputs) as (keyof DealInputs)[]) {
    result[key] = {
      value: inputs[key],
      provenance: DEFAULT_PROVENANCE,
    } as AnnotatedField<DealInputs[typeof key]>;
  }
  return result as AnnotatedInputs;
}

/**
 * Strip provenance and return plain `DealInputs` for the calculation kernel.
 * This is the only function that should be called when handing off to
 * `analyseDeal` — everything else should work with AnnotatedInputs.
 */
export function toPlainInputs(annotated: AnnotatedInputs): DealInputs {
  const result: Partial<DealInputs> = {};
  for (const key of Object.keys(annotated) as (keyof DealInputs)[]) {
    result[key] = annotated[key].value as DealInputs[typeof key];
  }
  return result as DealInputs;
}

/**
 * Merge provenance overrides from a resolved/extracted payload into a base
 * AnnotatedInputs. Override wins for every key present in `overrides`.
 * Fields absent from `overrides` keep the base provenance.
 */
export function mergeAnnotated(
  base: AnnotatedInputs,
  overrides: Partial<Record<keyof DealInputs, AnnotatedField<number>>>,
): AnnotatedInputs {
  return { ...base, ...overrides } as AnnotatedInputs;
}

/**
 * Build AnnotatedInputs from a plain `DealInputs` and a provenance map.
 * This is the client-side bridge: the resolver already returns
 * `provenance: Partial<Record<keyof DealInputs, FieldProvenance>>` on its
 * response — pass that in here alongside the merged inputs.
 */
export function annotateFromProvenance(
  inputs: DealInputs,
  provenance: Partial<Record<keyof DealInputs, FieldProvenance>>,
): AnnotatedInputs {
  const result: Partial<AnnotatedInputs> = {};
  for (const key of Object.keys(inputs) as (keyof DealInputs)[]) {
    result[key] = {
      value: inputs[key],
      provenance: provenance[key] ?? DEFAULT_PROVENANCE,
    } as AnnotatedField<DealInputs[typeof key]>;
  }
  return result as AnnotatedInputs;
}

/**
 * Return the worst confidence level across all annotated inputs.
 * Used to summarise "how confident is this verdict overall?"
 */
export function worstConfidence(annotated: AnnotatedInputs): ConfidenceLevel {
  const rank: Record<ConfidenceLevel, number> = { high: 2, medium: 1, low: 0 };
  let worst: ConfidenceLevel = "high";
  for (const key of Object.keys(annotated) as (keyof DealInputs)[]) {
    const conf = annotated[key].provenance.confidence;
    if (rank[conf] < rank[worst]) worst = conf;
  }
  return worst;
}

/**
 * Return the fields with the lowest confidence — used in narrative prompts
 * to tell Claude which inputs are weakest so it can mention them.
 */
export function lowConfidenceFields(
  annotated: AnnotatedInputs,
  threshold: ConfidenceLevel = "medium",
): Array<{ field: keyof DealInputs; provenance: FieldProvenance }> {
  const rank: Record<ConfidenceLevel, number> = { high: 2, medium: 1, low: 0 };
  const threshRank = rank[threshold];
  const out: Array<{ field: keyof DealInputs; provenance: FieldProvenance }> = [];
  for (const key of Object.keys(annotated) as (keyof DealInputs)[]) {
    const prov = annotated[key].provenance;
    if (rank[prov.confidence] <= threshRank) {
      out.push({ field: key, provenance: prov });
    }
  }
  return out;
}
