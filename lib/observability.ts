// Observability for API routes.
//
// Two primitives, same file:
//
//   captureError(err, context)  →  sends to Sentry when SENTRY_DSN is set,
//                                  also prints structured JSON to stderr so
//                                  Vercel captures it even without Sentry.
//
//   logEvent(name, props)        →  structured JSON breadcrumb to stdout.
//                                  Used for "told you so" moments (e.g.
//                                  Zillow parse fell through to regex-v3)
//                                  so we can grep Vercel logs when the
//                                  scraper inevitably drifts.
//
// Sentry is imported eagerly so its auto-instrumentation of Next.js route
// handlers can hook in, but initialisation is driven by `instrumentation.ts`
// at the project root — which checks `SENTRY_DSN` before calling `init`.
// When the DSN is absent, `captureException` is a no-op in the SDK, so the
// whole stack stays silent without any guards from our end.

import * as Sentry from "@sentry/nextjs";

// ---------------------------------------------------------------------------
// Error capture
// ---------------------------------------------------------------------------

export type ErrorContext = {
  /** Where the error happened, e.g. "api.zillow-parse". Becomes the Sentry tag. */
  area: string;
  /** Additional structured data — safe to include URLs, status codes, etc.
   *  DO NOT put user PII here; the same object is printed to Vercel logs. */
  extra?: Record<string, unknown>;
};

export function captureError(err: unknown, context: ErrorContext): void {
  // Plain Error → use its message + stack as-is.
  // Supabase / fetch-style error → bag of {message, code, details, hint, status}.
  // Anything else → JSON.stringify so we never lose the real cause to "[object Object]".
  let message = "unknown error";
  const errorFields: Record<string, unknown> = {};
  let stack: string | undefined;
  if (err instanceof Error) {
    message = err.message;
    stack = err.stack;
  } else if (typeof err === "string") {
    message = err;
  } else if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") message = obj.message;
    for (const key of ["code", "details", "hint", "status", "name"]) {
      if (key in obj) errorFields[`err_${key}`] = obj[key];
    }
    if (message === "unknown error") {
      try {
        message = JSON.stringify(err);
      } catch {
        message = "unstringifiable error object";
      }
    }
  }
  const payload = {
    level: "error",
    area: context.area,
    message,
    ...errorFields,
    ...(context.extra ?? {}),
  };
  try {
    console.error(JSON.stringify(payload));
    if (stack && process.env.NODE_ENV !== "production") {
      // In dev we want the full stack trace on stderr for readability.
      console.error(stack);
    }
  } catch {
    // JSON.stringify can throw on circular objects — fall back to a plain
    // string form so we never lose the error.
    console.error(`[${context.area}] ${message}`);
  }

  // Sentry. No-op when SDK hasn't been initialised.
  try {
    Sentry.captureException(err, (scope) => {
      scope.setTag("area", context.area);
      if (context.extra) scope.setContext("extra", context.extra);
      return scope;
    });
  } catch {
    // Never let Sentry itself take down a request.
  }
}

// ---------------------------------------------------------------------------
// Structured event log
// ---------------------------------------------------------------------------

/**
 * Emit a structured JSON event to stdout. Always safe to call. Intended for
 * operational breadcrumbs — Zillow parse strategy used, RentCast cache hit,
 * "fell back to X because Y", etc. Grep-friendly:
 *
 *    jq 'select(.event == "zillow.parse.strategy")' < logs.ndjson
 *
 * Also emits a Sentry breadcrumb so error reports include recent events.
 */
export function logEvent(
  name: string,
  props: Record<string, unknown> = {},
): void {
  const payload = { level: "info", event: name, ...props };
  try {
    console.log(JSON.stringify(payload));
  } catch {
    console.log(`[event] ${name}`);
  }

  try {
    Sentry.addBreadcrumb({
      category: name,
      message: name,
      level: "info",
      data: props,
    });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Convenience: wrap an async route handler so any uncaught throw is reported.
//
// Most of our routes already have try/catch around their fallible external
// calls, but a defensive layer at the top catches the unexpected (TypeError
// in our own code, Supabase client crash, etc.) without every handler having
// to remember to add one.
// ---------------------------------------------------------------------------

export function withErrorReporting<Args extends unknown[]>(
  area: string,
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      captureError(err, { area });
      return new Response(
        JSON.stringify({
          error: "server_error",
          message: "Something went wrong on our end. Please try again.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };
}
