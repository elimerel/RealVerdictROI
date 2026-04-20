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

export default function SaveDealButton({
  inputs,
  address,
  currentUrl,
  signedIn,
  supabaseConfigured,
}: {
  inputs: DealInputs;
  address?: string;
  currentUrl: string;
  signedIn: boolean;
  supabaseConfigured: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });

  // When Supabase is unavailable we hide the button entirely rather than show
  // something that would always fail.
  if (!supabaseConfigured) return null;

  const onClick = async () => {
    if (!signedIn) {
      router.push(`/login?mode=signup&redirect=${encodeURIComponent(currentUrl)}`);
      return;
    }
    setStatus({ state: "saving" });
    try {
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, address }),
      });
      if (res.status === 401) {
        // Session expired between render and click.
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
      <div className="inline-flex items-center gap-3 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/40">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">
          ✓
        </span>
        <span className="font-medium text-emerald-800 dark:text-emerald-200">
          Saved to your dashboard.
        </span>
        <Link
          href="/dashboard"
          className="text-sm font-semibold text-emerald-900 underline underline-offset-2 dark:text-emerald-100"
        >
          View
        </Link>
      </div>
    );
  }

  const label = !signedIn
    ? "Save this analysis"
    : status.state === "saving"
      ? "Saving…"
      : status.state === "error"
        ? "Try again"
        : "Save this analysis";

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={status.state === "saving"}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M5 4a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V6a2 2 0 00-2-2h-1.5a.5.5 0 000 1H15a1 1 0 011 1v10a1 1 0 01-1 1h-.5v-5.5a1.5 1.5 0 00-1.5-1.5h-6A1.5 1.5 0 006.5 12V18H5a1 1 0 01-1-1V6a1 1 0 011-1h.5a.5.5 0 100-1H5zm8 14v-5.5a.5.5 0 00-.5-.5h-5a.5.5 0 00-.5.5V18h6zM6.5 4.5A.5.5 0 017 4h6a.5.5 0 01.5.5v2a.5.5 0 01-.5.5H7a.5.5 0 01-.5-.5v-2z" />
        </svg>
        {label}
      </button>
      {!signedIn && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Free sign-up. Your deals are private and only visible to you.
        </p>
      )}
      {status.state === "error" && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {status.message}
        </p>
      )}
    </div>
  );
}
