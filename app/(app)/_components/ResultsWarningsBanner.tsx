"use client";

// Banner that surfaces the resolver's `warnings[]` on /results.
//
// The homepage already renders these warnings inline on the autofill chip,
// but without this banner they vanish the moment the user navigates to
// /results. Since warnings carry important context ("Zillow scraper offline
// — we used public records only", "FRED rate stale; using a fallback", etc.)
// we hand them off via sessionStorage, keyed by the canonical address.
//
// Design notes:
//   - sessionStorage only — warnings are a fresh-session UX hint, not a
//     permanent piece of state. Shared /results URLs in a new browser
//     won't show them, which is the correct behavior (the warnings may
//     no longer apply).
//   - Dismissible — once the user has read it, they can close it so the
//     next tab render doesn't re-surface the same message. The dismissal
//     is scoped to the same session key.

import { useEffect, useState } from "react";
import { normalizeCacheKey, sessionDelete, sessionGet } from "@/lib/client-session-cache";

// Must match HomeAnalyzeForm.tsx's `RESULTS_WARNINGS_NS` exactly — both
// sides of the sessionStorage handoff need the same key. Bump the version
// here in lockstep when the autofill cache version moves; otherwise the
// banner silently shows nothing because it's reading a stale namespace.
// (Was reading `results-warnings:v1` while the form had moved on to
// `:v3`/`:v4` — the warnings banner was effectively dead since v2.)
const RESULTS_WARNINGS_NS = "results-warnings:v4";

type WarningsEntry = {
  warnings: string[];
};

export default function ResultsWarningsBanner({
  address,
}: {
  address: string | undefined;
}) {
  const [warnings, setWarnings] = useState<string[]>([]);

  // Read sessionStorage on mount. This is a genuine "sync with external
  // browser storage" case — the lint rule's preferred pattern
  // (useSyncExternalStore) would be overkill for a one-shot read that
  // never updates after hydration.
  useEffect(() => {
    if (!address) return;
    const entry = sessionGet<WarningsEntry>(
      RESULTS_WARNINGS_NS,
      normalizeCacheKey(address),
    );
    if (entry && Array.isArray(entry.warnings) && entry.warnings.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading from sessionStorage at mount is a legitimate external-sync case
      setWarnings(entry.warnings);
    }
  }, [address]);

  if (warnings.length === 0) return null;

  const dismiss = () => {
    if (address) {
      sessionDelete(RESULTS_WARNINGS_NS, normalizeCacheKey(address));
    }
    setWarnings([]);
  };

  return (
    <div className="mb-6 rounded-lg border border-amber-700/50 bg-amber-950/40 p-4 text-sm text-amber-100">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-300">
            Heads up — data caveats
          </div>
          <ul className="space-y-1.5">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-1.5 leading-snug">
                <span aria-hidden className="shrink-0">⚠</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss warnings"
          className="shrink-0 rounded-md p-1 text-amber-300 transition hover:bg-amber-900/40 hover:text-amber-100"
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
