/**
 * Connect Google so a booking link can create Meet events while the desktop
 * app is closed. Deploy with verify_jwt = false: the callback is a browser
 * redirect from Google and has no Supabase JWT. The POST actions check the
 * user JWT themselves.
 *
 * POST { action: "start", origin }       Authorization: Bearer <user jwt>
 *   → { url }
 * GET  ?code&state  (Google's redirect)
 *   → 302 to <app>/calendar?connect=google&connect_code&connect_state
 * POST { action: "finish", code, state }  Authorization: Bearer <user jwt>
 *   → { ok } once the tokens are saved; 403 wrong_account if this user didn't start it,
 *     403 bad_state if the state is invalid or expired
 *
 * The callback saves nothing: only the signed-in app can finish, and only for
 * the user who started (see _shared/oauth-connect.ts). <app> is an
 * allow-listed origin, never one taken from the request.
 *
 * GOOGLE_CALENDAR_WEB_CLIENT_ID / GOOGLE_CALENDAR_WEB_CLIENT_SECRET are the
 * Web application OAuth client (the Desktop client cannot register this
 * function's URL as a redirect). MODUO_TOKEN_ENCRYPTION_SECRET matches the
 * desktop uploader and signs `state`. Refresh of a desktop-issued token stays
 * on the desktop client inside booking-public.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { exchangeGoogleCode, googleUserEmail } from "../_shared/google-calendar.ts";
import {
  connectCodeChallenge,
  connectCodeVerifier,
  connectReturnUrl,
  finishRefusal,
  readConnectState,
  signConnectState,
} from "../_shared/oauth-connect.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import { encryptToken } from "../_shared/token-cipher.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET = getDefaultSecretKey();
const ENC = Deno.env.get("MODUO_TOKEN_ENCRYPTION_SECRET") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CALENDAR_WEB_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CALENDAR_WEB_CLIENT_SECRET") ?? "";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

function redirectUri(): string {
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/booking-google-connect`;
}

/** Exchange the code and save the tokens on `uid`, the signed-in user who started. */
async function saveTokens(
  db: SupabaseClient,
  uid: string,
  code: string,
  state: string,
): Promise<Response> {
  let tokens: { accessToken: string; refreshToken: string | null; expiresAt: string };
  try {
    tokens = await exchangeGoogleCode({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      code,
      redirectUri: redirectUri(),
      codeVerifier: await connectCodeVerifier(ENC, "google", state),
    });
  } catch {
    return json({ error: "google_exchange_failed" }, 502);
  }
  if (!tokens.refreshToken) return json({ error: "google_no_refresh" }, 502);
  const accessEnc = await encryptToken(tokens.accessToken, ENC, uid);
  const refreshEnc = await encryptToken(tokens.refreshToken, ENC, uid);
  const email = ((await googleUserEmail(tokens.accessToken)) ?? "").toLowerCase();
  const keyed = email
    ? await db
        .from("user_integrations")
        .select("id")
        .eq("user_id", uid)
        .eq("provider", "google_calendar")
        .eq("account_key", email)
        .maybeSingle()
    : { data: null };
  const legacy = keyed.data
    ? { data: null }
    : await db
        .from("user_integrations")
        .select("id")
        .eq("user_id", uid)
        .eq("provider", "google_calendar")
        .eq("account_key", "")
        .maybeSingle();
  const existingId = (keyed.data?.id ?? legacy.data?.id) as string | undefined;
  const row = {
    user_id: uid,
    provider: "google_calendar",
    account_key: email,
    access_token_enc: accessEnc,
    refresh_token_enc: refreshEnc,
    token_expiry: tokens.expiresAt,
    updated_at: new Date().toISOString(),
  };
  const saved = existingId
    ? await db.from("user_integrations").update(row).eq("id", existingId)
    : await db.from("user_integrations").insert(row);
  if (saved.error) return json({ error: "save_failed" }, 500);
  return json({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!ENC || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return json({ error: "google_not_configured" }, 503);
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const state = url.searchParams.get("state") ?? "";
    const started = await readConnectState(ENC, "google", state);
    if (!started) return json({ error: "bad_callback" }, 400);
    const code = url.searchParams.get("code") ?? "";
    return Response.redirect(connectReturnUrl(started.origin, "google", code, state), 302);
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });
  const user = await db.auth.getUser(jwt);
  if (user.error || !user.data.user) return json({ error: "unauthorized" }, 401);
  const uid = user.data.user.id;

  let body: { action?: unknown; origin?: unknown; code?: unknown; state?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const action = body.action ?? "start";

  if (action === "finish") {
    const state = typeof body.state === "string" ? body.state : "";
    const refused = finishRefusal(await readConnectState(ENC, "google", state), uid);
    if (refused) return json({ error: refused }, 403);
    const code = typeof body.code === "string" ? body.code : "";
    if (!code) return json({ error: "bad_code" }, 400);
    return await saveTokens(db, uid, code, state);
  }

  if (action !== "start") return json({ error: "unknown_action" }, 400);
  const state = await signConnectState(ENC, "google", { uid, origin: body.origin });
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("redirect_uri", redirectUri());
  auth.searchParams.set("scope", SCOPES);
  auth.searchParams.set("state", state);
  auth.searchParams.set(
    "code_challenge",
    await connectCodeChallenge(await connectCodeVerifier(ENC, "google", state)),
  );
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("include_granted_scopes", "true");
  return json({ url: auth.toString() });
});
