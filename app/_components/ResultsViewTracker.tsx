"use client";

import { useEffect } from "react";
import type { VerdictTier } from "@/lib/calculations";
import { trackEvent } from "./Analytics";

// ---------------------------------------------------------------------------
// Fires a single "Results Viewed" event when the /results page mounts. We do
// this in a dedicated client island so the page itself stays a server
// component and the analytics code is small and tree-shakable.
// ---------------------------------------------------------------------------

export default function ResultsViewTracker({
  tier,
  priceBucket,
  source,
}: {
  tier: VerdictTier;
  priceBucket: string;
  source: "address" | "zillow" | "manual";
}) {
  useEffect(() => {
    trackEvent("Results Viewed", {
      tier,
      priceBucket,
      source,
    });
  }, [tier, priceBucket, source]);

  return null;
}
