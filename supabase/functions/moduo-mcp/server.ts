/**
 * The Moduo MCP connector's server (MCPO-2, docs/moduo-mcp-connector.md): who
 * is calling, and one stateless MCP server per request on the official SDK
 * (`@modelcontextprotocol/server`). index.ts mounts it with `@supabase/server`.
 *
 * Auth:   Authorization: Bearer moduo_sk_…  (created in Workspace settings →
 *         API keys; sha256-verified against workspace_api_keys, never stored).
 *         MCPO-3 adds OAuth tokens as a second branch of `authenticate`.
 * Scope:  the key's per-module none/view/edit ladder decides which tools are
 *         registered (view → read tools, edit → + intent ops), capped by its
 *         creator's own access; a tool that also touches another module needs
 *         that module too (MCP_TOOL_NEEDS in contracts/mcp-key-scopes.ts).
 * Actor:  tools run as service_role with the x-moduo-key-id header; Postgres
 *         attributes every mutation to the key (actor_type 'api_key') —
 *         agents never move things silently (module contract, Pillar 2).
 *
 * The SDK speaks the protocol; what clients saw before the SDK is kept where it
 * is ours to say (sdk-parity.test.ts): the 401/405 answers, the parse and batch
 * errors, the per-key tool list, `parseToolArgs` as the argument gate, the
 * refusal for a tool the key can't use, and every tool's answer.
 */

import {
  McpServer,
  type StandardSchemaWithJSON,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { jsonRpcRequestSchema } from "../_shared/contracts/rows.ts";
import { listingJsonSchema, parseToolArgs } from "../_shared/contracts/mcp-tool-args.ts";
import { parseOrError } from "../_shared/contracts/errors.ts";
import { apiKeyExpired } from "../_shared/api-key-expiry.ts";
import {
  connectorModules,
  findTool,
  moduleScope,
  toolAllowed,
  toolRequirement,
  toolsForKey,
  type KeyContext,
  type ToolDef,
} from "./registry.ts";

const SERVER_INFO = { name: "moduo-mcp", title: "Moduo", version: "1.0.0" };

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type ConnectorDeps = {
  /** Service-role client for the key lookup and the workspace name. */
  admin: SupabaseClient;
  /** A service-role client carrying the x-moduo-key-id actor header. */
  keyClient: (keyId: string) => SupabaseClient;
};

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: true };

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
const rpcError = (id: unknown, code: number, message: string) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: unknown) => json({ jsonrpc: "2.0", id, result });
const textResult = (text: string, isError = false): ToolResult =>
  isError ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verify the bearer secret against workspace_api_keys; null = unauthorized. */
export async function authenticate(req: Request, admin: SupabaseClient): Promise<KeyContext | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(moduo_sk_[a-f0-9]{48})$/i);
  if (!match) return null;
  const { data, error } = await admin
    .from("workspace_api_keys")
    .select("id, workspace_id, name, scopes, created_by, revoked_at, expires_at, last_used_at")
    .eq("key_hash", await sha256Hex(match[1]))
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  // API-KEY-EXP-1: an expired key is refused like a revoked one (a 401).
  if (apiKeyExpired(data.expires_at)) return null;
  // PERM-0: a key acts as its creator. A key with no recorded creator can't be
  // scoped to anyone's private data, so it is refused outright.
  if (!data.created_by) return null;
  // Effective scopes = key scopes capped by the creator's current permission
  // (all 'none' once the creator leaves). Fail closed if the RPC is missing.
  const effective = await admin.rpc("module_api_key_effective_scopes", { p_key_id: data.id });
  if (effective.error || !effective.data || typeof effective.data !== "object") return null;
  // Ambient last-used stamp, throttled to once a minute; never blocks the call.
  const lastUsed = data.last_used_at ? new Date(data.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > 60_000) {
    admin
      .from("workspace_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(
        () => {},
        () => {},
      );
  }
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    createdBy: data.created_by,
    scopes: effective.data as Record<string, string>,
  };
}

function instructionsFor(key: KeyContext, workspaceName: string): string {
  const scopeSummary = connectorModules.map((m) => `${m.module}=${moduleScope(key, m.module)}`).join(", ");
  return (
    `Moduo workspace "${workspaceName}" via API key "${key.name}" ` +
    `(access: ${scopeSummary}). The key sees only modules it has View or Edit on, ` +
    `and changes only those it has Edit on; it never gets more than the person who ` +
    `created it. Read tools list each module's items; write tools are Moduo intent ` +
    `ops, and every change is recorded and attributed to this key.`
  );
}

/**
 * A tool's arguments as the SDK sees them: listed with our JSON Schema
 * (`listingJsonSchema`, as before) and passed through untouched, because
 * `parseToolArgs` in the tool callback is the gate and words its own errors.
 */
function listedArguments(tool: ToolDef): StandardSchemaWithJSON {
  const listing = listingJsonSchema(tool.name, tool.inputSchema);
  return {
    "~standard": {
      version: 1,
      vendor: "moduo",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => listing, output: () => listing },
    },
  } as StandardSchemaWithJSON;
}

/** One stateless MCP server holding only the tools this key may use. */
export function buildServer(key: KeyContext, deps: ConnectorDeps, workspaceName: string | null): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: { listChanged: false } },
    instructions: workspaceName === null ? undefined : instructionsFor(key, workspaceName),
  });
  for (const tool of toolsForKey(key)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: listedArguments(tool) },
      async (rawArgs: unknown) => {
        const parsedArgs = parseToolArgs(tool.name, rawArgs ?? {});
        if (!parsedArgs.success) return textResult(parsedArgs.message, true);
        // Per-call client: the x-moduo-key-id header is what Postgres uses to
        // attribute mutations to this key (module_api_key_id() trusts it only
        // under the service-role key this client carries).
        const db = deps.keyClient(key.id);
        try {
          const result = await tool.handler(parsedArgs.data, { key, db });
          return textResult(JSON.stringify(result, null, 2));
        } catch (err) {
          return textResult(err instanceof Error ? err.message : String(err), true);
        }
      },
    );
  }
  return server;
}

/**
 * The tools/call answers the SDK would word its own way: a name no module has
 * gets "Unknown tool", a tool the key can't use gets the refusal naming what it
 * needs (the SDK would say "not found", as it only holds the key's tools), and
 * arguments that aren't an object get `parseToolArgs`'s message (the SDK would
 * reject the whole request). Null otherwise: the SDK answers.
 */
function toolCallAnsweredHere(message: { id?: unknown; params?: unknown }, key: KeyContext): Response | null {
  const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
  const name = typeof params.name === "string" ? params.name : "";
  const found = findTool(name);
  if (!found) return rpcError(message.id, -32602, `Unknown tool: ${name}`);
  if (!toolAllowed(key, found.module, found.tool)) {
    return rpcResult(
      message.id,
      textResult(
        `This API key can't use ${name}: it needs ${toolRequirement(found.module, found.tool)}. Change the key's access in Moduo → Settings → API keys.`,
        true,
      ),
    );
  }
  const args = params.arguments;
  if (args === undefined || args === null || (typeof args === "object" && !Array.isArray(args))) return null;
  const parsedArgs = parseToolArgs(name, args);
  return parsedArgs.success ? null : rpcResult(message.id, textResult(parsedArgs.message, true));
}

/** Answer one HTTP request to the connector. */
export async function handleMcpRequest(req: Request, deps: ConnectorDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "moduo-mcp speaks MCP Streamable HTTP: POST JSON-RPC messages." }, { status: 405 });
  }

  const key = await authenticate(req, deps.admin);
  if (!key) {
    return json(
      {
        error:
          "Missing, invalid, revoked or expired API key. Send Authorization: Bearer moduo_sk_… (Workspace settings → API keys).",
      },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error: body must be JSON.");
  }
  if (Array.isArray(raw)) return rpcError(null, -32600, "Batch requests are not supported.");
  const parsedMessage = parseOrError(jsonRpcRequestSchema, raw);
  if (!parsedMessage.success) {
    const id = raw && typeof raw === "object" && "id" in raw ? (raw as { id?: unknown }).id : null;
    return rpcError(id, -32600, "Invalid JSON-RPC request.");
  }
  const message = parsedMessage.data;
  // Notifications (and stray responses) are acknowledged, not answered.
  if (message.id === undefined || message.id === null) return new Response(null, { status: 202 });

  return await answerMessage(message, key, deps, req.headers);
}

/**
 * Answer one JSON-RPC request from a verified key: the few tools/call answers
 * that are ours to word, then a fresh SDK server holding only the key's tools.
 */
export async function answerMessage(
  message: { id?: unknown; method: string; params?: unknown },
  key: KeyContext,
  deps: ConnectorDeps,
  headers: HeadersInit = {},
): Promise<Response> {
  if (message.method === "tools/call") {
    const early = toolCallAnsweredHere(message, key);
    if (early) return early;
  }

  let workspaceName: string | null = null;
  if (message.method === "initialize") {
    const { data: workspace } = await deps.admin
      .from("workspaces")
      .select("name")
      .eq("id", key.workspaceId)
      .maybeSingle();
    workspaceName = workspace?.name ?? "(unknown)";
  }

  const server = buildServer(key, deps, workspaceName);
  // Stateless: no session id, one JSON answer per request (the SDK's
  // serverless pattern), so nothing outlives this request.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(sdkRequest(headers), { parsedBody: withoutNulls(message) });
  } finally {
    await server.close();
  }
}

/**
 * `"params": null` and `"arguments": null` meant "none" before the SDK, which
 * refuses both.
 */
function withoutNulls(raw: { params?: unknown }): unknown {
  if (raw.params === null) {
    const { params: _none, ...rest } = raw;
    return rest;
  }
  const params = raw.params as { arguments?: unknown } | undefined;
  if (params?.arguments !== null) return raw;
  const { arguments: _none, ...kept } = params;
  return { ...raw, params: kept };
}

/**
 * The SDK insists on `Accept: application/json, text/event-stream` and a JSON
 * Content-Type; the connector never did, and scripts that send neither keep
 * working. The client's other headers (mcp-protocol-version) go along, its
 * credentials don't; the
 * body has been read already and goes in as `parsedBody`.
 */
function sdkRequest(clientHeaders: HeadersInit): Request {
  const headers = new Headers(clientHeaders);
  // The key is verified already; tools never see the caller's credentials.
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("accept", "application/json, text/event-stream");
  headers.set("content-type", "application/json");
  return new Request("http://moduo-mcp.local/", { method: "POST", headers });
}
