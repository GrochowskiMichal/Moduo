/**
 * Edge Function: moduo-mcp — the one Moduo MCP connector
 * (improvement-plan Session 9; docs/moduo-mcp-connector.md).
 *
 * Stateless MCP over Streamable HTTP on the official SDK (server.ts, MCPO-2):
 * every POST is authenticated by a workspace API key, or by an app's OAuth
 * token exchanged for its connection (MCPO-3), and answered with
 * application/json; no SSE stream, no session state. `@supabase/server` is
 * the plumbing: CORS, the service-role clients built from the project's
 * SUPABASE_SECRET_KEYS, verifying app tokens against the project's JWKS, and
 * OAuth discovery (`withOAuthProtectedResource`: the protected-resource
 * document at GET /functions/v1/moduo-mcp/oauth-protected-resource, and the
 * `WWW-Authenticate: Bearer resource_metadata=…` header on every 401, which
 * is how an MCP client finds Moduo's sign-in). It also needs
 * SUPABASE_PUBLISHABLE_KEYS (it builds an anonymous client the connector never
 * uses): without it every request answers 500 MISSING_DEFAULT_PUBLISHABLE_KEY.
 * Hosted Edge Functions and the local stack set both, and SUPABASE_JWKS.
 *
 * Two addresses, one function: apps also connect at https://mcp.moduo.app,
 * a Worker (infra/mcp-proxy) that forwards here. Discovery names whichever
 * address the client used (public-url.ts); the sign-in server is always the
 * project's Supabase Auth.
 *
 * Deploy with verify_jwt = false — MCP clients send a Moduo key or an app
 * token, and discovery must reach the function signed out; server.ts is the
 * auth.
 */

import { withOAuthProtectedResource, withSupabase } from "@supabase/server";
import { createAdminClient, verifyCredentials } from "@supabase/server/core";

import { publicOrigins, publicResource } from "./public-url.ts";
import { CORS_HEADERS, handleMcpRequest } from "./server.ts";

const PUBLIC_ORIGINS = publicOrigins(Deno.env.get("MCP_PUBLIC_URL"));

/** An app's access token: its claims when Supabase Auth signed it and it hasn't expired. */
async function verifyToken(token: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await verifyCredentials({ token, apikey: null }, { auth: "user" });
  if (error) {
    // A 500 here is configuration (no JWKS, JWKS unreachable), not a bad token.
    if (error.status >= 500) console.error("moduo-mcp: token verification unavailable", error.code);
    return null;
  }
  return data.jwtClaims;
}

Deno.serve(
  withOAuthProtectedResource(
    // "" falls back to the Supabase URL @supabase/server derives from the request.
    { resourceServer: (req) => publicResource(req, PUBLIC_ORIGINS) },
    withSupabase({ auth: "none", cors: { headers: CORS_HEADERS } }, (req, ctx) =>
      handleMcpRequest(req, {
        admin: ctx.supabaseAdmin,
        keyClient: (keyId) =>
          createAdminClient({ supabaseOptions: { global: { headers: { "x-moduo-key-id": keyId } } } }),
        verifyToken,
        resourceMetadataUrl: ctx.oauthProtectedResource?.resourceMetadataUrl,
      }),
    ),
  ),
);
