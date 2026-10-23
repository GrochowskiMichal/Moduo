/**
 * Protocol revisions (MCPO-5 follow-up; docs/decisions/mcp.md).
 *
 * Claude opens with MCP 2026-07-28: a `server/discover` request carrying the
 * per-request `_meta` envelope and `MCP-Protocol-Version: 2026-07-28`. The
 * connector used to answer it 400 (its transport speaks the 2025 era only) and
 * Claude retried with `initialize`. Now the SDK's modern entry serves it, the
 * 2025 era is unchanged, and a claim-less request with a version header the
 * SDK doesn't know is answered as its latest instead of refused.
 *
 * The whole function, as in oauth.test.ts: an app token for a live connection
 * (Tasks: View), the project's API faked at fetch.
 */

import { afterAll, beforeAll, describe, expect, it, rs } from "@rstest/core";

rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

type Row = Record<string, unknown>;

const BASE = "http://protocol.local";
const ENDPOINT = `${BASE}/functions/v1/moduo-mcp`;
const WS = "11111111-1111-4111-8111-111111111111";
const ALEX = "22222222-2222-4222-8222-222222222222";
const CLAUDE = "55555555-5555-4555-8555-555555555555";

const connections: Row[] = [
  {
    id: "conn-live", workspace_id: WS, name: "Claude", scopes: { tasks: "view" }, created_by: ALEX,
    revoked_at: null, expires_at: null, last_used_at: "2026-10-23T08:59:30.000Z", oauth_client_id: CLAUDE,
  },
];
const members = new Set([`${WS}:${ALEX}`]);

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const q = (name: string) => url.searchParams.get(name);
  const rest = url.pathname.replace(/^\/rest\/v1\//, "");
  let data: unknown = [];
  if (rest === "rpc/module_api_key_effective_scopes") {
    data = connections[0].scopes;
  } else if (rest === "workspace_api_keys" && req.method === "GET") {
    data = connections.filter((c) => q("created_by") === `eq.${c.created_by}` && q("oauth_client_id") === `eq.${c.oauth_client_id}`);
  } else if (rest === "workspace_members") {
    const key = `${q("workspace_id")?.slice(3)}:${q("user_id")?.slice(3)}`;
    data = members.has(key) ? [{ user_id: q("user_id")?.slice(3) }] : [];
  } else if (rest === "workspaces") {
    data = [{ name: "Moduo Labs" }];
  }
  if (Array.isArray(data) && req.headers.get("accept")?.includes("vnd.pgrst.object")) {
    if (data.length !== 1) return Response.json({ code: "PGRST116", message: "no rows" }, { status: 406 });
    data = data[0];
  }
  return Response.json(data);
}

// ── Tokens ───────────────────────────────────────────────────────────────────

let signingKey: CryptoKey;
let strangerKey: CryptoKey;
const KID = "oauth-test-key";

const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function jwt(claims: Row, key: CryptoKey = signingKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }));
  const payload = b64url(
    JSON.stringify({ iss: `${BASE}/auth/v1`, aud: "authenticated", iat: now, exp: now + 3600, role: "authenticated", ...claims }),
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

const appToken = (person: string, client: string, extra: Row = {}) =>
  jwt({ sub: person, client_id: client, session_id: "66666666-6666-4666-8666-666666666666", ...extra });

// ── The function ─────────────────────────────────────────────────────────────

let serve: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  signingKey = pair.privateKey;
  strangerKey = ((await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair).privateKey;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const env: Record<string, string> = {
    SUPABASE_URL: BASE,
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_oauth" }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_oauth" }),
    SUPABASE_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: KID, alg: "ES256", use: "sig" }] }),
    SUPABASE_FUNCTION_SLUG: "moduo-mcp",
  };
  Object.assign(process.env, env);
  let handler: ((req: Request) => Promise<Response>) | undefined;
  (globalThis as any).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
    },
  };
  rs.spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
  await import("./index.ts");
  if (!handler) throw new Error("index.ts did not call Deno.serve");
  serve = handler;
});

afterAll(() => {
  rs.restoreAllMocks();
});

async function post(body: unknown, headers: Record<string, string> = {}) {
  const res = await serve(
    new Request(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${await appToken(ALEX, CLAUDE)}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, body: parsed };
}

const MODERN = "2026-07-28";
const envelope = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "claude-ai", version: "0.1.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const modernHeaders = (method: string) => ({ "mcp-protocol-version": MODERN, "mcp-method": method });
const discover = { jsonrpc: "2.0", id: 0, method: "server/discover", params: { _meta: envelope } };
const initialize = (protocolVersion: string) => ({
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: { protocolVersion, capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } },
});
const SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";

describe("a 2026-07-28 client", () => {
  it("gets its server/discover answered (Claude's opening, a 400 before)", async () => {
    const res = await post(discover, modernHeaders("server/discover"));
    expect(res.status).toBe(200);
    expect(res.body.result.supportedVersions).toEqual([MODERN]);
    expect(res.body.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(res.body.result.instructions).toMatch(/^Moduo workspace "Moduo Labs" via API key "Claude"/);
    expect(res.body.result._meta[SERVER_INFO_META]).toMatchObject({ name: "moduo-mcp" });
  });

  it("is served when it leaves the standard headers out: the body says what they would", async () => {
    expect((await post(discover)).status).toBe(200);
  });

  it("is still refused when a header contradicts the body", async () => {
    const res = await post(discover, modernHeaders("tools/list"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32020);
  });

  it("is told which revision the connector speaks when it claims one it doesn't", async () => {
    const future = { ...envelope, "io.modelcontextprotocol/protocolVersion": "2027-01-01" };
    const res = await post(
      { ...discover, params: { _meta: future } },
      { "mcp-protocol-version": "2027-01-01", "mcp-method": "server/discover" },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.data).toMatchObject({ supported: [MODERN], requested: "2027-01-01" });
  });

  it("lists the same tools as a 2025 client, as a complete result", async () => {
    const modern = await post(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: envelope } },
      modernHeaders("tools/list"),
    );
    const legacy = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(modern.status).toBe(200);
    expect(modern.body.result.resultType).toBe("complete");
    expect(modern.body.result.tools.map((t: { name: string }) => t.name)).toEqual(
      legacy.body.result.tools.map((t: { name: string }) => t.name),
    );
  });

  it("gets the refusal for a tool its access doesn't allow, as a complete result", async () => {
    const res = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { _meta: envelope, name: "tasks_create", arguments: {} } },
      modernHeaders("tools/call"),
    );
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ isError: true, resultType: "complete" });
    expect(res.body.result.content[0].text).toMatch(/^This API key can't use tasks_create/);
    expect(res.body.result._meta[SERVER_INFO_META]).toMatchObject({ name: "moduo-mcp" });
  });

  it("runs a tool it may use through the SDK, with the same answer a 2025 client gets", async () => {
    const call = (extra: Record<string, unknown>) => ({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { ...extra, name: "tasks_list", arguments: {} },
    });
    const modern = await post(call({ _meta: envelope }), modernHeaders("tools/call"));
    const legacy = await post(call({}));
    expect(modern.status).toBe(200);
    expect(modern.body.result.resultType).toBe("complete");
    expect(modern.body.result.content).toEqual(legacy.body.result.content);
  });

  it("is refused by the SDK, not answered early, when its Mcp-Name header contradicts the body", async () => {
    const res = await post(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { _meta: envelope, name: "tasks_create", arguments: {} } },
      { ...modernHeaders("tools/call"), "mcp-name": "tasks_list" },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32020);
  });

  it("gets Unknown tool for a name no module has", async () => {
    const res = await post(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { _meta: envelope, name: "nope", arguments: {} } },
      modernHeaders("tools/call"),
    );
    expect(res.body.error).toEqual({ code: -32602, message: "Unknown tool: nope" });
  });

  it("is told there are no notifications to listen for", async () => {
    const res = await post(
      { jsonrpc: "2.0", id: 4, method: "subscriptions/listen", params: { _meta: envelope, notifications: {} } },
      modernHeaders("subscriptions/listen"),
    );
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe(-32601);
  });
});

describe("a 2025 client", () => {
  it("asking initialize for 2026-07-28 is negotiated down to the latest 2025 revision", async () => {
    for (const headers of [{}, { "mcp-protocol-version": MODERN }]) {
      const res = await post(initialize(MODERN), headers);
      expect(res.status).toBe(200);
      expect(res.body.result.protocolVersion).toBe("2025-11-25");
    }
  });

  it("with a version header the SDK doesn't know is answered as the latest, not refused", async () => {
    for (const version of [MODERN, "2025-12-31", "1999-01-01"]) {
      const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-protocol-version": version });
      expect(res.status).toBe(200);
      expect(res.body.result.tools.length).toBeGreaterThan(0);
      expect(res.body.result.resultType).toBeUndefined();
    }
  });

  it("with a supported version header is answered as before", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" });
    expect(res.status).toBe(200);
  });
});
