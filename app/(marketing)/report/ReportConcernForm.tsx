"use client";

import { useState } from "react";

const KIND_OPTIONS: Array<{ value: string; label: string; helper?: string }> = [
  { value: "dmca",          label: "Copyright (DMCA)",        helper: "Content displayed by RealVerdict that you own and want removed." },
  { value: "data-accuracy", label: "Data inaccuracy",         helper: "A property or analysis showing wrong information." },
  { value: "privacy",       label: "Privacy concern",         helper: "Personal data shown without consent or a request to delete data." },
  { value: "abuse",         label: "Abuse / misuse",          helper: "Someone using RealVerdict in a way that violates the Terms." },
  { value: "other",         label: "Other",                   helper: "Something else." },
];

type Status =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "ok" }
  | { state: "error"; message: string };

export function ReportConcernForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<string>("dmca");
  const [subjectUrl, setSubjectUrl] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ state: "submitting" });
    try {
      const res = await fetch("/api/report-concern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, kind, subjectUrl, message }),
      });
      if (res.ok) {
        setStatus({ state: "ok" });
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus({
        state: "error",
        message:
          payload.error ??
          "Couldn't submit your report. Please email dmca@realverdict.app instead.",
      });
    } catch {
      setStatus({
        state: "error",
        message:
          "Network error. Please email dmca@realverdict.app instead.",
      });
    }
  };

  if (status.state === "ok") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
        <h2 className="text-base font-semibold">Report received</h2>
        <p className="mt-2 leading-relaxed">
          Thanks for the heads-up. We&rsquo;ve recorded your report and will
          respond at the email you provided. For DMCA notices we typically
          respond within 5 business days; for other reports we respond within
          14 business days.
        </p>
      </div>
    );
  }

  const helper = KIND_OPTIONS.find((k) => k.value === kind)?.helper;
  const submitting = status.state === "submitting";

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <Field label="Your name (optional)">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200"
        />
      </Field>

      <Field label="Your email" hint="So we can respond. Strongly recommended.">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200"
        />
      </Field>

      <Field label="Type of concern">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200"
        >
          {KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {helper && (
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-500">{helper}</p>
        )}
      </Field>

      <Field label="URL of concern (optional)" hint="The page or listing this is about.">
        <input
          type="url"
          value={subjectUrl}
          onChange={(e) => setSubjectUrl(e.target.value)}
          placeholder="https://"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200"
        />
      </Field>

      <Field label="Description" hint="Required. What's happening and what you'd like us to do.">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          minLength={8}
          maxLength={8000}
          rows={6}
          className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-200"
        />
      </Field>

      {status.state === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {status.message}
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={submitting || message.trim().length < 8}
          className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {submitting ? "Sending…" : "Send report"}
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
        We log your IP address and browser user-agent with this report to
        distinguish genuine reports from spam. We do not use this data for any
        other purpose. See our{" "}
        <a href="/privacy" className="underline underline-offset-2">Privacy Policy</a>.
      </p>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {label}
      </span>
      {children}
      {hint && (
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-500">{hint}</p>
      )}
    </label>
  );
}
