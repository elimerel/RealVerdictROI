import type { Metadata } from "next";
import { ReportConcernForm } from "./ReportConcernForm";

export const metadata: Metadata = {
  title: "Report a concern — RealVerdict",
  description:
    "Report a copyright concern, data inaccuracy, or other issue. We respond to valid reports promptly.",
  robots: { index: true, follow: true },
};

export default function ReportConcernPage() {
  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950">

      <main className="flex-1">
        <article className="mx-auto w-full max-w-xl px-6 py-16 sm:py-20">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Report a concern
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Use this form to report a copyright concern (DMCA notice), a data
            inaccuracy, an abuse issue, or a privacy concern. We respond to
            valid reports promptly.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            For DMCA notices, you can also email{" "}
            <a
              href="mailto:dmca@realverdict.app"
              className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
            >
              dmca@realverdict.app
            </a>{" "}
            directly. For privacy / data requests, email{" "}
            <a
              href="mailto:privacy@realverdict.app"
              className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
            >
              privacy@realverdict.app
            </a>
            .
          </p>

          <div className="mt-8">
            <ReportConcernForm />
          </div>
        </article>
      </main>

    </div>
  );
}
