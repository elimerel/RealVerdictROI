"use client";

// Add-to-Comparison button on /results.
//
// Two write modes:
//
//   1. Anonymous — writes to localStorage only (original behavior).
//   2. Signed-in — writes to localStorage AND upserts into Supabase via
//      /api/compare. localStorage acts as an offline-safety net so a
//      network failure doesn't cost the user their click; the /compare
//      page merges localStorage-only entries on next load.
//
// The button doesn't need to block on the network round trip. We return
// "added" as soon as the optimistic local write succeeds; the remote
// upsert runs in the background. Worst case the /compare merger picks
// it up on next visit.

import { useState } from "react";
import type { DealAnalysis } from "@/lib/calculations";

type AddToComparisonButtonProps = {
  inputs: DealAnalysis["inputs"];
  address?: string;
  analysis: DealAnalysis;
  /**
   * When true, the button ALSO upserts the entry into Supabase for
   * cross-device sync. When false, localStorage only (original
   * behavior). Supplied by the /results server component based on
   * the active auth session.
   */
  signedIn?: boolean;
  /** Pro-only: cross-device sync via `/api/compare`. */
  remoteSyncEnabled?: boolean;
};

type StoredDeal = {
  id: string;
  inputs: DealAnalysis["inputs"];
  analysis: DealAnalysis;
  address?: string;
  addedAt: string;
};

export default function AddToComparisonButton({
  inputs,
  address,
  analysis,
  signedIn = false,
  remoteSyncEnabled = false,
}: AddToComparisonButtonProps) {
  const [isAdded, setIsAdded] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const handleAddToComparison = () => {
    setIsAdding(true);

    const existingDeals = JSON.parse(
      localStorage.getItem("compareDeals") || "[]",
    ) as StoredDeal[];

    const dealId = `${inputs.purchasePrice}-${inputs.monthlyRent}-${Date.now()}`;
    const isAlreadyAdded = existingDeals.some(
      (deal) =>
        deal.inputs.purchasePrice === inputs.purchasePrice &&
        deal.inputs.monthlyRent === inputs.monthlyRent,
    );

    if (isAlreadyAdded) {
      setIsAdding(false);
      setIsAdded(true);
      return;
    }

    const newDeal: StoredDeal = {
      id: dealId,
      inputs,
      analysis,
      address,
      addedAt: new Date().toISOString(),
    };

    // Cap at 3 to keep the table readable. Shift the oldest off when full.
    const updatedDeals = [...existingDeals, newDeal];
    if (updatedDeals.length > 3) updatedDeals.shift();

    localStorage.setItem("compareDeals", JSON.stringify(updatedDeals));
    // Notify any open /compare tab so it picks up the new entry without a
    // manual refresh.
    try {
      window.dispatchEvent(new Event("compareDeals:changed"));
    } catch {
      /* ignore */
    }

    setIsAdded(true);
    setIsAdding(false);

    // Background upsert for signed-in users so the entry syncs across
    // devices. Failure is swallowed — the localStorage write is the
    // durable path, and the /compare page merger is a second chance.
    if (signedIn && remoteSyncEnabled) {
      void fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealKey: dealId, address, inputs }),
      }).catch(() => {
        /* ignore — non-critical */
      });
    }
  };

  return (
    <button
      onClick={handleAddToComparison}
      disabled={isAdding || isAdded}
      className={`flex h-12 min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs sm:text-sm font-semibold transition sm:px-4 ${
        isAdded
          ? "border-green-600 bg-green-900/20 text-green-400"
          : "border-zinc-800 bg-zinc-900/60 text-zinc-100 hover:border-zinc-700 hover:bg-zinc-900"
      }`}
    >
      {isAdding ? (
        <div className="animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full" />
      ) : isAdded ? (
        <>
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <span className="hidden sm:inline">Added to Compare</span>
          <span className="sm:hidden">Added</span>
        </>
      ) : (
        <>
          <CompareIcon />
          <span className="hidden sm:inline">Add to Comparison</span>
          <span className="sm:hidden">Compare</span>
        </>
      )}
    </button>
  );
}

function CompareIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-zinc-400"
      aria-hidden="true"
    >
      <path d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4zM11 4a1 1 0 10-2 0v1.268a2 2 0 000 3.464V16a1 1 0 102 0V8.732a2 2 0 000-3.464V4zM16 3a1 1 0 011 1v7.268a2 2 0 010 3.464V16a1 1 0 11-2 0v-1.268a2 2 0 010-3.464V4a1 1 0 011-1z" />
    </svg>
  );
}
