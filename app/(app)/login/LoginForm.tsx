"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Google "G" logo SVG — official brand colour
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

type Mode = "signin" | "signup";

export default function LoginForm({
  redirectTo,
  initialMode,
  compact = false,
}: {
  redirectTo: string;
  initialMode: Mode;
  compact?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "oauth_loading" }
    | { state: "error"; message: string }
    | { state: "needs_confirmation" }
  >({ state: "idle" });

  const signInWithGoogle = async () => {
    setStatus({ state: "oauth_loading" });
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });
    if (error) {
      setStatus({ state: "error", message: error.message });
    }
    // On success, Supabase redirects the browser to Google — no further action needed here
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ state: "loading" });

    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;

        // If email confirmation is disabled in the Supabase project, the
        // session is returned immediately and we can proceed.
        if (data.session) {
          router.replace(redirectTo);
          router.refresh();
          return;
        }
        setStatus({ state: "needs_confirmation" });
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Authentication failed.";
      setStatus({ state: "error", message });
    }
  };

  const busy = status.state === "loading";
  const oauthBusy = status.state === "oauth_loading";

  if (status.state === "needs_confirmation") {
    return (
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
          ✓
        </div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          We sent a confirmation link to{" "}
          <span className="font-mono text-zinc-900 dark:text-zinc-50">
            {email}
          </span>
          . Click it to activate your account, then sign in.
        </p>
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setStatus({ state: "idle" });
          }}
          className="mt-6 text-sm font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-50"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className={`w-full ${compact ? "max-w-sm" : "max-w-md"} rounded-2xl border border-zinc-200 bg-white ${compact ? "p-6" : "p-8"} shadow-sm dark:border-zinc-800 dark:bg-zinc-950`}>
      <div className={`${compact ? "mb-4" : "mb-6"} flex flex-col gap-1`}>
        <h1 className={`${compact ? "text-lg" : "text-2xl"} font-semibold tracking-tight text-zinc-900 dark:text-zinc-50`}>
          {mode === "signup"
            ? "Create your account"
            : "Welcome back"}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {mode === "signup"
            ? "Save deals and build your portfolio."
            : "Sign in to access your dashboard."}
        </p>
      </div>

      {/* Google OAuth */}
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy || oauthBusy}
        className="mb-4 inline-flex w-full items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
      >
        <GoogleIcon />
        {oauthBusy ? "Redirecting…" : "Continue with Google"}
      </button>

      {/* Divider */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
        <span className="text-xs text-zinc-400">or</span>
        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email"
            className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-100/10"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password"
            className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-100/10"
          />
          {mode === "signup" && (
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              At least 6 characters.
            </p>
          )}
        </div>

        {status.state === "error" && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {status.message}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-2 inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {busy
            ? "Please wait…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setStatus({ state: "idle" });
          }}
          className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {mode === "signup"
            ? "Already have an account? Sign in"
            : "Need an account? Sign up"}
        </button>
        {!compact && (
          <Link
            href="/"
            className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Back home
          </Link>
        )}
      </div>
    </div>
  );
}
