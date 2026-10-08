/**
 * Connect Zoom so a booking link can create Zoom meetings while the app is
 * closed. Deploy with verify_jwt = false: the callback is a browser redirect
 * from Zoom and has no Supabase JWT. POST actions check the user JWT.
 *
 * POST { action: "start", origin }        → { url }
 * GET  ?code&state  (Zoom's redirect)     → 302 to <app>/calendar?connect=zoom&connect_code&connect_state
 * POST { action: "finish", code, state }  → { ok }; 403 wrong_account / bad_state (see oauth-connect.ts)
 * POST { action: "status" }               → { configured, connected }
 * POST { action: "disconnect" }           → { ok }
 *
 * The callback saves nothing: only the signed-in app can finish, and only for
 * the user who started (see _shared/oauth-connect.ts). <app> is an
 * allow-listed origin, never one taken from the request; the desktop app
 * starts with app.moduo.app, so a desktop connect finishes in the browser and
 * needs the same account signed in there.
 *
 * ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET are a Zoom Marketplace "General app"
 * (user-managed OAuth) whose redirect URL is this function's URL. Scopes:
 * meeting:write:meeting, meeting:delete:meeting, user:read:user.
 * MODUO_TOKEN_ENCRYPTION_SECRET encrypts the stored tokens and signs `state`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

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
import { exchangeZoomCode, zoomConfigured } from "../_shared/zoom.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET = getDefaultSecretKey();
const ENC = Deno.env.get("MODUO_TOKEN_ENCRYPTION_SECRET") ?? "";

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
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/booking-zoom-connect`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const app = zoomConfigured();
  const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const state = url.searchParams.get("state") ?? "";
    const started = await readConnectState(ENC, "zoom", state);
    if (!started) return json({ error: "bad_callback" }, 400);
    const code = url.searchParams.get("code") ?? "";
    return Response.redirect(connectReturnUrl(started.origin, "zoom", code, state), 302);
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);
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

  if (action === "status") {
    const row = await db
      .from("user_integrations")
      .select("id")
      .eq("user_id", uid)
      .eq("provider", "zoom")
      .not("refresh_token_enc", "is", null)
      .limit(1)
      .maybeSingle();
    return json({ configured: Boolean(app && ENC), connected: Boolean(row.data) });
  }

  if (action === "disconnect") {
    await db.from("user_integrations").delete().eq("user_id", uid).eq("provider", "zoom");
    return json({ ok: true });
  }

  if (action !== "start" && action !== "finish") return json({ error: "unknown_action" }, 400);
  if (!app || !ENC) return json({ error: "zoom_not_configured" }, 503);

  if (action === "start") {
    const state = await signConnectState(ENC, "zoom", { uid, origin: body.origin });
    const auth = new URL("https://zoom.us/oauth/authorize");
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", app.clientId);
    auth.searchParams.set("redirect_uri", redirectUri());
    auth.searchParams.set("state", state);
    auth.searchParams.set(
      "code_challenge",
      await connectCodeChallenge(await connectCodeVerifier(ENC, "zoom", state)),
    );
    auth.searchParams.set("code_challenge_method", "S256");
    return json({ url: auth.toString() });
  }

  const state = typeof body.state === "string" ? body.state : "";
  const refused = finishRefusal(await readConnectState(ENC, "zoom", state), uid);
  if (refused) return json({ error: refused }, 403);
  const code = typeof body.code === "string" ? body.code : "";
  if (!code) return json({ error: "bad_code" }, 400);
  let tokens: { accessToken: string; refreshToken: string; expiresAt: string };
  try {
    tokens = await exchangeZoomCode({
      ...app,
      code,
      redirectUri: redirectUri(),
      codeVerifier: await connectCodeVerifier(ENC, "zoom", state),
    });
  } catch {
    return json({ error: "zoom_exchange_failed" }, 502);
  }
  const row = {
    user_id: uid,
    provider: "zoom",
    account_key: "",
    access_token_enc: await encryptToken(tokens.accessToken, ENC, uid),
    refresh_token_enc: await encryptToken(tokens.refreshToken, ENC, uid),
    token_expiry: tokens.expiresAt,
    updated_at: new Date().toISOString(),
  };
  const existing = await db
    .from("user_integrations")
    .select("id")
    .eq("user_id", uid)
    .eq("provider", "zoom")
    .limit(1)
    .maybeSingle();
  const saved = existing.data?.id
    ? await db.from("user_integrations").update(row).eq("id", existing.data.id)
    : await db.from("user_integrations").insert(row);
  return saved.error ? json({ error: "save_failed" }, 500) : json({ ok: true });
});
