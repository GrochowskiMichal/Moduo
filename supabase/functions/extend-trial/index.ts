/**
 * Edge Function: extend-trial
 *
 * "Try Pro for 14 days with no card, or 30 days with one." When a trialing user has a
 * card on file, extend their trial to 30 days from the subscription start. Called by the
 * app when the user returns from the Billing Portal. Idempotent; server-validated
 * (the card must really exist in Stripe), so calling it freely is safe.
 *
 * POST, Authorization: Bearer <access_token>. Returns { extended: boolean, reason?, trial_ends_at? }.
 * Deploy with verify_jwt = false — the JWT is verified in code.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import {
  authenticate,
  CORS_HEADERS,
  formatStripeErr,
  json,
  makeStripe,
  stripeSecretKeyConfigError,
  TRIAL_DAYS_WITH_CARD,
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

    const { data: profile } = await supabase.from("profiles").select("stripe_customer_id").eq("id", user.id).single();
    const customerId = profile?.stripe_customer_id;
    if (!customerId) return json({ extended: false, reason: "no_customer" });

    const trialing = (await stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 1 })).data[0];
    if (!trialing) return json({ extended: false, reason: "not_trialing" });

    const cards = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    if (cards.data.length === 0) return json({ extended: false, reason: "no_card" });

    const target = trialing.start_date + TRIAL_DAYS_WITH_CARD * 86_400;
    if ((trialing.trial_end ?? 0) >= target) {
      return json({ extended: false, reason: "already_extended", trial_ends_at: new Date((trialing.trial_end ?? target) * 1000).toISOString() });
    }

    await stripe.subscriptions.update(trialing.id, { trial_end: target, proration_behavior: "none" });
    return json({ extended: true, trial_ends_at: new Date(target * 1000).toISOString() });
  } catch (err) {
    console.error("[extend-trial]", err);
    return json({ error: formatStripeErr(err) }, { status: 500 });
  }
});
