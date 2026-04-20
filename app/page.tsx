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

      <section className="border-b border-zinc-200/70 dark:border-zinc-800/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
          <div className="flex max-w-3xl flex-col gap-6">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Honest numbers. No spreadsheet required.
            </span>
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-6xl dark:text-zinc-50">
              An honest verdict on your next{" "}
              <span className="bg-gradient-to-r from-emerald-500 via-sky-500 to-indigo-500 bg-clip-text text-transparent">
                real estate deal.
              </span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-300">
              Plug in the numbers — purchase price, financing, rent, expenses —
              and get the full picture: cash flow, cap rate, DSCR, IRR, a
              year-by-year projection, and a plain-English recommendation on
              whether the deal is actually worth pursuing.
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <Feature>Mortgage amortisation</Feature>
              <Feature>10+ investor metrics</Feature>
              <Feature>Hold-period IRR</Feature>
              <Feature>Shareable URLs</Feature>
            </div>
          </div>
        </div>
      </section>

      <main id="analyze" className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-16">
          <div className="mb-10 flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Your deal
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Pre-filled with a typical US rental. Edit anything — the preview
              on the right updates instantly.
            </p>
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

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/60 px-3 py-1 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-3.5 w-3.5 text-emerald-500"
      >
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4L8.5 12l6.8-6.8a1 1 0 011.4 0z"
          clipRule="evenodd"
        />
      </svg>
      {children}
    </span>
  );
}
