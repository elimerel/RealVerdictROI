// Next.js instrumentation entry point.
//
// This is the single place where we wire up Sentry (and anything else that
// needs to be initialised once per lambda cold start). Next calls `register`
// automatically before any route or page renders — so by the time a handler
// runs, Sentry has already hooked into its machinery and auto-wraps every
// request with an error boundary.
//
// Env-gated: when SENTRY_DSN is missing we skip the whole init, keeping dev
// silent and avoiding a dependency on the Sentry project existing.

export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  // Dynamically import so the Sentry bundle isn't included in the runtime
  // build when the DSN is absent. (Next still tree-shakes static imports,
  // but dynamic import makes the intent explicit.)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn,
      // Performance tracing is off by default; flip on via env var when
      // investigating a latency regression.
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      // Our routes tend to throw short, informative errors. Don't truncate them.
      maxValueLength: 2000,
      // Noisy and low-signal — Sentry's own default is the whole world which
      // produces a lot of console.error breadcrumbs from dev tools.
      integrations: (defaults) =>
        defaults.filter((i) => i.name !== "Console"),
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA,
    });
  }
}

export async function onRequestError(
  err: unknown,
  request: {
    path: string;
    method: string;
    headers: { [key: string]: string | string[] | undefined };
  },
  context: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "middleware";
    renderSource?: string;
    revalidateReason?: "on-demand" | "stale" | undefined;
    renderType?: "dynamic" | "dynamic-resume";
  },
) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(err, request, context);
}
