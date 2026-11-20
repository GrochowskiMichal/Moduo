/**
 * Outlook Calendar for the web app: connect a Microsoft login, then read its
 * calendars through the refresh token stored here (the browser can't read the
 * desktop keychain). View only, like the desktop app. Deploy with
 * verify_jwt = false: the callback is a browser redirect from Microsoft with no
 * Supabase JWT. The POST actions check the user JWT themselves.
 *
 * POST { action: "start", origin }        → { url }
 * GET  ?code&state  (Microsoft's redirect) → 302 to <app>/calendar?connect=microsoft&connect_code&connect_state
 * POST { action: "finish", code, state }  → { ok, email }; 403 wrong_account / bad_state as booking-google-connect
 * POST { action: "events", externalAccountId: "outlook:<email>", timeMin, timeMax }
 *   → { events } (every calendar, each tagged calendarId "<externalAccountId>:<calendarId>")
 *   409 { error: "outlook_reauth" } when Microsoft revoked the login, 409 outlook_not_connected without one
 * POST { action: "disconnect", email }    → { ok }
 *
 * The callback saves nothing: only the signed-in app finishes, and only for the
 * user who started (see _shared/oauth-connect.ts).
 *
 * MICROSOFT_CALENDAR_WEB_CLIENT_ID / MICROSOFT_CALENDAR_WEB_CLIENT_SECRET are the
 * Web platform of the Entra app (its redirect URI is this function's URL).
 * MODUO_TOKEN_ENCRYPTION_SECRET encrypts the tokens and signs `state`.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { APP_TOKEN_REFUSAL, verifiedPerson } from "../_shared/app-token.ts";
import {
  exchangeMicrosoftCode,
  listMicrosoftCalendars,
  listMicrosoftEvents,
  MICROSOFT_AUTHORIZE_URL,
  MICROSOFT_SCOPES,
  type MicrosoftClient,
  microsoftAccessOutcome,
  type MicrosoftTokenRow,
  microsoftUserEmail,
  outlookAccountEmail,
} from "../_shared/microsoft-calendar.ts";
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
const CLIENT: MicrosoftClient = {
  id: Deno.env.get("MICROSOFT_CALENDAR_WEB_CLIENT_ID") ?? "",
  secret: Deno.env.get("MICROSOFT_CALENDAR_WEB_CLIENT_SECRET") ?? "",
};
const PROVIDER = "microsoft_calendar";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TokenRow = MicrosoftTokenRow & { account_key: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

function redirectUri(): string {
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/calendar-microsoft-web`;
}

/** Exchange the code and save the tokens on `uid`, the signed-in user who started. */
async function saveTokens(db: SupabaseClient, uid: string, code: string, state: string): Promise<Response> {
  let tokens: Awaited<ReturnType<typeof exchangeMicrosoftCode>>;
  try {
    tokens = await exchangeMicrosoftCode({
      client: CLIENT,
      code,
      redirectUri: redirectUri(),
      codeVerifier: await connectCodeVerifier(ENC, "microsoft", state),
    });
  } catch {
    return json({ error: "microsoft_exchange_failed" }, 502);
  }
  if (!tokens.refreshToken) return json({ error: "microsoft_no_refresh" }, 502);
  let email: string | null;
  try {
    email = await microsoftUserEmail(tokens.accessToken);
  } catch {
    email = null;
  }
  if (!email) return json({ error: "microsoft_no_email" }, 502);
  const row = {
    user_id: uid,
    provider: PROVIDER,
    account_key: email,
    access_token_enc: await encryptToken(tokens.accessToken, ENC, uid),
    refresh_token_enc: await encryptToken(tokens.refreshToken, ENC, uid),
    token_expiry: tokens.expiresAt,
    updated_at: new Date().toISOString(),
  };
  const saved = await db.from("user_integrations").upsert(row, { onConflict: "user_id,provider,account_key" });
  if (saved.error) return json({ error: "save_failed" }, 500);
  return json({ ok: true, email });
}

async function tokensForUser(db: SupabaseClient, userId: string): Promise<TokenRow[]> {
  const res = await db
    .from("user_integrations")
    .select("id, account_key, refresh_token_enc, access_token_enc, token_expiry")
    .eq("user_id", userId)
    .eq("provider", PROVIDER);
  return (res.data ?? []) as TokenRow[];
}

function accessFor(db: SupabaseClient, userId: string, row: TokenRow) {
  return microsoftAccessOutcome({ db, encSecret: ENC, client: CLIENT }, userId, row);
}

async function eventsAction(db: SupabaseClient, userId: string, body: Record<string, unknown>): Promise<Response> {
  const email = outlookAccountEmail(body.externalAccountId);
  if (!email) return json({ error: "bad_account" }, 400);
  // Tag events with the account id as sent: the desktop app keeps Microsoft's
  // casing, and a changed calendarId would rewrite every mirrored row on each sync.
  const accountId = body.externalAccountId as string;
  const timeMin = typeof body.timeMin === "string" ? body.timeMin : "";
  const timeMax = typeof body.timeMax === "string" ? body.timeMax : "";
  if (!timeMin || !timeMax) return json({ error: "bad_window" }, 400);
  const row = (await tokensForUser(db, userId)).find((r) => r.account_key === email);
  if (!row) return json({ error: "outlook_not_connected" }, 409);
  const outcome = await accessFor(db, userId, row);
  if (outcome.kind === "revoked") return json({ error: "outlook_reauth" }, 409);
  if (outcome.kind !== "ok") return json({ error: "outlook_unavailable" }, 502);
  // Any failed read fails the whole answer: a partial list would read as deletions.
  const events: Record<string, unknown>[] = [];
  try {
    for (const cal of await listMicrosoftCalendars(outcome.accessToken)) {
      const items = await listMicrosoftEvents({ accessToken: outcome.accessToken, calendarId: cal.id, timeMin, timeMax });
      for (const item of items) events.push({ ...item, calendarId: `${accountId}:${cal.id}` });
    }
  } catch {
    return json({ error: "outlook_events_failed" }, 502);
  }
  return json({ events });
}

/** Microsoft's redirect: check the signed state, then send the browser back to the app with the code. */
async function callback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const started = await readConnectState(ENC, "microsoft", state);
  if (!started) return json({ error: "bad_callback" }, 400);
  const code = url.searchParams.get("code") ?? "";
  return Response.redirect(connectReturnUrl(started.origin, "microsoft", code, state), 302);
}

async function startAction(uid: string, body: Record<string, unknown>): Promise<Response> {
  const state = await signConnectState(ENC, "microsoft", { uid, origin: body.origin });
  const auth = new URL(MICROSOFT_AUTHORIZE_URL);
  auth.searchParams.set("client_id", CLIENT.id);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("response_mode", "query");
  auth.searchParams.set("redirect_uri", redirectUri());
  auth.searchParams.set("scope", MICROSOFT_SCOPES);
  auth.searchParams.set("state", state);
  auth.searchParams.set(
    "code_challenge",
    await connectCodeChallenge(await connectCodeVerifier(ENC, "microsoft", state)),
  );
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("prompt", "select_account");
  return json({ url: auth.toString() });
}

async function finishAction(db: SupabaseClient, uid: string, body: Record<string, unknown>): Promise<Response> {
  const state = typeof body.state === "string" ? body.state : "";
  const refused = finishRefusal(await readConnectState(ENC, "microsoft", state), uid);
  if (refused) return json({ error: refused }, 403);
  const code = typeof body.code === "string" ? body.code : "";
  if (!code) return json({ error: "bad_code" }, 400);
  return await saveTokens(db, uid, code, state);
}

async function disconnectAction(db: SupabaseClient, uid: string, body: Record<string, unknown>): Promise<Response> {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return json({ error: "bad_account" }, 400);
  const removed = await db
    .from("user_integrations")
    .delete()
    .eq("user_id", uid)
    .eq("provider", PROVIDER)
    .eq("account_key", email);
  if (removed.error) return json({ error: "disconnect_failed" }, 500);
  return json({ ok: true });
}

type Action = (db: SupabaseClient, uid: string, body: Record<string, unknown>) => Promise<Response>;

const ACTIONS: Record<string, Action> = {
  start: (_db, uid, body) => startAction(uid, body),
  finish: finishAction,
  events: eventsAction,
  disconnect: disconnectAction,
};

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!ENC || !CLIENT.id || !CLIENT.secret) return json({ error: "outlook_not_configured" }, 503);
  if (req.method === "GET") return await callback(req);
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });
  const caller = await verifiedPerson(db.auth, req.headers.get("Authorization"));
  if (caller.kind === "app") return json(APP_TOKEN_REFUSAL, 403);
  if (caller.kind !== "person") return json({ error: "unauthorized" }, 401);

  const body = await readBody(req);
  const name = typeof body.action === "string" ? body.action : "";
  const action = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined;
  if (!action) return json({ error: "unknown_action" }, 400);
  return await action(db, caller.user.id, body);
});
