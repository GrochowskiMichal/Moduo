/**
 * Edge Function: trial-extension
 *
 * Handles the Stripe `payment_method.attached` webhook event.
 * When a customer attaches a card while on a 7-day trial, this function
 * extends the trial_end to 30 days from the subscription start date.
 *
 * Configure in Stripe Dashboard → Webhooks:
 *   Endpoint URL: https://<project>.supabase.co/functions/v1/trial-extension
 *   Events: payment_method.attached
 *
 * Env vars (set in Supabase Dashboard → Project Settings → Edge Functions → Secrets):
 *   STRIPE_SECRET_KEY      — sk_test_... or sk_live_...
 *   STRIPE_WEBHOOK_SECRET  — whsec_... from the Stripe webhook signing secret
 */

import Stripe from "https://esm.sh/stripe@14?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[trial-extension] webhook signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  // Only react to payment_method.attached — all other events are handled by the Stripe Sync Engine.
  if (event.type !== "payment_method.attached") {
    return new Response(JSON.stringify({ skipped: "not payment_method.attached" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const pm = event.data.object as Stripe.PaymentMethod;
  const customerId = pm.customer as string | null;

  if (!customerId) {
    return new Response(JSON.stringify({ skipped: "no_customer" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Find any active trialing subscription for this customer.
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "trialing",
      limit: 1,
    });

    const sub = subs.data[0];
    if (!sub) {
      return new Response(JSON.stringify({ skipped: "no_trialing_sub" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const targetTrialEnd = sub.start_date + THIRTY_DAYS_SECONDS;
    const currentTrialEnd = sub.trial_end ?? 0;

    if (currentTrialEnd >= targetTrialEnd) {
      console.log(`[trial-extension] sub ${sub.id} already has trial_end >= 30d, skipping`);
      return new Response(JSON.stringify({ skipped: "already_extended", subscriptionId: sub.id }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    await stripe.subscriptions.update(sub.id, {
      trial_end: targetTrialEnd,
      proration_behavior: "none",
    });

    console.log(`[trial-extension] extended trial for sub ${sub.id} to 30d (${new Date(targetTrialEnd * 1000).toISOString()})`);

    return new Response(
      JSON.stringify({
        extended: true,
        subscriptionId: sub.id,
        newTrialEnd: new Date(targetTrialEnd * 1000).toISOString(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[trial-extension] error extending trial:", err);
    return new Response("Internal error", { status: 500 });
  }
});
