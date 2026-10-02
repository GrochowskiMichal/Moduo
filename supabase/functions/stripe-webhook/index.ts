/**
 * Edge Function: stripe-webhook
 *
 * Receives and verifies Stripe webhook events.
 * Updates profiles.plan_tier and inserts into subscription_events.
 *
 * Set the Stripe webhook endpoint URL to:
 *   https://<project>.supabase.co/functions/v1/stripe-webhook
 *
 * Relevant events:
 *   - checkout.session.completed
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.payment_failed
 */

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { type PlanTier } from "../_shared/contracts/vocabularies.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import {
  assertPlanTierForWrite,
  buildPriceToTier,
  TIER_RANK,
  tierFromPriceId,
} from "../_shared/stripe-tier.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const PRICE_TO_TIER = buildPriceToTier("price_founders");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    getDefaultSecretKey(),
    { auth: { persistSession: false } }
  );

  try {
    await handleEvent(supabase, event);
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    return new Response("Handler error", { status: 500 });
  }
});

async function handleEvent(supabase: ReturnType<typeof createClient>, event: Stripe.Event) {
  // Record every event for audit/debugging.
  // Schema: id, stripe_event_id, event_type, customer_id, subscription_id, payload, processed_at
  const obj = event.data.object as Record<string, unknown>;
  const customerId = (obj.customer ?? obj.customer_id ?? null) as string | null;
  const subscriptionId = (obj.subscription ?? obj.id ?? null) as string | null;

  await supabase.from("subscription_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    customer_id: customerId,
    subscription_id: subscriptionId,
    payload: event.data.object,
    processed_at: new Date().toISOString(),
  });

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") break;
      const userId = session.metadata?.supabase_user_id ?? await lookupUserByCustomer(supabase, session.customer as string);
      if (!userId) { console.warn("[stripe-webhook] no user for checkout session", session.id); break; }
      // Use best active tier across ALL subscriptions for this customer.
      const { tier, subscription } = await bestActiveTier(session.customer as string);
      const sub = subscription ?? await stripe.subscriptions.retrieve(session.subscription as string);
      await updateProfileTier(supabase, userId, tier, session.customer as string, sub);
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.supabase_user_id ?? await lookupUserByCustomer(supabase, sub.customer as string);
      if (!userId) break;
      // Re-evaluate across ALL active subs — prevents a lower-tier sub's update from downgrading.
      const { tier, subscription } = await bestActiveTier(sub.customer as string);
      await updateProfileTier(supabase, userId, tier, sub.customer as string, subscription ?? sub);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.supabase_user_id ?? await lookupUserByCustomer(supabase, sub.customer as string);
      if (!userId) break;
      // Check remaining active subs before downgrading to free.
      const { tier, subscription } = await bestActiveTier(sub.customer as string);
      if (tier === "free") {
        await updateProfileTier(supabase, userId, "free", sub.customer as string, sub);
      } else {
        await updateProfileTier(supabase, userId, tier, sub.customer as string, subscription!);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const userId = await lookupUserByCustomer(supabase, invoice.customer as string);
      if (userId) {
        await supabase
          .from("profiles")
          .update({ plan_tier: assertPlanTierForWrite("free") })
          .eq("id", userId);
      }
      break;
    }
  }
}

function tierFromSubscription(sub: Stripe.Subscription): PlanTier {
  const priceId = sub.items.data[0]?.price?.id ?? "";
  return tierFromPriceId(priceId, PRICE_TO_TIER);
}

/**
 * Fetches ALL active/trialing subscriptions for a customer and returns the
 * highest tier among them, plus the subscription that provides it.
 */
async function bestActiveTier(customerId: string): Promise<{ tier: PlanTier; subscription: Stripe.Subscription | null }> {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });
  const active = subs.data.filter((s) => ["active", "trialing"].includes(s.status));
  if (active.length === 0) return { tier: "free", subscription: null };

  let best: Stripe.Subscription = active[0];
  let bestTier = tierFromSubscription(active[0]);

  for (const sub of active.slice(1)) {
    const t = tierFromSubscription(sub);
    if ((TIER_RANK[t] ?? 0) > (TIER_RANK[bestTier] ?? 0)) {
      best = sub;
      bestTier = t;
    }
  }
  return { tier: bestTier, subscription: best };
}

async function lookupUserByCustomer(
  supabase: ReturnType<typeof createClient>,
  customerId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();
  return data?.id ?? null;
}

async function updateProfileTier(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  tier: PlanTier,
  customerId: string,
  subscription: Stripe.Subscription
) {
  await supabase.from("profiles").update({
    plan_tier: assertPlanTierForWrite(tier),
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    plan_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", userId);
}
