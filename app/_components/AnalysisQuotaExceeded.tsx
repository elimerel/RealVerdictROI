import Link from "next/link";

export default function AnalysisQuotaExceeded({
  retryAfter,
  returnTo,
}: {
  retryAfter: number;
  returnTo: string;
}) {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  const pricingHref = `/pricing?redirect=${encodeURIComponent(returnTo)}`;
  return (
    <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 p-8 text-center">
      <h2 className="text-lg font-semibold text-amber-100">
        Weekly analysis limit reached
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-amber-200/90">
        Free accounts can run a limited number of full reports per week. Try
        again in about {minutes} minute{minutes === 1 ? "" : "s"}, or upgrade to
        Pro for unlimited analyses.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          href={pricingHref}
          className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-full bg-zinc-100 px-6 text-sm font-semibold text-zinc-900 transition hover:bg-white"
        >
          Upgrade to Pro
        </Link>
        <Link
          href="/"
          className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-full border border-amber-500/50 px-6 text-sm font-semibold text-amber-100 transition hover:border-amber-400"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
