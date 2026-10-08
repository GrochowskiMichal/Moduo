/**
 * Edge Function: start-trial
 *
 * Starts the no-card 14-day Pro trial for the authenticated user. Called by the app
 * on first sign-in (invite-only beta: the trial starts when the invite is accepted).
 * Idempotent and one-per-customer: if the customer has ever had any subscription this
 * does nothing. Founders are skipped. Entitlements are resolved by the Stripe Sync
 * Engine + DB trigger, not written here.
 *
 * POST, Authorization: Bearer <access_token>. Returns { started: boolean, reason?: string }.
 * Deploy with verify_jwt = false — the JWT is verified in code.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import {
  authenticate,
  CORS_HEADERS,
  formatStripeErr,
  getOrCreateCustomer,
  json,
  makeStripe,
  priceForLookupKey,
  stripeSecretKeyConfigError,
  TRIAL_DAYS_NO_CARD,
} from "../_shared/billing.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const stripe = makeStripe();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  try {
    const keyErr = stripeSecretKeyConfigError();
    if (keyErr) return json({ error: keyErr }, { status: 500 });

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", getDefaultSecretKey(), {
      auth: { persistSession: false },
    });
    const user = await authenticate(supabase, req.headers.get("Authorization"));
    if (!user) return json({ error: "Unauthorized" }, { status: 401 });

    const { data: me } = await supabase.from("profiles").select("plan_tier").eq("id", user.id).single();
    if (me?.plan_tier === "founder") return json({ started: false, reason: "founder" });

    const customerId = await getOrCreateCustomer(stripe, supabase, user);
    const existing = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 });
    if (existing.data.length > 0) return json({ started: false, reason: "already_had_subscription" });

    const price = await priceForLookupKey(stripe, "pro_monthly");
    const sub = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: price.id, quantity: 1 }],
        trial_period_days: TRIAL_DAYS_NO_CARD,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: { supabase_user_id: user.id, source: "auto_trial" },
      },
      { idempotencyKey: `start-trial-${user.id}` },
    );

    return json({
      started: true,
      subscriptionId: sub.id,
      trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    });
  } catch (err) {
    console.error("[start-trial]", err);
    return json({ error: formatStripeErr(err) }, { status: 500 });
  }
});
