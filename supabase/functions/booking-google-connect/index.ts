/**
 * Connect Google so a booking link can create Meet events while the desktop
 * app is closed. Deploy with verify_jwt = false: the callback is a browser
 * redirect from Google and has no Supabase JWT. The start action checks the
 * user JWT itself.
 *
 * POST { action: "start", origin }  Authorization: Bearer <user jwt>
 *   → { url }
 * GET  ?code&state
 *   → 302 back to origin/calendar
 *
 * GOOGLE_CALENDAR_WEB_CLIENT_ID / GOOGLE_CALENDAR_WEB_CLIENT_SECRET are the
 * Web application OAuth client (the Desktop client cannot register this
 * function's URL as a redirect). MODUO_TOKEN_ENCRYPTION_SECRET matches the
 * desktop uploader. Refresh of a desktop-issued token stays on the desktop
 * client inside booking-public.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { exchangeGoogleCode, googleUserEmail } from "../_shared/google-calendar.ts";
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

function safeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signState(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ENC),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

async function readState(state: string): Promise<{ uid: string; origin: string } | null> {
  const dot = state.lastIndexOf(".");
  if (dot < 0 || !ENC) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ENC),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sig),
    new TextEncoder().encode(payload),
  );
  if (!ok) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as {
      uid?: string;
      origin?: string;
      exp?: number;
    };
    if (!parsed.uid || !parsed.origin || !parsed.exp || parsed.exp < Date.now()) return null;
    const origin = safeOrigin(parsed.origin);
    if (!origin) return null;
    return { uid: parsed.uid, origin };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!ENC || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return json({ error: "google_not_configured" }, 503);
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") ?? "";
    const state = await readState(url.searchParams.get("state") ?? "");
    if (!code || !state) return json({ error: "bad_callback" }, 400);
    let tokens: { accessToken: string; refreshToken: string | null; expiresAt: string };
    try {
      tokens = await exchangeGoogleCode({
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        code,
        redirectUri: redirectUri(),
      });
    } catch {
      return json({ error: "google_exchange_failed" }, 502);
    }
    if (!tokens.refreshToken) return json({ error: "google_no_refresh" }, 502);
    const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });
    const accessEnc = await encryptToken(tokens.accessToken, ENC, state.uid);
    const refreshEnc = await encryptToken(tokens.refreshToken, ENC, state.uid);
    const email = ((await googleUserEmail(tokens.accessToken)) ?? "").toLowerCase();
    const keyed = email
      ? await db
          .from("user_integrations")
          .select("id")
          .eq("user_id", state.uid)
          .eq("provider", "google_calendar")
          .eq("account_key", email)
          .maybeSingle()
      : { data: null };
    const legacy = keyed.data
      ? { data: null }
      : await db
          .from("user_integrations")
          .select("id")
          .eq("user_id", state.uid)
          .eq("provider", "google_calendar")
          .eq("account_key", "")
          .maybeSingle();
    const existingId = (keyed.data?.id ?? legacy.data?.id) as string | undefined;
    const row = {
      user_id: state.uid,
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
    return Response.redirect(`${state.origin}/calendar`, 302);
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });
  const user = await db.auth.getUser(jwt);
  if (user.error || !user.data.user) return json({ error: "unauthorized" }, 401);

  let body: { origin?: string } = {};
  try {
    body = (await req.json()) as { origin?: string };
  } catch {
    body = {};
  }
  const origin = safeOrigin(typeof body.origin === "string" ? body.origin : "");
  if (!origin) return json({ error: "bad_origin" }, 400);

  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({ uid: user.data.user.id, origin, exp: Date.now() + 10 * 60_000 }),
    ),
  );
  const state = await signState(payload);
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("redirect_uri", redirectUri());
  auth.searchParams.set("scope", SCOPES);
  auth.searchParams.set("state", state);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("include_granted_scopes", "true");
  return json({ url: auth.toString() });
});
