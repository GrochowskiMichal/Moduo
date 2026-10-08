/**
 * Edge Function: analytics-forget (PRIV-3)
 *
 * Deletes what PostHog holds for the signed-in caller when they switch app analytics
 * off (Settings → Preferences → Privacy): the PostHog person whose distinct id is their
 * user id, and their events, which PostHog removes in its weekly deletion run. Account
 * deletion does the same through delete-account. A caller can only ever erase their
 * own analytics: the distinct id is the verified user id, never something they send.
 * The work itself is ../_shared/analytics-forget.ts; it waits about 10 s before
 * deleting, so a request takes that long to answer.
 *
 * Deploy with verify_jwt = false — the caller's JWT is verified in code (getUser).
 * Needs the POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID secrets
 * (../_shared/posthog-erasure.ts).
 *
 * Returns:
 *   200 { ok: true }    PostHog took the deletion
 *   401 / 405 { error }
 *   502 / 503 { error } not done; the app keeps the request and sends it again later.
 *                       503: no PostHog secrets, or PostHog refused them (logged with
 *                       the user id). 502: PostHog or the auth check failed.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { forgetAnalytics } from "../_shared/analytics-forget.ts";
import { postHogEraserFromEnv } from "../_shared/posthog-erasure.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, { ...init, headers: { ...CORS, ...(init?.headers ?? {}) } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, { status: 401 });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", getDefaultSecretKey(), {
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (authError || !user) return json({ error: "Unauthorized" }, { status: 401 });

    const { status, body } = await forgetAnalytics(
      {
        posthog: postHogEraserFromEnv((name) => Deno.env.get(name)),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      user.id,
    );
    return json(body, { status });
  } catch (err) {
    // The auth check or the secret key failed: nothing was deleted, and the app asks again.
    console.error("[analytics-forget]", err);
    return json({ error: "Couldn't delete your analytics right now. Try again later." }, { status: 502 });
  }
});
