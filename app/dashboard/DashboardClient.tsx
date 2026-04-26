"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, Building2, MapPin, TrendingUp } from "lucide-react";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  type DealAnalysis,
  type DealInputs,
  type VerdictTier,
  analyseDeal,
  formatCurrency,
  formatPercent,
  inputsToSearchParams,
  sanitiseInputs,
} from "@/lib/calculations";
import { normalizeCacheKey, sessionGet, sessionSet } from "@/lib/client-session-cache";

// ── Types ───────────────────────────────────────────────────────────────────

export type DealRow = {
  id: string;
  created_at: string;
  address: string | null;
  inputs: DealInputs;
  results: DealAnalysis;
  verdict: string;
};

export type PackRow = {
  id: string;
  share_token: string;
  created_at: string;
  address: string | null;
  verdict: string | null;
  walk_away_price: number | null;
  list_price: number | null;
  revoked_at: string | null;
};

type Props = {
  deals: DealRow[];
  packs: PackRow[];
  isPro: boolean;
  proStatus: string | null;
  userEmail: string | undefined;
  justUpgraded: boolean;
};

// ── Autofill cache (same contract as HomeAnalyzeForm) ───────────────────────

const AUTOFILL_CACHE_VERSION = "v4";
const AUTOFILL_CACHE_NS = `autofill:${AUTOFILL_CACHE_VERSION}`;
const AUTOFILL_CACHE_TTL_MS = 30 * 60 * 1000;

type ResolverPayload = {
  address?: string;
  inputs: Partial<DealInputs>;
  provenance: Record<string, unknown>;
  facts: Record<string, unknown>;
  notes: string[];
  warnings: string[];
};

// ── Derived stats from real deals ───────────────────────────────────────────

function deriveQuickStats(deals: DealRow[]) {
  const count = deals.length;
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = deals.filter(
    (d) => new Date(d.created_at).getTime() > oneWeekAgo,
  ).length;

  const irrValues = deals
    .map((d) => d.results?.irr)
    .filter((v): v is number => typeof v === "number" && isFinite(v) && v > -1);
  const avgIRR =
    irrValues.length > 0
      ? irrValues.reduce((a, b) => a + b, 0) / irrValues.length
      : null;

  return [
    { label: "Properties Analyzed", value: count.toLocaleString() },
    {
      label: "Avg. IRR",
      value: avgIRR !== null ? formatPercent(avgIRR, 1) : "—",
    },
    { label: "Deals This Week", value: String(thisWeek) },
  ];
}

function deriveRecentSearches(deals: DealRow[]) {
  return deals
    .slice(0, 3)
    .filter((d) => d.address)
    .map((d) => ({ type: "address" as const, value: d.address! }));
}

// ── Main component ───────────────────────────────────────────────────────────

export default function DashboardClient({
  deals,
  packs,
  isPro,
  proStatus,
  userEmail,
  justUpgraded,
}: Props) {
  const router = useRouter();
  const [searchValue, setSearchValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const quickStats = deriveQuickStats(deals);
  const recentSearches = deriveRecentSearches(deals);

  const isZillowUrl = searchValue.includes("zillow.com");
  const detectMode = (text: string): "zillow" | "address" | null => {
    if (!text.trim()) return null;
    if (/zillow\.com\/homedetails/i.test(text)) return "zillow";
    if (/\d/.test(text) && text.trim().length >= 6) return "address";
    return null;
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = searchValue.trim();
    const mode = detectMode(text);
    if (!mode) {
      setErrorMsg("Enter a street address or a Zillow listing URL.");
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);

    // Client-side cache — same 30-min TTL as HomeAnalyzeForm
    const cacheId = normalizeCacheKey(text);
    const cached = sessionGet<ResolverPayload>(AUTOFILL_CACHE_NS, cacheId);

    if (cached) {
      const params = buildResultsParams(cached);
      router.push(`/results?${params.toString()}`);
      return;
    }

    try {
      const res =
        mode === "zillow"
          ? await fetch("/api/property-resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: text }),
            })
          : await fetch(
              `/api/property-resolve?address=${encodeURIComponent(text)}`,
            );

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        const msg =
          (typeof payload?.message === "string" && payload.message) ||
          (typeof payload?.error === "string" &&
          payload.error.length < 120 &&
          !/HTTP \d{3}|stack|trace|api[\s_-]?key/i.test(payload.error)
            ? payload.error
            : null) ||
          "Couldn't resolve that property. Try again or fill inputs manually.";
        throw new Error(msg);
      }

      const resolved = (await res.json()) as ResolverPayload;
      sessionSet(AUTOFILL_CACHE_NS, cacheId, resolved, AUTOFILL_CACHE_TTL_MS);
      const params = buildResultsParams(resolved);
      router.push(`/results?${params.toString()}`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Auto-fill failed. Try again.",
      );
      setIsLoading(false);
    }
  };

  return (
    <SidebarInset>
      {/* Header */}
      <header className="h-14 flex items-center gap-4 border-b border-border px-4 justify-between">
        <div className="flex items-center gap-4">
          <SidebarTrigger className="-ml-1" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Search className="h-4 w-4" />
            <span>Property Discovery</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {isPro ? (
            <form action="/api/stripe/portal" method="post">
              <button
                type="submit"
                className="font-medium text-muted-foreground hover:text-foreground transition"
              >
                Manage billing
              </button>
            </form>
          ) : (
            <Link
              href="/pricing"
              className="font-medium text-muted-foreground hover:text-foreground transition"
            >
              Upgrade to Pro
            </Link>
          )}
          <span className="hidden text-muted-foreground sm:inline">{userEmail}</span>
          <form action="/api/auth/signout?next=/" method="post">
            <button
              type="submit"
              className="font-medium text-muted-foreground hover:text-foreground transition"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4 pb-24">
        <div className="w-full max-w-2xl space-y-8">
          {justUpgraded && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
              <strong>You&apos;re on Pro.</strong> Unlimited verdicts, live
              comps, and saved portfolio are unlocked.
            </div>
          )}

          {/* Hero */}
          <div className="text-center space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Analyze any rental property
            </h1>
            <p className="text-muted-foreground text-balance">
              Paste a Zillow URL or enter an address to get instant investment
              analysis
            </p>
          </div>

          {/* Search Input */}
          <form onSubmit={handleSearch} className="relative">
            <div
              className={cn(
                "relative rounded-lg border bg-card/50 backdrop-blur-sm transition-all duration-200",
                isFocused
                  ? "border-foreground/20 ring-1 ring-foreground/10"
                  : "border-border",
              )}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                {isZillowUrl ? (
                  <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                ) : (
                  <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
                )}
                <Input
                  type="text"
                  placeholder="zillow.com/homedetails/... or 123 Main St, City, ST"
                  value={searchValue}
                  onChange={(e) => {
                    setSearchValue(e.target.value);
                    setErrorMsg(null);
                  }}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  className="border-0 bg-transparent p-0 text-base placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!searchValue.trim() || isLoading}
                  className="shrink-0 gap-1.5"
                >
                  {isLoading ? "Fetching…" : "Analyze"}
                  {!isLoading && <ArrowRight className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            {/* Input type indicator / error */}
            {(searchValue || errorMsg) && (
              <div className="absolute -bottom-6 left-4 text-xs text-muted-foreground">
                {errorMsg ? (
                  <span className="text-amber-700 dark:text-amber-400">
                    {errorMsg}
                  </span>
                ) : isZillowUrl ? (
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    Zillow listing detected
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Address search
                  </span>
                )}
              </div>
            )}
          </form>

          {/* Recent Searches — addresses from saved deals */}
          {recentSearches.length > 0 && (
            <div className="pt-6 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Recent Deals
              </p>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((search, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSearchValue(search.value)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground bg-muted/50 hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="truncate max-w-[200px]">{search.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Saved Deals Grid */}
          {deals.length > 0 && (
            <div className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Your Portfolio
                  <span className="ml-2 normal-case font-normal">
                    {deals.length} deal{deals.length !== 1 ? "s" : ""}
                  </span>
                </p>
                {!isPro && (
                  <Link
                    href="/pricing"
                    className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Upgrade for unlimited
                  </Link>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {deals.slice(0, 4).map((row) => (
                  <DealCard key={row.id} row={row} />
                ))}
              </div>
              {deals.length > 4 && (
                <Link
                  href="/dashboard/portfolio"
                  className="block text-center text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  View all {deals.length} deals
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Quick Stats Footer */}
        {deals.length > 0 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
            <div className="flex items-center gap-8 text-sm">
              {quickStats.map((stat, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-muted-foreground"
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  <span>{stat.label}:</span>
                  <span className="font-mono text-foreground">{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {deals.length === 0 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-xs text-muted-foreground text-center">
            Analyze a property above → save it from the verdict page to build
            your portfolio.
          </div>
        )}
      </div>
    </SidebarInset>
  );
}

// ── Deal Card ────────────────────────────────────────────────────────────────

function DealCard({ row }: { row: DealRow }) {
  const tier = (row.verdict as VerdictTier) ?? "fair";

  // Re-derive analysis from inputs so we always show fresh numbers
  let analysis: DealAnalysis | null = null;
  try {
    analysis = analyseDeal(sanitiseInputs(row.inputs));
  } catch {
    analysis = null;
  }

  const monthlyCashFlow = analysis?.monthlyCashFlow ?? row.results?.monthlyCashFlow ?? 0;
  const capRate = analysis?.capRate ?? row.results?.capRate ?? 0;
  const cocReturn = analysis?.cashOnCashReturn ?? row.results?.cashOnCashReturn ?? 0;
  const dscr = analysis?.dscr ?? row.results?.dscr ?? 0;
  const price = row.inputs.purchasePrice;

  const href = `/results?${inputsToSearchParams(row.inputs).toString()}${
    row.address ? `&address=${encodeURIComponent(row.address)}` : ""
  }`;

  const displayDate = new Date(row.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-foreground/20 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {row.address || formatCurrency(price, 0) + " deal"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {formatCurrency(price, 0)} · {displayDate}
          </div>
        </div>
        <VerdictBadge tier={tier} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Cash flow / mo"
          value={formatCurrency(monthlyCashFlow, 0)}
          tone={monthlyCashFlow >= 0 ? "positive" : "negative"}
        />
        <Stat label="Cap rate" value={formatPercent(capRate)} />
        <Stat label="CoC return" value={formatPercent(cocReturn)} />
        <Stat
          label="DSCR"
          value={isFinite(dscr) ? dscr.toFixed(2) : "∞"}
          tone={dscr >= 1.25 ? "positive" : dscr >= 1.0 ? "neutral" : "negative"}
        />
      </div>
    </Link>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const classes = {
    positive: "text-emerald-600 dark:text-emerald-400",
    negative: "text-red-600 dark:text-red-400",
    neutral: "text-foreground",
  }[tone];
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-base font-semibold ${classes}`}>
        {value}
      </div>
    </div>
  );
}

const VERDICT_STYLES: Record<VerdictTier, string> = {
  excellent:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  good: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  fair: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  poor: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  avoid: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function VerdictBadge({ tier }: { tier: VerdictTier }) {
  return (
    <span
      className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${VERDICT_STYLES[tier]}`}
    >
      {tier}
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildResultsParams(resolved: ResolverPayload): URLSearchParams {
  const inputs = resolved.inputs as Partial<DealInputs>;
  const params = new URLSearchParams();
  if (inputs.purchasePrice) params.set("purchasePrice", String(inputs.purchasePrice));
  if (inputs.monthlyRent) params.set("monthlyRent", String(inputs.monthlyRent));
  if (inputs.annualPropertyTax)
    params.set("annualPropertyTax", String(inputs.annualPropertyTax));
  if (inputs.annualInsurance)
    params.set("annualInsurance", String(inputs.annualInsurance));
  if (inputs.monthlyHOA) params.set("monthlyHOA", String(inputs.monthlyHOA));
  if (inputs.loanInterestRate)
    params.set("loanInterestRate", String(inputs.loanInterestRate));
  if (inputs.annualAppreciationPercent)
    params.set("annualAppreciationPercent", String(inputs.annualAppreciationPercent));
  if (resolved.address) params.set("address", resolved.address);
  return params;
}
