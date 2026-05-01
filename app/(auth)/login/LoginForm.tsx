"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import "@/lib/electron";

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
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Terms acceptance gate for signup (legal hardening pass).
  // Defaults to false so creating an account is always an affirmative
  // opt-in. The checkbox is unmounted entirely in sign-in mode.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [status, setStatus] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "oauth_loading" }
    | { state: "error"; message: string }
    | { state: "needs_confirmation" }
  >({ state: "idle" });

  // In Electron we use BOTH the IPC AND a hard navigation. Why both?
  //
  //   - The IPC tells the main process to resize the window (420×560 → 1400×900)
  //     and load /research. This is the happy path.
  //   - The hard navigation is a belt-and-suspenders fallback. If IPC fails
  //     for any reason (preload not loaded, channel mismatch, race condition),
  //     the page still moves off /login and main's did-navigate listener
  //     catches it — calling expandToMainApp from there.
  //
  // Read window.electronAPI fresh inside the callback rather than capturing
  // it from a render-time closure — the closure could be stale (null) if
  // window.electronAPI wasn't set during the very first SSR/hydration pass.
  const calledSignedIn = useRef(false);

  const afterSignIn = useCallback(() => {
    if (calledSignedIn.current) return;
    calledSignedIn.current = true;
    const electronAPI = typeof window !== "undefined" ? window.electronAPI : null;
    if (electronAPI?.signedIn) {
      // Happy path — IPC tells main to resize the window AND loadURL(/research)
      // in one step. Avoid window.location.href here so we don't race a second
      // navigation against the one main is about to start.
      try { void electronAPI.signedIn() } catch { /* fall through to fallback */ }
      // Belt-and-suspenders: if main never navigates us off /login within
      // 1.2 s, force the navigation ourselves. Main's did-navigate listener
      // will then catch /research and call expandToMainApp.
      window.setTimeout(() => {
        if (window.location.pathname.startsWith("/login")) {
          window.location.href = redirectTo;
        }
      }, 1200);
      return;
    }
    // Web — plain hard navigation so proxy.ts gets a fresh request with the
    // session cookies the supabase client just set.
    window.location.href = redirectTo;
  }, [redirectTo]);

  // Listen for Supabase auth state changes — handles:
  // - INITIAL_SESSION: fires on subscribe if a session already exists (app restart flow)
  // - SIGNED_IN: fires after email/password login or Google OAuth callback
  useEffect(() => {
    const electronAPI = typeof window !== "undefined" ? window.electronAPI : null;
    if (!electronAPI?.signedIn) return;  // only needed in Electron
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) afterSignIn();
    });
    return () => subscription.unsubscribe();
  }, [afterSignIn]);

  const signInWithGoogle = async () => {
    // Same acceptance gate as the email signup path. Google sign-in
    // can also create an account, so in signup mode we require the
    // checkbox before kicking off the OAuth round-trip.
    if (mode === "signup" && !termsAccepted) {
      setStatus({
        state: "error",
        message: "Please agree to the Terms of Service and Privacy Policy to continue.",
      });
      return;
    }
    setStatus({ state: "oauth_loading" });
    const supabase = createClient();
    const callbackUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`;

    // Electron desktop: open a dedicated popup window for Google sign-in so
    // the small login window never navigates away to google.com.
    // We ask Supabase for the OAuth URL without auto-redirecting, then hand
    // the URL to the main process which opens a proper BrowserWindow popup.
    const electronAPI = typeof window !== "undefined" ? window.electronAPI : null;
    if (electronAPI?.openOAuth) {
      try {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: callbackUrl, skipBrowserRedirect: true },
        });
        if (error) {
          setStatus({ state: "error", message: error.message });
          return;
        }
        if (!data?.url) {
          // Most likely cause: Google provider isn't enabled in the Supabase
          // dashboard, or the project's site/redirect URLs don't include this
          // origin. Surface a useful hint instead of silent failure.
          setStatus({
            state: "error",
            message:
              "Google sign-in isn't configured for this build. Use email and password, or enable the Google provider in Supabase.",
          });
          return;
        }
        // IPC opens a popup window. Resolves with `{ ok: true }` once we
        // detect the callback redirect, or `{ cancelled: true }` if the user
        // closes the popup without finishing.
        const result = await electronAPI.openOAuth(data.url);
        if (result?.cancelled) {
          setStatus({ state: "idle" });
        }
        // On `ok: true` the main process is already navigating the login
        // window to /auth/callback → /research, so onAuthStateChange will
        // fire SIGNED_IN and afterSignIn() will take over. No status reset
        // needed here — the page is about to leave.
      } catch (err) {
        const message = err instanceof Error ? err.message : "Google sign-in failed.";
        setStatus({ state: "error", message });
      }
      return;
    }

    // Web browser: standard redirect flow
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl },
    });
    if (error) {
      setStatus({ state: "error", message: error.message });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Sign-up acceptance gate (legal hardening pass). Submitting the
    // form in signup mode is the affirmative act; the disclosure
    // appears immediately above the submit button so the agreement is
    // unambiguous. We re-check it here just in case of an unusual
    // submission path (Enter key, automation tool, etc.).
    if (mode === "signup" && !termsAccepted) {
      setStatus({
        state: "error",
        message: "Please agree to the Terms of Service and Privacy Policy to continue.",
      });
      return;
    }
    setStatus({ state: "loading" });

    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) { afterSignIn(); return; }
        setStatus({ state: "needs_confirmation" });
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      afterSignIn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed.";
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

  // Compact (Electron) — flat dark form, no card, no scroll
  if (compact) {
    return (
      <div className="w-full max-w-xs">
        <p className="mb-3 text-center text-xs text-zinc-500">
          {mode === "signup" ? "Create your account" : "Sign in to your account"}
        </p>

        {/* Google OAuth */}
        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={busy || oauthBusy}
          className="mb-3 inline-flex w-full items-center justify-center gap-2.5 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <GoogleIcon />
          {oauthBusy ? "Redirecting…" : "Continue with Google"}
        </button>

        {/* Divider */}
        <div className="mb-3 flex items-center gap-3">
          <div className="flex-1 h-px bg-zinc-800" />
          <span className="text-xs text-zinc-600">or</span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-xs font-medium text-zinc-400">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-xs font-medium text-zinc-400">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
            />
          </div>

          {mode === "signup" && (
            <label className="mt-1 flex items-start gap-2 text-[11px] leading-snug text-zinc-400">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border border-zinc-600 bg-zinc-900 text-zinc-100 accent-zinc-100"
              />
              <span>
                I agree to the{" "}
                <a
                  href="https://realverdict.app/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-zinc-200 underline underline-offset-2 hover:text-white"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  href="https://realverdict.app/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-zinc-200 underline underline-offset-2 hover:text-white"
                >
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          )}

          {status.state === "error" && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {status.message}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || (mode === "signup" && !termsAccepted)}
            className="mt-1 inline-flex h-9 items-center justify-center rounded-lg bg-white text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setStatus({ state: "idle" }); }}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition"
          >
            {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Sign up"}
          </button>
        </div>
      </div>
    );
  }

  // Standard web layout (with card)
  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {mode === "signup" ? "Create your account" : "Welcome back"}
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
          <label htmlFor="email" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Email</label>
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
          <label htmlFor="password" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-100/10"
          />
          {mode === "signup" && (
            <p className="text-xs text-zinc-500">At least 6 characters.</p>
          )}
        </div>

        {mode === "signup" && (
          <label className="flex items-start gap-2.5 text-xs leading-snug text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border border-zinc-300 text-zinc-900 accent-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:accent-zinc-100"
            />
            <span>
              I agree to the{" "}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
              >
                Privacy Policy
              </a>
              .
            </span>
          </label>
        )}

        {status.state === "error" && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {status.message}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || (mode === "signup" && !termsAccepted)}
          className="mt-2 inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setStatus({ state: "idle" }); }}
          className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
        <Link href="/" className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Back home
        </Link>
      </div>
    </div>
  );
}
