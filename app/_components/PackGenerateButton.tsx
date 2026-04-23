"use client";

// ---------------------------------------------------------------------------
// Generate Negotiation Pack — primary CTA on the live-comp /results view
// (HANDOFF §11).
//
// Visible on the action row only when:
//   - The user has run a live comp pull (otherwise the Pack would be built
//     on a fast-estimate snapshot with no real comp evidence — that's
//     exactly the artifact §20.8 was designed to prevent).
//   - Supabase is configured (the Pack is persisted, share_token-keyed).
//
// Sign-in / Pro gates: the button starts visible to everyone. Click flow:
//   - Anonymous → /login?mode=signup&redirect=<here>
//   - Free user → POST proceeds (Pack generation is included in their 3
//     monthly live analyses; no separate Pro paywall on Pack itself per
//     §20.5 — Pack is the funnel TO Pro, not gated BY Pro).
//   - Anything goes wrong → inline error, retry button.
//
// On success: redirects to /pack/<shareToken> where the user can review
// the Pack, copy the share URL, and forward to their agent.
// ---------------------------------------------------------------------------

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  normalizeCacheKey,
  sessionGet,
} from "@/lib/client-session-cache";
import type { DealInputs } from "@/lib/calculations";

const RESULTS_WARNINGS_NS = "results-warnings:v4";

type GenStatus =
  | { state: "idle" }
  | { state: "generating" }
  | { state: "redirecting"; shareToken: string }
  | { state: "error"; message: string };

type SubjectFacts = {
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  propertyType?: string;
  lastSalePrice?: number;
  lastSaleDate?: string;
};

export default function PackGenerateButton({
  inputs,
  address,
  subjectFacts,
  currentUrl,
  signedIn,
  supabaseConfigured,
  isListed,
}: {
  inputs: DealInputs;
  address: string;
  subjectFacts: SubjectFacts;
  currentUrl: string;
  signedIn: boolean;
  supabaseConfigured: boolean;
  /** True when the `/results` query string has `listed=1` — i.e. the
   *  purchasePrice the user is looking at is the live Zillow list price,
   *  not a manual override. Passed through to the Pack API so the Pack's
   *  `analyzeComparables` call uses the same `currentListPrice` rule as
   *  `/results` and the fair-value / walk-away numbers cannot diverge. */
  isListed: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<GenStatus>({ state: "idle" });
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!address) return;
    const entry = sessionGet<{ warnings: string[] }>(
      RESULTS_WARNINGS_NS,
      normalizeCacheKey(address),
    );
    if (entry && Array.isArray(entry.warnings)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of sessionStorage at mount
      setWarnings(entry.warnings);
    }
  }, [address]);

  if (!supabaseConfigured) return null;

  const onClick = async () => {
    if (!signedIn) {
      router.push(
        `/login?mode=signup&redirect=${encodeURIComponent(currentUrl)}`,
      );
      return;
    }
    setStatus({ state: "generating" });
    try {
      const res = await fetch("/api/pack/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs,
          address,
          subjectFacts,
          warnings,
          isListed,
        }),
      });
      if (res.status === 401) {
        router.push(
          `/login?mode=signup&redirect=${encodeURIComponent(currentUrl)}`,
        );
        return;
      }
      const payload = await res.json();
      if (!res.ok) {
        setStatus({
          state: "error",
          message:
            payload?.error ?? `Pack generation failed (HTTP ${res.status})`,
        });
        return;
      }
      const shareToken = payload.shareToken as string;
      setStatus({ state: "redirecting", shareToken });
      router.push(`/pack/${shareToken}`);
    } catch (err) {
      setStatus({
        state: "error",
        message:
          err instanceof Error ? err.message : "Pack generation failed.",
      });
    }
  };

  const label =
    status.state === "generating"
      ? "Building Pack…"
      : status.state === "redirecting"
        ? "Opening Pack…"
        : status.state === "error"
          ? "Try again"
          : !signedIn
            ? "Generate Negotiation Pack"
            : "Generate Negotiation Pack";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={
          status.state === "generating" || status.state === "redirecting"
        }
        style={{
          backgroundColor: "var(--accent)",
          color: "#0a0a0a",
        }}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <PackIcon />
        <span>{label}</span>
      </button>
      {status.state === "error" && (
        <p className="text-xs text-red-400">{status.message}</p>
      )}
    </div>
  );
}

function PackIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3.5 2.75A.75.75 0 014.25 2h11.5a.75.75 0 01.75.75v14.5a.75.75 0 01-.75.75H4.25a.75.75 0 01-.75-.75V2.75zM6 5.5a.5.5 0 01.5-.5h7a.5.5 0 010 1h-7a.5.5 0 01-.5-.5zm.5 2.5a.5.5 0 000 1h7a.5.5 0 000-1h-7zm0 3a.5.5 0 000 1h4a.5.5 0 000-1h-4z" />
    </svg>
  );
}
