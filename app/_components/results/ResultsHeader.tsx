import Link from "next/link";

// ---------------------------------------------------------------------------
// Top nav for /results. Kept in its own file so the main page module stays
// focused on data fetching + section composition. Matches the homepage
// header visually (both use max-w-6xl + border-b) but renders on the dark
// results theme so it needs its own style.
// ---------------------------------------------------------------------------

export default function ResultsHeader({
  editHref,
  currentUrl,
  supabaseConfigured,
  signedIn,
}: {
  editHref: string;
  currentUrl: string;
  supabaseConfigured: boolean;
  signedIn: boolean;
}) {
  return (
    <header className="border-b border-zinc-900">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-zinc-100"
        >
          RealVerdict
        </Link>
        <nav className="flex items-center gap-3 sm:gap-5 text-sm">
          <Link
            href={editHref}
            className="font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            Edit
          </Link>
          <Link
            href="/compare"
            className="font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            Compare
          </Link>
          <Link
            href="/pricing"
            className="hidden sm:inline font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            Pricing
          </Link>
          {supabaseConfigured &&
            (signedIn ? (
              <Link
                href="/dashboard"
                className="font-medium text-zinc-400 transition hover:text-zinc-100"
              >
                Deals
              </Link>
            ) : (
              <Link
                href={`/login?redirect=${encodeURIComponent(currentUrl)}`}
                className="font-medium text-zinc-400 transition hover:text-zinc-100"
              >
                Sign in
              </Link>
            ))}
        </nav>
      </div>
    </header>
  );
}
