import Link from "next/link";

export default function ProCompsTeaser({ returnTo }: { returnTo: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 sm:p-10">
      <div className="mx-auto max-w-lg text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
          Pro feature
        </p>
        <h2 className="mt-2 text-xl font-semibold text-zinc-100 sm:text-2xl">
          Live sale and rent comps
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          See nearby listings, medians, and a reality check on your rent and
          purchase assumptions — included with RealVerdict Pro.
        </p>
        <div
          className="relative mx-auto mt-8 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80"
          aria-hidden="true"
        >
          <div className="grid grid-cols-2 gap-0 opacity-40 blur-[2px] select-none pointer-events-none">
            <div className="border-r border-b border-zinc-800 p-4 text-left text-[10px] text-zinc-500">
              Address
            </div>
            <div className="border-b border-zinc-800 p-4 text-right text-[10px] text-zinc-500">
              Price
            </div>
            <div className="border-r border-zinc-800 p-3 text-xs text-zinc-600">
              …
            </div>
            <div className="p-3 text-right font-mono text-xs text-zinc-600">
              $—
            </div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60">
            <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-300">
              Preview
            </span>
          </div>
        </div>
        <Link
          href={`/pricing?redirect=${encodeURIComponent(returnTo)}`}
          className="mt-8 inline-flex h-11 min-h-[44px] w-full items-center justify-center rounded-full bg-zinc-100 px-6 text-sm font-semibold text-zinc-900 transition hover:bg-white sm:w-auto"
        >
          Unlock Comps with Pro
        </Link>
      </div>
    </div>
  );
}
