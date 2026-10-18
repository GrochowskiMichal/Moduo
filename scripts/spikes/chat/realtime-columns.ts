// CV-0 spike 3, for CV-1: which columns a Postgres Changes event carries.
// LOCAL stack only (refuses any other URL). Record: docs/build/chat-v2/CV-0-S3.md.
//
// Realtime decodes the WAL with wal2json, naming the publication's tables in
// 'add-tables' (realtime.list_changes), so a publication column list does not
// narrow what a subscriber receives. The binding's `select` does: Realtime
// keeps only those columns per subscription (realtime.subscription.selected_columns).
// This subscribes four bindings (full row, `select` on INSERT, `select` on *,
// and `select` from a second socket of the same person), sends one message and
// prints the keys each one got. Two throwaway accounts and one workspace,
// removed at the end.
//
//   bun scripts/spikes/chat/realtime-columns.ts
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT ?? "orbstack" },
  }),
) as Record<string, string>;
const API = status.API_URL;
if (!API?.startsWith("http://127.0.0.1:")) throw new Error(`Local stack only; got ${API}`);
const ANON = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const DB = "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
const psql = (sql: string) =>
  execFileSync("psql", [DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim();
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub: string) => {
  const t = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ sub, role: "authenticated", aud: "authenticated", iat: t, exp: t + 3600 });
  return `${h}.${b}.${createHmac("sha256", status.JWT_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const client = (id: string): SupabaseClient => {
  const token = mint(id);
  return createClient(API, ANON, {
    auth: { persistSession: false },
    accessToken: async () => token,
  });
};
const admin = createClient(API, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const tag = `cv0-s3-cols-${Date.now().toString(36)}`;
const ids: string[] = [];
let W = "";
let failed = false;
try {
  for (const n of ["a", "b"]) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `${tag}-${n}@example.test`,
      email_confirm: true,
    });
    if (error) throw error;
    ids.push(data.user.id);
  }
  const [A, B] = ids;
  W = psql(`update public.profiles set plan_tier = 'duo' where id = '${A}';
            insert into public.workspaces (owner_id, name) values ('${A}', '${tag}') returning id;`);
  psql(
    `insert into public.workspace_members (workspace_id, user_id, role) values ('${W}', '${B}', 'member');`,
  );
  const ca = client(A);
  const cb = client(B);
  const cb2 = client(B); // a second socket of the same person (desktop + tab)
  await ca.rpc("chat_op_bootstrap", { p_workspace_id: W });
  const G = psql(`select id from public.chat_channels where workspace_id = '${W}';`);
  const base = { schema: "public", table: "chat_messages", filter: `workspace_id=eq.${W}` };
  const pick = [
    "id",
    "channel_id",
    "parent_id",
    "author_id",
    "body",
    "created_at",
    "deleted_at",
    "edited_at",
  ];
  const bindings: [string, SupabaseClient, object][] = [
    ["full row", cb, { ...base, event: "INSERT" }],
    ["select, INSERT", cb, { ...base, event: "INSERT", select: pick }],
    ["select, *", cb, { ...base, event: "*", select: pick }],
    ["select, second socket", cb2, { ...base, event: "INSERT", select: pick }],
  ];
  const got: Record<string, { keys: string[]; bytes: number }> = {};
  for (const [label, c, b] of bindings) {
    await new Promise<void>((resolve) => {
      c.channel(`cols:${label.replace(/\W+/g, "-")}`)
        .on("postgres_changes", b as never, (p: { new: Record<string, unknown> }) => {
          got[label] = { keys: Object.keys(p.new).sort(), bytes: JSON.stringify(p).length };
        })
        .on("system", {}, (m: { extension?: string }) => {
          if (m?.extension === "postgres_changes") resolve();
        })
        .subscribe();
      setTimeout(resolve, 8_000);
    });
  }
  await ca.rpc("chat_op_send", {
    p_id: randomUUID(),
    p_channel_id: G,
    p_body: "which columns arrive",
    p_reply_to_id: null,
  });
  for (let i = 0; i < 50 && Object.keys(got).length < bindings.length; i++)
    await new Promise((r) => setTimeout(r, 100));
  for (const [label] of bindings) {
    const g = got[label];
    const ok =
      label === "full row"
        ? (g?.keys.length ?? 0) > pick.length
        : JSON.stringify(g?.keys) === JSON.stringify([...pick].sort());
    if (!ok) failed = true;
    console.log(
      `${ok ? "PASS" : "FAIL"}: ${label}: ${g ? `${g.keys.length} columns, ${g.bytes} bytes` : "no event"}${g ? ` (${g.keys.join(", ")})` : ""}`,
    );
  }
  await cb.removeAllChannels();
  await cb2.removeAllChannels();
} catch (e) {
  failed = true;
  console.log("ERROR:", e instanceof Error ? e.message : e);
} finally {
  if (W) psql(`delete from public.workspaces where id = '${W}';`);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
  psql(`delete from auth.audit_log_entries where payload::text like '%${tag}-%';`);
}
process.exit(failed ? 1 : 0);
