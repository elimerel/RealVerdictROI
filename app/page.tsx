import Link from "next/link";
import AnalysisForm from "./_components/AnalysisForm";
import { supabaseEnv } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";

export default async function Home() {
  const authEnabled = supabaseEnv().configured;
  const user = authEnabled ? await getCurrentUser() : null;
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
          <nav className="flex items-center gap-5 text-sm">
            <a
              href="#analyze"
              className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Analyze a deal
            </a>
            {authEnabled &&
              (user ? (
                <Link
                  href="/dashboard"
                  className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Sign in
                </Link>
              ))}
          </nav>
        </div>
      </header>

      <main id="analyze" className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-6 pt-12 pb-16 sm:pt-16">
          <div className="mb-10 flex max-w-3xl flex-col gap-4">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
              An honest verdict on any{" "}
              <span className="bg-gradient-to-r from-emerald-500 via-sky-500 to-indigo-500 bg-clip-text text-transparent">
                rental deal
              </span>
              .
            </h1>
            <p className="text-base leading-relaxed text-zinc-600 sm:text-lg dark:text-zinc-300">
              Cash flow, cap rate, DSCR, IRR, a 10-year projection, and a
              plain-English AI recommendation — in under a minute.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              <Pill>No spreadsheet</Pill>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <Pill>AI-powered</Pill>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <Pill>Free to start</Pill>
            </div>
          </div>
          <AnalysisForm />
        </div>
      </main>

      <footer className="border-t border-zinc-200/70 dark:border-zinc-800/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 text-xs text-zinc-500 dark:text-zinc-500">
          RealVerdictROI is an analytical tool for educational purposes. Always
          verify assumptions with a qualified agent, lender, and tax advisor
          before making an offer.
        </div>
      </footer>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
      {children}
    </span>
  );
}
