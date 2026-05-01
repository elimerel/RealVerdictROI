import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import { enforceRateLimit } from "@/lib/ratelimit";
import { withErrorReporting, captureError, logEvent } from "@/lib/observability";

// ---------------------------------------------------------------------------
// /api/report-concern
//
// Public endpoint that backs the /report form on the marketing site.
// Accepts anonymous submissions so a rights holder, abuse reporter, or
// curious visitor can reach us through a structured channel rather than
// having to find an email address. Writes to the public.concern_reports
// table created in supabase/migrations/010_concern_reports.sql.
//
// Hardening:
//   - Strict shape validation + size caps (no 50KB rant submissions).
//   - Rate-limited per IP (the existing enforceRateLimit helper).
//   - No PII echoed in the response — we just acknowledge receipt.
//   - Captures IP + UA into the row to help us tell genuine reports
//     from spam without storing more than necessary.
//
// We deliberately do NOT auto-send an email here — wiring SMTP is
// scope for a separate pass and isn't required to comply with the
// "set up a clear takedown channel" obligation. The Supabase row IS
// the channel; the founder polls it from the dashboard or via a small
// admin script. Adding an outbound notification later (Resend, Postmark)
// is a one-line change in this handler.
// ---------------------------------------------------------------------------

const KNOWN_KINDS = new Set(["dmca", "data-accuracy", "abuse", "privacy", "other"]);

type ReportBody = {
  name?: unknown;
  email?: unknown;
  kind?: unknown;
  subjectUrl?: unknown;
  message?: unknown;
};

/** Trim, fall back to null on empty/non-string. */
function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

export const POST = withErrorReporting("api.report-concern", async (req: Request) => {
  if (!supabaseEnv().configured) {
    return NextResponse.json(
      { error: "Reporting is temporarily unavailable. Email dmca@realverdict.app instead." },
      { status: 503 },
    );
  }

  let body: ReportBody;
  try {
    body = (await req.json()) as ReportBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const message = trimOrNull(body.message, 8000);
  if (!message || message.length < 8) {
    return NextResponse.json(
      { error: "Please describe your concern (at least 8 characters)." },
      { status: 400 },
    );
  }

  // Light rate-limit so we don't get spam-flooded. Bucket is per-IP
  // (no userId — submissions are anonymous).
  const limited = await enforceRateLimit(req, "report-concern");
  if (limited) return limited;

  const reqHeaders = await headers();
  const ip =
    reqHeaders.get("x-forwarded-for")?.split(",")[0].trim() ||
    reqHeaders.get("x-real-ip") ||
    null;
  const ua = reqHeaders.get("user-agent")?.slice(0, 500) ?? null;

  const kindRaw = trimOrNull(body.kind, 40);
  const kind = kindRaw && KNOWN_KINDS.has(kindRaw) ? kindRaw : "other";

  const supabase = await createClient();
  const { error } = await supabase.from("concern_reports").insert({
    name:        trimOrNull(body.name, 120),
    email:       trimOrNull(body.email, 200),
    kind,
    subject_url: trimOrNull(body.subjectUrl, 2000),
    message,
    ip,
    user_agent:  ua,
  });

  if (error) {
    captureError(error, {
      area: "api.report-concern",
      extra: { stage: "supabase_insert", code: error.code },
    });
    return NextResponse.json(
      { error: "Could not record your report. Please email dmca@realverdict.app." },
      { status: 500 },
    );
  }

  logEvent("report.received", { kind });

  return NextResponse.json({ ok: true });
});
