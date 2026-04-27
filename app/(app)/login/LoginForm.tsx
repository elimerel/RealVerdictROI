"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function LoginForm({
  redirectTo,
  initialMode,
}: {
  redirectTo: string;
  initialMode: Mode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "error"; message: string }
    | { state: "needs_confirmation" }
  >({ state: "idle" });

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
    <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-6 flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {mode === "signup"
            ? "Create your RealVerdict account"
            : "Welcome back"}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {mode === "signup"
            ? "Save your deals, build a portfolio of analyses, and keep them all in one place."
            : "Sign in to save this deal and access your dashboard."}
        </p>
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

      <div className="mt-5 flex items-center justify-between text-sm">
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
        <Link
          href="/"
          className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
