"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Copies the current results page URL (as generated server-side from the
 * deal inputs) to the clipboard. Shows a "Link copied" confirmation for ~2s.
 * Falls back to a manual selection prompt on browsers without the Clipboard
 * API (e.g. insecure contexts).
 */
export default function ShareButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const onClick = async () => {
    // Build an absolute URL so the copied link is actually shareable.
    const fullUrl =
      typeof window !== "undefined"
        ? new URL(path, window.location.origin).toString()
        : path;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullUrl);
      } else {
        // Fallback — older browsers or insecure contexts.
        const ta = document.createElement("textarea");
        ta.value = fullUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("Clipboard unavailable");
      }
      setError(null);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-700 hover:bg-zinc-900"
    >
      {copied ? (
        <>
          <CheckIcon />
          <span>Link copied</span>
        </>
      ) : error ? (
        <span className="text-red-400">Copy failed — {error}</span>
      ) : (
        <>
          <ShareIcon />
          <span>Share this deal</span>
        </>
      )}
    </button>
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

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-zinc-400"
      aria-hidden="true"
    >
      <path d="M13 5a3 3 0 10-2.83-4H10a1 1 0 00-1 1v1H6a3 3 0 00-3 3v7a3 3 0 003 3h8a3 3 0 003-3v-2a1 1 0 10-2 0v2a1 1 0 01-1 1H6a1 1 0 01-1-1V6a1 1 0 011-1h3v1a1 1 0 001 1h.17A3 3 0 0013 5zm0-2a1 1 0 110 2 1 1 0 010-2z" />
      <path d="M17.7 7.7a1 1 0 00-1.4-1.4l-5 5a1 1 0 001.4 1.4l5-5z" />
    </svg>
  );
}
