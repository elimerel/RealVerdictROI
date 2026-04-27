"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function GetProButton({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async () => {
    setError(null);
    if (!signedIn) {
      router.push(`/login?redirect=${encodeURIComponent("/pricing")}`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      if (res.status === 401) {
        router.push(`/login?redirect=${encodeURIComponent("/pricing")}`);
        return;
      }
      const payload = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) {
        setError(
          res.status === 503
            ? "Billing is not configured on this deployment."
            : (payload.error ?? "Could not start checkout."),
        );
        return;
      }
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
      setError("Checkout did not return a redirect URL.");
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void startCheckout()}
        disabled={loading}
        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {loading ? "Redirecting…" : "Get Pro"}
      </button>
      {error && (
        <p className="text-center text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
