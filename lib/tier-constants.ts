import type { VerdictTier } from "./calculations";

// ---------------------------------------------------------------------------
// Single source of truth for verdict-tier display constants.
//
// Every component or module that maps a VerdictTier to a label or color
// must import from here — not redefine locally. This prevents the palette
// drifting across StressTestPanel, OfferCeilingCard, OG image, negotiation
// pack, and the results hero as the product evolves.
//
// TIER_COLOR in pack-pdf.tsx is intentionally separate: the PDF uses a
// print-safe dark palette that has nothing to do with the web accent colors.
// ---------------------------------------------------------------------------

export const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "STRONG BUY",
  good: "GOOD DEAL",
  fair: "BORDERLINE",
  poor: "PASS",
  avoid: "AVOID",
};

/** Hex accent colors — for inline `style` props and CSS variables. */
export const TIER_ACCENT: Record<VerdictTier, string> = {
  excellent: "#22c55e",
  good: "#22c55e",
  fair: "#eab308",
  poor: "#ef4444",
  avoid: "#ef4444",
};

/** Tailwind text-color classes for dark backgrounds (results, dashboard). */
export const TIER_TAILWIND_TEXT: Record<VerdictTier, string> = {
  excellent: "text-emerald-400",
  good: "text-emerald-400",
  fair: "text-amber-400",
  poor: "text-red-400",
  avoid: "text-red-400",
};

/** Tailwind text-color classes for light backgrounds (home page, pricing). */
export const TIER_TAILWIND_TEXT_LIGHT: Record<VerdictTier, string> = {
  excellent: "text-emerald-600",
  good: "text-emerald-600",
  fair: "text-amber-600",
  poor: "text-red-600",
  avoid: "text-red-600",
};
