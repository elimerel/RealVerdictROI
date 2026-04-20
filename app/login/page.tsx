import Link from "next/link";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; mode?: string }>;
}) {
  const sp = await searchParams;
  const redirectTo =
    typeof sp.redirect === "string" && sp.redirect.startsWith("/")
      ? sp.redirect
      : "/dashboard";

  // If already signed in, skip straight to the destination.
  const user = await getCurrentUser();
  if (user) redirect(redirectTo);

  const initialMode: "signin" | "signup" =
    sp.mode === "signup" ? "signup" : "signin";

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950">
      <header className="border-b border-zinc-200/70 bg-white/70 backdrop-blur-sm dark:border-zinc-800/70 dark:bg-black/40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white dark:bg-white dark:text-zinc-900">
              RV
            </span>
            <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              RealVerdict<span className="text-zinc-400">ROI</span>
            </span>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        {supabaseEnv().configured ? (
          <LoginForm redirectTo={redirectTo} initialMode={initialMode} />
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
        in your <code>.env.local</code>, then run the SQL in{" "}
        <code>supabase/migrations/001_deals.sql</code>. Restart the dev server
        after.
      </p>
    </div>
  );
}
