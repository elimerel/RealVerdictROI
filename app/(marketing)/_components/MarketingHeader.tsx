import Link from "next/link";

/**
 * Shared marketing-site header for inner pages (Terms, Privacy,
 * Report). The home page uses its own bespoke hero header.
 */
export function MarketingHeader() {
  return (
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
            href="/methodology"
            className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Methodology
          </Link>
          <Link
            href="/pricing"
            className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Pricing
          </Link>
          <Link
            href="/download"
            className="font-medium text-zinc-900 dark:text-zinc-50"
          >
            Download
          </Link>
        </nav>
      </div>
    </header>
  );
}
