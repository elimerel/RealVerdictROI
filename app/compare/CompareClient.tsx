"use client";

// Compare queue UI — runs on both localStorage (anonymous) and Supabase
// (signed-in). See /app/compare/page.tsx for the server-side shell that
// decides which mode to hand us.
//
// State invariants:
//   - The `deals` state is the source of truth for rendering; both modes
//     feed it.
//   - Anonymous mode: reads/writes localStorage directly, mirrors into
//     state, dispatches a window event so a second tab can subscribe.
//   - Signed-in mode: writes go through /api/compare, then the state
//     updates on success. localStorage is NOT touched in this mode so
//     the user doesn't build up parallel drift.
//
// Migration: when the user signs in and we have localStorage entries that
// aren't yet in the remote set, we fire-and-forget upserts for them and
// then clear localStorage. The user's next visit on a different device
// sees the merged queue.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DealInputs, DealAnalysis } from "@/lib/calculations";
import { analyseDeal, formatCurrency, formatPercent } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComparisonDeal = {
  id: string;
  inputs: DealInputs;
  analysis: DealAnalysis;
  address?: string;
  addedAt: Date;
};

// Shape returned by /api/compare GET / POST.
type RemoteEntry = {
  id: string;
  dealKey: string;
  address?: string;
  inputs: DealInputs;
  addedAt: string;
};

// localStorage shape (legacy — kept identical so existing queues don't
// need a migration when the user is still anonymous).
type StoredDeal = {
  id: string;
  inputs: DealInputs;
  address?: string;
  addedAt: string;
};

const STORAGE_KEY = "compareDeals";

// ---------------------------------------------------------------------------
// localStorage helpers (anonymous mode)
// ---------------------------------------------------------------------------

function readLocalStorage(): StoredDeal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredDeal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalStorage(deals: StoredDeal[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(deals));
  } catch {
    // QuotaExceeded etc. — not worth degrading the UI over.
  }
  try {
    window.dispatchEvent(new Event("compareDeals:changed"));
  } catch {
    /* ignore */
  }
}

function clearLocalStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("compareDeals:changed"));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function hydrateStored(s: StoredDeal): ComparisonDeal {
  return {
    id: s.id,
    inputs: s.inputs,
    address: s.address,
    analysis: analyseDeal(s.inputs),
    addedAt: new Date(s.addedAt),
  };
}

function hydrateRemote(r: RemoteEntry): ComparisonDeal {
  return {
    id: r.dealKey,
    inputs: r.inputs,
    address: r.address,
    analysis: analyseDeal(r.inputs),
    addedAt: new Date(r.addedAt),
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CompareClient({
  signedIn,
  remoteSyncEnabled,
  initialRemote,
}: {
  signedIn: boolean;
  remoteSyncEnabled: boolean;
  initialRemote: RemoteEntry[];
}) {
  const [deals, setDeals] = useState<ComparisonDeal[]>(() => {
    if (signedIn && remoteSyncEnabled) return initialRemote.map(hydrateRemote);
    return readLocalStorage().map(hydrateStored);
  });
  const [syncError, setSyncError] = useState<string | null>(null);

  // Merge-on-first-login: once after hydration, if we're signed in and
  // localStorage has entries not in `deals`, push them up. Happens at most
  // once per browser session so a subsequent sign-out / sign-in doesn't
  // loop.
  const didMergeRef = useRef(false);
  useEffect(() => {
    if (!signedIn || !remoteSyncEnabled || didMergeRef.current) return;
    didMergeRef.current = true;

    const local = readLocalStorage();
    if (local.length === 0) return;
    const existingKeys = new Set(deals.map((d) => d.id));
    const toMerge = local.filter((d) => !existingKeys.has(d.id));
    if (toMerge.length === 0) {
      // Already in remote — just clear the local copy so we don't drift.
      clearLocalStorage();
      return;
    }

    (async () => {
      const merged: ComparisonDeal[] = [];
      for (const d of toMerge) {
        try {
          const res = await fetch("/api/compare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dealKey: d.id,
              address: d.address,
              inputs: d.inputs,
            }),
          });
          if (res.ok) {
            const payload = (await res.json()) as { entry: RemoteEntry };
            merged.push(hydrateRemote(payload.entry));
          }
        } catch {
          // Individual merge failure is non-fatal — we'll still clear the
          // local entry later; worst case the user re-adds from /results.
        }
      }
      if (merged.length > 0) {
        setDeals((prev) => dedupeById([...merged, ...prev]));
      }
      clearLocalStorage();
    })();
  }, [signedIn, remoteSyncEnabled, deals]);

  // Anonymous-mode subscription: keep in sync across tabs via the
  // `compareDeals:changed` event that AddToComparisonButton dispatches.
  useEffect(() => {
    if (signedIn && remoteSyncEnabled) return;
    const refresh = () => setDeals(readLocalStorage().map(hydrateStored));
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("compareDeals:changed", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("compareDeals:changed", refresh);
    };
  }, [signedIn, remoteSyncEnabled]);

  const removeDeal = useCallback(
    async (id: string) => {
      // Optimistic — drop from local state first so the UI feels instant.
      setDeals((prev) => prev.filter((d) => d.id !== id));
      if (signedIn && remoteSyncEnabled) {
        try {
          const res = await fetch("/api/compare", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dealKey: id }),
          });
          if (!res.ok) setSyncError("Couldn't sync remove to your account.");
        } catch {
          setSyncError("Network error — remove didn't sync.");
        }
      } else {
        const remaining = readLocalStorage().filter((d) => d.id !== id);
        writeLocalStorage(remaining);
      }
    },
    [signedIn, remoteSyncEnabled],
  );

  const clearAll = useCallback(async () => {
    setDeals([]);
    if (signedIn && remoteSyncEnabled) {
      try {
        const res = await fetch("/api/compare", { method: "DELETE" });
        if (!res.ok) setSyncError("Couldn't sync clear to your account.");
      } catch {
        setSyncError("Network error — clear didn't sync.");
      }
    } else {
      clearLocalStorage();
    }
  }, [signedIn, remoteSyncEnabled]);

  if (deals.length === 0) {
    return (
      <EmptyState>
        <Header
          deals={deals}
          signedIn={signedIn}
          remoteSyncEnabled={remoteSyncEnabled}
        />
      </EmptyState>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <Header
        deals={deals}
        signedIn={signedIn}
        remoteSyncEnabled={remoteSyncEnabled}
        onClear={clearAll}
      />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-7xl px-6 py-8">
          {syncError && (
            <div className="mb-4 rounded-md border border-amber-600/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              {syncError}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {deals.map((deal, index) => (
              <DealSummaryCard
                key={deal.id}
                deal={deal}
                onRemove={() => removeDeal(deal.id)}
                dealNumber={index + 1}
              />
            ))}
          </div>
          <ComparisonTable deals={deals} />
        </div>
      </main>
    </div>
  );
}

function dedupeById(deals: ComparisonDeal[]): ComparisonDeal[] {
  const seen = new Set<string>();
  const out: ComparisonDeal[] = [];
  for (const d of deals) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Presentational pieces (mostly unchanged from the pre-sync version)
// ---------------------------------------------------------------------------

function Header({
  deals,
  signedIn,
  remoteSyncEnabled,
  onClear,
}: {
  deals: ComparisonDeal[];
  signedIn: boolean;
  remoteSyncEnabled: boolean;
  onClear?: () => void;
}) {
  return (
    <header className="border-b border-zinc-900">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-sm font-semibold tracking-tight text-zinc-100">
          RealVerdict
        </Link>
        <div className="flex items-center gap-4">
          {deals.length > 0 && (
            <span className="hidden sm:inline text-xs text-zinc-500">
              {signedIn && remoteSyncEnabled
                ? "Synced across your devices"
                : "Stored in this browser"}
            </span>
          )}
          <span className="text-sm text-zinc-400">
            {deals.length > 0
              ? `Comparing ${deals.length} deal${deals.length > 1 ? "s" : ""}`
              : "No deals yet"}
          </span>
          {onClear && deals.length > 0 && (
            <button
              onClick={onClear}
              className="text-sm font-medium text-zinc-400 transition hover:text-zinc-100"
            >
              Clear All
            </button>
          )}
          <Link
            href="/"
            className="font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            Back to Analysis
          </Link>
        </div>
      </div>
    </header>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {children}
      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-center px-6 py-20">
          <h1 className="text-3xl font-bold text-zinc-100 mb-4">No Deals to Compare</h1>
          <p className="text-zinc-400 mb-8 text-center max-w-md">
            Analyze properties and click &ldquo;Add to Comparison&rdquo; to start comparing
            deals side-by-side.
          </p>
          <Link
            href="/"
            className="rounded-lg bg-[#22c55e] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Analyze a Deal
          </Link>
        </div>
      </main>
    </div>
  );
}

function DealSummaryCard({
  deal,
  onRemove,
  dealNumber,
}: {
  deal: ComparisonDeal;
  onRemove: () => void;
  dealNumber: number;
}) {
  const { inputs, analysis } = deal;

  const accent =
    analysis.verdict.tier === "excellent" || analysis.verdict.tier === "good"
      ? "#22c55e"
      : analysis.verdict.tier === "fair"
        ? "#eab308"
        : "#ef4444";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 relative">
      <button
        onClick={onRemove}
        className="absolute top-2 right-2 text-zinc-500 hover:text-zinc-300 transition"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="mb-3">
        <span className="text-xs text-zinc-500">Deal {dealNumber}</span>
        <h3
          className="text-lg font-bold uppercase"
          style={{ color: accent }}
        >
          {analysis.verdict.tier === "excellent" && "STRONG BUY"}
          {analysis.verdict.tier === "good" && "GOOD DEAL"}
          {analysis.verdict.tier === "fair" && "BORDERLINE"}
          {analysis.verdict.tier === "poor" && "PASS"}
          {analysis.verdict.tier === "avoid" && "AVOID"}
        </h3>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">Address:</span>
          <span className="text-zinc-300">{deal.address || "No address"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Price:</span>
          <span className="text-zinc-300">{formatCurrency(inputs.purchasePrice, 0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Cash Flow:</span>
          <span
            className={analysis.monthlyCashFlow >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}
          >
            {formatCurrency(analysis.monthlyCashFlow, 0)}/mo
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Cash-on-Cash:</span>
          <span className="text-zinc-300">{formatPercent(analysis.cashOnCashReturn, 1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Cap Rate:</span>
          <span className="text-zinc-300">{formatPercent(analysis.capRate, 2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">DSCR:</span>
          <span className="text-zinc-300">
            {isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "infinite"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ComparisonTable({ deals }: { deals: ComparisonDeal[] }) {
  const metrics = [
    { key: "purchasePrice", label: "Purchase Price", format: "currency" },
    { key: "monthlyCashFlow", label: "Monthly Cash Flow", format: "currency" },
    { key: "annualCashFlow", label: "Annual Cash Flow", format: "currency" },
    { key: "cashOnCashReturn", label: "Cash-on-Cash Return", format: "percent" },
    { key: "capRate", label: "Cap Rate", format: "percent" },
    { key: "dscr", label: "DSCR", format: "dscr" },
    { key: "irr", label: "IRR", format: "percent" },
    { key: "totalROI", label: "Total ROI", format: "percent" },
    { key: "breakEvenOccupancy", label: "Break-even Occupancy", format: "percent" },
  ];

  const formatValue = (value: number, format: string) => {
    switch (format) {
      case "currency":
        return formatCurrency(value, 0);
      case "percent":
        return formatPercent(value, value < 0.1 ? 2 : 1);
      case "dscr":
        return isFinite(value) ? value.toFixed(2) : "infinite";
      default:
        return value.toString();
    }
  };

  const getBestValue = (metricKey: string, values: number[]) => {
    if (metricKey === "breakEvenOccupancy") return Math.min(...values);
    return Math.max(...values);
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Metric</th>
              {deals.map((deal, index) => (
                <th key={deal.id} className="px-4 py-3 text-center text-sm font-medium text-zinc-400">
                  Deal {index + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => {
              const values = deals.map(
                (deal) => deal.analysis[metric.key as keyof DealAnalysis] as number,
              );
              const bestValue = getBestValue(metric.key, values);

              return (
                <tr key={metric.key} className="border-b border-zinc-800/50">
                  <td className="px-4 py-3 text-sm text-zinc-300">{metric.label}</td>
                  {deals.map((deal) => {
                    const value = deal.analysis[metric.key as keyof DealAnalysis] as number;
                    const isBest = value === bestValue;

                    return (
                      <td
                        key={deal.id}
                        className={`px-4 py-3 text-sm text-center font-mono ${
                          isBest ? "text-[#22c55e] font-semibold" : "text-zinc-300"
                        }`}
                      >
                        {formatValue(value, metric.format)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
