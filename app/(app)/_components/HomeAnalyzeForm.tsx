"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  analyseDeal,
  DEFAULT_INPUTS,
  formatCurrency,
  formatPercent,
  inputsToSearchParams,
  sanitiseInputs,
  type DealInputs,
  type VerdictTier,
} from "@/lib/calculations";
import { trackEvent } from "./Analytics";
import {
  normalizeCacheKey,
  sessionGet,
  sessionSet,
} from "@/lib/client-session-cache";

// Bump when the resolver response shape changes so stale entries from an
// older deploy can't leak through into a fresh session.
// v3: bumped with resolver v13. Two changes force a client-cache miss:
//   - State now propagated explicitly from the Zillow URL flow (§16.U #2)
//     so insurance / tax estimates land in the right state on cached
//     autofills that previously had `state: undefined`.
//   - User-facing notes are now sanitized (§16.U #4); cached payloads
//     might still carry "RentCast: Property record: invalid RentCast API
//     key" strings that need to drop out of the UI.
// v4: bumped with resolver v15 (§20.8). The resolver no longer pulls
//   comps; rent now falls back to Zillow's rent Zestimate during autofill
//   (was the comp-derived median in v3). Any cached v3 entry carries a
//   rent-comps provenance that's no longer accurate for the fast path
//   and must be dropped.
const AUTOFILL_CACHE_VERSION = "v4";
const AUTOFILL_CACHE_NS = `autofill:${AUTOFILL_CACHE_VERSION}`;
// 30 min — long enough to cover "analyse, edit, go back, retype the same
// address" sessions, short enough that we don't hand the user data that's
// materially out of date (rates and FRED/FHFA values refresh daily).
const AUTOFILL_CACHE_TTL_MS = 30 * 60 * 1000;

// Separate cache that /results reads to surface the resolver's `warnings[]`
// as a banner (e.g. "Zillow scraper offline; used public records only").
// Keyed by canonical address so it survives the hop from "/" → "/results"
// without needing the raw input text.
const RESULTS_WARNINGS_NS = `results-warnings:${AUTOFILL_CACHE_VERSION}`;
const RESULTS_WARNINGS_TTL_MS = 30 * 60 * 1000;

type FieldProvenance = {
  source:
    | "rentcast"
    | "rent-comps"
    | "zillow-listing"
    | "state-average"
    | "state-investor-rate"
    | "national-average"
    | "fred"
    | "fhfa-hpi"
    | "fema-nfhl"
    | "default"
    | "user";
  confidence: "high" | "medium" | "low";
  note: string;
};

type ProvenanceState = Partial<Record<keyof DealInputs, FieldProvenance>>;

type Props = {
  initialInputs?: Partial<DealInputs>;
  initialAddress?: string;
  /**
   * Seed per-field provenance before the user does anything. Used by the
   * homepage to surface live macro data (e.g. FRED mortgage rate) the moment
   * the page loads, so the first-paint interest rate already has a source
   * badge instead of looking like a stale default.
   */
  initialProvenance?: ProvenanceState;
};

type PropertyFacts = {
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  propertyType?: string;
  lastSalePrice?: number;
  lastSaleDate?: string;
  floodZone?: {
    zone: string;
    risk: "high" | "moderate" | "low";
    label: string;
    isCoastalHigh: boolean;
  };
};

type LookupStatus =
  | { state: "idle" }
  | { state: "loading"; mode: "address" | "zillow" }
  | {
      state: "ok";
      mode: "address" | "zillow";
      notes: string[];
      warnings: string[];
      facts?: PropertyFacts;
      address?: string;
    }
  | { state: "error"; message: string }
  // Dedicated branch for 429s so we can render a specific, readable banner
  // with a retry-after hint instead of the generic error card.
  | { state: "rate_limited"; retryAfter: number };

const SOURCE_LABEL: Record<FieldProvenance["source"], string> = {
  rentcast: "RentCast",
  "rent-comps": "Rent comps",
  "zillow-listing": "Zillow",
  "state-average": "State avg",
  "state-investor-rate": "Investor rate",
  "national-average": "Estimate",
  fred: "FRED",
  "fhfa-hpi": "FHFA HPI",
  "fema-nfhl": "FEMA NFHL",
  default: "Default",
  user: "",
};

const CONFIDENCE_TONE: Record<FieldProvenance["confidence"], string> = {
  high: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  medium: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  low: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

import { TIER_LABEL, TIER_TAILWIND_TEXT_LIGHT as TIER_COLOR } from "@/lib/tier-constants";

export default function HomeAnalyzeForm({
  initialInputs,
  initialAddress = "",
  initialProvenance,
}: Props) {
  const router = useRouter();

  const [address, setAddress] = useState(initialAddress);
  const [lookupInput, setLookupInput] = useState(initialAddress);
  const [lookup, setLookup] = useState<LookupStatus>({ state: "idle" });
  const [provenance, setProvenance] = useState<ProvenanceState>(
    initialProvenance ?? {},
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inputs, setInputs] = useState<DealInputs>({
    ...DEFAULT_INPUTS,
    ...initialInputs,
  });

  const analysis = useMemo(() => {
    try {
      return analyseDeal(sanitiseInputs(inputs));
    } catch {
      return null;
    }
  }, [inputs]);

  const update = <K extends keyof DealInputs>(key: K, value: number) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setProvenance((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const detectInputType = (text: string): "zillow" | "address" | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (/zillow\.com\/homedetails/i.test(trimmed)) return "zillow";
    if (/\d/.test(trimmed) && trimmed.length >= 6) return "address";
    return null;
  };

  // Shape the resolver returns. Extracted so the sessionStorage cache entry
  // is typed identically to a live response — a cache hit and a fresh fetch
  // go through the same apply path, eliminating drift between them.
  type ResolverPayload = {
    address?: string;
    inputs: Partial<DealInputs>;
    provenance: ProvenanceState;
    facts: PropertyFacts;
    notes: string[];
    warnings: string[];
  };

  const applyResolvedPayload = (
    resolved: ResolverPayload,
    mode: "zillow" | "address",
    fromCache: boolean,
  ): boolean => {
    const filledKeys = Object.keys(resolved.inputs) as Array<keyof DealInputs>;
    const factsKnown = Object.values(resolved.facts ?? {}).some((v) => !!v);

    if (filledKeys.length === 0 && !factsKnown) {
      setLookup({
        state: "error",
        message:
          mode === "zillow"
            ? "We couldn't read that Zillow listing. The page may be private or the scraper is offline. Try the address by itself instead."
            : "We couldn't find data for that address. Fill in the basics manually below — the engine works the same.",
      });
      return false;
    }

    setInputs((prev) => ({ ...prev, ...resolved.inputs }));
    setProvenance((prev) => ({ ...prev, ...resolved.provenance }));
    if (resolved.address) setAddress(resolved.address);

    // If anything outside the four headline fields got auto-filled (HOA,
    // tax, insurance, etc.), pop the advanced section open so the user can
    // see what we changed.
    const advancedFilled = filledKeys.some(
      (k) =>
        k !== "purchasePrice" &&
        k !== "monthlyRent" &&
        k !== "downPaymentPercent" &&
        k !== "loanInterestRate",
    );
    if (advancedFilled) setShowAdvanced(true);

    const notes: string[] = [];
    if (resolved.inputs.monthlyRent)
      notes.push(`Rent ${formatCurrency(resolved.inputs.monthlyRent)}/mo`);
    if (resolved.inputs.purchasePrice)
      notes.push(`Price ${formatCurrency(resolved.inputs.purchasePrice)}`);
    if (resolved.inputs.annualPropertyTax)
      notes.push(
        `Tax ${formatCurrency(resolved.inputs.annualPropertyTax)}/yr`,
      );
    if (resolved.inputs.monthlyHOA)
      notes.push(`HOA ${formatCurrency(resolved.inputs.monthlyHOA)}/mo`);
    notes.push(...(resolved.notes ?? []));

    setLookup({
      state: "ok",
      mode,
      notes,
      warnings: resolved.warnings ?? [],
      facts: resolved.facts,
      address: resolved.address,
    });
    trackEvent("Autofill Succeeded", {
      mode,
      filledFields: filledKeys.length,
      hasFacts: factsKnown,
      fromCache,
    });
    return true;
  };

  const handleAutoFill = async () => {
    const text = lookupInput.trim();
    const mode = detectInputType(text);
    if (!mode) {
      setLookup({
        state: "error",
        message: "Enter a street address or a Zillow listing URL.",
      });
      return;
    }

    // Stage 2 RentCast optimization — skip the network round trip entirely
    // when we've resolved this exact address/URL within the last 30 minutes.
    // Complements the server-side 24h KVCache (Redis-backed, cross-lambda);
    // sessionStorage is the one reliable way to skip the round trip entirely
    // for same-session retypes, since even a Redis lookup costs a network hop.
    const cacheId = normalizeCacheKey(text);
    const cached = sessionGet<ResolverPayload>(AUTOFILL_CACHE_NS, cacheId);
    if (cached) {
      setLookup({ state: "loading", mode });
      trackEvent("Autofill Started", { mode, cache: "hit" });
      applyResolvedPayload(cached, mode, true);
      return;
    }

    setLookup({ state: "loading", mode });
    trackEvent("Autofill Started", { mode, cache: "miss" });

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

      // Handle rate-limited responses up-front so the UI can show a clear
      // "retry in N seconds" card instead of a generic error. The server
      // sends both a JSON `retryAfter` field and a Retry-After header —
      // prefer the header since it's the standard contract.
      if (res.status === 429) {
        const headerRetry = Number(res.headers.get("Retry-After"));
        let bodyRetry = 0;
        try {
          const body = (await res.json()) as { retryAfter?: number };
          bodyRetry = Number(body?.retryAfter ?? 0);
        } catch {
          // non-JSON body — fall back to header only
        }
        const retryAfter = Number.isFinite(headerRetry) && headerRetry > 0
          ? Math.ceil(headerRetry)
          : Number.isFinite(bodyRetry) && bodyRetry > 0
            ? Math.ceil(bodyRetry)
            : 60;
        trackEvent("Autofill Rate Limited", { mode, retryAfter });
        setLookup({ state: "rate_limited", retryAfter });
        return;
      }

      const payload = await res.json();
      if (!res.ok) {
        // Prefer the human-readable `message` field that withErrorReporting
        // and our 4xx returns ship; the legacy `error` field is sometimes a
        // machine code ("server_error") which isn't useful UI copy. Fall
        // back to a generic line — never expose raw HTTP / API error text
        // to the user (§16.U #4 / §20.9 #5).
        const safeMessage =
          (typeof payload?.message === "string" && payload.message) ||
          (typeof payload?.error === "string" &&
          // Allow short, copy-style `error` strings (e.g. "Invalid JSON body.")
          // but reject machine codes / raw stack traces.
          payload.error.length < 120 &&
          !/HTTP \d{3}|stack|trace|api[\s_-]?key/i.test(payload.error)
            ? payload.error
            : null) ||
          "We hit a snag pulling that property. Try again, or fill the inputs manually below.";
        throw new Error(safeMessage);
      }

      const resolved = payload as ResolverPayload;
      const ok = applyResolvedPayload(resolved, mode, false);
      // Only cache successful resolves — empty/error resolutions should not
      // poison the cache for the full 30 min TTL.
      if (ok) {
        sessionSet(AUTOFILL_CACHE_NS, cacheId, resolved, AUTOFILL_CACHE_TTL_MS);
      }
    } catch (err) {
      trackEvent("Autofill Failed", {
        mode,
        reason: err instanceof Error ? err.message : "unknown",
      });
      setLookup({
        state: "error",
        message:
          err instanceof Error ? err.message : "Auto-fill failed. Fill manually below.",
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitiseInputs(inputs);
    const params = inputsToSearchParams(clean);
    if (address.trim()) params.set("address", address.trim());
    // Pass property facts through the URL so /results can rerun the comp
    // derivation and show "how we got these numbers" for shared/bookmarked URLs.
    if (lookup.state === "ok" && lookup.facts) {
      if (lookup.facts.bedrooms) params.set("beds", String(lookup.facts.bedrooms));
      if (lookup.facts.bathrooms) params.set("baths", String(lookup.facts.bathrooms));
      if (lookup.facts.squareFootage)
        params.set("sqft", String(lookup.facts.squareFootage));
      if (lookup.facts.yearBuilt)
        params.set("yearBuilt", String(lookup.facts.yearBuilt));
      if (lookup.facts.propertyType)
        params.set("propertyType", lookup.facts.propertyType);
      // Pass last-sale as a market anchor so /results can cross-check the
      // comp-derived fair value against what this exact unit last transacted at.
      if (lookup.facts.lastSalePrice)
        params.set("lastSalePrice", String(lookup.facts.lastSalePrice));
      if (lookup.facts.lastSaleDate)
        params.set("lastSaleDate", lookup.facts.lastSaleDate);
    }
    // Flag that the purchase price came from an active Zillow listing — the
    // comp cross-check uses this as a market-truth anchor.
    if (lookup.state === "ok" && lookup.mode === "zillow") {
      params.set("listed", "1");
    }
    // Hand the resolver's warnings off to /results via sessionStorage so
    // the banner can show the same "Zillow scraper offline" / etc. context
    // the homepage already displays. Keyed by the canonical address so a
    // shared /results URL in a fresh session simply has no warnings to show
    // (safe default — we'd rather under-warn than show stale noise).
    if (lookup.state === "ok" && lookup.warnings.length > 0 && address.trim()) {
      sessionSet(
        RESULTS_WARNINGS_NS,
        normalizeCacheKey(address.trim()),
        { warnings: lookup.warnings },
        RESULTS_WARNINGS_TTL_MS,
      );
    }
    trackEvent("Deal Analyzed", {
      hasAddress: Boolean(address.trim()),
      hasZillow: lookup.state === "ok" && lookup.mode === "zillow",
      priceBucket: priceBucket(clean.purchasePrice),
      rentBucket: rentBucket(clean.monthlyRent),
    });
    router.push(`/results?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl mx-auto">
      <div className="rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 p-6 dark:border-zinc-800">
          <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            Rental listing — address or Zillow URL
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              placeholder="2315 Ave H, Austin, TX 78722"
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder-zinc-600"
            />
            <button
              type="button"
              onClick={handleAutoFill}
              disabled={lookup.state === "loading" || !lookupInput.trim()}
              className="rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {lookup.state === "loading" ? "Fetching…" : "Auto-fill"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
            Built for rentals you would lease long-term — not primary-home
            shopping lists.
          </p>
          <LookupStatusLine status={lookup} />
          <PropertyFactsStrip
            facts={lookup.state === "ok" ? lookup.facts : undefined}
            address={lookup.state === "ok" ? lookup.address : undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-x-5 gap-y-4 p-6 sm:grid-cols-2">
          <NumberField
            label="Purchase price"
            value={inputs.purchasePrice}
            onChange={(v) => update("purchasePrice", v)}
            prefix="$"
            provenance={provenance.purchasePrice}
          />
          <NumberField
            label="Monthly rent"
            value={inputs.monthlyRent}
            onChange={(v) => update("monthlyRent", v)}
            prefix="$"
            provenance={provenance.monthlyRent}
            hint={rentHint(lookup, provenance.monthlyRent)}
          />
          <NumberField
            label="Down payment"
            value={inputs.downPaymentPercent}
            onChange={(v) => update("downPaymentPercent", v)}
            suffix="%"
            step={0.5}
          />
          <NumberField
            label="Interest rate"
            value={inputs.loanInterestRate}
            onChange={(v) => update("loanInterestRate", v)}
            suffix="%"
            step={0.125}
            provenance={provenance.loanInterestRate}
          />
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between border-t border-zinc-200 px-6 py-3 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-950"
        >
          <span>{showAdvanced ? "Hide" : "Show"} advanced inputs</span>
          <Chevron open={showAdvanced} />
        </button>

        {showAdvanced && (
          <div className="border-t border-zinc-200 dark:border-zinc-800">
            <FieldGroup title="Financing">
              <NumberField
                label="Closing costs"
                value={inputs.closingCostsPercent}
                onChange={(v) => update("closingCostsPercent", v)}
                suffix="% of price"
                step={0.25}
              />
              <NumberField
                label="Loan term"
                value={inputs.loanTermYears}
                onChange={(v) => update("loanTermYears", v)}
                suffix="years"
                step={1}
              />
              <NumberField
                label="Rehab budget"
                value={inputs.rehabCosts}
                onChange={(v) => update("rehabCosts", v)}
                prefix="$"
              />
            </FieldGroup>

            <FieldGroup title="Income">
              <NumberField
                label="Other monthly income"
                value={inputs.otherMonthlyIncome}
                onChange={(v) => update("otherMonthlyIncome", v)}
                prefix="$"
              />
              <NumberField
                label="Vacancy rate"
                value={inputs.vacancyRatePercent}
                onChange={(v) => update("vacancyRatePercent", v)}
                suffix="%"
                step={1}
              />
            </FieldGroup>

            <FieldGroup title="Operating expenses">
              <NumberField
                label="Property tax / yr"
                value={inputs.annualPropertyTax}
                onChange={(v) => update("annualPropertyTax", v)}
                prefix="$"
                provenance={provenance.annualPropertyTax}
              />
              <NumberField
                label="Insurance / yr"
                value={inputs.annualInsurance}
                onChange={(v) => update("annualInsurance", v)}
                prefix="$"
                provenance={provenance.annualInsurance}
              />
              <NumberField
                label="HOA / mo"
                value={inputs.monthlyHOA}
                onChange={(v) => update("monthlyHOA", v)}
                prefix="$"
                provenance={provenance.monthlyHOA}
              />
              <NumberField
                label="Owner-paid utilities / mo"
                value={inputs.monthlyUtilities}
                onChange={(v) => update("monthlyUtilities", v)}
                prefix="$"
              />
              <NumberField
                label="Maintenance reserve"
                value={inputs.maintenancePercent}
                onChange={(v) => update("maintenancePercent", v)}
                suffix="% of rent"
                step={0.5}
              />
              <NumberField
                label="Property management"
                value={inputs.propertyManagementPercent}
                onChange={(v) => update("propertyManagementPercent", v)}
                suffix="% of rent"
                step={0.5}
              />
              <NumberField
                label="CapEx reserve"
                value={inputs.capexReservePercent}
                onChange={(v) => update("capexReservePercent", v)}
                suffix="% of rent"
                step={0.5}
              />
            </FieldGroup>

            <FieldGroup title="Growth & exit">
              <NumberField
                label="Appreciation / yr"
                value={inputs.annualAppreciationPercent}
                onChange={(v) => update("annualAppreciationPercent", v)}
                suffix="%"
                step={0.25}
                provenance={provenance.annualAppreciationPercent}
              />
              <NumberField
                label="Rent growth / yr"
                value={inputs.annualRentGrowthPercent}
                onChange={(v) => update("annualRentGrowthPercent", v)}
                suffix="%"
                step={0.25}
              />
              <NumberField
                label="Expense growth / yr"
                value={inputs.annualExpenseGrowthPercent}
                onChange={(v) => update("annualExpenseGrowthPercent", v)}
                suffix="%"
                step={0.25}
              />
              <NumberField
                label="Selling costs"
                value={inputs.sellingCostsPercent}
                onChange={(v) => update("sellingCostsPercent", v)}
                suffix="% of sale"
                step={0.25}
              />
              <NumberField
                label="Hold period"
                value={inputs.holdPeriodYears}
                onChange={(v) => update("holdPeriodYears", v)}
                suffix="years"
                step={1}
              />
            </FieldGroup>
          </div>
        )}

        <div className="border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950/60">
          {analysis ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                <span>
                  CF{" "}
                  <span
                    className={
                      analysis.monthlyCashFlow >= 0
                        ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                        : "text-red-600 dark:text-red-400 font-semibold"
                    }
                  >
                    {formatCurrency(analysis.monthlyCashFlow, 0)}/mo
                  </span>
                </span>
                <span>
                  Cap{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatPercent(analysis.capRate, 2)}
                  </span>
                </span>
                <span>
                  CoC{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatPercent(analysis.cashOnCashReturn, 1)}
                  </span>
                </span>
                <span>
                  DSCR{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {isFinite(analysis.dscr) ? analysis.dscr.toFixed(2) : "∞"}
                  </span>
                </span>
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${TIER_COLOR[analysis.verdict.tier]}`}
                >
                  {TIER_LABEL[analysis.verdict.tier]}
                </span>
              </div>
            </div>
          ) : (
            <span className="text-xs text-zinc-500">Fill in the basics to see a live preview.</span>
          )}
        </div>

        <button
          type="submit"
          className="block w-full rounded-b-2xl bg-gradient-to-r from-emerald-600 via-sky-600 to-indigo-600 px-6 py-4 text-base font-semibold text-white transition hover:brightness-110"
        >
          Run rental verdict →
        </button>
      </div>
    </form>
  );
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = "any",
  provenance,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number | "any";
  provenance?: FieldProvenance;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        {provenance && <ProvenanceBadge provenance={provenance} />}
      </span>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400">
            {prefix}
          </span>
        )}
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={0}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className={`w-full rounded-lg border border-zinc-300 bg-white py-2.5 text-sm font-medium text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 ${prefix ? "pl-7" : "pl-3"} ${suffix ? "pr-16" : "pr-3"}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-zinc-400">
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <span className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          {hint}
        </span>
      )}
    </label>
  );
}

function ProvenanceBadge({ provenance }: { provenance: FieldProvenance }) {
  const label = SOURCE_LABEL[provenance.source];
  if (!label) return null;
  return (
    <span
      title={provenance.note}
      className={`cursor-help rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${CONFIDENCE_TONE[provenance.confidence]}`}
    >
      {label}
    </span>
  );
}

function FieldGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-zinc-200 px-6 py-5 last:border-b-0 dark:border-zinc-800">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {title}
      </div>
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function LookupStatusLine({ status }: { status: LookupStatus }) {
  if (status.state === "idle") return null;
  if (status.state === "loading") {
    return (
      <p className="mt-2 text-xs text-zinc-500">
        Fetching {status.mode === "zillow" ? "Zillow listing" : "market data"}…
      </p>
    );
  }
  if (status.state === "error") {
    return (
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
        {status.message}
      </p>
    );
  }
  if (status.state === "rate_limited") {
    return <RateLimitNotice retryAfter={status.retryAfter} />;
  }
  return (
    <div className="mt-2 space-y-1 text-xs">
      <div className="text-emerald-700 dark:text-emerald-400">
        <span className="font-semibold">Auto-filled.</span>
        {status.notes.length > 0 && (
          <span className="ml-1 text-zinc-500 dark:text-zinc-400">
            {status.notes.join(" · ")}
          </span>
        )}
      </div>
      {status.warnings.length > 0 && (
        <ul className="mt-1 space-y-1.5 rounded-md border border-amber-300/60 bg-amber-50/80 p-2.5 text-[13px] leading-snug text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
          {status.warnings.map((w, i) => (
            <li key={i} className="flex gap-1.5">
              <span aria-hidden className="shrink-0">⚠</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RateLimitNotice({ retryAfter }: { retryAfter: number }) {
  // Live countdown using the standard "decrement-on-interval" pattern.
  // We seed `seconds` from the initial prop and rely on an effect to
  // handle both prop changes (new retryAfter arrives) and the 1-Hz tick.
  // `Date.now()` never appears in render — pure function, React-happy.
  const [seconds, setSeconds] = useState(() => Math.max(0, retryAfter));

  // Re-seed whenever the rate-limiter hands us a fresh retry window.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync prop → state so a new rate-limit response resets the countdown
    setSeconds(Math.max(0, retryAfter));
  }, [retryAfter]);

  // Tick down to zero, then stop (no interval leak).
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const when =
    seconds <= 0
      ? "now — tap Auto-fill again"
      : seconds < 60
        ? `in ${seconds}s`
        : `in ~${Math.ceil(seconds / 60)} min`;

  return (
    <div className="mt-2 rounded-md border border-amber-400/60 bg-amber-50/90 p-3 text-[13px] leading-snug text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="font-semibold">You&rsquo;re going too fast.</div>
      <div className="mt-0.5">
        We rate-limit autofill to keep data-source costs sustainable. Try
        again {when}.
      </div>
    </div>
  );
}

function PropertyFactsStrip({
  facts,
  address,
}: {
  facts?: PropertyFacts;
  address?: string;
}) {
  if (!facts) return null;
  const items: Array<{ label: string; value: string }> = [];
  if (facts.bedrooms != null)
    items.push({ label: "Beds", value: String(facts.bedrooms) });
  if (facts.bathrooms != null)
    items.push({ label: "Baths", value: String(facts.bathrooms) });
  if (facts.squareFootage)
    items.push({
      label: "Sqft",
      value: facts.squareFootage.toLocaleString("en-US"),
    });
  if (facts.yearBuilt) items.push({ label: "Built", value: String(facts.yearBuilt) });
  if (facts.propertyType)
    items.push({ label: "Type", value: facts.propertyType });
  if (facts.lastSalePrice && facts.lastSaleDate) {
    items.push({
      label: "Last sold",
      value: `${formatCurrency(facts.lastSalePrice, 0)} (${formatLastSaleYear(facts.lastSaleDate)})`,
    });
  }

  const floodChip = facts.floodZone ? floodZoneChip(facts.floodZone) : null;
  if (items.length === 0 && !floodChip) return null;

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
      {address && (
        <div className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {address}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {items.map((item) => (
          <span key={item.label} className="flex items-baseline gap-1">
            <span className="text-zinc-400 dark:text-zinc-500">{item.label}</span>
            <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">
              {item.value}
            </span>
          </span>
        ))}
        {floodChip}
      </div>
    </div>
  );
}

function floodZoneChip(zone: NonNullable<PropertyFacts["floodZone"]>) {
  // Only surface the chip when there's actually something to warn about.
  // Zone X minimal is the default — showing "Zone X · Low risk" on every
  // inland property is visual noise.
  if (zone.risk === "low") return null;
  const tone =
    zone.risk === "high"
      ? zone.isCoastalHigh
        ? "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60"
        : "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60"
      : "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/60";
  return (
    <span
      key="flood"
      title={zone.label}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      <span aria-hidden>⚠</span>
      <span>FEMA Zone {zone.zone}</span>
    </span>
  );
}

function formatLastSaleYear(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return String(d.getFullYear());
}

// ---------------------------------------------------------------------------
// Thin-rent hint — surface a human-readable "why is this field empty/weak?"
// note whenever the autofill pipeline couldn't find comps-backed rent. Keeps
// users from assuming the headline cash-flow number is derived from real data
// when the rent feeding it is actually a guess.
// ---------------------------------------------------------------------------

function rentHint(
  lookup: LookupStatus,
  prov: FieldProvenance | undefined,
): string | undefined {
  // Only surface hints *after* a successful autofill. Before autofill the
  // default placeholder is expected and adding a warning would be noise.
  if (lookup.state !== "ok") return undefined;

  // Autofill ran but rent never got overridden — form is still on the
  // default seed. Tell the user to type one in.
  if (!prov || prov.source === "default") {
    return "No rent comps available — enter the expected monthly rent.";
  }

  // Zestimate fallback: better than nothing, but materially less reliable
  // than comp-derived rent. Nudge the user to sanity-check it.
  if (prov.source === "zillow-listing" && prov.confidence === "low") {
    return "Rent from Zillow Zestimate — verify against local listings.";
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Analytics bucketing — keep props low-cardinality so Plausible stays usable.
// ---------------------------------------------------------------------------

function priceBucket(price: number): string {
  if (!price || price <= 0) return "none";
  if (price < 100_000) return "<100k";
  if (price < 200_000) return "100-200k";
  if (price < 350_000) return "200-350k";
  if (price < 500_000) return "350-500k";
  if (price < 750_000) return "500-750k";
  if (price < 1_000_000) return "750k-1M";
  if (price < 2_000_000) return "1-2M";
  return "2M+";
}

function rentBucket(rent: number): string {
  if (!rent || rent <= 0) return "none";
  if (rent < 1000) return "<1k";
  if (rent < 1500) return "1-1.5k";
  if (rent < 2000) return "1.5-2k";
  if (rent < 3000) return "2-3k";
  if (rent < 5000) return "3-5k";
  return "5k+";
}
