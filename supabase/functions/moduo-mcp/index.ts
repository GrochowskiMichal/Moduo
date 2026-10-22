/**
 * Edge Function: moduo-mcp — the one Moduo MCP connector
 * (improvement-plan Session 9; docs/moduo-mcp-connector.md).
 *
 * Stateless MCP over Streamable HTTP on the official SDK (server.ts, MCPO-2):
 * every POST is authenticated by a workspace API key and answered with
 * application/json; no SSE stream, no session state. `@supabase/server` is
 * the plumbing: CORS, and the service-role clients built from the
 * project's SUPABASE_SECRET_KEYS. It also needs SUPABASE_PUBLISHABLE_KEYS
 * (it builds an anonymous client the connector never uses): without it every
 * request answers 500 MISSING_DEFAULT_PUBLISHABLE_KEY. Hosted Edge Functions
 * and the local stack set both.
 *
 * Deploy with verify_jwt = false — MCP clients send the Moduo key, not a
 * Supabase JWT; key verification in server.ts is the auth.
 */

import { withSupabase } from "@supabase/server";
import { createAdminClient } from "@supabase/server/core";

import { CORS_HEADERS, handleMcpRequest } from "./server.ts";

Deno.serve(
  withSupabase({ auth: "none", cors: { headers: CORS_HEADERS } }, (req, ctx) =>
    handleMcpRequest(req, {
      admin: ctx.supabaseAdmin,
      keyClient: (keyId) =>
        createAdminClient({ supabaseOptions: { global: { headers: { "x-moduo-key-id": keyId } } } }),
    }),
  ),
);
