/**
 * Edge Function: founders-apply
 *
 * Public endpoint called from the landing page "Get in touch" (Early Founders) form.
 * Records interest in the `founders_interest` table and emails the admin team.
 *
 * The actual coupon issuance remains admin-only via issue-founder-coupon.
 *
 * Method: POST
 * Auth:   none (public)
 * Body:   { email: string; message?: string; name?: string }
 * Returns: { success: true }
 *
 * Env vars:
 *   RESEND_API_KEY         — from Resend dashboard
 *   FOUNDERS_NOTIFY_EMAIL  — team email to receive notifications (e.g. founders@moduo.app)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { foundersApplyBodySchema, parseJsonBody } from "../_shared/contracts/http-bodies.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_EMAIL = Deno.env.get("FOUNDERS_NOTIFY_EMAIL") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
    }
    const parsed = parseJsonBody(foundersApplyBodySchema, json);
    if (!parsed.success) {
      return Response.json({ error: "A valid email is required" }, { status: 400, headers: CORS_HEADERS });
    }
    const body = parsed.data;
    const email = body.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return Response.json({ error: "Valid email is required" }, { status: 400, headers: CORS_HEADERS });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      getDefaultSecretKey(),
      { auth: { persistSession: false } }
    );

    // Upsert into founders_interest (idempotent on email).
    const { error: dbError } = await supabase.from("founders_interest").upsert(
      {
        email,
        message: body.message ?? null,
        name: body.name ?? null,
        applied_at: new Date().toISOString(),
      },
      { onConflict: "email" }
    );

    if (dbError) {
      console.error("[founders-apply] DB upsert error:", dbError);
      return Response.json(
        { error: "Could not record your interest. Please try again." },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Send notification email to admin (best-effort — don't fail the response if this fails).
    if (RESEND_API_KEY && NOTIFY_EMAIL) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "moduo <noreply@moduo.app>",
            to: [NOTIFY_EMAIL],
            subject: `New Early Founders application: ${email}`,
            html: `
              <h2>New Early Founders Application</h2>
              <p><strong>Email:</strong> ${email}</p>
              ${body.name ? `<p><strong>Name:</strong> ${body.name}</p>` : ""}
              ${body.message ? `<p><strong>Message:</strong></p><p>${body.message}</p>` : ""}
              <hr>
              <p><small>To issue a coupon, use the admin <code>issue-founder-coupon</code> edge function.</small></p>
            `,
          }),
        });
      } catch (emailErr) {
        console.error("[founders-apply] notification email failed:", emailErr);
      }
    }

    console.log(`[founders-apply] recorded interest for ${email}`);

    return Response.json(
      { success: true, message: "We'll reach out within 48 hours." },
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[founders-apply] unexpected error:", err);
    return Response.json(
      { error: "Internal error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
