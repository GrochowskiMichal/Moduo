/**
 * Edge Function: issue-founder-coupon (admin only)
 *
 * Creates a Stripe Coupon (100% off, once, lifetime entitlement) and records
 * it in founders_interest for the given email. Optionally sends the coupon via Resend.
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
    const { email, sendEmail = true } = await req.json();
    if (!email) return Response.json({ error: "email required" }, { status: 400 });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      secretKey,
      { auth: { persistSession: false } }
    );

    // Create a unique 100%-off coupon for this email.
    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: "forever",
      name: `Early Founders — ${email}`,
      max_redemptions: 1,
      metadata: { email, type: "early_founders" },
    });

    // Turn it into a promotion code for easy sharing.
    const code = email
      .split("@")[0]
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10);

    const promoCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: `FOUNDERS-${code}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
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
                This code is single-use and reserved for you — please don't share it.
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
