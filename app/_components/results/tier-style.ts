import type { CSSProperties } from "react";
import type { VerdictTier } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// Shared UI constants for the /results page. Kept in one module so the
// hero / evidence / breakdown / comps sections render consistent accents
// without each file redefining them.
//
// Note: OfferCeilingCard has its own TIER_LABEL + TIER_DOT tables — left
// as-is. The card's palette is deliberately dimmer (it harmonizes against
// the page's --accent CSS variable rather than setting the tier color
// outright) and reusing the same constants here would regress that.
// ---------------------------------------------------------------------------

export const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "STRONG BUY",
  good: "GOOD DEAL",
  fair: "BORDERLINE",
  poor: "PASS",
  avoid: "AVOID",
};

export const TIER_ACCENT: Record<VerdictTier, string> = {
  excellent: "#22c55e",
  good: "#22c55e",
  fair: "#eab308",
  poor: "#ef4444",
  avoid: "#ef4444",
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
