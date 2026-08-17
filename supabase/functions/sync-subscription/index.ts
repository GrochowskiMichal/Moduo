/**
 * Edge Function: sync-subscription
 *
 * Force-syncs the authenticated user's Stripe subscription status to their profile.
 * Useful when webhook events were missed or processed out of order.
 *
 * POST /functions/v1/sync-subscription
 * Headers: Authorization: Bearer <access_token>
 * Deploy with verify_jwt = false — the caller's JWT is verified in code (getUser).
 * Returns: { plan_tier, subscription_status }
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const PRICE_TO_TIER = buildPriceToTier();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    getDefaultSecretKey(),
    { auth: { persistSession: false } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, "")
  );
  if (authErr || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return Response.json({ plan_tier: "free", subscription_status: "none" }, { headers: CORS_HEADERS });
    }

    const customerId = profile.stripe_customer_id;

    // Fetch all active/trialing subscriptions and pick the highest tier.
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });
    const active = subs.data.filter((s) => ["active", "trialing"].includes(s.status));

    if (active.length === 0) {
      await supabase.from("profiles").update({
        plan_tier: assertPlanTierForWrite("free"),
        subscription_status: "none",
      }).eq("id", user.id);
      return Response.json({ plan_tier: "free", subscription_status: "none" }, { headers: CORS_HEADERS });
    }

    let best = active[0];
    let bestTier: PlanTier = tierFromPriceId(best.items.data[0]?.price?.id ?? "", PRICE_TO_TIER);

    for (const sub of active.slice(1)) {
      const t = tierFromPriceId(sub.items.data[0]?.price?.id ?? "", PRICE_TO_TIER);
      if ((TIER_RANK[t] ?? 0) > (TIER_RANK[bestTier] ?? 0)) {
        best = sub;
        bestTier = t;
      }
    }

    const planTier = assertPlanTierForWrite(bestTier);
    await supabase.from("profiles").update({
      plan_tier: planTier,
      stripe_subscription_id: best.id,
      subscription_status: best.status,
      current_period_end: new Date(best.current_period_end * 1000).toISOString(),
      plan_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", user.id);

    console.log(`[sync-subscription] user=${user.id} synced to tier=${planTier} sub=${best.id}`);
    return Response.json({ plan_tier: planTier, subscription_status: best.status }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[sync-subscription]", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
