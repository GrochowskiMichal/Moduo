/**
 * Edge Function: create-portal-session
 *
 * Creates a Stripe Billing Portal session so the user can manage
 * their subscription (cancel, update payment method, download invoices).
 *
 * Body: { returnUrl: string }
 * Returns: { url: string }
 *
 * Deploy with verify_jwt = false — the caller's JWT is verified in code (getUser).
 */

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { createPortalSessionBodySchema, parseJsonBody } from "../_shared/contracts/http-bodies.ts";
import { safeRedirect } from "../_shared/billing.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, { ...init, headers: { ...CORS, ...(init?.headers ?? {}) } });

/** Stripe server calls must use sk_… or rk_… — never pk_… */
function stripeSecretKeyConfigError(): string | null {
  const k = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!k) return "STRIPE_SECRET_KEY is not set in Edge Function secrets.";
  if (k.startsWith("pk_")) {
    return "STRIPE_SECRET_KEY is a publishable key (pk_…). Set it to your Stripe secret key (sk_test_… or sk_live_…) from Dashboard → Developers → API keys. The publishable key belongs only in the frontend env.";
  }
  if (!k.startsWith("sk_") && !k.startsWith("rk_")) {
    return "STRIPE_SECRET_KEY must start with sk_ (secret) or rk_ (restricted with billing).";
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const keyErr = stripeSecretKeyConfigError();
    if (keyErr) return json({ error: keyErr }, { status: 500 });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      getDefaultSecretKey(),
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, { status: 401 });

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) return json({ error: "Unauthorized" }, { status: 401 });

    const rawBody = await req.json().catch(() => ({}));
    const parsedBody = parseJsonBody(createPortalSessionBodySchema, rawBody);
    if (!parsedBody.success) {
      return json({ error: "Invalid request", details: parsedBody.errors }, { status: 400 });
    }
    const returnUrl = safeRedirect(
      parsedBody.data.returnUrl,
      Deno.env.get("APP_URL") ?? "https://app.moduo.app",
    );

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return json({ error: "No billing account found. Start a trial first." }, { status: 404 });
    }

    // Verify the customer still exists in this Stripe account.
    try {
      await stripe.customers.retrieve(profile.stripe_customer_id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/no such customer/i.test(msg)) {
        await supabase.from("profiles").update({ stripe_customer_id: null }).eq("id", user.id);
        return json({ error: "No billing account found. Start a trial first." }, { status: 404 });
      }
      throw e;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: returnUrl,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("[create-portal-session]", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
});
