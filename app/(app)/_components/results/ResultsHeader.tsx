"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, BookmarkPlus, Check, Loader2 } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { DealInputs } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// App-shell header for /results — replaces the old standalone web-page header.
// Matches the visual language of Research and Leads page headers:
// h-14, SidebarTrigger, breadcrumb/back, actions on the right.
//
// fromelec: true when the user came from Research → Analyze → Results
//   (?fromelec=1 in URL). Shows a "← Research" back button in that path.
// ---------------------------------------------------------------------------

export default function ResultsHeader({
  editHref,
  currentUrl,
  supabaseConfigured,
  signedIn,
  isPro,
  inputs,
  address,
  fromelec,
}: {
  editHref: string;
  currentUrl: string;
  supabaseConfigured: boolean;
  signedIn: boolean;
  isPro: boolean;
  inputs: DealInputs;
  address?: string;
  fromelec: boolean;
}) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  const handleSave = async () => {
    if (!signedIn) {
      router.push(
        `/login?mode=signup&redirect=${encodeURIComponent(currentUrl)}`,
      );
      return;
    }
    if (!isPro) {
      router.push(`/pricing?redirect=${encodeURIComponent(currentUrl)}`);
      return;
    }
    setSaveState("saving");
    try {
      const res = await fetch("/api/deals/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, address }),
      });
      if (!res.ok) {
        setSaveState("error");
        return;
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  return (
    <header className="h-14 flex items-center gap-3 border-b border-border px-4 shrink-0">
      <SidebarTrigger className="-ml-1" />

      {fromelec ? (
        <button
          type="button"
          onClick={() => window.history.back()}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Research
        </button>
      ) : (
        address && (
          <span className="text-sm text-muted-foreground truncate min-w-0 hidden sm:block">
            {address}
          </span>
        )
      )}

      <span className="flex-1" />

      <nav className="flex items-center gap-1 shrink-0">
        <Link
          href={editHref}
          className="px-2 py-1 rounded text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          Edit
        </Link>
        <Link
          href="/compare"
          className="px-2 py-1 rounded text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          Compare
        </Link>
        {supabaseConfigured && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === "saving" || saveState === "saved"}
            className="ml-1 flex items-center gap-1.5 h-8 rounded-md border border-border bg-muted/40 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveState === "saved" ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400">Saved</span>
              </>
            ) : saveState === "saving" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Saving</span>
              </>
            ) : (
              <>
                <BookmarkPlus className="h-3.5 w-3.5" />
                <span>{signedIn && isPro ? "Save" : "Save (Pro)"}</span>
              </>
            )}
          </button>
        )}
      </nav>
    </header>
  );
}
