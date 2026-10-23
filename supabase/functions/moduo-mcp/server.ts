/**
 * The Moduo MCP connector's server (MCPO-2, docs/moduo-mcp-connector.md): who
 * is calling, and one stateless MCP server per request on the official SDK
 * (`@modelcontextprotocol/server`). index.ts mounts it with `@supabase/server`.
 *
 * Auth:   Authorization: Bearer moduo_sk_…  (created in Workspace settings →
 *         API keys; sha256-verified against workspace_api_keys, never stored),
 *         or an app's OAuth access token from Supabase Auth (MCPO-3): verified
 *         against the project's JWKS, then exchanged for its connection, the
 *         live workspace_api_keys row for (sub, client_id). From there both are
 *         the same key. Without either, a 401 points the client at sign-in
 *         (index.ts adds the protected-resource header).
 * Scope:  the key's per-module none/view/edit ladder decides which tools are
 *         registered (view → read tools, edit → + intent ops), capped by its
 *         creator's own access; a tool that also touches another module needs
 *         that module too (MCP_TOOL_NEEDS in contracts/mcp-key-scopes.ts).
 * Actor:  tools run as service_role with the x-moduo-key-id header; Postgres
 *         attributes every mutation to the key (actor_type 'api_key') —
 *         agents never move things silently (module contract, Pillar 2).
 *
 * Protocol revisions: a request carrying the 2026-07-28 `_meta` envelope (no
 * `initialize`; `server/discover` first) is served by the SDK's own modern
 * entry (`createMcpHandler`) from the same per-key server; everything else is
 * the 2025-era stateless path below, which negotiates `initialize` down to
 * the SDK's latest. A claim-less request whose MCP-Protocol-Version header
 * names a revision the SDK doesn't speak is answered as that latest rather
 * than refused (MCPO-5 follow-up; docs/decisions/mcp.md).
 *
 * The SDK speaks the protocol; what clients saw before the SDK is kept where it
 * is ours to say (sdk-parity.test.ts): the 401/405 answers, the parse and batch
 * errors, the per-key tool list, `parseToolArgs` as the argument gate, the
 * refusal for a tool the key can't use, and every tool's answer.
 */

import {
  createMcpHandler,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
  type StandardSchemaWithJSON,
  SUPPORTED_PROTOCOL_VERSIONS,
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
  toolAnnotations,
  toolRequirement,
  toolsForKey,
  type KeyContext,
  type ToolDef,
} from "./registry.ts";
import { outputJsonSchema } from "./tool-outputs.ts";

const SERVER_INFO = { name: "moduo-mcp", title: "Moduo", version: "1.0.0" };

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type ConnectorDeps = {
  /** Service-role client for the key lookup and the workspace name. */
  admin: SupabaseClient;
  /** A service-role client carrying the x-moduo-key-id actor header. */
  keyClient: (keyId: string) => SupabaseClient;
  /**
   * Verifies a Supabase access token (signature against the project's JWKS,
   * expiry) and answers its claims, or null. Absent: OAuth tokens are refused.
   */
  verifyToken?: (token: string) => Promise<Record<string, unknown> | null>;
  /** Where the protected-resource document is, for the invalid_token challenge. */
  resourceMetadataUrl?: string;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: true;
};

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

type KeyRow = {
  id: string;
  workspace_id: string;
  name: string;
  created_by: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
};

const KEY_COLUMNS = "id, workspace_id, name, scopes, created_by, revoked_at, expires_at, last_used_at";

/** Verify the bearer secret against workspace_api_keys; null = unauthorized. */
export async function authenticate(req: Request, admin: SupabaseClient): Promise<KeyContext | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(moduo_sk_[a-f0-9]{48})$/i);
  if (!match) return null;
  const { data, error } = await admin
    .from("workspace_api_keys")
    .select(KEY_COLUMNS)
    .eq("key_hash", await sha256Hex(match[1]))
    .maybeSingle();
  if (error || !data) return null;
  return await liveKey(data as KeyRow, admin);
}

/**
 * The app token in the Authorization header: a JWT (three dot-separated
 * parts). Anything else, a mistyped pasted key included, keeps the pasted-key
 * path and its words.
 */
export function appToken(req: Request): string | null {
  const match = (req.headers.get("authorization") ?? "").match(/^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/i);
  return match ? match[1] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * MCPO-3: an app's OAuth access token → its connection's key; null = refused.
 * The token must be a person's (role authenticated) and issued to an app
 * (`client_id`): a person's own session token is not a connection. The live
 * row for (person, app) then gets exactly a key's checks, and the person must
 * still be a member of the connection's workspace (else the app signs in
 * again and picks one).
 */
export async function authenticateApp(token: string, deps: ConnectorDeps): Promise<KeyContext | null> {
  if (!deps.verifyToken) return null;
  const claims = await deps.verifyToken(token);
  if (!claims) return null;
  const { sub, client_id: clientId, role } = claims;
  if (role !== "authenticated" || typeof sub !== "string" || !UUID.test(sub)) return null;
  if (typeof clientId !== "string" || !UUID.test(clientId)) return null;
  const { data, error } = await deps.admin
    .from("workspace_api_keys")
    .select(KEY_COLUMNS)
    .eq("created_by", sub)
    .eq("oauth_client_id", clientId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const member = await deps.admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", (data as KeyRow).workspace_id)
    .eq("user_id", sub)
    .maybeSingle();
  if (member.error || !member.data) return null;
  return await liveKey(data as KeyRow, deps.admin);
}

/** A found key row, if it may still be used: its context, or null. */
async function liveKey(data: KeyRow, admin: SupabaseClient): Promise<KeyContext | null> {
  if (data.revoked_at) return null;
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

/**
 * A main read's output schema as the SDK sees it (MCPO-6): listed as written
 * in tool-outputs.ts and not checked on the way out, so a schema that lags an
 * answer can never turn a good answer into an error (tests check real answers
 * against it instead). A list's schema is an array: the SDK lists it, and
 * wraps the answer as `{ result: [...] }`, the way 2025-era clients expect.
 */
function listedOutput(toolName: string): StandardSchemaWithJSON | undefined {
  const listing = outputJsonSchema(toolName);
  if (!listing) return undefined;
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
    const outputSchema = listedOutput(tool.name);
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: listedArguments(tool),
        ...(outputSchema ? { outputSchema } : {}),
        annotations: toolAnnotations(tool),
      },
      async (rawArgs: unknown) => {
        const parsedArgs = parseToolArgs(tool.name, rawArgs ?? {});
        if (!parsedArgs.success) return textResult(parsedArgs.message, true);
        // Per-call client: the x-moduo-key-id header is what Postgres uses to
        // attribute mutations to this key (module_api_key_id() trusts it only
        // under the service-role key this client carries).
        const db = deps.keyClient(key.id);
        try {
          const result = await tool.handler(parsedArgs.data, { key, db });
          const text = JSON.stringify(result, null, 2);
          // The same value as the text, read back from it, so the two never differ.
          return outputSchema ? { ...textResult(text), structuredContent: JSON.parse(text) } : textResult(text);
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
function toolCallAnsweredHere(
  message: { id?: unknown; params?: unknown },
  key: KeyContext,
  modern: boolean,
): Response | null {
  const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
  const name = typeof params.name === "string" ? params.name : "";
  // 2026-07-28 results carry resultType and the server's identity; the SDK
  // stamps its own, these are stamped here.
  const result = (id: unknown, value: ToolResult) =>
    rpcResult(id, modern ? { ...value, resultType: "complete", _meta: { [SERVER_INFO_META_KEY]: SERVER_INFO } } : value);
  const found = findTool(name);
  if (!found) return rpcError(message.id, -32602, `Unknown tool: ${name}`);
  if (!toolAllowed(key, found.module, found.tool)) {
    return result(
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
  return parsedArgs.success ? null : result(message.id, textResult(parsedArgs.message, true));
}

/** The modern revisions the SDK serves (its own list is internal). */
const MODERN_PROTOCOL_VERSIONS = ["2026-07-28"];

/** The revision a request's 2026-07-28 `_meta` envelope claims, or null for a 2025-era request. */
function envelopeClaim(message: { params?: unknown }): string | null {
  const meta = (message.params as { _meta?: unknown } | undefined)?._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta) || !(PROTOCOL_VERSION_META_KEY in meta)) return null;
  const claimed = (meta as Record<string, unknown>)[PROTOCOL_VERSION_META_KEY];
  return typeof claimed === "string" ? claimed : "";
}

/** Answer one HTTP request to the connector. */
export async function handleMcpRequest(req: Request, deps: ConnectorDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "moduo-mcp speaks MCP Streamable HTTP: POST JSON-RPC messages." }, { status: 405 });
  }

  const token = appToken(req);
  const key = token ? await authenticateApp(token, deps) : await authenticate(req, deps.admin);
  if (!key && token) {
    // RFC 6750: the app's token is no good (disconnected, expired, never
    // connected): the client signs in again, which shows the consent screen.
    const description = "This connection to Moduo was disconnected, has expired or doesn't exist. Sign in again.";
    const challenge = [
      'Bearer error="invalid_token"',
      `error_description="${description}"`,
      ...(deps.resourceMetadataUrl ? [`resource_metadata="${deps.resourceMetadataUrl}"`] : []),
    ].join(", ");
    return json(
      { error: "invalid_token", error_description: description },
      { status: 401, headers: { "WWW-Authenticate": challenge } },
    );
  }
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
  // `initialize` is 2025-era whatever it claims: it negotiates down.
  const claim = message.method === "initialize" ? null : envelopeClaim(message);
  const clientHeaders = new Headers(headers);
  if (claim) {
    // The body is the request: a standard header the client left out is
    // filled from it; one that disagrees with it is still the SDK's to refuse.
    if (!clientHeaders.has("mcp-protocol-version")) clientHeaders.set("mcp-protocol-version", claim);
    if (!clientHeaders.has("mcp-method")) clientHeaders.set("mcp-method", message.method);
    const toolName = (message.params as { name?: unknown } | undefined)?.name;
    if (
      message.method === "tools/call" &&
      !clientHeaders.has("mcp-name") &&
      typeof toolName === "string" &&
      /^[\x21-\x7e]+$/.test(toolName)
    ) {
      clientHeaders.set("mcp-name", toolName);
    }
  }
  if (message.method === "tools/call") {
    // In the modern era only once the SDK would serve the request: a claim it
    // doesn't speak or standard headers that don't match are its to refuse.
    const servable =
      claim === null ||
      (MODERN_PROTOCOL_VERSIONS.includes(claim) &&
        clientHeaders.get("mcp-protocol-version") === claim &&
        clientHeaders.get("mcp-method") === message.method);
    const early = servable ? toolCallAnsweredHere(message, key, claim !== null) : null;
    if (early) return early;
  }

  let workspaceName: string | null = null;
  // The workspace line is the server's instructions: on initialize, or on
  // server/discover, the 2026-07-28 opening.
  if (message.method === "initialize" || (claim !== null && message.method === "server/discover")) {
    const { data: workspace } = await deps.admin
      .from("workspaces")
      .select("name")
      .eq("id", key.workspaceId)
      .maybeSingle();
    workspaceName = workspace?.name ?? "(unknown)";
  }

  if (claim !== null) {
    // Stateless by design: the connector has nothing to notify, so a listen
    // stream would only hold the function open.
    if (message.method === "subscriptions/listen") {
      return rpcError(message.id, -32601, "Method not found: the Moduo connector sends no notifications.");
    }
    // The SDK's 2026-07-28 entry, modern-only (the 2025 era is served below):
    // it checks the envelope and the standard headers, answers server/discover,
    // and refuses a claimed revision it doesn't serve with the list it does.
    const modern = createMcpHandler(() => buildServer(key, deps, workspaceName), { legacy: "reject" });
    return await modern.fetch(sdkRequest(clientHeaders), { parsedBody: withoutNulls(message) });
  }

  // A 2025-era request is stateless here, so a version header naming a
  // revision the SDK doesn't speak (a newer one, a typo) has nothing to have
  // been negotiated against: answer as the SDK's latest instead of a 400.
  const version = clientHeaders.get("mcp-protocol-version");
  if (version !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) clientHeaders.delete("mcp-protocol-version");

  const server = buildServer(key, deps, workspaceName);
  // Stateless: no session id, one JSON answer per request (the SDK's
  // serverless pattern), so nothing outlives this request.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(sdkRequest(clientHeaders), { parsedBody: withoutNulls(message) });
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
