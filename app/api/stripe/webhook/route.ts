import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe";
import { enforceRateLimitByKey } from "@/lib/ratelimit";
import {
  withErrorReporting,
  logEvent,
  captureError,
} from "@/lib/observability";

export const dynamic = "force-dynamic";

const USER_META = "supabase_user_id";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}

function priceIdFromSubscription(sub: Stripe.Subscription): string | null {
  const price = sub.items.data[0]?.price;
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

// Stripe API ≥ 2025-08-27 moved current_period_end from Subscription to
// SubscriptionItem. Read from items first, fall back to subscription-level
// for older API versions or fixtures that still expose it.
function currentPeriodEndIso(sub: Stripe.Subscription): string | null {
  const items = sub.items?.data ?? [];
  let max: number | null = null;
  for (const item of items) {
    const ts = (item as { current_period_end?: number | null })
      .current_period_end;
    if (typeof ts === "number" && (max === null || ts > max)) max = ts;
  }
  if (max === null) {
    const legacy = (sub as { current_period_end?: number | null })
      .current_period_end;
    if (typeof legacy === "number") max = legacy;
  }
  return max === null ? null : new Date(max * 1000).toISOString();
}

function customerIdFromSubscription(sub: Stripe.Subscription): string {
  const c = sub.customer;
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && "id" in c) {
    return (c as { id: string }).id;
  }
  return "";
}

async function resolveUserIdForSubscription(
  admin: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  sub: Stripe.Subscription,
): Promise<string | null> {
  const meta = sub.metadata?.[USER_META];
  if (meta && isUuid(meta)) return meta;

  const subId = sub.id;
  const { data: bySub } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();
  const bySubUid = bySub as { user_id?: string } | null;
  if (bySubUid?.user_id) return bySubUid.user_id;

  const customerId = customerIdFromSubscription(sub);
  if (!customerId) return null;

  const { data: byCus } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  const byCusUid = byCus as { user_id?: string } | null;
  if (byCusUid?.user_id) return byCusUid.user_id;

  return null;
}

async function upsertSubscriptionRow(
  admin: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  userId: string,
  sub: Stripe.Subscription,
) {
  const customerId = customerIdFromSubscription(sub);
  if (!customerId) {
    throw new Error("subscription_missing_customer");
  }
  const row = {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: priceIdFromSubscription(sub),
    current_period_end: currentPeriodEndIso(sub),
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("subscriptions").upsert(row, {
    onConflict: "user_id",
  });
  if (error) throw error;
}

export const POST = withErrorReporting(
  "api.stripe-webhook",
  async (req: Request) => {
    const limited = await enforceRateLimitByKey(
      "stripe-webhook",
      "stripe-inbound",
    );
    if (limited) return limited;

    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    const admin = createServiceRoleClient();

    if (!stripe || !secret || !admin) {
      logEvent("stripe.webhook.misconfigured", {
        hasStripe: Boolean(stripe),
        hasSecret: Boolean(secret),
        hasAdmin: Boolean(admin),
      });
      return NextResponse.json(
        { error: "Webhook endpoint not fully configured." },
        { status: 503 },
      );
    }

    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ error: "Missing signature." }, { status: 400 });
    }

    let event: Stripe.Event;
    const rawBody = await req.text();
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err) {
      captureError(err, { area: "api.stripe-webhook", extra: { phase: "verify" } });
      return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode !== "subscription") break;

          const userIdRaw =
            session.client_reference_id ||
            session.metadata?.[USER_META] ||
            "";
          if (!isUuid(userIdRaw)) {
            logEvent("stripe.webhook.checkout.skip", {
              reason: "bad_user_id",
              sessionId: session.id,
            });
            break;
          }

          const subRef = session.subscription;
          const subId =
            typeof subRef === "string" ? subRef : subRef?.id ?? null;
          if (!subId) {
            logEvent("stripe.webhook.checkout.skip", {
              reason: "no_subscription",
              sessionId: session.id,
            });
            break;
          }

          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscriptionRow(admin, userIdRaw, sub);
          logEvent("stripe.webhook.checkout_ok", {
            userId: userIdRaw,
            status: sub.status,
          });
          break;
        }

        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const userId = await resolveUserIdForSubscription(admin, sub);
          if (!userId) {
            logEvent("stripe.webhook.subscription.skip", {
              reason: "no_user",
              subscriptionId: sub.id,
            });
            break;
          }
          await upsertSubscriptionRow(admin, userId, sub);
          logEvent("stripe.webhook.subscription_updated", {
            userId,
            status: sub.status,
          });
          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const userId = await resolveUserIdForSubscription(admin, sub);
          if (!userId) {
            logEvent("stripe.webhook.subscription.skip", {
              reason: "no_user",
              subscriptionId: sub.id,
            });
            break;
          }
          const customerId = customerIdFromSubscription(sub);
          if (!customerId) {
            logEvent("stripe.webhook.subscription.skip", {
              reason: "no_customer",
              subscriptionId: sub.id,
            });
            break;
          }
          const { error } = await admin.from("subscriptions").upsert(
            {
              user_id: userId,
              stripe_customer_id: customerId,
              stripe_subscription_id: sub.id,
              status: "canceled",
              price_id: priceIdFromSubscription(sub),
              current_period_end: currentPeriodEndIso(sub),
              cancel_at_period_end: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
          if (error) throw error;
          logEvent("stripe.webhook.subscription_deleted", { userId });
          break;
        }

        default:
          logEvent("stripe.webhook.ignored", { type: event.type });
      }
    } catch (err) {
      captureError(err, {
        area: "api.stripe-webhook",
        extra: { type: event.type, id: event.id },
      });
      return NextResponse.json({ error: "Handler failed." }, { status: 500 });
    }

    return NextResponse.json({ received: true });
  },
);
