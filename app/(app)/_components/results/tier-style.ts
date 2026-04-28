import type { CSSProperties } from "react";
import type { VerdictTier } from "@/lib/calculations";
export { TIER_ACCENT } from "@/lib/tier-constants";

/**
 * User-facing badge labels for verdict tiers — used on deal cards and badges.
 * Intentionally friendlier than the internal TIER_LABEL in lib/tier-constants.ts
 * (which uses ALL-CAPS analyst shorthand like BORDERLINE / PASS).
 */
export const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "Strong Buy",
  good: "Good Deal",
  fair: "Fair",
  poor: "Risky",
  avoid: "Walk Away",
};

export const WARN_COLOR = "#eab308";
export const BAD_COLOR = "#ef4444";

export type Tone = "good" | "warn" | "bad" | "neutral";

/** Map a tone token to inline CSS color. Used by MetricValue + table rows. */
export function toneToStyle(tone: Tone): CSSProperties {
  switch (tone) {
    case "good":
      return { color: "var(--accent)" };
    case "warn":
      return { color: WARN_COLOR };
    case "bad":
      return { color: BAD_COLOR };
    default:
      return {};
  }
}

export function toneCoC(v: number): Tone {
  if (v >= 0.08) return "good";
  if (v >= 0.04) return "warn";
  if (v < 0) return "bad";
  return "neutral";
}

export function toneCap(v: number): Tone {
  if (v >= 0.06) return "good";
  if (v >= 0.04) return "warn";
  if (v < 0.03) return "bad";
  return "neutral";
}

export function toneDSCR(v: number): Tone {
  if (!isFinite(v)) return "good";
  if (v >= 1.25) return "good";
  if (v >= 1.0) return "warn";
  return "bad";
}

export function toneBreakEven(v: number): Tone {
  if (v <= 0.75) return "good";
  if (v <= 0.9) return "warn";
  return "bad";
}

export function toneGRM(v: number): Tone {
  if (v <= 0) return "neutral";
  if (v <= 12) return "good";
  if (v <= 18) return "warn";
  return "bad";
}
