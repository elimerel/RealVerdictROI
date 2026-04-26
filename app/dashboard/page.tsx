import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import { getProStatus } from "@/lib/pro";
import {
  DealAnalysis,
  DealInputs,
  formatCurrency,
  formatPercent,
  inputsToSearchParams,
  VerdictTier,
} from "@/lib/calculations";
import { TIER_LABEL, TIER_TAILWIND_TEXT_LIGHT } from "@/lib/tier-constants";

type DealRow = {
  id: string;
  created_at: string;
  address: string | null;
  inputs: DealInputs;
  results: DealAnalysis;
  verdict: string;
};

type PackRow = {
  id: string;
  share_token: string;
  created_at: string;
  address: string | null;
  verdict: string | null;
  walk_away_price: number | null;
  list_price: number | null;
  revoked_at: string | null;
};

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!supabaseEnv().configured) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) {
    redirect("/login?redirect=/dashboard");
  }

  const search = await searchParams;
  const justUpgraded = search.checkout === "success";

  // Packs and Deals are parallel Supabase queries. Both have owner-scoped
  // RLS so the anon/auth client here returns exactly the user's rows.
  const [{ data: deals, error }, { data: packs, error: packsError }, proStatus] =
    await Promise.all([
      supabase
        .from("deals")
        .select("id, created_at, address, inputs, results, verdict")
        .order("created_at", { ascending: false }),
      supabase
        .from("negotiation_packs")
        .select(
          "id, share_token, created_at, address, verdict, walk_away_price, list_price, revoked_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      getProStatus(userRes.user.id),
    ]);

  const rows = (deals ?? []) as DealRow[];
  const packRows = (packs ?? []) as PackRow[];

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950">
      <header className="border-b border-zinc-200/70 bg-white/70 backdrop-blur-sm dark:border-zinc-800/70 dark:bg-black/40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            RealVerdict
          </Link>
          <div className="flex items-center gap-5 text-sm">
            {proStatus.isPro ? (
              <form action="/api/stripe/portal" method="post">
                <button
                  type="submit"
                  className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                  title="Open the Stripe billing portal to manage your subscription"
                >
                  Manage billing
                </button>
              </form>
            ) : (
              <Link
                href="/pricing"
                className="font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                Pricing
              </Link>
            )}
            <span className="hidden text-zinc-500 sm:inline dark:text-zinc-400">
              {userRes.user.email}
            </span>
            <form action="/api/auth/signout?next=/" method="post">
              <button
                type="submit"
                className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-6 py-12">
          {justUpgraded && (
            <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
              <strong>You&apos;re on Pro.</strong> Unlimited verdicts, live
              comps, and saved portfolio are unlocked. Manage your subscription
              anytime from the &quot;Manage billing&quot; link above.
            </div>
          )}

          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Your saved deals
                </h1>
                <PlanBadge isPro={proStatus.isPro} status={proStatus.status} />
              </div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {rows.length === 0
                  ? "No deals saved yet. Analyse one and save it from the results page."
                  : `${rows.length} deal${rows.length === 1 ? "" : "s"} in your portfolio.`}
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              New analysis →
            </Link>
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              Could not load your deals: {error.message}. Make sure the{" "}
              <code>deals</code> table exists — run{" "}
              <code>supabase/migrations/001_deals.sql</code>.
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyDashboard />
          ) : (
            <>
              <PortfolioSummary rows={rows} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((row) => (
                  <DealCard key={row.id} row={row} />
                ))}
              </div>
            </>
          )}

          <PackSection rows={packRows} error={packsError?.message} />
        </div>
      </main>
    </div>
  );
}

function DealCard({ row }: { row: DealRow }) {
  const tier = (row.verdict as VerdictTier) ?? "fair";
  const monthlyCashFlow = row.results?.monthlyCashFlow ?? 0;
  const capRate = row.results?.capRate ?? 0;
  const dscr = row.results?.dscr;
  const price = row.results?.inputs?.purchasePrice ?? row.inputs.purchasePrice;

  const viewHref = `/results?${inputsToSearchParams(row.inputs).toString()}${
    row.address ? `&address=${encodeURIComponent(row.address)}` : ""
  }`;
  const rerunHref = `/?${inputsToSearchParams(row.inputs).toString()}${
    row.address ? `&address=${encodeURIComponent(row.address)}` : ""
  }`;

  const displayDate = new Date(row.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const dscrDisplay =
    dscr != null && isFinite(dscr) ? dscr.toFixed(2) : dscr != null ? "∞" : "—";

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700">
      <Link href={viewHref} className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {row.address || formatCurrency(price, 0) + " deal"}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {formatCurrency(price, 0)} · saved {displayDate}
            </div>
          </div>
          <VerdictBadge tier={tier} />
        </div>
      </Link>

      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Cash flow"
          value={formatCurrency(monthlyCashFlow, 0) + "/mo"}
          tone={monthlyCashFlow >= 0 ? "positive" : "negative"}
        />
        <Stat label="Cap rate" value={formatPercent(capRate)} />
        <Stat label="DSCR" value={dscrDisplay} />
      </div>

      <div className="flex gap-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
        <Link
          href={viewHref}
          className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
        >
          View results
        </Link>
        <Link
          href={rerunHref}
          className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Re-run →
        </Link>
      </div>
    </div>
  );
}

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
    neutral: "text-zinc-900 dark:text-zinc-50",
  }[tone];
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-lg font-semibold ${classes}`}>
        {value}
      </div>
    </div>
  );
}

function VerdictBadge({ tier }: { tier: VerdictTier }) {
  const styles: Record<VerdictTier, string> = {
    excellent:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    fair: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    poor: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    avoid: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  return (
    <span
      className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${styles[tier]}`}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

function PlanBadge({
  isPro,
  status,
}: {
  isPro: boolean;
  status: string | null;
}) {
  if (isPro) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        Pro · {status ?? "active"}
      </span>
    );
  }
  return (
    <Link
      href="/pricing"
      className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
    >
      Free · upgrade
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Pack history section. Hidden entirely when the user has never generated a
// Pack — the main value of this area is "find the link to the Pack I made
// last week," not evangelizing the feature (the /results page does that).
// ---------------------------------------------------------------------------

function PackSection({
  rows,
  error,
}: {
  rows: PackRow[];
  error: string | undefined;
}) {
  // Missing table (migration not run) → soft error banner, no crash. The
  // rest of the dashboard stays usable.
  if (error) {
    return (
      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
        Could not load your Negotiation Packs: {error}. If this is your first
        time deploying, run{" "}
        <code>supabase/migrations/004_negotiation_packs.sql</code> in the
        Supabase SQL editor.
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Your Negotiation Packs
          <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
            {rows.length} generated
          </span>
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <PackCard key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}

function PackCard({ row }: { row: PackRow }) {
  const created = new Date(row.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const title =
    row.address ||
    (row.list_price
      ? `${formatCurrency(row.list_price, 0)} deal`
      : "Untitled Pack");

  const walkAwayDisplay = row.walk_away_price
    ? formatCurrency(row.walk_away_price, 0)
    : "—";
  const tier = (row.verdict as VerdictTier) || "fair";
  const revoked = !!row.revoked_at;

  const viewHref = `/pack/${row.share_token}`;
  const pdfHref = `/pack/${row.share_token}/pdf`;

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 shadow-sm transition ${
        revoked
          ? "border-zinc-200 bg-zinc-50 opacity-70 dark:border-zinc-800 dark:bg-zinc-950"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {created}
            {revoked && " · revoked"}
          </div>
        </div>
        <VerdictBadge tier={tier} />
      </div>

      <div className="flex items-baseline gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Walk-away
        </div>
        <div className="font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {walkAwayDisplay}
        </div>
      </div>

      {!revoked && (
        <div className="flex gap-2 pt-1">
          <Link
            href={viewHref}
            className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Open
          </Link>
          <a
            href={pdfHref}
            className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            PDF
          </a>
        </div>
      )}
    </div>
  );
}

function PortfolioSummary({ rows }: { rows: DealRow[] }) {
  if (rows.length === 0) return null;
  const totalCashFlow = rows.reduce(
    (sum, r) => sum + (r.results?.monthlyCashFlow ?? 0),
    0,
  );
  const avgCapRate =
    rows.reduce((sum, r) => sum + (r.results?.capRate ?? 0), 0) / rows.length;
  const bestTier = rows.reduce<VerdictTier>((best, r) => {
    const order: VerdictTier[] = ["excellent", "good", "fair", "poor", "avoid"];
    const current = (r.verdict as VerdictTier) ?? "fair";
    return order.indexOf(current) < order.indexOf(best) ? current : best;
  }, "avoid");

  return (
    <div className="mb-6 grid grid-cols-3 gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Portfolio cash flow
        </div>
        <div
          className={`mt-1 font-mono text-xl font-semibold ${
            totalCashFlow >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {formatCurrency(totalCashFlow, 0)}/mo
        </div>
      </div>
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Avg cap rate
        </div>
        <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {formatPercent(avgCapRate)}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Best deal
        </div>
        <div
          className={`mt-1 text-sm font-semibold ${TIER_TAILWIND_TEXT_LIGHT[bestTier]}`}
        >
          {TIER_LABEL[bestTier]}
        </div>
      </div>
    </div>
  );
}

function EmptyDashboard() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-950/50">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        No deals saved yet
      </h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        Run an analysis on any listing, then hit &ldquo;Save to portfolio&rdquo; on the results page. Each saved deal shows cash flow, cap rate, and DSCR — plus a Re-run link to re-underwrite with fresh numbers.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex h-9 items-center rounded-md bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700"
      >
        Underwrite a deal →
      </Link>
    </div>
  );
}
