"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import "@/lib/electron";
import { Button } from "@/components/ui/button";

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
      <div className="w-full max-w-md rounded-2xl p-8 rv-shadow-md"
           style={{ background: "var(--rv-surface-1)", border: "1px solid var(--rv-fill-border)" }}>
        <div
          className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: "var(--rv-accent-subtle)", color: "var(--rv-accent)" }}
        >
          ✓
        </div>
        <h1 className="text-xl font-semibold rv-t1" style={{ letterSpacing: "-0.02em" }}>
          Check your email
        </h1>
        <p className="mt-2 text-[13px] rv-t3 leading-relaxed">
          We sent a confirmation link to{" "}
          <span className="font-mono rv-t1">{email}</span>
          . Click it to activate your account, then sign in.
        </p>
        <Button
          type="button"
          onClick={() => {
            setMode("signin");
            setStatus({ state: "idle" });
          }}
          variant="link"
          size="sm"
          className="mt-6 px-0"
        >
          Back to sign in
        </Button>
      </div>
    );
  }

  // Compact (Electron) — flat dark form, no card, no scroll.
  // Rendered inside a `dark`-classed container so --rv-* tokens resolve
  // to dark-mode values against the #0a0a0b Electron login window.
  if (compact) {
    return (
      <div className="w-full max-w-xs">
        <p className="mb-3 text-center text-[11px] rv-t3">
          {mode === "signup" ? "Create your account" : "Sign in to your account"}
        </p>

        {/* Google OAuth */}
        <Button
          type="button"
          onClick={signInWithGoogle}
          disabled={busy || oauthBusy}
          variant="outline"
          className="mb-3 w-full"
        >
          <GoogleIcon />
          {oauthBusy ? "Redirecting…" : "Continue with Google"}
        </Button>

        {/* Divider */}
        <div className="mb-3 flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: "var(--rv-fill-border)" }} />
          <span className="text-[11px] rv-t4">or</span>
          <div className="flex-1 h-px" style={{ background: "var(--rv-fill-border)" }} />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <label htmlFor="email-compact" className="text-[11px] font-medium rv-t3">Email</label>
            <div className="rv-input flex items-center px-3 py-2">
              <input
                id="email-compact"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex-1 bg-transparent text-[13px] rv-t1 placeholder:rv-t4"
                placeholder="you@example.com"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password-compact" className="text-[11px] font-medium rv-t3">Password</label>
            <div className="rv-input flex items-center px-3 py-2">
              <input
                id="password-compact"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex-1 bg-transparent text-[13px] rv-t1"
              />
            </div>
          </div>

          {mode === "signup" && (
            <label className="mt-1 flex items-start gap-2 text-[11px] leading-snug rv-t3">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded"
                style={{ accentColor: "var(--rv-accent)" }}
              />
              <span>
                I agree to the{" "}
                <a
                  href="https://realverdict.app/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rv-t1 underline underline-offset-2"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  href="https://realverdict.app/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rv-t1 underline underline-offset-2"
                >
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          )}

          {status.state === "error" && (
            <div
              className="rounded-lg px-3 py-2 text-[12px]"
              style={{ background: "var(--rv-bad-sub)", color: "var(--rv-bad)", border: "1px solid var(--rv-bad)" }}
            >
              {status.message}
            </div>
          )}

          <Button
            type="submit"
            disabled={busy || (mode === "signup" && !termsAccepted)}
            variant="default"
            className="mt-1 w-full"
          >
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="mt-3 text-center">
          <Button
            type="button"
            onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setStatus({ state: "idle" }); }}
            variant="link"
            size="xs"
            className="text-[11px]"
          >
            {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Sign up"}
          </Button>
        </div>
      </div>
    );
  }

  // Standard web layout (with card)
  return (
    <div
      className="w-full max-w-md rounded-2xl p-8 rv-shadow-md"
      style={{ background: "var(--rv-surface-1)", border: "1px solid var(--rv-fill-border)" }}
    >
      <div className="mb-6 flex flex-col gap-1.5">
        <h1 className="text-[22px] font-semibold rv-t1" style={{ letterSpacing: "-0.022em" }}>
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="text-[13px] rv-t3">
          {mode === "signup"
            ? "Save deals and build your portfolio."
            : "Sign in to access your dashboard."}
        </p>
      </div>

      {/* Google OAuth */}
      <Button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy || oauthBusy}
        variant="outline"
        className="mb-4 w-full"
      >
        <GoogleIcon />
        {oauthBusy ? "Redirecting…" : "Continue with Google"}
      </Button>

      {/* Divider */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: "var(--rv-fill-border)" }} />
        <span className="text-[11px] rv-t4">or</span>
        <div className="flex-1 h-px" style={{ background: "var(--rv-fill-border)" }} />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-[0.08em] rv-t3">
            Email
          </label>
          <div className="rv-input flex items-center px-3 py-2.5">
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 bg-transparent text-[13px] rv-t1 placeholder:rv-t4"
              placeholder="you@example.com"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-[0.08em] rv-t3">
            Password
          </label>
          <div className="rv-input flex items-center px-3 py-2.5">
            <input
              id="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex-1 bg-transparent text-[13px] rv-t1"
            />
          </div>
          {mode === "signup" && (
            <p className="text-[11px] rv-t4">At least 6 characters.</p>
          )}
        </div>

        {mode === "signup" && (
          <label className="flex items-start gap-2.5 text-[12px] leading-snug rv-t3">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded"
              style={{ accentColor: "var(--rv-accent)" }}
            />
            <span>
              I agree to the{" "}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="rv-t1 font-medium underline underline-offset-2"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="rv-t1 font-medium underline underline-offset-2"
              >
                Privacy Policy
              </a>
              .
            </span>
          </label>
        )}

        {status.state === "error" && (
          <div
            className="rounded-lg px-3 py-2 text-[12px] leading-snug"
            style={{ background: "var(--rv-bad-sub)", color: "var(--rv-bad)", border: "1px solid var(--rv-bad)" }}
          >
            {status.message}
          </div>
        )}

        <Button
          type="submit"
          disabled={busy || (mode === "signup" && !termsAccepted)}
          variant="default"
          className="mt-1 w-full"
        >
          {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
        </Button>
      </form>

      <div className="mt-4 flex items-center justify-between text-[13px]">
        <Button
          type="button"
          onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setStatus({ state: "idle" }); }}
          variant="link"
          size="sm"
          className="px-0"
        >
          {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </Button>
        <Link href="/" className="rv-t4 hover:rv-t2 transition-colors">
          Back home
        </Link>
      </div>
    </div>
  );
}
