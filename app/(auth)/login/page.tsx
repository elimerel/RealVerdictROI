import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Zap } from "lucide-react";
import LoginForm from "./LoginForm";
import { MarketingHeader } from "@/app/(marketing)/_components/MarketingHeader";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; mode?: string; error?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const oauthError = sp.error === "oauth_failed"
    ? "Google sign-in failed. Please try again or use email."
    : null;
  const redirectTo =
    typeof sp.redirect === "string" && sp.redirect.startsWith("/")
      ? sp.redirect
      : "/research";

  const initialMode: "signin" | "signup" =
    sp.mode === "signup" ? "signup" : "signin";

  // Electron auto-detection — the desktop shell sends a private custom
  // request header on requests to our own origins. We use this header
  // (NOT a user-agent suffix) so the embedded browser stays an
  // indistinguishable Chromium UA on third-party sites — that's the
  // legal/operational hardening from the UA-normalization pass.
  //
  // Falls back to:
  //   - the legacy "RealVerdictDesktop" UA tag (older installed builds)
  //   - the ?source=electron query param (very old builds + manual link)
  // so users on stale binaries still get the compact form.
  const reqHeaders = await headers();
  const ua = reqHeaders.get("user-agent") ?? "";
  const isElectron =
    reqHeaders.get("x-realverdict-desktop") === "1" ||
    ua.includes("RealVerdictDesktop") ||
    ua.includes("realverdict-desktop") ||
    sp.source === "electron";

  // Compact layout for the Electron desktop app — dark, no header, no scroll.
  //
  // IMPORTANT: we deliberately skip the server-side getCurrentUser() check here.
  // If we detect an existing session on the server we'd normally redirect(), but
  // in Electron that redirect plays out inside the small 400×520 login window,
  // cramming the full app into it.  Instead, LoginForm's onAuthStateChange listener
  // handles the "already signed in" case: Supabase fires INITIAL_SESSION almost
  // immediately after subscribe if a session exists, which calls api.signedIn() via
  // IPC so the main process opens the real 1400×900 mainWindow and closes this
  // login window cleanly.
  if (isElectron) {
    return (
      <div className="dark flex flex-col items-center justify-center min-h-screen px-5 py-4 bg-[#0a0a0b]">
        {/* Logo — matches sidebar + landing brand mark */}
        <div className="mb-5 flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-[7px]"
            style={{
              background: "var(--rv-accent)",
              boxShadow: "0 1px 3px var(--rv-accent-border), inset 0 0 0 0.5px oklch(1 0 0 / 20%)",
            }}
          >
            <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
          </div>
          <span
            className="text-[13px] font-semibold"
            style={{ color: "var(--rv-t1)", letterSpacing: "-0.012em" }}
          >
            RealVerdict
          </span>
        </div>

        {oauthError && (
          <div className="mb-3 w-full max-w-xs rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {oauthError}
          </div>
        )}

        {supabaseEnv().configured ? (
          <LoginForm redirectTo={redirectTo} initialMode={initialMode} compact />
        ) : (
          <UnconfiguredNotice />
        )}
      </div>
    );
  }

  // Standard web layout — check session and redirect if already signed in.
  const user = await getCurrentUser();
  if (user) redirect(redirectTo);  // redirectTo defaults to /research

  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--rv-surface-bg)" }}>
      <MarketingHeader />
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        {supabaseEnv().configured ? (
          <>
            {oauthError && (
              <div className="mb-4 w-full max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {oauthError}
              </div>
            )}
            <LoginForm redirectTo={redirectTo} initialMode={initialMode} />
          </>
        ) : (
          <UnconfiguredNotice />
        )}
      </main>
    </div>
  );
}

function UnconfiguredNotice() {
  return (
    <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <h2 className="mb-2 text-base font-semibold">Auth is not configured</h2>
      <p className="leading-relaxed">
        To enable sign-in and deal saving, set{" "}
        <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs dark:bg-amber-900/60">
          NEXT_PUBLIC_SUPABASE_URL
        </code>{" "}
        and{" "}
        <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs dark:bg-amber-900/60">
          NEXT_PUBLIC_SUPABASE_ANON_KEY
        </code>{" "}
        in your <code>.env.local</code>.
      </p>
    </div>
  );
}
