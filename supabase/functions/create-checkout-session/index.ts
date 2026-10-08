/**
 * Edge Function: create-checkout-session
 *
 * Starts a paid plan for the authenticated user. Entitlements are resolved by the
 * Stripe Sync Engine + DB trigger, never written here.
 *
 * POST { plan: "pro"|"duo"|"team", interval?: "monthly"|"yearly", seats?: number (team, min 3),
 *        withCard?: boolean, successUrl?, cancelUrl?, coupon? }
 * Returns { url }              — redirect to Stripe Checkout or the Billing Portal, or
 *         { switched: true }   — a trialing user changed plan in place (trial kept, no redirect).
 *
 * Rules (no edge cases):
 *  - Live paid subscription (active / past_due)        → Billing Portal (change plan / card there).
 *  - Trialing, different plan                          → switch the subscription in place; trial end unchanged.
 *  - Trialing, same plan                               → Billing Portal (add a card, cancel).
 *  - No live subscription, never subscribed before     → Checkout with a trial (14d, or 30d with a card).
 *  - No live subscription, had a subscription before   → Checkout, no trial, card required (no trial recycling).
 * Deploy with verify_jwt = false — the caller's JWT is verified in code.
 */

import type Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import {
  authenticate,
  CORS_HEADERS,
  formatStripeErr,
  getOrCreateCustomer,
  isPaidPlan,
  json,
  lookupKey,
  makeStripe,
  priceForLookupKey,
  quantityFor,
  safeRedirect,
  stripeSecretKeyConfigError,
  TEAM_MAX_SEATS,
  TEAM_MIN_SEATS,
  TRIAL_DAYS_NO_CARD,
  TRIAL_DAYS_WITH_CARD,
} from "../_shared/billing.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const stripe = makeStripe();
const DEFAULT_ORIGIN = "https://app.moduo.app";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const keyErr = stripeSecretKeyConfigError();
    if (keyErr) return json({ error: keyErr }, { status: 500 });

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", getDefaultSecretKey(), {
      auth: { persistSession: false },
    });

    const queryToken = new URL(req.url).searchParams.get("access_token")?.trim();
    const user = await authenticate(
      supabase,
      req.headers.get("Authorization") ?? (queryToken ? `Bearer ${queryToken}` : null),
    );
    if (!user) return json({ error: "Unauthorized" }, { status: 401 });

    let rawInput: unknown;
    if (req.method === "GET") {
      const q = new URL(req.url).searchParams;
      rawInput = {
        plan: q.get("plan") ?? undefined,
        interval: q.get("interval") ?? q.get("billing") ?? undefined,
        seats: q.get("seats") ? Number(q.get("seats")) : undefined,
        withCard: q.get("withCard") === "true" ? true : undefined,
        successUrl: q.get("successUrl") ?? undefined,
        cancelUrl: q.get("cancelUrl") ?? undefined,
        coupon: q.get("coupon") ?? undefined,
      };
    } else {
      rawInput = await req.json().catch(() => ({}));
    }
    const input = (typeof rawInput === "object" && rawInput !== null ? rawInput : {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const body = {
      plan: str(input.plan),
      interval: str(input.interval) ?? str(input.billing_cycle) ?? str(input.billing),
      seats: typeof input.seats === "number" && Number.isInteger(input.seats) ? input.seats : undefined,
      withCard: input.withCard === true,
      successUrl: str(input.successUrl),
      cancelUrl: str(input.cancelUrl),
      coupon: str(input.coupon) ?? str(input.couponCode),
    };

    const plan = body.plan?.toLowerCase().trim();
    if (!isPaidPlan(plan)) {
      return json({ error: 'Choose a plan: "pro", "duo" or "team".' }, { status: 400 });
    }
    const interval = body.interval;
    if (plan === "team" && body.seats !== undefined && body.seats < TEAM_MIN_SEATS) {
      return json({ error: `Team needs at least ${TEAM_MIN_SEATS} seats.` }, { status: 400 });
    }
    if (plan === "team" && body.seats !== undefined && body.seats > TEAM_MAX_SEATS) {
      return json({ error: `Team supports up to ${TEAM_MAX_SEATS} seats.` }, { status: 400 });
    }

    const referer = req.headers.get("Referer");
    const refererOrigin = (() => { try { return referer ? new URL(referer).origin : DEFAULT_ORIGIN; } catch { return DEFAULT_ORIGIN; } })();
    const fallbackOrigin = safeRedirect(refererOrigin, DEFAULT_ORIGIN);
    const successUrl = safeRedirect(body.successUrl, `${fallbackOrigin}/?upgrade=success`);
    const cancelUrl = safeRedirect(body.cancelUrl, `${fallbackOrigin}/?upgrade=cancelled`);

    // Founders never pay and never need a checkout.
    const { data: me } = await supabase.from("profiles").select("plan_tier").eq("id", user.id).single();
    if (me?.plan_tier === "founder") {
      return json({ error: "Your account is a Founder account — no plan needed." }, { status: 409 });
    }

    const price = await priceForLookupKey(stripe, lookupKey(plan, interval));
    const quantity = quantityFor(plan, body.seats);
    const customerId = await getOrCreateCustomer(stripe, supabase, user);

    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    const live = subs.data.filter((s: Stripe.Subscription) => ["active", "trialing", "past_due"].includes(s.status));
    const paid = live.find((s: Stripe.Subscription) => s.status !== "trialing");
    const trialing = live.find((s: Stripe.Subscription) => s.status === "trialing");

    const portal = async () => {
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: successUrl });
      return json({ url: session.url, portal: true });
    };

    if (paid) return await portal();

    if (trialing) {
      const item = trialing.items.data[0];
      if (item.price.id === price.id && (item.quantity ?? 1) === quantity) return await portal();
      await stripe.subscriptions.update(trialing.id, {
        items: [{ id: item.id, price: price.id, quantity }],
        proration_behavior: "none",
      });
      return json({ switched: true });
    }

    // No live subscription. Trials are one per customer, ever.
    const everSubscribed = subs.data.length > 0;
    const withCard = body.withCard;
    const couponCode = body.coupon;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [
        plan === "team"
          ? { price: price.id, quantity, adjustable_quantity: { enabled: true, minimum: TEAM_MIN_SEATS, maximum: TEAM_MAX_SEATS } }
          : { price: price.id, quantity },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_method_collection: everSubscribed || withCard ? "always" : "if_required",
      subscription_data: {
        ...(everSubscribed
          ? {}
          : {
              trial_period_days: withCard ? TRIAL_DAYS_WITH_CARD : TRIAL_DAYS_NO_CARD,
              trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
            }),
        metadata: { supabase_user_id: user.id },
      },
      ...(couponCode ? { discounts: [{ coupon: couponCode }] } : { allow_promotion_codes: true }),
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("[create-checkout-session]", err);
    return json({ error: formatStripeErr(err) }, { status: 500 });
  }
});
