// NR-7 live probe (specs/notes-refresh.md AC12): a note's private live channel
// against the LOCAL stack's real Realtime server, with the policies from
// 20261016120000_notes_live_channel.sql. `bun run local:up` first, then
//
//   bun scripts/local/notes-realtime-probe.ts
//
// It makes three throwaway local people (owner O, viewer V, member M with no
// share), a workspace and a note, joins `note:<id>` as each, and checks: M is
// refused; V listens and appears in presence but can't send; O's edits reach
// V; the service role's content-free agent cue reaches V. Everything it made
// is deleted at the end. Local only: it refuses any non-local URL.

import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  execSync("supabase status -o env", { encoding: "utf8" })
    .split("\n")
    .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [m[1], m[2]]),
);
const URL_ = env.API_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_ ?? "")) {
  console.error("✗ The local stack isn't running (bun run local:up), or it isn't local.");
  process.exit(1);
}
const DB = "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
const psql = (sql: string) => execSync(`psql "${DB}" -X -q -v ON_ERROR_STOP=1`, { input: sql });

const admin = createClient(URL_, env.SECRET_KEY, { auth: { persistSession: false } });
const run = randomBytes(4).toString("hex");
const password = randomBytes(18).toString("hex");
const noteId = randomUUID();
const wsId = randomUUID();
const topic = `note:${noteId}`;

let failed = 0;
function check(ok: boolean, label: string) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function person(tag: string) {
  const email = `nr7-${tag.toLowerCase()}-${run}@moduo.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`create ${tag}: ${error?.message}`);
  // The way supabase/seed.sql sets the dev login: the local auth server
  // doesn't take an admin-set password here.
  psql(`UPDATE auth.users SET encrypted_password = extensions.crypt('${password}', extensions.gen_salt('bf'))
        WHERE id = '${data.user.id}';`);
  const client = createClient(URL_, env.PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`sign in ${tag}: ${signIn.error.message}`);
  await client.realtime.setAuth();
  return { id: data.user.id, client };
}

function join(client: SupabaseClient, key: string) {
  const got: unknown[] = [];
  const channel = client.channel(topic, {
    config: { private: true, broadcast: { self: false }, presence: { key } },
  });
  const status = new Promise<string>((resolve) => {
    channel
      .on("broadcast", { event: "u" }, (m) => got.push(m.payload))
      .subscribe((s) => {
        if (s === "SUBSCRIBED") void channel.track({ at: Date.now() });
        if (s !== "CLOSED") resolve(s);
      });
    setTimeout(() => resolve("TIMED_OUT"), 8000);
  });
  return { channel, got, status };
}

const people: Array<{ id: string; client: SupabaseClient }> = [];
const channels: Array<{ client: SupabaseClient; channel: RealtimeChannel }> = [];
try {
  const O = await person("O");
  const V = await person("V");
  const M = await person("M");
  people.push(O, V, M);
  psql(`
    INSERT INTO public.workspaces (id, owner_id, name) VALUES ('${wsId}', '${O.id}', 'NR-7 probe ${run}');
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES ('${wsId}', '${V.id}', 'member'), ('${wsId}', '${M.id}', 'member')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
    INSERT INTO public.notes (id, workspace_id, created_by, title, share_mode)
    VALUES ('${noteId}', '${wsId}', '${O.id}', 'Probe', 'custom');
    DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = '${noteId}';
    INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
    VALUES ('${wsId}', 'note', '${noteId}', 'member', '${V.id}', 'view', '${O.id}');
  `);

  const o = join(O.client, O.id);
  const v = join(V.client, V.id);
  const m = join(M.client, M.id);
  channels.push({ client: O.client, channel: o.channel }, { client: V.client, channel: v.channel });
  channels.push({ client: M.client, channel: m.channel });
  const [os, vs, ms] = await Promise.all([o.status, v.status, m.status]);
  check(os === "SUBSCRIBED", `the owner joins ${topic} (${os})`);
  check(vs === "SUBSCRIBED", `the viewer joins (${vs})`);
  check(ms !== "SUBSCRIBED", `a member without access is refused (${ms})`);

  await wait(1500);
  const seen = Object.keys(o.channel.presenceState());
  check(seen.includes(V.id), "the owner sees the viewer in presence");
  check(!seen.includes(M.id), "the refused member never appears in presence");
  check(
    Object.values(o.channel.presenceState())
      .flat()
      .every((meta) => !("name" in (meta as object))),
    "presence carries no name",
  );

  await o.channel.send({ type: "broadcast", event: "u", payload: { b64: "AQ==" } });
  await v.channel.send({ type: "broadcast", event: "u", payload: { b64: "Ag==" } });
  await wait(1500);
  check(
    v.got.some((p) => (p as { b64?: string }).b64 === "AQ=="),
    "the owner's edit reaches the viewer",
  );
  check(
    !o.got.some((p) => (p as { b64?: string }).b64 === "Ag=="),
    "the viewer can listen but not send",
  );
  check(m.got.length === 0, "the refused member hears nothing");

  // The MCP connector's cue: service role, private, content-free.
  const cue = admin.channel(topic, { config: { private: true } });
  await cue.httpSend("u", { origin: "api_key" });
  await admin.removeChannel(cue);
  await wait(1500);
  check(
    v.got.some((p) => (p as { origin?: string }).origin === "api_key"),
    "the agent cue (service role, private) reaches the viewer",
  );
} catch (e) {
  failed += 1;
  console.log(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  for (const { client, channel } of channels) await client.removeChannel(channel);
  try {
    psql(`
      DELETE FROM public.resource_grants WHERE resource_id = '${noteId}';
      DELETE FROM public.notes WHERE id = '${noteId}';
      DELETE FROM public.workspace_members WHERE workspace_id = '${wsId}';
      DELETE FROM public.workspaces WHERE id = '${wsId}';
    `);
  } catch (e) {
    console.warn("cleanup (rows) failed:", e instanceof Error ? e.message : e);
  }
  for (const p of people) await admin.auth.admin.deleteUser(p.id).catch(() => {});
}
console.log(failed === 0 ? "\n✓ NR-7 live channel probe passed" : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
