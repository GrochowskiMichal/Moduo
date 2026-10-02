/**
 * Edge Function: moduo-mcp — the one Moduo MCP connector
 * (improvement-plan Session 9; docs/moduo-mcp-connector.md).
 *
 * Stateless MCP server over Streamable HTTP: a single POST endpoint speaking
 * JSON-RPC (initialize / ping / tools/list / tools/call; notifications are
 * acknowledged with 202). No SSE stream, no session state — every request is
 * authenticated by a workspace API key and answered with application/json.
 *
 * Auth:   Authorization: Bearer moduo_sk_…  (created in Workspace settings →
 *         API keys; sha256-verified against workspace_api_keys, never stored).
 * Scope:  the key's per-module none/view/edit ladder decides which tools are
 *         visible and callable (view → read tools, edit → + intent ops).
 * Actor:  ops run as service_role with the x-moduo-key-id header; Postgres
 *         attributes every mutation to the key (actor_type 'api_key') —
 *         agents never move things silently (module contract, Pillar 2).
 *
 * Deploy with verify_jwt = false — MCP clients send the Moduo key, not a
 * Supabase JWT; key verification below is the auth.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { jsonRpcRequestSchema } from "../_shared/contracts/rows.ts";
import { listingJsonSchema, parseToolArgs } from "../_shared/contracts/mcp-tool-args.ts";
import { parseOrError } from "../_shared/contracts/errors.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import { connectorModules, moduleScope, toolsForKey, type KeyContext } from "./registry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const DEFAULT_SECRET_KEY = getDefaultSecretKey();

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "moduo-mcp", title: "Moduo", version: "1.0.0" };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, { ...init, headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) } });

const rpcResult = (id: unknown, result: unknown) => json({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verify the bearer secret against workspace_api_keys; null = unauthorized. */
async function authenticate(req: Request, admin: SupabaseClient): Promise<KeyContext | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(moduo_sk_[a-f0-9]{48})$/i);
  if (!match) return null;
  const { data, error } = await admin
    .from("workspace_api_keys")
    .select("id, workspace_id, name, scopes, revoked_at, last_used_at")
    .eq("key_hash", await sha256Hex(match[1]))
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  // Ambient last-used stamp, throttled to once a minute; never blocks the call.
  const lastUsed = data.last_used_at ? new Date(data.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > 60_000) {
    admin.from("workspace_api_keys").update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id).then(() => {}, () => {});
  }
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    scopes: (data.scopes ?? {}) as Record<string, string>,
  };
}

async function handleInitialize(id: unknown, params: any, key: KeyContext, admin: SupabaseClient) {
  const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : "2025-03-26";
  const { data: workspace } = await admin
    .from("workspaces").select("name").eq("id", key.workspaceId).maybeSingle();
  const scopeSummary = connectorModules
    .map((m) => `${m.module}=${moduleScope(key, m.module)}`)
    .join(", ");
  return rpcResult(id, {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions:
      `Moduo workspace "${workspace?.name ?? "(unknown)"}" via API key "${key.name}" ` +
      `(scopes: ${scopeSummary}). Read tools list buckets, tasks (with computed ` +
      `drift/blocked state), the day's commit queue, drift, tags and the attributed ` +
      `activity trail. Write tools are Moduo intent ops — every mutation is recorded ` +
      `and visible to the user; they appear only on edit-scoped keys.`,
  });
}

async function handleToolCall(id: unknown, params: any, key: KeyContext) {
  const name = typeof params?.name === "string" ? params.name : "";
  const allowed = toolsForKey(key);
  const tool = allowed.find((t) => t.name === name);
  if (!tool) {
    const exists = connectorModules.some((m) => m.tools.some((t) => t.name === name));
    if (!exists) return rpcError(id, -32602, `Unknown tool: ${name}`);
    return rpcResult(id, {
      content: [{
        type: "text",
        text: `This API key's scope doesn't allow ${name}. Write tools need an edit-scoped key — created in Moduo's Workspace settings → API keys.`,
      }],
      isError: true,
    });
  }
  // Per-request client: the x-moduo-key-id header is what Postgres uses to
  // attribute mutations to this key (module_api_key_id() trusts it only
  // under the service_role JWT this client carries).
  const db = createClient(SUPABASE_URL, DEFAULT_SECRET_KEY, {
    auth: { persistSession: false },
    global: { headers: { "x-moduo-key-id": key.id } },
  });
  const parsedArgs = parseToolArgs(name, params?.arguments ?? {});
  if (!parsedArgs.success) {
    return rpcResult(id, {
      content: [{ type: "text", text: parsedArgs.message }],
      isError: true,
    });
  }
  try {
    const result = await tool.handler(parsedArgs.data, { key, db });
    return rpcResult(id, {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return json({ error: "moduo-mcp speaks MCP Streamable HTTP: POST JSON-RPC messages." }, { status: 405 });
  }

  const admin = createClient(SUPABASE_URL, DEFAULT_SECRET_KEY, { auth: { persistSession: false } });
  const key = await authenticate(req, admin);
  if (!key) {
    return json(
      { error: "Missing or invalid API key. Send Authorization: Bearer moduo_sk_… (Workspace settings → API keys)." },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error: body must be JSON.");
  }
  if (Array.isArray(raw)) {
    return rpcError(null, -32600, "Batch requests are not supported.");
  }
  const parsedMessage = parseOrError(jsonRpcRequestSchema, raw);
  if (!parsedMessage.success) {
    const id = raw && typeof raw === "object" && "id" in raw ? (raw as { id?: unknown }).id : null;
    return rpcError(id, -32600, "Invalid JSON-RPC request.");
  }
  const message = parsedMessage.data;
  // Notifications (and stray responses) are acknowledged, not answered.
  if (message.id === undefined || message.id === null) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  switch (message.method) {
    case "initialize":
      return await handleInitialize(message.id, message.params, key, admin);
    case "ping":
      return rpcResult(message.id, {});
    case "tools/list":
      return rpcResult(message.id, {
        tools: toolsForKey(key).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: listingJsonSchema(t.name, t.inputSchema),
        })),
      });
    case "tools/call":
      return await handleToolCall(message.id, message.params, key);
    default:
      return rpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
});
