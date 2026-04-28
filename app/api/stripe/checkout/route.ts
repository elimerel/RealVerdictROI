import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import { getStripe, appBaseUrl } from "@/lib/stripe";
import { enforceRateLimit } from "@/lib/ratelimit";
import { withErrorReporting, logEvent, captureError } from "@/lib/observability";

export const POST = withErrorReporting(
  "api.stripe-checkout",
  async (req: Request) => {
    const stripe = getStripe();
    const priceId = process.env.STRIPE_PRICE_ID_PRO?.trim();
    if (!stripe || !priceId) {
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

    const limited = await enforceRateLimit(
      req,
      "stripe-checkout",
      auth.user.id,
    );
    if (limited) return limited;

    const base = appBaseUrl();
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        client_reference_id: auth.user.id,
        customer_email: auth.user.email ?? undefined,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${base}/deals?checkout=success`,
        cancel_url: `${base}/pricing?checkout=canceled`,
        metadata: { supabase_user_id: auth.user.id },
        subscription_data: {
          metadata: { supabase_user_id: auth.user.id },
        },
      });
      if (!session.url) {
        return NextResponse.json(
          { error: "Checkout session missing redirect URL." },
          { status: 500 },
        );
      }
      logEvent("stripe.checkout.created", { userId: auth.user.id });
      return NextResponse.json({ url: session.url });
    } catch (err) {
      captureError(err, {
        area: "api.stripe-checkout",
        extra: { userId: auth.user.id },
      });
      return NextResponse.json(
        { error: "Could not start checkout. Please try again." },
        { status: 500 },
      );
    }
  },
);
