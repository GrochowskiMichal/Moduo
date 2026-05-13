/**
 * Edge Function: sync-subscription
 *
 * Force-syncs the authenticated user's Stripe subscription status to their profile.
 * Useful when webhook events were missed or processed out of order.
 *
 * POST /functions/v1/sync-subscription
 * Headers: Authorization: Bearer <access_token>
 * Returns: { plan_tier, subscription_status }
 */

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const PRICE_TO_TIER: Record<string, string> = {
  [Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") ?? ""]: "pro",
  [Deno.env.get("STRIPE_PRICE_PRO_YEARLY") ?? ""]: "pro",
  [Deno.env.get("STRIPE_PRICE_TEAM_MONTHLY") ?? ""]: "team",
  [Deno.env.get("STRIPE_PRICE_TEAM_YEARLY") ?? ""]: "team",
  [Deno.env.get("STRIPE_PRICE_FOUNDERS") ?? ""]: "founders",
};

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, founders: 2, team: 3 };

function tierFromPriceId(priceId: string): string {
  return PRICE_TO_TIER[priceId] ?? "free";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
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
      await supabase.from("profiles").update({ plan_tier: "free", subscription_status: "none" }).eq("id", user.id);
      return Response.json({ plan_tier: "free", subscription_status: "none" }, { headers: CORS_HEADERS });
    }

    let best = active[0];
    let bestTier = tierFromPriceId(best.items.data[0]?.price?.id ?? "");

    for (const sub of active.slice(1)) {
      const t = tierFromPriceId(sub.items.data[0]?.price?.id ?? "");
      if ((TIER_RANK[t] ?? 0) > (TIER_RANK[bestTier] ?? 0)) {
        best = sub;
        bestTier = t;
      }
    }

    await supabase.from("profiles").update({
      plan_tier: bestTier,
      stripe_subscription_id: best.id,
      subscription_status: best.status,
      current_period_end: new Date(best.current_period_end * 1000).toISOString(),
      plan_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", user.id);

    console.log(`[sync-subscription] user=${user.id} synced to tier=${bestTier} sub=${best.id}`);
    return Response.json({ plan_tier: bestTier, subscription_status: best.status }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[sync-subscription]", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
