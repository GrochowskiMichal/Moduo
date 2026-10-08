/**
 * Account-linking OAuth for booking-google-connect and booking-zoom-connect.
 *
 * The provider's callback is a browser redirect with no Moduo session, so it
 * can't know who consented, and it doesn't decide whose account the tokens are
 * saved on. It only checks the signed `state` and sends the browser back to
 * the app with the code; the signed-in app posts code + state with its own
 * session (`action: "finish"`), and the function exchanges the code only when
 * that session's user is the one who started (the app also asks before
 * finishing a connect this tab didn't start). The app it returns to is one of
 * our https app hosts, never a host taken from the request.
 *
 * PKCE ties a code to the state it was started with, so a code can only be
 * finished together with its own state, and so only by the user who started.
 * docs/gotchas/calendar.md
 */

import { allowListedOrigin, APP_ORIGINS, CANONICAL_APP_ORIGIN } from "./app-origin.ts";

export type ConnectProvider = "google" | "zoom";

export type ConnectState = { uid: string; origin: string; exp: number };

export const CONNECT_STATE_TTL_MS = 10 * 60_000;

/**
 * Our deployed app hosts. Not the dev server: `start` takes its origin from the
 * request, so allowing localhost would let anyone send a consenting person's
 * code to whatever listens on that person's port 8081. A connect started on the
 * dev server finishes on app.moduo.app (same backend).
 */
export const CONNECT_RETURN_ORIGINS: readonly string[] = APP_ORIGINS.filter((origin) =>
  origin.startsWith("https://"),
);

/** Where a connect returns: the caller's app host when it is one of ours, else app.moduo.app. */
export function connectReturnOrigin(hint: unknown): string {
  return allowListedOrigin(hint, CONNECT_RETURN_ORIGINS) ?? CANONICAL_APP_ORIGIN;
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

/** One key per provider, so a Google state is never accepted by the Zoom function. */
async function stateKey(secret: string, provider: ConnectProvider): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${provider}:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signConnectState(
  secret: string,
  provider: ConnectProvider,
  start: { uid: string; origin: unknown },
  now = Date.now(),
): Promise<string> {
  if (!secret) throw new Error("signConnectState needs a secret");
  const state: ConnectState = {
    uid: start.uid,
    origin: connectReturnOrigin(start.origin),
    exp: now + CONNECT_STATE_TTL_MS,
  };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(state)));
  const sig = await crypto.subtle.sign(
    "HMAC",
    await stateKey(secret, provider),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

/** The state when its signature is ours for this provider and it hasn't expired, else null. */
export async function readConnectState(
  secret: string,
  provider: ConnectProvider,
  state: unknown,
  now = Date.now(),
): Promise<ConnectState | null> {
  if (!secret || typeof state !== "string") return null;
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = state.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await stateKey(secret, provider),
      b64urlDecode(state.slice(dot + 1)),
      new TextEncoder().encode(payload),
    );
    if (!ok) return null;
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as Partial<ConnectState>;
    if (typeof parsed.uid !== "string" || !parsed.uid) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
    const origin = allowListedOrigin(parsed.origin, CONNECT_RETURN_ORIGINS);
    return origin ? { uid: parsed.uid, origin, exp: parsed.exp } : null;
  } catch {
    return null;
  }
}

/**
 * The PKCE verifier for a connect: an HMAC of its state, so it needs no storage
 * and only this server can produce it. 32 bytes → 43 base64url characters, the
 * shortest verifier PKCE allows. The provider redeems a code only with the
 * verifier of the state it was started with.
 */
export async function connectCodeVerifier(
  secret: string,
  provider: ConnectProvider,
  state: string,
): Promise<string> {
  if (!secret) throw new Error("connectCodeVerifier needs a secret");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`pkce:${provider}:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(state));
  return b64url(new Uint8Array(mac));
}

/** The S256 `code_challenge` for a verifier (RFC 7636). */
export async function connectCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

/**
 * Why `uid` (the signed-in user finishing) may not finish this connect, or null
 * when it may. `wrong_account`: another account started it (for example a
 * desktop user whose browser is signed in to a different account).
 */
export function finishRefusal(
  state: ConnectState | null,
  uid: string,
): "bad_state" | "wrong_account" | null {
  if (!state) return "bad_state";
  return state.uid === uid ? null : "wrong_account";
}

/**
 * Where the callback sends the browser: the app's calendar on an allow-listed
 * origin, carrying the code and state for the app to finish with. Without a
 * code (the person declined) it carries only `connect`, which the app reports
 * as not connected. Names avoid `code`/`error`, which supabase-js reads from
 * the URL as a sign-in callback. It ends in an empty `#`: a redirect without a
 * fragment keeps the incoming request's (RFC 9110 §10.2.2). The app no longer
 * signs in from a `#access_token=…` fragment (#281); this keeps one off its URL anyway.
 */
export function connectReturnUrl(
  origin: string,
  provider: ConnectProvider,
  code: string,
  state: string,
): string {
  const url = new URL("/calendar", connectReturnOrigin(origin));
  url.searchParams.set("connect", provider);
  if (code && state) {
    url.searchParams.set("connect_code", code);
    url.searchParams.set("connect_state", state);
  }
  url.hash = "";
  return `${url.toString()}#`;
}
