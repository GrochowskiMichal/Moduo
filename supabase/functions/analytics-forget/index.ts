/**
 * Edge Function: analytics-forget (PRIV-3)
 *
 * Deletes what PostHog holds for the signed-in caller when they switch app analytics
 * off (Settings → Preferences → Privacy): the PostHog person whose distinct id is their
 * user id, and their events, which PostHog removes in its weekly deletion run. Account
 * deletion does the same through delete-account. A caller can only ever erase their
 * own analytics: the distinct id is the verified user id, never something they send.
 *
 * Deploy with verify_jwt = false — the caller's JWT is verified in code (getUser).
 * Needs the POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID secrets
 * (../_shared/posthog-erasure.ts); without them there is nothing to delete with.
 *
 * Returns:
 *   200 { ok: true, queued: true }                PostHog took the deletion
 *   200 { ok: true, skipped: "not_configured" }   no PostHog secrets
 *   200 { ok: true, skipped: "refused" }          PostHog refused for good (logged)
 *   401 { error }  /  502 { error }                502: try again later (the app does)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

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
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Unauthorized" }, { status: 401 });

    const posthog = postHogEraserFromEnv((name) => Deno.env.get(name));
    if (!posthog) return json({ ok: true, skipped: "not_configured" });

    const result = await posthog.erasePerson(user.id);
    if (result.status === "refused") {
      // A wrong key, scope or project id: retrying won't help. Logged with the user id
      // so the analytics can still be deleted by hand once the setup is fixed.
      console.warn("[analytics-forget] PostHog refused", user.id, result.httpStatus);
      return json({ ok: true, skipped: "refused" });
    }
    return json({ ok: true, queued: true });
  } catch (err) {
    console.error("[analytics-forget]", err);
    return json({ error: "Couldn't delete your analytics right now. Try again later." }, { status: 502 });
  }
});
