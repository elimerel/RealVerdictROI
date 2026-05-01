import Link from "next/link";
import { TrendingUp } from "lucide-react";

/**
 * Shared marketing-site footer.
 *
 * Includes Terms / Privacy / Report a concern links — required by the
 * legal hardening pass. The disclaimer line below the link row is the
 * existing analytical-tool framing carried forward from individual
 * footer copies (consistency check passed during the audit).
 *
 * Use this on every marketing page so links stay in sync; if they ever
 * diverge, the legal posture risks getting brittle.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-zinc-200/80 dark:border-zinc-800/80 py-10">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <Link href="/" className="flex items-center gap-2 self-start">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-50">
              <TrendingUp className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
            </div>
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              RealVerdict
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500 dark:text-zinc-500">
            <Link href="/about"        className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">About</Link>
            <Link href="/methodology"  className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Methodology</Link>
            <Link href="/pricing"      className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Pricing</Link>
            <Link href="/download"     className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Download</Link>
            <Link href="/deals"        className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Web app</Link>
            <span aria-hidden className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link href="/terms"        className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Terms</Link>
            <Link href="/privacy"      className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Privacy</Link>
            <Link href="/report"       className="hover:text-zinc-900 dark:hover:text-zinc-200 transition">Report a concern</Link>
          </nav>
        </div>
        <p className="mt-6 max-w-3xl text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
          RealVerdict is an analytical tool for educational purposes. Always
          verify property data and consult licensed professionals before
          making real estate decisions. Outputs are not investment advice or
          recommendations.
        </p>
      </div>
    </footer>
  );
}
