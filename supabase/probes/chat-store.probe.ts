// The chat store end to end on the local stack (CV-3): the app's own store,
// transport and live source on a signed-in test client. Checks the narrowed
// Realtime payload arrives in the app's real channel setup (spike 3's open
// question), live rows land with zero requests, keyset pages over a shared
// timestamp, a delta equal to a full read, resends under one id, the narrowed
// op answers, and a removal leaving the store within one access check. Two
// throwaway accounts and one workspace, removed at the end. Needs the local
// stack up with the chat v2 migrations applied (CV-1, CV-2a, CV-2b).
//
//   DOCKER_CONTEXT=orbstack bun supabase/probes/chat-store.probe.ts
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CHAT_MESSAGE_COLUMN_LIST } from "../../apps/app/src/features/chat/columns";
import type { ChatRuntime } from "../../apps/app/src/features/chat/model";
import { type ChatSocket, postgresChangesSource } from "../../apps/app/src/features/chat/realtime";
import { memoryChatCopy } from "../../apps/app/src/features/chat/store/device-copy";
import { ChatStore } from "../../apps/app/src/features/chat/store/store";
import { timestampMicros } from "../../apps/app/src/features/tasks/live";
import { chatRuntimeOn } from "../../apps/app/src/lib/runtime.chat.supabase";

const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }));
const URL_ = status.API_URL as string;
const ANON = (status.PUBLISHABLE_KEY ?? status.ANON_KEY) as string;
const SERVICE = (status.SECRET_KEY ?? status.SERVICE_ROLE_KEY) as string;
if (!/^http:\/\/127\.0\.0\.1:/.test(URL_)) throw new Error("The probe runs on the local stack only.");
const DB = "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
const psql = (sql: string) =>
  execFileSync("psql", [DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim();

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = `chat-store-probe-${Date.now()}`;
const results: string[] = [];
const ok = (cond: boolean, label: string, detail?: string) =>
  results.push(`${cond ? "PASS" : "FAIL"}: ${label}${!cond && detail ? ` [${detail}]` : ""}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 5_000): Promise<boolean> {
  for (let t = 0; t < ms; t += 50) {
    if (cond()) return true;
    await wait(50);
  }
  return cond();
}

const people: { id: string; client?: SupabaseClient }[] = [];
async function person(name: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `${tag}-${name}@example.test`;
  const password = `pw-${tag}-${name}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  people.push({ id: data.user.id });
  psql(`update auth.users set encrypted_password = extensions.crypt('${password}', extensions.gen_salt('bf')) where id = '${data.user.id}';`);
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  client.realtime.setAuth(signed.data.session!.access_token);
  people[people.length - 1]!.client = client;
  return { id: data.user.id, client };
}

/** The client as a socket that also records each raw message payload. */
function recording(client: SupabaseClient, raw: Record<string, unknown>[]): ChatSocket {
  return {
    channel: ((topic: string, opts?: unknown) => {
      const ch = client.channel(topic, opts as never);
      const on = ch.on.bind(ch);
      (ch as unknown as { on: unknown }).on = (kind: string, filter: unknown, fn: (p: unknown) => void) =>
        on(kind as never, filter as never, ((p: { new?: Record<string, unknown> }) => {
          if (kind === "postgres_changes" && (filter as { table?: string }).table === "chat_messages" && p.new) {
            raw.push(p.new);
          }
          fn(p);
        }) as never);
      return ch;
    }) as ChatSocket["channel"],
    removeChannel: (ch) => client.removeChannel(ch),
  };
}

/** A transport that counts its requests. */
function counted(rt: ChatRuntime, calls: string[]): ChatRuntime {
  return new Proxy(rt, {
    get(target, key) {
      const value = target[key as keyof ChatRuntime];
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(key));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

let W = "";
let store: ChatStore | null = null;
try {
  const A = await person("a");
  const B = await person("b");
  W = psql(`
    update public.profiles set plan_tier = 'duo' where id = '${A.id}';
    insert into public.workspaces (owner_id, name) values ('${A.id}', '${tag}') returning id;
  `);
  psql(`insert into public.workspace_members (workspace_id, user_id, role) values ('${W}', '${B.id}', 'member') on conflict do nothing;`);
  const a = chatRuntimeOn(() => A.client);
  const calls: string[] = [];
  const b = counted(chatRuntimeOn(() => B.client), calls);
  await a.bootstrap(W);
  const G = (await a.listChannels(W)).find((c) => c.isDefault)?.id;
  if (!G) throw new Error("no General");

  // ── the op answers are narrowed; a resend under one id makes one message ──
  const first = randomUUID();
  const sent = await a.send({ id: first, channelId: G, body: "hello", replyToId: null });
  ok(sent.data?.id === first, "a send keeps the client-minted id", JSON.stringify(sent.error));
  const again = await a.send({ id: first, channelId: G, body: "hello", replyToId: null });
  ok(again.data?.id === first && again.data.updatedAt === sent.data?.updatedAt, "a resend returns the stored row");
  ok(psql(`select count(*) from public.chat_messages where id = '${first}'`) === "1", "one row for two sends");
  const narrowed = await A.client
    .rpc("chat_op_send", { p_id: randomUUID(), p_channel_id: G, p_body: "narrow", p_reply_to_id: null })
    .select("id, updated_at");
  ok(
    !narrowed.error && Object.keys((Array.isArray(narrowed.data) ? narrowed.data[0] : narrowed.data) ?? {}).sort().join() === "id,updated_at",
    "an op's answer is narrowed by select (search_tsv stays off the wire)",
    JSON.stringify(narrowed),
  );
  const refused = await b.send({ id: first, channelId: G, body: "not mine", replyToId: null });
  ok(refused.error?.code === "22023", "someone else's id is refused with 22023", JSON.stringify(refused.error));

  // ── keyset pages over 200 messages on one timestamp ──
  psql(`
    insert into public.chat_messages (id, workspace_id, channel_id, author_id, body, format_version, created_at, updated_at)
    select gen_random_uuid(), '${W}', '${G}', '${A.id}', 'tie ' || g, 2, timestamptz '2026-01-01 10:00:00.123456+00', timestamptz '2026-01-01 10:00:00.123456+00'
      from generate_series(1, 200) g;
    insert into public.chat_messages (id, workspace_id, channel_id, author_id, body, format_version, created_at, updated_at)
    select gen_random_uuid(), '${W}', '${G}', '${A.id}', 'before ' || g, 2, timestamptz '2026-01-01 09:00:00+00' + g * interval '1 second', timestamptz '2026-01-01 09:00:00+00' + g * interval '1 second'
      from generate_series(1, 30) g;
  `);
  const total = Number(psql(`select count(*) from public.chat_messages where channel_id = '${G}'`));

  // ── the app's store on B's client, with the app's live source ──
  const raw: Record<string, unknown>[] = [];
  const live = postgresChangesSource(recording(B.client, raw));
  store = new ChatStore(b, B.id, W, { copy: memoryChatCopy(), live, timing: { joinDebounceMs: 50 } });
  store.acquire();
  await store.ready();
  ok(store.getSnapshot().status === "ready", "B's store loads", store.getSnapshot().error ?? "");
  await store.open(G);
  while (store.getSnapshot().windows[G]?.hasOlder) await store.loadOlder(G);
  const drawn = store.getSnapshot().windows[G]!.rows;
  ok(drawn.length === total && new Set(drawn.map((r) => r.id)).size === total, "keyset pages return every message once over a shared timestamp", `${drawn.length}/${total}`);

  // Wait for the live sources to join (each answers "Subscribed to PostgreSQL").
  await wait(2_000);
  const before = calls.length;
  const liveId = randomUUID();
  await a.send({ id: liveId, channelId: G, body: "live one", replyToId: null });
  const arrived = await until(() => Boolean(store?.rowById(liveId)));
  ok(arrived, "a live row lands in B's store");
  const fetched = calls.slice(before).filter((c) => c === "page" || c === "message" || c === "delta" || c === "counts");
  ok(fetched.length === 0, "with zero requests per incoming message", fetched.join());
  const payload = raw.find((r) => r.id === liveId) ?? {};
  ok(
    Object.keys(payload).sort().join() === [...CHAT_MESSAGE_COLUMN_LIST].sort().join(),
    "the narrowed select payload arrives in the app's real channel setup",
    Object.keys(payload).sort().join(),
  );

  // ── a delta equals a full read ──
  // Twenty more (written directly: the send limit would refuse a burst), an edit and a reaction.
  psql(`
    insert into public.chat_messages (id, workspace_id, channel_id, author_id, body, format_version)
    select gen_random_uuid(), '${W}', '${G}', '${A.id}', 'd ' || g, 2 from generate_series(1, 20) g;
  `);
  await a.edit({ id: first, body: "hello, edited" });
  await a.react({ id: first, key: "👍", on: true });
  await store.sync("manual");
  const full = psql(`select string_agg(id::text || '@' || (extract(epoch from updated_at) * 1000000)::bigint, ',' order by created_at, id) from public.chat_messages where channel_id = '${G}'`);
  const mine = store.getSnapshot().windows[G]!.rows
    .filter((r) => !r.sendState)
    .map((r) => `${r.id}@${timestampMicros(r.updatedAt)}`)
    .join(",");
  ok(mine === full, "the store equals a full read after a delta", `${mine.length} vs ${full.length}`);

  // ── removed from a private conversation: gone within one access check ──
  const P = (await a.createChannel({ workspaceId: W, name: "probe-private", isPrivate: true, memberIds: [B.id] })).id;
  // Written directly: A's burst above is at the send limit (a PT429 refusal).
  psql(`insert into public.chat_messages (id, workspace_id, channel_id, author_id, body, format_version) values (gen_random_uuid(), '${W}', '${P}', '${A.id}', 'secret', 2);`);
  await store.sync("manual");
  await store.open(P);
  const held = store.getSnapshot().windows[P]?.rows ?? [];
  ok(
    held.filter((r) => r.kind === "message").length === 1,
    "B holds the private conversation",
    JSON.stringify(held.map((r) => [r.kind, r.body])),
  );
  await a.removeMember({ channelId: P, userId: B.id });
  const gone = await until(() => !store?.holds(P), 5_000);
  ok(gone, "after the removal it leaves B's store (the member event runs the check)");
} catch (e) {
  results.push(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  store?.dispose({ persist: false });
  if (W) psql(`delete from public.workspaces where id = '${W}';`);
  for (const p of people) {
    await admin.auth.admin.deleteUser(p.id);
    await p.client?.realtime.disconnect();
  }
  await admin.realtime.disconnect();
}
console.log(results.join("\n"));
process.exit(results.some((r) => !r.startsWith("PASS")) ? 1 : 0);
