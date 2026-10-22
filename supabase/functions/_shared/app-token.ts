/**
 * Apps' OAuth tokens (MCPO-1, specs/mcp-oauth.md).
 *
 * Supabase Auth's OAuth 2.1 server gives an app (Claude, ChatGPT, …) a normal
 * user access token plus a `client_id` claim, and `auth.getUser()` accepts it
 * like the person's own session. Only moduo-mcp honours it (it exchanges the
 * token for the connection's scoped key); every other function that takes a
 * person's token refuses it first, so an app can't start a trial, open
 * billing or delete the account. The database refuses it the same way
 * (migration 20261022230000_app_token_lockout.sql).
 *
 * The claim is read without verifying the signature: a real app token always
 * carries it, the caller still verifies the token with `getUser()` afterwards,
 * and a forged claim can only get a request refused.
 */

/** The body every refusal answers with (403). */
export const APP_TOKEN_REFUSAL = {
  error: "app_token",
  message: "This token belongs to an app. Apps reach Moduo only through its MCP connector.",
} as const;

/** The OAuth client_id an app's token carries; null for anything else, a malformed token included. */
export function appTokenClientId(token: string | null | undefined): string | null {
  const raw = (token ?? "").replace(/^Bearer\s+/i, "").trim();
  const payload = raw.split(".")[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    const clientId = (claims as { client_id?: unknown } | null)?.client_id;
    return typeof clientId === "string" && clientId !== "" ? clientId : null;
  } catch {
    return null;
  }
}

/** True when a bearer token (with or without "Bearer ") is an app's OAuth token. */
export function isAppToken(token: string | null | undefined): boolean {
  return appTokenClientId(token) !== null;
}
