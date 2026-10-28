/**
 * Same answers through the SDK (MCPO-2, specs/mcp-oauth.md AC2).
 *
 * `sdk-parity.snapshot.json` was taken from the hand-written JSON-RPC server
 * (index.ts before MCPO-2) with this file; the server now runs on the official
 * MCP SDK and must answer the same. For every tool: its tools/list entry, a
 * sample call (arguments made from its listed schema), a call with no
 * arguments, and a call by a key without access; for each key shape the tool
 * list; plus the protocol edges (401, 405, parse errors, notifications, unknown
 * tool). Every database read and write a call makes is recorded with the
 * client that made it, so attribution (the x-moduo-key-id header) is compared
 * too. The few protocol answers the SDK gives differently on purpose are
 * listed in SDK_DIFFERENCES with the reason.
 *
 * Never refresh the snapshot to make this pass: a difference is a behavior
 * change clients see. Two deliberate refreshes so far: MCPO-6 added tool
 * annotations and the five main reads' outputSchema to the tool lists and
 * structuredContent to those reads' answers (29 cases); with those fields
 * taken out, every case still equals the MCPO-2 capture. The MCPO-5 follow-up
 * (2026-07-28) added mcp-method and mcp-name to every answer's CORS
 * Allow-Headers, and answers a ping with an unknown MCP-Protocol-Version
 * header as the old server did (200) instead of the SDK's 400; nothing else
 * moved. The mcp.moduo.app change (2026-10-23) added websiteUrl and icons to
 * serverInfo in the six initialize answers, edited in by hand (capture mode
 * records the SDK's raw answers, not the compared form); nothing else moved.
 * The browser-client fix (2026-10-23) added Access-Control-Expose-Headers:
 * WWW-Authenticate to every answer's CORS, so a client in a web page can read
 * the 401's sign-in pointer; nothing else moved. MOD-572 (2026-10-24) made
 * contacts_update, contacts_set_status and contacts_delete check that the
 * key's person can reach the contact before calling the op, so their three
 * sample cases now answer "No contact with that id" after a reach lookup
 * instead of calling the op (their empty cases were only re-serialised and
 * still answer "contact_id: Invalid input"); nothing else moved. GS-2
 * (2026-10-28) moved notes_search onto the server's notes__search and
 * notes_list onto notes__visible_ids (visibility before the limit): their
 * three call cases now record those RPCs instead of the table reads and
 * share_visible_ids, and notes_search's new description shows in the four
 * tool lists and the two protocol answers that carry one; nothing else moved.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, rs } from "@rstest/core";
import * as supabaseJs from "@supabase/supabase-js";

rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

type Row = Record<string, unknown>;
/** One request a supabase-js client sent, and which client sent it. */
type Op = { client: string; method: string; path: string; body?: unknown };

const NOW = "2026-10-23T09:00:00.000Z";
const URL_BASE = "http://parity.local";
const WS = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const SAMPLE_ID = "33333333-3333-4333-8333-333333333333";

/** Every database call made by the request under test, in order. */
let ops: Op[] = [];

type FixtureKey = { secret: string; name: string; row: Row; effective: Row | null };
const keysByHash = new Map<string, FixtureKey>();

/**
 * The project's API, faked at fetch: both servers build real supabase-js
 * clients (pre-SDK from esm.sh, now through @supabase/server), so what they
 * send is recorded the same way. Answers come from the fixtures: the keys
 * (looked up by hash), the workspace, and nothing else (empty lists, null
 * RPC results).
 */
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const text = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  // Key hashes are recorded by key name, so the snapshot carries no key material.
  const path = decodeURIComponent(url.pathname + url.search).replace(
    /key_hash=eq\.([a-f0-9]{64})/,
    (_m, hash: string) => `key_hash=eq.sha256(${keysByHash.get(hash)?.name ?? "?"})`,
  );
  ops.push({
    client: req.headers.get("x-moduo-key-id") ?? "admin",
    method: req.method,
    path,
    ...(body === undefined ? {} : { body }),
  });
  const rest = url.pathname.replace(/^\/rest\/v1\//, "");
  let data: unknown = [];
  if (rest.startsWith("rpc/")) {
    data = fixtureRpc(rest.slice(4), (body ?? {}) as Row);
  } else if (rest === "workspace_api_keys" && req.method === "GET") {
    const found = keysByHash.get(url.searchParams.get("key_hash")?.replace(/^eq\./, "") ?? "");
    data = found ? [found.row] : [];
  } else if (rest === "workspaces" && req.method === "GET") {
    data = [{ name: "Parity Workspace" }];
  } else if (!url.pathname.startsWith("/rest/v1/")) {
    data = {};
  }
  if (Array.isArray(data) && req.headers.get("accept")?.includes("vnd.pgrst.object")) {
    if (data.length !== 1) {
      return Response.json(
        { code: "PGRST116", details: `The result contains ${data.length} rows`, message: "JSON object requested, multiple (or no) rows returned" },
        { status: 406 },
      );
    }
    data = data[0];
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (Array.isArray(data)) headers["content-range"] = `*/${data.length}`;
  return new Response(req.method === "HEAD" ? null : JSON.stringify(data), { status: 200, headers });
}

function fixtureRpc(fn: string, args: Row): unknown {
  if (fn === "module_api_key_effective_scopes") {
    for (const k of keysByHash.values()) if (k.row.id === args.p_key_id) return k.effective;
  }
  return null;
}

// The pre-SDK server imported supabase-js from esm.sh, which only Deno loads.
rs.mock("https://esm.sh/@supabase/supabase-js@2?target=deno", () => supabaseJs);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const MODULES = ["tasks", "links", "contacts", "calendar", "notes", "email", "chat"] as const;
const everywhere = (level: string) => Object.fromEntries(MODULES.map((m) => [m, level]));

/** Key shapes whose tool lists are compared, by name. */
const KEY_SHAPES: Record<string, Row> = {
  edit_all: everywhere("edit"),
  view_all: everywhere("view"),
  none: everywhere("none"),
  ...Object.fromEntries(MODULES.flatMap((m) => [[`${m}_view`, { [m]: "view" }], [`${m}_edit`, { [m]: "edit" }]])),
  calendar_edit_tasks_view: { calendar: "edit", tasks: "view" },
  tasks_edit_links_view: { tasks: "edit", links: "view" },
  unknown_levels: { tasks: "admin", notes: "write" },
};

const secretFor = (i: number) => `moduo_sk_${i.toString(16).padStart(48, "0")}`;
const keyIds: Record<string, string> = {};

async function addKey(name: string, i: number, row: Partial<Row>, effective: Row | null) {
  const secret = secretFor(i);
  const id = `key-${name}`;
  keyIds[name] = secret;
  keysByHash.set(await sha256Hex(secret), {
    secret,
    name,
    row: {
      id,
      workspace_id: WS,
      name: `Key ${name}`,
      scopes: effective,
      created_by: ME,
      revoked_at: null,
      expires_at: null,
      last_used_at: NOW,
      ...row,
    },
    effective,
  });
}

/** The server under test: (Request) → Response. */
let serve: (req: Request) => Promise<Response>;

beforeAll(async () => {
  rs.useFakeTimers({ toFake: ["Date"] });
  rs.setSystemTime(new Date(NOW));
  rs.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("44444444-4444-4444-8444-444444444444");
  rs.spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
  let i = 1;
  for (const [name, scopes] of Object.entries(KEY_SHAPES)) await addKey(name, i++, {}, scopes);
  await addKey("revoked", i++, { revoked_at: NOW }, everywhere("edit"));
  await addKey("expired", i++, { expires_at: "2026-10-01T00:00:00.000Z" }, everywhere("edit"));
  await addKey("no_creator", i++, { created_by: null }, everywhere("edit"));
  await addKey("no_effective", i++, {}, null);
  serve = await loadServer();
});

afterAll(() => {
  rs.useRealTimers();
  rs.restoreAllMocks();
});

/** The whole function: index.ts registers its handler with Deno.serve. */
async function loadServer(): Promise<(req: Request) => Promise<Response>> {
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const env: Record<string, string> = {
    SUPABASE_URL: URL_BASE,
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_parity" }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_parity" }),
  };
  Object.assign(process.env, env);
  (globalThis as any).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
    },
  };
  await import("./index.ts");
  if (!handler) throw new Error("index.ts did not call Deno.serve");
  return handler;
}

type Exchange = { status: number; contentType: string | null; cors: string[]; body: unknown; ops: Op[] };

async function send(
  body: unknown,
  opts: { key?: string | null; method?: string; raw?: string; headers?: Record<string, string> } = {},
): Promise<Exchange> {
  ops = [];
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...opts.headers,
  };
  const secret = opts.key === undefined ? keyIds.edit_all : opts.key;
  if (secret) headers.authorization = `Bearer ${secret}`;
  const method = opts.method ?? "POST";
  const res = await serve(
    new Request(`${URL_BASE}/functions/v1/moduo-mcp`, {
      method,
      headers,
      body: method === "POST" ? (opts.raw ?? JSON.stringify(body)) : undefined,
    }),
  );
  const text = await res.text();
  // Let work a tool left running after its answer land in this case, not the next.
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep the text
  }
  const cors = [...res.headers].filter(([h]) => h.startsWith("access-control-")).map(([h, v]) => `${h}: ${v}`).sort();
  return { status: res.status, contentType: res.headers.get("content-type"), cors, body: parsed, ops: [...ops] };
}

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, params });

// ---------------------------------------------------------------------------
// Sample arguments, made from a tool's listed schema.

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minItems?: number;
  minimum?: number;
  pattern?: string;
  format?: string;
  const?: unknown;
};

function sampleValue(s: Schema): unknown {
  if (s.const !== undefined) return s.const;
  if (s.enum?.length) return s.enum[0];
  const branches = s.anyOf ?? s.oneOf;
  if (branches) return sampleValue(branches.find((b) => b.type !== "null") ?? branches[0]);
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  switch (type) {
    case "string":
      if (s.format === "date-time") return NOW;
      if (s.pattern?.includes("\\d{4}-\\d{2}-\\d{2}")) return "2026-10-23";
      if (s.pattern?.includes("\\d{2}:\\d{2}")) return "09:00";
      return SAMPLE_ID;
    case "integer":
    case "number":
      return s.minimum ?? 1;
    case "boolean":
      return true;
    case "array":
      return s.minItems ? [sampleValue(s.items ?? { type: "string" })] : [];
    case "object":
      return sampleArgs(s);
    default:
      return SAMPLE_ID;
  }
}

function sampleArgs(s: Schema): Row {
  const out: Row = {};
  for (const name of s.required ?? []) out[name] = sampleValue(s.properties?.[name] ?? {});
  return out;
}

// ---------------------------------------------------------------------------

const SNAPSHOT_PATH = new URL("./sdk-parity.snapshot.json", import.meta.url);
// Capture rewrites every case with today's answers, SDK_DIFFERENCES' too (they must keep the
// pre-SDK answers). For a deliberate change to every answer (a CORS header), transform the old
// snapshot instead (a string replace on the changed field) and check nothing else moved.
const CAPTURE = process.env.MODUO_PARITY_CAPTURE === "1";

/**
 * Protocol answers the SDK gives differently on purpose: why, and what it
 * answers now (checked below). Tool answers never appear here.
 */
const SDK_DIFFERENCES: Record<string, { why: string; now: (e: Exchange) => void }> = {
  "initialize 2025-11-25": {
    why: "The SDK speaks protocol 2025-11-25 too (specs/mcp-oauth.md #8); the old server fell back to 2025-03-26.",
    now: (e) => expect((e.body as any).result.protocolVersion).toBe("2025-11-25"),
  },
  "initialize unknown version": {
    why: "An unknown version is answered with the SDK's latest (2025-11-25), as the spec says, not 2025-03-26.",
    now: (e) => expect((e.body as any).result.protocolVersion).toBe("2025-11-25"),
  },
  "initialize without params": {
    why: "The SDK checks initialize's params (protocolVersion, capabilities, clientInfo) and answers -32603; the old server answered anything.",
    now: (e) => expect((e.body as any).error.code).toBe(-32603),
  },
  "unknown method": {
    why: "The SDK words method-not-found without the method's name; same code (-32601).",
    now: (e) =>
      expect(e.body).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }),
  },
};

async function collect(): Promise<Record<string, Exchange>> {
  const out: Record<string, Exchange> = {};
  // Protocol edges.
  out["initialize 2025-06-18"] = await send(
    rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "parity", version: "1" } }),
  );
  out["initialize 2025-03-26"] = await send(
    rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "parity", version: "1" } }),
  );
  out["initialize 2025-11-25"] = await send(
    rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "parity", version: "1" } }),
  );
  out["initialize unknown version"] = await send(
    rpc("initialize", { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "parity", version: "1" } }),
  );
  out["initialize view key"] = await send(
    rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "parity", version: "1" } }),
    { key: keyIds.tasks_view },
  );
  out.ping = await send(rpc("ping"));
  out["notification"] = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
  out["no key"] = await send(rpc("tools/list"), { key: null });
  out["malformed key"] = await send(rpc("tools/list"), { key: "moduo_sk_nothex" });
  out["unknown key"] = await send(rpc("tools/list"), { key: secretFor(4095) });
  out["revoked key"] = await send(rpc("tools/list"), { key: keyIds.revoked });
  out["expired key"] = await send(rpc("tools/list"), { key: keyIds.expired });
  out["key without creator"] = await send(rpc("tools/list"), { key: keyIds.no_creator });
  out["key without effective scopes"] = await send(rpc("tools/list"), { key: keyIds.no_effective });
  out["GET"] = await send(null, { method: "GET" });
  out["parse error"] = await send(null, { raw: "{not json" });
  out["batch"] = await send([rpc("ping", undefined, 1), rpc("ping", undefined, 2)]);
  out["invalid request"] = await send({ jsonrpc: "1.0", id: 7, method: "ping" });
  out["unknown tool"] = await send(rpc("tools/call", { name: "tasks_teleport", arguments: {} }));
  out["arguments not an object"] = await send(rpc("tools/call", { name: "tasks_list", arguments: "all" }));
  out["arguments null"] = await send(rpc("tools/call", { name: "tasks_list", arguments: null }));
  out["arguments a list"] = await send(rpc("tools/call", { name: "tasks_get", arguments: ["MOD-1"] }));
  out["arguments missing"] = await send(rpc("tools/call", { name: "tasks_list" }));
  out["tool name missing"] = await send(rpc("tools/call", {}));
  out["unknown method"] = await send(rpc("resources/list"));
  out["params null"] = await send(rpc("tools/list", null));
  out["unsupported protocol header"] = await send(rpc("ping"), { headers: { "mcp-protocol-version": "1999-01-01" } });
  out["initialize without params"] = await send(rpc("initialize"));
  out["string id"] = await send(rpc("ping", undefined, "abc"));
  out["plain client headers"] = await send(rpc("tools/list"), {
    headers: { accept: "*/*", "content-type": "text/plain" },
  });
  // Tool lists per key shape.
  for (const shape of Object.keys(KEY_SHAPES)) {
    out[`tools/list ${shape}`] = await send(rpc("tools/list"), { key: keyIds[shape] });
  }
  // Every tool: a sample call, a call with no arguments, a call without access.
  const listed = (out["tools/list edit_all"].body as { result: { tools: Array<{ name: string; inputSchema: Schema }> } })
    .result.tools;
  expect(listed.length).toBeGreaterThan(100);
  // The key lookups are the same for every call (compared in the cases above),
  // so only the tool's own database calls are kept.
  const toolOps = (e: Exchange): Exchange => ({ ...e, ops: e.ops.filter((op) => op.client !== "admin") });
  for (const t of listed) {
    out[`call ${t.name} sample`] = toolOps(
      await send(rpc("tools/call", { name: t.name, arguments: sampleArgs(t.inputSchema) })),
    );
    out[`call ${t.name} empty`] = toolOps(await send(rpc("tools/call", { name: t.name, arguments: {} })));
    out[`call ${t.name} refused`] = toolOps(
      await send(rpc("tools/call", { name: t.name, arguments: {} }), { key: keyIds.none }),
    );
  }
  return out;
}

/** JSON with object keys sorted: member order carries no meaning on the wire. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

describe("moduo-mcp through the SDK", () => {
  it("same answers through the SDK", async () => {
    const now = await collect();
    if (CAPTURE) {
      // One case per line, so a later diff points at the case that moved.
      const lines = Object.entries(now).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
      writeFileSync(SNAPSHOT_PATH, `{\n${lines.join(",\n")}\n}\n`);
      return;
    }
    // MODUO_PARITY_DUMP=<file> writes this run's answers there, to diff by hand.
    if (process.env.MODUO_PARITY_DUMP) writeFileSync(process.env.MODUO_PARITY_DUMP, JSON.stringify(now, null, 1));
    const before = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Record<string, Exchange>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(before).sort());
    const differing = Object.keys(before).filter(
      (name) => !(name in SDK_DIFFERENCES) && canonical(now[name]) !== canonical(before[name]),
    );
    // Name every case that moved, then show the first in full.
    expect(differing).toEqual([]);
    for (const name of differing) expect(now[name], name).toEqual(before[name]);
    for (const [name, difference] of Object.entries(SDK_DIFFERENCES)) {
      difference.now(now[name]);
      // The database calls (the key lookup) and CORS still match, and the
      // status too unless the difference is the status.
      expect(now[name].ops, name).toEqual(before[name].ops);
      expect(now[name].cors, name).toEqual(before[name].cors);
      expect(now[name].status, name).toBe(before[name].status);
    }
    // 380 cases through the SDK: about a second here, past the 5 s default on a busy CI runner.
  }, 60_000);
});
