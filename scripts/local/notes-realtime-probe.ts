// NR-7 live probe (specs/notes-refresh.md AC12) against the LOCAL stack's real
// Realtime server, with 20261016120000_notes_live_channel.sql applied.
// `bun run local:up` first, then
//
//   bun scripts/local/notes-realtime-probe.ts
//
// Three throwaway local people: owner O, viewer V (view share), member M (no
// share). It checks that the server, not the client, says who is viewing; that
// saved updates reach V while V may view the note and stop the moment the
// share is taken away, with V still connected; that M can't listen in; and
// that nobody can send on a live topic. Everything it made is deleted at the
// end. Local only: it refuses any non-local URL.

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
let seq = 0;

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

type Heard = { event: string; payload: Record<string, unknown> };
function listen(client: SupabaseClient, topic: string) {
  const heard: Heard[] = [];
  const channel = client.channel(topic, { config: { private: true } });
  const status = new Promise<string>((resolve) => {
    channel
      .on("broadcast", { event: "*" }, (m) =>
        heard.push({ event: m.event, payload: m.payload as Record<string, unknown> }),
      )
      .subscribe((s) => {
        if (s !== "CLOSED") resolve(s);
      });
    setTimeout(() => resolve("TIMED_OUT"), 8000);
  });
  return { channel, heard, status };
}

const here = (client: SupabaseClient, session: string) =>
  client.rpc("notes_live_here", { p_note_id: noteId, p_session_id: session, p_leaving: false });
const save = (origin = "user", b64 = "AQ==") => {
  seq += 1;
  psql(`INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64, origin)
        VALUES ('${wsId}', '${noteId}', 'probe', ${seq}, '${b64}', '${origin}');`);
};
const changed = (h: Heard[]) =>
  h.filter((x) => x.event === "changed" && x.payload.noteId === noteId);
const lastViewers = (h: Heard[]) =>
  (h.filter((x) => x.event === "viewers").at(-1)?.payload.viewers as string[] | undefined) ?? [];

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

  const o = listen(O.client, `notes-live:${O.id}`);
  const v = listen(V.client, `notes-live:${V.id}`);
  const spy = listen(M.client, `notes-live:${O.id}`);
  channels.push({ client: O.client, channel: o.channel }, { client: V.client, channel: v.channel });
  channels.push({ client: M.client, channel: spy.channel });
  const [os, vs, ms] = await Promise.all([o.status, v.status, spy.status]);
  check(os === "SUBSCRIBED" && vs === "SUBSCRIBED", `O and V join their own topics (${os}, ${vs})`);
  check(ms !== "SUBSCRIBED", `M can't listen on O's topic (${ms})`);

  // ── Presence comes from the server ──
  await here(O.client, "o1");
  const vHere = await here(V.client, "v1");
  check(
    Array.isArray(vHere.data) && vHere.data.includes(O.id),
    "V's heartbeat answers that O is viewing",
  );
  const mHere = await here(M.client, "m1");
  check(mHere.data === null, "M's heartbeat is refused");
  await wait(1000);
  const oViewers = lastViewers(o.heard);
  check(oViewers.includes(V.id) && !oViewers.includes(M.id), "O is told V (not M) is viewing");

  const forged = V.client.channel(`notes-live:${O.id}`, { config: { private: true } });
  const sendOwn = await forged.httpSend("viewers", { noteId, viewers: [V.id, "fake"] }).then(
    () => "sent",
    (e: Error) => e.message,
  );
  await V.client.removeChannel(forged);
  await wait(800);
  check(
    sendOwn !== "sent" && !lastViewers(o.heard).includes("fake"),
    `nobody can broadcast a fake viewer list (${sendOwn})`,
  );

  // ── Saved updates reach V; an agent write is announced ──
  save();
  await wait(1000);
  check(
    changed(v.heard).some((x) => JSON.stringify(x.payload.updates) === '["AQ=="]'),
    "a saved update reaches V inline",
  );
  save("api_key");
  await wait(1000);
  check(
    changed(v.heard).some((x) => x.payload.pull === true && !("updates" in x.payload)),
    "an agent write reaches V content-free (pull)",
  );
  check(changed(spy.heard).length === 0, "M hears nothing");

  // ── Revoke while V stays connected ──
  psql(
    `DELETE FROM public.resource_grants WHERE resource_id = '${noteId}' AND subject_id = '${V.id}';`,
  );
  const before = changed(v.heard).length;
  save("user", "Ag==");
  await wait(1500);
  check(
    changed(v.heard).length === before,
    "after the share is taken away, V (still connected) hears nothing",
  );
  check(
    changed(o.heard).some((x) => JSON.stringify(x.payload.updates) === '["Ag=="]'),
    "while O still gets it",
  );
  const vAgain = await here(V.client, "v1");
  check(vAgain.data === null, "V's next heartbeat is refused");
  await wait(1000);
  check(!lastViewers(o.heard).includes(V.id), "and O is told V is gone");
} catch (e) {
  failed += 1;
  console.log(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  for (const { client, channel } of channels) await client.removeChannel(channel);
  try {
    psql(`
      DELETE FROM public.note_updates WHERE note_id = '${noteId}';
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
