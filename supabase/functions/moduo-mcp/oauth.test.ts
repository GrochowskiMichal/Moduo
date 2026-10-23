/**
 * Apps sign in to the connector with OAuth (MCPO-3, specs/mcp-oauth.md AC3,
 * AC4; Assumptions #2, #3, #9).
 *
 * The whole function (index.ts, as Deno.serve gets it) with the project's API
 * faked at `fetch`, under real supabase-js and `@supabase/server`: tokens are
 * ES256 JWTs signed here with a key whose public half is the project's JWKS
 * (SUPABASE_JWKS), so the real verification runs. The fake answers the
 * connection rows, the membership check and the effective-scopes RPC, and
 * records which client (the key header) made each call.
 */

import { afterAll, beforeAll, describe, expect, it, rs } from "@rstest/core";

rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

type Row = Record<string, unknown>;

const BASE = "http://oauth.local";
const ENDPOINT = `${BASE}/functions/v1/moduo-mcp`;
const METADATA = `${ENDPOINT}/oauth-protected-resource`;
const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "11111111-1111-4111-8111-222222222222";
const ALEX = "22222222-2222-4222-8222-222222222222";
const SAM = "22222222-2222-4222-8222-333333333333";
const CLAUDE = "55555555-5555-4555-8555-555555555555";
const DESKTOP = "55555555-5555-4555-8555-666666666666";
const CHATGPT = "55555555-5555-4555-8555-777777777777";
const GONE = "55555555-5555-4555-8555-888888888888";
const LEFT = "55555555-5555-4555-8555-999999999999";

/** Connection rows (workspace_api_keys with oauth_client_id). */
const connections: Row[] = [
  conn("conn-live", ALEX, CLAUDE, { scopes: { tasks: "view" } }),
  conn("conn-revoked", ALEX, DESKTOP, { revoked_at: "2026-10-20T00:00:00.000Z" }),
  conn("conn-expired", ALEX, CHATGPT, { expires_at: "2026-10-01T00:00:00.000Z" }),
  conn("conn-other-ws", ALEX, LEFT, { workspace_id: OTHER_WS }),
  conn("conn-sam", SAM, CLAUDE, { scopes: { tasks: "edit" } }),
];
const members = new Set([`${WS}:${ALEX}`, `${WS}:${SAM}`]);

function conn(id: string, person: string, client: string, extra: Row = {}): Row {
  return {
    id,
    workspace_id: WS,
    name: "Claude",
    scopes: { tasks: "edit" },
    created_by: person,
    revoked_at: null,
    expires_at: null,
    last_used_at: "2026-10-23T08:59:30.000Z",
    oauth_client_id: client,
    ...extra,
  };
}

/** Every call the request under test made: which client, what. */
let calls: Array<{ client: string; method: string; path: string }> = [];

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  calls.push({
    client: req.headers.get("x-moduo-key-id") ?? "admin",
    method: req.method,
    path: decodeURIComponent(url.pathname + url.search),
  });
  const q = (name: string) => url.searchParams.get(name);
  const rest = url.pathname.replace(/^\/rest\/v1\//, "");
  let data: unknown = [];
  if (rest === "rpc/module_api_key_effective_scopes") {
    const body = JSON.parse(await req.text()) as { p_key_id: string };
    data = connections.find((c) => c.id === body.p_key_id)?.scopes ?? {};
  } else if (rest === "workspace_api_keys" && req.method === "GET") {
    data = connections.filter(
      (c) =>
        q("created_by") === `eq.${c.created_by}` &&
        q("oauth_client_id") === `eq.${c.oauth_client_id}` &&
        (q("revoked_at") !== "is.null" || c.revoked_at === null),
    );
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

async function post(body: unknown, authorization?: string) {
  calls = [];
  const res = await serve(
    new Request(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return { status: res.status, challenge: res.headers.get("www-authenticate"), body: (await res.json()) as any };
}

const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list" };

describe("401 points at discovery", () => {
  it("answers a call without credentials with a 401 naming the protected-resource document", async () => {
    const res = await post(listTools);
    expect(res.status).toBe(401);
    expect(res.challenge).toBe(`Bearer resource_metadata="${METADATA}"`);
    // Pasted-key clients keep reading the same words.
    expect(res.body.error).toMatch(/^Missing, invalid, revoked or expired API key/);
  });

  it("serves the protected-resource document naming the project's Supabase Auth", async () => {
    const res = await serve(new Request(METADATA, { method: "GET" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({
      resource: ENDPOINT,
      authorization_servers: [`${BASE}/auth/v1`],
      bearer_methods_supported: ["header"],
    });
  });

  it("lets a browser client read the document cross-origin", async () => {
    const res = await serve(new Request(METADATA, { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("answers a bearer that isn't a token (a mistyped key) with the pasted-key words", async () => {
    const res = await post(listTools, "Bearer moduo_sk_typo");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/^Missing, invalid, revoked or expired API key/);
    expect((await post(listTools, "Bearer sk-not-a-token")).body.error).toMatch(/^Missing, invalid/);
  });

  it("still answers a bad pasted key with its own words, plus the discovery header", async () => {
    const res = await post(listTools, `Bearer moduo_sk_${"0".repeat(48)}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/^Missing, invalid, revoked or expired API key/);
    expect(res.challenge).toBe(`Bearer resource_metadata="${METADATA}"`);
    // A pasted key is never tried as a token, nor looked up as a connection.
    expect(calls.map((c) => c.path).filter((p) => p.includes("oauth_client_id"))).toEqual([]);
  });
});

describe("token maps to its connection", () => {
  it("reaches the tools the connection's access allows, as the connection", async () => {
    const res = await post(listTools, `Bearer ${await appToken(ALEX, CLAUDE)}`);
    expect(res.status).toBe(200);
    const names: string[] = res.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("tasks_list");
    expect(names).not.toContain("tasks_create");
    expect(names.some((n) => n.startsWith("notes_"))).toBe(false);
    expect(calls[0].path).toContain(`created_by=eq.${ALEX}`);
    expect(calls[0].path).toContain(`oauth_client_id=eq.${CLAUDE}`);
    expect(calls[0].path).toContain("revoked_at=is.null");
  });

  it("runs a tool with the connection's key header, so the trail reads via the app", async () => {
    const res = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "tasks_list", arguments: {} } },
      `Bearer ${await appToken(ALEX, CLAUDE)}`,
    );
    expect(res.status).toBe(200);
    const toolCalls = calls.filter((c) => c.client !== "admin");
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(new Set(toolCalls.map((c) => c.client))).toEqual(new Set(["conn-live"]));
  });

  it("tells two people's connections to the same app apart", async () => {
    const res = await post(listTools, `Bearer ${await appToken(SAM, CLAUDE)}`);
    const names: string[] = res.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("tasks_create");
  });

  const refused: Array<[string, () => Promise<string>]> = [
    ["a disconnected connection", () => appToken(ALEX, DESKTOP)],
    ["an expired connection", () => appToken(ALEX, CHATGPT)],
    ["an app never connected", () => appToken(ALEX, GONE)],
    ["a connection in a workspace the person left", () => appToken(ALEX, LEFT)],
    ["a person's own session token (no client_id)", () => jwt({ sub: ALEX })],
    ["a token signed by another key", () => jwt({ sub: ALEX, client_id: CLAUDE }, strangerKey)],
    ["an expired token", () => appToken(ALEX, CLAUDE, { exp: Math.floor(Date.now() / 1000) - 60 })],
    ["an anonymous token", () => appToken(ALEX, CLAUDE, { role: "anon" })],
    ["a client_id that isn't an id", () => appToken(ALEX, "claude")],
  ];
  for (const [name, token] of refused) {
    it(`refuses ${name} with 401 invalid_token`, async () => {
      const res = await post(listTools, `Bearer ${await token()}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("invalid_token");
      expect(res.body.error_description).toContain("Sign in again");
      expect(res.challenge).toBe(
        `Bearer error="invalid_token", error_description="${res.body.error_description}", resource_metadata="${METADATA}"`,
      );
      // Refused before any tool ran.
      expect(calls.filter((c) => c.client !== "admin")).toEqual([]);
    });
  }
});
