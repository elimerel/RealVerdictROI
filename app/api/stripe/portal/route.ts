import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { supabaseEnv } from "@/lib/supabase/config";
import { getStripe, appBaseUrl } from "@/lib/stripe";
import { enforceRateLimit } from "@/lib/ratelimit";
import {
  withErrorReporting,
  logEvent,
  captureError,
} from "@/lib/observability";

// Customer Portal entry point. POST from a plain HTML form on /dashboard;
// we look up the Stripe customer for the signed-in user, mint a portal
// session, and 303-redirect the browser to Stripe.
export const POST = withErrorReporting(
  "api.stripe-portal",
  async (req: Request) => {
    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: "Stripe is not configured on this deployment." },
        { status: 503 },
      );
    }
    if (!supabaseEnv().configured) {
      return NextResponse.json(
        { error: "Supabase is not configured on this deployment." },
        { status: 503 },
      );
    }

    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth.user) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    // Reuse the checkout limiter — same intent, same per-user cadence.
    const limited = await enforceRateLimit(
      req,
      "stripe-checkout",
      auth.user.id,
    );
    if (limited) return limited;

    // Subscriptions are written by the webhook with the service-role key, so
    // read with that here too. Owner-only RLS would also work, but the
    // service-role read keeps this independent of the migration's policy.
    const admin = createServiceRoleClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Service-role Supabase client unavailable." },
        { status: 503 },
      );
    }

    const { data, error } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error || !data?.stripe_customer_id) {
      logEvent("stripe.portal.no_customer", { userId: auth.user.id });
      return NextResponse.redirect(
        `${appBaseUrl()}/pricing?portal=no_subscription`,
        { status: 303 },
      );
    }

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: data.stripe_customer_id as string,
        return_url: `${appBaseUrl()}/deals`,
      });
      logEvent("stripe.portal.opened", { userId: auth.user.id });
      return NextResponse.redirect(session.url, { status: 303 });
    } catch (err) {
      captureError(err, {
        area: "api.stripe-portal",
        extra: { userId: auth.user.id },
      });
      return NextResponse.json(
        { error: "Could not open billing portal. Please try again." },
        { status: 500 },
      );
    }
  },
);
