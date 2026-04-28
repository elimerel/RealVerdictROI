"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DealInputs } from "@/lib/calculations";

type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; id: string }
  | { state: "error"; message: string };

/**
 * Dark-themed action-bar button for saving the current analysis. Occupies
 * one column in the 3-up action row on the results page. If Supabase is
 * unconfigured it renders nothing so the grid collapses cleanly to 2 cols.
 */
export default function SaveDealButton({
  inputs,
  address,
  currentUrl,
  signedIn,
  isPro,
  supabaseConfigured,
  propertyFacts,
}: {
  inputs: DealInputs;
  address?: string;
  currentUrl: string;
  signedIn: boolean;
  isPro: boolean;
  supabaseConfigured: boolean;
  propertyFacts?: { beds?: number; baths?: number; sqft?: number; yearBuilt?: number; propertyType?: string };
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });

  if (!supabaseConfigured) return null;

  const onClick = async () => {
    if (!signedIn) {
      router.push(
        `/login?mode=signup&redirect=${encodeURIComponent(currentUrl)}`,
      );
      return;
    }
    if (!isPro) {
      router.push(
        `/pricing?redirect=${encodeURIComponent(currentUrl)}`,
      );
      return;
    }
    setStatus({ state: "saving" });
    try {
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, address, propertyFacts }),
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
          message: payload?.error ?? `Save failed (HTTP ${res.status})`,
        });
        return;
      }
      setStatus({ state: "saved", id: payload.id });
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Save failed.",
      });
    }
  };

  if (status.state === "saved") {
    return (
      <Link
        href="/dashboard"
        style={{
          borderColor: "var(--accent)",
          backgroundColor: "var(--accent-soft)",
        }}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold text-zinc-100 transition hover:brightness-110"
      >
        <CheckIcon />
        <span>Saved — view dashboard</span>
      </Link>
    );
  }

  const label = !signedIn
    ? "Save this analysis"
    : !isPro
      ? "Save (Pro)"
      : status.state === "saving"
        ? "Saving…"
        : status.state === "error"
          ? "Try again"
          : "Save this analysis";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={status.state === "saving"}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-700 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <SaveIcon />
        <span>{label}</span>
      </button>
      {status.state === "error" && (
        <p className="text-xs text-red-400">{status.message}</p>
      )}
    </div>
  );
}

function SaveIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-zinc-400"
      aria-hidden="true"
    >
      <path d="M5 4a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V6a2 2 0 00-2-2h-1.5a.5.5 0 000 1H15a1 1 0 011 1v10a1 1 0 01-1 1h-.5v-5.5a1.5 1.5 0 00-1.5-1.5h-6A1.5 1.5 0 006.5 12V18H5a1 1 0 01-1-1V6a1 1 0 011-1h.5a.5.5 0 100-1H5zm8 14v-5.5a.5.5 0 00-.5-.5h-5a.5.5 0 00-.5.5V18h6zM6.5 4.5A.5.5 0 017 4h6a.5.5 0 01.5.5v2a.5.5 0 01-.5.5H7a.5.5 0 01-.5-.5v-2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-[var(--accent)]"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4L8.5 12l6.8-6.8a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}
