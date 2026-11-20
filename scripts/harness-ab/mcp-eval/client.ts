// The eval's side door into its own stack: a fresh person, workspace and Moduo key per run (SQL on
// the eval stack's DB only), and a plain JSON-RPC client for the connector, used to seed each task,
// to run its reference solution and to read back the result for the oracle.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { RefusedError, refuseMcpTarget } from "../safety";

export type Ctx = {
  /** Call a connector tool as the run's key; throws on a tool error. */
  call: (tool: string, args?: Record<string, unknown>) => Promise<any>;
  /** One SQL value from the eval stack's DB (checks only, scoped to the run's workspace). */
  sql: (query: string) => string;
  workspaceId: string;
  userId: string;
  /** Local dates the prompts mean by "today", "tomorrow", … (YYYY-MM-DD). */
  today: string;
  /** Whatever seed() returned (ids the check needs). */
  seeded: Record<string, any>;
};

export type Account = { userId: string; workspaceId: string; keyId: string; secret: string };

/** The scopes every run's key gets: every module the eval reaches, at Edit. */
export const EVAL_SCOPES = {
  tasks: "edit",
  notes: "edit",
  calendar: "edit",
  contacts: "edit",
  chat: "edit",
  links: "edit",
  email: "none",
};

function psql(dbUrl: string, query: string): string {
  if (!/@127\.0\.0\.1:(\d+)\//.test(dbUrl) || /:5432\d\//.test(dbUrl))
    throw new RefusedError([{ where: "mcp-eval db", reason: `${dbUrl} is not the eval stack's` }]);
  const r = spawnSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-qtAX", "-c", query], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`psql: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A person, their workspace (the app's own triggers seed it) and a key, all new for this run. */
export function provision(dbUrl: string, label: string): Account {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const keyId = randomUUID();
  const secret = `moduo_sk_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(secret).digest("hex");
  const email = `mcp-eval+${label.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-${userId.slice(0, 8)}@moduo.local`;
  psql(
    dbUrl,
    `begin;
     -- The eval stack is throwaway: a founder plan opens every module (Chat is Duo and up).
     insert into public.founder_emails (email) values (${q(email)}) on conflict do nothing;
     insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new, email_change)
     values ('00000000-0000-0000-0000-000000000000', ${q(userId)}, 'authenticated', 'authenticated',
       ${q(email)}, now(), '{"provider":"email","providers":["email"]}',
       '{"display_name":"Eval Person"}', now(), now(), '', '', '', '');
     update public.profiles set display_name = 'Eval Person' where id = ${q(userId)};
     -- "Today" on the server is the person's day, the same one the agent's prompt means.
     insert into public.user_preferences (user_id, time_zone, time_zone_manual)
       values (${q(userId)}, ${q(TIME_ZONE)}, true)
       on conflict (user_id) do update set time_zone = excluded.time_zone, time_zone_manual = true;
     insert into public.workspaces (id, owner_id, name, task_key)
       values (${q(workspaceId)}, ${q(userId)}, 'Eval workspace', 'EVL');
     insert into public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
       values (${q(keyId)}, ${q(workspaceId)}, 'Eval agent', ${q(secret.slice(0, 16))}, ${q(hash)},
         ${q(JSON.stringify(EVAL_SCOPES))}::jsonb, ${q(userId)});
     commit;`,
  );
  return { userId, workspaceId, keyId, secret };
}

type RpcResult = {
  result?: {
    content?: { type: string; text?: string }[];
    structuredContent?: unknown;
    isError?: boolean;
    tools?: unknown[];
  };
  error?: { code: number; message: string };
};

export function connector(mcpUrl: string, secret: string) {
  const refused = refuseMcpTarget(mcpUrl);
  if (refused.length) throw new RefusedError(refused);
  let id = 0;
  const rpc = async (method: string, params: unknown): Promise<RpcResult> => {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as RpcResult;
  };
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const r = await rpc("tools/call", { name: tool, arguments: args });
    if (r.error) throw new Error(`${tool}: ${r.error.message}`);
    const text = r.result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
    if (r.result?.isError) throw new Error(`${tool}: ${text.slice(0, 500)}`);
    const sc = r.result?.structuredContent as Record<string, unknown> | undefined;
    // A list result goes out as structuredContent { result: [...] } (MCP wants an object there).
    if (sc && typeof sc === "object" && Object.keys(sc).length === 1 && Array.isArray(sc.result))
      return sc.result;
    if (sc !== undefined) return sc;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  const tools = async () =>
    ((await rpc("tools/list", {})).result?.tools ?? []) as { name: string }[];
  return { call, tools };
}

/** The Ctx a task's seed, reference and check get. */
export function context(opts: {
  mcpUrl: string;
  dbUrl: string;
  account: Account;
  today: string;
}): Ctx {
  const c = connector(opts.mcpUrl, opts.account.secret);
  return {
    call: c.call,
    sql: (query) => psql(opts.dbUrl, query),
    workspaceId: opts.account.workspaceId,
    userId: opts.account.userId,
    today: opts.today,
    seeded: {},
  };
}

/** YYYY-MM-DD in local time, `days` from `from`. */
export function addDays(from: string, days: number): string {
  const d = new Date(`${from}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The next given weekday (0 = Sunday) strictly after `from`. */
export function nextWeekday(from: string, weekday: number): string {
  const d = new Date(`${from}T12:00:00`);
  const ahead = (weekday - d.getDay() + 7) % 7 || 7;
  return addDays(from, ahead);
}
