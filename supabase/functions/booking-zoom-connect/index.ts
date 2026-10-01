/**
 * Connect Zoom so a booking link can create Zoom meetings while the app is
 * closed. Deploy with verify_jwt = false: the callback is a browser redirect
 * from Zoom and has no Supabase JWT. POST actions check the user JWT.
 *
 * POST { action: "start", origin }   → { url }
 * POST { action: "status" }          → { configured, connected, email }
 * POST { action: "disconnect" }      → { ok }
 * GET  ?code&state                   → 302 back to origin/calendar?zoom=connected
 *
 * ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET are a Zoom Marketplace "General app"
 * (user-managed OAuth) whose redirect URL is this function's URL. Scopes:
 * meeting:write:meeting, meeting:delete:meeting, user:read:user.
 * MODUO_TOKEN_ENCRYPTION_SECRET encrypts the stored tokens and signs `state`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

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

function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`zoom:${ENC}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signState(payload: string): Promise<string> {
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(payload)),
  );
  return `${payload}.${b64url(sig)}`;
}

async function readState(state: string): Promise<{ uid: string; origin: string } | null> {
  const dot = state.lastIndexOf(".");
  if (dot < 0 || !ENC) return null;
  const payload = state.slice(0, dot);
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    b64urlDecode(state.slice(dot + 1)),
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
    return origin ? { uid: parsed.uid, origin } : null;
  } catch {
    return null;
  }
}

function back(origin: string, result: string): Response {
  return Response.redirect(`${origin}/calendar?zoom=${encodeURIComponent(result)}`, 302);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const app = zoomConfigured();
  const db = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const state = await readState(url.searchParams.get("state") ?? "");
    if (!state) return json({ error: "bad_callback" }, 400);
    const code = url.searchParams.get("code") ?? "";
    if (!code || !app || !ENC) return back(state.origin, "failed");
    let tokens: { accessToken: string; refreshToken: string; expiresAt: string };
    try {
      tokens = await exchangeZoomCode({ ...app, code, redirectUri: redirectUri() });
    } catch {
      return back(state.origin, "failed");
    }
    const row = {
      user_id: state.uid,
      provider: "zoom",
      account_key: "",
      access_token_enc: await encryptToken(tokens.accessToken, ENC, state.uid),
      refresh_token_enc: await encryptToken(tokens.refreshToken, ENC, state.uid),
      token_expiry: tokens.expiresAt,
      updated_at: new Date().toISOString(),
    };
    const existing = await db
      .from("user_integrations")
      .select("id")
      .eq("user_id", state.uid)
      .eq("provider", "zoom")
      .limit(1)
      .maybeSingle();
    const saved = existing.data?.id
      ? await db.from("user_integrations").update(row).eq("id", existing.data.id)
      : await db.from("user_integrations").insert(row);
    return back(state.origin, saved.error ? "failed" : "connected");
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const user = await db.auth.getUser(jwt);
  if (user.error || !user.data.user) return json({ error: "unauthorized" }, 401);
  const uid = user.data.user.id;

  let body: { action?: string; origin?: string } = {};
  try {
    body = (await req.json()) as { action?: string; origin?: string };
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

  if (action !== "start") return json({ error: "unknown_action" }, 400);
  if (!app || !ENC) return json({ error: "zoom_not_configured" }, 503);
  const origin = safeOrigin(typeof body.origin === "string" ? body.origin : "");
  if (!origin) return json({ error: "bad_origin" }, 400);
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ uid, origin, exp: Date.now() + 10 * 60_000 })),
  );
  const auth = new URL("https://zoom.us/oauth/authorize");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", app.clientId);
  auth.searchParams.set("redirect_uri", redirectUri());
  auth.searchParams.set("state", await signState(payload));
  return json({ url: auth.toString() });
});
