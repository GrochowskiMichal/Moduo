/**
 * Edge Function: issue-founder-coupon (admin only)
 *
 * Creates a Stripe Coupon (100% off, once, lifetime entitlement) and records
 * it in founders_interest for the given email. Optionally sends the coupon via Resend.
 *
 * The promotion code is random (16 chars from crypto.getRandomValues, nothing
 * from the email) and bound to the recipient's own Stripe customer, so it works
 * only in their Checkout (MOD-583, _shared/founder-code.ts). The recipient
 * needs a Moduo account with a billing customer (made when the trial starts);
 * without one nothing is created and the answer is 409.
 *
 * Protected: only callers presenting the project's default secret key in the
 * `apikey` header (team dashboard) can hit this.
 *
 * Deploy with verify_jwt = false — auth is the `apikey` header secret check below.
 *
 * Body: { email: string; sendEmail?: boolean }
 * Returns: { couponCode: string; promotionCodeId: string }
 */

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { issueFounderCouponBodySchema, parseJsonBody } from "../_shared/contracts/http-bodies.ts";
import { escapeHtml } from "../_shared/escape.ts";
import { founderCustomerId, founderPromoCode } from "../_shared/founder-code.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const FOUNDERS_PRICE_ID = Deno.env.get("STRIPE_PRICE_FOUNDERS") ?? "";

Deno.serve(async (req: Request) => {
  // Require the project's default secret key in the `apikey` header — the new
  // secret-key transport. Authorization bearer is NOT accepted as a key
  // transport here; the dashboard sends the secret as `apikey`.
  const secretKey = getDefaultSecretKey();
  if (req.headers.get("apikey") !== secretKey) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return Response.json({ error: "email required" }, { status: 400 });
    }
    const parsed = parseJsonBody(issueFounderCouponBodySchema, json);
    if (!parsed.success) return Response.json({ error: "email required" }, { status: 400 });
    const { sendEmail = true } = parsed.data;
    // Supabase Auth keeps emails lower case, and so does the customer Moduo makes.
    const email = parsed.data.email.trim().toLowerCase();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      secretKey,
      { auth: { persistSession: false } }
    );

    // The recipient's own customer: the code is bound to it.
    const candidates = await stripe.customers.list({ email, limit: 20 });
    const uids = [
      ...new Set(candidates.data.map((c) => c.metadata?.supabase_user_id).filter((u): u is string => !!u)),
    ];
    const { data: profiles } = uids.length
      ? await supabase.from("profiles").select("id, stripe_customer_id").in("id", uids)
      : { data: [] };
    const customerId = founderCustomerId(candidates.data, profiles ?? []);
    if (!customerId) {
      return Response.json(
        { error: "No Moduo billing account for this email yet. Ask them to sign up first." },
        { status: 409 },
      );
    }

    // Create a unique 100%-off coupon for this email.
    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: "forever",
      name: `Early Founders — ${email}`,
      max_redemptions: 1,
      metadata: { email, type: "early_founders" },
    });

    // A promotion code only this customer can redeem.
    const promoCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: founderPromoCode(),
      customer: customerId,
      max_redemptions: 1,
      metadata: { email, type: "early_founders" },
    });

    // Record in Supabase.
    await supabase
      .from("founders_interest")
      .upsert(
        {
          email,
          coupon_code: promoCode.code,
          coupon_sent_at: sendEmail ? new Date().toISOString() : null,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "email" }
      );

    // Send via Resend if requested.
    if (sendEmail) {
      const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
      const from = Deno.env.get("RESEND_FROM") ?? "Moduo <hello@moduo.app>";

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from,
          to: email,
          subject: "Your Moduo Early Founders Coupon is here! 🚀",
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px">
              <h2 style="color:#f3f3f3">Welcome to the Moduo Early Founders club!</h2>
              <p style="color:#aaa">
                As promised, here is your personal coupon code for lifetime Pro access:
              </p>
              <div style="background:#111;border:1px solid #333;border-radius:12px;padding:20px;text-align:center;margin:24px 0">
                <code style="font-size:24px;font-weight:bold;color:#f59e0b;letter-spacing:0.1em">
                  ${promoCode.code}
                </code>
              </div>
              <p style="color:#aaa">
                Use this code at checkout to get lifetime Pro access for free.
                Go to <a href="https://moduo.app/#pricing" style="color:#f59e0b">moduo.app/#pricing</a>,
                choose the Pro plan, and enter your coupon at checkout.
              </p>
              <p style="color:#aaa">
                This code is single-use and works only when you're signed in to Moduo as ${escapeHtml(email)}.
              </p>
              <p style="color:#555;font-size:12px">— The Moduo team</p>
            </div>
          `,
        }),
      });
    }

    return Response.json({
      couponCode: promoCode.code,
      promotionCodeId: promoCode.id,
      couponId: coupon.id,
    });
  } catch (err) {
    console.error("[issue-founder-coupon]", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
});
