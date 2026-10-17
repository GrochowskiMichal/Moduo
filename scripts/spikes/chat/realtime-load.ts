// CV-0 spike 3 (Chat v2): Realtime delivery, typing cost and the plan's
// quotas, measured on the LOCAL stack only (127.0.0.1:54321; it refuses any
// other URL). Record: docs/build/chat-v2/CV-0-S3.md.
//
// Everything it creates is throwaway and removed at the end: 100+ accounts
// (`cv0-s3-<run>-…@example.test`), their workspaces, channels and messages,
// and the typing rows in realtime.messages for the topics it used. It never
// reads or writes an existing workspace. A row-count snapshot of the public,
// auth, realtime and storage schemas is taken before and after, and any
// difference is printed.
//
//   bun scripts/spikes/chat/realtime-load.ts                 # node clients only
//   bun scripts/spikes/chat/realtime-load.ts --base-url=http://127.0.0.1:8093
//       # plus two Playwright contexts driving v1's /chat page; start the dev
//       # server first, from a worktree whose .env.local points at the local
//       # stack (`bun run env:local`):
//       # MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8093
//
// Options: --clients=100 · --phases=delivery,gap,typing,switch,burst,hackathon
//          --messages=50 --unread-messages=20 --interval=3000 (delivery pacing)
//          --gap-seconds=60 · --typing-seconds=60 · --teams=25 · --out=<file.json> · --shots=<dir>
//
// The local Realtime tenant carries the Free plan's limits (_realtime.tenants:
// 200 connections, 100 events/s, 100 joins/s, 100 channels per client), so
// what trips here is what would trip on Free. Run it with nothing else using
// the local stack's Realtime: other sockets count against the same caps.
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

// ── options ──────────────────────────────────────────────────────────────────
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  }),
);
const opt = (k: string, d: string) => args.get(k) ?? d;
const N_CLIENTS = Number(opt("clients", "100"));
const PHASES = new Set(opt("phases", "delivery,gap,typing,switch,burst,hackathon").split(","));
const BASE_URL = args.get("base-url");
const N_MESSAGES = Number(opt("messages", "50"));
const N_UNREAD = Number(opt("unread-messages", "20"));
const INTERVAL = Number(opt("interval", "3000"));
const GAP_S = Number(opt("gap-seconds", "60"));
const TYPING_S = Number(opt("typing-seconds", "60"));
const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = `cv0-s3-${Date.now().toString(36)}`;
const OUT = opt("out", join(tmpdir(), `${RUN}.json`));
const SHOTS = args.get("shots"); // a directory for screenshots of the pages, if wanted
const TEAMS = Number(opt("teams", "25")); // hackathon: workspaces of 4

// ── the local stack ─────────────────────────────────────────────────────────
const ENV = { ...process.env, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT ?? "orbstack" };
const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: ENV,
  }),
) as Record<string, string>;
const API = status.API_URL;
if (!API?.startsWith("http://127.0.0.1:")) throw new Error(`Local stack only; got ${API}`);
const ANON = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const SERVICE = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
const JWT_SECRET = status.JWT_SECRET;
const DB = "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
const psql = (sql: string) =>
  execFileSync("psql", [DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim();
const admin = createClient(API, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

// ── stats ────────────────────────────────────────────────────────────────────
type Stats = { n: number; p50: number; p95: number; p99: number; max: number; mean: number };
function stats(xs: number[]): Stats {
  if (xs.length === 0) return { n: 0, p50: NaN, p95: NaN, p99: NaN, max: NaN, mean: NaN };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    n: s.length,
    p50: r(q(0.5)),
    p95: r(q(0.95)),
    p99: r(q(0.99)),
    max: r(s[s.length - 1]),
    mean: r(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

// ── people and tokens ───────────────────────────────────────────────────────
type Person = { id: string; email: string; token: string; name: string };
const people: Person[] = [];
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** An access token signed with the local stack's JWT secret: 100 password
 * sign-ins would hit the stack's 30-per-5-minutes sign-in limit. */
function mint(sub: string): string {
  const t = Math.floor(now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub,
    role: "authenticated",
    aud: "authenticated",
    iat: t,
    exp: t + 4 * 3600,
    is_anonymous: false,
  });
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
async function createPeople(n: number, label: string): Promise<Person[]> {
  const out: Person[] = [];
  for (let i = 0; i < n; i += 10) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(10, n - i) }, async (_, j) => {
        const k = String(i + j + 1).padStart(3, "0");
        const email = `${RUN}-${label}${k}@example.test`;
        const name = `S3 ${label}${k}`;
        const { data, error } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { display_name: name },
        });
        if (error) throw error;
        const p = { id: data.user.id, email, token: mint(data.user.id), name };
        people.push(p);
        return p;
      }),
    );
    out.push(...batch);
  }
  return out;
}

// ── a network that can go down (gap phase) ──────────────────────────────────
type Net = { mode: "up" | "down" | "frozen"; live: Set<{ drop(): void }> };
/** A WebSocket stand-in for realtime-js's `transport` option: "down" drops
 * the open socket like a lost network (no clean close, so Phoenix reconnects
 * with backoff) and refuses new ones; "frozen" keeps the socket but swallows
 * traffic both ways (a sleeping laptop: the heartbeat times out). */
function transportFor(net: Net) {
  return class NetSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    onopen: ((e: unknown) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onmessage: ((e: unknown) => void) | null = null;
    timeout = 0;
    private ws: WebSocket | null = null;
    private state = 0;
    constructor(
      readonly url: string,
      protocols?: string | string[],
    ) {
      if (net.mode !== "up") {
        setTimeout(() => {
          this.state = 3;
          this.onerror?.(new Event("error"));
          this.onclose?.({ code: 1006, reason: "network down", wasClean: false });
        }, 30);
        return;
      }
      const ws = new WebSocket(url, protocols);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      net.live.add(this);
      ws.onopen = (e) => this.onopen?.(e);
      ws.onmessage = (e) => {
        if (net.mode === "up") this.onmessage?.(e);
      };
      ws.onerror = (e) => this.onerror?.(e);
      ws.onclose = (e) => {
        net.live.delete(this);
        this.onclose?.(e);
      };
    }
    set binaryType(_v: string) {}
    get binaryType() {
      return "arraybuffer";
    }
    get readyState() {
      return this.ws ? this.ws.readyState : this.state;
    }
    get bufferedAmount() {
      return this.ws ? this.ws.bufferedAmount : 0;
    }
    send(d: string | ArrayBuffer) {
      if (net.mode === "up") this.ws?.send(d);
    }
    close(code?: number, reason?: string) {
      if (this.ws) this.ws.close(code, reason);
    }
    drop() {
      const ws = this.ws;
      if (!ws) return;
      this.ws = null;
      this.state = 3;
      net.live.delete(this);
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
      this.onclose?.({ code: 1006, reason: "network drop", wasClean: false });
    }
  };
}

// ── clients ─────────────────────────────────────────────────────────────────
type Recv = { at: number; commitTs: number; bytes: number };
type Client = {
  person: Person;
  sb: SupabaseClient;
  net?: Net;
  /** message id → first receipt over postgres_changes */
  got: Map<string, Recv>;
  /** every postgres_changes event, by `${table}:${type}` */
  events: Map<string, number>;
  eventTimes: number[];
  typing: { from: string; at: number; stop: boolean }[];
  presenceEvents: number;
  statuses: { topic: string; status: string; at: number; err?: string }[];
  dbSubscribedAt: number[];
  channels: Map<string, RealtimeChannel>;
  label: string;
};
const allClients: Client[] = [];
const samplePayloads: unknown[] = [];

function makeClient(person: Person, label: string, net?: Net): Client {
  const sb = createClient(API, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => person.token,
    realtime: net ? { transport: transportFor(net) as never } : {},
  });
  const c: Client = {
    person,
    sb,
    net,
    got: new Map(),
    events: new Map(),
    eventTimes: [],
    typing: [],
    presenceEvents: 0,
    statuses: [],
    dbSubscribedAt: [],
    channels: new Map(),
    label,
  };
  allClients.push(c);
  return c;
}

/** A join budget shared by every client: the local tenant allows 100 joins/s. */
let joinTokens: number[] = [];
async function joinGate(perSecond: number) {
  for (;;) {
    const t = now();
    joinTokens = joinTokens.filter((x) => t - x < 1000);
    if (joinTokens.length < perSecond) {
      joinTokens.push(t);
      return;
    }
    await sleep(1000 - (t - joinTokens[0]) + 1);
  }
}

type JoinOutcome = { status: string; ms: number; err?: string };
function watchStatus(
  c: Client,
  topic: string,
  ch: RealtimeChannel,
  onFirst: (o: JoinOutcome) => void,
  started: number,
) {
  let done = false;
  ch.subscribe((s, err) => {
    c.statuses.push({ topic, status: s, at: now(), err: err?.message });
    if (!done && s !== "SUBSCRIBED" && s !== "CHANNEL_ERROR" && s !== "TIMED_OUT" && s !== "CLOSED")
      return;
    if (!done) {
      done = true;
      onFirst({ status: s, ms: now() - started, err: err?.message });
    }
  });
}

/** v1's `chat-db:<ws>:<me>`: messages + channels of the workspace, my memberships. */
async function joinDb(c: Client, ws: string, rate = 25): Promise<JoinOutcome> {
  await joinGate(rate);
  return new Promise((resolve) => {
    const topic = `chat-db:${ws}:${c.person.id}`;
    const started = now();
    const ch = c.sb.channel(topic);
    c.channels.set(topic, ch);
    let pgReady = false;
    let first: JoinOutcome | null = null;
    const finish = () => {
      if (first && (pgReady || first.status !== "SUBSCRIBED"))
        resolve({ ...first, ms: now() - started });
    };
    const record =
      (table: string) =>
      (p: { eventType: string; commit_timestamp: string; new: Record<string, unknown> }) => {
        const at = now();
        c.events.set(`${table}:${p.eventType}`, (c.events.get(`${table}:${p.eventType}`) ?? 0) + 1);
        c.eventTimes.push(at);
        if (table === "chat_messages" && p.eventType === "INSERT") {
          const id = p.new.id as string;
          if (!c.got.has(id)) {
            const bytes = JSON.stringify(p).length;
            c.got.set(id, { at, commitTs: Date.parse(p.commit_timestamp), bytes });
            if (samplePayloads.length < 3) samplePayloads.push(p);
          }
        }
      };
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chat_messages", filter: `workspace_id=eq.${ws}` },
      record("chat_messages"),
    )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_channels", filter: `workspace_id=eq.${ws}` },
        record("chat_channels"),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_members",
          filter: `user_id=eq.${c.person.id}`,
        },
        record("chat_members"),
      )
      .on("system", {}, (m: { extension?: string; status?: string }) => {
        if (m?.extension === "postgres_changes" && m.status === "ok") {
          c.dbSubscribedAt.push(now());
          pgReady = true;
          finish();
        }
      });
    watchStatus(
      c,
      topic,
      ch,
      (o) => {
        first = o;
        finish();
      },
      started,
    );
    setTimeout(() => {
      if (!first) resolve({ status: "NO_ANSWER", ms: now() - started });
      else if (!pgReady)
        resolve({ ...first, status: `${first.status}+NO_PG`, ms: now() - started });
    }, 15_000);
  });
}

/** v1's `chat:<ws>`: private Presence, keyed by person, tracked on join. */
async function joinPresence(c: Client, ws: string, rate = 25): Promise<JoinOutcome> {
  await joinGate(rate);
  return new Promise((resolve) => {
    const topic = `chat:${ws}`;
    const started = now();
    const ch = c.sb.channel(topic, { config: { private: true, presence: { key: c.person.id } } });
    c.channels.set(topic, ch);
    ch.on("presence", { event: "sync" }, () => {
      c.presenceEvents++;
    });
    let done = false;
    ch.subscribe((s, err) => {
      c.statuses.push({ topic, status: s, at: now(), err: err?.message });
      // v1 tracks itself on every (re)join.
      if (s === "SUBSCRIBED") void ch.track({ at: new Date().toISOString() });
      if (!done && ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) {
        done = true;
        resolve({ status: s, ms: now() - started, err: err?.message });
      }
    });
  });
}

/** `chat:typing:<conversation>`: private Broadcast, only the open conversation. */
async function joinTyping(c: Client, channelId: string, rate = 25): Promise<JoinOutcome> {
  await joinGate(rate);
  return new Promise((resolve) => {
    const topic = `chat:typing:${channelId}`;
    const started = now();
    const ch = c.sb.channel(topic, { config: { private: true } });
    c.channels.set(topic, ch);
    ch.on("broadcast", { event: "typing" }, (m) => {
      const p = m.payload as { userId: string; stop: boolean };
      c.typing.push({ from: p.userId, at: now(), stop: p.stop });
    });
    watchStatus(c, topic, ch, (o) => resolve(o), started);
  });
}

async function leave(c: Client, topic: string) {
  const ch = c.channels.get(topic);
  if (!ch) return;
  c.channels.delete(topic);
  await c.sb.removeChannel(ch);
}

async function closeClient(c: Client) {
  try {
    await c.sb.removeAllChannels();
  } catch {}
  try {
    c.sb.realtime.disconnect();
  } catch {}
}

// ── sending ──────────────────────────────────────────────────────────────────
type Sent = {
  seq: number;
  id: string;
  createdAt: string;
  createdMs: number;
  tReq: number;
  tResp: number;
  by: string;
  channelId: string;
};
const sent = new Map<string, Sent>();
let seq = 0;
async function send(c: Client, channelId: string, label: string): Promise<Sent | null> {
  const n = ++seq;
  const body = `s3m-${n}- ${label} ${randomUUID().slice(0, 8)} — a short line of chat, about the length people type`;
  const tReq = now();
  const r = await c.sb.rpc("chat_op_send", {
    p_id: randomUUID(),
    p_channel_id: channelId,
    p_body: body,
    p_reply_to_id: null,
  });
  const tResp = now();
  if (r.error) {
    log("send failed", r.error.message);
    return null;
  }
  const row = r.data as { id: string; created_at: string };
  const s: Sent = {
    seq: n,
    id: row.id,
    createdAt: row.created_at,
    createdMs: Date.parse(row.created_at),
    tReq,
    tResp,
    by: c.person.id,
    channelId,
  };
  sent.set(s.id, s);
  return s;
}

/** The host clock against the database's: created_at (= now() in the send's
 * transaction) lies between the request leaving and the answer arriving. */
function clockBounds(list: Sent[]) {
  let lo = -Infinity;
  let hi = Infinity;
  for (const s of list) {
    lo = Math.max(lo, s.createdMs - s.tResp);
    hi = Math.min(hi, s.createdMs - s.tReq);
  }
  return { lo, hi, mid: lo <= hi ? (lo + hi) / 2 : 0, consistent: lo <= hi };
}

// ── database-side counters ───────────────────────────────────────────────────
function pgStat(): {
  typingCalls: number;
  typingMs: number;
  sendCalls: number;
  sendMs: number;
  walCalls: number;
  walMs: number;
} {
  const row = psql(`
    select
      coalesce(sum(calls) filter (where query like 'WITH pgrst_source%' and query like '%"p_stop"%'), 0),
      coalesce(sum(total_exec_time) filter (where query like 'WITH pgrst_source%' and query like '%"p_stop"%'), 0),
      coalesce(sum(calls) filter (where query like 'WITH pgrst_source%' and query like '%"p_body"%' and query like '%"p_reply_to_id"%'), 0),
      coalesce(sum(total_exec_time) filter (where query like 'WITH pgrst_source%' and query like '%"p_body"%' and query like '%"p_reply_to_id"%'), 0),
      coalesce(sum(calls) filter (where query like 'SELECT wal->>%'), 0),
      coalesce(sum(total_exec_time) filter (where query like 'SELECT wal->>%'), 0)
    from pg_stat_statements;`)
    .split("|")
    .map(Number);
  return {
    typingCalls: row[0],
    typingMs: row[1],
    sendCalls: row[2],
    sendMs: row[3],
    walCalls: row[4],
    walMs: row[5],
  };
}
const pgDelta = (a: ReturnType<typeof pgStat>, b: ReturnType<typeof pgStat>) =>
  Object.fromEntries(
    Object.keys(a).map((k) => [k, Math.round(((b as never)[k] - (a as never)[k]) * 10) / 10]),
  );

function realtimeLog(sinceIso: string): string[] {
  try {
    const out = execFileSync(
      "docker",
      ["--context", "orbstack", "logs", "--since", sinceIso, "supabase_realtime_moduo"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return out.split("\n");
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ""}\n${err.stderr ?? ""}`.split("\n");
  }
}
function realtimeLimitLines(sinceIso: string): string[] {
  return realtimeLog(sinceIso)
    .filter((l) => /limit|too many|rate|exceed|max_|ClientJoin|Unauthorized|error/i.test(l))
    .filter((l) => !/Billing metrics|api\/ping/.test(l))
    .map((l) => l.replace(/request_id=\S+ /, "").slice(0, 220));
}

// ── world: one workspace, its conversations ─────────────────────────────────
type World = {
  ws: string;
  general: string;
  quiet: string;
  switchB: string;
  storm: string[];
  typingRooms: string[];
};
const workspaceIds: string[] = [];
const typingTopicsUsed = new Set<string>();

function createWorkspace(owner: Person, members: Person[], name: string): string {
  const ws = psql(`
    update public.profiles set plan_tier = 'duo' where id = '${owner.id}';
    insert into public.workspaces (owner_id, name) values ('${owner.id}', '${name}') returning id;`);
  workspaceIds.push(ws);
  if (members.length) {
    psql(`insert into public.workspace_members (workspace_id, user_id, role)
          select '${ws}', u, 'member' from unnest(array[${members.map((m) => `'${m.id}'::uuid`).join(",")}]) u
          on conflict do nothing;`);
  }
  return ws;
}
function addToChannel(channelId: string, ws: string, members: Person[]) {
  psql(`insert into public.chat_members (channel_id, user_id, workspace_id)
        select '${channelId}', u, '${ws}' from unnest(array[${members.map((m) => `'${m.id}'::uuid`).join(",")}]) u
        on conflict do nothing;`);
}
async function rpcAs(p: Person, fn: string, a: object) {
  const c = createClient(API, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: async () => p.token,
  });
  const r = await c.rpc(fn, a);
  if (r.error) throw new Error(`${fn}: ${r.error.message}`);
  return r.data;
}

// ── browser (v1's /chat page) ───────────────────────────────────────────────
type Br = {
  label: string;
  person: Person;
  page: import("playwright-core").Page;
  requests: { at: number; what: string }[];
  sockets: string[];
  joins: { at: number; topic: string }[];
  net: Net;
};
async function passwordSession(p: Person) {
  const password = `pw-${RUN}-${p.id.slice(0, 8)}`;
  psql(
    `update auth.users set encrypted_password = extensions.crypt('${password}', extensions.gen_salt('bf')) where id = '${p.id}';`,
  );
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: p.email, password }),
  });
  if (!res.ok) throw new Error(`sign-in ${p.email}: ${res.status}`);
  const s = (await res.json()) as { expires_in: number };
  return { ...s, expires_at: Math.floor(now() / 1000) + s.expires_in };
}
async function markWelcomeSeen(userId: string) {
  const at = new Date().toISOString();
  const res = await fetch(`${API}/rest/v1/user_preferences?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      preferences: { tasksOnboarding: { welcomeSeenAt: at, roleAt: at } },
      preferences_updated_at: at,
    }),
  });
  if (!res.ok) log("welcome flag", res.status, await res.text());
}
const OBSERVER = () => {
  const w = window as unknown as { __s3: { seen: Record<string, number> } };
  w.__s3 = { seen: {} };
  const scan = (n: Node) => {
    if (!(n instanceof Element)) return;
    const at = Date.now();
    const els = n.matches("[data-message-id]")
      ? [n]
      : Array.from(n.querySelectorAll("[data-message-id]"));
    for (const el of els) {
      const id = (el as HTMLElement).dataset.messageId;
      if (id && !(id in w.__s3.seen)) w.__s3.seen[id] = at;
    }
  };
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of Array.from(m.addedNodes)) scan(n);
  }).observe(document, { childList: true, subtree: true });
};
async function openBrowser(
  browser: import("playwright-core").Browser,
  label: string,
  p: Person,
  ws: string,
  channelId: string,
  routeSocket: boolean,
): Promise<Br> {
  const session = await passwordSession(p);
  await markWelcomeSeen(p.id);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const net: Net = { mode: "up", live: new Set() };
  if (routeSocket) {
    // Only this context's socket goes through Playwright, so the gap phase
    // can cut it like a lost network (routing makes the cut explicit; setOffline was not relied on).
    await ctx.routeWebSocket(/\/realtime\/v1\/websocket/, (route) => {
      if (net.mode !== "up") {
        void route.close({ code: 4000, reason: "network down" });
        return;
      }
      const server = route.connectToServer();
      const handle = {
        drop() {
          void route.close({ code: 4000, reason: "network drop" });
          void server.close();
        },
      };
      net.live.add(handle);
      route.onClose(() => net.live.delete(handle));
    });
  }
  const host = new URL(API).hostname.split(".")[0];
  await ctx.addInitScript(
    (pairs: [string, string][]) => {
      for (const [k, v] of pairs) window.localStorage.setItem(k, v);
    },
    [
      [`sb-${host}-auth-token`, JSON.stringify(session)],
      [`moduo:selected-workspace:${p.id}`, ws],
    ] as [string, string][],
  );
  await ctx.addInitScript(OBSERVER);
  const page = await ctx.newPage();
  const b: Br = { label, person: p, page, requests: [], sockets: [], joins: [], net };
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(API) || u.includes("/realtime/v1/websocket")) return;
    const url = new URL(u);
    b.requests.push({ at: now(), what: `${r.method()} ${url.pathname.replace("/rest/v1/", "")}` });
  });
  page.on("websocket", (sock) => {
    if (!sock.url().includes("/realtime/v1/websocket")) return;
    b.sockets.push(sock.url().replace(/apikey=[^&]+/, "apikey=…"));
    sock.on("framesent", (f) => {
      const text = typeof f.payload === "string" ? f.payload : "";
      try {
        const m = JSON.parse(text);
        const [topic, event] = Array.isArray(m) ? [m[2], m[3]] : [m.topic, m.event];
        if (event === "phx_join") b.joins.push({ at: now(), topic });
      } catch {}
    });
  });
  await page.goto(`${BASE_URL}/chat?c=${channelId}`, { waitUntil: "domcontentloaded" });
  // The conversation has loaded once its seed message is drawn (v1 adds live rows only to a loaded window).
  await page.waitForSelector("[data-message-id]", { timeout: 60_000 });
  return b;
}
const seenIn = (b: Br) =>
  b.page.evaluate(
    () => (window as unknown as { __s3: { seen: Record<string, number> } }).__s3.seen,
  );
function requestsBetween(b: Br, t0: number, t1: number) {
  const list = b.requests.filter((r) => r.at >= t0 && r.at <= t1);
  const by: Record<string, number> = {};
  for (const r of list) by[r.what] = (by[r.what] ?? 0) + 1;
  return { total: list.length, by };
}

// ── results ──────────────────────────────────────────────────────────────────
const results: Record<string, unknown> = {
  run: RUN,
  api: API,
  clients: N_CLIENTS,
  phases: [...PHASES],
};
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 2));

function latencyFor(
  list: Sent[],
  clients: Client[],
  offset: number,
  hears: (s: Sent, c: Client) => boolean = () => true,
) {
  const viaSend: number[] = [];
  const viaCommit: number[] = [];
  let expected = 0;
  let missing = 0;
  const bytes: number[] = [];
  /** messages some receiver never got: seq → how many missed it, and when it was sent */
  const missedBy: Record<string, { receivers: number; sentAt: string }> = {};
  for (const s of list) {
    for (const c of clients) {
      if (c.person.id === s.by || !hears(s, c)) continue;
      expected++;
      const r = c.got.get(s.id);
      if (!r) {
        missing++;
        missedBy[s.seq] = {
          receivers: (missedBy[s.seq]?.receivers ?? 0) + 1,
          sentAt: new Date(s.tReq).toISOString(),
        };
        continue;
      }
      viaSend.push(r.at - s.tReq);
      viaCommit.push(r.at - (r.commitTs - offset));
      bytes.push(r.bytes);
    }
  }
  return {
    expected,
    missing,
    missedBy,
    fromSendCall: stats(viaSend),
    fromCommit: stats(viaCommit),
    eventBytes: stats(bytes),
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
const before = execFileSync("psql", [DB, "-X", "-At", "-f", join(HERE, "row-counts.sql")], {
  encoding: "utf8",
});
const startedIso = new Date().toISOString();
let browser: import("playwright-core").Browser | null = null;
const browsers: Br[] = [];

try {
  // Bar 1: the publication.
  results.publication = psql(
    `select tablename || ' (' || array_to_string(attnames, ',') || ')' || coalesce(' where ' || rowfilter, '') from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'chat%' order by 1;`,
  ).split("\n");
  results.tenant = psql(
    `select row_to_json(t) from (select max_concurrent_users, max_events_per_second, max_joins_per_second, max_channels_per_client, max_presence_events_per_second, max_bytes_per_second, max_payload_size_in_kb from _realtime.tenants) t;`,
  );
  log("publication", results.publication);
  log("tenant limits", results.tenant);

  const needW0 = ["delivery", "gap", "typing", "switch", "burst"].some((p) => PHASES.has(p));
  let W: World | null = null;
  let nodeClients: Client[] = [];
  let brA: Br | null = null;
  let brB: Br | null = null;
  let senders: Client[] = [];

  if (needW0) {
    // ── setup: 2 browser people + N node people in one throwaway workspace ──
    log(`creating ${N_CLIENTS + 2} throwaway accounts`);
    const [pa, pb] = await createPeople(2, "browser");
    const nodes = await createPeople(N_CLIENTS, "node");
    const ws = createWorkspace(pa, [pb, ...nodes], `${RUN} load`);
    await rpcAs(pa, "chat_op_bootstrap", { p_workspace_id: ws });
    const general = psql(
      `select id from public.chat_channels where workspace_id = '${ws}' and kind = 'channel' and name = 'general';`,
    );
    const mk = async (name: string, members: Person[], priv: boolean) =>
      (
        (await rpcAs(pa, "chat_op_create_channel", {
          p_workspace_id: ws,
          p_name: name,
          p_topic: "",
          p_is_private: priv,
          p_member_ids: members.map((m) => m.id),
        })) as { id: string }
      ).id;
    const quiet = await mk("quiet", [pb], false);
    const switchB = await mk("switch-b", nodes, false);
    const storm = [await mk("storm-1", [], false), await mk("storm-2", [], false)];
    const typingRooms: string[] = [];
    for (let r = 0; r < 5; r++)
      typingRooms.push(await mk(`typing-${r + 1}`, nodes.slice(r * 4, r * 4 + 4), true));
    addToChannel(general, ws, [pa, pb, ...nodes]);
    W = { ws, general, quiet, switchB, storm, typingRooms };
    for (const t of [general, quiet, switchB, ...storm, ...typingRooms])
      typingTopicsUsed.add(`chat:typing:${t}`);
    log("workspace", ws, "general", general);

    // ── node clients: what v1 joins per tab (db, presence, open conversation's typing) ──
    // The first 10 can lose their network in the gap phase.
    const t0 = now();
    nodeClients = nodes.map((p, i) =>
      makeClient(p, `node${i + 1}`, i < 10 ? { mode: "up", live: new Set() } : undefined),
    );
    const joinRes = await Promise.all(
      nodeClients.map(async (c) => {
        const db = await joinDb(c, ws, 25);
        const pr = await joinPresence(c, ws, 25);
        const ty = await joinTyping(c, general, 25);
        return { db, pr, ty };
      }),
    );
    const bad = joinRes.flatMap((r, i) =>
      [r.db, r.pr, r.ty]
        .filter((o) => o.status !== "SUBSCRIBED")
        .map((o) => `${nodeClients[i].label}: ${o.status} ${o.err ?? ""}`),
    );
    results.ramp = {
      clients: nodeClients.length,
      seconds: (now() - t0) / 1000,
      dbJoin: stats(joinRes.map((r) => r.db.ms)),
      presenceJoin: stats(joinRes.map((r) => r.pr.ms)),
      typingJoin: stats(joinRes.map((r) => r.ty.ms)),
      notSubscribed: bad,
      presenceSyncEventsDuringRamp: nodeClients.reduce((a, c) => a + c.presenceEvents, 0),
    };
    log("ramp", JSON.stringify(results.ramp));
    senders = nodeClients.slice(-10);
    await send(senders[0], general, "seed");

    if (BASE_URL) {
      const { chromium } = await import("playwright-core");
      browser = await chromium.launch({ headless: true });
      brA = await openBrowser(browser, "A (owner, direct socket)", pa, ws, general, false);
      brB = await openBrowser(
        browser,
        "B (member, socket routed through Playwright)",
        pb,
        ws,
        general,
        true,
      );
      browsers.push(brA, brB);
      log("browsers open");
    }
    await sleep(8_000); // let presence and the pages settle before measuring
  }

  // ── bars 2 and 3: delivery latency and requests per incoming message ──────
  if (PHASES.has("delivery") && W) {
    log(
      `delivery: ${N_MESSAGES} messages, one every ${INTERVAL} ms, to ${nodeClients.length} node clients + ${browsers.length} pages`,
    );
    // Postgres Changes polls the WAL whether or not anything changes: its idle cost first.
    const idle0 = pgStat();
    await sleep(10_000);
    const walIdle10s = pgDelta(idle0, pgStat());
    const pg0 = pgStat();
    const openList: Sent[] = [];
    const tOpen0 = now();
    for (let i = 0; i < N_MESSAGES; i++) {
      const s = await send(senders[i % senders.length], W.general, "delivery");
      if (s) openList.push(s);
      await sleep(INTERVAL);
    }
    await sleep(3_000);
    const tOpen1 = now();
    const pg1 = pgStat();
    // Read what each page drew before B navigates away (a navigation resets its observer).
    const seenOpen = new Map<Br, Record<string, number>>();
    for (const b of browsers) seenOpen.set(b, await seenIn(b));
    // Then B looks at another conversation while general keeps going (v1's unread path).
    const unreadList: Sent[] = [];
    let tUn0 = 0;
    let tUn1 = 0;
    if (brB && N_UNREAD > 0) {
      await brB.page.goto(`${BASE_URL}/chat?c=${W.quiet}`, { waitUntil: "domcontentloaded" });
      await sleep(6_000);
      tUn0 = now();
      for (let i = 0; i < N_UNREAD; i++) {
        const s = await send(senders[i % senders.length], W.general, "unread");
        if (s) unreadList.push(s);
        await sleep(INTERVAL);
      }
      await sleep(3_000);
      tUn1 = now();
    }
    const clock = clockBounds(openList);
    const evPerSend =
      nodeClients
        .filter((c) => !senders.includes(c))
        .reduce((a, c) => a + c.eventTimes.filter((t) => t >= tOpen0 && t <= tOpen1).length, 0) /
      (nodeClients.length - senders.length) /
      openList.length;
    const res: Record<string, unknown> = {
      messages: openList.length,
      intervalMs: INTERVAL,
      clock,
      nodeClients: latencyFor(openList, nodeClients, clock.mid),
      eventsPerSendPerConnection: Math.round(evPerSend * 100) / 100,
      eventKinds: Object.fromEntries(nodeClients[nodeClients.length - 1].events),
      pgStat: pgDelta(pg0, pg1),
      walIdle10s,
      seconds: (tOpen1 - tOpen0) / 1000,
    };
    for (const b of browsers) {
      const seen = seenOpen.get(b) ?? {};
      const vis: number[] = [];
      const visCommit: number[] = [];
      let missing = 0;
      for (const s of openList) {
        const at = seen[s.id];
        if (!at) {
          missing++;
          continue;
        }
        vis.push(at - s.tReq);
        const c = nodeClients[0].got.get(s.id);
        visCommit.push(at - ((c?.commitTs ?? s.createdMs) - clock.mid));
      }
      if (SHOTS)
        await b.page.screenshot({
          path: join(SHOTS, `${RUN}-${b.person.name.replace(/\W+/g, "-")}-delivery.png`),
        });
      res[`browser ${b.label}`] = {
        url: b.page.url().replace(BASE_URL ?? "", ""),
        idsSeenInDom: Object.keys(seen).length,
        // What the v1 app holds open on this tab: sockets, and the topics it joined on them.
        socketsOpened: b.sockets.length,
        topicsJoined: [
          ...new Set(b.joins.map((j) => j.topic.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>"))),
        ],
        joinFrames: b.joins.length,
        visibleFromSendCall: stats(vis),
        visibleFromCommit: stats(visCommit),
        missing,
        requestsWhileOpen: requestsBetween(b, tOpen0, tOpen1),
        requestsPerMessageWhileOpen:
          Math.round((requestsBetween(b, tOpen0, tOpen1).total / openList.length) * 100) / 100,
      };
    }
    if (brB && unreadList.length) {
      const r = requestsBetween(brB, tUn0, tUn1);
      res.unreadWindow = {
        messages: unreadList.length,
        requests: r,
        requestsPerMessage: Math.round((r.total / unreadList.length) * 100) / 100,
      };
      await brB.page.goto(`${BASE_URL}/chat?c=${W.general}`, { waitUntil: "domcontentloaded" });
    }
    res.samplePayload = samplePayloads[0];
    results.delivery = res;
    log("delivery", JSON.stringify({ ...res, samplePayload: undefined }));
    save();
  }

  // ── bar 4: a 60 s disconnect, then the gap fill ───────────────────────────
  if (PHASES.has("gap") && W) {
    const group = nodeClients.slice(0, 10).filter((c) => c.net);
    const drop = group.slice(0, 5);
    const freeze = group.slice(5);
    await sleep(3_000);
    // What each held before the network went: its newest (created_at, id).
    const newest = (c: Client) => {
      let best: Sent | null = null;
      for (const id of c.got.keys()) {
        const s = sent.get(id);
        if (
          s &&
          (!best ||
            s.createdAt > best.createdAt ||
            (s.createdAt === best.createdAt && s.id > best.id))
        )
          best = s;
      }
      return best;
    };
    const mark = new Map(group.map((c) => [c, newest(c)]));
    const subsBefore = new Map(group.map((c) => [c, c.dbSubscribedAt.length]));
    log(
      `gap: ${drop.length} clients lose the network, ${freeze.length} freeze, page B drops, for ${GAP_S} s`,
    );
    const tDown = now();
    for (const c of drop) {
      c.net!.mode = "down";
      for (const s of [...c.net!.live]) s.drop();
    }
    for (const c of freeze) c.net!.mode = "frozen";
    if (brB) {
      brB.net.mode = "down";
      for (const s of [...brB.net.live]) s.drop();
    }
    const reqB0 = now();
    const gapList: Sent[] = [];
    const tEnd = tDown + GAP_S * 1000;
    // Four senders at once every 12 s, so rows share near-identical stamps.
    while (now() < tEnd - 1_000) {
      const burst = await Promise.all(senders.slice(0, 4).map((s) => send(s, W!.general, "gap")));
      gapList.push(...(burst.filter(Boolean) as Sent[]));
      await sleep(Math.min(12_000, Math.max(0, tEnd - now() - 1_000)));
    }
    await sleep(Math.max(0, tEnd - now()));
    const tUp = now();
    for (const c of group) c.net!.mode = "up";
    if (brB) brB.net.mode = "up";
    // Keep sending through the rejoin, one a second for 15 s.
    const rejoinList: Sent[] = [];
    for (let i = 0; i < 15; i++) {
      const s = await send(senders[i % senders.length], W.general, "rejoin");
      if (s) rejoinList.push(s);
      await sleep(1_000);
    }
    // Each client: wait for its postgres_changes to be live again, then read the delta.
    const perClient: Record<string, unknown>[] = [];
    const deadline = now() + 60_000;
    for (const c of group) {
      while (c.dbSubscribedAt.length <= subsBefore.get(c)! && now() < deadline) await sleep(200);
      const rejoinedAt = c.dbSubscribedAt[subsBefore.get(c)!];
      const m = mark.get(c)!;
      const q = c.sb
        .from("chat_messages")
        .select("id, created_at")
        .eq("workspace_id", W.ws)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1000);
      const { data, error } = m
        ? await q.or(
            `created_at.gt."${m.createdAt}",and(created_at.eq."${m.createdAt}",id.gt.${m.id})`,
          )
        : await q;
      const delta = new Set((data ?? []).map((r: { id: string }) => r.id));
      const after = [...gapList, ...rejoinList];
      const missedByStream = after.filter((s) => !c.got.has(s.id));
      const stillMissing = after.filter((s) => !c.got.has(s.id) && !delta.has(s.id));
      const dupes = after.filter((s) => c.got.has(s.id) && delta.has(s.id)).length;
      const errs = c.statuses.filter((s) => s.at >= tDown && s.status !== "SUBSCRIBED");
      perClient.push({
        client: c.label,
        mode: drop.includes(c) ? "network lost" : "frozen (heartbeat)",
        firstErrorAfterMs: errs.length ? errs[0].at - tDown : null,
        rejoinedAfterUpMs: rejoinedAt ? rejoinedAt - tUp : null,
        sentAfterMark: after.length,
        missedByStream: missedByStream.length,
        missedSeqs: missedByStream.map((s) => s.seq),
        deltaRows: delta.size,
        deltaError: error?.message ?? null,
        stillMissing: stillMissing.length,
        inBothStreamAndDelta: dupes,
      });
    }
    const res: Record<string, unknown> = {
      seconds: GAP_S,
      sentDuringOutage: gapList.length,
      sentDuringRejoin: rejoinList.length,
      sameMillisecondPairs: (() => {
        const ms = gapList.map((s) => s.createdAt.slice(0, 23));
        return ms.length - new Set(ms).size;
      })(),
      clients: perClient,
    };
    if (brB) {
      const want = [...gapList, ...rejoinList];
      const t0 = now();
      let seen: Record<string, number> = {};
      while (now() - t0 < 45_000) {
        seen = await seenIn(brB);
        if (want.every((s) => seen[s.id])) break;
        await sleep(500);
      }
      const shown = want.filter((s) => seen[s.id]);
      res.browserB = {
        shownAfterRejoin: `${shown.length}/${want.length}`,
        lastShownAfterUpMs: shown.length
          ? Math.max(...gapList.filter((s) => seen[s.id]).map((s) => seen[s.id])) - tUp
          : null,
        requestsFromDownToSettled: requestsBetween(brB, reqB0, now()),
        socketsOpened: brB.sockets.length,
      };
    }
    results.gap = res;
    log("gap", JSON.stringify(res));
    save();
  }

  // ── bar 5: typing through chat_op_typing + realtime.send ─────────────────
  if (PHASES.has("typing") && W) {
    const typists = nodeClients.slice(0, 20);
    // Each typist opens its team's conversation: one leave + one join (a switch).
    const switchMs: number[] = [];
    await Promise.all(
      typists.map(async (c, i) => {
        await leave(c, `chat:typing:${W!.general}`);
        const o = await joinTyping(c, W!.typingRooms[Math.floor(i / 4)], 50);
        switchMs.push(o.ms);
      }),
    );
    await sleep(2_000);
    for (const c of typists) c.typing = [];
    const rowsBefore = Number(
      psql(
        `select count(*) from realtime.messages where topic = any(array[${W.typingRooms.map((r) => `'chat:typing:${r}'`).join(",")}]);`,
      ),
    );
    const pg0 = pgStat();
    const calls: { by: string; at: number; ms: number; ok: boolean }[] = [];
    log(`typing: ${typists.length} typists, one event per 3 s each, for ${TYPING_S} s`);
    const t0 = now();
    await Promise.all(
      typists.map(async (c, i) => {
        await sleep(Math.random() * 3_000);
        let k = 0;
        while (now() - t0 < TYPING_S * 1000) {
          const at = now();
          const r = await c.sb.rpc("chat_op_typing", {
            p_channel_id: W!.typingRooms[Math.floor(i / 4)],
            p_parent_id: null,
            p_stop: k % 4 === 3,
          });
          calls.push({ by: c.person.id, at, ms: now() - at, ok: !r.error });
          k++;
          await sleep(Math.max(0, 3_000 - (now() - at)));
        }
      }),
    );
    await sleep(2_000);
    const t1 = now();
    const pg1 = pgStat();
    const rowsAfter = Number(
      psql(
        `select count(*) from realtime.messages where topic = any(array[${W.typingRooms.map((r) => `'chat:typing:${r}'`).join(",")}]);`,
      ),
    );
    const lat: number[] = [];
    let expected = 0;
    let received = 0;
    for (let i = 0; i < typists.length; i++) {
      const room = Math.floor(i / 4);
      const mates = typists.filter((_, j) => Math.floor(j / 4) === room && j !== i);
      const mine = calls.filter((x) => x.by === typists[i].person.id && x.ok);
      for (const m of mates) {
        const evs = m.typing.filter((e) => e.from === typists[i].person.id);
        expected += mine.length;
        received += evs.length;
        for (const e of evs) {
          const call = [...mine].reverse().find((x) => x.at <= e.at);
          if (call) lat.push(e.at - call.at);
        }
      }
    }
    const pd = pgDelta(pg0, pg1) as Record<string, number>;
    const secs = (t1 - t0) / 1000;
    results.typing = {
      typists: typists.length,
      conversations: W.typingRooms.length,
      seconds: secs,
      calls: calls.length,
      failed: calls.filter((x) => !x.ok).length,
      callsPerSecond: Math.round((calls.length / TYPING_S) * 100) / 100,
      rpcRoundTrip: stats(calls.map((x) => x.ms)),
      dbExecMsPerCall: pd.typingCalls
        ? Math.round((pd.typingMs / pd.typingCalls) * 1000) / 1000
        : null,
      dbCallsCounted: pd.typingCalls,
      realtimeMessagesRows: rowsAfter - rowsBefore,
      realtimeMessagesRowsPerMinute: Math.round(((rowsAfter - rowsBefore) / TYPING_S) * 60),
      deliveries: { expected, received },
      delivery: stats(lat),
      switchJoin: stats(switchMs),
      walPollingDuring: { calls: pd.walCalls, ms: pd.walMs },
    };
    log("typing", JSON.stringify(results.typing));
    // Back to general, as the delivery world expects.
    await Promise.all(
      typists.map(async (c, i) => {
        await leave(c, `chat:typing:${W!.typingRooms[Math.floor(i / 4)]}`);
        await joinTyping(c, W!.general, 50);
      }),
    );
    // Broadcast from the database to a crowd: one typist in the 100-person
    // conversation, one event a second for 30 s, every node client listening.
    // The same transport the scale path would use for messages.
    await sleep(2_000);
    for (const c of nodeClients) c.typing = [];
    const one = nodeClients[20];
    const crowdCalls: number[] = [];
    const rows0 = Number(
      psql(`select count(*) from realtime.messages where topic = 'chat:typing:${W.general}';`),
    );
    for (let k = 0; k < 30; k++) {
      const at = now();
      const r = await one.sb.rpc("chat_op_typing", {
        p_channel_id: W.general,
        p_parent_id: null,
        p_stop: false,
      });
      if (!r.error) crowdCalls.push(at);
      await sleep(Math.max(0, 1_000 - (now() - at)));
    }
    await sleep(2_000);
    const crowdLat: number[] = [];
    let crowdGot = 0;
    for (const c of nodeClients) {
      if (c === one) continue;
      for (const e of c.typing.filter((x) => x.from === one.person.id)) {
        crowdGot++;
        const call = [...crowdCalls].reverse().find((t) => t <= e.at);
        if (call) crowdLat.push(e.at - call);
      }
    }
    (results.typing as Record<string, unknown>).crowd = {
      listeners: nodeClients.length - 1,
      calls: crowdCalls.length,
      deliveries: { expected: crowdCalls.length * (nodeClients.length - 1), received: crowdGot },
      delivery: stats(crowdLat),
      realtimeMessagesRows:
        Number(
          psql(`select count(*) from realtime.messages where topic = 'chat:typing:${W.general}';`),
        ) - rows0,
    };
    log("typing to a crowd", JSON.stringify((results.typing as Record<string, unknown>).crowd));
    save();
  }

  // ── joins per second: switching conversations ─────────────────────────────
  if (PHASES.has("switch") && W) {
    const out: Record<string, unknown> = {};
    // (a) Steady: every client switches conversation every 10 s for 40 s.
    const steady: JoinOutcome[] = [];
    const t0 = now();
    const flips = new Map<Client, boolean>();
    await Promise.all(
      nodeClients.map(async (c) => {
        await sleep(Math.random() * 10_000);
        while (now() - t0 < 40_000) {
          const onB = flips.get(c) ?? false;
          const from = onB ? W!.switchB : W!.general;
          const to = onB ? W!.general : W!.switchB;
          await leave(c, `chat:typing:${from}`);
          steady.push(await joinTyping(c, to, 1_000));
          flips.set(c, !onB);
          await sleep(10_000);
        }
      }),
    );
    out.steady = {
      clients: nodeClients.length,
      joins: steady.length,
      joinsPerSecond: Math.round((steady.length / 40) * 10) / 10,
      join: stats(steady.map((o) => o.ms)),
      refused: steady
        .filter((o) => o.status !== "SUBSCRIBED")
        .map((o) => `${o.status} ${o.err ?? ""}`),
    };
    // (b) Storm: every client opens two conversations at the same instant (2 × N joins at once).
    const tStorm = new Date().toISOString();
    const storm = await Promise.all(
      nodeClients.flatMap((c) => W!.storm.map((r) => joinTyping(c, r, 100_000))),
    );
    out.storm = {
      joinsAtOnce: storm.length,
      join: stats(storm.filter((o) => o.status === "SUBSCRIBED").map((o) => o.ms)),
      subscribed: storm.filter((o) => o.status === "SUBSCRIBED").length,
      refused: storm.filter((o) => o.status !== "SUBSCRIBED").length,
      refusals: [
        ...new Set(
          storm.filter((o) => o.status !== "SUBSCRIBED").map((o) => `${o.status} ${o.err ?? ""}`),
        ),
      ],
      realtimeLog: realtimeLimitLines(tStorm).slice(0, 12),
    };
    await Promise.all(
      nodeClients.map(async (c) => {
        for (const r of W!.storm) await leave(c, `chat:typing:${r}`);
      }),
    );
    results.switch = out;
    log("switch", JSON.stringify(out));
    save();
  }

  // ── over the events cap: 20 sends at once into a 100-person conversation ──
  if (PHASES.has("burst") && W) {
    await sleep(5_000);
    const tIso = new Date().toISOString();
    const errBefore = nodeClients.map((c) => c.statuses.length);
    const burstSenders = nodeClients.slice(-20);
    const list = (await Promise.all(burstSenders.map((c) => send(c, W!.general, "burst")))).filter(
      Boolean,
    ) as Sent[];
    await sleep(15_000);
    const lat = latencyFor(list, nodeClients, 0);
    const statusChanges = nodeClients.flatMap((c, i) =>
      c.statuses.slice(errBefore[i]).map((s) => `${s.status} ${s.err ?? ""}`),
    );
    const byStatus: Record<string, number> = {};
    for (const s of statusChanges) byStatus[s] = (byStatus[s] ?? 0) + 1;
    results.burst = {
      sends: list.length,
      subscribers: nodeClients.length + browsers.length,
      expectedDeliveries: lat.expected,
      missing: lat.missing,
      fromSendCall: lat.fromSendCall,
      statusChanges: byStatus,
      realtimeLog: realtimeLimitLines(tIso).slice(0, 15),
    };
    log("burst", JSON.stringify(results.burst));
    save();
  }

  // Close the single-workspace world before the hackathon shape.
  for (const b of browsers) await b.page.context().close();
  if (browser) await browser.close();
  browser = null;
  await Promise.all(nodeClients.map(closeClient));
  await sleep(3_000);

  // ── CH31: a busy hackathon minute (25 workspaces of 4, two sockets each) ──
  if (PHASES.has("hackathon")) {
    const crowd = people.filter((p) => p.email.includes("-node")).slice(0, TEAMS * 4);
    const extra =
      crowd.length < TEAMS * 4 ? await createPeople(TEAMS * 4 - crowd.length, "crowd") : [];
    const everyone = [...crowd, ...extra];
    type Team = { ws: string; general: string; members: Person[] };
    const teams: Team[] = [];
    for (let t = 0; t < TEAMS; t++) {
      const members = everyone.slice(t * 4, t * 4 + 4);
      const ws = createWorkspace(members[0], members.slice(1), `${RUN} team ${t + 1}`);
      await rpcAs(members[0], "chat_op_bootstrap", { p_workspace_id: ws });
      const general = psql(
        `select id from public.chat_channels where workspace_id = '${ws}' and kind = 'channel';`,
      );
      addToChannel(general, ws, members);
      typingTopicsUsed.add(`chat:typing:${general}`);
      teams.push({ ws, general, members });
    }
    // Two sockets per person: the desktop app and a browser tab.
    const conns: { c: Client; team: Team; device: string }[] = [];
    for (const team of teams)
      for (const p of team.members)
        for (const device of ["desktop", "tab"])
          conns.push({ c: makeClient(p, `${p.name} ${device}`), team, device });
    log(`hackathon: ${conns.length} sockets, 3 channels each, joins paced at 25/s`);
    const t0 = now();
    const ramp = await Promise.all(
      conns.map(async ({ c, team }) => [
        await joinDb(c, team.ws, 25),
        await joinPresence(c, team.ws, 25),
        await joinTyping(c, team.general, 25),
      ]),
    );
    const rampOut = {
      sockets: conns.length,
      joins: ramp.flat().length,
      seconds: (now() - t0) / 1000,
      notSubscribed: ramp.flat().filter((o) => o.status !== "SUBSCRIBED").length,
      statuses: [
        ...new Set(
          ramp
            .flat()
            .filter((o) => o.status !== "SUBSCRIBED")
            .map((o) => `${o.status} ${o.err ?? ""}`),
        ),
      ],
    };
    log("hackathon ramp", JSON.stringify(rampOut));
    // One socket more than the cap.
    const tOver = new Date().toISOString();
    const over = makeClient(teams[0].members[0], "socket 201");
    const overJoin = await joinTyping(over, teams[0].general, 100);
    await sleep(2_000);
    const overOut = { join: overJoin, realtimeLog: realtimeLimitLines(tOver).slice(0, 8) };
    await closeClient(over);
    log("socket over the cap", JSON.stringify(overOut));
    await sleep(5_000);

    // The minute: every person sends once at a random second; before it,
    // three typing events 3 s apart, and a stop after it (v1's composer).
    for (const { c } of conns) {
      c.eventTimes = [];
      c.typing = [];
      c.presenceEvents = 0;
    }
    const pg0 = pgStat();
    const tMin = now();
    const minuteSent: Sent[] = [];
    const typingCalls: { by: string; at: number; ok: boolean }[] = [];
    const desktopOf = new Map(
      conns.filter((x) => x.device === "desktop").map((x) => [x.c.person.id, x]),
    );
    await Promise.all(
      [...desktopOf.values()].map(async ({ c, team }) => {
        const at = 10_000 + Math.random() * 45_000;
        await sleep(at - 9_000);
        for (let k = 0; k < 3; k++) {
          const t = now();
          const r = await c.sb.rpc("chat_op_typing", {
            p_channel_id: team.general,
            p_parent_id: null,
            p_stop: false,
          });
          typingCalls.push({ by: c.person.id, at: t, ok: !r.error });
          await sleep(3_000 - (now() - t));
        }
        const s = await send(c, team.general, "hackathon");
        if (s) minuteSent.push(s);
        const t = now();
        const r = await c.sb.rpc("chat_op_typing", {
          p_channel_id: team.general,
          p_parent_id: null,
          p_stop: true,
        });
        typingCalls.push({ by: c.person.id, at: t, ok: !r.error });
      }),
    );
    await sleep(Math.max(0, 63_000 - (now() - tMin)));
    const tEnd = now();
    const pg1 = pgStat();
    // Deliveries: everything any socket received in the minute, per second.
    const buckets = new Map<number, number>();
    let pgEvents = 0;
    let typingEvents = 0;
    let presence = 0;
    for (const { c } of conns) {
      for (const t of c.eventTimes) {
        pgEvents++;
        const b = Math.floor((t - tMin) / 1000);
        buckets.set(b, (buckets.get(b) ?? 0) + 1);
      }
      for (const e of c.typing) {
        typingEvents++;
        const b = Math.floor((e.at - tMin) / 1000);
        buckets.set(b, (buckets.get(b) ?? 0) + 1);
      }
      presence += c.presenceEvents;
    }
    const perSecond = [...buckets.values()];
    const kinds: Record<string, number> = { typing: typingEvents };
    for (const { c } of conns) for (const [k, n] of c.events) kinds[k] = (kinds[k] ?? 0) + n;
    const series = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
    const minuteClients = conns.map((x) => x.c);
    const teamOf = new Map(conns.map((x) => [x.c, x.team.general]));
    const lat = latencyFor(minuteSent, minuteClients, 0, (s, c) => teamOf.get(c) === s.channelId);
    const secs = (tEnd - tMin) / 1000;
    results.hackathon = {
      ramp: rampOut,
      overTheCap: overOut,
      people: desktopOf.size,
      sockets: conns.length,
      seconds: secs,
      sends: minuteSent.length,
      typingCalls: typingCalls.length,
      typingFailed: typingCalls.filter((x) => !x.ok).length,
      delivered: { postgresChanges: pgEvents, typing: typingEvents, presenceSyncs: presence },
      deliveredByKind: kinds,
      deliveredPerSecondSeries: series,
      deliveredPerSecond: {
        mean: Math.round(((pgEvents + typingEvents) / secs) * 10) / 10,
        peakSecond: Math.max(0, ...perSecond),
      },
      inboundPerSecond: Math.round(((minuteSent.length + typingCalls.length) / secs) * 100) / 100,
      messageDelivery: {
        expected: lat.expected,
        missing: lat.missing,
        missedBy: lat.missedBy,
        // For each message someone missed: did the sender's own sockets get their echo?
        missedEcho: Object.keys(lat.missedBy).map((q) => {
          const m = minuteSent.find((x) => String(x.seq) === q);
          const own = conns.filter((x) => x.c.person.id === m?.by);
          return { seq: q, ownSocketsGotIt: own.filter((x) => m && x.c.got.has(m.id)).length };
        }),
        fromSendCall: lat.fromSendCall,
      },
      pgStat: pgDelta(pg0, pg1),
      realtimeLog: realtimeLimitLines(new Date(tMin).toISOString()).slice(0, 10),
    };
    log("hackathon", JSON.stringify(results.hackathon));
    await Promise.all(conns.map((x) => closeClient(x.c)));
    save();
  }
} catch (e) {
  results.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  log("ERROR", results.error);
} finally {
  // ── leave the local stack as it was ──────────────────────────────────────
  try {
    if (browser) await browser.close();
  } catch {}
  await Promise.all(allClients.map(closeClient));
  await sleep(2_000);
  const cleanup: string[] = [];
  if (typingTopicsUsed.size)
    cleanup.push(
      `realtime.messages rows deleted: ${psql(`with d as (delete from realtime.messages where topic = any(array[${[...typingTopicsUsed].map((t) => `'${t}'`).join(",")}]) returning 1) select count(*) from d;`)}`,
    );
  if (people.length) {
    const ids = people.map((p) => `'${p.id}'::uuid`).join(",");
    cleanup.push(
      `workspaces deleted: ${psql(`with d as (delete from public.workspaces where id = any(array[${workspaceIds.map((w) => `'${w}'::uuid`).join(",") || "null::uuid"}]::uuid[]) or owner_id = any(array[${ids}]) returning 1) select count(*) from d;`)}`,
    );
    for (let i = 0; i < people.length; i += 10)
      await Promise.all(people.slice(i, i + 10).map((p) => admin.auth.admin.deleteUser(p.id)));
    cleanup.push(`accounts deleted: ${people.length}`);
    cleanup.push(
      `accounts left: ${psql(`select count(*) from auth.users where email like '${RUN}-%';`)}`,
    );
    // The admin API logs every create, sign-in and delete; this run's lines name its accounts.
    cleanup.push(
      `auth audit lines deleted: ${psql(`with d as (delete from auth.audit_log_entries where payload::text like '%${RUN}-%' returning 1) select count(*) from d;`)}`,
    );
  }
  await sleep(3_000);
  // This run's own leftovers, by id (the stack is shared: the row-count diff
  // below also shows whatever other sessions did meanwhile).
  if (people.length) {
    const ids = `array[${people.map((p) => `'${p.id}'::uuid`).join(",")}]`;
    const wss = `array[${workspaceIds.map((w) => `'${w}'::uuid`).join(",") || "null::uuid"}]::uuid[]`;
    const topics = `array[${[...typingTopicsUsed].map((t) => `'${t}'`).join(",") || "''"}]`;
    // Realtime drops a closed socket's Postgres Changes subscriptions a few seconds later.
    for (let i = 0; i < 30; i++) {
      if (
        psql(
          `select count(*) from realtime.subscription where (claims->>'sub')::uuid = any(${ids});`,
        ) === "0"
      )
        break;
      await sleep(1_000);
    }
    results.leftovers = psql(`select json_build_object(
      'auth.users', (select count(*) from auth.users where id = any(${ids}) or email like '${RUN}-%'),
      'auth.sessions', (select count(*) from auth.sessions where user_id = any(${ids})),
      'profiles', (select count(*) from public.profiles where id = any(${ids})),
      'workspaces', (select count(*) from public.workspaces where id = any(${wss}) or owner_id = any(${ids})),
      'workspace_members', (select count(*) from public.workspace_members where workspace_id = any(${wss}) or user_id = any(${ids})),
      'chat_channels', (select count(*) from public.chat_channels where workspace_id = any(${wss})),
      'chat_messages', (select count(*) from public.chat_messages where workspace_id = any(${wss})),
      'chat_members', (select count(*) from public.chat_members where workspace_id = any(${wss}) or user_id = any(${ids})),
      'realtime.messages', (select count(*) from realtime.messages where topic = any(${topics}) or topic = any(select 'chat:' || w::text from unnest(${wss}) w)),
      'realtime.subscription', (select count(*) from realtime.subscription where (claims->>'sub')::uuid = any(${ids})),
      'auth.audit_log_entries', (select count(*) from auth.audit_log_entries where payload::text like '%${RUN}-%'));`);
    log("this run's leftovers", results.leftovers);
  }
  const after = execFileSync("psql", [DB, "-X", "-At", "-f", join(HERE, "row-counts.sql")], {
    encoding: "utf8",
  });
  const b0 = new Map(
    before
      .trim()
      .split("\n")
      .map((l) => l.split("=") as [string, string]),
  );
  const diff = after
    .trim()
    .split("\n")
    .map((l) => l.split("=") as [string, string])
    .filter(([t, n]) => b0.get(t) !== n)
    .map(([t, n]) => `${t}: ${b0.get(t) ?? "new"} → ${n}`);
  results.cleanup = cleanup;
  results.rowCountDiff = diff;
  results.startedAt = startedIso;
  save();
  log("cleanup", cleanup.join(" · "));
  log("row counts that differ from before the run:", diff.length ? diff : "none");
  log("results:", OUT);
  await admin.realtime.disconnect();
  process.exit(results.error ? 1 : 0);
}
