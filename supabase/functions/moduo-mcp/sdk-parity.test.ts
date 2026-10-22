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
 * change clients see.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, rs } from "@rstest/core";

rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

type Row = Record<string, unknown>;
type Op = { client: string; table?: string; fn?: string; chain: Array<[string, unknown[]]> };

const NOW = "2026-10-23T09:00:00.000Z";
const WS = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const SAMPLE_ID = "33333333-3333-4333-8333-333333333333";

/** Every database call made by the request under test, in order. */
let ops: Op[] = [];

/**
 * A supabase-js stand-in that records each query chain and answers from the
 * fixtures: the keys (looked up by hash), the workspace, and nothing else
 * (empty lists, null rows, null RPC results).
 */
function fakeClient(headers: Record<string, string>) {
  const client = headers["x-moduo-key-id"] ?? "admin";
  const chainOf = (op: Op, resolveData: () => unknown): any => {
    const builder: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") {
            ops.push(redactHashes(op));
            const data = resolveData();
            return (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : null }).then(
                resolve,
                reject,
              );
          }
          return (...args: unknown[]) => {
            op.chain.push([prop, args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  const single = (op: Op) => op.chain.some(([m]) => m === "maybeSingle" || m === "single");
  return {
    from(table: string) {
      const op: Op = { client, table, chain: [] };
      return chainOf(op, () => {
        const rows = fixtureRows(table, op);
        return single(op) ? (rows[0] ?? null) : rows;
      });
    },
    rpc(fn: string, args: unknown) {
      const op: Op = { client, fn, chain: [["args", [args]]] };
      return chainOf(op, () => fixtureRpc(fn, args as Row));
    },
    storage: {
      from(bucket: string) {
        const op: Op = { client, table: `storage:${bucket}`, chain: [] };
        return chainOf(op, () => null);
      },
    },
  };
}

type FixtureKey = { secret: string; name: string; row: Row; effective: Row | null };
const keysByHash = new Map<string, FixtureKey>();

/** Key hashes are recorded by key name, so the snapshot carries no key material. */
function redactHashes(op: Op): Op {
  return {
    ...op,
    chain: op.chain.map(([m, a]) =>
      m === "eq" && a[0] === "key_hash" ? [m, [a[0], `sha256(${keysByHash.get(String(a[1]))?.name ?? "?"})`]] : [m, a],
    ),
  };
}

function fixtureRows(table: string, op: Op): Row[] {
  const eq = (col: string) => op.chain.find(([m, a]) => m === "eq" && a[0] === col)?.[1][1];
  if (table === "workspace_api_keys") {
    const found = keysByHash.get(String(eq("key_hash")));
    return found ? [found.row] : [];
  }
  if (table === "workspaces") return [{ name: "Parity Workspace" }];
  return [];
}

function fixtureRpc(fn: string, args: Row): unknown {
  if (fn === "module_api_key_effective_scopes") {
    for (const k of keysByHash.values()) if (k.row.id === args.p_key_id) return k.effective;
  }
  return null;
}

rs.mock("https://esm.sh/@supabase/supabase-js@2?target=deno", () => ({
  createClient: (_url: string, _key: string, opts?: { global?: { headers?: Record<string, string> } }) =>
    fakeClient(opts?.global?.headers ?? {}),
}));

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

/** The pre-SDK server: index.ts registers its handler with Deno.serve. */
async function loadServer(): Promise<(req: Request) => Promise<Response>> {
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const env: Record<string, string> = {
    SUPABASE_URL: "http://parity.local",
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_parity" }),
  };
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

type Exchange = { status: number; contentType: string | null; body: unknown; ops: Op[] };

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
    new Request("http://parity.local/functions/v1/moduo-mcp", {
      method,
      headers,
      body: method === "POST" ? (opts.raw ?? JSON.stringify(body)) : undefined,
    }),
  );
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep the text
  }
  return { status: res.status, contentType: res.headers.get("content-type"), body: parsed, ops: [...ops] };
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
const CAPTURE = process.env.MODUO_PARITY_CAPTURE === "1";

/**
 * Protocol answers the SDK gives differently on purpose (case → why). Tool
 * answers never appear here.
 */
const SDK_DIFFERENCES: Record<string, string> = {};

async function collect(): Promise<Record<string, Exchange>> {
  const out: Record<string, Exchange> = {};
  // Protocol edges.
  out["initialize 2025-06-18"] = await send(
    rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "parity", version: "1" } }),
  );
  out["initialize 2025-03-26"] = await send(
    rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "parity", version: "1" } }),
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

describe("moduo-mcp through the SDK", () => {
  it("same answers through the SDK", async () => {
    const now = await collect();
    if (CAPTURE) {
      // One case per line, so a later diff points at the case that moved.
      const lines = Object.entries(now).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
      writeFileSync(SNAPSHOT_PATH, `{\n${lines.join(",\n")}\n}\n`);
      return;
    }
    const before = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Record<string, Exchange>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(before).sort());
    for (const [name, exchange] of Object.entries(before)) {
      if (name in SDK_DIFFERENCES) continue;
      expect(now[name], name).toEqual(exchange);
    }
  });
});
