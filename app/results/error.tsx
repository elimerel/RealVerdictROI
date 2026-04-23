"use client";

import { useEffect } from "react";
import Link from "next/link";
import { captureError } from "@/lib/observability";

// ---------------------------------------------------------------------------
// Error boundary for /results. Previously a bad search param or an upstream
// data-provider hiccup would 500 the whole page with the Next.js default
// error screen — a terrible experience for someone who just clicked a link
// to their own Pack. This boundary:
//   1) Reports the error to Sentry via lib/observability-client.
//   2) Renders a readable "something went wrong" screen matching the dark
//      /results theme (not the default Next.js light red page).
//   3) Gives the user two obvious actions: retry the same URL, or go home
//      and start a fresh analysis.
//
// `reset()` is the Next.js hook that re-runs the route server component.
// For transient issues (RentCast 502, Supabase connection blip), a second
// try often works. For parse errors in the search params, retrying won't
// help — the "Start a new analysis" link gets them out.
// ---------------------------------------------------------------------------

export default function ResultsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, {
      area: "app.results.error-boundary",
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-900">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-zinc-100"
          >
            RealVerdict
          </Link>
          <nav className="flex items-center gap-3 sm:gap-5 text-sm">
            <Link
              href="/pricing"
              className="font-medium text-zinc-400 transition hover:text-zinc-100"
            >
              Pricing
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-5 px-4 py-16 sm:px-6 sm:py-24">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-red-400">
            Something went wrong
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            We couldn&apos;t render this verdict.
          </h1>
          <p className="text-sm leading-relaxed text-zinc-400">
            The analysis engine hit an error while building this page. This
            is usually a bad query string or a temporary upstream outage —
            try again, and if it still fails, start a fresh analysis from
            the homepage.
          </p>

          {error.digest && (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 font-mono text-xs text-zinc-500">
              Error ID: {error.digest}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md bg-zinc-100 px-5 text-sm font-semibold text-zinc-900 transition hover:bg-white"
            >
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/60 px-5 text-sm font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
            >
              Start a new analysis
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-900 py-6">
        <div className="mx-auto max-w-6xl px-6 text-xs text-zinc-600">
          If this keeps happening, reach out and include the error ID above.
        </div>
      </footer>
    </div>
  );
}
