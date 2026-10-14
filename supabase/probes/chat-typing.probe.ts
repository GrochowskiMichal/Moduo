// Chat typing, end to end on the local stack: a conversation's member joins
// its private typing topic, an outsider cannot, nothing a client broadcasts
// reaches anyone, and a server-written typing event (chat_op_typing through
// realtime.send) arrives with the session's sender. Three throwaway accounts
// and one workspace, removed at the end. Needs `bun run local:up` and the
// chat privacy rules and the sending and typing limits applied
// (20261014090000_chat_privacy_rules.sql, 20261014155205_chat_send_limits.sql).
//
//   bun supabase/probes/chat-typing.probe.ts
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }));
const URL_ = status.API_URL as string;
const ANON = (status.PUBLISHABLE_KEY ?? status.ANON_KEY) as string;
const SERVICE = (status.SECRET_KEY ?? status.SERVICE_ROLE_KEY) as string;
const DB = "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
const psql = (sql: string) =>
  execFileSync("psql", [DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim();

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = `chat-typing-probe-${Date.now()}`;
const results: string[] = [];
const ok = (cond: boolean, label: string, detail?: string) =>
  results.push(`${cond ? "PASS" : "FAIL"}: ${label}${!cond && detail ? ` [${detail}]` : ""}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  // New accounts start without a password (TX-4's auth_users_no_password
  // trigger), so the local test password is set afterwards, as seed.sql does.
  psql(`update auth.users set encrypted_password = extensions.crypt('${password}', extensions.gen_salt('bf')) where id = '${data.user.id}';`);
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  client.realtime.setAuth(signed.data.session!.access_token);
  return { id: data.user.id, client };
}

type JoinResult = { status: string; err?: string };
function join(
  client: SupabaseClient,
  topic: string,
  onTyping?: (payload: unknown) => void,
  presence?: { key: string },
): Promise<{ channel: ReturnType<SupabaseClient["channel"]>; result: JoinResult }> {
  return new Promise((resolve) => {
    const channel = client.channel(topic, {
      config: presence ? { private: true, presence } : { private: true },
    });
    if (onTyping) channel.on("broadcast", { event: "typing" }, (m) => onTyping(m.payload));
    let done = false;
    const finish = (result: JoinResult) => {
      if (done) return;
      done = true;
      resolve({ channel, result });
    };
    channel.subscribe((s, err) => {
      if (s === "SUBSCRIBED") finish({ status: s });
      else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED")
        finish({ status: s, err: err?.message });
    });
    setTimeout(() => finish({ status: "NO_ANSWER" }), 8_000);
  });
}

const people: { id: string; client?: SupabaseClient }[] = [];
let W = "";
try {
  const A = await person("a");
  const B = await person("b");
  const X = await person("x");
  for (const p of people) p.client = [A, B, X].find((q) => q.id === p.id)?.client;

  W = psql(`
    update public.profiles set plan_tier = 'duo' where id = '${A.id}';
    insert into public.workspaces (owner_id, name) values ('${A.id}', '${tag}') returning id;
  `);
  psql(`insert into public.workspace_members (workspace_id, user_id, role) values ('${W}', '${B.id}', 'member') on conflict do nothing;`);

  let r = await A.client.rpc("chat_op_bootstrap", { p_workspace_id: W });
  if (r.error) throw new Error(`bootstrap: ${r.error.message}`);
  r = await A.client.rpc("chat_op_create_channel", {
    p_workspace_id: W,
    p_name: "probe-private",
    p_topic: "",
    p_is_private: true,
    p_member_ids: [B.id],
  });
  if (r.error) throw new Error(`create: ${r.error.message}`);
  const P = (r.data as { id: string }).id;

  // B (in P) joins P's typing topic; X (not in the workspace) is refused.
  const receivedB: unknown[] = [];
  const b = await join(B.client, `chat:typing:${P}`, (p) => receivedB.push(p));
  ok(b.result.status === "SUBSCRIBED", "B joins P's typing topic", JSON.stringify(b.result));
  const x = await join(X.client, `chat:typing:${P}`);
  ok(x.result.status !== "SUBSCRIBED", "X cannot join P's typing topic", JSON.stringify(x.result));

  // A joins the workspace presence topic, tracks presence, and cannot broadcast on it.
  const a = await join(A.client, `chat:${W}`, undefined, { key: A.id });
  ok(a.result.status === "SUBSCRIBED", "A joins the workspace presence topic", JSON.stringify(a.result));
  const tracked = await a.channel.track({ at: new Date().toISOString() });
  ok(tracked === "ok", "A tracks presence on the workspace topic", String(tracked));
  const sent = await a.channel.send({
    type: "broadcast",
    event: "typing",
    payload: { userId: "someone-else", channelId: P },
  });
  // send() only reports that the push left the socket; the server drops a
  // broadcast the policy refuses, which the receivers below show.
  ok(sent === "ok", "a client's broadcast on the workspace topic leaves the socket", String(sent));

  // A also joins P's typing topic and tries to broadcast on it: refused.
  const receivedA: unknown[] = [];
  const a2 = await join(A.client, `chat:typing:${P}`, (p) => receivedA.push(p));
  ok(a2.result.status === "SUBSCRIBED", "A joins P's typing topic", JSON.stringify(a2.result));
  const sent2 = await a2.channel.send({
    type: "broadcast",
    event: "typing",
    payload: { userId: "someone-else", channelId: P },
  });
  ok(sent2 === "ok", "a client's broadcast on the typing topic leaves the socket", String(sent2));
  await wait(1_500);
  ok(receivedB.length === 0, "nothing a client sent reached B (the server dropped both)", JSON.stringify(receivedB));

  // The op: A says they are typing; B receives it with A as the sender.
  r = await A.client.rpc("chat_op_typing", { p_channel_id: P, p_parent_id: null, p_stop: false });
  ok(!r.error, "A calls chat_op_typing", r.error?.message);
  for (let i = 0; i < 50 && receivedB.length === 0; i++) await wait(100);
  const got = receivedB[0] as Record<string, unknown> | undefined;
  ok(
    got?.userId === A.id && got?.channelId === P && got?.stop === false && got?.parentId === null,
    "B received A's typing event with A as the sender from the session",
    JSON.stringify(receivedB),
  );

  // X cannot say they are typing in P (and nothing reaches B).
  r = await X.client.rpc("chat_op_typing", { p_channel_id: P, p_parent_id: null, p_stop: false });
  ok(Boolean(r.error), "X is refused by chat_op_typing", r.error?.message);
  const before = receivedB.length;
  await wait(500);
  ok(receivedB.length === before, "nothing reached B from X");

  // B starts and then stops typing; A (also on the topic) receives both. A
  // stop goes out once, to close a start that went out, so B's second stop
  // reaches nobody.
  const fromB = (stop: boolean) =>
    receivedA.filter((p) => {
      const q = p as Record<string, unknown>;
      return q.userId === B.id && q.stop === stop;
    });
  r = await B.client.rpc("chat_op_typing", { p_channel_id: P, p_parent_id: null, p_stop: false });
  ok(!r.error, "B calls chat_op_typing (start)", r.error?.message);
  for (let i = 0; i < 50 && fromB(false).length === 0; i++) await wait(100);
  ok(fromB(false).length === 1, "A received B's typing event", JSON.stringify(receivedA));
  r = await B.client.rpc("chat_op_typing", { p_channel_id: P, p_parent_id: null, p_stop: true });
  ok(!r.error, "B calls chat_op_typing (stop)", r.error?.message);
  for (let i = 0; i < 50 && fromB(true).length === 0; i++) await wait(100);
  const ownEcho = receivedA.find((p) => (p as Record<string, unknown>).userId === A.id);
  ok(Boolean(ownEcho), "A also received their own server-written event (the client drops it as self)");
  ok(fromB(true).length === 1, "A received B's stop event", JSON.stringify(receivedA));
  r = await B.client.rpc("chat_op_typing", { p_channel_id: P, p_parent_id: null, p_stop: true });
  ok(!r.error, "B's second stop is answered quietly", r.error?.message);
  await wait(1_000);
  ok(fromB(true).length === 1, "B's second stop reaches nobody", JSON.stringify(receivedA));

  for (const c of [b.channel, x.channel, a.channel, a2.channel]) await c.unsubscribe();
} catch (e) {
  results.push(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  // Leave the local stack as it was.
  if (W) {
    psql(`delete from realtime.messages where topic like 'chat:typing:%' or topic = 'chat:${W}';`);
    psql(`delete from public.workspaces where id = '${W}';`);
  }
  for (const p of people) {
    await admin.auth.admin.deleteUser(p.id);
    await p.client?.realtime.disconnect();
  }
  await admin.realtime.disconnect();
}
console.log(results.join("\n"));
process.exit(results.some((r) => !r.startsWith("PASS")) ? 1 : 0);
