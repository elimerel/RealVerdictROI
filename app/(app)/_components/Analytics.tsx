"use client";

import Script from "next/script";
import { Analytics as VercelAnalytics } from "@vercel/analytics/next";

// ---------------------------------------------------------------------------
// Analytics integrations — two independent, additive, env-gated providers.
//
// 1. Plausible (optional). Enabled when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is set.
//    Hosted product ($9/mo) — gives us cookieless page analytics + the
//    `window.plausible(event, { props })` custom event API we use for funnel
//    tracking ("analyze_click", "save_deal_click", etc.).
//
// 2. Vercel Analytics (always rendered). Free on Vercel Hobby, generous
//    request cap. The `<Analytics />` component is a no-op when the app is
//    served from anywhere other than a Vercel deployment, so including it
//    unconditionally has zero cost in dev or on self-hosted.
//
// Using both is fine — Plausible is product-domain events, Vercel is
// infrastructure-domain pageviews / web vitals. They don't overlap.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    plausible?: (
      event: string,
      options?: { props?: Record<string, string | number | boolean> },
    ) => void;
  }
}

export default function Analytics() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  return (
    <>
      {domain ? (
        <>
          <Script
            strategy="afterInteractive"
            data-domain={domain}
            src="https://plausible.io/js/script.outbound-links.file-downloads.tagged-events.js"
          />
          {/*
            Define a no-op queue so that calls to `plausible()` made before the
            script has loaded are still captured and flushed when it arrives.
            Recommended by Plausible docs.
          */}
          <Script id="plausible-queue" strategy="afterInteractive">
            {`window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments) }`}
          </Script>
        </>
      ) : null}
      <VercelAnalytics />
    </>
  );
}

// ---------------------------------------------------------------------------
// Tiny helper so callers don't have to guard on `window.plausible` everywhere.
// Safe to call on the server (no-op) and before analytics has loaded (queued).
// ---------------------------------------------------------------------------

export function trackEvent(
  event: string,
  props?: Record<string, string | number | boolean>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.plausible?.(event, props ? { props } : undefined);
  } catch {
    // analytics failures must never break the page
  }
}
