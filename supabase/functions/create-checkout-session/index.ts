/**
 * Edge Function: create-checkout-session
 *
 * Creates a Stripe Checkout Session for the authenticated user.
 * Called by the frontend when the user clicks a pricing CTA.
 *
 * Accepts both POST (JSON body) and GET (query params) for flexibility.
 *
 * POST body / GET query (prefer plan-based checkout — uses server STRIPE_PRICE_* secrets):
 *   plan        — "pro" | "team"
 *   interval    — "monthly" | "yearly" (optional, default monthly)
 *   priceId     — legacy Stripe price_… (must match a configured STRIPE_PRICE_* if any are set)
 *   successUrl  — URL to redirect to after successful checkout
 *   cancelUrl   — URL to redirect to if the user cancels
 *   access_token — (GET only) JWT when Authorization header cannot be set (browser redirect)
 *
 * Returns: { url: string } — redirect to Stripe Checkout
 *
 * Deploy with verify_jwt = false — the caller's JWT is verified in code
 * (getUser); GET redirects pass access_token as a query param.
 *
 * If the user already has an active/trialing subscription, redirects them to the
 * Stripe Billing Portal instead so they can manage their plan.
 */

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { createCheckoutSessionBodySchema, parseJsonBody } from "../_shared/contracts/http-bodies.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function stripeSecretKeyConfigError(): string | null {
  const k = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!k) return "STRIPE_SECRET_KEY is not set in Edge Function secrets.";
  if (k.startsWith("pk_")) {
    return "STRIPE_SECRET_KEY is a publishable key (pk_…). Set your Stripe secret key (sk_test_… or sk_live_…) in Supabase Edge Function secrets — not the publishable key.";
  }
  if (!k.startsWith("sk_") && !k.startsWith("rk_")) {
    return "STRIPE_SECRET_KEY must start with sk_ or rk_.";
  }
  return null;
}

function normalizeInterval(v: string | null | undefined): "monthly" | "yearly" {
  const s = (v ?? "monthly").toLowerCase();
  return s === "yearly" || s === "annual" ? "yearly" : "monthly";
}

function configuredStripePriceIds(): string[] {
  return [
    Deno.env.get("STRIPE_PRICE_PRO_MONTHLY"),
    Deno.env.get("STRIPE_PRICE_PRO_YEARLY"),
    Deno.env.get("STRIPE_PRICE_TEAM_MONTHLY"),
    Deno.env.get("STRIPE_PRICE_TEAM_YEARLY"),
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
}

function resolveCheckoutPriceId(args: {
  plan?: string | null;
  interval?: string | null;
  priceId?: string | null;
}): { priceId: string } | { error: string } {
  const plan = args.plan?.toLowerCase().trim();
  const interval = normalizeInterval(args.interval);

  if (plan === "pro" || plan === "team") {
    const envKey =
      plan === "pro"
        ? interval === "yearly"
          ? "STRIPE_PRICE_PRO_YEARLY"
          : "STRIPE_PRICE_PRO_MONTHLY"
        : interval === "yearly"
        ? "STRIPE_PRICE_TEAM_YEARLY"
        : "STRIPE_PRICE_TEAM_MONTHLY";
    const id = (Deno.env.get(envKey) ?? "").trim();
    if (!id) {
      return {
        error:
          `Billing is not fully configured: set ${envKey} in Supabase Edge Function secrets to a recurring price_… id from the same Stripe account as STRIPE_SECRET_KEY.`,
      };
    }
    return { priceId: id };
  }

  const raw = (args.priceId ?? "").trim();
  if (!raw) {
    return {
      error:
        'Missing checkout target. Send JSON { plan: "pro"|"team", interval?: "monthly"|"yearly" } or a legacy priceId.',
    };
  }

  const configured = configuredStripePriceIds();
  if (configured.length > 0 && !configured.includes(raw)) {
    return {
      error:
        "This price ID is not allowed for this project. Use plan+interval checkout, or set STRIPE_PRICE_* secrets and PUBLIC_STRIPE_PRICE_* to the same price_… values.",
    };
  }

  return { priceId: raw };
}

function formatStripeErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/no such price/i.test(msg) || /resource_missing.*price/i.test(msg)) {
    return "Stripe could not find this price. In Supabase → Edge Functions → Secrets, set STRIPE_PRICE_* to price_… ids that exist in the Stripe account for your STRIPE_SECRET_KEY (test vs live must match). Run scripts/stripe-bootstrap.ts or copy ids from Stripe → Products.";
  }
  return msg;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const keyErr = stripeSecretKeyConfigError();
    if (keyErr) {
      return Response.json({ error: keyErr }, { status: 500, headers: CORS_HEADERS });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      getDefaultSecretKey(),
      { auth: { persistSession: false } }
    );

    const authFromQuery = (() => {
      try {
        const t = new URL(req.url).searchParams.get("access_token")?.trim();
        return t ? `Bearer ${t}` : null;
      } catch {
        return null;
      }
    })();
    const authHeader = req.headers.get("Authorization") ?? authFromQuery;
    if (!authHeader) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace(/^Bearer\s+/i, "")
    );
    if (authError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }

    let rawInput: unknown;
    if (req.method === "GET") {
      const url = new URL(req.url);
      rawInput = {
        plan: url.searchParams.get("plan") ?? undefined,
        interval: url.searchParams.get("interval") ?? url.searchParams.get("billing") ?? undefined,
        priceId: url.searchParams.get("price_id") ?? url.searchParams.get("priceId") ?? undefined,
        successUrl: url.searchParams.get("successUrl") ?? undefined,
        cancelUrl: url.searchParams.get("cancelUrl") ?? undefined,
        coupon: url.searchParams.get("coupon") ?? undefined,
      };
    } else {
      rawInput = await req.json().catch(() => ({}));
    }
    const parsedInput = parseJsonBody(createCheckoutSessionBodySchema, rawInput);
    if (!parsedInput.success) {
      return Response.json(
        { error: "Invalid request", details: parsedInput.errors },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    const body = parsedInput.data;
    let plan = body.plan;
    let interval = body.interval ?? body.billing_cycle ?? body.billing;
    let priceId = body.priceId ?? body.price_id;
    let successUrl = body.successUrl;
    let cancelUrl = body.cancelUrl;
    const couponCode = body.coupon ?? body.couponCode;

    const resolved = resolveCheckoutPriceId({ plan, interval, priceId });
    if ("error" in resolved) {
      return Response.json({ error: resolved.error }, { status: 400, headers: CORS_HEADERS });
    }
    priceId = resolved.priceId;

    // Derive success/cancel URLs from Referer header if not supplied.
    const referer = req.headers.get("Referer") ?? "https://app.moduo.app";
    const origin = (() => { try { return new URL(referer).origin; } catch { return "https://app.moduo.app"; } })();
    successUrl = successUrl ?? `${origin}/?upgrade=success`;
    cancelUrl = cancelUrl ?? `${origin}/?upgrade=cancelled`;

    // Get or create Stripe customer.
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, display_name")
      .eq("id", user.id)
      .single();

    let customerId: string | undefined = profile?.stripe_customer_id ?? undefined;

    // If we have a stored customer ID, verify it still exists in this Stripe account.
    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/no such customer/i.test(msg)) {
          console.warn(`[create-checkout-session] stale stripe_customer_id ${customerId} for user ${user.id}, creating fresh customer`);
          customerId = undefined;
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

    // Idempotency: if the user already has an active/trialing subscription,
    // check whether they're requesting a different plan (upgrade/change).
    // If same plan → billing portal. If different plan → let Stripe Checkout handle the upgrade.
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 5,
    });
    const activeSub = existingSubs.data.find((s) =>
      ["active", "trialing"].includes(s.status)
    );
    if (activeSub) {
      const currentPriceId = activeSub.items.data[0]?.price?.id;
      const isSamePlan = currentPriceId === priceId;
      if (isSamePlan) {
        // Already on this exact plan → manage via portal
        console.log(`[create-checkout-session] user ${user.id} already on this plan (${activeSub.id}), redirecting to portal`);
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: successUrl,
        });
        return Response.json(
          { url: portalSession.url, already_subscribed: true },
          { headers: CORS_HEADERS }
        );
      }
      // Different plan requested → proceed to Stripe Checkout for upgrade (Stripe handles proration)
      console.log(`[create-checkout-session] user ${user.id} upgrading from ${currentPriceId} to ${priceId}`);
    }

    // Create Checkout Session with a 7-day trial (no card required to start).
    // If a coupon code is supplied, apply it as a discount (disables allow_promotion_codes
    // since Stripe doesn't allow both at once).
    const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_method_collection: "if_required",
      subscription_data: {
        trial_period_days: 7,
        trial_settings: {
          end_behavior: { missing_payment_method: "cancel" },
        },
        metadata: { supabase_user_id: user.id },
      },
    };
    if (couponCode) {
      sessionParams.discounts = [{ coupon: couponCode }];
    } else {
      sessionParams.allow_promotion_codes = true;
    }
    const session = await stripe.checkout.sessions.create(sessionParams);

    return Response.json({ url: session.url }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[create-checkout-session]", err);
    return Response.json(
      { error: formatStripeErr(err) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
