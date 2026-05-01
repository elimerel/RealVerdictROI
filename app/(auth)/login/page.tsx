import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { TrendingUp } from "lucide-react";
import LoginForm from "./LoginForm";
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

  // Electron auto-detection — the desktop shell stamps "RealVerdictDesktop"
  // onto its user-agent. Detect it here so we never crash a server-side
  // redirect (e.g. /deals -> /login when no session) into the website-styled
  // card inside the 420×560 login window.
  //
  // Falls back to ?source=electron for older builds without the UA token.
  const reqHeaders = await headers();
  const ua = reqHeaders.get("user-agent") ?? "";
  const isElectron = ua.includes("RealVerdictDesktop") ||
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
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#09090b] px-5 py-4">
        {/* Logo */}
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 border border-white/10">
            <TrendingUp className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-white">RealVerdict</span>
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
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950">
      <header className="border-b border-zinc-200/70 bg-white/70 backdrop-blur-sm dark:border-zinc-800/70 dark:bg-black/40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            RealVerdict
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href="/pricing"
              className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Pricing
            </Link>
          </nav>
        </div>
      </header>

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
