"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyseDeal,
  DealInputs,
  DEFAULT_INPUTS,
  formatCurrency,
  formatPercent,
  inputsToSearchParams,
  sanitiseInputs,
} from "@/lib/calculations";
import type { PropertyLookupResult } from "@/app/api/property-lookup/route";
import type { AddressSuggestion } from "@/app/api/address-autocomplete/route";

type FieldKey = keyof DealInputs;

type Field = {
  key: FieldKey;
  label: string;
  hint?: string;
  unit: "currency" | "percent" | "years";
  step?: number;
  min?: number;
  max?: number;
};

type Section = {
  title: string;
  description: string;
  fields: Field[];
};

const SECTIONS: Section[] = [
  {
    title: "Purchase",
    description: "What it costs to get in the door.",
    fields: [
      {
        key: "purchasePrice",
        label: "Purchase price",
        unit: "currency",
        step: 1000,
      },
      {
        key: "downPaymentPercent",
        label: "Down payment",
        unit: "percent",
        step: 0.5,
        min: 0,
        max: 100,
      },
      {
        key: "closingCostsPercent",
        label: "Closing costs",
        hint: "% of purchase price",
        unit: "percent",
        step: 0.25,
        min: 0,
        max: 20,
      },
      {
        key: "rehabCosts",
        label: "Rehab / initial repairs",
        unit: "currency",
        step: 500,
      },
    ],
  },
  {
    title: "Financing",
    description: "Mortgage terms from your lender (or 0% for all-cash).",
    fields: [
      {
        key: "loanInterestRate",
        label: "Interest rate",
        unit: "percent",
        step: 0.125,
        min: 0,
        max: 25,
      },
      {
        key: "loanTermYears",
        label: "Loan term",
        unit: "years",
        step: 1,
        min: 1,
        max: 40,
      },
    ],
  },
  {
    title: "Income",
    description: "What the property will actually bring in.",
    fields: [
      { key: "monthlyRent", label: "Monthly rent", unit: "currency", step: 25 },
      {
        key: "otherMonthlyIncome",
        label: "Other monthly income",
        hint: "Laundry, parking, storage, pet rent…",
        unit: "currency",
        step: 10,
      },
      {
        key: "vacancyRatePercent",
        label: "Vacancy rate",
        hint: "% of the year the unit sits empty",
        unit: "percent",
        step: 0.5,
        min: 0,
        max: 100,
      },
    ],
  },
  {
    title: "Fixed operating expenses",
    description: "Bills you pay no matter who is (or isn't) in the unit.",
    fields: [
      {
        key: "annualPropertyTax",
        label: "Property tax (annual)",
        unit: "currency",
        step: 100,
      },
      {
        key: "annualInsurance",
        label: "Insurance (annual)",
        unit: "currency",
        step: 50,
      },
      { key: "monthlyHOA", label: "HOA (monthly)", unit: "currency", step: 10 },
      {
        key: "monthlyUtilities",
        label: "Utilities you cover (monthly)",
        unit: "currency",
        step: 10,
      },
    ],
  },
  {
    title: "Variable reserves",
    description: "Percent-of-rent rules of thumb that keep you honest.",
    fields: [
      {
        key: "maintenancePercent",
        label: "Maintenance & repairs",
        hint: "% of gross rent",
        unit: "percent",
        step: 0.5,
        min: 0,
        max: 100,
      },
      {
        key: "propertyManagementPercent",
        label: "Property management",
        hint: "% of gross rent (0 if you self-manage)",
        unit: "percent",
        step: 0.5,
        min: 0,
        max: 100,
      },
      {
        key: "capexReservePercent",
        label: "CapEx reserve",
        hint: "Roof, HVAC, appliances — % of rent set aside",
        unit: "percent",
        step: 0.5,
        min: 0,
        max: 100,
      },
    ],
  },
  {
    title: "Growth & exit",
    description: "Your assumptions for the long haul.",
    fields: [
      {
        key: "annualAppreciationPercent",
        label: "Annual appreciation",
        unit: "percent",
        step: 0.25,
        min: -20,
        max: 30,
      },
      {
        key: "annualRentGrowthPercent",
        label: "Annual rent growth",
        unit: "percent",
        step: 0.25,
        min: -20,
        max: 30,
      },
      {
        key: "annualExpenseGrowthPercent",
        label: "Annual expense growth",
        unit: "percent",
        step: 0.25,
        min: -20,
        max: 30,
      },
      {
        key: "sellingCostsPercent",
        label: "Selling costs at exit",
        hint: "Agent fees, transfer tax, closing",
        unit: "percent",
        step: 0.25,
        min: 0,
        max: 20,
      },
      {
        key: "holdPeriodYears",
        label: "Hold period",
        unit: "years",
        step: 1,
        min: 1,
        max: 40,
      },
    ],
  },
];

const UNIT_PREFIX: Record<Field["unit"], string> = {
  currency: "$",
  percent: "",
  years: "",
};

const UNIT_SUFFIX: Record<Field["unit"], string> = {
  currency: "",
  percent: "%",
  years: "yrs",
};

type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: PropertyLookupResult }
  | { status: "error"; message: string };

export default function AnalysisForm() {
  const router = useRouter();
  const [inputs, setInputs] = useState<DealInputs>(DEFAULT_INPUTS);
  const [address, setAddress] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [autoFilled, setAutoFilled] = useState<Set<FieldKey>>(new Set());
  const [isPending, startTransition] = useTransition();

  const preview = useMemo(() => analyseDeal(inputs), [inputs]);

  const update = (key: FieldKey, value: number) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
    // Once the user edits a field themselves, it's no longer "auto-filled".
    setAutoFilled((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const runLookup = async (overrideAddress?: string) => {
    const q = (overrideAddress ?? address).trim();
    if (q.length < 5) {
      setLookup({
        status: "error",
        message: "Enter a full street address including city and state.",
      });
      return;
    }
    setLookup({ status: "loading" });
    try {
      const res = await fetch(
        `/api/property-lookup?address=${encodeURIComponent(q)}`,
      );
      const payload = await res.json();
      if (!res.ok) {
        setLookup({
          status: "error",
          message: payload?.error ?? `Lookup failed (HTTP ${res.status})`,
        });
        return;
      }
      const data = payload as PropertyLookupResult;
      setLookup({ status: "success", data });

      // Apply the auto-fills returned by the server and mark each as filled.
      setInputs((prev) => {
        const next = { ...prev };
        if (typeof data.autoFilled.monthlyRent === "number")
          next.monthlyRent = data.autoFilled.monthlyRent;
        if (typeof data.autoFilled.purchasePrice === "number")
          next.purchasePrice = data.autoFilled.purchasePrice;
        if (typeof data.autoFilled.annualPropertyTax === "number")
          next.annualPropertyTax = data.autoFilled.annualPropertyTax;
        return next;
      });
      setAutoFilled(() => {
        const next = new Set<FieldKey>();
        if (typeof data.autoFilled.monthlyRent === "number")
          next.add("monthlyRent");
        if (typeof data.autoFilled.purchasePrice === "number")
          next.add("purchasePrice");
        if (typeof data.autoFilled.annualPropertyTax === "number")
          next.add("annualPropertyTax");
        return next;
      });
    } catch (err) {
      setLookup({
        status: "error",
        message:
          err instanceof Error ? err.message : "Could not reach property service.",
      });
    }
  };

  const onAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // "Hit Tab to look up" per spec — also Enter for convenience.
    if (e.key === "Tab" && address.trim().length >= 5) {
      e.preventDefault();
      void runLookup();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void runLookup();
    }
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = sanitiseInputs(inputs);
    const params = inputsToSearchParams(clean);
    if (address.trim()) params.set("address", address.trim());
    startTransition(() => {
      router.push(`/results?${params.toString()}`);
    });
  };

  const onReset = () => {
    setInputs(DEFAULT_INPUTS);
    setAddress("");
    setLookup({ status: "idle" });
    setAutoFilled(new Set());
  };

  // Helper: render the "Market estimate: $X–$Y/mo" subtitle under the rent
  // field, but only when we actually have a range from the lookup.
  const rentRangeSubtitle =
    lookup.status === "success" && lookup.data.rent
      ? `Market estimate: ${formatCurrency(lookup.data.rent.low, 0)}–${formatCurrency(lookup.data.rent.high, 0)}/mo`
      : undefined;
  const priceRangeSubtitle =
    lookup.status === "success" && lookup.data.value
      ? `Market estimate: ${formatCurrency(lookup.data.value.low, 0)}–${formatCurrency(lookup.data.value.high, 0)}`
      : undefined;

  return (
    <form onSubmit={onSubmit} className="w-full">
      <AddressLookup
        address={address}
        setAddress={(v) => {
          setAddress(v);
          if (lookup.status === "error") setLookup({ status: "idle" });
        }}
        onLookup={() => runLookup()}
        onKeyDown={onAddressKeyDown}
        onSelectSuggestion={(s) => {
          setAddress(s.label);
          if (lookup.status === "error") setLookup({ status: "idle" });
          void runLookup(s.label);
        }}
        lookup={lookup}
      />

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_22rem]">
        {/* Left column — all the inputs */}
        <div className="flex flex-col gap-10">
          {SECTIONS.map((section) => (
            <section
              key={section.title}
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <header className="mb-5 flex flex-col gap-1">
                <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {section.title}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {section.description}
                </p>
              </header>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <FieldInput
                    key={field.key}
                    field={field}
                    value={inputs[field.key]}
                    onChange={(v) => update(field.key, v)}
                    isAutoFilled={autoFilled.has(field.key)}
                    subtitle={
                      field.key === "monthlyRent"
                        ? rentRangeSubtitle
                        : field.key === "purchasePrice"
                          ? priceRangeSubtitle
                          : undefined
                    }
                  />
                ))}
              </div>
            </section>
          ))}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onReset}
              className="text-sm font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Reset to sample deal
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-zinc-900 px-8 text-sm font-semibold text-white shadow-lg shadow-zinc-900/10 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isPending ? "Running the numbers…" : "Deliver the verdict →"}
            </button>
          </div>
        </div>

        {/* Right column — live preview */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Live preview
              </span>
              <VerdictPill tier={preview.verdict.tier} score={preview.verdict.score} />
            </div>
            <h3 className="mt-3 text-sm text-zinc-900 dark:text-zinc-50">
              {preview.verdict.headline}
            </h3>

            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <PreviewStat
                label="Monthly cash flow"
                value={formatCurrency(preview.monthlyCashFlow, 0)}
                positive={preview.monthlyCashFlow >= 0}
              />
              <PreviewStat
                label="Cash invested"
                value={formatCurrency(preview.totalCashInvested, 0)}
              />
              <PreviewStat
                label="Cap rate"
                value={formatPercent(preview.capRate)}
              />
              <PreviewStat
                label="Cash-on-cash"
                value={formatPercent(preview.cashOnCashReturn)}
                positive={preview.cashOnCashReturn >= 0}
              />
              <PreviewStat
                label="DSCR"
                value={
                  isFinite(preview.dscr) ? preview.dscr.toFixed(2) : "∞"
                }
              />
              <PreviewStat
                label={`${preview.inputs.holdPeriodYears}-yr IRR`}
                value={formatPercent(preview.irr)}
                positive={preview.irr >= 0}
              />
            </dl>

            <p className="mt-5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Numbers update as you type. Submit for the full report: year-by-year
              projection, amortisation, exit proceeds, and the detailed verdict.
            </p>
          </div>
        </aside>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Address lookup card — lives at the very top of the form.
// ---------------------------------------------------------------------------

function AddressLookup({
  address,
  setAddress,
  onLookup,
  onKeyDown,
  onSelectSuggestion,
  lookup,
}: {
  address: string;
  setAddress: (v: string) => void;
  onLookup: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSelectSuggestion: (s: AddressSuggestion) => void;
  lookup: LookupState;
}) {
  const isLoading = lookup.status === "loading";

  // ---- Autocomplete state --------------------------------------------------
  // We debounce 300ms before hitting Nominatim. `requestSeq` protects against
  // out-of-order responses: a slow response for "123 M" shouldn't clobber
  // fresh results for "123 Main".
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suppressNextFetchRef = useRef(false);
  const requestSeqRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const query = address.trim();

  useEffect(() => {
    // When a suggestion is picked we don't want our own state update to
    // trigger another autocomplete fetch for the full address.
    if (suppressNextFetchRef.current) {
      suppressNextFetchRef.current = false;
      return;
    }

    if (query.length < 4) {
      setSuggestions([]);
      setIsFetching(false);
      setIsOpen(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    setIsFetching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/address-autocomplete?q=${encodeURIComponent(query)}`,
        );
        if (seq !== requestSeqRef.current) return;
        if (!res.ok) {
          setSuggestions([]);
          setIsOpen(false);
          return;
        }
        const rows = (await res.json()) as AddressSuggestion[];
        if (seq !== requestSeqRef.current) return;
        setSuggestions(Array.isArray(rows) ? rows.slice(0, 5) : []);
        setIsOpen((Array.isArray(rows) ? rows.length : 0) > 0);
        setActiveIndex(-1);
      } catch {
        if (seq !== requestSeqRef.current) return;
        setSuggestions([]);
        setIsOpen(false);
      } finally {
        if (seq === requestSeqRef.current) setIsFetching(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [query]);

  // Dismiss on outside click.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const pickSuggestion = (s: AddressSuggestion) => {
    suppressNextFetchRef.current = true;
    setIsOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
    onSelectSuggestion(s);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) =>
          i <= 0 ? suggestions.length - 1 : i - 1,
        );
        return;
      }
      if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        pickSuggestion(suggestions[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        return;
      }
    }
    onKeyDown(e);
  };

  return (
    <section className="mb-10 rounded-2xl border border-zinc-200 bg-gradient-to-br from-white to-zinc-50 p-6 shadow-sm dark:border-zinc-800 dark:from-zinc-950 dark:to-zinc-900">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Pull market data from an address
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Enter a full US street address — we&rsquo;ll pre-fill rent, price, and
          property tax from comparable listings. Hit{" "}
          <kbd className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            Tab
          </kbd>{" "}
          or click the button.
        </p>
      </div>

      <div
        ref={containerRef}
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <div className="relative flex-1">
          <LocationIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) setIsOpen(true);
            }}
            placeholder="123 Main St, Austin, TX 78701"
            autoComplete="off"
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            aria-controls="address-suggestions"
            aria-activedescendant={
              activeIndex >= 0
                ? `address-suggestion-${suggestions[activeIndex]?.placeId}`
                : undefined
            }
            className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-9 pr-9 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-100/10"
          />
          {isFetching && (
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
              <Spinner />
            </div>
          )}

          {isOpen && suggestions.length > 0 && (
            <ul
              id="address-suggestions"
              role="listbox"
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
            >
              {suggestions.map((s, i) => (
                <li
                  key={s.placeId}
                  id={`address-suggestion-${s.placeId}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => {
                    // mousedown (not click) fires before the input's blur, so
                    // the dropdown doesn't close before we handle the pick.
                    e.preventDefault();
                    pickSuggestion(s);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`cursor-pointer px-3 py-2 text-sm transition ${
                    i === activeIndex
                      ? "bg-zinc-100 dark:bg-zinc-900"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  }`}
                >
                  <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {s.primary}
                  </div>
                  {s.secondary && (
                    <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {s.secondary}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onLookup}
          disabled={isLoading || address.trim().length < 5}
          className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isLoading ? (
            <>
              <Spinner /> Looking up…
            </>
          ) : (
            <>Fetch market data</>
          )}
        </button>
      </div>

      {lookup.status === "error" && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          {lookup.message}
        </p>
      )}

      {lookup.status === "success" && <LookupSummary data={lookup.data} />}
    </section>
  );
}

function LookupSummary({ data }: { data: PropertyLookupResult }) {
  const filledCount = Object.keys(data.autoFilled).length;
  const details: string[] = [];
  if (data.property?.bedrooms)
    details.push(
      `${data.property.bedrooms} bd · ${data.property.bathrooms ?? "?"} ba`,
    );
  if (data.property?.squareFootage)
    details.push(`${data.property.squareFootage.toLocaleString()} sqft`);
  if (data.property?.yearBuilt) details.push(`built ${data.property.yearBuilt}`);
  if (data.property?.propertyType) details.push(data.property.propertyType);

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/30">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-medium text-emerald-900 dark:text-emerald-100">
          {filledCount === 0
            ? "Property found — but no market data to auto-fill."
            : `Auto-filled ${filledCount} field${filledCount === 1 ? "" : "s"} for this address.`}
        </div>
        <div className="font-mono text-xs text-emerald-700 dark:text-emerald-300">
          {data.address}
        </div>
      </div>
      {details.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-emerald-800 dark:text-emerald-200">
          {details.map((d) => (
            <span key={d}>{d}</span>
          ))}
          {data.property?.lastSalePrice && data.property?.lastSaleDate && (
            <span>
              last sold {formatCurrency(data.property.lastSalePrice, 0)} on{" "}
              {new Date(data.property.lastSaleDate).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
      {data.notes.length > 0 && (
        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Some data was unavailable: {data.notes.join(" · ")}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic field input (with auto-filled badge support)
// ---------------------------------------------------------------------------

function FieldInput({
  field,
  value,
  onChange,
  isAutoFilled,
  subtitle,
}: {
  field: Field;
  value: number;
  onChange: (v: number) => void;
  isAutoFilled?: boolean;
  subtitle?: string;
}) {
  const id = `field-${field.key}`;
  const prefix = UNIT_PREFIX[field.unit];
  const suffix = UNIT_SUFFIX[field.unit];

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-baseline justify-between gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200"
      >
        <span className="flex items-center gap-1.5">
          <span>{field.label}</span>
          {isAutoFilled && <AutoFilledBadge />}
        </span>
        {field.hint && (
          <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">
            {field.hint}
          </span>
        )}
      </label>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
            {prefix}
          </span>
        )}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={field.step ?? "any"}
          min={field.min}
          max={field.max}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const next = e.target.valueAsNumber;
            onChange(Number.isFinite(next) ? next : 0);
          }}
          onFocus={(e) => e.target.select()}
          className={`w-full rounded-lg border bg-white py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-100/10 ${
            isAutoFilled
              ? "border-emerald-300 dark:border-emerald-800"
              : "border-zinc-200 dark:border-zinc-800"
          } ${prefix ? "pl-7" : "pl-3"} ${suffix ? "pr-10" : "pr-3"}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
            {suffix}
          </span>
        )}
      </div>
      {subtitle && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function AutoFilledBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-2.5 w-2.5">
        <path d="M9 1a1 1 0 00-.994.89L8 2v1H5a2 2 0 00-1.995 1.85L3 5v12a2 2 0 001.85 1.995L5 19h10a2 2 0 001.995-1.85L17 17V5a2 2 0 00-1.85-1.995L15 3h-3V2a1 1 0 00-2-.117L10 2v1H9V2a1 1 0 00-1-1zm4.707 8.293a1 1 0 00-1.32-.083l-.094.083L9 12.586 7.707 11.293a1 1 0 00-1.497 1.32l.083.094 2 2a1 1 0 001.32.083l.094-.083 4-4a1 1 0 000-1.414z" />
      </svg>
      auto
    </span>
  );
}

function PreviewStat({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  const tone =
    positive === undefined
      ? "text-zinc-900 dark:text-zinc-50"
      : positive
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className={`mt-0.5 font-mono text-base font-semibold ${tone}`}>
        {value}
      </dd>
    </div>
  );
}

function VerdictPill({
  tier,
  score,
}: {
  tier: "excellent" | "good" | "fair" | "poor" | "avoid";
  score: number;
}) {
  const styles: Record<typeof tier, string> = {
    excellent:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    good: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    fair: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    poor: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    avoid: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${styles[tier]}`}
    >
      {tier}
      <span className="font-mono opacity-70">{Math.round(score)}</span>
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
      />
    </svg>
  );
}

function LocationIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M10 18s-6-5.33-6-10a6 6 0 1112 0c0 4.67-6 10-6 10zm0-7a3 3 0 100-6 3 3 0 000 6z"
        clipRule="evenodd"
      />
    </svg>
  );
}
