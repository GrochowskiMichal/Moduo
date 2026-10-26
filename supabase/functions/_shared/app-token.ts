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

/** A JWT's payload claims, unverified; null unless the token is three base64url parts with an object payload. */
function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[\w-]+$/.test(p))) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    return claims !== null && typeof claims === "object" && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** What an Authorization header holds, for a function that takes a person's token. */
export type Bearer = { kind: "person"; token: string } | { kind: "app" } | { kind: "unauthorized" };

/**
 * Reads the Authorization header exactly once (MOD-570). The caller hands
 * `token` itself to `getUser()`, so the string checked for an app here is the
 * string Auth verifies, and the claims read here are that verified token's.
 * Fails closed: anything but `Bearer <three-part token>` with a readable
 * payload is "unauthorized", and a `client_id` claim of any value is "app".
 */
export function personBearer(header: string | null | undefined): Bearer {
  const match = (header ?? "").match(/^Bearer\s+(\S+)$/i);
  if (!match) return { kind: "unauthorized" };
  const claims = jwtClaims(match[1]);
  if (!claims) return { kind: "unauthorized" };
  if (claims.client_id !== undefined && claims.client_id !== null) return { kind: "app" };
  return { kind: "person", token: match[1] };
}

/** The slice of `supabase.auth` that `verifiedPerson` needs. */
export interface UserVerifier<U> {
  getUser(jwt: string): Promise<{ data: { user: U | null }; error: unknown }>;
}

/**
 * `personBearer`, then `getUser()` on that same token: a person's verified
 * user, or why not. Each function maps "app" to 403 and "unauthorized" to 401
 * in its own response shape.
 */
export async function verifiedPerson<U>(
  auth: UserVerifier<U>,
  header: string | null | undefined,
): Promise<{ kind: "person"; user: U } | { kind: "app" } | { kind: "unauthorized" }> {
  const bearer = personBearer(header);
  if (bearer.kind !== "person") return bearer;
  const { data, error } = await auth.getUser(bearer.token);
  return error || !data.user ? { kind: "unauthorized" } : { kind: "person", user: data.user };
}
