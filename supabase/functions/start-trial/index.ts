/**
 * Edge Function: start-trial
 *
 * Creates a 7-day no-card Stripe trial subscription for the authenticated user.
 * Called automatically after a new user completes OTP sign-up on web.
 * Idempotent: if the customer already has any subscription, returns the existing
 * trial_ends_at without creating a new one.
 *
 * Method: POST (no body required)
 * Auth:   Bearer <supabase_access_token>
 * Returns: { trial_ends_at: string (ISO), subscriptionId: string }
 *
 * Env vars (set in Supabase Dashboard → Edge Functions → Secrets):
 *   STRIPE_SECRET_KEY           — sk_test_... or sk_live_...
 *   STRIPE_PRICE_PRO_MONTHLY    — price_... for the Pro Monthly plan
 */

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const TRIAL_DAYS = 7;
const PRO_MONTHLY_PRICE_ID = Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, { ...init, headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) } });

function stripeSecretKeyConfigError(): string | null {
  const k = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!k) return "STRIPE_SECRET_KEY is not set in Edge Function secrets.";
  if (k.startsWith("pk_")) {
    return "STRIPE_SECRET_KEY is a publishable key (pk_…). Use your Stripe secret key (sk_test_… or sk_live_…) in Supabase secrets.";
  }
  if (!k.startsWith("sk_") && !k.startsWith("rk_")) {
    return "STRIPE_SECRET_KEY must start with sk_ or rk_.";
  }
  return null;
}

function formatStripeErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/no such price/i.test(msg) || /resource_missing.*price/i.test(msg)) {
    return "Stripe could not find STRIPE_PRICE_PRO_MONTHLY. Set it in Supabase Edge Function secrets to a price_… id from the same Stripe account and mode (test/live) as STRIPE_SECRET_KEY.";
  }
  return msg;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const keyErr = stripeSecretKeyConfigError();
    if (keyErr) return json({ error: keyErr }, { status: 500 });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Validate the user JWT.
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!PRO_MONTHLY_PRICE_ID) {
      console.error("[start-trial] STRIPE_PRICE_PRO_MONTHLY is not configured");
      return json({ error: "Billing not configured — please contact support." }, { status: 500 });
    }

    // Get or create a Stripe customer for this user.
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, display_name")
      .eq("id", user.id)
      .single();

    let customerId: string = profile?.stripe_customer_id ?? "";

    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/no such customer/i.test(msg)) {
          console.warn(`[start-trial] stale stripe_customer_id ${customerId} for user ${user.id}, creating fresh customer`);
          customerId = "";
          await supabase.from("profiles").update({ stripe_customer_id: null }).eq("id", user.id);
        } else {
          throw e;
        }
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile?.display_name ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // Idempotency: if an active or trialing subscription already exists, return its data.
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 5,
    });
    const activeSub = existingSubs.data.find((s) =>
      ["active", "trialing", "past_due"].includes(s.status)
    );
    if (activeSub) {
      console.log(`[start-trial] customer ${customerId} already has sub ${activeSub.id}`);
      const trialEnd = activeSub.trial_end
        ? new Date(activeSub.trial_end * 1000).toISOString()
        : null;
      return json({ already_subscribed: true, subscriptionId: activeSub.id, trial_ends_at: trialEnd });
    }

    // Create a no-card 7-day trial subscription.
    // payment_method_collection is a Checkout Session param, not valid here.
    // trial_settings.end_behavior handles what happens when the trial ends with no card.
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: PRO_MONTHLY_PRICE_ID, quantity: 1 }],
      trial_period_days: TRIAL_DAYS,
      trial_settings: {
        end_behavior: { missing_payment_method: "cancel" },
      },
      metadata: {
        supabase_user_id: user.id,
        source: "auto_trial",
      },
    });

    const trialEnd = sub.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : null;

    // Immediately write the subscription state to profiles so the client sees
    // the updated plan_tier/subscription_status without waiting for the Stripe
    // Sync Engine → trigger chain (which can take several seconds).
    const currentPeriodEnd = sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null;

    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update({
        plan_tier: "pro",
        stripe_customer_id: customerId,
        stripe_subscription_id: sub.id,
        subscription_status: sub.status, // 'trialing'
        current_period_end: currentPeriodEnd,
        plan_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (profileUpdateError) {
      // Non-fatal: the Sync Engine trigger will eventually catch up.
      console.warn("[start-trial] profile update error (non-fatal):", profileUpdateError.message);
    }

    console.log(`[start-trial] created trial sub ${sub.id} for user ${user.id}, ends ${trialEnd}`);

    return json({ subscriptionId: sub.id, trial_ends_at: trialEnd });
  } catch (err) {
    console.error("[start-trial] error:", err);
    return json(
      { error: formatStripeErr(err) },
      { status: 500 }
    );
  }
});
