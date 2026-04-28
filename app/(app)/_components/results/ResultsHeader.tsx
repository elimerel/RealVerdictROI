import Link from "next/link";
import { Suspense } from "react";
import { ResultsNav } from "./ResultsNav";
import type { DealInputs } from "@/lib/calculations";

export default function ResultsHeader({
  editHref,
  currentUrl,
  supabaseConfigured,
  signedIn,
  inputs,
  address,
  isPro,
}: {
  editHref: string;
  currentUrl: string;
  supabaseConfigured: boolean;
  signedIn: boolean;
  inputs?: DealInputs;
  address?: string;
  isPro?: boolean;
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
        {/* ResultsNav is a client component — Suspense required by Next.js for useSearchParams */}
        <Suspense fallback={null}>
          <ResultsNav
            editHref={editHref}
            currentUrl={currentUrl}
            supabaseConfigured={supabaseConfigured}
            signedIn={signedIn}
            inputs={inputs}
            address={address}
            isPro={isPro}
          />
        </Suspense>
      </div>
    </header>
  );
}
